/**
 * Stale sync-run reaper.
 *
 * `sync_runs` rows marked `running` are a global lock: `getActiveSyncRun` matches any of
 * them with no age limit, so a run that never writes its terminal status blocks every
 * project forever (this happened in production for 8 days). A run can be orphaned by
 * process death mid-sync, by an early return before the sync's own cleanup, or by a
 * throw that escapes it. This module closes such rows automatically.
 *
 * It runs regardless of whether the scheduled sync is enabled, because manually started
 * syncs orphan too.
 *
 * Single-replica assumption: the only protection against closing a run that is genuinely
 * executing elsewhere is `localSyncRunAgeMs`, which is per-process. If this service is
 * ever scaled beyond one replica, this must be replaced by a heartbeat column on
 * `sync_runs` that the running sync bumps periodically.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getLatestSyncLogEntryAt,
  getRunningSyncRuns,
  markSyncRunFinishedIfStillRunning,
} from "./supabase.js";
import {
  clearSyncCancellation,
  listLocalSyncRunIds,
  localSyncRunAgeMs,
  requestSyncCancellation,
  unregisterLocalSyncRun,
} from "./sync-cancellation.js";

const LOG_PREFIX = "[sync-reaper]";

export interface SyncReaperConfig {
  enabled: boolean;
  /** A `running` row older than this with no live local owner is considered dead. */
  staleAfterMs: number;
  /** Ceiling on a local registration before it is treated as leaked rather than live. */
  localMaxMs: number;
  sweepIntervalMs: number;
}

export function getSyncReaperConfig(env: NodeJS.ProcessEnv = process.env): SyncReaperConfig {
  const ms = (name: string, fallback: number, min: number) => {
    const parsed = Number.parseInt(env[name] ?? "", 10);
    return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
  };
  return {
    // On by default, with an explicit kill switch: a safety net that defaults to off
    // is not a safety net.
    enabled: !/^(0|false|no)$/i.test(env.SYNC_REAPER_ENABLED ?? ""),
    // 15 min is ~5x the longest run ever observed (179s), so a slow GetSales page or a
    // wide manual backfill can never trip it, while still clearing a wedge well inside
    // the 60 min scheduler tick.
    staleAfterMs: ms("SYNC_RUN_STALE_MS", 900_000, 60_000),
    // Deliberately far above any plausible run: this exists to break a leaked registry
    // entry, not to police run duration.
    localMaxMs: ms("SYNC_RUN_LOCAL_MAX_MS", 14_400_000, 300_000),
    sweepIntervalMs: ms("SYNC_REAPER_SWEEP_MS", 300_000, 30_000),
  };
}

export interface StaleRunInput {
  id: string;
  started_at: string;
  project_id?: string | null;
}

export interface StaleRunSelection {
  now: Date;
  staleAfterMs: number;
  localMaxMs: number;
  /** Ms since this process registered the run; undefined when this process does not own it. */
  localAgeMs: (runId: string) => number | undefined;
  /**
   * ISO timestamp of the run's most recent log entry, if any. This is the primary
   * liveness signal: a running sync writes log entries continuously, so recent activity
   * means it is alive even when the in-process registry says otherwise (which is exactly
   * how a live Velvetech run got reaped on 2026-07-29).
   */
  lastLogAt?: (runId: string) => string | undefined;
}

/**
 * Pure core of the reaper: which of these `running` rows are dead?
 *
 * Local ownership is checked first so a young run owned by this process is protected
 * regardless of how its DB timestamp looks. A local run past `localMaxMs` falls through
 * and becomes reapable, which is what breaks a leaked registration.
 */
export function selectStaleRunIds(runs: StaleRunInput[], opts: StaleRunSelection): string[] {
  const nowMs = opts.now.getTime();
  const stale: string[] = [];
  for (const run of runs) {
    // Liveness first, and it outranks everything: recent log activity means the sync is
    // demonstrably still working, so it must never be closed no matter how old the row is.
    const lastLog = opts.lastLogAt?.(run.id);
    if (lastLog) {
      const lastLogMs = Date.parse(lastLog);
      if (Number.isFinite(lastLogMs) && nowMs - lastLogMs < opts.staleAfterMs) continue;
    }
    const localAge = opts.localAgeMs(run.id);
    if (localAge !== undefined && localAge < opts.localMaxMs) continue;
    const startedMs = Date.parse(run.started_at);
    // An unparseable timestamp can never age out, so treat it as stale rather than
    // letting it wedge the lock permanently.
    if (!Number.isFinite(startedMs)) {
      stale.push(run.id);
      continue;
    }
    if (nowMs - startedMs >= opts.staleAfterMs) stale.push(run.id);
  }
  return stale;
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (totalMinutes > 0) return `${totalMinutes}m`;
  return `${Math.floor(ms / 1000)}s`;
}

/**
 * Worded so it is distinguishable in `sync_runs.error` from the manual
 * "Clear stuck sync lock" message, making it obvious which mechanism fired.
 */
