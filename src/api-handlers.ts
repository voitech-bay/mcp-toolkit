/**
 * HTTP handlers for Supabase state and sync. Used by Vercel serverless api/supabase-state and api/supabase-sync.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getSupabase,
  getTableCounts,
  getLatestRows,
  queryTableWithFilters,
  getConversation,
  listCompanyContextsByCompanyId,
  addCompanyContextEntry,
  getCompanyContextCounts,
  listContactContextsByContactId,
  addContactContextEntry,
  getContactContextCounts,
  getProjects,
  getProjectById,
  updateProjectCredentials,
  getProjectEntityCounts,
  getProjectLatestRows,
  getActiveSyncRun,
  getSyncHistory,
  createSyncRun,
  getAllCompanies,
  addCompaniesToProject,
  getProjectCompanies,
  getHypothesesWithCounts,
  getHypothesisTargets,
  createHypothesis,
  updateHypothesis,
  deleteHypothesis,
  addCompaniesToHypothesis,
  removeCompaniesFromHypothesis,
  getContextSnapshots,
  saveContextSnapshot,
  getConversationsList,
  type ConversationReplyTag,
  getCompanyHypotheses,
  getContactsByCompany,
  createCompany,
  updateContactCompany,
  getCompaniesByIds,
  type TableQueryFilters,
  listEnrichmentAgentsForEntityType,
  listAllEnrichmentAgents,
  createEnrichmentAgent,
  updateEnrichmentAgent,
  getEnrichmentTableData,
  listContactListsForProject,
  enqueueEnrichmentTasks,
  listEnrichmentQueueTasksForProject,
  listEnrichmentAgentRunsForProject,
  getEnrichmentBatchDetail,
  stopEnrichmentQueueTask,
  restartEnrichmentQueueTask,
  getEnrichmentPromptSettingsEffective,
  getEnrichmentPromptSettingsRow,
  upsertEnrichmentPromptSettings,
  getEnrichmentAgentResultsMapForEntity,
  getEnrichmentAgentByName,
  getCollectedAnalyticsDays,
  type EnrichmentEntityType,
} from "./services/supabase.js";
import { buildCompanyEntitiesForPrompt } from "./services/enrichment-entity-assembler.js";
import {
  resolvePromptForBatch,
  type EnrichmentEntityType as PromptEntityType,
} from "./services/prompt-resolver.js";
import {
  buildReplyContextPrompt,
  generateContextText,
  type BuildContextNodes,
} from "./services/reply-context-prompt.js";
import { syncSupabaseFromSource, syncAnalyticsSnapshots } from "./services/sync-supabase.js";
import {
  getActiveWorkers,
  isWorkerHeartbeatAuthOk,
  recordWorkerHeartbeat,
  type WorkerHeartbeatPayload,
  type WorkerPendingBatchProgress,
} from "./services/worker-registry.js";
import { persistWorkerPresenceToSupabase } from "./services/worker-presence-db.js";
import { getWorkersUiSnapshot } from "./services/worker-ui-snapshot.js";
import { broadcastEnrichmentBatchStarted } from "./services/enrichment-realtime.js";

export { generateContextText };

/** Read and parse JSON body from request (for POST). */
async function getParsedBody(req: IncomingMessage): Promise<unknown> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.includes("application/json")) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export type NodeHandler = (
  req: IncomingMessage,
  res: ServerResponse
) => Promise<void>;

export async function handleSupabaseState(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const limit = parseLatestLimit(req);
  const [countsResult, latestResult] = await Promise.all([
    getTableCounts(client),
    getLatestRows(client, limit),
  ]);
  if (countsResult.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: countsResult.error, counts: null, latest: null }));
    return;
  }
  res.writeHead(200);
  res.end(
    JSON.stringify({
      counts: countsResult.counts,
      latest: latestResult.error ? null : latestResult.latest,
      latestError: latestResult.error ?? undefined,
    })
  );
}

/** Parse ?latest=N from URL (default 10, max 100). */
function parseLatestLimit(req: IncomingMessage): number {
  const url = req.url ?? "";
  const q = url.includes("?") ? url.slice(url.indexOf("?")) : "";
  const params = new URLSearchParams(q);
  const n = params.get("latest");
  if (n == null) return 10;
  const parsed = parseInt(n, 10);
  if (Number.isNaN(parsed)) return 10;
  return Math.min(Math.max(parsed, 1), 100);
}

export async function handleSupabaseSync(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");

  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }

  const body = (await getParsedBody(req)) as { projectId?: string } | undefined;
  const projectId = body?.projectId;

  const { data: activeRun } = await getActiveSyncRun(client);
  if (activeRun) {
    res.writeHead(409);
    res.end(JSON.stringify({
      error: "sync already running",
      activeRunId: activeRun.id,
      activeProjectId: activeRun.project_id ?? null,
    }));
    return;
  }

  const runResult = await createSyncRun(client, projectId);
  if (runResult.error || !runResult.id) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: runResult.error ?? "Failed to create sync run" }));
    return;
  }

  const runId = runResult.id;

  res.writeHead(200);
  res.end(JSON.stringify({ runId }));

  syncSupabaseFromSource(projectId, runId).catch((err) => {
    console.error("[sync] background sync error:", err);
  });
}

