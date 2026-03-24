import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;

export const LINKEDIN_MESSAGES_TABLE = "LinkedinMessages";
export const SENDERS_TABLE = "Senders";
export const CONTACTS_TABLE = "Contacts";
/** Core companies table; domain is unique. Contacts link via company_id. */
export const COMPANIES_TABLE = "companies";
export const CONTEXT_SNAPSHOTS_TABLE = "ContextSnapshots";

// --- Projects (table: Projects) ---

export const PROJECTS_TABLE = "Projects";

export interface ProjectRow {
  id: string;
  created_at: string;
  name: string;
  description: string | null;
  source_api_key: string | null;
  source_api_base_url: string | null;
}

/** Sanitised project returned by listing endpoints (hides actual API key). */
export interface ProjectSummary {
  id: string;
  name: string;
  description: string | null;
  api_key_set: boolean;
  source_api_base_url: string | null;
  created_at: string;
}

function toProjectSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    api_key_set: row.source_api_key != null && row.source_api_key.length > 0,
    source_api_base_url: row.source_api_base_url,
    created_at: row.created_at,
  };
}

/**
 * List all projects. Returns sanitised summaries (actual API key is hidden).
 */
export async function getProjects(
  client: SupabaseClient
): Promise<{ data: ProjectSummary[]; error: string | null }> {
  const { data, error } = await client
    .from(PROJECTS_TABLE)
    .select("*")
    .order("name", { ascending: true });
  if (error) return { data: [], error: error.message };
  return {
    data: ((data ?? []) as ProjectRow[]).map(toProjectSummary),
    error: null,
  };
}

/**
 * Get a single project by id, including credentials.
 */
export async function getProjectById(
  client: SupabaseClient,
  id: string
): Promise<{ data: ProjectRow | null; error: string | null }> {
  const { data, error } = await client
    .from(PROJECTS_TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data: (data as ProjectRow) ?? null, error: null };
}

/**
 * Update project API credentials. Only updates the provided fields.
 */
export async function updateProjectCredentials(
  client: SupabaseClient,
  id: string,
  credentials: { apiKey?: string | null; baseUrl?: string | null }
): Promise<{ error: string | null }> {
  const update: Record<string, unknown> = {};
  if (credentials.apiKey !== undefined) update.source_api_key = credentials.apiKey;
  if (credentials.baseUrl !== undefined) update.source_api_base_url = credentials.baseUrl;
  if (Object.keys(update).length === 0) return { error: null };
  const { error } = await client
    .from(PROJECTS_TABLE)
    .update(update)
    .eq("id", id);
  return { error: error?.message ?? null };
}

/**
 * Get entity counts (Contacts, LinkedinMessages, Senders) filtered by project_id.
 */
export async function getProjectEntityCounts(
  client: SupabaseClient,
  projectId: string
): Promise<{ counts: TableCounts; error: string | null }> {
  try {
    const [contactsRes, messagesRes, sendersRes] = await Promise.all([
      client
        .from(CONTACTS_TABLE)
        .select("*", { count: "exact", head: true })
        .eq("project_id", projectId),
      client
        .from(LINKEDIN_MESSAGES_TABLE)
        .select("*", { count: "exact", head: true })
        .eq("project_id", projectId),
      client
        .from(SENDERS_TABLE)
        .select("*", { count: "exact", head: true })
        .eq("project_id", projectId),
    ]);
    const zeroCounts: TableCounts = { contacts: 0, linkedin_messages: 0, senders: 0 };
    if (contactsRes.error) return { counts: zeroCounts, error: contactsRes.error.message };
    if (messagesRes.error) return { counts: zeroCounts, error: messagesRes.error.message };
    if (sendersRes.error) return { counts: zeroCounts, error: sendersRes.error.message };
    return {
      counts: {
        contacts: contactsRes.count ?? 0,
        linkedin_messages: messagesRes.count ?? 0,
        senders: sendersRes.count ?? 0,
      },
      error: null,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { counts: { contacts: 0, linkedin_messages: 0, senders: 0 }, error: message };
  }
}

/**
 * Get latest rows per table filtered by project_id.
 */
export async function getProjectLatestRows(
  client: SupabaseClient,
  projectId: string,
  limit: number = DEFAULT_LATEST_LIMIT
): Promise<{ latest: LatestRows; error: string | null }> {
  const n = Math.min(Math.max(limit, 1), 100);
  try {
    const [contactsRes, messagesRes, sendersRes] = await Promise.all([
      client
        .from(CONTACTS_TABLE)
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(n),
      client
        .from(LINKEDIN_MESSAGES_TABLE)
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(n),
      client
        .from(SENDERS_TABLE)
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(n),
    ]);
    const latest: LatestRows = {
      contacts: contactsRes.data ?? [],
      linkedin_messages: messagesRes.data ?? [],
      senders: sendersRes.data ?? [],
    };
    if (contactsRes.error) return { latest, error: contactsRes.error.message };
    if (messagesRes.error) return { latest, error: messagesRes.error.message };
    if (sendersRes.error) return { latest, error: sendersRes.error.message };
    return { latest, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      latest: { contacts: [], linkedin_messages: [], senders: [] },
      error: message,
    };
  }
}

/**
 * Check if any sync run is currently active (status = 'running').
 * Returns the active run row if one exists, or null.
 */
export async function getActiveSyncRun(
  client: SupabaseClient
): Promise<{ data: (SyncRunRow & { project_id: string | null }) | null; error: string | null }> {
  const { data, error } = await client
    .from(SYNC_RUNS_TABLE)
    .select("*")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data: data as (SyncRunRow & { project_id: string | null }) | null, error: null };
}

export interface SyncHistoryEntry {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: SyncRunStatus;
  result_summary: Record<string, unknown> | null;
  error: string | null;
  project_id: string | null;
  log_entries: Array<{
    id: string;
    created_at: string;
    kind: string;
    level: string;
    message: string;
    table_name: string | null;
    row_count: number | null;
    data: Record<string, unknown> | null;
  }>;
}

/**
 * Get recent sync runs (optionally filtered by project_id) with their log entries.
 */
export async function getSyncHistory(
  client: SupabaseClient,
  options?: { projectId?: string; limit?: number }
): Promise<{ data: SyncHistoryEntry[]; error: string | null }> {
  const n = Math.min(Math.max(options?.limit ?? 20, 1), 100);

  let runsQuery = client
    .from(SYNC_RUNS_TABLE)
    .select("*")
    .order("started_at", { ascending: false })
    .limit(n);
  if (options?.projectId) {
    runsQuery = runsQuery.eq("project_id", options.projectId);
  }

  const { data: runs, error: runsError } = await runsQuery;
  if (runsError) return { data: [], error: runsError.message };
  if (!runs || runs.length === 0) return { data: [], error: null };

  const runIds = (runs as SyncRunRow[]).map((r) => r.id);
  const { data: entries, error: entriesError } = await client
    .from(SYNC_LOG_ENTRIES_TABLE)
    .select("*")
    .in("run_id", runIds)
    .order("created_at", { ascending: true });
  if (entriesError) return { data: [], error: entriesError.message };

  const entriesByRun = new Map<string, SyncHistoryEntry["log_entries"]>();
  for (const entry of (entries ?? []) as Array<Record<string, unknown>>) {
    const runId = entry.run_id as string;
    if (!entriesByRun.has(runId)) entriesByRun.set(runId, []);
    entriesByRun.get(runId)!.push({
      id: entry.id as string,
      created_at: entry.created_at as string,
      kind: entry.kind as string,
      level: entry.level as string,
      message: entry.message as string,
      table_name: (entry.table_name as string) ?? null,
      row_count: (entry.row_count as number) ?? null,
      data: (entry.data as Record<string, unknown>) ?? null,
    });
  }

  const result: SyncHistoryEntry[] = (runs as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    started_at: r.started_at as string,
    finished_at: (r.finished_at as string) ?? null,
    status: r.status as SyncRunStatus,
    result_summary: (r.result_summary as Record<string, unknown>) ?? null,
    error: (r.error as string) ?? null,
    project_id: (r.project_id as string) ?? null,
    log_entries: entriesByRun.get(r.id as string) ?? [],
  }));

  return { data: result, error: null };
}

// --- companies (table: companies) ---

/**
 * Get company ids by domain. Returns a map domain -> id for all found.
 * Domains should be normalized (lowercase, trimmed).
 */
export async function getCompanyIdsByDomains(
  client: SupabaseClient,
  domains: string[]
): Promise<{ map: Record<string, string>; error: string | null }> {
  const unique = [...new Set(domains)].filter((d) => d.length > 0);
  if (unique.length === 0) return { map: {}, error: null };
  const { data, error } = await client
    .from(COMPANIES_TABLE)
    .select("id, domain")
    .in("domain", unique);
  if (error) return { map: {}, error: error.message };
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    const d = row?.domain;
    const id = row?.id;
    if (typeof d === "string" && typeof id === "string") map[d] = id;
  }
  return { map, error: null };
}

/**
 * Ensure companies exist by domain. Inserts missing rows (name/linkedin_url optional),
 * then returns domain -> id for all given domains. Uses upsert on domain so existing
 * rows are updated with provided name/linkedin_url when given.
 */
