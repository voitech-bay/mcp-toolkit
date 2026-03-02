/**
 * Incremental sync: for each table we take the latest created_at in Supabase, then fetch from
 * the source API (newest first) until we reach that row, and upsert only the new rows.
 * Requires SUPABASE_SERVICE_ROLE_KEY (not anon key) so upserts bypass Row Level Security.
 * LinkedinMessages: API columns are sent as-is (e.g. sender_profile_uuid); do not add sender_id.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabase,
  getLatestCreatedAt,
  CONTACTS_TABLE,
  LINKEDIN_MESSAGES_TABLE,
  SENDERS_TABLE,
} from "./supabase.js";
import {
  fetchContactsIncremental,
  fetchLinkedInMessagesIncremental,
  fetchSendersIncremental,
} from "./source-api.js";

const CHUNK_SIZE = 100;

/** Pass through message rows as-is. LinkedinMessages table uses API column names (e.g. sender_profile_uuid), not sender_id. */
function mapMessageForSupabase(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row };
}

async function upsertChunk(
  client: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  conflictColumn: string
): Promise<{ inserted: number; error: string | null }> {
  if (rows.length === 0) return { inserted: 0, error: null };
  const { error } = await client.from(table).upsert(rows, {
    onConflict: conflictColumn,
    ignoreDuplicates: false,
  });
  if (error) return { inserted: 0, error: error.message };
  return { inserted: rows.length, error: null };
}

export interface SyncResult {
  contacts: { fetched: number; upserted: number; error: string | null };
  linkedin_messages: { fetched: number; upserted: number; error: string | null };
  senders: { fetched: number; upserted: number; error: string | null };
  error: string | null;
}

/** Resolve latest created_at for a table; on error return null (will do full fetch for that table). */
async function latestCreatedAt(
  client: SupabaseClient,
  table: string
): Promise<string | null> {
  const { latest, error } = await getLatestCreatedAt(client, table);
  if (error) return null;
  return latest;
}

export async function syncSupabaseFromSource(): Promise<SyncResult> {
  const client = getSupabase();
  const result: SyncResult = {
    contacts: { fetched: 0, upserted: 0, error: null },
    linkedin_messages: { fetched: 0, upserted: 0, error: null },
    senders: { fetched: 0, upserted: 0, error: null },
    error: null,
  };

  if (!client) {
    result.error = "Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)";
    return result;
  }

  const rlsHint =
    " Use SUPABASE_SERVICE_ROLE_KEY (not anon key) so sync bypasses Row Level Security.";

  // Resolve latest created_at per table (empty table → null → fetch all new)
  const [contactsLatest, messagesLatest, sendersLatest] = await Promise.all([
    latestCreatedAt(client, CONTACTS_TABLE),
    latestCreatedAt(client, LINKEDIN_MESSAGES_TABLE),
    latestCreatedAt(client, SENDERS_TABLE),
  ]);

  // --- Contacts (incremental: only rows with created_at > contactsLatest) ---
  const contactsRes = await fetchContactsIncremental(contactsLatest);
  result.contacts.fetched = contactsRes.data.length;
  if (contactsRes.error) {
    result.contacts.error = contactsRes.error;
  } else {
    for (let i = 0; i < contactsRes.data.length; i += CHUNK_SIZE) {
      const chunk = contactsRes.data.slice(i, i + CHUNK_SIZE);
      const { inserted, error } = await upsertChunk(client, CONTACTS_TABLE, chunk, "uuid");
      if (error) {
        result.contacts.error = error + (error.includes("row-level security") ? rlsHint : "");
        break;
      }
      result.contacts.upserted += inserted;
    }
  }

  // --- LinkedIn Messages (incremental) ---
  const messagesRes = await fetchLinkedInMessagesIncremental(messagesLatest);
  result.linkedin_messages.fetched = messagesRes.data.length;
  if (messagesRes.error) {
    result.linkedin_messages.error = messagesRes.error;
  } else {
    const mapped = messagesRes.data.map(mapMessageForSupabase);
    for (let i = 0; i < mapped.length; i += CHUNK_SIZE) {
      const chunk = mapped.slice(i, i + CHUNK_SIZE);
      const { inserted, error } = await upsertChunk(
        client,
        LINKEDIN_MESSAGES_TABLE,
        chunk,
        "uuid"
      );
      if (error) {
        result.linkedin_messages.error =
          error +
          (error.includes("sender_id")
            ? " (LinkedinMessages table may use sender_profile_uuid; sync sends API columns as-is.)"
            : "");
        break;
      }
      result.linkedin_messages.upserted += inserted;
    }
  }

  // --- Senders (incremental) ---
  const sendersRes = await fetchSendersIncremental(sendersLatest);
  result.senders.fetched = sendersRes.data.length;
  if (sendersRes.error) {
    result.senders.error = sendersRes.error;
  } else {
    for (let i = 0; i < sendersRes.data.length; i += CHUNK_SIZE) {
      const chunk = sendersRes.data.slice(i, i + CHUNK_SIZE);
      const { inserted, error } = await upsertChunk(client, SENDERS_TABLE, chunk, "uuid");
      if (error) {
        result.senders.error = error + (error.includes("row-level security") ? rlsHint : "");
        break;
      }
      result.senders.upserted += inserted;
    }
  }

  return result;
}
