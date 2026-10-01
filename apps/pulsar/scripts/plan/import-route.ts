// Drives `POST /importar/leer` (`app/importar/leer/route.ts`, RP-37, RNP-13)
// as the exported function, the way `task-actions.ts` drives an action:
// `server-only`, `next/headers` stubbed before the first `@/` import, and the
// cookie `harness:mint-session` left standing is the session `getPerson()`
// reads. The model is never reached: the key is a fake one set on `env`, and
// `globalThis.fetch` answers in place of OpenAI, recording how many
// `model_calls` rows the person held when it was asked. The pooler seeds the
// cap's rows and deletes every call the file made.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { resolve } from "node:path";
import { after, before, beforeEach, test } from "node:test";

import postgres from "postgres";

function laneNumber(): number {
  const raw = process.env.HARNESS_LANE?.trim();
  if (!raw) return 1;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`HARNESS_LANE must be a positive integer, not "${raw}"`);
  }
  return Number(raw);
}

type StoredCookie = { name: string; value: string };

function loadCookies(): StoredCookie[] {
  const file = resolve(process.cwd(), `private/session-${laneNumber()}.json`);
  let state: { cookies: StoredCookie[] };
  try {
    state = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`no session at ${file} — run harness:mint-session first`);
  }
  if (state.cookies.length === 0) {
    throw new Error(`${file} carries no cookie — the mint did not land one`);
  }
  return state.cookies.map(({ name, value }) => ({ name, value }));
}

// Swapped to [] for the signed-out case.
let standing: StoredCookie[] = [];

function installStubs(): void {
  const untyped = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = untyped._load;
  untyped._load = (request, parent, isMain) => {
    if (request === "server-only") return {};
    if (request === "next/headers") {
      return { cookies: async () => ({ getAll: () => standing, set() {} }) };
    }
    return originalLoad(request, parent, isMain);
  };
}

const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });

type Rows = { outcome: string | null; source: string; input_tokens: number | null }[];

let route: typeof import("@/app/importar/leer/route");
let envHandle: { OPENAI_API_KEY?: string };
let userId: string;
let cookies: StoredCookie[];

const goal = {
  name: "IA aplicada",
  horizon: "2027-10-01",
  measure: { name: "horas de estudio", unit: "minutos" },
  phases: [],
  months: [{ month: "2026-10", amount: 720 }],
  commitments: [],
  tasks: [],
};

const TEMPLATE = "pulsar · plantilla 1\n\n# IA aplicada\nhorizonte: 2027-10-01\nmedida: horas de estudio · minutos\n\n## Meses\n- 2026-10 · 12 h";

const realFetch = globalThis.fetch;
// What each fake model call saw: the person's rows at the moment it was asked.
let modelCalls: { rowsSeen: Rows }[] = [];
let modelAnswer: () => Response = () => completion({ goals: [goal] });

const completion = (content: unknown) =>
  Response.json({
    choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 120, completion_tokens: 340 },
  });

async function rows(): Promise<Rows> {
  return sql<Rows>`
    select outcome, source, input_tokens from goals.model_calls
    where user_id = ${userId} order by called_at`;
}

function request(parts: Record<string, string | File>, headers: Record<string, string> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(parts)) form.set(key, value);
  return new Request("http://localhost/importar/leer", { method: "POST", body: form, headers }) as unknown as Parameters<
    typeof route.POST
  >[0];
}

before(async () => {
  cookies = loadCookies();
  installStubs();
  standing = cookies;
  ({ env: envHandle } = (await import("@/lib/env")) as unknown as { env: { OPENAI_API_KEY?: string } });
  route = await import("@/app/importar/leer/route");
  const { getPerson } = await import("@/lib/session");
  const person = await getPerson();
  if (!person) throw new Error("the standing session names no person — run harness:mint-session");
  userId = person.id;
  await sql`delete from goals.model_calls where user_id = ${userId}`;
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    if (!String(url).startsWith("https://api.openai.com/")) return realFetch(url as string, init);
    modelCalls.push({ rowsSeen: await rows() });
    return modelAnswer();
  }) as typeof fetch;
});

beforeEach(async () => {
  standing = cookies;
  envHandle.OPENAI_API_KEY = "sk-never-sent";
  modelCalls = [];
  modelAnswer = () => completion({ goals: [goal] });
  await sql`delete from goals.model_calls where user_id = ${userId}`;
});

after(async () => {
  globalThis.fetch = realFetch;
  await sql`delete from goals.model_calls where user_id = ${userId}`;
  await sql.end();
});

async function seedToday(count: number) {
  for (let i = 0; i < count; i++) {
    await sql`insert into goals.model_calls (user_id, model, source, outcome) values (${userId}, 'RNP-13 fixture', 'paste', 'ok')`;
  }
}

async function answer(response: Response) {
  assert.notEqual(response.status, 204, "never a 204");
  assert.equal(response.headers.get("cache-control"), "no-store");
  return (await response.json()) as Record<string, unknown>;
}

test("signed out: 401 import.errors.signedOut, no claim", async () => {
  standing = [];
  const response = await route.POST(request({ text: "algo" }));
  assert.equal(response.status, 401);
  assert.equal((await answer(response)).error, "import.errors.signedOut");
  assert.equal((await rows()).length, 0);
});

test("a file over 4 MB: 413 import.errors.tooBig, and so is a declared body over it", async () => {
  const big = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "plan.txt", { type: "text/plain" });
  const response = await route.POST(request({ file: big }));
  assert.equal(response.status, 413);
  assert.equal((await answer(response)).error, "import.errors.tooBig");

  const declared = await route.POST(request({ text: "algo" }, { "content-length": String(5 * 1024 * 1024) }));
  assert.equal(declared.status, 413);
  assert.equal(modelCalls.length, 0);
  assert.equal((await rows()).length, 0);
});

