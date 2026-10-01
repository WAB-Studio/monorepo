// Drives `confirmImport` (`app/actions/import.ts`, RP-37) the way
// `shift-actions.ts` drives `acceptShift`: the action imported as a plain
// async function, `server-only`, `next/headers` and `next/cache` stubbed before
// the first `@/` import, the cookie `harness:mint-session` left standing as the
// session, and the pool's wire read for the statement count. "Today" is pinned
// to 2026-09-30 by stubbing `@/lib/zone`: the template's example plans from
// 2026-10 on. Rows are read back through the pooler, and as a second person
// under the `authenticated` role.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { resolve } from "node:path";
import { after, before, test } from "node:test";

import postgres from "postgres";

const TODAY = "2026-09-30";

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

type PostgresFactory = (url: string, options: Record<string, unknown>) => unknown;

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
    if (request === "@/lib/zone") {
      const real = originalLoad(request, parent, isMain) as Record<string, unknown>;
      return { ...real, todayInZone: () => TODAY };
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

let confirmImport: typeof import("@/app/actions/import").confirmImport;
let parseTemplate: typeof import("@/lib/import/template").parseTemplate;
type Draft = import("@/lib/import/draft").ImportDraft;

const sql = postgres(process.env.MIGRATION_DATABASE_URL!, {
  prepare: false,
  max: 1,
  connection: { statement_timeout: 15_000, lock_timeout: 10_000 },
});

const goalIds: string[] = [];
let personId: string;
let otherId: string;

// `docs/pulsar/PLANTILLA.md`'s example, verbatim.
const EXAMPLE = `pulsar · plantilla 1

# IA aplicada
horizonte: 2027-10-01
medida: horas de estudio · minutos

## Fases
- 2026-10-01 a 2026-12-31 · Evals y harness

## Meses
- 2026-10 · 12 h
- 2026-11 · 20 h

## Compromisos
- Tema técnico · martes y jueves · 2 h
- Inglés pasivo · cada día · toque

## Tareas
- 2026-10 · 4 h · Leer AI Engineering cap. 1–4
- 2026-10 · Tutor
  - 1 h · Elegir tutor
  - 6 h · Sesiones 1–4
`;

function draftOf(text: string): Draft {
  const parsed = parseTemplate(text);
  if (!parsed.matched || "error" in parsed) throw new Error(`the template did not parse: ${JSON.stringify(parsed)}`);
  return parsed.draft;
}

// Four goals, each with every section: more of everything than the example.
function fourGoals(): string {
  const goals = [1, 2, 3, 4].map(
    (n) => `
# RP-37 fixture: meta ${n}
horizonte: 2027-10-01
medida: horas de estudio · minutos

## Fases
- 2026-10-01 a 2026-12-31 · Primera
- 2027-01-01 a 2027-03-31 · Segunda

## Meses
- 2026-10 · 12 h
- 2026-11 · 20 h
- 2026-12 · 1,5 h

## Compromisos
- Tema técnico ${n} · martes y jueves · 2 h
- Inglés pasivo ${n} · cada día · toque
- Repaso ${n} · 3 veces por semana · 30 min

## Tareas
- 2026-10 · 4 h · Leer ${n}
- 2026-10 · 2 h · Escribir ${n}
- 2026-11 · Tutor ${n}
  - 1 h · Elegir
  - 6 h · Sesiones
  - 2 h · Cierre
- 2026-11 · Otro ${n}
  - 1 h · Uno
`,
  );
  return `pulsar · plantilla 1\n${goals.join("")}`;
}

// The application statements the action put on the wire, settle included:
// begin, commit and a cold connection's type fetch are not statements it chose.
async function counted<T>(run: () => Promise<T>): Promise<{ result: T; statements: number }> {
  wire = [];
  try {
    const result = await run();
    const calls = wire.map((call) => call.query.trim().toLowerCase());
    assert.equal(calls.filter((q) => q === "begin").length, 1, "one begin");
    assert.equal(calls.filter((q) => q === "commit").length, 1, "one commit");
    const statements = calls.filter(
      (q) => q !== "begin" && q !== "commit" && !q.includes("pg_catalog.pg_type"),
    ).length;
    return { result, statements };
  } finally {
    wire = null;
  }
}

async function confirmed(draft: Draft) {
  const { result, statements } = await counted(() => confirmImport(draft));
  if (!result.ok) throw new Error(`confirmImport: ${result.error} at ${result.at}`);
  goalIds.push(...result.goalIds);
  return { goalIds: result.goalIds, statements };
}

async function countGoals(name: string): Promise<number> {
  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::int as count from goals.goals where user_id = ${personId} and name = ${name}`;
  return count;
}

before(async () => {
  installStubs(loadCookies());
  ({ confirmImport } = await import("@/app/actions/import"));
  ({ parseTemplate } = await import("@/lib/import/template"));
  const { getPerson } = await import("@/lib/session");
  const person = await getPerson();
  if (!person) throw new Error("no settled session — mint-session.ts's cookie did not verify");
  personId = person.id;
  const [other] = await sql<{ id: string }[]>`
    select id from auth.users
    where email like 'harness%@example.invalid' and id <> ${personId}
    order by (email = ${`harness-member-${laneNumber()}@example.invalid`}) desc limit 1`;
  if (!other) throw new Error("no second identity in auth.users — run harness:token for this lane");
  otherId = other.id;
});

after(async () => {
  // Cascades to each fixture's phases, budgets, commitments and one-offs.
  if (goalIds.length > 0) await sql`delete from goals.goals where id in ${sql(goalIds)}`;
  await sql.end();
});

const measured: { one?: number; four?: number } = {};

test("confirmImport: the template's example writes its goal and every row reads back", async () => {
  revalidated.length = 0;
  const { goalIds: ids, statements } = await confirmed(draftOf(EXAMPLE));
  measured.one = statements;
  assert.equal(ids.length, 1);
  const [goalId] = ids;
  assert.deepEqual(revalidated, ["/", "/metas"]);

  const [goal] = await sql`
    select user_id, name, horizon::text as horizon, measure_name, measure_unit, archived_at
    from goals.goals where id = ${goalId}`;
  assert.deepEqual({ ...goal }, {
    user_id: personId,
    name: "IA aplicada",
    horizon: "2027-10-01",
    measure_name: "horas de estudio",
    measure_unit: "minutos",
    archived_at: null,
  });

  const phases = await sql`
    select aim, starts_on::text as s, ends_on::text as e from goals.phases where goal_id = ${goalId}`;
  assert.deepEqual(phases.map((p) => ({ ...p })), [{ aim: "Evals y harness", s: "2026-10-01", e: "2026-12-31" }]);

  // Minutes (RP-35): 12 h and 20 h.
  const months = await sql`
    select month::text as month, amount from goals.month_budgets where goal_id = ${goalId} order by month`;
  assert.deepEqual(months.map((m) => ({ ...m })), [
    { month: "2026-10-01", amount: 720 },
    { month: "2026-11-01", amount: 1200 },
  ]);

  const commitments = await sql`
    select name, cadence_kind, cadence_n, cadence_weekdays, satisfaction, target_quantity, unit, retired_at
    from goals.commitments where goal_id = ${goalId} order by name`;
  assert.deepEqual(commitments.map((c) => ({ ...c, cadence_weekdays: c.cadence_weekdays && [...c.cadence_weekdays] })), [
    { name: "Inglés pasivo", cadence_kind: "daily", cadence_n: null, cadence_weekdays: null, satisfaction: "tap", target_quantity: null, unit: null, retired_at: null },
    { name: "Tema técnico", cadence_kind: "weekdays", cadence_n: null, cadence_weekdays: [2, 4], satisfaction: "quantity", target_quantity: 120, unit: "minutos", retired_at: null },
  ]);

  const tasks = await sql<{ id: string; parent_id: string | null; name: string; estimate: number | null; planned_month: string | null; day: string | null }[]>`
    select id, parent_id, name, estimate, planned_month::text as planned_month, day::text as day
    from goals.one_offs where goal_id = ${goalId} order by name`;
  const tutor = tasks.find((t) => t.name === "Tutor")!;
  assert.deepEqual(
    tasks.map((t) => [t.name, t.parent_id === null ? null : t.parent_id === tutor.id ? "Tutor" : "?", t.estimate, t.planned_month, t.day]),
    [
      ["Elegir tutor", "Tutor", 60, null, null],
      ["Leer AI Engineering cap. 1–4", null, 240, "2026-10-01", null],
      ["Sesiones 1–4", "Tutor", 360, null, null],
      ["Tutor", null, null, "2026-10-01", null],
    ],
  );
});

test("confirmImport: a four-goal draft pays the same number of statements as the one-goal example", async () => {
  const draft = draftOf(fourGoals());
  assert.equal(draft.goals.length, 4);
  const { goalIds: ids, statements } = await confirmed(draft);
  measured.four = statements;
  assert.equal(ids.length, 4);
  console.log(`# statements for 1 goal = ${measured.one}, for 4 goals = ${measured.four}`);
  assert.equal(measured.four, measured.one);
  // Settle, goals, measure, phases, budgets, commitments, parents, children.
  assert.equal(measured.one, 8);

  const [{ tasks, children }] = await sql<{ tasks: number; children: number }[]>`
    select count(*) filter (where parent_id is null)::int as tasks,
           count(*) filter (where parent_id is not null)::int as children
    from goals.one_offs where goal_id in ${sql(ids)}`;
  assert.deepEqual({ tasks, children }, { tasks: 16, children: 16 });
});

