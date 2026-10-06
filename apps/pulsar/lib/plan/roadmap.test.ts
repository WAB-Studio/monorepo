import assert from "node:assert/strict";
import test from "node:test";

import { amountOf, fillPlan, type PlanInput, type PlanItem, type PlanTask, type Roadmap } from "./roadmap";

const SEP = "2026-09-01";
const OCT = "2026-10-01";
const NOV = "2026-11-01";
const DEC = "2026-12-01";
const JAN = "2027-01-01";
const TODAY = "2026-10-15";

let nextPosition = 0;

// An unfixed plan task, created before every reading day of these tests.
function task(id: string, patch: Partial<PlanTask> = {}): PlanTask {
  nextPosition += 1;
  return {
    id,
    parentId: null,
    name: id,
    plannedMonth: null,
    day: null,
    estimate: null,
    doneOn: null,
    inPlan: true,
    createdOn: "2026-08-01",
    position: nextPosition,
    ...patch,
  };
}

function plan(tasks: PlanTask[], patch: Partial<PlanInput> = {}): Roadmap {
  return fillPlan({
    rhythm: 12,
    budgets: [],
    tasks,
    openedOn: "2026-08-01",
    horizon: "2027-07-01",
    today: TODAY,
    ...patch,
  });
}

// Every part of `id`, in month order: [month, part].
function parts(roadmap: Roadmap, id: string): [string, number][] {
  return roadmap.months.flatMap((month) =>
    month.items.filter((item) => item.task.id === id).map((item): [string, number] => [month.month, item.part]),
  );
}

function partIn(roadmap: Roadmap, month: string, id: string): PlanItem {
  const item = roadmap.months.find((m) => m.month === month)?.items.find((i) => i.task.id === id);
  assert.ok(item, `${id} has no part in ${month}`);
  return item;
}

function ids(roadmap: Roadmap, month: string): string[] {
  return (roadmap.months.find((m) => m.month === month)?.items ?? []).map((item) => item.task.id);
}

test("a task larger than a month's room splits, its parts summing to its hours, from/to naming the neighbours", () => {
  const roadmap = plan([task("a", { estimate: 8 }), task("b", { estimate: 10 })]);
  assert.deepEqual(parts(roadmap, "b"), [
    [OCT, 4],
    [NOV, 6],
  ]);
  const first = partIn(roadmap, OCT, "b");
  const second = partIn(roadmap, NOV, "b");
  assert.equal(first.hours, 10);
  assert.equal(first.part + second.part, first.hours);
  assert.deepEqual([first.from, first.to], [null, NOV]);
  assert.deepEqual([second.from, second.to], [OCT, null]);
});

test("a 30-hour task at 12 a month spans three months", () => {
  const roadmap = plan([task("big", { estimate: 30 })]);
  assert.deepEqual(parts(roadmap, "big"), [
    [OCT, 12],
    [NOV, 12],
    [DEC, 6],
  ]);
  assert.deepEqual([partIn(roadmap, NOV, "big").from, partIn(roadmap, NOV, "big").to], [OCT, DEC]);
});

test("a fixed task stays in its month and the rest flow around it", () => {
  const roadmap = plan([
    task("a", { estimate: 10 }),
    task("fixed", { estimate: 8, plannedMonth: NOV }),
    task("b", { estimate: 6 }),
  ]);
  assert.deepEqual(parts(roadmap, "fixed"), [[NOV, 8]]);
  assert.equal(partIn(roadmap, NOV, "fixed").fixed, true);
  // October keeps 2 after a; November keeps 4 after the fixed task.
  assert.deepEqual(parts(roadmap, "b"), [
    [OCT, 2],
    [NOV, 4],
  ]);
});

test("a fixed task larger than its month's room stays whole there; the flow skips the month", () => {
  const roadmap = plan([
    task("a", { estimate: 12 }),
    task("fixed", { estimate: 20, plannedMonth: NOV }),
    task("b", { estimate: 5 }),
  ]);
  assert.deepEqual(parts(roadmap, "fixed"), [[NOV, 20]]);
  assert.deepEqual(parts(roadmap, "b"), [[DEC, 5]]);
  const november = roadmap.months.find((m) => m.month === NOV);
  assert.equal(november?.filled, 20);
});

