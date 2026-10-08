// RL-24, RL-39: the copy's state belongs to one reader on one live device.
import assert from "node:assert/strict";
import { test } from "node:test";

import { normaliseSyncState, syncStateForReader } from "./sync-state";
import type { SyncState } from "./types";

function state(overrides: Partial<SyncState> = {}): SyncState {
  return {
    deviceId: "device-old",
    pushedThroughLocalId: 12,
    pulledThroughCursor: "a|b|3",
    lastSyncedAt: 1_700_000_000_000,
    enabled: false,
    readerId: "A",
    retired: false,
    ...overrides,
  };
}

const mint = () => "device-new";

test("normaliseSyncState: a row from before readerId and retired reads unclaimed and live", () => {
  const old = {
    deviceId: "d",
    pushedThroughLocalId: 4,
    pulledThroughCursor: "c",
    lastSyncedAt: 5,
    enabled: true,
  };
  assert.deepEqual(normaliseSyncState(old), { ...old, readerId: null, retired: false });
});

test("syncStateForReader: the same reader keeps device and both cursors", () => {
  const next = syncStateForReader(state(), "A", mint);
  assert.equal(next.deviceId, "device-old");
  assert.equal(next.pushedThroughLocalId, 12);
  assert.equal(next.pulledThroughCursor, "a|b|3");
  assert.equal(next.enabled, true);
});

test("syncStateForReader: another reader starts over under a new device", () => {
  const next = syncStateForReader(state(), "B", mint);
  assert.equal(next.deviceId, "device-new");
  assert.equal(next.pushedThroughLocalId, null);
  assert.equal(next.pulledThroughCursor, null);
  assert.equal(next.readerId, "B");
  assert.equal(next.enabled, true);
});

test("syncStateForReader: cursors from before readerId was recorded start over", () => {
  const next = syncStateForReader(state({ readerId: null }), "A", mint);
  assert.equal(next.deviceId, "device-new");
  assert.equal(next.pushedThroughLocalId, null);
  assert.equal(next.pulledThroughCursor, null);
});

test("syncStateForReader: an unclaimed state with no cursors keeps its device", () => {
  const next = syncStateForReader(state({ readerId: null, pushedThroughLocalId: null, pulledThroughCursor: null }), "A", mint);
  assert.equal(next.deviceId, "device-old");
  assert.equal(next.readerId, "A");
});

test("syncStateForReader: a retired device starts over even for the same reader", () => {
  const next = syncStateForReader(state({ retired: true, enabled: false }), "A", mint);
  assert.equal(next.deviceId, "device-new");
  assert.equal(next.retired, false);
  assert.equal(next.pushedThroughLocalId, null);
  assert.equal(next.enabled, true);
});
