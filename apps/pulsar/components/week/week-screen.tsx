import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { type Translator } from "@/i18n/translator";
import { Flex, IconButton, Page, ScreenHeader, Text } from "@/components/ui";
import { dayPhrase } from "@/lib/day/day-phrase";
import { weekDayHref } from "@/lib/day/week-href";
import { weekSteps } from "@/lib/day/week-param";
import { loadWeek, type GoalSummary } from "@/lib/queries/week";
import { civilDateToDate, weekOf } from "@/lib/zone";

import { EmptyWeek } from "./empty-week";
import { EndedLine } from "./ended-line";
import { endedLastDay } from "./week-progress";
import { WeekTableFace } from "./week-table-face";


// The day number alone when both ends of the range share a month
// (`Semana.dc.html`'s own "Del 21 al 27"), the month's short name added where
// a week crosses one: «Del 28 sep al 4 oct» (`SemanaPasadaEscritorio.dc.html`).
function formatRangeEnd(day: string, monthNames: string[], withMonth: boolean): string {
  const [, month, dayOfMonth] = day.split("-");
  const dayNumber = String(Number(dayOfMonth));
  return withMonth ? `${dayNumber} ${monthNames[Number(month) - 1]}` : dayNumber;
}

function formatWeekRange(start: string, end: string, t: Translator): string {
  const monthNames = t.raw("week.monthShort") as string[];
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return t("week.range", {
    start: formatRangeEnd(start, monthNames, !sameMonth),
    end: formatRangeEnd(end, monthNames, !sameMonth),
  });
}

// The week's distance from today, said the way `SemanaPasada.dc.html` heads it.
function eyebrowFor(monday: string, thisMonday: string, firstMonday: string | null, t: Translator): string {
  if (monday === thisMonday) return t("week.eyebrow.this");
  const month = (t.raw("day.monthLong") as string[])[Number(monday.slice(5, 7)) - 1];
  if (monday === firstMonday) return t("week.eyebrow.first", { month });
  const weeksAgo = Math.round(
    (civilDateToDate(thisMonday).getTime() - civilDateToDate(monday).getTime()) / (7 * 86_400_000),
  );
  return weeksAgo === 1 ? t("week.eyebrow.last") : t("week.eyebrow.ago", { month, count: weeksAgo });
}

function stepHref(monday: string | null, thisMonday: string): string | null {
  if (monday === null) return null;
  return monday === thisMonday ? "/semana" : `/semana?semana=${monday}`;
}

/**
 * The Monday-to-Sunday week `day` sits in, read-only beyond seven days back.
 * ‹ › step a week at a time (`SemanaPasada.dc.html`); the week is drawn by
 * `WeekTableFace`, folded to one row per commitment on the phone.
 *
 * With no open goal at all (RP-11) the screen drew a range and a dead end;
 * `EmptyWeek` fills that in, in the day screen's own words.
 */
export async function WeekScreen({ day, today }: { day: string; today: string }) {
  const t = await getTranslations();
  const week = await loadWeek(day);
  const { view, evidence, goals } = week;

  const thisMonday = weekOf(today)[0];
  // A week before the first goal's has nothing to read: land on the first.
  if (week.firstMonday !== null && view.start < week.firstMonday) {
    redirect(stepHref(week.firstMonday, thisMonday) ?? "/semana");
  }
  const past = view.start !== thisMonday;
  const steps = weekSteps({ monday: view.start, thisMonday, firstMonday: week.firstMonday });
  const prev = stepHref(steps.prev, thisMonday);
  const next = stepHref(steps.next, thisMonday);

  const weekdayNames = t.raw("week.weekdayShort") as string[];
  const weekdayLong = t.raw("week.weekdayLong") as string[];
  const columns = view.days.map((dayView) => {
    const href = weekDayHref(dayView.day, today);
    const weekday = (civilDateToDate(dayView.day).getUTCDay() + 6) % 7;
    const dayNumber = Number(dayView.day.slice(8, 10));
    const isToday = dayView.day === today;
    return {
      key: dayView.day,
      label: `${weekdayNames[weekday]} ${dayNumber}`,
      mark: isToday ? t("week.todayMark") : undefined,
      href: href ?? undefined,
      hrefLabel: href ? t("week.openDay", { weekday: weekdayLong[weekday], day: dayNumber }) : undefined,
      today: isToday,
    };
  });

  // «terminó el <día> · ver»: Hoy's own phrase and keys, always naming the day
  // since the week is not read from today.
  function endedNote(goal: GoalSummary) {
    const lastDay = endedLastDay(goal.horizon, today);
    if (lastDay === null) return null;
    const text = dayPhrase((key, values) => t(key, values), "day.ended.on", lastDay, today, {
      weekdays: t.raw("day.weekdayLong") as string[],
      months: t.raw("day.monthLong") as string[],
    }, { goal: "" });
    return (
      <EndedLine
        text={text.trim()}
        href={`/metas/${goal.id}`}
        see={t("day.ended.see")}
        seeLabel={t("day.ended.seeLabel", { goal: goal.name })}
      />
    );
  }

  function step(href: string | null, label: string, icon: "prev" | "next") {
    if (href === null) return <Flex width="48px" flexShrink="0" aria-hidden />;
    return (
      <IconButton asChild tap={48} variant="ghost">
        <Link href={href} aria-label={label}>
          {icon === "prev" ? <ChevronLeft size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
        </Link>
      </IconButton>
    );
  }

  return (
    <Page width="full">
      <ScreenHeader
        title={formatWeekRange(view.start, view.days[6]?.day ?? view.start, t)}
        eyebrow={
          <Text as="p" variant="meta" tone="muted">
            {eyebrowFor(view.start, thisMonday, week.firstMonday, t)}
          </Text>
        }
        actions={
          <Flex align="center" gap="1">
            {step(prev, t("week.nav.prev"), "prev")}
            {step(next, t("week.nav.next"), "next")}
          </Flex>
        }
      />

      {evidence === "unreadable" ? (
        <Text as="p" tone="muted" variant="meta">
          {t("week.unreadableEvidence")}
        </Text>
      ) : null}

      {goals.length === 0 ? (
        <EmptyWeek title={t("week.empty.title")} action={t("week.empty.action")} />
      ) : null}

      <WeekTableFace week={week} today={today} past={past} columns={columns} t={t} endedNote={endedNote} />
    </Page>
  );
}
