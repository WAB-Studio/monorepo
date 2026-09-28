import { civilDateInZone, civilDateToDate } from "@/lib/zone";

// Whole civil days between two `YYYY-MM-DD` strings, by midday UTC — the
// same technique `scripts/harness/seed-goal.ts`'s own `addDays` uses, so a
// month boundary never drifts the count the way a naive subtraction of
// year/month/day parts would.
function daysBetween(fromCivil: string, toCivil: string): number {
  return Math.round(
    (civilDateToDate(toCivil).getTime() - civilDateToDate(fromCivil).getTime()) / 86_400_000,
  );
}

export type WeekProgress = { week: number; total: number };

/**
 * "Week N of the goal's own horizon" (RP-16's overline, `Semana.dc.html`):
 * `total` is the horizon's own span in whole weeks from the goal's creation,
 * `week` is which of those weeks `weekStart` falls in. Null when the horizon
 * carries no real span (a data problem, not a day to draw a week number for)
 * or when the queried week sits outside it — a goal already past its own
 * horizon draws no overline rather than a number nobody asked for.
 */
export function goalWeekProgress(
  goal: { horizon: string; createdAt: string },
  weekStart: string,
): WeekProgress | null {
  const createdCivil = civilDateInZone(new Date(goal.createdAt));
  const totalDays = daysBetween(createdCivil, goal.horizon);
  if (totalDays <= 0) return null;

  const total = Math.ceil(totalDays / 7);
  // A goal opened mid-week still lives in week 1 of its own horizon: a
  // negative or zero count here (the queried week starts before the goal
  // existed) floors to 1, never to zero or below.
  const week = Math.max(1, Math.floor(daysBetween(createdCivil, weekStart) / 7) + 1);
  if (week > total) return null;

  return { week, total };
}
