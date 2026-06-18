/**
 * GetSales lead markers sync — pulls per-lead email + connection stats from the
 * GetSales /leads/api/leads/{uuid} endpoint and upserts them into Contacts columns.
 *
 * The lead detail response includes a `markers` array; we use the aggregate row
 * (sender_profile_uuid = null) which reflects team-wide totals. Individual
 * sender-scoped rows are ignored.
 *
 * Columns written: email_sent_count, email_inbox_count, email_read_count,
 * email_click_count, gs_connection_accepted_at, markers_synced_at.
 *
 * Called from both the manual list refresh and the normal Contacts sync. Both
 * paths receive the selected project's decrypted GetSales credentials.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiCredentials } from "./source-api.js";

const CONTACTS_TABLE = "Contacts";

interface GsMarker {
  sender_profile_uuid: string | null;
  email_sent_count: number | null;
  email_inbox_count: number | null;
  email_read_count: number | null;
  email_click_count: number | null;
  email_first_message_sent_at: string | null;
  email_last_message_sent_at: string | null;
  linkedin_last_connection_accepted_at: string | null;
}

interface GsLeadDetail {
  markers?: GsMarker[];
}

async function fetchLeadDetail(uuid: string, credentials: ApiCredentials): Promise<GsLeadDetail> {
  const resp = await fetch(`${credentials.baseUrl.replace(/\/$/, "")}/leads/api/leads/${uuid}`, {
    headers: {
      Authorization: `Bearer ${credentials.apiKey}`,
      ...(credentials.teamId ? { "Team-ID": credentials.teamId } : {}),
      "Content-Type": "application/json",
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`GetSales ${resp.status}: ${body.slice(0, 200)}`);
  }
  return resp.json() as Promise<GsLeadDetail>;
}

function pickAggregate(markers: GsMarker[]): GsMarker | null {
  // Prefer the aggregate row (null sender) — it has team-wide totals.
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
 * Rate-limited to ~12 req/s (85 ms between requests).
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

  for (const uuid of contactUuids) {
    try {
      const detail = await fetchLeadDetail(uuid, credentials);
      const m = pickAggregate(detail.markers ?? []);
      if (!m) {
        skipped++;
        continue;
      }

      const patch = {
        email_sent_count: m.email_sent_count ?? 0,
        email_inbox_count: m.email_inbox_count ?? 0,
        email_read_count: m.email_read_count ?? 0,
        email_click_count: m.email_click_count ?? 0,
        gs_connection_accepted_at: m.linkedin_last_connection_accepted_at ?? null,
        markers_synced_at: new Date().toISOString(),
      };

      const { error } = await client.from(CONTACTS_TABLE).update(patch).eq("uuid", uuid);
      if (error) throw new Error(error.message);
      synced++;
    } catch (e) {
      errors.push({ uuid, message: e instanceof Error ? e.message : String(e) });
    }
    // 85 ms gap = ~12 req/s, well within GetSales limits
    await new Promise((r) => setTimeout(r, 85));
  }

  return { synced, skipped, errors, duration_ms: Date.now() - start };
}
