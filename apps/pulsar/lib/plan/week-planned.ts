import type { MonthBudget } from "@/lib/plan/months";

export function weekPlanned(_input: {
  weekStart: string;
  weekEnd: string;
  budgets: MonthBudget[];
  openedOn: string;
  horizon: string;
}): number | null {
  throw new Error("not built");
}
