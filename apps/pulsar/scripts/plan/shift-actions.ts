// Drives `acceptShift` (`app/actions/shift.ts`, RP-34) the way `budget-actions.ts`
// drives `setMonthBudget`: the action imported as a plain async function,
// `server-only`, `next/headers` and `next/cache` stubbed before the first `@/`
// import, and the cookie `harness:mint-session` left standing as the session.
// "Today" is the real one and every fixture is built relative to it: the
// closed month is last month, so the shift is offered from today. Fixture
// rows are written through the pooler (as `postgres`) and ended by exact id;
// every accept goes through the action, as `authenticated`.
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

type StoredCookie = { name: string; value: string };

function loadCookies(): StoredCookie[] {
  const file = resolve(process.cwd(), `private/session-${laneNumber()}.json`);
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

const revalidated: string[] = [];

type WireCall = { connection: number; query: string };
let wire: WireCall[] | null = null;
// A request with no cookie: the one way to reach the signed-out guard.
let signedOut = false;

type PostgresFactory = (url: string, options: Record<string, unknown>) => unknown;

function installStubs(cookies: StoredCookie[]): void {
  const untyped = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = untyped._load;
  untyped._load = (request, parent, isMain) => {
    if (request === "server-only") return {};
    if (request === "next/headers") {
      return { cookies: async () => ({ getAll: () => (signedOut ? [] : cookies), set() {} }) };
    }
    if (request === "next/cache") {
      return { revalidatePath: (path: string) => void revalidated.push(path) };
    }
    // `db/client.ts` is the only `@/` importer of `postgres` before any test
    // body runs; its pool is the one every statement of the action leaves on.
    if (request === "postgres") {
      const real = originalLoad(request, parent, isMain) as PostgresFactory;
      const wrapped: PostgresFactory = (url, options) =>
        real(url, {
          ...options,
          debug: (connection: number, query: string) => {
            wire?.push({ connection, query });
          },
        });
      return Object.assign(wrapped, real);
    }
    return originalLoad(request, parent, isMain);
  };
}

let acceptShift: typeof import("@/app/actions/shift").acceptShift;
let createGoal: typeof import("@/app/actions/plan").createGoal;
let addMonths: typeof import("@/lib/plan/shift").addMonths;
let pgCode: typeof import("@/lib/db-error").pgCode;

// Bounded, so a fixture a mutation left half-moved cannot hang the cleanup.
const sql = postgres(process.env.MIGRATION_DATABASE_URL!, {
  prepare: false,
  max: 1,
  connection: { statement_timeout: 15_000, lock_timeout: 10_000 },
});

// "YYYY-MM" `delta` months from the one `day` sits in.
function monthFrom(day: string, delta: number): string {
  const index = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1 + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function lastDayOf(month: string): string {
  const [year, index] = month.split("-").map(Number);
  return new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10);
}

const goalIds: string[] = [];
let personId: string;
let today: string;
// The closed month, the one after it (this month), and the horizon the
// fixtures plan eleven months past this one.
let closed: string;
let current: string;
let horizon: string;

type Built = {
  goalId: string;
  moved: string[];
  stays: string;
  closedTasks: string[];
  phases: { notBegun: string; begun: string };
};

// A goal with an amount in every month from the closed one through the tenth
// after it, two phases, a done and an undone task in the closed month, `moved`
// undone tasks in this month and one done in this month. `closedEstimates` is
// the done and the undone estimate of the closed month.
async function buildGoal(
  name: string,
  moved: number,
  closedEstimates: [number, number],
  extra: (goalId: string) => Promise<void> = async () => {},
): Promise<Built> {
  const created = await createGoal({ name, horizon });
  if (!created.ok) throw new Error(`createGoal: ${created.error}`);
  const goalId = created.goalId;
  goalIds.push(goalId);

  for (let delta = -1; delta <= 10; delta++) {
    await sql`
      insert into goals.month_budgets (user_id, goal_id, month, amount)
      values (${personId}, ${goalId}, ${`${monthFrom(today, delta)}-01`}, ${1000 + delta * 10})`;
  }

  const [notBegun] = await sql<{ id: string }[]>`
    insert into goals.phases (user_id, goal_id, aim, starts_on, ends_on)
    values (${personId}, ${goalId}, 'por empezar', ${`${monthFrom(today, 1)}-01`}, ${lastDayOf(monthFrom(today, 1))})
    returning id`;
  const [begun] = await sql<{ id: string }[]>`
    insert into goals.phases (user_id, goal_id, aim, starts_on, ends_on)
    values (${personId}, ${goalId}, 'empezada', ${`${closed}-01`}, ${lastDayOf(current)})
    returning id`;

  async function task(taskName: string, month: string, estimate: number): Promise<string> {
    const [row] = await sql<{ id: string }[]>`
      insert into goals.one_offs (user_id, goal_id, name, planned_month, estimate)
      values (${personId}, ${goalId}, ${taskName}, ${`${month}-01`}, ${estimate}) returning id`;
    return row.id;
  }
  async function done(oneOffId: string, day: string): Promise<void> {
    await sql`
      insert into goals.facts (user_id, one_off_id, goal_id, day)
      values (${personId}, ${oneOffId}, ${goalId}, ${day})`;
  }

  const closedDone = await task("hecha del mes cerrado", closed, closedEstimates[0]);
  await done(closedDone, `${closed}-01`);
  const closedUndone = await task("sin hacer del mes cerrado", closed, closedEstimates[1]);
  const stays = await task("hecha este mes", current, 3);
  await done(stays, today);
  const movedIds: string[] = [];
  for (let i = 1; i <= moved; i++) movedIds.push(await task(`corrible ${i}`, current, 1));

  await extra(goalId);
  return {
    goalId,
    moved: movedIds,
    stays,
    closedTasks: [closedDone, closedUndone],
    phases: { notBegun: notBegun.id, begun: begun.id },
  };
}

type Snapshot = {
  budgets: [string, number][];
  phases: [string, string, string][];
  tasks: [string, string | null][];
  horizon: string;
  shifts: number;
};

async function snapshot(goalId: string): Promise<Snapshot> {
  const budgets = await sql<{ month: string; amount: number }[]>`
    select month::text as month, amount from goals.month_budgets where goal_id = ${goalId} order by month`;
  const phases = await sql<{ id: string; starts_on: string; ends_on: string }[]>`
    select id, starts_on::text as starts_on, ends_on::text as ends_on
    from goals.phases where goal_id = ${goalId} order by id`;
  const tasks = await sql<{ id: string; planned_month: string | null }[]>`
    select id, planned_month::text as planned_month from goals.one_offs where goal_id = ${goalId} order by id`;
  const [goal] = await sql<{ horizon: string }[]>`select horizon::text as horizon from goals.goals where id = ${goalId}`;
  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::int as count from goals.month_shifts where goal_id = ${goalId}`;
  return {
    budgets: budgets.map((b) => [b.month, b.amount]),
    phases: phases.map((p) => [p.id, p.starts_on, p.ends_on]),
    tasks: tasks.map((t) => [t.id, t.planned_month]),
    horizon: goal.horizon,
    shifts: count,
  };
}

// The application statements `acceptShift` put on the wire: begin, commit and
// the one-time type fetch of a cold connection are not statements it chose.
async function counted<T>(
  run: () => Promise<T>,
  ends: "commit" | "rollback" = "commit",
): Promise<{ result: T; statements: number }> {
  wire = [];
  try {
    const result = await run();
    const calls = wire.map((call) => ({ ...call, query: call.query.trim().toLowerCase() }));
    const begins = calls.filter((c) => c.query === "begin").length;
    const ended = calls.filter((c) => c.query === ends).length;
    assert.equal(begins, 1, "one begin");
    assert.equal(ended, 1, `one ${ends}`);
    const statements = calls.filter(
      (c) => c.query !== "begin" && c.query !== ends && !c.query.includes("pg_catalog.pg_type"),
    ).length;
    return { result, statements };
  } finally {
    wire = null;
  }
}

before(async () => {
  installStubs(loadCookies());
  ({ createGoal } = await import("@/app/actions/plan"));
  ({ acceptShift } = await import("@/app/actions/shift"));
  ({ addMonths } = await import("@/lib/plan/shift"));
  ({ pgCode } = await import("@/lib/db-error"));
  const { getPerson } = await import("@/lib/session");
  const { todayInZone } = await import("@/lib/zone");
  const person = await getPerson();
  if (!person) throw new Error("no settled session — mint-session.ts's cookie did not verify");
  personId = person.id;
  today = todayInZone();
  closed = monthFrom(today, -1);
  current = monthFrom(today, 0);
  horizon = `${monthFrom(today, 11)}-01`;
});

after(async () => {
  // Cascades to each fixture's amounts, phases, tasks, facts and shifts.
  // One by one: a goal that will not go is reported and does not hold the rest.
  for (const id of goalIds) {
    try {
      await sql`delete from goals.goals where id = ${id}`;
    } catch (error) {
      console.error(`# fixture ${id} not deleted:`, error);
    }
  }
  await sql.end({ timeout: 5 });
});