/** GET /api/analytics-collected-days?projectId= — distinct snapshot dates already stored. */
export async function handleAnalyticsCollectedDays(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const projectId = getQueryParams(req).get("projectId");
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing projectId query parameter" }));
    return;
  }
  const { dates, error } = await getCollectedAnalyticsDays(client, projectId);
  if (error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ dates }));
}

/** POST /api/analytics-sync — body: { projectId, dateFrom, dateTo } (YYYY-MM-DD). */
export async function handleAnalyticsSync(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const body = (await getParsedBody(req)) as
    | { projectId?: string; dateFrom?: string; dateTo?: string }
    | undefined;
  const projectId = body?.projectId?.trim();
  const dateFrom = body?.dateFrom?.trim();
  const dateTo = body?.dateTo?.trim();
  if (!projectId || !dateFrom || !dateTo) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Body must include projectId, dateFrom, and dateTo (YYYY-MM-DD)" }));
    return;
  }
  const result = await syncAnalyticsSnapshots(projectId, dateFrom, dateTo);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify(result));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify(result));
}

/** Parse query string from req.url. */
function getQueryParams(req: IncomingMessage): URLSearchParams {
  const url = req.url ?? "";
  const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  return new URLSearchParams(q);
}

export async function handleSupabaseTableQuery(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const table = params.get("table");
  const validTables = ["contacts", "linkedin_messages", "senders"];
  if (!table || !validTables.includes(table)) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing or invalid query: table (contacts|linkedin_messages|senders)" }));
    return;
  }
  let filters: TableQueryFilters = {};
  const filtersParam = params.get("filters");
  if (filtersParam) {
    try {
      const decoded = decodeURIComponent(filtersParam);
      const parsed = JSON.parse(decoded) as TableQueryFilters;
      if (typeof parsed === "object" && parsed !== null) {
        filters = parsed;
      }
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "Invalid filters JSON" }));
      return;
    }
  }
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "25", 10) || 25, 1), 100);
  const offset = Math.max(parseInt(params.get("offset") ?? "0", 10) || 0, 0);
  const search = params.get("search") ?? undefined;
  const result = await queryTableWithFilters(client, table, { filters, search, limit, offset });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], total: 0, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data, total: result.total }));
}

export async function handleConversation(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const leadUuid = params.get("leadUuid") ?? undefined;
  const conversationUuid = params.get("conversationUuid") ?? undefined;
  const senderProfileUuid = params.get("senderProfileUuid") ?? undefined;
  const result = await getConversation(client, {
    leadUuid: leadUuid || undefined,
    conversationUuid: conversationUuid || undefined,
    senderProfileUuid: senderProfileUuid || undefined,
    messageLimit: Math.min(parseInt(params.get("limit") ?? "500", 10) || 500, 1000),
  });
  if (result.error) {
    res.writeHead(200);
    res.end(JSON.stringify({ contact: result.contact ?? null, messages: result.messages, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ contact: result.contact ?? null, messages: result.messages }));
}

export async function handleGetCompanyContext(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const companyId = params.get("company_id") ?? "";
  if (!companyId.trim()) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "company_id is required", data: null }));
    return;
  }
  const result = await listCompanyContextsByCompanyId(client, companyId);
  if (result.error) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: result.error, data: null }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

export async function handleSetCompanyContext(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST" && req.method !== "PUT") {
    res.writeHead(405, { Allow: "POST, PUT" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as { rootContext?: string; company_id?: string | null } | undefined;
  const companyId = body?.company_id != null ? (body.company_id === null ? null : String(body.company_id)) : null;
  const rootContext = body?.rootContext !== undefined ? (body.rootContext === null ? null : String(body.rootContext)) : null;
  if (!companyId || !companyId.trim()) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "company_id is required", data: null }));
    return;
  }
  const result = await addCompanyContextEntry(client, companyId, rootContext);
  if (result.error) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: result.error, data: null }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

/** GET /api/company-context-counts?company_ids=id1,id2,id3 → { data: { [id]: count } } */
export async function handleGetCompanyContextCounts(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const raw = params.get("company_ids") ?? "";
  const companyIds = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const result = await getCompanyContextCounts(client, companyIds);
  if (result.error) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: result.error, data: null }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

export async function handleGetContactContext(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const contactId = params.get("contact_id") ?? "";
  if (!contactId.trim()) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "contact_id is required", data: null }));
    return;
  }
  const result = await listContactContextsByContactId(client, contactId);
  if (result.error) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: result.error, data: null }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

