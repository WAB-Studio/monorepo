import type { Cadence } from "@/lib/day/types";
import { horizonWeeksOf, weekIndexOf } from "@/lib/day/weeks";
import { civilDateInZone } from "@/lib/zone";

export type WeekProgress = { week: number; total: number };

/**
 * "Week N of the goal's own horizon" (RP-16's overline, `Semana.dc.html`):
 * `total` is the horizon's own span in goal weeks from the goal's creation,
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
  const total = horizonWeeksOf(createdCivil, goal.horizon);
  if (total <= 0) return null;

  // The queried week starting before the goal existed floors to week 1.
  const week = Math.max(1, weekIndexOf(createdCivil, weekStart));
  if (week > total) return null;

  return { week, total };
}

type Say = (key: string, values?: Record<string, number | string>) => string;

/**
 * A flexible commitment's own two phrases (`SemanaFlexible.dc.html`): its
 * cadence, «3 veces por semana», and the period's count, «1 de 3 esta
 * semana». Null for a cadence counted by the day.
 */
export function flexibleWords(
  commitment: { cadence: Cadence; periodDone: number | null },
  t: Say,
): { cadence: string; progress: string } | null {
  const { cadence, periodDone } = commitment;
  if (cadence.kind === "times_per_week") {
    return {
      cadence: t("week.flexible.week", { count: cadence.count }),
      progress: t("week.flexible.weekProgress", { done: periodDone ?? 0, total: cadence.count }),
    };
  }
  if (cadence.kind === "times_per_month") {
    return {
      cadence: t("week.flexible.month", { count: cadence.count }),
      progress: t("week.flexible.monthProgress", { done: periodDone ?? 0, total: cadence.count }),
    };
  }
  return null;
}
