import type { IncomingMessage, ServerResponse } from "node:http";
import { appendFileSync } from "node:fs";
import { CONTACTS_TABLE, getGetSalesCredentials, getSupabase } from "./services/supabase.js";
import { createLeadCustomField, listLeadCustomFields, updateLeadCustomFields } from "./services/source-api.js";
import { GETSALES_INMAIL_FIELD_NAMES, arrangeGetSalesFields } from "./services/inmail-review.js";
import { normalizeOutreachMessageChannel } from "./services/email-studio.js";
import { linkedinSlugFromUrl } from "./services/n8n-entity-link.js";
import { extractPovFacts, loadLatestPovRows, resolveCompanyKeys } from "./services/pov-facts.js";
import { htmlToPlaintext } from "./services/html-plaintext.js";
import { upsertLeadWithVariables } from "./services/instantly.js";
import { assembleWelloreResearch } from "./launcher-handlers.js";

type Json = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINKEDIN_CHANNELS = ["linkedin_dm", "linkedin_inmail"] as const;
const NEEDS_ATTENTION_STATUSES = new Set(["ai_draft_made", "needs_review", "comments_made", "regenerated", "final_check", "changes_requested", "research_missing", "generation_failed", "sending_failed"]);
const GETSALES_LI_MSG_RE = /^li_msg_(?:\d+|1a|1b|2a|2b|3|4a|4b|4c|5a|5b)$/;

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function reqUrl(req: IncomingMessage) {
  return new URL(req.url ?? "", "http://localhost");
}