test("a task fixed to a past month and undone reads in the current month, first, carriedFrom set", () => {
  const roadmap = plan([
    task("a", { estimate: 4 }),
    task("late", { estimate: 3, plannedMonth: SEP }),
  ]);
  assert.deepEqual(ids(roadmap, OCT), ["late", "a"]);
  assert.equal(partIn(roadmap, OCT, "late").carriedFrom, SEP);
  assert.equal(partIn(roadmap, OCT, "a").carriedFrom, null);
});

test("an override replaces the rhythm for its month", () => {
  const roadmap = plan([task("big", { estimate: 30 })], {
    budgets: [{ month: NOV, amount: 4 }],
  });
  assert.deepEqual(parts(roadmap, "big"), [
    [OCT, 12],
    [NOV, 4],
    [DEC, 12],
    [JAN, 2],
  ]);
});

test("an override of 0 is skipped", () => {
  const roadmap = plan([task("big", { estimate: 20 })], {
    budgets: [{ month: NOV, amount: 0 }],
  });
  assert.deepEqual(parts(roadmap, "big"), [
    [OCT, 12],
    [DEC, 8],
  ]);
});

test("amountOf: the month's own amount, 0 included, else the rhythm, else null", () => {
  const budgets = [{ month: NOV, amount: 0 }];
  assert.equal(amountOf(NOV, { budgets, rhythm: 12 }), 0);
  assert.equal(amountOf(OCT, { budgets, rhythm: 12 }), 12);
  assert.equal(amountOf(OCT, { budgets, rhythm: null }), null);
});

test("a 0-hour task takes the cursor's month and no room", () => {
  const roadmap = plan([
    task("a", { estimate: 12 }),
    task("b", { estimate: 6 }),
    task("zero"),
    task("c", { estimate: 6 }),
  ]);
  assert.deepEqual(parts(roadmap, "zero"), [[NOV, 0]]);
  assert.deepEqual(parts(roadmap, "c"), [[NOV, 6]]);
});

test("a parent's hours are its undone children's, and a done child's hours fill its done month", () => {
  const roadmap = plan([
    task("parent"),
    task("done-child", { parentId: "parent", estimate: 5, doneOn: "2026-10-03" }),
    task("open-child", { parentId: "parent", estimate: 4 }),
    task("open-child-2", { parentId: "parent", estimate: 3 }),
    task("after", { estimate: 12 }),
  ]);
  const parent = partIn(roadmap, OCT, "parent");
  assert.equal(parent.hours, 7);
  assert.deepEqual(
    parent.children.map((child) => child.id),
    ["done-child", "open-child", "open-child-2"],
  );
  // October: 5 done + 7 for the parent leaves nothing for `after`.
  assert.deepEqual(parts(roadmap, "after"), [[NOV, 12]]);
});

test("a task done in a past month sits there and adds no room to today's", () => {
  const roadmap = plan([
    task("old", { estimate: 9, doneOn: "2026-09-20" }),
    task("a", { estimate: 12 }),
  ]);
  assert.equal(
    roadmap.months.some((month) => month.items.some((item) => item.task.id === "old")),
    false,
  );
  assert.deepEqual(parts(roadmap, "a"), [[OCT, 12]]);
});

test("the current month's room loses what is done in it", () => {
  const roadmap = plan([
    task("done", { estimate: 5, doneOn: "2026-10-05" }),
    task("a", { estimate: 10 }),
  ]);
  const done = partIn(roadmap, OCT, "done");
  assert.equal(done.done, true);
  assert.equal(done.part, 5);
  assert.deepEqual(parts(roadmap, "a"), [
    [OCT, 7],
    [NOV, 3],
  ]);
});

test("a month closed with tasks undone pushes them into the current month and the rest after them", () => {
  const tasks = (doneOn: string | null) => [
    task("sep-1", { estimate: 6, doneOn, plannedMonth: SEP }),
    task("sep-2", { estimate: 6, doneOn, plannedMonth: SEP }),
    task("next", { estimate: 12 }),
  ];
  const undone = plan(tasks(null));
  const done = plan(tasks("2026-09-25"));
  assert.deepEqual(ids(undone, OCT), ["sep-1", "sep-2"]);
  assert.deepEqual(parts(undone, "next"), [[NOV, 12]]);
  assert.deepEqual(parts(done, "next"), [[OCT, 12]]);
  assert.ok(undone.end !== null && done.end !== null && undone.end > done.end);
});

