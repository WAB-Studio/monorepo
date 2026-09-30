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

/**
 * A flexible commitment already met in its period, drawn quiet: «cumplida
 * esta semana · 1 de 1». Past its quota the count is said as times, since
 * «2 de 1» reads as a mistake. Null for a cadence counted by the day, or one
 * not yet met.
 */
export function metPhrase(
  translate: Translate,
  commitment: { cadence: Cadence; periodDone: number | undefined },
): string | null {
  const { cadence, periodDone } = commitment;
  if (periodDone === undefined) return null;
  let period: "week" | "month";
  if (cadence.kind === "times_per_week") period = "week";
  else if (cadence.kind === "times_per_month") period = "month";
  else return null;
  if (periodDone < cadence.count) return null;
  return translate(periodDone > cadence.count ? `day.met.${period}Over` : `day.met.${period}`, {
    done: periodDone,
    total: cadence.count,
  });
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

export type RowMetaPieces = {
  kind: "tap" | "quantity" | "evidence";
  done: boolean;
  quiet: boolean;
  // Already null where the status says the cadence: «2 de 3 esta semana»,
  // never «3 veces por semana · 2 de 3 esta semana».
  cadenceText: string | null;
  amount: string | undefined;
  // The met phrase of a quiet row, or the progress of a flexible one.
  status: string | null;
  writtenTime: string | undefined;
  writtenLabel: string | undefined;
};

/**
 * A row's second line, pieces joined with « · ». «lo dijiste tú» marks a
 * done `tap` or `quantity` row after its hour; «pide el número» marks a
 * `quantity` row not yet done, after its target. Evidence and quiet rows say
 * neither (`HoyEscritorio.dc.html`).
 */
export function rowMeta(translate: Translate, pieces: RowMetaPieces): string | undefined {
  const { kind, done, quiet, status } = pieces;
  const loud = !quiet && kind !== "evidence";
  const said = loud && done ? translate("day.row.saidByYou") : null;
  const asks = loud && !done && kind === "quantity" ? translate("day.row.asksNumber") : null;
  return (
    [
      pieces.cadenceText,
      pieces.amount,
      asks,
      status,
      pieces.writtenTime,
      said,
      pieces.writtenLabel,
    ]
      .filter(Boolean)
      .join(" · ") || undefined
  );
}
