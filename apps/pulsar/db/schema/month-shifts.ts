import { sql } from "drizzle-orm";
import { check, date, pgPolicy, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole, authUid, authUsers } from "drizzle-orm/supabase";

import { goalsSchema } from "./_schema";
import { goals } from "./goals";

// A shift the person accepted (RP-34): the goal's plan moved one month later
// after `month` closed. An act, written once: no UPDATE and no DELETE grant.
export const monthShifts = goalsSchema.table(
  "month_shifts",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    goalId: uuid()
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    // The closed month whose carry proposed the shift.
    month: date().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A proposal accepted is never made again for that month.
    unique("month_shifts_goal_id_month_unique").on(t.goalId, t.month),
    check("month_shifts_month_first_day", sql`${t.month} = date_trunc('month', ${t.month})::date`),
    pgPolicy("month_shifts_select_self", {
      for: "select",
      to: authenticatedRole,
      using: sql`${authUid} = ${t.userId}`,
    }),
    pgPolicy("month_shifts_insert_self", {
      for: "insert",
      to: authenticatedRole,
      withCheck: sql`${authUid} = ${t.userId}`,
    }),
  ],
);

export type MonthShift = typeof monthShifts.$inferSelect;
export type NewMonthShift = typeof monthShifts.$inferInsert;
