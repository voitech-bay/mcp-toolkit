/**
 * GetSales conversation refresh used by the live webhook and the conversation
 * drawer. Inbox/reply webhooks should POST
 * `/api/webhooks/getsales/<projectId>?token=<GETSALES_WEBHOOK_SECRET>` for
 * `contact_replied_linkedin_message` / `contact_replied_inmail`. Events whose
 * lead UUID is missing from `Contacts` (warmup) are skipped with HTTP 200.
 */
import { timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CONTACTS_TABLE, getConversation, getGetSalesCredentials, LINKEDIN_MESSAGES_TABLE } from "./supabase.js";
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

/** Warmup and unknown GetSales events must 200-skip so the provider does not retry. */
export function getSalesWebhookSkipReason(leadUuid: string | null, contactExists: boolean): string | null {
  if (!leadUuid) return "No lead uuid found in event payload";
  if (!contactExists) return "Lead is not a Contacts row in this project";
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
