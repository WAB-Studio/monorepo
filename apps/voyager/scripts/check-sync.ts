/**
 * Drives the policies on `reading.lookups` and `reading.devices` against the
 * real database — DELETE included — instead of asserting them from the
 * migration (AGENTS.md, "Verification"), and the real statements of
 * `lib/sync/upload.ts` and `lib/sync/devices.ts` through them.
 *
 * A single `sql.begin` holds every statement below and always throws at the
 * end to force a ROLLBACK. The two subjects are `randomUUID()`, their
 * `auth.users` rows are inserted inside that same transaction, and nothing
 * survives it: `npm run harness:census` does not move and
 * `@repo/harness-registry` is never needed.
 */
import { randomUUID } from "node:crypto";

import Module from "node:module";

import { assertSuiteDatabase } from "@repo/harness-registry";
import { settleSessionSql } from "@repo/supabase-auth/settle";
import { PgDialect } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { Transaction } from "../lib/session";
import { deviceLabel } from "../lib/sync/device-label";
import { decodeCursor, syncRequestSchema, type SyncRow } from "../lib/sync/protocol";

assertSuiteDatabase();

// `server-only` throws outside Next; `lib/sync/upload.ts` and `devices.ts`
// import it, and are loaded with `await import` in `main` once this is in place.
const untypedModule = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = untypedModule._load;
untypedModule._load = (request, parent, isMain) =>
  request === "server-only" ? {} : originalLoad(request, parent, isMain);

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

// The real `writeUpload`, `downloadRows`, `listDevices` and `retireDevice`
// take a drizzle transaction; this wraps the probe's own postgres.js one, so
// they run inside the forced-rollback block under the probe's settled role.
// Only `execute` is ever called, which reaches `unsafe` and nothing else.
function readerTx(tx: postgres.TransactionSql): Transaction {
  const client = { options: { parsers: {}, serializers: {} }, unsafe: tx.unsafe.bind(tx) };
  return drizzle({ client: client as unknown as postgres.Sql, casing: "snake_case" }) as unknown as Transaction;
}

