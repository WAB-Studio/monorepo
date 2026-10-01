import type { GoalReport } from "./report";

export type Section = "month" | "toDate" | "phases" | "carried" | "months" | "weeks";

// A goal with no unit measures nothing, so it prints no figure section
// rather than a zero (RP-33). `month` stays with a unit even when this month
// has no amount: the page then prints the reached figure alone.
export function goalSections(goal: GoalReport): Section[] {
  const measured = goal.unit !== null;
  const sections: Section[] = [];
  if (measured) sections.push("month", "toDate");
  if (goal.phases.length > 0) sections.push("phases");
  if (goal.carried.length > 0) sections.push("carried");
  if (measured) sections.push("months", "weeks");
  return sections;
}