test("confirmImport: a month outside the goal's span is refused with its key and path, and writes nothing", async () => {
  const draft = draftOf(EXAMPLE.replace("# IA aplicada", "# RP-37 fixture: fuera de plazo").replace("- 2026-11 · 20 h", "- 2028-01 · 20 h"));
  const result = await confirmImport(draft);
  assert.deepEqual(result, { ok: false, error: "month.errors.outsideSpan", at: "goals.0.months.1" });
  assert.equal(await countGoals("RP-37 fixture: fuera de plazo"), 0);
});

test("confirmImport: a goal whose end already passed is refused whole", async () => {
  const draft = draftOf(EXAMPLE.replace("# IA aplicada", "# RP-37 fixture: pasada").replace("2027-10-01", "2026-09-30"));
  const result = await confirmImport(draft);
  assert.deepEqual(result, { ok: false, error: "import.errors.horizonPast", at: "goals.0.horizon" });
  assert.equal(await countGoals("RP-37 fixture: pasada"), 0);
});

test("confirmImport: a draft with an extra unknown field is refused by the schema", async () => {
  const draft = draftOf(EXAMPLE.replace("# IA aplicada", "# RP-37 fixture: campo extra"));
  const forged = { goals: [{ ...draft.goals[0], admin: true }] };
  const result = await confirmImport(forged);
  assert.deepEqual(result, { ok: false, error: "import.errors.draftInvalid", at: "goals.0" });
  assert.equal(await countGoals("RP-37 fixture: campo extra"), 0);
  assert.deepEqual(await confirmImport({ goals: [] }), { ok: false, error: "import.errors.empty", at: "goals" });
});

