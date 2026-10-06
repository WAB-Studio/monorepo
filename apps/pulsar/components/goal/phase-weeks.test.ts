import assert from "node:assert/strict";
import test from "node:test";

import { defaultPhaseWeeks, horizonWeeks, weekIndex, weeksToPhaseSpan } from "./phase-weeks";

// RP-15: week 1 opens exactly on the goal's own opening day; later weeks on a Monday.
test("weeksToPhaseSpan: week 1 starts on the goal's own opening day", () => {
  const span = weeksToPhaseSpan("2026-01-15", 1, 4);
  assert.equal(span.startsOn, "2026-01-15");
});

// 2026-01-15 is a Thursday: week 4 ends on Sunday 2026-02-08, across a month boundary.
test("weeksToPhaseSpan: a span's end is a Sunday and crosses a month boundary", () => {
  const span = weeksToPhaseSpan("2026-01-15", 1, 4);
  assert.equal(span.endsOn, "2026-02-08");
});

// A later span starts the day after the previous one's own end — no gap,
// no shared day, the way a prefilled second phase must sit against a first.
test("weeksToPhaseSpan: a phase starting the week after another has no shared day", () => {
  const first = weeksToPhaseSpan("2026-01-15", 1, 4);
  const second = weeksToPhaseSpan("2026-01-15", 5, 8);
  assert.equal(second.startsOn, "2026-02-09");
  assert.notEqual(second.startsOn, first.endsOn);
});

// Round-trip through `weekIndex`, at both ends of the same week: the first
// and the last day of week N must both read back as week N.
test("weeksToPhaseSpan and weekIndex agree at both ends of a span", () => {
  const openedOn = "2026-01-15";
  const span = weeksToPhaseSpan(openedOn, 3, 3);
  assert.equal(weekIndex(openedOn, span.startsOn), 3);
  assert.equal(weekIndex(openedOn, span.endsOn), 3);
});

// A horizon set in exact weeks (`NewGoalForm`) reads back as that same whole
// number, never a fraction.
test("horizonWeeks reads back the exact number of weeks a horizon was set in", () => {
  const openedOn = "2026-01-15";
  const horizon = "2026-04-09"; // openedOn + 12 * 7 days, whatever its weekday
  assert.equal(horizonWeeks(openedOn, horizon), 12);
});

// RP-15: the page's default span passes the form's own checks.
test("defaultPhaseWeeks: a last phase ending in the partial last week leaves no room", () => {
  const openedOn = "2026-01-15";
  const horizon = "2026-02-20"; // a Friday: week 6 is partial
  const last = weeksToPhaseSpan(openedOn, 1, 5);
  assert.equal(defaultPhaseWeeks({ openedOn, horizon, phases: [last] }), null);
});

test("defaultPhaseWeeks: weeks 1-4 taken, 35 full weeks yields 5-8", () => {
  const openedOn = "2026-01-15";
  const horizon = "2026-09-24"; // openedOn + 36 * 7 days
  const phases = [weeksToPhaseSpan(openedOn, 1, 4)];
  assert.equal(horizonWeeks(openedOn, horizon), 36);
  assert.deepEqual(defaultPhaseWeeks({ openedOn, horizon, phases }), { from: 5, to: 8 });
});

test("defaultPhaseWeeks: 6 full weeks left yields a 4-week span, never past the horizon", () => {
  const openedOn = "2026-01-15";
  const horizon = "2026-04-09"; // 12 weeks
  const phases = [weeksToPhaseSpan(openedOn, 1, 6)];
  assert.deepEqual(defaultPhaseWeeks({ openedOn, horizon, phases }), { from: 7, to: 10 });
  const tight = [weeksToPhaseSpan(openedOn, 1, 10)];
  assert.deepEqual(defaultPhaseWeeks({ openedOn, horizon, phases: tight }), { from: 11, to: 12 });
});

test("defaultPhaseWeeks: no phase opens on week 1", () => {
  assert.deepEqual(
    defaultPhaseWeeks({ openedOn: "2026-01-15", horizon: "2026-04-09", phases: [] }),
    { from: 1, to: 4 },
  );
});

test("defaultPhaseWeeks: starts after the latest phase, whatever order the phases come in", () => {
  const openedOn = "2026-01-15";
  const horizon = "2026-09-24";
  const early = weeksToPhaseSpan(openedOn, 1, 4);
  const late = weeksToPhaseSpan(openedOn, 9, 12);
  const middle = weeksToPhaseSpan(openedOn, 5, 8);
  for (const phases of [[early, middle, late], [late, early, middle], [middle, late, early]]) {
    assert.deepEqual(defaultPhaseWeeks({ openedOn, horizon, phases }), { from: 13, to: 16 });
  }
});
