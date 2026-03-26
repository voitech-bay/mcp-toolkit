/**
 * Long-running enrichment queue consumer.
 * Run: `npm run dev:enrichment-worker` (or `npm run start:enrichment-worker` after `npm run build:worker`).
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see `.env.worker.example`).
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { uniqueNamesGenerator, starWars } from "unique-names-generator";
import {
  CONTACTS_TABLE,
  ENRICHMENT_AGENT_BATCHES_TABLE,
  ENRICHMENT_AGENT_RESULTS_TABLE,
  ENRICHMENT_AGENT_RUNS_TABLE,
  ENRICHMENT_QUEUE_TASKS_TABLE,
  getEnrichmentAgentByName,
  getEnrichmentAgentResultsMapForEntity,
  getEnrichmentPromptSettingsEffective,
  type EnrichmentAgentRegistryRow,
  type EnrichmentQueueTaskRow,
} from "../services/supabase.js";
import {
  createLlmAdapter,
  type LlmAdapter,
} from "../services/llm-adapter.js";
import {
  resolvePromptForBatch,
  type EnrichmentEntityType,
} from "../services/prompt-resolver.js";
import { buildCompanyEntitiesForPrompt } from "../services/enrichment-entity-assembler.js";
import type { WorkerPendingBatchProgress } from "../services/worker-registry.js";
import {
  markWorkerStopping,
  setWorkerPendingBatches,
  setWorkerRuntimeConfig,
  startWorkerRealtimeConnection,
  startWorkerPresenceHttpServer,
  withWorkerTasksPresence,
} from "./worker-presence.js";
import { deleteWorkerPresenceFromSupabase } from "../services/worker-presence-db.js";

/** Set before logging; identifies this process in logs and DB payloads. */
let activeWorkerName = "";

/** Auto-generated name when `ENRICHMENT_WORKER_NAME` is unset — only one random draw per process. */
let cachedGeneratedWorkerName: string | null = null;

/** Auto-generated id when `ENRICHMENT_WORKER_ID` is unset — one UUID per process. */
let cachedGeneratedWorkerId: string | null = null;

/**
 * Human-friendly id for this process. Set `ENRICHMENT_WORKER_NAME` per replica/host
 * (e.g. `enrichment-prod-1`). If unset, a random readable name is generated once (see `unique-names-generator`).
 */
export function getEnrichmentWorkerName(): string {
  const raw = process.env.ENRICHMENT_WORKER_NAME?.trim();
  if (raw) return raw;
  if (!cachedGeneratedWorkerName) {
    cachedGeneratedWorkerName = `${uniqueNamesGenerator({
      dictionaries: [starWars],
      separator: " ",
      length: 1,
      style: "capital",
    })}`;
  }
  return cachedGeneratedWorkerName;
}

/** Stable id for heartbeats / registry (UUID). Set `ENRICHMENT_WORKER_ID` or a random UUID is generated once per process. */
export function getEnrichmentWorkerId(): string {
  const raw = process.env.ENRICHMENT_WORKER_ID?.trim();
  if (raw) return raw;
  if (!cachedGeneratedWorkerId) {
    cachedGeneratedWorkerId = randomUUID();
  }
  return cachedGeneratedWorkerId;
}

/**
 * Selects which `prompt_profiles` entry to merge in `enrichment_prompt_settings` for this process.
 * Set a different value per worker host/replica to vary prefix/suffix / companies config without redeploying.
 */
