import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { syncRequestSchema, type SyncRow } from "./protocol";

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
