/**
 * HTTP handlers for the contact/company card pages. Additive and self-contained:
 * GET endpoints are read-only assemblies over existing tables (see
 * services/account-context.ts); the only write is the cached account summary,
 * stored as a typed JSON entry in CompaniesContext (never touches
 * AnalyticsSnapshots or any analytics table). Routes registered in api-server.ts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getSupabase,
  addCompanyContextEntry,
} from "./services/supabase.js";
import {
  buildContactCard,
  buildCompanyCard,
  groupMessagesIntoThreads,
  type AccountSummaryEntry,
  type MessageRow,
} from "./services/account-context.js";
import { buildLeadersList } from "./services/leaders-list.js";
import { syncMarkersForContacts } from "./services/getsales-markers.js";
import { CONTACTS_TABLE } from "./services/supabase.js";
import { generateOpenRouterMessage } from "./services/openrouter.js";

const SUMMARY_MODEL = () => process.env.ACCOUNT_SUMMARY_MODEL?.trim() || "google/gemma-4-31b-it";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Json = Record<string, unknown>;

function sendJson(res: ServerResponse, status: number, obj: unknown): void {
  res.setHeader("Content-Type", "application/json");
  res.writeHead(status);
  res.end(JSON.stringify(obj));
}

function queryParam(req: IncomingMessage, key: string): string {
  try {
    return new URL(req.url ?? "", "http://localhost").searchParams.get(key)?.trim() ?? "";
  } catch {
    return "";
  }
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

// --- GET /api/cards/contact?uuid= --------------------------------------------
export async function handleGetContactCard(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });
  const uuid = queryParam(req, "uuid");
  if (!UUID_RE.test(uuid)) return sendJson(res, 400, { error: "uuid must be a UUID" });
  const { data, error } = await buildContactCard(client, uuid);
  if (error) return sendJson(res, error === "Contact not found" ? 404 : 500, { error });
  sendJson(res, 200, data);
}

// --- GET /api/cards/company?id= -----------------------------------------------
export async function handleGetCompanyCard(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });
  const id = queryParam(req, "id");
  if (!UUID_RE.test(id)) return sendJson(res, 400, { error: "id must be a UUID" });
  const { data, error } = await buildCompanyCard(client, id);
  if (error) return sendJson(res, error === "Company not found" ? 404 : 500, { error });
  sendJson(res, 200, data);
}

// --- GET /api/lists/tagged?tag=<GetSalesTags uuid> ----------------------------
// Tag-backed record list for the lists-checker view (e.g. "MSSP Leaders in MENA").
// Read-only assembly across Contacts/companies/PipelineStages/n8n/FlowLeads/LinkedinMessages.
export async function handleGetTaggedList(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });
  const tag = queryParam(req, "tag");
  if (!UUID_RE.test(tag)) return sendJson(res, 400, { error: "tag must be a UUID" });

  // Refresh GetSales markers for contacts never synced so email/connection stats are accurate.
  const apiKey = process.env.GETSALES_FEASIBLE_API_KEY?.trim() ?? "";
  const teamId = process.env.GETSALES_FEASIBLE_TEAM_ID?.trim() ?? "";
  if (apiKey && teamId) {
    const { data: unsynced, error: unsyncedErr } = await client
      .from(CONTACTS_TABLE)
      .select("uuid")
      .contains("tags", JSON.stringify([tag]))
      .is("markers_synced_at", null);
    if (!unsyncedErr && unsynced?.length) {
      const uuids = ((unsynced ?? []) as { uuid: string }[]).map((r) => r.uuid).filter(Boolean);
      if (uuids.length) await syncMarkersForContacts(client, uuids, apiKey, teamId);
    }
  }

  const { data, error } = await buildLeadersList(client, tag);
  if (error) return sendJson(res, 500, { error });
  sendJson(res, 200, { data, total: data.length });
}

// --- POST /api/cards/company-summary { companyId } -----------------------------
// Generates the account-level summary across all conversations at the company and
// caches it as a typed CompaniesContext entry. Explicit user action (Regenerate
// button) — never called automatically.
export async function handlePostCompanySummary(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });
  const body = await readJsonBody(req);
  const companyId = typeof body.companyId === "string" ? body.companyId.trim() : "";
  if (!UUID_RE.test(companyId)) return sendJson(res, 400, { error: "companyId must be a UUID" });

  const { data: card, error: cardErr } = await buildCompanyCard(client, companyId);
  if (cardErr || !card) return sendJson(res, 500, { error: cardErr ?? "Failed to load company" });

  const company = card.company as Json;
  const contacts = (card.contacts as Json[]) ?? [];
  const threads = (card.conversations as ReturnType<typeof groupMessagesIntoThreads>) ?? [];
  const messageCount = Number(card.message_count ?? 0);

  if (!threads.length) {
    return sendJson(res, 400, { error: "No conversations at this account yet — nothing to summarize." });
  }

  const nameByLead = new Map<string, string>();
  for (const c of contacts) {
    const label =
      (typeof c.name === "string" && c.name) ||
      [c.first_name, c.last_name].filter((x) => typeof x === "string" && x).join(" ") ||
      "unknown";
    nameByLead.set(String(c.uuid ?? ""), label);
  }

  const threadBlocks = threads.slice(0, 20).map((t) => {
    const who = nameByLead.get(t.lead_uuid ?? "") ?? "unknown contact";
    const lines = t.messages
      .slice(-15)
      .map((m) => `${(m.type ?? "").toLowerCase() === "inbox" ? `${who} (prospect)` : "us"}: ${(m.text ?? "").slice(0, 500)}`)
      .filter((l) => l.length > 6);
    return `--- Conversation with ${who} (${t.message_count} msgs, status: ${t.reply_status}) ---\n${lines.join("\n")}`;
  });

  const systemPrompt =
    "You analyze B2B outreach conversations at one target account and return STRICT JSON only (no markdown, no preamble). " +
    'Schema: {"account_summary": "2-4 sentence plain-language summary of what is building at this account", ' +
    '"per_contact": [{"name": "...", "key_points": ["verbatim-faithful key points the prospect raised"], "stance": "positive|neutral|negative|no_reply"}], ' +
    '"suggested_next_step": "one concrete next action"}. ' +
    "Only include contacts that actually have messages. Key points must reflect what the prospect literally said (objections, interests, timing, tools mentioned) so a teammate can reference them later. No invented facts.";

  const userPrompt = [
    `Account: ${String(company.name ?? "")} (${String(company.domain ?? "")}, ${String(company.industry ?? "")})`,
    `Contacts at account: ${contacts.length}; conversations: ${threads.length}; total messages: ${messageCount}`,
    "",
    ...threadBlocks,
  ].join("\n");

  const { data: gen, error: genErr } = await generateOpenRouterMessage({
    model: SUMMARY_MODEL(),
    systemPrompt,
    userPrompt,
    temperature: 0.2,
  });
  if (genErr || !gen) return sendJson(res, 502, { error: genErr ?? "Summary generation failed" });

  let parsed: Json | null = null;
  try {
    const stripped = gen.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const v = JSON.parse(stripped) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) parsed = v as Json;
  } catch {
    /* fallthrough */
  }
  if (!parsed || typeof parsed.account_summary !== "string") {
    return sendJson(res, 502, { error: "Model returned unparsable summary", raw: gen.text.slice(0, 500) });
  }

  const entry: AccountSummaryEntry = {
    kind: "account_summary",
    generated_at: new Date().toISOString(),
    message_watermark: messageCount,
    model: gen.model,
    data: parsed,
  };
  const { error: saveErr } = await addCompanyContextEntry(client, companyId, JSON.stringify(entry));
  if (saveErr) return sendJson(res, 500, { error: `Summary generated but cache failed: ${saveErr}` });

  sendJson(res, 200, { account_summary: entry, account_summary_stale: false });
}

