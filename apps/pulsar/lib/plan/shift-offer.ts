import { dayBefore } from "@/lib/day/weeks";
import { carryShare, type Task } from "./carry";
import { monthOf, nextMonth, type MonthBudget } from "./months";
import { addMonths, monthAmount, shiftOffered, shiftPlan, type ShiftPlan } from "./shift";

// RP-48 as every screen that offers the shift reads it: the month before
// today's, or null when it is not on offer. Whether the goal is open stays
// the caller's check.
export function shiftOfferNow({
  today,
  horizon,
  budgets,
  months,
  phases,
  tasks,
  shifts,
}: {
  today: string;
  horizon: string;
  budgets: MonthBudget[];
  // Each month's reached amount, RP-36 estimates included.
  months: { month: string; reached: number }[];
  phases: { id: string; name: string; startsOn: string; endsOn: string | null }[];
  tasks: Task[];
  shifts: string[];
}): {
  closedMonth: string;
  share: { carried: number; planned: number };
  plan: ShiftPlan;
  until: string;
} | null {
  const thisMonth = monthOf(today);
  const closedMonth = addMonths(thisMonth, -1);
  const share = carryShare(tasks, closedMonth);
  if (
    share === null ||
    !shiftOffered({
      month: closedMonth,
      today,
      share,
      amount: monthAmount(closedMonth, budgets, months),
      shifted: shifts,
    })
  ) {
    return null;
  }
  return {
    closedMonth,
    share,
    plan: shiftPlan({
      closedMonth,
      today,
      horizon,
      budgets,
      // A phase with no end has no span to move.
      phases: phases.flatMap((phase) =>
        phase.endsOn === null
          ? []
          : [{ id: phase.id, aim: phase.name, startsOn: phase.startsOn, endsOn: phase.endsOn }],
      ),
      tasks,
    }),
    until: dayBefore(nextMonth(thisMonth)),
  };
}
