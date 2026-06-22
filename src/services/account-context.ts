/**
 * Shared prospect/account context assembly for the contact and company card pages.
 *
 * Reads ONLY existing tables/views (Contacts, companies, LinkedinMessages,
 * n8n_workflow_results + canonical views contact_workflow_latest /
 * company_workflow_latest, ContactsContext, CompaniesContext, inmail_review_state,
 * generated_messages). Writes nothing — the card endpoints are read-only; the
 * account summary cache is written by card-handlers via addCompanyContextEntry.
 *
 * The pure grouping helpers (groupMessagesIntoThreads, summarizeContactActivity,
 * parseAccountSummaryEntry) are exported separately so they can be unit-tested
 * without a Supabase client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CONTACTS_TABLE,
  COMPANIES_TABLE,
  LINKEDIN_MESSAGES_TABLE,
  SENDERS_TABLE,
  N8N_WORKFLOW_RESULTS_TABLE,
  GENERATED_MESSAGES_TABLE,
  listContactContextsByContactId,
  listCompanyContextsByCompanyId,
  type CompanyContextRow,
} from "./supabase.js";

const CONTACT_WORKFLOW_LATEST_VIEW = "contact_workflow_latest";
const COMPANY_WORKFLOW_LATEST_VIEW = "company_workflow_latest";
const INMAIL_REVIEW_STATE_TABLE = "inmail_review_state";

const CONTACT_CARD_FIELDS =
  "uuid, project_id, name, first_name, last_name, position, headline, about, avatar_url, linkedin, linkedin_url, work_email, status, email_status, tags, company_uuid, company_id, company_name, experience, lead_category, priority, gs_connection_accepted_at, created_at, updated_at";
const COMPANY_CARD_FIELDS =
  "id, name, domain, website, linkedin, industry, about, employees_range, employees_on_linkedin, hq_location, hq_raw_address, status, tags, created_at, updated_at";
const MESSAGE_FIELDS =
  "uuid, lead_uuid, linkedin_conversation_uuid, sender_profile_uuid, text, subject, type, status, sent_at, created_at, linkedin_type";

type Json = Record<string, unknown>;

export interface MessageRow {
  uuid: string;
  lead_uuid: string | null;
  linkedin_conversation_uuid: string | null;
  sender_profile_uuid: string | null;
  text: string | null;
  subject: string | null;
  type: string | null;
  status: string | null;
  sent_at: string | null;
  created_at: string | null;
  linkedin_type?: string | null;
}

export interface ConversationThread {
  conversation_uuid: string;
  lead_uuid: string | null;
  message_count: number;
  inbox_count: number;
  outbox_count: number;
  first_message_at: string | null;
  last_message_at: string | null;
  last_message_text: string | null;
  last_message_type: string | null;
  reply_status: "no_response" | "waiting_for_response" | "got_response";
  messages: Array<{
    text: string | null;
    type: string | null;
    sent_at: string | null;
    subject: string | null;
    linkedin_type: string | null;
    sender_profile_uuid: string | null;
    sender_display_name: string | null;
  }>;
}

export interface ContactActivity {
  lead_uuid: string;
  thread_count: number;
  inbox_count: number;
  outbox_count: number;
  last_message_at: string | null;
  last_message_text: string | null;
  reply_status: ConversationThread["reply_status"];
}

function msgTime(m: MessageRow): string {
  return m.sent_at ?? m.created_at ?? "";
}

function isInbox(m: MessageRow): boolean {
  return (m.type ?? "").toLowerCase() === "inbox";
}

/** Group LinkedinMessages rows into per-conversation threads, newest-activity first. */
export function groupMessagesIntoThreads(
  rows: MessageRow[],
  opts?: { messagesPerThread?: number; senderNames?: Map<string, string> }
): ConversationThread[] {
  const cap = opts?.messagesPerThread ?? 50;
  const byConv = new Map<string, MessageRow[]>();
  for (const m of rows) {
    const key = m.linkedin_conversation_uuid || `lead:${m.lead_uuid ?? "unknown"}`;
    const arr = byConv.get(key);
    if (arr) arr.push(m);
    else byConv.set(key, [m]);
  }
  const threads: ConversationThread[] = [];
  for (const [key, msgs] of byConv) {
    msgs.sort((a, b) => msgTime(a).localeCompare(msgTime(b)));
    const inbox = msgs.filter(isInbox).length;
    const outbox = msgs.length - inbox;
    const last = msgs[msgs.length - 1];
    const lastIsInbox = last ? isInbox(last) : false;
    const reply_status: ConversationThread["reply_status"] =
      inbox === 0 ? "no_response" : lastIsInbox ? "got_response" : "waiting_for_response";
    threads.push({
      conversation_uuid: key,
      lead_uuid: msgs[0]?.lead_uuid ?? null,
      message_count: msgs.length,
      inbox_count: inbox,
      outbox_count: outbox,
      first_message_at: msgs[0] ? msgTime(msgs[0]) : null,
      last_message_at: last ? msgTime(last) : null,
      last_message_text: last?.text ?? null,
      last_message_type: last?.type ?? null,
      reply_status,
      messages: msgs.slice(-cap).map((m) => ({
        text: m.text,
        type: m.type,
        sent_at: msgTime(m) || null,
        subject: m.subject,
        linkedin_type: m.linkedin_type ?? null,
        sender_profile_uuid: m.sender_profile_uuid,
        sender_display_name: m.sender_profile_uuid ? opts?.senderNames?.get(m.sender_profile_uuid) ?? null : null,
      })),
    });
  }
  threads.sort((a, b) => (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""));
  return threads;
}