test("no rhythm gives noRhythm and every unfixed task unplaced", () => {
  const roadmap = plan(
    [task("a", { estimate: 3 }), task("fixed", { estimate: 2, plannedMonth: NOV }), task("b")],
    { rhythm: null, budgets: [{ month: OCT, amount: 12 }] },
  );
  assert.equal(roadmap.state, "noRhythm");
  assert.deepEqual(
    roadmap.unplaced.map((item) => item.task.id),
    ["a", "b"],
  );
  assert.deepEqual(parts(roadmap, "a"), []);
  assert.deepEqual(parts(roadmap, "fixed"), [[NOV, 2]]);
  assert.equal(roadmap.end, null);
});

test("rhythm 0 terminates, everything unfixed unplaced and the end null", () => {
  const roadmap = plan([task("a", { estimate: 3 }), task("b", { estimate: 1 })], { rhythm: 0 });
  assert.equal(roadmap.state, "planned");
  assert.deepEqual(
    roadmap.unplaced.map((item) => item.task.id),
    ["a", "b"],
  );
  assert.equal(roadmap.end, null);
});

test("a task left over 120 months past the current one is unplaced whole", () => {
  const roadmap = plan([task("huge", { estimate: 12 * 122 })]);
  assert.deepEqual(parts(roadmap, "huge"), []);
  assert.deepEqual(
    roadmap.unplaced.map((item) => [item.task.id, item.hours]),
    [["huge", 12 * 122]],
  );
});

test("a task created after today is absent", () => {
  const roadmap = plan([task("later", { estimate: 3, createdOn: "2026-10-16" }), task("a", { estimate: 1 })]);
  assert.deepEqual(parts(roadmap, "later"), []);
  assert.deepEqual(roadmap.unplaced, []);
  assert.deepEqual(ids(roadmap, OCT), ["a"]);
});

test("doneBy earlier than a done day reads the task undone", () => {
  const tasks = [task("a", { estimate: 3, doneOn: "2026-10-10" })];
  assert.equal(partIn(plan(tasks), OCT, "a").done, true);
  const before = partIn(plan(tasks, { doneBy: "2026-10-09" }), OCT, "a");
  assert.equal(before.done, false);
  assert.equal(before.hours, 3);
});

test("a dated goal one-off sits in its day's month and never in the flow", () => {
  const roadmap = plan([
    task("a", { estimate: 12 }),
    task("dated", { inPlan: false, day: "2026-12-04", estimate: 5 }),
    task("b", { estimate: 12 }),
  ]);
  assert.deepEqual(parts(roadmap, "dated"), [[DEC, 5]]);
  assert.equal(partIn(roadmap, DEC, "dated").fixed, true);
  assert.deepEqual(parts(roadmap, "b"), [[NOV, 12]]);
});

test("a goal suelta is no item", () => {
  const roadmap = plan([task("suelta", { inPlan: false, estimate: 4 }), task("a", { estimate: 1 })], {
    rhythm: null,
  });
  assert.deepEqual(roadmap.unplaced.map((item) => item.task.id), ["a"]);
  assert.deepEqual(parts(roadmap, "suelta"), []);
});

test("an item ends on ceil(daysIn × filled / amount) of its last month", () => {
  // 8 of 12 in a 31-day month: ceil(248 / 12) = 21.
  const roadmap = plan([task("a", { estimate: 8 })]);
  assert.equal(partIn(roadmap, OCT, "a").endsOn, "2026-10-21");
  assert.equal(roadmap.end, "2026-10-21");
  // 18 hours: the second part is 6 of 12 in a 30-day November.
  const split = plan([task("b", { estimate: 18 })]);
  assert.equal(partIn(split, NOV, "b").endsOn, "2026-11-15");
  assert.equal(split.end, "2026-11-15");
});

