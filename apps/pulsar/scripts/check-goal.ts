// Proves module 28's `loadGoal` fan-out the same way `scripts/check-day.ts`
// proves `loadDay`'s: by counting statements off the driver's own wire, not
// off `goal.ts`'s source text, and by redeeming this lane's own
// `private/session-<lane>.json` cookie rather than typing anything into
// `/entrar`. Read that file first — the technique below (debug-hook
// instrumentation, one begin/one commit per connection, an exact match on
// `postgres`'s own type-fetch text, capped at one per connection and zero
// warm) is copied from it verbatim, not reinvented.
//
// This closes the one hole module 28's own validator found in its gitignored
// probe (`private/check-goal.ts`, a copy sits at
// `private/reportes/check-goal.modulo28.ts`): that probe's SQL-text
// assertion only tested that `"goals"."goals"` appears *somewhere* in the
// reading statement, so a `from` bound rewritten as a hardcoded
// `sql`'0001-01-01'::date`` still passed — the `to` bound's own reference
// carried the whole assertion. `assertReadingBounds` below extracts the
// `between <from> and <to>` clause `goalSpan`'s own two subqueries land in
// (`lib/queries/goal.ts`) and checks each side on its own.
//
// No goal on this shared database, for any harness identity, has an
// evidence-only measuring commitment (checked before writing this file), so
// this script seeds one itself — through `createGoal`/`addCommitment`/
// `retireCommitment`, never a raw INSERT — the same three actions module
// 28's probe drove.
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

// `mint-session.ts`'s own file, read the same way `check-day.ts` reads it.
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

// "none": the real registry reader, against the real (empty, for a fresh
// identity) `reading.lookups`. "stub": the reader replaced with three known
// rows, to prove the sum against a number no real row on this database can
// produce for any harness identity. "degraded": the reader replaced with one
// that always rejects, to prove RNP-04's failure path.
type StubMode = "none" | "stub" | "degraded";

const STUB_QUANTITIES = [5, 3, 2];
const STUB_TOTAL = STUB_QUANTITIES.reduce((a, b) => a + b, 0);

function todayInBogota(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
}

/**
 * Installs every stub `@/lib/queries/goal.ts`'s own import chain needs to run
 * outside Next, the reader override named by `mode` included. Has to run
 * before the first `@/`-rooted import — `check-day.ts`'s own warning, word
 * for word: `_load` binds each `require` once, and a module already required
 * is a module this cannot reach again.
 */
function installStubs(cookies: StoredCookie[], mode: StubMode): void {
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
    if (mode === "degraded" && request === "./reading-lookups") {
      return {
        readReadingLookups: async () => {
          throw new Error("check-goal.ts: simulated reading-lookups failure");
        },
      };
    }
    if (mode === "stub" && request === "./reading-lookups") {
      return {
        readReadingLookups: async () => {
          const day = todayInBogota();
          return STUB_QUANTITIES.map((quantity) => ({
            day,
            quantity,
            unit: "searches",
            labelKey: "sources.readingLookups",
          }));
        },
      };
    }
    // Wraps `postgres` itself once, so every statement `db/client.ts`'s pool
    // sends is counted — `prepare`, `max` and `idle_timeout` pass through
    // untouched, the pool under measurement stays the pool `loadGoal` gets.
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

// `postgres`'s own default `fetch_types: true` (never set in `db/client.ts`)
// sends exactly this query the first time a physical connection is ever
// used — read verbatim off `node_modules/postgres/src/connection.js`'s own
// `fetchArrayTypes`, the same text `check-day.ts` matches. An exact match on
// the whole statement, whitespace collapsed: a bare `pg_catalog.pg_type`
// substring match would let a statement that merely *mentions* that catalog
// net itself out of the count it is supposed to inflate.
const TYPE_FETCH_QUERY_TEXT =
  "select b.oid, b.typarray from pg_catalog.pg_type a left join pg_catalog.pg_type b " +
  "on b.oid = a.typelem where a.typcategory = 'a' group by b.oid, b.typarray order by b.oid";

function isTypeFetchText(query: string): boolean {
  return query.replace(/\s+/g, " ").trim().toLowerCase() === TYPE_FETCH_QUERY_TEXT;
}

// The settle statement's third `set_config` argument is the search path
// `withGoalsDb`/`withReadingDb` chose (`lib/session.ts`) — read from
// `parameters`, not guessed from the query text.
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
  // sends on a connection's first-ever use — what `loadGoal` itself chose to
  // send. The settle (`set_config`) statement is not netted out here: it is
  // one of `loadGoal`'s own two statements per connection, the same way
  // `check-day.ts` counts it for `loadDay`.
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

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let index = 0;
  for (;;) {
    index = text.indexOf(needle, index);
    if (index === -1) return count;
    count++;
    index += needle.length;
  }
}

