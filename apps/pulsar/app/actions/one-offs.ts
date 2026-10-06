"use server";

import { revalidatePath } from "next/cache";

import { and, eq, gt, isNull, or, sql } from "drizzle-orm";

import { facts, goals, oneOffs } from "@/db/schema";
import { getPerson, withGoalsDb } from "@/lib/session";
import { monthOutsideSpan, monthStart } from "@/lib/validation/budget";
import { isClosed } from "@/lib/validation/closed";
import { civilDateInZone, todayInZone } from "@/lib/zone";
import {
  createOneOffSchema,
  completeOneOffSchema,
  deleteOneOffSchema,
  editTaskSchema,
  fixTaskSchema,
  moveTaskSchema,
  scheduleOneOffSchema,
  setOneOffNoteSchema,
  type SetOneOffNoteInput,
  type ScheduleOneOffInput,
  type CreateOneOffInput,
  type CompleteOneOffInput,
  type DeleteOneOffInput,
  type MoveTaskInput,
  type EditTaskInput,
  type FixTaskInput,
} from "@/lib/validation/one-off";

import { declareFact, type DeclareFactResult } from "./facts";
import { messageKey, type MessageKey } from "@/i18n/translator";

export type CreateOneOffResult = { ok: true; oneOffId: string } | { ok: false; error: MessageKey };
export type CompleteOneOffResult = DeclareFactResult;
export type ScheduleOneOffResult = { ok: true } | { ok: false; error: MessageKey };
export type DeleteOneOffResult = { ok: true } | { ok: false; error: MessageKey };
export type SetOneOffNoteResult = { ok: true } | { ok: false; error: MessageKey };
export type MoveTaskResult = { ok: true } | { ok: false; error: MessageKey };
export type EditTaskResult = { ok: true } | { ok: false; error: MessageKey };
export type FixTaskResult = EditTaskResult;

// Carries a message key out of the transaction without collapsing every
// rejection into the same generic failure.
class NamedError extends Error {}

/**
 * Writes something to do once (RP-19, RP-20), or a task of a goal's month
 * (RP-30, RP-31). `goalId`, when given, is read back before the insert the
 * way `addPhase` reads its own goal back: `one_offs_insert_self` only checks
 * that the new row's `user_id` is the caller, never that `goal_id` names one
 * of theirs, so `goals_select_self` — not this function's own `where` — is
 * what actually hides a foreign goal. A sub-task reads its parent back
 * instead and takes the parent's goal; the policy refuses the same parents,
 * so this read only buys the refusal its key.
 */
