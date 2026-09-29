import assert from "node:assert/strict";
import test from "node:test";

import { civilDateToDate, dateToCivilDate, todayInZone } from "@/lib/zone";

import { createOneOffSchema, scheduleOneOffSchema } from "./one-off";

// RP-19: an errand's day is today or later, never one already gone.
function yesterday() {
  const d = civilDateToDate(todayInZone());
  d.setUTCDate(d.getUTCDate() - 1);
  return dateToCivilDate(d);
}

test("createOneOffSchema: a name of 120 characters is taken, 121 is refused", () => {
  assert.equal(createOneOffSchema.safeParse({ name: "a".repeat(120), day: null }).success, true);
  const long = createOneOffSchema.safeParse({ name: "a".repeat(121), day: null });
  assert.equal(long.success, false);
  assert.equal(long.error?.issues[0]?.message, "day.errors.oneOffNameTooLong");
});

test("createOneOffSchema: today is taken, yesterday is refused as past", () => {
  const today = todayInZone();
  assert.equal(createOneOffSchema.safeParse({ name: "x", day: today }).success, true);
  const past = createOneOffSchema.safeParse({ name: "x", day: yesterday() });
  assert.equal(past.success, false);
  assert.equal(past.error?.issues[0]?.message, "day.errors.oneOffDayPast");
});

test("createOneOffSchema: no day at all is a one-off with no day yet", () => {
  assert.equal(createOneOffSchema.safeParse({ name: "x", day: null }).success, true);
});

test("scheduleOneOffSchema: a day is required, today taken, yesterday refused", () => {
  const id = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";
  assert.equal(scheduleOneOffSchema.safeParse({ oneOffId: id, day: todayInZone() }).success, true);
  assert.equal(scheduleOneOffSchema.safeParse({ oneOffId: id, day: yesterday() }).success, false);
  assert.equal(scheduleOneOffSchema.safeParse({ oneOffId: id, day: null }).success, false);
});