export async function ensureCompanies(
  client: SupabaseClient,
  rows: Array<{ domain: string; name?: string | null; linkedin_url?: string | null }>
): Promise<{ map: Record<string, string>; error: string | null }> {
  if (rows.length === 0) return { map: {}, error: null };
  const { data, error } = await client
    .from(COMPANIES_TABLE)
    .upsert(
      rows.map((r) => ({
        domain: r.domain,
        name: r.name ?? r.domain,
        linkedin_url: r.linkedin_url ?? null,
      })),
      { onConflict: "domain" }
    )
    .select("id, domain");
  if (error) return { map: {}, error: error.message };
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    const d = row?.domain;
    const id = row?.id;
    if (typeof d === "string" && typeof id === "string") map[d] = id;
  }
  return { map, error: null };
}

// --- Sync logging (sync_runs, sync_log_entries) ---

export const SYNC_RUNS_TABLE = "sync_runs";
export const SYNC_LOG_ENTRIES_TABLE = "sync_log_entries";

export type SyncRunStatus = "running" | "success" | "partial" | "error";

export interface SyncRunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: SyncRunStatus;
  result_summary: Record<string, unknown> | null;
  error: string | null;
}

/**
 * Create a new sync run. Returns run id or error.
 * When projectId is provided, the run is associated with that project.
 */
export async function createSyncRun(
  client: SupabaseClient,
  projectId?: string | null
): Promise<{ id: string | null; error: string | null }> {
  const row: Record<string, unknown> = { status: "running" };
  if (projectId) row.project_id = projectId;
  const { data, error } = await client
    .from(SYNC_RUNS_TABLE)
    .insert(row)
    .select("id")
    .single();
  if (error) return { id: null, error: error.message };
  const id = data?.id;
  return { id: typeof id === "string" ? id : null, error: null };
}

/**
 * Update sync run with finish time, status, and optional result/error.
 */
export async function updateSyncRun(
  client: SupabaseClient,
  runId: string,
  payload: {
    finished_at?: string;
    status: SyncRunStatus;
    result_summary?: Record<string, unknown> | null;
    error?: string | null;
  }
): Promise<{ error: string | null }> {
  const { error } = await client
    .from(SYNC_RUNS_TABLE)
    .update({
      finished_at: payload.finished_at ?? new Date().toISOString(),
      status: payload.status,
      result_summary: payload.result_summary ?? null,
      error: payload.error ?? null,
    })
    .eq("id", runId);
  return { error: error?.message ?? null };
}

/**
 * Insert a sync log entry (log message or upsert event). Fails silently if table is missing.
 */
export async function insertSyncLogEntry(
  client: SupabaseClient,
  runId: string,
  entry: {
    kind: "log" | "upsert";
    level: "info" | "error";
    message: string;
    table_name?: string | null;
    row_count?: number | null;
    data?: Record<string, unknown> | null;
  }
): Promise<{ error: string | null }> {
  const { error } = await client.from(SYNC_LOG_ENTRIES_TABLE).insert({
    run_id: runId,
    kind: entry.kind,
    level: entry.level,
    message: entry.message,
    table_name: entry.table_name ?? null,
    row_count: entry.row_count ?? null,
    data: entry.data ?? null,
  });
  return { error: error?.message ?? null };
}

export function getSupabase(): SupabaseClient | null {
  if (!url || !key) return null;
  return createClient(url, key);
}

// --- LinkedIn Messages (table: LinkedinMessages) ---

export interface GetLinkedinMessagesParams {
  sender?: string;
  senderId?: string;
  senderProfileUuid?: string;
  contactId?: string;
  leadUuid?: string;
  leadId?: string;
  conversationUuid?: string;
  /** Message UUID (table primary key; no separate id column). */
  messageId?: string;
  channel?: string;
  direction?: string;
  status?: string;
  createdAfter?: string;
  createdBefore?: string;
  limit?: number;
  offset?: number;
  orderBy?: string;
  order?: "asc" | "desc";
}

export async function getLinkedinMessages(
  client: SupabaseClient,
  params: GetLinkedinMessagesParams
): Promise<{ data: unknown[]; error: string | null }> {
  let query = client.from(LINKEDIN_MESSAGES_TABLE).select("*");

  if (params.sender != null) query = query.eq("sender", params.sender);
  if (params.senderId != null) query = query.eq("sender_id", params.senderId);
  if (params.senderProfileUuid != null)
    query = query.eq("sender_profile_uuid", params.senderProfileUuid);
  if (params.contactId != null) query = query.eq("contact_id", params.contactId);
  if (params.leadUuid != null) query = query.eq("lead_uuid", params.leadUuid);
  if (params.leadId != null) query = query.eq("lead_id", params.leadId);
  if (params.conversationUuid != null)
    query = query.eq("linkedin_conversation_uuid", params.conversationUuid);
  if (params.messageId != null) query = query.eq("uuid", params.messageId);
  if (params.channel != null) query = query.eq("channel", params.channel);
  if (params.direction != null) query = query.eq("direction", params.direction);
  if (params.status != null) query = query.eq("status", params.status);
  if (params.createdAfter != null)
    query = query.gte("created_at", params.createdAfter);
  if (params.createdBefore != null)
    query = query.lte("created_at", params.createdBefore);

  const orderBy = params.orderBy ?? "created_at";
  const order = params.order ?? "desc";
  query = query.order(orderBy, { ascending: order === "asc" });

  const limit = Math.min(Math.max(params.limit ?? 100, 1), 1000);
  const offset = Math.max(params.offset ?? 0, 0);
  query = query.range(offset, offset + limit - 1);

  const { data, error } = await query;
  if (error) return { data: [], error: error.message };
  return { data: data ?? [], error: null };
}

// --- Aggregated: conversation by contact full name ---

export interface ConversationByContactFullNameResult {
  contact: Record<string, unknown> | null;
  messages: unknown[];
  error: string | null;
}

/**
 * Find a contact by full name (case-insensitive match on name), then return
 * that contact and all LinkedIn messages (conversation) linked via lead_uuid.
 * Messages are ordered by sent_at ascending (chronological).
 */
export async function getConversationByContactFullName(
  client: SupabaseClient,
  contactFullName: string,
  options?: { messageLimit?: number }
): Promise<ConversationByContactFullNameResult> {
  const trimmed = contactFullName?.trim();
  if (!trimmed) {
    return { contact: null, messages: [], error: "contactFullName is required." };
  }

  const { data: contacts, error: contactError } = await client
    .from(CONTACTS_TABLE)
    .select("*")
    .ilike("name", `%${trimmed}%`)
    .limit(10);

  if (contactError) {
    return { contact: null, messages: [], error: contactError.message };
  }
  const contact = Array.isArray(contacts) && contacts.length > 0 ? contacts[0] : null;
  if (!contact || typeof contact !== "object" || !("uuid" in contact)) {
    return {
      contact: null,
      messages: [],
      error: `No contact found matching "${trimmed}".`,
    };
  }

  const leadUuid = contact.uuid as string;
  const messageLimit = Math.min(Math.max(options?.messageLimit ?? 500, 1), 1000);
  const msgResult = await getLinkedinMessages(client, {
    leadUuid,
    orderBy: "sent_at",
    order: "asc",
    limit: messageLimit,
  });

  if (msgResult.error) {
    return {
      contact: contact as Record<string, unknown>,
      messages: [],
      error: msgResult.error,
    };
  }

  return {
    contact: contact as Record<string, unknown>,
    messages: msgResult.data,
    error: null,
  };
}

/** Result for conversation API: messages (and optional contact when queried by leadUuid). */
export interface GetConversationResult {
  contact?: Record<string, unknown> | null;
  messages: unknown[];
  error: string | null;
}

/**
 * Get LinkedIn conversation(s) by contact (leadUuid), by message (conversationUuid),
 * or by sender (senderProfileUuid). Messages ordered by sent_at ascending.
 */
export async function getConversation(
  client: SupabaseClient,
  params: {
    leadUuid?: string;
    conversationUuid?: string;
    senderProfileUuid?: string;
    messageLimit?: number;
  }
): Promise<GetConversationResult> {
  const limit = Math.min(Math.max(params.messageLimit ?? 500, 1), 1000);
  if (params.leadUuid) {
    const contactRes = await client
      .from(CONTACTS_TABLE)
      .select("*")
      .eq("uuid", params.leadUuid)
      .limit(1)
      .maybeSingle();
    const contact = contactRes.data ?? null;
    const msgResult = await getLinkedinMessages(client, {
      leadUuid: params.leadUuid,
      orderBy: "sent_at",
      order: "asc",
      limit,
    });
    return {
      contact: contact as Record<string, unknown> | null,
      messages: msgResult.error ? [] : msgResult.data,
      error: msgResult.error,
    };
  }
  if (params.conversationUuid) {
    const msgResult = await getLinkedinMessages(client, {
      conversationUuid: params.conversationUuid,
      orderBy: "sent_at",
      order: "asc",
      limit,
    });
    const messages = msgResult.error ? [] : msgResult.data;
    let contact: Record<string, unknown> | null = null;
    if (Array.isArray(messages) && messages.length > 0) {
      const first = messages[0] as Record<string, unknown>;
      const leadUuid = first?.lead_uuid != null ? String(first.lead_uuid) : null;
      if (leadUuid) {
        const contactRes = await client
          .from(CONTACTS_TABLE)
          .select("*")
          .eq("uuid", leadUuid)
          .limit(1)
          .maybeSingle();
        contact = (contactRes.data ?? null) as Record<string, unknown> | null;
      }
    }
    return { contact, messages, error: msgResult.error };
  }
  if (params.senderProfileUuid) {
    const msgResult = await getLinkedinMessages(client, {
      senderProfileUuid: params.senderProfileUuid,
      orderBy: "sent_at",
      order: "asc",
      limit,
    });
    return { messages: msgResult.error ? [] : msgResult.data, error: msgResult.error };
  }
  return { messages: [], error: "Provide leadUuid, conversationUuid, or senderProfileUuid." };
}