function senderDisplayName(row: Json): string {
  const first = typeof row.first_name === "string" ? row.first_name.trim() : "";
  const last = typeof row.last_name === "string" ? row.last_name.trim() : "";
  if (first || last) return [first, last].filter(Boolean).join(" ");
  return typeof row.label === "string" ? row.label.trim() : "";
}

async function loadSenderNames(client: SupabaseClient, rows: MessageRow[]): Promise<Map<string, string>> {
  const uuids = [...new Set(rows.map((row) => row.sender_profile_uuid?.trim() ?? "").filter(Boolean))];
  const names = new Map<string, string>();
  if (!uuids.length) return names;
  const { data } = await client
    .from(SENDERS_TABLE)
    .select("uuid, first_name, last_name, label")
    .in("uuid", uuids);
  for (const row of (data ?? []) as Json[]) {
    const uuid = typeof row.uuid === "string" ? row.uuid.trim() : "";
    const display = senderDisplayName(row);
    if (uuid && display) names.set(uuid, display);
  }
  return names;
}

/** Per-contact activity badges for a company roster, derived from already-grouped threads. */
export function summarizeContactActivity(threads: ConversationThread[]): Map<string, ContactActivity> {
  const byLead = new Map<string, ContactActivity>();
  for (const t of threads) {
    const lead = t.lead_uuid ?? "";
    if (!lead) continue;
    const cur = byLead.get(lead) ?? {
      lead_uuid: lead,
      thread_count: 0,
      inbox_count: 0,
      outbox_count: 0,
      last_message_at: null,
      last_message_text: null,
      reply_status: "no_response" as const,
    };
    cur.thread_count += 1;
    cur.inbox_count += t.inbox_count;
    cur.outbox_count += t.outbox_count;
    if (!cur.last_message_at || (t.last_message_at ?? "") > cur.last_message_at) {
      cur.last_message_at = t.last_message_at;
      cur.last_message_text = t.last_message_text;
      cur.reply_status = t.reply_status;
    }
    byLead.set(lead, cur);
  }
  return byLead;
}

export interface AccountSummaryEntry {
  kind: "account_summary";
  generated_at: string;
  message_watermark: number;
  model: string;
  data: Json;
}

/** Parse a CompaniesContext row that holds a cached account summary; null if it's a plain note. */
export function parseAccountSummaryEntry(row: Pick<CompanyContextRow, "rootContext">): AccountSummaryEntry | null {
  const raw = row.rootContext;
  if (!raw || !raw.trimStart().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(raw) as Json;
    if (parsed && parsed.kind === "account_summary" && parsed.data && typeof parsed.data === "object") {
      return parsed as unknown as AccountSummaryEntry;
    }
  } catch {
    /* plain-text context entry */
  }
  return null;
}

