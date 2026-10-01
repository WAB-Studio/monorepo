import assert from "node:assert/strict";
import test from "node:test";

import type { DeclaredFact, EvidenceDay } from "@/lib/day/types";
import {
  monthLine,
  monthOf,
  monthRows,
  monthsOfSpan,
  reachedByMonth,
  toDate,
} from "./months";

function fact(day: string, quantity: number, unit: string): DeclaredFact {
  return { commitmentId: "c", day, writtenAt: `${day}T12:00:00Z`, quantity, unit, note: null };
}

function evidenceDay(day: string, quantity: number, unit: string): EvidenceDay {
  return { day, quantity, unit, labelKey: "sources.readingLookups" };
}

const OCT = "2026-10-01";
const budget = { month: OCT, amount: 720 };

test("monthOf: any day reads as the first of its month", () => {
  assert.equal(monthOf("2026-10-31"), "2026-10-01");
  assert.equal(monthOf("2026-11-01"), "2026-11-01");
});

test("monthsOfSpan: a span opened on the 31st of January lists February", () => {
  assert.deepEqual(monthsOfSpan("2026-01-31", "2026-03-01"), ["2026-01-01", "2026-02-01"]);
});

test("monthsOfSpan: ends at the month of the horizon's day before, not the horizon's own", () => {
  assert.deepEqual(monthsOfSpan("2026-09-29", "2026-11-01"), ["2026-09-01", "2026-10-01"]);
  assert.deepEqual(monthsOfSpan("2026-09-29", "2026-11-02"), [
    "2026-09-01",
    "2026-10-01",
    "2026-11-01",
  ]);
});

test("monthsOfSpan: crosses a year", () => {
  assert.deepEqual(monthsOfSpan("2026-12-15", "2027-02-10"), [
    "2026-12-01",
    "2027-01-01",
    "2027-02-01",
  ]);
});

test("reachedByMonth: the 31st of a 31-day month and the 1st of the next fall in two months", () => {
  const reached = reachedByMonth({
    unit: "min",
    facts: [fact("2026-10-31", 10, "min"), fact("2026-11-01", 7, "min")],
    evidence: [],
  });
  assert.equal(reached.get("2026-10-01"), 10);
  assert.equal(reached.get("2026-11-01"), 7);
});

test("reachedByMonth: a fact in min does not feed a goal in minutos", () => {
  const reached = reachedByMonth({
    unit: "minutos",
    facts: [fact("2026-10-05", 10, "min"), fact("2026-10-06", 4, "minutos")],
    evidence: [evidenceDay("2026-10-07", 100, "min"), evidenceDay("2026-10-08", 3, "minutos")],
  });
  assert.equal(reached.get(OCT), 7);
});

test("reachedByMonth: facts and evidence add up; a null unit reads empty", () => {
  const facts = [fact("2026-10-05", 10, "min")];
  const evidence = [evidenceDay("2026-10-06", 5, "min")];
  assert.equal(reachedByMonth({ unit: "min", facts, evidence }).get(OCT), 15);
  assert.equal(reachedByMonth({ unit: null, facts, evidence }).size, 0);
});

test("monthLine: 431 of 720 on the 20th is under pace, 432 is not", () => {
  const line = (reached: number) =>
    monthLine({ month: OCT, today: "2026-10-20", budget, reached });
  assert.equal(line(431).underPace, true);
  assert.equal(line(432).underPace, false);
  assert.equal(line(431).planned, 720);
});

test("monthLine: the 19th is never under pace", () => {
  assert.equal(monthLine({ month: OCT, today: "2026-10-19", budget, reached: 0 }).underPace, false);
});

test("monthLine: a past or future month is never under pace", () => {
  assert.equal(
    monthLine({ month: "2026-09-01", today: "2026-10-25", budget: { month: "2026-09-01", amount: 720 }, reached: 0 }).underPace,
    false,
  );
  assert.equal(
    monthLine({ month: "2026-11-01", today: "2026-10-25", budget: { month: "2026-11-01", amount: 720 }, reached: 0 }).underPace,
    false,
  );
});

test("monthLine: a zero amount or no amount is never under pace", () => {
  const today = "2026-10-25";
  const zero = monthLine({ month: OCT, today, budget: { month: OCT, amount: 0 }, reached: 0 });
  assert.equal(zero.underPace, false);
  assert.equal(zero.planned, 0);
  const none = monthLine({ month: OCT, today, budget: null, reached: 0 });
  assert.equal(none.underPace, false);
  assert.equal(none.planned, null);
});

test("monthRows: one row per month of the span, a month with nothing included, flags set", () => {
  const rows = monthRows({
    openedOn: "2026-09-10",
    horizon: "2026-12-01",
    today: "2026-10-22",
    budgets: [{ month: OCT, amount: 720 }],
    reached: new Map([["2026-09-01", 50]]),
  });
  assert.deepEqual(rows, [
    { month: "2026-09-01", planned: null, reached: 50, current: false, past: true },
    { month: OCT, planned: 720, reached: 0, current: true, past: false },
    { month: "2026-11-01", planned: null, reached: 0, current: false, past: false },
  ]);
});

test("toDate: sums through the current month, a month without amount adds 0 planned", () => {
  const rows = monthRows({
    openedOn: "2026-09-10",
    horizon: "2026-12-01",
    today: "2026-10-22",
    budgets: [{ month: OCT, amount: 720 }],
    reached: new Map([
      ["2026-09-01", 50],
      [OCT, 100],
      ["2026-11-01", 999],
    ]),
  });
  assert.deepEqual(toDate(rows), { planned: 720, reached: 150 });
});
