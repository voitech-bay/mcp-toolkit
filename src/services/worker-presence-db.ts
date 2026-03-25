/**
 * Persist minimal worker identity to Supabase so any dashboard (same project) can list workers
 * that heartbeated from other hosts (e.g. deployed worker while you use a local API).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "./supabase.js";
import type { WorkerHeartbeatPayload } from "./worker-registry.js";

export const WORKER_PRESENCE_TABLE = "worker_presence";

export type WorkerPresenceRow = {
  worker_id: string;
  name: string;
  kind: string;
  status: string;
  last_seen_at: string;
  updated_at: string;
};

export async function persistWorkerPresenceToSupabase(payload: WorkerHeartbeatPayload): Promise<void> {
  const client = getSupabase();
  if (!client) return;
  const now = new Date().toISOString();
  const { error } = await client.from(WORKER_PRESENCE_TABLE).upsert(
    {
      worker_id: payload.workerId,
      name: payload.name,
      kind: payload.kind,
      status: payload.status,
      last_seen_at: now,
      updated_at: now,
    },
    { onConflict: "worker_id" }
  );
  if (error) {
    console.error("[worker_presence] upsert failed:", error.message);
  }
}

/** Remove a worker row (e.g. process exit or presence WebSocket closed). */
export async function deleteWorkerPresenceFromSupabase(
  workerId: string,
  client?: SupabaseClient | null
): Promise<void> {
  const c = client ?? getSupabase();
  if (!c) return;
  const { error } = await c.from(WORKER_PRESENCE_TABLE).delete().eq("worker_id", workerId);
  if (error) {
    console.error("[worker_presence] delete failed:", error.message);
  }
}

export async function listRecentWorkerPresence(
  client: SupabaseClient,
  maxAgeDays = 7
): Promise<{ rows: WorkerPresenceRow[]; error: string | null }> {
  const cutoff = new Date(Date.now() - maxAgeDays * 864e5).toISOString();
  const { data, error } = await client
    .from(WORKER_PRESENCE_TABLE)
    .select("worker_id,name,kind,status,last_seen_at,updated_at")
    .gte("last_seen_at", cutoff)
    .order("name", { ascending: true });
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as WorkerPresenceRow[], error: null };
}
