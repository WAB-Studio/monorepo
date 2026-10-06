"use server";

import { revalidatePath } from "next/cache";

import { sql, type SQL } from "drizzle-orm";

import { carryShare, estimateFacts } from "@/lib/plan/carry";
import { reachedByMonth } from "@/lib/plan/months";
import { monthAmount, shiftOffered, shiftPlan } from "@/lib/plan/shift";
import { pgCode } from "@/lib/db-error";
import { getPerson, withGoalsDb } from "@/lib/session";
import type { FactRow, TaskRow } from "@/lib/queries/goal";
import { toDeclaredFact } from "@/lib/queries/rows";
import { acceptShiftSchema, monthStart, type AcceptShiftInput } from "@/lib/validation/budget";
import { isClosed } from "@/lib/validation/closed";
import { todayInZone } from "@/lib/zone";
import { messageKey, type MessageKey } from "@/i18n/translator";

export type AcceptShiftResult =
  | { ok: true; moved: { budgets: number; phases: number; tasks: number; horizon: string | null } }
  | { ok: false; error: MessageKey };

// Carries a message key out of the transaction without collapsing every
// rejection into the same generic failure.
class NamedError extends Error {}

type ShiftRow = {
  goal: { horizon: string; archived_at: string | null; measure_unit: string | null } | null;
  budgets: { month: string; amount: number }[];
  phases: { id: string; aim: string; starts_on: string; ends_on: string }[];
  tasks: TaskRow[];
  facts: FactRow[];
  shifts: string[];
};

// The rows travel as one JSON array parameter, so a statement's text and
// parameter count never grow with the number of items it moves.
function asJson(rows: unknown[]): SQL {
  return sql`${JSON.stringify(rows)}::jsonb`;
}

/**
 * Moves the plan one month forward and records that it was moved (RP-48).
 * The sheet only shows what 142 derived; here the rows are read and 142 is
 * asked again, so nothing a client sends but the goal and the month is read.
 * Every write is one statement whatever the counts, raw SQL naming the
 * granted columns: the moved budgets and phases leave and return shifted in
 * one data-modifying CTE or one `update … from`, the tasks' `planned_month`
 * in one `update … from`. The budgets' insert reads the deleted rows through
 * an `order by`: the sort drains the delete first, so a month's new row never
 * meets the old one still holding its slot in the `(goal_id, month)` UNIQUE.
 */