export async function createOneOff(input: CreateOneOffInput): Promise<CreateOneOffResult> {
  const parsed = createOneOffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messageKey(parsed.error.issues[0].message) };

  const person = await getPerson();
  if (!person) return { ok: false, error: "day.errors.signedOut" };

  const { name, day, estimate, plannedMonth, parentId, note, inPlan } = parsed.data;
  // A plain one-off of a goal keeps RP-20's rules; a month's task obeys the goal's plan.
  const isTask = plannedMonth != null || estimate != null || parentId != null || inPlan === true;

  try {
    const written = await withGoalsDb(async (tx) => {
      let goalId = parsed.data.goalId ?? null;
      // The month the task counts in: its own, or its parent's.
      let month = plannedMonth ?? null;
      let goal: {
        horizon: string;
        archivedAt: Date | null;
        measureUnit: string | null;
        createdAt: Date;
      } | null = null;

      if (parentId != null) {
        const [parent] = await tx
          .select({
            goalId: oneOffs.goalId,
            parentId: oneOffs.parentId,
            day: oneOffs.day,
            estimate: oneOffs.estimate,
            plannedMonth: oneOffs.plannedMonth,
            hasFact: sql<boolean>`exists (select 1 from ${facts} f where f.one_off_id = ${oneOffs}.id)`,
            horizon: goals.horizon,
            archivedAt: goals.archivedAt,
            measureUnit: goals.measureUnit,
            createdAt: goals.createdAt,
          })
          .from(oneOffs)
          .leftJoin(goals, eq(goals.id, oneOffs.goalId))
          .where(eq(oneOffs.id, parentId));
        if (!parent) throw new NamedError("month.errors.notFound");
        if (
          parent.parentId !== null ||
          parent.plannedMonth === null ||
          parent.day !== null ||
          parent.estimate !== null ||
          parent.hasFact ||
          parent.goalId === null ||
          parent.horizon === null ||
          parent.createdAt === null
        ) {
          throw new NamedError("month.errors.parentInvalid");
        }
        goalId = parent.goalId;
        month = parent.plannedMonth.slice(0, 7);
        goal = {
          horizon: parent.horizon,
          archivedAt: parent.archivedAt,
          measureUnit: parent.measureUnit,
          createdAt: parent.createdAt,
        };
      } else if (goalId != null) {
        const [own] = await tx
          .select({
            horizon: goals.horizon,
            archivedAt: goals.archivedAt,
            measureUnit: goals.measureUnit,
            createdAt: goals.createdAt,
          })
          .from(goals)
          .where(eq(goals.id, goalId));
        if (!own) throw new NamedError("plan.errors.goalNotFound");
        goal = own;
      }

      if (isTask && goal !== null) {
        // DESIGN: a month of an ended or archived goal takes no task.
        if (isClosed(goal)) throw new NamedError("month.errors.closed");
        if (estimate != null && goal.measureUnit === null) {
          throw new NamedError("month.errors.noMeasure");
        }
        if (
          plannedMonth != null &&
          monthOutsideSpan({
            month: plannedMonth,
            openedOn: civilDateInZone(goal.createdAt),
            horizon: goal.horizon,
          })
        ) {
          throw new NamedError("month.errors.outsideSpan");
        }
      }

      // Named columns only, never the builder's `.insert()` (docs/TRAPS.md,
      // "Drizzle's insert builder names every column"): `id` and `created_at`
      // are left off, and the grant does not even list `created_at`.
      const [inserted] = await tx.execute<{ id: string }>(sql`
        insert into ${oneOffs} (user_id, goal_id, name, day, estimate, planned_month, parent_id, note, in_plan)
        values (
          ${person.id}, ${goalId}, ${name}, ${day}, ${estimate ?? null},
          ${plannedMonth != null ? monthStart(plannedMonth) : null}, ${parentId ?? null},
          ${note ?? null}, ${inPlan === true}
        )
        returning id
      `);

      return { oneOffId: inserted.id, goalId, month };
    });

    revalidatePath("/");
    revalidatePath("/sueltas");
    if (written.goalId !== null && written.month !== null) {
      revalidatePath(`/metas/${written.goalId}/meses/${written.month}`);
    }
    return { ok: true, oneOffId: written.oneOffId };
  } catch (error) {
    if (error instanceof NamedError) return { ok: false, error: messageKey(error.message) };
    throw error;
  }
}

/**
 * Gives a one-off a day, or moves one dated after today (RP-21). The row is
 * read first only to name the refusal; the enforcement is
 * `day is null or day > today` in the UPDATE and `one_offs_update_self`, so a fact landing between the two statements still
 * writes nothing — 0 rows is reported as `oneOffHasFact`.
 */
