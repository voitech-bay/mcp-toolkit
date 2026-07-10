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
  getContactsByUuidsForProject,
  getCompaniesByIdsForProject,
  getConversation,
  getGetSalesCredentials,
  listContactListsForProject,
  N8N_WORKFLOW_RESULTS_TABLE,
} from "./services/supabase.js";
import {
  listLaunchableWorkflows,
  findWorkflow,
  triggerWorkflowByUuids,
  triggerWorkflowPayload,
} from "./services/n8n-trigger.js";
import { fetchAllSenders, sendLinkedInMessage } from "./services/source-api.js";

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

function strAny(obj: unknown, ...keys: string[]): string {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "";
  const rec = obj as Json;
  for (const key of keys) {
    const v = rec[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
}

function domainFrom(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split(":")[0];
}

function emailDomain(raw: string): string {
  const at = raw.lastIndexOf("@");
  return at >= 0 ? domainFrom(raw.slice(at + 1)) : "";
}

function firstName(row: Json): string {
  const first = str(row, "first_name");
  if (first) return first;
  return str(row, "name").split(/\s+/).filter(Boolean)[0] ?? "";
}

function contactName(row: Json): string {
  return str(row, "name") || [str(row, "first_name"), str(row, "last_name")].filter(Boolean).join(" ");
}

function latestOutboundSender(messages: unknown[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) continue;
    const row = msg as Json;
    const type = str(row, "type").toLowerCase();
    const direction = str(row, "direction").toLowerCase();
    if (type === "outbox" || direction === "outbound" || direction === "out") {
      const sender = str(row, "sender_profile_uuid");
      if (sender) return sender;
    }
  }
  return "";
}

function messageLine(row: unknown): Json {
  if (!row || typeof row !== "object" || Array.isArray(row)) return {};
  const r = row as Json;
  return {
    sent_at: str(r, "sent_at") || str(r, "created_at"),
    type: str(r, "type"),
    linkedin_type: str(r, "linkedin_type"),
    subject: str(r, "subject"),
    text: str(r, "text"),
    status: str(r, "status"),
    sender_profile_uuid: str(r, "sender_profile_uuid"),
  };
}

function findNestedString(value: unknown, key: string, seen = new Set<object>()): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findNestedString(item, key, seen);
      if (found) return found;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  const obj = value as Json;
  if (seen.has(obj)) return "";
  seen.add(obj);
  const direct = obj[key];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  for (const child of Object.values(obj)) {
    const found = findNestedString(child, key, seen);
    if (found) return found;
  }
  return "";
}