function rowsOf(deviceId: string, localIds: number[]): SyncRow[] {
  return localIds.map((localId) => ({
    deviceId,
    localId,
    at: Date.now(),
    text: "x",
    normalised: "x",
    kind: "word",
    outcome: "exact",
    headword: null,
    rule: null,
    senses: 0,
    translation: null,
    dictionaryReady: true,
    origin: null,
    recordSchema: 1,
  }));
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
  const { downloadRows, writeUpload } = await import("../lib/sync/upload");
  const { listDevices, retireDevice } = await import("../lib/sync/devices");

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
      const ownRetired = await retireDevice(readerTx(tx), subject, deviceSubject);
      const lookupsAfterOwn = await countLookups(tx, subject, deviceSubject);
      const ownAfter = await deviceState(tx, subject, deviceSubject);
      assert(
        "S10",
        lookupsBeforeOwn === "3" && ownRetired.lookups === 3 && lookupsAfterOwn === "0" && ownAfter?.retired === true,
        `lookups ${lookupsBeforeOwn} -> ${lookupsAfterOwn} (reported ${ownRetired.lookups}), device row kept retired = ${ownAfter?.retired}`,
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
        update reading.devices set retired_at = now() where device_id = ${deviceIntruderMain}
        returning (select count(*) from gone) as lookups`;

      await enterUserContext(tx, intruder);
      const mainLookupsAfterAttack = await countLookups(tx, intruder, deviceIntruderMain);
      const mainDeviceAfterAttack = await deviceState(tx, intruder, deviceIntruderMain);
      assert(
        "S11",
        attack.length === 0 && mainLookupsAfterAttack === "2" && mainDeviceAfterAttack?.retired === false,
        `outer update rows = ${attack.length}, B's rows survive = ${mainLookupsAfterAttack} lookups, device retired = ${mainDeviceAfterAttack?.retired}`,
      );

      const otherLookupsBefore = await countLookups(tx, intruder, deviceIntruderOther);
      const otherDeviceBefore = await countDevice(tx, intruder, deviceIntruderOther);
      // The legitimate retirement: the real `retireDevice`, run by its owner.
      const retiredMain = await retireDevice(readerTx(tx), intruder, deviceIntruderMain);
      const otherLookupsAfter = await countLookups(tx, intruder, deviceIntruderOther);
      const otherDeviceAfter = await countDevice(tx, intruder, deviceIntruderOther);
      assert(
        "S12",
        retiredMain.lookups === 2 && otherLookupsBefore === otherLookupsAfter && otherDeviceBefore === otherDeviceAfter,
        `main device retired ${retiredMain.lookups} lookups; other device untouched: lookups ${otherLookupsBefore} -> ${otherLookupsAfter}, device ${otherDeviceBefore} -> ${otherDeviceAfter}`,
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
      const reader = readerTx(tx);
      const garbled = decodeCursor("x|y|1");
      const legible = decodeCursor(`2026-10-08T12:00:00.123456Z|${deviceA}|7`);
      const impossible = decodeCursor(`2026-02-31T12:00:00Z|${deviceA}|7`);
      await writeUpload(reader, owner, deviceB, "chrome:android", rowsOf(deviceB, [1, 2, 3]));
      let everything = "not run" as number | string;
      await tx
        .savepoint(async (sp) => {
          everything = (await downloadRows(readerTx(sp), garbled, deviceA)).length;
        })
        .catch((error: unknown) => {
          everything = `sqlstate ${pgCode(error) ?? String(error)}`;
        });
      assert(
        "S17",
        garbled === null && impossible === null && legible?.localId === 7 && everything === 3,
        `x|y|1 -> ${garbled === null ? "null" : "a cursor"}, 31 February -> ${impossible}, legible kept = ${legible !== null}, full download = ${everything}`,
      );

      const wire = (at: number) => ({ deviceId: deviceA, rows: [{ ...rowsOf(deviceA, [1])[0], at }], since: null });
      assert(
        "S18",
        !syncRequestSchema.safeParse(wire(9e15)).success && syncRequestSchema.safeParse(wire(1_700_000_000_000)).success,
        `9e15 refused = ${!syncRequestSchema.safeParse(wire(9e15)).success}`,
      );

      // Aged to 2000 by hand: `now()` is constant inside a transaction, so a
      // refreshed `last_seen_at` is only visible against an older one.
      const age = (device: string) =>
        tx`update reading.devices set last_seen_at = '2000-01-01T00:00:00Z' where user_id = ${owner} and device_id = ${device}`;
      const countOwner = async () =>
        Number((await tx<{ count: string }[]>`select count(*)::text as count from reading.lookups where user_id = ${owner}`)[0].count);

      await age(deviceA);
      const before = await countOwner();
      const overQuota = await writeUpload(reader, owner, deviceA, "chrome:android", rowsOf(deviceA, [1]), before);
      const afterQuota = await countOwner();
      const sealQuota = await deviceState(tx, owner, deviceA);
      const underQuota = await writeUpload(reader, owner, deviceA, "chrome:android", rowsOf(deviceA, [1]), before + 1);
      assert(
        "S19",
        overQuota.status === "quota" && afterQuota === before && sealQuota?.seenYear === 2000 && underQuota.status === "ok",
        `over cap -> ${overQuota.status}, rows ${before} -> ${afterQuota}, seal year ${sealQuota?.seenYear}, at cap -> ${underQuota.status}`,
      );

      await tx`update reading.devices set retired_at = now() where user_id = ${owner} and device_id = ${deviceA}`;
      await age(deviceA);
      const beforeRetired = await countOwner();
      const toRetired = await writeUpload(reader, owner, deviceA, "chrome:android", rowsOf(deviceA, [2]));
      const afterRetired = await countOwner();
      const sealRetired = await deviceState(tx, owner, deviceA);
      assert(
        "S20",
        toRetired.status === "retired" && beforeRetired === afterRetired && sealRetired?.seenYear === 2000,
        `upload -> ${toRetired.status}, rows ${beforeRetired} -> ${afterRetired}, seal year ${sealRetired?.seenYear}`,
      );

      await tx`insert into reading.devices (user_id, device_id, label) values (${owner}, ${deviceC}, 'Chrome on Android')`;
      await writeUpload(reader, owner, deviceC, deviceLabel("Mozilla/5.0 (Linux; Android 14) Chrome/126.0.0.0 Mobile Safari/537.36"), []);
      const relabelled = await deviceState(tx, owner, deviceC);
      assert("S20b", relabelled?.label === "chrome:android", `label after a round = ${relabelled?.label}`);

      await tx`insert into reading.devices (user_id, device_id, label) values (${owner}, ${deviceD}, 'chrome:android')`;
      await writeUpload(reader, owner, deviceD, "chrome:android", rowsOf(deviceD, [1, 2]));
      const siblingBefore = (await tx`select 1 from reading.lookups where user_id = ${owner} and device_id = ${deviceB}`).length;
      const gone = await retireDevice(reader, owner, deviceD);
      const retiredRow = await deviceState(tx, owner, deviceD);
      const [{ count: leftOnD }] = await tx<{ count: string }[]>`select count(*)::text as count from reading.lookups where user_id = ${owner} and device_id = ${deviceD}`;
      const siblingAfter = (await tx`select 1 from reading.lookups where user_id = ${owner} and device_id = ${deviceB}`).length;
      const listed = (await listDevices(reader, owner)).map((device) => device.deviceId);
      let second = "not run" as number | string;
      await tx
        .savepoint(async (sp) => {
          second = (await retireDevice(readerTx(sp), owner, deviceD)).lookups;
        })
        .catch((error: unknown) => {
          second = `sqlstate ${pgCode(error) ?? String(error)}`;
        });
      const neverSealed = randomUUID();
      const ghost = await retireDevice(reader, owner, neverSealed);
      const ghostUpload = await writeUpload(reader, owner, neverSealed, "chrome:android", rowsOf(neverSealed, [1]));
      assert(
        "S21",
        gone.lookups === 2 && retiredRow?.retired === true && leftOnD === "0" && siblingBefore === siblingAfter &&
          !listed.includes(deviceD) && listed.includes(deviceC) && second === 0 && ghost.lookups === 0 &&
          ghostUpload.status === "retired",
        `retired ${gone.lookups} rows, row kept retired = ${retiredRow?.retired}, left = ${leftOnD}, sibling ${siblingBefore} -> ${siblingAfter}, listed = ${listed.length}, second call = ${second}, never-sealed = ${ghost.lookups}/${ghostUpload.status}`,
      );

      throw forcedRollback;
    })
    .catch((error: unknown) => {
      if (error !== forcedRollback) throw error;
    });

  // S22: two uploads at once, each alone within the cap and together past it.
  // The first holds its transaction open while the second waits on the quota
  // lock, so the second counts only after the first commits. It needs real
  // commits, so its reader is a committed row this block deletes at the end
  // (the cascade takes the devices and lookups with it).
  const racer = randomUUID();
  const raceCap = 2;
  const race = postgres(process.env.DATABASE_URL!, { prepare: false, max: 3, connection: { search_path: "reading, public" } });
  try {
    await race`insert into auth.users (id) values (${racer})`;
    const firstDevice = randomUUID();
    const secondDevice = randomUUID();

    let firstHolds!: (status: string) => void;
    const firstWrote = new Promise<string>((resolve) => (firstHolds = resolve));
    let releaseFirst!: () => void;
    const firstReleased = new Promise<void>((resolve) => (releaseFirst = resolve));

    const first = race.begin(async (tx) => {
      await enterUserContext(tx, racer);
      const upload = await writeUpload(readerTx(tx), racer, firstDevice, "chrome:android", rowsOf(firstDevice, [1, 2]), raceCap);
      firstHolds(upload.status);
      await firstReleased;
    });
    // A first upload that throws must not leave this block waiting on a signal nobody sends.
    first.catch((error: unknown) => firstHolds(`threw ${pgCode(error) ?? String(error)}`));
    const firstStatus = await firstWrote;

    let secondDone = false;
    const second = race
      .begin(async (tx) => {
        await enterUserContext(tx, racer);
        return writeUpload(readerTx(tx), racer, secondDevice, "chrome:android", rowsOf(secondDevice, [1, 2]), raceCap);
      })
      .finally(() => {
        secondDone = true;
      });

    // Until the second statement is queued on an advisory lock, or has already
    // finished because nothing made it wait. Bounded: never a retry.
    let waited = false;
    for (let attempt = 0; attempt < 100 && !waited && !secondDone; attempt += 1) {
      const [{ count }] = await race<{ count: string }[]>`
        select count(*)::text as count from pg_locks where locktype = 'advisory' and not granted`;
      waited = count !== "0";
      if (!waited) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    releaseFirst();
    await first;
    const secondUpload = await second;

    const [{ count: raced }] = await race<{ count: string }[]>`
      select count(*)::text as count from reading.lookups where user_id = ${racer}`;
    assert(
      "S22",
      firstStatus === "ok" && waited && secondUpload.status === "quota" && raced === String(raceCap),
      `first -> ${firstStatus}, second waited on the lock = ${waited}, second -> ${secondUpload.status}, rows ${raced} for a cap of ${raceCap}`,
    );
  } finally {
    await race`delete from auth.users where id = ${racer}`;
    await race.end();
  }

  await sql.end();
  if (failed) process.exit(1);
}

main();
