import { dayBefore } from "@/lib/day/weeks";
import { phaseWithinHorizon } from "@/lib/validation/plan";
import { dateToCivilDate } from "@/lib/zone";
import type { Task } from "./carry";
import { monthOf, nextMonth, type MonthBudget } from "./months";

export type ShiftPhase = { id: string; aim: string; startsOn: string; endsOn: string };

export type ShiftPlan = {
  budgets: { month: string; to: string; amount: number }[];
  phases: (ShiftPhase & { toStartsOn: string; toEndsOn: string })[];
  tasks: { id: string; name: string; from: string; to: string }[];
  horizon: { from: string; to: string } | null;
  emptied: string;
};

// Calendar months, clamped to the target month's last day: 31 January + 1
// is the 28th or 29th of February, never the 3rd of March.
export function addMonths(day: string, n: number): string {
  const index = Number(day.slice(0, 4)) * 12 + (Number(day.slice(5, 7)) - 1) + n;
  const year = Math.floor(index / 12);
  const month = index % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const target = Math.min(Number(day.slice(8, 10)), lastDay);
  return dateToCivilDate(new Date(Date.UTC(year, month, target, 12)));
}

// RP-34: only through the month after the closed one, once, and only when
// strictly more than half of what it planned was left undone.
export function shiftOffered({
  month,
  today,
  share,
  shifted,
}: {
  month: string;
  today: string;
  share: { carried: number; planned: number } | null;
  shifted: string[];
}): boolean {
  return (
    monthOf(today) === addMonths(month, 1) &&
    share !== null &&
    share.carried * 2 > share.planned &&
    !shifted.includes(month)
  );
}

// A sub-task has no month of its own and follows its parent; a parent is done
// once every child is.
function isDone(task: Task, tasks: Task[]): boolean {
  const children = tasks.filter((other) => other.parentId === task.id);
  return children.length === 0
    ? task.doneOn !== null
    : children.every((child) => child.doneOn !== null);
}

// Re-derived on the server from the rows it reads, never from the client.
export function shiftPlan({
  closedMonth,
  today,
  horizon,
  budgets,
  phases,
  tasks,
}: {
  closedMonth: string;
  today: string;
  horizon: string;
  budgets: MonthBudget[];
  phases: ShiftPhase[];
  tasks: Task[];
}): ShiftPlan {
  const emptied = addMonths(closedMonth, 1);

  const movedBudgets = budgets
    .filter((budget) => budget.month >= emptied)
    .map((budget) => ({ month: budget.month, to: addMonths(budget.month, 1), amount: budget.amount }));

  // A phase already begun stays: a week lived never changes shape.
  const movedPhases = phases
    .filter((phase) => phase.startsOn > today)
    .map((phase) => ({
      ...phase,
      toStartsOn: addMonths(phase.startsOn, 1),
      toEndsOn: addMonths(phase.endsOn, 1),
    }));

  const movedTasks = tasks
    .filter(
      (task) =>
        task.parentId === null &&
        task.plannedMonth !== null &&
        task.plannedMonth >= emptied &&
        !isDone(task, tasks) &&
        (task.day === null || task.day > today),
    )
    .map((task) => ({
      id: task.id,
      name: task.name,
      from: task.plannedMonth as string,
      to: addMonths(task.plannedMonth as string, 1),
    }));

  // The least horizon that holds every moved item: a month's last day must
  // fall inside the span (`monthsOfSpan`), a phase's end within it.
  let newHorizon = horizon;
  const lastMonth = monthOf(dayBefore(newHorizon));
  const latestMonth = [...movedBudgets.map((b) => b.to), ...movedTasks.map((t) => t.to)]
    .sort()
    .at(-1);
  if (latestMonth !== undefined && latestMonth > lastMonth) {
    newHorizon = nextMonth(latestMonth);
  }
  for (const phase of movedPhases) {
    if (!phaseWithinHorizon({ startsOn: phase.toStartsOn, endsOn: phase.toEndsOn }, newHorizon)) {
      newHorizon = phase.toEndsOn;
    }
  }

  return {
    budgets: movedBudgets,
    phases: movedPhases,
    tasks: movedTasks,
    horizon: newHorizon === horizon ? null : { from: horizon, to: newHorizon },
    emptied,
  };
}
