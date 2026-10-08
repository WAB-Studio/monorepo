// RL-24, RNL-09: an upload page always fits the wire and always moves the cursor.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { LookupRecord } from "@/lib/log/types";
import { syncRequestSchema } from "./protocol";
import { planUploadRound } from "./upload-page";

const DEVICE = "7b2d5a14-0c1e-4f6a-9d3b-8e1f2a3b4c5d";

function row(id: number, overrides: Partial<LookupRecord> = {}): LookupRecord {
  return {
    id,
    schema: 2,
    at: 1_700_000_000_000 + id,
    text: "word",
    normalised: "word",
    kind: "word",
    outcome: "exact",
    headword: "word",
    rule: null,
    senses: 1,
    translation: null,
    dictionaryReady: true,
    origin: null,
    ...overrides,
  };
}

test("planUploadRound: a 689-character row goes up cut to 500 and the request parses", () => {
  const long = "a".repeat(689);
  const { rows } = planUploadRound([row(1, { text: long, normalised: long, headword: long })], DEVICE);
  assert.equal(rows[0].text.length, 500);
  assert.equal(rows[0].normalised.length, 500);
  assert.equal(rows[0].headword!.length, 500);
  assert.doesNotThrow(() => syncRequestSchema.parse({ deviceId: DEVICE, rows, since: null }));
});

test("planUploadRound: a surrogate pair on the cut is dropped whole", () => {
  const text = "a".repeat(499) + "😀";
  const { rows } = planUploadRound([row(1, { text })], DEVICE);
  assert.equal(rows[0].text, "a".repeat(499));
});

test("planUploadRound: foreign rows are skipped and through is the last id scanned", () => {
  const { rows, through } = planUploadRound(
    [row(1), row(2, { device: "other", deviceSeq: 9 }), row(3, { device: "other", deviceSeq: 10 })],
    DEVICE,
  );
  assert.deepEqual(rows.map((r) => r.localId), [1]);
  assert.equal(through, 3);
});

test("planUploadRound: an empty page has no through", () => {
  assert.deepEqual(planUploadRound([], DEVICE), { rows: [], through: null });
});
