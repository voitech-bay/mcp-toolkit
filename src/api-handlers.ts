/**
 * HTTP handlers for Supabase state and sync. Used by Vercel serverless api/supabase-state and api/supabase-sync.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { getSupabase, getTableCounts, getLatestRows, queryTableWithFilters, getConversation, type TableQueryFilters } from "./services/supabase.js";
import { syncSupabaseFromSource } from "./services/sync-supabase.js";

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
  const result = await syncSupabaseFromSource();
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