const measured: Record<string, number> = {};

test("acceptShift: a closed month that carried 23 of 44 moves the plan one month and records the act", async () => {
  const built = await buildGoal("RP-34 fixture: dos tareas", 2, [21, 23]);
  const { goalId } = built;
  revalidated.length = 0;

  const { result, statements } = await counted(() => acceptShift({ goalId, month: closed }));
  measured.two = statements;
  assert.deepEqual(result, {
    ok: true,
    moved: { budgets: 11, phases: 1, tasks: 2, horizon: `${monthFrom(today, 12)}-01` },
  });

  const after = await snapshot(goalId);
  const expectedBudgets: [string, number][] = [[`${closed}-01`, 990]];
  for (let delta = 1; delta <= 11; delta++) {
    expectedBudgets.push([`${monthFrom(today, delta)}-01`, 1000 + (delta - 1) * 10]);
  }
  assert.deepEqual(after.budgets, expectedBudgets);

  const phaseOf = (id: string) => after.phases.find((p) => p[0] === id)!;
  const notBegunFrom = `${monthFrom(today, 1)}-01`;
  const notBegunTo = lastDayOf(monthFrom(today, 1));
  assert.deepEqual(phaseOf(built.phases.notBegun).slice(1), [addMonths(notBegunFrom, 1), addMonths(notBegunTo, 1)]);
  assert.deepEqual(phaseOf(built.phases.begun).slice(1), [`${closed}-01`, lastDayOf(current)]);

  const monthOfTask = (id: string) => after.tasks.find((t) => t[0] === id)![1];
  for (const id of built.moved) assert.equal(monthOfTask(id), `${monthFrom(today, 1)}-01`);
  assert.equal(monthOfTask(built.stays), `${current}-01`);
  for (const id of built.closedTasks) assert.equal(monthOfTask(id), `${closed}-01`);

  assert.equal(after.horizon, `${monthFrom(today, 12)}-01`);
  assert.equal(after.shifts, 1);
  for (const path of ["/", `/metas/${goalId}`, `/metas/${goalId}/meses`, `/metas/${goalId}/meses/${closed}`, `/metas/${goalId}/meses/${current}`]) {
    assert.ok(revalidated.includes(path), `revalidated: ${revalidated.join(", ")}`);
  }

  // The second accept names the same key and changes nothing.
  const before = await snapshot(goalId);
  // Still 23 of 44 undone, so only the taken month refuses it, and it does so
  // on the read alone: settle and select, no write reaches the UNIQUE.
  const { result: again, statements: refusedStatements } = await counted(
    () => acceptShift({ goalId, month: closed }),
    "rollback",
  );
  assert.deepEqual(again, { ok: false, error: "month.errors.shiftNotOffered" });
  assert.equal(refusedStatements, 2);
  assert.deepEqual(await snapshot(goalId), before);
});

