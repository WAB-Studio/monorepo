import { dayBefore } from "@/lib/day/weeks";
import type { ShiftPlan } from "./shift";

export type ShiftRows = {
  budgets: { from: string; to: string; next: string } | null;
  tasks: { count: number; month: string } | null;
  phases: { name: string; from: string; to: string }[];
  end: { from: string; to: string } | null;
  // The month the shift empties, capitalised for the start of a sentence.
  emptied: string;
};

const long = new Intl.DateTimeFormat("es", { month: "long", timeZone: "UTC" });

// «dic»: cut from the long name, as `civilDateShort` does, because ICU's own
// short form is «sept».
function short(day: string): string {
  return long.format(new Date(`${day.slice(0, 7)}-01T12:00:00Z`)).slice(0, 3);
}

function span(startsOn: string, endsOn: string): string {
  const from = short(startsOn);
  const to = short(endsOn);
  return from === to ? from : `${from}–${to}`;
}

// «30 sep 2027»: a horizon is the day after the last, so the sheet names the
// last day the goal runs.
function lastDay(horizon: string): string {
  const day = dayBefore(horizon);
  return `${Number(day.slice(8, 10))} ${short(day)}`;
}

// What the shift sheet prints for a plan, as the words' parameters. Amounts
// are one grouped row, never one per month; a row with nothing to move is null
// or absent.
export function shiftRows(plan: ShiftPlan): ShiftRows {
  const budgets = plan.budgets;
  const first = budgets[0];
  const last = budgets.at(-1);
  const taskMonth = plan.tasks.map((task) => task.from).sort()[0];
  const emptiedName = long.format(new Date(`${plan.emptied}T12:00:00Z`));

  return {
    budgets:
      first && last ? { from: short(first.month), to: short(last.month), next: short(first.to) } : null,
    tasks: plan.tasks.length > 0 ? { count: plan.tasks.length, month: short(taskMonth) } : null,
    phases: plan.phases.map((phase) => ({
      name: phase.aim,
      from: span(phase.startsOn, phase.endsOn),
      to: span(phase.toStartsOn, phase.toEndsOn),
    })),
    end: plan.horizon
      ? {
          from: lastDay(plan.horizon.from),
          to: `${lastDay(plan.horizon.to)} ${dayBefore(plan.horizon.to).slice(0, 4)}`,
        }
      : null,
    emptied: emptiedName.charAt(0).toUpperCase() + emptiedName.slice(1),
  };
}
