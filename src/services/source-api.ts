/**
 * Fetches data from the same external API that main/ uses (GetSales-style).
 * Requires SOURCE_API_BASE_URL and SOURCE_API_KEY env vars.
 */

const CONTACTS_PATH = "/leads/api/leads/search";
const LINKEDIN_MESSAGES_PATH = "/flows/api/linkedin-messages";
const SENDER_PROFILES_PATH = "/flows/api/sender-profiles";

const PAGE_SIZE = 100;
const DELAY_MS = 800;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getConfig(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = process.env.SOURCE_API_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.SOURCE_API_KEY;
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

async function fetchJson<T>(
  url: string,
  options: { method?: string; body?: string; headers?: Record<string, string> }
): Promise<T> {
  const { method = "GET", body, headers = {} } = options;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.SOURCE_API_KEY}`,
      ...headers,
    },
    ...(body && { body }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Source API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

/** Contact search item: API can return { lead } or flat lead at root. */
type ContactItem = { lead?: Record<string, unknown> } & Record<string, unknown>;

/** Unwrap to a single row for Supabase (lead fields at root). */
function unwrapContact(item: ContactItem): Record<string, unknown> {
  if (item.lead && typeof item.lead === "object") return { ...item.lead };
  return { ...item };
}

export interface FetchContactsResult {
  data: Record<string, unknown>[];
  error: string | null;
}

/** Get created_at from a row (API may use created_at or different casing). */
function rowCreatedAt(row: Record<string, unknown>): string | null {
  const v = row.created_at ?? row.createdAt;
  if (v == null) return null;
  return typeof v === "string" ? v : (v as Date).toISOString?.() ?? String(v);
}

/** True if we should stop fetching (we've reached or passed the cursor). */
function isAtOrOlder(rowCreatedAtVal: string | null, sinceCreatedAt: string | null): boolean {
  if (sinceCreatedAt == null || rowCreatedAtVal == null) return false;
  return rowCreatedAtVal <= sinceCreatedAt;
}

export async function fetchAllContacts(): Promise<FetchContactsResult> {
  return fetchContactsIncremental(null);
}

/**
 * Fetch contacts from source API (newest first). Stops when a row has created_at <= sinceCreatedAt.
 * If sinceCreatedAt is null, fetches all. Returns only rows with created_at > sinceCreatedAt.
 */
export async function fetchContactsIncremental(
  sinceCreatedAt: string | null
): Promise<FetchContactsResult> {
  const config = getConfig();
  if (!config) return { data: [], error: "SOURCE_API_BASE_URL and SOURCE_API_KEY are required" };
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  try {
    while (true) {
      const url = `${config.baseUrl}${CONTACTS_PATH}`;
      const body = JSON.stringify({
        filter: {},
        limit: PAGE_SIZE,
        offset,
        order_field: "created_at",
        order_type: "desc",
      });
      const res = await fetchJson<{ data?: ContactItem[]; total?: number }>(url, {
        method: "POST",
        body,
      });
      const raw = res.data ?? [];
      const page = raw.map(unwrapContact);
      let shouldStop = false;
      for (const row of page) {
        const at = rowCreatedAt(row);
        if (sinceCreatedAt != null && isAtOrOlder(at, sinceCreatedAt)) {
          shouldStop = true;
          break;
        }
        if (sinceCreatedAt == null || (at != null && at > sinceCreatedAt)) {
          all.push(row);
        }
      }
      if (page.length === 0 || (res.total != null && offset + page.length >= res.total) || shouldStop) break;
      offset += PAGE_SIZE;
      await sleep(DELAY_MS);
    }
    return { data: all, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { data: [], error: message };
  }
}

export interface FetchLinkedInMessagesResult {
  data: Record<string, unknown>[];
  error: string | null;
}

export async function fetchAllLinkedInMessages(): Promise<FetchLinkedInMessagesResult> {
  return fetchLinkedInMessagesIncremental(null);
}

/**
 * Fetch LinkedIn messages from source (newest first). Stops when a row has created_at <= sinceCreatedAt.
 * If sinceCreatedAt is null, fetches all. Returns only rows with created_at > sinceCreatedAt.
 */
export async function fetchLinkedInMessagesIncremental(
  sinceCreatedAt: string | null
): Promise<FetchLinkedInMessagesResult> {
  const config = getConfig();
  if (!config) return { data: [], error: "SOURCE_API_BASE_URL and SOURCE_API_KEY are required" };
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  try {
    while (true) {
      const url = `${config.baseUrl}${LINKEDIN_MESSAGES_PATH}?limit=${PAGE_SIZE}&offset=${offset}&order_field=created_at&order_type=desc`;
      const res = await fetchJson<{
        data?: Record<string, unknown>[];
        has_more?: boolean;
        total?: number;
      }>(url, { method: "GET" });
      const page = res.data ?? [];
      let shouldStop = false;
      for (const row of page) {
        const at = rowCreatedAt(row);
        if (sinceCreatedAt != null && isAtOrOlder(at, sinceCreatedAt)) {
          shouldStop = true;
          break;
        }
        if (sinceCreatedAt == null || (at != null && at > sinceCreatedAt)) {
          all.push(row);
        }
      }
      if (page.length === 0 || !res.has_more || shouldStop) break;
      offset += PAGE_SIZE;
      await sleep(DELAY_MS);
    }
    return { data: all, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { data: [], error: message };
  }
}

export interface FetchSendersResult {
  data: Record<string, unknown>[];
  error: string | null;
}

export async function fetchAllSenders(): Promise<FetchSendersResult> {
  return fetchSendersIncremental(null);
}

/**
 * Fetch senders from source (newest first). Stops when a row has created_at <= sinceCreatedAt.
 * If sinceCreatedAt is null, fetches all. Returns only rows with created_at > sinceCreatedAt.
 */
export async function fetchSendersIncremental(
  sinceCreatedAt: string | null
): Promise<FetchSendersResult> {
  const config = getConfig();
  if (!config) return { data: [], error: "SOURCE_API_BASE_URL and SOURCE_API_KEY are required" };
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  try {
    while (true) {
      const url = `${config.baseUrl}${SENDER_PROFILES_PATH}?limit=${PAGE_SIZE}&offset=${offset}&order_field=created_at&order_type=desc`;
      const res = await fetchJson<{
        data?: Record<string, unknown>[];
        has_more?: boolean;
      }>(url, { method: "GET" });
      const page = res.data ?? [];
      let shouldStop = false;
      for (const row of page) {
        const at = rowCreatedAt(row);
        if (sinceCreatedAt != null && isAtOrOlder(at, sinceCreatedAt)) {
          shouldStop = true;
          break;
        }
        if (sinceCreatedAt == null || (at != null && at > sinceCreatedAt)) {
          all.push(row);
        }
      }
      if (page.length === 0 || !res.has_more || shouldStop) break;
      offset += PAGE_SIZE;
      await sleep(DELAY_MS);
    }
    return { data: all, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { data: [], error: message };
  }
}
