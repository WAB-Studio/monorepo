import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  date,
  integer,
  pgPolicy,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid, authUsers } from "drizzle-orm/supabase";

import { TIME_ZONE } from "../../lib/zone";
import { goalsSchema } from "./_schema";
import { goals } from "./goals";

// Something to do once. No day when it is not on a day yet, no goal when it
// belongs to none: a one-off with neither is still a whole one-off.
export const oneOffs = goalsSchema.table(
  "one_offs",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    goalId: uuid().references(() => goals.id, { onDelete: "cascade" }),
    name: text().notNull(),
    day: date(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // In the goal's measure unit (RP-30). No UPDATE grant: written once.
    estimate: integer(),
    // A month instead of a day (RP-31); the shift is its one later write.
    plannedMonth: date(),
    // One level deep (RP-30). No UPDATE grant: a sub-task never changes hands.
    parentId: uuid().references((): AnyPgColumn => oneOffs.id, { onDelete: "cascade" }),
  },
  (t) => [
    check("one_offs_estimate_range", sql`${t.estimate} between 1 and 1000000`),
    check(
      "one_offs_planned_month_first_day",
      sql`${t.plannedMonth} = date_trunc('month', ${t.plannedMonth})::date`,
    ),
    check("one_offs_planned_month_needs_goal", sql`${t.plannedMonth} is null or ${t.goalId} is not null`),
    check("one_offs_estimate_needs_goal", sql`${t.estimate} is null or ${t.goalId} is not null`),
    // A sub-task takes its parent's month.
    check("one_offs_child_has_no_month", sql`${t.parentId} is null or ${t.plannedMonth} is null`),
    check("one_offs_not_own_parent", sql`${t.parentId} <> ${t.id}`),
    // `auth.uid()` bare, never `authUid`'s `(select auth.uid())`: the policies
    // below read this table again, and Postgres refuses as infinite recursion
    // any self-read whose select policy holds a subquery of its own (42P17).
    // The cost is one `auth.uid()` per row read instead of one per query.
    pgPolicy("one_offs_select_self", {
      for: "select",
      to: authenticatedRole,
      using: sql`auth.uid() = ${t.userId}`,
    }),
    // A sub-task hangs only off an own top-level one-off planned for a month
    // of the same goal, with no day, no estimate and no fact. Policies cannot
    // say row-to-row rules any other way; `p`'s alias keeps `${t.goalId}`
    // pointing at the new row, not at the parent.
    pgPolicy("one_offs_insert_self", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${authUid} = ${t.userId} and (${t.parentId} is null or exists (
        select 1 from "goals"."one_offs" p
        where p.id = ${t.parentId} and p.parent_id is null and p.planned_month is not null
          and p.day is null and p.estimate is null and p.goal_id = ${t.goalId}
          and not exists (select 1 from "goals"."facts" f where f.one_off_id = p.id)
      ))`,
    }),
    // RP-22: a one-off that already carries a fact is never deleted, by
    // whatever door reaches this row — the policy is the enforcement, not
    // `deleteOneOff`'s own check alone (round 2, 2026-09-28: driven bare,
    // under a settled session, with no server action in the way, the old
    // policy let the row go and the fact cascaded with it). The subquery
    // runs under the caller's own RLS on `goals.facts`
    // (`facts_select_self`): a person's own fact is always visible to them
    // there, so this never passes vacuously for the row it is meant to
    // guard — never `"goals".facts` through the `facts` table object,
    // which would close an import cycle back to this file.
    // A parent whose sub-task carries a fact stays too: the FK cascade to its
    // children bypasses RLS, so this is the only place the child's fact is kept.
    pgPolicy("one_offs_delete_self", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId} and not exists (
        select 1 from "goals"."facts" f where f.one_off_id = ${t.id}
      ) and not exists (
        select 1 from "goals"."one_offs" c join "goals"."facts" f on f.one_off_id = c.id
        where c.parent_id = ${t.id}
      )`,
    }),
    // RP-21: a one-off with no day, or a day after the person's today, takes
    // another, never one on or before today or one with a fact. The grant
    // narrows the write to `day`; `using` is what refuses the rest. Today is
    // the zone's civil day, never `current_date` (UTC). Same subquery shape
    // as the delete policy, for the same import-cycle reason.
    pgPolicy("one_offs_update_self", {
      for: "update",
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId} and (${t.day} is null or ${t.day} > (now() at time zone '${sql.raw(TIME_ZONE)}')::date) and not exists (
        select 1 from "goals"."facts" f where f.one_off_id = ${t.id}
      )`,
      // A parent never takes a day, and still takes a month. In `withCheck`,
      // never in `using`: there it would refuse the shift's move of a parent.
      withCheck: sql`${authUid} = ${t.userId} and (${t.day} is null or not exists (
        select 1 from "goals"."one_offs" c where c.parent_id = ${t.id}
      ))`,
    }),
  ],
);

export type OneOff = typeof oneOffs.$inferSelect;
export type NewOneOff = typeof oneOffs.$inferInsert;
