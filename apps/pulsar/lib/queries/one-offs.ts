import "server-only";

import { sql } from "drizzle-orm";

import { withGoalsDb } from "@/lib/session";
import { todayInZone } from "@/lib/zone";

export type DaylessOneOff = {
  id: string;
  name: string;
  goalId: string | null;
  goalName: string | null;
};

type DaylessRow = {
  id: string;
  name: string;
  goal_id: string | null;
  goal_name: string | null;
};

// A goal is open on `day` while it is not archived and its horizon, the
// first day after it, lies after `day`. `g` is the joined goal.
function openGoal(day: string) {
  return sql`g.archived_at is null and g.horizon > ${day}::date`;
}

// One-offs written with no day, not done, whose goal is none or still open:
// the same filter `loadDay`'s `dayless_count` counts. RLS alone scopes it.
export async function listDaylessOneOffs(): Promise<DaylessOneOff[]> {
  const rows = await withGoalsDb((tx) =>
    tx.execute<DaylessRow>(sql`
      select o.id, o.name, o.goal_id, g.name as goal_name
        from "goals"."one_offs" o
        left join "goals"."goals" g on g.id = o.goal_id
        where o.day is null
          and not exists (
            select 1 from "goals"."facts" f where f.one_off_id = o.id
          )
          and (o.goal_id is null or (${openGoal(todayInZone())}))
        order by o.created_at
    `),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    goalId: row.goal_id,
    goalName: row.goal_name,
  }));
}

export type ScheduledOneOff = DaylessOneOff & { day: string };

type ScheduledRow = DaylessRow & { day: string };

// One-offs dated after `today`, not done, whose goal is none or still open on
// `today`: the same rows `loadDay`'s `scheduled_count` counts.
export async function listScheduledOneOffs(today: string): Promise<ScheduledOneOff[]> {
  const rows = await withGoalsDb((tx) =>
    tx.execute<ScheduledRow>(sql`
      select o.id, o.name, o.goal_id, g.name as goal_name, o.day
        from "goals"."one_offs" o
        left join "goals"."goals" g on g.id = o.goal_id
        where o.day > ${today}::date
          and not exists (
            select 1 from "goals"."facts" f where f.one_off_id = o.id
          )
          and (o.goal_id is null or (${openGoal(today)}))
        order by o.day, o.created_at
    `),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    goalId: row.goal_id,
    goalName: row.goal_name,
    day: row.day,
  }));
}