test("acceptShift: the statement count is the same for 2 moved tasks and for 20", async () => {
  const { goalId } = await buildGoal("RP-34 fixture: veinte tareas", 20, [21, 23]);
  const { result, statements } = await counted(() => acceptShift({ goalId, month: closed }));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.moved.tasks, 20);
  measured.twenty = statements;
  console.log(`# statements for 2 moved tasks = ${measured.two}, for 20 = ${measured.twenty}`);
  assert.equal(measured.twenty, measured.two);
  // Settle, read, budgets, phases, tasks, horizon, the act.
  assert.equal(measured.two, 7);
});

test("acceptShift: 22 of 44 is not more than half, so it is refused and changes nothing", async () => {
  const { goalId } = await buildGoal("RP-34 fixture: la mitad", 2, [22, 22]);
  const before = await snapshot(goalId);
  const result = await acceptShift({ goalId, month: closed });
  assert.deepEqual(result, { ok: false, error: "month.errors.shiftNotOffered" });
  assert.deepEqual(await snapshot(goalId), before);
});

test("acceptShift: a month that is not the one just closed is not offered", async () => {
  const { goalId } = await buildGoal("RP-34 fixture: otro mes", 2, [21, 23]);
  const before = await snapshot(goalId);
  const result = await acceptShift({ goalId, month: monthFrom(today, -2) });
  assert.deepEqual(result, { ok: false, error: "month.errors.shiftNotOffered" });
  assert.deepEqual(await snapshot(goalId), before);
});