export async function scheduleOneOff(input: ScheduleOneOffInput): Promise<ScheduleOneOffResult> {
  const parsed = scheduleOneOffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messageKey(parsed.error.issues[0].message) };

  const person = await getPerson();
  if (!person) return { ok: false, error: "day.errors.signedOut" };

  const { oneOffId, day } = parsed.data;
  const today = todayInZone();

  try {
    await withGoalsDb(async (tx) => {
      const [row] = await tx
        .select({
          id: oneOffs.id,
          day: oneOffs.day,
          // `${oneOffs}.id`, never `${oneOffs.id}`: a one-table select prints
          // columns bare, and a bare `id` would bind to the subquery's own row.
          hasChildren: sql<boolean>`exists (select 1 from ${oneOffs} c where c.parent_id = ${oneOffs}.id)`,
        })
        .from(oneOffs)
        .where(eq(oneOffs.id, oneOffId));
      if (!row) throw new NamedError("day.errors.notFound");
      // A parent never takes a day (`one_offs_update_self`'s check); this names it.
      if (row.hasChildren) throw new NamedError("month.errors.parentIsDoneByChildren");
      if (row.day != null && row.day <= today) throw new NamedError("day.errors.oneOffAlreadyDated");

      const [existingFact] = await tx
        .select({ id: facts.id })
        .from(facts)
        .where(eq(facts.oneOffId, oneOffId));
      if (existingFact) throw new NamedError("day.errors.oneOffHasFact");

      const updated = await tx
        .update(oneOffs)
        .set({ day })
        .where(
          and(
            eq(oneOffs.id, oneOffId),
            eq(oneOffs.userId, person.id),
            or(isNull(oneOffs.day), gt(oneOffs.day, today)),
          ),
        )
        .returning({ id: oneOffs.id });
      if (updated.length === 0) throw new NamedError("day.errors.oneOffHasFact");
    });

    revalidatePath("/");
    revalidatePath("/sueltas");
    return { ok: true };
  } catch (error) {
    if (error instanceof NamedError) return { ok: false, error: messageKey(error.message) };
    throw error;
  }
}

/**
 * Takes a one-off off the day's list by writing the fact it produces
 * (RP-19). This is the fact path itself, not a second one: `declareFact`
 * already knows a bare `oneOffId` is one whole subject
 * (`declareFactSchema`'s `requireOneSubject`), reads no commitment and asks
 * no quantity, so calling it here is the entire act. Nothing here inserts
 * into `goals.facts` on its own.
 */
export async function completeOneOff(input: CompleteOneOffInput): Promise<CompleteOneOffResult> {
  const parsed = completeOneOffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messageKey(parsed.error.issues[0].message) };

  const person = await getPerson();
  if (!person) return { ok: false, error: "day.errors.signedOut" };

  const { oneOffId } = parsed.data;

  // A parent is done by its sub-tasks (RP-30). `facts_insert_self` refuses
  // its fact too, but as a 42501 the row could not name.
  const [child] = await withGoalsDb((tx) =>
    tx.select({ id: oneOffs.id }).from(oneOffs).where(eq(oneOffs.parentId, oneOffId)).limit(1),
  );
  if (child) return { ok: false, error: "month.errors.parentIsDoneByChildren" };

  return declareFact({ oneOffId });
}

/**
 * Deletes a one-off written by mistake (RP-22): it never happened, so there
 * is no fact to keep. This check is a courtesy, not the enforcement — round
 * 2, 2026-09-28: driven bare, under a settled session with no server action
 * in the way, the old policy let an own one-off with a fact go and the fact
 * cascaded away with it (`facts.one_off_id`'s own FK is `ON DELETE cascade`,
 * `db/schema/facts.ts`, not `restrict` — changing that risks a person's own
 * cascade elsewhere and is out of this module's own migration). The real
 * guard is `one_offs_delete_self` (`db/schema/one-offs.ts`, migration 0002):
 * its own `USING` now refuses a row that carries a fact, so even a write
 * that skips this function entirely — or a fact landing between this check
 * and the statement below — never deletes one. This check only ever buys
 * the sheet its named message before the round trip; the delete itself is
 * the same statement either way.
 */
