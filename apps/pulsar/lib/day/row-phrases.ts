import type { Cadence } from "@/lib/day/types";

type Translate = (key: string, values?: Record<string, string | number>) => string;

export type CadenceNames = {
  // Monday first, one letter each: a weekdays cadence of several days.
  weekdayShort: string[];
  // Monday first, «martes», «sábados»: read after «solo los».
  weekdayPlural: string[];
};

// The cadence as a row's second line says it, or null where the row says
// nothing: a daily commitment is the default and stays quiet
// (`HoyEscritorio.dc.html`).
export function cadencePhrase(translate: Translate, cadence: Cadence, names: CadenceNames): string | null {
  switch (cadence.kind) {
    case "daily":
      return null;
    case "weekdays":
      return cadence.days.length === 1
        ? translate("day.cadence.onlyWeekday", { weekday: names.weekdayPlural[cadence.days[0] - 1] })
        : cadence.days.map((day) => names.weekdayShort[day - 1]).join(", ");
    case "times_per_week":
      return translate("day.cadence.timesPerWeek", { count: cadence.count });
    case "every_n_days":
      return cadence.n === 1 ? null : translate("day.cadence.everyNDays", { n: cadence.n });
    case "times_per_month":
      return translate("day.cadence.timesPerMonth", { count: cadence.count });
  }
}

// A goal's phase line: «fase 2 de 3 · desbloquear la boca»; a goal with one
// phase says its name alone.
export function phaseLine(
  translate: Translate,
  name: string,
  position: { ordinal: number; total: number },
): string {
  return position.total > 1 ? translate("day.phase.of", { ...position, name }) : name;
}

// Each phase's place among its goal's phases, by `startsOn`.
export function phasePositions(
  phases: { id: string; goalId: string; startsOn: string }[],
): Record<string, { ordinal: number; total: number }> {
  const byGoal = new Map<string, typeof phases>();
  for (const phase of phases) byGoal.set(phase.goalId, [...(byGoal.get(phase.goalId) ?? []), phase]);

  const positions: Record<string, { ordinal: number; total: number }> = {};
  for (const own of byGoal.values()) {
    const ordered = [...own].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
    ordered.forEach((phase, index) => {
      positions[phase.id] = { ordinal: index + 1, total: ordered.length };
    });
  }
  return positions;
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