/**
 * Splits the reading statement's own `between <from> and <to>` clause
 * (`reading-lookups.ts`'s `civilDay between ${from} and ${to}`) into the two
 * bound expressions `goalSpan` built (`lib/queries/goal.ts`), by tracking
 * paren depth rather than assuming either side is wrapped in one: a bound
 * rewritten as a bare literal (the mutation this function exists to catch)
 * has no parens of its own, and a naive `(select ...)` match would silently
 * skip right past it. Returns `null` when no top-level `and` is found at all
 * — a shape this file has never seen sent, and one this function must fail
 * closed on rather than guess at.
 */
function splitBetweenBounds(query: string): { from: string; to: string } | null {
  const between = /\bbetween\b/i.exec(query);
  if (!between) return null;

  let i = between.index + between[0].length;
  const fromStart = i;
  let depth = 0;
  let andIndex = -1;
  for (; i < query.length; i++) {
    const ch = query[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && /^\s+and\b/i.test(query.slice(i))) {
      andIndex = i;
      break;
    }
  }
  if (andIndex === -1) return null;
  const fromText = query.slice(fromStart, andIndex).trim();

  const andWord = /^\s+and\b/i.exec(query.slice(andIndex));
  if (!andWord) return null;
  let j = andIndex + andWord[0].length;
  const toStart = j;
  depth = 0;
  let toEnd = query.length;
  for (; j < query.length; j++) {
    const ch = query[j];
    if (ch === "(") depth++;
    else if (ch === ")") {
      if (depth === 0) {
        toEnd = j;
        break;
      }
      depth--;
    }
  }
  const toText = query.slice(toStart, toEnd).trim();

  return { from: fromText, to: toText };
}

// The reading connection's own application statement, net of its settle,
// its bracket and any type-fetch — the one statement `readReadingLookups`
// sends, found the same bounded way `analyzeGroup` bounds everything else.
function findReadingAppCall(calls: DebugCall[]): DebugCall | undefined {
  for (const [, groupCalls] of groupByConnection(calls)) {
    if (labelConnection(groupCalls) !== "reading") continue;
    return groupCalls.find((call) => {
      const normalized = normalizeStatement(call.query);
      return (
        !normalized.startsWith("begin") &&
        normalized !== "commit" &&
        normalized !== "rollback" &&
        !/set_config/i.test(call.query) &&
        !isTypeFetchText(call.query)
      );
    });
  }
  return undefined;
}

/**
 * The assertion module 28's own probe did not make: `"goals"."goals"` named
 * once in the `from` bound and once in the `to` bound, checked independently
 * rather than counted across the whole statement. A count of two across the
 * whole statement would still pass if one bound carried both references and
 * the other none — this reads the two bounds apart first, the way `goalSpan`
 * itself built them apart, and fails on either alone missing its reference.
 */
function assertReadingBounds(label: string, calls: DebugCall[]): void {
  const call = findReadingAppCall(calls);
  if (!call) {
    assert(`${label} run's reading statement bounds "goals"."goals" on both from and to`, false, "no reading application statement found on the wire");
    return;
  }
  const bounds = splitBetweenBounds(call.query);
  if (!bounds) {
    assert(
      `${label} run's reading statement bounds "goals"."goals" on both from and to`,
      false,
      `no "between ... and ..." clause found in: ${call.query.replace(/\s+/g, " ").trim()}`,
    );
    return;
  }
  const fromOk = countOccurrences(bounds.from, `"goals"."goals"`) === 1;
  const toOk = countOccurrences(bounds.to, `"goals"."goals"`) === 1;
  assert(
    `${label} run's reading statement bounds "goals"."goals" on both from and to`,
    fromOk && toOk,
    `from = ${bounds.from} | to = ${bounds.to}`,
  );
}