async function readBody(req: IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Json : {};
  } catch {
    return {};
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function csv(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function dayStart(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : null;
}

function dayEnd(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : null;
}

function dateMs(value: unknown): number {
  const raw = str(value);
  const ms = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

function actorUserId(req: IncomingMessage): string | null {
  const value = String(req.headers["x-user-id"] ?? "").trim();
  return UUID_RE.test(value) ? value : null;
}

function contactName(row: Json): string {
  const name = str(row.name);
  if (name) return name;
  return [str(row.first_name), str(row.last_name)].filter(Boolean).join(" ") || "Unknown";
}

function statusSummary(messages: Json[]) {
  const byChannel: Record<string, { total: number; approved: number; needsReview: number; pushed: number; latestStatus: string | null }> = {};
  for (const channel of ["email", ...LINKEDIN_CHANNELS]) {
    byChannel[channel] = { total: 0, approved: 0, needsReview: 0, pushed: 0, latestStatus: null };
  }
  for (const msg of messages) {
    const channel = normalizeOutreachMessageChannel(msg.channel, "email");
    const item = byChannel[channel] ?? (byChannel[channel] = { total: 0, approved: 0, needsReview: 0, pushed: 0, latestStatus: null });
    const status = str(msg.status);
    item.total += 1;
    if (status === "approved" || status === "sent") item.approved += 1;
    if (["ai_draft_made", "needs_review", "comments_made", "regenerated", "final_check", "changes_requested"].includes(status)) item.needsReview += 1;
    if (msg.external_pushed_at) item.pushed += 1;
    if (!item.latestStatus) item.latestStatus = status || null;
  }
  return byChannel;
}

async function hypothesisScope(client: NonNullable<ReturnType<typeof getSupabase>>, hypothesisId: string) {
  const out = { sequenceIds: new Set<string>(), companyIds: new Set<string>() };
  if (!validUuid(hypothesisId)) return out;
  const [sequences, targets] = await Promise.all([
    client.from("outreach_sequences").select("id").eq("hypothesis_id", hypothesisId).limit(1000),
    client
      .from("hypothesis_targets")
      .select("project_companies(company_id)")
      .eq("hypothesis_id", hypothesisId)
      .limit(2000),
  ]);
  for (const row of (sequences.data ?? []) as Json[]) {
    const id = str(row.id);
    if (id) out.sequenceIds.add(id);
  }
  for (const row of (targets.data ?? []) as Json[]) {
    const pc = row.project_companies as Json | Json[] | null | undefined;
    const companyId = Array.isArray(pc) ? str(pc[0]?.company_id) : str(pc?.company_id);
    if (companyId) out.companyIds.add(companyId);
  }
  return out;
}

type FitMeta = { persona: string; fit_score: number; contact_key: string };

const PERSONA_RANK: Record<string, number> = { it: 0, ops: 1, finance: 2 };

function personaRank(persona: string): number {
  return PERSONA_RANK[persona] ?? 99;
}

function fitFromRow(row: Json): FitMeta {
  const persona = str(row.persona).toLowerCase() || "other";
  const fitRaw = row.fit_score ?? row.fitScore ?? row.score;
  const fit_score = typeof fitRaw === "number" && Number.isFinite(fitRaw) ? fitRaw : Number(fitRaw) || 0;
  return { persona, fit_score, contact_key: str(row.contact_key).toLowerCase() };
}

/** Resolve POV fit_contacts for a company to CRM Contact uuids + persona/fit meta. */
async function resolveEligibleContactsForCompany(
  client: NonNullable<ReturnType<typeof getSupabase>>,
  projectId: string,
  companyId: string
): Promise<{ companyName: string | null; metaByUuid: Map<string, FitMeta> }> {
  const company = await client
    .from("companies")
    .select("id, name, domain, website")
    .eq("id", companyId)
    .maybeSingle();
  if (company.error) throw new Error(company.error.message);
  const companyName = str((company.data as Json | null)?.name) || null;
  const allKeys = await resolveCompanyKeys(client, {
    projectId,
    companyId: null,
    extraKeys: [
      str((company.data as Json | null)?.domain),
      str((company.data as Json | null)?.website),
    ].filter(Boolean),
  });

  const povRows = await loadLatestPovRows(client, [companyId], allKeys);
  const pov = povRows[0];
  const result = (pov?.result && typeof pov.result === "object" ? pov.result : {}) as Json;
  const fitContacts = Array.isArray(result.fit_contacts) ? (result.fit_contacts as Json[]) : [];
  if (!fitContacts.length) return { companyName, metaByUuid: new Map() };

  const directIds = new Set<string>();
  const pending: Array<{ meta: FitMeta; contactId: string; contactKey: string; linkedin: string }> = [];

  for (const raw of fitContacts) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Json;
    const meta = fitFromRow(row);
    const contactId = str(row.contact_id || row.contactId || row.uuid);
    const contactKey = str(row.contact_key).toLowerCase();
    const linkedin =
      linkedinSlugFromUrl(str(row.linkedin_url) || str(row.linkedin)) ||
      (contactKey && !contactKey.includes(".") ? contactKey : "");
    if (validUuid(contactId)) directIds.add(contactId);
    pending.push({ meta, contactId, contactKey, linkedin });
  }

  const roster = await client
    .from(CONTACTS_TABLE)
    .select("uuid, linkedin, company_uuid")
    .eq("project_id", projectId)
    .eq("company_uuid", companyId)
    .limit(500);
  if (roster.error) throw new Error(roster.error.message);

  const byUuid = new Map<string, Json>();
  const bySlug = new Map<string, string>();
  for (const row of (roster.data ?? []) as Json[]) {
    const uuid = str(row.uuid);
    if (!uuid) continue;
    byUuid.set(uuid, row);
    const slug = linkedinSlugFromUrl(str(row.linkedin)) || str(row.linkedin).toLowerCase();
    if (slug) bySlug.set(slug, uuid);
  }

  // Also fetch any direct UUIDs not in the company roster (mislinked company_uuid).
  const missingDirect = [...directIds].filter((id) => !byUuid.has(id));
  if (missingDirect.length) {
    const extra = await client
      .from(CONTACTS_TABLE)
      .select("uuid, linkedin, company_uuid")
      .eq("project_id", projectId)
      .in("uuid", missingDirect);
    if (extra.error) throw new Error(extra.error.message);
    for (const row of (extra.data ?? []) as Json[]) {
      const uuid = str(row.uuid);
      if (!uuid) continue;
      byUuid.set(uuid, row);
      const slug = linkedinSlugFromUrl(str(row.linkedin)) || str(row.linkedin).toLowerCase();
      if (slug) bySlug.set(slug, uuid);
    }
  }

  const metaByUuid = new Map<string, FitMeta>();
  for (const item of pending) {
    let uuid = "";
    if (validUuid(item.contactId) && byUuid.has(item.contactId)) uuid = item.contactId;
    else if (item.linkedin && bySlug.has(item.linkedin)) uuid = bySlug.get(item.linkedin) || "";
    else if (item.contactKey && bySlug.has(item.contactKey)) uuid = bySlug.get(item.contactKey) || "";
    if (!uuid) continue;
    const prev = metaByUuid.get(uuid);
    if (!prev || item.meta.fit_score > prev.fit_score) metaByUuid.set(uuid, item.meta);
  }

  return { companyName, metaByUuid };
}


export async function handleSequenceStudioLeads(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" });
  const q = reqUrl(req).searchParams;
  const projectId = q.get("projectId") ?? "";
  if (!validUuid(projectId)) return send(res, 400, { error: "projectId is required" });
  const page = Math.max(1, Number(q.get("page") ?? 1));
  const pageSize = Math.min(100, Math.max(1, Number(q.get("pageSize") ?? 25)));
  const from = (page - 1) * pageSize;
  const search = str(q.get("search"));
  const companySearch = str(q.get("company"));
  const statuses = csv(q.get("status"));
  const channels = csv(q.get("channel")).map((channel) => normalizeOutreachMessageChannel(channel, "email"));
  const draftState = str(q.get("draftState")) || "all";
  const sendState = str(q.get("sendState")) || "all";
  const campaign = str(q.get("campaign"));
  const batch = str(q.get("batch"));
  const sequenceId = str(q.get("sequenceId"));
  const hypothesisId = str(q.get("hypothesisId"));
  const createdFrom = dayStart(str(q.get("createdFrom")));
  const createdTo = dayEnd(str(q.get("createdTo")));
  const sentFrom = dayStart(str(q.get("sentFrom")));
  const sentTo = dayEnd(str(q.get("sentTo")));
  const sortBy = str(q.get("sortBy")) || "latest_draft";
  const sortDir = str(q.get("sortDir")) === "asc" ? "asc" : "desc";
  const companyId = str(q.get("companyId"));
  const eligibleOnly = q.get("eligible") === "1" || q.get("eligible") === "true";
  const requiresMessageScan = Boolean(statuses.length || channels.length || draftState !== "all" || sendState !== "all" || campaign || batch || validUuid(sequenceId) || validUuid(hypothesisId) || createdFrom || createdTo || sentFrom || sentTo || ["latest_draft", "email_created", "sent_at"].includes(sortBy));
  // #region agent log
  appendFileSync("/opt/cursor/logs/debug.log", JSON.stringify({ hypothesisId: "A,B,C,E", location: "sequence-studio-handlers.ts:handleSequenceStudioLeads:entry", message: "Sequence Studio list request parsed", data: { projectIdValid: validUuid(projectId), page, pageSize, statusesCount: statuses.length, channelsCount: channels.length, draftState, sendState, sortBy, hasCompanyId: Boolean(companyId), eligibleOnly, requiresMessageScan }, timestamp: Date.now() }) + "\n");
  // #endregion
  const hypothesis = await hypothesisScope(client, hypothesisId);

  let scopeCompanyName: string | null = null;
  let eligibleMeta = new Map<string, FitMeta>();
  if (eligibleOnly) {
    if (!validUuid(companyId)) return send(res, 400, { error: "companyId is required when eligible=1" });
    try {
      const resolved = await resolveEligibleContactsForCompany(client, projectId, companyId);
      scopeCompanyName = resolved.companyName;
      eligibleMeta = resolved.metaByUuid;
    } catch (e) {
      return send(res, 500, { error: e instanceof Error ? e.message : "Failed to resolve eligible contacts" });
    }
    if (!eligibleMeta.size) {
      return send(res, 200, {
        data: [],
        total: 0,
        page,
        pageSize,
        scope: { companyId, companyName: scopeCompanyName, eligible: true, eligibleCount: 0 },
      });
    }
  } else if (validUuid(companyId)) {
    const company = await client.from("companies").select("name").eq("id", companyId).maybeSingle();
    scopeCompanyName = str((company.data as Json | null)?.name) || null;
  }

  let contactsQuery = client
    .from(CONTACTS_TABLE)
    .select("uuid, name, first_name, last_name, avatar_url, company_name, company_uuid, position, linkedin, work_email, created_at", { count: "exact" })
    .eq("project_id", projectId);
  if (search) {
    const safe = search.replace(/[%_,()]/g, "");
    contactsQuery = contactsQuery.or(`name.ilike.%${safe}%,first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,company_name.ilike.%${safe}%,position.ilike.%${safe}%`);
  }
  if (companySearch) contactsQuery = contactsQuery.ilike("company_name", `%${companySearch.replace(/[%_]/g, "")}%`);
  if (validUuid(companyId)) contactsQuery = contactsQuery.eq("company_uuid", companyId);
  if (eligibleOnly) contactsQuery = contactsQuery.in("uuid", [...eligibleMeta.keys()]);
  if (hypothesis.companyIds.size) contactsQuery = contactsQuery.in("company_uuid", [...hypothesis.companyIds]);
  const contactSort =
    sortBy === "contact_name" ? "first_name" :
    sortBy === "company_name" ? "company_name" :
    "created_at";
  // Eligible / company-scoped lists are small; load the full matching set then sort/paginate in memory.
  const companyScoped = validUuid(companyId) || eligibleOnly;
  // #region agent log
  appendFileSync("/opt/cursor/logs/debug.log", JSON.stringify({ hypothesisId: "A,B,E", location: "sequence-studio-handlers.ts:handleSequenceStudioLeads:beforeContacts", message: "Executing contacts query", data: { table: CONTACTS_TABLE, contactSort, from, rangeEnd: requiresMessageScan || companyScoped ? 2499 : from + pageSize - 1, hasSearch: Boolean(search), hasCompanySearch: Boolean(companySearch), companyScoped }, timestamp: Date.now() }) + "\n");
  // #endregion
  const contacts = await contactsQuery
    .order(contactSort, { ascending: sortDir === "asc", nullsFirst: false })
    .range(requiresMessageScan || companyScoped ? 0 : from, requiresMessageScan || companyScoped ? 2499 : from + pageSize - 1);
  // #region agent log
  appendFileSync("/opt/cursor/logs/debug.log", JSON.stringify({ hypothesisId: "A,B,E", location: "sequence-studio-handlers.ts:handleSequenceStudioLeads:afterContacts", message: "Contacts query completed", data: { rowCount: contacts.data?.length ?? 0, count: contacts.count ?? null, error: contacts.error ? { message: contacts.error.message, code: contacts.error.code, details: contacts.error.details, hint: contacts.error.hint } : null }, timestamp: Date.now() }) + "\n");
  // #endregion
  if (contacts.error) return send(res, 500, { error: contacts.error.message });
  const rows = (contacts.data ?? []) as Json[];
  const contactIds = rows.map((row) => String(row.uuid));

  const buildMessageQuery = (ids: string[]) => {
    let query = client
      .from("outreach_emails")
      .select("id, contact_id, channel, step_number, sequence_step, status, current_subject, current_body, campaign_id, batch_name, sequence_id, external_target, external_pushed_at, created_at, sent_at, updated_at")
      .eq("project_id", projectId)
      .in("contact_id", ids);
    if (statuses.length) {
      const expanded = statuses.includes("needs_attention")
        ? [...new Set([...statuses.filter((s) => s !== "needs_attention"), ...NEEDS_ATTENTION_STATUSES])]
        : statuses;
      query = query.in("status", expanded);
    }
    if (channels.length) query = query.in("channel", [...new Set(channels)]);
    if (campaign) query = query.ilike("campaign_id", `%${campaign.replace(/[%_]/g, "")}%`);
    if (batch) query = query.ilike("batch_name", `%${batch.replace(/[%_]/g, "")}%`);
    if (validUuid(sequenceId)) query = query.eq("sequence_id", sequenceId);
    if (hypothesis.sequenceIds.size) query = query.in("sequence_id", [...hypothesis.sequenceIds]);
    if (createdFrom) query = query.gte("created_at", createdFrom);
    if (createdTo) query = query.lte("created_at", createdTo);
    if (sentFrom) query = query.gte("sent_at", sentFrom);
    if (sentTo) query = query.lte("sent_at", sentTo);
    return query.order("updated_at", { ascending: false }).limit(5000);
  };
  const messageQuery = contactIds.length > 0;
  // #region agent log
  appendFileSync("/opt/cursor/logs/debug.log", JSON.stringify({ hypothesisId: "C,D", location: "sequence-studio-handlers.ts:handleSequenceStudioLeads:beforeMessages", message: "Executing outreach messages query", data: { contactIdCount: contactIds.length, hasMessageQuery: Boolean(messageQuery), statusesCount: statuses.length, channelsCount: channels.length, hasSentRange: Boolean(sentFrom || sentTo) }, timestamp: Date.now() }) + "\n");
  // #endregion
  const messageRows: Json[] = [];
  let messageError: { message: string; code?: string; details?: string; hint?: string } | null = null;
  for (let i = 0; i < contactIds.length; i += 100) {
    const result = await buildMessageQuery(contactIds.slice(i, i + 100));
    if (result.error) {
      messageError = result.error;
      break;
    }
    messageRows.push(...(result.data ?? []) as Json[]);
  }
  messageRows.sort((a, b) => dateMs(b.updated_at) - dateMs(a.updated_at));
  const messages = { data: messageRows.slice(0, 5000), error: messageError };
  // #region agent log
  appendFileSync("/opt/cursor/logs/debug.log", JSON.stringify({ hypothesisId: "C,D", location: "sequence-studio-handlers.ts:handleSequenceStudioLeads:afterMessages", message: "Outreach messages query completed", data: { rowCount: messages.data?.length ?? 0, error: messages.error ? { message: messages.error.message, code: messages.error.code, details: messages.error.details, hint: messages.error.hint } : null }, timestamp: Date.now() }) + "\n");
  // #endregion
  if (messages.error) return send(res, 500, { error: messages.error.message });

  const byContact = new Map<string, Json[]>();
  for (const msg of (messages.data ?? []) as Json[]) {
    const id = String(msg.contact_id ?? "");
    byContact.set(id, [...(byContact.get(id) ?? []), msg]);
  }

  let data = rows.map((row) => {
    const drafts = byContact.get(String(row.uuid)) ?? [];
    const fit = eligibleMeta.get(String(row.uuid));
    return {
      contact: { ...row, display_name: contactName(row) },
      draftCount: drafts.length,
      statusSummary: statusSummary(drafts),
      latestDraft: drafts[0] ?? null,
      messages: drafts,
      persona: fit?.persona ?? null,
      fit_score: fit?.fit_score ?? null,
      contact_key: fit?.contact_key ?? null,
    };
  });
  if (requiresMessageScan) {
    data = data.filter((row) => {
      const drafts = row.messages;
      if (draftState === "has_drafts" && drafts.length === 0) return false;
      if (draftState === "no_drafts" && drafts.length > 0) return false;
      if (draftState === "needs_attention" && !drafts.some((m) => NEEDS_ATTENTION_STATUSES.has(str(m.status)))) return false;
      if (draftState === "approved" && !drafts.some((m) => str(m.status) === "approved")) return false;
      if (draftState === "sent" && !drafts.some((m) => str(m.status) === "sent" || m.sent_at)) return false;
      if (sendState === "sent" && !drafts.some((m) => str(m.status) === "sent" || m.sent_at)) return false;
      if (sendState === "unsent" && drafts.some((m) => str(m.status) === "sent" || m.sent_at)) return false;
      if (sendState === "pushed" && !drafts.some((m) => m.external_pushed_at)) return false;
      if (sendState === "not_pushed" && drafts.some((m) => m.external_pushed_at)) return false;
      if ((statuses.length || channels.length || campaign || batch || validUuid(sequenceId) || createdFrom || createdTo || sentFrom || sentTo || hypothesis.sequenceIds.size) && drafts.length === 0) return false;
      return true;
    });
  }
  const useEligibleSort = eligibleOnly || (validUuid(companyId) && sortBy === "latest_draft");
  data.sort((a, b) => {
    if (useEligibleSort) {
      const pr = personaRank(str(a.persona)) - personaRank(str(b.persona));
      if (pr !== 0) return pr;
      const fitDiff = Number(b.fit_score ?? 0) - Number(a.fit_score ?? 0);
      if (fitDiff !== 0) return fitDiff;
      return String(a.contact.display_name ?? "").localeCompare(String(b.contact.display_name ?? ""));
    }
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortBy === "contact_name") return dir * String(a.contact.display_name ?? "").localeCompare(String(b.contact.display_name ?? ""));
    if (sortBy === "company_name") return dir * String((a.contact as Json).company_name ?? "").localeCompare(String((b.contact as Json).company_name ?? ""));
    const aDrafts = a.messages ?? [];
    const bDrafts = b.messages ?? [];
    const aTime =
      sortBy === "email_created" ? Math.max(0, ...aDrafts.map((m) => dateMs(m.created_at))) :
      sortBy === "sent_at" ? Math.max(0, ...aDrafts.map((m) => dateMs(m.sent_at))) :
      sortBy === "contact_created" ? dateMs((a.contact as Json).created_at) :
      Math.max(0, ...aDrafts.map((m) => dateMs(m.updated_at)), dateMs((a.contact as Json).created_at));
    const bTime =
      sortBy === "email_created" ? Math.max(0, ...bDrafts.map((m) => dateMs(m.created_at))) :
      sortBy === "sent_at" ? Math.max(0, ...bDrafts.map((m) => dateMs(m.sent_at))) :
      sortBy === "contact_created" ? dateMs((b.contact as Json).created_at) :
      Math.max(0, ...bDrafts.map((m) => dateMs(m.updated_at)), dateMs((b.contact as Json).created_at));
    return dir * (aTime - bTime);
  });
  const total = requiresMessageScan || companyScoped ? data.length : contacts.count ?? data.length;
  const pageData = requiresMessageScan || companyScoped ? data.slice(from, from + pageSize) : data;
  // #region agent log
  appendFileSync("/opt/cursor/logs/debug.log", JSON.stringify({ hypothesisId: "A,B,C,D,E", location: "sequence-studio-handlers.ts:handleSequenceStudioLeads:exit", message: "Sequence Studio list response ready", data: { total, pageRowCount: pageData.length }, timestamp: Date.now() }) + "\n");
  // #endregion
  return send(res, 200, {
    data: pageData,
    total,
    page,
    pageSize,
    scope: validUuid(companyId)
      ? {
          companyId,
          companyName: scopeCompanyName || str((pageData[0]?.contact as Json | undefined)?.company_name) || null,
          eligible: eligibleOnly,
          eligibleCount: eligibleOnly ? eligibleMeta.size : null,
        }
      : null,
  });
}

export async function handleSequenceStudioLead(req: IncomingMessage, res: ServerResponse, contactId: string) {
  if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" });
  const projectId = reqUrl(req).searchParams.get("projectId") ?? "";
  if (!validUuid(projectId) || !validUuid(contactId)) return send(res, 400, { error: "projectId and contactId are required" });

  const contact = await client
    .from(CONTACTS_TABLE)
    .select("uuid, name, first_name, last_name, avatar_url, company_name, company_uuid, position, linkedin, work_email, created_at")
    .eq("project_id", projectId)
    .eq("uuid", contactId)
    .maybeSingle();
  if (contact.error) return send(res, 500, { error: contact.error.message });
  if (!contact.data) return send(res, 404, { error: "Contact not found" });
  const contactRow = contact.data as Json;

  // POV rows are frequently keyed only by company domain (result.company_key),
  // so resolve the contact's company domain / website host to match those rows too.
  const emailDomain = str(contactRow.work_email).split("@")[1] ?? "";
  const companyKeys = await resolveCompanyKeys(client, {
    projectId,
    companyId: str(contactRow.company_uuid) || null,
    extraKeys: emailDomain ? [emailDomain] : [],
  });

  const [messages, povRows, marks] = await Promise.all([
    client
      .from("outreach_emails")
      .select("id, contact_id, contact_name, company_name, channel, step_number, sequence_step, status, current_subject, current_body, current_version_id, approved_version_id, external_target, external_pushed_at, external_push_log, updated_at")
      .eq("project_id", projectId)
      .eq("contact_id", contactId)
      .order("channel", { ascending: true })
      .order("step_number", { ascending: true }),
    loadLatestPovRows(client, [contactId, str(contactRow.company_uuid)], companyKeys),
    client
      .from("pov_fact_marks")
      .select("*")
      .eq("project_id", projectId)
      .in("entity_key", [contactId, str(contactRow.company_uuid)].filter(Boolean))
      .order("rank", { ascending: true, nullsFirst: false }),
  ]);
  if (messages.error) return send(res, 500, { error: messages.error.message });
  if (marks.error) return send(res, 500, { error: marks.error.message });

  const facts = povRows.flatMap((row) =>
    extractPovFacts(row.result).map((fact) => ({
      ...fact,
      rowId: row.id,
      entityKey: str(row.contact_id) || str(row.company_id) || contactId,
      createdAt: row.created_at,
    }))
  );

  return send(res, 200, {
    contact: { ...contactRow, display_name: contactName(contactRow) },
    messages: messages.data ?? [],
    povRows,
    facts,
    marks: marks.data ?? [],
  });
}

export async function handlePovFactMarks(req: IncomingMessage, res: ServerResponse) {
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" });
  if (req.method === "GET") {
    const q = reqUrl(req).searchParams;
    const projectId = q.get("projectId") ?? "";
    const entityKey = str(q.get("entityKey"));
    if (!validUuid(projectId) || !entityKey) return send(res, 400, { error: "projectId and entityKey are required" });
    const result = await client.from("pov_fact_marks").select("*").eq("project_id", projectId).eq("entity_key", entityKey).order("rank", { ascending: true, nullsFirst: false });
    return send(res, result.error ? 500 : 200, result.error ? { error: result.error.message } : { data: result.data ?? [] });
  }
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const body = await readBody(req);
  const projectId = str(body.projectId);
  const entityKey = str(body.entityKey);
  const factId = str(body.factId);
  if (!validUuid(projectId) || !entityKey || !factId) return send(res, 400, { error: "projectId, entityKey, and factId are required" });
  const authorId = actorUserId(req);
  const patch = {
    project_id: projectId,
    entity_key: entityKey,
    fact_id: factId,
    priority: body.priority !== false,
    rank: Number.isFinite(Number(body.rank)) ? Math.trunc(Number(body.rank)) : null,
    comment: str(body.comment) || null,
    author_id: authorId,
    updated_at: new Date().toISOString(),
  };
  const result = await client
    .from("pov_fact_marks")
    .upsert(patch, { onConflict: "project_id,entity_key,fact_id,author_id" })
    .select("*")
    .single();
  return send(res, result.error ? 500 : 200, result.error ? { error: result.error.message } : { data: result.data });
}

export async function handleStyleSources(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" });
  const projectId = str(reqUrl(req).searchParams.get("projectId"));
  if (!validUuid(projectId)) return send(res, 400, { error: "projectId is required" });
  const result = await client
    .from("style_sources")
    .select("id, project_id, name, origin_url, technique_summary, prompt_block, tags, status")
    .eq("status", "active")
    .or(`project_id.is.null,project_id.eq.${projectId}`)
    .order("name", { ascending: true });
  return send(res, result.error ? 500 : 200, result.error ? { error: result.error.message } : { data: result.data ?? [] });
}

function dmFieldName(email: Json): string {
  const target = str(email.external_target);
  const match = target.match(/^getsales:(li_msg_(?:\d+|1a|1b|2a|2b|3|4a|4b|4c|5a|5b))$/);
  if (match) return match[1];
  const step = Math.max(1, Math.trunc(Number(email.step_number ?? email.sequence_step ?? 1)));
  return `li_msg_${step}`;
}

function pushFieldsForEmail(email: Json): { fields: Record<string, string>; preview: string; warning: string | null } {
  const channel = normalizeOutreachMessageChannel(email.channel);
  if (channel === "linkedin_inmail") {
    const arranged = arrangeGetSalesFields({ subject: str(email.current_subject), body: str(email.current_body) });
    return { fields: arranged.fields as unknown as Record<string, string>, preview: arranged.assembledPreview, warning: arranged.warning };
  }
  const field = dmFieldName(email);
  const body = str(email.current_body);
  return { fields: { [field]: body }, preview: body, warning: body ? null : "Draft body is empty." };
}

async function pushLeadCustomFields(projectId: string, leadUuid: string, fields: Record<string, string>) {
  const client = getSupabase(); if (!client) throw new Error("Supabase not configured");
  const { credentials, error: credErr } = await getGetSalesCredentials(client, projectId);
  if (credErr) throw new Error(`GetSales credentials: ${credErr}`);
  if (!credentials) throw new Error("GetSales credentials not configured for project");

  const defs = await listLeadCustomFields(credentials);
  const byName = new Map(defs.map((d) => [d.name, d.uuid]));
  const fieldMap: Record<string, string> = {};
  for (const [name, value] of Object.entries(fields)) {
    let uuid = byName.get(name);
    if (!uuid) uuid = await createLeadCustomField(credentials, name);
    fieldMap[uuid] = value;
  }
  await updateLeadCustomFields(credentials, leadUuid, fieldMap);
}

export async function handleSequenceStudioPushLinkedin(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" });
  const body = await readBody(req);
  const projectId = str(body.projectId);
  const emailId = str(body.emailId);
  const dryRun = body.dryRun !== false;
  if (!validUuid(projectId) || !validUuid(emailId)) return send(res, 400, { error: "projectId and emailId are required" });

  const emailResult = await client
    .from("outreach_emails")
    .select("*")
    .eq("project_id", projectId)
    .eq("id", emailId)
    .maybeSingle();
  if (emailResult.error) return send(res, 500, { error: emailResult.error.message });
  const email = emailResult.data as Json | null;
  if (!email) return send(res, 404, { error: "Draft not found" });
  const channel = normalizeOutreachMessageChannel(email.channel);
  if (!LINKEDIN_CHANNELS.includes(channel as typeof LINKEDIN_CHANNELS[number])) return send(res, 400, { error: "Only LinkedIn DM and InMail drafts can be pushed to GetSales here" });
  if (!dryRun && email.status !== "approved") return send(res, 409, { error: "Approve the draft before pushing it to GetSales" });
  const leadUuid = str(email.contact_id);
  if (!validUuid(leadUuid)) return send(res, 400, { error: "Draft has no linked GetSales lead UUID" });
  const mapped = pushFieldsForEmail(email);

  if (dryRun) {
    return send(res, 200, { dryRun: true, leadUuid, channel, fields: mapped.fields, preview: mapped.preview, warning: mapped.warning });
  }

  try {
    await pushLeadCustomFields(projectId, leadUuid, mapped.fields);
    const pushLog = {
      at: new Date().toISOString(),
      channel,
      leadUuid,
      fields: mapped.fields,
      fieldNames: Object.keys(mapped.fields),
    };
    const update = await client
      .from("outreach_emails")
      .update({ external_pushed_at: pushLog.at, external_push_log: pushLog, updated_at: pushLog.at })
      .eq("id", emailId)
      .select("*")
      .single();
    if (update.error) return send(res, 500, { error: update.error.message });
    return send(res, 200, { ok: true, leadUuid, fields: mapped.fields, data: update.data });
  } catch (e) {
    return send(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

export async function handleSequenceStudioPushLinkedinSequence(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" });
  const body = await readBody(req);
  const projectId = str(body.projectId);
  const contactId = str(body.contactId);
  const dryRun = body.dryRun !== false;
  if (!validUuid(projectId) || !validUuid(contactId)) return send(res, 400, { error: "projectId and contactId are required" });

  const result = await client
    .from("outreach_emails")
    .select("*")
    .eq("project_id", projectId)
    .eq("contact_id", contactId)
    .in("channel", ["linkedin_dm", "linkedin_inmail"])
    .order("channel", { ascending: true })
    .order("step_number", { ascending: true });
  if (result.error) return send(res, 500, { error: result.error.message });

  const drafts = ((result.data ?? []) as Json[]).filter((email) => str(email.status) === "approved");
  if (!drafts.length) return send(res, 409, { error: "No approved LinkedIn drafts found for this contact" });

  const fields: Record<string, string> = {};
  const warnings: string[] = [];
  for (const email of drafts) {
    const mapped = pushFieldsForEmail(email);
    if (mapped.warning) warnings.push(mapped.warning);
    for (const [name, value] of Object.entries(mapped.fields)) {
      if (GETSALES_LI_MSG_RE.test(name) || GETSALES_INMAIL_FIELD_NAMES.includes(name as typeof GETSALES_INMAIL_FIELD_NAMES[number])) {
        fields[name] = value;
      }
    }
  }
  if (!Object.keys(fields).length) return send(res, 400, { error: "No GetSales fields could be mapped from approved drafts" });
  if (dryRun) return send(res, 200, { dryRun: true, leadUuid: contactId, fields, warnings, draftIds: drafts.map((d) => d.id) });

  try {
    await pushLeadCustomFields(projectId, contactId, fields);
    const at = new Date().toISOString();
    const pushLog = {
      at,
      channel: "linkedin_sequence",
      leadUuid: contactId,
      fields,
      fieldNames: Object.keys(fields),
      source: "sequence-studio-human-resync",
    };
    const ids = drafts.map((d) => str(d.id)).filter(Boolean);
    const update = await client
      .from("outreach_emails")
      .update({ external_pushed_at: at, external_push_log: pushLog, updated_at: at })
      .in("id", ids)
      .select("id");
    if (update.error) return send(res, 500, { error: update.error.message });
    return send(res, 200, { ok: true, leadUuid: contactId, fields, updatedDrafts: update.data?.length ?? 0, warnings });
  } catch (e) {
    return send(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

export async function handleEmailStudioPushGetSalesLinkedinSequence(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" });
  const body = await readBody(req);
  const projectId = str(body.projectId);
  const contactId = str(body.contactId);
  const dryRun = body.dryRun !== false;
  const rawFields = body.liMsgFields && typeof body.liMsgFields === "object" ? body.liMsgFields as Record<string, unknown> : {};
  if (!validUuid(projectId) || !validUuid(contactId)) return send(res, 400, { error: "projectId and contactId are required" });

  const fields: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawFields)) {
    if (!GETSALES_LI_MSG_RE.test(name)) continue;
    fields[name] = str(value);
  }
  if (!Object.keys(fields).length) return send(res, 400, { error: "liMsgFields must include at least one li_msg_* value" });

  if (dryRun) return send(res, 200, { dryRun: true, leadUuid: contactId, fields });

  try {
    await pushLeadCustomFields(projectId, contactId, fields);
    const at = new Date().toISOString();
    const pushLog = {
      at,
      channel: "linkedin_dm",
      leadUuid: contactId,
      fields,
      fieldNames: Object.keys(fields),
      source: "n8n-accept-linkedin",
    };
    const update = await client
      .from("outreach_emails")
      .update({ external_pushed_at: at, external_push_log: pushLog, updated_at: at })
      .eq("project_id", projectId)
      .eq("contact_id", contactId)
      .eq("channel", "linkedin_dm")
      .in("campaign_id", ["velvetech-accept-linkedin", "velvetech-n8n"])
      .select("id");
    if (update.error) return send(res, 500, { error: update.error.message });
    return send(res, 200, { ok: true, leadUuid: contactId, fields, updatedDrafts: update.data?.length ?? 0 });
  } catch (e) {
    return send(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Push all approved email-channel drafts for a contact to Instantly as one lead
 * (find-or-create by email, then merge email_subject_N / email_body_N custom
 * variables). Mirrors handleSequenceStudioPushLinkedinSequence's shape, but
 * Instantly campaigns need every step's variables set together on one lead
 * rather than one field write per touch, so there is no single-touch variant.
 */
export async function handleSequenceStudioPushInstantlySequence(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" });
  const body = await readBody(req);
  const projectId = str(body.projectId);
  const contactId = str(body.contactId);
  const campaignId = str(body.campaignId);
  const dryRun = body.dryRun !== false;
  if (!validUuid(projectId) || !validUuid(contactId)) return send(res, 400, { error: "projectId and contactId are required" });
  if (!dryRun && !campaignId) return send(res, 400, { error: "campaignId is required to push" });

  const [contactRes, emailsRes] = await Promise.all([
    client.from(CONTACTS_TABLE).select("uuid, name, first_name, last_name, company_name, work_email").eq("project_id", projectId).eq("uuid", contactId).maybeSingle(),
    client.from("outreach_emails").select("*").eq("project_id", projectId).eq("contact_id", contactId).eq("channel", "email").order("step_number", { ascending: true }),
  ]);
  if (contactRes.error) return send(res, 500, { error: contactRes.error.message });
  if (!contactRes.data) return send(res, 404, { error: "Contact not found" });
  if (emailsRes.error) return send(res, 500, { error: emailsRes.error.message });

  const drafts = ((emailsRes.data ?? []) as Json[]).filter((email) => str(email.status) === "approved");
  if (!drafts.length) return send(res, 409, { error: "No approved email drafts found for this contact" });

  const contact = contactRes.data as Json;
  const email = str(contact.work_email);
  if (!email) return send(res, 400, { error: "Contact has no work email" });

  const variables: Record<string, string> = {};
  for (const draft of drafts) {
    const step = Math.max(1, Math.trunc(Number(draft.step_number ?? draft.sequence_step ?? 1)));
    variables[`email_subject_${step}`] = str(draft.current_subject);
    variables[`email_body_${step}`] = htmlToPlaintext(draft.current_body);
  }

  const leadPayload: { email: string; first_name?: string; last_name?: string; company_name?: string } = { email };
  const firstName = str(contact.first_name) || str(contact.name).split(/\s+/)[0];
  if (firstName) leadPayload.first_name = firstName;
  if (str(contact.last_name)) leadPayload.last_name = str(contact.last_name);
  if (str(contact.company_name)) leadPayload.company_name = str(contact.company_name);

  if (dryRun) return send(res, 200, { dryRun: true, email, variables, draftIds: drafts.map((d) => d.id) });

  try {
    const lead = await upsertLeadWithVariables(campaignId, leadPayload, variables);
    const at = new Date().toISOString();
    const pushLog = { at, channel: "email_sequence", campaignId, leadId: lead.id, email, variables, source: "sequence-studio-instantly" };
    const ids = drafts.map((d) => str(d.id)).filter(Boolean);
    const update = await client.from("outreach_emails").update({ external_pushed_at: at, external_push_log: pushLog, updated_at: at }).in("id", ids).select("id");
    if (update.error) return send(res, 500, { error: update.error.message });
    return send(res, 200, { ok: true, leadId: lead.id, email, variables, updatedDrafts: update.data?.length ?? 0 });
  } catch (e) {
    return send(res, 502, { error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * List Wellore contacts with their research-snapshot state, for WelloreResearchPage.vue.
 * Deliberately lighter than handleSequenceStudioLeads (no message/status-summary join) --
 * this page is about research review, not sequence status.
 */
export async function handleListWelloreResearch(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" });
  const q = reqUrl(req).searchParams;
  const projectId = q.get("projectId") ?? "";
  if (!validUuid(projectId)) return send(res, 400, { error: "projectId is required" });
  const search = str(q.get("search"));

  let contactsQuery = client
    .from(CONTACTS_TABLE)
    .select("uuid, name, first_name, last_name, title, company_name, company_uuid, work_email, linkedin_url")
    .eq("project_id", projectId)
    .order("company_name", { ascending: true })
    .limit(1000);
  if (search) contactsQuery = contactsQuery.or(`name.ilike.%${search}%,company_name.ilike.%${search}%,work_email.ilike.%${search}%`);
  const contactsRes = await contactsQuery;
  if (contactsRes.error) return send(res, 500, { error: contactsRes.error.message });
  const contacts = (contactsRes.data ?? []) as Json[];
  const contactIds = contacts.map((c) => str(c.uuid)).filter(Boolean);

  const snapRes = contactIds.length
    ? await client.from("wellore_research_snapshots").select("*").eq("project_id", projectId).in("contact_id", contactIds)
    : { data: [], error: null };
  if (snapRes.error) return send(res, 500, { error: snapRes.error.message });
  const snapshotByContact = new Map<string, Json>((snapRes.data ?? []).map((r: Json) => [String(r.contact_id), r]));

  const rows = contacts.map((c) => ({
    contact: { ...c, display_name: contactName(c) },
    snapshot: snapshotByContact.get(str(c.uuid)) ?? null,
  }));
  return send(res, 200, { data: rows });
}

/**
 * Wellore research-review gate (Phase 10). Assemble writes/upserts an unreviewed snapshot
 * per contact (always resets reviewed_at to null, even on re-assemble, so a changed research
 * bundle never silently inherits a stale approval); Approve stamps reviewed_at/reviewed_by.
 * buildWelloreMessagingPayloads (launcher-handlers.ts) refuses to draft from anything that
 * hasn't been through Approve.
 */
export async function handleAssembleWelloreResearch(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" });
  const body = await readBody(req);
  const projectId = str(body.projectId);
  const contactIds = Array.isArray(body.contactIds) ? body.contactIds.map((x) => str(x)).filter(Boolean) : [];
  if (!validUuid(projectId) || !contactIds.length) return send(res, 400, { error: "projectId and contactIds[] are required" });

  const built = await assembleWelloreResearch(client, { projectId, leadUuids: contactIds });
  if (!built.ok) return send(res, built.status, { error: built.error });

  const assembledBy = actorUserId(req) ?? "unknown";
  const now = new Date().toISOString();
  const okResults = built.results.filter((r) => r.ok);
  const failed = built.results.filter((r) => !r.ok);
  if (okResults.length) {
    const rows = okResults.map((r) => ({
      project_id: projectId,
      contact_id: r.leadUuid,
      company_uuid: r.companyUuid,
      research: r.research,
      assembled_at: now,
      assembled_by: assembledBy,
      reviewed_at: null,
      reviewed_by: null,
    }));
    const upsert = await client.from("wellore_research_snapshots").upsert(rows, { onConflict: "project_id,contact_id" }).select("*");
    if (upsert.error) return send(res, 500, { error: upsert.error.message });
    return send(res, 200, { ok: true, assembled: upsert.data ?? [], failed });
  }
  return send(res, 200, { ok: true, assembled: [], failed });
}

export async function handleApproveWelloreResearch(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" });
  const client = getSupabase(); if (!client) return send(res, 500, { error: "Supabase not configured" });
  const body = await readBody(req);
  const projectId = str(body.projectId);
  const contactIds = Array.isArray(body.contactIds) ? body.contactIds.map((x) => str(x)).filter(Boolean) : [];
  if (!validUuid(projectId) || !contactIds.length) return send(res, 400, { error: "projectId and contactIds[] are required" });
  const reviewedBy = str(body.reviewedBy) || actorUserId(req) || "unknown";

  const now = new Date().toISOString();
  const update = await client
    .from("wellore_research_snapshots")
    .update({ reviewed_at: now, reviewed_by: reviewedBy })
    .eq("project_id", projectId)
    .in("contact_id", contactIds)
    .select("contact_id");
  if (update.error) return send(res, 500, { error: update.error.message });
  const approvedIds = new Set((update.data ?? []).map((r: { contact_id: string }) => r.contact_id));
  const skipped = contactIds.filter((id) => !approvedIds.has(id));
  return send(res, 200, { ok: true, approved: update.data ?? [], skipped });
}
