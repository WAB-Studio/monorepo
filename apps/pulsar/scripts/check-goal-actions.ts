// Proves `renameGoal`'s (`app/actions/plan.ts`, RP-23) own two guards from
// outside the browser — the same door `scripts/harness/seed-goal.ts` already
// opens (verbatim comment there): every action here is `"use server"`, which
// the Next compiler reads at build time and a plain script never sees, so
// imported directly these run as the ordinary async functions they are.
// `server-only`, `next/headers` and `next/cache` are stubbed the same way,
// before the first `@/`-rooted import, and the real session cookie
// `harness:mint-session` left standing is what `getPerson()` sees — nothing
// here fabricates a claim.
//
// Neither case below writes a row. A goalId that names no goal at all
// matches nothing in the `UPDATE ... WHERE`, so the guard this proves
// (`if (renamed.length === 0) return notFound`) is the only thing standing
// between that call and a false "ok: true" — no goal was ever touched to
// clean up after. A goalId that fails `z.uuid()` never reaches the database
// at all: the guard this proves (`if (!parsed.success) return ...`) is what
// keeps `parsed.data` — absent on a failed `safeParse` — from being read and
// throwing before any statement is sent.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { resolve } from "node:path";
import { before, test } from "node:test";

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
      return { revalidatePath() {} };
    }
    return originalLoad(request, parent, isMain);
  };
}

// `node --test` runs a CommonJS-compiled entry, which cannot carry a
// top-level `await` — installed and imported in `before`, the same ordering
// `installStubs` demands (before the first `@/`-rooted import), just run
// from inside a hook instead of at module scope.
let renameGoal: typeof import("@/app/actions/plan").renameGoal;

before(async () => {
  installStubs(loadCookies());
  ({ renameGoal } = await import("@/app/actions/plan"));
  const { getPerson } = await import("@/lib/session");
  const person = await getPerson();
  if (!person) throw new Error("no settled session — mint-session.ts's cookie did not verify");
});

test("renameGoal: a goalId that names no goal is reported notFound, not a false ok:true", async () => {
  const result = await renameGoal({ goalId: randomUUID(), name: "meta ajena" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "plan.errors.notFound");
});

test("renameGoal: a goalId that fails z.uuid() is refused gracefully, never thrown", async () => {
  await assert.doesNotReject(() => renameGoal({ goalId: "not-a-uuid", name: "meta ajena" }));
  const result = await renameGoal({ goalId: "not-a-uuid", name: "meta ajena" });
  assert.equal(result.ok, false);
});
