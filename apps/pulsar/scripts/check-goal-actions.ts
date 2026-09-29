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

// Every path the `next/cache` stub received, in call order.
const revalidated: string[] = [];

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
      return { revalidatePath: (path: string) => void revalidated.push(path) };
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
let scheduleOneOff: typeof import("@/app/actions/one-offs").scheduleOneOff;
let moveHorizon: typeof import("@/app/actions/plan").moveHorizon;
let addPhase: typeof import("@/app/actions/plan").addPhase;
let addCommitment: typeof import("@/app/actions/plan").addCommitment;
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
let fixtureGoalId: string;

before(async () => {
  installStubs(loadCookies());
  ({ renameGoal, createGoal, moveHorizon, addPhase, addCommitment } = await import("@/app/actions/plan"));
  ({ createOneOff, scheduleOneOff } = await import("@/app/actions/one-offs"));
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
  fixtureGoalId = goal.goalId;

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
  // Cascades to the fixture's commitments, one-off and facts.
  if (fixtureGoalId) await sql`delete from goals.goals where id = ${fixtureGoalId}`;
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

test("declareFact: a day on the commitment's own creation day is accepted and lands there", async () => {
  // `youngCommitmentId` was born three days ago, at this very time of day.
  const bornOn = shiftDay(today, -3);
  const result = await declareFact({ commitmentId: youngCommitmentId, day: bornOn });
  assert.equal(result.ok, true);
  const rows = await sql<{ day: string }[]>`
    select day::text as day from goals.facts where commitment_id = ${youngCommitmentId}`;
  assert.deepEqual(
    rows.map((row) => row.day),
    [bornOn],
  );
});

test("declareFact: a day on the commitment's own retirement day is accepted and lands there", async () => {
  // `retiredCommitmentId` was retired two days ago, at this very time of day.
  const retiredOn = shiftDay(today, -2);
  const result = await declareFact({ commitmentId: retiredCommitmentId, day: retiredOn });
  assert.equal(result.ok, true);
  const rows = await sql<{ day: string }[]>`
    select day::text as day from goals.facts where commitment_id = ${retiredCommitmentId}`;
  assert.deepEqual(
    rows.map((row) => row.day),
    [retiredOn],
  );
});

test("declareFact: day = today is accepted and lands on today", async () => {
  const result = await declareFact({ commitmentId: oldCommitmentId, day: today });
  assert.equal(result.ok, true);
  const rows = await sql<{ day: string }[]>`
    select day::text as day from goals.facts where commitment_id = ${oldCommitmentId} and day = ${today}`;
  assert.equal(rows.length, 1);
});

test("declareFact: a past-day fact revalidates /semana and its own /dia/<day>", async () => {
  const day = shiftDay(today, -4);
  revalidated.length = 0;
  const result = await declareFact({ commitmentId: oldCommitmentId, day });
  assert.equal(result.ok, true);
  assert.ok(revalidated.includes("/semana"), `revalidated: ${revalidated.join(", ")}`);
  assert.ok(revalidated.includes(`/dia/${day}`), `revalidated: ${revalidated.join(", ")}`);
});

// Module 66: a one-off's day and a goal's horizon. Everything seeded here is
// deleted by id in `finally`, never by a sweep.
async function oneOffDay(id: string): Promise<string | null> {
  const [row] = await sql<{ day: string | null }[]>`
    select day::text as day from goals.one_offs where id = ${id}`;
  return row.day;
}

test("createOneOff: no day lands a null day; yesterday is refused and writes no row; tomorrow lands tomorrow", async () => {
  const ids: string[] = [];
  try {
    const dayless = await createOneOff({ name: "RP-21 sin día", day: null });
    assert.equal(dayless.ok, true);
    if (!dayless.ok) return;
    ids.push(dayless.oneOffId);
    assert.equal(await oneOffDay(dayless.oneOffId), null);

    const refused = await createOneOff({ name: "RP-19 ayer", day: shiftDay(today, -1) });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.error, "day.errors.oneOffDayPast");
    const [{ count }] = await sql<{ count: string }[]>`
      select count(*)::text as count from goals.one_offs
      where user_id = ${personId} and name = 'RP-19 ayer'`;
    assert.equal(count, "0");

    const tomorrow = shiftDay(today, 1);
    const future = await createOneOff({ name: "RP-19 mañana", day: tomorrow });
    assert.equal(future.ok, true);
    if (!future.ok) return;
    ids.push(future.oneOffId);
    assert.equal(await oneOffDay(future.oneOffId), tomorrow);
  } finally {
    if (ids.length) await sql`delete from goals.one_offs where id in ${sql(ids)}`;
    // The refused write must land nothing; if a regression lets it land, it
    // still does not outlive this test.
    await sql`delete from goals.one_offs where user_id = ${personId} and name = 'RP-19 ayer'`;
  }
});

test("scheduleOneOff: a dayless one gets today; a second call is refused and the day holds; one with a fact is refused", async () => {
  const ids: string[] = [];
  try {
    const made = await createOneOff({ name: "RP-21 por fechar", day: null });
    if (!made.ok) throw new Error(made.error);
    ids.push(made.oneOffId);

    const first = await scheduleOneOff({ oneOffId: made.oneOffId, day: today });
    assert.equal(first.ok, true);
    assert.equal(await oneOffDay(made.oneOffId), today);

    const second = await scheduleOneOff({ oneOffId: made.oneOffId, day: shiftDay(today, 3) });
    assert.equal(second.ok, false);
    if (!second.ok) assert.equal(second.error, "day.errors.oneOffAlreadyDated");
    assert.equal(await oneOffDay(made.oneOffId), today);

    const past = await scheduleOneOff({ oneOffId: made.oneOffId, day: shiftDay(today, -1) });
    assert.equal(past.ok, false);
    if (!past.ok) assert.equal(past.error, "day.errors.oneOffDayPast");

    const missing = await scheduleOneOff({ oneOffId: randomUUID(), day: today });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error, "day.errors.notFound");

    // A dayless one that already carries a fact: seeded through the pooler,
    // since `completeOneOff` never sees a dayless one.
    const [withFact] = await sql<{ id: string }[]>`
      insert into goals.one_offs (user_id, name) values (${personId}, 'RP-21 con hecho') returning id`;
    ids.push(withFact.id);
    await sql`insert into goals.facts (user_id, one_off_id, day) values (${personId}, ${withFact.id}, ${today})`;
    const refused = await scheduleOneOff({ oneOffId: withFact.id, day: today });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.error, "day.errors.oneOffHasFact");
    assert.equal(await oneOffDay(withFact.id), null);
  } finally {
    if (ids.length) {
      await sql`delete from goals.facts where one_off_id in ${sql(ids)}`;
      await sql`delete from goals.one_offs where id in ${sql(ids)}`;
    }
  }
});