async function latestVelvetechPov(client: NonNullable<ReturnType<typeof getSupabase>>, domain: string): Promise<Json | null> {
  if (!domain) return null;
  const freshCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await client
    .from(N8N_WORKFLOW_RESULTS_TABLE)
    .select("result,created_at")
    .eq("workflow_name", "velvetech-pov")
    .eq("result->>entity_key", domain)
    .gte("created_at", freshCutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const result = data && typeof data === "object" ? (data as Json).result : null;
  return result && typeof result === "object" && !Array.isArray(result) ? (result as Json) : null;
}

async function buildVelvetechResearchPayload(
  client: NonNullable<ReturnType<typeof getSupabase>>,
  args: { projectId: string; launchId: string; leadUuids: string[] }
): Promise<{ ok: true; payload: Json } | { ok: false; status: number; error: string }> {
  const { contacts, error } = await getContactsByUuidsForProject(client, args.projectId, args.leadUuids);
  if (error) return { ok: false, status: 500, error };
  const contactRows = args.leadUuids.map((uuid) => contacts[uuid]).filter((row): row is Json => !!row);
  const missing = args.leadUuids.length - contactRows.length;
  if (missing > 0) return { ok: false, status: 400, error: `${missing} selected lead(s) are not synced in Contacts` };

  const companyIds = contactRows.map((c) => str(c, "company_uuid")).filter(Boolean);
  const companiesRes = await getCompaniesByIdsForProject(client, args.projectId, companyIds);
  if (companiesRes.error) return { ok: false, status: 500, error: companiesRes.error };

  const rows = contactRows.map((c) => {
    const companyId = str(c, "company_uuid");
    const co = companiesRes.companies[companyId] as Json | undefined;
    const domain = domainFrom(strAny(co, "domain")) || emailDomain(str(c, "work_email"));
    return {
      lead_uuid: str(c, "uuid"),
      company_uuid: companyId,
      company_domain: domain,
      company_name: strAny(co, "name") || str(c, "company_name") || domain,
      first_name: str(c, "first_name"),
      last_name: str(c, "last_name"),
      full_name: contactName(c),
      title: str(c, "position"),
      linkedin_url: str(c, "linkedin"),
      email: str(c, "work_email"),
    };
  }).filter((r) => r.company_domain);
  if (rows.length === 0) return { ok: false, status: 400, error: "Selected leads have no company domain or work email domain" };
  return {
    ok: true,
    payload: { run_id: args.launchId, launch_id: args.launchId, project_id: args.projectId, rows },
  };
}

async function buildVelvetechReplyPayloads(
  client: NonNullable<ReturnType<typeof getSupabase>>,
  args: { projectId: string; launchId: string; leadUuids: string[] }
): Promise<{ ok: true; payloads: Json[] } | { ok: false; status: number; error: string }> {
  const { contacts, error } = await getContactsByUuidsForProject(client, args.projectId, args.leadUuids);
  if (error) return { ok: false, status: 500, error };
  const contactRows = args.leadUuids.map((uuid) => contacts[uuid]).filter((row): row is Json => !!row);
  const missing = args.leadUuids.length - contactRows.length;
  if (missing > 0) return { ok: false, status: 400, error: `${missing} selected lead(s) are not synced in Contacts` };

  const companyIds = contactRows.map((c) => str(c, "company_uuid")).filter(Boolean);
  const companiesRes = await getCompaniesByIdsForProject(client, args.projectId, companyIds);
  if (companiesRes.error) return { ok: false, status: 500, error: companiesRes.error };

  // The copy agent writes in the sender persona's voice, so it needs the
  // persona NAME; the raw uuid stays on lead.sender_profile_uuid for sending.
  const senderNameByUuid = new Map<string, string>();
  const { credentials: gsCredentials } = await getGetSalesCredentials(client, args.projectId);
  if (gsCredentials) {
    const senders = await fetchAllSenders(gsCredentials);
    for (const row of senders.data ?? []) {
      const uuid = str(row as Json, "uuid");
      const name = [str(row as Json, "first_name"), str(row as Json, "last_name")].filter(Boolean).join(" ");
      if (uuid && name) senderNameByUuid.set(uuid, name);
    }
  }

  const payloads: Json[] = [];
  for (const c of contactRows) {
    const leadUuid = str(c, "uuid");
    const companyId = str(c, "company_uuid");
    const co = companiesRes.companies[companyId] as Json | undefined;
    const domain = domainFrom(strAny(co, "domain")) || emailDomain(str(c, "work_email"));
    if (!domain) return { ok: false, status: 400, error: `${contactName(c) || leadUuid} has no company domain` };
    const conv = await getConversation(client, { leadUuid, messageLimit: 100 });
    const messages = Array.isArray(conv.messages) ? conv.messages : [];
    const senderProfileUuid = latestOutboundSender(messages);
    const pov = await latestVelvetechPov(client, domain);
    payloads.push({
      run_id: `${args.launchId}-${leadUuid.slice(0, 8)}`,
      launch_id: args.launchId,
      project_id: args.projectId,
      company_domain: domain,
      company_key: domain,
      company_name: strAny(co, "name") || str(c, "company_name") || domain,
      company_uuid: companyId,
      skip_research: Boolean(pov),
      pov,
      lead: {
        lead_uuid: leadUuid,
        company_uuid: companyId,
        name: contactName(c),
        first_name: firstName(c),
        title: str(c, "position"),
        linkedin: str(c, "linkedin"),
        email: str(c, "work_email"),
        sender_profile_uuid: senderProfileUuid,
      },
      sender_persona: senderNameByUuid.get(senderProfileUuid) || senderProfileUuid,
      channel_state: {
        thread: messages.map(messageLine),
      },
    });
  }
  return { ok: true, payloads };
}

// --- GET /api/n8n/workflows --------------------------------------------------
export async function handleN8nWorkflows(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
  const url = new URL(req.url ?? "/", "http://localhost");
  const projectId = url.searchParams.get("projectId")?.trim() ?? "";
  const items = listLaunchableWorkflows().filter((w) => !projectId || w.project === projectId).map((w) => ({
    key: w.key,
    label: w.label,
    project: w.project,
    adapter: w.adapter,
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

  const requestedProjectId = str(body, "projectId") || wf.project;
  if (requestedProjectId !== wf.project) {
    return sendJson(res, 403, { error: "Selected workflow is not available for this project" });
  }
  const projectId = wf.project;
  const sourceListUuid = str(body, "sourceListUuid") || null;
  if (wf.adapter === "feasible_list" && !sourceListUuid) {
    return sendJson(res, 400, { error: "sourceListUuid is required" });
  }
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

  let trig: { ok: boolean; status: number; error?: string };
  if (wf.adapter === "feasible_list") {
    trig = await triggerWorkflowByUuids(workflowKey, { leadUuids, projectId, launchId, sourceListUuid });
  } else if (wf.adapter === "velvetech_research") {
    const built = await buildVelvetechResearchPayload(client, { projectId, launchId, leadUuids });
    if (!built.ok) {
      await client
        .from(LAUNCH_RUNS_TABLE)
        .update({ status: "failed", error_message: built.error, finished_at: new Date().toISOString() })
        .eq("id", launchId);
      return sendJson(res, built.status, { error: built.error, launchId });
    }
    trig = await triggerWorkflowPayload(workflowKey, built.payload);
  } else {
    const built = await buildVelvetechReplyPayloads(client, { projectId, launchId, leadUuids });
    if (!built.ok) {
      await client
        .from(LAUNCH_RUNS_TABLE)
        .update({ status: "failed", error_message: built.error, finished_at: new Date().toISOString() })
        .eq("id", launchId);
      return sendJson(res, built.status, { error: built.error, launchId });
    }
    let failed: string | null = null;
    for (const payload of built.payloads) {
      const one = await triggerWorkflowPayload(workflowKey, payload);
      if (!one.ok) failed = one.error ?? "Trigger failed";
    }
    trig = failed ? { ok: false, status: 502, error: failed } : { ok: true, status: 200 };
  }
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

function rowMatchesLaunchId(result: Json, launchId: string): boolean {
  if (str(result, "launch_id") === launchId || str(result, "run_id") === launchId) return true;
  if (findNestedString(result, "launch_id") === launchId) return true;
  if (findNestedString(result, "run_id") === launchId) return true;
  return false;
}

/**
 * Correlate result rows for a launch: rows for the launched contacts created at/after
 * the run started. When some rows carry `result.launch_id` or `result.run_id`, restrict to those.
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

  const projectId = str(run, "project_id");
  const { contacts: contactRows } = projectId
    ? await getContactsByUuidsForProject(client, projectId, leadUuids)
    : { contacts: {} as Record<string, Json> };
  const launchedCompanyIds = [
    ...new Set(
      leadUuids
        .map((uuid) => str(contactRows[uuid], "company_uuid"))
        .filter(Boolean)
    ),
  ];

  type RowPick = { contact_id: string | null; company_id: string | null; created_at: string | null; result: unknown };
  const rowKey = (r: RowPick) => `${str(r as Json, "contact_id")}|${str(r as Json, "company_id")}|${str(r as Json, "created_at")}`;

  let byContactQuery = client
    .from(N8N_WORKFLOW_RESULTS_TABLE)
    .select("contact_id,company_id,created_at,result")
    .in("contact_id", leadUuids);
  if (createdAt) byContactQuery = byContactQuery.gte("created_at", createdAt);
  const { data: byContact, error: contactErr } = await byContactQuery.limit(2000);

  let byLaunchQuery = client
    .from(N8N_WORKFLOW_RESULTS_TABLE)
    .select("contact_id,company_id,created_at,result")
    .or(`result->>launch_id.eq.${launchId},result->>run_id.eq.${launchId}`);
  if (createdAt) byLaunchQuery = byLaunchQuery.gte("created_at", createdAt);
  const { data: byLaunchTag, error: tagErr } = await byLaunchQuery.limit(2000);

  if (contactErr && tagErr) return empty;

  const merged = new Map<string, RowPick>();
  for (const r of [...(byContact ?? []), ...(byLaunchTag ?? [])] as RowPick[]) {
    merged.set(rowKey(r), r);
  }

  if (launchedCompanyIds.length > 0) {
    let companyQuery = client
      .from(N8N_WORKFLOW_RESULTS_TABLE)
      .select("contact_id,company_id,created_at,result")
      .in("company_id", launchedCompanyIds)
      .is("contact_id", null);
    if (createdAt) companyQuery = companyQuery.gte("created_at", createdAt);
    const { data: companyGrain } = await companyQuery.limit(500);
    for (const r of (companyGrain ?? []) as RowPick[]) {
      merged.set(rowKey(r), r);
    }
  }

  let rows = [...merged.values()];
  const tagged = rows.filter((r) => rowMatchesLaunchId((r.result as Json) ?? {}, launchId));
  if (tagged.length > 0) rows = tagged;

  const contacts = new Set<string>();
  const companies = new Set<string>();
  let failed = 0;
  let latest: string | null = null;
  for (const r of rows) {
    const cid = str(r as Json, "contact_id");
    if (cid) contacts.add(cid);
    const coid = str(r as Json, "company_id");
    if (coid) companies.add(coid);
    const result = (r.result as Json) ?? {};
    if (result._error || str(result, "error")) failed += 1;
    const at = str(r as Json, "created_at");
    if (at && (!latest || at > latest)) latest = at;
  }
  const requested = Number(run.requested_count) || leadUuids.length;
  const seen = contacts.size;
  const succeeded = Math.max(0, seen - failed);
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

// --- GET /api/n8n/velvetech/drafts?projectId=&limit= ------------------------
export async function handleVelvetechDrafts(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });
  const url = new URL(req.url ?? "/", "http://localhost");
  const projectId = url.searchParams.get("projectId")?.trim() ?? "";
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 100);

  const { data, error } = await client
    .from(N8N_WORKFLOW_RESULTS_TABLE)
    .select("id,contact_id,company_id,execution_id,workflow_name,result,created_at,updated_at")
    .eq("workflow_name", "velvetech-reply")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) return sendJson(res, 500, { error: error.message });

  const rawRows = (data ?? []) as Json[];
  const contactIds = [...new Set(rawRows.map((r) => str(r, "contact_id")).filter(Boolean))];
  const { contacts, error: contactsErr } = await getContactsByUuidsForProject(client, projectId, contactIds);
  if (contactsErr) return sendJson(res, 500, { error: contactsErr });

  const companyIds = [...new Set(rawRows.map((r) => str(r, "company_id")).filter(Boolean))];
  const companiesRes = await getCompaniesByIdsForProject(client, projectId, companyIds);
  if (companiesRes.error) return sendJson(res, 500, { error: companiesRes.error });

  const rows = rawRows
    .filter((r) => {
      const contactId = str(r, "contact_id");
      return contactId && contacts[contactId];
    })
    .map((r) => {
      const result = r.result && typeof r.result === "object" && !Array.isArray(r.result) ? (r.result as Json) : {};
      const contactId = str(r, "contact_id");
      const companyId = str(r, "company_id");
      const contact = contacts[contactId] as Json | undefined;
      const company = companiesRes.companies[companyId] as Json | undefined;
      return {
        id: str(r, "id"),
        contact_id: contactId,
        company_id: companyId || null,
        contact_name: contact ? contactName(contact) : contactId,
        company_name: strAny(company, "name") || strAny(contact, "company_name") || strAny(result, "company_name"),
        execution_id: str(r, "execution_id"),
        status: strAny(result, "status") || "unknown",
        sends: Array.isArray(result.sends) ? result.sends.map(String) : [],
        copy_ok: result.copy_ok === true,
        copy_violations: Array.isArray(result.copy_violations) ? result.copy_violations.map(String) : [],
        sender_profile_uuid: findNestedString(result, "sender_profile_uuid"),
        created_at: str(r, "created_at"),
        updated_at: str(r, "updated_at"),
      };
    })
    .filter((r) => r.status === "pending_approval" || r.status === "needs_human" || r.status === "sent")
    .slice(0, limit);

  sendJson(res, 200, { rows });
}

// --- POST /api/n8n/velvetech/drafts/approve ---------------------------------
export async function handleVelvetechDraftApprove(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });
  const body = await readJsonBody(req);
  const projectId = str(body, "projectId");
  const draftId = str(body, "draftId");
  if (!projectId || !draftId) return sendJson(res, 400, { error: "projectId and draftId are required" });

  const { data: row, error } = await client
    .from(N8N_WORKFLOW_RESULTS_TABLE)
    .select("*")
    .eq("id", draftId)
    .eq("workflow_name", "velvetech-reply")
    .maybeSingle();
  if (error) return sendJson(res, 500, { error: error.message });
  if (!row) return sendJson(res, 404, { error: "Draft not found" });

  const result = (row as Json).result && typeof (row as Json).result === "object" ? ((row as Json).result as Json) : {};
  // needs_human drafts are approvable too once the human has reviewed (and
  // usually edited) the sends; only already-sent / unknown states are refused.
  const draftStatus = strAny(result, "status");
  if (draftStatus !== "pending_approval" && draftStatus !== "needs_human") {
    return sendJson(res, 409, { error: `Draft status is ${draftStatus || "unknown"}` });
  }
  const leadUuid = str(row as Json, "contact_id") || findNestedString(result, "lead_uuid");
  const senderProfileUuid = findNestedString(result, "sender_profile_uuid");
  const editedSends = Array.isArray((body as Json).sends)
    ? ((body as Json).sends as unknown[]).map(String).map((s) => s.trim()).filter(Boolean)
    : null;
  const sends = editedSends && editedSends.length > 0
    ? editedSends
    : Array.isArray(result.sends) ? result.sends.map(String).map((s) => s.trim()).filter(Boolean) : [];
  if (!leadUuid) return sendJson(res, 400, { error: "Draft has no linked lead UUID" });
  if (!senderProfileUuid) return sendJson(res, 400, { error: "Draft has no sender profile UUID; rerun after an outbound sender exists" });
  if (sends.length === 0) return sendJson(res, 400, { error: "Draft has no sends[]" });
  if (draftStatus === "needs_human" && !editedSends) {
    return sendJson(res, 400, { error: "needs_human draft: review and pass edited sends[] to approve" });
  }

  const { contacts, error: contactsErr } = await getContactsByUuidsForProject(client, projectId, [leadUuid]);
  if (contactsErr) return sendJson(res, 500, { error: contactsErr });
  if (!contacts[leadUuid]) return sendJson(res, 403, { error: "Draft lead is not in this project" });

  const { credentials, error: credErr } = await getGetSalesCredentials(client, projectId);
  if (credErr) return sendJson(res, 400, { error: `GetSales credentials: ${credErr}` });
  if (!credentials) return sendJson(res, 400, { error: "GetSales credentials not configured" });

  const sent: Json[] = [];
  try {
    for (const text of sends) {
      const one = await sendLinkedInMessage(credentials, {
        senderProfileUuid,
        leadUuid,
        text,
        channel: "linkedin",
      });
      sent.push(one);
    }
  } catch (e) {
    return sendJson(res, 502, { error: e instanceof Error ? e.message : String(e), sent });
  }

  const updatedResult = {
    ...result,
    sends,
    status: "sent",
    sent_at: new Date().toISOString(),
    sent_messages: sent,
    ...(editedSends && editedSends.length > 0 ? { edited_before_send: true } : {}),
  };
  const { error: updErr } = await client
    .from(N8N_WORKFLOW_RESULTS_TABLE)
    .update({ result: updatedResult, updated_at: new Date().toISOString() })
    .eq("id", draftId);
  if (updErr) return sendJson(res, 500, { error: updErr.message, sent });
  sendJson(res, 200, { ok: true, sent });
}