export function getEnrichmentSystemPromptType(): string {
  return process.env.ENRICHMENT_SYSTEM_PROMPT_TYPE?.trim() ?? "";
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

/** First set env wins; used so we can rename vars while keeping legacy aliases. */
function parsePositiveIntFirst(names: string[], fallback: number): number {
  for (const name of names) {
    const raw = process.env[name];
    if (raw == null || raw === "") continue;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return fallback;
}

/**
 * Partial-batch timing after the first task lands in an accumulator:
 * - **Default 30000**: wait this many ms, then flush whatever is queued (partial batch), **unless** the
 *   queue is exhausted for this tick (see multi-claim loop — stragglers flush without waiting).
 * - **0**: flush a partial batch **immediately** after each pick — so the first pick (e.g. 10 tasks) runs
 *   right away even if agent `batch_size` is 20. This is often mistaken for a bug.
 * - **-1** (or `full` / `never`): never time-based partials; still flush partials when the queue is
 *   exhausted for this tick so leftover rows are not stuck forever.
 */
function parseBatchWaitMs(): number {
  const raw = process.env.ENRICHMENT_BATCH_WAIT_MS;
  if (raw == null || raw === "") return 30000;
  const t = raw.trim().toLowerCase();
  if (t === "-1" || t === "full" || t === "never" || t === "no-partial") return -1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 30000;
  return n >= 0 ? n : -1;
}

/**
 * Worker scheduling (single process):
 *
 * - Every **pickIntervalMs**, we **claim** in a loop: up to **pickLimit** rows per RPC until the queue
 *   returns fewer than **pickLimit** rows (or empty). That fills batch accumulators past **pickLimit** when
 *   **batch_size** is larger (e.g. pick 10 + 10 before flushing 20).
 * - Tasks are grouped into in-memory **per-agent** lists. We flush **full** batches whenever
 *   `tasks.length >= batch_size`. **Partial** batches: after each tick, when `batchWaitMs` elapsed (timer), or
 *   when the DB returns no rows (empty claim) while the buffer still has tasks. If the **only** claim in a
 *   tick is a short page **and** we never saw a full page this tick (slow one-by-one enqueue), we **hold** the
 *   buffer until `batch_size`, timer, or empty queue — **not** immediate drain. After at least one full page in
 *   a tick, a short final page means bulk tail and we drain stragglers.
 * - At most **maxConcurrentAgentRuns** batch invocations run at the same time on this worker.
 *
 * Legacy env names still work: ENRICHMENT_MAX_PARALLEL, ENRICHMENT_CLAIM_LIMIT, ENRICHMENT_POLL_INTERVAL_MS.
 */
function getWorkerEnv(): {
  workerName: string;
  /** Max concurrent `processTaskBatch` calls (distinct agent runs) on this worker. */
  maxConcurrentAgentRuns: number;
  /** Max queue tasks to claim in one pick (fills batch accumulators). */
  pickLimit: number;
  /** Milliseconds between picks (claim + flush loop + sleep). */
  pickIntervalMs: number;
  lockMinutes: number;
  /** -1 = never partial; 0 = immediate partial; >0 = ms before partial flush. */
  batchWaitMs: number;
} {
  return {
    workerName: ensureWorkerName(),
    maxConcurrentAgentRuns: Math.max(
      1,
      parsePositiveIntFirst(["ENRICHMENT_MAX_CONCURRENT_AGENT_RUNS", "ENRICHMENT_MAX_PARALLEL"], 5)
    ),
    pickLimit: Math.max(
      1,
      parsePositiveIntFirst(["ENRICHMENT_PICK_LIMIT", "ENRICHMENT_CLAIM_LIMIT"], 10)
    ),
    pickIntervalMs: Math.max(
      0,
      parsePositiveIntFirst(["ENRICHMENT_PICK_INTERVAL_MS", "ENRICHMENT_POLL_INTERVAL_MS"], 2000)
    ),
    lockMinutes: Math.max(0, parsePositiveInt("ENRICHMENT_LOCK_MINUTES", 15)),
    batchWaitMs: parseBatchWaitMs(),
  };
}

const DEFAULT_CURSOR_API_BASE = "https://api.cursor.com";
const DEFAULT_CURSOR_POLL_MS = 5000;
const DEFAULT_CURSOR_TIMEOUT_MS = 300_000;

/**
 * Non-secret tuning + LLM adapter identity for heartbeats / worker drawer (in-memory only).
 * Never includes API keys; `cursorApiKeyConfigured` is yes/no.
 */
function buildEnrichmentRuntimeSnapshot(heartbeatIntervalMs: number): Record<string, string | number> {
  const e = getWorkerEnv();
  const rawAdapter = process.env.LLM_ADAPTER?.trim();
  const llmAdapter =
    rawAdapter && rawAdapter.length > 0 ? rawAdapter.toLowerCase() : "mock";

  const out: Record<string, string | number> = {
    workerName: e.workerName,
    maxConcurrentAgentRuns: e.maxConcurrentAgentRuns,
    pickLimit: e.pickLimit,
    pickIntervalMs: e.pickIntervalMs,
    lockMinutes: e.lockMinutes,
    batchWaitMs: e.batchWaitMs,
    heartbeatIntervalMs,
    llmAdapter,
    cursorApiKeyConfigured: process.env.CURSOR_API_KEY?.trim() ? "yes" : "no",
  };

  const repo = process.env.CURSOR_AGENT_REPO_URL?.trim() ?? "";
  const ref = process.env.CURSOR_AGENT_REF?.trim() || "main";
  const apiBase = (
    process.env.CURSOR_API_BASE_URL?.trim() || DEFAULT_CURSOR_API_BASE
  ).replace(/\/+$/, "");
  const pollRaw = Number.parseInt(process.env.CURSOR_AGENT_POLL_INTERVAL_MS ?? "", 10);
  const timeoutRaw = Number.parseInt(process.env.CURSOR_AGENT_TIMEOUT_MS ?? "", 10);
  const pollMs =
    Number.isFinite(pollRaw) && pollRaw >= 100 ? pollRaw : DEFAULT_CURSOR_POLL_MS;
  const timeoutMs =
    Number.isFinite(timeoutRaw) && timeoutRaw >= 1000
      ? timeoutRaw
      : DEFAULT_CURSOR_TIMEOUT_MS;

  out.cursorAgentRepoUrl = repo || "(not set)";
  out.cursorAgentRef = ref;
  out.cursorApiBaseUrl = apiBase;
  out.cursorPollIntervalMs = pollMs;
  out.cursorTimeoutMs = timeoutMs;

  return out;
}

function resolveAgentConfig(row: EnrichmentAgentRegistryRow | null): {
  prompt: string;
  batch_size: number;
} {
  if (!row) return { prompt: "", batch_size: 1 };
  const bs = Math.max(1, Number(row.batch_size) || 1);
  return { prompt: typeof row.prompt === "string" ? row.prompt : "", batch_size: bs };
}

type PendingAccumulator = {
  tasks: EnrichmentQueueTaskRow[];
  agent: { prompt: string; batch_size: number };
  firstClaimedAt: number;
};

function snapshotPendingBatches(
  pending: Map<string, PendingAccumulator>
): WorkerPendingBatchProgress[] {
  const out: WorkerPendingBatchProgress[] = [];
  for (const [agentName, acc] of pending.entries()) {
    out.push({
      agentName,
      count: acc.tasks.length,
      batchSize: Math.max(1, acc.agent.batch_size),
      waitingSince: new Date(acc.firstClaimedAt).toISOString(),
    });
  }
  return out.sort((a, b) => a.agentName.localeCompare(b.agentName));
}

/** Compact view for worker logs (multi-claim / flush debugging). */
function pendingQueuesDebug(
  pending: Map<string, PendingAccumulator>
): Array<{ agent: string; queued: number; batchSize: number }> {
  return [...pending.entries()]
    .map(([agent, acc]) => ({
      agent,
      queued: acc.tasks.length,
      batchSize: Math.max(1, acc.agent.batch_size),
    }))
    .sort((a, b) => a.agent.localeCompare(b.agent));
}

/**
 * Remove ready batches from the pending map.
 * - Full batch when `tasks.length >= batch_size` (unless `fullOnly` is set and we'd only take partial — then skip).
 * - Partial when `fullOnly` is false and either the batch-wait timer fired, or `queueExhausted` (no more rows
 *   available this tick after multi-claim), so stragglers flush without waiting 30s when the queue is drained.
 */
function takeReadyBatches(
  pending: Map<string, PendingAccumulator>,
  batchWaitMs: number,
  now: number,
  opts?: { queueExhausted?: boolean; fullOnly?: boolean }
): Array<{
  tasks: EnrichmentQueueTaskRow[];
  agent: { prompt: string; batch_size: number };
}> {
  const queueExhausted = opts?.queueExhausted ?? false;
  const fullOnly = opts?.fullOnly ?? false;
  const flushes: Array<{
    tasks: EnrichmentQueueTaskRow[];
    agent: { prompt: string; batch_size: number };
  }> = [];
  for (const [agentName, acc] of [...pending.entries()]) {
    const bs = Math.max(1, acc.agent.batch_size);
    let take = 0;
    let flushReason: "full" | "partial_timer" | "partial_queue_exhausted" | null = null;
    if (acc.tasks.length >= bs) {
      take = bs;
      flushReason = "full";
    } else if (!fullOnly) {
      if (
        batchWaitMs >= 0 &&
        acc.tasks.length > 0 &&
        now - acc.firstClaimedAt >= batchWaitMs
      ) {
        take = acc.tasks.length;
        flushReason = "partial_timer";
      } else if (queueExhausted && acc.tasks.length > 0) {
        take = acc.tasks.length;
        flushReason = "partial_queue_exhausted";
      }
    }
    if (take === 0) continue;
    log("info", "takeReadyBatches: flush", {
      agent: agentName,
      take,
      batchSize: bs,
      reason: flushReason,
      fullOnly,
      queueExhausted,
      batchWaitMs,
      msSinceFirstInBuffer: now - acc.firstClaimedAt,
      remainingAfter: acc.tasks.length - take,
    });
    const slice = acc.tasks.splice(0, take);
    if (acc.tasks.length === 0) {
      pending.delete(agentName);
    }
    flushes.push({ tasks: slice, agent: acc.agent });
  }
  return flushes;
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
 * Ensure queue rows show which worker claimed them: `claimed_by` + `meta.worker_name`.
 * Legacy `claim_enrichment_tasks` (without `p_worker_name`) leaves `claimed_by` null; the RPC
 * may also omit attribution depending on migration state.
 */
async function affirmQueueWorkerAttribution(
  client: SupabaseClient,
  tasks: EnrichmentQueueTaskRow[],
  workerName: string
): Promise<void> {
  if (tasks.length === 0) return;

  const mergedMeta = (task: EnrichmentQueueTaskRow) => {
    const prev =
      task.meta && typeof task.meta === "object" && !Array.isArray(task.meta)
        ? { ...(task.meta as Record<string, unknown>) }
        : {};
    return { ...prev, worker_name: workerName };
  };

  const patchBoth = (task: EnrichmentQueueTaskRow) =>
    client
      .from(ENRICHMENT_QUEUE_TASKS_TABLE)
      .update({
        claimed_by: workerName,
        meta: mergedMeta(task),
      })
      .eq("id", task.id);

  const first = await Promise.all(tasks.map((t) => patchBoth(t)));
  let err = first.find((r) => r.error)?.error;

  if (err && isSchemaCacheMissingColumn(err.message, "claimed_by")) {
    const second = await Promise.all(
      tasks.map((task) =>
        client
          .from(ENRICHMENT_QUEUE_TASKS_TABLE)
          .update({ meta: mergedMeta(task) })
          .eq("id", task.id)
      )
    );
    err = second.find((r) => r.error)?.error;
  } else if (err && isSchemaCacheMissingColumn(err.message, "meta")) {
    const second = await Promise.all(
      tasks.map((task) =>
        client
          .from(ENRICHMENT_QUEUE_TASKS_TABLE)
          .update({ claimed_by: workerName })
          .eq("id", task.id)
      )
    );
    err = second.find((r) => r.error)?.error;
  }

  if (err) {
    log("error", "affirmQueueWorkerAttribution failed", { error: err.message, worker: workerName });
  }
}

/**
 * Write latest result for (project, agent, entity). Avoids `.upsert(..., onConflict)` because
 * partial unique indexes are not always valid ON CONFLICT targets for PostgREST, and some DBs
 * may lack those indexes until migrations are applied.
 */
async function upsertEnrichmentAgentResult(
  client: SupabaseClient,
  task: EnrichmentQueueTaskRow,
  runId: string,
  nowIso: string,
  workerName: string,
  agentResult: Record<string, unknown>
): Promise<{ error: string | null }> {
  const agent_result = {
    ...agentResult,
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

function parseEntityTypeForPrompt(raw: string | undefined): EnrichmentEntityType {
  if (raw === "company" || raw === "contact" || raw === "both") return raw;
  return "both";
}

/** Latest `agent_result` per agent name for `{{agent:Name.key}}` (reference entity = first in batch). */
async function fetchAgentResultsForReferenceEntity(
  client: SupabaseClient,
  projectId: string,
  rowKind: "company" | "contact",
  entityId: string
): Promise<Record<string, unknown>> {
  const { data, error } = await getEnrichmentAgentResultsMapForEntity(
    client,
    projectId,
    rowKind,
    entityId
  );
  if (error) return {};
  return data;
}

/** One batch’s prompt + entity lists; written to each run’s `input` for auditing / “prompt to start”. */
type EnrichmentRunStartContext = {
  agentPrompt: string;
  batchCompanyIds: string[];
  batchContactIds: string[];
  batchQueueTaskIds: string[];
};

const PROMPT_SETTINGS_TTL_MS = 45_000;
const promptSettingsCache = new Map<
  string,
  {
    at: number;
    settings: Awaited<ReturnType<typeof getEnrichmentPromptSettingsEffective>>;
  }
>();

async function getCachedEnrichmentPromptSettings(
  client: SupabaseClient,
  projectId: string
) {
  const now = Date.now();
  const profileKey = getEnrichmentSystemPromptType();
  const cacheKey = `${projectId}::${profileKey}`;
  const hit = promptSettingsCache.get(cacheKey);
  if (hit && now - hit.at < PROMPT_SETTINGS_TTL_MS) {
    return hit.settings;
  }
  const settings = await getEnrichmentPromptSettingsEffective(
    client,
    projectId,
    profileKey || undefined
  );
  promptSettingsCache.set(cacheKey, { at: now, settings });
  return settings;
}

async function updateEnrichmentBatchLlmTrace(
  client: SupabaseClient,
  batchId: string,
  patch: {
    llm_adapter: string;
    external_agent_id?: string | null;
    meta?: Record<string, unknown>;
  }
): Promise<void> {
  const { error } = await client
    .from(ENRICHMENT_AGENT_BATCHES_TABLE)
    .update({
      llm_adapter: patch.llm_adapter,
      external_agent_id: patch.external_agent_id ?? null,
      meta: patch.meta ?? {},
      updated_at: new Date().toISOString(),
    })
    .eq("id", batchId);
  if (error) {
    log("info", "update enrichment_agent_batches llm trace failed", {
      batchId,
      error: error.message,
    });
  }
}

async function insertEnrichmentBatchRow(
  client: SupabaseClient,
  projectId: string,
  agentName: string,
  workerName: string
): Promise<{ batchId: string } | { error: string }> {
  const { data, error } = await client
    .from(ENRICHMENT_AGENT_BATCHES_TABLE)
    .insert({
      project_id: projectId,
      agent_name: agentName,
      worker_name: workerName,
    })
    .select("id")
    .single();

  if (error || !data || typeof (data as { id?: unknown }).id !== "string") {
    return { error: error?.message ?? "Failed to insert enrichment_agent_batches" };
  }
  return { batchId: (data as { id: string }).id };
}

async function insertRunAndLinkTask(
  client: SupabaseClient,
  task: EnrichmentQueueTaskRow,
  workerName: string,
  nowIso: string,
  startContext: EnrichmentRunStartContext,
  batchId: string | null
): Promise<{ runId: string } | { error: string }> {
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
      agent_prompt: startContext.agentPrompt,
      batch_company_ids: startContext.batchCompanyIds,
      batch_contact_ids: startContext.batchContactIds,
      batch_queue_task_ids: startContext.batchQueueTaskIds,
    },
    started_at: nowIso,
  };
  if (batchId) {
    runInsert.batch_id = batchId;
  }

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

  if (runErr && isSchemaCacheMissingColumn(runErr.message, "batch_id")) {
    const { batch_id: _omitBatch, ...withoutBatch } = runInsert;
    void _omitBatch;
    let retry = await client
      .from(ENRICHMENT_AGENT_RUNS_TABLE)
      .insert(withoutBatch)
      .select("id")
      .single();
    if (retry.error && isSchemaCacheMissingColumn(retry.error.message, "meta")) {
      const { meta: _omit, ...withoutMeta } = withoutBatch;
      void _omit;
      retry = await client
        .from(ENRICHMENT_AGENT_RUNS_TABLE)
        .insert(withoutMeta)
        .select("id")
        .single();
    }
    runRow = retry.data;
    runErr = retry.error;
  }

  if (runErr || !runRow?.id) {
    const msg = runErr?.message ?? "Failed to insert enrichment_agent_runs";
    return { error: msg };
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
    await client
      .from(ENRICHMENT_AGENT_RUNS_TABLE)
      .update({
        status: "error",
        finished_at: new Date().toISOString(),
        error: linkErr.message,
      })
      .eq("id", runId);
    return { error: linkErr.message };
  }

  return { runId };
}

/** Correlates all `processTaskBatch` / `task completed` lines within one outer worker loop iteration. */
type ProcessBatchContext = {
  tickId: string;
  batchSeq: number;
  phase: string;
  wave: number;
};

/** Fire-and-forget: tells the API to broadcast `enrichment_batch_started` so the table can flip all cells at once. */
function postEnrichmentBatchStartedEvent(payload: {
  projectId: string;
  agentName: string;
  workerName: string;
  items: Array<{ taskId: string; companyId: string | null; contactId: string | null }>;
}): void {
  const apiBase =
    process.env.RAILWAY_PUBLIC_DOMAIN?.trim() ||
    process.env.WORKER_API_BASE_URL?.trim() ||
    process.env.ENRICHMENT_API_URL?.trim() ||
    "";
  if (!apiBase) return;
  const baseNorm = apiBase.replace(/\/$/, "");
  const withScheme = baseNorm.includes("://") ? baseNorm : `http://${baseNorm}`;
  const url = `${withScheme}/api/enrichment/worker-batch-event`;
  const secret = process.env.WORKER_HEARTBEAT_SECRET?.trim();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret) headers.Authorization = `Bearer ${secret}`;
  void fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  }).then(
    (res) => {
      if (!res.ok) {
        log("info", "worker-batch-event POST failed", { status: res.status, agent: payload.agentName });
      }
    },
    (e: unknown) => {
      log("info", "worker-batch-event POST error", {
        error: e instanceof Error ? e.message : String(e),
        agent: payload.agentName,
      });
    }
  );
}

