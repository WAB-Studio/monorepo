// RL-63: the registro's filter keeps the study rows whose text holds what was typed.
import assert from "node:assert/strict";
import { test } from "node:test";

import { filterStudyRows } from "./study-filter";
import type { StudyRow } from "./summary";

function row(
  key: string,
  over: Partial<Omit<StudyRow, "forms">> & { forms?: string[] } = {},
): StudyRow {
  const { forms = [key], ...rest } = over;
  return {
    key,
    normalised: key,
    forms: forms.map((text) => ({ text, count: 1 })),
    display: key,
    count: 1,
    lastAt: 0,
    lastTranslation: null,
    lastOutcome: "exact",
    ...rest,
  };
}

const linger = row("linger", { lastTranslation: "demorarse" });
const lukewarm = row("lukewarm", { lastTranslation: "tibio" });
const go = row("go", { forms: ["go", "went", "gone"], lastTranslation: "ir" });
const compulsive = row("compulsive", {
  display: "compulsive",
  lastTranslation: "desplazamiento compulsivo",
});
// `display` is the surface form searched, `key` the lemma: they differ.
const rows = [linger, lukewarm, go, compulsive];

const keys = (found: StudyRow[]) => found.map((r) => r.key);

test("filterStudyRows: a blank text returns the same array", () => {
  assert.equal(filterStudyRows(rows, "  "), rows);
  assert.equal(filterStudyRows(rows, ""), rows);
});

test("filterStudyRows: the key matches", () => {
  const found = keys(filterStudyRows(rows, "ling"));
  assert.ok(found.includes("linger"));
  assert.ok(!found.includes("lukewarm"));
  const lemma = row("run", { display: "ran", forms: ["ran"] });
  assert.deepEqual(keys(filterStudyRows([lemma, ...rows], "run")), ["run"]);
});

test("filterStudyRows: a form matches its group", () => {
  assert.deepEqual(keys(filterStudyRows(rows, "went")), ["go"]);
});

test("filterStudyRows: the last translation matches", () => {
  assert.deepEqual(keys(filterStudyRows(rows, "tibio")), ["lukewarm"]);
});

test("filterStudyRows: accents are ignored on both sides", () => {
  assert.deepEqual(keys(filterStudyRows(rows, "compulsion")), []);
  const accented = row("drift", { lastTranslation: "desplazamiento compulsión" });
  assert.deepEqual(keys(filterStudyRows([accented, ...rows], "compulsion")), ["drift"]);
  assert.deepEqual(keys(filterStudyRows(rows, "tíbio")), ["lukewarm"]);
});

test("filterStudyRows: case is ignored", () => {
  assert.deepEqual(keys(filterStudyRows(rows, "LINGER")), ["linger"]);
  const upper = row("Mixed", { display: "MIXED" });
  assert.deepEqual(keys(filterStudyRows([upper], "mixed")), ["Mixed"]);
});

test("filterStudyRows: spaces are trimmed and collapsed", () => {
  assert.deepEqual(
    keys(filterStudyRows(rows, "  desplazamiento    compulsivo ")),
    ["compulsive"],
  );
});

test("filterStudyRows: the result keeps the order of the rows", () => {
  const shuffled = [compulsive, lukewarm, go, linger];
  const found = filterStudyRows(shuffled, "l");
  assert.deepEqual(found, [compulsive, lukewarm, linger]);
  assert.deepEqual(found, shuffled.filter((hit) => found.includes(hit)));
});

test("filterStudyRows: no match returns an empty list", () => {
  assert.deepEqual(filterStudyRows(rows, "zzz"), []);
});

test("filterStudyRows: 50 filters over 800 rows take under 50 ms", () => {
  const many = Array.from({ length: 800 }, (_, i) =>
    row(`word${i}`, { forms: [`word${i}`, `forma${i}`], lastTranslation: `palabra ${i}` }),
  );
  const start = performance.now();
  for (let i = 0; i < 50; i++) filterStudyRows(many, `Palábra ${i}`);
  assert.ok(performance.now() - start < 50);
});
