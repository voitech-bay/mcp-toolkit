/**
 * n8n workflow triggering for the web-app launcher.
 *
 * Generalizes the single-contact pattern in inmail-review-handlers.ts
 * (handleInmailRunNew → fetch(N8N_INMAIL_SINGLE_WEBHOOK_URL, ...)) to a small
 * registry of pipelines launched from the app. Feasible uses a list-driven
 * parent workflow; Velvetech accepts bare lead UUIDs from Launch or cards.
 * The backend stores selected lead UUIDs so run history can compute aggregates
 * from rows pushed back to /api/n8n/workflow-results.
 */

const N8N_BASE = (process.env.N8N_BASE_URL?.trim() || "https://primary-production-36cb4.up.railway.app").replace(
  /\/+$/,
  ""
);
export const FEASIBLE_PROJECT_ID = "94dc3b92-1cae-4360-a958-917a58063309";
export const VELVETECH_PROJECT_ID = "51cc22a1-868e-42c4-974f-9a7c5f5dce20";

export type WorkflowLaunchAdapter = "feasible_list" | "velvetech_research" | "velvetech_reply";

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
  adapter: WorkflowLaunchAdapter;
}

/**
 * Launchable pipelines per project (Feasible list-only; Velvetech list or bare UUIDs).
 * Webhook URLs are overridden by env when set.
 */
export const WORKFLOW_REGISTRY: WorkflowRegistryEntry[] = [
  {
    key: "feasible_direct_pov",
    label: "Feasible — Direct POV pipeline",
    webhookUrlEnv: "N8N_FEASIBLE_DIRECT_POV_WEBHOOK_URL",
    workflowId: "PqAsnwNHiezGsMTw",
    project: FEASIBLE_PROJECT_ID,
    adapter: "feasible_list",
  },
  {
    key: "velvetech_research",
    label: "Velvetech — Research pipeline",
    webhookUrlEnv: "N8N_VELVETECH_RESEARCH_WEBHOOK_URL",
    workflowId: "l9pGpKlzrQuCj4Yn",
    project: VELVETECH_PROJECT_ID,
    adapter: "velvetech_research",
  },
  {
    key: "velvetech_reply",
    label: "Velvetech — Draft reply",
    webhookUrlEnv: "N8N_VELVETECH_REPLY_WEBHOOK_URL",
    workflowId: "bMc92zIIWe0wGAbE",
    project: VELVETECH_PROJECT_ID,
    adapter: "velvetech_reply",
  },
];

export function findWorkflow(key: string): WorkflowRegistryEntry | null {
  return WORKFLOW_REGISTRY.find((w) => w.key === key) ?? null;
}

/** Registry entries that have a configured webhook URL (i.e. actually launchable). */
export function listLaunchableWorkflows(): Array<WorkflowRegistryEntry & { configured: boolean }> {
  return WORKFLOW_REGISTRY.map((w) => ({
    ...w,
    configured: Boolean(resolveWebhookUrl(w)),
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
  args: { leadUuids: string[]; projectId: string; launchId: string; sourceListUuid?: string | null }
): Promise<TriggerResult> {
  const wf = findWorkflow(key);
  if (!wf) return { ok: false, status: 400, error: `Unknown workflow: ${key}` };
  const webhook = resolveWebhookUrl(wf);
  if (!webhook) {
    return { ok: false, status: 500, error: `${wf.webhookUrlEnv} not configured` };
  }
  const leadUuids = [...new Set(args.leadUuids.map((u) => String(u).trim()).filter(Boolean))];
  if (leadUuids.length === 0) return { ok: false, status: 400, error: "No lead UUIDs provided" };
  const listUuid = String(args.sourceListUuid ?? "").trim();
  if (!listUuid) return { ok: false, status: 400, error: "sourceListUuid is required for Feasible launch" };

  try {
    const r = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        list_uuid: listUuid,
        project_id: args.projectId || wf.project,
        lead_uuids: leadUuids,
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

export async function triggerWorkflowPayload(
  key: string,
  payload: Record<string, unknown>
): Promise<TriggerResult> {
  const wf = findWorkflow(key);
  if (!wf) return { ok: false, status: 400, error: `Unknown workflow: ${key}` };
  const webhook = resolveWebhookUrl(wf);
  if (!webhook) {
    return { ok: false, status: 500, error: `${wf.webhookUrlEnv} not configured` };
  }

  try {
    const r = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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

export function resolveWebhookUrl(wf: WorkflowRegistryEntry): string {
  const configured = process.env[wf.webhookUrlEnv]?.trim();
  if (configured) return configured;
  if (wf.key === "feasible_direct_pov") return `${N8N_BASE}/webhook/feasible-pipeline-trigger`;
  if (wf.key === "velvetech_research") return `${N8N_BASE}/webhook/velvetech-research-trigger`;
  if (wf.key === "velvetech_reply") return `${N8N_BASE}/webhook/velvetech-reply-trigger`;
  return "";
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
