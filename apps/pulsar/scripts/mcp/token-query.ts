// Proves RP-38 and RP-41 at the query: inside `actAs` the person reads their
// own keys, live ones first and newest first, revoked ones after, never the
// fingerprint and never another person's. Stubs and wire counting as `acting.ts`.
import assert from "node:assert/strict";
import Module from "node:module";
import { after, before, test } from "node:test";

import postgres from "postgres";

import { adminSql, createPeople, dropPeople, issueKeyFor, openCheckRun, stubServerOnly, type Person } from "./lib/people";
import type { ResolvedPerson } from "@/lib/mcp/tokens";

const admin = adminSql();
const wire: string[] = [];
const door = postgres(process.env.DATABASE_URL!, {
  prepare: false,
  max: 1,
  debug: (_connection: number, query: string) => void wire.push(query),
});
(globalThis as unknown as { sql: unknown }).sql = door;

let session: typeof import("@/lib/session");
let tokens: typeof import("@/lib/queries/tokens");
let subject: Person;
let intruder: Person;
let second: string;
let revoked: string;

const asResolved = (person: Person): ResolvedPerson => ({ id: person.id, email: person.email }) as ResolvedPerson;

function installStubs(): void {
  stubServerOnly();
  const untyped = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = untyped._load;
  untyped._load = (request, parent, isMain) => {
    if (request === "next/headers") {
      return { cookies: async () => ({ getAll: () => [], set() {} }) };
    }
    if (request === "next/cache") return { revalidatePath() {} };
    return originalLoad(request, parent, isMain);
  };
}

before(async () => {
  installStubs();
  session = await import("@/lib/session");
  tokens = await import("@/lib/queries/tokens");
  const runId = await openCheckRun(admin);
  [subject, intruder] = await createPeople(admin, runId, door, 2);
  // Created after `second`, then revoked: newest overall, so only the
  // live-first order can put it last.
  second = (await issueKeyFor(door, subject, "check second")).id;
  revoked = (await issueKeyFor(door, subject, "check revoked")).id;
  await admin`update goals.access_tokens set revoked_at = now() where id = ${revoked}`;
});

after(async () => {
  try {
    await dropPeople(admin);
  } finally {
    await door.end();
    await admin.end();
  }
});

test("two live keys newest first, then the revoked one, the intruder's never", async () => {
  const list = await session.actAs(asResolved(subject), () => tokens.listAccessTokens());
  assert.deepEqual(
    list.map((token) => token.id),
    [second, subject.keyId, revoked],
  );
  assert.ok(!list.some((token) => token.id === intruder.keyId), "the subject read the intruder's key");
});

test("the fields are the contract's, instants are ISO strings, no fingerprint", async () => {
  const list = await session.actAs(asResolved(subject), () => tokens.listAccessTokens());
  const [live, , gone] = list;
  assert.deepEqual(Object.keys(live).sort(), ["createdAt", "hint", "id", "kind", "lastUsedAt", "name", "revokedAt"]);
  assert.equal(live.kind, "personal");
  assert.equal(live.name, "check second");
  assert.equal(live.hint?.length, 4);
  assert.equal(live.revokedAt, null);
  assert.equal(live.lastUsedAt, null);
  assert.equal(live.createdAt, new Date(live.createdAt).toISOString());
  assert.equal(gone.revokedAt, new Date(gone.revokedAt!).toISOString());
  assert.ok(!JSON.stringify(list).includes("token_hash"));
});

test("the intruder reads only their own key", async () => {
  const list = await session.actAs(asResolved(intruder), () => tokens.listAccessTokens());
  assert.deepEqual(list.map((token) => token.id), [intruder.keyId]);
});

test("the list is two application statements on the wire", async () => {
  const run = () => session.actAs(asResolved(subject), () => tokens.listAccessTokens());
  await run();
  wire.length = 0;
  await run();
  const application = wire.filter((query) => !/^\s*(begin|commit)\s*$/i.test(query));
  assert.equal(application.length, 2, `expected two, the wire carried:\n${application.join("\n---\n")}`);
});
