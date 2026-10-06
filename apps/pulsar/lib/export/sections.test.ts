import assert from "node:assert/strict";
import test from "node:test";

import type { GoalReport } from "./report";
import { goalSections } from "./sections";

function goal(patch: Partial<GoalReport> = {}): GoalReport {
  return {
    id: "g",
    name: "Applied AI Engineer",
    horizon: "2027-10-01",
    endedOn: null,
    unit: "horas",
    thisMonth: { planned: 44, reached: 20, underPace: false },
    tasks: [],
    toDate: { planned: 44, reached: 20 },
    phases: [{ aim: "Fundamentos", startsOn: "2026-10-01", endsOn: "2026-12-31", current: true }],
    carried: [{ name: "Tutor", note: null, from: "2026-10-01", owes: 12, hasAmount: true, children: [{ name: "Sesiones", note: null, owes: 6, hasAmount: true }] }],
    months: [{ month: "2026-10-01", planned: 44, reached: 20, current: true, past: false, carried: null }],
    weeks: [],
    ...patch,
  };
}

test("goalSections: a goal with a unit, phases and a carried task prints all six, in order", () => {
  assert.deepEqual(goalSections(goal()), ["month", "toDate", "phases", "carried", "months", "weeks"]);
});

test("goalSections: a goal with no unit prints only phases and carried", () => {
  assert.deepEqual(goalSections(goal({ unit: null })), ["phases", "carried"]);
  assert.deepEqual(goalSections(goal({ unit: null, phases: [], carried: [] })), []);
});

test("goalSections: an empty carried drops its section, an empty phases drops its own", () => {
  assert.deepEqual(goalSections(goal({ carried: [] })), ["month", "toDate", "phases", "months", "weeks"]);
  assert.deepEqual(goalSections(goal({ phases: [] })), ["month", "toDate", "carried", "months", "weeks"]);
});

test("goalSections: month stays with a unit when this month has no amount", () => {
  const sections = goalSections(goal({ thisMonth: { planned: null, reached: 3, underPace: false } }));
  assert.equal(sections[0], "month");
});
