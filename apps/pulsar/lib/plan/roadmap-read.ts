import { dayBefore, daysBetween } from "@/lib/day/weeks";
import { monthOfTask } from "./carry";
import { monthOf, nextMonth } from "./months";
import { amountOf, fillPlan, type PlanInput, type PlanItem, type PlanTask } from "./roadmap";

export type PlanNotice = {
  closedMonth: string;
  movedDays: number;
  closedDone: number;
  closedAmount: number;
  end: string;
};

const lastDayOf = (month: string) => dayBefore(nextMonth(month));
const monthBefore = (month: string) => monthOf(dayBefore(month));

function childrenOf(tasks: PlanTask[], task: PlanTask): PlanTask[] {
  return tasks.filter((other) => other.parentId === task.id);
}

// The last day of a task's children, once all are done; a leaf's own.
function doneDayOf(task: PlanTask, children: PlanTask[]): string | null {
  if (children.length === 0) return task.doneOn;
  let last: string | null = null;
  for (const child of children) {
    if (child.doneOn === null) return null;
    if (last === null || child.doneOn > last) last = child.doneOn;
  }
  return last;
}

// What the task still owes counting only what is done by `day`.
function owedBy(task: PlanTask, children: PlanTask[], day: string): number {
  const undone = (t: PlanTask) => (t.doneOn === null || t.doneOn > day ? (t.estimate ?? 0) : 0);
  return children.length === 0 ? undone(task) : children.reduce((total, child) => total + undone(child), 0);
}

function inPlanList(task: PlanTask): boolean {
  return task.parentId === null && (task.inPlan || task.day !== null || task.plannedMonth !== null);
}

export function planMonthList(input: PlanInput, month: string): PlanItem[] {
  const current = monthOf(input.today);
  if (month >= current) {
    const items = fillPlan(input).months.find((m) => m.month === month)?.items ?? [];
    if (month !== current) return items;
    // Left undone from last month: it sat in an earlier month on the day before this one began.
    const before = fillPlan({ ...input, today: dayBefore(current) });
    const sat = new Map<string, string>();
    for (const m of before.months) {
      if (m.month >= current) continue;
      for (const item of m.items) sat.set(item.task.id, m.month);
    }
    const marked = items.map((item) => {
      const from = sat.get(item.task.id);
      return item.carriedFrom === null && !item.fixed && !item.done && from !== undefined
        ? { ...item, carriedFrom: from }
        : item;
    });
    return [...marked.filter((item) => item.carriedFrom !== null), ...marked.filter((item) => item.carriedFrom === null)];
  }

  const last = lastDayOf(month);
  const listed = fillPlan({ ...input, today: month, doneBy: last }).months.find((m) => m.month === month)?.items ?? [];
  const seen = new Set(listed.map((item) => item.task.id));
  const ahead: PlanItem[] = [];
  for (const task of input.tasks) {
    if (!inPlanList(task) || seen.has(task.id)) continue;
    const children = childrenOf(input.tasks, task);
    const doneOn = doneDayOf(task, children);
    if (doneOn === null || monthOf(doneOn) !== month) continue;
    const hours = children.length === 0 ? (task.estimate ?? 0) : children.reduce((t, c) => t + (c.estimate ?? 0), 0);
    ahead.push({
      task,
      children,
      hours,
      part: hours,
      from: null,
      to: null,
      fixed: monthOfTask(task) !== null,
      carriedFrom: null,
      done: true,
      endsOn: null,
      pastEnd: false,
    });
  }
  return [...listed, ...ahead];
}

export function planShare(input: PlanInput, month: string): { carried: number; planned: number } | null {
  if (month >= monthOf(input.today)) return null;
  const last = lastDayOf(month);
  const held = fillPlan({ ...input, today: month }).months.find((m) => m.month === month)?.items ?? [];
  let planned = 0;
  let carried = 0;
  for (const item of held) {
    // The item was read on the month's first day; its doneness is read from the tasks themselves.
    const task = input.tasks.find((other) => other.id === item.task.id) ?? item.task;
    const children = childrenOf(input.tasks, task);
    planned += item.part;
    carried += Math.min(item.part, owedBy(task, children, last));
  }
  return planned === 0 ? null : { carried, planned };
}

export function planMoved(input: PlanInput & { seen: string | null }): PlanNotice | null {
  if (input.rhythm === null) return null;
  const current = monthOf(input.today);
  const closed = monthBefore(current);
  if (closed < monthOf(input.openedOn)) return null;
  if (input.seen !== null && input.seen >= closed) return null;

  const last = lastDayOf(closed);
  const before = fillPlan({ ...input, today: last }).end;
  const after = fillPlan({ ...input, today: current, doneBy: last }).end;
  if (before === null || after === null || after <= before) return null;

  // Leaves only: a parent's hours are its children's.
  const parents = new Set(input.tasks.map((task) => task.parentId));
  let closedDone = 0;
  for (const task of input.tasks) {
    if (parents.has(task.id) || task.doneOn === null || monthOf(task.doneOn) !== closed) continue;
    closedDone += task.estimate ?? 0;
  }
  return {
    closedMonth: closed,
    movedDays: daysBetween(before, after),
    closedDone,
    closedAmount: amountOf(closed, input) ?? 0,
    end: after,
  };
}

export function rhythmToMeet(input: PlanInput, step: number): number | null {
  const lastDay = dayBefore(input.horizon);
  const plan = fillPlan(input);
  if (plan.state === "empty") return null;
  if (plan.end !== null && plan.end <= lastDay) return null;

  const meets = (steps: number) => {
    const end = fillPlan({ ...input, rhythm: steps * step }).end;
    return end !== null && end <= lastDay;
  };
  const total = input.tasks.reduce((sum, task) => sum + (task.estimate ?? 0), 0);
  let high = Math.max(1, Math.ceil(total / step));
  if (!meets(high)) return null;
  let low = 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (meets(mid)) high = mid;
    else low = mid + 1;
  }
  return high * step;
}