export async function acceptShift(input: AcceptShiftInput): Promise<AcceptShiftResult> {
  const parsed = acceptShiftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messageKey(parsed.error.issues[0].message) };

  const person = await getPerson();
  if (!person) return { ok: false, error: "month.errors.signedOut" };

  const { goalId } = parsed.data;
  const month = monthStart(parsed.data.month);
  const today = todayInZone();

  let result: Extract<AcceptShiftResult, { ok: true }>["moved"];
  let emptied: string;
  try {
    ({ moved: result, emptied } = await withGoalsDb(async (tx) => {
      const [row] = await tx.execute<ShiftRow>(sql`
        select
          (select jsonb_build_object('horizon', g.horizon, 'archived_at', g.archived_at,
                                'measure_unit', g.measure_unit)
             from "goals"."goals" g where g.id = ${goalId}) as goal,
          (select coalesce(json_agg(jsonb_build_object('month', b.month, 'amount', b.amount)
                                    order by b.month), '[]'::json)
             from "goals"."month_budgets" b where b.goal_id = ${goalId}) as budgets,
          (select coalesce(json_agg(to_jsonb(p) order by p.starts_on, p.id), '[]'::json)
             from "goals"."phases" p where p.goal_id = ${goalId}) as phases,
          (select coalesce(json_agg(to_jsonb(o) || jsonb_build_object(
                     'done_on', (select min(f.day) from "goals"."facts" f where f.one_off_id = o.id)
                   ) order by o.position, o.created_at, o.id), '[]'::json)
             from "goals"."one_offs" o where o.goal_id = ${goalId}) as tasks,
          (select coalesce(json_agg(to_jsonb(f) || jsonb_build_object(
                     'commitment_unit', c.unit
                   )), '[]'::json)
             from "goals"."facts" f
             left join "goals"."commitments" c on c.id = f.commitment_id
             where f.goal_id = ${goalId} and f.commitment_id is not null) as facts,
          (select coalesce(json_agg(m.month order by m.month), '[]'::json)
             from "goals"."month_shifts" m where m.goal_id = ${goalId}) as shifts
      `);
      if (!row.goal) throw new NamedError("month.errors.notFound");
      const goal = { horizon: row.goal.horizon, archivedAt: row.goal.archived_at };
      if (isClosed(goal)) throw new NamedError("month.errors.closed");

      const tasks = row.tasks.map((task) => ({
        id: task.id,
        parentId: task.parent_id,
        name: task.name,
        plannedMonth: task.planned_month,
        day: task.day,
        estimate: task.estimate,
        doneOn: task.done_on,
      }));

      // The declared half of what each month reached, estimates included
      // (RP-36). Evidence is another transaction and is not read here, so a
      // forged accept can pass a month the screen would not have offered.
      const reached = [
        ...reachedByMonth({
          unit: row.goal.measure_unit,
          facts: [
            ...row.facts
              .filter((fact): fact is FactRow & { commitment_id: string } => fact.commitment_id !== null)
              .map(toDeclaredFact),
            ...estimateFacts(tasks, row.goal.measure_unit),
          ],
          evidence: [],
        }),
      ].map(([reachedMonth, amount]) => ({ month: reachedMonth, reached: amount }));

      const offered = shiftOffered({
        month,
        today,
        share: carryShare(tasks, month),
        amount: monthAmount(month, row.budgets, reached),
        shifted: row.shifts,
      });
      if (!offered) {
        // A month that reached its amount has its own message: the list alone
        // would have offered it.
        const listOnly = shiftOffered({
          month,
          today,
          share: carryShare(tasks, month),
          amount: { planned: null, reached: 0 },
          shifted: row.shifts,
        });
        throw new NamedError(listOnly ? "month.errors.shiftReached" : "month.errors.shiftNotOffered");
      }

      const plan = shiftPlan({
        closedMonth: month,
        today,
        horizon: goal.horizon,
        budgets: row.budgets,
        phases: row.phases.map((p) => ({
          id: p.id,
          aim: p.aim,
          startsOn: p.starts_on,
          endsOn: p.ends_on,
        })),
        tasks,
      });

      if (plan.budgets.length > 0) {
        await tx.execute(sql`
          with gone as (
            delete from "goals"."month_budgets" b
            using jsonb_array_elements(${asJson(plan.budgets)}) m
            where b.goal_id = ${goalId} and b.month = (m->>'month')::date
            returning (m->>'to')::date as to_month, b.amount
          )
          insert into "goals"."month_budgets" (user_id, goal_id, month, amount)
          select ${person.id}, ${goalId}, to_month, amount from gone order by to_month
        `);
      }

      if (plan.phases.length > 0) {
        await tx.execute(sql`
          update "goals"."phases" p
          set starts_on = (m->>'toStartsOn')::date, ends_on = (m->>'toEndsOn')::date
          from jsonb_array_elements(${asJson(plan.phases)}) m
          where p.id = (m->>'id')::uuid and p.goal_id = ${goalId}
        `);
      }

      if (plan.tasks.length > 0) {
        await tx.execute(sql`
          update "goals"."one_offs" o
          set planned_month = (m->>'to')::date
          from jsonb_array_elements(${asJson(plan.tasks)}) m
          where o.id = (m->>'id')::uuid and o.goal_id = ${goalId}
        `);
      }

      if (plan.horizon !== null) {
        await tx.execute(sql`
          update "goals"."goals" set horizon = ${plan.horizon.to}
          where id = ${goalId} and user_id = ${person.id}
        `);
      }

      await tx.execute(sql`
        insert into "goals"."month_shifts" (user_id, goal_id, month)
        values (${person.id}, ${goalId}, ${month})
      `);

      return {
        emptied: plan.emptied,
        moved: {
          budgets: plan.budgets.length,
          phases: plan.phases.length,
          tasks: plan.tasks.length,
          horizon: plan.horizon?.to ?? null,
        },
      };
    }));
  } catch (error) {
    if (error instanceof NamedError) return { ok: false, error: messageKey(error.message) };
    // The UNIQUE on (goal_id, month): a second accept that raced the first.
    if (pgCode(error) === "23505") return { ok: false, error: "month.errors.shiftNotOffered" };
    throw error;
  }

  revalidatePath("/");
  revalidatePath(`/metas/${goalId}`);
  revalidatePath(`/metas/${goalId}/meses`);
  revalidatePath(`/metas/${goalId}/meses/${parsed.data.month}`);
  revalidatePath(`/metas/${goalId}/meses/${emptied.slice(0, 7)}`);
  return { ok: true, moved: result };
}
