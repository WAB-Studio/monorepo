// Drives `loadReport` (`lib/queries/report.ts`, RP-33) the way `scripts/check-
// goal.ts` drives `loadGoal`: statements counted off the driver's own wire,
// the session `harness:mint-session` left standing, `server-only`,
// `next/headers` and `next/cache` stubbed before the first `@/` import. Every
// own goal is written through the actions; the pooler plants only what no
// action writes (tasks with an estimate, a done fact, another person's goal)
// and deletes each fixture by its exact id.
import assert from "node:assert/strict";
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
const memberEmail = `harness-member${lane === 1 ? "" : `-${lane}`}@example.invalid`;

type StoredCookie = { name: string; value: string };

function loadCookies(): StoredCookie[] {
  const file = resolve(process.cwd(), `private/session-${lane}.json`);
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
type PostgresFactory = (url: string, options?: Record<string, unknown>) => unknown;

const wireCalls: DebugCall[] = [];
const STUB_QUANTITIES = [5, 3, 2];
// Flipped per test: the reader answers with known rows, rejects, or is the
// real one (the wire test needs its own statement).
let evidenceRejects = false;
let realReader = false;

function todayInBogota(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());
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
    if (request === "next/cache") return { revalidatePath() {} };
    if (request === "./reading-lookups") {
      const real = originalLoad(request, parent, isMain) as {
        readReadingLookups: (...args: unknown[]) => Promise<unknown>;
      };
      return {
        readReadingLookups: async (...args: unknown[]) => {
          if (realReader) return real.readReadingLookups(...args);
          if (evidenceRejects) throw new Error("report.ts: simulated reading-lookups failure");
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

const TYPE_FETCH_QUERY_TEXT =
  "select b.oid, b.typarray from pg_catalog.pg_type a left join pg_catalog.pg_type b " +
  "on b.oid = a.typelem where a.typcategory = 'a' group by b.oid, b.typarray order by b.oid";

function normalized(query: string): string {
  return query.replace(/\s+/g, " ").trim().toLowerCase();
}

type Wire = { applicationStatements: number; connections: number; overlap: boolean };

// Application statements are what is left after each connection's bracket and
// its first-use type fetch; two connections overlap when their windows do.
function readWire(calls: DebugCall[]): Wire {
  const byConnection = new Map<number, DebugCall[]>();
  for (const call of calls) byConnection.set(call.connection, [...(byConnection.get(call.connection) ?? []), call]);
  let applicationStatements = 0;
  const windows: { start: number; end: number }[] = [];
  for (const group of byConnection.values()) {
    applicationStatements += group.filter((call) => {
      const text = normalized(call.query);
      return !text.startsWith("begin") && text !== "commit" && text !== "rollback" && text !== TYPE_FETCH_QUERY_TEXT;
    }).length;
    const times = group.map((call) => call.at);
    windows.push({ start: Math.min(...times), end: Math.max(...times) });
  }
  const [a, b] = windows;
  const overlap = windows.length === 2 && a.start <= b.end && b.start <= a.end;
  return { applicationStatements, connections: byConnection.size, overlap };
}

function monthFrom(day: string, delta: number): string {
  const index = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1 + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });

const goalIds: string[] = [];
let today: string;
let minutesGoalId: string;
let searchesGoalId: string;
let archivedGoalId: string;
let foreignGoalId: string;
let sharesGoalId: string;
let loadReport: typeof import("@/lib/queries/report").loadReport;
let loadGoal: typeof import("@/lib/queries/goal").loadGoal;

before(async () => {
  installStubs(loadCookies());
  const plan = await import("@/app/actions/plan");
  const { setMonthBudget } = await import("@/app/actions/budgets");
  const { declareFact } = await import("@/app/actions/facts");
  ({ loadReport } = await import("@/lib/queries/report"));
  ({ loadGoal } = await import("@/lib/queries/goal"));
  const { todayInZone } = await import("@/lib/zone");
  today = todayInZone();
  const thisMonth = today.slice(0, 7);
  const horizon = `${monthFrom(today, 2)}-01`;

  async function goal(name: string, unit: string): Promise<{ goalId: string; commitmentId: string }> {
    const created = await plan.createGoal({ name, horizon });
    if (!created.ok) throw new Error(`createGoal: ${created.error}`);
    goalIds.push(created.goalId);
    const commitment = await plan.addCommitment({
      goalId: created.goalId,
      name: "RP-33 fixture: cantidad",
      cadenceKind: "daily",
      satisfaction: "quantity",
      targetQuantity: 10,
      unit,
    });
    if (!commitment.ok) throw new Error(`addCommitment: ${commitment.error}`);
    return { goalId: created.goalId, commitmentId: commitment.commitmentId };
  }

  const minutes = await goal("RP-33 fixture: minutos", "minutos");
  minutesGoalId = minutes.goalId;
  const searches = await goal("RP-33 fixture: búsquedas", "searches");
  searchesGoalId = searches.goalId;
  const archived = await goal("RP-33 fixture: archivada", "minutos");
  archivedGoalId = archived.goalId;

  for (const [goalId, month, amount] of [
    [minutesGoalId, thisMonth, 720],
    [searchesGoalId, monthFrom(today, 1), 40],
  ] as const) {
    const planted = await setMonthBudget({ goalId, month, amount });
    if (!planted.ok) throw new Error(`setMonthBudget: ${planted.error}`);
  }
  const evidence = await plan.addCommitment({
    goalId: searchesGoalId,
    name: "RP-33 fixture: evidencia",
    cadenceKind: "daily",
    satisfaction: "evidence",
    sourceKey: "reading_lookups",
    threshold: 1,
  });
  if (!evidence.ok) throw new Error(`addCommitment(evidence): ${evidence.error}`);
  const phase = await plan.addPhase({
    goalId: minutesGoalId,
    aim: "RP-33 fixture: fase",
    startsOn: today,
    endsOn: `${monthFrom(today, 1)}-01`,
  });
  if (!phase.ok) throw new Error(`addPhase: ${phase.error}`);
  const fact = await declareFact({ commitmentId: minutes.commitmentId, quantity: 30 });
  if (!fact.ok) throw new Error(`declareFact: ${fact.error}`);

  const [owner] = await sql<{ user_id: string }[]>`
    select user_id from goals.goals where id = ${minutesGoalId}`;
  // A parent planned last month with one undone child (carried into this
  // month), and one done task this month whose estimate counts (RP-36).
  const [parent] = await sql<{ id: string }[]>`
    insert into goals.one_offs (user_id, goal_id, name, planned_month)
    values (${owner.user_id}, ${minutesGoalId}, 'RP-33 fixture: arrastrada', ${`${monthFrom(today, -1)}-01`})
    returning id`;
  await sql`
    insert into goals.one_offs (user_id, goal_id, name, parent_id, estimate)
    values (${owner.user_id}, ${minutesGoalId}, 'RP-33 fixture: hija', ${parent.id}, 40)`;
  const [done] = await sql<{ id: string }[]>`
    insert into goals.one_offs (user_id, goal_id, name, planned_month, estimate)
    values (${owner.user_id}, ${minutesGoalId}, 'RP-33 fixture: hecha', ${`${thisMonth}-01`}, 25)
    returning id`;
  await sql`
    insert into goals.facts (user_id, goal_id, one_off_id, day)
    values (${owner.user_id}, ${minutesGoalId}, ${done.id}, ${today})`;

  // A goal opened two months ago, so last month is closed and has a share.
  const shares = await goal("RP-33 fixture: cuota", "minutos");
  sharesGoalId = shares.goalId;
  await sql`
    update goals.goals set created_at = now() - interval '70 days'
    where id = ${sharesGoalId} and user_id = ${owner.user_id}`;
  const lastMonth = `${monthFrom(today, -1)}-01`;
  async function task(name: string, fields: { estimate?: number; parent?: string; month?: boolean }) {
    const [row] = await sql<{ id: string }[]>`
      insert into goals.one_offs (user_id, goal_id, name, planned_month, parent_id, estimate)
      values (${owner.user_id}, ${sharesGoalId}, ${name},
              ${fields.month === false ? null : lastMonth}, ${fields.parent ?? null}, ${fields.estimate ?? null})
      returning id`;
    return row.id;
  }
  async function doneOn(id: string, day: string) {
    await sql`insert into goals.facts (user_id, goal_id, one_off_id, day)
              values (${owner.user_id}, ${sharesGoalId}, ${id}, ${day})`;
  }
  await doneOn(await task("RP-33 cuota: hecha", { estimate: 60 }), `${monthFrom(today, -1)}-05`);
  await task("RP-33 cuota: debe", { estimate: 40 });
  const half = await task("RP-33 cuota: mitad", {});
  await doneOn(await task("RP-33 cuota: mitad hecha", { parent: half, month: false, estimate: 10 }), `${monthFrom(today, -1)}-06`);
  await task("RP-33 cuota: mitad pendiente", { parent: half, month: false, estimate: 15 });
  await task("RP-33 cuota: sin monto", {});
  const whole = await task("RP-33 cuota: toda hecha", {});
  await doneOn(await task("RP-33 cuota: toda hecha hija", { parent: whole, month: false, estimate: 20 }), `${monthFrom(today, -1)}-06`);

  const archivedResult = await plan.archiveGoal({ goalId: archivedGoalId });
  if (!archivedResult.ok) throw new Error(`archiveGoal: ${archivedResult.error}`);

  const [member] = await sql<{ id: string }[]>`
    select id from auth.users where email = ${memberEmail}`;
  if (!member) throw new Error("no member identity — run harness:token for this lane");
  const [foreign] = await sql<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon)
    values (${member.id}, 'RP-33 ajena', ${horizon}) returning id`;
  foreignGoalId = foreign.id;
});

after(async () => {
  const ids = [...goalIds, foreignGoalId].filter(Boolean);
  if (ids.length > 0) await sql`delete from goals.goals where id in ${sql(ids)}`;
  await sql.end();
});

test("loadReport: two open goals report; the archived and the other person's do not", async () => {
  evidenceRejects = false;
  const report = await loadReport(today);
  assert.equal(report.today, today);
  assert.equal(report.evidence, "read");
  // Sibling files of `check:plan` run at once on this identity: only this
  // file's own fixtures are counted.
  const own = [minutesGoalId, searchesGoalId, archivedGoalId, foreignGoalId];
  assert.deepEqual(
    report.goals.map((goal) => goal.id).filter((id) => own.includes(id)).sort(),
    [minutesGoalId, searchesGoalId].sort(),
  );
  assert.ok(!report.goals.some((goal) => goal.id === archivedGoalId));
  assert.ok(!report.goals.some((goal) => goal.id === foreignGoalId));
});

test("loadReport: a goal's month and to-date figures are what loadGoal reads", async () => {
  evidenceRejects = false;
  const { toDate } = await import("@/lib/plan/months");
  const report = await loadReport(today);
  for (const id of [minutesGoalId, searchesGoalId]) {
    const entry = report.goals.find((goal) => goal.id === id);
    const loaded = await loadGoal(id, today);
    assert.ok(entry && loaded);
    assert.equal(entry.name, loaded.name);
    assert.equal(entry.unit, loaded.measureUnit);
    assert.deepEqual(entry.thisMonth, {
      planned: loaded.month?.planned ?? null,
      reached: loaded.month?.reached ?? 0,
      underPace: loaded.month?.underPace ?? false,
    });
    assert.deepEqual(entry.toDate, toDate(loaded.months));
    assert.deepEqual(
      entry.months.map((row) => ({ ...row, carried: null })),
      loaded.months.map((row) => ({ ...row, carried: null })),
    );
    assert.deepEqual(entry.weeks, loaded.weeks);
  }
  // The fixtures make those figures nonzero, so equality is not two zeros.
  const minutes = report.goals.find((goal) => goal.id === minutesGoalId)!;
  // 55 of 720 is under 60 % whenever the pace rule speaks (from the 20th).
  assert.deepEqual(minutes.thisMonth, {
    planned: 720,
    reached: 55,
    underPace: Number(today.slice(8, 10)) >= 20,
  });
  const searches = report.goals.find((goal) => goal.id === searchesGoalId)!;
  assert.equal(searches.thisMonth.reached, 10);
});

test("loadReport: phases and the carried task read as the goal holds them", async () => {
  const report = await loadReport(today);
  const minutes = report.goals.find((goal) => goal.id === minutesGoalId)!;
  assert.deepEqual(
    minutes.phases.map(({ aim, current }) => ({ aim, current })),
    [{ aim: "RP-33 fixture: fase", current: true }],
  );
  assert.deepEqual(minutes.carried, [
    {
      name: "RP-33 fixture: arrastrada",
      from: `${monthFrom(today, -1)}-01`,
      owes: 40,
      hasAmount: true,
      children: [{ name: "RP-33 fixture: hija", owes: 40, hasAmount: true }],
    },
  ]);
});

test("loadReport: four application statements, two transactions that overlap", async () => {
  realReader = true;
  await loadReport(today);
  const before = wireCalls.length;
  await loadReport(today);
  realReader = false;
  const wire = readWire(wireCalls.slice(before));
  console.log(`wire: ${JSON.stringify(wire)}`);
  assert.equal(wire.connections, 2);
  assert.equal(wire.applicationStatements, 4);
  assert.equal(wire.overlap, true);
});

test("loadReport: evidence that cannot be read says so and both goals keep their declared half", async () => {
  evidenceRejects = true;
  try {
    const report = await loadReport(today);
    assert.equal(report.evidence, "unreadable");
    const own = [minutesGoalId, searchesGoalId, archivedGoalId, foreignGoalId];
    assert.deepEqual(
      report.goals.map((goal) => goal.id).filter((id) => own.includes(id)).sort(),
      [minutesGoalId, searchesGoalId].sort(),
    );
    const minutes = report.goals.find((goal) => goal.id === minutesGoalId)!;
    assert.equal(minutes.thisMonth.reached, 55);
    const searches = report.goals.find((goal) => goal.id === searchesGoalId)!;
    assert.equal(searches.thisMonth.reached, 0);
  } finally {
    evidenceRejects = false;
  }
});

test("loadReport: a carried parent lists only what is undone, owing its estimate; no estimate reads hasAmount false", async () => {
  const report = await loadReport(today);
  const entry = report.goals.find((goal) => goal.id === sharesGoalId)!;
  const from = `${monthFrom(today, -1)}-01`;
  assert.deepEqual(entry.carried, [
    { name: "RP-33 cuota: debe", from, owes: 40, hasAmount: true, children: [] },
    {
      name: "RP-33 cuota: mitad",
      from,
      owes: 15,
      hasAmount: true,
      children: [{ name: "RP-33 cuota: mitad pendiente", owes: 15, hasAmount: true }],
    },
    { name: "RP-33 cuota: sin monto", from, owes: 0, hasAmount: false, children: [] },
  ]);
  // «toda hecha» finished its children before this month: it is not listed at all.
  assert.ok(!entry.carried.some((item) => item.name === "RP-33 cuota: toda hecha"));
});

test("loadReport: a closed month reads its share carried; the current and future months read null", async () => {
  const report = await loadReport(today);
  const entry = report.goals.find((goal) => goal.id === sharesGoalId)!;
  const byMonth = new Map(entry.months.map((row) => [row.month.slice(0, 7), row]));
  // 60 + 40 + 10 + 15 + 20 planned; 40 + 15 still carried.
  assert.equal(byMonth.get(monthFrom(today, -1))!.carried, Math.floor((55 * 100) / 145));
  assert.equal(byMonth.get(monthFrom(today, -2))!.carried, null);
  assert.equal(byMonth.get(today.slice(0, 7))!.carried, null);
  assert.equal(byMonth.get(monthFrom(today, 1))!.carried, null);
});
