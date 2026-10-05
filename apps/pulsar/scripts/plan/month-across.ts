// Drives `loadMonthAcross` (`lib/queries/month.ts`, RP-43) the way `report.ts`
// drives `loadReport`: statements counted off the driver's own wire, the
// session `harness:mint-session` left standing, the three Next-only modules
// stubbed before the first `@/` import. Goals are written through the actions;
// the pooler plants only what no action writes and deletes each fixture by its
// exact id.
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
let monthStart: string;
let aId: string;
let bId: string;
let cId: string;
let archivedId: string;
let endedId: string;
let dId: string;
let loadMonthAcross: typeof import("@/lib/queries/month").loadMonthAcross;
let archiveGoal: typeof import("@/app/actions/plan").archiveGoal;

before(async () => {
  installStubs(loadCookies());
  const plan = await import("@/app/actions/plan");
  archiveGoal = plan.archiveGoal;
  const { setMonthBudget } = await import("@/app/actions/budgets");
  const { declareFact } = await import("@/app/actions/facts");
  ({ loadMonthAcross } = await import("@/lib/queries/month"));
  const { todayInZone } = await import("@/lib/zone");
  today = todayInZone();
  monthStart = `${today.slice(0, 7)}-01`;
  const horizon = `${monthFrom(today, 2)}-01`;

  async function goal(name: string, unit: string | null): Promise<{ goalId: string; commitmentId: string | null }> {
    const created = await plan.createGoal({ name, horizon });
    if (!created.ok) throw new Error(`createGoal: ${created.error}`);
    goalIds.push(created.goalId);
    if (unit === null) return { goalId: created.goalId, commitmentId: null };
    const commitment = await plan.addCommitment({
      goalId: created.goalId,
      name: "RP-43 fixture: cantidad",
      cadenceKind: "daily",
      satisfaction: "quantity",
      targetQuantity: 10,
      unit,
    });
    if (!commitment.ok) throw new Error(`addCommitment: ${commitment.error}`);
    return { goalId: created.goalId, commitmentId: commitment.commitmentId };
  }

  const a = await goal("RP-43 fixture: A", "minutos");
  aId = a.goalId;
  const b = await goal("RP-43 fixture: B", "minutos");
  bId = b.goalId;
  cId = (await goal("RP-43 fixture: C", null)).goalId;
  archivedId = (await goal("RP-43 fixture: archivada", "minutos")).goalId;
  endedId = (await goal("RP-43 fixture: terminada", "minutos")).goalId;
  // D measures in the reading source's own unit, so its evidence feeds `reached`.
  const d = await goal("RP-43 fixture: D", "searches");
  dId = d.goalId;
  const source = await plan.addCommitment({
    goalId: dId,
    name: "RP-43 fixture: evidencia",
    cadenceKind: "daily",
    satisfaction: "evidence",
    sourceKey: "reading_lookups",
    threshold: 1,
  });
  if (!source.ok) throw new Error(`addCommitment: ${source.error}`);
  // A's second commitment holds the month's first-day fact, so no date collides
  // with the one `declareFact` writes today.
  const second = await plan.addCommitment({
    goalId: aId,
    name: "RP-43 fixture: segunda cantidad",
    cadenceKind: "daily",
    satisfaction: "quantity",
    targetQuantity: 10,
    unit: "minutos",
  });
  if (!second.ok) throw new Error(`addCommitment: ${second.error}`);

  const budget = await setMonthBudget({ goalId: aId, month: today.slice(0, 7), amount: 600 });
  if (!budget.ok) throw new Error(`setMonthBudget: ${budget.error}`);
  const fact = await declareFact({ commitmentId: a.commitmentId!, quantity: 30 });
  if (!fact.ok) throw new Error(`declareFact: ${fact.error}`);

  const [owner] = await sql<{ user_id: string }[]>`
    select user_id from goals.goals where id = ${aId}`;
  const lastMonth = monthFrom(today, -1);
  await sql`
    insert into goals.facts (user_id, goal_id, commitment_id, day, quantity)
    values (${owner.user_id}, ${aId}, ${second.commitmentId}, ${monthStart}, 30)`;
  await sql`
    insert into goals.facts (user_id, goal_id, commitment_id, day, quantity)
    values (${owner.user_id}, ${dId}, ${d.commitmentId}, ${monthStart}, 7)`;
  await sql`
    insert into goals.facts (user_id, goal_id, commitment_id, day, quantity)
    values (${owner.user_id}, ${aId}, ${a.commitmentId}, ${`${lastMonth}-15`}, 45)`;
  const [done] = await sql<{ id: string }[]>`
    insert into goals.one_offs (user_id, goal_id, name, planned_month, estimate)
    values (${owner.user_id}, ${aId}, 'RP-43 fixture: hecha', ${monthStart}, 60) returning id`;
  await sql`
    insert into goals.facts (user_id, goal_id, one_off_id, day)
    values (${owner.user_id}, ${aId}, ${done.id}, ${today})`;
  await sql`
    insert into goals.one_offs (user_id, goal_id, name, planned_month)
    values (${owner.user_id}, ${cId}, 'RP-43 fixture: arrastrada', ${`${lastMonth}-01`})`;

  const archived = await archiveGoal({ goalId: archivedId });
  if (!archived.ok) throw new Error(`archiveGoal: ${archived.error}`);
  await sql`
    update goals.goals set created_at = now() - interval '5 days', horizon = ${today}
    where id = ${endedId} and user_id = ${owner.user_id}`;
});

