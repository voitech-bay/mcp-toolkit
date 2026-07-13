import type { IncomingMessage, ServerResponse } from "node:http";
import { getSupabase } from "./services/supabase.js";

type Json = Record<string, unknown>;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function body(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try {
    const x = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    return x && typeof x === "object" && !Array.isArray(x) ? x as Json : {};
  } catch {
    return {};
  }
}

export async function handleUsers(req: IncomingMessage, res: ServerResponse) {
  const client = getSupabase();
  if (!client) return send(res, 500, { error: "Supabase not configured" });

  if (req.method === "GET") {
    const r = await client.from("users").select("id,name,color").order("name");
    return send(res, r.error ? 500 : 200, r.error ? { error: r.error.message } : { data: r.data ?? [] });
  }

  if (req.method === "POST") {
    const b = await body(req);
    const name = String(b.name ?? "").trim().slice(0, 80);
    const color = String(b.color ?? "#64748b").trim();
    if (!name) return send(res, 400, { error: "name is required" });
    if (!HEX_COLOR_RE.test(color)) return send(res, 400, { error: "color must be a hex color" });
    const r = await client
      .from("users")
      .insert({ name, color })
      .select("id,name,color")
      .single();
    return send(res, r.error ? 500 : 201, r.error ? { error: r.error.message } : { data: r.data });
  }

  res.writeHead(405);
  res.end();
}
