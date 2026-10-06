import type { ReviewWeek } from "@/lib/day/types";

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

export type MonthWithWeeks = {
  month: GoalReport["months"][number];
  weeks: ReviewWeek[];
};

// Each week sits under the month its first day falls in, so a week that
// crosses into the next month stays with the month it began in.
export function monthsWithWeeks(goal: GoalReport): MonthWithWeeks[] {
  return goal.months.map((month) => ({
    month,
    weeks: goal.weeks.filter((week) => week.startsOn.slice(0, 7) === month.month.slice(0, 7)),
  }));
}

const SHORT_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// «31 ago–6 sep 2026»: the year closes the span, and opens both ends when the
// span crosses a year. The month is cut to three letters because ICU's own
// short form is «sept».
export function civilSpan(startsOn: string, endsOn: string): string {
  const [startYear, startMonth, startDay] = startsOn.split("-").map(Number);
  const [endYear, endMonth, endDay] = endsOn.split("-").map(Number);
  const start = SHORT_MONTHS[startMonth - 1];
  const end = SHORT_MONTHS[endMonth - 1];
  if (startYear !== endYear) return `${startDay} ${start} ${startYear}–${endDay} ${end} ${endYear}`;
  if (startMonth !== endMonth) return `${startDay} ${start}–${endDay} ${end} ${endYear}`;
  return `${startDay}–${endDay} ${end} ${endYear}`;
}
