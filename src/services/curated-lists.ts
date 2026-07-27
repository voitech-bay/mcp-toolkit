/**
 * Pinned prospect-list membership (curated_lists / curated_list_members).
 *
 * These lists used to be defined by a GetSales tag on Contacts.tags. That made them
 * fragile: a bulk retag in GetSales silently emptied the view (2026-07-23, MENA went
 * from 134 to 22 when its tag was swapped for a "new enrich" tag). Membership now
 * lives only in Supabase and changes only when someone edits the list in the app.
 *
 * Callers may address a list by slug ("mssp-leaders-mena") or by the legacy GetSales
 * tag UUID it replaced, so existing links and API callers keep working unchanged.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const CURATED_LISTS_TABLE = "curated_lists";
export const CURATED_LIST_MEMBERS_TABLE = "curated_list_members";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CuratedList {
  id: string;
  slug: string;
  name: string;
}

/**
 * Resolve a list by slug or by the legacy GetSales tag UUID it replaced.
 * Returns null when the key matches no pinned list.
 */
export async function resolveCuratedList(
  client: SupabaseClient,
  key: string
): Promise<{ list: CuratedList | null; error: string | null }> {
  const k = key.trim();
  if (!k) return { list: null, error: "list key is required" };

  const column = UUID_RE.test(k) ? "legacy_tag_uuid" : "slug";
  const { data, error } = await client
    .from(CURATED_LISTS_TABLE)
    .select("id, slug, name")
    .eq(column, k)
    .maybeSingle();

  if (error) return { list: null, error: error.message };
  if (!data) return { list: null, error: null };
  return { list: data as CuratedList, error: null };
}

/** Contact UUIDs pinned to a list. Order is not meaningful; callers sort. */
export async function getCuratedMemberUuids(
  client: SupabaseClient,
  listId: string
): Promise<{ uuids: string[]; error: string | null }> {
  const { data, error } = await client
    .from(CURATED_LIST_MEMBERS_TABLE)
    .select("contact_uuid")
    .eq("list_id", listId);

  if (error) return { uuids: [], error: error.message };
  const uuids = ((data ?? []) as Array<{ contact_uuid: string | null }>)
    .map((r) => r.contact_uuid)
    .filter((v): v is string => Boolean(v));
  return { uuids, error: null };
}

/** Every contact pinned to any list — used to refresh GetSales markers after a sync. */
export async function getAllCuratedMemberUuids(
  client: SupabaseClient
): Promise<{ uuids: string[]; error: string | null }> {
  const { data, error } = await client
    .from(CURATED_LIST_MEMBERS_TABLE)
    .select("contact_uuid");

  if (error) return { uuids: [], error: error.message };
  const uuids = [
    ...new Set(
      ((data ?? []) as Array<{ contact_uuid: string | null }>)
        .map((r) => r.contact_uuid)
        .filter((v): v is string => Boolean(v))
    ),
  ];
  return { uuids, error: null };
}

/**
 * Drop contacts from a pinned list. Local only: this never touches GetSales tags,
 * lists, or flow enrolment. Returns how many membership rows were deleted.
 */
export async function removeCuratedMembers(
  client: SupabaseClient,
  listId: string,
  contactUuids: string[]
): Promise<{ removed: number; error: string | null }> {
  if (!contactUuids.length) return { removed: 0, error: null };

  const { data, error } = await client
    .from(CURATED_LIST_MEMBERS_TABLE)
    .delete()
    .eq("list_id", listId)
    .in("contact_uuid", contactUuids)
    .select("contact_uuid");

  if (error) return { removed: 0, error: error.message };
  return { removed: (data ?? []).length, error: null };
}
