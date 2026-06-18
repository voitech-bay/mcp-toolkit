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

// re-export for tests
export type { MessageRow };
