/**
 * HTTP handlers for the workflow launcher (Pipeline > Launch). Additive and
 * self-contained: reuses Supabase + the n8n-trigger service. Routes registered
 * in src/api-server.ts. No existing handler is touched.
 *
 * Table (see scripts/n8n-launch-schema.sql): public.n8n_launch_runs.
 * Run aggregates are derived from public.n8n_workflow_results: rows are correlated
 * by the launched lead_uuids within the run's time window, preferring an echoed
 * `result.launch_id` when present.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getSupabase,
  listContactListsForProject,
  N8N_WORKFLOW_RESULTS_TABLE,
} from "./services/supabase.js";
import {
  listLaunchableWorkflows,
  findWorkflow,
  triggerWorkflowByUuids,
} from "./services/n8n-trigger.js";

const LAUNCH_RUNS_TABLE = "n8n_launch_runs";
/** Mark a still-running launch as complete once no new rows have arrived for this long. */
const SETTLE_MS = 90_000;

type Json = Record<string, unknown>;

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.setHeader("Content-Type", "application/json");
  res.writeHead(status);
  res.end(JSON.stringify(obj));
}

async function readJsonBody(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Json) : {};
  } catch {
    return {};
  }
}

function str(obj: Json, key: string): string {
  const v = obj[key];
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
}

// --- GET /api/n8n/workflows --------------------------------------------------
export async function handleN8nWorkflows(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
  const items = listLaunchableWorkflows().map((w) => ({
    key: w.key,
    label: w.label,
    project: w.project,
    configured: w.configured,
  }));
  sendJson(res, 200, { items });
}

// --- POST /api/n8n/launch ----------------------------------------------------
// Body: { projectId, workflowKey, sourceListUuid?, leadUuids: string[] }
export async function handleN8nLaunch(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });

  const body = await readJsonBody(req);
  const workflowKey = str(body, "workflowKey");
  const wf = findWorkflow(workflowKey);
  if (!wf) return sendJson(res, 400, { error: `Unknown workflowKey: ${workflowKey || "(missing)"}` });

  const projectId = str(body, "projectId") || wf.project;
  const sourceListUuid = str(body, "sourceListUuid") || null;
  const leadUuids = Array.isArray(body.leadUuids)
    ? [...new Set(body.leadUuids.map((u) => String(u).trim()).filter(Boolean))]
    : [];
  if (leadUuids.length === 0) return sendJson(res, 400, { error: "leadUuids must be a non-empty array" });

  // Resolve the source list name for display (best-effort).
  let sourceListName: string | null = null;
  if (sourceListUuid) {
    const { data: lists } = await listContactListsForProject(client, projectId);
    sourceListName = lists.find((l) => l.uuid === sourceListUuid)?.name ?? null;
  }

  // Create the launch record first so we have the launch_id to thread into n8n.
  const { data: inserted, error: insErr } = await client
    .from(LAUNCH_RUNS_TABLE)
    .insert({
      project_id: projectId,
      workflow_key: workflowKey,
      source_list_uuid: sourceListUuid,
      source_list_name: sourceListName,
      lead_uuids: leadUuids,
      requested_count: leadUuids.length,
      status: "running",
    })
    .select("*")
    .single();
  if (insErr || !inserted) {
    return sendJson(res, 500, { error: insErr?.message ?? "Failed to create launch record" });
  }
  const launchId = String((inserted as Json).id);

  const trig = await triggerWorkflowByUuids(workflowKey, { leadUuids, projectId, launchId });
  if (!trig.ok) {
    await client
      .from(LAUNCH_RUNS_TABLE)
      .update({ status: "failed", error_message: trig.error ?? "Trigger failed", finished_at: new Date().toISOString() })
      .eq("id", launchId);
    return sendJson(res, trig.status, { error: trig.error ?? "Trigger failed", launchId });
  }

  sendJson(res, 200, { launchId, requestedCount: leadUuids.length });
}

interface RunAggregates {
  contacts_count: number;
  companies_count: number;
  succeeded_count: number;
  failed_count: number;
  latest_row_at: string | null;
}

/**
 * Correlate result rows for a launch: rows for the launched contacts created at/after
 * the run started. When some rows carry `result.launch_id`, restrict to exactly those.
 */
