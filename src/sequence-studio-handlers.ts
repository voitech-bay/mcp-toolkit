import type { IncomingMessage, ServerResponse } from "node:http";
import { CONTACTS_TABLE, N8N_WORKFLOW_RESULTS_TABLE, getGetSalesCredentials, getSupabase } from "./services/supabase.js";
import { createLeadCustomField, listLeadCustomFields, updateLeadCustomFields } from "./services/source-api.js";
import { GETSALES_INMAIL_FIELD_NAMES, arrangeGetSalesFields } from "./services/inmail-review.js";
import { normalizeOutreachMessageChannel } from "./services/email-studio.js";

type Json = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINKEDIN_CHANNELS = ["linkedin_dm", "linkedin_inmail"] as const;

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

function factText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const row = value as Json;
  return str(row.statement) || str(row.fact) || str(row.text) || str(row.summary) || str(row.title);
}

function extractFacts(result: unknown): Array<{ id: string; text: string; source: string }> {
  const root = result && typeof result === "object" ? result as Json : {};
  const candidates: Array<{ source: string; value: unknown }> = [
    { source: "verified_signals", value: root.verified_signals },
    { source: "headline_facts", value: root.headline_facts },
    { source: "facts", value: root.facts },
    { source: "signals", value: root.signals },
    { source: "pov_points", value: root.pov_points },
    { source: "structured_research.verified_signals", value: (root.structured_research as Json | undefined)?.verified_signals },
  ];
  const out: Array<{ id: string; text: string; source: string }> = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate.value)) continue;
    candidate.value.forEach((item, index) => {
      const text = factText(item);
      if (!text) return;
      out.push({ id: `${candidate.source}:${index + 1}`, text, source: candidate.source });
    });
  }
  return out;
}

async function latestPovRows(client: NonNullable<ReturnType<typeof getSupabase>>, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return [];
  const { data, error } = await client
    .from(N8N_WORKFLOW_RESULTS_TABLE)
    .select("id, workflow_name, contact_id, company_id, result, created_at")
    .eq("workflow_name", "velvetech-pov")
    .or(`contact_id.in.(${unique.join(",")}),company_id.in.(${unique.join(",")})`)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as Json[];
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

  let contactsQuery = client
    .from(CONTACTS_TABLE)
    .select("uuid, name, first_name, last_name, avatar_url, company_name, company_uuid, position, linkedin, work_email, created_at", { count: "exact" })
    .eq("project_id", projectId);
  if (search) {
    const safe = search.replace(/[%_,()]/g, "");
    contactsQuery = contactsQuery.or(`name.ilike.%${safe}%,first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,company_name.ilike.%${safe}%,position.ilike.%${safe}%`);
  }
  const contacts = await contactsQuery.order("created_at", { ascending: false }).range(from, from + pageSize - 1);
  if (contacts.error) return send(res, 500, { error: contacts.error.message });
  const rows = (contacts.data ?? []) as Json[];
  const contactIds = rows.map((row) => String(row.uuid));

  const messages = contactIds.length
    ? await client
      .from("outreach_emails")
      .select("id, contact_id, channel, step_number, sequence_step, status, current_subject, current_body, external_target, external_pushed_at, updated_at")
      .eq("project_id", projectId)
      .in("contact_id", contactIds)
      .order("updated_at", { ascending: false })
    : { data: [], error: null };
  if (messages.error) return send(res, 500, { error: messages.error.message });

  const byContact = new Map<string, Json[]>();
  for (const msg of (messages.data ?? []) as Json[]) {
    const id = String(msg.contact_id ?? "");
    byContact.set(id, [...(byContact.get(id) ?? []), msg]);
  }

  const data = rows.map((row) => {
    const drafts = byContact.get(String(row.uuid)) ?? [];
    return {
      contact: { ...row, display_name: contactName(row) },
      draftCount: drafts.length,
      statusSummary: statusSummary(drafts),
      latestDraft: drafts[0] ?? null,
      messages: drafts,
    };
  });
  return send(res, 200, { data, total: contacts.count ?? 0, page, pageSize });
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

  const [messages, povRows, marks] = await Promise.all([
    client
      .from("outreach_emails")
      .select("id, contact_id, contact_name, company_name, channel, step_number, sequence_step, status, current_subject, current_body, current_version_id, approved_version_id, external_target, external_pushed_at, external_push_log, updated_at")
      .eq("project_id", projectId)
      .eq("contact_id", contactId)
      .order("channel", { ascending: true })
      .order("step_number", { ascending: true }),
    latestPovRows(client, [contactId, str(contactRow.company_uuid)]),
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
    extractFacts(row.result).map((fact) => ({
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

function dmFieldName(email: Json): string {
  const target = str(email.external_target);
  const match = target.match(/^getsales:(li_msg_\d+)$/);
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

  const { credentials, error: credErr } = await getGetSalesCredentials(client, projectId);
  if (credErr) return send(res, 400, { error: `GetSales credentials: ${credErr}` });
  if (!credentials) return send(res, 400, { error: "GetSales credentials not configured for project" });
  try {
    const defs = await listLeadCustomFields(credentials);
    const byName = new Map(defs.map((d) => [d.name, d.uuid]));
    const fieldMap: Record<string, string> = {};
    for (const [name, value] of Object.entries(mapped.fields)) {
      let uuid = byName.get(name);
      if (!uuid) uuid = await createLeadCustomField(credentials, name);
      fieldMap[uuid] = value;
    }
    await updateLeadCustomFields(credentials, leadUuid, fieldMap);
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
