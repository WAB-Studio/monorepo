import { daysBetween, horizonWeeksOf, weekIndexOf, weekSpan } from "@/lib/day/weeks";

export { daysBetween };

// The 1-based Monday-to-Sunday goal week `day` falls in —
// what `Meta.dc.html` calls "semanas 1–4" for a phase's own span. The one
// convention every screen that counts a goal's weeks reuses; never a second
// one (module 36's own instruction not to invent one). `lib/day/weeks.ts`'s
// own `weekIndexOf`, under the name every caller here already uses.
export const weekIndex = weekIndexOf;

// How many goal weeks a horizon holds — `lib/day/weeks.ts`'s `horizonWeeksOf`.
export function horizonWeeks(openedOn: string, horizon: string): number {
  return horizonWeeksOf(openedOn, horizon);
}

// The civil dates a span of 1-based weeks covers, counted from the goal's
// own opening — `lib/day/weeks.ts`'s own `weekSpan`, under the name every
// caller here already uses. Week 1 is the partial week from the opening day
// to its first Sunday.
export function weeksToPhaseSpan(
  openedOn: string,
  fromWeek: number,
  toWeek: number,
): { startsOn: string; endsOn: string } {
  return weekSpan(openedOn, fromWeek, toWeek);
}
