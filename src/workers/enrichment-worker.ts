/**
 * Long-running enrichment queue consumer.
 * Run: `npm run dev:enrichment-worker` (or `npm run start:enrichment-worker` after `npm run build:backend`).
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see `.env.worker.example`).
 */
import "dotenv/config";
import { hostname } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  ENRICHMENT_AGENT_RESULTS_TABLE,
  ENRICHMENT_AGENT_RUNS_TABLE,
  ENRICHMENT_QUEUE_TASKS_TABLE,
  type EnrichmentQueueTaskRow,
} from "../services/supabase.js";
import {
  markWorkerStopping,
  startWorkerHeartbeatLoop,
  startWorkerPresenceHttpServer,
  withWorkerTaskPresence,
} from "./worker-presence.js";

/** Set before logging; identifies this process in logs and DB payloads. */
let activeWorkerName = "";

/**
 * Human-friendly id for this process. Set `ENRICHMENT_WORKER_NAME` per replica/host
 * (e.g. `enrichment-prod-1`). If unset, defaults to `enrichment-worker-<hostname>-<pid>`.
 */
export function getEnrichmentWorkerName(): string {
  const raw = process.env.ENRICHMENT_WORKER_NAME?.trim();
  if (raw) return raw;
  return `enrichment-worker-${hostname()}-${process.pid}`;
}

/** Stable id for heartbeats; defaults to {@link getEnrichmentWorkerName} if unset. */
export function getEnrichmentWorkerId(): string {
  const raw = process.env.ENRICHMENT_WORKER_ID?.trim();
  if (raw) return raw;
  return getEnrichmentWorkerName();
}

function ensureWorkerName(): string {
  if (!activeWorkerName) activeWorkerName = getEnrichmentWorkerName();
  return activeWorkerName;
}

/** Remote DB may not have migration `20260326120000_enrichment_worker_attribution.sql` yet. */
function isLegacyClaimRpcError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("could not find the function") ||
    (m.includes("claim_enrichment_tasks") && m.includes("p_worker_name"))
  );
}

function isSchemaCacheMissingColumn(message: string, column: string): boolean {
  return message.includes(column) && message.includes("schema cache");
}

let loggedLegacyClaimRpc = false;
let loggedLegacyRequeue = false;

function log(level: "info" | "error", message: string, extra?: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  const w = ensureWorkerName();
  const payload = extra ? ` ${JSON.stringify(extra)}` : "";
  if (level === "error") {
    console.error(`[${w} ${ts}] ${message}${payload}`);
  } else {
    console.log(`[${w} ${ts}] ${message}${payload}`);
  }
}

function parsePositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function getWorkerEnv(): {
  workerName: string;
  maxParallel: number;
  claimLimit: number;
  pollIntervalMs: number;
  lockMinutes: number;
} {
  return {
    workerName: ensureWorkerName(),
    maxParallel: Math.max(1, parsePositiveInt("ENRICHMENT_MAX_PARALLEL", 5)),
    claimLimit: Math.max(1, parsePositiveInt("ENRICHMENT_CLAIM_LIMIT", 10)),
    pollIntervalMs: Math.max(0, parsePositiveInt("ENRICHMENT_POLL_INTERVAL_MS", 2000)),
    lockMinutes: Math.max(0, parsePositiveInt("ENRICHMENT_LOCK_MINUTES", 15)),
  };
}

export function createEnrichmentWorkerClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the enrichment worker."
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Reset tasks stuck in `running` with an expired lock so they can be claimed again.
 */
export async function requeueStuckEnrichmentTasks(
  client: SupabaseClient,
  nowIso: string
): Promise<{ error: string | null }> {
  const base = {
    status: "queued" as const,
    locked_until: null,
    updated_at: nowIso,
    enrichment_agent_run_id: null,
  };
  let { error } = await client
    .from(ENRICHMENT_QUEUE_TASKS_TABLE)
    .update({
      ...base,
      claimed_by: null,
    })
    .eq("status", "running")
    .lt("locked_until", nowIso);
  if (error && isSchemaCacheMissingColumn(error.message, "claimed_by")) {
    if (!loggedLegacyRequeue) {
      log("info", "requeue without claimed_by (apply migration for worker attribution)", {});
      loggedLegacyRequeue = true;
    }
    const r2 = await client
      .from(ENRICHMENT_QUEUE_TASKS_TABLE)
      .update(base)
      .eq("status", "running")
      .lt("locked_until", nowIso);
    error = r2.error;
  }
  return { error: error?.message ?? null };
}

