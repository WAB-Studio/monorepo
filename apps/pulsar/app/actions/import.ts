"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { sql, type SQL } from "drizzle-orm";

import { commitments, goals, monthBudgets, oneOffs, phases } from "@/db/schema";
import { draftRefusals, importDraftSchema, withCutPhases } from "@/lib/import/draft";
import { getPerson, withGoalsDb } from "@/lib/session";
import { monthStart } from "@/lib/validation/budget";
import { todayInZone } from "@/lib/zone";
import { messageKey, type MessageKey } from "@/i18n/translator";

export type ConfirmImportResult =
  | { ok: true; goalIds: string[] }
  | { ok: false; error: MessageKey; at?: string };

// One parenthesised row per entry, joined into a single multi-row VALUES.
function rows(entries: SQL[]): SQL {
  return sql.join(
    entries.map((entry) => sql`(${entry})`),
    sql`, `,
  );
}

// Never a bare array parameter (docs/TRAPS.md, "An array binding is not an array").
function weekdaysSql(days: number[] | null): SQL {
  if (days === null) return sql`null::smallint[]`;
  return sql`ARRAY[${sql.join(
    days.map((day) => sql`${day}`),
    sql`, `,
  )}]::smallint[]`;
}

/**
 * Writes a reviewed import draft (RP-37). The draft is judged again here
 * with the schema and the refusals the model's answer already passed: the
 * client is not trusted, and a refusal left over is a forged or stale draft.
 *
 * One transaction, and a bounded number of statements whatever the draft
 * holds: ids are minted here so parents and children link without a
 * `returning` chain, and each table takes one multi-row insert. Raw SQL
 * naming the granted columns only (docs/TRAPS.md, "Drizzle's insert builder
 * names every column"); `goals` takes its INSERT grant and its measure
 * columns' UPDATE grant as two statements for the same reason.
 */
export async function confirmImport(input: unknown): Promise<ConfirmImportResult> {
  const parsed = importDraftSchema.safeParse(input);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    // A zod default message (an unknown field, a wrong type) is no catalogue key.
    const error = issue.message.includes(".errors.") ? messageKey(issue.message) : "import.errors.draftInvalid";
    return { ok: false, error, at: issue.path.join(".") };
  }
  // RP-37: a phase that starts before the goal opens begins today, one wholly
  // before it is dropped, so the refusals and the rows see the cut draft.
  const today = todayInZone();
  const draft = withCutPhases(parsed.data, today);

  const [refusal] = draftRefusals(draft, today);
  if (refusal) return { ok: false, error: messageKey(refusal.key), at: refusal.path };

  const person = await getPerson();
  if (!person) return { ok: false, error: "import.errors.signedOut" };

  const goalRows: SQL[] = [];
  const measureRows: SQL[] = [];
  const phaseRows: SQL[] = [];
  const budgetRows: SQL[] = [];
  const commitmentRows: SQL[] = [];
  const parentRows: SQL[] = [];
  const childRows: SQL[] = [];
  const goalIds: string[] = [];

  // RP-47: each table's position is the person's current max plus the row's
  // place in the draft, so the plan's order never rests on how a multi-row
  // VALUES is walked. A VALUES subquery reads the table as it stood before
  // the statement, so every row of one statement sees the same base.
  const basePosition = (table: typeof goals | typeof commitments | typeof oneOffs): SQL =>
    sql`(select coalesce(max(p.position), 0) from ${table} p where p.user_id = ${person.id}::uuid)`;
  let goalIndex = 0;
  let commitmentIndex = 0;
  // Parents and their children share one sequence in reading order: a child
  // sits at its parent's slot plus its own place under it.
  let taskIndex = 0;

  for (const goal of draft.goals) {
    const goalId = randomUUID();
    goalIds.push(goalId);
    goalIndex += 1;
    goalRows.push(sql`${goalId}::uuid, ${person.id}::uuid, ${goal.name}, ${goal.horizon}::date, ${basePosition(goals)} + ${goalIndex}::integer`);
    if (goal.measure !== null) {
      measureRows.push(sql`${goalId}::uuid, ${goal.measure.name}, ${goal.measure.unit}`);
    }
    for (const phase of goal.phases) {
      phaseRows.push(sql`${person.id}::uuid, ${goalId}::uuid, ${phase.aim}, ${phase.startsOn}::date, ${phase.endsOn}::date`);
    }
    for (const entry of goal.months) {
      budgetRows.push(sql`${person.id}::uuid, ${goalId}::uuid, ${monthStart(entry.month)}::date, ${entry.amount}::integer`);
    }
    for (const commitment of goal.commitments) {
      commitmentIndex += 1;
      commitmentRows.push(sql`
        ${person.id}::uuid, ${goalId}::uuid, ${commitment.name}, ${commitment.cadenceKind},
        ${commitment.cadenceN}::integer, ${weekdaysSql(commitment.cadenceWeekdays)},
        ${commitment.satisfaction}, ${commitment.targetQuantity}::integer, ${commitment.unit}::text,
        ${basePosition(commitments)} + ${commitmentIndex}::integer`);
    }
    for (const task of goal.tasks) {
      const taskId = randomUUID();
      taskIndex += 1;
      const parentIndex = taskIndex;
      parentRows.push(sql`${taskId}::uuid, ${person.id}::uuid, ${goalId}::uuid, ${task.name}, ${monthStart(task.month)}::date, ${task.estimate}::integer, ${task.note ?? null}::text, ${basePosition(oneOffs)} + ${parentIndex}::integer`);
      for (const [place, child] of task.children.entries()) {
        taskIndex += 1;
        // The parent's own row already holds base + parentIndex.
        childRows.push(sql`${person.id}::uuid, ${goalId}::uuid, ${taskId}::uuid, ${child.name}, ${child.estimate}::integer, ${child.note ?? null}::text, (select p.position from ${oneOffs} p where p.id = ${taskId}::uuid) + ${place + 1}::integer`);
      }
    }
  }

  await withGoalsDb(async (tx) => {
    await tx.execute(sql`
      insert into ${goals} (id, user_id, name, horizon, position) values ${rows(goalRows)}
    `);
    if (measureRows.length > 0) {
      await tx.execute(sql`
        update ${goals} set measure_name = m.name, measure_unit = m.unit
        from (values ${rows(measureRows)}) as m(id, name, unit)
        where ${goals}.id = m.id
      `);
    }
    if (phaseRows.length > 0) {
      await tx.execute(sql`
        insert into ${phases} (user_id, goal_id, aim, starts_on, ends_on) values ${rows(phaseRows)}
      `);
    }
    if (budgetRows.length > 0) {
      await tx.execute(sql`
        insert into ${monthBudgets} (user_id, goal_id, month, amount) values ${rows(budgetRows)}
      `);
    }
    if (commitmentRows.length > 0) {
      await tx.execute(sql`
        insert into ${commitments}
          (user_id, goal_id, name, cadence_kind, cadence_n, cadence_weekdays,
           satisfaction, target_quantity, unit, position)
        values ${rows(commitmentRows)}
      `);
    }
    // Parents before children: the child's policy reads its parent back.
    if (parentRows.length > 0) {
      await tx.execute(sql`
        insert into ${oneOffs} (id, user_id, goal_id, name, planned_month, estimate, note, position)
        values ${rows(parentRows)}
      `);
    }
    if (childRows.length > 0) {
      await tx.execute(sql`
        insert into ${oneOffs} (user_id, goal_id, parent_id, name, estimate, note, position)
        values ${rows(childRows)}
      `);
    }
  });

  revalidatePath("/");
  revalidatePath("/metas");
  return { ok: true, goalIds };
}
