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

async function runDegradedChild(): Promise<void> {
  installStubs(loadCookies(), true);

  const { loadDay } = await import("@/lib/queries/day");
  const { todayInZone } = await import("@/lib/zone");

  const { view, evidence } = await loadDay(todayInZone());
  const result: DegradedResult = {
    evidence,
    slotIds: view.slots.map((slot) => slot.commitmentId).sort(),
  };
  console.log(`${DEGRADED_MARKER}${JSON.stringify(result)}`);
}

function runDegradedChildProcess(): DegradedResult {
  const output = execFileSync(
    process.execPath,
    ["--import", "tsx", "--env-file=.env.local", "scripts/check-day.ts", "--degraded-child"],
    { cwd: process.cwd(), env: process.env, encoding: "utf8" },
  );
  const line = output.split("\n").find((row) => row.startsWith(DEGRADED_MARKER));
  if (!line) throw new Error(`degraded child printed no result:\n${output}`);
  return JSON.parse(line.slice(DEGRADED_MARKER.length)) as DegradedResult;
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

  console.log("");
  console.log(failed ? "REPORT  failed" : "REPORT  passed");
  process.exit(failed ? 1 : 0);
}

void (async () => {
  try {
    if (process.argv.includes("--degraded-child")) {
      await runDegradedChild();
      process.exit(0);
    } else {
      await runMain();
    }
  } catch (error) {
    console.error(`FAILED  ${(error as Error).message}`);
    process.exit(1);
  }
})();
