import type { SyncState } from "./types";

/** A stored row from before `readerId` and `retired` existed reads as unclaimed and live. */
export function normaliseSyncState(row: unknown): SyncState {
  const stored = (row ?? {}) as Partial<SyncState>;
  return {
    deviceId: stored.deviceId as string,
    pushedThroughLocalId: stored.pushedThroughLocalId ?? null,
    pulledThroughCursor: stored.pulledThroughCursor ?? null,
    lastSyncedAt: stored.lastSyncedAt ?? null,
    enabled: stored.enabled ?? false,
    readerId: stored.readerId ?? null,
    retired: stored.retired ?? false,
  };
}

/**
 * The state a copy for `readerId` starts from. Cursors and `deviceId` belong
 * to one reader on one live device: any other case starts over under a new id.
 */
export function syncStateForReader(current: SyncState, readerId: string, mintId: () => string): SyncState {
  const hasCursors = current.pushedThroughLocalId !== null || current.pulledThroughCursor !== null;
  const sameReader = current.readerId === readerId || (current.readerId === null && !hasCursors);
  if (sameReader && !current.retired) return { ...current, readerId, enabled: true };
  return {
    deviceId: mintId(),
    pushedThroughLocalId: null,
    pulledThroughCursor: null,
    lastSyncedAt: null,
    enabled: true,
    readerId,
    retired: false,
  };
}