async function computeAggregates(
  client: NonNullable<ReturnType<typeof getSupabase>>,
  run: Json
): Promise<RunAggregates> {
  const launchId = String(run.id);
  const createdAt = str(run, "created_at");
  const leadUuids = Array.isArray(run.lead_uuids) ? (run.lead_uuids as unknown[]).map(String) : [];
  const empty: RunAggregates = {
    contacts_count: 0,
    companies_count: 0,
    succeeded_count: 0,
    failed_count: Number(run.requested_count) || leadUuids.length,
    latest_row_at: null,
  };
  if (leadUuids.length === 0) return empty;

  let query = client
    .from(N8N_WORKFLOW_RESULTS_TABLE)
    .select("contact_id,company_id,created_at,result")
    .in("contact_id", leadUuids);
  if (createdAt) query = query.gte("created_at", createdAt);
  const { data, error } = await query.limit(2000);
  if (error) return empty;

  let rows = (data ?? []) as Json[];
  // If any rows carry the launch_id, trust those exclusively (precise correlation).
  const tagged = rows.filter((r) => {
    const result = (r.result as Json) ?? {};
    return str(result, "launch_id") === launchId;
  });
  if (tagged.length > 0) rows = tagged;

  const contacts = new Set<string>();
  const companies = new Set<string>();
  let failed = 0;
  let latest: string | null = null;
  for (const r of rows) {
    const cid = str(r, "contact_id");
    if (cid) contacts.add(cid);
    const coid = str(r, "company_id");
    if (coid) companies.add(coid);
    const result = (r.result as Json) ?? {};
    if (result._error || str(result, "error")) failed += 1;
    const at = str(r, "created_at");
    if (at && (!latest || at > latest)) latest = at;
  }
  const requested = Number(run.requested_count) || leadUuids.length;
  const seen = contacts.size;
  const succeeded = Math.max(0, seen - failed);
  // Contacts launched but never seen in results count as failures once the run settles.
  const missing = Math.max(0, requested - seen);
  return {
    contacts_count: seen,
    companies_count: companies.size,
    succeeded_count: succeeded,
    failed_count: failed + missing,
    latest_row_at: latest,
  };
}

function statusFor(run: Json, agg: RunAggregates): string {
  const current = str(run, "status");
  if (current === "failed") return "failed";
  const requested = Number(run.requested_count) || 0;
  const seen = agg.contacts_count;
  if (seen >= requested && requested > 0) {
    return agg.failed_count > 0 ? "partial" : "success";
  }
  // Settle: no new rows for a while → finalize as partial/success/failed.
  const ref = agg.latest_row_at ?? str(run, "created_at");
  const idleMs = ref ? Date.now() - Date.parse(ref) : 0;
  if (idleMs > SETTLE_MS) {
    if (seen === 0) return "failed";
    return "partial";
  }
  return "running";
}

async function refreshRun(
  client: NonNullable<ReturnType<typeof getSupabase>>,
  run: Json
): Promise<Json> {
  if (str(run, "status") === "success" || str(run, "status") === "failed") return run;
  const agg = await computeAggregates(client, run);
  const status = statusFor(run, agg);
  const patch: Json = {
    contacts_count: agg.contacts_count,
    companies_count: agg.companies_count,
    succeeded_count: agg.succeeded_count,
    failed_count: agg.failed_count,
    status,
  };
  if (status === "success" || status === "partial" || status === "failed") {
    patch.finished_at = new Date().toISOString();
  }
  const { data: updated } = await client
    .from(LAUNCH_RUNS_TABLE)
    .update(patch)
    .eq("id", String(run.id))
    .select("*")
    .single();
  return (updated as Json) ?? { ...run, ...patch };
}

// --- GET /api/n8n/launch/:id/status ------------------------------------------
export async function handleN8nLaunchStatus(
  req: IncomingMessage,
  res: ServerResponse,
  launchId: string
): Promise<void> {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });
  const { data: run, error } = await client.from(LAUNCH_RUNS_TABLE).select("*").eq("id", launchId).maybeSingle();
  if (error) return sendJson(res, 500, { error: error.message });
  if (!run) return sendJson(res, 404, { error: "Launch not found" });
  const refreshed = await refreshRun(client, run as Json);
  sendJson(res, 200, { run: refreshed });
}

// --- GET /api/n8n/launch/history?projectId=&limit=&workflowKey= --------------
export async function handleN8nLaunchHistory(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });
  const url = new URL(req.url ?? "/", "http://localhost");
  const projectId = url.searchParams.get("projectId")?.trim();
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const workflowKey = url.searchParams.get("workflowKey")?.trim();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 200);

  let query = client
    .from(LAUNCH_RUNS_TABLE)
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (workflowKey) query = query.eq("workflow_key", workflowKey);
  const { data, error } = await query;
  if (error) return sendJson(res, 500, { error: error.message });

  // Refresh any still-running rows so counts/status are current in the table.
  const runs = await Promise.all(
    ((data ?? []) as Json[]).map((run) =>
      str(run, "status") === "running" ? refreshRun(client, run) : Promise.resolve(run)
    )
  );
  sendJson(res, 200, { runs });
}
