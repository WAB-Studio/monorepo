// Proves RNP-03 and RNP-04 against the seeded person of module 20, the way
// `scripts/harness/seed-goal.ts` reaches a server action: by stubbing the
// three modules that only exist inside Next (`server-only`, `next/headers`,
// `next/cache`) before the first `@/`-rooted import, and by redeeming the
// same `private/session-<lane>.json` cookie `mint-session.ts` left standing.
// Nothing here fabricates a claim — `getPerson()` sees exactly the identity
// that cookie names.
//
// The statement count comes from the driver, not from reading `day.ts`:
// `postgres`'s own `debug` option fires once for every statement it puts on
// the wire, `begin` and `commit` included (`apps/orbit/scripts/harness/
// instrument.ts`'s own technique). Module 8's done criterion names "four
// statements... two settles and two queries", so `begin`/`commit` are
// counted off the wire and then excluded before the assertion — they are a
// round trip each, but never a statement `day.ts` chose to send. Excluding
// them is bounded, not blind: each connection must bracket exactly one
// `begin` and one `commit`, never a `rollback` and never a second one of
// either — an extra transaction-control statement is itself a round trip
// `day.ts` did not choose to spend, and independent validation found this
// file originally let it hide inside the very count it was supposed to
// bound. Every run asserts the bracket, cold included: only the overlap
// claim is cold-exempt, never the shape of the transaction or its count.
// The type-fetch `postgres` sends on a connection's first-ever use is netted
// out the same bounded way, by an exact match on its own text (never a bare
// substring, which let a statement merely mentioning `pg_catalog.pg_type`
// net itself out too) and capped at one per connection, zero on every warm
// run. Five consecutive warm calls are asserted, not one or two: a fix that
// only holds for the first couple is a fix a later screen the same minute
// would still be paying for.
//
// The degraded scenario needs a fresh module graph: `lib/evidence/
// registry.ts` builds its reader map once, at import time, and a process
// that already ran the real reader cannot un-import it. This file re-execs
// itself as a child with `--degraded-child`, the one place `./reading-
// lookups` is stubbed to reject, and reads the child's one line of JSON back.
import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { resolve } from "node:path";

// The session pooler, loaded here before `installStubs` runs so it is never
// the wrapped, counted `postgres` — used only to delete a probe's own goal.
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

// `mint-session.ts`'s own file, read the same way `seed-goal.ts` reads it.
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

type DebugCall = { at: number; connection: number; query: string; parameters: unknown[] };

const wireCalls: DebugCall[] = [];

type PostgresFactory = (url: string, options?: Record<string, unknown>) => unknown;

/**
 * Installs every stub `@/lib/queries/day.ts`'s own import chain needs to run
 * outside Next, `installReadingLookupsStub` included when `degraded` is true.
 * Has to run before the first `@/`-rooted import — `seed-goal.ts`'s own
 * warning, word for word: `_load` binds each `require` once, and a module
 * already required is a module this cannot reach again.
 */
function installStubs(cookies: StoredCookie[], degraded: boolean): void {
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
    // The one reader `lib/evidence/registry.ts` names today (RNP-10). Only
    // that file imports this relative specifier, so matching the bare string
    // carries no risk of catching an unrelated module.
    if (degraded && request === "./reading-lookups") {
      return {
        readReadingLookups: async () => {
          throw new Error("check-day.ts: simulated reading-lookups failure");
        },
      };
    }
    // Wraps `postgres` itself once, so every statement `db/client.ts`'s pool
    // sends is counted — `prepare`, `max` and `idle_timeout` pass through
    // untouched, the pool under measurement stays the pool `loadDay` gets.
    if (request === "postgres") {
      const real = originalLoad(request, parent, isMain) as PostgresFactory;
      const wrapped: PostgresFactory = (url, options) =>
        real(url, {
          ...options,
          debug: (connection: number, query: string, parameters: unknown[]) => {
            wireCalls.push({ at: Date.now(), connection, query, parameters });
          },
        });
      return wrapped;
    }
    return originalLoad(request, parent, isMain);
  };
}

function normalizeStatement(query: string): string {
  return query.trim().toLowerCase();
}

// `postgres`'s own default `fetch_types: true` (never set in `db/client.ts`,
// and this file must not set it either) sends exactly this query the first
// time a physical connection is ever used — read verbatim off
// `node_modules/postgres/src/connection.js`'s own `fetchArrayTypes`, not
// guessed at. An exact match on the whole statement, whitespace collapsed:
// a bare `pg_catalog.pg_type` substring match let a statement that merely
// *mentions* that catalog (independent validation's own
// `select count(*) from pg_catalog.pg_type`) net itself out of the count
// it was supposed to inflate.
const TYPE_FETCH_QUERY_TEXT =
  "select b.oid, b.typarray from pg_catalog.pg_type a left join pg_catalog.pg_type b " +
  "on b.oid = a.typelem where a.typcategory = 'a' group by b.oid, b.typarray order by b.oid";

function isTypeFetchText(query: string): boolean {
  return query.replace(/\s+/g, " ").trim().toLowerCase() === TYPE_FETCH_QUERY_TEXT;
}

// The UTC instant that reads as `hour:minute` in `zone` on `day` — read off
// `Intl`'s own offset for that day (`timeZoneName: "longOffset"`, e.g.
// "GMT-05:00"), never a hardcoded "-05:00": the same authority `lib/zone.ts`
// already defers every civil-day render to. One pass is exact for a zone
// whose offset does not move within a day, which is all this ever asks of it.
function instantAtLocalTime(day: string, hour: number, minute: number, zone: string): Date {
  const offsetText = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "longOffset",
  })
    .formatToParts(new Date(`${day}T12:00:00Z`))
    .find((part) => part.type === "timeZoneName")?.value;

  const match = offsetText ? /^GMT([+-])(\d{2}):(\d{2})$/.exec(offsetText) : null;
  if (!match) throw new Error(`instantAtLocalTime: unreadable offset "${offsetText}" for ${zone}`);
  const [, sign, offsetHours, offsetMinutes] = match;
  const offsetMinutesTotal =
    (sign === "-" ? -1 : 1) * (Number(offsetHours) * 60 + Number(offsetMinutes));

  const instant = new Date(`${day}T00:00:00Z`);
  instant.setUTCMinutes(instant.getUTCMinutes() + hour * 60 + minute - offsetMinutesTotal);
  return instant;
}

// The settle statement's third `set_config` argument is the search path
// `withGoalsDb`/`withReadingDb` chose (`lib/session.ts`) — read from
// `parameters`, not guessed from the query text, which carries `$1`/`$2`/`$3`
// placeholders and no values.
function labelConnection(calls: DebugCall[]): string {
  const settle = calls.find((call) => /set_config/i.test(call.query));
  const searchPath = typeof settle?.parameters[2] === "string" ? settle.parameters[2] : "";
  if (searchPath.startsWith("goals")) return "goals";
  if (searchPath.startsWith("reading")) return "reading";
  return "unknown";
}

function groupByConnection(calls: DebugCall[]): Map<number, DebugCall[]> {
  const groups = new Map<number, DebugCall[]>();
  for (const call of calls) {
    const list = groups.get(call.connection) ?? [];
    list.push(call);
    groups.set(call.connection, list);
  }
  return groups;
}

type GroupAnalysis = {
  connection: number;
  label: string;
  window: { start: number; end: number };
  beginCount: number;
  commitCount: number;
  rollbackCount: number;
  typeFetchCount: number;
  // Net of the transaction's own bracket and of the type-fetch `postgres`
  // sends on a connection's first-ever use — what `day.ts` itself chose to
  // send, and the only number the "four" assertion is about.
  applicationCount: number;
  bracketOk: boolean;
};

function analyzeGroup(connection: number, calls: DebugCall[]): GroupAnalysis {
  const label = labelConnection(calls);
  const times = calls.map((call) => call.at);
  const window = { start: Math.min(...times), end: Math.max(...times) };

  const beginCount = calls.filter((call) => normalizeStatement(call.query).startsWith("begin")).length;
  const commitCount = calls.filter((call) => normalizeStatement(call.query) === "commit").length;
  const rollbackCount = calls.filter((call) => normalizeStatement(call.query) === "rollback").length;
  const typeFetchCount = calls.filter((call) => isTypeFetchText(call.query)).length;
  const applicationCount = calls.length - beginCount - commitCount - rollbackCount - typeFetchCount;
  const bracketOk = beginCount === 1 && commitCount === 1 && rollbackCount === 0;

  return { connection, label, window, beginCount, commitCount, rollbackCount, typeFetchCount, applicationCount, bracketOk };
}

let failed = false;

function assert(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  if (!ok) failed = true;
}

/**
 * Prints every connection's own window, bracket and statement counts, and
 * asserts on all of it: every connection brackets exactly one `begin` and
 * one `commit`, never a `rollback`, never a second one of either (an extra
 * transaction-control statement is a round trip `day.ts` did not choose to
 * spend, and hiding inside a blind filter is the hole independent
 * validation found); at most one type-fetch statement per connection, and
 * on a warm run none at all — a connection warm enough to be reused has
 * already paid that cost, so a second sighting of it is itself a defect,
 * never a fact to net out a second time; the application statements, net of
 * that bracket and of any legitimate type-fetch, total exactly four —
 * asserted on the cold run too, not only the warm ones; and, only when
 * `isWarm`, the two windows overlap in wall-clock time. `isWarm` is false
 * for the cold run alone: the user's own decided note says a cold process
 * pays a real dial between the two transactions and does not overlap — a
 * timing fact, never a licence to leave the cold run's bracket, its
 * type-fetch cap or its statement count unchecked.
 */
function reportRun(label: string, calls: DebugCall[], isWarm: boolean): void {
  const groups = [...groupByConnection(calls).entries()].map(([connection, groupCalls]) =>
    analyzeGroup(connection, groupCalls),
  );

  const totalApplication = groups.reduce((sum, group) => sum + group.applicationCount, 0);
  const totalTypeFetch = groups.reduce((sum, group) => sum + group.typeFetchCount, 0);

  console.log(
    `\n${label} run — ${calls.length} statement(s) on the wire across ${groups.length} connection(s), ` +
      `${totalApplication} application statement(s), ${totalTypeFetch} type-fetch statement(s)`,
  );
  for (const group of groups) {
    console.log(
      `  ${group.label.padEnd(8)} cid=${group.connection} ` +
        `${new Date(group.window.start).toISOString()} -> ${new Date(group.window.end).toISOString()} ` +
        `(${(group.window.end - group.window.start).toFixed(1)}ms), ` +
        `begin=${group.beginCount} commit=${group.commitCount} rollback=${group.rollbackCount}, ` +
        `application=${group.applicationCount}, type-fetch=${group.typeFetchCount}`,
    );
  }

  const [a, b] = groups.map((group) => group.window);
  const overlaps = a !== undefined && b !== undefined && Math.max(a.start, b.start) < Math.min(a.end, b.end);
  const gapMs =
    a !== undefined && b !== undefined
      ? a.start <= b.start
        ? b.start - a.end
        : a.start - b.end
      : NaN;
  console.log(`  overlap = ${overlaps}${overlaps ? "" : `, gap = ${gapMs.toFixed(1)}ms`}`);

  const badBrackets = groups.filter((group) => !group.bracketOk);
  assert(
    `${label} run's connections bracket exactly one begin and one commit, no rollback`,
    badBrackets.length === 0,
    badBrackets.length === 0
      ? `${groups.length} connection(s), each begin=1 commit=1 rollback=0`
      : badBrackets
          .map(
            (group) =>
              `cid=${group.connection} (${group.label}) begin=${group.beginCount} commit=${group.commitCount} rollback=${group.rollbackCount}`,
          )
          .join("; "),
  );

  const overCapped = groups.filter((group) => group.typeFetchCount > 1);
  assert(
    `${label} run's connections send at most one type-fetch statement each`,
    overCapped.length === 0,
    overCapped.length === 0
      ? `${groups.length} connection(s), each type-fetch <= 1`
      : overCapped.map((group) => `cid=${group.connection} (${group.label}) type-fetch=${group.typeFetchCount}`).join("; "),
  );

  if (isWarm) {
    const unexpectedTypeFetch = groups.filter((group) => group.typeFetchCount > 0);
    assert(
      `${label} run's connections send no type-fetch statement`,
      unexpectedTypeFetch.length === 0,
      unexpectedTypeFetch.length === 0
        ? `${groups.length} connection(s), each type-fetch = 0`
        : unexpectedTypeFetch
            .map((group) => `cid=${group.connection} (${group.label}) type-fetch=${group.typeFetchCount}`)
            .join("; "),
    );
  }

  assert(
    `${label} run issues four application statements, no more`,
    totalApplication === 4,
    `${totalApplication} application statement(s) of ${calls.length} on the wire, ${totalTypeFetch} netted out as type-fetch`,
  );

  if (isWarm) {
    assert(
      `${label} run's two transactions overlap in wall-clock time`,
      overlaps,
      overlaps ? "the second starts before the first ends" : `no overlap, gap = ${gapMs.toFixed(1)}ms`,
    );
  }
}