async function fetchLatestResults(
  client: SupabaseClient,
  view: string,
  column: "contact_id" | "company_id",
  id: string
): Promise<{ data: Json[]; error: string | null }> {
  const { data, error } = await client
    .from(view)
    .select("id, workflow_name, result, created_at, execution_id")
    .eq(column, id)
    .order("created_at", { ascending: false });
  if (error) {
    // Canonical view missing or errored: degrade to the base table, newest row per workflow_name in JS.
    const fb = await client
      .from(N8N_WORKFLOW_RESULTS_TABLE)
      .select("id, workflow_name, result, created_at, execution_id")
      .eq(column, id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (fb.error) return { data: [], error: fb.error.message };
    const seen = new Set<string>();
    const latest: Json[] = [];
    for (const row of (fb.data ?? []) as Json[]) {
      const wf = String(row.workflow_name ?? "other");
      if (seen.has(wf)) continue;
      seen.add(wf);
      latest.push(row);
    }
    return { data: latest, error: null };
  }
  return { data: (data ?? []) as Json[], error: null };
}

export async function buildContactCard(
  client: SupabaseClient,
  contactUuid: string
): Promise<{ data: Json | null; error: string | null }> {
  const uuid = contactUuid.trim();
  if (!uuid) return { data: null, error: "contactUuid is required" };

  const { data: contact, error: contactErr } = await client
    .from(CONTACTS_TABLE)
    .select(CONTACT_CARD_FIELDS)
    .eq("uuid", uuid)
    .maybeSingle();
  if (contactErr) return { data: null, error: contactErr.message };
  if (!contact) return { data: null, error: "Contact not found" };
  const c = contact as Json;

  const companyId =
    (typeof c.company_id === "string" && c.company_id) ||
    (typeof c.company_uuid === "string" && c.company_uuid) ||
    "";

  const [latestRes, execsRes, msgsRes, contextRes, reviewRes, genRes, companyRes] = await Promise.all([
    fetchLatestResults(client, CONTACT_WORKFLOW_LATEST_VIEW, "contact_id", uuid),
    client
      .from(N8N_WORKFLOW_RESULTS_TABLE)
      .select("id, workflow_name, created_at, execution_id")
      .eq("contact_id", uuid)
      .order("created_at", { ascending: false })
      .limit(50),
    client
      .from(LINKEDIN_MESSAGES_TABLE)
      .select(MESSAGE_FIELDS)
      .eq("lead_uuid", uuid)
      .order("sent_at", { ascending: false })
      .limit(500),
    listContactContextsByContactId(client, uuid),
    client.from(INMAIL_REVIEW_STATE_TABLE).select("result_id, workflow, status, updated_at").eq("lead_uuid", uuid),
    client
      .from(GENERATED_MESSAGES_TABLE)
      .select("id, content, created_at, hypothesis_id")
      .eq("contact_id", uuid)
      .order("created_at", { ascending: false })
      .limit(10),
    companyId
      ? client.from(COMPANIES_TABLE).select("id, name, domain, industry").eq("id", companyId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const messageRows = (msgsRes.data ?? []) as MessageRow[];
  const senderNames = await loadSenderNames(client, messageRows);
  const threads = groupMessagesIntoThreads(messageRows, { senderNames });

  return {
    data: {
      contact: c,
      company: (companyRes as { data: Json | null }).data ?? null,
      company_linked: Boolean((companyRes as { data: Json | null }).data),
      latest_results: latestRes.data,
      executions: (execsRes.data ?? []) as Json[],
      conversations: threads,
      context_entries: contextRes.data,
      inmail_review: (reviewRes.data ?? []) as Json[],
      generated_messages: (genRes.data ?? []) as Json[],
    },
    error: null,
  };
}

export async function buildCompanyCard(
  client: SupabaseClient,
  companyId: string
): Promise<{ data: Json | null; error: string | null }> {
  const id = companyId.trim();
  if (!id) return { data: null, error: "companyId is required" };

  const { data: company, error: companyErr } = await client
    .from(COMPANIES_TABLE)
    .select(COMPANY_CARD_FIELDS)
    .eq("id", id)
    .maybeSingle();
  if (companyErr) return { data: null, error: companyErr.message };
  if (!company) return { data: null, error: "Company not found" };

  // Contacts may link via company_id (backfilled, ~67%) or only company_uuid (GetSales key).
  const { data: contacts, error: contactsErr } = await client
    .from(CONTACTS_TABLE)
    .select("uuid, name, first_name, last_name, position, headline, linkedin, avatar_url, status")
    .or(`company_id.eq.${id},company_uuid.eq.${id}`)
    .limit(200);
  if (contactsErr) return { data: null, error: contactsErr.message };
  const roster = (contacts ?? []) as Json[];
  const leadUuids = roster.map((r) => String(r.uuid ?? "")).filter(Boolean);

  const [latestRes, msgsRes, contextRes] = await Promise.all([
    fetchLatestResults(client, COMPANY_WORKFLOW_LATEST_VIEW, "company_id", id),
    leadUuids.length
      ? client
          .from(LINKEDIN_MESSAGES_TABLE)
          .select(MESSAGE_FIELDS)
          .in("lead_uuid", leadUuids)
          .order("sent_at", { ascending: false })
          .limit(2000)
      : Promise.resolve({ data: [] as MessageRow[], error: null }),
    listCompanyContextsByCompanyId(client, id),
  ]);

  const messageRows = (msgsRes.data ?? []) as MessageRow[];
  const senderNames = await loadSenderNames(client, messageRows);
  const threads = groupMessagesIntoThreads(messageRows, { senderNames });
  const activity = summarizeContactActivity(threads);
  const rosterWithActivity = roster.map((r) => ({
    ...r,
    activity: activity.get(String(r.uuid ?? "")) ?? null,
  }));

  // Latest cached account summary among context entries; remaining entries are plain notes.
  let accountSummary: AccountSummaryEntry | null = null;
  const plainContextEntries: CompanyContextRow[] = [];
  for (const row of contextRes.data) {
    const parsed = parseAccountSummaryEntry(row);
    if (parsed && !accountSummary) accountSummary = parsed;
    else if (!parsed) plainContextEntries.push(row);
  }
  const totalMessages = ((msgsRes.data ?? []) as MessageRow[]).length;

  return {
    data: {
      company: company as Json,
      latest_results: latestRes.data,
      contacts: rosterWithActivity,
      conversations: threads,
      context_entries: plainContextEntries,
      account_summary: accountSummary,
      account_summary_stale: accountSummary ? totalMessages > accountSummary.message_watermark : false,
      message_count: totalMessages,
    },
    error: null,
  };
}