export async function handleSetContactContext(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST" && req.method !== "PUT") {
    res.writeHead(405, { Allow: "POST, PUT" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as { rootContext?: string; contact_id?: string | null } | undefined;
  const contactId = body?.contact_id != null ? (body.contact_id === null ? null : String(body.contact_id)) : null;
  const rootContext = body?.rootContext !== undefined ? (body.rootContext === null ? null : String(body.rootContext)) : null;
  if (!contactId || !contactId.trim()) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "contact_id is required", data: null }));
    return;
  }
  const result = await addContactContextEntry(client, contactId, rootContext);
  if (result.error) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: result.error, data: null }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

/** GET /api/contact-context-counts?contact_ids=id1,id2,id3 → { data: { [id]: count } } */
export async function handleGetContactContextCounts(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const raw = params.get("contact_ids") ?? "";
  const contactIds = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const result = await getContactContextCounts(client, contactIds);
  if (result.error) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: result.error, data: null }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

// --- Project & Sync endpoints ---

export async function handleGetProjects(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const result = await getProjects(client);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

export async function handleUpdateProjectCredentials(
  req: IncomingMessage,
  res: ServerResponse,
  projectId: string
): Promise<void> {
  if (req.method !== "PUT") {
    res.writeHead(405, { Allow: "PUT" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const { data: project } = await getProjectById(client, projectId);
  if (!project) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: `Project not found: ${projectId}` }));
    return;
  }
  const body = (await getParsedBody(req)) as {
    apiKey?: string | null;
    baseUrl?: string | null;
  } | undefined;
  if (!body) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "JSON body required" }));
    return;
  }
  const result = await updateProjectCredentials(client, projectId, {
    apiKey: body.apiKey,
    baseUrl: body.baseUrl,
  });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true }));
}

export async function handleSyncPreflight(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId");
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing query param: projectId" }));
    return;
  }
  const [countsResult, latestResult, activeRunResult] = await Promise.all([
    getProjectEntityCounts(client, projectId),
    getProjectLatestRows(client, projectId, 3),
    getActiveSyncRun(client),
  ]);
  res.writeHead(200);
  res.end(JSON.stringify({
    projectId,
    counts: countsResult.counts,
    countsError: countsResult.error ?? undefined,
    latest: latestResult.latest,
    latestError: latestResult.error ?? undefined,
    activeSyncRun: activeRunResult.data
      ? { id: activeRunResult.data.id, project_id: activeRunResult.data.project_id }
      : null,
  }));
}

export async function handleSyncStatus(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const { data, error } = await getActiveSyncRun(client);
  if (error) {
    res.writeHead(500);
    res.end(JSON.stringify({ running: false, error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({
    running: data != null,
    activeRun: data
      ? {
          id: data.id,
          started_at: data.started_at,
          project_id: data.project_id,
        }
      : null,
  }));
}

export async function handleSyncHistory(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId") ?? undefined;
  const limitStr = params.get("limit");
  const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 20, 1), 100) : undefined;
  const result = await getSyncHistory(client, { projectId, limit });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

// --- Global companies list + project membership ---

export async function handleGetAllCompanies(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId") ?? undefined;
  const search = params.get("search") ?? undefined;
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "25", 10) || 25, 1), 100);
  const offset = Math.max(parseInt(params.get("offset") ?? "0", 10) || 0, 0);
  const result = await getAllCompanies(client, { search, limit, offset, projectId });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], total: 0, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data, total: result.total }));
}

export async function handleAddCompaniesToProject(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as { projectId?: string; companyIds?: string[] } | undefined;
  if (!body?.projectId || !Array.isArray(body.companyIds) || body.companyIds.length === 0) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Body must include projectId and non-empty companyIds array" }));
    return;
  }
  const result = await addCompaniesToProject(client, body.projectId, body.companyIds);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(201);
  res.end(JSON.stringify({ added: result.data.length, data: result.data }));
}

// --- Companies & Hypotheses endpoints ---

export async function handleGetProjectCompanies(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId");
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing query param: projectId" }));
    return;
  }
  const search = params.get("search") ?? undefined;
  const companyId = params.get("companyId") ?? undefined;
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "25", 10) || 25, 1), 100);
  const offset = Math.max(parseInt(params.get("offset") ?? "0", 10) || 0, 0);
  const result = await getProjectCompanies(client, projectId, { search, limit, offset, companyId });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], total: 0, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data, total: result.total }));
}

export async function handleGetHypotheses(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId");
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing query param: projectId" }));
    return;
  }
  const result = await getHypothesesWithCounts(client, projectId);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

export async function handleCreateHypothesis(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as {
    projectId?: string;
    name?: string;
    description?: string | null;
    targetPersona?: string | null;
  } | undefined;
  if (!body?.projectId || !body?.name) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Body must include projectId and name" }));
    return;
  }
  const result = await createHypothesis(client, {
    projectId: body.projectId,
    name: body.name,
    description: body.description,
    targetPersona: body.targetPersona,
  });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(201);
  res.end(JSON.stringify({ data: result.data }));
}