// --- PUT /api/contacts/meta?uuid= { lead_category?, priority? } ----------------
// Editable fields for the contact card: lead_category and priority.
const VALID_CATEGORIES = ["Founder/CEO", "Business Leader", "Technical Leader", "Engineer", "Sales", "Other"] as const;
const VALID_PRIORITIES = ["Top", "High", "Medium", "Low"] as const;

export async function handlePutContactMeta(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "PUT") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });
  const uuid = queryParam(req, "uuid");
  if (!UUID_RE.test(uuid)) return sendJson(res, 400, { error: "uuid must be a UUID" });
  const body = await readJsonBody(req);
  const patch: Record<string, string> = {};
  if (body.lead_category !== undefined) {
    const cat = typeof body.lead_category === "string" ? body.lead_category.trim() : "";
    if (!VALID_CATEGORIES.includes(cat as typeof VALID_CATEGORIES[number])) {
      return sendJson(res, 400, { error: `lead_category must be one of: ${VALID_CATEGORIES.join(", ")}` });
    }
    patch.lead_category = cat;
  }
  if (body.priority !== undefined) {
    const pri = typeof body.priority === "string" ? body.priority.trim() : "";
    if (!VALID_PRIORITIES.includes(pri as typeof VALID_PRIORITIES[number])) {
      return sendJson(res, 400, { error: `priority must be one of: ${VALID_PRIORITIES.join(", ")}` });
    }
    patch.priority = pri;
  }
  if (!Object.keys(patch).length) return sendJson(res, 400, { error: "No valid fields to update" });
  const { error } = await client.from("Contacts").update(patch).eq("uuid", uuid);
  if (error) return sendJson(res, 500, { error: error.message });
  sendJson(res, 200, { ok: true, updated: patch });
}

