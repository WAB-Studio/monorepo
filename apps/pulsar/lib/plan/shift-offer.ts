import { dayBefore } from "@/lib/day/weeks";
import { carryShare, type Task } from "./carry";
import { monthOf, nextMonth, type MonthBudget } from "./months";
import { addMonths, shiftOffered, shiftPlan, type ShiftPlan } from "./shift";

// RP-34 as every screen that offers the shift reads it: the month before
// today's, or null when it is not on offer. Whether the goal is open stays
// the caller's check.
export function shiftOfferNow({
  today,
  horizon,
  budgets,
  phases,
  tasks,
  shifts,
}: {
  today: string;
  horizon: string;
  budgets: MonthBudget[];
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
  if (share === null || !shiftOffered({ month: closedMonth, today, share, shifted: shifts })) {
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