export async function claimEnrichmentTasks(
  client: SupabaseClient,
  limit: number,
  nowIso: string,
  lockMinutes: number,
  workerName: string
): Promise<{ tasks: EnrichmentQueueTaskRow[]; error: string | null }> {
  const v4 = await client.rpc("claim_enrichment_tasks", {
    p_limit: limit,
    p_now: nowIso,
    p_lock_minutes: lockMinutes,
    p_worker_name: workerName,
  });
  if (!v4.error) {
    return { tasks: (v4.data ?? []) as EnrichmentQueueTaskRow[], error: null };
  }
  if (isLegacyClaimRpcError(v4.error.message)) {
    if (!loggedLegacyClaimRpc) {
      log("info", "using legacy claim_enrichment_tasks (3-arg); apply migration for worker name on claim", {});
      loggedLegacyClaimRpc = true;
    }
    const legacy = await client.rpc("claim_enrichment_tasks", {
      p_limit: limit,
      p_now: nowIso,
      p_lock_minutes: lockMinutes,
    });
    if (legacy.error) return { tasks: [], error: legacy.error.message };
    return { tasks: (legacy.data ?? []) as EnrichmentQueueTaskRow[], error: null };
  }
  return { tasks: [], error: v4.error.message };
}

/**
 * Write latest result for (project, agent, entity). Avoids `.upsert(..., onConflict)` because
 * partial unique indexes are not always valid ON CONFLICT targets for PostgREST, and some DBs
 * may lack those indexes until migrations are applied.
 */
async function upsertPlaceholderResult(
  client: SupabaseClient,
  task: EnrichmentQueueTaskRow,
  runId: string,
  nowIso: string,
  workerName: string
): Promise<{ error: string | null }> {
  const agent_result = {
    stub: true,
    message: "Placeholder enrichment output (worker stub)",
    worker_name: workerName,
    queue_task_id: task.id,
    run_id: runId,
  };

  if (task.company_id) {
    const { data: existing, error: selErr } = await client
      .from(ENRICHMENT_AGENT_RESULTS_TABLE)
      .select("id")
      .eq("project_id", task.project_id)
      .eq("agent_name", task.agent_name)
      .eq("company_id", task.company_id)
      .maybeSingle();
    if (selErr) return { error: selErr.message };

    const row = {
      project_id: task.project_id,
      agent_name: task.agent_name,
      company_id: task.company_id,
      contact_id: null,
      agent_result,
      updated_at: nowIso,
    };

    if (existing?.id) {
      const { error } = await client
        .from(ENRICHMENT_AGENT_RESULTS_TABLE)
        .update({ agent_result, updated_at: nowIso })
        .eq("id", existing.id);
      return { error: error?.message ?? null };
    }
    const { error } = await client.from(ENRICHMENT_AGENT_RESULTS_TABLE).insert(row);
    return { error: error?.message ?? null };
  }

  if (task.contact_id) {
    const { data: existing, error: selErr } = await client
      .from(ENRICHMENT_AGENT_RESULTS_TABLE)
      .select("id")
      .eq("project_id", task.project_id)
      .eq("agent_name", task.agent_name)
      .eq("contact_id", task.contact_id)
      .maybeSingle();
    if (selErr) return { error: selErr.message };

    const row = {
      project_id: task.project_id,
      agent_name: task.agent_name,
      company_id: null,
      contact_id: task.contact_id,
      agent_result,
      updated_at: nowIso,
    };

    if (existing?.id) {
      const { error } = await client
        .from(ENRICHMENT_AGENT_RESULTS_TABLE)
        .update({ agent_result, updated_at: nowIso })
        .eq("id", existing.id);
      return { error: error?.message ?? null };
    }
    const { error } = await client.from(ENRICHMENT_AGENT_RESULTS_TABLE).insert(row);
    return { error: error?.message ?? null };
  }

  return { error: "Task has neither company_id nor contact_id" };
}