async function goalHorizon(id: string): Promise<string> {
  const [row] = await sql<{ horizon: string }[]>`
    select horizon::text as horizon from goals.goals where id = ${id}`;
  return row.horizon;
}

test("moveHorizon: moves an own goal; before the last phase, or in the past, is refused and the column holds", async () => {
  const created = await createGoal({ name: "RP-25 horizonte", horizon: shiftDay(today, 60) });
  if (!created.ok) throw new Error(created.error);
  const goalId = created.goalId;
  try {
    await sql`
      insert into goals.phases (user_id, goal_id, aim, starts_on, ends_on)
      values (${personId}, ${goalId}, 'RP-25 fase', ${shiftDay(today, 1)}, ${shiftDay(today, 30)})`;

    revalidated.length = 0;
    const moved = await moveHorizon({ goalId, horizon: shiftDay(today, 90) });
    assert.equal(moved.ok, true);
    assert.equal(await goalHorizon(goalId), shiftDay(today, 90));
    assert.ok(revalidated.includes(`/metas/${goalId}/revision`), revalidated.join(", "));
    assert.ok(revalidated.includes(`/metas/${goalId}`), revalidated.join(", "));

    const stranded = await moveHorizon({ goalId, horizon: shiftDay(today, 20) });
    assert.equal(stranded.ok, false);
    if (!stranded.ok) assert.equal(stranded.error, "goal.errors.horizonBeforePhase");
    assert.equal(await goalHorizon(goalId), shiftDay(today, 90));

    const past = await moveHorizon({ goalId, horizon: today });
    assert.equal(past.ok, false);
    if (!past.ok) assert.equal(past.error, "goal.errors.horizonPast");
    assert.equal(await goalHorizon(goalId), shiftDay(today, 90));
  } finally {
    await sql`delete from goals.goals where id = ${goalId}`;
  }
});

