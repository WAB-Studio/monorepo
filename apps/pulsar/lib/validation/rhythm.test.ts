import assert from "node:assert/strict";
import test from "node:test";

import roadmap from "../../messages/es/roadmap.json";
import { setRhythmSchema } from "./rhythm";

const goalId = "6f1c9a52-3c1e-4d0e-9a43-1d2f7b8e9c10";
const KEY = "roadmap.errors.rhythmRange";

// 31 days of 24 hours, in minutes: the most a month can hold.
const MONTH_MINUTES = 31 * 24 * 60;

test("setRhythmSchema: 1 minute to 744 hours a month is a rhythm, one past either end is not", () => {
  assert.equal(MONTH_MINUTES, 44_640);
  for (const amount of [1, 720, 44_639, 44_640]) {
    assert.equal(setRhythmSchema.safeParse({ goalId, amount }).success, true, `${amount} min`);
  }
  for (const amount of [0, -1, 44_641, 1_000_000]) {
    const parsed = setRhythmSchema.safeParse({ goalId, amount });
    assert.equal(parsed.success, false, `${amount} min`);
    if (!parsed.success) assert.equal(parsed.error.issues[0].message, KEY, `${amount} min`);
  }
});

test("setRhythmSchema: a half minute, text or nothing is the same refusal", () => {
  for (const amount of [1.5, Number.NaN, "720", null, undefined]) {
    const parsed = setRhythmSchema.safeParse({ goalId, amount });
    assert.equal(parsed.success, false, String(amount));
    if (!parsed.success) assert.equal(parsed.error.issues[0].message, KEY, String(amount));
  }
});

test("the rhythm's refusal says the range the schema holds, in hours", () => {
  assert.equal(roadmap.errors.rhythmRange, "El ritmo va de 1 min a 744 h al mes.");
});