// --- CompaniesContext (table: CompaniesContext) ---
// Table: id, created_at, rootContext, company_id (FK to companies.id).

export const COMPANIES_CONTEXT_TABLE = "CompaniesContext";

export interface CompanyContextRow {
  id: string;
  created_at: string;
  rootContext: string | null;
  company_id: string | null;
}

/**
 * List company context entries by company_id.
 */
export async function listCompanyContextsByCompanyId(
  client: SupabaseClient,
  companyId: string
): Promise<{ data: CompanyContextRow[]; error: string | null }> {
  const id = companyId?.trim();
  if (!id) return { data: [], error: "company_id is required." };
  const { data, error } = await client
    .from(COMPANIES_CONTEXT_TABLE)
    .select("*")
    .eq("company_id", id)
    .order("created_at", { ascending: false });
  if (error) return { data: [], error: error.message };
  return { data: (data as CompanyContextRow[] | null) ?? [], error: null };
}

/**
 * Get latest company context entry by company_id.
 */
export async function getCompanyContextByCompanyId(
  client: SupabaseClient,
  companyId: string
): Promise<{ data: CompanyContextRow | null; error: string | null }> {
  const list = await listCompanyContextsByCompanyId(client, companyId);
  if (list.error) return { data: null, error: list.error };
  return { data: list.data[0] ?? null, error: null };
}

/**
 * Add a new company context entry row. company_id is required.
 */
export async function addCompanyContextEntry(
  client: SupabaseClient,
  companyId: string,
  rootContext: string | null
): Promise<{ data: CompanyContextRow | null; error: string | null }> {
  const id = companyId?.trim();
  if (!id) return { data: null, error: "company_id is required." };
  const payload = { company_id: id, rootContext: rootContext ?? null };
  const { data, error } = await client
    .from(COMPANIES_CONTEXT_TABLE)
    .insert(payload)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as CompanyContextRow, error: null };
}

/**
 * Set root context for a company: update latest row if present, otherwise insert.
 * Prefer addCompanyContextEntry for multi-context.
 */
export async function setCompanyRootContext(
  client: SupabaseClient,
  companyId: string,
  rootContext: string | null
): Promise<{ data: CompanyContextRow | null; error: string | null }> {
  const id = companyId?.trim();
  if (!id) return { data: null, error: "company_id is required." };
  const list = await listCompanyContextsByCompanyId(client, id);
  if (list.error) return { data: null, error: list.error };
  const latest = list.data[0];
  if (latest?.id) {
    const { data, error } = await client
      .from(COMPANIES_CONTEXT_TABLE)
      .update({ rootContext: rootContext ?? null })
      .eq("id", latest.id)
      .select()
      .single();
    if (error) return { data: null, error: error.message };
    return { data: data as CompanyContextRow, error: null };
  }
  return await addCompanyContextEntry(client, id, rootContext);
}

/**
 * Get context counts for many companies in one query. Returns Record<company_id, count>.
 * IDs not present in the table get count 0.
 */
export async function getCompanyContextCounts(
  client: SupabaseClient,
  companyIds: string[]
): Promise<{ data: Record<string, number>; error: string | null }> {
  const ids = companyIds.map((id) => id?.trim()).filter(Boolean);
  const result: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  if (ids.length === 0) return { data: result, error: null };
  const { data, error } = await client
    .from(COMPANIES_CONTEXT_TABLE)
    .select("company_id")
    .in("company_id", ids);
  if (error) return { data: result, error: error.message };
  const rows = (data as { company_id: string | null }[] | null) ?? [];
  for (const row of rows) {
    if (row.company_id != null && row.company_id in result) {
      result[row.company_id] += 1;
    }
  }
  return { data: result, error: null };
}

// --- ContactsContext (table: ContactsContext) ---
// Table: id, created_at, rootContext, contact_id (FK to Contacts.uuid).

export const CONTACTS_CONTEXT_TABLE = "ContactsContext";

export interface ContactContextRow {
  id: string;
  created_at: string;
  rootContext: string | null;
  contact_id: string | null;
}

/**
 * List contact context entries by contact_id (Contacts.uuid).
 */
export async function listContactContextsByContactId(
  client: SupabaseClient,
  contactId: string
): Promise<{ data: ContactContextRow[]; error: string | null }> {
  const id = contactId?.trim();
  if (!id) return { data: [], error: "contact_id is required." };
  const { data, error } = await client
    .from(CONTACTS_CONTEXT_TABLE)
    .select("*")
    .eq("contact_id", id)
    .order("created_at", { ascending: false });
  if (error) return { data: [], error: error.message };
  return { data: (data as ContactContextRow[] | null) ?? [], error: null };
}

/**
 * Get latest contact context entry by contact_id.
 */
export async function getContactContextByContactId(
  client: SupabaseClient,
  contactId: string
): Promise<{ data: ContactContextRow | null; error: string | null }> {
  const list = await listContactContextsByContactId(client, contactId);
  if (list.error) return { data: null, error: list.error };
  return { data: list.data[0] ?? null, error: null };
}

/**
 * Add a new contact context entry row. contact_id is required.
 */
export async function addContactContextEntry(
  client: SupabaseClient,
  contactId: string,
  rootContext: string | null
): Promise<{ data: ContactContextRow | null; error: string | null }> {
  const id = contactId?.trim();
  if (!id) return { data: null, error: "contact_id is required." };
  const payload = { contact_id: id, rootContext: rootContext ?? null };
  const { data, error } = await client
    .from(CONTACTS_CONTEXT_TABLE)
    .insert(payload)
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as ContactContextRow, error: null };
}

/**
 * Set root context for a contact: update latest row if present, otherwise insert.
 * Prefer addContactContextEntry for multi-context.
 */
export async function setContactRootContext(
  client: SupabaseClient,
  contactId: string,
  rootContext: string | null
): Promise<{ data: ContactContextRow | null; error: string | null }> {
  const id = contactId?.trim();
  if (!id) return { data: null, error: "contact_id is required." };
  const list = await listContactContextsByContactId(client, id);
  if (list.error) return { data: null, error: list.error };
  const latest = list.data[0];
  if (latest?.id) {
    const { data, error } = await client
      .from(CONTACTS_CONTEXT_TABLE)
      .update({ rootContext: rootContext ?? null })
      .eq("id", latest.id)
      .select()
      .single();
    if (error) return { data: null, error: error.message };
    return { data: data as ContactContextRow, error: null };
  }
  return await addContactContextEntry(client, id, rootContext);
}

/**
 * Get context counts for many contacts in one query. Returns Record<contact_id, count>.
 * IDs not present in the table get count 0.
 */
export async function getContactContextCounts(
  client: SupabaseClient,
  contactIds: string[]
): Promise<{ data: Record<string, number>; error: string | null }> {
  const ids = contactIds.map((id) => id?.trim()).filter(Boolean);
  const result: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  if (ids.length === 0) return { data: result, error: null };
  const { data, error } = await client
    .from(CONTACTS_CONTEXT_TABLE)
    .select("contact_id")
    .in("contact_id", ids);
  if (error) return { data: result, error: error.message };
  const rows = (data as { contact_id: string | null }[] | null) ?? [];
  for (const row of rows) {
    if (row.contact_id != null && row.contact_id in result) {
      result[row.contact_id] += 1;
    }
  }
  return { data: result, error: null };
}

// --- Senders (table: Senders) ---

export interface GetSendersParams {
  uuid?: string;
  teamId?: number;
  linkedinBrowserId?: number;
  linkedinAccountUuid?: string;
  assigneeUserId?: number;
  firstName?: string;
  lastName?: string;
  label?: string;
  smartLimitsEnabled?: boolean;
  avatarUrl?: string;
  status?: string;
  userId?: number;
  lastAutomationServerId?: number;
  notificationEmails?: string;
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  holdTasksTillAfter?: string;
  holdTasksTillBefore?: string;
  limit?: number;
  offset?: number;
  orderBy?: string;
  order?: "asc" | "desc";
}