test("confirmImport: a commitment the table refuses leaves no goal behind", async () => {
  const name = "RP-37 fixture: atómica";
  const draft = draftOf(EXAMPLE.replace("# IA aplicada", `# ${name}`));
  // A tap with a target passes the form's schema and meets
  // `commitments_quantity_for_quantity` at the commitments insert, after the goals.
  draft.goals[0].commitments[1] = { ...draft.goals[0].commitments[1], targetQuantity: 5, unit: "minutos" };
  await assert.rejects(() => confirmImport(draft));
  assert.equal(await countGoals(name), 0);
});

test("confirmImport: the second person sees none of the rows", async () => {
  const ids = goalIds.slice();
  assert.ok(ids.length >= 5);
  const claims = JSON.stringify({ sub: otherId, role: "authenticated" });
  const seen = await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims}, true),
                    set_config('search_path', 'goals, public', true),
                    set_config('role', 'authenticated', true)`;
    const counts: Record<string, number> = {};
    for (const [table, column] of [["goals", "id"], ["phases", "goal_id"], ["month_budgets", "goal_id"], ["commitments", "goal_id"], ["one_offs", "goal_id"]]) {
      const [{ count }] = await tx.unsafe<{ count: number }[]>(
        `select count(*)::int as count from goals.${table} where ${column} = any($1::uuid[])`,
        [`{${ids.join(",")}}`],
      );
      counts[table] = count;
    }
    return counts;
  });
  assert.deepEqual(seen, { goals: 0, phases: 0, month_budgets: 0, commitments: 0, one_offs: 0 });
  // And the owner does: the zeros above are RLS, not an empty write.
  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from goals.goals where id in ${sql(ids)}`;
  assert.equal(count, ids.length);
});