// --- POST /api/contacts/sync-markers { tag?, uuids? } -------------------------
// Syncs GetSales lead markers (email counts, connection date) into Contacts columns.
// Accepts either a tag UUID (syncs all tagged contacts) or an explicit uuids array.
export async function handlePostSyncMarkers(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });

  const apiKey = process.env.GETSALES_FEASIBLE_API_KEY?.trim() ?? "";
  const teamId = process.env.GETSALES_FEASIBLE_TEAM_ID?.trim() ?? "";
  if (!apiKey || !teamId) return sendJson(res, 500, { error: "GetSales credentials not configured" });

  const body = await readJsonBody(req);
  let uuids: string[] = [];

  if (typeof body.tag === "string" && UUID_RE.test(body.tag)) {
    // Resolve all contacts with this tag
    const { data, error } = await client
      .from(CONTACTS_TABLE)
      .select("uuid")
      .contains("tags", JSON.stringify([body.tag]));
    if (error) return sendJson(res, 500, { error: error.message });
    uuids = ((data ?? []) as { uuid: string }[]).map((r) => r.uuid).filter(Boolean);
  } else if (Array.isArray(body.uuids)) {
    uuids = (body.uuids as unknown[]).filter((v): v is string => typeof v === "string" && UUID_RE.test(v));
  }

  if (!uuids.length) return sendJson(res, 400, { error: "Provide tag (UUID) or uuids (array of UUIDs)" });
  if (uuids.length > 500) return sendJson(res, 400, { error: "Batch too large (max 500)" });

  const result = await syncMarkersForContacts(client, uuids, apiKey, teamId);
  sendJson(res, 200, { ok: true, total: uuids.length, ...result });
}

// --- POST /api/lists/tagged/remove { tag, uuids } ----------------------------
// Removes the given tag UUID from Contacts.tags for each listed contact UUID.
// Uses the remove_tag_from_contacts Postgres function for an atomic batch update.
export async function handlePostRemoveFromList(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  const client = getSupabase();
  if (!client) return sendJson(res, 500, { error: "Supabase not configured" });
  const body = await readJsonBody(req);
  const tag = typeof body.tag === "string" ? body.tag.trim() : "";
  if (!UUID_RE.test(tag)) return sendJson(res, 400, { error: "tag must be a UUID" });
  const uuids = Array.isArray(body.uuids)
    ? (body.uuids as unknown[]).filter((v): v is string => typeof v === "string" && UUID_RE.test(v))
    : [];
  if (!uuids.length) return sendJson(res, 400, { error: "uuids must be a non-empty array of UUIDs" });
  if (uuids.length > 200) return sendJson(res, 400, { error: "Batch too large (max 200)" });

  const { data, error } = await client.rpc("remove_tag_from_contacts", {
    p_uuids: uuids,
    p_tag_uuid: tag,
  });
  if (error) return sendJson(res, 500, { error: error.message });
  sendJson(res, 200, { ok: true, removed: data as number });
}

// re-export for tests
export type { MessageRow };