export async function getSenders(
  client: SupabaseClient,
  params: GetSendersParams
): Promise<{ data: unknown[]; error: string | null }> {
  let query = client.from(SENDERS_TABLE).select("*");

  if (params.uuid != null) query = query.eq("uuid", params.uuid);
  if (params.teamId != null) query = query.eq("team_id", params.teamId);
  if (params.linkedinBrowserId != null)
    query = query.eq("linkedin_browser_id", params.linkedinBrowserId);
  if (params.linkedinAccountUuid != null)
    query = query.eq("linkedin_account_uuid", params.linkedinAccountUuid);
  if (params.assigneeUserId != null)
    query = query.eq("assignee_user_id", params.assigneeUserId);
  if (params.firstName != null) query = query.eq("first_name", params.firstName);
  if (params.lastName != null) query = query.eq("last_name", params.lastName);
  if (params.label != null) query = query.eq("label", params.label);
  if (params.smartLimitsEnabled != null)
    query = query.eq("smart_limits_enabled", params.smartLimitsEnabled);
  if (params.avatarUrl != null) query = query.eq("avatar_url", params.avatarUrl);
  if (params.status != null) query = query.eq("status", params.status);
  if (params.userId != null) query = query.eq("user_id", params.userId);
  if (params.lastAutomationServerId != null)
    query = query.eq("last_automation_server_id", params.lastAutomationServerId);
  if (params.notificationEmails != null)
    query = query.eq("notification_emails", params.notificationEmails);
  if (params.createdAfter != null)
    query = query.gte("created_at", params.createdAfter);
  if (params.createdBefore != null)
    query = query.lte("created_at", params.createdBefore);
  if (params.updatedAfter != null)
    query = query.gte("updated_at", params.updatedAfter);
  if (params.updatedBefore != null)
    query = query.lte("updated_at", params.updatedBefore);
  if (params.holdTasksTillAfter != null)
    query = query.gte("hold_tasks_till", params.holdTasksTillAfter);
  if (params.holdTasksTillBefore != null)
    query = query.lte("hold_tasks_till", params.holdTasksTillBefore);

  const orderBy = params.orderBy ?? "created_at";
  const order = params.order ?? "desc";
  query = query.order(orderBy, { ascending: order === "asc" });

  const limit = Math.min(Math.max(params.limit ?? 100, 1), 1000);
  const offset = Math.max(params.offset ?? 0, 0);
  query = query.range(offset, offset + limit - 1);

  const { data, error } = await query;
  if (error) return { data: [], error: error.message };
  return { data: data ?? [], error: null };
}

// --- Contacts (table: Contacts) ---

export interface GetContactsParams {
  uuid?: string;
  teamId?: number;
  userId?: string;
  listUuid?: string;
  dataSourceUuid?: string;
  aiAgentUuid?: string;
  aiAgentMode?: string;
  aiEngagementStatusUuid?: string;
  pipelineStageUuid?: string;
  companyUuid?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  companyLnId?: string;
  position?: string;
  headline?: string;
  about?: string;
  avatarUrl?: string;
  lnMemberId?: number;
  lnId?: string;
  snId?: string;
  linkedin?: string;
  facebook?: string;
  twitter?: string;
  workEmail?: string;
  workEmailDomain?: string;
  personalEmail?: string;
  workPhoneNumber?: string;
  personalPhoneNumber?: string;
  connectionsNumber?: string;
  followersNumber?: string;
  primaryLanguage?: string;
  hasOpenProfile?: string;
  hasVerifiedProfile?: string;
  hasPremium?: string;
  rawAddress?: string;
  location?: string;
  status?: string;
  linkedinStatus?: string;
  emailStatus?: string;
  lastAutomationApproveAt?: string;
  lastStopOnReplyAt?: string;
  lastEnrichAtAfter?: string;
  lastEnrichAtBefore?: string;
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  limit?: number;
  offset?: number;
  orderBy?: string;
  order?: "asc" | "desc";
}

export async function getContacts(
  client: SupabaseClient,
  params: GetContactsParams
): Promise<{ data: unknown[]; error: string | null }> {
  let query = client.from(CONTACTS_TABLE).select("*");

  if (params.uuid != null) query = query.eq("uuid", params.uuid);
  if (params.teamId != null) query = query.eq("team_id", params.teamId);
  if (params.userId != null) query = query.eq("user_id", params.userId);
  if (params.listUuid != null) query = query.eq("list_uuid", params.listUuid);
  if (params.dataSourceUuid != null)
    query = query.eq("data_source_uuid", params.dataSourceUuid);
  if (params.aiAgentUuid != null)
    query = query.eq("ai_agent_uuid", params.aiAgentUuid);
  if (params.aiAgentMode != null)
    query = query.eq("ai_agent_mode", params.aiAgentMode);
  if (params.aiEngagementStatusUuid != null)
    query = query.eq("ai_engagement_status_uuid", params.aiEngagementStatusUuid);
  if (params.pipelineStageUuid != null)
    query = query.eq("pipeline_stage_uuid", params.pipelineStageUuid);
  if (params.companyUuid != null)
    query = query.eq("company_uuid", params.companyUuid);
  if (params.name != null) query = query.eq("name", params.name);
  if (params.firstName != null) query = query.eq("first_name", params.firstName);
  if (params.lastName != null) query = query.eq("last_name", params.lastName);
  if (params.companyName != null)
    query = query.eq("company_name", params.companyName);
  if (params.companyLnId != null)
    query = query.eq("company_ln_id", params.companyLnId);
  if (params.position != null) query = query.eq("position", params.position);
  if (params.headline != null) query = query.eq("headline", params.headline);
  if (params.about != null) query = query.eq("about", params.about);
  if (params.avatarUrl != null) query = query.eq("avatar_url", params.avatarUrl);
  if (params.lnMemberId != null)
    query = query.eq("ln_member_id", params.lnMemberId);
  if (params.lnId != null) query = query.eq("ln_id", params.lnId);
  if (params.snId != null) query = query.eq("sn_id", params.snId);
  if (params.linkedin != null) query = query.eq("linkedin", params.linkedin);
  if (params.facebook != null) query = query.eq("facebook", params.facebook);
  if (params.twitter != null) query = query.eq("twitter", params.twitter);
  if (params.workEmail != null)
    query = query.eq("work_email", params.workEmail);
  if (params.workEmailDomain != null)
    query = query.eq("work_email_domain", params.workEmailDomain);
  if (params.personalEmail != null)
    query = query.eq("personal_email", params.personalEmail);
  if (params.workPhoneNumber != null)
    query = query.eq("work_phone_number", params.workPhoneNumber);
  if (params.personalPhoneNumber != null)
    query = query.eq("personal_phone_number", params.personalPhoneNumber);
  if (params.connectionsNumber != null)
    query = query.eq("connections_number", params.connectionsNumber);
  if (params.followersNumber != null)
    query = query.eq("followers_number", params.followersNumber);
  if (params.primaryLanguage != null)
    query = query.eq("primary_language", params.primaryLanguage);
  if (params.hasOpenProfile != null)
    query = query.eq("has_open_profile", params.hasOpenProfile);
  if (params.hasVerifiedProfile != null)
    query = query.eq("has_verified_profile", params.hasVerifiedProfile);
  if (params.hasPremium != null)
    query = query.eq("has_premium", params.hasPremium);
  if (params.rawAddress != null)
    query = query.eq("raw_address", params.rawAddress);
  if (params.location != null) query = query.eq("location", params.location);
  if (params.status != null) query = query.eq("status", params.status);
  if (params.linkedinStatus != null)
    query = query.eq("linkedin_status", params.linkedinStatus);
  if (params.emailStatus != null)
    query = query.eq("email_status", params.emailStatus);
  if (params.lastAutomationApproveAt != null)
    query = query.eq(
      "last_automation_approve_at",
      params.lastAutomationApproveAt
    );
  if (params.lastStopOnReplyAt != null)
    query = query.eq("last_stop_on_reply_at", params.lastStopOnReplyAt);
  if (params.lastEnrichAtAfter != null)
    query = query.gte("last_enrich_at", params.lastEnrichAtAfter);
  if (params.lastEnrichAtBefore != null)
    query = query.lte("last_enrich_at", params.lastEnrichAtBefore);
  if (params.createdAfter != null)
    query = query.gte("created_at", params.createdAfter);
  if (params.createdBefore != null)
    query = query.lte("created_at", params.createdBefore);
  if (params.updatedAfter != null)
    query = query.gte("updated_at", params.updatedAfter);
  if (params.updatedBefore != null)
    query = query.lte("updated_at", params.updatedBefore);

  const orderBy = params.orderBy ?? "created_at";
  const order = params.order ?? "desc";
  query = query.order(orderBy, { ascending: order === "asc" });

  const limit = Math.min(Math.max(params.limit ?? 100, 1), 1000);
  const offset = Math.max(params.offset ?? 0, 0);
  query = query.range(offset, offset + limit - 1);

  const { data, error } = await query;
  if (error) return { data: [], error: error.message };
  return { data: data ?? [], error: null };
}

// --- Table counts (for /api/supabase-state) ---

export interface TableCounts {
  contacts: number;
  linkedin_messages: number;
  senders: number;
}

/**
 * Returns the latest created_at (ISO string) for the table, or null if empty.
 * Used by incremental sync to fetch only rows newer than this from the source API.
 * When projectId is provided, only considers rows belonging to that project.
 */
export async function getLatestCreatedAt(
  client: SupabaseClient,
  table: string,
  projectId?: string | null
): Promise<{ latest: string | null; error: string | null }> {
  let query = client
    .from(table)
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1);
  if (projectId) {
    query = query.eq("project_id", projectId);
  }
  const { data, error } = await query.maybeSingle();
  if (error) return { latest: null, error: error.message };
  const raw = data?.created_at;
  if (raw == null) return { latest: null, error: null };
  const latest = typeof raw === "string" ? raw : (raw as Date).toISOString?.() ?? String(raw);
  return { latest, error: null };
}

