// Proves RP-41's statements end to end: register, issue a code as the person,
// exchange it, refresh it, and the revocations a replay brings. A secret is
// never printed; a failure names the step.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import postgres from "postgres";

import { adminSql, createPeople, dropPeople, openCheckRun, stubServerOnly, type Person } from "./lib/people";

const admin = adminSql();
const door = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
(globalThis as unknown as { sql: unknown }).sql = door;

const REDIRECT = "http://localhost:6274/oauth/callback";
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
// RFC 7636 appendix B, written out so the check does not lean on `challengeOf`.
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

let grants: typeof import("@/lib/oauth/grants");
let resolveBearer: typeof import("@/lib/mcp/tokens").resolveBearer;
let subject: Person;
let clientId: string;

// Dynamic: `@/db/client` needs `stubServerOnly` first.
async function codeFor(person: Person, redirect = REDIRECT): Promise<string> {
  const { withSettledTransaction } = await import("@/lib/settled-transaction");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const schema = await import("@/db/schema");
  const orm = drizzle(door, { schema, casing: "snake_case" });

  return withSettledTransaction<import("@/lib/session").Transaction, string>(
    { claims: { sub: person.id, role: "authenticated" } },
    "check:mcp",
    "goals, public",
    (fn) => orm.transaction(fn as never) as never,
    (tx, statement) => tx.execute(statement),
    (tx) =>
      grants.issueCode(tx, {
        personId: person.id,
        clientId,
        challenge: CHALLENGE,
        redirectUri: redirect,
        resource: "https://pulsar.example/mcp",
      }),
  );
}

before(async () => {
  stubServerOnly();
  grants = await import("@/lib/oauth/grants");
  ({ resolveBearer } = await import("@/lib/mcp/tokens"));
  const runId = await openCheckRun(admin);
  [subject] = await createPeople(admin, runId, door, 1);
  clientId = await grants.registerClient({ name: "check client", redirectUris: [REDIRECT] });
});

after(async () => {
  try {
    await admin`delete from goals.oauth_clients where id = ${clientId}`;
    await dropPeople(admin);
  } finally {
    await door.end();
    await admin.end();
  }
});

test("a code exchanged with the right verifier yields a token that resolves to the person", async () => {
  const code = await codeFor(subject);
  assert.match(code, /^plc_/);
  const issued = await grants.exchangeCode({ code, verifier: VERIFIER, clientId, redirectUri: REDIRECT });
  assert.ok(issued, "the exchange returned nothing");
  assert.match(issued.accessToken, /^plo_/);
  assert.match(issued.refreshToken, /^plr_/);
  assert.equal(issued.expiresIn, 3600);
  assert.equal(issued.personId, subject.id);
  assert.equal((await resolveBearer(issued.accessToken))?.id, subject.id);

  const [row] = await admin`select kind, expires_at > now() as live from goals.access_tokens
    where token_hash = ${(await import("@/lib/mcp/tokens")).fingerprint(issued.accessToken)}`;
  assert.equal(row.kind, "oauth");
  assert.equal(row.live, true);
});

test("a second exchange yields nothing and the first access token stops resolving", async () => {
  const code = await codeFor(subject);
  const input = { code, verifier: VERIFIER, clientId, redirectUri: REDIRECT };
  const first = await grants.exchangeCode(input);
  assert.ok(first);
  assert.equal((await resolveBearer(first.accessToken))?.id, subject.id);

  assert.equal(await grants.exchangeCode(input), null);
  assert.equal(await resolveBearer(first.accessToken), null);
});

test("a wrong verifier, a wrong redirect and a malformed verifier yield nothing", async () => {
  const code = await codeFor(subject);
  const other = "A".repeat(43);
  assert.equal(await grants.exchangeCode({ code, verifier: other, clientId, redirectUri: REDIRECT }), null);
  assert.equal(
    await grants.exchangeCode({ code, verifier: VERIFIER, clientId, redirectUri: REDIRECT + "/x" }),
    null,
  );
  assert.equal(await grants.exchangeCode({ code, verifier: "short", clientId, redirectUri: REDIRECT }), null);
  // The code survived those refusals.
  assert.ok(await grants.exchangeCode({ code, verifier: VERIFIER, clientId, redirectUri: REDIRECT }));
});

test("a refresh rotates: the old access token stops resolving and the new one resolves", async () => {
  const code = await codeFor(subject);
  const first = await grants.exchangeCode({ code, verifier: VERIFIER, clientId, redirectUri: REDIRECT });
  assert.ok(first);

  const second = await grants.refreshToken({ refreshToken: first.refreshToken, clientId });
  assert.ok(second, "the refresh returned nothing");
  assert.notEqual(second.accessToken, first.accessToken);
  assert.equal(await resolveBearer(first.accessToken), null);
  assert.equal((await resolveBearer(second.accessToken))?.id, subject.id);

  const third = await grants.refreshToken({ refreshToken: second.refreshToken, clientId });
  assert.ok(third);
  assert.equal((await resolveBearer(third.accessToken))?.id, subject.id);
});

test("a reused refresh yields nothing and revokes the connection", async () => {
  const code = await codeFor(subject);
  const first = await grants.exchangeCode({ code, verifier: VERIFIER, clientId, redirectUri: REDIRECT });
  assert.ok(first);
  const second = await grants.refreshToken({ refreshToken: first.refreshToken, clientId });
  assert.ok(second);

  assert.equal(await grants.refreshToken({ refreshToken: first.refreshToken, clientId }), null);
  assert.equal(await resolveBearer(second.accessToken), null);
  assert.equal(await grants.refreshToken({ refreshToken: second.refreshToken, clientId }), null);
});
