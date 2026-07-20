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
import {
  fetchVelvetechResultsForCompanyDomain,
  fetchVelvetechResultsForContactLinkedin,
} from "./n8n-entity-link.js";

const CONTACT_WORKFLOW_LATEST_VIEW = "contact_workflow_latest";
const COMPANY_WORKFLOW_LATEST_VIEW = "company_workflow_latest";
const INMAIL_REVIEW_STATE_TABLE = "inmail_review_state";

const CONTACT_CARD_FIELDS =
  "uuid, project_id, name, first_name, last_name, position, headline, about, avatar_url, linkedin, linkedin_url, work_email, status, email_status, tags, company_uuid, company_id, company_name, experience, lead_category, priority, gs_connection_sent_at, gs_connection_accepted_at, gs_connection_lost_at, created_at, updated_at";
const COMPANY_CARD_FIELDS =
  "id, name, domain, website, linkedin, industry, about, employees_range, employees_on_linkedin, hq_location, hq_raw_address, status, tags, qualification_status, qualification_decided_at, created_at, updated_at";
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
    channel_label: "InMail" | "Email" | "LinkedIn" | "Connection request";
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

export type ContactConnectionStatus = "accepted" | "sent" | "withdrawn" | "none";

export interface CompanyReplyContact {
  uuid: string;
  name: string;
  position: string | null;
  inbound_count: number;
  latest_reply_at: string | null;
}

function msgTime(m: MessageRow): string {
  return m.sent_at ?? m.created_at ?? "";
}

function isInbox(m: MessageRow): boolean {
  return (m.type ?? "").toLowerCase() === "inbox";
}

