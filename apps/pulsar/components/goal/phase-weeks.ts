import { daysBetween, weekIndexOf, weekSpan } from "@/lib/day/weeks";

export { daysBetween };

// The 1-based week `day` falls in, counted from the goal's own opening —
// what `Meta.dc.html` calls "semanas 1–4" for a phase's own span. The one
// convention every screen that counts a goal's weeks reuses; never a second
// one (module 36's own instruction not to invent one). `lib/day/weeks.ts`'s
// own `weekIndexOf`, under the name every caller here already uses.
export const weekIndex = weekIndexOf;

// How many whole weeks a horizon holds. A horizon is always set in exact
// weeks (`NewGoalForm`'s own conversion), so this lands on a whole number,
// never a fraction rounded away.
export function horizonWeeks(openedOn: string, horizon: string): number {
  return Math.round(daysBetween(openedOn, horizon) / 7);
}

// The civil dates a span of 1-based weeks covers, counted from the goal's
// own opening — `lib/day/weeks.ts`'s own `weekSpan`, under the name every
// caller here already uses. Never `lib/zone.ts`'s `weekOf`, which counts the
// real Monday-to-Sunday week and has nothing to do with a goal's own opening
// day.
export function weeksToPhaseSpan(
  openedOn: string,
  fromWeek: number,
  toWeek: number,
): { startsOn: string; endsOn: string } {
  return weekSpan(openedOn, fromWeek, toWeek);
}
