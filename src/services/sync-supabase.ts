/**
 * Syncs Supabase tables from the source API: fetch all from source, upsert (dedupe by uuid).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabase,
  CONTACTS_TABLE,
  LINKEDIN_MESSAGES_TABLE,
  SENDERS_TABLE,
} from "./supabase.js";
import {
  fetchAllContacts,
  fetchAllLinkedInMessages,
  fetchAllSenders,
} from "./source-api.js";

const CHUNK_SIZE = 100;

function mapMessageForSupabase(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  // Supabase table uses sender_id; API returns sender_profile_uuid
  if (row.sender_profile_uuid != null && out.sender_id === undefined) {
    out.sender_id = row.sender_profile_uuid;
  }
  return out;
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

  // --- Contacts ---
  const contactsRes = await fetchAllContacts();
  result.contacts.fetched = contactsRes.data.length;
  if (contactsRes.error) {
    result.contacts.error = contactsRes.error;
  } else {
    for (let i = 0; i < contactsRes.data.length; i += CHUNK_SIZE) {
      const chunk = contactsRes.data.slice(i, i + CHUNK_SIZE);
      const { inserted, error } = await upsertChunk(client, CONTACTS_TABLE, chunk, "uuid");
      if (error) {
        result.contacts.error = error;
        break;
      }
      result.contacts.upserted += inserted;
    }
  }

  // --- LinkedIn Messages ---
  const messagesRes = await fetchAllLinkedInMessages();
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
        result.linkedin_messages.error = error;
        break;
      }
      result.linkedin_messages.upserted += inserted;
    }
  }

  // --- Senders ---
  const sendersRes = await fetchAllSenders();
  result.senders.fetched = sendersRes.data.length;
  if (sendersRes.error) {
    result.senders.error = sendersRes.error;
  } else {
    for (let i = 0; i < sendersRes.data.length; i += CHUNK_SIZE) {
      const chunk = sendersRes.data.slice(i, i + CHUNK_SIZE);
      const { inserted, error } = await upsertChunk(client, SENDERS_TABLE, chunk, "uuid");
      if (error) {
        result.senders.error = error;
        break;
      }
      result.senders.upserted += inserted;
    }
  }

  return result;
}