export async function handleUpdateHypothesis(
  req: IncomingMessage,
  res: ServerResponse,
  hypothesisId: string
): Promise<void> {
  if (req.method !== "PUT") {
    res.writeHead(405, { Allow: "PUT" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as {
    name?: string;
    description?: string | null;
    targetPersona?: string | null;
  } | undefined;
  if (!body) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "JSON body required" }));
    return;
  }
  const result = await updateHypothesis(client, hypothesisId, {
    name: body.name,
    description: body.description,
    targetPersona: body.targetPersona,
  });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true }));
}

export async function handleDeleteHypothesis(
  req: IncomingMessage,
  res: ServerResponse,
  hypothesisId: string
): Promise<void> {
  if (req.method !== "DELETE") {
    res.writeHead(405, { Allow: "DELETE" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const result = await deleteHypothesis(client, hypothesisId);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true }));
}

export async function handleGetHypothesisTargets(
  req: IncomingMessage,
  res: ServerResponse,
  hypothesisId: string
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const result = await getHypothesisTargets(client, hypothesisId);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

export async function handleAddHypothesisTargets(
  req: IncomingMessage,
  res: ServerResponse,
  hypothesisId: string
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as {
    projectCompanyIds?: string[];
    score?: number | null;
  } | undefined;
  if (!body?.projectCompanyIds || !Array.isArray(body.projectCompanyIds) || body.projectCompanyIds.length === 0) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Body must include non-empty projectCompanyIds array" }));
    return;
  }
  const result = await addCompaniesToHypothesis(client, {
    hypothesisId,
    projectCompanyIds: body.projectCompanyIds,
    score: body.score,
  });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(201);
  res.end(JSON.stringify({ ok: true, inserted: body.projectCompanyIds.length }));
}

export async function handleRemoveHypothesisTargets(
  req: IncomingMessage,
  res: ServerResponse,
  hypothesisId: string
): Promise<void> {
  if (req.method !== "DELETE") {
    res.writeHead(405, { Allow: "DELETE" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as { projectCompanyIds?: string[] } | undefined;
  if (!body?.projectCompanyIds || !Array.isArray(body.projectCompanyIds) || body.projectCompanyIds.length === 0) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Body must include non-empty projectCompanyIds array" }));
    return;
  }
  const result = await removeCompaniesFromHypothesis(client, {
    hypothesisId,
    projectCompanyIds: body.projectCompanyIds,
  });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true }));
}

// ── Context Snapshots list ───────────────────────────────────────────────────

export async function handleGetContextSnapshots(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId")?.trim();
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "projectId is required" }));
    return;
  }
  const limit = Math.min(parseInt(params.get("limit") ?? "50", 10) || 50, 200);
  const offset = Math.max(parseInt(params.get("offset") ?? "0", 10) || 0, 0);
  const result = await getContextSnapshots(client, { projectId, limit, offset });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], total: 0, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data, total: result.total }));
}

// ── Build Context ────────────────────────────────────────────────────────────

export async function handleBuildContext(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");

  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }

  const body = (await getParsedBody(req)) as {
    projectId?: string;
    name?: string;
    selectedNodes?: BuildContextNodes;
  } | undefined;

  const projectId = body?.projectId?.trim();
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "projectId is required" }));
    return;
  }

  const selectedNodes: BuildContextNodes = {
    hypotheses: body?.selectedNodes?.hypotheses ?? [],
    companies: body?.selectedNodes?.companies ?? [],
    contacts: body?.selectedNodes?.contacts ?? [],
    conversations: body?.selectedNodes?.conversations ?? [],
  };

  const contextText = await buildReplyContextPrompt(client, projectId, selectedNodes);

  const result = await saveContextSnapshot(client, {
    projectId,
    name: body?.name ?? null,
    nodes: selectedNodes as unknown as Record<string, unknown>,
    contextText,
  });

  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }

  res.writeHead(201);
  res.end(
    JSON.stringify({
      data: {
        id: result.data!.id,
        context_text: result.data!.context_text,
        created_at: result.data!.created_at,
      },
    })
  );
}

// ── Conversations list ────────────────────────────────────────────────────────

export async function handleGetConversationsList(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId");
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing query param: projectId" }));
    return;
  }
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "50", 10) || 50, 1), 200);
  const offset = Math.max(parseInt(params.get("offset") ?? "0", 10) || 0, 0);
  const search = params.get("search")?.trim() ?? "";
  const replyTagRaw = params.get("replyTag")?.trim() ?? "";
  const allowedTags = new Set<string>(["no_response", "waiting_for_response", "got_response"]);
  const replyTag: ConversationReplyTag | null =
    replyTagRaw && allowedTags.has(replyTagRaw) ? (replyTagRaw as ConversationReplyTag) : null;

  const result = await getConversationsList(client, projectId, {
    limit,
    offset,
    search: search || null,
    replyTag,
  });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], total: 0, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data, total: result.total }));
}

// ── Company hypotheses ────────────────────────────────────────────────────────

export async function handleGetCompanyHypotheses(
  req: IncomingMessage,
  res: ServerResponse,
  companyId: string
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId");
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing query param: projectId" }));
    return;
  }
  const result = await getCompanyHypotheses(client, companyId, projectId);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], projectCompanyId: null, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data, projectCompanyId: result.projectCompanyId }));
}

