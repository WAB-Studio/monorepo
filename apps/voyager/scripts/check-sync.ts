/**
 * Drives the seven policies on `reading.lookups` and `reading.devices`
 * against the real database — DELETE included — instead of asserting them
 * from the migration (AGENTS.md, "Verification").
 *
 * A single `sql.begin` holds every statement below and always throws at the
 * end to force a ROLLBACK. The two subjects are `randomUUID()`, their
 * `auth.users` rows are inserted inside that same transaction, and nothing
 * survives it: `npm run harness:census` does not move and
 * `@repo/harness-registry` is never needed.
 */
import { randomUUID } from "node:crypto";

import { assertSuiteDatabase } from "@repo/harness-registry";
import { settleSessionSql } from "@repo/supabase-auth/settle";
import { PgDialect } from "drizzle-orm/pg-core";
import postgres from "postgres";

import { deviceLabel } from "../lib/sync/device-label";
import { decodeCursor, syncRequestSchema } from "../lib/sync/protocol";

assertSuiteDatabase();

const sql = postgres(process.env.DATABASE_URL!, {
  prepare: false,
  max: 1,
  connection: { search_path: "reading, public" },
});

let failed = false;

function assert(label: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — ${detail}`);
  if (!ok) failed = true;
}

// Nothing here goes through drizzle, so the driver's own PostgresError is the
// thrown value — no cause chain to walk, unlike `apps/orbit/lib/db-error.ts`.
function pgCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const { code } = error as { code: unknown };
  return typeof code === "string" ? code : undefined;
}

// Mirrors `withReaderDb` (`apps/voyager/lib/session.ts`): one statement, not
// four, and transaction-local (`true`), so re-pointing mid-transaction is
// safe — it never reaches across a reused connection (`docs/TRAPS.md:389`).
async function enterUserContext(tx: postgres.TransactionSql, subject: string): Promise<void> {
  const claims = JSON.stringify({ sub: subject, role: "authenticated", aud: "authenticated" });
  await tx`select
    set_config('request.jwt.claims', ${claims}, true),
    set_config('statement_timeout', '8000', true),
    set_config('search_path', 'reading, public', true),
    set_config('role', 'authenticated', true)`;
}

async function insertLookup(
  tx: postgres.TransactionSql,
  userId: string,
  deviceId: string,
  localId: number,
  text: string,
  onConflictDoNothing = false,
) {
  return tx`insert into reading.lookups
    (user_id, device_id, local_id, at, text, normalised, kind, outcome, senses, dictionary_ready, record_schema)
    values (${userId}, ${deviceId}, ${localId}, now(), ${text}, ${text}, 'word', 'exact', 0, true, 1)
    ${onConflictDoNothing ? tx`on conflict (user_id, device_id, local_id) do nothing` : tx``}`;
}

async function countLookups(tx: postgres.TransactionSql, userId: string, deviceId: string): Promise<string> {
  const [row] = await tx<{ count: string }[]>`
    select count(*)::text as count from reading.lookups where user_id = ${userId} and device_id = ${deviceId}`;
  return row.count;
}

async function countDevice(tx: postgres.TransactionSql, userId: string, deviceId: string): Promise<string> {
  const [row] = await tx<{ count: string }[]>`
    select count(*)::text as count from reading.devices where user_id = ${userId} and device_id = ${deviceId}`;
  return row.count;
}

// The statements below mirror `app/api/log/sync/route.ts`'s `writeUpload` and
// `downloadRows` and `lib/sync/devices.ts`'s `listDevices` and `retireDevice`
// (both import `server-only`, which throws under plain Node), with the daily
// cap as a parameter so a probe needs two rows, not twenty thousand.
type ProbeRow = { deviceId: string; localId: number };

async function probeUpload(
  tx: postgres.TransactionSql,
  userId: string,
  deviceId: string,
  label: string,
  rows: ProbeRow[],
  cap: number,
): Promise<"ok" | "retired" | "quota"> {
  const payload = JSON.stringify(
    rows.map((row) => ({
      device_id: row.deviceId,
      local_id: row.localId,
      at: new Date().toISOString(),
      text: "x",
      normalised: "x",
      kind: "word",
      outcome: "exact",
      headword: null,
      rule: null,
      senses: 0,
      translation: null,
      dictionary_ready: true,
      origin: null,
      record_schema: 1,
    })),
  );
  const [state] = await tx<{ retired: boolean; allowed: boolean }[]>`
    with state as (
      select
        exists (
          select 1 from reading.devices
          where user_id = ${userId} and device_id = ${deviceId} and retired_at is not null
        ) as retired,
        (
          select count(*) from reading.lookups
          where user_id = ${userId}
            and received_at >= (date_trunc('day', now() at time zone 'utc') at time zone 'utc')
        ) as today
    ),
    gate as (
      select retired, (not retired and today + ${rows.length}::int <= ${cap}::int) as allowed from state
    ),
    sealed as (
      insert into reading.devices (user_id, device_id, label)
      select ${userId}::uuid, ${deviceId}::uuid, ${label}::text from gate where allowed
      on conflict (user_id, device_id)
        do update set last_seen_at = now(), label = excluded.label where devices.retired_at is null
      returning 1
    ),
    written as (
      insert into reading.lookups
        (user_id, device_id, local_id, at, text, normalised, kind, outcome, headword, rule, senses,
         translation, dictionary_ready, origin, record_schema)
      select ${userId}::uuid, r.device_id, r.local_id, r."at", r."text", r.normalised, r.kind, r.outcome,
             r.headword, r."rule", r.senses, r.translation, r.dictionary_ready, r.origin, r.record_schema
      from jsonb_to_recordset(${payload}::text::jsonb) as r(
        device_id uuid, local_id integer, "at" timestamptz, "text" text, normalised text, kind text,
        outcome text, headword text, "rule" text, senses integer, translation text,
        dictionary_ready boolean, origin text, record_schema smallint
      )
      where (select allowed from gate)
      on conflict (user_id, device_id, local_id) do nothing
      returning 1
    )
    select gate.retired, gate.allowed from gate`;
  return state.retired ? "retired" : state.allowed ? "ok" : "quota";
}

async function probeRetire(tx: postgres.TransactionSql, userId: string, deviceId: string): Promise<number> {
  const [row] = await tx<{ lookups: string }[]>`
    with gone as (
      delete from reading.lookups where user_id = ${userId} and device_id = ${deviceId} returning 1
    )
    insert into reading.devices (user_id, device_id, label, retired_at)
    values (${userId}, ${deviceId}, 'unknown:unknown', now())
    on conflict (user_id, device_id) do update set retired_at = coalesce(devices.retired_at, now())
    returning (select count(*) from gone) as lookups`;
  return Number(row.lookups);
}

async function probeList(tx: postgres.TransactionSql, userId: string): Promise<string[]> {
  const rows = await tx<{ device_id: string }[]>`
    select d.device_id from reading.devices d where d.user_id = ${userId} and d.retired_at is null`;
  return rows.map((row) => row.device_id);
}

async function deviceState(
  tx: postgres.TransactionSql,
  userId: string,
  deviceId: string,
): Promise<{ label: string; seenYear: number; retired: boolean } | undefined> {
  const [row] = await tx<{ label: string; seen_year: number; retired: boolean }[]>`
    select label, extract(year from last_seen_at)::int as seen_year, retired_at is not null as retired
    from reading.devices where user_id = ${userId} and device_id = ${deviceId}`;
  return row && { label: row.label, seenYear: row.seen_year, retired: row.retired };
}

async function main() {
  const subject = randomUUID();
  const intruder = randomUUID();
  const deviceSubject = randomUUID();
  // The intruder holds two devices, so S12 can prove that retiring one never
  // touches the other's rows — a device-scoped delete, not a user-scoped one.
  const deviceIntruderMain = randomUUID();
  const deviceIntruderOther = randomUUID();
  const forcedRollback = Symbol("forced rollback");

  await sql
    .begin(async (tx) => {
      const [rel] = await tx<{ rowsecurity: boolean; forced: boolean }[]>`
        select relrowsecurity as rowsecurity, relforcerowsecurity as forced
        from pg_class where oid = 'reading.lookups'::regclass`;
      assert(
        "S1",
        rel.rowsecurity === true && rel.forced === true,
        `relrowsecurity = ${rel.rowsecurity}, relforcerowsecurity = ${rel.forced}`,
      );

      const strayGrants = await tx<{ grantee: string; table_name: string; privilege_type: string }[]>`
        select grantee, table_name, privilege_type
        from information_schema.role_table_grants
        where table_schema = 'reading' and table_name in ('lookups', 'devices')
          and grantee in ('anon', 'service_role')`;
      assert("S2", strayGrants.length === 0, `anon/service_role grants = ${strayGrants.length}`);

      const insertCols = await tx<{ column_name: string }[]>`
        select column_name from information_schema.column_privileges
        where table_schema = 'reading' and table_name = 'lookups'
          and grantee = 'authenticated' and privilege_type = 'INSERT'`;
      const cols = insertCols.map((r) => r.column_name);
      assert(
        "S3",
        cols.length === 15 && cols.includes("translation") && !cols.includes("received_at"),
        `${cols.length} insertable columns, translation = ${cols.includes("translation")}, received_at = ${cols.includes("received_at")}`,
      );

      await tx`insert into auth.users (id) values (${subject}), (${intruder})`;

      await enterUserContext(tx, subject);
      await insertLookup(tx, subject, deviceSubject, 1, "hello");
      const [ownRow] = await tx<{ user_id: string }[]>`
        select user_id from reading.lookups where user_id = ${subject} and device_id = ${deviceSubject} and local_id = 1`;
      assert("S4", ownRow?.user_id === subject, `row found = ${Boolean(ownRow)}`);

      await enterUserContext(tx, intruder);
      const [{ count: intruderSees }] = await tx<{ count: string }[]>`
        select count(*)::text as count from reading.lookups where user_id = ${subject}`;
      assert("S5", intruderSees === "0", `rows visible to the intruder = ${intruderSees}`);

      await enterUserContext(tx, subject);
      let foreignInsertCode: string | undefined;
      await tx
        .savepoint((sp) => insertLookup(sp, intruder, deviceSubject, 99, "forged"))
        .catch((error: unknown) => {
          foreignInsertCode = pgCode(error);
        });
      assert("S6", foreignInsertCode === "42501", `sqlstate = ${foreignInsertCode ?? "none"}`);

      const beforeReinsert = await countLookups(tx, subject, deviceSubject);
      await insertLookup(tx, subject, deviceSubject, 1, "hello", true);
      const afterReinsert = await countLookups(tx, subject, deviceSubject);
      assert("S7", beforeReinsert === afterReinsert, `before = ${beforeReinsert}, after = ${afterReinsert}`);

      let updateRows: number | undefined;
      let updateCode: string | undefined;
      await tx
        .savepoint(async (sp) => {
          const result = await sp`
            update reading.lookups set text = 'changed'
            where user_id = ${subject} and device_id = ${deviceSubject} and local_id = 1`;
          updateRows = result.count;
        })
        .catch((error: unknown) => {
          updateCode = pgCode(error);
        });
      assert(
        "S8",
        updateRows === 0 || updateCode !== undefined,
        `rows affected = ${updateRows ?? "n/a"}, sqlstate = ${updateCode ?? "none"}`,
      );

      await insertLookup(tx, subject, deviceSubject, 2, "second");
      await insertLookup(tx, subject, deviceSubject, 3, "third");
      // `::text` on both sides of every comparison below: postgres.js resolves
      // a bare string parameter's wire type from how the query uses it, and a
      // parameter Postgres calls `timestamptz` gets re-serialized through
      // `new Date(x).toISOString()` (`node_modules/postgres/src/types.js:31`),
      // which floors microseconds. Comparing text to text never asks for that
      // cast, so the cursor keeps the precision the column actually holds.
      const [cursorRow, laterRow] = await tx<{ local_id: number; received_at: string }[]>`
        select local_id, received_at::text as received_at from reading.lookups
        where user_id = ${subject} and device_id = ${deviceSubject} and local_id in (2, 3)
        order by local_id`;
      const nonDecreasing = cursorRow.received_at <= laterRow.received_at;
      const afterCursor = await tx<{ local_id: number }[]>`
        select local_id from reading.lookups
        where user_id = ${subject} and received_at::text > ${cursorRow.received_at}
        order by received_at asc limit 500`;
      const cursorExcludesDownloaded = !afterCursor.some((row) => row.local_id === cursorRow.local_id);
      assert(
        "S9",
        nonDecreasing && cursorExcludesDownloaded,
        `non-decreasing = ${nonDecreasing}, cursor excludes local_id ${cursorRow.local_id} = ${cursorExcludesDownloaded}`,
      );

      await tx`insert into reading.devices (user_id, device_id, label) values (${subject}, ${deviceSubject}, 'reader A device')`;

      const lookupsBeforeOwn = await countLookups(tx, subject, deviceSubject);
      const deviceBeforeOwn = await countDevice(tx, subject, deviceSubject);
      // The retire statement itself, unchanged from module 20's `retireDevice`.
      await tx`
        with gone as (
          delete from reading.lookups where user_id = ${subject} and device_id = ${deviceSubject} returning 1
        )
        delete from reading.devices where user_id = ${subject} and device_id = ${deviceSubject}
        returning (select count(*) from gone) as lookups`;
      const lookupsAfterOwn = await countLookups(tx, subject, deviceSubject);
      const deviceAfterOwn = await countDevice(tx, subject, deviceSubject);
      assert(
        "S10",
        lookupsBeforeOwn === "3" && lookupsAfterOwn === "0" && deviceBeforeOwn === "1" && deviceAfterOwn === "0",
        `lookups ${lookupsBeforeOwn} -> ${lookupsAfterOwn}, device row ${deviceBeforeOwn} -> ${deviceAfterOwn}`,
      );

      await enterUserContext(tx, intruder);
      await tx`insert into reading.devices (user_id, device_id, label) values (${intruder}, ${deviceIntruderMain}, 'reader B device main')`;
      await tx`insert into reading.devices (user_id, device_id, label) values (${intruder}, ${deviceIntruderOther}, 'reader B device other')`;
      await insertLookup(tx, intruder, deviceIntruderMain, 1, "b1");
      await insertLookup(tx, intruder, deviceIntruderMain, 2, "b2");
      await insertLookup(tx, intruder, deviceIntruderOther, 1, "c1");

      // The attack: the reader A session runs the retire statement narrowed
      // only by `device_id`, no `user_id` — proving the policy stops it, not
      // the `where` clause the app happens to also send (module 20's note).
      await enterUserContext(tx, subject);
      const attack = await tx<{ lookups: string }[]>`
        with gone as (
          delete from reading.lookups where device_id = ${deviceIntruderMain} returning 1
        )
        delete from reading.devices where device_id = ${deviceIntruderMain}
        returning (select count(*) from gone) as lookups`;

      await enterUserContext(tx, intruder);
      const mainLookupsAfterAttack = await countLookups(tx, intruder, deviceIntruderMain);
      const mainDeviceAfterAttack = await countDevice(tx, intruder, deviceIntruderMain);
      assert(
        "S11",
        attack.length === 0 && mainLookupsAfterAttack === "2" && mainDeviceAfterAttack === "1",
        `outer delete rows = ${attack.length}, B's rows survive = ${mainLookupsAfterAttack} lookups / ${mainDeviceAfterAttack} device`,
      );

      const otherLookupsBefore = await countLookups(tx, intruder, deviceIntruderOther);
      const otherDeviceBefore = await countDevice(tx, intruder, deviceIntruderOther);
      // The legitimate retirement: same statement, run by its owner.
      const [retiredMain] = await tx<{ lookups: string }[]>`
        with gone as (
          delete from reading.lookups where user_id = ${intruder} and device_id = ${deviceIntruderMain} returning 1
        )
        delete from reading.devices where user_id = ${intruder} and device_id = ${deviceIntruderMain}
        returning (select count(*) from gone) as lookups`;
      const otherLookupsAfter = await countLookups(tx, intruder, deviceIntruderOther);
      const otherDeviceAfter = await countDevice(tx, intruder, deviceIntruderOther);
      assert(
        "S12",
        retiredMain?.lookups === "2" && otherLookupsBefore === otherLookupsAfter && otherDeviceBefore === otherDeviceAfter,
        `main device retired ${retiredMain?.lookups} lookups; other device untouched: lookups ${otherLookupsBefore} -> ${otherLookupsAfter}, device ${otherDeviceBefore} -> ${otherDeviceAfter}`,
      );

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  // Everything above proves the policies decide, but only because the session
  // runs as `authenticated`. The login role is `postgres`, which holds
  // BYPASSRLS: drop the role line from `settleSessionSql` and every policy
  // stops applying, in both apps, with all twelve assertions above still
  // green — they settle the role themselves. So this one drives the shared
  // statement instead of mirroring it, in its own transaction, because
  // `set_config(…, true)` is transaction-local and the role the block above
  // set would answer for it.
  await sql
    .begin(async (tx) => {
      const [before] = await tx<{ role: string }[]>`select current_user as role`;
      const claims = JSON.stringify({ sub: randomUUID(), role: "authenticated", aud: "authenticated" });
      const settle = new PgDialect().sqlToQuery(settleSessionSql({ claims, searchPath: "reading, public" }));
      await tx.unsafe(settle.sql, settle.params as string[]);
      const [after] = await tx<{ role: string; bypasses: boolean }[]>`
        select current_user as role,
               (select rolbypassrls from pg_roles where rolname = current_user) as bypasses`;
      assert(
        "S13",
        before.role !== "authenticated" && after.role === "authenticated" && after.bypasses === false,
        `role ${before.role} -> ${after.role}, bypassrls = ${after.bypasses}`,
      );
      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  // S14-S21 run in a transaction of their own, appended after S13 so the
  // numbering above does not move.
  const owner = randomUUID();
  const other = randomUUID();
  const deviceA = randomUUID();
  const deviceB = randomUUID();
  const deviceC = randomUUID();
  const deviceD = randomUUID();
  await sql
    .begin(async (tx) => {
      await tx`insert into auth.users (id) values (${owner}), (${other})`;
      await enterUserContext(tx, owner);
      await tx`insert into reading.devices (user_id, device_id, label) values (${owner}, ${deviceA}, 'chrome:android')`;

      await enterUserContext(tx, other);
      const [{ count: otherSeesDevices }] = await tx<{ count: string }[]>`
        select count(*)::text as count from reading.devices where user_id = ${owner}`;
      assert("S14", otherSeesDevices === "0", `devices of the owner visible to the other reader = ${otherSeesDevices}`);

      let forgedDeviceCode: string | undefined;
      await tx
        .savepoint((sp) => sp`insert into reading.devices (user_id, device_id, label) values (${owner}, ${randomUUID()}, 'forged')`)
        .catch((error: unknown) => {
          forgedDeviceCode = pgCode(error);
        });
      assert("S15", forgedDeviceCode === "42501", `sqlstate = ${forgedDeviceCode ?? "none"}`);

      const touched = await tx`update reading.devices set last_seen_at = now() where user_id = ${owner}`;
      assert("S16", touched.count === 0, `rows updated = ${touched.count}`);

      await enterUserContext(tx, owner);
      const garbled = decodeCursor("x|y|1");
      const legible = decodeCursor(`2026-10-08T12:00:00.123456Z|${deviceA}|7`);
      const impossible = decodeCursor(`2026-02-31T12:00:00Z|${deviceA}|7`);
      await probeUpload(tx, owner, deviceB, "chrome:android", [1, 2, 3].map((localId) => ({ deviceId: deviceB, localId })), 100);
      const everything = await tx<{ local_id: number }[]>`
        select local_id from reading.lookups where user_id = ${owner}
          and ${garbled ? tx`false` : tx`true`} and device_id <> ${deviceA}`;
      assert(
        "S17",
        garbled === null && impossible === null && legible?.localId === 7 && everything.length === 3,
        `x|y|1 -> ${garbled}, 31 February -> ${impossible}, legible kept = ${legible !== null}, full download = ${everything.length} rows`,
      );

      const wire = (at: number) => ({
        deviceId: deviceA,
        rows: [{
          deviceId: deviceA, localId: 1, at, text: "x", normalised: "x", kind: "word", outcome: "exact",
          headword: null, rule: null, senses: 0, translation: null, dictionaryReady: true, origin: null, recordSchema: 1,
        }],
        since: null,
      });
      assert(
        "S18",
        !syncRequestSchema.safeParse(wire(9e15)).success && syncRequestSchema.safeParse(wire(1_700_000_000_000)).success,
        `9e15 refused = ${!syncRequestSchema.safeParse(wire(9e15)).success}`,
      );

      // Aged to 2000 by hand: `now()` is constant inside a transaction, so a
      // refreshed `last_seen_at` is only visible against an older one.
      const age = (device: string) =>
        tx`update reading.devices set last_seen_at = '2000-01-01T00:00:00Z' where user_id = ${owner} and device_id = ${device}`;

      await age(deviceA);
      const [{ count: before }] = await tx<{ count: string }[]>`select count(*)::text as count from reading.lookups where user_id = ${owner}`;
      const overQuota = await probeUpload(tx, owner, deviceA, "chrome:android", [{ deviceId: deviceA, localId: 1 }], Number(before));
      const [{ count: afterQuota }] = await tx<{ count: string }[]>`select count(*)::text as count from reading.lookups where user_id = ${owner}`;
      const sealQuota = await deviceState(tx, owner, deviceA);
      const underQuota = await probeUpload(tx, owner, deviceA, "chrome:android", [{ deviceId: deviceA, localId: 1 }], Number(before) + 1);
      assert(
        "S19",
        overQuota === "quota" && afterQuota === before && sealQuota?.seenYear === 2000 && underQuota === "ok",
        `over cap -> ${overQuota}, rows ${before} -> ${afterQuota}, seal year ${sealQuota?.seenYear}, at cap -> ${underQuota}`,
      );

      await tx`update reading.devices set retired_at = now() where user_id = ${owner} and device_id = ${deviceA}`;
      await age(deviceA);
      const [{ count: beforeRetired }] = await tx<{ count: string }[]>`select count(*)::text as count from reading.lookups where user_id = ${owner}`;
      const toRetired = await probeUpload(tx, owner, deviceA, "chrome:android", [{ deviceId: deviceA, localId: 2 }], 100);
      const [{ count: afterRetired }] = await tx<{ count: string }[]>`select count(*)::text as count from reading.lookups where user_id = ${owner}`;
      const sealRetired = await deviceState(tx, owner, deviceA);
      assert(
        "S20",
        toRetired === "retired" && beforeRetired === afterRetired && sealRetired?.seenYear === 2000,
        `upload -> ${toRetired}, rows ${beforeRetired} -> ${afterRetired}, seal year ${sealRetired?.seenYear}`,
      );

      await tx`insert into reading.devices (user_id, device_id, label) values (${owner}, ${deviceC}, 'Chrome on Android')`;
      await probeUpload(tx, owner, deviceC, deviceLabel("Mozilla/5.0 (Linux; Android 14) Chrome/126.0.0.0 Mobile Safari/537.36"), [], 100);
      const relabelled = await deviceState(tx, owner, deviceC);
      assert("S20b", relabelled?.label === "chrome:android", `label after a round = ${relabelled?.label}`);

      await tx`insert into reading.devices (user_id, device_id, label) values (${owner}, ${deviceD}, 'chrome:android')`;
      await probeUpload(tx, owner, deviceD, "chrome:android", [{ deviceId: deviceD, localId: 1 }, { deviceId: deviceD, localId: 2 }], 100);
      const siblingBefore = (await tx`select 1 from reading.lookups where user_id = ${owner} and device_id = ${deviceB}`).length;
      const gone = await probeRetire(tx, owner, deviceD);
      const retiredRow = await deviceState(tx, owner, deviceD);
      const [{ count: leftOnD }] = await tx<{ count: string }[]>`select count(*)::text as count from reading.lookups where user_id = ${owner} and device_id = ${deviceD}`;
      const siblingAfter = (await tx`select 1 from reading.lookups where user_id = ${owner} and device_id = ${deviceB}`).length;
      const listed = await probeList(tx, owner);
      const second = await probeRetire(tx, owner, deviceD);
      const neverSealed = randomUUID();
      const ghost = await probeRetire(tx, owner, neverSealed);
      const ghostUpload = await probeUpload(tx, owner, neverSealed, "chrome:android", [{ deviceId: neverSealed, localId: 1 }], 100);
      assert(
        "S21",
        gone === 2 && retiredRow?.retired === true && leftOnD === "0" && siblingBefore === siblingAfter &&
          !listed.includes(deviceD) && listed.includes(deviceC) && second === 0 && ghost === 0 && ghostUpload === "retired",
        `retired ${gone} rows, row kept retired = ${retiredRow?.retired}, left = ${leftOnD}, sibling ${siblingBefore} -> ${siblingAfter}, listed = ${listed.length}, second call = ${second}, never-sealed = ${ghost}/${ghostUpload}`,
      );

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  await sql.end();
  if (failed) process.exit(1);
}

main();
