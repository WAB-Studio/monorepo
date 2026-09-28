import assert from "node:assert/strict";
import test from "node:test";

import { civilDateToDate } from "@/lib/zone";

import { goalWeekProgress } from "@/components/week/week-progress";

import { horizonForWeeks, horizonWeeksOf, weekIndexOf, weekSpan } from "./weeks";

// One goal opened on each weekday that matters: its first Sunday and the
// Monday after it differ in every case.
const CASES = [
  { name: "Monday", openedOn: "2026-09-28", firstSunday: "2026-10-04", nextMonday: "2026-10-05" },
  { name: "Wednesday", openedOn: "2026-09-30", firstSunday: "2026-10-04", nextMonday: "2026-10-05" },
  { name: "Sunday", openedOn: "2026-10-04", firstSunday: "2026-10-04", nextMonday: "2026-10-05" },
];

function plusDays(day: string, days: number): string {
  const date = civilDateToDate(day);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

for (const { name, openedOn, firstSunday, nextMonday } of CASES) {
  test(`weekIndexOf: a goal opened on a ${name} ends week 1 on the first Sunday and opens week 2 the next Monday`, () => {
    assert.equal(weekIndexOf(openedOn, openedOn), 1);
    assert.equal(weekIndexOf(openedOn, firstSunday), 1);
    assert.equal(weekIndexOf(openedOn, nextMonday), 2);
    assert.equal(weekIndexOf(openedOn, plusDays(nextMonday, 7)), 3);
  });

  test(`weekSpan: week 1 of a goal opened on a ${name} runs from the opening day to the first Sunday`, () => {
    assert.deepEqual(weekSpan(openedOn, 1, 1), { startsOn: openedOn, endsOn: firstSunday });
    assert.deepEqual(weekSpan(openedOn, 2, 2), { startsOn: nextMonday, endsOn: plusDays(nextMonday, 6) });
    assert.deepEqual(weekSpan(openedOn, 1, 2), { startsOn: openedOn, endsOn: plusDays(nextMonday, 6) });
  });

  test(`horizon: a goal opened on a ${name} reads 12 weeks back from horizonForWeeks and from opening + 84 days`, () => {
    assert.equal(horizonWeeksOf(openedOn, horizonForWeeks(openedOn, 12)), 12);
    assert.equal(horizonWeeksOf(openedOn, plusDays(openedOn, 84)), 12);
    // The horizon is the first day after the goal: a Monday, after week 12's Sunday.
    assert.equal(plusDays(horizonForWeeks(openedOn, 12), -1), weekSpan(openedOn, 12, 12).endsOn);
  });

  test(`goalWeekProgress: the week holding the opening day of a goal opened on a ${name} reads week 1`, () => {
    const createdAt = `${openedOn}T15:00:00Z`;
    const horizon = horizonForWeeks(openedOn, 12);
    assert.deepEqual(goalWeekProgress({ horizon, createdAt }, weekSpan(openedOn, 1, 1).startsOn), {
      week: 1,
      total: 12,
    });
    assert.deepEqual(goalWeekProgress({ horizon, createdAt }, nextMonday), { week: 2, total: 12 });
  });
}

test("horizonWeeksOf: a horizon on or before the opening reads 0, never negative", () => {
  assert.equal(horizonWeeksOf("2026-09-30", "2026-09-30"), 0);
  assert.equal(horizonWeeksOf("2026-09-30", "2026-08-01"), 0);
});
