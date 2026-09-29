import assert from "node:assert/strict";
import test from "node:test";

import { tallyDays } from "./tally";
import type { DayView, WeekView } from "./types";

// 2026-09-28 is a Monday.
const DAYS = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];

function dayView(day: string, slots: [string, boolean][]): DayView {
  return {
    day,
    phase: null,
    slots: slots.map(([commitmentId, satisfied]) => ({
      commitmentId,
      satisfied,
      satisfiedBy: satisfied ? "declared" : null,
      labelKey: null,
      quantity: null,
    })),
  };
}

function week(slotsOf: (day: string) => [string, boolean][]): WeekView {
  return { start: DAYS[0], days: DAYS.map((d) => dayView(d, slotsOf(d))) };
}

test("tallyDays: a goal ending mid-week counts the days before its horizon only", () => {
  const view = week(() => [["c1", true]]);
  const tally = tallyDays({
    view,
    goals: [{ id: "g1", horizon: "2026-10-01", createdAt: "2026-09-01T12:00:00Z" }],
    commitments: [{ id: "c1", goalId: "g1" }],
    oneOffFacts: [],
  });
  assert.deepEqual(
    tally.map((t) => t.total),
    [1, 1, 1, 0, 0, 0, 0],
  );
  assert.deepEqual(
    tally.map((t) => t.done),
    [1, 1, 1, 0, 0, 0, 0],
  );
});

test("tallyDays: a goal opening mid-week counts from its opening day", () => {
  const view = week(() => [["c1", false]]);
  const tally = tallyDays({
    view,
    goals: [{ id: "g1", horizon: "2027-01-01", createdAt: "2026-10-01T15:00:00Z" }],
    commitments: [{ id: "c1", goalId: "g1" }],
    oneOffFacts: [],
  });
  assert.deepEqual(
    tally.map((t) => t.total),
    [0, 0, 0, 1, 1, 1, 1],
  );
  assert.equal(tally[3].done, 0);
});

test("tallyDays: a one-off fact of no goal counts, one of an ended goal does not, an unknown goal counts nowhere", () => {
  const view = week(() => []);
  const tally = tallyDays({
    view,
    goals: [{ id: "g1", horizon: "2026-09-30", createdAt: "2026-09-01T12:00:00Z" }],
    commitments: [],
    oneOffFacts: [
      { day: "2026-09-29", goalId: null },
      { day: "2026-09-29", goalId: "g1" },
      { day: "2026-09-30", goalId: "g1" },
      { day: "2026-09-30", goalId: "archived" },
    ],
  });
  assert.deepEqual(tally[1], { day: "2026-09-29", done: 2, total: 2 });
  assert.deepEqual(tally[2], { day: "2026-09-30", done: 0, total: 0 });
});
