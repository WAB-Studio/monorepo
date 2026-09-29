import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import {
  ArchiveGoalAction,
  ReopenGoalButton,
} from "@/components/goal/archive-sheet";
import { EvidenceNote } from "@/components/day/evidence-note";
import { dayWords } from "@/lib/day/day-words";
import { phaseOn } from "@/lib/day/derive";
import { loadGoal } from "@/lib/queries/goal";
import { dayBefore } from "@/lib/day/weeks";
import {
  civilDateInZone,
  civilDateLabel,
  todayInZone,
  TIME_ZONE,
} from "@/lib/zone";
import {
  Button,
  Face,
  Figure,
  Flex,
  Mark,
  Page,
  Panel,
  Row,
  SectionLabel,
  Split,
  Text,
} from "@/components/ui";

import { CommitmentList, countWord, type Translator } from "./commitment-list";
import { horizonWeeks, weekIndex } from "./phase-weeks";
import { MoveHorizonAction } from "./horizon-sheet";
import { RenameGoalAction } from "./rename-sheet";

// "22 de septiembre": the day the goal was opened, in the person's own zone
// (RNP-06) and in words, never a locale this design does not otherwise use.
function openedOnLabel(createdAt: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "long",
    timeZone: TIME_ZONE,
  }).format(new Date(createdAt));
}

// «lunes 28 de septiembre»: the month always, so the week of today is not
// asked for by `dayWords`; a day of 1970 is never in it.
function endedOnWords(endedOn: string, t: Translator): string {
  const words = dayWords(endedOn, "1970-01-01");
  const weekdays = t.raw("day.weekdayLong") as string[];
  const months = t.raw("day.monthLong") as string[];
  return t("goal.detail.endedOn", {
    weekday: weekdays[words.weekday],
    day: words.day,
    month: months[words.month ?? 0],
  });
}

function phaseSpanLabel(
  openedOn: string,
  startsOn: string,
  endsOn: string | null,
  t: Translator,
) {
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
  const goal = await loadGoal(goalId);
  if (!goal) notFound();

  const t = await getTranslations();
  const today = todayInZone();
  const openedOn = civilDateInZone(new Date(goal.createdAt));
  const totalWeeks = horizonWeeks(openedOn, goal.horizon);
  const currentPhase = phaseOn(goal.phases, today);

  const archived = goal.archivedAt !== null;
  const ended = goal.endedOn !== null && !archived;
  // An ended goal's sheet opens on the count that ends this Sunday.
  const sheetWeeks = ended
    ? Math.max(totalWeeks, weekIndex(openedOn, today))
    : totalWeeks;
  const moveAction = (
    <MoveHorizonAction
      goalId={goal.id}
      name={goal.name}
      openedOn={openedOn}
      weeks={sheetWeeks}
      phases={goal.phases}
      solid={ended}
    />
  );

  const phoneActs = ended ? (
    <Face on="phone">
      <Flex gap="3">
        <Flex flexGrow="1" flexBasis="0" minWidth="0">
          {moveAction}
        </Flex>
        <Flex flexGrow="1" flexBasis="0" minWidth="0">
          <ArchiveGoalAction goalId={goal.id} name={goal.name} short />
        </Flex>
      </Flex>
    </Face>
  ) : null;

  const before = (
    <>
      <Panel>
        <Face on="desktop">
          <SectionLabel>{t("goal.detail.endHeading")}</SectionLabel>
        </Face>
        {ended && goal.endedOn ? (
          <Text as="p" variant="meta">
            {endedOnWords(goal.endedOn, t)}
          </Text>
        ) : (
          <Flex justify="between" align="center">
            <Text as="p" variant="meta" tone="muted">
              {t("goal.detail.horizonUntil", {
                weeks: totalWeeks,
                date: civilDateLabel(dayBefore(goal.horizon)),
              })}
            </Text>
            {archived ? null : moveAction}
          </Flex>
        )}
        {ended ? <Face on="desktop">{moveAction}</Face> : null}
      </Panel>

      {goal.measureUnit ? (
        <Panel>
          <Text as="p" variant="meta" tone="muted">
            {t("goal.detail.measures", { measure: goal.measureName ?? "" })}
          </Text>
          {phoneActs}

          {goal.measureUnit ? (
            <Figure
              value={goal.measureTotal}
              unit={goal.measureUnit}
              variant="measure"
            />
          ) : null}

          {goal.measureUnit ? (
            <Button asChild variant="ghost">
              <Link href={`/metas/${goal.id}/revision`}>
                {t("goal.detail.reviewLink")}
              </Link>
            </Button>
          ) : null}

          {goal.measureUnit && goal.evidence === "unreadable" ? (
            <EvidenceNote text={t("goal.detail.unreadableEvidence")} />
          ) : null}
        </Panel>
      ) : (
        phoneActs
      )}
    </>
  );

  const main = (
    <Panel as="div">
      <CommitmentList
        goalId={goal.id}
        commitments={goal.commitments}
        archived={archived || ended}
      />
    </Panel>
  );

  const after = (
    <Panel>
      <section>
        <Flex justify="between" align="center" mb={{ initial: "0", lg: "1" }}>
          <SectionLabel>
            {t("goal.detail.phasesCount", {
              word: countWord(goal.phases.length, t, true),
              count: goal.phases.length,
            })}
          </SectionLabel>
          {archived || ended ? null : (
            <Face on="desktop">
              <Button asChild variant="ghost" tone="accent" tap={44}>
                <Link href={`/metas/${goal.id}/fases/nueva`}>
                  {t("goal.phases.add")}
                </Link>
              </Button>
            </Face>
          )}
        </Flex>
        {goal.phases.map((phase) => (
          <Row
            key={phase.id}
            leading={
              <Mark
                state={currentPhase?.id === phase.id ? "declared" : "empty"}
                size="dot"
              />
            }
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
        {archived || ended ? null : (
          <Face on="phone">
            <Button
              asChild
              variant={goal.phases.length > 0 ? "outline" : "solid"}
              block
            >
              <Link href={`/metas/${goal.id}/fases/nueva`}>
                {t("goal.phases.add")}
              </Link>
            </Button>
          </Face>
        )}
      </section>
    </Panel>
  );

  return (
    <Page>
      <Text as="p" variant="meta" tone="muted">
        {t("goal.detail.overline", { date: openedOnLabel(goal.createdAt) })}
      </Text>
      <Panel as="div" row>
        <Text as="p" variant="title">
          {goal.name}
        </Text>
        <Face on="desktop">
          <Flex gap="2">
            {archived ? null : (
              <RenameGoalAction
                goalId={goal.id}
                name={goal.name}
                variant="outline"
              />
            )}
            {archived ? null : (
              <ArchiveGoalAction
                goalId={goal.id}
                name={goal.name}
                block={false}
                short
              />
            )}
          </Flex>
        </Face>
      </Panel>
      {archived ? null : (
        <Face on="phone">
          <RenameGoalAction goalId={goal.id} name={goal.name} />
        </Face>
      )}

      <Split before={before} main={main} after={after} aside={380} />

      {archived ? (
        <ReopenGoalButton goalId={goal.id} />
      ) : ended ? null : (
        <Face on="phone">
          <ArchiveGoalAction goalId={goal.id} name={goal.name} />
        </Face>
      )}
    </Page>
  );
}
