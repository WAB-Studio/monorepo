import assert from "node:assert/strict";
import test from "node:test";

import type { GoalReport } from "./report";
import { civilSpan, goalSections, monthsWithWeeks } from "./sections";

function goal(patch: Partial<GoalReport> = {}): GoalReport {
  return {
    id: "g",
    name: "Applied AI Engineer",
    horizon: "2027-10-01",
    endedOn: null,
    unit: "horas",
    thisMonth: { planned: 44, reached: 20, underPace: false },
    tasks: [
      { name: "Tutor", from: "2026-09-01", done: false, doneOn: null, estimate: null, owes: 12, hasAmount: true, note: null, children: [] },
    ],
    toDate: { planned: 44, reached: 20 },
    phases: [{ aim: "Fundamentos", startsOn: "2026-10-01", endsOn: "2026-12-31", current: true }],
    carried: [],
    months: [{ month: "2026-10-01", planned: 44, reached: 20, current: true, past: false, carried: null }],
    weeks: [],
    ...patch,
  };
}

test("RP-46 goalSections: a goal with a unit, phases and tasks prints five sections, in order, and never weeks", () => {
  const sections = goalSections(goal());
  assert.deepEqual(sections, ["month", "toDate", "phases", "tasks", "months"]);
  assert.equal((sections as string[]).includes("weeks"), false);
  assert.equal((sections as string[]).includes("carried"), false);
});

test("RP-46 goalSections: tasks is present only with tasks", () => {
  assert.deepEqual(goalSections(goal({ tasks: [] })), ["month", "toDate", "phases", "months"]);
});

test("RP-46 goalSections: a goal with no unit prints only phases and tasks", () => {
  assert.deepEqual(goalSections(goal({ unit: null })), ["phases", "tasks"]);
  assert.deepEqual(goalSections(goal({ unit: null, phases: [], tasks: [] })), []);
});

test("RP-46 goalSections: month stays with a unit when this month has no amount", () => {
  const sections = goalSections(goal({ thisMonth: { planned: null, reached: 3, underPace: false } }));
  assert.equal(sections[0], "month");
});

test("RP-46 monthsWithWeeks: a week sits under the month its startsOn falls in, even when it ends in the next", () => {
  const week = (index: number, startsOn: string, endsOn: string) => ({
    index,
    startsOn,
    endsOn,
    total: 0,
    phaseName: null,
    current: false,
  });
  const month = (day: string) => ({ month: day, planned: null, reached: 0, current: false, past: true, carried: null });
  const grouped = monthsWithWeeks(
    goal({
      months: [month("2026-08-01"), month("2026-09-01")],
      weeks: [week(1, "2026-08-31", "2026-09-06"), week(2, "2026-09-07", "2026-09-13")],
    }),
  );
  assert.deepEqual(grouped[0].weeks.map((w) => w.index), [1]);
  assert.deepEqual(grouped[1].weeks.map((w) => w.index), [2]);
});

test("RP-46 civilSpan: every span carries its year, both ends across a year", () => {
  assert.equal(civilSpan("2026-08-31", "2026-09-06"), "31 ago–6 sep 2026");
  assert.equal(civilSpan("2026-10-05", "2026-10-11"), "5–11 oct 2026");
  assert.equal(civilSpan("2026-12-28", "2027-01-03"), "28 dic 2026–3 ene 2027");
});
