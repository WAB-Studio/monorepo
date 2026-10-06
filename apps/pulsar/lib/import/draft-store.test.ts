import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import type { ImportDraft } from "./draft";
import { clearDraft, readDraft, readSource, saveDraft, saveReview } from "./draft-store";

const memory = new Map<string, string>();
(globalThis as { sessionStorage?: unknown }).sessionStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
};

const draft = (amount = 720): ImportDraft => ({
  goals: [
    {
      name: "IA aplicada",
      horizon: "2027-10-01",
      measure: { name: "horas de estudio", unit: "minutos" },
      phases: [{ aim: "Evals", startsOn: "2026-10-01", endsOn: "2026-12-31" }],
      months: [{ month: "2026-10", amount }],
      commitments: [],
      tasks: [],
    },
  ],
});

beforeEach(() => memory.clear());

test("a text save reads back its text, unmarked null", () => {
  saveDraft({ via: "template", draft: draft(), source: "texto" });
  assert.equal(readSource(), "texto");
  assert.equal(readDraft()?.unmarked, null);
});

test("a file save reads source null", () => {
  saveDraft({ via: "model", draft: draft() });
  assert.equal(readDraft()?.source, null);
  assert.equal(readSource(), null);
});

test("saveReview keeps amounts, unmarked paths and the source", () => {
  saveDraft({ via: "template", draft: draft(), source: "texto" });
  saveReview(draft(900), ["goals.0", "goals.0.tasks.1"]);
  const read = readDraft();
  assert.equal(read?.draft.goals[0].months[0].amount, 900);
  assert.deepEqual(read?.unmarked, ["goals.0", "goals.0.tasks.1"]);
  assert.equal(read?.source, "texto");
  assert.equal(read?.via, "template");
  assert.equal(readSource(), "texto");
});

test("saveReview with [] reads [], never null", () => {
  saveDraft({ via: "template", draft: draft(), source: "t" });
  saveReview(draft(), []);
  assert.deepEqual(readDraft()?.unmarked, []);
});

test("saveReview does nothing when nothing is stored", () => {
  saveReview(draft(), ["a"]);
  assert.equal(memory.size, 0);
});

test("the older shape reads the defaults", () => {
  memory.set("pulsar.import-draft", JSON.stringify({ via: "template", draft: draft() }));
  const read = readDraft();
  assert.equal(read?.source, null);
  assert.equal(read?.unmarked, null);
});

test("a non-string unmarked entry is dropped", () => {
  memory.set("pulsar.import-draft", JSON.stringify({ via: "model", draft: draft(), source: null, unmarked: ["a", 3, null, "b"] }));
  assert.deepEqual(readDraft()?.unmarked, ["a", "b"]);
});

test("clearDraft then readSource is null", () => {
  saveDraft({ via: "template", draft: draft(), source: "t" });
  clearDraft();
  assert.equal(readSource(), null);
});

test("a draft with an unknown field reads null", () => {
  const bad = { goals: [{ ...draft().goals[0], extra: 1 }] };
  memory.set("pulsar.import-draft", JSON.stringify({ via: "template", draft: bad, source: null, unmarked: null }));
  assert.equal(readDraft(), null);
});

test("a file save reads back its name, and no text", () => {
  saveDraft({ via: "model", draft: draft(), sourceName: "plan-2027.md" });
  const read = readDraft();
  assert.equal(read?.sourceName, "plan-2027.md");
  assert.equal(read?.source, null);
});

test("a text save carries no file name", () => {
  saveDraft({ via: "template", draft: draft(), source: "texto" });
  assert.equal(readDraft()?.sourceName, null);
});

test("saveReview keeps the file name", () => {
  saveDraft({ via: "model", draft: draft(), sourceName: "plan-2027.md" });
  saveReview(draft(900), ["goals.0"]);
  assert.equal(readDraft()?.sourceName, "plan-2027.md");
});

test("a stored file name that is no string reads null, and the older shape without one reads null", () => {
  memory.set("pulsar.import-draft", JSON.stringify({ via: "model", draft: draft(), sourceName: 3 }));
  assert.equal(readDraft()?.sourceName, null);
  memory.set("pulsar.import-draft", JSON.stringify({ via: "model", draft: draft() }));
  assert.equal(readDraft()?.sourceName, null);
});
