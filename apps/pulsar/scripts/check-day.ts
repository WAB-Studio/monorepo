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

  const goal = await createGoal({ name: "check-day zone probe", horizon: "2019-12-31" });
  if (!goal.ok) throw new Error(`runZoneCheck: createGoal failed: ${goal.error}`);

  const commitment = await addCommitment({
    goalId: goal.goalId,
    name: "check-day zone probe",
    cadenceKind: "daily",
    satisfaction: "tap",
  });
  if (!commitment.ok) throw new Error(`runZoneCheck: addCommitment failed: ${commitment.error}`);
  const testId = commitment.commitmentId;

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

  const goal = await createGoal({ name: "check-day cadence zone probe", horizon: "2019-12-31" });
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

  const goal = await createGoal({ name: "check-day week-commitments zone probe", horizon: "2019-12-31" });
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

  const undone = await createOneOff({ name: "check-day carry probe undone", day: threeDaysBack });
  if (!undone.ok) {
    throw new Error(`runOneOffCarryCheck: createOneOff (undone) failed: ${undone.error}`);
  }

  const doneElsewhen = await createOneOff({
    name: "check-day carry probe done-elsewhen",
    day: threeDaysBack,
  });
  if (!doneElsewhen.ok) {
    throw new Error(`runOneOffCarryCheck: createOneOff (done-elsewhen) failed: ${doneElsewhen.error}`);
  }

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

async function runMain(): Promise<void> {
  installStubs(loadCookies(), false);

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

  console.log("");
  console.log(failed ? "REPORT  failed" : "REPORT  passed");
  process.exit(failed ? 1 : 0);
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
