/**
 * Cooperative cancellation for the Supabase ← GetSales sync (single in-process run).
 * POST /api/supabase-sync-cancel sets a flag; incremental fetch loops check it between pages.
 */

const cancelledRunIds = new Set<string>();

/** Run IDs whose sync loop is executing in this Node process (clears on redeploy). */
const localActiveSyncRunIds = new Set<string>();

export function registerLocalSyncRun(runId: string): void {
  localActiveSyncRunIds.add(runId);
}

export function unregisterLocalSyncRun(runId: string): void {
  localActiveSyncRunIds.delete(runId);
}

/** True if this process is actively running the given sync (cooperative cancel only; do not clear DB lock from another handler). */
export function isLocalSyncRunActive(runId: string): boolean {
  return localActiveSyncRunIds.has(runId);
}

export class SyncCancelledError extends Error {
  constructor() {
    super("Sync cancelled by user");
    this.name = "SyncCancelledError";
  }
}

/** Mark a run as cancelled; the sync loop observes this between API pages. */
export function requestSyncCancellation(runId: string): void {
  cancelledRunIds.add(runId);
}

export function isSyncCancelled(runId: string): boolean {
  return cancelledRunIds.has(runId);
}

export function clearSyncCancellation(runId: string): void {
  cancelledRunIds.delete(runId);
}
