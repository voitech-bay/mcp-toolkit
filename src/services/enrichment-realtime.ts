/**
 * Supabase Realtime → WebSocket fan-out for enrichment UI.
 * Subscribes to queue / runs / results / agents and notifies browsers per projectId.
 *
 * Node has no global `WebSocket`; Realtime must use the `ws` transport or it never
 * connects to Supabase (no postgres_changes events).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { WebSocketLikeConstructor } from "@supabase/realtime-js";
import WebSocket from "ws";
import type { RawData, WebSocket as WsClient } from "ws";
import {
  ENRICHMENT_AGENTS_TABLE,
  ENRICHMENT_AGENT_RESULTS_TABLE,
  ENRICHMENT_AGENT_RUNS_TABLE,
  ENRICHMENT_QUEUE_TASKS_TABLE,
  getEnrichmentTableData,
  getSupabase,
  listEnrichmentAgentsForEntityType,
  type EnrichmentEntityType,
} from "./supabase.js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;
/** True only after Realtime reports SUBSCRIBED (not merely after .subscribe() called). */
let channelReady = false;
let realtimeChannel: ReturnType<SupabaseClient["channel"]> | null = null;
/** Prevents synchronous re-entry: `removeChannel` can emit CLOSED while still inside the status callback. */
let channelStatusHandlerBusy = false;

const subscribersByProject = new Map<string, Set<WsClient>>();

/** Per-browser pagination + tab; client sends JSON after connect and when it changes. */
const wsTableParams = new WeakMap<
  WsClient,
  { entityType: EnrichmentEntityType; limit: number; offset: number }
>();

const DEFAULT_TABLE_PARAMS: { entityType: EnrichmentEntityType; limit: number; offset: number } = {
  entityType: "company",
  limit: 25,
  offset: 0,
};

const BROADCAST_DEBOUNCE_MS = 150;
const pendingBroadcast = new Map<string, ReturnType<typeof setTimeout>>();

function getClient(): SupabaseClient | null {
  if (!url || !key) return null;
  if (!client) {
    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: {
        transport: WebSocket as unknown as WebSocketLikeConstructor,
      },
    });
  }
  return client;
}

function projectIdFromRow(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const pid = (row as Record<string, unknown>).project_id;
  return typeof pid === "string" && pid.length > 0 ? pid : null;
}

function parseEntityType(raw: unknown): EnrichmentEntityType {
  return raw === "contact" ? "contact" : "company";
}

/**
 * Builds the same payload as GET /api/enrichment-table + /api/enrichment/agents and sends one message per socket.
 * No browser HTTP — data travels on this WebSocket only.
 */
async function pushEnrichmentDataForProject(projectId: string): Promise<void> {
  const set = subscribersByProject.get(projectId);
  if (!set?.size) return;
  const client = getSupabase();
  if (!client) return;

  let n = 0;
  for (const ws of set) {
    if (ws.readyState !== ws.OPEN) continue;
    const p = wsTableParams.get(ws) ?? DEFAULT_TABLE_PARAMS;
    const [tableResult, agentsResult] = await Promise.all([
      getEnrichmentTableData(client, projectId, p.entityType, p.limit, p.offset),
      listEnrichmentAgentsForEntityType(client, p.entityType),
    ]);
    const err = tableResult.error ?? agentsResult.error ?? null;
    try {
      ws.send(
        JSON.stringify({
          type: "enrichment_data",
          projectId,
          entityType: p.entityType,
          limit: p.limit,
          offset: p.offset,
          total: tableResult.total,
          agentNames: tableResult.agentNames,
          rows: tableResult.rows,
          agents: agentsResult.data,
          error: err,
        })
      );
      n++;
    } catch {
      /* ignore */
    }
  }
  if (n > 0) {
    console.log(
      `[enrichment-realtime] enrichment_data ${projectId.slice(0, 8)}… → ${n} browser socket(s)`
    );
  }
}

function scheduleBroadcast(projectId: string): void {
  const existing = pendingBroadcast.get(projectId);
  if (existing) clearTimeout(existing);
  pendingBroadcast.set(
    projectId,
    setTimeout(() => {
      pendingBroadcast.delete(projectId);
      void pushEnrichmentDataForProject(projectId);
    }, BROADCAST_DEBOUNCE_MS)
  );
}

function scheduleBroadcastAllSubscribedProjects(): void {
  for (const projectId of subscribersByProject.keys()) {
    scheduleBroadcast(projectId);
  }
}

function handleChange(payload: { new?: unknown; old?: unknown }): void {
  const row = payload.new ?? payload.old;
  const pid = projectIdFromRow(row);
  if (pid) {
    scheduleBroadcast(pid);
  }
}

function teardownRealtimeChannel(supabase: SupabaseClient): void {
  const ch = realtimeChannel;
  if (!ch) {
    channelReady = false;
    return;
  }
  realtimeChannel = null;
  channelReady = false;
  try {
    void supabase.removeChannel(ch);
  } catch {
    /* ignore */
  }
}

