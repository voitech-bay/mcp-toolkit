/**
 * In-memory registry of worker heartbeats for the API process.
 * Workers POST periodically; entries older than TTL are omitted (and pruned on read).
 */

export type WorkerTaskProgress = {
  taskId: string;
  agentName: string;
  operationName?: string | null;
};

export type WorkerHeartbeatPayload = {
  workerId: string;
  name: string;
  kind: string;
  status: "idle" | "busy" | "stopping";
  tasksInProgress?: WorkerTaskProgress[];
};

export type WorkerPublicEntry = {
  workerId: string;
  name: string;
  kind: string;
  status: "idle" | "busy" | "stopping";
  tasksInProgress: WorkerTaskProgress[];
  lastSeenAt: string;
};

const store = new Map<string, WorkerHeartbeatPayload & { lastSeenAt: number }>();

function ttlMs(): number {
  const n = Number(process.env.WORKER_HEARTBEAT_TTL_MS ?? 45000);
  return Number.isFinite(n) && n > 0 ? n : 45000;
}

export function recordWorkerHeartbeat(payload: WorkerHeartbeatPayload): void {
  const now = Date.now();
  store.set(payload.workerId, {
    ...payload,
    tasksInProgress: payload.tasksInProgress ?? [],
    lastSeenAt: now,
  });
}

export function getActiveWorkers(): { workers: WorkerPublicEntry[] } {
  const now = Date.now();
  const maxAge = ttlMs();
  const workers: WorkerPublicEntry[] = [];

  for (const [id, row] of store) {
    if (now - row.lastSeenAt > maxAge) {
      store.delete(id);
      continue;
    }
    workers.push({
      workerId: id,
      name: row.name,
      kind: row.kind,
      status: row.status,
      tasksInProgress: row.tasksInProgress ?? [],
      lastSeenAt: new Date(row.lastSeenAt).toISOString(),
    });
  }

  workers.sort((a, b) => a.name.localeCompare(b.name));
  return { workers };
}

export function isWorkerHeartbeatAuthOk(req: { headers: { authorization?: string } }): boolean {
  const secret = process.env.WORKER_HEARTBEAT_SECRET?.trim();
  if (!secret) return true;
  const auth = req.headers.authorization;
  return auth === `Bearer ${secret}`;
}