export async function deleteOneOff(input: DeleteOneOffInput): Promise<DeleteOneOffResult> {
  const parsed = deleteOneOffSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messageKey(parsed.error.issues[0].message) };

  const person = await getPerson();
  if (!person) return { ok: false, error: "day.errors.signedOut" };

  const { oneOffId } = parsed.data;

  try {
    const deleted = await withGoalsDb(async (tx) => {
      // One statement names both refusals; a done sub-task's fact is the
      // policy's alone, and its 0 rows read as the own-fact refusal.
      const [found] = await tx
        .select({
          own: sql<boolean>`exists (select 1 from ${facts} where ${facts.oneOffId} = ${oneOffId})`,
          child: sql<boolean>`exists (
            select 1 from ${facts} f join ${oneOffs} c on c.id = f.one_off_id
            where c.parent_id = ${oneOffId}
          )`,
        })
        .from(sql`(select 1) as one`);
      if (found.own) throw new NamedError("day.errors.oneOffHasFact");
      if (found.child) throw new NamedError("month.errors.parentHasDoneChild");

      return tx
        .delete(oneOffs)
        .where(and(eq(oneOffs.id, oneOffId), eq(oneOffs.userId, person.id)))
        .returning({ id: oneOffs.id });
    });

    // A fact this check never saw, written after it and before the
    // statement above: the policy is what actually refused the row, and
    // `deleted.length === 0` is the only sign of that reaching this
    // function — reported as the same refusal, never "not found", since a
    // sheet only ever opens for a one-off the person can already see.
    if (deleted.length === 0) return { ok: false, error: "day.errors.oneOffHasFact" };

    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    if (error instanceof NamedError) return { ok: false, error: messageKey(error.message) };
    throw error;
  }
}

type TaskWrite = {
  oneOffId: string;
  name?: string;
  estimate?: number | null;
  month?: string | null;
};

/**
 * The one write behind `editTask` and `fixTask` (RP-51, RP-55, RP-57). The
 * row is read first only to name the refusal; the UPDATE is the act. A fact
 * or a child landing in between makes `one_offs_guard_day` return 0 rows for
 * an estimate or a month, reported as `doneTask`. A one-off of no goal takes
 * its name alone.
 */
async function writeTask(input: TaskWrite): Promise<EditTaskResult> {
  const person = await getPerson();
  if (!person) return { ok: false, error: "day.errors.signedOut" };

  const { oneOffId, name, estimate, month } = input;
  const touchesEstimate = estimate !== undefined;
  const touchesMonth = month !== undefined;

  try {
    const written = await withGoalsDb(async (tx) => {
      const [row] = await tx
        .select({
          goalId: oneOffs.goalId,
          parentId: oneOffs.parentId,
          inPlan: oneOffs.inPlan,
          plannedMonth: oneOffs.plannedMonth,
          // Itself or any child; `${oneOffs}.id`, never `${oneOffs.id}` (see scheduleOneOff).
          hasFact: sql<boolean>`exists (
            select 1 from ${facts} f
            where f.one_off_id = ${oneOffs}.id
              or f.one_off_id in (select c.id from ${oneOffs} c where c.parent_id = ${oneOffs}.id)
          )`,
          hasChildren: sql<boolean>`exists (select 1 from ${oneOffs} c where c.parent_id = ${oneOffs}.id)`,
          horizon: goals.horizon,
          archivedAt: goals.archivedAt,
          measureUnit: goals.measureUnit,
          createdAt: goals.createdAt,
        })
        .from(oneOffs)
        .leftJoin(goals, eq(goals.id, oneOffs.goalId))
        .where(eq(oneOffs.id, oneOffId));
      if (!row) throw new NamedError("plan.errors.notFound");

      if (row.goalId === null) {
        // A suelta (RP-57): a name, done or not, and nothing else.
        if (estimate != null) throw new NamedError("month.errors.noMeasure");
        if (touchesMonth) throw new NamedError("month.errors.invalid");
      } else {
        if (!row.inPlan || row.horizon === null || row.createdAt === null) {
          throw new NamedError("month.errors.invalid");
        }
        if (touchesEstimate || touchesMonth) {
          if (row.hasFact) throw new NamedError("roadmap.errors.doneTask");
          if (touchesMonth && row.parentId !== null) throw new NamedError("roadmap.errors.subTaskMonth");
          if (isClosed({ horizon: row.horizon, archivedAt: row.archivedAt })) {
            throw new NamedError("month.errors.closed");
          }
          if (estimate != null) {
            if (row.hasChildren) throw new NamedError("month.errors.invalid");
            if (row.measureUnit === null) throw new NamedError("month.errors.noMeasure");
          }
          if (month != null) {
            if (
              monthOutsideSpan({
                month,
                openedOn: civilDateInZone(row.createdAt),
                horizon: row.horizon,
              })
            ) {
              throw new NamedError("roadmap.errors.monthOutsideSpan");
            }
            if (month < todayInZone().slice(0, 7)) throw new NamedError("roadmap.errors.monthEnded");
          }
        }
      }

      const set: Partial<typeof oneOffs.$inferInsert> = {};
      if (name !== undefined) set.name = name;
      if (touchesEstimate) set.estimate = estimate;
      if (touchesMonth) set.plannedMonth = month === null ? null : monthStart(month);
      const updated = await tx
        .update(oneOffs)
        .set(set)
        .where(and(eq(oneOffs.id, oneOffId), eq(oneOffs.userId, person.id)))
        .returning({ id: oneOffs.id });
      if (updated.length === 0) {
        throw new NamedError(touchesEstimate || touchesMonth ? "roadmap.errors.doneTask" : "plan.errors.notFound");
      }
      return { goalId: row.goalId };
    });

    revalidatePath("/");
    revalidatePath("/sueltas");
    if (written.goalId !== null) {
      revalidatePath("/mes");
      revalidatePath(`/metas/${written.goalId}`, "layout");
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof NamedError) return { ok: false, error: messageKey(error.message) };
    throw error;
  }
}

