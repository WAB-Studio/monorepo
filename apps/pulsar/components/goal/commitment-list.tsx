import Link from "next/link";
import { getTranslations } from "next-intl/server";

import type { Cadence } from "@/lib/day/types";
import type { GoalCommitment } from "@/lib/queries/goal";
import { Button, Flex, SectionLabel, Text } from "@/components/ui";

import { CommitmentRow } from "./retire-sheet";

export type Translator = Awaited<ReturnType<typeof getTranslations>>;

// The count in words, section-label style ("ocho compromisos", "tres
// fases"): `goal.countWords` covers what a real plan holds; past its length
// the plain numeral still reads correctly, never a placeholder. Exported: the
// goal screen's own phases section needs the identical wording.
export function countWord(n: number, t: Translator): string {
  const words = t.raw("goal.countWords") as string[];
  return words[n] ?? String(n);
}

// `Meta.dc.html`'s own cadence phrasing — full words, unlike `day.cadence`'s
// abbreviated one, which a day row's tighter space asks for instead.
function cadenceWords(cadence: Cadence, t: Translator): string {
  switch (cadence.kind) {
    case "daily":
      return t("goal.cadence.daily");
    case "weekdays": {
      const names = t.raw("goal.cadence.weekdayFull") as string[];
      return cadence.days.map((day) => names[day - 1]).join(", ");
    }
    case "times_per_week":
      return t("goal.cadence.timesPerWeek", { count: cadence.count });
    case "every_n_days":
      // "Every 1 day" reads exactly as daily, the same call `day-row.tsx`
      // already makes for the day's own label.
      return cadence.n === 1
        ? t("goal.cadence.daily")
        : t("goal.cadence.everyNDays", { n: cadence.n });
    case "times_per_month":
      return t("goal.cadence.timesPerMonth", { count: cadence.count });
  }
}

// An evidence source's own unit, read back as a Spanish noun (RP-09):
// `reading_lookups`' `unit` column holds "searches", never a sentence, and
// `goal.units` is this screen's own small catalogue of what each known unit
// is called — a second source names one more case here (RNP-10), never
// leaves the word to a guess at the raw column.
function evidenceUnitWords(unit: string, count: number, t: Translator): string {
  switch (unit) {
    case "searches":
      return t("goal.units.searches", { count });
    default:
      return unit;
  }
}

// What satisfies the commitment, in quiet: a tap, the quantity's own unit —
// the person's own word, never resolved against a catalogue — or the
// evidence threshold and source ("1 búsqueda · diccionario").
function satisfactionWords(commitment: GoalCommitment, t: Translator): string {
  switch (commitment.satisfiedBy.kind) {
    case "tap":
      return t("goal.satisfaction.tap");
    case "quantity":
      return commitment.satisfiedBy.unit;
    case "evidence": {
      const { threshold, unit } = commitment.satisfiedBy;
      const source = commitment.sourceLabelKey ? t(commitment.sourceLabelKey) : "";
      return `${threshold} ${evidenceUnitWords(unit, threshold, t)} · ${source}`;
    }
  }
}

/**
 * `Meta.dc.html`'s commitment rows (RP-12, RP-13, RP-14): the name on the
 * left, the cadence over the satisfaction right-aligned in mono. A retired
 * commitment stays in the list — never hidden — marked in its own second
 * line rather than by hue, since this design has none for it. Below the
 * rows, the goal's own way into `CompromisoNuevo.dc.html` (docs/pulsar/
 * DESIGN.md "A goal adds a commitment from its own screen"): solid while the
 * list is empty, because then it is the only thing the screen asks for;
 * outlined once a first commitment already carries the goal.
 */
export async function CommitmentList({
  goalId,
  commitments,
}: {
  goalId: string;
  commitments: GoalCommitment[];
}) {
  const t = await getTranslations();
  // A retired commitment stays in the list — never hidden (RP-13) — but it
  // no longer asks anything of the goal, so the count above it names only
  // what is still active, not the whole history the list itself keeps.
  const activeCount = commitments.filter((commitment) => commitment.retiredAt === null).length;

  return (
    <section>
      <SectionLabel>
        {t("goal.detail.commitmentsCount", {
          word: countWord(activeCount, t),
          count: activeCount,
        })}
      </SectionLabel>
      {commitments.map((commitment) => (
        <CommitmentRow
          key={commitment.id}
          commitmentId={commitment.id}
          name={commitment.name}
          retired={commitment.retiredAt !== null}
          retiredLabel={t("goal.commitments.retired")}
          factDayCount={commitment.factDayCount}
          trailing={
            <Flex direction="column" align="end" gap="1">
              <Text as="span" variant="meta" tone="muted">
                {cadenceWords(commitment.cadence, t)}
              </Text>
              <Text as="span" variant="meta" tone="muted">
                {satisfactionWords(commitment, t)}
              </Text>
            </Flex>
          }
        />
      ))}
      <Button asChild variant={commitments.length > 0 ? "outline" : "solid"} block>
        <Link href={`/metas/${goalId}/compromisos/nuevo`}>{t("goal.commitments.add")}</Link>
      </Button>
    </section>
  );
}