// ── Contacts by company ───────────────────────────────────────────────────────

export async function handleGetContactsByCompany(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const companyId = params.get("companyId");
  const projectId = params.get("projectId");
  if (!companyId || !projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing query params: companyId and projectId required" }));
    return;
  }
  const result = await getContactsByCompany(client, companyId, projectId);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

// ── Create company ────────────────────────────────────────────────────────────

export async function handleCreateCompany(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as { name?: string; domain?: string | null } | undefined;
  if (!body?.name?.trim()) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Body must include name" }));
    return;
  }
  const result = await createCompany(client, { name: body.name.trim(), domain: body.domain ?? null });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(201);
  res.end(JSON.stringify({ id: result.id }));
}

// ── Get companies by IDs ─────────────────────────────────────────────────────

export async function handleGetCompaniesByIds(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const ids = params.getAll("ids[]").concat(
    (params.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  );
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) {
    res.writeHead(200);
    res.end(JSON.stringify({ data: [] }));
    return;
  }
  const result = await getCompaniesByIds(client, unique);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

// ── Patch contact company ────────────────────────────────────────────────────

export async function handlePatchContactCompany(
  req: IncomingMessage,
  res: ServerResponse,
  contactId: string
): Promise<void> {
  if (req.method !== "PATCH") {
    res.writeHead(405, { Allow: "PATCH" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as { companyId?: string; companyName?: string | null } | undefined;
  if (!body?.companyId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Body must include companyId" }));
    return;
  }
  const result = await updateContactCompany(client, contactId, body.companyId, body.companyName ?? null);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true }));
}

// ── Enrichment table API ─────────────────────────────────────────────────────

function parseEnrichmentEntityType(raw: string | null): EnrichmentEntityType | null {
  if (raw === "company" || raw === "contact") return raw;
  return null;
}

/** GET /api/enrichment/agents?entityType=company|contact */
export async function handleGetEnrichmentAgents(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const entityType = parseEnrichmentEntityType(params.get("entityType"));
  if (!entityType) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing or invalid query: entityType (company|contact)" }));
    return;
  }
  const result = await listEnrichmentAgentsForEntityType(client, entityType);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

/** GET /api/contact-lists?projectId= — ContactLists rows for dropdowns (synced from GetSales). */
export async function handleGetContactLists(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId")?.trim();
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing query param: projectId" }));
    return;
  }
  const result = await listContactListsForProject(client, projectId);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error, data: [] }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

/** GET /api/enrichment-table?entityType=company|contact&projectId=...&limit=&offset=&listUuid= */
export async function handleGetEnrichmentTable(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const entityType = parseEnrichmentEntityType(params.get("entityType"));
  const projectId = params.get("projectId")?.trim();
  if (!entityType || !projectId) {
    res.writeHead(400);
    res.end(
      JSON.stringify({
        error: "Missing or invalid query: entityType (company|contact) and projectId are required",
      })
    );
    return;
  }
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "25", 10) || 25, 1), 100);
  const offset = Math.max(parseInt(params.get("offset") ?? "0", 10) || 0, 0);
  const listUuidRaw = params.get("listUuid")?.trim();
  const listUuid = listUuidRaw ? listUuidRaw : null;
  const result = await getEnrichmentTableData(client, projectId, entityType, limit, offset, listUuid);
  if (result.error) {
    res.writeHead(500);
    res.end(
      JSON.stringify({
        total: 0,
        agentNames: [],
        rows: [],
        error: result.error,
      })
    );
    return;
  }
  res.writeHead(200);
  res.end(
    JSON.stringify({
      total: result.total,
      agentNames: result.agentNames,
      rows: result.rows,
    })
  );
}

/** POST /api/enrichment/enqueue */
export async function handlePostEnrichmentEnqueue(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as
    | {
        projectId?: string;
        entityType?: string;
        agentName?: string;
        companyIds?: string[];
        contactIds?: string[];
        operationName?: string | null;
        meta?: Record<string, unknown> | null;
      }
    | undefined;
  const projectId = body?.projectId?.trim();
  const entityType = parseEnrichmentEntityType(
    body?.entityType != null ? String(body.entityType) : null
  );
  const agentName = body?.agentName?.trim();
  if (!projectId || !entityType || !agentName) {
    res.writeHead(400);
    res.end(
      JSON.stringify({
        error: "Body must include projectId, entityType (company|contact), and agentName",
      })
    );
    return;
  }
  const enqueueResult = await enqueueEnrichmentTasks(client, {
    projectId,
    entityType,
    agentName,
    companyIds: body?.companyIds,
    contactIds: body?.contactIds,
    operationName: body?.operationName,
    meta: body?.meta,
  });
  if (enqueueResult.error) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: enqueueResult.error, inserted: 0 }));
    return;
  }
  res.writeHead(201);
  res.end(JSON.stringify({ inserted: enqueueResult.inserted }));
}

