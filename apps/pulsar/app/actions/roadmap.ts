"use server";

import { revalidatePath } from "next/cache";

import { sql } from "drizzle-orm";

import { getPerson, withGoalsDb } from "@/lib/session";
import { monthStart } from "@/lib/validation/budget";
import {
  dismissPlanNoticeSchema,
  setRhythmSchema,
  type DismissPlanNoticeInput,
  type SetRhythmInput,
} from "@/lib/validation/rhythm";
import { TIME_ZONE, todayInZone } from "@/lib/zone";
import { messageKey, type MessageKey } from "@/i18n/translator";

export type SetRhythmResult = { ok: true } | { ok: false; error: MessageKey };
export type DismissPlanNoticeResult = { ok: true } | { ok: false; error: MessageKey };

/**
 * Sets or changes a goal's rhythm (RP-52) in one statement. The CTEs read one
 * snapshot, so `g.rhythm` is the old value: it fills every closed month of the
 * span that has no amount (the plan those months were lived against), and
 * only the first rhythm (old null) sends the goal's undone top-level plan
 * tasks back to the plan. A task is done when it has a fact, or when it has
 * children and each of them has one. The guard trigger already leaves a
 * task with a fact alone; the clause says it again for the parent.
 * A goal the person cannot see, or one refused, updates and inserts nothing,
 * so the refusal needs no rollback.
 */
export async function setRhythm({ goalId, amount }: SetRhythmInput): Promise<SetRhythmResult> {
  const parsed = setRhythmSchema.safeParse({ goalId, amount });
  if (!parsed.success) return { ok: false, error: messageKey(parsed.error.issues[0].message) };

  const person = await getPerson();
  if (!person) return { ok: false, error: "month.errors.signedOut" };

  const today = todayInZone();

  const rows = await withGoalsDb((tx) =>
    tx.execute<{ measured: boolean; open: boolean }>(sql`
      with g as (
        select id, rhythm, measure_unit, horizon, archived_at,
               (created_at at time zone ${TIME_ZONE})::date as opened
        from goals where id = ${goalId}
      ),
      ok as (
        select * from g
        where measure_unit is not null and archived_at is null and horizon > ${today}::date
      ),
      upd as (
        update goals set rhythm = ${amount} where id in (select id from ok) returning id
      ),
      ins as (
        insert into month_budgets (user_id, goal_id, month, amount)
        select ${person.id}, ok.id, m::date, ok.rhythm
        from ok, generate_series(
          date_trunc('month', ok.opened), date_trunc('month', ${today}::date) - interval '1 month', interval '1 month'
        ) m
        where ok.rhythm is not null
        on conflict (goal_id, month) do nothing
        returning 1
      ),
      rel as (
        update one_offs set planned_month = null
        where goal_id in (select id from ok where rhythm is null)
          and parent_id is null and planned_month is not null
          and not exists (select 1 from facts f where f.one_off_id = one_offs.id)
          and not (
            exists (select 1 from one_offs c where c.parent_id = one_offs.id)
            and not exists (
              select 1 from one_offs c where c.parent_id = one_offs.id
                and not exists (select 1 from facts f where f.one_off_id = c.id)
            )
          )
        returning 1
      )
      select measure_unit is not null as measured,
             archived_at is null and horizon > ${today}::date as open
      from g
    `),
  );

  const goal = rows[0];
  if (!goal) return { ok: false, error: "month.errors.notFound" };
  if (!goal.open) return { ok: false, error: "month.errors.closed" };
  if (!goal.measured) return { ok: false, error: "roadmap.errors.rhythmNoMeasure" };

  revalidatePath(`/metas/${goalId}`, "layout");
  revalidatePath("/");
  return { ok: true };
}

/**
 * Dismisses Hoy's notice for a month already over (RP-53). `greatest` ignores
 * `null`, so the first dismissal sets the column and an older month never
 * pulls it back. `goals_select_self` and the update policy scope the row to
 * its owner: another person's goal matches nothing.
 */
export async function dismissPlanNotice(
  input: DismissPlanNoticeInput,
): Promise<DismissPlanNoticeResult> {
  const parsed = dismissPlanNoticeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: messageKey(parsed.error.issues[0].message) };

  const person = await getPerson();
  if (!person) return { ok: false, error: "month.errors.signedOut" };

  const { goalId, month } = parsed.data;
  if (month >= todayInZone().slice(0, 7)) return { ok: false, error: "month.errors.monthInvalid" };

  const rows = await withGoalsDb((tx) =>
    tx.execute(sql`
      update goals set plan_seen = greatest(plan_seen, ${monthStart(month)}::date)
      where id = ${goalId} returning id
    `),
  );
  if (rows.length === 0) return { ok: false, error: "month.errors.notFound" };

  revalidatePath("/");
  return { ok: true };
}
