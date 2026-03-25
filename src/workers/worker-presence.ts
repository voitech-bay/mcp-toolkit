/**
 * Shared presence state for long-running workers: local HTTP status + WebSocket to API (realtime).
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import WebSocket from "ws";
import type {
  WorkerPendingBatchProgress,
  WorkerTaskProgress,
} from "../services/worker-registry.js";

const presence: {
  stopping: boolean;
  tasksInProgress: WorkerTaskProgress[];
  pendingBatches: WorkerPendingBatchProgress[];
  /** Serialized worker tuning (e.g. ENRICHMENT_* env) sent with each heartbeat. */
  runtime: Record<string, string | number>;
} = {
  stopping: false,
  tasksInProgress: [],
  pendingBatches: [],
  runtime: {},
};

/** Call from worker process startup (e.g. enrichment worker) to expose ENV in the UI. */
export function setWorkerRuntimeConfig(config: Record<string, string | number>): void {
  presence.runtime = { ...config };
}

function deriveStatus(): "idle" | "busy" | "stopping" {
  if (presence.stopping) return "stopping";
  if (presence.tasksInProgress.length > 0 || presence.pendingBatches.length > 0) return "busy";
  return "idle";
}

export function markWorkerStopping(): void {
  presence.stopping = true;
}

/** Updates batch-accumulator snapshot for heartbeats (tasks waiting to be executed as a batch). */
export function setWorkerPendingBatches(batches: WorkerPendingBatchProgress[]): void {
  presence.pendingBatches = batches.map((b) => ({ ...b }));
}

export async function withWorkerTaskPresence<T>(
  task: WorkerTaskProgress,
  fn: () => Promise<T>
): Promise<T> {
  presence.tasksInProgress.push(task);
  try {
    return await fn();
  } finally {
    const id = task.taskId;
    presence.tasksInProgress = presence.tasksInProgress.filter((t) => t.taskId !== id);
  }
}

export async function withWorkerTasksPresence<T>(
  tasks: WorkerTaskProgress[],
  fn: () => Promise<T>
): Promise<T> {
  for (const t of tasks) {
    presence.tasksInProgress.push(t);
  }
  try {
    return await fn();
  } finally {
    const ids = new Set(tasks.map((t) => t.taskId));
    presence.tasksInProgress = presence.tasksInProgress.filter((t) => !ids.has(t.taskId));
  }
}

export function getWorkerPresenceBody(
  workerId: string,
  name: string,
  kind: string
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    workerId,
    name,
    kind,
    status: deriveStatus(),
    tasksInProgress: presence.tasksInProgress.map((t) => ({ ...t })),
    pendingBatches: presence.pendingBatches.map((b) => ({ ...b })),
  };
  if (Object.keys(presence.runtime).length > 0) {
    body.runtime = { ...presence.runtime };
  }
  return body;
}

/**
 * Optional HTTP server on the worker host: GET /, /status, /health → JSON (same fields as heartbeat).
 */
export function startWorkerPresenceHttpServer(
  port: number,
  workerId: string,
  name: string,
  kind: string
): { close: () => void } {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = req.url?.split("?")[0] ?? "/";
    if (req.method !== "GET" || (path !== "/" && path !== "/status" && path !== "/health")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        ...getWorkerPresenceBody(workerId, name, kind),
      })
    );
  });
  server.listen(port, "0.0.0.0");
  return {
    close: (): void => {
      server.close();
    },
  };
}

function normalizeApiBase(raw: string): string {
  const t = raw.trim().replace(/\/$/, "");
  return t;
}

function toWorkerWsUrl(httpBase: string): string {
  const u = new URL(httpBase.includes("://") ? httpBase : `http://${httpBase}`);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.pathname = "/api/workers-ws";
  u.search = "";
  u.searchParams.set("role", "worker");
  const secret = process.env.WORKER_HEARTBEAT_SECRET?.trim();
  if (secret) u.searchParams.set("token", secret);
  return u.toString();
}

/**
 * WebSocket connection to the main API for realtime presence (replaces HTTP heartbeat).
 * Reconnects automatically. Call `stop()` on shutdown.
 */
export function startWorkerRealtimeConnection(
  apiBaseUrl: string,
  workerId: string,
  name: string,
  kind: string,
  intervalMs: number
): { stop: () => void } {
  const base = normalizeApiBase(apiBaseUrl);
  const wsUrl = toWorkerWsUrl(base);

  let socket: WebSocket | null = null;
  let tickTimer: ReturnType<typeof setInterval> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  function clearTimers(): void {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = undefined;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
  }

  function sendStatus(): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const body = getWorkerPresenceBody(workerId, name, kind);
    socket.send(JSON.stringify({ type: "status", ...body }));
  }

  function connect(): void {
    if (stopped) return;
    clearTimers();
    const ws = new WebSocket(wsUrl);
    socket = ws;

    ws.on("open", () => {
      if (stopped) {
        ws.close();
        return;
      }
      const hello = { type: "hello", ...getWorkerPresenceBody(workerId, name, kind) };
      ws.send(JSON.stringify(hello));
      sendStatus();
      tickTimer = setInterval(sendStatus, Math.max(2000, intervalMs));
    });

    ws.on("message", () => {
      /* server may send pings or acks; ignore */
    });

    ws.on("close", () => {
      socket = null;
      clearTimers();
      if (!stopped) {
        reconnectTimer = setTimeout(connect, 3000);
      }
    });

    ws.on("error", () => {
      ws.close();
    });
  }

  connect();

  return {
    stop: (): void => {
      stopped = true;
      clearTimers();
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
      socket = null;
    },
  };
}