type DegradedResult = { evidence: string; slotIds: string[] };

// The child's whole report: one line, so a stray `console.log` upstream of it
// (Next's own, a dependency's) never gets parsed as the result.
const DEGRADED_MARKER = "DEGRADED_JSON ";

// The goals transaction's own two statements (its settle, its query) plus
// the reading transaction's one (its settle alone). Measured, not assumed:
// `withReadingDb`'s settle always runs, unconditionally, before `fn(tx)`
// does (`lib/session.ts`'s `withSettledDb`); the stub this file installs for
// `./reading-lookups` throws before it ever touches `tx`, so nothing of the
// reader's own reaches the wire. `sql.begin` answers a thrown callback with
// `rollback`, never `commit` (`node_modules/postgres/src/index.js`'s own
// `begin()`), so the reading connection's bracket is begin+rollback, not
// begin+commit — RNP-03's bound on the failure path is not the happy path's
// shape, but it is still a bound, and this is what a real run of it sends.
const EXPECTED_DEGRADED_APPLICATION_STATEMENTS = 3;

/**
 * The degraded child spawns fresh every time (`runDegradedChildProcess`), so
 * both its connections are cold — each may pay one type-fetch, capped the
 * same way the main run's cold call is. Asserts the goals connection's usual
 * bracket, the reading connection's rolled-back one, and the total
 * application-statement count — the hole independent validation found:
 * `runDegradedChild` counted nothing of its own, so a real extra round trip
 * on the failure path went unnoticed while `REPORT passed`.
 */
function reportDegradedRun(calls: DebugCall[]): void {
  const groups = [...groupByConnection(calls).entries()].map(([connection, groupCalls]) =>
    analyzeGroup(connection, groupCalls),
  );

  const totalApplication = groups.reduce((sum, group) => sum + group.applicationCount, 0);
  const totalTypeFetch = groups.reduce((sum, group) => sum + group.typeFetchCount, 0);

  console.log(
    `\ndegraded child's own wire — ${calls.length} statement(s) across ${groups.length} connection(s), ` +
      `${totalApplication} application statement(s), ${totalTypeFetch} type-fetch statement(s)`,
  );
  for (const group of groups) {
    console.log(
      `  ${group.label.padEnd(8)} cid=${group.connection} begin=${group.beginCount} commit=${group.commitCount} ` +
        `rollback=${group.rollbackCount}, application=${group.applicationCount}, type-fetch=${group.typeFetchCount}`,
    );
  }

  const overCapped = groups.filter((group) => group.typeFetchCount > 1);
  assert(
    "degraded child's connections send at most one type-fetch statement each",
    overCapped.length === 0,
    overCapped.length === 0
      ? `${groups.length} connection(s), each type-fetch <= 1`
      : overCapped.map((group) => `cid=${group.connection} (${group.label}) type-fetch=${group.typeFetchCount}`).join("; "),
  );

  const goalsGroups = groups.filter((group) => group.label === "goals");
  const readingGroups = groups.filter((group) => group.label === "reading");
  assert(
    "degraded child opens exactly one goals connection and one reading connection",
    groups.length === 2 && goalsGroups.length === 1 && readingGroups.length === 1,
    `${groups.length} connection(s): ${groups.map((group) => group.label).join(", ") || "none"}`,
  );

  const goals = goalsGroups[0];
  if (goals) {
    assert(
      "degraded child's goals connection brackets exactly one begin and one commit, no rollback",
      goals.beginCount === 1 && goals.commitCount === 1 && goals.rollbackCount === 0,
      `begin=${goals.beginCount} commit=${goals.commitCount} rollback=${goals.rollbackCount}`,
    );
  }

  const reading = readingGroups[0];
  if (reading) {
    assert(
      "degraded child's reading connection brackets exactly one begin and one rollback, no commit",
      reading.beginCount === 1 && reading.commitCount === 0 && reading.rollbackCount === 1,
      `begin=${reading.beginCount} commit=${reading.commitCount} rollback=${reading.rollbackCount}`,
    );
  }

  assert(
    `degraded child issues ${EXPECTED_DEGRADED_APPLICATION_STATEMENTS} application statements, no more`,
    totalApplication === EXPECTED_DEGRADED_APPLICATION_STATEMENTS,
    `${totalApplication} application statement(s) of ${calls.length} on the wire, ${totalTypeFetch} netted out as type-fetch`,
  );
}

async function runDegradedChild(): Promise<void> {
  installStubs(loadCookies(), true);

  const { loadDay } = await import("@/lib/queries/day");
  const { todayInZone } = await import("@/lib/zone");

  const start = wireCalls.length;
  const { view, evidence } = await loadDay(todayInZone());
  reportDegradedRun(wireCalls.slice(start));

  const result: DegradedResult = {
    evidence,
    slotIds: view.slots.map((slot) => slot.commitmentId).sort(),
  };
  console.log(`${DEGRADED_MARKER}${JSON.stringify(result)}`);
}

function runDegradedChildProcess(): DegradedResult {
  let output: string;
  try {
    output = execFileSync(
      process.execPath,
      ["--import", "tsx", "--env-file=.env.local", "scripts/check-day.ts", "--degraded-child"],
      { cwd: process.cwd(), env: process.env, encoding: "utf8" },
    );
  } catch (error) {
    // The child's own PASS/FAIL lines are on its stdout, lost the moment
    // `execFileSync` throws unless printed here — the only place a caller of
    // this function still has them.
    const execError = error as { stdout?: string; stderr?: string; message: string };
    if (execError.stdout) console.log(execError.stdout);
    if (execError.stderr) console.error(execError.stderr);
    throw new Error(`degraded child process failed: ${execError.message}`);
  }
  console.log(output);
  const line = output.split("\n").find((row) => row.startsWith(DEGRADED_MARKER));
  if (!line) throw new Error(`degraded child printed no result:\n${output}`);
  return JSON.parse(line.slice(DEGRADED_MARKER.length)) as DegradedResult;
}

// `ZONE_TEST_DAY` (a Sunday) and `ZONE_NEXT_DAY` (the Monday right after it,
// so it is also that week's own `weekStart`) are years before any date the
// rest of this file ever asks for — retired, this row can never resurface in
// the cold/warm/degraded assertions above, which all ask for `today` alone,
// and neither `goals` nor `commitments` grant a DELETE at all, so it is never
// cleaned up; picked once, reused by every run of this suite.
const ZONE_TEST_DAY = "2019-11-03";
const ZONE_NEXT_DAY = "2019-11-04";

/**
 * Proves `lib/queries/day.ts`'s and `lib/queries/week.ts`'s own `retired_at`
 * filter reads the person's civil day, not the session's (UTC): a commitment
 * retired at 23:30 in `TIME_ZONE` on `ZONE_TEST_DAY` is 04:30 UTC on
 * `ZONE_NEXT_DAY` — a bare `retired_at::date` renders that as `ZONE_NEXT_DAY`
 * already, one day early.
 *
 * `loadDay` proves the day-level filter: `ZONE_TEST_DAY >= ZONE_TEST_DAY`
 * passes either way, so the defect never shows there — it is `ZONE_NEXT_DAY`
 * where a bare cast wrongly keeps `retired_at::date (= ZONE_NEXT_DAY) >=
 * ZONE_NEXT_DAY` true, asking one day too many.
 *
 * `loadWeek` proves the coarser week-level filter at its own `weekStart`
 * (`ZONE_NEXT_DAY` here, a Monday): retired the Sunday before its week
 * begins, the commitment must never enter that week's set at all. A bare
 * cast renders `retired_at::date` as `ZONE_NEXT_DAY` too, so
 * `>= weekStart` wrongly passes and the row rides into every day `deriveWeek`
 * derives, `asksOn`'s own retirement check included — that check compares a
 * civil day against `plan.retiredAt`'s full timestamp string and does not
 * block a `daily` cadence here, so the leak reaches `view.days` as a slot on
 * `ZONE_NEXT_DAY` itself under the bug, and never gets that far under the fix.
 *
 * Built through the app's own doors (`createGoal`, `addCommitment`) and one
 * raw `UPDATE` for the one column their grant ever lets move afterward
 * (`GRANT UPDATE (retired_at)`, `db/migrations/0000_mighty_pet_avengers.sql`)
 * — never a privileged connection.
 */
async function runZoneCheck(): Promise<void> {
  const { loadDay } = await import("@/lib/queries/day");
  const { loadWeek } = await import("@/lib/queries/week");
  const { createGoal, addCommitment } = await import("@/app/actions/plan");
  const { getPerson, withGoalsDb } = await import("@/lib/session");
  const { TIME_ZONE } = await import("@/lib/zone");
  const { sql } = await import("drizzle-orm");

  const person = await getPerson();
  if (!person) throw new Error("runZoneCheck: no verified session");

  const goal = await createGoal({ name: "check-day zone probe", horizon: "2099-12-31" });
  if (!goal.ok) throw new Error(`runZoneCheck: createGoal failed: ${goal.error}`);

  const commitment = await addCommitment({
    goalId: goal.goalId,
    name: "check-day zone probe",
    cadenceKind: "daily",
    satisfaction: "tap",
  });
  if (!commitment.ok) throw new Error(`runZoneCheck: addCommitment failed: ${commitment.error}`);
  const testId = commitment.commitmentId;

  await backdateCommitment(testId, person.id, new Date("2019-01-01T12:00:00Z"));

  const retiredAt = instantAtLocalTime(ZONE_TEST_DAY, 23, 30, TIME_ZONE);
  await withGoalsDb((tx) =>
    tx.execute(
      sql`update "goals"."commitments" set retired_at = ${retiredAt.toISOString()}::timestamptz where id = ${testId}`,
    ),
  );

  const onRetirementDay = await loadDay(ZONE_TEST_DAY);
  const dayAfter = await loadDay(ZONE_NEXT_DAY);
  const presentOn = onRetirementDay.commitments.some((row) => row.id === testId);
  const presentAfter = dayAfter.commitments.some((row) => row.id === testId);
  assert(
    "loadDay still asks for a commitment on the civil day it was retired",
    presentOn,
    `commitment ${presentOn ? "present" : "absent"} in loadDay("${ZONE_TEST_DAY}")`,
  );
  assert(
    "loadDay stops asking for it the very next civil day",
    !presentAfter,
    `commitment ${presentAfter ? "present" : "absent"} in loadDay("${ZONE_NEXT_DAY}")`,
  );

  const week = await loadWeek(ZONE_NEXT_DAY);
  const weekStartDay = week.view.days.find((day) => day.day === ZONE_NEXT_DAY);
  if (!weekStartDay) throw new Error(`runZoneCheck: loadWeek derived no day "${ZONE_NEXT_DAY}"`);
  const presentInWeek = weekStartDay.slots.some((slot) => slot.commitmentId === testId);
  assert(
    "loadWeek never admits a commitment retired the civil day before its week starts",
    !presentInWeek,
    `commitment ${presentInWeek ? "present" : "absent"} on loadWeek("${ZONE_NEXT_DAY}")'s own "${ZONE_NEXT_DAY}"`,
  );
}

