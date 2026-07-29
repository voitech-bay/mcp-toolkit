import { getActiveSyncRun, getProjects, getSupabase } from "./supabase.js";
import { syncSupabaseFromSource } from "./sync-supabase.js";
import { reapStaleSyncRuns } from "./sync-reaper.js";

export interface ScheduledSyncConfig {
  enabled: boolean;
  timeZone: string;
  startHour: number;
  endHour: number;
}

export function getScheduledSyncConfig(env: NodeJS.ProcessEnv = process.env): ScheduledSyncConfig {
  const hour = (name: string, fallback: number) => {
    const parsed = Number.parseInt(env[name] ?? "", 10);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 23 ? parsed : fallback;
  };
  return {
    enabled: /^(1|true|yes)$/i.test(env.GETSALES_SCHEDULED_SYNC_ENABLED ?? ""),
    timeZone: env.GETSALES_SCHEDULED_SYNC_TIMEZONE?.trim() || "Europe/Lisbon",
    startHour: hour("GETSALES_SCHEDULED_SYNC_START_HOUR", 8),
    endHour: hour("GETSALES_SCHEDULED_SYNC_END_HOUR", 20),
  };
}

export function localHour(now: Date, timeZone: string): number {
  const value = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(now);
  return Number.parseInt(value, 10);
}

export function isInsideScheduledWindow(now: Date, config: ScheduledSyncConfig): boolean {
  const hour = localHour(now, config.timeZone);
  return hour >= config.startHour && hour <= config.endHour;
}

let running = false;
let timer: ReturnType<typeof setInterval> | undefined;

export type ScheduledSyncOutcome = "success" | "partial" | "skipped" | "cancelled" | "error";

/** Per-entity slice of a SyncResult; only the error matters for classification. */
interface EntityOutcome {
  error?: string | null;
}

/**
 * A cycle result is not simply ok/failed. In particular a lock conflict is a SKIP, not a
 * failure: another sync is already doing the work, so logging it as an error trains people
 * to ignore scheduler errors.
 */
// Takes `object` rather than SyncResult so it stays callable with minimal literals in
// tests: SyncResult has no index signature, and a narrower literal type would trip
// excess-property checks on the entity fields.
export function classifyScheduledSyncOutcome(result: object): ScheduledSyncOutcome {
  const { cancelled, error } = result as { cancelled?: boolean; error?: string | null };
  if (cancelled) return "cancelled";
  if (typeof error === "string" && error.startsWith("Sync already running")) {
    return "skipped";
  }
  if (error != null) return "error";
  const entityHasError = Object.values(result as Record<string, unknown>).some(
    (value) =>
      value != null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as EntityOutcome).error != null
  );
  return entityHasError ? "partial" : "success";
}

export interface CycleEntry {
  projectId: string;
  name: string;
  outcome: ScheduledSyncOutcome;
  durationMs: number;
}

export function summarizeScheduledSyncCycle(entries: CycleEntry[]): {
  total: number;
  success: number;
  partial: number;
  skipped: number;
  cancelled: number;
  error: number;
} {
  const summary = { total: entries.length, success: 0, partial: 0, skipped: 0, cancelled: 0, error: 0 };
  for (const entry of entries) summary[entry.outcome] += 1;
  return summary;
}

export async function runScheduledGetSalesSync(
  now = new Date(),
  config = getScheduledSyncConfig()
): Promise<void> {
  if (!config.enabled || !isInsideScheduledWindow(now, config) || running) return;
  running = true;
  const cycleStartedMs = Date.now();
  try {
    const client = getSupabase();
    if (!client) throw new Error("Supabase is not configured");

    // Clear any wedged lock before we try to take it, so a crashed earlier run cannot
    // cost us every subsequent cycle. Never let a reaper failure abort the cycle.
    let reaped = 0;
    try {
      const reap = await reapStaleSyncRuns(client);
      reaped = reap.reaped.length;
      if (reaped > 0) {
        console.log(`[scheduled-sync] reaped ${reaped} stale run(s): ${reap.reaped.join(", ")}`);
      }
    } catch (error) {
      console.error("[scheduled-sync] reaper failed:", error);
    }

    // One cycle-level lock check, so a held lock produces a single actionable line
    // instead of one confusing "Sync already running" error per project.
    const { data: activeRun } = await getActiveSyncRun(client);
    if (activeRun) {
      console.log(
        `[scheduled-sync] cycle skipped: lock held by run ${activeRun.id} ` +
          `(project ${activeRun.project_id ?? "unknown"}, started ${activeRun.started_at})`
      );
      return;
    }

    const projects = await getProjects(client);
    if (projects.error) throw new Error(projects.error);

    const entries: CycleEntry[] = [];
    for (const project of projects.data.filter((item) => item.api_key_set)) {
      const startedMs = Date.now();
      try {
        const result = await syncSupabaseFromSource(project.id);
        const outcome = classifyScheduledSyncOutcome(result);
        entries.push({
          projectId: project.id,
          name: project.name,
          outcome,
          durationMs: Date.now() - startedMs,
        });
        if (outcome === "error") console.error(`[scheduled-sync] ${project.name}: ${result.error}`);
        else if (outcome === "skipped") console.log(`[scheduled-sync] ${project.name}: skipped (busy)`);
      } catch (error) {
        entries.push({
          projectId: project.id,
          name: project.name,
          outcome: "error",
          durationMs: Date.now() - startedMs,
        });
        console.error(`[scheduled-sync] ${project.name}:`, error);
      }
    }

    console.log(
      "[scheduled-sync] cycle done",
      JSON.stringify({
        durationMs: Date.now() - cycleStartedMs,
        reaped,
        ...summarizeScheduledSyncCycle(entries),
        projects: entries,
      })
    );
  } finally {
    running = false;
  }
}

export function startScheduledGetSalesSync(): void {
  const config = getScheduledSyncConfig();
  if (!config.enabled || timer) return;
  console.log(`[scheduled-sync] enabled hourly ${config.startHour}:00-${config.endHour}:00 ${config.timeZone}`);
  void runScheduledGetSalesSync();
  timer = setInterval(() => void runScheduledGetSalesSync(), 60 * 60 * 1000);
  timer.unref?.();
}

export function stopScheduledGetSalesSync(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}
