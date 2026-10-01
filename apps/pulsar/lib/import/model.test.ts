import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { afterEach, mock } from "node:test";

import type { ImportDraft } from "./draft";

const fakeEnv: { OPENAI_API_KEY?: string; PULSAR_MODEL_STUB?: string } = {};
mock.module("@/lib/env", { namedExports: { env: fakeEnv } });

const goal: ImportDraft["goals"][number] = {
  name: "IA aplicada",
  horizon: "2027-10-01",
  measure: { name: "horas de estudio", unit: "minutos" },
  phases: [{ aim: "Evals", startsOn: "2026-10-01", endsOn: "2026-12-31" }],
  months: [{ month: "2026-10", amount: 720 }],
  commitments: [],
  tasks: [{ name: "Leer", month: "2026-10", estimate: 240, children: [] }],
};

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];
const realFetch = globalThis.fetch;
const realVercel = process.env.VERCEL;

function replyWith(make: () => Response | Promise<Response>) {
  calls.length = 0;
  globalThis.fetch = (async (url: unknown, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return make();
  }) as typeof fetch;
}

const completion = (content: unknown, extra: object = {}) =>
  Response.json({
    choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 120, completion_tokens: 340 },
    ...extra,
  });

const bodyOf = (call: Call) => JSON.parse(call.init.body as string);

afterEach(() => {
  globalThis.fetch = realFetch;
  delete fakeEnv.OPENAI_API_KEY;
  delete fakeEnv.PULSAR_MODEL_STUB;
  if (realVercel === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = realVercel;
  calls.length = 0;
});

test("a Markdown text posts to chat completions with the key, the model, json_schema and the text", async () => {
  const { readPlan, MODEL_NAME } = await import("./model");
  fakeEnv.OPENAI_API_KEY = "sk-test";
  replyWith(() => completion({ goals: [goal] }));

  const result = await readPlan({ kind: "text", text: "# Mi plan\n- aprender" });

  assert.equal(result.status, "ok");
  if (result.status === "ok") {
    assert.deepEqual(result.draft.goals[0], goal);
    assert.deepEqual(result.usage, { input: 120, output: 340 });
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/chat/completions");
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, "Bearer sk-test");
  const body = bodyOf(calls[0]);
  assert.equal(body.model, MODEL_NAME);
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.messages[1].content, [{ type: "text", text: "# Mi plan\n- aprender" }]);
});

test("the strict schema names every key as required and closes every object", async () => {
  const { importDraftStrictSchema } = await import("./model");
  const seen: string[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node === null || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (obj.type === "object") {
      assert.equal(obj.additionalProperties, false);
      assert.deepEqual(obj.required, Object.keys(obj.properties as object));
      seen.push("object");
    }
    Object.values(obj).forEach(walk);
  };
  walk(importDraftStrictSchema);
  assert.ok(seen.length >= 6);
  assert.equal("$schema" in (importDraftStrictSchema as object), false);
});

test("a Markdown file is decoded here and sent as text", async () => {
  const { readPlan } = await import("./model");
  fakeEnv.OPENAI_API_KEY = "sk-test";
  replyWith(() => completion({ goals: [goal] }));

  await readPlan({ kind: "file", name: "plan.md", type: "", bytes: new TextEncoder().encode("# Plan") });

  assert.deepEqual(bodyOf(calls[0]).messages[1].content, [{ type: "text", text: "# Plan" }]);
});

test("a PDF posts a file part with a base64 data URL and its filename", async () => {
  const { readPlan } = await import("./model");
  fakeEnv.OPENAI_API_KEY = "sk-test";
  replyWith(() => completion({ goals: [goal] }));
  const bytes = new Uint8Array([37, 80, 68, 70, 45]);

  await readPlan({ kind: "file", name: "plan.pdf", type: "application/pdf", bytes });

  assert.deepEqual(bodyOf(calls[0]).messages[1].content, [
    { type: "file", file: { filename: "plan.pdf", file_data: `data:application/pdf;base64,${Buffer.from(bytes).toString("base64")}` } },
  ]);
});

