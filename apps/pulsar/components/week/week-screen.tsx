import { Fragment } from "react";
import { getTranslations } from "next-intl/server";

import { Face, Page, Row, SectionLabel, Text, type MarkState } from "@/components/ui";
import type { DaySlot } from "@/lib/day/types";
import { loadWeek, type CommitmentGoal, type GoalSummary, type OneOffFact } from "@/lib/queries/week";
import { weekDayHref } from "@/lib/day/week-href";
import { civilDateToDate, todayInZone } from "@/lib/zone";

import { EmptyWeek } from "./empty-week";
import { WeekDayRow, type WeekDot } from "./week-day-row";
import { flexibleWords, goalWeekProgress } from "./week-progress";
import { WeekTableFace } from "./week-table-face";

type Translate = Awaited<ReturnType<typeof getTranslations>>;

// The day number alone when both ends of the range share a month
// (`Semana.dc.html`'s own "Del 21 al 27"), the month's own short name added
// only where a week actually crosses one — nothing on the board draws that
// case, so this is what it takes to say a Monday-to-Sunday range does not
// silently misname a day when it does.
function formatRangeEnd(day: string, monthNames: string[], withMonth: boolean): string {
  const [, month, dayOfMonth] = day.split("-");
  const dayNumber = String(Number(dayOfMonth));
  return withMonth ? `${dayNumber} de ${monthNames[Number(month) - 1]}` : dayNumber;
}

function formatWeekRange(start: string, end: string, t: Translate): string {
  const monthNames = t.raw("week.monthShort") as string[];
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return t("week.range", {
    start: formatRangeEnd(start, monthNames, !sameMonth),
    end: formatRangeEnd(end, monthNames, !sameMonth),
  });
}

