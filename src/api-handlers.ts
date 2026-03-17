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
  getCompanyContextByName,
  setCompanyRootContext,
  getProjects,
  getProjectById,
  updateProjectCredentials,
  getProjectEntityCounts,
  getProjectLatestRows,
  getActiveSyncRun,
  getSyncHistory,
  createSyncRun,
  type TableQueryFilters,
} from "./services/supabase.js";
import { syncSupabaseFromSource } from "./services/sync-supabase.js";

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
  const name = params.get("name") ?? "";
  const result = await getCompanyContextByName(client, name);
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
  const body = (await getParsedBody(req)) as { name?: string; rootContext?: string } | undefined;
  const name = typeof body?.name === "string" ? body.name : "";
  const rootContext = body?.rootContext !== undefined ? (body.rootContext === null ? null : String(body.rootContext)) : null;
  const result = await setCompanyRootContext(client, name, rootContext);
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
