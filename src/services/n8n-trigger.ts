/**
 * n8n workflow triggering for the web-app launcher.
 *
 * Generalizes the single-contact pattern in inmail-review-handlers.ts
 * (handleInmailRunNew → fetch(N8N_INMAIL_SINGLE_WEBHOOK_URL, ...)) to a small
 * registry of pipelines, each launched by POSTing an array of lead UUIDs to its
 * webhook. The n8n workflow fetches the contacts by UUID internally and echoes
 * `launch_id` onto every result row it pushes back to /api/n8n/workflow-results
 * so the backend can compute per-run aggregates.
 */

const N8N_BASE = (process.env.N8N_BASE_URL?.trim() || "https://primary-production-36cb4.up.railway.app").replace(
  /\/+$/,
  ""
);
const SPRITES_PROJECT_ID = "33095db5-9793-4034-959d-7adadfd761fb";

export interface WorkflowRegistryEntry {
  /** Stable key used in API bodies and the launch record. */
  key: string;
  /** Human label for the picker. */
  label: string;
  /** Env var holding the production webhook URL of the multi-UUID workflow. */
  webhookUrlEnv: string;
  /** n8n workflow id (for optional executions enrichment). */
  workflowId: string;
  project: string;
}

/**
 * Launchable pipelines. Each multi-UUID webhook accepts { lead_uuids, projectId, launch_id }
 * and fetches contacts by UUID inside n8n. Webhook URLs come from env (set once the
 * corresponding n8n workflow exists), mirroring N8N_INMAIL_SINGLE_WEBHOOK_URL.
 */
export const WORKFLOW_REGISTRY: WorkflowRegistryEntry[] = [
  {
    key: "research",
    label: "Sprites — Research pipeline (Phase A/B)",
    webhookUrlEnv: "N8N_RESEARCH_MULTI_WEBHOOK_URL",
    workflowId: "O9cupRQBeLdZZkqd",
    project: SPRITES_PROJECT_ID,
  },
  {
    key: "inmail",
    label: "Sprites — InMail pipeline",
    webhookUrlEnv: "N8N_INMAIL_MULTI_WEBHOOK_URL",
    workflowId: "n870pBNtzB2GV05u",
    project: SPRITES_PROJECT_ID,
  },
  {
    key: "followup",
    label: "Sprites — Follow-up pipeline",
    webhookUrlEnv: "N8N_FOLLOWUP_MULTI_WEBHOOK_URL",
    workflowId: "huX4XEzUZKVkxMYx",
    project: SPRITES_PROJECT_ID,
  },
];

export function findWorkflow(key: string): WorkflowRegistryEntry | null {
  return WORKFLOW_REGISTRY.find((w) => w.key === key) ?? null;
}

/** Registry entries that have a configured webhook URL (i.e. actually launchable). */
export function listLaunchableWorkflows(): Array<WorkflowRegistryEntry & { configured: boolean }> {
  return WORKFLOW_REGISTRY.map((w) => ({
    ...w,
    configured: Boolean(process.env[w.webhookUrlEnv]?.trim()),
  }));
}

export interface TriggerResult {
  ok: boolean;
  status: number;
  error?: string;
}

/**
 * Fire a pipeline webhook with the selected lead UUIDs. Fire-and-forget: the n8n
 * run pushes results back asynchronously via /api/n8n/workflow-results.
 */
export async function triggerWorkflowByUuids(
  key: string,
  args: { leadUuids: string[]; projectId: string; launchId: string }
): Promise<TriggerResult> {
  const wf = findWorkflow(key);
  if (!wf) return { ok: false, status: 400, error: `Unknown workflow: ${key}` };
  const webhook = process.env[wf.webhookUrlEnv]?.trim();
  if (!webhook) {
    return { ok: false, status: 500, error: `${wf.webhookUrlEnv} not configured` };
  }
  const leadUuids = [...new Set(args.leadUuids.map((u) => String(u).trim()).filter(Boolean))];
  if (leadUuids.length === 0) return { ok: false, status: 400, error: "No lead UUIDs provided" };

  try {
    const r = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lead_uuids: leadUuids,
        projectId: args.projectId || wf.project,
        launch_id: args.launchId,
      }),
    });
    if (!r.ok) {
      const text = await r.text();
      return { ok: false, status: 502, error: `n8n webhook ${r.status}: ${text.slice(0, 300)}` };
    }
    return { ok: true, status: 200 };
  } catch (e) {
    return { ok: false, status: 502, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface N8nExecutionSummary {
  id: string;
  finished: boolean;
  status: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
}

/**
 * Optional health enrichment via the n8n public API. Best-effort: returns [] when
 * N8N_API_KEY is unset or the call fails (primary run state comes from result-row
 * aggregates keyed by launch_id).
 */
export async function listExecutions(workflowId: string, limit = 5): Promise<N8nExecutionSummary[]> {
  const apiKey = process.env.N8N_API_KEY?.trim();
  if (!apiKey) return [];
  try {
    const url = `${N8N_BASE}/api/v1/executions?workflowId=${encodeURIComponent(workflowId)}&includeData=false&limit=${limit}`;
    const r = await fetch(url, { headers: { "X-N8N-API-KEY": apiKey } });
    if (!r.ok) return [];
    const json = (await r.json()) as { data?: Array<Record<string, unknown>> };
    return (json.data ?? []).map((e) => ({
      id: String(e.id ?? ""),
      finished: Boolean(e.finished),
      status: typeof e.status === "string" ? e.status : null,
      startedAt: typeof e.startedAt === "string" ? e.startedAt : null,
      stoppedAt: typeof e.stoppedAt === "string" ? e.stoppedAt : null,
    }));
  } catch {
    return [];
  }
}
