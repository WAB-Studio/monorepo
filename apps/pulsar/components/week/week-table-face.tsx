import type { ReactNode } from "react";

import { type MessageKey, type Translator } from "@/i18n/translator";
import { Face, Figure, Flex, Mark, Panel, Section, SectionLabel, Text, WeekFold, WeekTable } from "@/components/ui";
import type { WeekTableCell, WeekTableColumn } from "@/components/ui/week-table";
import { tallyDays } from "@/lib/day/tally";
import type { DaySlot } from "@/lib/day/types";
import type { GoalSummary, loadWeek } from "@/lib/queries/week";
import { civilDateInZone, civilDateToDate, civilDayMonthShort } from "@/lib/zone";

import { goalWeekProgress } from "./week-progress";
import { flexibleWords, type FlexibleKey } from "@/lib/day/row-phrases";

type Week = Awaited<ReturnType<typeof loadWeek>>;

const PAST_KEY: Partial<Record<FlexibleKey, MessageKey>> = {
  "week.flexible.weekProgress": "week.flexible.weekProgressPast",
  "week.flexible.monthProgress": "week.flexible.monthProgressPast",
};

/**
 * `SemanaEscritorio.dc.html` from 1024, `SemanaPlegada.dc.html` below it: the
 * week as commitments down and days across, one set of groups drawn twice.
 * A day on or after a goal's horizon asks nothing of it, and neither does a
 * day before its commitment was written; each such day reads «no pedía».
 * `past` is a week already over: its counts say «esa semana».
 */
