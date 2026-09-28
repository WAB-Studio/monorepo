import { measureOf, phaseOn } from "@/lib/day/derive";
import type { DeclaredFact, EvidenceDay, Phase, ReviewWeek } from "@/lib/day/types";
import { addWeeksToCivilDate, civilDateToDate, dateToCivilDate } from "@/lib/zone";

// Whole civil days between two `YYYY-MM-DD` strings, at midday UTC so no
// zone offset can shift the count by one — `components/goal/phase-weeks.ts`'s
// own `daysBetween`, copied rather than imported: `lib/day` never reaches
// into `components/`.
function daysBetween(from: string, to: string): number {
  const ms = civilDateToDate(to).getTime() - civilDateToDate(from).getTime();
  return Math.round(ms / 86_400_000);
}

// The 1-based week `day` falls in, counted from the goal's own opening — the
// one convention every screen that counts a goal's weeks uses
// (`components/goal/phase-weeks.ts`'s own `weekIndex`). Week 1 starts the day
// the goal was created, never on a Monday (decided by the user 2026-09-28).
function weekIndexOf(openedOn: string, day: string): number {
  return Math.floor(daysBetween(openedOn, day) / 7) + 1;
}

function dayBefore(day: string): string {
  const date = civilDateToDate(day);
  date.setUTCDate(date.getUTCDate() - 1);
  return dateToCivilDate(date);
}

// The inverse of `weekIndexOf`: the civil dates a 1-based week span covers.
// Week `N` opens `(N - 1) * 7` days after `openedOn` and closes the day
// before week `N + 1` opens — `components/goal/phase-weeks.ts`'s own
// `weeksToPhaseSpan`, narrowed to one week.
function weekSpan(openedOn: string, index: number): { startsOn: string; endsOn: string } {
  return {
    startsOn: addWeeksToCivilDate(openedOn, index - 1),
    endsOn: dayBefore(addWeeksToCivilDate(openedOn, index)),
  };
}

// `measureOf`'s own rule (RP-14), run twice: once over the declared facts of
// the span, once over the evidence days of the span, by `unit`. `unit: null`
// means the goal has no measure yet, so the week's own total is `0` rather
// than matching a fact or an evidence day that carries no unit of its own.
function totalInSpan(
  unit: string | null,
  facts: DeclaredFact[],
  evidence: EvidenceDay[],
  startsOn: string,
  endsOn: string,
): number {
  if (unit === null) return 0;

  const declared = measureOf(
    unit,
    facts.filter((fact) => fact.day >= startsOn && fact.day <= endsOn),
  );
  const read = evidence.reduce(
    (total, day) =>
      day.unit === unit && day.day >= startsOn && day.day <= endsOn ? total + day.quantity : total,
    0,
  );
  return declared + read;
}

/**
 * What a goal's measure was in each of its own weeks, from week 1 to the
 * week holding `today` — capped at the week holding `horizon`, so a review
 * asked for past the goal's own end never invents weeks it never ran (RP-17).
 * A week with nothing still reads `total: 0`: RP-16's rule that a gap is
 * drawn, never hidden, carried here from the day to the review.
 */
export function measureByWeek(args: {
  openedOn: string;
  horizon: string;
  today: string;
  unit: string | null;
  facts: DeclaredFact[];
  evidence: EvidenceDay[];
  phases: Phase[];
}): ReviewWeek[] {
  const { openedOn, horizon, today, unit, facts, evidence, phases } = args;

  const todayWeek = weekIndexOf(openedOn, today);
  const horizonWeek = weekIndexOf(openedOn, horizon);
  const lastIndex = Math.min(todayWeek, horizonWeek);

  const rows: ReviewWeek[] = [];
  for (let index = 1; index <= lastIndex; index++) {
    const { startsOn, endsOn } = weekSpan(openedOn, index);
    rows.push({
      index,
      startsOn,
      endsOn,
      total: totalInSpan(unit, facts, evidence, startsOn, endsOn),
      phaseName: phaseOn(phases, startsOn)?.name ?? null,
      current: index === todayWeek,
    });
  }
  return rows;
}
