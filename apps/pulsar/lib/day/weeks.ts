import { addWeeksToCivilDate, civilDateToDate, dateToCivilDate } from "@/lib/zone";

// Whole civil days between two `YYYY-MM-DD` strings, at midday UTC so no
// zone offset can shift the count by one — the one implementation every
// screen that counts a goal's weeks shares (`lib/day/review.ts` and
// `components/goal/phase-weeks.ts` held identical copies of this, verified
// 2026-09-28).
export function daysBetween(from: string, to: string): number {
  const ms = civilDateToDate(to).getTime() - civilDateToDate(from).getTime();
  return Math.round(ms / 86_400_000);
}

// The 1-based week `day` falls in, counted from the goal's own opening.
// Week 1 starts the day the goal was created, never on a Monday (decided by
// the user 2026-09-28) — the one convention every screen that counts a
// goal's weeks reuses; never a second one.
export function weekIndexOf(openedOn: string, day: string): number {
  return Math.floor(daysBetween(openedOn, day) / 7) + 1;
}

export function dayBefore(day: string): string {
  const date = civilDateToDate(day);
  date.setUTCDate(date.getUTCDate() - 1);
  return dateToCivilDate(date);
}

// The inverse of `weekIndexOf`: the civil dates a span of 1-based weeks
// covers, counted from the goal's own opening. Week `fromWeek` opens
// `(fromWeek - 1) * 7` days after `openedOn`; the span closes the day before
// week `toWeek + 1` opens. `fromWeek === toWeek` gives one week's own span.
export function weekSpan(
  openedOn: string,
  fromWeek: number,
  toWeek: number,
): { startsOn: string; endsOn: string } {
  return {
    startsOn: addWeeksToCivilDate(openedOn, fromWeek - 1),
    endsOn: dayBefore(addWeeksToCivilDate(openedOn, toWeek)),
  };
}