// --- All companies (global browse, with per-project membership flag) ---

export interface AllCompanyRow {
  id: string;
  name: string | null;
  domain: string;
  linkedin_url: string | null;
  created_at: string;
  in_project: boolean;
  project_company_id: string | null;
}

/**
 * Create a new company row. Returns the created company id.
 */
export async function createCompany(
  client: SupabaseClient,
  payload: { name: string; domain?: string | null }
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await client
    .from(COMPANIES_TABLE)
    .insert({ name: payload.name, domain: payload.domain ?? null })
    .select("id")
    .single();
  if (error) return { id: null, error: error.message };
  return { id: (data as Record<string, unknown>).id as string, error: null };
}

/**
 * Fetch minimal company info (id, name, domain) for a given list of company UUIDs.
 * Useful for resolving names of companies referenced by contacts without loading all companies.
 */
export async function getCompaniesByIds(
  client: SupabaseClient,
  ids: string[]
): Promise<{ data: Array<{ id: string; name: string | null; domain: string | null }>; error: string | null }> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return { data: [], error: null };
  const { data, error } = await client
    .from(COMPANIES_TABLE)
    .select("id, name, domain")
    .in("id", unique);
  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as Array<{ id: string; name: string | null; domain: string | null }>, error: null };
}

/** LinkedIn-style profile fields from Contacts (for reply prompts). */
export interface ContactProfileForPromptRow {
  uuid: string;
  headline: string | null;
  about: string | null;
  experience: unknown;
  posts: unknown;
}

/**
 * Batch-load profile fields used when building reply context (headline, about, experience, posts).
 * `experience` and `posts` are typically JSON/array payloads from enrichment sync.
 */
export async function getContactsProfileForPromptByUuids(
  client: SupabaseClient,
  uuids: string[]
): Promise<{ data: ContactProfileForPromptRow[]; error: string | null }> {
  const unique = [...new Set(uuids)].filter(Boolean);
  if (unique.length === 0) return { data: [], error: null };
  const { data, error } = await client
    .from(CONTACTS_TABLE)
    .select("uuid, headline, about, experience, posts")
    .in("uuid", unique);
  if (error) return { data: [], error: error.message };
  return {
    data: (data ?? []) as ContactProfileForPromptRow[],
    error: null,
  };
}

/**
 * Set company_id (and optionally company_name) on a contact row.
 */
export async function updateContactCompany(
  client: SupabaseClient,
  contactId: string,
  companyId: string,
  companyName: string | null
): Promise<{ error: string | null }> {
  const update: Record<string, unknown> = { company_id: companyId };
  if (companyName != null) update.company_name = companyName;
  const { error } = await client
    .from(CONTACTS_TABLE)
    .update(update)
    .eq("uuid", contactId);
  return { error: error?.message ?? null };
}

/**
 * List all companies with optional search and pagination.
 * When projectId is supplied, each row carries `in_project` and `project_company_id`
 * so the UI can show which companies are already connected to the project.
 */
export async function getAllCompanies(
  client: SupabaseClient,
  options?: { search?: string | null; limit?: number; offset?: number; projectId?: string | null }
): Promise<{ data: AllCompanyRow[]; total: number; error: string | null }> {
  const limit = Math.min(Math.max(options?.limit ?? 25, 1), 100);
  const offset = Math.max(options?.offset ?? 0, 0);

  let query = client
    .from(COMPANIES_TABLE)
    .select("*", { count: "exact" })
    .order("name", { ascending: true })
    .range(offset, offset + limit - 1);

  const search = options?.search?.trim() ?? "";
  if (search.length > 0) {
    const escaped = search.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    const pattern = `%${escaped}%`;
    query = query.or(`name.ilike.${pattern},domain.ilike.${pattern}`);
  }

  const { data, error, count } = await query;
  if (error) return { data: [], total: 0, error: error.message };

  // Build project membership map (company_id -> project_company_id)
  const pcMap: Record<string, string> = {};
  if (options?.projectId && (data ?? []).length > 0) {
    const companyIds = (data as Array<Record<string, unknown>>).map((r) => r.id as string);
    const { data: pcData } = await client
      .from(PROJECT_COMPANIES_TABLE)
      .select("id, company_id")
      .eq("project_id", options.projectId)
      .in("company_id", companyIds);
    for (const pc of (pcData ?? []) as Array<Record<string, unknown>>) {
      pcMap[pc.company_id as string] = pc.id as string;
    }
  }

  const rows: AllCompanyRow[] = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    name: (r.name as string) ?? null,
    domain: r.domain as string,
    linkedin_url: (r.linkedin_url as string) ?? null,
    created_at: r.created_at as string,
    in_project: r.id as string in pcMap,
    project_company_id: pcMap[r.id as string] ?? null,
  }));

  return { data: rows, total: count ?? 0, error: null };
}

/**
 * Add companies to a project (bulk). Skips any already linked.
 * Returns the newly created project_company rows.
 */
export async function addCompaniesToProject(
  client: SupabaseClient,
  projectId: string,
  companyIds: string[]
): Promise<{ data: Array<{ id: string; company_id: string }>; error: string | null }> {
  if (companyIds.length === 0) return { data: [], error: null };

  // Find which ones are already linked
  const { data: existing } = await client
    .from(PROJECT_COMPANIES_TABLE)
    .select("company_id")
    .eq("project_id", projectId)
    .in("company_id", companyIds);

  const existingIds = new Set((existing ?? []).map((r: Record<string, unknown>) => r.company_id as string));
  const toInsert = companyIds.filter((id) => !existingIds.has(id));

  if (toInsert.length === 0) return { data: [], error: null };

  const rows = toInsert.map((cid) => ({ project_id: projectId, company_id: cid }));
  const { data, error } = await client
    .from(PROJECT_COMPANIES_TABLE)
    .insert(rows)
    .select("id, company_id");

  if (error) return { data: [], error: error.message };
  return { data: (data ?? []) as Array<{ id: string; company_id: string }>, error: null };
}

// --- project_companies, hypotheses, hypothesis_targets ---

export const PROJECT_COMPANIES_TABLE = "project_companies";
export const HYPOTHESES_TABLE = "hypotheses";
export const HYPOTHESIS_TARGETS_TABLE = "hypothesis_targets";

export interface ProjectCompanyContact {
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  project_id: string | null;
}

export interface ProjectCompanyRow {
  project_company_id: string;
  company_id: string;
  status: string | null;
  created_at: string;
  name: string | null;
  domain: string | null;
  linkedin_url: string | null;
  hypotheses: Array<{ id: string; name: string }>;
  contact_count: number;
  contacts_preview: ProjectCompanyContact[];
}

/**
 * List companies in a project (joining project_companies -> companies).
 * Also joins hypothesis_targets -> hypotheses to return which hypotheses each company appears in.
 * Supports optional search (name/domain ilike) and pagination with total count.
 */
export async function getProjectCompanies(
  client: SupabaseClient,
  projectId: string,
  options?: { search?: string | null; limit?: number; offset?: number; companyId?: string | null }
): Promise<{ data: ProjectCompanyRow[]; total: number; error: string | null }> {
  const limit = Math.min(Math.max(options?.limit ?? 25, 1), 100);
  const offset = Math.max(options?.offset ?? 0, 0);

  let query = client
    .from(PROJECT_COMPANIES_TABLE)
    .select(
      `id, status, created_at, company_id,
       companies!inner(id, name, domain, linkedin_url),
       hypothesis_targets(hypothesis_id, hypotheses(id, name))`,
      { count: "exact" }
    )
    .eq("project_id", projectId);

  if (options?.companyId) {
    query = query.eq("company_id", options.companyId);
  }

  const search = options?.search?.trim().toLowerCase() ?? "";
  if (search.length > 0) {
    const escaped = search.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    const pattern = `%${escaped}%`;
    query = query.or(`name.ilike.${pattern},domain.ilike.${pattern}`, {
      referencedTable: "companies",
    });
  }

  query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) return { data: [], total: 0, error: error.message };

  const rawRows = (data ?? []) as Array<Record<string, unknown>>;

  // Collect company_ids for the current page to fetch contacts in one query
  const companyIds = rawRows
    .map((r) => {
      const c = r.companies as Record<string, unknown> | null;
      return (c?.id ?? r.company_id) as string;
    })
    .filter(Boolean);

  // Fetch contacts for these companies (up to 10 per company, fetched as a batch)
  const contactsByCompany: Record<string, ProjectCompanyContact[]> = {};
  const contactCountByCompany: Record<string, number> = {};
  if (companyIds.length > 0) {
    const { data: contactData } = await client
      .from(CONTACTS_TABLE)
      .select("company_id, first_name, last_name, position, project_id")
      .in("company_id", companyIds)
      .order("created_at", { ascending: false })
      .limit(companyIds.length * 10); // generous upper bound per page

    for (const c of (contactData ?? []) as Array<Record<string, unknown>>) {
      const cid = c.company_id as string;
      if (!contactsByCompany[cid]) contactsByCompany[cid] = [];
      contactCountByCompany[cid] = (contactCountByCompany[cid] ?? 0) + 1;
      if (contactsByCompany[cid].length < 10) {
        contactsByCompany[cid].push({
          first_name: (c.first_name as string) ?? null,
          last_name: (c.last_name as string) ?? null,
          position: (c.position as string) ?? null,
          project_id: (c.project_id as string) ?? null,
        });
      }
    }
  }

  const rows: ProjectCompanyRow[] = rawRows.map((row) => {
    const company = (row.companies as Record<string, unknown> | null) ?? {};
    const companyId = (company.id ?? row.company_id) as string;
    const targets = (row.hypothesis_targets as Array<Record<string, unknown>> | null) ?? [];
    const hypotheses = targets
      .map((t) => t.hypotheses as Record<string, unknown> | null)
      .filter((h): h is Record<string, unknown> => h != null && typeof h.id === "string")
      .map((h) => ({ id: h.id as string, name: h.name as string }));
    return {
      project_company_id: row.id as string,
      company_id: companyId,
      status: (row.status as string) ?? null,
      created_at: row.created_at as string,
      name: (company.name as string) ?? null,
      domain: (company.domain as string) ?? null,
      linkedin_url: (company.linkedin_url as string) ?? null,
      hypotheses,
      contact_count: contactCountByCompany[companyId] ?? 0,
      contacts_preview: contactsByCompany[companyId] ?? [],
    };
  });

  return { data: rows, total: count ?? 0, error: null };
}