export function WeekTableFace({
  week,
  today,
  past,
  columns,
  t,
  endedNote,
}: {
  week: Week;
  today: string;
  past: boolean;
  columns: readonly WeekTableColumn[];
  t: Translator;
  endedNote: (goal: GoalSummary) => ReactNode;
}) {
  const { view, goals, commitments, oneOffFacts } = week;
  const weekdayLong = t.raw("week.weekdayLong") as string[];
  const horizonOf = new Map(goals.map((goal) => [goal.id, goal.horizon]));
  const live = (goalId: string | null, day: string) =>
    goalId === null || day < (horizonOf.get(goalId) ?? "");

  function mark(
    name: string,
    day: string,
    status: "done" | "missed" | "upcoming" | "none" | "evidence" | "partial",
  ): WeekTableCell {
    return {
      state:
        status === "none"
          ? "none"
          : status === "evidence"
            ? "evidence"
            : status === "partial"
              ? "partial"
              : status === "done"
                ? "declared"
                : "empty",
      label: t("week.mark.label", {
        name,
        weekday: weekdayLong[(civilDateToDate(day).getUTCDay() + 6) % 7],
        day: Number(day.slice(8, 10)),
        status: t(`week.mark.${status}`),
      }),
    };
  }

  function slotStatus(slot: DaySlot, day: string) {
    if (day > today) return "upcoming";
    if (slot.satisfiedBy === "evidence") return "evidence";
    if (slot.partial) return "partial";
    return slot.satisfied ? "done" : "missed";
  }

  // The week's own counts say «esa semana» once it is over.
  const say = (key: FlexibleKey, values?: Record<string, number | string>) =>
    t(past ? (PAST_KEY[key] ?? key) : key, values);

  const commitmentRows = (goalId: string) =>
    commitments
      .filter((commitment) => commitment.goalId === goalId)
      .map((commitment) => {
        const words = flexibleWords(commitment, say);
        return {
          key: commitment.id,
          name: commitment.name,
          detail: words ? t("week.flexible.detail", words) : undefined,
          cells: view.days.map((dayView) => {
            const slot = dayView.slots.find((s) => s.commitmentId === commitment.id);
            // A flexible row marks the days it was done or logged in part and
            // leaves the rest quiet: no day of it was ever asked on its own.
            if (!live(goalId, dayView.day) || !slot || (words && !slot.satisfied && !slot.partial)) {
              return mark(commitment.name, dayView.day, "none");
            }
            return mark(commitment.name, dayView.day, slotStatus(slot, dayView.day));
          }),
        };
      });

  const oneOffRows = (goalId: string | null) =>
    oneOffFacts
      .filter((fact) => fact.goalId === goalId)
      .map((fact) => ({
        key: fact.oneOffId,
        name: fact.name,
        cells: view.days.map((dayView) =>
          mark(fact.name, dayView.day, dayView.day === fact.day && live(goalId, dayView.day) ? "done" : "none"),
        ),
      }));

  // A goal with nothing to mark still heads its group on the phone.
  const goalGroups = goals.map((goal) => {
    const progress = goalWeekProgress(goal, view.start);
    const label = progress
      ? t("week.sectionLabel", { name: goal.name, week: progress.week, total: progress.total })
      : goal.name;
    return {
      key: goal.id,
      // An archive since keeps the weeks the goal governed (RP-24).
      label: goal.archivedAt
        ? t("week.archivedOn", { label, date: civilDayMonthShort(civilDateInZone(new Date(goal.archivedAt))) })
        : label,
      note: past ? null : endedNote(goal),
      rows: [...commitmentRows(goal.id), ...oneOffRows(goal.id)],
    };
  });
  const looseRows = oneOffRows(null);
  const foldGroups = [
    ...goalGroups,
    ...(looseRows.length > 0 ? [{ key: "one-offs", label: t("week.oneOffs.title"), rows: looseRows }] : []),
  ];
  const tableGroups = foldGroups.filter((group) => group.rows.length > 0);

  if (foldGroups.length === 0) return null;

  const cells = tallyDays(week).map(({ day, done, total }) =>
    day > today || total === 0 ? null : { figure: String(done), rest: t("week.ratioOf", { total }) },
  );
  const footer = { label: t("week.table.footer"), cells };

  // `SemanaEnParte.dc.html`: the phone names the partial days apart from
  // «hechos», over the days that have come, and draws its legend. Without a
  // partial day the per-day tally says it all.
  const lived = tallyDays(week).filter(({ day, total }) => day <= today && total > 0);
  const sum = (pick: (tally: (typeof lived)[number]) => number) => lived.reduce((acc, tally) => acc + pick(tally), 0);
  const partial = sum((tally) => tally.partial);
  // The key shows whenever any half dot is drawn, flexible rows included.
  const halfDrawn = foldGroups.some((group) =>
    group.rows.some((row) => row.cells.some((cell) => cell.state === "partial")),
  );

  return (
    <>
      {tableGroups.length > 0 ? (
        <Face on="desktop">
          <Panel as="div">
            <WeekTable caption={t("week.table.caption")} columns={columns} groups={tableGroups} footer={footer} />
          </Panel>
        </Face>
      ) : null}
      <Face on="phone">
        <Section as="div">
          <WeekFold columns={columns} groups={foldGroups} footer={footer} />
          {halfDrawn ? (
            <>
              {partial > 0 ? (
                <Flex align="baseline" gap="2">
                  <SectionLabel>{t("week.table.footer")}</SectionLabel>
                  <Figure variant="meta" value={sum((tally) => tally.done)} />
                  <Text variant="sentence">
                    {t.rich("week.summary.rest", {
                      total: sum((tally) => tally.total),
                      partial,
                      fig: (chunks) => <Figure variant="meta" value={chunks} />,
                    })}
                  </Text>
                </Flex>
              ) : null}
              <Flex wrap="wrap" gap="3" data-testid="week-legend">
                {(
                  [
                    ["declared", "week.legend.done"],
                    ["evidence", "week.legend.evidence"],
                    ["partial", "week.legend.partial"],
                    ["empty", "week.legend.pending"],
                  ] as const
                ).map(([state, key]) => (
                  <Flex key={state} align="center" gap="2">
                    <Mark state={state} size="dot" />
                    <Text variant="sentence">{t(key)}</Text>
                  </Flex>
                ))}
              </Flex>
            </>
          ) : null}
        </Section>
      </Face>
    </>
  );
}
