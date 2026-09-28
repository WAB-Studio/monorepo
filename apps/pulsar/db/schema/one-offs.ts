import { sql } from "drizzle-orm";
import { date, pgPolicy, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole, authUid, authUsers } from "drizzle-orm/supabase";

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
  },
  (t) => [
    pgPolicy("one_offs_select_self", {
      for: "select",
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId}`,
    }),
    pgPolicy("one_offs_insert_self", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${authUid} = ${t.userId}`,
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
    pgPolicy("one_offs_delete_self", {
      for: "delete",
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId} and not exists (
        select 1 from "goals"."facts" f where f.one_off_id = ${t.id}
      )`,
    }),
  ],
);

export type OneOff = typeof oneOffs.$inferSelect;
export type NewOneOff = typeof oneOffs.$inferInsert;
