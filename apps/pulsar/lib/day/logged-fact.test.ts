import assert from "node:assert/strict";
import test from "node:test";

import { latestFactByCommitment, type FactForCommitment } from "./logged-fact";

function fact(overrides: Partial<FactForCommitment> = {}): FactForCommitment {
  return {
    id: "fact-1",
    commitmentId: "anki",
    writtenAt: "2026-09-27T10:00:00Z",
    quantity: 10,
    note: null,
    ...overrides,
  };
}

test("latestFactByCommitment picks the most recently written fact, not the first one in the array", () => {
  const result = latestFactByCommitment([
    fact({ id: "first", writtenAt: "2026-09-27T10:00:00Z", quantity: 10, note: null }),
    fact({ id: "second", writtenAt: "2026-09-27T12:00:00Z", quantity: 25, note: "tarde" }),
  ]);

  assert.deepEqual(result.anki, { factId: "second", quantity: 25, note: "tarde" });
});

test("latestFactByCommitment reads the same result with the array reversed — the rule is the timestamp, never the position", () => {
  const result = latestFactByCommitment([
    fact({ id: "second", writtenAt: "2026-09-27T12:00:00Z", quantity: 25, note: "tarde" }),
    fact({ id: "first", writtenAt: "2026-09-27T10:00:00Z", quantity: 10, note: null }),
  ]);

  assert.deepEqual(result.anki, { factId: "second", quantity: 25, note: "tarde" });
});

test("latestFactByCommitment ignores a one-off's own fact — no commitment id, no entry", () => {
  const result = latestFactByCommitment([
    fact({ id: "suelta", commitmentId: null, quantity: null }),
  ]);

  assert.deepEqual(result, {});
});

test("latestFactByCommitment keeps one entry per commitment, each its own latest", () => {
  const result = latestFactByCommitment([
    fact({ id: "anki-old", commitmentId: "anki", writtenAt: "2026-09-27T09:00:00Z" }),
    fact({ id: "anki-new", commitmentId: "anki", writtenAt: "2026-09-27T11:00:00Z", quantity: 30 }),
    fact({ id: "shadowing-1", commitmentId: "shadowing", writtenAt: "2026-09-27T10:30:00Z", quantity: 15 }),
  ]);

  assert.deepEqual(result.anki, { factId: "anki-new", quantity: 30, note: null });
  assert.deepEqual(result.shadowing, { factId: "shadowing-1", quantity: 15, note: null });
});