async function processTaskBatch(
  client: SupabaseClient,
  tasks: EnrichmentQueueTaskRow[],
  agent: { prompt: string; batch_size: number },
  workerName: string,
  adapter: LlmAdapter,
  batchCtx?: ProcessBatchContext,
  execOptions?: { signal?: AbortSignal }
): Promise<void> {
  if (tasks.length === 0) return;

  const invalid: EnrichmentQueueTaskRow[] = [];
  for (const t of tasks) {
    if (!t.company_id && !t.contact_id) invalid.push(t);
  }
  const nowIso0 = new Date().toISOString();
  for (const task of invalid) {
    const msg = "Invalid task: missing company_id and contact_id";
    log("error", msg, { taskId: task.id, agent: task.agent_name });
    await client
      .from(ENRICHMENT_QUEUE_TASKS_TABLE)
      .update({
        status: "error",
        last_error: msg,
        updated_at: nowIso0,
      })
      .eq("id", task.id);
  }

  const toRun = tasks.filter((t) => t.company_id || t.contact_id);
  if (toRun.length === 0) {
    log("info", "processTaskBatch: skipped (no valid entity ids)", {
      worker: workerName,
      rawTaskCount: tasks.length,
      ...(batchCtx ?? {}),
    });
    return;
  }

  const primaryAgent = toRun[0]?.agent_name ?? "?";
  log("info", "processTaskBatch: start", {
    worker: workerName,
    agent: primaryAgent,
    taskCount: toRun.length,
    batchSizeConfig: agent.batch_size,
    llmAdapter: adapter.name,
    taskIdsSample: toRun.slice(0, 8).map((t) => t.id),
    ...(batchCtx ?? {}),
  });

  const eligible: EnrichmentQueueTaskRow[] = [];
  for (const task of toRun) {
    const { data: freshTask } = await client
      .from(ENRICHMENT_QUEUE_TASKS_TABLE)
      .select("status")
      .eq("id", task.id)
      .maybeSingle();
    if (freshTask && (freshTask as { status: string }).status === "cancelled") {
      log("info", "task cancelled before run", { taskId: task.id, worker: workerName });
      continue;
    }
    eligible.push(task);
  }

  if (eligible.length === 0) {
    log("info", "processTaskBatch: skipped (all tasks cancelled)", {
      worker: workerName,
      agent: primaryAgent,
      ...(batchCtx ?? {}),
    });
    return;
  }

  const progressTasks = eligible.map((t) => ({
    taskId: t.id,
    agentName: t.agent_name,
    operationName: t.operation_name,
  }));

  postEnrichmentBatchStartedEvent({
    projectId: eligible[0]!.project_id,
    agentName: primaryAgent,
    workerName,
    items: eligible.map((t) => ({
      taskId: t.id,
      companyId: t.company_id ?? null,
      contactId: t.contact_id ?? null,
    })),
  });

  const runStartContext: EnrichmentRunStartContext = {
    agentPrompt: agent.prompt,
    batchCompanyIds: [...new Set(eligible.map((t) => t.company_id).filter(Boolean))] as string[],
    batchContactIds: [...new Set(eligible.map((t) => t.contact_id).filter(Boolean))] as string[],
    batchQueueTaskIds: eligible.map((t) => t.id),
  };

  let batchId: string | null = null;
  const batchIns = await insertEnrichmentBatchRow(
    client,
    eligible[0]!.project_id,
    primaryAgent,
    workerName
  );
  if ("error" in batchIns) {
    log("error", "insert enrichment_agent_batches failed", {
      error: batchIns.error,
      agent: primaryAgent,
      worker: workerName,
      ...(batchCtx ?? {}),
    });
    const fin = new Date().toISOString();
    for (const task of eligible) {
      await client
        .from(ENRICHMENT_QUEUE_TASKS_TABLE)
        .update({
          status: "error",
          last_error: batchIns.error,
          updated_at: fin,
        })
        .eq("id", task.id);
    }
    return;
  }
  batchId = batchIns.batchId;

  await withWorkerTasksPresence(progressTasks, async () => {
    type Prepared = {
      task: EnrichmentQueueTaskRow;
      runId: string;
      entityId: string;
    };
    const prepared: Prepared[] = [];

    for (const task of eligible) {
      const startedIso = new Date().toISOString();
      const ins = await insertRunAndLinkTask(
        client,
        task,
        workerName,
        startedIso,
        runStartContext,
        batchId
      );
      if ("error" in ins) {
        log("error", "insert run failed", {
          taskId: task.id,
          error: ins.error,
          agent: task.agent_name,
          worker: workerName,
        });
        await client
          .from(ENRICHMENT_QUEUE_TASKS_TABLE)
          .update({
            status: "error",
            last_error: ins.error,
            updated_at: new Date().toISOString(),
          })
          .eq("id", task.id);
        continue;
      }

      const entityId = (task.company_id ?? task.contact_id) as string;
      prepared.push({ task, runId: ins.runId, entityId });
    }

    if (prepared.length === 0) return;

    const contactUuids = [
      ...new Set(prepared.map((p) => p.task.contact_id).filter(Boolean)),
    ] as string[];

    const contactByUuid = new Map<string, Record<string, unknown>>();
    if (contactUuids.length > 0) {
      const { data: cdata, error: cErr } = await client
        .from(CONTACTS_TABLE)
        .select("*")
        .in("uuid", contactUuids);
      if (cErr) {
        const err = cErr.message;
        for (const p of prepared) {
          const fin = new Date().toISOString();
          await client
            .from(ENRICHMENT_AGENT_RUNS_TABLE)
            .update({ status: "error", finished_at: fin, error: err })
            .eq("id", p.runId);
          await client
            .from(ENRICHMENT_QUEUE_TASKS_TABLE)
            .update({ status: "error", last_error: err, updated_at: fin })
            .eq("id", p.task.id);
        }
        log("error", "batch fetch contacts failed", { error: err, worker: workerName });
        return;
      }
      for (const row of (cdata ?? []) as Record<string, unknown>[]) {
        const u = row.uuid as string | undefined;
        if (u) contactByUuid.set(u, row);
      }
    }

    const { data: agentRow } = await getEnrichmentAgentByName(client, primaryAgent);
    const entityType = parseEntityTypeForPrompt(agentRow?.entity_type);
    const refTask = prepared[0]!.task;
    const rowKind: "company" | "contact" = refTask.company_id ? "company" : "contact";
    const refEntityId = (refTask.company_id ?? refTask.contact_id) as string;

    const promptSettings = await getCachedEnrichmentPromptSettings(
      client,
      refTask.project_id
    );

    let entities: Array<{ id: string; data: Record<string, unknown> }>;
    if (refTask.company_id) {
      const companyIdsOrdered = prepared.map((p) => p.task.company_id).filter(Boolean) as string[];
      const assembled = await buildCompanyEntitiesForPrompt(
        client,
        refTask.project_id,
        companyIdsOrdered,
        promptSettings.companies_placeholder_config
      );
      if (assembled.error) {
        const err = assembled.error;
        for (const p of prepared) {
          const fin = new Date().toISOString();
          await client
            .from(ENRICHMENT_AGENT_RUNS_TABLE)
            .update({ status: "error", finished_at: fin, error: err })
            .eq("id", p.runId);
          await client
            .from(ENRICHMENT_QUEUE_TASKS_TABLE)
            .update({ status: "error", last_error: err, updated_at: fin })
            .eq("id", p.task.id);
        }
        log("error", "assemble company entities failed", { error: err, worker: workerName });
        return;
      }
      entities = assembled.entities;
    } else {
      entities = prepared.map((p) => {
        const t = p.task;
        const data =
          contactByUuid.get(t.contact_id as string) ?? { id: t.contact_id };
        return { id: p.entityId, data };
      });
    }

    const agentResultsByAgentName = await fetchAgentResultsForReferenceEntity(
      client,
      refTask.project_id,
      rowKind,
      refEntityId
    );

    const resolvedPrompt = resolvePromptForBatch(agent.prompt, entities, {
      batchSize: agent.batch_size,
      entityType,
      rowKind,
      agentResultsByAgentName,
    });

    const finalPrompt = `${promptSettings.global_prompt_prefix}${resolvedPrompt}${promptSettings.global_prompt_suffix}`;

    let resultMap: Map<string, Record<string, unknown>>;
    try {
      const execOut = await adapter.execute(finalPrompt, entities, {
        signal: execOptions?.signal,
      });
      resultMap = execOut.results;
      if (batchId) {
        await updateEnrichmentBatchLlmTrace(client, batchId, {
          llm_adapter: adapter.name,
          external_agent_id: execOut.trace?.externalAgentId ?? null,
          meta: execOut.trace?.meta,
        });
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      if (batchId) {
        await updateEnrichmentBatchLlmTrace(client, batchId, {
          llm_adapter: adapter.name,
          meta: { error: err },
        });
      }
      for (const p of prepared) {
        const fin = new Date().toISOString();
        await client
          .from(ENRICHMENT_AGENT_RUNS_TABLE)
          .update({ status: "error", finished_at: fin, error: err })
          .eq("id", p.runId);
        await client
          .from(ENRICHMENT_QUEUE_TASKS_TABLE)
          .update({ status: "error", last_error: err, updated_at: fin })
          .eq("id", p.task.id);
      }
      log("error", "LLM adapter execute failed", {
        error: err,
        worker: workerName,
        adapter: adapter.name,
      });
      return;
    }

    for (const p of prepared) {
      const finishedIso = new Date().toISOString();
      const agentResult = resultMap.get(p.entityId) ?? {
        enriched: false,
        error: "missing result for entity",
      };
      const upsertRes = await upsertEnrichmentAgentResult(
        client,
        p.task,
        p.runId,
        finishedIso,
        workerName,
        agentResult
      );
      if (upsertRes.error) {
        log("error", "upsert enrichment_agent_results failed", {
          taskId: p.task.id,
          runId: p.runId,
          error: upsertRes.error,
        });
        await client
          .from(ENRICHMENT_AGENT_RUNS_TABLE)
          .update({
            status: "error",
            finished_at: finishedIso,
            error: upsertRes.error,
          })
          .eq("id", p.runId);
        await client
          .from(ENRICHMENT_QUEUE_TASKS_TABLE)
          .update({
            status: "error",
            last_error: upsertRes.error,
            updated_at: finishedIso,
          })
          .eq("id", p.task.id);
        continue;
      }

      await client
        .from(ENRICHMENT_AGENT_RUNS_TABLE)
        .update({
          status: "success",
          finished_at: finishedIso,
          error: null,
        })
        .eq("id", p.runId);

      await client
        .from(ENRICHMENT_QUEUE_TASKS_TABLE)
        .update({
          status: "done",
          last_error: null,
          updated_at: finishedIso,
        })
        .eq("id", p.task.id);

      log("info", "task completed", {
        taskId: p.task.id,
        runId: p.runId,
        agent: p.task.agent_name,
        worker: workerName,
        ...(batchCtx ?? {}),
      });
    }

    log("info", "processTaskBatch: done", {
      worker: workerName,
      agent: primaryAgent,
      completed: prepared.length,
      ...(batchCtx ?? {}),
    });
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
  const llmAdapter = createLlmAdapter();
  log("info", "worker started", {
    worker: env.workerName,
    maxConcurrentAgentRuns: env.maxConcurrentAgentRuns,
    pickLimit: env.pickLimit,
    pickIntervalMs: env.pickIntervalMs,
    lockMinutes: env.lockMinutes,
    batchWaitMs: env.batchWaitMs,
    llmAdapter: llmAdapter.name,
    note: "processTaskBatch / task completed logs only appear in THIS process (not the API server terminal)",
  });
  if (env.batchWaitMs === 0) {
    log(
      "info",
      "WARNING: ENRICHMENT_BATCH_WAIT_MS=0 — partial batches flush immediately after each pick; first pick may run before batch_size is reached (e.g. pickLimit 10 with batch_size 20). Use 30000 (default), or -1 for full batches only.",
      { worker: env.workerName }
    );
  } else if (env.batchWaitMs === -1) {
    log("info", "ENRICHMENT_BATCH_WAIT_MS=-1: only full batch_size flushes (no timed partials)", {
      worker: env.workerName,
    });
  }

  const signal = options?.signal;
  const pendingByAgent = new Map<string, PendingAccumulator>();

  for (;;) {
    if (signal?.aborted) break;

    const tickId = randomUUID().slice(0, 8);
    const processBatchInvocation = { n: 0 };

    const nowIso = new Date().toISOString();

    const requeue = await requeueStuckEnrichmentTasks(client, nowIso);
    if (requeue.error) {
      log("error", "requeue stuck tasks failed", { error: requeue.error, worker: env.workerName });
    }

    log("info", "worker tick", {
      worker: env.workerName,
      tickId,
      pendingBeforeClaim: pendingQueuesDebug(pendingByAgent),
      pickLimit: env.pickLimit,
      batchWaitMs: env.batchWaitMs,
    });

    const agentCache = new Map<string, { prompt: string; batch_size: number }>();
    const resolveCached = async (agentName: string): Promise<{ prompt: string; batch_size: number }> => {
      const key = agentName.trim();
      if (agentCache.has(key)) return agentCache.get(key)!;
      const { data } = await getEnrichmentAgentByName(client, key);
      const cfg = resolveAgentConfig(data);
      agentCache.set(key, cfg);
      return cfg;
    };

    const flushUntilStable = async (
      phase: string,
      fullOnly: boolean,
      queueExhausted: boolean
    ): Promise<void> => {
      let wave = 0;
      for (;;) {
        wave += 1;
        const now = Date.now();
        const flushes = takeReadyBatches(pendingByAgent, env.batchWaitMs, now, {
          fullOnly,
          queueExhausted,
        });
        if (flushes.length === 0) {
          if (pendingByAgent.size > 0) {
            log("info", "flushUntilStable: no flush this wave (buffers waiting)", {
              worker: env.workerName,
              phase,
              fullOnly,
              queueExhausted,
              wave,
              pending: pendingQueuesDebug(pendingByAgent),
            });
          }
          break;
        }
        log("info", "flushUntilStable: executing batch(es)", {
          worker: env.workerName,
          phase,
          fullOnly,
          queueExhausted,
          wave,
          batches: flushes.map((f) => ({
            taskCount: f.tasks.length,
            batchSize: Math.max(1, f.agent.batch_size),
          })),
        });
        await mapWithConcurrency(
          flushes,
          env.maxConcurrentAgentRuns,
          (batch) => {
            processBatchInvocation.n += 1;
            return processTaskBatch(
              client,
              batch.tasks,
              batch.agent,
              env.workerName,
              llmAdapter,
              {
                tickId,
                batchSeq: processBatchInvocation.n,
                phase,
                wave,
              },
              { signal }
            );
          },
          env.workerName
        );
        setWorkerPendingBatches(snapshotPendingBatches(pendingByAgent));
      }
    };

    /** Claim repeatedly in one tick so `pickLimit < batch_size` can still fill a full agent batch. */
    const maxClaimRounds = 500;
    let claimRounds = 0;
    let claimHadError: string | null = null;
    let rowsClaimedThisTick = 0;
    /** True if any claim this tick returned a full page — then a short final page means DB queue drained (bulk). */
    let hadFullClaimPageThisTick = false;

    while (claimRounds < maxClaimRounds) {
      const claimed = await claimEnrichmentTasks(
        client,
        env.pickLimit,
        new Date().toISOString(),
        env.lockMinutes,
        env.workerName
      );
      if (claimed.error) {
        claimHadError = claimed.error;
        break;
      }
      claimRounds += 1;

      if (claimed.tasks.length === 0) {
        log("info", "claim: RPC returned 0 rows (queue empty)", {
          worker: env.workerName,
          round: claimRounds,
          rowsClaimedThisTick,
          pendingBeforeDrain: pendingQueuesDebug(pendingByAgent),
        });
        await flushUntilStable("after-empty-claim", false, true);
        break;
      }

      await affirmQueueWorkerAttribution(client, claimed.tasks, env.workerName);

      rowsClaimedThisTick += claimed.tasks.length;
      if (claimed.tasks.length >= env.pickLimit) {
        hadFullClaimPageThisTick = true;
      }

      log("info", "claim: got page", {
        worker: env.workerName,
        count: claimed.tasks.length,
        round: claimRounds,
        pickLimit: env.pickLimit,
        isFullPage: claimed.tasks.length >= env.pickLimit,
      });

      for (const task of claimed.tasks) {
        const cfg = await resolveCached(task.agent_name);
        const key = task.agent_name.trim();
        const existing = pendingByAgent.get(key);
        if (!existing) {
          pendingByAgent.set(key, {
            tasks: [task],
            agent: cfg,
            firstClaimedAt: Date.now(),
          });
        } else {
          existing.tasks.push(task);
          existing.agent = cfg;
        }
      }

      setWorkerPendingBatches(snapshotPendingBatches(pendingByAgent));

      log("info", "claim: merged into buffers", {
        worker: env.workerName,
        round: claimRounds,
        pending: pendingQueuesDebug(pendingByAgent),
      });

      await flushUntilStable("after-merge-full-only", true, false);

      if (claimed.tasks.length < env.pickLimit) {
        if (hadFullClaimPageThisTick) {
          const pendingDbg = pendingQueuesDebug(pendingByAgent);
          for (const p of pendingDbg) {
            if (p.queued > 0 && p.queued < p.batchSize) {
              log("info", "claim: queue exhausted mid-tick — cannot fill agent batch_size", {
                worker: env.workerName,
                agent: p.agent,
                rowsInBuffer: p.queued,
                batchSize: p.batchSize,
                rowsClaimedThisTick,
                explain:
                  "After at least one full claim page this tick, a short page means no more rows in the DB. " +
                  "Draining stragglers now. For one-row-at-a-time enqueue, hadFullClaimPageThisTick stays false so we hold until batch_size or batchWaitMs.",
              });
            }
          }
          log("info", "claim: last page was partial — draining stragglers (bulk tail)", {
            worker: env.workerName,
            round: claimRounds,
            pageSize: claimed.tasks.length,
            pickLimit: env.pickLimit,
            rowsClaimedThisTick,
          });
          await flushUntilStable("after-partial-page", false, true);
        } else {
          log("info", "claim: short page — holding buffer (accumulate until batch_size or batchWaitMs)", {
            worker: env.workerName,
            round: claimRounds,
            pageSize: claimed.tasks.length,
            pickLimit: env.pickLimit,
            pending: pendingQueuesDebug(pendingByAgent),
          });
        }
        break;
      }

      log("info", "claim: full page this round — next claim in same tick (buffers may be empty after flush)", {
        worker: env.workerName,
        completedClaimRound: claimRounds,
        nextClaimRound: claimRounds + 1,
        pendingAfterFlushes: pendingQueuesDebug(pendingByAgent),
      });
    }

    if (!claimHadError) {
      await flushUntilStable("tick-end-full-or-timer", false, false);
    }

    if (claimHadError) {
      log("error", "claim failed", { error: claimHadError, worker: env.workerName });
      log("info", "worker tick end (claim error)", {
        worker: env.workerName,
        tickId,
        processTaskBatchInvocations: processBatchInvocation.n,
        pendingAfterTick: pendingQueuesDebug(pendingByAgent),
        sleepMs: env.pickIntervalMs,
      });
      setWorkerPendingBatches(snapshotPendingBatches(pendingByAgent));
      await sleep(env.pickIntervalMs, signal);
      continue;
    }

    if (claimRounds >= maxClaimRounds) {
      log("info", "max claim rounds per tick reached; will continue next tick", {
        worker: env.workerName,
        maxClaimRounds,
        pending: pendingQueuesDebug(pendingByAgent),
      });
    }

    log("info", "worker tick end", {
      worker: env.workerName,
      tickId,
      claimRoundsThisTick: claimRounds,
      rowsClaimedThisTick,
      processTaskBatchInvocations: processBatchInvocation.n,
      pendingAfterTick: pendingQueuesDebug(pendingByAgent),
      sleepMs: env.pickIntervalMs,
    });

    setWorkerPendingBatches(snapshotPendingBatches(pendingByAgent));

    await sleep(env.pickIntervalMs, signal);
  }

  setWorkerPendingBatches([]);
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
  const sysPromptType = getEnrichmentSystemPromptType();
  if (sysPromptType) {
    log("info", "enrichment prompt profile (ENRICHMENT_SYSTEM_PROMPT_TYPE)", {
      profile: sysPromptType,
      worker: activeWorkerName,
    });
  }

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
  setWorkerRuntimeConfig(buildEnrichmentRuntimeSnapshot(heartbeatIntervalMs));
  const httpPort = parsePositiveInt("ENRICHMENT_WORKER_HTTP_PORT", 0);

  let stopHeartbeat: (() => void) | undefined;
  let closePresenceHttp: (() => void) | undefined;

  if (httpPort > 0) {
    const { close } = startWorkerPresenceHttpServer(httpPort, workerId, activeWorkerName, "enrichment");
    closePresenceHttp = close;
    log("info", "worker status HTTP", { port: httpPort, worker: activeWorkerName });
  }

  if (apiBase) {
    const rt = startWorkerRealtimeConnection(
      apiBase,
      workerId,
      activeWorkerName,
      "enrichment",
      heartbeatIntervalMs
    );
    stopHeartbeat = rt.stop;
    log("info", "API worker WebSocket (realtime presence) enabled", {
      apiBase,
      intervalMs: heartbeatIntervalMs,
      worker: activeWorkerName,
    });
  } else {
    log("info", "WORKER_API_BASE_URL / ENRICHMENT_API_URL not set; skipping API worker presence", {});
  }

  const controller = new AbortController();
  let shuttingDown = false;
  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    log("info", "shutdown signal received", { worker: activeWorkerName });
    markWorkerStopping();
    await deleteWorkerPresenceFromSupabase(workerId, client);
    stopHeartbeat?.();
    closePresenceHttp?.();
    controller.abort();
  }
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

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
