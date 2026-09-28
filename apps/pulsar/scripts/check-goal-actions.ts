// Proves `renameGoal`'s (`app/actions/plan.ts`, RP-23) own two guards from
// outside the browser — the same door `scripts/harness/seed-goal.ts` already
// opens (verbatim comment there): every action here is `"use server"`, which
// the Next compiler reads at build time and a plain script never sees, so
// imported directly these run as the ordinary async functions they are.
// `server-only`, `next/headers` and `next/cache` are stubbed the same way,
// before the first `@/`-rooted import, and the real session cookie
// `harness:mint-session` left standing is what `getPerson()` sees — nothing
// here fabricates a claim.
//
// Neither case below writes a row. A goalId that names no goal at all
// matches nothing in the `UPDATE ... WHERE`, so the guard this proves
// (`if (renamed.length === 0) return notFound`) is the only thing standing
// between that call and a false "ok: true" — no goal was ever touched to
// clean up after. A goalId that fails `z.uuid()` never reaches the database
// at all: the guard this proves (`if (!parsed.success) return ...`) is what
// keeps `parsed.data` — absent on a failed `safeParse` — from being read and
// throwing before any statement is sent.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { resolve } from "node:path";
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

function sessionFile(): string {
  return resolve(process.cwd(), `private/session-${lane}.json`);
}

type StoredCookie = { name: string; value: string };

function loadCookies(): StoredCookie[] {
  const file = sessionFile();
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

function installStubs(cookies: StoredCookie[]): void {
  const untyped = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = untyped._load;
  untyped._load = (request, parent, isMain) => {
    if (request === "server-only") return {};
    if (request === "next/headers") {
      return { cookies: async () => ({ getAll: () => cookies, set() {} }) };
    }
    if (request === "next/cache") {
      return { revalidatePath() {} };
    }
    return originalLoad(request, parent, isMain);
  };
}

// `node --test` runs a CommonJS-compiled entry, which cannot carry a
// top-level `await` — installed and imported in `before`, the same ordering
// `installStubs` demands (before the first `@/`-rooted import), just run
// from inside a hook instead of at module scope.
let renameGoal: typeof import("@/app/actions/plan").renameGoal;
let createGoal: typeof import("@/app/actions/plan").createGoal;
let createOneOff: typeof import("@/app/actions/one-offs").createOneOff;
let declareFact: typeof import("@/app/actions/facts").declareFact;
let todayInZone: typeof import("@/lib/zone").todayInZone;
let PAST_DAY_LIMIT: number;

// Whole civil days added to a `YYYY-MM-DD` string, by midday UTC — the same
// technique `scripts/harness/seed-goal.ts`'s own `addDays` uses, so a test
// day never drifts the way a naive `Date` constructor would.
function shiftDay(day: string, delta: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(date);
}

// The session pooler, bypassing RLS the same way `e2e/fixtures.ts` does for
// its own fixtures — never the app's own `DATABASE_URL` role. Only fixture
// setup runs on it: every `declareFact` call below still goes through
// `withGoalsDb`, as `authenticated`, which is the door RP-06's own Done
// criterion asks to be proven.
const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });

let today: string;
let personId: string;
// A tap commitment born ten days ago and never retired: old enough that
// every day this file declares against it — up to `PAST_DAY_LIMIT` back —
// falls on or after its own creation.
let oldCommitmentId: string;
// A tap commitment born three days ago: young enough that a day within
// `PAST_DAY_LIMIT` can still fall before it was created.
let youngCommitmentId: string;
// A tap commitment born ten days ago and retired two days ago: old enough at
// birth, retired recently enough that a day within `PAST_DAY_LIMIT` can still
// fall after it.
let retiredCommitmentId: string;
let oneOffId: string;

before(async () => {
  installStubs(loadCookies());
  ({ renameGoal, createGoal } = await import("@/app/actions/plan"));
  ({ createOneOff } = await import("@/app/actions/one-offs"));
  ({ declareFact } = await import("@/app/actions/facts"));
  ({ todayInZone } = await import("@/lib/zone"));
  ({ PAST_DAY_LIMIT } = await import("@/lib/validation/fact"));

  const { getPerson } = await import("@/lib/session");
  const person = await getPerson();
  if (!person) throw new Error("no settled session — mint-session.ts's cookie did not verify");
  personId = person.id;
  today = todayInZone();

  const goal = await createGoal({ name: "RP-06 fixture", horizon: shiftDay(today, 60) });
  if (!goal.ok) throw new Error(`createGoal: ${goal.error}`);

  // `created_at`/`retired_at` at birth are out of `authenticated`'s own
  // grant (`db/migrations/0000_mighty_pet_avengers.sql`: "a commitment is
  // born live") and no server action offers them either, so a backdated
  // fixture can only be seeded through the session pooler, never through
  // `addCommitment`.
  const [old] = await sql<{ id: string }[]>`
    insert into goals.commitments (user_id, goal_id, name, cadence_kind, satisfaction, created_at)
    values (${personId}, ${goal.goalId}, 'RP-06 fixture: hace 10 días', 'daily', 'tap', now() - interval '10 days')
    returning id`;
  oldCommitmentId = old.id;

  const [young] = await sql<{ id: string }[]>`
    insert into goals.commitments (user_id, goal_id, name, cadence_kind, satisfaction, created_at)
    values (${personId}, ${goal.goalId}, 'RP-06 fixture: hace 3 días', 'daily', 'tap', now() - interval '3 days')
    returning id`;
  youngCommitmentId = young.id;

  const [retired] = await sql<{ id: string }[]>`
    insert into goals.commitments (user_id, goal_id, name, cadence_kind, satisfaction, created_at, retired_at)
    values (${personId}, ${goal.goalId}, 'RP-06 fixture: retirado', 'daily', 'tap', now() - interval '10 days', now() - interval '2 days')
    returning id`;
  retiredCommitmentId = retired.id;

  const oneOff = await createOneOff({ goalId: goal.goalId, name: "RP-06 fixture: suelta", day: today });
  if (!oneOff.ok) throw new Error(`createOneOff: ${oneOff.error}`);
  oneOffId = oneOff.oneOffId;
});