/**
 * The sheet's one act (RP-55, RP-57): name, estimate and month of a plan
 * task, or the name of a suelta. Absent leaves a field; `month: null`
 * returns the task to the plan.
 */
export async function editTask(input: EditTaskInput): Promise<EditTaskResult> {
  const parsed = editTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messageKey(parsed.error.issues[0].message) };
  return writeTask(parsed.data);
}

/** The month half of `editTask`, for the AI (RP-51): fixes, or unfixes with `null`. */
export async function fixTask(input: FixTaskInput): Promise<FixTaskResult> {
  const parsed = fixTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messageKey(parsed.error.issues[0].message) };
  return writeTask(parsed.data);
}

/** Fixes a task to a month. Stays for the MCP until 355 deletes it. */
export async function moveTaskToMonth(input: MoveTaskInput): Promise<MoveTaskResult> {
  const parsed = moveTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messageKey(parsed.error.issues[0].message) };
  return writeTask(parsed.data);
}

/**
 * Writes, changes or empties a task's note (RP-45), done or not. One UPDATE
 * of `note` alone: it never touches `day` or `planned_month`, so
 * `one_offs_guard_day` lets it through on a done or past row. Another
 * person's row is hidden by `one_offs_update_self` and reads as 0 rows.
 */
export async function setOneOffNote(input: SetOneOffNoteInput): Promise<SetOneOffNoteResult> {
  const parsed = setOneOffNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messageKey(parsed.error.issues[0].message) };

  const person = await getPerson();
  if (!person) return { ok: false, error: "day.errors.signedOut" };

  const { oneOffId, note } = parsed.data;

  const updated = await withGoalsDb((tx) =>
    tx
      .update(oneOffs)
      .set({ note })
      .where(and(eq(oneOffs.id, oneOffId), eq(oneOffs.userId, person.id)))
      .returning({ goalId: oneOffs.goalId }),
  );
  if (updated.length === 0) return { ok: false, error: "day.errors.notFound" };

  revalidatePath("/");
  revalidatePath("/sueltas");
  revalidatePath("/mes");
  revalidatePath("/metas");
  revalidatePath("/exportar");
  const { goalId } = updated[0];
  if (goalId !== null) revalidatePath(`/metas/${goalId}`, "layout");
  return { ok: true };
}