async function processClaimedTask(
  client: SupabaseClient,
  task: EnrichmentQueueTaskRow,
  workerName: string
): Promise<void> {
  const nowIso = new Date().toISOString();

  if (!task.company_id && !task.contact_id) {
    const msg = "Invalid task: missing company_id and contact_id";
    log("error", msg, { taskId: task.id, agent: task.agent_name });
    await client
      .from(ENRICHMENT_QUEUE_TASKS_TABLE)
      .update({
        status: "error",
        last_error: msg,
        updated_at: nowIso,
      })
      .eq("id", task.id);
    return;
  }

  const { data: freshTask } = await client
    .from(ENRICHMENT_QUEUE_TASKS_TABLE)
    .select("status")
    .eq("id", task.id)
    .maybeSingle();
  if (freshTask && (freshTask as { status: string }).status === "cancelled") {
    log("info", "task cancelled before run", { taskId: task.id, worker: workerName });
    return;
  }

  const runInsert: Record<string, unknown> = {
    queue_task_id: task.id,
    project_id: task.project_id,
    agent_name: task.agent_name,
    operation_name: task.operation_name,
    company_id: task.company_id,
    contact_id: task.contact_id,
    status: "running",
    meta: {
      worker_name: workerName,
      queue_task_id: task.id,
    },
    input: {
      worker_name: workerName,
      meta: task.meta ?? {},
      queue_task_id: task.id,
    },
    started_at: nowIso,
  };

  let { data: runRow, error: runErr } = await client
    .from(ENRICHMENT_AGENT_RUNS_TABLE)
    .insert(runInsert)
    .select("id")
    .single();

  if (runErr && isSchemaCacheMissingColumn(runErr.message, "meta")) {
    const { meta: _omit, ...withoutMeta } = runInsert;
    void _omit;
    const retry = await client
      .from(ENRICHMENT_AGENT_RUNS_TABLE)
      .insert(withoutMeta)
      .select("id")
      .single();
    runRow = retry.data;
    runErr = retry.error;
  }

  if (runErr || !runRow?.id) {
    const msg = runErr?.message ?? "Failed to insert enrichment_agent_runs";
    log("error", "insert run failed", { taskId: task.id, error: msg, agent: task.agent_name, worker: workerName });
    await client
      .from(ENRICHMENT_QUEUE_TASKS_TABLE)
      .update({
        status: "error",
        last_error: msg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id);
    return;
  }

  const runId = runRow.id as string;

  const { error: linkErr } = await client
    .from(ENRICHMENT_QUEUE_TASKS_TABLE)
    .update({
      enrichment_agent_run_id: runId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", task.id);

  if (linkErr) {
    log("error", "link run to queue task failed", { taskId: task.id, error: linkErr.message });
    await client
      .from(ENRICHMENT_AGENT_RUNS_TABLE)
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        error: linkErr.message,
      })
      .eq("id", runId);
    await client
      .from(ENRICHMENT_QUEUE_TASKS_TABLE)
      .update({
        status: "error",
        last_error: linkErr.message,
        updated_at: new Date().toISOString(),
      })
      .eq("id", task.id);
    return;
  }

  const finishedIso = new Date().toISOString();
  const upsertRes = await upsertPlaceholderResult(client, task, runId, finishedIso, workerName);
  if (upsertRes.error) {
    log("error", "upsert enrichment_agent_results failed", {
      taskId: task.id,
      runId,
      error: upsertRes.error,
    });
    await client
      .from(ENRICHMENT_AGENT_RUNS_TABLE)
      .update({
        status: "error",
        finished_at: finishedIso,
        error: upsertRes.error,
      })
      .eq("id", runId);
    await client
      .from(ENRICHMENT_QUEUE_TASKS_TABLE)
      .update({
        status: "error",
        last_error: upsertRes.error,
        updated_at: finishedIso,
      })
      .eq("id", task.id);
    return;
  }

  await client
    .from(ENRICHMENT_AGENT_RUNS_TABLE)
    .update({
      status: "success",
      finished_at: finishedIso,
      error: null,
    })
    .eq("id", runId);

  await client
    .from(ENRICHMENT_QUEUE_TASKS_TABLE)
    .update({
      status: "done",
      last_error: null,
      updated_at: finishedIso,
    })
    .eq("id", task.id);

  log("info", "task completed", {
    taskId: task.id,
    runId,
    agent: task.agent_name,
    worker: workerName,
  });
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
  workerLabel: string
): Promise<void> {
  if (items.length === 0) return;
  const n = Math.min(Math.max(1, concurrency), items.length);
  let index = 0;
  async function poolWorker(): Promise<void> {
    for (;;) {
      const i = index++;
      if (i >= items.length) return;
      try {
        await fn(items[i]!);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        log("error", "task handler threw", { error: message, worker: workerLabel });
      }
    }
  }
  await Promise.all(Array.from({ length: n }, () => poolWorker()));
}

export async function runEnrichmentWorkerLoop(client: SupabaseClient, options?: {
  signal?: AbortSignal;
}): Promise<void> {
  const env = getWorkerEnv();
  log("info", "worker started", {
    worker: env.workerName,
    maxParallel: env.maxParallel,
    claimLimit: env.claimLimit,
    pollIntervalMs: env.pollIntervalMs,
    lockMinutes: env.lockMinutes,
  });

  const signal = options?.signal;

  for (;;) {
    if (signal?.aborted) break;

    const nowIso = new Date().toISOString();

    const requeue = await requeueStuckEnrichmentTasks(client, nowIso);
    if (requeue.error) {
      log("error", "requeue stuck tasks failed", { error: requeue.error, worker: env.workerName });
    }

    const claimed = await claimEnrichmentTasks(
      client,
      env.claimLimit,
      new Date().toISOString(),
      env.lockMinutes,
      env.workerName
    );
    if (claimed.error) {
      log("error", "claim failed", { error: claimed.error, worker: env.workerName });
      await sleep(env.pollIntervalMs, signal);
      continue;
    }

    if (claimed.tasks.length > 0) {
      log("info", "claimed tasks", { count: claimed.tasks.length, worker: env.workerName });
      await mapWithConcurrency(
        claimed.tasks,
        env.maxParallel,
        (task) =>
          withWorkerTaskPresence(
            {
              taskId: task.id,
              agentName: task.agent_name,
              operationName: task.operation_name,
            },
            () => processClaimedTask(client, task, env.workerName)
          ),
        env.workerName
      );
    }

    await sleep(env.pollIntervalMs, signal);
  }

  log("info", "worker stopped", { worker: env.workerName });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

async function main(): Promise<void> {
  activeWorkerName = getEnrichmentWorkerName();
  const workerId = getEnrichmentWorkerId();

  let client: SupabaseClient;
  try {
    client = createEnrichmentWorkerClient();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log("error", message);
    process.exit(1);
    return;
  }

  const apiBase =
    process.env.RAILWAY_PUBLIC_DOMAIN?.trim() || process.env.WORKER_API_BASE_URL?.trim() || process.env.ENRICHMENT_API_URL?.trim() || "";
  const heartbeatIntervalMs = Math.max(2000, parsePositiveInt("WORKER_HEARTBEAT_INTERVAL_MS", 10000));
  const httpPort = parsePositiveInt("ENRICHMENT_WORKER_HTTP_PORT", 0);

  let stopHeartbeat: (() => void) | undefined;
  let closePresenceHttp: (() => void) | undefined;

  if (httpPort > 0) {
    const { close } = startWorkerPresenceHttpServer(httpPort, workerId, activeWorkerName, "enrichment");
    closePresenceHttp = close;
    log("info", "worker status HTTP", { port: httpPort, worker: activeWorkerName });
  }

  if (apiBase) {
    const hb = startWorkerHeartbeatLoop(
      apiBase,
      workerId,
      activeWorkerName,
      "enrichment",
      heartbeatIntervalMs
    );
    stopHeartbeat = hb.stop;
    log("info", "API heartbeats enabled", { apiBase, intervalMs: heartbeatIntervalMs, worker: activeWorkerName });
  } else {
    log("info", "WORKER_API_BASE_URL / ENRICHMENT_API_URL not set; skipping API heartbeats", {});
  }

  const controller = new AbortController();
  const stop = (): void => {
    log("info", "shutdown signal received", { worker: activeWorkerName });
    markWorkerStopping();
    stopHeartbeat?.();
    closePresenceHttp?.();
    controller.abort();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  try {
    await runEnrichmentWorkerLoop(client, { signal: controller.signal });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log("error", "worker crashed", { error: message, worker: activeWorkerName });
    process.exit(1);
  }
}

const isMain =
  process.argv[1] != null &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  void main();
}
