// Proves RP-41 and RNP-19: the call limit on the two anonymous OAuth routes and
// the ceiling on unused clients. Drives the lane's running server
// (`PULSAR_BASE_URL`, else :3200 + lane - 1). Every address is a random /64 of
// the documentation prefix, and every assertion is on rows this run made.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import postgres from "postgres";

import { adminSql, stubServerOnly } from "./lib/people";

const lane = Number(process.env.HARNESS_LANE ?? "1");
const base = (process.env.PULSAR_BASE_URL ?? `http://localhost:${3200 + lane - 1}`).replace(/\/+$/, "");
const REDIRECT = "http://localhost:6274/oauth/callback";
const run = randomBytes(4).toString("hex");

const admin = adminSql();
const door = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
(globalThis as unknown as { sql: unknown }).sql = door;

const sources: Buffer[] = [];
let fingerprint: typeof import("@/lib/mcp/tokens").fingerprint;
let callerAddress: typeof import("@/lib/oauth/throttle").callerAddress;

const prefix = () => `2001:db8:${randomBytes(2).toString("hex")}:${randomBytes(2).toString("hex")}`;

// A window that closes mid-run would split a count the check reads whole.
async function outwait(windowSeconds: number, marginSeconds: number): Promise<void> {
  const left = windowSeconds - (Date.now() / 1000) % windowSeconds;
  if (left < marginSeconds) await new Promise((done) => setTimeout(done, (left + 1) * 1000));
}

function remember(address: string): void {
  sources.push(fingerprint(callerAddress({ headers: new Headers({ "x-forwarded-for": address }) })));
}

const register = (address: string, name: string) =>
  fetch(`${base}/oauth/registro`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": address },
    body: JSON.stringify({ client_name: name, redirect_uris: [REDIRECT] }),
  });

const garbageToken = (address: string) =>
  fetch(`${base}/oauth/token`, { method: "POST", headers: { "x-forwarded-for": address }, body: "" });

const callsOf = async (address: string, bucket?: string) => {
  const rows = await admin`
    select coalesce(sum(calls), 0)::int as calls from goals.oauth_calls
    where (${bucket ?? null}::text is null or bucket = ${bucket ?? null}) and source = ${fingerprint(callerAddress({ headers: new Headers({ "x-forwarded-for": address }) }))}`;

  return rows[0].calls as number;
};

function assertRefused(response: Response, ceiling: number): void {
  assert.equal(response.status, 429);
  const wait = response.headers.get("retry-after") ?? "";
  assert.match(wait, /^\d+$/, "Retry-After is not whole seconds");
  assert.ok(Number(wait) >= 1 && Number(wait) <= ceiling, `Retry-After ${wait} outside 1..${ceiling}`);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-expose-headers"), "Retry-After");
  assert.equal(response.headers.get("cache-control"), "no-store");
}

before(async () => {
  stubServerOnly();
  ({ fingerprint } = await import("@/lib/mcp/tokens"));
  ({ callerAddress } = await import("@/lib/oauth/throttle"));
});

after(async () => {
  try {
    await admin`delete from goals.oauth_clients where client_name like ${`limits-${run}-%`}`;
    for (const source of sources) await admin`delete from goals.oauth_calls where source = ${source}`;
  } finally {
    await door.end();
    await admin.end();
  }
});

test("ten registrations from one address answer 201, the eleventh 429 and leaves no row", async () => {
  await outwait(3600, 60);
  const a = `${prefix()}::1`;
  remember(a);
  for (let n = 0; n < 10; n += 1) {
    const response = await register(a, `limits-${run}-a${n}`);
    assert.equal(response.status, 201, `registration ${n + 1}`);
    await response.text();
  }
  const refused = await register(a, `limits-${run}-refused`);
  assertRefused(refused, 3600);
  assert.deepEqual(await refused.json(), { error: "too_many_requests" });
  const rows = await admin`select id from goals.oauth_clients where client_name = ${`limits-${run}-refused`}`;
  assert.equal(rows.length, 0, "the refused call left its client");

  const sibling = a.replace(/::1$/, ":0:0:0:2");
  remember(sibling);
  const second = await register(sibling, `limits-${run}-sibling`);
  assertRefused(second, 3600);
  const rowsSibling = await admin`select id from goals.oauth_clients where client_name = ${`limits-${run}-sibling`}`;
  assert.equal(rowsSibling.length, 0);

  const b = `${prefix()}::1`;
  remember(b);
  const other = await register(b, `limits-${run}-b`);
  assert.equal(other.status, 201, "another address was refused");
  await other.text();
});