test("an image posts an image_url part with a data URL", async () => {
  const { readPlan } = await import("./model");
  fakeEnv.OPENAI_API_KEY = "sk-test";
  replyWith(() => completion({ goals: [goal] }));

  await readPlan({ kind: "file", name: "plan.png", type: "image/png", bytes: new Uint8Array([1, 2, 3]) });

  assert.deepEqual(bodyOf(calls[0]).messages[1].content, [
    { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
  ]);
});

test("a .docx answers unreadableType with no call", async () => {
  const { readPlan } = await import("./model");
  fakeEnv.OPENAI_API_KEY = "sk-test";
  replyWith(() => completion({ goals: [goal] }));

  const result = await readPlan({
    kind: "file",
    name: "plan.docx",
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bytes: new Uint8Array([1]),
  });

  assert.equal(result.status, "unreadableType");
  assert.equal(calls.length, 0);
});

test("an HTTP 500, a network error and a non-JSON body answer failed", async () => {
  const { readPlan } = await import("./model");
  fakeEnv.OPENAI_API_KEY = "sk-test";
  const input = { kind: "text", text: "plan" } as const;

  replyWith(() => new Response("boom", { status: 500 }));
  assert.equal((await readPlan(input)).status, "failed");

  replyWith(() => {
    throw new TypeError("fetch failed");
  });
  assert.equal((await readPlan(input)).status, "failed");

  replyWith(() => new Response("<html>not json</html>", { status: 200 }));
  assert.equal((await readPlan(input)).status, "failed");

  replyWith(() => completion("not json at all"));
  assert.equal((await readPlan(input)).status, "failed");
});

test("an answer missing a field answers invalid", async () => {
  const { readPlan } = await import("./model");
  fakeEnv.OPENAI_API_KEY = "sk-test";
  const missing: Partial<typeof goal> = { ...goal };
  delete missing.tasks;
  replyWith(() => completion({ goals: [missing] }));

  const result = await readPlan({ kind: "text", text: "plan" });

  assert.equal(result.status, "invalid");
  assert.deepEqual(result.usage, { input: 120, output: 340 });
});

test("{ goals: [] } answers empty", async () => {
  const { readPlan } = await import("./model");
  fakeEnv.OPENAI_API_KEY = "sk-test";
  replyWith(() => completion({ goals: [] }));

  assert.equal((await readPlan({ kind: "text", text: "plan" })).status, "empty");
});

test("a truncated answer (finish_reason length) answers failed", async () => {
  const { readPlan } = await import("./model");
  fakeEnv.OPENAI_API_KEY = "sk-test";
  replyWith(() => Response.json({ choices: [{ message: { content: '{"goals":[' }, finish_reason: "length" }] }));

  assert.equal((await readPlan({ kind: "text", text: "plan" })).status, "failed");
});

test("no key and no stub: unavailable, and readPlan answers failed with no call", async () => {
  const { readPlan, modelAvailable } = await import("./model");
  delete process.env.VERCEL;
  replyWith(() => completion({ goals: [goal] }));

  assert.equal(modelAvailable(), false);
  assert.equal((await readPlan({ kind: "text", text: "plan" })).status, "failed");
  assert.equal(calls.length, 0);
});

test("a stub answers before fetch: draft file, fail, invalid, empty", async () => {
  const { readPlan, modelAvailable } = await import("./model");
  delete process.env.VERCEL;
  fakeEnv.OPENAI_API_KEY = "sk-test";
  replyWith(() => completion({ goals: [goal] }));
  const dir = mkdtempSync(join(tmpdir(), "stub-"));
  const path = join(dir, "draft.json");
  writeFileSync(path, JSON.stringify({ goals: [goal] }));
  const input = { kind: "text", text: "plan" } as const;

  fakeEnv.PULSAR_MODEL_STUB = `draft:${path}`;
  const ok = await readPlan(input);
  assert.equal(ok.status, "ok");
  if (ok.status === "ok") assert.deepEqual(ok.draft.goals[0], goal);

  fakeEnv.PULSAR_MODEL_STUB = "fail";
  assert.equal((await readPlan(input)).status, "failed");
  fakeEnv.PULSAR_MODEL_STUB = "invalid";
  assert.equal((await readPlan(input)).status, "invalid");
  fakeEnv.PULSAR_MODEL_STUB = "empty";
  assert.equal((await readPlan(input)).status, "empty");

  delete fakeEnv.OPENAI_API_KEY;
  assert.equal(modelAvailable(), true);
  assert.equal(calls.length, 0);
});

test("a stub whose fixture does not exist answers failed", async () => {
  const { readPlan } = await import("./model");
  delete process.env.VERCEL;
  fakeEnv.PULSAR_MODEL_STUB = "draft:/nonexistent/draft.json";

  assert.equal((await readPlan({ kind: "text", text: "plan" })).status, "failed");
});

test("under VERCEL the stub is off: the real call is made and the key rules", async () => {
  const { readPlan, modelAvailable } = await import("./model");
  process.env.VERCEL = "1";
  fakeEnv.PULSAR_MODEL_STUB = "fail";
  replyWith(() => completion({ goals: [goal] }));

  assert.equal(modelAvailable(), false);
  fakeEnv.OPENAI_API_KEY = "sk-test";
  const result = await readPlan({ kind: "text", text: "plan" });

  assert.equal(result.status, "ok");
  assert.equal(calls.length, 1);
});
