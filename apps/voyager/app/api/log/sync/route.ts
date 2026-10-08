import "server-only";

import { sql } from "drizzle-orm";

import { getReader, withReaderDb, type Transaction } from "@/lib/session";
import { deviceLabel } from "@/lib/sync/device-label";
import {
  syncRequestSchema,
  SYNC_BATCH,
  SYNC_DAILY_ROW_CAP,
  decodeCursor,
  encodeCursor,
  type Cursor,
  type SyncResponse,
  type SyncRow,
} from "@/lib/sync/protocol";

// Reads the session per request and answers a moving cursor: never a candidate
// for the full route cache, on top of the `Cache-Control` this route also sets.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

// The columns `authenticated` may insert into `lookups`, in the grant's own
// order (apps/voyager/db/migrations/0000_shallow_hammerhead.sql:74-78).
// `received_at` is never here: no grant reaches it, only the server's own
// clock stamps it — which is why a builder `.insert()` cannot be used
// (apps/orbit/db/insert-row.ts's header: it would name `received_at` too,
// with the keyword `default`, and Postgres checks the privilege on a named
// column even then).
const INSERT_COLUMNS = sql.join(
  [
    "user_id",
    "device_id",
    "local_id",
    "at",
    "text",
    "normalised",
    "kind",
    "outcome",
    "headword",
    "rule",
    "senses",
    "translation",
    "dictionary_ready",
    "origin",
    "record_schema",
  ].map((column) => sql.identifier(column)),
  sql`, `,
);

// The batch travels as ONE jsonb parameter, read back through typed columns:
// a `values` list cannot sit behind the quota guard, and a `select` over
// untyped parameters loses the column types an `insert … values` infers.
// `at` goes as an ISO string so its millisecond survives as a `timestamptz`.
function uploadedRows(rows: SyncRow[]): string {
  return JSON.stringify(
    rows.map((row) => ({
      device_id: row.deviceId,
      local_id: row.localId,
      at: new Date(row.at).toISOString(),
      text: row.text,
      normalised: row.normalised,
      kind: row.kind,
      outcome: row.outcome,
      headword: row.headword,
      rule: row.rule,
      senses: row.senses,
      translation: row.translation,
      dictionary_ready: row.dictionaryReady,
      origin: row.origin,
      record_schema: row.recordSchema,
    })),
  );
}

type Upload = { status: "ok"; accepted: number } | { status: "retired" } | { status: "quota" };

// Seals `reading.devices` (RL-25) and inserts the device's own batch in ONE
// statement, one round trip. `state` reads whether the device is retired and
// how many rows this reader sent today (UTC, by `lookups_user_id_received_at_idx`);
// the seal and the insert are data-modifying CTEs, so Postgres runs both
// whether or not anything reads them (`docs/TRAPS.md:463-486`) and both sit
// behind the same guard: a retired device, or a day past the cap, writes and
// seals nothing. A resent, fully-duplicate batch still seals the device.
// `on conflict … do nothing` keeps a retry after a crash from duplicating (RL-24).
// `received_at` is the statement's `now()`: every row of a batch ties on it.
async function writeUpload(
  tx: Transaction,
  userId: string,
  deviceId: string,
  label: string,
  rows: SyncRow[],
): Promise<Upload> {
  const [state] = await tx.execute<{ retired: boolean; allowed: boolean; accepted: number }>(sql`
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
      select retired, (not retired and today + ${rows.length} <= ${SYNC_DAILY_ROW_CAP}) as allowed from state
    ),
    sealed as (
      insert into reading.devices (user_id, device_id, label)
      select ${userId}, ${deviceId}, ${label} from gate where allowed
      on conflict (user_id, device_id)
        do update set last_seen_at = now(), label = excluded.label where devices.retired_at is null
      returning 1
    ),
    written as (
      insert into reading.lookups (${INSERT_COLUMNS})
      select ${userId}, r.device_id, r.local_id, r."at", r."text", r.normalised, r.kind, r.outcome,
             r.headword, r."rule", r.senses, r.translation, r.dictionary_ready, r.origin, r.record_schema
      from jsonb_to_recordset(${uploadedRows(rows)}::text::jsonb) as r(
        device_id uuid, local_id integer, "at" timestamptz, "text" text, normalised text, kind text,
        outcome text, headword text, "rule" text, senses integer, translation text,
        dictionary_ready boolean, origin text, record_schema smallint
      )
      where (select allowed from gate)
      on conflict (user_id, device_id, local_id) do nothing
      returning 1
    )
    select gate.retired, gate.allowed, (select count(*) from written)::int as accepted from gate
  `);

  if (state.retired) return { status: "retired" };
  if (!state.allowed) return { status: "quota" };
  return { status: "ok", accepted: state.accepted };
}

// `at` and `received_at` travel as UTC wall-clock text with no zone marker,
// not the bare column: `drizzle-orm/postgres-js` registers a transparent
// parser over every timestamp OID (its own `driver.js`), so a raw
// `tx.execute()` — one with no schema column to decode through — hands back
// Postgres's own text output (`DateStyle`-dependent) instead of a `Date`.
// `timezone('utc', …)` pins the zone regardless of the session's own setting;
// `to_json` on the result is then a plain "YYYY-MM-DDTHH:MI:SS.ffffff", which
// this file appends its own literal "Z" to — never `new Date(...).toISOString()`,
// which would round the stored microseconds down to milliseconds and make
// `received_at > cursor` true again for the very row the cursor named
// (RL-24's "never download the same row twice").
type DownloadedRow = {
  device_id: string;
  local_id: number;
  at: string;
  text: string;
  normalised: SyncRow["normalised"];
  kind: SyncRow["kind"];
  outcome: SyncRow["outcome"];
  headword: string | null;
  rule: string | null;
  senses: number;
  translation: string | null;
  dictionary_ready: boolean;
  origin: SyncRow["origin"];
  record_schema: number;
  received_at: string;
};

