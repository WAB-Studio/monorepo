import assert from "node:assert/strict";
import test from "node:test";

import { addPhaseSchema } from "./plan";

const GOAL_ID = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

function phaseInput(startsOn: string, endsOn: string) {
  return { goalId: GOAL_ID, aim: "leer despacio", startsOn, endsOn };
}

// RP-15: a phase is a span of weeks. A span whose end precedes its start
// names no span at all and must never reach the database — mirrors
// `phases_ends_on_after_starts_on`.
test("addPhaseSchema: refuses a phase whose end precedes its start", () => {
  const result = addPhaseSchema.safeParse(phaseInput("2026-02-10", "2026-02-01"));
  assert.equal(result.success, false);
});

test("addPhaseSchema: accepts a phase whose end is the same day as its start", () => {
  const result = addPhaseSchema.safeParse(phaseInput("2026-02-10", "2026-02-10"));
  assert.equal(result.success, true);
});

test("addPhaseSchema: accepts a phase whose end follows its start", () => {
  const result = addPhaseSchema.safeParse(phaseInput("2026-02-01", "2026-02-28"));
  assert.equal(result.success, true);
});
