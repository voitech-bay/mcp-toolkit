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
const FLOWS_PATH = "/flows/api/flows";
const FLOW_LEADS_LIST_PATH = "/flows/api/flows-leads/list";
const LEADS_METRICS_PATH = "/leads/api/leads/metrics";
const COMPANIES_LIST_PATH = "/leads/api/companies/list";
/** GET /leads/api/lists — contact list segments (see GetSales API docs). */
const LISTS_PATH = "/leads/api/lists";

/**
 * Required on POST /leads/api/leads/metrics — which aggregate counters to return.
 * (API returns 422 "The metrics field is required" if omitted.)
 */
export const LEADS_METRICS_REQUEST_KEYS = [
  "linkedin_connection_request_sent_count",
  "linkedin_connection_request_accepted_count",
  "linkedin_sent_count",
  "linkedin_opened_count",
  "linkedin_inbox_count",
  "linkedin_inmail_sent_count",
  "linkedin_inmail_replied_count",
  "linkedin_positive_count",
  "email_sent_count",
  "email_opened_count",
  "email_clicked_count",
  "email_bounced_count",
  "email_unsubscribed_count",
  "email_inbox_count",
  "email_positive_count",
] as const;

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
          ...(process.env.SOURCE_TEAM_ID ? { "Team-ID": process.env.SOURCE_TEAM_ID } : {}),
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