export function formatReaperErrorText(ageMs: number, staleAfterMs: number): string {
  return (
    `Auto-closed by the sync reaper: still 'running' after ${formatDurationMs(ageMs)} ` +
    `(threshold ${formatDurationMs(staleAfterMs)}) with no sync process on this server. ` +
    "Likely a redeploy, restart, or crash mid-sync. No data was lost: the next incremental " +
    "sync resumes from the last watermark."
  );
}

export interface ReapResult {
  candidates: number;
  reaped: string[];
  error: string | null;
}

export async function reapStaleSyncRuns(
  client: SupabaseClient,
  options?: { now?: Date; config?: SyncReaperConfig }
): Promise<ReapResult> {
  const config = options?.config ?? getSyncReaperConfig();
  if (!config.enabled) return { candidates: 0, reaped: [], error: null };

  const now = options?.now ?? new Date();
  const nowMs = now.getTime();
  // Push the age bound into Postgres so the normal case is one indexed query
  // returning nothing at all.
  const cutoffIso = new Date(nowMs - config.staleAfterMs).toISOString();

  const { data: runs, error } = await getRunningSyncRuns(client, {
    olderThanIso: cutoffIso,
    limit: 50,
  });
  if (error) return { candidates: 0, reaped: [], error };
  if (runs.length === 0) return { candidates: 0, reaped: [], error: null };

  // Heartbeat lookup for the candidates only, so the common (empty) case costs nothing.
  const { data: lastLogByRun } = await getLatestSyncLogEntryAt(
    client,
    runs.map((r) => r.id)
  );

  const staleIds = selectStaleRunIds(runs, {
    now,
    staleAfterMs: config.staleAfterMs,
    localMaxMs: config.localMaxMs,
    localAgeMs: (runId) => localSyncRunAgeMs(runId, nowMs),
    lastLogAt: (runId) => lastLogByRun[runId],
  });

  const reaped: string[] = [];
  for (const runId of staleIds) {
    const run = runs.find((r) => r.id === runId);
    const startedMs = run ? Date.parse(run.started_at) : Number.NaN;
    const ageMs = Number.isFinite(startedMs) ? nowMs - startedMs : Number.NaN;
    const { updated, error: updateError } = await markSyncRunFinishedIfStillRunning(client, runId, {
      error: formatReaperErrorText(ageMs, config.staleAfterMs),
    });
    if (updateError) {
      console.error(`${LOG_PREFIX} failed to close run ${runId}: ${updateError}`);
      continue;
    }
    // Clear in-memory state even when the CAS lost, so a leaked registration
    // cannot survive a sweep.
    unregisterLocalSyncRun(runId);
    clearSyncCancellation(runId);
    if (updated) {
      reaped.push(runId);
      console.warn(
        `${LOG_PREFIX} closed stale run ${runId} (project ${run?.project_id ?? "unknown"}, ` +
          `age ${formatDurationMs(ageMs)})`
      );
    }
  }

  return { candidates: runs.length, reaped, error: null };
}

/**
 * Release the DB locks held by runs this process owns, on shutdown.
 *
 * Does NOT wait for the sync loop itself to finish, which can take minutes and would
 * blow the platform's kill window. Only the DB row has to be correct: in-flight upserts
 * are idempotent and the next sync resumes from the last watermark.
 */
export async function closeLocalSyncRunsForShutdown(
  client: SupabaseClient,
  options?: { reason?: string; timeoutMs?: number }
): Promise<{ closed: string[]; timedOut: boolean }> {
  const ids = listLocalSyncRunIds();
  if (ids.length === 0) return { closed: [], timedOut: false };

  const reason =
    options?.reason ??
    "Server shut down (deploy or restart) while this sync was running. Database lock " +
      "released; the next sync resumes from the last watermark.";
  const timeoutMs = options?.timeoutMs ?? 5000;

  const closed: string[] = [];
  const work = Promise.allSettled(
    ids.map(async (runId) => {
      // Ask the loop to stop first: if it is between API pages it will observe this
      // and write its own proper terminal status.
      requestSyncCancellation(runId);
      const { updated } = await markSyncRunFinishedIfStillRunning(client, runId, { error: reason });
      if (updated) closed.push(runId);
    })
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    work.then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);

  return { closed, timedOut };
}

let timer: ReturnType<typeof setInterval> | undefined;

/** Idempotent. Sweeps immediately, then on an interval. */
export function startSyncReaper(getClient: () => SupabaseClient | null): void {
  const config = getSyncReaperConfig();
  if (!config.enabled || timer) return;
  console.log(
    `${LOG_PREFIX} enabled: closing runs stuck over ${formatDurationMs(config.staleAfterMs)}, ` +
      `sweeping every ${formatDurationMs(config.sweepIntervalMs)}`
  );
  const sweep = async () => {
    const client = getClient();
    if (!client) return;
    try {
      await reapStaleSyncRuns(client);
    } catch (error) {
      console.error(`${LOG_PREFIX} sweep failed:`, error);
    }
  };
  void sweep();
  timer = setInterval(() => void sweep(), config.sweepIntervalMs);
  timer.unref?.();
}

export function stopSyncReaper(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
