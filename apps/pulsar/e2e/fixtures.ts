import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { test as base, expect } from "@playwright/test";
import postgres from "postgres";

// The signed-in person every spec drives: the suite's global setup mints a
// real identity under its own run and writes its cookie to this file —
// never a typed address, never a fresh sign-in per spec (RNP-09).
// `playwright.config.ts` points the whole suite's browser context at it;
// nothing here opens `/entrar`.
export function laneNumber(): number {
  const raw = process.env.HARNESS_LANE?.trim();
  if (!raw) return 1;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`HARNESS_LANE must be a positive integer, not "${raw}"`);
  }
  return Number(raw);
}

export function sessionFile(): string {
  return resolve(process.cwd(), `private/session-${laneNumber()}.json`);
}

type StoredCookie = { name: string; value: string };
type StorageState = { cookies: StoredCookie[]; origins: unknown[] };

function loadStorageState(file = sessionFile()): StorageState {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`no session at ${file} — scripts/harness/e2e-run.ts mints it before any spec`);
  }
}

function decodeBase64Url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

// `@supabase/ssr` chunks a cookie past its own length cap and, by default,
// prefixes the whole payload with `base64-` (`cookies.js`'s own
// `decodeChunkedCookieValue`). Nothing here re-implements that module —
// this only ever reads a cookie `mint-session.ts` itself just wrote, so the
// two encodings this file actually meets are covered and nothing else.
function accessTokenFromCookies(cookies: StoredCookie[]): string {
  const chunks = cookies
    .filter((cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("auth-token"))
    .sort((a, b) => {
      const na = Number(a.name.split(".").pop());
      const nb = Number(b.name.split(".").pop());
      return (Number.isNaN(na) ? 0 : na) - (Number.isNaN(nb) ? 0 : nb);
    });
  if (chunks.length === 0) throw new Error("storage state carries no sb-*-auth-token cookie");

  const raw = chunks.map((cookie) => cookie.value).join("");
  const encoded = raw.startsWith("base64-") ? raw.slice("base64-".length) : raw;
  const session = JSON.parse(decodeBase64Url(encoded)) as { access_token: string };
  return session.access_token;
}

// Read straight off the access token's own payload, unverified — this file
// only ever decodes a token `mint-session.ts` minted for itself, never one
// carried in from outside.
function claimsFromAccessToken(token: string): { id: string; email: string } {
  const [, payload] = token.split(".");
  const claims = JSON.parse(decodeBase64Url(payload)) as { sub: string; email: string };
  return { id: claims.sub, email: claims.email };
}

export function seededPerson(): { id: string; email: string } {
  const { cookies } = loadStorageState();
  return claimsFromAccessToken(accessTokenFromCookies(cookies));
}

// A person of a spec's own, under a session file no other test can name: the
// path is a fresh UUID, never a number two files could pick alike. Two
// workers minting one path overwrote each other's cookie, and the teardown of
// one dropped the rows the other was measuring. Registered under the suite's
// run (`HARNESS_RUN_ID`), whose teardown drops the identity.
export function mintDisposablePerson(baseUrl: string): { id: string; sessionFile: string } {
  const file = `private/disposable/${randomUUID()}.json`;
  execFileSync(
    process.execPath,
    ["--import", "tsx", "--env-file=.env.local", "scripts/harness/mint-session.ts"],
    { env: { ...process.env, MINT_SESSION_FILE: file, PULSAR_BASE_URL: baseUrl }, stdio: "pipe" },
  );
  const absolute = resolve(process.cwd(), file);
  const { cookies } = loadStorageState(absolute);
  return { id: claimsFromAccessToken(accessTokenFromCookies(cookies)).id, sessionFile: absolute };
}

type Fixtures = {
  // One connection per test, bypassing RLS the same way `MIGRATION_DATABASE_URL`
  // does for every harness script — never the app's own `DATABASE_URL` role
  // rules out reaching, and never a policy this suite has any business
  // proving from outside the app (`check-policies.ts` owns that).
  db: postgres.Sql;
  personId: string;
};

// Named `provide`, not Playwright's own `use`: an identically-named
// parameter here reads to `eslint-plugin-react-hooks` as the `use` hook,
// which this file, being test wiring rather than a component, is not
// (`apps/voyager/e2e/fixtures.ts`'s own fix for the same warning).
export const test = base.extend<Fixtures>({
  db: async ({}, provide) => {
    const sql = postgres(process.env.MIGRATION_DATABASE_URL!, { prepare: false, max: 1 });
    await provide(sql);
    await sql.end();
  },

  personId: async ({}, provide) => {
    await provide(seededPerson().id);
  },
});

export { expect };