/** Get updated_at from a row. */
function rowUpdatedAt(row: Record<string, unknown>): string | null {
  const v = row.updated_at ?? row.updatedAt;
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

export interface FetchFlowsResult {
  data: Record<string, unknown>[];
  error: string | null;
}

/**
 * Fetch flows (newest by updated_at first). Stops when a row has updated_at <= sinceUpdatedAt.
 * Returns only rows with updated_at > sinceUpdatedAt (or all when sinceUpdatedAt is null).
 */
export async function fetchFlowsIncremental(
  sinceUpdatedAt: string | null,
  credentials?: ApiCredentials,
  onLog?: FetchLogger
): Promise<FetchFlowsResult> {
  const config = resolveCredentials(credentials);
  if (!config) return { data: [], error: "SOURCE_API_BASE_URL and SOURCE_API_KEY are required" };
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  try {
    while (true) {
      const url =
        `${config.baseUrl}${FLOWS_PATH}?limit=${PAGE_SIZE}&offset=${offset}` +
        `&order_field=updated_at&order_type=desc`;
      const res = await fetchJson<{
        data?: Record<string, unknown>[];
        has_more?: boolean;
      }>(url, config.apiKey, { method: "GET" });
      const page = res.data ?? [];
      const preview = page.slice(0, 10).map((r) => (typeof r.name === "string" ? r.name : (r.uuid ?? "?")));
      const logMsg = `flows: page at offset=${offset}, got ${page.length} rows (total so far: ${all.length + page.length})`;
      if (onLog) await onLog(logMsg, { offset, pageSize: page.length, totalSoFar: all.length + page.length, head10: preview });
      let shouldStop = false;
      for (const row of page) {
        const at = rowUpdatedAt(row);
        if (sinceUpdatedAt != null && isAtOrOlder(at, sinceUpdatedAt)) {
          shouldStop = true;
          break;
        }
        if (sinceUpdatedAt == null || (at != null && at > sinceUpdatedAt)) {
          all.push(row);
        }
      }
      if (page.length === 0 || !res.has_more || shouldStop) break;
      offset += PAGE_SIZE;
      await sleep(DELAY_MS);
    }
    if (onLog) await onLog(`flows: fetch complete`, { totalRows: all.length });
    return { data: all, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { data: [], error: message };
  }
}

export interface FetchFlowLeadsResult {
  data: Record<string, unknown>[];
  error: string | null;
}

/**
 * Fetch flow-lead enrollments (newest first by created_at). Stops when created_at <= sinceCreatedAt.
 */
export async function fetchFlowLeadsIncremental(
  sinceCreatedAt: string | null,
  credentials?: ApiCredentials,
  onLog?: FetchLogger
): Promise<FetchFlowLeadsResult> {
  const config = resolveCredentials(credentials);
  if (!config) return { data: [], error: "SOURCE_API_BASE_URL and SOURCE_API_KEY are required" };
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  try {
    while (true) {
      const url = `${config.baseUrl}${FLOW_LEADS_LIST_PATH}`;
      const body = JSON.stringify({
        filter: {},
        limit: PAGE_SIZE,
        offset,
        order_field: "created_at",
        order_type: "desc",
      });
      const res = await fetchJson<{ data?: Record<string, unknown>[]; total?: number; has_more?: boolean }>(
        url,
        config.apiKey,
        { method: "POST", body }
      );
      const page = res.data ?? [];
      const preview = page.slice(0, 10).map((r) => r.lead_uuid ?? r.flow_uuid ?? r.uuid ?? "?");
      const logMsg = `flow_leads: page at offset=${offset}, got ${page.length} rows (total so far: ${all.length + page.length})`;
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
      if (
        page.length === 0 ||
        shouldStop ||
        res.has_more === false ||
        (res.total != null && offset + page.length >= res.total)
      ) {
        break;
      }
      offset += PAGE_SIZE;
      await sleep(DELAY_MS);
    }
    if (onLog) await onLog(`flow_leads: fetch complete`, { totalRows: all.length });
    return { data: all, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { data: [], error: message };
  }
}

export interface FetchCompaniesResult {
  data: Record<string, unknown>[];
  error: string | null;
}

/** Company item shape from POST /leads/api/companies/list. */
type CompanyItem = { company?: Record<string, unknown> } & Record<string, unknown>;

/** Unwrap to a single row (company fields at root). */
function unwrapCompany(item: CompanyItem): Record<string, unknown> {
  if (item.company && typeof item.company === "object") return { ...item.company };
  return { ...item };
}

export async function fetchAllCompanies(credentials?: ApiCredentials, onLog?: FetchLogger): Promise<FetchCompaniesResult> {
  return fetchCompaniesIncremental(null, credentials, onLog);
}

/**
 * Fetch companies from source API (newest first by updated_at). Stops when a row has
 * updated_at <= sinceUpdatedAt. If sinceUpdatedAt is null, fetches all.
 * Returns only rows with updated_at > sinceUpdatedAt.
 * Using updated_at ensures both new and modified companies are picked up on each sync.
 * POST /leads/api/companies/list
 */
export async function fetchCompaniesIncremental(
  sinceUpdatedAt: string | null,
  credentials?: ApiCredentials,
  onLog?: FetchLogger
): Promise<FetchCompaniesResult> {
  const config = resolveCredentials(credentials);
  if (!config) return { data: [], error: "SOURCE_API_BASE_URL and SOURCE_API_KEY are required" };
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  try {
    while (true) {
      const url = `${config.baseUrl}${COMPANIES_LIST_PATH}`;
      const body = JSON.stringify({
        filter: {},
        limit: PAGE_SIZE,
        offset,
        order_field: "updated_at",
        order_type: "desc",
      });
      const res = await fetchJson<{ data?: CompanyItem[]; total?: number; has_more?: boolean }>(
        url,
        config.apiKey,
        { method: "POST", body }
      );
      const raw = res.data ?? [];
      const page = raw.map(unwrapCompany);
      const preview = page.slice(0, 10).map((r) => r.name ?? r.uuid ?? "?");
      const logMsg = `companies: page at offset=${offset}, got ${page.length} rows (total so far: ${all.length + page.length})`;
      if (onLog) await onLog(logMsg, { offset, pageSize: page.length, totalSoFar: all.length + page.length, head10: preview });
      let shouldStop = false;
      for (const row of page) {
        const at = rowUpdatedAt(row);
        if (sinceUpdatedAt != null && isAtOrOlder(at, sinceUpdatedAt)) {
          shouldStop = true;
          break;
        }
        if (sinceUpdatedAt == null || (at != null && at > sinceUpdatedAt)) {
          all.push(row);
        }
      }
      if (
        page.length === 0 ||
        shouldStop ||
        res.has_more === false ||
        (res.total != null && offset + page.length >= res.total)
      ) {
        break;
      }
      offset += PAGE_SIZE;
      await sleep(DELAY_MS);
    }
    if (onLog) await onLog(`companies: fetch complete`, { totalRows: all.length });
    return { data: all, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { data: [], error: message };
  }
}

export interface FetchContactListsResult {
  data: Record<string, unknown>[];
  error: string | null;
}

/**
 * Fetch contact lists (newest by updated_at first). Stops when a row has updated_at <= sinceUpdatedAt.
 * GET /leads/api/lists — same auth as other leads endpoints (Bearer + optional Team-ID).
 */
export async function fetchContactListsIncremental(
  sinceUpdatedAt: string | null,
  credentials?: ApiCredentials,
  onLog?: FetchLogger
): Promise<FetchContactListsResult> {
  const config = resolveCredentials(credentials);
  if (!config) return { data: [], error: "SOURCE_API_BASE_URL and SOURCE_API_KEY are required" };
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  try {
    while (true) {
      const url =
        `${config.baseUrl}${LISTS_PATH}?limit=${PAGE_SIZE}&offset=${offset}` +
        `&order_field=updated_at&order_type=desc`;
      const res = await fetchJson<{
        data?: Record<string, unknown>[];
        has_more?: boolean;
        total?: number;
      }>(url, config.apiKey, { method: "GET" });
      const page = res.data ?? [];
      const preview = page.slice(0, 10).map((r) => (typeof r.name === "string" ? r.name : (r.uuid ?? "?")));
      const logMsg = `contact_lists: page at offset=${offset}, got ${page.length} rows (total so far: ${all.length + page.length})`;
      if (onLog) await onLog(logMsg, { offset, pageSize: page.length, totalSoFar: all.length + page.length, head10: preview });
      let shouldStop = false;
      for (const row of page) {
        const at = rowUpdatedAt(row);
        if (sinceUpdatedAt != null && isAtOrOlder(at, sinceUpdatedAt)) {
          shouldStop = true;
          break;
        }
        if (sinceUpdatedAt == null || (at != null && at > sinceUpdatedAt)) {
          all.push(row);
        }
      }
      if (
        page.length === 0 ||
        shouldStop ||
        res.has_more === false ||
        (res.total != null && offset + page.length >= res.total)
      ) {
        break;
      }
      offset += PAGE_SIZE;
      await sleep(DELAY_MS);
    }
    if (onLog) await onLog(`contact_lists: fetch complete`, { totalRows: all.length });
    return { data: all, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { data: [], error: message };
  }
}

/** Group dimension for POST /leads/api/leads/metrics */
export type LeadsMetricsGroupBy = "flows" | "sender_profiles";

export interface FetchLeadsMetricsResult {
  rows: Array<{ group_uuid: string | null; metrics: Record<string, unknown> }>;
  error: string | null;
}

function isPlainObjectRowArray(arr: unknown): arr is Record<string, unknown>[] {
  return (
    Array.isArray(arr) &&
    arr.length > 0 &&
    arr.every((x) => x !== null && typeof x === "object" && !Array.isArray(x))
  );
}

/**
 * Unwrap GetSales /leads/metrics JSON — shape varies (data[], nested data, metrics map, etc.).
 */
function extractMetricsRows(res: unknown): Record<string, unknown>[] {
  if (res == null) return [];
  if (Array.isArray(res)) {
    return isPlainObjectRowArray(res) ? res : [];
  }

  if (typeof res !== "object") return [];
  const o = res as Record<string, unknown>;

  const arrayKeys = [
    "data",
    "rows",
    "items",
    "results",
    "leads",
    "flows",
    "groups",
    "statistics",
    "sender_profiles",
    "by_flow",
    "by_flows",
    "by_sender",
    "by_sender_profiles",
    "metrics",
    "result",
    "payload",
    "collection",
    "resources",
  ];
  for (const k of arrayKeys) {
    const v = o[k];
    if (isPlainObjectRowArray(v)) return v;
  }

  // Nested wrappers: { data: { rows: [...] } }, { result: { data: [...] } }, etc.
  for (const nestedKey of ["data", "result", "payload", "resource", "response"]) {
    const v = o[nestedKey];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const inner = extractMetricsRows(v);
      if (inner.length > 0) return inner;
    }
  }

  // metrics: { "uuid": { ...counts }, ... } (object map, not array)
  const metricsVal = o.metrics;
  if (metricsVal && typeof metricsVal === "object" && !Array.isArray(metricsVal)) {
    const map = metricsVal as Record<string, unknown>;
    const fromMap = Object.entries(map).map(([id, row]) => {
      if (row && typeof row === "object" && !Array.isArray(row)) {
        return {
          ...(row as Record<string, unknown>),
          group_uuid: id,
          flow_uuid: id,
          sender_profile_uuid: id,
        };
      }
      return { group_uuid: id, flow_uuid: id, sender_profile_uuid: id };
    });
    if (fromMap.length > 0) return fromMap;
  }

  // { total: { linkedin_..._count: n, ... } } — aggregate-only (API omits per-flow rows)
  const tot = o.total;
  if (tot && typeof tot === "object" && !Array.isArray(tot)) {
    const metrics = tot as Record<string, unknown>;
    if (Object.keys(metrics).length > 0) {
      return [{ group_uuid: null, metrics }];
    }
  }

  return [];
}

function normalizeLeadsMetricsRow(
  row: Record<string, unknown>,
  groupBy: LeadsMetricsGroupBy
): { group_uuid: string | null; metrics: Record<string, unknown> } {
  const uuidKeys =
    groupBy === "flows"
      ? ["group_uuid", "flow_uuid", "flow_id", "uuid", "id"]
      : ["group_uuid", "sender_profile_uuid", "sender_uuid", "uuid", "id"];

  let group_uuid: string | null = null;
  for (const k of uuidKeys) {
    const v = row[k];
    if (typeof v === "string" && v.length > 0) {
      group_uuid = v;
      break;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      group_uuid = String(v);
      break;
    }
  }

  if (row.metrics && typeof row.metrics === "object" && !Array.isArray(row.metrics)) {
    return { group_uuid, metrics: { ...(row.metrics as Record<string, unknown>) } };
  }

  const metrics = { ...row };
  for (const k of uuidKeys) delete metrics[k];
  return { group_uuid, metrics };
}

/**
 * Inclusive UTC calendar bounds for one day (YYYY-MM-DD).
 */
export function dayBoundsUtc(dateYyyyMmDd: string): { fromIso: string; toIso: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYyyyMmDd.trim());
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const from = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0, 0));
  const to = new Date(Date.UTC(y, mo - 1, d, 23, 59, 59, 999));
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

function parseDateOnly(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

/**
 * Enumerate each calendar day from dateFrom through dateTo (inclusive), UTC.
 * If from > to, bounds are swapped.
 */
export function enumerateDatesInclusive(dateFrom: string, dateTo: string): string[] | null {
  const a = parseDateOnly(dateFrom);
  const b = parseDateOnly(dateTo);
  if (!a || !b) return null;
  let start = new Date(Date.UTC(a.y, a.m - 1, a.d));
  let end = new Date(Date.UTC(b.y, b.m - 1, b.d));
  if (start > end) {
    const t = start;
    start = end;
    end = t;
  }
  const out: string[] = [];
  const cur = new Date(start);
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * Pre-aggregated lead metrics for a time range, grouped by flows or sender profiles.
 * POST /leads/api/leads/metrics
 */
export async function fetchLeadsMetricsForRange(
  params: {
    fromIso: string;
    toIso: string;
    groupBy: LeadsMetricsGroupBy;
    /** When set, metrics are scoped to these flow UUIDs (e.g. one id per request). API body key: `flows`. */
    flows?: string[];
    /** Defaults to {@link LEADS_METRICS_REQUEST_KEYS}. */
    metrics?: readonly string[];
  },
  credentials?: ApiCredentials,
  onLog?: FetchLogger
): Promise<FetchLeadsMetricsResult> {
  const config = resolveCredentials(credentials);
  if (!config) return { rows: [], error: "SOURCE_API_BASE_URL and SOURCE_API_KEY are required" };
  const url = `${config.baseUrl}${LEADS_METRICS_PATH}`;
  const metrics = params.metrics?.length ? [...params.metrics] : [...LEADS_METRICS_REQUEST_KEYS];
  const body = JSON.stringify({
    period_from: params.fromIso,
    period_to: params.toIso,
    group_by: params.groupBy,
    metrics,
    ...(params.flows?.length ? { flows: params.flows } : {}),
  });
  try {
    if (onLog) {
      await onLog(`metrics: POST ${LEADS_METRICS_PATH}`, {
        groupBy: params.groupBy,
        from_period: params.fromIso,
        to_period: params.toIso,
        metricsCount: metrics,
        url
      });
    }
    const res = await fetchJson<unknown>(url, config.apiKey, { method: "POST", body });
    const rawRows = extractMetricsRows(res);
    if (rawRows.length === 0 && onLog) {
      const preview =
        res && typeof res === "object"
          ? { topKeys: Object.keys(res as object), jsonHead: JSON.stringify(res).slice(0, 800) }
          : { raw: String(res).slice(0, 300) };
      await onLog(`metrics: no rows parsed from response (check API shape)`, preview);
    }
    const rows = rawRows.map((r) => normalizeLeadsMetricsRow(r, params.groupBy));
    return { rows, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { rows: [], error: message };
  }
}