// A Wednesday in the same week `runZoneCheck` already uses (Monday
// `ZONE_NEXT_DAY` .. Sunday), so `loadWeek` derives the same seven days from
// a single fresh call, no new commitment span to reason about.
const CADENCE_ZONE_WEDNESDAY = "2019-11-06";

/**
 * Proves `lib/day/cadence.ts`'s own `asksOn`, never `lib/queries/week.ts`'s
 * SQL filter: retired mid-week, this commitment is `>= weekStart` regardless
 * of which zone `retired_at::date` renders in, so it always rides into
 * `deriveWeek`'s raw commitments set — round 1's fix does not touch this
 * case at all. What used to decide Thursday–Sunday was `asksOn`'s own bare
 * `day > plan.retiredAt` — a civil-date string compared lexically against a
 * full ISO instant, which a Thursday date string reads as "not yet retired"
 * for exactly the reason `lib/queries/day.ts` did: the instant's own UTC
 * render lands on Thursday, and a bare compare never looks past that.
 */
async function runCadenceZoneCheck(): Promise<void> {
  const { loadWeek } = await import("@/lib/queries/week");
  const { createGoal, addCommitment } = await import("@/app/actions/plan");
  const { getPerson, withGoalsDb } = await import("@/lib/session");
  const { TIME_ZONE } = await import("@/lib/zone");
  const { sql } = await import("drizzle-orm");

  const person = await getPerson();
  if (!person) throw new Error("runCadenceZoneCheck: no verified session");

  const goal = await createGoal({ name: "check-day cadence zone probe", horizon: "2099-12-31" });
  if (!goal.ok) throw new Error(`runCadenceZoneCheck: createGoal failed: ${goal.error}`);

  const commitment = await addCommitment({
    goalId: goal.goalId,
    name: "check-day cadence zone probe",
    cadenceKind: "daily",
    satisfaction: "tap",
  });
  if (!commitment.ok) {
    throw new Error(`runCadenceZoneCheck: addCommitment failed: ${commitment.error}`);
  }
  const testId = commitment.commitmentId;

  await backdateCommitment(testId, person.id, new Date("2019-01-01T12:00:00Z"));

  const retiredAt = instantAtLocalTime(CADENCE_ZONE_WEDNESDAY, 23, 30, TIME_ZONE);
  await withGoalsDb((tx) =>
    tx.execute(
      sql`update "goals"."commitments" set retired_at = ${retiredAt.toISOString()}::timestamptz where id = ${testId}`,
    ),
  );

  const week = await loadWeek(CADENCE_ZONE_WEDNESDAY);
  const askedDays = new Set(
    week.view.days
      .filter((day) => day.slots.some((slot) => slot.commitmentId === testId))
      .map((day) => day.day),
  );

  assert(
    "loadWeek still asks on the Wednesday a commitment was retired at 23:30 Bogotá",
    askedDays.has(CADENCE_ZONE_WEDNESDAY),
    `asked days: [${[...askedDays].join(", ")}]`,
  );
  const daysAfter = week.view.days
    .map((day) => day.day)
    .filter((day) => day > CADENCE_ZONE_WEDNESDAY);
  assert(
    "loadWeek asks on no day from Thursday through Sunday of that same week",
    daysAfter.every((day) => !askedDays.has(day)),
    `asked days: [${[...askedDays].join(", ")}], days after Wednesday: [${daysAfter.join(", ")}]`,
  );
}

/**
 * Proves `lib/queries/week.ts`'s own `loadWeek(...).commitments` — the raw
 * `CommitmentGoal[]` module 17's screen groups a week's dots under, built
 * straight off `row.commitments` and never passed through `asksOn` — carries
 * the same zone fix `runZoneCheck` proved on `view.days` alone. A commitment
 * retired at 23:30 Bogotá on `ZONE_TEST_DAY` (a Sunday) must be gone from
 * `loadWeek(ZONE_NEXT_DAY)`'s own list: `deriveWeek`'s `asksOn` would still
 * keep this commitment out of every day's slots even under a bare
 * `retired_at::date` cast (`ZONE_TEST_DAY` sits in the week before), so that
 * check alone cannot catch a filter regressed back to the bare cast — only
 * reading `commitments` itself, before `asksOn` ever runs, can.
 */
async function runWeekCommitmentsZoneCheck(): Promise<void> {
  const { loadWeek } = await import("@/lib/queries/week");
  const { createGoal, addCommitment } = await import("@/app/actions/plan");
  const { getPerson, withGoalsDb } = await import("@/lib/session");
  const { TIME_ZONE } = await import("@/lib/zone");
  const { sql } = await import("drizzle-orm");

  const person = await getPerson();
  if (!person) throw new Error("runWeekCommitmentsZoneCheck: no verified session");

  const goal = await createGoal({ name: "check-day week-commitments zone probe", horizon: "2099-12-31" });
  if (!goal.ok) throw new Error(`runWeekCommitmentsZoneCheck: createGoal failed: ${goal.error}`);

  const commitment = await addCommitment({
    goalId: goal.goalId,
    name: "check-day week-commitments zone probe",
    cadenceKind: "daily",
    satisfaction: "tap",
  });
  if (!commitment.ok) {
    throw new Error(`runWeekCommitmentsZoneCheck: addCommitment failed: ${commitment.error}`);
  }
  const testId = commitment.commitmentId;

  const retiredAt = instantAtLocalTime(ZONE_TEST_DAY, 23, 30, TIME_ZONE);
  await withGoalsDb((tx) =>
    tx.execute(
      sql`update "goals"."commitments" set retired_at = ${retiredAt.toISOString()}::timestamptz where id = ${testId}`,
    ),
  );

  const week = await loadWeek(ZONE_NEXT_DAY);
  const presentInCommitments = week.commitments.some((row) => row.id === testId);
  assert(
    "loadWeek's own commitments list never admits a commitment retired the civil day before its week starts",
    !presentInCommitments,
    `commitment ${presentInCommitments ? "present" : "absent"} in loadWeek("${ZONE_NEXT_DAY}").commitments`,
  );
}

// A commitment asks nothing before its own `created_at`'s civil day, so a
// probe about a day in the past writes that moment back by id, under the
// identity that owns the row. The app's own role cannot write the column.
async function backdateCommitment(id: string, userId: string, createdAt: Date): Promise<void> {
  const db = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });
  try {
    await db`
      update goals.commitments set created_at = ${createdAt.toISOString()}::timestamptz
      where id = ${id} and user_id = ${userId}
    `;
  } finally {
    await db.end();
  }
}

// Whole civil days added to a `YYYY-MM-DD` string, by midday UTC — the same
// technique `scripts/harness/seed-goal.ts` and `lib/zone.ts`'s own `weekOf`
// use.
function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(date);
}