test("moveHorizon: another person's goal answers notFound and is unchanged", async () => {
  const [member] = await sql<{ id: string }[]>`
    select id from auth.users where email = ${`harness-member-${lane}@example.invalid`}`;
  if (!member) throw new Error("no member identity — run harness:token for this lane");
  const [foreign] = await sql<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon)
    values (${member.id}, 'RP-25 ajena', ${shiftDay(today, 60)}) returning id`;
  try {
    const result = await moveHorizon({ goalId: foreign.id, horizon: shiftDay(today, 90) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "plan.errors.notFound");
    assert.equal(await goalHorizon(foreign.id), shiftDay(today, 60));
  } finally {
    await sql`delete from goals.goals where id = ${foreign.id}`;
  }
});

test("scheduleOneOff: a one-off dated after today moves; one dated today is refused; another person's is notFound", async () => {
  const ids: string[] = [];
  const [member] = await sql<{ id: string }[]>`
    select id from auth.users where email = ${`harness-member-${lane}@example.invalid`}`;
  if (!member) throw new Error("no member identity — run harness:token for this lane");
  try {
    const made = await createOneOff({ name: "RP-21 mover", day: shiftDay(today, 1) });
    if (!made.ok) throw new Error(made.error);
    ids.push(made.oneOffId);

    revalidated.length = 0;
    const moved = await scheduleOneOff({ oneOffId: made.oneOffId, day: shiftDay(today, 2) });
    assert.equal(moved.ok, true);
    assert.equal(await oneOffDay(made.oneOffId), shiftDay(today, 2));
    assert.ok(revalidated.includes("/") && revalidated.includes("/sueltas"), revalidated.join(", "));

    const toToday = await scheduleOneOff({ oneOffId: made.oneOffId, day: today });
    assert.equal(toToday.ok, true);
    assert.equal(await oneOffDay(made.oneOffId), today);
    const { loadDay } = await import("@/lib/queries/day");
    const loaded = await loadDay(today);
    assert.ok(loaded.oneOffs.some((o) => o.id === made.oneOffId));

    const dated = await scheduleOneOff({ oneOffId: made.oneOffId, day: shiftDay(today, 3) });
    assert.equal(dated.ok, false);
    if (!dated.ok) assert.equal(dated.error, "day.errors.oneOffAlreadyDated");
    assert.equal(await oneOffDay(made.oneOffId), today);

    const [withFact] = await sql<{ id: string }[]>`
      insert into goals.one_offs (user_id, name, day)
      values (${personId}, 'RP-21 futura con hecho', ${shiftDay(today, 1)}) returning id`;
    ids.push(withFact.id);
    await sql`insert into goals.facts (user_id, one_off_id, day) values (${personId}, ${withFact.id}, ${today})`;
    const refused = await scheduleOneOff({ oneOffId: withFact.id, day: shiftDay(today, 2) });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.error, "day.errors.oneOffHasFact");
    assert.equal(await oneOffDay(withFact.id), shiftDay(today, 1));

    const [foreign] = await sql<{ id: string }[]>`
      insert into goals.one_offs (user_id, name, day)
      values (${member.id}, 'RP-21 ajena', ${shiftDay(today, 1)}) returning id`;
    ids.push(foreign.id);
    const other = await scheduleOneOff({ oneOffId: foreign.id, day: shiftDay(today, 2) });
    assert.equal(other.ok, false);
    if (!other.ok) assert.equal(other.error, "day.errors.notFound");
    assert.equal(await oneOffDay(foreign.id), shiftDay(today, 1));
  } finally {
    if (ids.length) {
      await sql`delete from goals.facts where one_off_id in ${sql(ids)}`;
      await sql`delete from goals.one_offs where id in ${sql(ids)}`;
    }
  }
});

test("addPhase and addCommitment: an ended or archived goal is refused as a goal that is gone and writes nothing; an open one lands both", async () => {
  const open = await createGoal({ name: "RP-88 abierta", horizon: shiftDay(today, 60) });
  if (!open.ok) throw new Error(open.error);
  const [ended] = await sql<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, created_at)
    values (${personId}, 'RP-88 terminada', ${today}, now() - interval '20 days') returning id`;
  const [archived] = await sql<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon, archived_at)
    values (${personId}, 'RP-88 archivada', ${shiftDay(today, 60)}, now()) returning id`;
  const phase = (goalId: string) => ({
    goalId,
    aim: "RP-88 fase",
    startsOn: shiftDay(today, -10),
    endsOn: shiftDay(today, -3),
  });
  const commitment = (goalId: string) => ({
    goalId,
    name: "RP-88 compromiso",
    cadenceKind: "daily" as const,
    satisfaction: "tap" as const,
  });
  const written = async (goalId: string) => {
    const [row] = await sql<{ phases: number; commitments: number }[]>`
      select (select count(*)::int from goals.phases where goal_id = ${goalId}) as phases,
             (select count(*)::int from goals.commitments where goal_id = ${goalId}) as commitments`;
    return row;
  };
  try {
    for (const goalId of [ended.id, archived.id]) {
      const refusedPhase = await addPhase(phase(goalId));
      assert.equal(refusedPhase.ok, false);
      if (!refusedPhase.ok) assert.equal(refusedPhase.error, "plan.errors.goalNotFound");

      const refusedCommitment = await addCommitment(commitment(goalId));
      assert.equal(refusedCommitment.ok, false);
      if (!refusedCommitment.ok) assert.equal(refusedCommitment.error, "plan.errors.goalNotFound");

      assert.deepEqual(await written(goalId), { phases: 0, commitments: 0 });
    }

    const landedPhase = await addPhase({ ...phase(open.goalId), startsOn: shiftDay(today, 1), endsOn: shiftDay(today, 8) });
    assert.equal(landedPhase.ok, true);
    const landedCommitment = await addCommitment(commitment(open.goalId));
    assert.equal(landedCommitment.ok, true);
    assert.deepEqual(await written(open.goalId), { phases: 1, commitments: 1 });
  } finally {
    await sql`delete from goals.goals where id in ${sql([open.goalId, ended.id, archived.id])}`;
  }
});
