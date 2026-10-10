import assert from "node:assert/strict";
import test from "node:test";

import type { GoalReport } from "./report";
import { civilSpan, goalSections, monthsWithWeeks, printsOnPaper } from "./sections";

function goal(patch: Partial<GoalReport> = {}): GoalReport {
  return {
    id: "g",
    name: "Applied AI Engineer",
    horizon: "2027-10-01",
    endedOn: null,
    unit: "horas",
    measureName: null,
    measureFed: false,
    thisMonth: { planned: 44, reached: 20, underPace: false },
    tasks: [
      { name: "Tutor", from: "2026-09-01", done: false, doneOn: null, estimate: null, part: null, continuesIn: null, owes: 12, hasAmount: true, note: null, children: [] },
    ],
    toDate: { planned: 44, reached: 20 },
    phases: [{ aim: "Fundamentos", startsOn: "2026-10-01", endsOn: "2026-12-31", current: true }],
    carried: [],
    months: [{ month: "2026-10-01", planned: 44, reached: 20, current: true, past: false, carried: null }],
    weeks: [],
    weekSplits: [],
    ...patch,
  };
}

test("RP-49 goalSections: a goal with a unit, phases and tasks prints five sections, in order, and never weeks", () => {
  const sections = goalSections(goal());
  assert.deepEqual(sections, ["month", "toDate", "phases", "tasks", "months"]);
  assert.equal((sections as string[]).includes("weeks"), false);
  assert.equal((sections as string[]).includes("carried"), false);
});

test("RP-49 goalSections: tasks is present only with tasks", () => {
  assert.deepEqual(goalSections(goal({ tasks: [] })), ["month", "toDate", "phases", "months"]);
});

test("RP-49 goalSections: a goal with no unit prints only phases and tasks", () => {
  assert.deepEqual(goalSections(goal({ unit: null })), ["phases", "tasks"]);
  assert.deepEqual(goalSections(goal({ unit: null, phases: [], tasks: [] })), []);
});

test("RP-49 goalSections: month stays with a unit when this month has no amount", () => {
  const sections = goalSections(goal({ thisMonth: { planned: null, reached: 3, underPace: false } }));
  assert.equal(sections[0], "month");
});

const week = (index: number, startsOn: string, endsOn: string, total = 0) => ({
  index,
  startsOn,
  endsOn,
  total,
  phaseName: null,
  current: false,
});
const month = (day: string) => ({ month: day, planned: null, reached: 0, current: false, past: true, carried: null });

test("RP-49 monthsWithWeeks: a week inside one month sits under it whole", () => {
  const grouped = monthsWithWeeks(
    goal({
      months: [month("2026-09-01"), month("2026-10-01")],
      weeks: [week(1, "2026-09-07", "2026-09-13", 5), week(2, "2026-10-05", "2026-10-11", 7)],
    }),
  );
  assert.deepEqual(grouped[0].weeks.map((w) => [w.index, w.total]), [[1, 5]]);
  assert.deepEqual(grouped[1].weeks.map((w) => [w.index, w.total]), [[2, 7]]);
});

test("RP-49 monthsWithWeeks: a week 28 sep-4 oct sits under both months with its own span and share", () => {
  const grouped = monthsWithWeeks(
    goal({
      months: [month("2026-09-01"), month("2026-10-01")],
      weeks: [week(4, "2026-09-21", "2026-09-27", 3), week(5, "2026-09-28", "2026-10-04", 10)],
      weekSplits: [
        { index: 5, month: "2026-09-01", startsOn: "2026-09-28", endsOn: "2026-09-30", total: 6 },
        { index: 5, month: "2026-10-01", startsOn: "2026-10-01", endsOn: "2026-10-04", total: 4 },
      ],
    }),
  );
  assert.deepEqual(
    grouped[0].weeks.map((w) => [w.index, w.startsOn, w.endsOn, w.total]),
    [[4, "2026-09-21", "2026-09-27", 3], [5, "2026-09-28", "2026-09-30", 6]],
  );
  assert.deepEqual(
    grouped[1].weeks.map((w) => [w.index, w.startsOn, w.endsOn, w.total]),
    [[5, "2026-10-01", "2026-10-04", 4]],
  );
});

test("RP-49 monthsWithWeeks: the weeks under a month add up to the month's reached", () => {
  const grouped = monthsWithWeeks(
    goal({
      months: [{ ...month("2026-09-01"), reached: 9 }, { ...month("2026-10-01"), reached: 4 }],
      weeks: [week(4, "2026-09-21", "2026-09-27", 3), week(5, "2026-09-28", "2026-10-04", 10)],
      weekSplits: [
        { index: 5, month: "2026-09-01", startsOn: "2026-09-28", endsOn: "2026-09-30", total: 6 },
        { index: 5, month: "2026-10-01", startsOn: "2026-10-01", endsOn: "2026-10-04", total: 4 },
      ],
    }),
  );
  for (const { month: m, weeks } of grouped) {
    assert.equal(weeks.reduce((sum, w) => sum + w.total, 0), m.reached);
  }
});

test("RP-49 civilSpan: every span carries its year, both ends across a year", () => {
  assert.equal(civilSpan("2026-08-31", "2026-09-06"), "31 ago–6 sep 2026");
  assert.equal(civilSpan("2026-08-31", "2026-08-31"), "31 ago 2026");
  assert.equal(civilSpan("2026-10-05", "2026-10-11"), "5–11 oct 2026");
  assert.equal(civilSpan("2026-12-28", "2027-01-03"), "28 dic 2026–3 ene 2027");
});

type MonthRow = GoalReport["months"][number];

function row(patch: Partial<MonthRow>): MonthRow {
  return { month: "2026-12-01", planned: null, reached: 0, current: false, past: false, carried: null, ...patch };
}

test("RP-70 printsOnPaper: a past month prints with no amount", () => {
  assert.equal(printsOnPaper(row({ past: true, planned: null, reached: 0 })), true);
});

test("RP-70 printsOnPaper: the current month prints with no amount", () => {
  assert.equal(printsOnPaper(row({ current: true, planned: null })), true);
});

test("RP-70 printsOnPaper: a future month with an amount prints", () => {
  assert.equal(printsOnPaper(row({ planned: 1200 })), true);
});

test("RP-70 printsOnPaper: a future month planned at 0 prints, zero is an amount", () => {
  assert.equal(printsOnPaper(row({ planned: 0 })), true);
});

test("RP-70 printsOnPaper: a future month with no amount does not print", () => {
  assert.equal(printsOnPaper(row({ past: false, current: false, planned: null })), false);
});