after(async () => {
  const ids = goalIds.filter(Boolean);
  if (ids.length > 0) await sql`delete from goals.goals where id in ${sql(ids)}`;
  await sql.end();
});

const own = () => [aId, bId, cId, dId, archivedId, endedId];

test("loadMonthAcross: A, B, C and D read; the archived and the ended goal do not", async () => {
  const month = await loadMonthAcross(today);
  assert.equal(month.month, monthStart);
  assert.equal(month.evidence, "read");
  assert.deepEqual(
    month.goals.map((goal) => goal.id).filter((id) => own().includes(id)),
    [aId, bId, cId, dId],
  );
});

test("loadMonthAcross: A plans 600 and reached 120; B plans nothing; C has no line", async () => {
  const month = await loadMonthAcross(today);
  const a = month.goals.find((goal) => goal.id === aId)!;
  assert.deepEqual(a.line, {
    planned: 600,
    reached: 120,
    underPace: Number(today.slice(8, 10)) >= 20,
  });
  assert.equal(a.unit, "minutos");
  const b = month.goals.find((goal) => goal.id === bId)!;
  assert.equal(b.line?.planned, null);
  assert.equal(b.line?.reached, 0);
  const c = month.goals.find((goal) => goal.id === cId)!;
  assert.equal(c.line, null);
  assert.equal(c.unit, null);
});

test("loadMonthAcross: C lists its carried task first, from last month; A's done task is done", async () => {
  const month = await loadMonthAcross(today);
  const c = month.goals.find((goal) => goal.id === cId)!;
  assert.equal(c.items[0].task.name, "RP-43 fixture: arrastrada");
  assert.equal(c.items[0].carriedFrom, `${monthFrom(today, -1)}-01`);
  assert.equal(c.items[0].done, false);
  const a = month.goals.find((goal) => goal.id === aId)!;
  assert.deepEqual(
    a.items.map((item) => [item.task.name, item.done, item.task.factId !== null]),
    [["RP-43 fixture: hecha", true, true]],
  );
});

test("loadMonthAcross: D reaches its 7 declared plus 10 of evidence when the reader reads", async () => {
  const month = await loadMonthAcross(today);
  assert.equal(month.goals.find((goal) => goal.id === dId)!.line?.reached, 7 + 5 + 3 + 2);
});

test("loadMonthAcross: evidence that cannot be read says so; A keeps 120 and D its declared 7", async () => {
  evidenceRejects = true;
  try {
    const month = await loadMonthAcross(today);
    assert.equal(month.evidence, "unreadable");
    assert.equal(month.goals.find((goal) => goal.id === aId)!.line?.reached, 120);
    assert.equal(month.goals.find((goal) => goal.id === dId)!.line?.reached, 7);
  } finally {
    evidenceRejects = false;
  }
});

async function wireOfOneRead() {
  realReader = true;
  await loadMonthAcross(today);
  const before = wireCalls.length;
  await loadMonthAcross(today);
  realReader = false;
  return wireCalls.slice(before);
}

test("loadMonthAcross: four application statements in two overlapping transactions, four goals", async () => {
  const calls = await wireOfOneRead();
  const wire = readWire(calls);
  console.log(`wire (4 goals): ${JSON.stringify(wire)}`);
  assert.equal(wire.connections, 2);
  assert.equal(wire.applicationStatements, 4);
  assert.equal(wire.overlap, true);
});

test("loadMonthAcross: the reading statement bounds its days on both ends", async () => {
  const calls = await wireOfOneRead();
  const reading = calls.filter((call) => normalized(call.query).includes('"lookups"'));
  assert.equal(reading.length, 1);
  const bounds = /::date between \$(\d+) and \$(\d+)/.exec(normalized(reading[0].query));
  assert.ok(bounds, "the civil day sits between two parameters");
  assert.equal(reading[0].parameters[Number(bounds[1]) - 1], monthStart, "the month's first day opens it");
  assert.equal(reading[0].parameters[Number(bounds[2]) - 1], today, "today closes it");
});

test("loadMonthAcross: the same four statements with one goal", async () => {
  for (const id of [bId, cId, dId]) {
    const archived = await archiveGoal({ goalId: id });
    if (!archived.ok) throw new Error(`archiveGoal: ${archived.error}`);
  }
  const month = await loadMonthAcross(today);
  assert.deepEqual(
    month.goals.map((goal) => goal.id).filter((id) => own().includes(id)),
    [aId],
  );
  const wire = readWire(await wireOfOneRead());
  console.log(`wire (1 goal): ${JSON.stringify(wire)}`);
  assert.equal(wire.connections, 2);
  assert.equal(wire.applicationStatements, 4);
  assert.equal(wire.overlap, true);
});