/**
 * Prints every connection's own window, bracket and statement counts, and
 * asserts on all of it — the same shape `check-day.ts`'s `reportRun` asserts,
 * plus `assertReadingBounds` above: every connection brackets exactly one
 * `begin` and one `commit`, never a `rollback`, never a second one of
 * either; at most one type-fetch statement per connection, none at all on a
 * warm run; the application statements, net of that bracket and of any
 * legitimate type-fetch, total exactly four — asserted on the cold run too;
 * only when `isWarm`, the two windows overlap in wall-clock time; and the
 * reading statement's own `from`/`to` bounds each name the goal's row.
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

  assertReadingBounds(label, calls);
}

// Whole civil days added to a `YYYY-MM-DD` string, by midday UTC — the same
// technique `seed-goal.ts` and `lib/zone.ts`'s own `weekOf` use.
function addDays(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(date);
}

/**
 * A goal whose only *active* measuring commitment is evidence-satisfied: a
 * quantity commitment names the measure ("searches") and is retired the same
 * run — the mechanism RP-12's own note describes for a correction — leaving
 * only the evidence commitment, of the same unit, asking. Never a raw
 * INSERT: the same three actions `seed-goal.ts` drives.
 */
async function seedEvidenceOnlyGoal(): Promise<string> {
  const { createGoal, addCommitment, retireCommitment } = await import("@/app/actions/plan");
  const { todayInZone } = await import("@/lib/zone");

  const today = todayInZone();
  const goal = await createGoal({
    name: "check-goal.ts probe — evidence-only measure",
    horizon: addDays(today, 30),
  });
  if (!goal.ok) throw new Error(`createGoal: ${goal.error}`);

  const counter = await addCommitment({
    goalId: goal.goalId,
    name: "check-goal.ts probe — contador manual (a retirar)",
    cadenceKind: "daily",
    satisfaction: "quantity",
    targetQuantity: 1,
    unit: "searches",
  });
  if (!counter.ok) throw new Error(`addCommitment(counter): ${counter.error}`);

  const retired = await retireCommitment({ commitmentId: counter.commitmentId });
  if (!retired.ok) throw new Error(`retireCommitment: ${retired.error}`);

  const evidence = await addCommitment({
    goalId: goal.goalId,
    name: "check-goal.ts probe — evidencia de lectura",
    cadenceKind: "daily",
    satisfaction: "evidence",
    sourceKey: "reading_lookups",
    threshold: 1,
  });
  if (!evidence.ok) throw new Error(`addCommitment(evidence): ${evidence.error}`);

  return goal.goalId;
}

const CHILD_MARKER = "CHILD_JSON ";

type ChildResult = { evidence: string; measureTotal: number; measureUnit: string | null };

/**
 * The child's own report: the goals connection's usual bracket, the reading
 * connection's own (a normal commit for `stub`, a rollback for `degraded` —
 * `sql.begin` answers a thrown callback with `rollback`, never `commit`,
 * `node_modules/postgres/src/index.js`'s own `begin()`), and the total
 * application-statement count — never left uncounted the way independent
 * validation found `check-day.ts`'s own degraded child once did.
 */