function formatRealtimeSubscribeErr(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function ensureRealtimeChannel(): void {
  const supabase = getClient();
  if (!supabase || channelReady) return;
  /** Avoid opening a second channel while the first `.subscribe()` is still in flight. */
  if (realtimeChannel) return;

  const ch = supabase.channel("enrichment-table-realtime");
  realtimeChannel = ch;
  const opts = { schema: "public" as const };
  ch.on(
    "postgres_changes",
    { event: "*", ...opts, table: ENRICHMENT_QUEUE_TASKS_TABLE },
    (p) => handleChange(p as { new?: unknown; old?: unknown })
  )
    .on(
      "postgres_changes",
      { event: "*", ...opts, table: ENRICHMENT_AGENT_RUNS_TABLE },
      (p) => handleChange(p as { new?: unknown; old?: unknown })
    )
    .on(
      "postgres_changes",
      { event: "*", ...opts, table: ENRICHMENT_AGENT_RESULTS_TABLE },
      (p) => handleChange(p as { new?: unknown; old?: unknown })
    )
    .on(
      "postgres_changes",
      { event: "*", ...opts, table: ENRICHMENT_AGENTS_TABLE },
      () => scheduleBroadcastAllSubscribedProjects()
    )
    .subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        channelReady = true;
        console.log("[enrichment-realtime] Realtime SUBSCRIBED (postgres_changes active)");
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        if (channelStatusHandlerBusy) {
          return;
        }
        channelStatusHandlerBusy = true;
        const errPart = formatRealtimeSubscribeErr(err);
        const line = `[enrichment-realtime] Realtime channel not ready: ${status}${
          errPart ? ` ${errPart}` : ""
        }`;
        try {
          console.error(line);
        } finally {
          setImmediate(() => {
            try {
              teardownRealtimeChannel(supabase);
            } finally {
              channelStatusHandlerBusy = false;
            }
          });
        }
        return;
      }
      console.log("[enrichment-realtime] Realtime status:", status);
    });
}

export function registerEnrichmentSubscriber(projectId: string, ws: WsClient): void {
  if (!getClient()) {
    try {
      ws.send(
        JSON.stringify({
          type: "error",
          message: "Supabase not configured; realtime unavailable",
        })
      );
    } catch {
      /* ignore */
    }
    return;
  }

  let set = subscribersByProject.get(projectId);
  if (!set) {
    set = new Set();
    subscribersByProject.set(projectId, set);
  }
  set.add(ws);
  ensureRealtimeChannel();

  try {
    ws.send(JSON.stringify({ type: "connected", projectId }));
  } catch {
    /* ignore */
  }
}

export function unregisterEnrichmentSubscriber(projectId: string, ws: WsClient): void {
  wsTableParams.delete(ws);
  const set = subscribersByProject.get(projectId);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) subscribersByProject.delete(projectId);
}

/** One WebSocket message so the table can flip all cells to “working” together (avoids top-to-bottom DB realtime). */
export type EnrichmentBatchStartedPayload = {
  type: "enrichment_batch_started";
  projectId: string;
  agentName: string;
  workerName?: string | null;
  items: Array<{ taskId: string; companyId: string | null; contactId: string | null }>;
};

export function broadcastEnrichmentBatchStarted(payload: Omit<EnrichmentBatchStartedPayload, "type">): void {
  const msg: EnrichmentBatchStartedPayload = { type: "enrichment_batch_started", ...payload };
  const raw = JSON.stringify(msg);
  const set = subscribersByProject.get(payload.projectId);
  if (!set?.size) return;
  let n = 0;
  for (const ws of set) {
    if (ws.readyState !== ws.OPEN) continue;
    try {
      ws.send(raw);
      n++;
    } catch {
      /* ignore */
    }
  }
  if (n > 0) {
    console.log(
      `[enrichment-realtime] enrichment_batch_started ${payload.projectId.slice(0, 8)}… ${payload.agentName} (${payload.items.length} tasks) → ${n} socket(s)`
    );
  }
}

export function attachEnrichmentTableSocket(ws: WsClient, projectId: string): void {
  registerEnrichmentSubscriber(projectId, ws);

  ws.on("message", (data: RawData) => {
    try {
      const raw = typeof data === "string" ? data : data.toString();
      const j = JSON.parse(raw) as {
        entityType?: unknown;
        limit?: unknown;
        offset?: unknown;
      };
      const entityType = parseEntityType(j.entityType);
      const limit = Math.min(Math.max(Number(j.limit) || DEFAULT_TABLE_PARAMS.limit, 1), 100);
      const offset = Math.max(Number(j.offset) || 0, 0);
      wsTableParams.set(ws, { entityType, limit, offset });
      void pushEnrichmentDataForProject(projectId);
    } catch {
      /* ignore invalid client messages */
    }
  });

  ws.on("close", () => unregisterEnrichmentSubscriber(projectId, ws));
  ws.on("error", () => unregisterEnrichmentSubscriber(projectId, ws));
}