test("thirty garbage token requests answer 400, the thirty-first 429", async () => {
  await outwait(300, 30);
  const c = `${prefix()}::1`;
  remember(c);
  for (let n = 0; n < 30; n += 1) {
    const response = await garbageToken(c);
    assert.equal(response.status, 400, `token request ${n + 1}`);
    await response.text();
  }
  assertRefused(await garbageToken(c), 300);
});

test("a preflight is never counted", async () => {
  const d = `${prefix()}::1`;
  remember(d);
  for (const path of ["/oauth/registro", "/oauth/token"]) {
    for (let n = 0; n < 40; n += 1) {
      const response = await fetch(`${base}${path}`, { method: "OPTIONS", headers: { "x-forwarded-for": d } });
      assert.equal(response.status, 204);
    }
  }
  assert.equal(await callsOf(d), 0, "an OPTIONS moved the counter");
  const first = await garbageToken(d);
  assert.equal(first.status, 400);
  await first.text();
  assert.equal(await callsOf(d), 1);
});

test("a token request naming a metadata URL spends the registration limit before it fetches", async () => {
  await outwait(3600, 60);
  const e = `${prefix()}::1`;
  remember(e);
  // A public literal that answers nothing: the claim is all that is observed.
  const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: "plr_x", client_id: "https://192.0.2.1/client.json" });
  const answers = await Promise.all(
    Array.from({ length: 12 }, () =>
      fetch(`${base}/oauth/token`, { method: "POST", headers: { "x-forwarded-for": e }, body }).then(async (response) => {
        await response.text();
        return response.status;
      }),
    ),
  );
  assert.ok(answers.every((status) => status === 400), `answers ${answers}`);
  assert.equal(await callsOf(e, "register"), 12, "the metadata read did not claim the register bucket");
  assert.equal(await callsOf(e, "token"), 12);
});

test("the counter table grants nothing to the API roles", async () => {
  const grants = await admin`
    select grantee, privilege_type from information_schema.role_table_grants
    where table_schema = 'goals' and table_name = 'oauth_calls'
      and grantee in ('anon', 'authenticated', 'service_role')`;
  assert.deepEqual(grants.map((row) => `${row.grantee}:${row.privilege_type}`), []);
});

test("registering keeps at most one hundred unused clients, dropping the oldest, and spares one with a code", async () => {
  const rollback = new Error("rollback");
  const name = `limits-${run}-evict`;
  try {
    await admin.begin(async (tx) => {
      for (let n = 0; n < 100; n += 1) {
        await tx`
          insert into goals.oauth_clients (client_name, redirect_uris, created_at)
          values (${`limits-${run}-old${n}`}, ${[REDIRECT]}, now() - interval '23 hours' - ${n} * interval '1 second')`;
      }
      const person = randomUUID();
      await tx`
        insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
        values (${person}, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
                ${`harness-limits-${person}@example.invalid`}, now(), now())`;
      const [held] = await tx`
        insert into goals.oauth_clients (client_name, redirect_uris, created_at)
        values (${`limits-${run}-held`}, ${[REDIRECT]}, now() - interval '23 hours' - interval '1000 seconds')
        returning id`;
      await tx`
        insert into goals.oauth_codes (user_id, client_id, code_hash, code_challenge, redirect_uri, resource)
        values (${person}, ${held.id}, ${randomBytes(32)}, 'c', ${REDIRECT}, 'r')`;

      const [made] = await tx`select goals.oauth_register_client(${name}, ${[REDIRECT]}::text[], null) as id`;
      const unused = await tx`
        select c.id, c.client_name from goals.oauth_clients c
        where not exists (select 1 from goals.oauth_codes k where k.client_id = c.id)
          and not exists (select 1 from goals.oauth_refresh r where r.client_id = c.id)`;
      assert.equal(unused.length, 100, "the ceiling is not exactly one hundred");
      assert.ok(unused.some((row) => row.id === made.id), "the new client was dropped");
      assert.ok(!unused.some((row) => row.client_name === `limits-${run}-old99`), "the oldest unused client survived");
      const kept = await tx`select 1 from goals.oauth_clients where id = ${held.id}`;
      assert.equal(kept.length, 1, "the client with a code was evicted");
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});
