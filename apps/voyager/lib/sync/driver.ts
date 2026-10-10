import type { ForeignRow } from "@/lib/log/merge";
import { readSince, mergeForeign } from "@/lib/log/merge";
import { markRetired, readSyncState, writeSyncState } from "@/lib/log/record";
import { SYNC_BATCH, syncRequestSchema, syncResponseSchema, type SyncResponse, type SyncRow } from "./protocol";
import { failureCause, type SyncFailure } from "./failure";
import { shareInFlight } from "./in-flight";
import { planUploadRound } from "./upload-page";

const SYNC_ENDPOINT = "/api/log/sync";

// A hostile record can never tie a hidden tab up forever: this many round
// trips per call, then the rest waits for the next hide.
const MAX_BATCHES = 40;

export const SYNC_LANDED_EVENT = "voyager:sync-landed";

class SyncFailureError extends Error {
  constructor(readonly cause: SyncFailure) {
    super(`sync failed: ${cause}`);
  }
}

export type SyncOutcome =
  | { kind: "off" } // enabled === false: no request was ever issued
  | { kind: "done"; pushed: number; pulled: number }
  | { kind: "retired" } // the server retired this device: the copy is off for good
  | { kind: "failed"; cause: SyncFailure };

// The row's own device, not this one's: it already crossed the wire once.
// Every other wire field passes through, so a new one needs no edit here.
function toForeignRow(row: SyncResponse["rows"][number]): ForeignRow {
  const { deviceId, localId, recordSchema, receivedAt, ...rest } = row;
  void receivedAt;
  return { ...rest, schema: recordSchema, device: deviceId, deviceSeq: localId };
}

// Hands the main thread back so a search typed meanwhile runs between the
// parse and the merge, not after them.
const yieldToLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// `deviceId` travels on every round, `rows` empty or not: a pull-only round
// still has to seal this device's own row in `reading.devices` (module 31,
// RL-25), and the route has nothing else top-level to read it off.
async function postBatch(
  deviceId: string,
  rows: SyncRow[],
  since: string | null,
): Promise<SyncResponse | "retired"> {
  const response = await fetch(SYNC_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(syncRequestSchema.parse({ deviceId, rows, since })),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (response.status === 409 && body?.error === "retired") return "retired";
    throw new SyncFailureError(failureCause({ status: response.status, body }));
  }
  return syncResponseSchema.parse(await response.json());
}

/**
 * Pushes local rows and pulls foreign ones, in batches of `SYNC_BATCH`, until
 * both sides come back short or `MAX_BATCHES` is spent. Every round calls
 * `postBatch`, even one with nothing local to push: the download is not a
 * side effect of the upload, so a fresh device with an empty log still pulls
 * what the account already holds. Never throws: a failed round trip leaves
 * the cursors where they were, so the next call resumes it.
 */
async function runSync(): Promise<SyncOutcome> {
  const state = await readSyncState();
  if (!state.enabled) return { kind: "off" };

  let pushedThroughLocalId = state.pushedThroughLocalId;
  let pulledThroughCursor = state.pulledThroughCursor;
  let pushed = 0;
  let pulled = 0;

  try {
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const { own, scannedThrough, scanned } = await readSince(pushedThroughLocalId ?? 0, SYNC_BATCH);
      const { rows } = planUploadRound(own, state.deviceId);
      const response = await postBatch(state.deviceId, rows, pulledThroughCursor);
      if (response === "retired") {
        await markRetired();
        return { kind: "retired" };
      }

      // The merge is awaited in full before either cursor moves: a batch
      // that only half lands must be read again next time, not skipped.
      await yieldToLoop();
      pulled += await mergeForeign(response.rows.map(toForeignRow));

      // The upload cursor follows what was scanned, not what was sent: a page
      // of foreign rows has nothing to send and still has to be left behind.
      if (scannedThrough !== null) pushedThroughLocalId = scannedThrough;
      pushed += rows.length;
      pulledThroughCursor = response.cursor;
      await writeSyncState({ pushedThroughLocalId, pulledThroughCursor, lastSyncedAt: Date.now() });
      await yieldToLoop();

      // Stop only once neither side has a next page waiting: a short scanned
      // page alone no longer ends the call, or a large foreign backlog would
      // never finish downloading behind a thin local log.
      if (scanned < SYNC_BATCH && response.rows.length < SYNC_BATCH) break;
    }
    if (pulled > 0) window.dispatchEvent(new Event(SYNC_LANDED_EVENT));
    return { kind: "done", pushed, pulled };
  } catch (error) {
    const cause =
      error instanceof SyncFailureError
        ? error.cause
        : failureCause({ error, online: typeof navigator === "undefined" || navigator.onLine });
    return { kind: "failed", cause };
  }
}

export const syncNow = shareInFlight(runSync);
