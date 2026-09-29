import { addWeeksToCivilDate, civilDateToDate, dateToCivilDate, weekOf } from "@/lib/zone";

// Whole civil days between two `YYYY-MM-DD` strings, at midday UTC so no
// zone offset can shift the count by one — the one implementation every
// screen that counts a goal's weeks shares (`lib/day/review.ts` and
// `components/goal/phase-weeks.ts` held identical copies of this, verified
// 2026-09-28).
export function daysBetween(from: string, to: string): number {
  const ms = civilDateToDate(to).getTime() - civilDateToDate(from).getTime();
  return Math.round(ms / 86_400_000);
}

function mondayOf(day: string): string {
  return weekOf(day)[0];
}

// The 1-based week `day` falls in, counted Monday to Sunday from the Monday
// of the goal's opening day: week 1 is the partial week from the opening day
// to its first Sunday (decided by the user 2026-09-28) — the one convention
// every screen that counts a goal's weeks reuses; never a second one.
export function weekIndexOf(openedOn: string, day: string): number {
  return Math.floor(daysBetween(mondayOf(openedOn), mondayOf(day)) / 7) + 1;
}

// A horizon is the first day after the goal: the Monday after its week
// `weeks`, so a goal written «12 semanas» ends on the Sunday of its week 12.
export function horizonForWeeks(openedOn: string, weeks: number): string {
  return addWeeksToCivilDate(mondayOf(openedOn), weeks);
}

// The inverse of `horizonForWeeks`. A horizon written as opening + 7·N reads
// back as N whatever weekday the goal opened on.
export function horizonWeeksOf(openedOn: string, horizon: string): number {
  return Math.max(0, weekIndexOf(openedOn, horizon) - 1);
}

export function dayBefore(day: string): string {
  const date = civilDateToDate(day);
  date.setUTCDate(date.getUTCDate() - 1);
  return dateToCivilDate(date);
}

// The inverse of `weekIndexOf`: the civil dates a span of 1-based weeks
// covers. Week 1 opens on `openedOn` itself; a later week opens on its own
// Monday. The span closes on the Sunday of week `toWeek`.
export function weekSpan(
  openedOn: string,
  fromWeek: number,
  toWeek: number,
): { startsOn: string; endsOn: string } {
  const firstMonday = mondayOf(openedOn);
  return {
    startsOn: fromWeek === 1 ? openedOn : addWeeksToCivilDate(firstMonday, fromWeek - 1),
    endsOn: dayBefore(addWeeksToCivilDate(firstMonday, toWeek)),
  };
}