test("acceptShift: another person's goal is notFound; a bad month never reaches the database", async () => {
  const [member] = await sql<{ id: string }[]>`
    select id from auth.users
    where email in (${`harness-member-${laneNumber()}@example.invalid`}, 'harness-member@example.invalid')
       or email like 'harness-member%@example.invalid'
    order by (email = ${`harness-member-${laneNumber()}@example.invalid`}) desc limit 1`;
  if (!member) throw new Error("no member identity — run harness:token for this lane");
  const [foreign] = await sql<{ id: string }[]>`
    insert into goals.goals (user_id, name, horizon) values (${member.id}, 'RP-34 ajena', ${horizon}) returning id`;
  try {
    const result = await acceptShift({ goalId: foreign.id, month: closed });
    assert.deepEqual(result, { ok: false, error: "month.errors.notFound" });
  } finally {
    await sql`delete from goals.goals where id = ${foreign.id}`;
  }

  const bad = await acceptShift({ goalId: foreign.id, month: "2026-13" });
  assert.deepEqual(bad, { ok: false, error: "month.errors.monthInvalid" });
});

test("acceptShift: an archived goal is refused with closed", async () => {
  const { goalId } = await buildGoal("RP-34 fixture: archivada", 2, [21, 23], async (id) => {
    await sql`update goals.goals set archived_at = now() where id = ${id}`;
  });
  const before = await snapshot(goalId);
  const result = await acceptShift({ goalId, month: closed });
  assert.deepEqual(result, { ok: false, error: "month.errors.closed" });
  assert.deepEqual(await snapshot(goalId), before);
});

test("acceptShift: a plan sent by the client moves nothing; the server derives its own", async () => {
  const built = await buildGoal("RP-34 fixture: plan falso", 2, [21, 23]);
  const forged = {
    goalId: built.goalId,
    month: closed,
    plan: {
      budgets: [],
      phases: [],
      tasks: [{ id: built.closedTasks[1], name: "falsa", from: `${closed}-01`, to: `${monthFrom(today, 5)}-01` }],
      horizon: null,
      emptied: `${current}-01`,
    },
  };
  const result = await acceptShift(forged);
  assert.equal(result.ok, true);
  const after = await snapshot(built.goalId);
  assert.equal(after.tasks.find((t) => t[0] === built.closedTasks[1])![1], `${closed}-01`);
  for (const id of built.moved) {
    assert.equal(after.tasks.find((t) => t[0] === id)![1], `${monthFrom(today, 1)}-01`);
  }
  assert.equal(after.budgets.length, 12);
});

