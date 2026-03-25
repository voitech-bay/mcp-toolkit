/**
 * Workers dropdown: merge Supabase `worker_presence` with this API process in-memory heartbeats.
 * `hasRuntime === false` means the worker is not connected to this server — drawer details unavailable.
 */
import { getSupabase } from "./supabase.js";
import { listRecentWorkerPresence } from "./worker-presence-db.js";
import { getActiveWorkers, type WorkerPublicEntry } from "./worker-registry.js";

export async function getWorkersUiSnapshot(): Promise<{ workers: WorkerPublicEntry[] }> {
  const memWorkers = getActiveWorkers().workers;
  const client = getSupabase();
  if (!client) {
    return {
      workers: memWorkers.map((w) => ({ ...w, hasRuntime: true })),
    };
  }

  const { rows, error } = await listRecentWorkerPresence(client, 7);
  if (error) {
    return {
      workers: memWorkers.map((w) => ({ ...w, hasRuntime: true })),
    };
  }

  const memById = new Map(memWorkers.map((w) => [w.workerId, w]));
  const dbById = new Map(rows.map((r) => [r.worker_id, r]));
  const ids = new Set<string>([...memById.keys(), ...dbById.keys()]);
  const merged: WorkerPublicEntry[] = [];

  for (const id of ids) {
    const m = memById.get(id);
    const d = dbById.get(id);
    if (m) {
      merged.push({ ...m, hasRuntime: true });
    } else if (d) {
      merged.push({
        workerId: d.worker_id,
        name: d.name,
        kind: d.kind,
        status: d.status as WorkerPublicEntry["status"],
        tasksInProgress: [],
        pendingBatches: [],
        lastSeenAt: d.last_seen_at,
        hasRuntime: false,
      });
    }
  }

  merged.sort((a, b) => a.name.localeCompare(b.name));
  return { workers: merged };
}
