// Drives `claimModelCall` and `settleModelCall` (`lib/import/spend.ts`,
// RNP-13) under two persons: the lane's own pair of identities, read off
// `auth.users`, so no row is minted here. `@repo/supabase-auth`'s
// `verifiedClaims` is stubbed to answer whichever person the test names;
// everything past it (the settle, the role, the policies) is the real thing.
// The pooler reads rows back and deletes every call the file created.
import assert from "node:assert/strict";
import Module from "node:module";
import { after, before, test } from "node:test";

import postgres from "postgres";

function laneNumber(): number {
  const raw = process.env.HARNESS_LANE?.trim();
  if (!raw) return 1;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`HARNESS_LANE must be a positive integer, not "${raw}"`);
  }
  return Number(raw);
}

const lane = laneNumber();
const suffix = lane === 1 ? "" : `-${lane}`;

type Person = { id: string; email: string };
let current: Person;

function installStubs(): void {
  const untyped = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = untyped._load;
  untyped._load = (request, parent, isMain) => {
    if (request === "server-only") return {};
    if (request === "next/headers") {
      return { cookies: async () => ({ getAll: () => [], set() {} }) };
    }
    if (request === "@repo/supabase-auth") {
      const real = originalLoad(request, parent, isMain) as Record<string, unknown>;
      return {
        ...real,
        verifiedClaims: async () => ({
          claims: { sub: current.id, email: current.email, role: "authenticated" },
          user: current,
        }),
      };
    }
    return originalLoad(request, parent, isMain);
  };
}

const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });

let first: Person;
let second: Person;
let today: string;
let claimModelCall: typeof import("@/lib/import/spend").claimModelCall;
let settleModelCall: typeof import("@/lib/import/spend").settleModelCall;
let cap: number;
const claimed: string[] = [];

async function person(email: string): Promise<Person> {
  const [row] = await sql<{ id: string }[]>`select id from auth.users where email = ${email}`;
  if (!row) throw new Error(`no ${email} in auth.users — run harness:token for lane ${lane}`);
  return { id: row.id, email };
}

before(async () => {
  installStubs();
  ({ claimModelCall, settleModelCall } = await import("@/lib/import/spend"));
  ({ MODEL_CALLS_DAILY_CAP: cap } = await import("@/lib/import/spend"));
  const { todayInZone } = await import("@/lib/zone");
  today = todayInZone();
  first = await person(`harness-member${suffix}@example.invalid`);
  second = await person(`harness${suffix}@example.invalid`);
  // Clear anything an earlier aborted run left for today.
  await sql`delete from goals.model_calls where user_id in ${sql([first.id, second.id])} and model = 'RNP-13 fixture'`;
  const [{ count }] = await sql<{ count: string }[]>`
    select count(*) from goals.model_calls where user_id in ${sql([first.id, second.id])} and day = ${today}`;
  if (Number(count) !== 0) throw new Error(`the lane's identities already hold ${count} calls today`);
});

after(async () => {
  if (claimed.length > 0) await sql`delete from goals.model_calls where id in ${sql(claimed)}`;
  await sql.end();
});

test("claimModelCall: the cap is 10; ten claims land and the eleventh answers null", async () => {
  assert.equal(cap, 10);
  current = first;
  for (let i = 0; i < 10; i++) {
    const call = await claimModelCall("RNP-13 fixture", "paste");
    assert.ok(call, `claim ${i + 1} landed`);
    claimed.push(call.id);
  }
  assert.equal(await claimModelCall("RNP-13 fixture", "paste"), null);
});

test("claimModelCall: a second person still claims after the first hit the cap", async () => {
  current = second;
  const call = await claimModelCall("RNP-13 fixture", "file");
  assert.ok(call);
  claimed.push(call.id);
});

test("claimModelCall: rows read back under their owner, the zone's day, source and no outcome", async () => {
  const rows = await sql<{ userId: string; day: string; source: string; outcome: string | null }[]>`
    select user_id as "userId", day::text as day, source, outcome
    from goals.model_calls where id in ${sql(claimed)}`;
  assert.equal(rows.length, 11);
  assert.equal(rows.filter((r) => r.userId === first.id).length, 10);
  assert.equal(rows.filter((r) => r.userId === second.id).length, 1);
  for (const row of rows) {
    assert.equal(row.day, today);
    assert.equal(row.outcome, null);
  }
  assert.equal(rows.find((r) => r.userId === second.id)?.source, "file");
});

test("settleModelCall: writes the tokens and the outcome on the person's own row", async () => {
  current = first;
  assert.equal(await settleModelCall(claimed[0], { inputTokens: 120, outputTokens: 45, outcome: "ok" }), true);
  const [row] = await sql<{ i: number; o: number; outcome: string }[]>`
    select input_tokens as i, output_tokens as o, outcome from goals.model_calls where id = ${claimed[0]}`;
  assert.deepEqual(row, { i: 120, o: 45, outcome: "ok" });
});

test("settleModelCall: another person's settle of that row touches 0 rows", async () => {
  current = second;
  assert.equal(await settleModelCall(claimed[0], { inputTokens: 1, outputTokens: 2, outcome: "failed" }), false);
  const [row] = await sql<{ i: number; o: number; outcome: string }[]>`
    select input_tokens as i, output_tokens as o, outcome from goals.model_calls where id = ${claimed[0]}`;
  assert.deepEqual(row, { i: 120, o: 45, outcome: "ok" });
});