test("acceptShift: a failure in the tasks statement leaves the budgets, phases and horizon where they were", async () => {
  // A task with a day after today, a month and a sub-task passes the plan's
  // filter, but `one_offs_update_self` refuses its new row (a dated parent
  // takes no sub-task): the tasks statement fails after the budgets and the
  // phases already ran.
  const built = await buildGoal("RP-34 fixture: falla a medias", 2, [21, 23], async (goalId) => {
    const tomorrow = new Date(`${today}T12:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const [parent] = await sql<{ id: string }[]>`
      insert into goals.one_offs (user_id, goal_id, name, planned_month, day)
      values (${personId}, ${goalId}, 'con día y sub-tarea', ${`${current}-01`}, ${tomorrow.toISOString().slice(0, 10)})
      returning id`;
    await sql`
      insert into goals.one_offs (user_id, goal_id, name, parent_id)
      values (${personId}, ${goalId}, 'sub-tarea', ${parent.id})`;
  });
  const before = await snapshot(built.goalId);
  let code: string | undefined;
  try {
    await acceptShift({ goalId: built.goalId, month: closed });
    assert.fail("acceptShift did not throw");
  } catch (error) {
    if (error instanceof assert.AssertionError) throw error;
    code = pgCode(error);
  }
  assert.equal(code, "42501");
  assert.deepEqual(await snapshot(built.goalId), before);
});

test("acceptShift: a signed-out call answers signedOut", async () => {
  signedOut = true;
  try {
    const result = await acceptShift({ goalId: randomUUID(), month: closed });
    assert.deepEqual(result, { ok: false, error: "month.errors.signedOut" });
  } finally {
    signedOut = false;
  }
});

test("acceptShift: a shift recorded between its read and its write is refused by the UNIQUE and moves nothing", async () => {
  const { goalId } = await buildGoal("RP-34 fixture: carrera", 2, [21, 23]);
  const before = await snapshot(goalId);
  const holder = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let inserted!: () => void;
  const hasInserted = new Promise<void>((resolve) => (inserted = resolve));
  // An open transaction holding the act: the action's read cannot see it, its
  // own insert of the same month waits on it.
  const held = holder.begin(async (tx) => {
    await tx`insert into goals.month_shifts (user_id, goal_id, month) values (${personId}, ${goalId}, ${`${closed}-01`})`;
    inserted();
    await gate;
  });
  try {
    await hasInserted;
    const pending = acceptShift({ goalId, month: closed });
    pending.catch(() => {});
    const deadline = Date.now() + 30_000;
    for (;;) {
      const waiting = await sql`
        select 1 from pg_stat_activity
        where wait_event_type = 'Lock' and query ilike '%goals"."month_shifts%' and pid <> pg_backend_pid()`;
      if (waiting.length > 0) break;
      if (Date.now() > deadline) throw new Error("the action never reached the month_shifts insert");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    release();
    await held;
    assert.deepEqual(await pending, { ok: false, error: "month.errors.shiftNotOffered" });
  } finally {
    release();
    await held.catch(() => {});
    await holder.end({ timeout: 5 });
  }
  assert.deepEqual(await snapshot(goalId), { ...before, shifts: 1 });
});

test("acceptShift: a phase of another goal named by the client never moves", async () => {
  const mine = await buildGoal("RP-34 fixture: fase ajena, la mía", 2, [21, 23]);
  const other = await buildGoal("RP-34 fixture: fase ajena, la otra", 2, [21, 23]);
  const untouched = await snapshot(other.goalId);
  const result = await acceptShift({
    goalId: mine.goalId,
    month: closed,
    plan: {
      phases: [
        {
          id: other.phases.notBegun,
          toStartsOn: `${monthFrom(today, 6)}-01`,
          toEndsOn: `${monthFrom(today, 6)}-28`,
        },
      ],
    },
  } as Parameters<typeof acceptShift>[0]);
  assert.equal(result.ok, true);
  assert.deepEqual(await snapshot(other.goalId), untouched);
});