after(async () => {
  await sql.end();
});

test("renameGoal: a goalId that names no goal is reported notFound, not a false ok:true", async () => {
  const result = await renameGoal({ goalId: randomUUID(), name: "meta ajena" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "plan.errors.notFound");
});

test("renameGoal: a goalId that fails z.uuid() is refused gracefully, never thrown", async () => {
  await assert.doesNotReject(() => renameGoal({ goalId: "not-a-uuid", name: "meta ajena" }));
  const result = await renameGoal({ goalId: "not-a-uuid", name: "meta ajena" });
  assert.equal(result.ok, false);
});

// RP-06: `declareFact` writes for a day already past.
test("declareFact: a tap for yesterday lands with day=yesterday and written_at=today; a repeat leaves one row", async () => {
  const yesterday = shiftDay(today, -1);

  const first = await declareFact({ commitmentId: oldCommitmentId, day: yesterday });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  // The authenticated INSERT this Done criterion asks to be proven: it
  // landed, under the app's own role, with a past `day`.
  const second = await declareFact({ commitmentId: oldCommitmentId, day: yesterday });
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.factId, first.factId);

  const rows = await sql<{ id: string; day: string; writtenAtDay: string }[]>`
    select id, day::text as day,
           (written_at at time zone 'America/Bogota')::date::text as "writtenAtDay"
    from goals.facts where commitment_id = ${oldCommitmentId} and day = ${yesterday}`;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, first.factId);
  assert.equal(rows[0].day, yesterday);
  assert.equal(rows[0].writtenAtDay, today);
});

test("declareFact: PAST_DAY_LIMIT days back is accepted, one more is refused", async () => {
  const atLimit = shiftDay(today, -PAST_DAY_LIMIT);
  const accepted = await declareFact({ commitmentId: oldCommitmentId, day: atLimit });
  assert.equal(accepted.ok, true);

  const pastLimit = shiftDay(today, -(PAST_DAY_LIMIT + 1));
  const refused = await declareFact({ commitmentId: oldCommitmentId, day: pastLimit });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.error, "day.errors.dayTooOld");
});

test("declareFact: a day after today is refused with its own key, and writes no row", async () => {
  const tomorrow = shiftDay(today, 1);
  const [before_] = await sql<{ count: string }[]>`
    select count(*)::text as count from goals.facts
    where commitment_id = ${oldCommitmentId} and day = ${tomorrow}`;

  const result = await declareFact({ commitmentId: oldCommitmentId, day: tomorrow });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "day.errors.dayFuture");

  const [after_] = await sql<{ count: string }[]>`
    select count(*)::text as count from goals.facts
    where commitment_id = ${oldCommitmentId} and day = ${tomorrow}`;
  assert.equal(after_.count, before_.count);
});

test("declareFact: a day before the commitment's own creation is refused", async () => {
  // Within PAST_DAY_LIMIT (so `dayTooOld` never fires), before `youngCommitmentId`'s
  // own creation three days ago.
  const tooEarly = shiftDay(today, -5);
  const result = await declareFact({ commitmentId: youngCommitmentId, day: tooEarly });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "day.errors.dayBeforeCommitment");
});

test("declareFact: a day after the commitment's own retirement is refused", async () => {
  // Within PAST_DAY_LIMIT and after `retiredCommitmentId`'s own creation ten
  // days ago, but after its retirement two days ago.
  const afterRetirement = shiftDay(today, -1);
  const result = await declareFact({ commitmentId: retiredCommitmentId, day: afterRetirement });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "day.errors.dayAfterRetired");
});

test("declareFact: a day on a one-off is refused — a one-off is done on the day it is done", async () => {
  const result = await declareFact({ oneOffId, day: shiftDay(today, -1) });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "day.errors.dayOnOneOff");
});

test("declareFact: a malformed day is refused gracefully, never thrown", async () => {
  await assert.doesNotReject(() => declareFact({ commitmentId: oldCommitmentId, day: "2026-13-40" }));
  const result = await declareFact({ commitmentId: oldCommitmentId, day: "2026-13-40" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "day.errors.dayInvalid");
});
