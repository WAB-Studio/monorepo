import assert from "node:assert/strict";
import test from "node:test";

import { horizonWeeks, weekIndex, weeksToPhaseSpan } from "./phase-weeks";

// RP-15: week 1 opens exactly on the goal's own opening day.
test("weeksToPhaseSpan: week 1 starts on the goal's own opening day", () => {
  const span = weeksToPhaseSpan("2026-01-15", 1, 4);
  assert.equal(span.startsOn, "2026-01-15");
});

// The last day of a span crosses a month boundary: 2026-01-15 + 27 days.
test("weeksToPhaseSpan: a span's end crosses a month boundary", () => {
  const span = weeksToPhaseSpan("2026-01-15", 1, 4);
  assert.equal(span.endsOn, "2026-02-11");
});

// A later span starts the day after the previous one's own end — no gap,
// no shared day, the way a prefilled second phase must sit against a first.
test("weeksToPhaseSpan: a phase starting the week after another has no shared day", () => {
  const first = weeksToPhaseSpan("2026-01-15", 1, 4);
  const second = weeksToPhaseSpan("2026-01-15", 5, 8);
  assert.equal(second.startsOn, "2026-02-12");
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
  const horizon = "2026-04-09"; // openedOn + 12 * 7 days
  assert.equal(horizonWeeks(openedOn, horizon), 12);
});