// Downloads what other devices copied since `since`, ordered by the same
// tuple the comparison names, so the last row's own clock and identity are
// the next cursor to send back (RL-22). No cursor at all — a first-ever sync
// — filters on `user_id` alone: there is no sentinel value less than every
// real `received_at` to bind instead, and none is needed.
//
// `excludeDeviceId` is the calling device's own id, filtered out here rather
// than left for the client to notice: the client's own dedupe keys on
// `[device, deviceSeq]` in IndexedDB, and a row this device just uploaded
// comes back with `device` set (a local row is stored with `device: null`,
// `lib/log/merge.ts`), so it never collides with itself there — it lands as
// a second, foreign-looking copy of a search the reader already made. A
// filter on the query is the only place this is actually excluded.
async function downloadRows(
  tx: Transaction,
  cursor: Cursor | null,
  excludeDeviceId: string,
): Promise<DownloadedRow[]> {
  // Never `${cursor.receivedAt}::timestamptz` alone: Postgres would then
  // describe that parameter as `timestamptz` (OID 1184), and postgres.js
  // serializes a bound value for that OID through `new Date(x).toISOString()`
  // — dropping the stored microseconds, so the cursor lands on the wrong side
  // of the very row it named and a tied upload batch either replays forever
  // or is silently dropped at the boundary (RL-24, both measured 2026-09-08).
  // Casting from text keeps the parameter's own OID at `text` (25): the value
  // crosses the wire unchanged, and Postgres parses it back server-side.
  const boundary = cursor
    ? sql`(received_at, device_id, local_id) > (${cursor.receivedAt}::text::timestamptz, ${cursor.deviceId}::uuid, ${cursor.localId}::integer)`
    : sql`true`;

  // A filter, not a paging boundary: the tuple comparison and the order by
  // below are untouched, so a page still resumes from the last row it named.
  // Fewer rows now qualify per page — a device with rows of its own gets a
  // smaller page than before, never a skipped one.
  const notOwn = sql`and device_id <> ${excludeDeviceId}::uuid`;

  return tx.execute<DownloadedRow>(sql`
    select device_id, local_id, to_json(timezone('utc', "at")) as "at", text, normalised,
           kind, outcome, headword, rule, senses, translation, dictionary_ready, origin,
           record_schema, to_json(timezone('utc', received_at)) as received_at
    from reading.lookups
    where user_id = auth.uid() and ${boundary} ${notOwn}
    -- Table-qualified: the output column of the same name is the to_json
    -- alias above, and json carries no ordering operator (42883) on its own.
    -- The full tuple, in the comparison's own order: received_at alone ties
    -- within a batch, and a tie resumes wrong without its tiebreakers ordered too.
    order by reading.lookups.received_at asc, reading.lookups.device_id asc, reading.lookups.local_id asc
    limit ${SYNC_BATCH}
  `);
}

function toWireRow(row: DownloadedRow): SyncResponse["rows"][number] {
  return {
    deviceId: row.device_id,
    localId: row.local_id,
    at: new Date(`${row.at}Z`).getTime(),
    text: row.text,
    normalised: row.normalised,
    kind: row.kind,
    outcome: row.outcome,
    headword: row.headword,
    rule: row.rule,
    senses: row.senses,
    translation: row.translation,
    dictionaryReady: row.dictionary_ready,
    origin: row.origin,
    recordSchema: row.record_schema,
    receivedAt: `${row.received_at}Z`,
  };
}

export async function POST(request: Request): Promise<Response> {
  // Without a session there is no query at all: `getReader` never touches
  // Postgres, so the 401 never opens a connection.
  const reader = await getReader();
  if (!reader) return json({ error: "unauthorized" }, 401);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "invalid" }, 400);
  }

  const parsed = syncRequestSchema.safeParse(raw);
  if (!parsed.success) return json({ error: "invalid" }, 400);

  const { rows, since } = parsed.data;

  // Nothing ties the top-level `deviceId` to the one on each row: both are
  // `z.uuid()` and a request may disagree with itself. A batch with rows has
  // always spoken for `rows[0]`'s device — sealing and excluding any other
  // sends the rows just uploaded straight back down in the same response — so
  // it keeps doing that. The top-level field answers only the empty batch, a
  // download-only round (RL-22) with no row to read a device off.
  const deviceId = rows.length > 0 ? rows[0].deviceId : parsed.data.deviceId;
  const label = deviceLabel(request.headers.get("user-agent"));

  const sinceCursor = since ? decodeCursor(since) : null;

  const outcome = await withReaderDb(async (tx) => {
    // Same statement order the contract names: upload, then download.
    const upload = await writeUpload(tx, reader.id, deviceId, label, rows);
    if (upload.status !== "ok") return upload;
    return { status: "ok", accepted: upload.accepted, downloaded: await downloadRows(tx, sinceCursor, deviceId) } as const;
  });

  if (outcome.status === "retired") return json({ error: "retired" }, 409);
  if (outcome.status === "quota") return json({ error: "quota" }, 429);

  const wireRows = outcome.downloaded.map(toWireRow);
  const last = wireRows[wireRows.length - 1];
  // Echoes the cursor only when it was legible: a garbled one would otherwise
  // come back and be stored again.
  const cursor = last
    ? encodeCursor({ receivedAt: last.receivedAt, deviceId: last.deviceId, localId: last.localId })
    : sinceCursor && encodeCursor(sinceCursor);

  const response: SyncResponse = { accepted: outcome.accepted, rows: wireRows, cursor };
  return json(response, 200);
}
