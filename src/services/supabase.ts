import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
const tableName = process.env.SUPABASE_MESSAGES_TABLE ?? "LinkedinMessages";

export function getSupabase(): SupabaseClient | null {
  if (!url || !key) return null;
  return createClient(url, key);
}

export function getMessagesTable(): string {
  return tableName;
}

export interface GetMessagesParams {
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

export async function getMessages(
  client: SupabaseClient,
  table: string,
  params: GetMessagesParams
): Promise<{ data: unknown[]; error: string | null }> {
  let query = client.from(table).select("*");

  if (params.sender != null) {
    query = query.eq("sender", params.sender);
  }
  if (params.senderId != null) {
    query = query.eq("sender_id", params.senderId);
  }
  if (params.contactId != null) {
    query = query.eq("contact_id", params.contactId);
  }
  if (params.leadUuid != null) {
    query = query.eq("lead_uuid", params.leadUuid);
  }
  if (params.leadId != null) {
    query = query.eq("lead_id", params.leadId);
  }
  if (params.conversationUuid != null) {
    query = query.eq("linkedin_conversation_uuid", params.conversationUuid);
  }
  if (params.messageId != null) {
    query = query.eq("id", params.messageId);
  }
  if (params.channel != null) {
    query = query.eq("channel", params.channel);
  }
  if (params.direction != null) {
    query = query.eq("direction", params.direction);
  }
  if (params.status != null) {
    query = query.eq("status", params.status);
  }
  if (params.createdAfter != null) {
    query = query.gte("created_at", params.createdAfter);
  }
  if (params.createdBefore != null) {
    query = query.lte("created_at", params.createdBefore);
  }

  const orderBy = params.orderBy ?? "created_at";
  const order = params.order ?? "desc";
  query = query.order(orderBy, { ascending: order === "asc" });

  const limit = Math.min(Math.max(params.limit ?? 100, 1), 1000);
  const offset = Math.max(params.offset ?? 0, 0);
  query = query.range(offset, offset + limit - 1);

  const { data, error } = await query;

  if (error) {
    return { data: [], error: error.message };
  }
  return { data: data ?? [], error: null };
}