// The Monday of the week that starts at least `days` after `after` — always
// strictly later than `after` itself, whatever civil day `after` names.
function mondayAtLeastAfter(after: string, days: number): string {
  const candidate = addDays(after, days);
  const weekday = new Date(`${candidate}T12:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  const backToMonday = weekday === 0 ? 6 : weekday - 1;
  return addDays(candidate, -backToMonday);
}

/**
 * A Monday later than any phase this identity's own probes have ever seeded
 * (`goals.phases` grants no DELETE — RP-15 has no retirement of its own —
 * so every past run's own phase is still live), plus a further random offset
 * so two runs racing this check never land on the same day either. A fixed
 * or independently-random day both failed here: a fixed day accumulates one
 * phase per run forever, and `deriveWeek`'s own `phaseOn` keeps only the
 * first phase covering a day when two overlap it, so a later run compared
 * against a stranger's own already-seeded phase, never the one it just made
 * — and a day chosen independent of what already exists still falls, most of
 * the time, inside an earlier run's own wide `[2017-12-01, ends_on]` span,
 * for the same reason. Confirmed by running this check twice in a row before
 * this fix, both showing the same, wrong, already-seeded phase.
 */
async function pickFreshPhaseMonday(): Promise<string> {
  const { withGoalsDb } = await import("@/lib/session");
  const { sql } = await import("drizzle-orm");

  const [row] = await withGoalsDb((tx) =>
    tx.execute<{ max_ends_on: string | null }>(
      sql`select max(ends_on) as max_ends_on from "goals"."phases"`,
    ),
  );
  const floor = row?.max_ends_on ?? "1970-01-05";
  const anchor = mondayAtLeastAfter(floor, 7);
  return addDays(anchor, randomInt(0, 500) * 7);
}

/**
 * Proves `lib/queries/week.ts`'s own `p.ends_on >= weekStart` bound: a phase
 * ending exactly on the week's own Monday must still be that Monday's phase
 * in `loadWeek`'s own view — the row-selection layer this bound guards,
 * never `phaseOn`'s own inclusive check (`runMain`'s cold/warm calls and
 * `lib/day/derive.test.ts` cover that half; a phase excluded from the row set
 * entirely never reaches `phaseOn` to be misjudged either way).
 */
async function runPhaseWeekBoundCheck(): Promise<void> {
  const { loadWeek } = await import("@/lib/queries/week");
  const { createGoal, addPhase } = await import("@/app/actions/plan");

  const monday = await pickFreshPhaseMonday();

  const goal = await createGoal({ name: "check-day phase week-bound probe", horizon: "2099-12-31" });
  if (!goal.ok) throw new Error(`runPhaseWeekBoundCheck: createGoal failed: ${goal.error}`);

  const phase = await addPhase({
    goalId: goal.goalId,
    aim: "check-day phase week-bound probe",
    startsOn: addDays(monday, -7),
    endsOn: monday,
  });
  if (!phase.ok) throw new Error(`runPhaseWeekBoundCheck: addPhase failed: ${phase.error}`);

  const week = await loadWeek(monday);
  const mondayView = week.view.days.find((day) => day.day === monday);
  if (!mondayView) {
    throw new Error(`runPhaseWeekBoundCheck: loadWeek derived no day "${monday}"`);
  }

  assert(
    "a phase ending on a week's own Monday is in that week's loadWeek phases (RP-15)",
    mondayView.phase?.id === phase.phaseId,
    `phase = ${JSON.stringify(mondayView.phase)}`,
  );
}

/**
 * Proves `loadDay`'s own `view.slots[].satisfied`, which neither `runMain`'s
 * own cold/warm assertions nor `check:goal` ever read (both stop at slot ids,
 * statement counts and measure totals — independent validation's own
 * mutation over `lib/queries/day.ts`'s fact filter survived exactly this
 * blind spot). A tap commitment's slot for today starts unsatisfied and
 * flips the moment `declareFact` writes today's fact — the one round trip a
 * person's own tap actually drives.
 */
async function runFactSatisfactionCheck(): Promise<void> {
  const { loadDay } = await import("@/lib/queries/day");
  const { createGoal, addCommitment } = await import("@/app/actions/plan");
  const { declareFact } = await import("@/app/actions/facts");
  const { todayInZone } = await import("@/lib/zone");

  const today = todayInZone();
  const goal = await createGoal({ name: "check-day fact-satisfaction probe", horizon: "2099-12-31" });
  if (!goal.ok) throw new Error(`runFactSatisfactionCheck: createGoal failed: ${goal.error}`);

  const commitment = await addCommitment({
    goalId: goal.goalId,
    name: "check-day fact-satisfaction probe",
    cadenceKind: "daily",
    satisfaction: "tap",
  });
  if (!commitment.ok) {
    throw new Error(`runFactSatisfactionCheck: addCommitment failed: ${commitment.error}`);
  }
  const testId = commitment.commitmentId;

  const before = await loadDay(today);
  const slotBefore = before.view.slots.find((slot) => slot.commitmentId === testId);
  assert(
    "a tap commitment with no fact declared today has an unsatisfied slot",
    slotBefore?.satisfied === false,
    `slot = ${JSON.stringify(slotBefore)}`,
  );

  const fact = await declareFact({ commitmentId: testId });
  if (!fact.ok) throw new Error(`runFactSatisfactionCheck: declareFact failed: ${fact.error}`);

  const after = await loadDay(today);
  const slotAfter = after.view.slots.find((slot) => slot.commitmentId === testId);
  assert(
    "declaring a fact makes that commitment's slot for today satisfied",
    slotAfter?.satisfied === true,
    `slot = ${JSON.stringify(slotAfter)}`,
  );
}

/**
 * Proves `declareFact`'s own refusal (RP-05, `app/actions/facts.ts`): a fact
 * for a commitment satisfied by evidence would have no day of its own to
 * explain, since that day is drawn from the source, never written here.
 * `day-row.tsx`'s own `tappable = kind !== "evidence"` means no screen ever
 * sends this call, so this is the one place today that reaches it at all.
 */
async function runEvidenceRefusalCheck(): Promise<void> {
  const { createGoal, addCommitment } = await import("@/app/actions/plan");
  const { declareFact } = await import("@/app/actions/facts");

  const goal = await createGoal({ name: "check-day evidence-refusal probe", horizon: "2099-12-31" });
  if (!goal.ok) throw new Error(`runEvidenceRefusalCheck: createGoal failed: ${goal.error}`);

  const commitment = await addCommitment({
    goalId: goal.goalId,
    name: "check-day evidence-refusal probe",
    cadenceKind: "daily",
    satisfaction: "evidence",
    sourceKey: "reading_lookups",
    threshold: 1,
  });
  if (!commitment.ok) {
    throw new Error(`runEvidenceRefusalCheck: addCommitment failed: ${commitment.error}`);
  }

  const result = await declareFact({ commitmentId: commitment.commitmentId });
  assert(
    "declareFact refuses a fact for a commitment satisfied by evidence (RP-05)",
    !result.ok && result.error === "day.errors.evidenceOnly",
    JSON.stringify(result),
  );
}

/**
 * Proves module 38's own contract: a `tap` commitment holds at most one fact
 * a day, whatever the device. Two concurrent `declareFact` calls race on the
 * pool (`max: 8`, `db/client.ts`), so `Promise.all` genuinely opens two
 * connections rather than one queued behind the other — the shape the
 * assignment names, not a stand-in for it.
 *
 * The raw second insert bypasses `declareFact`'s own `on conflict … do
 * nothing` on purpose: it is the negative control for the index itself,
 * proved as the person under RLS (`withGoalsDb`, never a privileged
 * connection) rather than asserted from the migration (`AGENTS.md`
 * «## Verification»).
 */
async function runFactUniqueCheck(): Promise<void> {
  const { createGoal, addCommitment } = await import("@/app/actions/plan");
  const { declareFact } = await import("@/app/actions/facts");
  const { getPerson, withGoalsDb } = await import("@/lib/session");
  const { todayInZone } = await import("@/lib/zone");
  const { facts } = await import("@/db/schema");
  const { pgCode } = await import("@/lib/db-error");
  const { sql } = await import("drizzle-orm");

  const person = await getPerson();
  if (!person) throw new Error("runFactUniqueCheck: no verified session");

  const goal = await createGoal({ name: "check-day unique-fact probe", horizon: "2099-12-31" });
  if (!goal.ok) throw new Error(`runFactUniqueCheck: createGoal failed: ${goal.error}`);

  const commitment = await addCommitment({
    goalId: goal.goalId,
    name: "check-day unique-fact probe",
    cadenceKind: "daily",
    satisfaction: "tap",
  });
  if (!commitment.ok) {
    throw new Error(`runFactUniqueCheck: addCommitment failed: ${commitment.error}`);
  }
  const testId = commitment.commitmentId;
  const today = todayInZone();

  const [first, second] = await Promise.all([
    declareFact({ commitmentId: testId }),
    declareFact({ commitmentId: testId }),
  ]);
  assert(
    "two concurrent declareFact calls for the same tap commitment and day both report ok",
    first.ok && second.ok,
    `first = ${JSON.stringify(first)}, second = ${JSON.stringify(second)}`,
  );

  const [{ count }] = await withGoalsDb((tx) =>
    tx.execute<{ count: string }>(
      sql`select count(*)::int as count from ${facts} where commitment_id = ${testId} and day = ${today}`,
    ),
  );
  assert(
    "two concurrent declareFact calls for the same commitment and day leave exactly one fact",
    Number(count) === 1,
    `count = ${count}`,
  );

  let rawInsertCode: string | undefined;
  try {
    await withGoalsDb((tx) =>
      tx.execute(sql`
        insert into ${facts} (user_id, commitment_id, one_off_id, goal_id, day)
        values (${person.id}, ${testId}, null, ${goal.goalId}, ${today})
      `),
    );
  } catch (error) {
    // `pgCode` (`@/lib/db-error`, round 2): `PgPreparedQuery#queryWithCache`
    // (`pg-core/session.ts`) wraps the raw `postgres` error in a
    // `DrizzleQueryError`, whose own `.code` is undefined — the code that
    // matters is on `.cause`, the real driver error.
    rawInsertCode = pgCode(error);
  }
  assert(
    "a raw second insert for the same commitment and day fails with the unique violation (23505)",
    rawInsertCode === "23505",
    `code = ${rawInsertCode ?? "none — the insert succeeded"}`,
  );
}

/**
 * Proves module 38's round 2 fix: `declareFact`'s own advisory lock
 * (`app/actions/facts.ts`) serialises "Cambiar" (`replace: true`) racing a
 * plain tap on the same commitment and day. Before the lock, an independent
 * validator drove this live and found 11 of 20 trials where the loser's own
 * fallback `select` (after `on conflict … do nothing`) read a row the
 * winner's own delete had already removed by the time either transaction
 * committed — a `factId` that no longer exists is worse than an error, since
 * nothing on screen ever finds out.
 *
 * Each trial has its own fresh commitment, so one trial's race can never
 * contaminate another's — but every trial's pair is fired in the same
 * `Promise.all`, all `TRIALS * 2` calls at once, not one trial at a time.
 * Sequential trials never reproduced the bug in this environment (0 of 70,
 * measured): each trial's two calls raced each other, but the pool sat idle
 * between trials, and this script's own round trips to Supabase are close
 * enough in latency that one trial alone rarely lands the exact interleaving
 * the bug needs (`declareFact`'s comment above spells out which one). Firing
 * every trial's pair together reproduces the real contention an independent
 * validator saw driving this live through the app, where many requests
 * genuinely overlap on the connection pool (`db/client.ts`'s own `max: 8`).
 */
async function runReplaceRaceCheck(): Promise<void> {
  const { createGoal, addCommitment } = await import("@/app/actions/plan");
  const { declareFact } = await import("@/app/actions/facts");
  const { withGoalsDb } = await import("@/lib/session");
  const { todayInZone } = await import("@/lib/zone");
  const { facts } = await import("@/db/schema");
  const { sql } = await import("drizzle-orm");

  const TRIALS = 10;
  const today = todayInZone();

  const goal = await createGoal({ name: "check-day replace-race probe", horizon: "2099-12-31" });
  if (!goal.ok) throw new Error(`runReplaceRaceCheck: createGoal failed: ${goal.error}`);

  const testIds: string[] = [];
  for (let trial = 0; trial < TRIALS; trial++) {
    const commitment = await addCommitment({
      goalId: goal.goalId,
      name: `check-day replace-race probe ${trial}`,
      cadenceKind: "daily",
      satisfaction: "tap",
    });
    if (!commitment.ok) {
      throw new Error(`runReplaceRaceCheck: addCommitment failed: ${commitment.error}`);
    }
    testIds.push(commitment.commitmentId);
  }

  type Call = { testId: string; result: Awaited<ReturnType<typeof declareFact>> };
  const calls: Promise<Call>[] = testIds.flatMap((testId) => [
    declareFact({ commitmentId: testId }).then((result) => ({ testId, result })),
    declareFact({ commitmentId: testId, replace: true }).then((result) => ({ testId, result })),
  ]);
  const settled = await Promise.all(calls);

  for (const { testId, result } of settled) {
    if (!result.ok) {
      throw new Error(`runReplaceRaceCheck: a call for ${testId} failed: ${JSON.stringify(result)}`);
    }
  }

  let multiRowTrials = 0;
  let deadIdTrials = 0;

  for (const testId of testIds) {
    const rows = await withGoalsDb((tx) =>
      tx.execute<{ id: string }>(
        sql`select id from ${facts} where commitment_id = ${testId} and day = ${today}`,
      ),
    );
    if (rows.length !== 1) multiRowTrials++;

    const liveIds = new Set(rows.map((row) => row.id));
    const returnedIds = settled
      .filter((call) => call.testId === testId)
      .map((call) => (call.result as { ok: true; factId: string }).factId);
    if (returnedIds.some((factId) => !liveIds.has(factId))) deadIdTrials++;
  }

  assert(
    `${TRIALS} replace-vs-plain trials each leave exactly one row for their own commitment and day`,
    multiRowTrials === 0,
    `${multiRowTrials} of ${TRIALS} trial(s) left more than one row`,
  );
  assert(
    `${TRIALS} replace-vs-plain trials never return a factId that is not the row left standing`,
    deadIdTrials === 0,
    `${deadIdTrials} of ${TRIALS} trial(s) returned a dead factId`,
  );
}

/**
 * Proves RP-19 widened 2026-09-28: `loadDay(today).oneOffs` carries a
 * one-off dated three days back, still undone, with its own `day`; drops one
 * dated three days back whose fact was written on a day other than today —
 * "done leaves the list for good", true on any day the fact was written, not
 * only today's; and never carries one dated tomorrow. Built through
 * `createOneOff` (`app/actions/one-offs.ts`) for every row, plus one raw
 * insert for the "got a fact yesterday" case: `declareFact` itself refuses a
 * caller-supplied day for a one-off (`requireDayForSubject`'s own
 * `dayOnOneOff`, RP-06 never redates one), so a fact dated anywhere but
 * today can only be seeded the way `runZoneCheck` above already seeds state
 * `declareFact` cannot reach. The `loadDay(today)` call itself is wrapped in
 * `reportRun` the same way the cold/warm calls in `runMain` are, so the
 * carrying oneOffs list and the four-statement count are proven from the
 * very same call. Cleaned up by the ids this function returns: the fact
 * first (`facts_delete_self`), then every one-off (`one_offs_delete_self`,
 * which refuses a row that still carries a fact).
 */