export interface HypothesisRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  target_persona: string | null;
  created_at: string;
  target_count: number;
}

/**
 * List hypotheses for a project with count of hypothesis_targets per hypothesis.
 */
export async function getHypothesesWithCounts(
  client: SupabaseClient,
  projectId: string
): Promise<{ data: HypothesisRow[]; error: string | null }> {
  const { data, error } = await client
    .from(HYPOTHESES_TABLE)
    .select("*, hypothesis_targets(count)")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) return { data: [], error: error.message };

  const rows: HypothesisRow[] = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const targets = row.hypothesis_targets as Array<Record<string, unknown>> | null;
    const target_count =
      Array.isArray(targets) && targets.length > 0
        ? (targets[0].count as number) ?? 0
        : 0;
    return {
      id: row.id as string,
      project_id: row.project_id as string,
      name: row.name as string,
      description: (row.description as string) ?? null,
      target_persona: (row.target_persona as string) ?? null,
      created_at: row.created_at as string,
      target_count,
    };
  });

  return { data: rows, error: null };
}

export interface HypothesisTargetRow {
  id: string;
  project_company_id: string;
  score: number | null;
  company_id: string | null;
  name: string | null;
  domain: string | null;
  linkedin_url: string | null;
  status: string | null;
}

/**
 * List targets for a hypothesis, joined with project_companies -> companies.
 */
export async function getHypothesisTargets(
  client: SupabaseClient,
  hypothesisId: string
): Promise<{ data: HypothesisTargetRow[]; error: string | null }> {
  const { data, error } = await client
    .from(HYPOTHESIS_TARGETS_TABLE)
    .select(
      "id, score, project_company_id, project_companies!inner(id, status, companies!inner(id, name, domain, linkedin_url))"
    )
    .eq("hypothesis_id", hypothesisId)
    .order("score", { ascending: false });

  if (error) return { data: [], error: error.message };

  const rows: HypothesisTargetRow[] = ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    const pc = (row.project_companies as Record<string, unknown> | null) ?? {};
    const company = (pc.companies as Record<string, unknown> | null) ?? {};
    return {
      id: row.id as string,
      project_company_id: row.project_company_id as string,
      score: (row.score as number) ?? null,
      company_id: (company.id as string) ?? null,
      name: (company.name as string) ?? null,
      domain: (company.domain as string) ?? null,
      linkedin_url: (company.linkedin_url as string) ?? null,
      status: (pc.status as string) ?? null,
    };
  });

  return { data: rows, error: null };
}

/**
 * Create a new hypothesis for a project.
 */
export async function createHypothesis(
  client: SupabaseClient,
  payload: {
    projectId: string;
    name: string;
    description?: string | null;
    targetPersona?: string | null;
  }
): Promise<{ data: { id: string } | null; error: string | null }> {
  const { data, error } = await client
    .from(HYPOTHESES_TABLE)
    .insert({
      project_id: payload.projectId,
      name: payload.name,
      description: payload.description ?? null,
      target_persona: payload.targetPersona ?? null,
    })
    .select("id")
    .single();
  if (error) return { data: null, error: error.message };
  return { data: { id: (data as Record<string, unknown>).id as string }, error: null };
}

/**
 * Update fields on an existing hypothesis.
 */
export async function updateHypothesis(
  client: SupabaseClient,
  id: string,
  payload: { name?: string; description?: string | null; targetPersona?: string | null }
): Promise<{ error: string | null }> {
  const update: Record<string, unknown> = {};
  if (payload.name !== undefined) update.name = payload.name;
  if (payload.description !== undefined) update.description = payload.description;
  if (payload.targetPersona !== undefined) update.target_persona = payload.targetPersona;
  if (Object.keys(update).length === 0) return { error: null };
  const { error } = await client.from(HYPOTHESES_TABLE).update(update).eq("id", id);
  return { error: error?.message ?? null };
}

/**
 * Delete a hypothesis (cascade deletes hypothesis_targets if configured in DB, otherwise manual cleanup needed).
 */
export async function deleteHypothesis(
  client: SupabaseClient,
  id: string
): Promise<{ error: string | null }> {
  const { error } = await client.from(HYPOTHESES_TABLE).delete().eq("id", id);
  return { error: error?.message ?? null };
}

/**
 * Bulk add project companies to a hypothesis as targets with an optional score.
 */
export async function addCompaniesToHypothesis(
  client: SupabaseClient,
  payload: { hypothesisId: string; projectCompanyIds: string[]; score?: number | null }
): Promise<{ error: string | null }> {
  if (payload.projectCompanyIds.length === 0) return { error: null };
  const rows = payload.projectCompanyIds.map((pcId) => ({
    hypothesis_id: payload.hypothesisId,
    project_company_id: pcId,
    score: payload.score ?? null,
  }));
  const { error } = await client.from(HYPOTHESIS_TARGETS_TABLE).insert(rows);
  return { error: error?.message ?? null };
}

/**
 * Remove project companies from a hypothesis (delete hypothesis_targets rows).
 */
export async function removeCompaniesFromHypothesis(
  client: SupabaseClient,
  payload: { hypothesisId: string; projectCompanyIds: string[] }
): Promise<{ error: string | null }> {
  const ids = [...new Set(payload.projectCompanyIds)].filter(Boolean);
  if (ids.length === 0) return { error: null };
  const { error } = await client
    .from(HYPOTHESIS_TARGETS_TABLE)
    .delete()
    .eq("hypothesis_id", payload.hypothesisId)
    .in("project_company_id", ids);
  return { error: error?.message ?? null };
}