test("a template text: 200 via template with its draft, no key needed, no row, no model", async () => {
  delete envHandle.OPENAI_API_KEY;
  const response = await route.POST(request({ text: TEMPLATE }));
  assert.equal(response.status, 200);
  const body = await answer(response);
  assert.equal(body.via, "template");
  assert.equal((body.draft as { goals: { name: string }[] }).goals[0].name, "IA aplicada");
  assert.equal((await rows()).length, 0);
  assert.equal(modelCalls.length, 0);
});

test("a template file is read as UTF-8 the same way", async () => {
  delete envHandle.OPENAI_API_KEY;
  const file = new File([TEMPLATE], "plan.md", { type: "text/markdown" });
  const response = await route.POST(request({ file }));
  assert.equal(response.status, 200);
  assert.equal((await answer(response)).via, "template");
  assert.equal((await rows()).length, 0);
});

test("a template with a broken line: 422 templateLine with its line and form, no row, no model", async () => {
  const broken = TEMPLATE.replace("- 2026-10 · 12 h", "- octubre · 12 h");
  const response = await route.POST(request({ text: broken }));
  assert.equal(response.status, 422);
  const body = await answer(response);
  assert.equal(body.error, "import.errors.templateLine");
  assert.equal(typeof body.line, "number");
  assert.equal(typeof body.expected, "string");
  assert.equal((await rows()).length, 0);
  assert.equal(modelCalls.length, 0);
});

test("a broken template with no key is still 422, never 503", async () => {
  delete envHandle.OPENAI_API_KEY;
  const response = await route.POST(request({ text: TEMPLATE.replace("- 2026-10 · 12 h", "- octubre · 12 h") }));
  assert.equal(response.status, 422);
});

test("no key: 503 import.errors.noKey, no row, no model", async () => {
  delete envHandle.OPENAI_API_KEY;
  const response = await route.POST(request({ text: "quiero aprender inglés este año" }));
  assert.equal(response.status, 503);
  assert.equal((await answer(response)).error, "import.errors.noKey");
  assert.equal((await rows()).length, 0);
  assert.equal(modelCalls.length, 0);
});

test("a blank text: 422 import.errors.empty, no row", async () => {
  const response = await route.POST(request({ text: "   " }));
  assert.equal(response.status, 422);
  assert.equal((await answer(response)).error, "import.errors.empty");
  assert.equal((await rows()).length, 0);
});

test("the model path: the row is claimed before the model runs and settled after", async () => {
  const response = await route.POST(request({ text: "quiero aprender inglés este año" }));
  assert.equal(response.status, 200);
  const body = await answer(response);
  assert.equal(body.via, "model");
  assert.equal((body.draft as { goals: { name: string }[] }).goals[0].name, "IA aplicada");

  assert.equal(modelCalls.length, 1);
  assert.equal(modelCalls[0].rowsSeen.length, 1, "claimed before the model ran");
  assert.equal(modelCalls[0].rowsSeen[0].outcome, null, "unsettled while the model ran");
  const after = await rows();
  assert.equal(after.length, 1);
  assert.equal(after[0].outcome, "ok");
  assert.equal(after[0].source, "paste");
  assert.equal(after[0].input_tokens, 120);
});

test("a non-template file goes to the model as a file claim", async () => {
  const file = new File(["quiero aprender inglés"], "plan.txt", { type: "text/plain" });
  const response = await route.POST(request({ file }));
  assert.equal(response.status, 200);
  assert.equal((await rows())[0].source, "file");
});

test("at ten rows today the eleventh answers 429 import.errors.cap and the model is not called", async () => {
  await seedToday(10);
  const response = await route.POST(request({ text: "quiero aprender inglés este año" }));
  assert.equal(response.status, 429);
  assert.equal((await answer(response)).error, "import.errors.cap");
  assert.equal(modelCalls.length, 0);
  assert.equal((await rows()).length, 10);
});

test("a template still reads at ten rows: no cap on it", async () => {
  await seedToday(10);
  const response = await route.POST(request({ text: TEMPLATE }));
  assert.equal(response.status, 200);
});

test("the model answers no goals: 422 import.errors.empty, settled empty", async () => {
  modelAnswer = () => completion({ goals: [] });
  const response = await route.POST(request({ text: "nada que leer aquí" }));
  assert.equal(response.status, 422);
  assert.equal((await answer(response)).error, "import.errors.empty");
  assert.equal((await rows())[0].outcome, "empty");
});

test("the model answers a shape the schema refuses: 502 import.errors.modelInvalid, settled invalid", async () => {
  modelAnswer = () => completion({ goals: [{ name: 3 }] });
  const response = await route.POST(request({ text: "un plan cualquiera" }));
  assert.equal(response.status, 502);
  assert.equal((await answer(response)).error, "import.errors.modelInvalid");
  assert.equal((await rows())[0].outcome, "invalid");
});

test("the model fails: 502 import.errors.modelFailed, settled failed", async () => {
  modelAnswer = () => new Response("boom", { status: 500 });
  const response = await route.POST(request({ text: "un plan cualquiera" }));
  assert.equal(response.status, 502);
  assert.equal((await answer(response)).error, "import.errors.modelFailed");
  assert.equal((await rows())[0].outcome, "failed");
});

test("a file type the reader refuses: 415 import.errors.unreadableType", async () => {
  const file = new File([new Uint8Array([80, 75, 3, 4])], "plan.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const response = await route.POST(request({ file }));
  assert.equal(response.status, 415);
  assert.equal((await answer(response)).error, "import.errors.unreadableType");
  assert.equal(modelCalls.length, 0);
});
