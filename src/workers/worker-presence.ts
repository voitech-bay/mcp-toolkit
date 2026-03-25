/**
 * Shared presence state for long-running workers: local HTTP status + API heartbeats.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { WorkerTaskProgress } from "../services/worker-registry.js";

const presence: {
  status: "idle" | "busy" | "stopping";
  tasksInProgress: WorkerTaskProgress[];
} = {
  status: "idle",
  tasksInProgress: [],
};

export function markWorkerStopping(): void {
  presence.status = "stopping";
}

export async function withWorkerTaskPresence<T>(
  task: WorkerTaskProgress,
  fn: () => Promise<T>
): Promise<T> {
  presence.tasksInProgress.push(task);
  presence.status = "busy";
  try {
    return await fn();
  } finally {
    const id = task.taskId;
    presence.tasksInProgress = presence.tasksInProgress.filter((t) => t.taskId !== id);
    if (presence.tasksInProgress.length === 0 && presence.status === "busy") {
      presence.status = "idle";
    }
  }
}

export function getWorkerPresenceBody(
  workerId: string,
  name: string,
  kind: string
): Record<string, unknown> {
  return {
    workerId,
    name,
    kind,
    status: presence.status,
    tasksInProgress: presence.tasksInProgress.map((t) => ({ ...t })),
  };
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

async function postHeartbeat(
  apiBase: string,
  body: Record<string, unknown>,
  authorization?: string
): Promise<void> {
  const url = `${apiBase}/api/workers/heartbeat`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authorization) headers.Authorization = authorization;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`heartbeat ${res.status}: ${text || res.statusText}`);
  }
}

/**
 * Periodically POST presence to the main API. Call `stop()` on shutdown.
 */
export function startWorkerHeartbeatLoop(
  apiBaseUrl: string,
  workerId: string,
  name: string,
  kind: string,
  intervalMs: number
): { stop: () => void } {
  const base = normalizeApiBase(apiBaseUrl);
  const secret = process.env.WORKER_HEARTBEAT_SECRET?.trim();
  const authorization = secret ? `Bearer ${secret}` : undefined;

  let timer: ReturnType<typeof setInterval> | undefined;
  const tick = (): void => {
    const body = getWorkerPresenceBody(workerId, name, kind);
    void postHeartbeat(base, body, authorization).catch(() => {
      /* logged elsewhere if needed */
    });
  };
  tick();
  timer = setInterval(tick, Math.max(2000, intervalMs));

  return {
    stop: (): void => {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
