/**
 * Fetches data from the same external API that main/ uses (GetSales-style).
 * All fetch functions accept optional ApiCredentials; env vars are used as fallback.
 */

export interface ApiCredentials {
  baseUrl: string;
  apiKey: string;
}

const CONTACTS_PATH = "/leads/api/leads/search";
const LINKEDIN_MESSAGES_PATH = "/flows/api/linkedin-messages";
const SENDER_PROFILES_PATH = "/flows/api/sender-profiles";

const PAGE_SIZE = 500;
const DELAY_MS = 800;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
const LOG_PREFIX = "[source-api]";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveCredentials(override?: ApiCredentials): { baseUrl: string; apiKey: string } | null {
  const baseUrl = (override?.baseUrl ?? process.env.SOURCE_API_BASE_URL)?.replace(/\/$/, "");
  const apiKey = override?.apiKey ?? process.env.SOURCE_API_KEY;
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

async function fetchJson<T>(
  url: string,
  apiKey: string,
  options: { method?: string; body?: string; headers?: Record<string, string> }
): Promise<T> {
  const { method = "GET", body, headers = {} } = options;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...headers,
        },
        ...(body && { body }),
      });
      if (!res.ok) {
        const text = await res.text();
        const errMsg = `Source API ${method} ${url} responded ${res.status} ${res.statusText}: ${text}`;
        if (res.status >= 500 || res.status === 429) {
          lastError = new Error(errMsg);
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          console.warn(`${LOG_PREFIX} attempt ${attempt}/${MAX_RETRIES} failed (HTTP ${res.status}), retrying in ${delay}ms… URL: ${url}`);
          await sleep(delay);
          continue;
        }
        throw new Error(errMsg);
      }
      return res.json() as Promise<T>;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(`${LOG_PREFIX} attempt ${attempt}/${MAX_RETRIES} failed: ${lastError.message}. Retrying in ${delay}ms… URL: ${url}`);
        await sleep(delay);
      }
    }
  }
  console.error(`${LOG_PREFIX} all ${MAX_RETRIES} attempts failed for ${method} ${url}. Last error: ${lastError?.message}`);
  throw lastError ?? new Error(`fetchJson failed after ${MAX_RETRIES} retries`);
}

/** Contact search item: API can return { lead } or flat lead at root. */
type ContactItem = { lead?: Record<string, unknown> } & Record<string, unknown>;

/** Unwrap to a single row for Supabase (lead fields at root). */
function unwrapContact(item: ContactItem): Record<string, unknown> {
  if (item.lead && typeof item.lead === "object") return { ...item.lead };
  return { ...item };
}

export type FetchLogger = (msg: string, data?: Record<string, unknown>) => Promise<void>;

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

export async function fetchAllContacts(credentials?: ApiCredentials, onLog?: FetchLogger): Promise<FetchContactsResult> {
  return fetchContactsIncremental(null, credentials, onLog);
}

/**
 * Fetch contacts from source API (newest first). Stops when a row has created_at <= sinceCreatedAt.
 * If sinceCreatedAt is null, fetches all. Returns only rows with created_at > sinceCreatedAt.
 */
export async function fetchContactsIncremental(
  sinceCreatedAt: string | null,
  credentials?: ApiCredentials,
  onLog?: FetchLogger
): Promise<FetchContactsResult> {
  const config = resolveCredentials(credentials);
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
      const res = await fetchJson<{ data?: ContactItem[]; total?: number }>(url, config.apiKey, {
        method: "POST",
        body,
      });
      const raw = res.data ?? [];
      const page = raw.map(unwrapContact);
      const preview = page.slice(0, 10).map((r) => r.name ?? r.first_name ?? r.uuid ?? "?");
      const logMsg = `contacts: page at offset=${offset}, got ${page.length} rows (total so far: ${all.length + page.length})`;
      if (onLog) await onLog(logMsg, { offset, pageSize: page.length, totalSoFar: all.length + page.length, head10: preview });
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
    if (onLog) await onLog(`contacts: fetch complete`, { totalRows: all.length });
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

export async function fetchAllLinkedInMessages(credentials?: ApiCredentials, onLog?: FetchLogger): Promise<FetchLinkedInMessagesResult> {
  return fetchLinkedInMessagesIncremental(null, credentials, onLog);
}

/**
 * Fetch LinkedIn messages from source (newest first). Stops when a row has created_at <= sinceCreatedAt.
 * If sinceCreatedAt is null, fetches all. Returns only rows with created_at > sinceCreatedAt.
 */
export async function fetchLinkedInMessagesIncremental(
  sinceCreatedAt: string | null,
  credentials?: ApiCredentials,
  onLog?: FetchLogger
): Promise<FetchLinkedInMessagesResult> {
  const config = resolveCredentials(credentials);
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
      }>(url, config.apiKey, { method: "GET" });
      const page = res.data ?? [];
      const preview = page.slice(0, 10).map((r) => {
        const text = r.text;
        return typeof text === "string" ? text.slice(0, 50) : (r.uuid ?? "?");
      });
      const logMsg = `linkedin_messages: page at offset=${offset}, got ${page.length} rows (total so far: ${all.length + page.length})`;
      if (onLog) await onLog(logMsg, { offset, pageSize: page.length, totalSoFar: all.length + page.length, head10: preview });
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
    if (onLog) await onLog(`linkedin_messages: fetch complete`, { totalRows: all.length });
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

export async function fetchAllSenders(credentials?: ApiCredentials, onLog?: FetchLogger): Promise<FetchSendersResult> {
  return fetchSendersIncremental(null, credentials, onLog);
}

/**
 * Fetch senders from source (newest first). Stops when a row has created_at <= sinceCreatedAt.
 * If sinceCreatedAt is null, fetches all. Returns only rows with created_at > sinceCreatedAt.
 */
export async function fetchSendersIncremental(
  sinceCreatedAt: string | null,
  credentials?: ApiCredentials,
  onLog?: FetchLogger
): Promise<FetchSendersResult> {
  const config = resolveCredentials(credentials);
  if (!config) return { data: [], error: "SOURCE_API_BASE_URL and SOURCE_API_KEY are required" };
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  try {
    while (true) {
      const url = `${config.baseUrl}${SENDER_PROFILES_PATH}?limit=${PAGE_SIZE}&offset=${offset}&order_field=created_at&order_type=desc`;
      const res = await fetchJson<{
        data?: Record<string, unknown>[];
        has_more?: boolean;
      }>(url, config.apiKey, { method: "GET" });
      const page = res.data ?? [];
      const preview = page.slice(0, 10).map((r) => {
        const name = [r.first_name, r.last_name].filter(Boolean).join(" ");
        return name || r.uuid || "?";
      });
      const logMsg = `senders: page at offset=${offset}, got ${page.length} rows (total so far: ${all.length + page.length})`;
      if (onLog) await onLog(logMsg, { offset, pageSize: page.length, totalSoFar: all.length + page.length, head10: preview });
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
    if (onLog) await onLog(`senders: fetch complete`, { totalRows: all.length });
    return { data: all, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { data: [], error: message };
  }
}
