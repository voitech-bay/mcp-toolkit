import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getConversation, getGetSalesCredentials, LINKEDIN_MESSAGES_TABLE } from "./supabase.js";
import { fetchLinkedInMessagesForLead } from "./source-api.js";
import { mapMessageForSupabase } from "./sync-supabase.js";

export function isGetSalesWebhookSecretValid(received: string | undefined, expected = process.env.GETSALES_WEBHOOK_SECRET): boolean {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function extractWebhookLeadUuid(payload: Record<string, unknown>): string | null {
  const candidates = [
    payload.lead_uuid,
    payload.contact_uuid,
    payload.leadUuid,
    payload.contactUuid,
    (payload.lead as Record<string, unknown> | undefined)?.uuid,
    (payload.contact as Record<string, unknown> | undefined)?.uuid,
    (payload.data as Record<string, unknown> | undefined)?.lead_uuid,
    ((payload.data as Record<string, unknown> | undefined)?.lead as Record<string, unknown> | undefined)?.uuid,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export async function refreshGetSalesConversation(
  client: SupabaseClient,
  projectId: string,
  leadUuid: string
): Promise<{ fetched: number; upserted: number; contact: Record<string, unknown> | null; messages: unknown[]; error: string | null }> {
  const credentialsResult = await getGetSalesCredentials(client, projectId);
  if (credentialsResult.error || !credentialsResult.credentials) {
    return { fetched: 0, upserted: 0, contact: null, messages: [], error: credentialsResult.error ?? "GetSales credentials not configured" };
  }
  const fetched = await fetchLinkedInMessagesForLead(leadUuid, credentialsResult.credentials);
  if (fetched.error) {
    return { fetched: 0, upserted: 0, contact: null, messages: [], error: fetched.error };
  }
  const rows = fetched.data.map(mapMessageForSupabase).filter((row) => typeof row.uuid === "string");
  if (rows.length > 0) {
    const { error } = await client.from(LINKEDIN_MESSAGES_TABLE).upsert(rows, { onConflict: "uuid" });
    if (error) return { fetched: fetched.fetchedCount, upserted: 0, contact: null, messages: [], error: error.message };
  }
  const conversation = await getConversation(client, { leadUuid, messageLimit: 1000 });
  return {
    fetched: fetched.fetchedCount,
    upserted: rows.length,
    contact: conversation.contact ?? null,
    messages: conversation.messages,
    error: conversation.error,
  };
}
