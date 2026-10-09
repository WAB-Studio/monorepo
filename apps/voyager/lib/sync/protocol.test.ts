import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { SYNC_BATCH, SYNC_DAILY_ROW_CAP, syncRequestSchema, syncRowSchema, type SyncRow } from "./protocol";

function row(deviceId: string, localId: number): SyncRow {
  return {
    deviceId,
    localId,
    at: 1_700_000_000_000,
    text: "x",
    normalised: "x",
    kind: "word",
    outcome: "exact",
    headword: null,
    rule: null,
    senses: 0,
    translation: null,
    dictionaryReady: true,
    origin: null,
    recordSchema: 1,
  };
}

test("a batch whose rows come from two devices is refused", () => {
  const one = randomUUID();
  const two = randomUUID();
  const parsed = syncRequestSchema.safeParse({ deviceId: one, rows: [row(one, 1), row(two, 1)], since: null });
  assert.equal(parsed.success, false);
});

test("a batch from one device passes, the empty one too", () => {
  const one = randomUUID();
  assert.equal(syncRequestSchema.safeParse({ deviceId: one, rows: [row(one, 1), row(one, 2)], since: null }).success, true);
  assert.equal(syncRequestSchema.safeParse({ deviceId: one, rows: [], since: null }).success, true);
});

test("an `at` past the largest Date is refused", () => {
  const one = randomUUID();
  const late = { ...row(one, 1), at: 9e15 };
  assert.equal(syncRequestSchema.safeParse({ deviceId: one, rows: [late], since: null }).success, false);
});

test("a row whose outcome is unlisted passes, an unknown outcome does not", () => {
  const one = randomUUID();
  assert.equal(syncRowSchema.safeParse({ ...row(one, 1), outcome: "unlisted" }).success, true);
  assert.equal(syncRowSchema.safeParse({ ...row(one, 1), outcome: "nope" }).success, false);
});

test("a batch admits 500 rows and refuses 501", () => {
  const one = randomUUID();
  const batch = (count: number) => ({
    deviceId: one,
    rows: Array.from({ length: count }, (_, index) => row(one, index + 1)),
    since: null,
  });
  assert.equal(syncRequestSchema.safeParse(batch(500)).success, true);
  assert.equal(syncRequestSchema.safeParse(batch(501)).success, false);
  assert.equal(SYNC_BATCH, 500);
});

test("a reader may send 20 000 rows a day", () => {
  assert.equal(SYNC_DAILY_ROW_CAP, 20_000);
});
