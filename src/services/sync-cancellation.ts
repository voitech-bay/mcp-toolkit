/**
 * Cooperative cancellation for the Supabase ← GetSales sync (single in-process run).
 * POST /api/supabase-sync-cancel sets a flag; incremental fetch loops check it between pages.
 */

const cancelledRunIds = new Set<string>();

/**
 * Run IDs whose sync loop is executing in this Node process, mapped to the epoch ms
 * at which they were registered (clears on redeploy).
 *
 * The timestamp exists so the reaper can tell a genuinely long run from a leaked
 * registration: if `syncSupabaseFromSource` dies in a way that skips its cleanup,
 * the entry would otherwise keep `isLocalSyncRunActive` true forever and shield a
 * dead run from ever being reaped.
 */
const localActiveSyncRuns = new Map<string, number>();

export function registerLocalSyncRun(runId: string, nowMs = Date.now()): void {
  // Never overwrite an existing registration: the first timestamp is the true age.
  if (!localActiveSyncRuns.has(runId)) localActiveSyncRuns.set(runId, nowMs);
}

export function unregisterLocalSyncRun(runId: string): void {
  localActiveSyncRuns.delete(runId);
}

/** True if this process is actively running the given sync (cooperative cancel only; do not clear DB lock from another handler). */
export function isLocalSyncRunActive(runId: string): boolean {
  return localActiveSyncRuns.has(runId);
}

/** Run IDs registered by this process. Used on shutdown to release their DB locks. */
export function listLocalSyncRunIds(): string[] {
  return [...localActiveSyncRuns.keys()];
}

/** Ms since this process registered the run, or undefined when it does not own it. */
export function localSyncRunAgeMs(runId: string, nowMs = Date.now()): number | undefined {
  const startedMs = localActiveSyncRuns.get(runId);
  return startedMs === undefined ? undefined : nowMs - startedMs;
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
