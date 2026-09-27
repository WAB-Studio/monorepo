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
// round trip each, but never a statement `day.ts` chose to send.
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

// `begin`/`commit`/`rollback` are a round trip each, but `day.ts`'s own
// comment and module 8's done criterion both count "statements" as what the
// file chose to send — the settle and the query, never the transaction's own
// bracket.
function isTransactionControl(query: string): boolean {
  const normalized = query.trim().toLowerCase();
  return normalized === "commit" || normalized === "rollback" || normalized.startsWith("begin");
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

let failed = false;

function assert(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  if (!ok) failed = true;
}

type Window = { start: number; end: number };

/**
 * Prints each transaction's own window and its application-statement count,
 * and — only when `assertOn` — turns the two facts module 8's done criterion
 * names into pass/fail: four statements, no more, and the second window
 * starting before the first ends. `assertOn` is false for the cold run:
 * `postgres`'s own default `fetch_types: true` sends one extra `pg_type`
 * query the first time each physical connection is ever used, on top of the
 * real dial the user's own decided note already names, so a truly cold run
 * sends six application statements, not four — a known, first-use-only cost,
 * never this file's to fail on. The cold number is printed, never asserted,
 * and never hidden by a pre-warm.
 */
function reportRun(label: string, calls: DebugCall[], assertOn: boolean): void {
  const groups = groupByConnection(calls);
  const windows = new Map<string, Window>();
  let applicationStatements = 0;

  for (const groupCalls of groups.values()) {
    const name = labelConnection(groupCalls);
    const times = groupCalls.map((call) => call.at);
    windows.set(name, { start: Math.min(...times), end: Math.max(...times) });
    applicationStatements += groupCalls.filter((call) => !isTransactionControl(call.query)).length;
  }

  console.log(
    `\n${label} run — ${calls.length} statement(s) on the wire across ${groups.size} connection(s), ${applicationStatements} of them application statements`,
  );
  for (const [name, window] of windows) {
    console.log(
      `  ${name.padEnd(8)} ${new Date(window.start).toISOString()} -> ` +
        `${new Date(window.end).toISOString()} (${(window.end - window.start).toFixed(1)}ms)`,
    );
  }

  const [a, b] = [...windows.values()];
  const overlaps = a !== undefined && b !== undefined && Math.max(a.start, b.start) < Math.min(a.end, b.end);
  const gapMs =
    a !== undefined && b !== undefined
      ? a.start <= b.start
        ? b.start - a.end
        : a.start - b.end
      : NaN;
  console.log(`  overlap = ${overlaps}${overlaps ? "" : `, gap = ${gapMs.toFixed(1)}ms`}`);

  if (!assertOn) return;

  assert(
    `${label} run issues four statements, no more`,
    applicationStatements === 4,
    `${applicationStatements} application statement(s) of ${calls.length} on the wire`,
  );
  assert(
    `${label} run's two transactions overlap in wall-clock time`,
    overlaps,
    overlaps ? "the second starts before the first ends" : `no overlap, gap = ${gapMs.toFixed(1)}ms`,
  );
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
  // this process's own startup. Reported, never asserted on its overlap.
  const coldStart = wireCalls.length;
  const cold = await loadDay(today);
  reportRun("cold", wireCalls.slice(coldStart), false);

  // Second call: the same pool, now warm — the scenario module 8's done
  // criterion measures.
  const warmStart = wireCalls.length;
  const warm = await loadDay(today);
  reportRun("warm", wireCalls.slice(warmStart), true);

  assert(
    "the warm run reads the source",
    warm.evidence === "read",
    `evidence = ${warm.evidence}`,
  );
  assert(
    "the cold and warm runs declare the same slots",
    JSON.stringify(cold.view.slots.map((slot) => slot.commitmentId).sort()) ===
      JSON.stringify(warm.view.slots.map((slot) => slot.commitmentId).sort()),
    `cold ${cold.view.slots.length} slot(s), warm ${warm.view.slots.length} slot(s)`,
  );

  const undegradedSlotIds = warm.view.slots.map((slot) => slot.commitmentId).sort();
  const degraded = runDegradedChildProcess();

  console.log(`\ndegraded run — evidence = ${degraded.evidence}`);
  console.log(`  undegraded slots: [${undegradedSlotIds.join(", ")}]`);
  console.log(`  degraded slots:   [${degraded.slotIds.join(", ")}]`);

  assert(
    "the degraded run reports the source unreadable",
    degraded.evidence === "unreadable",
    `evidence = ${degraded.evidence}`,
  );
  assert(
    "every declared slot is still present when the source cannot be read",
    JSON.stringify(degraded.slotIds) === JSON.stringify(undegradedSlotIds),
    `undegraded ${undegradedSlotIds.length} slot(s), degraded ${degraded.slotIds.length} slot(s)`,
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
