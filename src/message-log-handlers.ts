/**
 * Message log: project-wide history of every message-generation attempt
 * (generated_messages) plus the edited version actually sent to the prospect
 * (the linked LinkedinMessages row, via generated_message_id). Grouped by contact
 * in the UI. Read-only. Route registered in api-server.ts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getSupabase,
  GENERATED_MESSAGES_TABLE,
  LINKEDIN_MESSAGES_TABLE,
  CONTACTS_TABLE,
} from "./services/supabase.js";

type Json = Record<string, unknown>;

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.setHeader("Content-Type", "application/json");
  res.writeHead(status);
  res.end(JSON.stringify(obj));
}

function s(obj: Json, key: string): string {
  const v = obj[key];
  return typeof v === "string" ? v : "";
}

// --- GET /api/message-log?projectId=&search=&limit=&offset= ------------------
export async function handleMessageLog(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });

  const url = new URL(req.url ?? "", "http://local");
  const projectId = url.searchParams.get("projectId")?.trim() ?? "";
  const search = url.searchParams.get("search")?.trim() ?? "";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 200, 1), 500);
  const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);

  let q = client
    .from(GENERATED_MESSAGES_TABLE)
    .select("id, contact_id, content, generation_context, created_at")
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (search) q = q.ilike("content", `%${search}%`);
  const { data, error } = await q;
  if (error) return sendJson(res, 500, { error: error.message });
  const gms = (data ?? []) as Json[];

  const contactIds = [...new Set(gms.map((g) => s(g, "contact_id")).filter(Boolean))];
  const gmIds = gms.map((g) => s(g, "id")).filter(Boolean);

  // Contacts (identity + project scope).
  const contactById = new Map<string, Json>();
  if (contactIds.length) {
    const { data: cs } = await client
      .from(CONTACTS_TABLE)
      .select("uuid, name, first_name, last_name, position, company_name, project_id, avatar_url")
      .in("uuid", contactIds);
    for (const c of (cs ?? []) as Json[]) contactById.set(String(c.uuid), c);
  }

  // Sent versions linked back to each generated message.
  const sentByGm = new Map<string, Json>();
  if (gmIds.length) {
    const { data: msgs } = await client
      .from(LINKEDIN_MESSAGES_TABLE)
      .select("uuid, generated_message_id, text, subject, sent_at, sender_profile_uuid, linkedin_type")
      .in("generated_message_id", gmIds);
    for (const m of (msgs ?? []) as Json[]) {
      const gid = s(m, "generated_message_id");
      // newest sent wins if multiple
      const prev = sentByGm.get(gid);
      if (!prev || String(m.sent_at ?? "") > String(prev.sent_at ?? "")) sentByGm.set(gid, m);
    }
  }

  const items = gms
    .map((g) => {
      const cid = s(g, "contact_id");
      const c = contactById.get(cid);
      if (projectId && c && typeof c.project_id === "string" && c.project_id !== projectId) return null;
      const name =
        (c && (s(c, "name").trim() || `${s(c, "first_name")} ${s(c, "last_name")}`.trim())) || "(unknown)";
      const sent = sentByGm.get(s(g, "id")) ?? null;
      return {
        id: s(g, "id"),
        contact_id: cid,
        contact_name: name,
        contact_avatar_url: c ? (c.avatar_url ?? null) : null,
        position: c ? s(c, "position") : "",
        company_name: c ? s(c, "company_name") : "",
        content: s(g, "content"),
        generation_context: (g.generation_context as Json) ?? null,
        created_at: s(g, "created_at"),
        sent: sent
          ? {
              text: s(sent, "text"),
              subject: s(sent, "subject"),
              sent_at: s(sent, "sent_at"),
              sender_profile_uuid: s(sent, "sender_profile_uuid"),
              channel: s(sent, "linkedin_type"),
            }
          : null,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  sendJson(res, 200, { items, total: items.length });
}
