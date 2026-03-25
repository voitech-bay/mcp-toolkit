/**
 * WebSocket endpoints for enrichment workers (push status) and UI clients (live worker list).
 */
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import {
  getActiveWorkers,
  onWorkerRegistryChange,
  pruneStaleWorkersIfNeeded,
  recordWorkerHeartbeat,
  removeWorker,
  type WorkerHeartbeatPayload,
  type WorkerPendingBatchProgress,
  type WorkerTaskProgress,
} from "./worker-registry.js";
import {
  deleteWorkerPresenceFromSupabase,
  persistWorkerPresenceToSupabase,
} from "./worker-presence-db.js";
import { getWorkersUiSnapshot } from "./worker-ui-snapshot.js";

setInterval(() => {
  pruneStaleWorkersIfNeeded();
}, 15000);

const uiSubscribers = new Set<WebSocket>();

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function workerWsAuthOk(url: URL): boolean {
  const secret = process.env.WORKER_HEARTBEAT_SECRET?.trim();
  if (!secret) return true;
  const token = url.searchParams.get("token")?.trim() ?? "";
  return token === secret;
}

async function broadcastSnapshot(): Promise<void> {
  let payload: string;
  try {
    const snap = await getWorkersUiSnapshot();
    payload = JSON.stringify({ type: "workers", ...snap });
  } catch {
    payload = JSON.stringify({ type: "workers", ...getActiveWorkers() });
  }
  for (const ws of uiSubscribers) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

onWorkerRegistryChange(() => {
  void broadcastSnapshot();
});

/** Optional: call after DB persistence if you need to push merged list without touching in-memory registry. */
export async function broadcastWorkersUiSnapshot(): Promise<void> {
  await broadcastSnapshot();
}

function parseTasks(raw: unknown): WorkerTaskProgress[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: WorkerTaskProgress[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const taskId = parseString(item.taskId);
    const agentName = parseString(item.agentName);
    if (!taskId || !agentName) continue;
    const operationName =
      item.operationName === null || item.operationName === undefined
        ? undefined
        : typeof item.operationName === "string"
          ? item.operationName
          : String(item.operationName);
    out.push({ taskId, agentName, operationName });
  }
  return out;
}

function parsePendingBatches(raw: unknown): WorkerPendingBatchProgress[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: WorkerPendingBatchProgress[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const agentName = parseString(item.agentName);
    const count = typeof item.count === "number" && Number.isFinite(item.count) ? item.count : 0;
    const batchSize =
      typeof item.batchSize === "number" && Number.isFinite(item.batchSize) ? item.batchSize : 1;
    const waitingSince =
      typeof item.waitingSince === "string" && item.waitingSince.trim()
        ? item.waitingSince.trim()
        : "";
    if (!agentName || !waitingSince) continue;
    out.push({
      agentName,
      count: Math.max(0, Math.floor(count)),
      batchSize: Math.max(1, Math.floor(batchSize)),
      waitingSince,
    });
  }
  return out.length ? out : undefined;
}

function parseRuntime(raw: unknown): Record<string, string | number> | undefined {
  if (!isRecord(raw)) return undefined;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.length > 80) continue;
    if (typeof v === "string" || typeof v === "number") {
      if (typeof v === "number" && !Number.isFinite(v)) continue;
      out[k] = v;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function applyPayload(msg: Record<string, unknown>): WorkerHeartbeatPayload | null {
  const workerId = parseString(msg.workerId);
  const name = parseString(msg.name);
  const kind = parseString(msg.kind) ?? "unknown";
  const statusRaw = parseString(msg.status);
  if (!workerId || !name) return null;
  const status =
    statusRaw === "idle" || statusRaw === "busy" || statusRaw === "stopping" ? statusRaw : "idle";
  const tasksInProgress = parseTasks(msg.tasksInProgress);
  const pendingBatches = parsePendingBatches(msg.pendingBatches);
  const runtime = parseRuntime(msg.runtime);
  return {
    workerId,
    name,
    kind,
    status,
    tasksInProgress,
    pendingBatches,
    runtime,
  };
}

/**
 * Worker process connects with `role` omitted or `role=worker`; optional `?token=` if WORKER_HEARTBEAT_SECRET is set.
 * Messages: `{ type: "hello", ... }` then `{ type: "status", workerId, status, tasksInProgress?, pendingBatches? }`.
 */
export function attachWorkerPresenceSocket(ws: WebSocket, req: IncomingMessage): void {
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url ?? "", `http://${host}`);
  if (!workerWsAuthOk(url)) {
    ws.close(4001);
    return;
  }

  let boundWorkerId: string | null = null;

  const onMessage = (raw: WebSocket.RawData): void => {
    let msg: unknown;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!isRecord(msg)) return;
    const type = parseString(msg.type);
    if (type === "hello") {
      const payload = applyPayload(msg);
      if (!payload) return;
      boundWorkerId = payload.workerId;
      void (async (): Promise<void> => {
        await persistWorkerPresenceToSupabase(payload);
        recordWorkerHeartbeat(payload);
      })();
      return;
    }
    if (type === "status") {
      if (!boundWorkerId) return;
      const workerId = parseString(msg.workerId) ?? boundWorkerId;
      if (workerId !== boundWorkerId) return;
      const payload = applyPayload({ ...msg, workerId: boundWorkerId });
      if (payload) {
        void (async (): Promise<void> => {
          await persistWorkerPresenceToSupabase(payload);
          recordWorkerHeartbeat(payload);
        })();
      }
    }
  };

  ws.on("message", onMessage);
  ws.on("close", () => {
    if (boundWorkerId) {
      removeWorker(boundWorkerId);
      void deleteWorkerPresenceFromSupabase(boundWorkerId);
    }
  });
  ws.on("error", () => {
    if (boundWorkerId) {
      removeWorker(boundWorkerId);
      void deleteWorkerPresenceFromSupabase(boundWorkerId);
    }
  });
}

/** Browser UI: `?role=subscribe` — receives `{ type: "workers", workers: [...] }` on connect and whenever the registry changes. */
export function attachWorkerListSubscriberSocket(ws: WebSocket): void {
  uiSubscribers.add(ws);
  void (async (): Promise<void> => {
    try {
      const snap = await getWorkersUiSnapshot();
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "workers", ...snap }));
      }
    } catch {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "workers", ...getActiveWorkers() }));
      }
    }
  })();
  ws.on("close", () => {
    uiSubscribers.delete(ws);
  });
  ws.on("error", () => {
    uiSubscribers.delete(ws);
  });
}
