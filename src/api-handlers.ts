/**
 * HTTP handlers for Supabase state and sync. Used by Vercel serverless api/supabase-state and api/supabase-sync.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { getSupabase, getTableCounts, getLatestRows } from "./services/supabase.js";
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
