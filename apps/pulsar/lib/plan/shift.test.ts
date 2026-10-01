import assert from "node:assert/strict";
import test from "node:test";

import type { Task } from "./carry";
import { addMonths, shiftOffered, shiftPlan, type ShiftPhase } from "./shift";

const OCT = "2026-10-01";
const NOV = "2026-11-01";
const HORIZON = "2027-10-01";

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    parentId: null,
    name: id,
    plannedMonth: NOV,
    day: null,
    estimate: null,
    doneOn: null,
    ...patch,
  };
}

// November through September, one amount each.
const budgets = [
  "2026-11-01", "2026-12-01", "2027-01-01", "2027-02-01", "2027-03-01", "2027-04-01",
  "2027-05-01", "2027-06-01", "2027-07-01", "2027-08-01", "2027-09-01",
].map((month, i) => ({ month, amount: 40 + i }));

const phases: ShiftPhase[] = [
  { id: "begun", aim: "Fundamentos", startsOn: "2026-10-01", endsOn: "2026-12-31" },
  { id: "next", aim: "Proyecto", startsOn: "2027-01-01", endsOn: "2027-03-31" },
];

function plan(patch: Partial<Parameters<typeof shiftPlan>[0]> = {}) {
  return shiftPlan({
    closedMonth: OCT,
    today: "2026-11-05",
    horizon: HORIZON,
    budgets,
    phases,
    tasks: [],
    ...patch,
  });
}

test("addMonths: calendar months, clamped to the last day of the target month", () => {
  assert.equal(addMonths("2027-01-31", 1), "2027-02-28");
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonths("2026-12-15", 1), "2027-01-15");
  assert.equal(addMonths("2026-10-01", 12), "2027-10-01");
  assert.equal(addMonths("2026-01-31", -2), "2025-11-30");
});

test("shiftOffered: October with 44 planned and 23 carried is offered on 5 November, not on 5 December", () => {
  const share = { carried: 23, planned: 44 };
  assert.equal(shiftOffered({ month: OCT, today: "2026-11-05", share, shifted: [] }), true);
  assert.equal(shiftOffered({ month: OCT, today: "2026-12-05", share, shifted: [] }), false);
  assert.equal(shiftOffered({ month: OCT, today: "2026-10-31", share, shifted: [] }), false);
});

test("shiftOffered: exactly half does not offer (22 * 2 = 44), nor does nothing planned", () => {
  const today = "2026-11-05";
  assert.equal(shiftOffered({ month: OCT, today, share: { carried: 22, planned: 44 }, shifted: [] }), false);
  assert.equal(shiftOffered({ month: OCT, today, share: null, shifted: [] }), false);
});

test("shiftOffered: a month already shifted is not offered again", () => {
  const share = { carried: 30, planned: 44 };
  assert.equal(shiftOffered({ month: OCT, today: "2026-11-05", share, shifted: [OCT] }), false);
  assert.equal(shiftOffered({ month: OCT, today: "2026-11-05", share, shifted: ["2026-09-01"] }), true);
});

test("shiftPlan: November through September's amounts move to December through October", () => {
  const moved = plan().budgets;
  assert.equal(moved.length, 11);
  assert.deepEqual(moved[0], { month: NOV, to: "2026-12-01", amount: 40 });
  assert.deepEqual(moved[10], { month: "2027-09-01", to: "2027-10-01", amount: 50 });
  assert.equal(plan().emptied, NOV);
});

test("shiftPlan: the closed month's own amount stays", () => {
  const moved = plan({ budgets: [{ month: OCT, amount: 44 }, ...budgets] }).budgets;
  assert.equal(moved.some((b) => b.month === OCT), false);
  assert.equal(moved.length, 11);
});

test("shiftPlan: an undone November task moves a month, the done one and the closed month's do not", () => {
  const tasks = [
    task("undone"),
    task("done", { doneOn: "2026-11-02" }),
    task("closed", { plannedMonth: OCT }),
    task("later", { plannedMonth: "2027-02-01" }),
    task("dated", { day: "2026-11-20" }),
    task("lived", { day: "2026-11-03" }),
  ];
  const moved = plan({ tasks }).tasks;
  assert.deepEqual(moved.map((t) => t.id), ["undone", "later", "dated"]);
  assert.deepEqual(moved[0], { id: "undone", name: "undone", from: NOV, to: "2026-12-01" });
});

test("shiftPlan: a task dated today has begun and stays", () => {
  const tasks = [task("today", { day: "2026-11-05" }), task("tomorrow", { day: "2026-11-06" })];
  assert.deepEqual(plan({ tasks }).tasks.map((t) => t.id), ["tomorrow"]);
});

test("shiftPlan: a sub-task follows its parent and is never listed; a parent with every child done stays", () => {
  const tasks = [
    task("open"),
    task("a", { parentId: "open", doneOn: "2026-11-02" }),
    task("b", { parentId: "open" }),
    task("whole"),
    task("c", { parentId: "whole", doneOn: "2026-11-02" }),
  ];
  assert.deepEqual(plan({ tasks }).tasks.map((t) => t.id), ["open"]);
});

test("shiftPlan: a phase starting 1 January moves to 1 February, one begun 1 October does not move", () => {
  const moved = plan().phases;
  assert.deepEqual(moved, [
    { ...phases[1], toStartsOn: "2027-02-01", toEndsOn: "2027-04-30" },
  ]);
});

test("shiftPlan: a phase starting today has begun and stays", () => {
  const moved = plan({ phases: [{ id: "x", aim: "x", startsOn: "2026-11-05", endsOn: "2026-12-31" }] }).phases;
  assert.equal(moved.length, 0);
});

test("shiftPlan: the horizon moves a month because September's amount would pass it", () => {
  assert.deepEqual(plan().horizon, { from: HORIZON, to: "2027-11-01" });
});

test("shiftPlan: the horizon stays null when nothing passes it", () => {
  const short = budgets.slice(0, 3);
  assert.equal(plan({ budgets: short, phases: [] }).horizon, null);
});

test("shiftPlan: a moved phase ending past the horizon pulls it to that day", () => {
  const late = [{ id: "z", aim: "z", startsOn: "2027-08-01", endsOn: "2027-10-01" }];
  assert.deepEqual(plan({ budgets: [], phases: late }).horizon, { from: HORIZON, to: "2027-11-01" });
});

test("shiftPlan: a moved task alone pulls the horizon past its new month", () => {
  const tasks = [task("last", { plannedMonth: "2027-09-01" })];
  assert.deepEqual(plan({ budgets: [], phases: [], tasks }).horizon, { from: HORIZON, to: "2027-11-01" });
});
