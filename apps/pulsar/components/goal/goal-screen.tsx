import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { type Translator } from "@/i18n/translator";

import {
  ArchiveGoalAction,
  ReopenGoalButton,
} from "@/components/goal/archive-sheet";
import { EvidenceNote } from "@/components/day/evidence-note";
import { dayWords } from "@/lib/day/day-words";
import { phaseOn } from "@/lib/day/derive";
import { ShiftProposal } from "@/components/month/task-row";
import { monthList } from "@/lib/plan/carry";
import { shiftOfferNow } from "@/lib/plan/shift-offer";
import { listGoals, loadGoal } from "@/lib/queries/goal";
import { dayBefore } from "@/lib/day/weeks";
import { isTimeUnit } from "@/lib/units/time";
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
  Progress,
  Row,
  ScreenHeader,
  SectionLabel,
  Separator,
  Split,
  Text,
} from "@/components/ui";

import { CommitmentList, countWord } from "./commitment-list";
import { horizonWeeks, weekIndex } from "./phase-weeks";
import { MoveHorizonAction } from "./horizon-sheet";
import { RenameGoalAction } from "./rename-sheet";

// "22 de septiembre": the day a goal was opened or archived, in the person's
// own zone (RNP-06) and in words, never a locale this design does not
// otherwise use.
function longDateLabel(instant: string): string {
  return new Intl.DateTimeFormat("es-CO", {
    day: "numeric",
    month: "long",
    timeZone: TIME_ZONE,
  }).format(new Date(instant));
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
  const [goal, goals] = await Promise.all([loadGoal(goalId), listGoals()]);
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

  // `MetaMes*.dc.html` (RP-28, RP-29): the current month's amount, drawn only
  // with a measure and a month inside the span. A time unit prints itself in
  // hours and minutes; any other unit is already named by «mide en».
  const month = goal.month;
  const figureUnit = isTimeUnit(goal.measureUnit) ? (goal.measureUnit ?? undefined) : undefined;
  const monthName = (t.raw("day.monthLong") as string[])[Number(today.slice(5, 7)) - 1];
  const daysLeft = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate() - Number(today.slice(8, 10));
  const planned = month?.planned ?? null;
  const percent = month && planned ? Math.floor((month.reached * 100) / planned) : 0;
  // A goal with no measure has no amount to read, but its months and their
  // tasks stay reachable (`MetaSinMedida.dc.html`).
  const bareMonth = !goal.measureUnit && goal.months.some((row) => row.current);
  const own = bareMonth
    ? monthList(goal.tasks, `${today.slice(0, 7)}-01`, today).filter((item) => item.carriedFrom === null)
    : [];
  const offer =
    (month || bareMonth) && !archived && !ended
      ? shiftOfferNow({
          today,
          horizon: goal.horizon,
          budgets: goal.budgets,
          months: goal.months,
          phases: goal.phases,
          tasks: goal.tasks,
          shifts: goal.shifts,
        })
      : null;
  const monthNames = t.raw("day.monthLong") as string[];
  const closedName = offer ? monthNames[Number(offer.closedMonth.slice(5, 7)) - 1] : "";
  const shiftOffer = offer ? (
    <ShiftProposal
      goalId={goal.id}
      goalName={goal.name}
      month={offer.closedMonth.slice(0, 7)}
      plan={offer.plan}
      currentPhase={currentPhase?.name ?? null}
      hasDoneTasks={goal.tasks.some((task) => task.doneOn !== null)}
      otherGoals={goals.filter((other) => other.id !== goal.id).map((other) => other.name)}
      proposal={t("month.shift.carriedOver", {
        month: closedName.charAt(0).toUpperCase() + closedName.slice(1),
        share: Math.floor((offer.share.carried * 100) / offer.share.planned),
      })}
      see={t("month.shift.see")}
      until={t("month.shift.until", {
        date: `${Number(offer.until.slice(8, 10))} de ${monthNames[Number(offer.until.slice(5, 7)) - 1]}`,
      })}
    />
  ) : null;
  const monthsLink = (
    <Button asChild variant="ghost">
      <Link href={`/metas/${goal.id}/meses`}>{t("goal.detail.monthsLink")}</Link>
    </Button>
  );
  const bareBlock = bareMonth ? (
    <section>
      <Separator />
      <Flex justify="between" align="center">
        <SectionLabel>{monthName}</SectionLabel>
        <Button asChild variant="ghost" tone="accent" tap={44}>
          <Link href={`/metas/${goal.id}/meses`}>{t("goal.detail.monthsLink")}</Link>
        </Button>
      </Flex>
      <Text as="p">
        {t("month.months.withoutMeasure.goalTasks", {
          count: own.length,
          done: own.filter((item) => item.done).length,
        })}
      </Text>
      {shiftOffer}
    </section>
  ) : null;
  // Under 60 % from the 20th the pace line holds reached «de» planned itself.
  const paceLine = planned !== null && planned > 0 && Boolean(month?.underPace) && goal.evidence !== "unreadable";
  const monthBlock =
    goal.measureUnit && month ? (
      <section>
        <SectionLabel>{monthName}</SectionLabel>
        {paceLine ? (
          <Text as="p" variant="meta">
            {t("goal.detail.monthPace", { day: Number(today.slice(8, 10)) })}{" "}
            <Figure value={month.reached} unit={figureUnit} variant="meta" />{" "}
            {t("day.monthLine.of")} <Figure value={planned as number} unit={figureUnit} variant="meta" />
            {t("goal.detail.monthPaceUnder", { threshold: 60 })}
          </Text>
        ) : (
          <Flex align="baseline" gap="2" wrap="wrap">
            <Figure value={month.reached} unit={figureUnit} variant="measure" />
            {planned !== null ? (
              <Text variant="meta" tone="muted">
                {t("day.monthLine.of")} <Figure value={planned} unit={figureUnit} variant="meta" />
              </Text>
            ) : (
              <Text variant="meta" tone="muted">
                {t("goal.detail.monthNoPlan")}
              </Text>
            )}
          </Flex>
        )}
        {planned !== null && planned > 0 ? (
          <>
            <Progress percent={percent} />
            {goal.evidence === "unreadable" ? (
              <Text as="p" variant="meta" tone="muted">
                {t("goal.detail.monthDeclaredOnly")}
              </Text>
            ) : paceLine ? null : (
              <Text as="p" variant="meta" tone="muted">
                {t("goal.detail.monthProgress", { percent, days: daysLeft })}
              </Text>
            )}
          </>
        ) : null}
        {shiftOffer}
        {planned === null && !archived && !ended ? (
          <Button asChild variant="outline">
            <Link href={`/metas/${goal.id}/meses?planear=${today.slice(0, 7)}`}>
              {t("goal.detail.monthPlanLink", { month: monthName })}
            </Link>
          </Button>
        ) : null}
      </section>
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
        {goal.measureUnit ? null : (
          <Text as="p" variant="meta" tone="muted">
            {t("month.list.noMeasure")}
          </Text>
        )}
        {ended ? <Face on="desktop">{moveAction}</Face> : null}
      </Panel>

      {goal.measureUnit ? (
        <Panel>
          <Text as="p" variant="meta" tone="muted">
            {t("goal.detail.measures", { unit: goal.measureUnit })}
          </Text>
          {phoneActs}

          {goal.measureUnit ? (
            <Figure
              value={goal.measureTotal}
              unit={goal.measureUnit}
              variant="measure"
            />
          ) : null}

          {monthBlock}

          <Flex gap="5" wrap="wrap">
            {month ? monthsLink : null}
            <Button asChild variant="ghost">
              <Link href={`/metas/${goal.id}/revision`}>
                {t("goal.detail.reviewLink")}
              </Link>
            </Button>
          </Flex>

          {goal.measureUnit && goal.evidence === "unreadable" ? (
            <EvidenceNote text={t("goal.detail.unreadableEvidence")} />
          ) : null}
        </Panel>
      ) : (
        <>
          {phoneActs}
          {bareBlock}
        </>
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
    <Page width="full">
      <ScreenHeader
        title={goal.name}
        back={{ href: "/metas", place: t("common.nav.goals") }}
        meta={
          goal.archivedAt
            ? t("goal.detail.archivedOverline", { date: longDateLabel(goal.archivedAt) })
            : t("goal.detail.overline", { date: longDateLabel(goal.createdAt) })
        }
        actions={
          archived ? null : (
            <Face on="desktop">
              <Flex gap="2">
                <RenameGoalAction goalId={goal.id} name={goal.name} variant="outline" />
                <ArchiveGoalAction goalId={goal.id} name={goal.name} block={false} short />
              </Flex>
            </Face>
          )
        }
      />
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
