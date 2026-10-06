import { dayBefore } from "@/lib/day/weeks";
import { phaseWithinHorizon } from "@/lib/validation/plan";
import { dateToCivilDate } from "@/lib/zone";
import type { Task } from "./carry";
import { monthOf, nextMonth, underSixty, type MonthBudget } from "./months";

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

// What a closed month planned and reached (RP-28), the figures RP-48 reads.
export function monthAmount(
  month: string,
  budgets: MonthBudget[],
  reached: { month: string; reached: number }[],
): { planned: number | null; reached: number } {
  return {
    planned: budgets.find((budget) => budget.month === month)?.amount ?? null,
    reached: reached.find((row) => row.month === month)?.reached ?? 0,
  };
}

// RP-48: only through the month after the closed one, once, when strictly
// more than half of what it planned was left undone and, where the month had
// an amount, it reached under 60 % of it. No amount (null or zero) leaves the
// list rule alone.
export function shiftOffered({
  month,
  today,
  share,
  amount,
  shifted,
}: {
  month: string;
  today: string;
  share: { carried: number; planned: number } | null;
  amount: { planned: number | null; reached: number };
  shifted: string[];
}): boolean {
  const fellShort =
    amount.planned === null || amount.planned <= 0 || underSixty(amount.reached, amount.planned);
  return (
    monthOf(today) === addMonths(month, 1) &&
    share !== null &&
    share.carried * 2 > share.planned &&
    fellShort &&
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