/** GET /api/enrichment/agents/registry — all agents (admin). */
export async function handleGetEnrichmentAgentsRegistry(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const result = await listAllEnrichmentAgents(client);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

/** POST /api/enrichment/agents/registry — create agent. */
export async function handlePostEnrichmentAgent(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as
    | {
        name?: string;
        entity_type?: string;
        operation_name?: string | null;
        prompt?: string;
        batch_size?: number;
        is_active?: boolean;
      }
    | undefined;
  const result = await createEnrichmentAgent(client, {
    name: body?.name ?? "",
    entity_type: body?.entity_type ?? "",
    operation_name: body?.operation_name,
    prompt: body?.prompt,
    batch_size: body?.batch_size,
    is_active: body?.is_active,
  });
  if (result.error) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(201);
  res.end(JSON.stringify({ ok: true }));
}

/** PUT /api/enrichment/agents/registry — update agent by name. */
export async function handlePutEnrichmentAgent(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "PUT") {
    res.writeHead(405, { Allow: "PUT" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as
    | {
        name?: string;
        entity_type?: string;
        operation_name?: string | null;
        prompt?: string;
        batch_size?: number;
        is_active?: boolean;
      }
    | undefined;
  const name = body?.name?.trim();
  if (!name) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Body must include name" }));
    return;
  }
  const result = await updateEnrichmentAgent(client, name, {
    entity_type: body?.entity_type,
    operation_name: body?.operation_name,
    prompt: body?.prompt,
    batch_size: body?.batch_size,
    is_active: body?.is_active,
  });
  if (result.error) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true }));
}

/** GET /api/enrichment/queue?projectId=&limit=&offset=&status= */
export async function handleGetEnrichmentQueue(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId")?.trim();
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "projectId is required" }));
    return;
  }
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "25", 10) || 25, 1), 100);
  const offset = Math.max(parseInt(params.get("offset") ?? "0", 10) || 0, 0);
  const status = params.get("status")?.trim() || null;
  const result = await listEnrichmentQueueTasksForProject(client, projectId, {
    limit,
    offset,
    status,
  });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], total: 0, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data, total: result.total }));
}

/** GET /api/enrichment/runs?projectId=&limit=&offset=&status= */
export async function handleGetEnrichmentRunsList(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId")?.trim();
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "projectId is required" }));
    return;
  }
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "25", 10) || 25, 1), 100);
  const offset = Math.max(parseInt(params.get("offset") ?? "0", 10) || 0, 0);
  const status = params.get("status")?.trim() || null;
  const result = await listEnrichmentAgentRunsForProject(client, projectId, {
    limit,
    offset,
    status,
  });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], total: 0, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data, total: result.total }));
}

/** GET /api/enrichment/batch?batchId=&projectId= (optional project check) */
export async function handleGetEnrichmentBatchDetail(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const batchId = params.get("batchId")?.trim();
  if (!batchId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "batchId is required" }));
    return;
  }
  const projectId = params.get("projectId")?.trim() ?? null;
  const result = await getEnrichmentBatchDetail(client, batchId);
  if (result.error) {
    const notFound = result.error === "Batch not found";
    res.writeHead(notFound ? 404 : 500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  if (!result.data) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Batch not found" }));
    return;
  }
  if (projectId && result.data.batch.project_id !== projectId) {
    res.writeHead(403);
    res.end(JSON.stringify({ error: "batch does not belong to this project" }));
    return;
  }
  res.writeHead(200);
  res.end(
    JSON.stringify({
      batch: result.data.batch,
      runs: result.data.runs,
    })
  );
}

/** POST /api/enrichment/stop — body: { projectId, queueTaskId } */
export async function handlePostEnrichmentStop(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as
    | { projectId?: string; queueTaskId?: string }
    | undefined;
  const projectId = body?.projectId?.trim();
  const queueTaskId = body?.queueTaskId?.trim();
  if (!projectId || !queueTaskId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "projectId and queueTaskId are required" }));
    return;
  }
  const result = await stopEnrichmentQueueTask(client, projectId, queueTaskId);
  if (!result.ok) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: result.error ?? "Stop failed" }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true }));
}

/** POST /api/enrichment/restart — body: { projectId, queueTaskId } */
export async function handlePostEnrichmentRestart(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as
    | { projectId?: string; queueTaskId?: string }
    | undefined;
  const projectId = body?.projectId?.trim();
  const queueTaskId = body?.queueTaskId?.trim();
  if (!projectId || !queueTaskId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "projectId and queueTaskId are required" }));
    return;
  }
  const result = await restartEnrichmentQueueTask(client, projectId, queueTaskId);
  if (!result.ok) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: result.error ?? "Restart failed" }));
    return;
  }
  res.writeHead(201);
  res.end(JSON.stringify({ ok: true, newTaskId: result.newTaskId }));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** POST /api/workers/heartbeat — JSON body from worker processes. */
