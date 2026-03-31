/**
 * Source of truth for synced Supabase table columns (from MCP list_tables verbose).
 * Used by sync mappers to whitelist columns and avoid overwriting backfilled fields.
 */

/** Columns that exist on public.Contacts. Sync includes only these; backfilled columns are omitted unless present in API payload. */
export const CONTACTS_COLUMNS = [
  "uuid",
  "team_id",
  "list_uuid",
  "data_source_uuid",
  "ai_agent_uuid",
  "ai_agent_mode",
  "ai_engagement_status_uuid",
  "pipeline_stage_uuid",
  "user_id",
  "company_uuid",
  "name",
  "first_name",
  "last_name",
  "company_name",
  "company_ln_id",
  "position",
  "headline",
  "about",
  "avatar_url",
  "ln_member_id",
  "ln_id",
  "sn_id",
  "linkedin",
  "facebook",
  "twitter",
  "work_email",
  "work_email_domain",
  "personal_email",
  "work_phone_number",
  "personal_phone_number",
  "connections_number",
  "followers_number",
  "primary_language",
  "supported_languages",
  "has_open_profile",
  "has_verified_profile",
  "has_premium",
  "experience",
  "posts",
  "educations",
  "skills",
  "top_voices",
  "raw_address",
  "location",
  "tags",
  "status",
  "linkedin_status",
  "email_status",
  "unread_counts",
  "last_automation_approve_at",
  "last_stop_on_reply_at",
  "last_enrich_at",
  "created_at",
  "updated_at",
  "title",
  "linkedin_url",
  "email",
  "project_id",
] as const;

/** Columns on Contacts that are backfilled/app-maintained; sync omits them unless the API explicitly sends them. */
export const CONTACTS_BACKFILLED_COLUMNS = new Set([
  "title",
  "linkedin_url",
  "email",
  "supported_languages",
  "tags",
  "unread_counts",
]);

/** Columns that exist on public.LinkedinMessages. Sync includes only these. */
export const LINKEDIN_MESSAGES_COLUMNS = [
  "uuid",
  "team_id",
  "sender_profile_uuid",
  "linkedin_account_uuid",
  "linkedin_conversation_uuid",
  "lead_uuid",
  "task_pipeline_uuid",
  "template_uuid",
  "message_hash",
  "text",
  "custom_content",
  "attachments",
  "type",
  "automation",
  "status",
  "fail_reason",
  "subject",
  "linkedin_type",
  "user_id",
  "read_at",
  "sent_at",
  "created_at",
  "updated_at",
  "generated_message_id",
  "reply_received",
  "project_id",
] as const;

/** Columns on LinkedinMessages that are app-set; sync omits them unless the API sends them. */
export const LINKEDIN_MESSAGES_SYNC_OMIT_UNLESS_IN_API = new Set([
  "generated_message_id",
  "reply_received",
]);

/** Columns that exist on public.Senders. Sync includes only these. */
export const SENDERS_COLUMNS = [
  "uuid",
  "team_id",
  "linkedin_browser_id",
  "linkedin_account_uuid",
  "assignee_user_id",
  "first_name",
  "last_name",
  "label",
  "schedule",
  "smart_limits_enabled",
  "avatar_url",
  "status",
  "user_id",
  "hold_tasks_till",
  "last_automation_server_id",
  "notification_emails",
  "created_at",
  "updated_at",
  "project_id",
] as const;

/** Columns that exist on public.ContactLists. Sync includes only these. */
export const CONTACT_LISTS_COLUMNS = [
  "uuid",
  "team_id",
  "user_id",
  "name",
  "created_at",
  "updated_at",
  "project_id",
] as const;

/** Columns that exist on public.Flows. Sync includes only these. */
export const FLOWS_COLUMNS = [
  "uuid",
  "team_id",
  "user_id",
  "name",
  "description",
  "flow_workspace_uuid",
  "flow_version_uuid",
  "status",
  "priority",
  "created_at",
  "updated_at",
  "project_id",
] as const;

/** Columns that exist on public.FlowLeads. Sync includes only these. */
export const FLOW_LEADS_COLUMNS = [
  "uuid",
  "team_id",
  "flow_uuid",
  "lead_uuid",
  "company_uuid",
  "contact_source_id",
  "sender_profile_uuid",
  "status",
  "error_msg",
  "created_at",
  "updated_at",
  "project_id",
] as const;

/** Columns that exist on public.companies. Sync uses uuid as id. */
export const COMPANIES_COLUMNS = [
  "id",
  "team_id",
  "name",
  "domain",
  "website",
  "linkedin",
  "ln_id",
  "facebook",
  "twitter",
  "phone",
  "logo_url",
  "industry",
  "employees_range",
  "followers",
  "employees_on_linkedin",
  "year_established",
  "tagline",
  "about",
  "specialities",
  "hashtags",
  "hq_raw_address",
  "hq_location",
  "deal_size",
  "pipeline_stage_uuid",
  "status",
  "linkedin_status",
  "created_at",
  "updated_at",
] as const;

/**
 * Map a raw GetSales company item (already unwrapped from { company: {...} }) to
 * a companies row: use the GetSales uuid as id, whitelist columns.
 */
export function mapCompanyForSupabase(row: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set<string>(COMPANIES_COLUMNS);
  const base: Record<string, unknown> = { ...row };
  // Map GetSales uuid -> id (the primary key now equals GetSales uuid)
  if (base.id == null && base.uuid != null) {
    base.id = base.uuid;
  }
  delete base.uuid;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(base)) {
    if (allowed.has(key)) out[key] = base[key];
  }
  return out;
}

/**
 * Pick only allowed keys from row. Keys not in allowedSet are dropped.
 * Values are passed through as-is.
 */
export function pickColumns(
  row: Record<string, unknown>,
  allowedSet: Set<string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (allowedSet.has(key)) {
      out[key] = row[key];
    }
  }
  return out;
}
