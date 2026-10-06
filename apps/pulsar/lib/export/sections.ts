import type { ReviewWeek } from "@/lib/day/types";

import { shortMonth } from "@/lib/dates/short-month";

import type { GoalReport } from "./report";

export type Section = "month" | "toDate" | "phases" | "tasks" | "months";

// A goal with no unit measures nothing, so it prints no figure section
// rather than a zero (RP-46). `month` stays with a unit even when this month
// has no amount: the page then prints the reached figure alone. `tasks` is
// every task of the month, carried first, so a goal with none prints no head.
export function goalSections(goal: GoalReport): Section[] {
  const measured = goal.unit !== null;
  const sections: Section[] = [];
  if (measured) sections.push("month", "toDate");
  if (goal.phases.length > 0) sections.push("phases");
  if (goal.tasks.length > 0) sections.push("tasks");
  if (measured) sections.push("months");
  return sections;
}

// A week as one month holds it: the whole week, or its days in that month.
export type MonthWeek = Pick<ReviewWeek, "index" | "startsOn" | "endsOn" | "total" | "current">;

export type MonthWithWeeks = {
  month: GoalReport["months"][number];
  weeks: MonthWeek[];
};

// A week inside one month sits under it whole; one crossing two sits under
// both, cut at the edge (`goal.weekSplits`), so a month's weeks add up to it.
export function monthsWithWeeks(goal: GoalReport): MonthWithWeeks[] {
  return goal.months.map((month) => {
    const key = month.month.slice(0, 7);
    const weeks: MonthWeek[] = [];
    for (const week of goal.weeks) {
      const parts = goal.weekSplits.filter((split) => split.index === week.index);
      if (parts.length === 0) {
        if (week.startsOn.slice(0, 7) === key) weeks.push(week);
        continue;
      }
      const part = parts.find((split) => split.month.slice(0, 7) === key);
      if (part) weeks.push({ ...week, startsOn: part.startsOn, endsOn: part.endsOn, total: part.total });
    }
    return { month, weeks };
  });
}

// «31 ago–6 sep 2026»: the year closes the span, and opens both ends when the
// span crosses a year.
export function civilSpan(startsOn: string, endsOn: string): string {
  const [startYear, startMonth, startDay] = startsOn.split("-").map(Number);
  const [endYear, endMonth, endDay] = endsOn.split("-").map(Number);
  if (startsOn === endsOn) return `${endDay} ${shortMonth(endsOn)} ${endYear}`;
  const start = shortMonth(startsOn);
  const end = shortMonth(endsOn);
  if (startYear !== endYear) return `${startDay} ${start} ${startYear}–${endDay} ${end} ${endYear}`;
  if (startMonth !== endMonth) return `${startDay} ${start}–${endDay} ${end} ${endYear}`;
  return `${startDay}–${endDay} ${end} ${endYear}`;
}
