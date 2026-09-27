import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { EvidenceNote } from "@/components/day/evidence-note";
import { phaseOn } from "@/lib/day/derive";
import { loadGoal } from "@/lib/queries/goal";
import { civilDateInZone, civilDateToDate, todayInZone, TIME_ZONE } from "@/lib/zone";
import { Figure, Flex, Mark, Page, Row, SectionLabel, Text } from "@/components/ui";

import { CommitmentList, countWord, type Translator } from "./commitment-list";

// Whole civil days between two `YYYY-MM-DD` strings, the same midday-UTC
// technique `lib/day/cadence.ts`'s own `daysBetween` uses.
function daysBetween(from: string, to: string): number {
  const ms = civilDateToDate(to).getTime() - civilDateToDate(from).getTime();
  return Math.round(ms / 86_400_000);
}

// The 1-based week `day` falls in, counted from the goal's own opening —
// what `Meta.dc.html` calls "semanas 1–4" for a phase's own span.
function weekIndex(openedOn: string, day: string): number {
  return Math.floor(daysBetween(openedOn, day) / 7) + 1;
}

// "22 de septiembre": the day the goal was opened, in the person's own zone
// (RNP-06) and in words, never a locale this design does not otherwise use.
function openedOnLabel(createdAt: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "long",
    timeZone: TIME_ZONE,
  }).format(new Date(createdAt));
}

function phaseSpanLabel(openedOn: string, startsOn: string, endsOn: string | null, t: Translator) {
  const start = weekIndex(openedOn, startsOn);
  const end = endsOn ? weekIndex(openedOn, endsOn) : start;
  return t("goal.detail.phaseSpan", { start, end });
}

/**
 * `Meta.dc.html` (RP-11, RP-14, RP-15): a goal's commitments, their cadence
 * and what satisfies them, and its phases — a retired commitment stays in
 * the list, a phase not in effect today draws outlined rather than filled.
 * The measure is a figure, drawn only once the goal has one (§0.3, 3): a
 * goal whose first quantity commitment has not landed yet has nothing to
 * show and nothing to sum.
 */
export async function GoalScreen({ goalId }: { goalId: string }) {
  const goal = await loadGoal(goalId).catch(() => null);
  if (!goal) notFound();

  const t = await getTranslations();
  const today = todayInZone();
  const openedOn = civilDateInZone(new Date(goal.createdAt));
  const totalWeeks = Math.round(daysBetween(openedOn, goal.horizon) / 7);
  const currentPhase = phaseOn(goal.phases, today);

  return (
    <Page>
      <Text as="p" variant="meta" tone="muted">
        {t("goal.detail.overline", { date: openedOnLabel(goal.createdAt) })}
      </Text>
      <Text as="p" variant="title">
        {goal.name}
      </Text>
      <Text as="p" variant="meta" tone="muted">
        {goal.measureUnit
          ? t("goal.detail.horizonAndMeasure", { weeks: totalWeeks, measure: goal.measureName ?? "" })
          : t("goal.detail.horizonOnly", { weeks: totalWeeks })}
      </Text>

      {goal.measureUnit ? (
        <Figure value={goal.measureTotal} unit={goal.measureUnit} variant="measure" />
      ) : null}

      {goal.measureUnit && goal.evidence === "unreadable" ? (
        <EvidenceNote text={t("goal.detail.unreadableEvidence")} />
      ) : null}

      <CommitmentList commitments={goal.commitments} />

      <section>
        <SectionLabel>
          {t("goal.detail.phasesCount", {
            word: countWord(goal.phases.length, t),
            count: goal.phases.length,
          })}
        </SectionLabel>
        {goal.phases.map((phase) => (
          <Row
            key={phase.id}
            leading={<Mark state={currentPhase?.id === phase.id ? "declared" : "empty"} size="dot" />}
            name={phase.name}
            trailing={
              <Flex direction="column" align="end">
                <Text as="span" variant="meta" tone="muted">
                  {phaseSpanLabel(openedOn, phase.startsOn, phase.endsOn, t)}
                </Text>
              </Flex>
            }
            disabled
          />
        ))}
      </section>
    </Page>
  );
}