function reportChildRun(label: string, calls: DebugCall[], expectReadingCommit: boolean): void {
  const groups = [...groupByConnection(calls).entries()].map(([connection, groupCalls]) =>
    analyzeGroup(connection, groupCalls),
  );
  const totalApplication = groups.reduce((sum, group) => sum + group.applicationCount, 0);

  console.log(
    `\n${label} child's own wire — ${calls.length} statement(s) across ${groups.length} connection(s), ` +
      `${totalApplication} application statement(s)`,
  );
  for (const group of groups) {
    console.log(
      `  ${group.label.padEnd(8)} cid=${group.connection} begin=${group.beginCount} commit=${group.commitCount} ` +
        `rollback=${group.rollbackCount}, application=${group.applicationCount}, type-fetch=${group.typeFetchCount}`,
    );
  }

  const overCapped = groups.filter((group) => group.typeFetchCount > 1);
  assert(
    `${label} child's connections send at most one type-fetch statement each`,
    overCapped.length === 0,
    overCapped.length === 0
      ? `${groups.length} connection(s), each type-fetch <= 1`
      : overCapped.map((group) => `cid=${group.connection} (${group.label}) type-fetch=${group.typeFetchCount}`).join("; "),
  );

  const goalsGroups = groups.filter((group) => group.label === "goals");
  const readingGroups = groups.filter((group) => group.label === "reading");
  assert(
    `${label} child opens exactly one goals connection and one reading connection`,
    groups.length === 2 && goalsGroups.length === 1 && readingGroups.length === 1,
    `${groups.length} connection(s): ${groups.map((group) => group.label).join(", ") || "none"}`,
  );

  const goals = goalsGroups[0];
  if (goals) {
    assert(
      `${label} child's goals connection brackets exactly one begin and one commit, no rollback`,
      goals.beginCount === 1 && goals.commitCount === 1 && goals.rollbackCount === 0,
      `begin=${goals.beginCount} commit=${goals.commitCount} rollback=${goals.rollbackCount}`,
    );
  }

  const reading = readingGroups[0];
  if (reading) {
    const readingOk = expectReadingCommit
      ? reading.beginCount === 1 && reading.commitCount === 1 && reading.rollbackCount === 0
      : reading.beginCount === 1 && reading.commitCount === 0 && reading.rollbackCount === 1;
    assert(
      `${label} child's reading connection brackets exactly one begin and one ${expectReadingCommit ? "commit" : "rollback"}`,
      readingOk,
      `begin=${reading.beginCount} commit=${reading.commitCount} rollback=${reading.rollbackCount}`,
    );
  }

  // Neither `stub` nor `degraded` ever lets the reader's own statement reach
  // the wire (the whole `readReadingLookups` module is replaced before
  // `loadGoal` ever imports it), so both children total the goals
  // connection's two statements (settle, query) plus the reading
  // connection's settle alone — one round trip cheaper than the four
  // `reportRun` bounds a real reader to, and a fact this file measures
  // rather than assumes.
  const expectedTotal = 3;
  assert(
    `${label} child issues ${expectedTotal} application statements, no more`,
    totalApplication === expectedTotal,
    `${totalApplication} application statement(s) of ${calls.length} on the wire`,
  );
}

async function runChild(mode: "stub" | "degraded", goalId: string): Promise<void> {
  installStubs(loadCookies(), mode);

  const { loadGoal } = await import("@/lib/queries/goal");

  const start = wireCalls.length;
  const view = await loadGoal(goalId);
  reportChildRun(mode, wireCalls.slice(start), mode === "stub");

  const result: ChildResult = {
    evidence: view.evidence,
    measureTotal: view.measureTotal,
    measureUnit: view.measureUnit,
  };
  console.log(`${CHILD_MARKER}${JSON.stringify(result)}`);
}

function runChildProcess(mode: "stub" | "degraded", goalId: string): ChildResult {
  let output: string;
  try {
    output = execFileSync(
      process.execPath,
      ["--import", "tsx", "--env-file=.env.local", "scripts/check-goal.ts", `--child=${mode}`, `--goal=${goalId}`],
      { cwd: process.cwd(), env: process.env, encoding: "utf8" },
    );
  } catch (error) {
    // The child's own PASS/FAIL lines are on its stdout, lost the moment
    // `execFileSync` throws unless printed here — the only place a caller of
    // this function still has them.
    const execError = error as { stdout?: string; stderr?: string; message: string };
    if (execError.stdout) console.log(execError.stdout);
    if (execError.stderr) console.error(execError.stderr);
    throw new Error(`${mode} child process failed: ${execError.message}`);
  }
  console.log(output);
  const line = output.split("\n").find((row) => row.startsWith(CHILD_MARKER));
  if (!line) throw new Error(`${mode} child printed no result:\n${output}`);
  return JSON.parse(line.slice(CHILD_MARKER.length)) as ChildResult;
}