export async function handlePostWorkerHeartbeat(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  if (!isWorkerHeartbeatAuthOk(req)) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  const raw = await getParsedBody(req);
  if (!isRecord(raw)) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "JSON body required" }));
    return;
  }
  const workerId = parseString(raw.workerId);
  const name = parseString(raw.name);
  const kind = parseString(raw.kind) ?? "unknown";
  const statusRaw = parseString(raw.status);
  if (!workerId || !name) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "workerId and name are required" }));
    return;
  }
  const status =
    statusRaw === "idle" || statusRaw === "busy" || statusRaw === "stopping" ? statusRaw : "idle";

  let tasksInProgress: WorkerHeartbeatPayload["tasksInProgress"];
  if (Array.isArray(raw.tasksInProgress)) {
    tasksInProgress = [];
    for (const item of raw.tasksInProgress) {
      if (!isRecord(item)) continue;
      const taskId = parseString(item.taskId);
      const agentName = parseString(item.agentName);
      if (!taskId || !agentName) continue;
      const operationName =
        item.operationName === null || item.operationName === undefined
          ? undefined
          : typeof item.operationName === "string"
            ? item.operationName
            : String(item.operationName);
      tasksInProgress.push({ taskId, agentName, operationName });
    }
  }

  let pendingBatches: WorkerPendingBatchProgress[] | undefined;
  if (Array.isArray(raw.pendingBatches)) {
    pendingBatches = [];
    for (const item of raw.pendingBatches) {
      if (!isRecord(item)) continue;
      const agentName = parseString(item.agentName);
      const count = typeof item.count === "number" && Number.isFinite(item.count) ? item.count : 0;
      const batchSize =
        typeof item.batchSize === "number" && Number.isFinite(item.batchSize) ? item.batchSize : 1;
      const waitingSince =
        typeof item.waitingSince === "string" && item.waitingSince.trim()
          ? item.waitingSince.trim()
          : "";
      if (!agentName || !waitingSince) continue;
      pendingBatches.push({
        agentName,
        count: Math.max(0, Math.floor(count)),
        batchSize: Math.max(1, Math.floor(batchSize)),
        waitingSince,
      });
    }
  }

  let runtime: Record<string, string | number> | undefined;
  if (isRecord(raw.runtime)) {
    const out: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(raw.runtime)) {
      if (k.length > 80) continue;
      if (typeof v === "string" || typeof v === "number") {
        if (typeof v === "number" && !Number.isFinite(v)) continue;
        out[k] = v;
      }
    }
    if (Object.keys(out).length > 0) runtime = out;
  }

  const payload: WorkerHeartbeatPayload = {
    workerId,
    name,
    kind,
    status,
    tasksInProgress,
    pendingBatches,
    runtime,
  };
  await persistWorkerPresenceToSupabase(payload);
  recordWorkerHeartbeat(payload);
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true }));
}

/** GET /api/workers — recent worker heartbeats (for UI). */
export async function handleGetWorkers(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.writeHead(200);
  try {
    const snap = await getWorkersUiSnapshot();
    res.end(JSON.stringify(snap));
  } catch {
    res.end(JSON.stringify(getActiveWorkers()));
  }
}

function parseEntityTypeForPromptArg(raw: string | undefined): PromptEntityType {
  if (raw === "company" || raw === "contact" || raw === "both") return raw;
  return "both";
}

/** GET /api/enrichment/prompt-settings?projectId=uuid */
export async function handleGetEnrichmentPromptSettings(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId")?.trim();
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing query: projectId" }));
    return;
  }
  const [effective, projectRowRes, globalRowRes] = await Promise.all([
    getEnrichmentPromptSettingsEffective(client, projectId),
    getEnrichmentPromptSettingsRow(client, projectId),
    getEnrichmentPromptSettingsRow(client, null),
  ]);
  if (projectRowRes.error || globalRowRes.error) {
    res.writeHead(500);
    res.end(
      JSON.stringify({
        error: projectRowRes.error ?? globalRowRes.error ?? "Failed to load prompt settings rows",
      })
    );
    return;
  }
  res.writeHead(200);
  res.end(
    JSON.stringify({
      effective,
      projectRow: projectRowRes.data,
      globalRow: globalRowRes.data,
    })
  );
}

/** PATCH /api/enrichment/prompt-settings — body: { projectId: string | null, global_prompt_prefix?, global_prompt_suffix?, companies_placeholder_config? } */
export async function handlePatchEnrichmentPromptSettings(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "PATCH") {
    res.writeHead(405, { Allow: "PATCH" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const raw = await getParsedBody(req);
  if (!isRecord(raw)) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "JSON body required" }));
    return;
  }
  const projectIdRaw = raw.projectId;
  const projectId =
    projectIdRaw === null
      ? null
      : typeof projectIdRaw === "string"
        ? projectIdRaw.trim() || null
        : undefined;
  if (projectId === undefined) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "projectId is required (null for global row)" }));
    return;
  }
  const patch: {
    global_prompt_prefix?: string;
    global_prompt_suffix?: string;
    companies_placeholder_config?: Record<string, unknown>;
    prompt_profiles?: Record<string, unknown>;
  } = {};
  if (typeof raw.global_prompt_prefix === "string") {
    patch.global_prompt_prefix = raw.global_prompt_prefix;
  }
  if (typeof raw.global_prompt_suffix === "string") {
    patch.global_prompt_suffix = raw.global_prompt_suffix;
  }
  if (raw.companies_placeholder_config !== undefined) {
    if (!isRecord(raw.companies_placeholder_config)) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "companies_placeholder_config must be an object" }));
      return;
    }
    patch.companies_placeholder_config = raw.companies_placeholder_config;
  }
  if (raw.prompt_profiles !== undefined) {
    if (!isRecord(raw.prompt_profiles)) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "prompt_profiles must be an object" }));
      return;
    }
    patch.prompt_profiles = raw.prompt_profiles;
  }
  if (Object.keys(patch).length === 0) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "No fields to update" }));
    return;
  }
  const result = await upsertEnrichmentPromptSettings(client, projectId, patch);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true, row: result.data }));
}