test("an item ending after the goal's last day is pastEnd", () => {
  const roadmap = plan([task("a", { estimate: 12 }), task("b", { estimate: 12 })], {
    horizon: "2026-11-01",
  });
  assert.equal(roadmap.lastDay, "2026-10-31");
  assert.equal(partIn(roadmap, OCT, "a").pastEnd, false);
  assert.equal(partIn(roadmap, NOV, "b").pastEnd, true);
});

test("nothing undone reads empty with no end", () => {
  const roadmap = plan([task("a", { estimate: 3, doneOn: "2026-10-02" })]);
  assert.equal(roadmap.state, "empty");
  assert.equal(roadmap.end, null);
});

test("a task fixed to the current month is not carried; one fixed to the month before is", () => {
  const roadmap = plan([
    task("now", { estimate: 3, plannedMonth: OCT }),
    task("past", { estimate: 3, plannedMonth: SEP }),
  ]);
  assert.equal(partIn(roadmap, OCT, "now").carriedFrom, null);
  assert.equal(partIn(roadmap, OCT, "past").carriedFrom, SEP);
});

test("a task fixed to a month is present whenever it was created; an unfixed one is not", () => {
  const roadmap = plan([
    task("fixed", { estimate: 3, plannedMonth: OCT, createdOn: "2026-10-16" }),
    task("child-parent", { plannedMonth: NOV, createdOn: "2026-10-16" }),
    task("child", { parentId: "child-parent", estimate: 2, createdOn: "2026-10-16" }),
    task("loose", { estimate: 3, createdOn: "2026-10-16" }),
  ]);
  assert.deepEqual(parts(roadmap, "fixed"), [[OCT, 3]]);
  assert.deepEqual(parts(roadmap, "child-parent"), [[NOV, 2]]);
  assert.deepEqual(parts(roadmap, "loose"), []);
});

test("a task fixed to September and done in October lists in October, done, carried from September, and takes its room", () => {
  const roadmap = plan([
    task("late", { estimate: 5, plannedMonth: SEP, doneOn: "2026-10-05" }),
    task("a", { estimate: 10 }),
  ]);
  const late = partIn(roadmap, OCT, "late");
  assert.equal(late.done, true);
  assert.equal(late.carriedFrom, SEP);
  assert.equal(late.fixed, true);
  assert.deepEqual(parts(roadmap, "a"), [
    [OCT, 7],
    [NOV, 3],
  ]);
});

test("a task done in its own fixed month, or before it, stays in that month, carried from none", () => {
  const roadmap = plan([
    task("own", { estimate: 3, plannedMonth: OCT, doneOn: "2026-10-05" }),
    task("early", { estimate: 2, plannedMonth: NOV, doneOn: "2026-10-06" }),
  ]);
  assert.equal(partIn(roadmap, OCT, "own").carriedFrom, null);
  assert.equal(partIn(roadmap, NOV, "early").carriedFrom, null);
  assert.equal(roadmap.months.find((m) => m.month === OCT)?.items.some((i) => i.task.id === "early"), false);
});

test("with no rhythm every task fixed to a month reads in the month it had", () => {
  const roadmap = plan(
    [
      task("past", { estimate: 3, plannedMonth: SEP }),
      task("now", { estimate: 2, plannedMonth: OCT }),
      task("doneNow", { estimate: 1, plannedMonth: OCT, doneOn: "2026-10-05" }),
      task("future", { estimate: 4, plannedMonth: DEC }),
      task("donePast", { estimate: 1, plannedMonth: SEP, doneOn: "2026-09-10" }),
    ],
    { rhythm: null },
  );
  assert.deepEqual(roadmap.unplaced, []);
  assert.deepEqual(ids(roadmap, OCT).sort(), ["doneNow", "now", "past"]);
  assert.deepEqual(ids(roadmap, DEC), ["future"]);
  assert.equal(partIn(roadmap, OCT, "past").carriedFrom, SEP);
  assert.equal(partIn(roadmap, OCT, "now").carriedFrom, null);
  assert.equal(partIn(roadmap, OCT, "doneNow").done, true);
  assert.equal(partIn(roadmap, DEC, "future").fixed, true);
});