export async function getTableCounts(
  client: SupabaseClient
): Promise<{ counts: TableCounts; error: string | null }> {
  try {
    const [contactsRes, messagesRes, sendersRes] = await Promise.all([
      client.from(CONTACTS_TABLE).select("*", { count: "exact", head: true }),
      client.from(LINKEDIN_MESSAGES_TABLE).select("*", { count: "exact", head: true }),
      client.from(SENDERS_TABLE).select("*", { count: "exact", head: true }),
    ]);
    const contacts = contactsRes.count ?? 0;
    const linkedin_messages = messagesRes.count ?? 0;
    const senders = sendersRes.count ?? 0;
    if (contactsRes.error) return { counts: { contacts: 0, linkedin_messages: 0, senders: 0 }, error: contactsRes.error.message };
    if (messagesRes.error) return { counts: { contacts: 0, linkedin_messages: 0, senders: 0 }, error: messagesRes.error.message };
    if (sendersRes.error) return { counts: { contacts: 0, linkedin_messages: 0, senders: 0 }, error: sendersRes.error.message };
    return { counts: { contacts, linkedin_messages, senders }, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { counts: { contacts: 0, linkedin_messages: 0, senders: 0 }, error: message };
  }
}

export interface LatestRows {
  contacts: unknown[];
  linkedin_messages: unknown[];
  senders: unknown[];
}

const DEFAULT_LATEST_LIMIT = 10;

/**
 * Returns the latest rows per table (by created_at desc) for visualization.
 * Used by /api/supabase-state so the UI can show what was recently updated.
 */
export async function getLatestRows(
  client: SupabaseClient,
  limit: number = DEFAULT_LATEST_LIMIT
): Promise<{ latest: LatestRows; error: string | null }> {
  const n = Math.min(Math.max(limit, 1), 100);
  try {
    const [contactsRes, messagesRes, sendersRes] = await Promise.all([
      client.from(CONTACTS_TABLE).select("*").order("created_at", { ascending: false }).limit(n),
      client.from(LINKEDIN_MESSAGES_TABLE).select("*").order("created_at", { ascending: false }).limit(n),
      client.from(SENDERS_TABLE).select("*").order("created_at", { ascending: false }).limit(n),
    ]);
    const latest: LatestRows = {
      contacts: contactsRes.data ?? [],
      linkedin_messages: messagesRes.data ?? [],
      senders: sendersRes.data ?? [],
    };
    if (contactsRes.error) return { latest, error: contactsRes.error.message };
    if (messagesRes.error) return { latest, error: messagesRes.error.message };
    if (sendersRes.error) return { latest, error: sendersRes.error.message };
    return { latest, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      latest: { contacts: [], linkedin_messages: [], senders: [] },
      error: message,
    };
  }
}

// --- Table query with filters (for /api/supabase-table-query) ---

export const TABLE_KEY_TO_NAME: Record<string, string> = {
  contacts: CONTACTS_TABLE,
  linkedin_messages: LINKEDIN_MESSAGES_TABLE,
  senders: SENDERS_TABLE,
};

/** Filters: column key -> array of values (row must match one of the values per column). */
export interface TableQueryFilters {
  [columnKey: string]: (string | number)[] | string | number | null | undefined;
}

/** Columns to search with ILIKE %term% per table (case-insensitive). */
export const SEARCH_COLUMNS_BY_TABLE: Record<string, string[]> = {
  contacts: ["company_name", "first_name", "last_name", "position"],
  linkedin_messages: ["text"],
  senders: ["first_name", "last_name"],
};

/** Escape user input for use inside PostgREST ilike pattern (literal % and _; quote-safe). */
function escapeSearchTerm(term: string): string {
  return term
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

export async function queryTableWithFilters(
  client: SupabaseClient,
  tableKey: string,
  params: {
    filters: TableQueryFilters;
    search?: string | null;
    limit?: number;
    offset?: number;
  }
): Promise<{ data: unknown[]; total: number; error: string | null }> {
  const tableName = TABLE_KEY_TO_NAME[tableKey];
  if (!tableName) {
    return { data: [], total: 0, error: `Unknown table: ${tableKey}` };
  }
  const limit = Math.min(Math.max(params.limit ?? 25, 1), 100);
  const offset = Math.max(params.offset ?? 0, 0);

  let query = client.from(tableName).select("*", { count: "exact" });

  for (const [columnKey, raw] of Object.entries(params.filters)) {
    if (raw === null || raw === undefined) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    const trimmed = values.filter((v) => v !== "" && v !== null && v !== undefined);
    if (trimmed.length === 0) continue;
    query = query.in(columnKey, trimmed);
  }

  const searchTrimmed = typeof params.search === "string" ? params.search.trim().toLowerCase() : "";
  if (searchTrimmed.length > 0) {
    const columns = SEARCH_COLUMNS_BY_TABLE[tableKey];
    if (columns && columns.length > 0) {
      const escaped = escapeSearchTerm(searchTrimmed);
      const pattern = `%${escaped}%`;
      const orClause = columns.map((col) => `${col}.ilike."${pattern}"`).join(",");
      query = query.or(orClause);
    }
  }

  query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) return { data: [], total: 0, error: error.message };
  return { data: data ?? [], total: count ?? 0, error: null };
}

// ── Conversations List ───────────────────────────────────────────────────────

/** UI / filter bucket for reply state (matches ConversationsPage tags). */
export type ConversationReplyTag = "no_response" | "waiting_for_response" | "got_response";

export interface ConversationListItem {
  conversationUuid: string;
  leadUuid: string | null;
  senderProfileUuid: string | null;
  senderDisplayName: string;
  receiverDisplayName: string;
  receiverTitle: string | null;
  receiverCompanyName: string | null;
  receiverAvatarUrl: string | null;
  receiverCompanyId: string | null;
  lastMessageText: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  inboxCount: number;
  outboxCount: number;
  /** True when the chronologically last message was sent by us (outbox). */
  lastMessageIsOutbox: boolean;
  /** Number of hypotheses the receiver's company appears in (for this project). */
  hypothesisCount: number;
  replyTag: ConversationReplyTag;
}

function deriveConversationReplyTag(item: {
  inboxCount: number;
  outboxCount: number;
  lastMessageIsOutbox: boolean;
}): ConversationReplyTag {
  if (item.outboxCount > 0 && item.inboxCount === 0) return "no_response";
  if (item.inboxCount > 0 && item.lastMessageIsOutbox) return "waiting_for_response";
  if (item.inboxCount > 0 && !item.lastMessageIsOutbox) return "got_response";
  if (item.inboxCount > 0) return "got_response";
  return "no_response";
}

const CONV_LIST_PAGE = 1000;
const CONV_LIST_MAX_PAGES = 200;

export async function getConversationsList(
  client: SupabaseClient,
  projectId: string,
  options?: {
    limit?: number;
    offset?: number;
    /** Case-insensitive match on receiver/sender name, company, last message text. */
    search?: string | null;
    replyTag?: ConversationReplyTag | null;
  }
): Promise<{ data: ConversationListItem[]; total: number; error: string | null }> {
  const rawMessages: Array<Record<string, unknown>> = [];
  for (let page = 0; page < CONV_LIST_MAX_PAGES; page++) {
    const from = page * CONV_LIST_PAGE;
    const to = from + CONV_LIST_PAGE - 1;
    const { data: chunk, error: msgErr } = await client
      .from(LINKEDIN_MESSAGES_TABLE)
      .select("linkedin_conversation_uuid, lead_uuid, sender_profile_uuid, text, sent_at, type, linkedin_type")
      .eq("project_id", projectId)
      .order("sent_at", { ascending: true })
      .range(from, to);

    if (msgErr) return { data: [], total: 0, error: msgErr.message };
    const rows = (chunk ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) break;
    rawMessages.push(...rows);
    if (rows.length < CONV_LIST_PAGE) break;
  }

  // Group by conversation uuid
  const grouped = new Map<string, {
    lead_uuid: string | null;
    sender_profile_uuid: string | null;
    msgs: Array<Record<string, unknown>>;
  }>();

  for (const msg of rawMessages) {
    const convId = msg["linkedin_conversation_uuid"] as string | null;
    if (!convId) continue;
    if (!grouped.has(convId)) {
      grouped.set(convId, {
        lead_uuid: (msg["lead_uuid"] as string | null) ?? null,
        sender_profile_uuid: (msg["sender_profile_uuid"] as string | null) ?? null,
        msgs: [],
      });
    }
    grouped.get(convId)!.msgs.push(msg);
  }

  // Collect unique lead_uuids and sender_profile_uuids for batch fetching
  const leadUuids = [...new Set([...grouped.values()].map((g) => g.lead_uuid).filter(Boolean) as string[])];
  const senderUuids = [...new Set([...grouped.values()].map((g) => g.sender_profile_uuid).filter(Boolean) as string[])];

  const contactMap = new Map<string, Record<string, unknown>>();
  const senderMap = new Map<string, Record<string, unknown>>();

  if (leadUuids.length > 0) {
    const { data: contacts } = await client
      .from(CONTACTS_TABLE)
      .select("uuid, first_name, last_name, name, position, company_name, avatar_url, company_id")
      .in("uuid", leadUuids);
    for (const c of (contacts ?? []) as Array<Record<string, unknown>>) {
      if (c.uuid) contactMap.set(c.uuid as string, c);
    }
  }

  if (senderUuids.length > 0) {
    const { data: senders } = await client
      .from(SENDERS_TABLE)
      .select("uuid, first_name, last_name, label")
      .in("uuid", senderUuids);
    for (const s of (senders ?? []) as Array<Record<string, unknown>>) {
      if (s.uuid) senderMap.set(s.uuid as string, s);
    }
  }

  // Collect unique company_ids to batch-resolve hypothesis counts
  const companyIds = [...new Set(
    [...contactMap.values()]
      .map((c) => c.company_id as string | null)
      .filter(Boolean) as string[]
  )];

  // Map company_id → number of hypotheses it belongs to (in this project)
  const hypothesisCountByCompany = new Map<string, number>();
  if (companyIds.length > 0) {
    const { data: pcRows } = await client
      .from(PROJECT_COMPANIES_TABLE)
      .select("company_id, hypothesis_targets(count)")
      .eq("project_id", projectId)
      .in("company_id", companyIds);

    for (const row of (pcRows ?? []) as Array<Record<string, unknown>>) {
      const cid = row.company_id as string;
      const targets = row.hypothesis_targets as Array<Record<string, unknown>> | null;
      const cnt = Array.isArray(targets) && targets.length > 0
        ? (targets[0].count as number) ?? 0
        : 0;
      const existing = hypothesisCountByCompany.get(cid) ?? 0;
      hypothesisCountByCompany.set(cid, existing + cnt);
    }
  }

  function displayName(c: Record<string, unknown> | null, fallback: string): string {
    if (!c) return fallback;
    if (typeof c.name === "string" && c.name.trim()) return c.name.trim();
    const f = typeof c.first_name === "string" ? c.first_name.trim() : "";
    const l = typeof c.last_name === "string" ? c.last_name.trim() : "";
    if (f || l) return [f, l].filter(Boolean).join(" ");
    if (typeof c.label === "string" && c.label.trim()) return c.label.trim();
    return fallback;
  }

  const allItems: ConversationListItem[] = [];
  for (const [convId, group] of grouped.entries()) {
    const { msgs } = group;
    let inboxCount = 0;
    let outboxCount = 0;
    let lastMsg: Record<string, unknown> | null = null;
    let lastAt: string | null = null;

    for (const m of msgs) {
      const t = String(m["type"] ?? m["linkedin_type"] ?? "").toLowerCase();
      if (t === "inbox") inboxCount++;
      else if (t === "outbox") outboxCount++;
      const at = m["sent_at"] as string | null;
      if (at && (!lastAt || at > lastAt)) {
        lastAt = at;
        lastMsg = m;
      }
    }

    const lastMsgType = lastMsg
      ? String(lastMsg["type"] ?? lastMsg["linkedin_type"] ?? "").toLowerCase()
      : "";

    const contact = group.lead_uuid ? contactMap.get(group.lead_uuid) ?? null : null;
    const sender = group.sender_profile_uuid ? senderMap.get(group.sender_profile_uuid) ?? null : null;
    const companyId = contact ? ((contact.company_id as string | null) ?? null) : null;

    const lastMessageIsOutbox = lastMsgType === "outbox";
    const replyTag = deriveConversationReplyTag({
      inboxCount,
      outboxCount,
      lastMessageIsOutbox,
    });

    allItems.push({
      conversationUuid: convId,
      leadUuid: group.lead_uuid,
      senderProfileUuid: group.sender_profile_uuid,
      senderDisplayName: displayName(sender, "Unknown Sender"),
      receiverDisplayName: displayName(contact, group.lead_uuid ? group.lead_uuid.slice(0, 8) + "…" : "Unknown"),
      receiverTitle: contact ? ((contact.position as string | null) ?? null) : null,
      receiverCompanyName: contact ? ((contact.company_name as string | null) ?? null) : null,
      receiverAvatarUrl: contact ? ((contact.avatar_url as string | null) ?? null) : null,
      receiverCompanyId: companyId,
      lastMessageText: lastMsg ? ((lastMsg.text as string | null) ?? null) : null,
      lastMessageAt: lastAt,
      messageCount: msgs.length,
      inboxCount,
      outboxCount,
      lastMessageIsOutbox,
      hypothesisCount: companyId ? (hypothesisCountByCompany.get(companyId) ?? 0) : 0,
      replyTag,
    });
  }

  // Sort by lastMessageAt desc
  allItems.sort((a, b) => {
    const da = a.lastMessageAt ?? "";
    const db = b.lastMessageAt ?? "";
    return db.localeCompare(da);
  });

  const searchRaw = typeof options?.search === "string" ? options.search.trim().toLowerCase() : "";
  let filtered = allItems;
  if (searchRaw.length > 0) {
    filtered = allItems.filter(
      (c) =>
        c.receiverDisplayName.toLowerCase().includes(searchRaw) ||
        c.senderDisplayName.toLowerCase().includes(searchRaw) ||
        (c.receiverCompanyName ?? "").toLowerCase().includes(searchRaw) ||
        (c.lastMessageText ?? "").toLowerCase().includes(searchRaw)
    );
  }

  const tagFilter = options?.replyTag ?? null;
  if (tagFilter) {
    filtered = filtered.filter((c) => c.replyTag === tagFilter);
  }

  const offset = options?.offset ?? 0;
  const limit = Math.min(options?.limit ?? 50, 200);
  const total = filtered.length;
  return { data: filtered.slice(offset, offset + limit), total, error: null };
}

// ── Company Hypotheses ────────────────────────────────────────────────────────

export async function getCompanyHypotheses(
  client: SupabaseClient,
  companyId: string,
  projectId: string
): Promise<{ data: Array<{ id: string; name: string }>; projectCompanyId: string | null; error: string | null }> {
  // Find project_company row for this company in this project
  const { data: pcRows, error: pcErr } = await client
    .from(PROJECT_COMPANIES_TABLE)
    .select("id")
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .limit(1);

  if (pcErr) return { data: [], projectCompanyId: null, error: pcErr.message };

  const pc = (pcRows ?? [])[0] as Record<string, unknown> | undefined;
  if (!pc) return { data: [], projectCompanyId: null, error: null };

  const projectCompanyId = pc.id as string;

  const { data: targets, error: tErr } = await client
    .from(HYPOTHESIS_TARGETS_TABLE)
    .select("hypotheses(id, name)")
    .eq("project_company_id", projectCompanyId);

  if (tErr) return { data: [], projectCompanyId, error: tErr.message };

  const hypotheses = ((targets ?? []) as Array<Record<string, unknown>>)
    .map((t) => t.hypotheses as Record<string, unknown> | null)
    .filter((h): h is Record<string, unknown> => h != null && typeof h.id === "string")
    .map((h) => ({ id: h.id as string, name: h.name as string }));

  return { data: hypotheses, projectCompanyId, error: null };
}

// ── Contacts by Company ───────────────────────────────────────────────────────

export interface ContactWithConversations {
  uuid: string;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  position: string | null;
  avatar_url: string | null;
  company_id: string | null;
  conversations: Array<{ conversationUuid: string; messageCount: number; lastMessageAt: string | null }>;
}

export async function getContactsByCompany(
  client: SupabaseClient,
  companyId: string,
  projectId: string
): Promise<{ data: ContactWithConversations[]; error: string | null }> {
  const { data: contacts, error: cErr } = await client
    .from(CONTACTS_TABLE)
    .select("uuid, first_name, last_name, name, position, avatar_url, company_id")
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (cErr) return { data: [], error: cErr.message };

  const contactRows = (contacts ?? []) as Array<Record<string, unknown>>;
  if (contactRows.length === 0) return { data: [], error: null };

  const leadUuids = contactRows.map((c) => c.uuid as string).filter(Boolean);

  // Fetch messages for all these contacts (to compute conversation groups)
  const { data: msgs } = await client
    .from(LINKEDIN_MESSAGES_TABLE)
    .select("lead_uuid, linkedin_conversation_uuid, sent_at")
    .in("lead_uuid", leadUuids)
    .eq("project_id", projectId)
    .order("sent_at", { ascending: false })
    .limit(2000);

  // Group by lead_uuid then by conversation_uuid
  const convsByLead = new Map<string, Map<string, { count: number; lastAt: string | null }>>();
  for (const m of (msgs ?? []) as Array<Record<string, unknown>>) {
    const lu = m["lead_uuid"] as string | null;
    const cu = m["linkedin_conversation_uuid"] as string | null;
    if (!lu || !cu) continue;
    if (!convsByLead.has(lu)) convsByLead.set(lu, new Map());
    const convMap = convsByLead.get(lu)!;
    if (!convMap.has(cu)) convMap.set(cu, { count: 0, lastAt: null });
    const entry = convMap.get(cu)!;
    entry.count++;
    const at = m["sent_at"] as string | null;
    if (at && (!entry.lastAt || at > entry.lastAt)) entry.lastAt = at;
  }

  const result: ContactWithConversations[] = contactRows.map((c) => {
    const uuid = c.uuid as string;
    const convMap = convsByLead.get(uuid) ?? new Map();
    const conversations = [...convMap.entries()]
      .map(([convId, info]) => ({ conversationUuid: convId, messageCount: info.count, lastMessageAt: info.lastAt }))
      .sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""));
    return {
      uuid,
      first_name: (c.first_name as string | null) ?? null,
      last_name: (c.last_name as string | null) ?? null,
      name: (c.name as string | null) ?? null,
      position: (c.position as string | null) ?? null,
      avatar_url: (c.avatar_url as string | null) ?? null,
      company_id: (c.company_id as string | null) ?? null,
      conversations,
    };
  });

  return { data: result, error: null };
}

