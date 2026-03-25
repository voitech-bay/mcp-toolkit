/**
 * In-memory registry of worker heartbeats for the API process.
 * Workers POST periodically; entries older than TTL are omitted (and pruned on read).
 */

export type WorkerTaskProgress = {
  taskId: string;
  agentName: string;
  operationName?: string | null;
};

/** Tasks held in the worker batch accumulator (not yet executing). */
export type WorkerPendingBatchProgress = {
  agentName: string;
  count: number;
  batchSize: number;
  waitingSince: string;
};

export type WorkerHeartbeatPayload = {
  workerId: string;
  name: string;
  kind: string;
  status: "idle" | "busy" | "stopping";
  tasksInProgress?: WorkerTaskProgress[];
  pendingBatches?: WorkerPendingBatchProgress[];
  /** Flat tuning snapshot (e.g. ENRICHMENT_* env) from the worker process. */
  runtime?: Record<string, string | number>;
};

export type WorkerPublicEntry = {
  workerId: string;
  name: string;
  kind: string;
  status: "idle" | "busy" | "stopping";
  tasksInProgress: WorkerTaskProgress[];
  pendingBatches: WorkerPendingBatchProgress[];
  lastSeenAt: string;
  runtime?: Record<string, string | number>;
  /**
   * False when this row comes only from Supabase (worker heartbeats another API host).
   * Omitted/true when this process has live heartbeats — drawer can show runtime detail.
   */
  hasRuntime?: boolean;
};

const store = new Map<string, WorkerHeartbeatPayload & { lastSeenAt: number }>();

const changeListeners = new Set<() => void>();

export function onWorkerRegistryChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return (): void => {
    changeListeners.delete(listener);
  };
}

function emitWorkerRegistryChange(): void {
  for (const fn of changeListeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

function ttlMs(): number {
  const n = Number(process.env.WORKER_HEARTBEAT_TTL_MS ?? 45000);
  return Number.isFinite(n) && n > 0 ? n : 45000;
}

export function recordWorkerHeartbeat(payload: WorkerHeartbeatPayload): void {
  const now = Date.now();
  store.set(payload.workerId, {
    ...payload,
    tasksInProgress: payload.tasksInProgress ?? [],
    pendingBatches: payload.pendingBatches ?? [],
    runtime: payload.runtime,
    lastSeenAt: now,
  });
  emitWorkerRegistryChange();
}

/** Remove a worker immediately (e.g. WebSocket disconnected). */
export function removeWorker(workerId: string): void {
  if (store.delete(workerId)) {
    emitWorkerRegistryChange();
  }
}

function purgeStaleEntries(): boolean {
  const now = Date.now();
  const maxAge = ttlMs();
  let removed = false;
  for (const [id, row] of [...store.entries()]) {
    if (now - row.lastSeenAt > maxAge) {
      store.delete(id);
      removed = true;
    }
  }
  return removed;
}

/** Drop TTL-expired workers and notify subscribers (e.g. HTTP-only heartbeats that stopped). */
export function pruneStaleWorkersIfNeeded(): void {
  if (purgeStaleEntries()) {
    emitWorkerRegistryChange();
  }
}

export function getActiveWorkers(): { workers: WorkerPublicEntry[] } {
  purgeStaleEntries();
  const workers: WorkerPublicEntry[] = [];

  for (const [id, row] of store) {
    const entry: WorkerPublicEntry = {
      workerId: id,
      name: row.name,
      kind: row.kind,
      status: row.status,
      tasksInProgress: row.tasksInProgress ?? [],
      pendingBatches: row.pendingBatches ?? [],
      lastSeenAt: new Date(row.lastSeenAt).toISOString(),
      hasRuntime: true,
    };
    if (row.runtime && Object.keys(row.runtime).length > 0) {
      entry.runtime = { ...row.runtime };
    }
    workers.push(entry);
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