function dayLabel(day: string, weekdayNames: string[]): string {
  const weekday = weekdayNames[(new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7];
  return `${weekday} ${Number(day.slice(8, 10))}`;
}

// "5 de 6" once the day is already lived, "hoy" on today, nothing on a day
// yet to come — the literal three-way rule `Semana.dc.html` draws. The
// board's own "descanso deliberado" example is left out on purpose: it is a
// note the plan itself would have to supply, and nothing in `WeekView` or
// `CommitmentGoal` carries one — inventing a word for "nothing was asked" is
// exactly the judgement this design has no colour for.
function noteFor(day: string, today: string, filled: number, total: number, t: Translate): string | undefined {
  if (day > today) return undefined;
  if (day === today) return t("week.today");
  // A goal that drew no dot on a lived day asked nothing there (it was opened
  // later): a count would read "0 de 0", a pair of zeros with nothing behind.
  if (total === 0) return undefined;
  return t("week.ratio", { done: filled, total });
}

// The "Sueltas" group has no cadence to grade against (RP-20: a goalless
// one-off is a fact with a day, never an ask), so its own ratio is always
// "N de N" — never a shortfall, only ever whether the day carries one. A day
// that carries none says nothing rather than a vacuous "0 de 0": there is no
// data behind that pair of zeros, only their absence.
function goallessNoteFor(day: string, today: string, count: number, t: Translate): string | undefined {
  if (day === today) return t("week.today");
  if (count === 0) return undefined;
  return t("week.ratio", { done: count, total: count });
}

function commitmentDotState(slot: DaySlot): MarkState {
  if (slot.satisfiedBy === "evidence") return "evidence";
  return slot.satisfied ? "declared" : "empty";
}

function commitmentDotLabel(name: string, slot: DaySlot, t: Translate): string {
  if (slot.satisfiedBy === "evidence" && slot.labelKey) {
    return t("week.dot.evidence", { name, source: t(slot.labelKey) });
  }
  return t("week.dot.commitment", { name, status: t(slot.satisfied ? "week.dot.done" : "week.dot.pending") });
}

// The screen's own title (`Semana.dc.html`'s h1): the week's date range.
function WeekTitle({ start, end, t }: { start: string; end: string; t: Translate }) {
  return (
    <Text as="p" variant="title">
      {formatWeekRange(start, end, t)}
    </Text>
  );
}

/**
 * The current Monday-to-Sunday week (`/semana` is this week alone —
 * `Semana.dc.html` draws no control to look at another one, and none is
 * built here).
 *
 * A goal's own dots come from `view.days[i].slots`, narrowed to the
 * commitments `commitments` (module 9's `CommitmentGoal[]`) names as that
 * goal's own, plus one more filled dot per one-off fact `oneOffFacts` (RP-20)
 * names for that goal and that day — `deriveWeek` (module 4) knows nothing of
 * either grouping, it only ever derives a slot. A one-off belonging to
 * nothing draws in its own "Sueltas" group, exactly as the day screen's own
 * one does, but only when the week actually holds one — this screen writes
 * nothing, so an empty group here would be a group with no reason to exist.
 *
 * With no open goal at all (RP-11), this drew "Del 21 al 27" and nothing
 * else — a range and a dead end. `EmptyWeek` fills that in, in the day
 * screen's own words: the goalless one-offs below still draw when the week
 * holds one, since RP-20 asks for that group with or without a goal open.
 */
export async function WeekScreen() {
  const t = await getTranslations();
  const today = todayInZone();
  const week = await loadWeek(today);
  const { view, evidence, goals, commitments, oneOffFacts } = week;

  const weekdayNames = t.raw("week.weekdayShort") as string[];
  const weekdayLong = t.raw("week.weekdayLong") as string[];
  function linkFor(day: string) {
    const href = weekDayHref(day, today);
    if (!href) return undefined;
    const weekday = weekdayLong[(civilDateToDate(day).getUTCDay() + 6) % 7];
    return {
      href,
      label: t("week.openDay", { weekday, day: Number(day.slice(8, 10)) }),
    };
  }
  const columns = view.days.map((dayView) => {
    const link = linkFor(dayView.day);
    const label = dayLabel(dayView.day, weekdayNames);
    const isToday = dayView.day === today;
    return {
      key: dayView.day,
      label,
      mark: isToday ? t("week.todayMark") : undefined,
      href: link?.href,
      hrefLabel: link?.label,
      today: isToday,
    };
  });
  const slotsByDay = new Map(view.days.map((dayView) => [dayView.day, dayView.slots]));

  function dotsFor(goal: GoalSummary, day: string): WeekDot[] {
    // A day on or after the goal's end draws nothing (RP-26).
    if (day >= goal.horizon) return [];
    const goalId = goal.id;
    const goalCommitments = new Map(
      commitments
        .filter((c) => c.goalId === goalId && flexibleWords(c, t) === null)
        .map((c) => [c.id, c] as [string, CommitmentGoal]),
    );
    const slots = (slotsByDay.get(day) ?? []).filter((slot) => goalCommitments.has(slot.commitmentId));
    const oneOffs = oneOffFacts.filter((fact) => fact.goalId === goalId && fact.day === day);

    return [
      ...slots.map((slot) => ({
        state: commitmentDotState(slot),
        label: commitmentDotLabel(goalCommitments.get(slot.commitmentId)!.name, slot, t),
      })),
      ...oneOffs.map(() => ({ state: "declared" as const, label: t("week.dot.oneOff") })),
    ];
  }

  // A commitment counted by the week or the month: its own row, under the
  // goal's days, with its cadence and the period's count (`SemanaFlexible.dc.html`).
  function flexibleSection(goal: GoalSummary) {
    const rows = commitments.flatMap((c) => {
      const words = c.goalId === goal.id ? flexibleWords(c, t) : null;
      return words ? [{ commitment: c, words }] : [];
    });
    if (rows.length === 0) return null;
    return (
      <section key={`${goal.id}-flexible`}>
        <SectionLabel>{t("week.flexible.group", { name: goal.name })}</SectionLabel>
        {rows.map(({ commitment, words }, index) => (
          <Row
            key={commitment.id}
            name={commitment.name}
            meta={words.cadence}
            trailing={
              <Text as="span" variant="meta">
                {words.progress}
              </Text>
            }
            rule={index < rows.length - 1}
          />
        ))}
      </section>
    );
  }

  function goalSection(goal: GoalSummary) {
    const progress = goalWeekProgress(goal, view.start);
    // The page's own overline is the date range alone (`Semana.dc.html`
    // draws it once, above the h1); "semana N de M" rides the goal's own
    // section label instead — "inglés b2+ laboral · semana 1 de 12" — since
    // several open goals can carry different horizons and no single figure
    // would have an obvious owner.
    const sectionLabel = progress
      ? t("week.sectionLabel", { name: goal.name, week: progress.week, total: progress.total })
      : goal.name;

    const flexible = flexibleSection(goal);
    // A goal whose only commitments are flexible has no day to draw; a goal
    // with none at all still draws its section, as it always did.
    const daysToDraw =
      flexible === null ||
      commitments.some((c) => c.goalId === goal.id && flexibleWords(c, t) === null) ||
      oneOffFacts.some((fact) => fact.goalId === goal.id);
    if (!daysToDraw) return flexible;

    return (
      <Fragment key={goal.id}>
        <section>
          <SectionLabel>{sectionLabel}</SectionLabel>
          {view.days.map((dayView, index) => {
            const dots = dotsFor(goal, dayView.day);
            const ended = dayView.day >= goal.horizon;
            const filled = dots.filter((dot) => dot.state !== "empty").length;
            return (
              <WeekDayRow
                key={dayView.day}
                label={dayLabel(dayView.day, weekdayNames)}
                isToday={dayView.day === today}
                link={linkFor(dayView.day)}
                dots={dots}
                note={ended ? undefined : noteFor(dayView.day, today, filled, dots.length, t)}
                rule={index < view.days.length - 1}
              />
            );
          })}
        </section>
        {flexible}
      </Fragment>
    );
  }

  const goalless = (day: string): OneOffFact[] =>
    oneOffFacts.filter((fact) => fact.goalId === null && fact.day === day);
  const hasGoalless = oneOffFacts.some((fact) => fact.goalId === null);

  return (
    <Page>
      <WeekTitle start={view.start} end={view.days[6]?.day ?? view.start} t={t} />

      {evidence === "unreadable" ? (
        <Text as="p" tone="muted" variant="meta">
          {t("week.unreadableEvidence")}
        </Text>
      ) : null}

      {goals.length === 0 ? (
        <EmptyWeek title={t("week.empty.title")} action={t("week.empty.action")} />
      ) : null}

      <Face on="desktop">
        <WeekTableFace week={week} today={today} columns={columns} t={t} />
      </Face>

      <Face on="phone">
        {goals.map(goalSection)}

        {hasGoalless ? (
          <section>
            <SectionLabel>{t("week.oneOffs.title")}</SectionLabel>
            {view.days.map((dayView, index) => {
              const count = goalless(dayView.day).length;
              const dots: WeekDot[] = Array.from({ length: count }, () => ({
                state: "declared",
                label: t("week.dot.oneOff"),
              }));
              return (
                <WeekDayRow
                  key={dayView.day}
                  label={dayLabel(dayView.day, weekdayNames)}
                  isToday={dayView.day === today}
                  link={linkFor(dayView.day)}
                  dots={dots}
                  note={goallessNoteFor(dayView.day, today, count, t)}
                  rule={index < view.days.length - 1}
                />
              );
            })}
          </section>
        ) : null}
      </Face>
    </Page>
  );
}