async function runMain(): Promise<void> {
  installStubs(loadCookies(), "none");

  const { loadGoal } = await import("@/lib/queries/goal");

  const goalId = await seedEvidenceOnlyGoal();
  console.log(`seeded goal ${goalId}`);

  // First call: whatever the pool's connections happen to be, cold after
  // this process's own startup. Its bracket, its type-fetch cap, its
  // statement count and its reading bounds are asserted like any other run;
  // only its overlap is not — the user's own decided note names the cold
  // dial, never a free pass on the rest.
  const coldStart = wireCalls.length;
  const cold = await loadGoal(goalId);
  reportRun("cold", wireCalls.slice(coldStart), false);

  // Five consecutive warm calls, each bounded on its own — the same number
  // `check-day.ts` settled on: a fix that only holds for the first couple of
  // warm calls is a fix a later screen the same minute would still be
  // paying for.
  const WARM_CALLS = 5;
  const warmResults: Awaited<ReturnType<typeof loadGoal>>[] = [];
  for (let i = 1; i <= WARM_CALLS; i++) {
    const start = wireCalls.length;
    const result = await loadGoal(goalId);
    reportRun(`warm-${i}`, wireCalls.slice(start), true);
    warmResults.push(result);
    assert(`the warm-${i} run reads the source`, result.evidence === "read", `evidence = ${result.evidence}`);
  }

  const coldCommitmentIds = cold.commitments.map((commitment) => commitment.id).sort();
  const warmCommitmentIdLists = warmResults.map((result) => result.commitments.map((commitment) => commitment.id).sort());
  assert(
    "the cold and every warm run declare the same commitments",
    warmCommitmentIdLists.every((ids) => JSON.stringify(ids) === JSON.stringify(coldCommitmentIds)),
    `cold ${coldCommitmentIds.length} commitment(s); warm ${warmCommitmentIdLists.map((ids) => ids.length).join(", ")} commitment(s)`,
  );

  assert(
    "against the real (empty) reading.lookups, the evidence-only goal sums to zero, not undefined",
    cold.measureTotal === 0 && warmResults.every((result) => result.measureTotal === 0),
    `cold=${cold.measureTotal} warm=[${warmResults.map((result) => result.measureTotal).join(", ")}]`,
  );
  assert(
    "the goal's own measure unit is the evidence source's own unit",
    cold.measureUnit === "searches",
    `measureUnit = ${cold.measureUnit}`,
  );

  // The registry's reader replaced in a child process (module 28's own
  // dispatch): proves the sum against known rows, since no harness identity
  // on this database carries a real `reading.lookups` row to sum instead.
  const stub = runChildProcess("stub", goalId);
  console.log(`\nstub run — evidence = ${stub.evidence}, measureTotal = ${stub.measureTotal}`);
  assert("the stub run reads the source", stub.evidence === "read", `evidence = ${stub.evidence}`);
  assert(
    "a goal whose only measuring commitment is evidence-satisfied reports the source's count, not 0",
    stub.measureTotal === STUB_TOTAL,
    `expected ${STUB_TOTAL} (${STUB_QUANTITIES.join("+")}), got ${stub.measureTotal}`,
  );

  const degraded = runChildProcess("degraded", goalId);
  console.log(`\ndegraded run — evidence = ${degraded.evidence}, measureTotal = ${degraded.measureTotal}`);
  assert(
    "the degraded run reports the source unreadable, never throws",
    degraded.evidence === "unreadable",
    `evidence = ${degraded.evidence}`,
  );
  assert(
    "the degraded run still returns the goal, with its declared total alone",
    degraded.measureTotal === 0,
    `measureTotal = ${degraded.measureTotal} (declared alone, no evidence commitment ever writes a fact)`,
  );

  console.log("");
  console.log(failed ? "REPORT  failed" : "REPORT  passed");
  process.exit(failed ? 1 : 0);
}

void (async () => {
  try {
    const childArg = process.argv.find((arg) => arg.startsWith("--child="));
    const goalArg = process.argv.find((arg) => arg.startsWith("--goal="));
    if (childArg) {
      const mode = childArg.slice("--child=".length) as "stub" | "degraded";
      const goalId = goalArg?.slice("--goal=".length);
      if (!goalId) throw new Error("--child needs --goal=<id>");
      await runChild(mode, goalId);
      // `failed` is this process's own — a fresh process per run, so this
      // reads only what `reportChildRun` just asserted, nothing carried
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
