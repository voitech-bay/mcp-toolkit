/**
 * HTTP handlers for Supabase state and sync. Used by Vercel serverless api/supabase-state and api/supabase-sync.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { getSupabase, getTableCounts } from "./services/supabase.js";
import { syncSupabaseFromSource } from "./services/sync-supabase.js";

export type NodeHandler = (
  req: IncomingMessage,
  res: ServerResponse
) => Promise<void>;

export async function handleSupabaseState(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const { counts, error } = await getTableCounts(client);
  if (error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error, counts: null }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify(counts));
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
