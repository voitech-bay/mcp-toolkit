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
} from "./services/supabase.js";
import {
  buildReplyContextPrompt,
  generateContextText,
  type BuildContextNodes,
} from "./services/reply-context-prompt.js";
import { syncSupabaseFromSource } from "./services/sync-supabase.js";

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