async function runOneOffCarryCheck(): Promise<void> {
  const { loadDay } = await import("@/lib/queries/day");
  const { createOneOff } = await import("@/app/actions/one-offs");
  const { getPerson, withGoalsDb } = await import("@/lib/session");
  const { todayInZone } = await import("@/lib/zone");
  const { facts, oneOffs } = await import("@/db/schema");
  const { sql } = await import("drizzle-orm");

  const person = await getPerson();
  if (!person) throw new Error("runOneOffCarryCheck: no verified session");

  const today = todayInZone();
  const threeDaysBack = addDays(today, -3);
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);

  // `createOneOff` refuses a past day (RP-19), so the rows dated back are raw inserts.
  async function seedDated(name: string, day: string): Promise<{ oneOffId: string }> {
    const [row] = await withGoalsDb((tx) =>
      tx.execute<{ id: string }>(sql`
        insert into ${oneOffs} (user_id, goal_id, name, day)
        values (${person!.id}, null, ${name}, ${day})
        returning id
      `),
    );
    return { oneOffId: row.id };
  }
  const undone = await seedDated("check-day carry probe undone", threeDaysBack);
  const doneElsewhen = await seedDated("check-day carry probe done-elsewhen", threeDaysBack);

  const future = await createOneOff({ name: "check-day carry probe future", day: tomorrow });
  if (!future.ok) {
    throw new Error(`runOneOffCarryCheck: createOneOff (future) failed: ${future.error}`);
  }

  const [factRow] = await withGoalsDb((tx) =>
    tx.execute<{ id: string }>(sql`
      insert into ${facts} (user_id, commitment_id, one_off_id, goal_id, day)
      values (${person.id}, null, ${doneElsewhen.oneOffId}, null, ${yesterday})
      returning id
    `),
  );

  const start = wireCalls.length;
  const day = await loadDay(today);
  reportRun("carry", wireCalls.slice(start), false);

  const ids = day.oneOffs.map((oneOff) => oneOff.id);
  const undoneRow = day.oneOffs.find((oneOff) => oneOff.id === undone.oneOffId);

  assert(
    "loadDay(today).oneOffs carries a one-off dated three days back, still undone, with its own day",
    undoneRow !== undefined && undoneRow.day === threeDaysBack,
    `row = ${JSON.stringify(undoneRow)}`,
  );
  assert(
    "loadDay(today).oneOffs drops a one-off whose fact was written on a day other than today",
    !ids.includes(doneElsewhen.oneOffId),
    `ids = ${JSON.stringify(ids)}`,
  );
  assert(
    "loadDay(today).oneOffs never carries a one-off dated tomorrow",
    !ids.includes(future.oneOffId),
    `ids = ${JSON.stringify(ids)}`,
  );

  await withGoalsDb((tx) => tx.execute(sql`delete from ${facts} where id = ${factRow.id}`));
  await withGoalsDb((tx) =>
    tx.execute(
      sql`delete from ${oneOffs} where id in (${undone.oneOffId}, ${doneElsewhen.oneOffId}, ${future.oneOffId})`,
    ),
  );
}

/**
 * Proves RP-06 for `LoggedFact.writtenOn` (`lib/day/logged-fact.ts`): a fact
 * dated `yesterday` but inserted right now reads back from
 * `loadDay(yesterday)` with `writtenOn` — today's own civil day, read
 * through `civilDateInZone`, never a bare substring of `writtenAt` — never
 * the day the fact explains. `declareFact` cannot seed this state for a
 * fresh commitment: `requireDayForSubject` refuses a `day` before the
 * commitment's own `createdDay`, which a commitment created moments ago
 * always is, so the raw insert below is the only way to reach a fact whose
 * own day and whose own written moment fall on two different civil days.
 */
async function runFactWrittenOnCheck(): Promise<void> {
  const { loadDay } = await import("@/lib/queries/day");
  const { createGoal, addCommitment } = await import("@/app/actions/plan");
  const { getPerson, withGoalsDb } = await import("@/lib/session");
  const { todayInZone } = await import("@/lib/zone");
  const { facts } = await import("@/db/schema");
  const { sql } = await import("drizzle-orm");

  const person = await getPerson();
  if (!person) throw new Error("runFactWrittenOnCheck: no verified session");

  const today = todayInZone();
  const yesterday = addDays(today, -1);

  const goal = await createGoal({ name: "check-day written-on probe", horizon: "2099-12-31" });
  if (!goal.ok) throw new Error(`runFactWrittenOnCheck: createGoal failed: ${goal.error}`);

  const commitment = await addCommitment({
    goalId: goal.goalId,
    name: "check-day written-on probe",
    cadenceKind: "daily",
    satisfaction: "tap",
  });
  if (!commitment.ok) {
    throw new Error(`runFactWrittenOnCheck: addCommitment failed: ${commitment.error}`);
  }
  const testId = commitment.commitmentId;

  await backdateCommitment(testId, person.id, new Date(Date.now() - 3 * 86_400_000));

  const [factRow] = await withGoalsDb((tx) =>
    tx.execute<{ id: string }>(sql`
      insert into ${facts} (user_id, commitment_id, one_off_id, goal_id, day)
      values (${person.id}, ${testId}, null, ${goal.goalId}, ${yesterday})
      returning id
    `),
  );

  const day = await loadDay(yesterday);
  const logged = day.factsByCommitment[testId];

  assert(
    "a fact written today for yesterday comes back from loadDay(yesterday) with writtenOn = today",
    logged !== undefined && logged.writtenOn === today,
    `logged = ${JSON.stringify(logged)}`,
  );

  const slot = day.view.slots.find((candidate) => candidate.commitmentId === testId);
  assert(
    "that same fact satisfies the commitment's own slot on the day it explains (yesterday)",
    slot?.satisfied === true,
    `slot = ${JSON.stringify(slot)}`,
  );

  await withGoalsDb((tx) => tx.execute(sql`delete from ${facts} where id = ${factRow.id}`));
}

/**
 * Proves `lib/queries/day.ts`'s own `p.ends_on >= day` bound: a phase ending
 * on day D is in `loadDay(D).phases`. The week-bound check above proves the
 * same edge for `loadWeek`; this is `loadDay`'s own statement.
 */
async function runPhaseDayBoundCheck(): Promise<void> {
  const { loadDay } = await import("@/lib/queries/day");
  const { createGoal, addPhase } = await import("@/app/actions/plan");

  const endsOn = await pickFreshPhaseMonday();

  const goal = await createGoal({ name: "check-day phase day-bound probe", horizon: "2099-12-31" });
  if (!goal.ok) throw new Error(`runPhaseDayBoundCheck: createGoal failed: ${goal.error}`);

  const migrationDb = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });
  try {
    const phase = await addPhase({
      goalId: goal.goalId,
      aim: "check-day phase day-bound probe",
      startsOn: addDays(endsOn, -7),
      endsOn,
    });
    if (!phase.ok) throw new Error(`runPhaseDayBoundCheck: addPhase failed: ${phase.error}`);

    const day = await loadDay(endsOn);
    assert(
      "a phase ending on day D is in loadDay(D).phases (RP-15)",
      day.phases.some((candidate) => candidate.id === phase.phaseId),
      `phases = ${JSON.stringify(day.phases.map((candidate) => candidate.id))}, wanted ${phase.phaseId}`,
    );
  } finally {
    await migrationDb`delete from goals.goals where id = ${goal.goalId}`;
    await migrationDb.end();
  }
}

/**
 * Proves `daylessCount` counts only the dayless (RP-21), against a baseline
 * read first, with two dayless and one dated-undone one-off so the two sets
 * differ in size, and that `listDaylessOneOffs` reads them oldest first.
 */
async function runDaylessCountAndOrderCheck(): Promise<void> {
  const { loadDay } = await import("@/lib/queries/day");
  const { listDaylessOneOffs } = await import("@/lib/queries/one-offs");
  const { getPerson, withGoalsDb } = await import("@/lib/session");
  const { todayInZone } = await import("@/lib/zone");
  const { oneOffs } = await import("@/db/schema");
  const { sql } = await import("drizzle-orm");

  const person = await getPerson();
  if (!person) throw new Error("runDaylessCountAndOrderCheck: no verified session");

  const today = todayInZone();
  const baseline = (await loadDay(today)).daylessCount;
  const ids: string[] = [];

  async function seed(name: string, day: string | null): Promise<string> {
    const [row] = await withGoalsDb((tx) =>
      tx.execute<{ id: string }>(sql`
        insert into ${oneOffs} (user_id, goal_id, name, day)
        values (${person!.id}, null, ${name}, ${day})
        returning id
      `),
    );
    ids.push(row.id);
    return row.id;
  }

  try {
    const first = await seed("check-day order first", null);
    const second = await seed("check-day order second", null);
    await seed("check-day dated undone a", today);

    const now = await loadDay(today);
    assert(
      "daylessCount moves by the two dayless one-offs, not by the dated one",
      now.daylessCount === baseline + 2,
      `baseline ${baseline}, now ${now.daylessCount}`,
    );

    const listed = (await listDaylessOneOffs()).map((row) => row.id);
    assert(
      "listDaylessOneOffs lists the older dayless one-off before the newer",
      listed.indexOf(first) !== -1 && listed.indexOf(first) < listed.indexOf(second),
      `first at ${listed.indexOf(first)}, second at ${listed.indexOf(second)}`,
    );
  } finally {
    if (ids.length > 0) {
      await withGoalsDb((tx) =>
        tx.execute(sql`delete from ${oneOffs} where id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`),
      );
    }
  }
}

/**
 * Proves module 64's reads: a commitment asks nothing before the civil day it
 * was written (`loadDay` and `loadWeek` alike), `loadDay(today).goals` carries
 * `openedOn`, a one-off done on the day drawn is in `doneOneOffs` with its
 * fact and out of `oneOffs`, one done yesterday is in neither, and a dayless
 * one is in neither list but counts in `daylessCount` and is listed by
 * `listDaylessOneOffs`, unless it is done or its goal is archived. The dayless
 * count is measured against a baseline read first: this identity may hold
 * dayless rows of its own. Every row is deleted by id in `finally`.
 */
