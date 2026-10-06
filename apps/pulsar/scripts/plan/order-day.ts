// Drives the day's and the loose lists' order (RP-47, module 255):
// actions imported as plain async functions, `server-only`, `next/headers` and `next/cache` stubbed before the
// first `@/` import, and the cookie `harness:mint-session` left standing is
// the session `getPerson()` reads. Rows are written by direct SQL, with the ids and positions the case needs.
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

const sql = postgres(process.env.MIGRATION_DATABASE_URL!, {
  prepare: false,
  max: 1,
  connection: { statement_timeout: 15_000, lock_timeout: 10_000 },
});

function dayAfter(day: string, delta: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

// Ids sort against the plan's order, so an order by id alone reads wrong.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const REVERSED = (slot: number) => id(1000 - slot);

const goalIds: string[] = [];
const oneOffIds: string[] = [];
let today: string;
let userId: string;
let base: number;

before(async () => {
  installStubs(loadCookies());
  const plan = await import("@/app/actions/plan");
  const { todayInZone } = await import("@/lib/zone");
  today = todayInZone();
  const made = await plan.createGoal({ name: "RP-47 fixture: ancla", horizon: dayAfter(today, 90) });
  if (!made.ok) throw new Error(`createGoal: ${made.error}`);
  goalIds.push(made.goalId);
  const [anchor] = await sql`select user_id from goals.goals where id = ${made.goalId}`;
  userId = anchor.user_id;
  const [top] = await sql`select coalesce(max(position), 0) as top from goals.one_offs where user_id = ${userId}`;
  base = Number(top.top) + 1000;
});

after(async () => {
  if (oneOffIds.length > 0) await sql`delete from goals.one_offs where id in ${sql(oneOffIds)}`;
  if (goalIds.length > 0) await sql`delete from goals.goals where id in ${sql(goalIds)}`;
  await sql.end();
});

async function goalAt(name: string, position: number, idOf: string): Promise<string> {
  await sql`
    insert into goals.goals (id, user_id, name, horizon, position)
    values (${idOf}, ${userId}, ${name}, ${dayAfter(today, 90)}, ${position})`;
  goalIds.push(idOf);
  return idOf;
}

async function oneOffAt(row: {
  id: string;
  name: string;
  position: number;
  goalId?: string | null;
  parentId?: string | null;
  month?: string | null;
  day?: string | null;
}): Promise<void> {
  await sql`
    insert into goals.one_offs (id, user_id, goal_id, name, day, position, planned_month, parent_id)
    values (${row.id}, ${userId}, ${row.goalId ?? null}, ${row.name}, ${row.day ?? null}, ${row.position},
            ${row.month ?? null}, ${row.parentId ?? null})`;
  oneOffIds.push(row.id);
}

test("loadDay: goals inserted at positions 2, 1 come back 1, 2", async () => {
  // Same statement time, so created_at ties; the ids run against the positions.
  await goalAt("RP-47 segunda", base + 2, id(5001));
  await goalAt("RP-47 primera", base + 1, id(5002));
  const { loadDay } = await import("@/lib/queries/day");
  const loaded = await loadDay(today);
  const names = loaded.goals.map((g) => g.name).filter((n) => n.startsWith("RP-47 ") && !n.startsWith("RP-47 fixture"));
  assert.deepEqual(names.slice(0, 2), ["RP-47 primera", "RP-47 segunda"]);
});

test("loadDay: the next month task is the first leaf in plan order and names its parent, on twenty loads", async () => {
  const goalId = await goalAt("RP-47 plan", base + 10, id(5003));
  const month = `${today.slice(0, 7)}-01`;
  const cap1 = REVERSED(1);
  const cap2 = REVERSED(2);
  const a = REVERSED(3);
  const b = REVERSED(4);
  // One statement, so created_at ties; listed against plan order, so the heap order reads wrong too.
  const rows = [
    { id: b, name: "1b", position: base + 23, parent: cap1, goal: null, month: null },
    { id: a, name: "1a", position: base + 22, parent: cap1, goal: null, month: null },
    { id: cap2, name: "Cap. 2", position: base + 21, parent: null, goal: goalId, month },
    { id: cap1, name: "Cap. 1", position: base + 20, parent: null, goal: goalId, month },
  ];
  await sql`
    insert into goals.one_offs ${sql(
      rows.map((r) => ({
        id: r.id,
        user_id: userId,
        goal_id: r.goal,
        name: r.name,
        position: r.position,
        planned_month: r.month,
        parent_id: r.parent,
      })),
    )}`;
  oneOffIds.push(...rows.map((r) => r.id));

  const { loadDay } = await import("@/lib/queries/day");
  for (let i = 0; i < 20; i += 1) {
    const next = (await loadDay(today)).monthTask[goalId];
    assert.equal(next?.name, "1a");
    assert.equal(next?.parentName, "Cap. 1");
  }

  await sql`insert into goals.facts (user_id, one_off_id, day) values (${userId}, ${a}, ${today}), (${userId}, ${b}, ${today})`;
  const after = (await loadDay(today)).monthTask[goalId];
  assert.equal(after?.name, "Cap. 2");
  assert.equal(after?.parentName, null);
});

test("listDaylessOneOffs and listScheduledOneOffs order by position before creation time", async () => {
  const later = dayAfter(today, 5);
  await oneOffAt({ id: id(6001), name: "RP-47 suelta b", position: base + 31 });
  await oneOffAt({ id: id(6002), name: "RP-47 suelta a", position: base + 30 });
  await oneOffAt({ id: id(6003), name: "RP-47 agendada b", position: base + 33, day: later });
  await oneOffAt({ id: id(6004), name: "RP-47 agendada a", position: base + 32, day: later });
  const { listDaylessOneOffs, listScheduledOneOffs } = await import("@/lib/queries/one-offs");
  const dayless = (await listDaylessOneOffs()).filter((o) => o.name.startsWith("RP-47 suelta"));
  assert.deepEqual(dayless.map((o) => o.name), ["RP-47 suelta a", "RP-47 suelta b"]);
  const scheduled = (await listScheduledOneOffs(today)).filter((o) => o.name.startsWith("RP-47 agendada"));
  assert.deepEqual(scheduled.map((o) => o.name), ["RP-47 agendada a", "RP-47 agendada b"]);
});
