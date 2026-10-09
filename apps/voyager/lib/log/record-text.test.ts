// RL-24: a row recorded longer than the wire admits could never be copied.
import assert from "node:assert/strict";
import { test } from "node:test";

import { clampForRecord, RECORD_TEXT_MAX } from "./record-text";

test("clampForRecord: 689 characters come back as 500", () => {
  assert.equal([...clampForRecord("a".repeat(689))].length, RECORD_TEXT_MAX);
});

test("clampForRecord: an emoji on the boundary is not split", () => {
  const out = clampForRecord("a".repeat(499) + "😀" + "b".repeat(50));
  assert.equal(out, "a".repeat(499) + "😀");
  assert.equal([...out].length, 500);
  assert.equal(out.isWellFormed(), true);
});

test("clampForRecord: a 120-character phrase is untouched", () => {
  const phrase = "ab ".repeat(40);
  assert.equal(clampForRecord(phrase), phrase);
});