async function runCreatedOnAndOneOffsCheck(): Promise<void> {
  const { loadDay } = await import("@/lib/queries/day");
  const { loadWeek } = await import("@/lib/queries/week");
  const { listDaylessOneOffs } = await import("@/lib/queries/one-offs");
  const { createGoal, addCommitment, archiveGoal } = await import("@/app/actions/plan");
  const { createOneOff, completeOneOff } = await import("@/app/actions/one-offs");
  const { getPerson, withGoalsDb } = await import("@/lib/session");
  const { todayInZone } = await import("@/lib/zone");
  const { oneOffs } = await import("@/db/schema");
  const { sql } = await import("drizzle-orm");

  const person = await getPerson();
  if (!person) throw new Error("runCreatedOnAndOneOffsCheck: no verified session");

  const today = todayInZone();
  const yesterday = addDays(today, -1);
  const baseline = (await loadDay(today)).daylessCount;

  const db = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });
  const goalIds: string[] = [];
  const oneOffIds: string[] = [];

  async function seedDayless(name: string, goalId: string | null): Promise<string> {
    const [row] = await withGoalsDb((tx) =>
      tx.execute<{ id: string }>(sql`
        insert into ${oneOffs} (user_id, goal_id, name, day)
        values (${person!.id}, ${goalId}, ${name}, null)
        returning id
      `),
    );
    oneOffIds.push(row.id);
    return row.id;
  }

  try {
    const goal = await createGoal({ name: "check-day created-on probe", horizon: "2099-12-31" });
    if (!goal.ok) throw new Error(`runCreatedOnAndOneOffsCheck: createGoal failed: ${goal.error}`);
    goalIds.push(goal.goalId);

    const commitment = await addCommitment({
      goalId: goal.goalId,
      name: "check-day created-on probe",
      cadenceKind: "daily",
      satisfaction: "tap",
    });
    if (!commitment.ok) {
      throw new Error(`runCreatedOnAndOneOffsCheck: addCommitment failed: ${commitment.error}`);
    }
    const commitmentId = commitment.commitmentId;

    const doneToday = await createOneOff({ name: "check-day done today", day: today, goalId: goal.goalId });
    if (!doneToday.ok) throw new Error("runCreatedOnAndOneOffsCheck: createOneOff failed");
    // A past day is refused by `createOneOff` (RP-19), so this row is a raw insert.
    const [doneYesterdayRow] = await withGoalsDb((tx) =>
      tx.execute<{ id: string }>(sql`
        insert into ${oneOffs} (user_id, goal_id, name, day)
        values (${person.id}, null, 'check-day done yesterday', ${yesterday})
        returning id
      `),
    );
    const doneYesterday = { oneOffId: doneYesterdayRow.id };
    const undoneToday = await createOneOff({ name: "check-day undone today", day: today });
    if (!undoneToday.ok) throw new Error("runCreatedOnAndOneOffsCheck: createOneOff (undone) failed");
    oneOffIds.push(doneToday.oneOffId, doneYesterday.oneOffId, undoneToday.oneOffId);

    const completed = await completeOneOff({ oneOffId: doneToday.oneOffId });
    if (!completed.ok) throw new Error(`runCreatedOnAndOneOffsCheck: completeOneOff failed: ${completed.error}`);
    await db`
      insert into goals.facts (user_id, commitment_id, one_off_id, goal_id, day)
      values (${person.id}, null, ${doneYesterday.oneOffId}, null, ${yesterday})
    `;

    const dayless = await seedDayless("check-day dayless", null);
    const daylessDone = await seedDayless("check-day dayless done", null);
    const daylessDoneResult = await completeOneOff({ oneOffId: daylessDone });
    if (!daylessDoneResult.ok) {
      throw new Error(`runCreatedOnAndOneOffsCheck: completeOneOff (dayless) failed: ${daylessDoneResult.error}`);
    }
    const archivedGoal = await createGoal({ name: "check-day archived probe", horizon: "2099-12-31" });
    if (!archivedGoal.ok) throw new Error(`runCreatedOnAndOneOffsCheck: createGoal failed: ${archivedGoal.error}`);
    goalIds.push(archivedGoal.goalId);
    const daylessArchived = await seedDayless("check-day dayless archived", archivedGoal.goalId);
    const archived = await archiveGoal({ goalId: archivedGoal.goalId });
    if (!archived.ok) throw new Error(`runCreatedOnAndOneOffsCheck: archiveGoal failed: ${archived.error}`);

    const start = wireCalls.length;
    const todayDay = await loadDay(today);
    reportRun("created-on", wireCalls.slice(start), false);
    const yesterdayDay = await loadDay(yesterday);

    assert(
      "a commitment created today is absent from loadDay(yesterday).view.slots",
      !yesterdayDay.view.slots.some((slot) => slot.commitmentId === commitmentId),
      `slots = ${JSON.stringify(yesterdayDay.view.slots.map((slot) => slot.commitmentId))}`,
    );
    assert(
      "it is present on its own day, in loadDay(today).view.slots",
      todayDay.view.slots.some((slot) => slot.commitmentId === commitmentId),
      `slots = ${JSON.stringify(todayDay.view.slots.map((slot) => slot.commitmentId))}`,
    );

    const week = await loadWeek(yesterday);
    const weekYesterday = week.view.days.find((day) => day.day === yesterday);
    const weekToday = (await loadWeek(today)).view.days.find((day) => day.day === today);
    assert(
      "loadWeek asks nothing for that commitment on the day before its creation",
      weekYesterday !== undefined && !weekYesterday.slots.some((slot) => slot.commitmentId === commitmentId),
      `slots = ${JSON.stringify(weekYesterday?.slots.map((slot) => slot.commitmentId))}`,
    );
    assert(
      "loadWeek asks for it on its own day",
      weekToday !== undefined && weekToday.slots.some((slot) => slot.commitmentId === commitmentId),
      `slots = ${JSON.stringify(weekToday?.slots.map((slot) => slot.commitmentId))}`,
    );

    const openedOn = todayDay.goals.find((candidate) => candidate.id === goal.goalId)?.openedOn;
    assert("loadDay(today).goals carries openedOn, the civil day the goal was written", openedOn === today, `openedOn = ${openedOn}`);

    const [factRow] = await db<{ id: string }[]>`
      select id from goals.facts where one_off_id = ${doneToday.oneOffId}
    `;
    const doneRow = todayDay.doneOneOffs.find((row) => row.id === doneToday.oneOffId);
    assert(
      "a one-off completed today is in doneOneOffs with its factId",
      doneRow !== undefined && doneRow.factId === factRow.id && doneRow.goalId === goal.goalId,
      `row = ${JSON.stringify(doneRow)}, fact ${factRow.id}`,
    );
    assert(
      "it is not in oneOffs",
      !todayDay.oneOffs.some((row) => row.id === doneToday.oneOffId),
      "checked against loadDay(today).oneOffs",
    );
    const listed = [...todayDay.oneOffs.map((row) => row.id), ...todayDay.doneOneOffs.map((row) => row.id)];
    assert(
      "a one-off completed yesterday is in neither list",
      !listed.includes(doneYesterday.oneOffId),
      `ids = ${JSON.stringify(listed)}`,
    );
    assert(
      "a dayless one-off is in neither list",
      !listed.includes(dayless),
      `ids = ${JSON.stringify(listed)}`,
    );
    assert(
      "daylessCount counts the dayless one, and not a dated one, a done one nor one whose goal is archived",
      todayDay.daylessCount === baseline + 1,
      `baseline ${baseline}, now ${todayDay.daylessCount}`,
    );

    const listStart = wireCalls.length;
    const daylessList = await listDaylessOneOffs();
    const listCalls = wireCalls.slice(listStart);
    const ids = daylessList.map((row) => row.id);
    assert(
      "listDaylessOneOffs lists the dayless one and no dated, done or archived-goal one",
      ids.includes(dayless) &&
        !ids.includes(undoneToday.oneOffId) &&
        !ids.includes(daylessDone) &&
        !ids.includes(daylessArchived),
      `ids = ${JSON.stringify(ids)}`,
    );
    assert(
      "listDaylessOneOffs and daylessCount agree",
      daylessList.length === todayDay.daylessCount,
      `${daylessList.length} listed, ${todayDay.daylessCount} counted`,
    );
    const listApplication = [...groupByConnection(listCalls).entries()].reduce(
      (sum, [connection, calls]) => sum + analyzeGroup(connection, calls).applicationCount,
      0,
    );
    assert(
      "listDaylessOneOffs issues two application statements",
      listApplication === 2,
      `${listApplication} application statement(s) of ${listCalls.length} on the wire`,
    );
  } finally {
    if (oneOffIds.length > 0) {
      await db`delete from goals.one_offs where id in ${db(oneOffIds)} and user_id = ${person.id}`;
    }
    if (goalIds.length > 0) {
      await db`delete from goals.goals where id in ${db(goalIds)} and user_id = ${person.id}`;
    }
    await db.end();
  }
}

function applicationStatements(calls: DebugCall[]): number {
  return [...groupByConnection(calls).entries()].reduce(
    (sum, [connection, group]) => sum + analyzeGroup(connection, group).applicationCount,
    0,
  );
}