/** POST /api/enrichment/prompt-preview — resolved prompt using same pipeline as the worker (company entities). */
export async function handlePostEnrichmentPromptPreview(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const raw = await getParsedBody(req);
  if (!isRecord(raw)) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "JSON body required" }));
    return;
  }
  const projectId = parseString(raw.projectId);
  const prompt = typeof raw.prompt === "string" ? raw.prompt : "";
  const agentName = parseString(raw.agentName);
  const batchSize = Math.max(
    1,
    Math.min(100, Number.parseInt(String(raw.batchSize ?? "1"), 10) || 1)
  );
  const rowKind = raw.rowKind === "contact" ? "contact" : "company";
  if (!projectId || !agentName) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "projectId and agentName are required" }));
    return;
  }
  const companyIdsRaw = raw.companyIds;
  const companyIds = Array.isArray(companyIdsRaw)
    ? companyIdsRaw
        .filter((x): x is string => typeof x === "string" && x.length > 0)
        .slice(0, 40)
    : [];

  if (rowKind === "company" && companyIds.length === 0) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "companyIds (non-empty array) required when rowKind is company" }));
    return;
  }

  const { data: agentRow } = await getEnrichmentAgentByName(client, agentName);
  const entityType = parseEntityTypeForPromptArg(agentRow?.entity_type);

  const systemPromptType =
    typeof raw.systemPromptType === "string" ? raw.systemPromptType.trim() : "";
  const settings = await getEnrichmentPromptSettingsEffective(
    client,
    projectId,
    systemPromptType || undefined
  );

  if (rowKind === "contact") {
    res.writeHead(400);
    res.end(
      JSON.stringify({
        error: "Contact preview is not implemented; use the table preview for contact rows.",
      })
    );
    return;
  }

  const assembled = await buildCompanyEntitiesForPrompt(
    client,
    projectId,
    companyIds,
    settings.companies_placeholder_config
  );
  if (assembled.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: assembled.error }));
    return;
  }
  const entities = assembled.entities;
  const refId = companyIds[0] ?? "";
  const agentResultsByAgentName = refId
    ? (await getEnrichmentAgentResultsMapForEntity(client, projectId, "company", refId)).data
    : {};

  const resolvedPrompt = resolvePromptForBatch(prompt, entities, {
    batchSize,
    entityType,
    rowKind: "company",
    agentResultsByAgentName,
  });
  const finalPrompt = `${settings.global_prompt_prefix}${resolvedPrompt}${settings.global_prompt_suffix}`;

  res.writeHead(200);
  res.end(
    JSON.stringify({
      resolvedPrompt,
      finalPrompt,
      entityCount: entities.length,
    })
  );
}

/** POST /api/enrichment/worker-batch-event — worker notifies UI that a batch run is starting (same auth as worker heartbeat). */
export async function handlePostEnrichmentWorkerBatchEvent(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  if (!isWorkerHeartbeatAuthOk(req)) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  const raw = await getParsedBody(req);
  if (!isRecord(raw)) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "JSON body required" }));
    return;
  }
  const projectId = parseString(raw.projectId);
  const agentName = parseString(raw.agentName);
  const workerName = parseString(raw.workerName) ?? null;
  if (!projectId || !agentName) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "projectId and agentName are required" }));
    return;
  }
  const itemsRaw = raw.items;
  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "items must be a non-empty array" }));
    return;
  }
  const items: Array<{ taskId: string; companyId: string | null; contactId: string | null }> = [];
  for (const el of itemsRaw) {
    if (!isRecord(el)) continue;
    const taskId = parseString(el.taskId);
    if (!taskId) continue;
    const companyId =
      el.companyId === undefined
        ? null
        : typeof el.companyId === "string"
          ? el.companyId
          : null;
    const contactId =
      el.contactId === undefined
        ? null
        : typeof el.contactId === "string"
          ? el.contactId
          : null;
    if (!companyId && !contactId) continue;
    items.push({ taskId, companyId, contactId });
  }
  if (items.length === 0) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "no valid items" }));
    return;
  }
  broadcastEnrichmentBatchStarted({ projectId, agentName, workerName, items });
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true, broadcast: items.length }));
}
