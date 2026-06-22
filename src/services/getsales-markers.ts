/**
 * GetSales lead markers sync — pulls per-lead email + connection stats from the
 * GetSales /leads/api/leads/{uuid} endpoint and upserts them into Contacts columns.
 *
 * The lead detail response includes a `markers` array; we use the aggregate row
 * (sender_profile_uuid = null) which reflects team-wide totals. Individual
 * sender-scoped rows are ignored.
 *
 * Columns written: email_sent_count, email_inbox_count, email_read_count,
 * email_click_count, gs_connection_sent_at, gs_connection_accepted_at,
 * gs_connection_lost_at, markers_synced_at.
 *
 * Called from both the manual list refresh and the normal Contacts sync. Both
 * paths receive the selected project's decrypted GetSales credentials.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchLeadMarkersByUuid,
  type ApiCredentials,
  type LeadMarkerRow,
} from "./source-api.js";

const CONTACTS_TABLE = "Contacts";
export const MSSP_LEADERS_TAG_UUID = "b108ac8f-5049-466d-bc48-982c5a7e2201";

function pickAggregate(markers: LeadMarkerRow[]): LeadMarkerRow | null {
  return markers.find((m) => m.sender_profile_uuid === null) ?? markers[0] ?? null;
}

export interface MarkerSyncResult {
  synced: number;
  skipped: number;
  errors: Array<{ uuid: string; message: string }>;
  duration_ms: number;
}

/**
 * Sync GetSales lead markers for a batch of contact UUIDs.
 * Uses modest concurrency (~8 in flight) to keep list loads fast.
 */
export async function syncMarkersForContacts(
  client: SupabaseClient,
  contactUuids: string[],
  credentials: ApiCredentials
): Promise<MarkerSyncResult> {
  const start = Date.now();
  let synced = 0;
  let skipped = 0;
  const errors: MarkerSyncResult["errors"] = [];
  const concurrency = 8;

  async function syncOne(uuid: string): Promise<void> {
    try {
      const markers = await fetchLeadMarkersByUuid(credentials, uuid);
      const m = pickAggregate(markers);
      if (!m) {
        skipped++;
        return;
      }

      const patch = {
        email_sent_count: m.email_sent_count ?? 0,
        email_inbox_count: m.email_inbox_count ?? 0,
        email_read_count: m.email_read_count ?? 0,
        email_click_count: m.email_click_count ?? 0,
        gs_connection_sent_at: m.linkedin_last_connection_sent_at ?? null,
        gs_connection_accepted_at: m.linkedin_last_connection_accepted_at ?? null,
        gs_connection_lost_at: m.linkedin_last_connection_lost_at ?? null,
        markers_synced_at: new Date().toISOString(),
      };

      const { error } = await client.from(CONTACTS_TABLE).update(patch).eq("uuid", uuid);
      if (error) throw new Error(error.message);
      synced++;
    } catch (e) {
      errors.push({ uuid, message: e instanceof Error ? e.message : String(e) });
    }
  }

  for (let i = 0; i < contactUuids.length; i += concurrency) {
    await Promise.all(contactUuids.slice(i, i + concurrency).map((uuid) => syncOne(uuid)));
  }

  return { synced, skipped, errors, duration_ms: Date.now() - start };
}