// ── Context Snapshots ────────────────────────────────────────────────────────

export interface ContextSnapshotRow {
  id: string;
  project_id: string;
  name: string | null;
  nodes: Record<string, unknown>;
  context_text: string;
  created_at: string;
}

export interface SaveContextSnapshotParams {
  projectId: string;
  name?: string | null;
  nodes: Record<string, unknown>;
  contextText: string;
}

export async function getContextSnapshots(
  client: SupabaseClient,
  params: { projectId: string; limit?: number; offset?: number }
): Promise<{ data: ContextSnapshotRow[]; total: number; error: string | null }> {
  const limit = Math.min(params.limit ?? 50, 200);
  const offset = params.offset ?? 0;
  const { data, error, count } = await client
    .from(CONTEXT_SNAPSHOTS_TABLE)
    .select("*", { count: "exact" })
    .eq("project_id", params.projectId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return { data: [], total: 0, error: error.message };
  return { data: (data ?? []) as ContextSnapshotRow[], total: count ?? 0, error: null };
}

export async function getContextSnapshotById(
  client: SupabaseClient,
  snapshotId: string
): Promise<{ data: ContextSnapshotRow | null; error: string | null }> {
  const { data, error } = await client
    .from(CONTEXT_SNAPSHOTS_TABLE)
    .select("*")
    .eq("id", snapshotId)
    .maybeSingle();

  if (error) return { data: null, error: error.message };
  return { data: (data as ContextSnapshotRow) ?? null, error: null };
}

export async function saveContextSnapshot(
  client: SupabaseClient,
  params: SaveContextSnapshotParams
): Promise<{ data: ContextSnapshotRow | null; error: string | null }> {
  const { data, error } = await client
    .from(CONTEXT_SNAPSHOTS_TABLE)
    .insert({
      project_id: params.projectId,
      name: params.name ?? null,
      nodes: params.nodes,
      context_text: params.contextText,
    })
    .select()
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as ContextSnapshotRow, error: null };
}