// Module 74: an ended goal leaves the day, the week keeps the days it lived,
// a done one-off carries its time, scheduled one-offs are counted and
// listed, the week's measure equals the goal's own current week. Every row
// is seeded under this run's identity and deleted by id. Run alone with
// `--module-74`.
async function runEndedGoalScheduledCheck(): Promise<void> {
  const { loadDay } = await import("@/lib/queries/day");
  const { loadWeek } = await import("@/lib/queries/week");
  const { loadGoal } = await import("@/lib/queries/goal");
  const { listDaylessOneOffs, listScheduledOneOffs } = await import("@/lib/queries/one-offs");
  const { tallyDays } = await import("@/lib/day/tally");
  const { getPerson } = await import("@/lib/session");
  const { todayInZone, weekOf } = await import("@/lib/zone");

  const person = await getPerson();
  if (!person) throw new Error("runEndedGoalScheduledCheck: no verified session");
  const userId = person.id;

  const today = todayInZone();
  const yesterday = addDays(today, -1);
  const tomorrow = addDays(today, 1);
  const monday = weekOf(today)[0];
  console.log(`\nmodule 74 check — ${new Date().toISOString()} (today ${today}, monday ${monday})`);

  const db = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });
  const goalIds: string[] = [];
  const oneOffIds: string[] = [];

  async function seedGoal(
    name: string,
    horizon: string,
    measure: { name: string; unit: string } | null,
    archived = false,
  ): Promise<string> {
    const [row] = await db<{ id: string }[]>`
      insert into goals.goals (user_id, name, horizon, measure_name, measure_unit, created_at, archived_at)
      values (${userId}, ${name}, ${horizon}::date, ${measure?.name ?? null}, ${measure?.unit ?? null},
              now() - interval '28 days', ${archived ? new Date().toISOString() : null}::timestamptz)
      returning id
    `;
    goalIds.push(row.id);
    return row.id;
  }
  async function seedCommitment(goalId: string, name: string, quantity: boolean): Promise<string> {
    const [row] = await db<{ id: string }[]>`
      insert into goals.commitments
        (user_id, goal_id, name, cadence_kind, satisfaction, target_quantity, unit, created_at)
      values (${userId}, ${goalId}, ${name}, 'daily', ${quantity ? "quantity" : "tap"},
              ${quantity ? 10 : null}, ${quantity ? "min" : null}, now() - interval '28 days')
      returning id
    `;
    return row.id;
  }
  // `goal_id` rides on the fact the way `declareFact` copies it: `loadGoal`
  // reads a goal's facts by it.
  async function seedFact(
    goalId: string,
    commitmentId: string,
    day: string,
    quantity: number | null,
  ): Promise<void> {
    await db`
      insert into goals.facts (user_id, goal_id, commitment_id, day, quantity)
      values (${userId}, ${goalId}, ${commitmentId}, ${day}::date, ${quantity})
    `;
  }
  async function seedOneOff(name: string, goalId: string | null, day: string | null): Promise<string> {
    const [row] = await db<{ id: string }[]>`
      insert into goals.one_offs (user_id, goal_id, name, day)
      values (${userId}, ${goalId}, ${name}, ${day}::date)
      returning id
    `;
    oneOffIds.push(row.id);
    return row.id;
  }

  try {
    const ended = await seedGoal("check-74 ended", today, null);
    const endedCommitment = await seedCommitment(ended, "check-74 ended tap", false);
    const measured = await seedGoal("check-74 measured", "2099-12-31", { name: "minutos", unit: "min" });
    const measuredCommitment = await seedCommitment(measured, "check-74 minutes", true);
    const plain = await seedGoal("check-74 plain", "2099-12-31", null);
    await seedCommitment(plain, "check-74 plain tap", false);
    const archivedGoal = await seedGoal("check-74 archived", "2099-12-31", null, true);
    await seedCommitment(archivedGoal, "check-74 archived tap", false);

    // 7 on the Monday, 5 today, 100 the week before: the week's measure is 12
    // (5 when today is the Monday itself).
    const expectedMeasure = monday === today ? 5 : 12;
    if (monday !== today) await seedFact(measured, measuredCommitment, monday, 7);
    await seedFact(measured, measuredCommitment, today, 5);
    await seedFact(measured, measuredCommitment, addDays(monday, -7), 100);

    const doneOneOff = await seedOneOff("check-74 done today", null, today);
    await db`
      insert into goals.facts (user_id, one_off_id, goal_id, day)
      values (${userId}, ${doneOneOff}, null, ${today}::date)
    `;
    const [doneFact] = await db<{ written_at: Date }[]>`
      select written_at from goals.facts where one_off_id = ${doneOneOff}
    `;
    const tomorrowOneOff = await seedOneOff("check-74 tomorrow", null, tomorrow);
    const laterOneOff = await seedOneOff("check-74 in three days", null, addDays(today, 3));
    const todayOneOff = await seedOneOff("check-74 dated today", null, today);
    const endedScheduled = await seedOneOff("check-74 ended goal, scheduled", ended, tomorrow);
    const endedDayless = await seedOneOff("check-74 ended goal, dayless", ended, null);

    const dayStart = wireCalls.length;
    const todayDay = await loadDay(today);
    const dayApplication = applicationStatements(wireCalls.slice(dayStart));
    const yesterdayDay = await loadDay(yesterday);
    assert("loadDay still issues four application statements", dayApplication === 4, `${dayApplication}`);

    assert(
      "a goal whose horizon is today is absent from loadDay(today).goals",
      !todayDay.goals.some((goal) => goal.id === ended),
      `goals = ${JSON.stringify(todayDay.goals.map((goal) => goal.name))}`,
    );
    assert(
      "it is present in loadDay(yesterday).goals",
      yesterdayDay.goals.some((goal) => goal.id === ended),
      `goals = ${JSON.stringify(yesterdayDay.goals.map((goal) => goal.name))}`,
    );
    assert(
      "an archived goal is on no day",
      !todayDay.goals.some((goal) => goal.id === archivedGoal) &&
        !yesterdayDay.goals.some((goal) => goal.id === archivedGoal),
      "checked today and yesterday",
    );

    const doneRow = todayDay.doneOneOffs.find((row) => row.id === doneOneOff);
    assert(
      "a one-off completed today carries writtenAt equal to its fact's written_at",
      doneRow !== undefined && new Date(doneRow.writtenAt).getTime() === doneFact.written_at.getTime(),
      `writtenAt = ${doneRow?.writtenAt}, fact ${doneFact.written_at.toISOString()}`,
    );

    const openOneOffs = todayDay.oneOffs.map((row) => row.id);
    assert(
      "a one-off dated tomorrow is not in oneOffs",
      !openOneOffs.includes(tomorrowOneOff) && !openOneOffs.includes(laterOneOff),
      `ids = ${JSON.stringify(openOneOffs)}`,
    );
    assert("a one-off dated today is in oneOffs", openOneOffs.includes(todayOneOff), "checked");

    const [expected] = await db<{ n: number }[]>`
      select count(*)::int as n from goals.one_offs o
      where o.user_id = ${userId}
        and o.day > ${today}::date
        and not exists (select 1 from goals.facts f where f.one_off_id = o.id)
        and (o.goal_id is null or exists (
          select 1 from goals.goals g
          where g.id = o.goal_id and g.archived_at is null and g.horizon > ${today}::date))
    `;
    const countedNow = (await loadDay(today)).scheduledCount;
    assert(
      "scheduledCount counts tomorrow's and the later one, not today's nor an ended goal's",
      countedNow === expected.n && countedNow >= 2,
      `scheduledCount ${countedNow}, database read ${expected.n}`,
    );

    const listStart = wireCalls.length;
    const scheduled = await listScheduledOneOffs(today);
    const listApplication = applicationStatements(wireCalls.slice(listStart));
    const scheduledIds = scheduled.map((row) => row.id);
    assert("listScheduledOneOffs issues two application statements", listApplication === 2, `${listApplication}`);
    assert(
      "listScheduledOneOffs lists tomorrow's and the later one, in day order",
      scheduledIds.includes(tomorrowOneOff) &&
        scheduledIds.includes(laterOneOff) &&
        scheduledIds.indexOf(tomorrowOneOff) < scheduledIds.indexOf(laterOneOff),
      `ids = ${JSON.stringify(scheduledIds)}`,
    );
    assert(
      "it lists neither today's one-off, nor an ended goal's, nor a done one",
      !scheduledIds.includes(todayOneOff) &&
        !scheduledIds.includes(endedScheduled) &&
        !scheduledIds.includes(doneOneOff),
      `ids = ${JSON.stringify(scheduledIds)}`,
    );
    const dayless = (await listDaylessOneOffs()).map((row) => row.id);
    assert(
      "an ended goal's dayless one-off is not listed",
      !dayless.includes(endedDayless),
      `ids = ${JSON.stringify(dayless)}`,
    );

    assert(
      "weekMeasure holds the goal's measure since Monday",
      todayDay.weekMeasure[measured] === expectedMeasure,
      `weekMeasure = ${todayDay.weekMeasure[measured]}, seeded ${expectedMeasure}`,
    );
    const goalView = await loadGoal(measured);
    const currentWeek = goalView?.weeks.find((week) => week.current);
    assert(
      "it equals the current week of loadGoal(id).weeks",
      currentWeek !== undefined && currentWeek.total === todayDay.weekMeasure[measured],
      `loadGoal ${currentWeek?.total}, loadDay ${todayDay.weekMeasure[measured]}`,
    );
    assert(
      "a goal without a measure has no key",
      !(plain in todayDay.weekMeasure) && !(ended in todayDay.weekMeasure),
      `keys = ${JSON.stringify(Object.keys(todayDay.weekMeasure))}`,
    );

    const weekStart = wireCalls.length;
    const week = await loadWeek(today);
    const weekApplication = applicationStatements(wireCalls.slice(weekStart));
    assert("loadWeek still issues four application statements", weekApplication === 4, `${weekApplication}`);
    const weekOneOff = week.oneOffFacts.find((fact) => fact.oneOffId === doneOneOff);
    assert(
      "loadWeek's one-off facts carry the one-off's id and name",
      weekOneOff?.name === "check-74 done today",
      `fact = ${JSON.stringify(weekOneOff)}`,
    );
    const endedInWeek = week.goals.some((goal) => goal.id === ended);
    assert(
      "a goal that ended yesterday is in loadWeek(today).goals when yesterday is in the week, absent when the week starts today",
      endedInWeek === (monday !== today),
      `inWeek = ${endedInWeek}, monday ${monday}, today ${today}`,
    );
    assert(
      "an archived goal is not in loadWeek's goals",
      !week.goals.some((goal) => goal.id === archivedGoal),
      "checked",
    );

    const without = { ...week, goals: week.goals.filter((goal) => goal.id !== ended) };
    const withEnded = tallyDays(week);
    const withoutEnded = tallyDays(without);
    const delta = withEnded.map((tally, i) => tally.total - withoutEnded[i].total);
    const days = week.view.days.map((day) => day.day);
    const expectedDelta = days.map((day) =>
      day < today && week.view.days.find((d) => d.day === day)!.slots.some((slot) => slot.commitmentId === endedCommitment)
        ? 1
        : 0,
    );
    assert(
      "the ended goal's commitment counts in tallyDays for the days before today and not from today",
      JSON.stringify(delta) === JSON.stringify(expectedDelta) &&
        (monday === today || expectedDelta.some((n) => n === 1)),
      `delta = ${JSON.stringify(delta)}, expected ${JSON.stringify(expectedDelta)}`,
    );

    // A commitment retired earlier this week still feeds the goal's week:
    // `weekMeasure` must equal the goal's own current row. Impossible on a
    // Monday, when nothing can have been retired earlier in the week.
    if (monday !== today) {
      const retiredGoal = await seedGoal("check-74 retired", "2099-12-31", { name: "minutos", unit: "min" });
      const live = await seedCommitment(retiredGoal, "check-74 retired goal, live", true);
      const gone = await seedCommitment(retiredGoal, "check-74 retired goal, gone", true);
      await db`update goals.commitments set retired_at = now() - interval '1 day' where id = ${gone}`;
      await seedFact(retiredGoal, gone, monday, 4);
      await seedFact(retiredGoal, live, today, 5);
      const retiredDay = await loadDay(today);
      const retiredCurrent = (await loadGoal(retiredGoal))?.weeks.find((week) => week.current);
      assert(
        "weekMeasure still counts a commitment retired earlier this week, as loadGoal does",
        retiredCurrent !== undefined &&
          retiredCurrent.total === 9 &&
          retiredDay.weekMeasure[retiredGoal] === retiredCurrent.total,
        `loadGoal ${retiredCurrent?.total}, loadDay ${retiredDay.weekMeasure[retiredGoal]}, seeded 9`,
      );
    }
  } finally {
    if (oneOffIds.length > 0) {
      await db`delete from goals.one_offs where id in ${db(oneOffIds)} and user_id = ${userId}`;
    }
    if (goalIds.length > 0) {
      await db`delete from goals.goals where id in ${db(goalIds)} and user_id = ${userId}`;
    }
    await db.end();
  }
}

// Desktop slice survivors. Every row lives in a fixed past week so no other
// goal of the person can outrank or join it, is seeded under this run's
// identity, and is deleted by id.
async function runDesktopSurvivorsCheck(): Promise<void> {
  const { loadDay } = await import("@/lib/queries/day");
  const { loadWeek } = await import("@/lib/queries/week");
  const { getPerson } = await import("@/lib/session");
  const { weekOf } = await import("@/lib/zone");

  const person = await getPerson();
  if (!person) throw new Error("runDesktopSurvivorsCheck: no verified session");
  const userId = person.id;

  const db = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });
  const goalIds: string[] = [];
  const deviceId = "00000000-0000-4000-8000-0000000000d5";

  async function seedGoal(name: string, horizon: string, opts: { archived?: boolean; unit?: string } = {}) {
    const [row] = await db<{ id: string }[]>`
      insert into goals.goals (user_id, name, horizon, measure_name, measure_unit, created_at, archived_at)
      values (${userId}, ${name}, ${horizon}::date, ${opts.unit ?? null}, ${opts.unit ?? null},
              '2009-12-01T00:00:00Z'::timestamptz, ${opts.archived ? "2010-01-01T00:00:00Z" : null}::timestamptz)
      returning id
    `;
    goalIds.push(row.id);
    return row.id;
  }

  try {
    // 2010-06-07 is a Monday.
    const monday = "2010-06-07";
    assert("the fixture Monday is a Monday", weekOf("2010-06-09")[0] === monday, weekOf("2010-06-09")[0]);

    // Hoy's all-ended card names the goal that ended last, and never an
    // archived one, however late its horizon.
    await seedGoal("survivor first-ended", "2010-06-01");
    await seedGoal("survivor last-ended", "2010-06-05");
    await seedGoal("survivor archived-later", "2010-06-06", { archived: true });
    const ended = (await loadDay("2010-06-09")).lastEnded;
    assert(
      "lastEnded names the goal that ended last, not the first and not an archived one",
      ended?.name === "survivor last-ended",
      `lastEnded = ${JSON.stringify(ended)}`,
    );

    // A goal that ended on or before the week's Monday never draws in the week.
    const beforeWeek = await seedGoal("survivor ended before week", "2010-06-03");
    const onMonday = await seedGoal("survivor ends on monday", monday);
    const inWeek = await seedGoal("survivor ends in week", "2010-06-08");
    const week = await loadWeek("2010-06-09");
    const weekIds = week.goals.map((goal) => goal.id);
    assert(
      "loadWeek omits a goal whose horizon is before the week and one whose horizon is the Monday",
      !weekIds.includes(beforeWeek) && !weekIds.includes(onMonday),
      `ended-before present ${weekIds.includes(beforeWeek)}, ends-on-monday present ${weekIds.includes(onMonday)}`,
    );
    assert("loadWeek keeps a goal that ends inside the week", weekIds.includes(inWeek), `ids = ${JSON.stringify(weekIds)}`);

    // The weekly figure reads evidence from every earlier day of the week,
    // and none from the week before.
    const measured = await seedGoal("survivor measured", "2099-12-31", { unit: "searches" });
    const [source] = await db<{ id: string }[]>`select id from goals.evidence_sources where key = 'reading_lookups'`;
    await db`
      insert into goals.commitments
        (user_id, goal_id, name, cadence_kind, satisfaction, source_id, threshold, created_at)
      values (${userId}, ${measured}, 'survivor evidence', 'daily', 'evidence', ${source.id}, 1,
              '2009-12-01T00:00:00Z'::timestamptz)
    `;
    const lookupAt = ["2010-06-07T17:00:00Z", "2010-06-07T18:00:00Z", "2010-06-06T17:00:00Z"];
    for (const [i, at] of lookupAt.entries()) {
      await db`
        insert into reading.lookups
          (user_id, device_id, local_id, at, received_at, text, normalised, kind, outcome,
           dictionary_ready, record_schema)
        values (${userId}, ${deviceId}, ${i + 1}, ${at}::timestamptz, ${at}::timestamptz, 'x', 'x',
                'word', 'exact', true, 1)
      `;
    }
    const measure = (await loadDay("2010-06-09")).weekMeasure[measured];
    assert(
      "weekMeasure on Wednesday counts Monday's two searches and not the Sunday before",
      measure === 2,
      `weekMeasure = ${measure}, seeded 2 on Monday and 1 on the Sunday before`,
    );
  } finally {
    await db`delete from reading.lookups where user_id = ${userId} and device_id = ${deviceId}::uuid`;
    if (goalIds.length > 0) {
      await db`delete from goals.goals where id in ${db(goalIds)} and user_id = ${userId}`;
    }
    await db.end();
  }
}

