import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;

export const LINKEDIN_MESSAGES_TABLE = "LinkedinMessages";
export const SENDERS_TABLE = "Senders";
export const CONTACTS_TABLE = "Contacts";

export function getSupabase(): SupabaseClient | null {
  if (!url || !key) return null;
  return createClient(url, key);
}

// --- LinkedIn Messages (table: LinkedinMessages) ---

export interface GetLinkedinMessagesParams {
  sender?: string;
  senderId?: string;
  contactId?: string;
  leadUuid?: string;
  leadId?: string;
  conversationUuid?: string;
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
  if (params.contactId != null) query = query.eq("contact_id", params.contactId);
  if (params.leadUuid != null) query = query.eq("lead_uuid", params.leadUuid);
  if (params.leadId != null) query = query.eq("lead_id", params.leadId);
  if (params.conversationUuid != null)
    query = query.eq("linkedin_conversation_uuid", params.conversationUuid);
  if (params.messageId != null) query = query.eq("id", params.messageId);
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
