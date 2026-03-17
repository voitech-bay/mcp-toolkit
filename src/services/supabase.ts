import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;

export const LINKEDIN_MESSAGES_TABLE = "LinkedinMessages";
export const SENDERS_TABLE = "Senders";
export const CONTACTS_TABLE = "Contacts";
/** Core companies table; domain is unique. Contacts link via company_id. */
export const COMPANIES_TABLE = "companies";

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

export const COMPANIES_CONTEXT_TABLE = "CompaniesContext";

export interface CompanyContextRow {
  id: string;
  created_at: string;
  name: string | null;
  rootContext: string | null;
}

/**
 * Get company context by name (case-sensitive exact match).
 */
export async function getCompanyContextByName(
  client: SupabaseClient,
  companyName: string
): Promise<{ data: CompanyContextRow | null; error: string | null }> {
  const trimmed = companyName?.trim();
  if (!trimmed) {
    return { data: null, error: "companyName is required." };
  }
  const { data, error } = await client
    .from(COMPANIES_CONTEXT_TABLE)
    .select("*")
    .eq("name", trimmed)
    .limit(1)
    .maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data: data as CompanyContextRow | null, error: null };
}

/**
 * Set root context for a company. If a row with the given name exists, update it;
 * otherwise insert a new row.
 */
export async function setCompanyRootContext(
  client: SupabaseClient,
  companyName: string,
  rootContext: string | null
): Promise<{ data: CompanyContextRow | null; error: string | null }> {
  const trimmed = companyName?.trim();
  if (!trimmed) {
    return { data: null, error: "companyName is required." };
  }
  const existing = await getCompanyContextByName(client, trimmed);
  if (existing.error) return { data: null, error: existing.error };
  if (existing.data) {
    const { data, error } = await client
      .from(COMPANIES_CONTEXT_TABLE)
      .update({ rootContext: rootContext ?? null })
      .eq("id", existing.data.id)
      .select()
      .single();
    if (error) return { data: null, error: error.message };
    return { data: data as CompanyContextRow, error: null };
  }
  const { data, error } = await client
    .from(COMPANIES_CONTEXT_TABLE)
    .insert({ name: trimmed, rootContext: rootContext ?? null })
    .select()
    .single();
  if (error) return { data: null, error: error.message };
  return { data: data as CompanyContextRow, error: null };
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