// Semana counts a flexible cadence by its own period (module 91). The week
// 2010-05-31..06-06 crosses a month, so «al mes» reaches facts the week's own
// rows never read, and «por semana» must not read the week before.
async function runFlexiblePeriodCheck(): Promise<void> {
  const { loadWeek } = await import("@/lib/queries/week");
  const { getPerson } = await import("@/lib/session");

  const person = await getPerson();
  if (!person) throw new Error("runFlexiblePeriodCheck: no verified session");
  const userId = person.id;

  const db = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });
  let goalId: string | null = null;

  async function seedCommitment(name: string, kind: string, count: number | null): Promise<string> {
    const [row] = await db<{ id: string }[]>`
      insert into goals.commitments (user_id, goal_id, name, cadence_kind, cadence_n, satisfaction, created_at)
      values (${userId}, ${goalId}, ${name}, ${kind}, ${count}, 'tap', '2009-12-01T00:00:00Z'::timestamptz)
      returning id
    `;
    return row.id;
  }
  async function seedFacts(commitmentId: string, days: string[]): Promise<void> {
    for (const day of days) {
      await db`
        insert into goals.facts (user_id, goal_id, commitment_id, day)
        values (${userId}, ${goalId}, ${commitmentId}, ${day}::date)
      `;
    }
  }

  try {
    const [goal] = await db<{ id: string }[]>`
      insert into goals.goals (user_id, name, horizon, created_at)
      values (${userId}, 'check-91 flexible', '2099-12-31'::date, '2009-12-01T00:00:00Z'::timestamptz)
      returning id
    `;
    goalId = goal.id;
    const weekly = await seedCommitment("check-91 weekly", "times_per_week", 3);
    const monthly = await seedCommitment("check-91 monthly", "times_per_month", 4);
    const daily = await seedCommitment("check-91 daily", "daily", null);
    // Weekly: two inside the week, one the week before. Monthly: four in June
    // (two inside the week, two after it) and one in May inside the week, so
    // counting the month by the week would say 3 and the month says 4.
    await seedFacts(weekly, ["2010-05-31", "2010-06-02", "2010-05-25"]);
    await seedFacts(monthly, ["2010-06-01", "2010-06-02", "2010-06-15", "2010-06-20", "2010-05-31"]);

    const week = await loadWeek("2010-06-02");
    const byId = new Map(week.commitments.map((c) => [c.id, c]));
    assert(
      "a times-per-week commitment counts the days it was done in this week only",
      byId.get(weekly)?.periodDone === 2,
      `periodDone = ${byId.get(weekly)?.periodDone}, seeded 2 in the week and 1 the week before`,
    );
    assert(
      "a times-per-month commitment counts its month, past the week's own days and not the month before",
      byId.get(monthly)?.periodDone === 4,
      `periodDone = ${byId.get(monthly)?.periodDone}, seeded 4 in June (2 in the week) and 1 in May`,
    );

    // A week that begins inside the month: the fact before its Monday still
    // belongs to the month, the one after its Sunday too.
    const inside = await seedCommitment("check-91 monthly inside", "times_per_month", 5);
    await seedFacts(inside, ["2010-06-03", "2010-06-15", "2010-06-30", "2010-05-30"]);
    const later = await loadWeek("2010-06-16");
    const insideRow = later.commitments.find((c) => c.id === inside);
    assert(
      "a times-per-month commitment counts a fact of its month before the week begins, and one after it ends",
      insideRow?.periodDone === 3,
      `periodDone = ${insideRow?.periodDone}, seeded 06-03 (before the week 06-14..20), 06-15, 06-30 and 05-30 (May)`,
    );
    assert(
      "a daily commitment carries no period count",
      byId.get(daily)?.periodDone === null,
      `periodDone = ${byId.get(daily)?.periodDone}`,
    );
  } finally {
    if (goalId) await db`delete from goals.goals where id = ${goalId} and user_id = ${userId}`;
    await db.end();
  }
}

async function runMain(): Promise<void> {
  installStubs(loadCookies(), false);

  if (process.argv.includes("--module-74")) {
    await runEndedGoalScheduledCheck();
    console.log(failed ? "REPORT  failed" : "REPORT  passed");
    process.exit(failed ? 1 : 0);
  }

  const { loadDay } = await import("@/lib/queries/day");
  const { todayInZone } = await import("@/lib/zone");
  const today = todayInZone();

  // First call: whatever the pool's connections happen to be, cold after
  // this process's own startup. Its bracket, its type-fetch cap and its
  // statement count are asserted like any other run; only its overlap is
  // not — the user's own decided note names the cold dial, never a free
  // pass on the rest.
  const coldStart = wireCalls.length;
  const cold = await loadDay(today);
  reportRun("cold", wireCalls.slice(coldStart), false);

  // Five consecutive warm calls, each bounded on its own: a fix that only
  // holds for the first one or two warm calls after the cold one is a fix a
  // later screen the same minute would still be paying for — independent
  // validation found exactly that hole with a mutation that only bit from
  // the fourth `withGoalsDb` call on. Five, not more: this is the number
  // that closed the hole, and chasing a larger one buys nothing new.
  const WARM_CALLS = 5;
  const warmResults: Awaited<ReturnType<typeof loadDay>>[] = [];
  for (let i = 1; i <= WARM_CALLS; i++) {
    const start = wireCalls.length;
    const result = await loadDay(today);
    reportRun(`warm-${i}`, wireCalls.slice(start), true);
    warmResults.push(result);
    assert(`the warm-${i} run reads the source`, result.evidence === "read", `evidence = ${result.evidence}`);
  }

  const coldSlotIds = cold.view.slots.map((slot) => slot.commitmentId).sort();
  const warmSlotIdLists = warmResults.map((result) => result.view.slots.map((slot) => slot.commitmentId).sort());
  const lastWarmSlotIds = warmSlotIdLists[warmSlotIdLists.length - 1] ?? [];
  assert(
    "the cold and every warm run declare the same slots",
    warmSlotIdLists.every((ids) => JSON.stringify(ids) === JSON.stringify(coldSlotIds)),
    `cold ${coldSlotIds.length} slot(s); warm ${warmSlotIdLists.map((ids) => ids.length).join(", ")} slot(s)`,
  );

  const degraded = runDegradedChildProcess();

  console.log(`\ndegraded run — evidence = ${degraded.evidence}`);
  console.log(`  undegraded slots: [${lastWarmSlotIds.join(", ")}]`);
  console.log(`  degraded slots:   [${degraded.slotIds.join(", ")}]`);

  assert(
    "the degraded run reports the source unreadable",
    degraded.evidence === "unreadable",
    `evidence = ${degraded.evidence}`,
  );
  assert(
    "every declared slot is still present when the source cannot be read",
    JSON.stringify(degraded.slotIds) === JSON.stringify(lastWarmSlotIds),
    `undegraded ${lastWarmSlotIds.length} slot(s), degraded ${degraded.slotIds.length} slot(s)`,
  );

  await runZoneCheck();
  await runCadenceZoneCheck();
  await runWeekCommitmentsZoneCheck();
  await runPhaseWeekBoundCheck();
  await runFactSatisfactionCheck();
  await runEvidenceRefusalCheck();
  await runFactUniqueCheck();
  await runReplaceRaceCheck();
  await runOneOffCarryCheck();
  await runFactWrittenOnCheck();
  await runPhaseDayBoundCheck();
  await runCreatedOnAndOneOffsCheck();
  await runDaylessCountAndOrderCheck();
  await runEndedGoalScheduledCheck();
  await runDesktopSurvivorsCheck();
  await runFlexiblePeriodCheck();
  await runEndedThisWeekCheck();

  console.log("");
  console.log(failed ? "REPORT  failed" : "REPORT  passed");
  process.exit(failed ? 1 : 0);
}

// Hoy's «terminó ayer» line: goals whose last day fell in the week of the
// viewed day, before it. Rows live in a fixed 2010 week (Mon 06-07).
async function runEndedThisWeekCheck(): Promise<void> {
  const { loadDay } = await import("@/lib/queries/day");
  const { getPerson } = await import("@/lib/session");

  const person = await getPerson();
  if (!person) throw new Error("runEndedThisWeekCheck: no verified session");
  const db = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });
  const ids: string[] = [];

  async function seedGoal(name: string, horizon: string, archived = false) {
    const [row] = await db<{ id: string }[]>`
      insert into goals.goals (user_id, name, horizon, created_at, archived_at)
      values (${person!.id}, ${name}, ${horizon}::date, '2009-12-01T00:00:00Z'::timestamptz,
              ${archived ? "2010-01-01T00:00:00Z" : null}::timestamptz)
      returning id
    `;
    ids.push(row.id);
    return row.id;
  }

  try {
    const previousWeek = await seedGoal("ended-week last day sunday before", "2010-06-07");
    const monday = await seedGoal("ended-week last day monday", "2010-06-08");
    const tuesday = await seedGoal("ended-week last day tuesday", "2010-06-09");
    await seedGoal("ended-week archived", "2010-06-09", true);
    await seedGoal("ended-week still open", "2010-06-11");
    const ended = (await loadDay("2010-06-10")).endedThisWeek;
    const seeded = ended.filter((goal) => goal.name.startsWith("ended-week"));
    assert(
      "endedThisWeek lists the goals whose last day fell this week, most recent first, with the last day",
      JSON.stringify(seeded) ===
        JSON.stringify([
          { id: tuesday, name: "ended-week last day tuesday", lastDay: "2010-06-08" },
          { id: monday, name: "ended-week last day monday", lastDay: "2010-06-07" },
        ]),
      `endedThisWeek = ${JSON.stringify(seeded)}; the previous week's goal ${previousWeek} must be absent`,
    );
    const sunday = (await loadDay("2010-06-13")).endedThisWeek.filter((goal) => goal.name.startsWith("ended-week"));
    assert(
      "endedThisWeek on the Sunday holds the whole week's endings, the goal open on Thursday included",
      sunday.length === 3 && sunday[0].lastDay === "2010-06-10",
      `endedThisWeek on Sunday = ${JSON.stringify(sunday)}`,
    );

    // A fixed week (Mon 2010-08-02): endings on Monday, Tuesday and Thursday
    // read from its Friday, in horizon-descending order, and none from before.
    const before = await seedGoal("fixed-week before", "2010-08-02");
    const fixedMon = await seedGoal("fixed-week mon", "2010-08-03");
    const fixedTue = await seedGoal("fixed-week tue", "2010-08-04");
    const fixedThu = await seedGoal("fixed-week thu", "2010-08-06");
    const fixed = (await loadDay("2010-08-06")).endedThisWeek.filter((goal) => goal.name.startsWith("fixed-week"));
    assert(
      "endedThisWeek from a Friday holds the Thursday, Tuesday and Monday endings in horizon-descending order, none from the week before",
      JSON.stringify(fixed.map((goal) => [goal.id, goal.lastDay])) ===
        JSON.stringify([[fixedThu, "2010-08-05"], [fixedTue, "2010-08-03"], [fixedMon, "2010-08-02"]]),
      `endedThisWeek = ${JSON.stringify(fixed)}; the previous week's goal ${before} must be absent`,
    );
  } finally {
    if (ids.length > 0) await db`delete from goals.goals where id in ${db(ids)}`;
    await db.end();
  }
}

void (async () => {
  try {
    if (process.argv.includes("--degraded-child")) {
      await runDegradedChild();
      // `failed` is this process's own — a fresh process per run, so this
      // reads only what `reportDegradedRun` just asserted, nothing carried
      // over from a previous invocation.
      process.exit(failed ? 1 : 0);
    } else {
      await runMain();
    }
  } catch (error) {
    console.error(`FAILED  ${(error as Error).message}`);
    process.exit(1);
  }
})();