export function messageChannelLabel(
  message: Pick<MessageRow, "linkedin_type" | "type" | "subject">
): ConversationThread["messages"][number]["channel_label"] {
  const linkedinType = (message.linkedin_type ?? "").toLowerCase();
  const type = (message.type ?? "").toLowerCase();
  if (linkedinType.includes("inmail") || type.includes("inmail")) return "InMail";
  if (linkedinType.includes("connection")) return "Connection request";
  if (linkedinType === "message" || linkedinType.includes("linkedin")) return "LinkedIn";
  if (type.includes("email") || Boolean(message.subject?.trim())) return "Email";
  return "LinkedIn";
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
        channel_label: messageChannelLabel(m),
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

/** Connection status for company roster filters, matching GetSales marker precedence. */
export function contactConnectionStatus(contact: Json, threads: ConversationThread[]): ContactConnectionStatus {
  const uuid = typeof contact.uuid === "string" ? contact.uuid : "";
  const contactMessages = threads.filter((thread) => thread.lead_uuid === uuid).flatMap((thread) => thread.messages);
  if (
    (typeof contact.gs_connection_accepted_at === "string" && contact.gs_connection_accepted_at) ||
    contactMessages.some((message) => (message.linkedin_type ?? "").toLowerCase() === "message")
  ) return "accepted";
  if (typeof contact.gs_connection_lost_at === "string" && contact.gs_connection_lost_at) return "withdrawn";
  if (
    (typeof contact.gs_connection_sent_at === "string" && contact.gs_connection_sent_at) ||
    contactMessages.some((message) => (message.linkedin_type ?? "").toLowerCase() === "connection_note")
  ) return "sent";
  return "none";
}

/** Contacts with at least one inbound message, including historical replies followed by our response. */
export function companyReplyContacts(roster: Json[], rows: MessageRow[]): CompanyReplyContact[] {
  const contacts = new Map<string, CompanyReplyContact>();
  for (const row of roster) {
    const uuid = typeof row.uuid === "string" ? row.uuid : "";
    if (!uuid) continue;
    const name =
      (typeof row.name === "string" && row.name.trim()) ||
      [row.first_name, row.last_name].filter((value) => typeof value === "string" && value.trim()).join(" ") ||
      uuid.slice(0, 8);
    contacts.set(uuid, {
      uuid,
      name,
      position: typeof row.position === "string" && row.position.trim() ? row.position.trim() : null,
      inbound_count: 0,
      latest_reply_at: null,
    });
  }
  for (const row of rows) {
    if (!isInbox(row) || !row.lead_uuid) continue;
    const contact = contacts.get(row.lead_uuid);
    if (!contact) continue;
    contact.inbound_count += 1;
    const time = msgTime(row) || null;
    if (time && (!contact.latest_reply_at || time > contact.latest_reply_at)) contact.latest_reply_at = time;
  }
  return [...contacts.values()]
    .filter((contact) => contact.inbound_count > 0)
    .sort((a, b) => (b.latest_reply_at ?? "").localeCompare(a.latest_reply_at ?? ""));
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

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function companyOneLinerFromLatestResults(rows: Json[]): string | null {
  for (const row of rows) {
    const result = row.result;
    if (!result || typeof result !== "object" || Array.isArray(result)) continue;
    const r = result as Json;
    const direct = stringField(r.research_company_one_liner);
    if (direct) return direct;
    const summary = r.research_summary;
    if (summary && typeof summary === "object" && !Array.isArray(summary)) {
      const nested = stringField((summary as Json).company_one_liner);
      if (nested) return nested;
    }
  }
  return null;
}

function jsonArray(value: unknown): Json[] {
  return Array.isArray(value) ? (value as Json[]) : [];
}

// Latest velvetech-pov result row, if present. latestResults is already
// newest-first-per-workflow, so the first pov row is the current one.
function povResultFromLatestResults(rows: Json[]): Json | null {
  for (const row of rows) {
    if (String(row.workflow_name ?? "") !== "velvetech-pov") continue;
    const r = row.result;
    if (r && typeof r === "object" && !Array.isArray(r)) return r as Json;
  }
  return null;
}

function groupFitContactsByPersona(fitContacts: Json[]): Record<string, Json[]> {
  const groups: Record<string, Json[]> = { it: [], ops: [], finance: [] };
  for (const c of fitContacts) {
    const persona = String(c.persona ?? "it") || "it";
    if (!groups[persona]) groups[persona] = [];
    groups[persona].push(c);
  }
  return groups;
}

// Older POV rows (pre headline_facts contract) have no ranked facts. Derive a
// best-effort ranked list from the structured arrays they do carry so the
// dossier tile is never empty for the already-run accounts.
function deriveFallbackHeadlineFacts(pov: Json): Json[] {
  const facts: Json[] = [];
  for (const t of jsonArray(pov.transformation_signals).slice(0, 2)) {
    const claim = stringField(t.claim);
    if (claim) facts.push({ fact: claim, type: "trigger", tier: 1, source: stringField(t.source) ?? "company data" });
  }
  const tech = jsonArray(pov.tech_stack).map((x) => String(x)).filter(Boolean);
  if (tech.length) facts.push({ fact: `Runs ${tech.slice(0, 8).join(", ")}.`, type: "systems", tier: 2, source: "company data" });
  for (const p of jsonArray(pov.pressure_points).map((x) => String(x)).filter(Boolean).slice(0, 2)) {
    facts.push({ fact: p, type: "pain", tier: 2, source: "company data" });
  }
  return facts.slice(0, 5);
}

// Deterministic (no-LLM) fallback narrative for rows produced before the POV
// agent emitted account_narrative. Concatenates the strongest stored signals so
// the hero block is never empty; real synthesis comes from a POV-only re-run.
function deriveFallbackNarrative(pov: Json): string {
  const facts = jsonArray(pov.transformation_signals)
    .map((t) => stringField(t.claim))
    .filter(Boolean)
    .slice(0, 3) as string[];
  const pains = jsonArray(pov.data_integration_pain)
    .map((p) => stringField(p.claim))
    .filter(Boolean)
    .slice(0, 2) as string[];
  const parts: string[] = [];
  if (facts.length) parts.push(facts.join(" "));
  if (pains.length) parts.push(pains.join(" "));
  parts.push("Derived from stored research signals. Re-run the POV for a synthesized narrative.");
  return parts.join("\n\n");
}

// Project the latest POV row into the typed dossier the CompanyDossier tile
// renders. Native contract fields win; fallback derives them for older rows.
function dossierFromLatestResults(rows: Json[]): Json | null {
  const pov = povResultFromLatestResults(rows);
  if (!pov) return null;
  const fitContacts = jsonArray(pov.fit_contacts);
  let headlineFacts = jsonArray(pov.headline_facts);
  const fromContract = headlineFacts.length > 0;
  if (!fromContract) headlineFacts = deriveFallbackHeadlineFacts(pov);
  const discovery = jsonArray(pov.discovery_questions).map((x) => String(x)).filter(Boolean);

  let hook = stringField(pov.hook);
  if (!hook) {
    const tier1 = headlineFacts.find((f) => Number(f.tier) === 1);
    hook = stringField(tier1?.fact) ?? stringField(headlineFacts[0]?.fact);
  }
  let leadQuestion = stringField(pov.lead_question) ?? (discovery[0] ?? null);

  let target: Json | null =
    pov.target && typeof pov.target === "object" && !Array.isArray(pov.target) ? (pov.target as Json) : null;
  if (!target && fitContacts.length) {
    const best =
      fitContacts.find((c) => String(c.fit ?? "") === "high") ??
      fitContacts.find((c) => String(c.fit ?? "") === "medium") ??
      fitContacts[0];
    const profile = best.profile && typeof best.profile === "object" ? (best.profile as Json) : {};
    target = {
      name: best.name ?? "",
      title: best.title ?? "",
      persona: best.persona ?? "it",
      role_type: best.role_type ?? "other",
      linkedin_url: best.linkedin_url ?? "",
      contact_key: best.contact_key ?? "",
      tenure_months: (profile.tenure_months as unknown) ?? null,
      profile_highlight: stringField(profile.summary_excerpt) ?? stringField(profile.headline) ?? "",
    };
  }

  const companyIntel = pov.company_intel && typeof pov.company_intel === "object" ? (pov.company_intel as Json) : {};
  const peopleAnalysis = pov.people_analysis && typeof pov.people_analysis === "object" ? (pov.people_analysis as Json) : {};
  const byPersona = groupFitContactsByPersona(fitContacts);

  // Native account_narrative wins; otherwise a deterministic fallback.
  let accountNarrative = stringField(pov.account_narrative);
  const narrativeFromContract = !!accountNarrative;
  if (!accountNarrative) accountNarrative = deriveFallbackNarrative(pov);

  const rosterAbsent =
    pov.roster_absent === true ||
    (Array.isArray(pov.fit_contacts) &&
      (pov.fit_contacts as unknown[]).length === 0 &&
      Array.isArray(pov.all_contacts) &&
      (pov.all_contacts as unknown[]).length === 0 &&
      Number(pov.eligible_contact_count ?? 0) === 0);

  const employeesCount =
    typeof companyIntel.employees_count === "number" ? companyIntel.employees_count : null;
  const activeJobCount =
    typeof pov.active_job_postings_count === "number"
      ? pov.active_job_postings_count
      : typeof companyIntel.active_job_postings_count === "number"
        ? companyIntel.active_job_postings_count
        : jsonArray(pov.job_postings).length;

  return {
    pov_ok: pov.pov_ok === true,
    from_contract: fromContract,
    account_narrative: accountNarrative,
    narrative_from_contract: narrativeFromContract,
    hook,
    lead_question: leadQuestion,
    headline_facts: headlineFacts,
    target,
    tech_stack: jsonArray(pov.tech_stack),
    fit_contacts_by_persona: byPersona,
    fit_score: pov.fit_score ?? null,
    score_rationale: stringField(pov.score_rationale),
    vertical: stringField(pov.vertical),
    build_risk: stringField(pov.build_risk),
    pressure_points: jsonArray(pov.pressure_points),
    data_integration_pain: jsonArray(pov.data_integration_pain),
    transformation_signals: jsonArray(pov.transformation_signals),
    discovery_questions: discovery,
    job_postings: jsonArray(pov.job_postings),
    leadership_openings: jsonArray(pov.leadership_openings),
    jobs_error: stringField(pov.jobs_error) ?? "",
    active_job_postings_count: activeJobCount,
    eligible_contact_count:
      typeof pov.eligible_contact_count === "number"
        ? pov.eligible_contact_count
        : fitContacts.length,
    discovery_error: stringField(pov.discovery_error) ?? "",
    research_source_urls: Array.from(
      new Set(jsonArray(pov.research_source_urls).map((u) => String(u)).filter(Boolean))
    ),
    team_signal: {
      dept_headcount:
        companyIntel.dept_headcount && typeof companyIntel.dept_headcount === "object"
          ? companyIntel.dept_headcount
          : {},
      employees_count: employeesCount,
      capacity_gaps: jsonArray(peopleAnalysis.capacity_gaps).map((x) => String(x)).filter(Boolean),
      it_contact_count: (byPersona.it ?? []).length,
      roster_absent: rosterAbsent,
    },
    brief_markdown: stringField(pov.brief_markdown),
    company_name: stringField(pov.company_name),
    as_of: stringField(pov.persisted_at),
    run_id: stringField(pov.run_id),
  };
}

function mergeLatestWorkflowResults(
  primary: Json[],
  supplemental: Array<Record<string, unknown>>
): Json[] {
  const seen = new Set(primary.map((row) => String(row.workflow_name ?? "")));
  const merged = [...primary];
  for (const row of supplemental) {
    const wf = String(row.workflow_name ?? "");
    if (!wf || seen.has(wf)) continue;
    seen.add(wf);
    merged.push(row as Json);
  }
  merged.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  return merged;
}

async function supplementVelvetechContactResults(
  client: SupabaseClient,
  contact: Json,
  primary: Json[]
): Promise<Json[]> {
  const linkedin = stringField(contact.linkedin) ?? stringField(contact.linkedin_url);
  if (!linkedin) return primary;
  const supplemental = await fetchVelvetechResultsForContactLinkedin(client, linkedin);
  return supplemental.length ? mergeLatestWorkflowResults(primary, supplemental) : primary;
}

async function supplementVelvetechCompanyResults(
  client: SupabaseClient,
  company: Json,
  primary: Json[]
): Promise<Json[]> {
  const domain = stringField(company.domain);
  if (!domain) return primary;
  const supplemental = await fetchVelvetechResultsForCompanyDomain(client, domain);
  return supplemental.length ? mergeLatestWorkflowResults(primary, supplemental) : primary;
}

export async function buildContactCard(
  client: SupabaseClient,
  contactUuid: string,
  opts?: { includeCompanyReplyContacts?: boolean }
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
  let replyContacts: CompanyReplyContact[] = [];
  if (opts?.includeCompanyReplyContacts && companyId) {
    const { data: companyContacts } = await client
      .from(CONTACTS_TABLE)
      .select("uuid, name, first_name, last_name, position")
      .or(`company_id.eq.${companyId},company_uuid.eq.${companyId}`)
      .limit(200);
    const companyRoster = (companyContacts ?? []) as Json[];
    const companyLeadUuids = companyRoster.map((row) => String(row.uuid ?? "")).filter(Boolean);
    if (companyLeadUuids.length) {
      const { data: companyInbox } = await client
        .from(LINKEDIN_MESSAGES_TABLE)
        .select(MESSAGE_FIELDS)
        .in("lead_uuid", companyLeadUuids)
        .eq("type", "inbox")
        .order("sent_at", { ascending: false })
        .limit(2000);
      replyContacts = companyReplyContacts(companyRoster, (companyInbox ?? []) as MessageRow[]);
    }
  }

  const latestResults = await supplementVelvetechContactResults(client, c, latestRes.data);

  // Organic contact -> account dossier link: when the contact's employer
  // resolved (via the existing company_id/company_uuid FK, checked reliable
  // for processed Velvetech contacts), reuse the same domain-keyed n8n lookup
  // and projection the company page uses, so the contact page can render the
  // identical CompanyDossier with zero extra clicks.
  const resolvedCompany = (companyRes as { data: Json | null }).data ?? null;
  const companyDomain = resolvedCompany ? stringField(resolvedCompany.domain) : null;
  const dossier = companyDomain
    ? dossierFromLatestResults(await fetchVelvetechResultsForCompanyDomain(client, companyDomain))
    : null;

  return {
    data: {
      contact: c,
      company: resolvedCompany,
      company_linked: Boolean(resolvedCompany),
      dossier,
      latest_results: latestResults,
      executions: (execsRes.data ?? []) as Json[],
      conversations: threads,
      context_entries: contextRes.data,
      inmail_review: (reviewRes.data ?? []) as Json[],
      generated_messages: (genRes.data ?? []) as Json[],
      company_reply_contacts: replyContacts,
      company_reply_contact_count: replyContacts.length,
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
    .select("uuid, name, first_name, last_name, position, headline, linkedin, avatar_url, status, work_email, email_status, lead_category, priority, gs_connection_sent_at, gs_connection_accepted_at, gs_connection_lost_at")
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
    connection_status: contactConnectionStatus(r, threads),
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
  const latestResults = await supplementVelvetechCompanyResults(
    client,
    company as Json,
    latestRes.data
  );
  const companyWithResearch = {
    ...(company as Json),
    research_company_one_liner: companyOneLinerFromLatestResults(latestResults),
  };

  return {
    data: {
      company: companyWithResearch,
      latest_results: latestResults,
      dossier: dossierFromLatestResults(latestResults),
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
