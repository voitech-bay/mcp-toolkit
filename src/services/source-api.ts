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

export async function fetchAllContacts(): Promise<FetchContactsResult> {
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
      all.push(...page);
      if (page.length === 0 || (res.total != null && offset + page.length >= res.total)) break;
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
      all.push(...page);
      if (page.length === 0 || !res.has_more) break;
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
      all.push(...page);
      if (page.length === 0 || !res.has_more) break;
      offset += PAGE_SIZE;
      await sleep(DELAY_MS);
    }
    return { data: all, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { data: [], error: message };
  }
}
