/**
 * Fetches data from the same external API that main/ uses (GetSales-style).
 * All fetch functions accept optional ApiCredentials; env vars are used as fallback.
 *
 * Contacts and companies list sync use **date-partitioned** requests by default so Elasticsearch
 * `from`+`size` stays within ~10k (see `SOURCE_API_MAX_OFFSET_PLUS_LIMIT`). Flow leads use a single
 * unfiltered `POST /flows/api/flows-leads/list` pass (no `filter.created_at` — not supported like
 * `LeadFilter`) plus client-side incremental cursor on `created_at`. Leads use
 * `POST /leads/api/leads/count` (GetSales) to size buckets before paging.
 */

import { SyncCancelledError } from "./sync-cancellation.js";

export interface ApiCredentials {
  baseUrl: string;
  apiKey: string;
}

const CONTACTS_PATH = "/leads/api/leads/search";
const LEADS_COUNT_PATH = "/leads/api/leads/count";
const LINKEDIN_MESSAGES_PATH = "/flows/api/linkedin-messages";
const SENDER_PROFILES_PATH = "/flows/api/sender-profiles";
const FLOWS_PATH = "/flows/api/flows";
const FLOW_LEADS_LIST_PATH = "/flows/api/flows-leads/list";
const LEADS_METRICS_PATH = "/leads/api/leads/metrics";
const COMPANIES_LIST_PATH = "/leads/api/companies/list";
/** GET /leads/api/lists — contact list segments (see GetSales API docs). */
const LISTS_PATH = "/leads/api/lists";
/** GET /leads/api/tags — team tag definitions (see GetSales API docs). */
const TAGS_PATH = "/leads/api/tags";
/** GET /leads/api/pipeline-stages — requires filter[object]=lead|company (see GetSales API docs). */
const PIPELINE_STAGES_PATH = "/leads/api/pipeline-stages";

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

/** GetSales bundled API: list endpoints use `limit` (default 20, max 100). */
const SOURCE_API_PAGE_SIZE_MAX = 100;
/**
 * Elasticsearch `max_result_window` — server maps offset/limit to `from`/`size`;
 * requests with offset + limit > 10000 return HTTP 500 (Result window is too large).
 */
const SOURCE_API_MAX_OFFSET_PLUS_LIMIT = 10_000;

function parseSourceApiPageSize(): number {
  const raw = process.env.SOURCE_API_PAGE_SIZE;
  if (raw == null || raw === "") return SOURCE_API_PAGE_SIZE_MAX;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return SOURCE_API_PAGE_SIZE_MAX;
  return Math.min(SOURCE_API_PAGE_SIZE_MAX, Math.max(1, Math.floor(n)));
}

const PAGE_SIZE = parseSourceApiPageSize();

/** Per-request limit so offset + limit never exceeds Elasticsearch max_result_window. */
function pageLimitForOffset(offset: number): number {
  const cap = SOURCE_API_MAX_OFFSET_PLUS_LIMIT - offset;
  if (cap <= 0) return 0;
  return Math.min(PAGE_SIZE, cap);
}

function sourceApiEsPaginationTruncatedError(entity: string, offset: number, total?: number): string {
  const base = `GetSales/Elasticsearch: cannot paginate past ${SOURCE_API_MAX_OFFSET_PLUS_LIMIT} rows (offset+limit). Stopped at offset=${offset} for ${entity}.`;
  if (total != null) return `${base} API reports total=${total} — sync is incomplete.`;
  return `${base} More data may exist; GetSales would need scroll/search_after for deep pages.`;
}

const DELAY_MS = 800;
/** Stop full-history contact sync after this many consecutive months with zero leads (no count / no rows). */
const CONTACTS_FULL_SYNC_MAX_EMPTY_MONTH_STREAK = 6;
/** Do not scan contacts older than this many years before "today" when no explicit date range is set. */
const CONTACTS_FULL_SYNC_MAX_YEARS_BACK = 25;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
const LOG_PREFIX = "[source-api]";

/** Max response body length stored in sync logs / JSON payloads (full body still printed to server console). */
export const SOURCE_API_ERROR_BODY_STORE_MAX_CHARS = 512_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveCredentials(override?: ApiCredentials): { baseUrl: string; apiKey: string } | null {
  const baseUrl = (override?.baseUrl ?? process.env.SOURCE_API_BASE_URL)?.replace(/\/$/, "");
  const apiKey = override?.apiKey ?? process.env.SOURCE_API_KEY;
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

/** Structured context for GetSales / Laravel failures (support tickets, debugging). */
export type SourceApiErrorDetail = {
  request: { method: string; url: string; body?: string };
  response?: { status: number; statusText: string; body: string; bodyTruncated?: boolean };
};

export class SourceApiRequestError extends Error {
  readonly request: SourceApiErrorDetail["request"];
  readonly response?: SourceApiErrorDetail["response"];

  constructor(
    message: string,
    request: SourceApiErrorDetail["request"],
    response?: SourceApiErrorDetail["response"]
  ) {
    super(message);
    this.name = "SourceApiRequestError";
    this.request = request;
    this.response = response;
  }
}

function requestSnapshot(method: string, url: string, body?: string): SourceApiErrorDetail["request"] {
  return body != null && body !== "" ? { method, url, body } : { method, url };
}

/** Truncate response body for JSON/DB storage; keep full text in server logs when possible. */
export function truncateSourceApiErrorDetailForStorage(
  detail: SourceApiErrorDetail | undefined
): SourceApiErrorDetail | undefined {
  if (!detail?.response?.body) return detail;
  const b = detail.response.body;
  if (b.length <= SOURCE_API_ERROR_BODY_STORE_MAX_CHARS) return detail;
  return {
    ...detail,
    response: {
      ...detail.response,
      body: `${b.slice(0, SOURCE_API_ERROR_BODY_STORE_MAX_CHARS)}\n\n...[truncated for storage; ${b.length - SOURCE_API_ERROR_BODY_STORE_MAX_CHARS} chars omitted; see server logs for full body]`,
      bodyTruncated: true,
    },
  };
}

export function fetchErrorFromUnknown(e: unknown): { error: string; errorDetail?: SourceApiErrorDetail } {
  const error = e instanceof Error ? e.message : String(e);
  if (e instanceof SourceApiRequestError) {
    return {
      error,
      errorDetail: { request: e.request, response: e.response },
    };
  }
  return { error };
}

async function fetchJson<T>(
  url: string,
  apiKey: string,
  options: { method?: string; body?: string; headers?: Record<string, string> }
): Promise<T> {
  const { method = "GET", body, headers = {} } = options;
  const reqSnap = requestSnapshot(method, url, body);
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
      const responseText = await res.text();
      const status = res.status;

      if (!res.ok) {
        const errMsg = `Source API ${method} ${url} → HTTP ${status} ${res.statusText}\n--- Response body ---\n${responseText}`;
        const err = new SourceApiRequestError(errMsg, reqSnap, {
          status,
          statusText: res.statusText,
          body: responseText,
        });
        if (status >= 500 || status === 429) {
          lastError = err;
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          console.warn(
            `${LOG_PREFIX} attempt ${attempt}/${MAX_RETRIES} failed (HTTP ${status}), retrying in ${delay}ms… URL: ${url}`
          );
          console.error(`${LOG_PREFIX} ${errMsg}`);
          if (attempt < MAX_RETRIES) {
            await sleep(delay);
            continue;
          }
          throw err;
        }
        throw err;
      }

      if (status === 204 || responseText.trim() === "") {
        return {} as T;
      }

      try {
        return JSON.parse(responseText) as T;
      } catch (parseErr) {
        const pe = parseErr instanceof Error ? parseErr.message : String(parseErr);
        const errMsg = `Source API ${method} ${url} → HTTP ${status} OK but response is not valid JSON (${pe})\n--- Response body ---\n${responseText}`;
        throw new SourceApiRequestError(errMsg, reqSnap, {
          status,
          statusText: res.statusText,
          body: responseText,
        });
      }
    } catch (e) {
      if (e instanceof SourceApiRequestError) {
        const st = e.response?.status;
        if (st != null && st < 500 && st !== 429) {
          console.error(`${LOG_PREFIX} ${e.message}`);
          throw e;
        }
        if (st === 200) {
          console.error(`${LOG_PREFIX} ${e.message}`);
          throw e;
        }
        lastError = e;
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          console.warn(
            `${LOG_PREFIX} attempt ${attempt}/${MAX_RETRIES} failed (${e.message.slice(0, 200)}…). Retrying in ${delay}ms… URL: ${url}`
          );
          console.error(`${LOG_PREFIX} ${e.message}`);
          await sleep(delay);
          continue;
        }
        console.error(`${LOG_PREFIX} ${e.message}`);
        throw e;
      }
      lastError = e instanceof Error ? e : new Error(String(e));
      const wrapped = new SourceApiRequestError(
        `Network or client error: ${lastError.message}\n(Request: ${method} ${url}${body ? `\n--- Request body ---\n${body}` : ""})`,
        reqSnap,
        undefined
      );
      if (attempt < MAX_RETRIES) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
        console.warn(
          `${LOG_PREFIX} attempt ${attempt}/${MAX_RETRIES} failed: ${lastError.message}. Retrying in ${delay}ms… URL: ${url}`
        );
        await sleep(delay);
        continue;
      }
      console.error(`${LOG_PREFIX} ${wrapped.message}`);
      throw wrapped;
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

/** Calendar date bounds (YYYY-MM-DD) for GetSales `created_at` / `updated_at` filter objects. */
export type DateRangeFilter = { from: string; to: string };

/**
 * Wire format for date range filters per GetSales bundled API (YYYY-MM-DD):
 * - [searchleads.md](https://api.getsales.io/bundled/leads-(contacts)/searchleads.md): `filter.created_at`
 * - [countleads.md](https://api.getsales.io/bundled/leads-(contacts)/countleads.md): `filter.leadFilter.created_at`
 * - [listcompanies.md](https://api.getsales.io/bundled/companies-(accounts)/listcompanies.md): `created_at` / `updated_at` same object shape
 * Example: `{"from":"2025-01-01","to":"2025-03-01"}`. Do **not** use on `POST /flows/api/flows-leads/list`.
 */
function toGetSalesDateFilter(range: DateRangeFilter): { from: string; to: string } {
  return { from: range.from, to: range.to };
}

/** Optional streaming: after each API page (after incremental filter), rows are passed here instead of accumulating in memory. */
export type FetchIncrementalOptions = {
  onPage?: (rows: Record<string, unknown>[]) => Promise<void>;
  /** Called at the start of each page loop (before the HTTP request). Used to cooperatively cancel sync. */
  onBeforePage?: () => Promise<void>;
  /**
   * Optional bounds for this sync (YYYY-MM-DD). Narrows partitioned buckets; if omitted, contacts scan
   * month-by-month from today backward (until cursor / empty streak / max years).
   */
  dateRange?: DateRangeFilter;
  /**
   * When true (default for contacts/companies), split requests by date buckets so offset never exceeds
   * Elasticsearch max_result_window (~10k rows per query). Ignored for flow leads (see `fetchFlowLeadsIncremental`).
   */
  useDatePartition?: boolean;
};

function formatYmdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseYmdUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  return new Date(Date.UTC(y, m - 1, d));
}

function addDaysYmd(ymd: string, days: number): string {
  const d = parseYmdUtc(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return formatYmdUtc(d);
}

/** Inclusive month buckets from `rangeTo` month down to `rangeFrom` month (each bucket clipped to [rangeFrom, rangeTo]). */
function enumerateMonthBucketsDescending(rangeFrom: string, rangeTo: string): DateRangeFilter[] {
  const start = parseYmdUtc(rangeFrom);
  const end = parseYmdUtc(rangeTo);
  const out: DateRangeFilter[] = [];
  let y = end.getUTCFullYear();
  let mo = end.getUTCMonth();
  const limitY = start.getUTCFullYear();
  const limitM = start.getUTCMonth();
  const startT = start.getTime();
  const endT = end.getTime();
  while (y > limitY || (y === limitY && mo >= limitM)) {
    const ms = new Date(Date.UTC(y, mo, 1));
    const me = new Date(Date.UTC(y, mo + 1, 0));
    const bf = Math.max(ms.getTime(), startT);
    const bt = Math.min(me.getTime(), endT);
    if (bf <= bt) {
      out.push({ from: formatYmdUtc(new Date(bf)), to: formatYmdUtc(new Date(bt)) });
    }
    if (mo === 0) {
      y -= 1;
      mo = 11;
    } else {
      mo -= 1;
    }
  }
  return out;
}

function splitDateRangeHalves(range: DateRangeFilter): [DateRangeFilter, DateRangeFilter] {
  const a = parseYmdUtc(range.from).getTime();
  const b = parseYmdUtc(range.to).getTime();
  if (a >= b) return [range, range];
  const mid = Math.floor((a + b) / 2);
  const midDate = new Date(mid);
  const midStr = formatYmdUtc(midDate);
  const left: DateRangeFilter = { from: range.from, to: midStr };
  const nextStart = addDaysYmd(midStr, 1);
  const right: DateRangeFilter = { from: nextStart <= range.to ? nextStart : range.to, to: range.to };
  if (left.from > left.to) return [right, right];
  if (right.from > right.to) return [left, left];
  return [left, right];
}

/**
 * POST /leads/api/leads/count — see [countleads.md](https://api.getsales.io/bundled/leads-(contacts)/countleads.md):
 * `filter.all`, `filter.leadFilter.created_at` date range `{ from, to }`.
 */
async function countLeadsForDateRange(
  config: { baseUrl: string; apiKey: string },
  createdAtRange: DateRangeFilter
): Promise<number> {
  const url = `${config.baseUrl}${LEADS_COUNT_PATH}`;
  const body = JSON.stringify({
    filter: {
      all: true,
      leadFilter: {
        created_at: toGetSalesDateFilter(createdAtRange),
      },
    },
  });
  const res = await fetchJson<{ count?: number }>(url, config.apiKey, { method: "POST", body });
  await sleep(DELAY_MS);
  return res.count ?? 0;
}

function cursorDateOnly(iso: string | null): string | null {
  if (iso == null || iso === "") return null;
  return iso.slice(0, 10);
}

/** Skip bucket entirely if every row in bucket would be at or before incremental cursor (created_at). */
function shouldSkipCreatedAtBucket(bucket: DateRangeFilter, sinceCreatedAt: string | null): boolean {
  if (sinceCreatedAt == null) return false;
  const c = cursorDateOnly(sinceCreatedAt);
  if (c == null) return false;
  return bucket.to < c;
}

function shouldSkipUpdatedAtBucket(bucket: DateRangeFilter, sinceUpdatedAt: string | null): boolean {
  if (sinceUpdatedAt == null) return false;
  const c = cursorDateOnly(sinceUpdatedAt);
  if (c == null) return false;
  return bucket.to < c;
}

export interface FetchContactsResult {
  data: Record<string, unknown>[];
  error: string | null;
  /** Rows matching the incremental filter (equals data.length when onPage is not used). */
  fetchedCount: number;
  /** When `error` is set: request/response for GetSales / Laravel debugging. */
  errorDetail?: SourceApiErrorDetail;
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
 * One search filter pass: POST /leads/api/leads/search with optional `filter.created_at` range.
 * Newest first; stops when a row has created_at <= sinceCreatedAt.
 */
async function fetchContactsSearchPass(
  sinceCreatedAt: string | null,
  config: { baseUrl: string; apiKey: string },
  onLog: FetchLogger | undefined,
  options: FetchIncrementalOptions | undefined,
  createdAtRange: DateRangeFilter | null
): Promise<FetchContactsResult> {
  const onPage = options?.onPage;
  const onBeforePage = options?.onBeforePage;
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  let fetchedCount = 0;
  let lastTotal: number | undefined;
  const filter: Record<string, unknown> =
    createdAtRange != null
      ? { created_at: toGetSalesDateFilter(createdAtRange) }
      : {};
  try {
    while (true) {
      const limit = pageLimitForOffset(offset);
      if (limit === 0) {
        if (lastTotal != null && offset < lastTotal) {
          return {
            data: onPage ? [] : all,
            error: sourceApiEsPaginationTruncatedError("contacts", offset, lastTotal),
            fetchedCount,
            errorDetail: undefined,
          };
        }
        break;
      }
      if (onBeforePage) await onBeforePage();
      const url = `${config.baseUrl}${CONTACTS_PATH}`;
      const body = JSON.stringify({
        filter,
        limit,
        offset,
        order_field: "created_at",
        order_type: "desc",
      });
      const res = await fetchJson<{ data?: ContactItem[]; total?: number }>(url, config.apiKey, {
        method: "POST",
        body,
      });
      if (res.total != null) lastTotal = res.total;
      const raw = res.data ?? [];
      const page = raw.map(unwrapContact);
      const preview = page.slice(0, 10).map((r) => r.name ?? r.first_name ?? r.uuid ?? "?");
      const totalSoFar = offset + page.length;
      const logMsg = `contacts: page at offset=${offset}, got ${page.length} rows (total so far: ${totalSoFar})`;
      if (onLog) {
        await onLog(logMsg, {
          offset,
          pageSize: page.length,
          limit,
          totalSoFar,
          head10: preview,
          createdAtFilter: createdAtRange ?? "none",
        });
      }
      let shouldStop = false;
      const pageRows: Record<string, unknown>[] = [];
      for (const row of page) {
        const at = rowCreatedAt(row);
        if (sinceCreatedAt != null && isAtOrOlder(at, sinceCreatedAt)) {
          shouldStop = true;
          break;
        }
        if (sinceCreatedAt == null || (at != null && at > sinceCreatedAt)) {
          pageRows.push(row);
        }
      }
      if (pageRows.length > 0) {
        if (onPage) {
          await onPage(pageRows);
          fetchedCount += pageRows.length;
        } else {
          all.push(...pageRows);
        }
      }
      if (page.length === 0 || (res.total != null && offset + page.length >= res.total) || shouldStop) break;
      offset += limit;
      await sleep(DELAY_MS);
    }
    if (onLog) await onLog(`contacts: fetch complete`, { totalRows: onPage ? fetchedCount : all.length });
    return {
      data: onPage ? [] : all,
      error: null,
      fetchedCount: onPage ? fetchedCount : all.length,
    };
  } catch (e) {
    if (e instanceof SyncCancelledError) throw e;
    const fe = fetchErrorFromUnknown(e);
    return {
      data: [],
      error: fe.error,
      errorDetail: fe.errorDetail,
      fetchedCount: onPage ? fetchedCount : 0,
    };
  }
}

async function fetchContactsBucketRecursive(
  sinceCreatedAt: string | null,
  config: { baseUrl: string; apiKey: string },
  onLog: FetchLogger | undefined,
  options: FetchIncrementalOptions | undefined,
  range: DateRangeFilter,
  depth: number
): Promise<FetchContactsResult> {
  if (depth > 48) {
    return {
      data: [],
      error: `contacts: date bucket split exceeded max depth for ${range.from}..${range.to}`,
      fetchedCount: 0,
    };
  }
  let count = 0;
  try {
    count = await countLeadsForDateRange(config, range);
  } catch (e) {
    if (e instanceof SyncCancelledError) throw e;
    const fe = fetchErrorFromUnknown(e);
    return { data: [], error: fe.error, errorDetail: fe.errorDetail, fetchedCount: 0 };
  }
  if (onLog) {
    await onLog(`contacts: count for ${range.from}..${range.to}`, { count });
  }
  if (count === 0) {
    return { data: [], error: null, fetchedCount: 0 };
  }
  if (count > SOURCE_API_MAX_OFFSET_PLUS_LIMIT) {
    if (range.from === range.to) {
      return {
        data: [],
        error: `contacts: ${count} rows on ${range.from} exceed Elasticsearch page limit (${SOURCE_API_MAX_OFFSET_PLUS_LIMIT})`,
        fetchedCount: 0,
      };
    }
    const [left, right] = splitDateRangeHalves(range);
    if (
      left.from === range.from &&
      left.to === range.to &&
      right.from === range.from &&
      right.to === range.to
    ) {
      return fetchContactsSearchPass(sinceCreatedAt, config, onLog, options, range);
    }
    if (left.from > left.to || right.from > right.to) {
      return fetchContactsSearchPass(sinceCreatedAt, config, onLog, options, range);
    }
    const a = await fetchContactsBucketRecursive(sinceCreatedAt, config, onLog, options, left, depth + 1);
    if (a.error) return a;
    const b = await fetchContactsBucketRecursive(sinceCreatedAt, config, onLog, options, right, depth + 1);
    return {
      data: [],
      error: b.error,
      fetchedCount: a.fetchedCount + b.fetchedCount,
      errorDetail: b.errorDetail,
    };
  }
  return fetchContactsSearchPass(sinceCreatedAt, config, onLog, options, range);
}

/**
 * Fetch contacts from source API (newest first). Stops when a row has created_at <= sinceCreatedAt.
 * If sinceCreatedAt is null, fetches all (subject to empty-month streak / max years when no dateRange).
 * Uses monthly date buckets + POST /leads/api/leads/count to stay under Elasticsearch 10k offset limit.
 */
export async function fetchContactsIncremental(
  sinceCreatedAt: string | null,
  credentials?: ApiCredentials,
  onLog?: FetchLogger,
  options?: FetchIncrementalOptions
): Promise<FetchContactsResult> {
  const config = resolveCredentials(credentials);
  if (!config) {
    return { data: [], error: "SOURCE_API_BASE_URL and SOURCE_API_KEY are required", fetchedCount: 0 };
  }
  const usePartition = options?.useDatePartition !== false;
  if (!usePartition) {
    return fetchContactsSearchPass(sinceCreatedAt, config, onLog, options, null);
  }

  const onPage = options?.onPage;
  const userRange = options?.dateRange;
  const today = formatYmdUtc(new Date());
  const oldestAllowed = formatYmdUtc(
    new Date(Date.UTC(new Date().getUTCFullYear() - CONTACTS_FULL_SYNC_MAX_YEARS_BACK, 0, 1))
  );

  let rangeFrom: string;
  let rangeTo: string;
  if (userRange) {
    rangeFrom = userRange.from;
    rangeTo = userRange.to;
    if (rangeFrom > rangeTo) {
      return { data: [], error: "contacts: dateRange.from must be <= dateRange.to", fetchedCount: 0 };
    }
  } else {
    rangeTo = today;
    rangeFrom = oldestAllowed;
  }

  const months = enumerateMonthBucketsDescending(rangeFrom, rangeTo);
  let totalFetched = 0;
  let streakEmpty = 0;
  let firstError: string | null = null;
  let firstErrorDetail: SourceApiErrorDetail | undefined;

  for (const monthBucket of months) {
    if (shouldSkipCreatedAtBucket(monthBucket, sinceCreatedAt)) {
      // Buckets are newest-first; if this whole month is before the cursor, every older month is too.
      if (onLog) {
        await onLog(`contacts: stop — reached months before incremental cursor`, {
          cursor: cursorDateOnly(sinceCreatedAt),
          firstSkippedBucket: monthBucket,
        });
      }
      break;
    }
    if (onLog) await onLog(`contacts: processing bucket`, { bucket: monthBucket });
    const sub = await fetchContactsBucketRecursive(
      sinceCreatedAt,
      config,
      onLog,
      options,
      monthBucket,
      0
    );
    totalFetched += sub.fetchedCount;
    if (sub.error) {
      firstError = firstError ?? sub.error;
      firstErrorDetail = firstErrorDetail ?? sub.errorDetail;
      break;
    }
    if (sub.fetchedCount === 0) {
      streakEmpty += 1;
      if (
        sinceCreatedAt == null &&
        !userRange &&
        streakEmpty >= CONTACTS_FULL_SYNC_MAX_EMPTY_MONTH_STREAK
      ) {
        if (onLog) await onLog(`contacts: stopping — ${CONTACTS_FULL_SYNC_MAX_EMPTY_MONTH_STREAK} empty months in a row`);
        break;
      }
    } else {
      streakEmpty = 0;
    }
    await sleep(DELAY_MS);
  }

  if (onLog) await onLog(`contacts: partitioned fetch complete`, { totalRows: totalFetched });
  return {
    data: [],
    error: firstError,
    fetchedCount: totalFetched,
    errorDetail: firstErrorDetail,
  };
}

export interface FetchLinkedInMessagesResult {
  data: Record<string, unknown>[];
  error: string | null;
  fetchedCount: number;
  errorDetail?: SourceApiErrorDetail;
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
  onLog?: FetchLogger,
  options?: FetchIncrementalOptions
): Promise<FetchLinkedInMessagesResult> {
  const config = resolveCredentials(credentials);
  if (!config) {
    return { data: [], error: "SOURCE_API_BASE_URL and SOURCE_API_KEY are required", fetchedCount: 0 };
  }
  const onPage = options?.onPage;
  const onBeforePage = options?.onBeforePage;
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  let fetchedCount = 0;
  let lastHasMore: boolean | undefined;
  try {
    while (true) {
      const limit = pageLimitForOffset(offset);
      if (limit === 0) {
        if (lastHasMore === true) {
          return {
            data: onPage ? [] : all,
            error: sourceApiEsPaginationTruncatedError("linkedin_messages", offset),
            fetchedCount,
            errorDetail: undefined,
          };
        }
        break;
      }
      if (onBeforePage) await onBeforePage();
      const url = `${config.baseUrl}${LINKEDIN_MESSAGES_PATH}?limit=${limit}&offset=${offset}&order_field=created_at&order_type=desc`;
      const res = await fetchJson<{
        data?: Record<string, unknown>[];
        has_more?: boolean;
        total?: number;
      }>(url, config.apiKey, { method: "GET" });
      lastHasMore = res.has_more;
      const page = res.data ?? [];
      const preview = page.slice(0, 10).map((r) => {
        const text = r.text;
        return typeof text === "string" ? text.slice(0, 50) : (r.uuid ?? "?");
      });
      const totalSoFar = offset + page.length;
      const logMsg = `linkedin_messages: page at offset=${offset}, got ${page.length} rows (total so far: ${totalSoFar})`;
      if (onLog) await onLog(logMsg, { offset, pageSize: page.length, limit, totalSoFar, head10: preview });
      let shouldStop = false;
      const pageRows: Record<string, unknown>[] = [];
      for (const row of page) {
        const at = rowCreatedAt(row);
        if (sinceCreatedAt != null && isAtOrOlder(at, sinceCreatedAt)) {
          shouldStop = true;
          break;
        }
        if (sinceCreatedAt == null || (at != null && at > sinceCreatedAt)) {
          pageRows.push(row);
        }
      }
      if (pageRows.length > 0) {
        if (onPage) {
          await onPage(pageRows);
          fetchedCount += pageRows.length;
        } else {
          all.push(...pageRows);
        }
      }
      if (page.length === 0 || !res.has_more || shouldStop) break;
      offset += limit;
      await sleep(DELAY_MS);
    }
    if (onLog) await onLog(`linkedin_messages: fetch complete`, { totalRows: onPage ? fetchedCount : all.length });
    return {
      data: onPage ? [] : all,
      error: null,
      fetchedCount: onPage ? fetchedCount : all.length,
    };
  } catch (e) {
    if (e instanceof SyncCancelledError) throw e;
    const fe = fetchErrorFromUnknown(e);
    return {
      data: [],
      error: fe.error,
      errorDetail: fe.errorDetail,
      fetchedCount: onPage ? fetchedCount : 0,
    };
  }
}

export interface FetchSendersResult {
  data: Record<string, unknown>[];
  error: string | null;
  fetchedCount: number;
  errorDetail?: SourceApiErrorDetail;
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
  onLog?: FetchLogger,
  options?: FetchIncrementalOptions
): Promise<FetchSendersResult> {
  const config = resolveCredentials(credentials);
  if (!config) {
    return { data: [], error: "SOURCE_API_BASE_URL and SOURCE_API_KEY are required", fetchedCount: 0 };
  }
  const onPage = options?.onPage;
  const onBeforePage = options?.onBeforePage;
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  let fetchedCount = 0;
  let lastHasMore: boolean | undefined;
  try {
    while (true) {
      const limit = pageLimitForOffset(offset);
      if (limit === 0) {
        if (lastHasMore === true) {
          return {
            data: onPage ? [] : all,
            error: sourceApiEsPaginationTruncatedError("senders", offset),
            fetchedCount,
            errorDetail: undefined,
          };
        }
        break;
      }
      if (onBeforePage) await onBeforePage();
      const url = `${config.baseUrl}${SENDER_PROFILES_PATH}?limit=${limit}&offset=${offset}&order_field=created_at&order_type=desc`;
      const res = await fetchJson<{
        data?: Record<string, unknown>[];
        has_more?: boolean;
      }>(url, config.apiKey, { method: "GET" });
      lastHasMore = res.has_more;
      const page = res.data ?? [];
      const preview = page.slice(0, 10).map((r) => {
        const name = [r.first_name, r.last_name].filter(Boolean).join(" ");
        return name || r.uuid || "?";
      });
      const totalSoFar = offset + page.length;
      const logMsg = `senders: page at offset=${offset}, got ${page.length} rows (total so far: ${totalSoFar})`;
      if (onLog) await onLog(logMsg, { offset, pageSize: page.length, limit, totalSoFar, head10: preview });
      let shouldStop = false;
      const pageRows: Record<string, unknown>[] = [];
      for (const row of page) {
        const at = rowCreatedAt(row);
        if (sinceCreatedAt != null && isAtOrOlder(at, sinceCreatedAt)) {
          shouldStop = true;
          break;
        }
        if (sinceCreatedAt == null || (at != null && at > sinceCreatedAt)) {
          pageRows.push(row);
        }
      }
      if (pageRows.length > 0) {
        if (onPage) {
          await onPage(pageRows);
          fetchedCount += pageRows.length;
        } else {
          all.push(...pageRows);
        }
      }
      if (page.length === 0 || !res.has_more || shouldStop) break;
      offset += limit;
      await sleep(DELAY_MS);
    }
    if (onLog) await onLog(`senders: fetch complete`, { totalRows: onPage ? fetchedCount : all.length });
    return {
      data: onPage ? [] : all,
      error: null,
      fetchedCount: onPage ? fetchedCount : all.length,
    };
  } catch (e) {
    if (e instanceof SyncCancelledError) throw e;
    const fe = fetchErrorFromUnknown(e);
    return {
      data: [],
      error: fe.error,
      errorDetail: fe.errorDetail,
      fetchedCount: onPage ? fetchedCount : 0,
    };
  }
}

export interface FetchFlowsResult {
  data: Record<string, unknown>[];
  error: string | null;
  fetchedCount: number;
  errorDetail?: SourceApiErrorDetail;
}

/**
 * Fetch flows (newest by updated_at first). Stops when a row has updated_at <= sinceUpdatedAt.
 * Returns only rows with updated_at > sinceUpdatedAt (or all when sinceUpdatedAt is null).
 */
export async function fetchFlowsIncremental(
  sinceUpdatedAt: string | null,
  credentials?: ApiCredentials,
  onLog?: FetchLogger,
  options?: FetchIncrementalOptions
): Promise<FetchFlowsResult> {
  const config = resolveCredentials(credentials);
  if (!config) {
    return { data: [], error: "SOURCE_API_BASE_URL and SOURCE_API_KEY are required", fetchedCount: 0 };
  }
  const onPage = options?.onPage;
  const onBeforePage = options?.onBeforePage;
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  let fetchedCount = 0;
  let lastHasMore: boolean | undefined;
  try {
    while (true) {
      const limit = pageLimitForOffset(offset);
      if (limit === 0) {
        if (lastHasMore === true) {
          return {
            data: onPage ? [] : all,
            error: sourceApiEsPaginationTruncatedError("flows", offset),
            fetchedCount,
            errorDetail: undefined,
          };
        }
        break;
      }
      if (onBeforePage) await onBeforePage();
      const url =
        `${config.baseUrl}${FLOWS_PATH}?limit=${limit}&offset=${offset}` +
        `&order_field=updated_at&order_type=desc`;
      const res = await fetchJson<{
        data?: Record<string, unknown>[];
        has_more?: boolean;
      }>(url, config.apiKey, { method: "GET" });
      lastHasMore = res.has_more;
      const page = res.data ?? [];
      const preview = page.slice(0, 10).map((r) => (typeof r.name === "string" ? r.name : (r.uuid ?? "?")));
      const totalSoFar = offset + page.length;
      const logMsg = `flows: page at offset=${offset}, got ${page.length} rows (total so far: ${totalSoFar})`;
      if (onLog) await onLog(logMsg, { offset, pageSize: page.length, limit, totalSoFar, head10: preview });
      let shouldStop = false;
      const pageRows: Record<string, unknown>[] = [];
      for (const row of page) {
        const at = rowUpdatedAt(row);
        if (sinceUpdatedAt != null && isAtOrOlder(at, sinceUpdatedAt)) {
          shouldStop = true;
          break;
        }
        if (sinceUpdatedAt == null || (at != null && at > sinceUpdatedAt)) {
          pageRows.push(row);
        }
      }
      if (pageRows.length > 0) {
        if (onPage) {
          await onPage(pageRows);
          fetchedCount += pageRows.length;
        } else {
          all.push(...pageRows);
        }
      }
      if (page.length === 0 || !res.has_more || shouldStop) break;
      offset += limit;
      await sleep(DELAY_MS);
    }
    if (onLog) await onLog(`flows: fetch complete`, { totalRows: onPage ? fetchedCount : all.length });
    return {
      data: onPage ? [] : all,
      error: null,
      fetchedCount: onPage ? fetchedCount : all.length,
    };
  } catch (e) {
    if (e instanceof SyncCancelledError) throw e;
    const fe = fetchErrorFromUnknown(e);
    return {
      data: [],
      error: fe.error,
      errorDetail: fe.errorDetail,
      fetchedCount: onPage ? fetchedCount : 0,
    };
  }
}

export interface FetchFlowLeadsResult {
  data: Record<string, unknown>[];
  error: string | null;
  fetchedCount: number;
  errorDetail?: SourceApiErrorDetail;
}

/**
 * POST /flows/api/flows-leads/list — only documented filter fields (e.g. flow_uuid); no server-side
 * `created_at` range until FlowLeadFilter supports the same shape as LeadFilter (see listflowleads.md / OpenAPI).
 */
async function fetchFlowLeadsSearchPass(
  sinceCreatedAt: string | null,
  config: { baseUrl: string; apiKey: string },
  onLog: FetchLogger | undefined,
  options: FetchIncrementalOptions | undefined
): Promise<FetchFlowLeadsResult> {
  const onPage = options?.onPage;
  const onBeforePage = options?.onBeforePage;
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  let fetchedCount = 0;
  let lastTotal: number | undefined;
  const filter: Record<string, unknown> = {};
  try {
    while (true) {
      const limit = pageLimitForOffset(offset);
      if (limit === 0) {
        if (lastTotal != null && offset < lastTotal) {
          return {
            data: onPage ? [] : all,
            error: sourceApiEsPaginationTruncatedError("flow_leads", offset, lastTotal),
            fetchedCount,
            errorDetail: undefined,
          };
        }
        break;
      }
      if (onBeforePage) await onBeforePage();
      const url = `${config.baseUrl}${FLOW_LEADS_LIST_PATH}`;
      const body = JSON.stringify({
        filter,
        limit,
        offset,
        order_field: "created_at",
        order_type: "desc",
      });
      const res = await fetchJson<{ data?: Record<string, unknown>[]; total?: number; has_more?: boolean }>(
        url,
        config.apiKey,
        { method: "POST", body }
      );
      if (res.total != null) lastTotal = res.total;
      const page = res.data ?? [];
      const preview = page.slice(0, 10).map((r) => r.lead_uuid ?? r.flow_uuid ?? r.uuid ?? "?");
      const totalSoFar = offset + page.length;
      const logMsg = `flow_leads: page at offset=${offset}, got ${page.length} rows (total so far: ${totalSoFar})`;
      if (onLog) {
        await onLog(logMsg, {
          offset,
          pageSize: page.length,
          limit,
          totalSoFar,
          head10: preview,
        });
      }
      let shouldStop = false;
      const pageRows: Record<string, unknown>[] = [];
      for (const row of page) {
        const at = rowCreatedAt(row);
        if (sinceCreatedAt != null && isAtOrOlder(at, sinceCreatedAt)) {
          shouldStop = true;
          break;
        }
        if (sinceCreatedAt == null || (at != null && at > sinceCreatedAt)) {
          pageRows.push(row);
        }
      }
      if (pageRows.length > 0) {
        if (onPage) {
          await onPage(pageRows);
          fetchedCount += pageRows.length;
        } else {
          all.push(...pageRows);
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
      offset += limit;
      await sleep(DELAY_MS);
    }
    if (onLog) await onLog(`flow_leads: fetch complete`, { totalRows: onPage ? fetchedCount : all.length });
    return {
      data: onPage ? [] : all,
      error: null,
      fetchedCount: onPage ? fetchedCount : all.length,
    };
  } catch (e) {
    if (e instanceof SyncCancelledError) throw e;
    const fe = fetchErrorFromUnknown(e);
    return {
      data: [],
      error: fe.error,
      errorDetail: fe.errorDetail,
      fetchedCount: onPage ? fetchedCount : 0,
    };
  }
}

/**
 * Fetch flow-lead enrollments (newest first by `order_field: created_at`). Stops when row `created_at` <=
 * `sinceCreatedAt`. Does not send `filter.created_at` — FlowLeadFilter is not LeadFilter; date-range
 * partition is unavailable until the API documents a supported shape. `dateRange` / `useDatePartition` in
 * `options` are ignored.
 */
export async function fetchFlowLeadsIncremental(
  sinceCreatedAt: string | null,
  credentials?: ApiCredentials,
  onLog?: FetchLogger,
  options?: FetchIncrementalOptions
): Promise<FetchFlowLeadsResult> {
  const config = resolveCredentials(credentials);
  if (!config) {
    return { data: [], error: "SOURCE_API_BASE_URL and SOURCE_API_KEY are required", fetchedCount: 0 };
  }
  return fetchFlowLeadsSearchPass(sinceCreatedAt, config, onLog, options);
}

export interface FetchCompaniesResult {
  data: Record<string, unknown>[];
  error: string | null;
  fetchedCount: number;
  errorDetail?: SourceApiErrorDetail;
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
 * POST /leads/api/companies/list — optional `filter.updated_at` range (same shape as `created_at` in API docs).
 */
async function fetchCompaniesSearchPass(
  sinceUpdatedAt: string | null,
  config: { baseUrl: string; apiKey: string },
  onLog: FetchLogger | undefined,
  options: FetchIncrementalOptions | undefined,
  updatedAtRange: DateRangeFilter | null
): Promise<FetchCompaniesResult> {
  const onPage = options?.onPage;
  const onBeforePage = options?.onBeforePage;
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  let fetchedCount = 0;
  let lastTotal: number | undefined;
  const filter: Record<string, unknown> =
    updatedAtRange != null
      ? { updated_at: toGetSalesDateFilter(updatedAtRange) }
      : {};
  try {
    while (true) {
      const limit = pageLimitForOffset(offset);
      if (limit === 0) {
        if (lastTotal != null && offset < lastTotal) {
          return {
            data: onPage ? [] : all,
            error: sourceApiEsPaginationTruncatedError("companies", offset, lastTotal),
            fetchedCount,
            errorDetail: undefined,
          };
        }
        break;
      }
      if (onBeforePage) await onBeforePage();
      const url = `${config.baseUrl}${COMPANIES_LIST_PATH}`;
      const body = JSON.stringify({
        filter,
        limit,
        offset,
        order_field: "updated_at",
        order_type: "desc",
      });
      const res = await fetchJson<{ data?: CompanyItem[]; total?: number; has_more?: boolean }>(
        url,
        config.apiKey,
        { method: "POST", body }
      );
      if (res.total != null) lastTotal = res.total;
      const raw = res.data ?? [];
      const page = raw.map(unwrapCompany);
      const preview = page.slice(0, 10).map((r) => r.name ?? r.uuid ?? "?");
      const totalSoFar = offset + page.length;
      const logMsg = `companies: page at offset=${offset}, got ${page.length} rows (total so far: ${totalSoFar})`;
      if (onLog) {
        await onLog(logMsg, {
          offset,
          pageSize: page.length,
          limit,
          totalSoFar,
          head10: preview,
          updatedAtFilter: updatedAtRange ?? "none",
        });
      }
      let shouldStop = false;
      const pageRows: Record<string, unknown>[] = [];
      for (const row of page) {
        const at = rowUpdatedAt(row);
        if (sinceUpdatedAt != null && isAtOrOlder(at, sinceUpdatedAt)) {
          shouldStop = true;
          break;
        }
        if (sinceUpdatedAt == null || (at != null && at > sinceUpdatedAt)) {
          pageRows.push(row);
        }
      }
      if (pageRows.length > 0) {
        if (onPage) {
          await onPage(pageRows);
          fetchedCount += pageRows.length;
        } else {
          all.push(...pageRows);
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
      offset += limit;
      await sleep(DELAY_MS);
    }
    if (onLog) await onLog(`companies: fetch complete`, { totalRows: onPage ? fetchedCount : all.length });
    return {
      data: onPage ? [] : all,
      error: null,
      fetchedCount: onPage ? fetchedCount : all.length,
    };
  } catch (e) {
    if (e instanceof SyncCancelledError) throw e;
    const fe = fetchErrorFromUnknown(e);
    return {
      data: [],
      error: fe.error,
      errorDetail: fe.errorDetail,
      fetchedCount: onPage ? fetchedCount : 0,
    };
  }
}

async function fetchCompaniesBucketRecursive(
  sinceUpdatedAt: string | null,
  config: { baseUrl: string; apiKey: string },
  onLog: FetchLogger | undefined,
  options: FetchIncrementalOptions | undefined,
  range: DateRangeFilter,
  depth: number
): Promise<FetchCompaniesResult> {
  if (depth > 48) {
    return {
      data: [],
      error: `companies: date bucket split exceeded max depth for ${range.from}..${range.to}`,
      fetchedCount: 0,
    };
  }
  const pass = await fetchCompaniesSearchPass(sinceUpdatedAt, config, onLog, options, range);
  if (pass.error == null) return pass;
  if (!pass.error.includes(String(SOURCE_API_MAX_OFFSET_PLUS_LIMIT)) && !pass.error.includes("cannot paginate past")) {
    return pass;
  }
  if (range.from === range.to) {
    return pass;
  }
  const [left, right] = splitDateRangeHalves(range);
  if (left.from > left.to || right.from > right.to) {
    return pass;
  }
  const a = await fetchCompaniesBucketRecursive(sinceUpdatedAt, config, onLog, options, left, depth + 1);
  if (a.error) return a;
  const b = await fetchCompaniesBucketRecursive(sinceUpdatedAt, config, onLog, options, right, depth + 1);
  return {
    data: [],
    error: b.error,
    fetchedCount: a.fetchedCount + b.fetchedCount,
    errorDetail: b.errorDetail,
  };
}

/**
 * Fetch companies from source API (newest first by updated_at). Stops when a row has
 * updated_at <= sinceUpdatedAt. If sinceUpdatedAt is null, fetches all (subject to empty-month streak).
 * POST /leads/api/companies/list — partitioned by `filter.updated_at` month buckets.
 */
export async function fetchCompaniesIncremental(
  sinceUpdatedAt: string | null,
  credentials?: ApiCredentials,
  onLog?: FetchLogger,
  options?: FetchIncrementalOptions
): Promise<FetchCompaniesResult> {
  const config = resolveCredentials(credentials);
  if (!config) {
    return { data: [], error: "SOURCE_API_BASE_URL and SOURCE_API_KEY are required", fetchedCount: 0 };
  }
  const usePartition = options?.useDatePartition !== false;
  if (!usePartition) {
    return fetchCompaniesSearchPass(sinceUpdatedAt, config, onLog, options, null);
  }

  const userRange = options?.dateRange;
  const today = formatYmdUtc(new Date());
  const oldestAllowed = formatYmdUtc(
    new Date(Date.UTC(new Date().getUTCFullYear() - CONTACTS_FULL_SYNC_MAX_YEARS_BACK, 0, 1))
  );

  let rangeFrom: string;
  let rangeTo: string;
  if (userRange) {
    rangeFrom = userRange.from;
    rangeTo = userRange.to;
    if (rangeFrom > rangeTo) {
      return { data: [], error: "companies: dateRange.from must be <= dateRange.to", fetchedCount: 0 };
    }
  } else {
    rangeTo = today;
    rangeFrom = oldestAllowed;
  }

  const months = enumerateMonthBucketsDescending(rangeFrom, rangeTo);
  let totalFetched = 0;
  let streakEmpty = 0;
  let firstError: string | null = null;
  let firstErrorDetail: SourceApiErrorDetail | undefined;

  for (const monthBucket of months) {
    if (shouldSkipUpdatedAtBucket(monthBucket, sinceUpdatedAt)) {
      // Buckets are newest-first; if this whole month is before the cursor, every older month is too.
      if (onLog) {
        await onLog(`companies: stop — reached months before incremental cursor`, {
          cursor: cursorDateOnly(sinceUpdatedAt),
          firstSkippedBucket: monthBucket,
        });
      }
      break;
    }
    if (onLog) await onLog(`companies: processing bucket`, { bucket: monthBucket });
    const sub = await fetchCompaniesBucketRecursive(sinceUpdatedAt, config, onLog, options, monthBucket, 0);
    totalFetched += sub.fetchedCount;
    if (sub.error) {
      firstError = firstError ?? sub.error;
      firstErrorDetail = firstErrorDetail ?? sub.errorDetail;
      break;
    }
    if (sub.fetchedCount === 0) {
      streakEmpty += 1;
      if (
        sinceUpdatedAt == null &&
        !userRange &&
        streakEmpty >= CONTACTS_FULL_SYNC_MAX_EMPTY_MONTH_STREAK
      ) {
        if (onLog) await onLog(`companies: stopping — ${CONTACTS_FULL_SYNC_MAX_EMPTY_MONTH_STREAK} empty months in a row`);
        break;
      }
    } else {
      streakEmpty = 0;
    }
    await sleep(DELAY_MS);
  }

  if (onLog) await onLog(`companies: partitioned fetch complete`, { totalRows: totalFetched });
  return {
    data: [],
    error: firstError,
    fetchedCount: totalFetched,
    errorDetail: firstErrorDetail,
  };
}

export interface FetchContactListsResult {
  data: Record<string, unknown>[];
  error: string | null;
  fetchedCount: number;
  errorDetail?: SourceApiErrorDetail;
}

/**
 * Fetch contact lists (newest by updated_at first). Stops when a row has updated_at <= sinceUpdatedAt.
 * GET /leads/api/lists — same auth as other leads endpoints (Bearer + optional Team-ID).
 */
export async function fetchContactListsIncremental(
  sinceUpdatedAt: string | null,
  credentials?: ApiCredentials,
  onLog?: FetchLogger,
  options?: FetchIncrementalOptions
): Promise<FetchContactListsResult> {
  const config = resolveCredentials(credentials);
  if (!config) {
    return { data: [], error: "SOURCE_API_BASE_URL and SOURCE_API_KEY are required", fetchedCount: 0 };
  }
  const onPage = options?.onPage;
  const onBeforePage = options?.onBeforePage;
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  let fetchedCount = 0;
  let lastTotal: number | undefined;
  let lastHasMore: boolean | undefined;
  try {
    while (true) {
      const limit = pageLimitForOffset(offset);
      if (limit === 0) {
        if ((lastTotal != null && offset < lastTotal) || lastHasMore === true) {
          return {
            data: onPage ? [] : all,
            error: sourceApiEsPaginationTruncatedError("contact_lists", offset, lastTotal),
            fetchedCount,
            errorDetail: undefined,
          };
        }
        break;
      }
      if (onBeforePage) await onBeforePage();
      const url =
        `${config.baseUrl}${LISTS_PATH}?limit=${limit}&offset=${offset}` +
        `&order_field=updated_at&order_type=desc`;
      const res = await fetchJson<{
        data?: Record<string, unknown>[];
        has_more?: boolean;
        total?: number;
      }>(url, config.apiKey, { method: "GET" });
      if (res.total != null) lastTotal = res.total;
      lastHasMore = res.has_more;
      const page = res.data ?? [];
      const preview = page.slice(0, 10).map((r) => (typeof r.name === "string" ? r.name : (r.uuid ?? "?")));
      const totalSoFar = offset + page.length;
      const logMsg = `contact_lists: page at offset=${offset}, got ${page.length} rows (total so far: ${totalSoFar})`;
      if (onLog) await onLog(logMsg, { offset, pageSize: page.length, limit, totalSoFar, head10: preview });
      let shouldStop = false;
      const pageRows: Record<string, unknown>[] = [];
      for (const row of page) {
        const at = rowUpdatedAt(row);
        if (sinceUpdatedAt != null && isAtOrOlder(at, sinceUpdatedAt)) {
          shouldStop = true;
          break;
        }
        if (sinceUpdatedAt == null || (at != null && at > sinceUpdatedAt)) {
          pageRows.push(row);
        }
      }
      if (pageRows.length > 0) {
        if (onPage) {
          await onPage(pageRows);
          fetchedCount += pageRows.length;
        } else {
          all.push(...pageRows);
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
      offset += limit;
      await sleep(DELAY_MS);
    }
    if (onLog) await onLog(`contact_lists: fetch complete`, { totalRows: onPage ? fetchedCount : all.length });
    return {
      data: onPage ? [] : all,
      error: null,
      fetchedCount: onPage ? fetchedCount : all.length,
    };
  } catch (e) {
    if (e instanceof SyncCancelledError) throw e;
    const fe = fetchErrorFromUnknown(e);
    return {
      data: [],
      error: fe.error,
      errorDetail: fe.errorDetail,
      fetchedCount: onPage ? fetchedCount : 0,
    };
  }
}

export interface FetchTagsResult {
  data: Record<string, unknown>[];
  error: string | null;
  fetchedCount: number;
  errorDetail?: SourceApiErrorDetail;
}

/**
 * Fetch GetSales tags (newest by updated_at first). Stops when a row has updated_at <= sinceUpdatedAt.
 * GET /leads/api/tags — same auth as contact lists (Bearer + optional Team-ID).
 */
export async function fetchTagsIncremental(
  sinceUpdatedAt: string | null,
  credentials?: ApiCredentials,
  onLog?: FetchLogger,
  options?: FetchIncrementalOptions
): Promise<FetchTagsResult> {
  const config = resolveCredentials(credentials);
  if (!config) {
    return { data: [], error: "SOURCE_API_BASE_URL and SOURCE_API_KEY are required", fetchedCount: 0 };
  }
  const onPage = options?.onPage;
  const onBeforePage = options?.onBeforePage;
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  let fetchedCount = 0;
  let lastTotal: number | undefined;
  let lastHasMore: boolean | undefined;
  try {
    while (true) {
      const limit = pageLimitForOffset(offset);
      if (limit === 0) {
        if ((lastTotal != null && offset < lastTotal) || lastHasMore === true) {
          return {
            data: onPage ? [] : all,
            error: sourceApiEsPaginationTruncatedError("getsales_tags", offset, lastTotal),
            fetchedCount,
            errorDetail: undefined,
          };
        }
        break;
      }
      if (onBeforePage) await onBeforePage();
      const url =
        `${config.baseUrl}${TAGS_PATH}?limit=${limit}&offset=${offset}` +
        `&order_field=updated_at&order_type=desc`;
      const res = await fetchJson<{
        data?: Record<string, unknown>[];
        has_more?: boolean;
        total?: number;
      }>(url, config.apiKey, { method: "GET" });
      if (res.total != null) lastTotal = res.total;
      lastHasMore = res.has_more;
      const page = res.data ?? [];
      const preview = page.slice(0, 10).map((r) => (typeof r.name === "string" ? r.name : (r.uuid ?? "?")));
      const totalSoFar = offset + page.length;
      const logMsg = `getsales_tags: page at offset=${offset}, got ${page.length} rows (total so far: ${totalSoFar})`;
      if (onLog) await onLog(logMsg, { offset, pageSize: page.length, limit, totalSoFar, head10: preview });
      let shouldStop = false;
      const pageRows: Record<string, unknown>[] = [];
      for (const row of page) {
        const at = rowUpdatedAt(row);
        if (sinceUpdatedAt != null && isAtOrOlder(at, sinceUpdatedAt)) {
          shouldStop = true;
          break;
        }
        if (sinceUpdatedAt == null || (at != null && at > sinceUpdatedAt)) {
          pageRows.push(row);
        }
      }
      if (pageRows.length > 0) {
        if (onPage) {
          await onPage(pageRows);
          fetchedCount += pageRows.length;
        } else {
          all.push(...pageRows);
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
      offset += limit;
      await sleep(DELAY_MS);
    }
    if (onLog) await onLog(`getsales_tags: fetch complete`, { totalRows: onPage ? fetchedCount : all.length });
    return {
      data: onPage ? [] : all,
      error: null,
      fetchedCount: onPage ? fetchedCount : all.length,
    };
  } catch (e) {
    if (e instanceof SyncCancelledError) throw e;
    const fe = fetchErrorFromUnknown(e);
    return {
      data: [],
      error: fe.error,
      errorDetail: fe.errorDetail,
      fetchedCount: onPage ? fetchedCount : 0,
    };
  }
}

export interface FetchPipelineStagesResult {
  data: Record<string, unknown>[];
  error: string | null;
  fetchedCount: number;
  errorDetail?: SourceApiErrorDetail;
}

/**
 * Fetch pipeline stages for contacts and companies (newest by updated_at first per filter[object]).
 * GET /leads/api/pipeline-stages — filter[object] is required (lead | company).
 */
export async function fetchPipelineStagesIncremental(
  sinceUpdatedAt: string | null,
  credentials?: ApiCredentials,
  onLog?: FetchLogger,
  options?: FetchIncrementalOptions
): Promise<FetchPipelineStagesResult> {
  const config = resolveCredentials(credentials);
  if (!config) {
    return { data: [], error: "SOURCE_API_BASE_URL and SOURCE_API_KEY are required", fetchedCount: 0 };
  }
  const onPage = options?.onPage;
  const onBeforePage = options?.onBeforePage;
  const all: Record<string, unknown>[] = [];
  let totalFetched = 0;
  let firstError: string | null = null;
  let firstErrorDetail: SourceApiErrorDetail | undefined;

  const objectFilters = ["lead", "company"] as const;

  for (const objectFilter of objectFilters) {
    let offset = 0;
    let fetchedCount = 0;
    let lastTotal: number | undefined;
    let lastHasMore: boolean | undefined;
    try {
      while (true) {
        const limit = pageLimitForOffset(offset);
        if (limit === 0) {
          if ((lastTotal != null && offset < lastTotal) || lastHasMore === true) {
            const err = sourceApiEsPaginationTruncatedError(
              `pipeline_stages(${objectFilter})`,
              offset,
              lastTotal
            );
            firstError = firstError ?? err;
            break;
          }
          break;
        }
        if (onBeforePage) await onBeforePage();
        const q = new URLSearchParams();
        q.set("limit", String(limit));
        q.set("offset", String(offset));
        q.set("order_field", "updated_at");
        q.set("order_type", "desc");
        q.set("filter[object]", objectFilter);
        const url = `${config.baseUrl}${PIPELINE_STAGES_PATH}?${q.toString()}`;
        const res = await fetchJson<{
          data?: Record<string, unknown>[];
          has_more?: boolean;
          total?: number;
        }>(url, config.apiKey, { method: "GET" });
        if (res.total != null) lastTotal = res.total;
        lastHasMore = res.has_more;
        const page = res.data ?? [];
        const preview = page.slice(0, 10).map((r) =>
          typeof r.name === "string" ? r.name : (r.uuid ?? "?")
        );
        const totalSoFar = offset + page.length;
        const logMsg = `pipeline_stages[${objectFilter}]: page at offset=${offset}, got ${page.length} rows (total so far: ${totalSoFar})`;
        if (onLog) await onLog(logMsg, { offset, pageSize: page.length, limit, totalSoFar, head10: preview });
        let shouldStop = false;
        const pageRows: Record<string, unknown>[] = [];
        for (const row of page) {
          const at = rowUpdatedAt(row);
          if (sinceUpdatedAt != null && isAtOrOlder(at, sinceUpdatedAt)) {
            shouldStop = true;
            break;
          }
          if (sinceUpdatedAt == null || (at != null && at > sinceUpdatedAt)) {
            pageRows.push(row);
          }
        }
        for (const row of pageRows) {
          if (row.object == null) row.object = objectFilter;
        }
        if (pageRows.length > 0) {
          if (onPage) {
            await onPage(pageRows);
            fetchedCount += pageRows.length;
          } else {
            all.push(...pageRows);
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
        offset += limit;
        await sleep(DELAY_MS);
      }
      if (onLog) {
        await onLog(`pipeline_stages[${objectFilter}]: fetch complete`, {
          totalRows: onPage ? fetchedCount : all.length,
        });
      }
      totalFetched += onPage ? fetchedCount : 0;
    } catch (e) {
      if (e instanceof SyncCancelledError) throw e;
      const fe = fetchErrorFromUnknown(e);
      firstError = firstError ?? fe.error;
      firstErrorDetail = firstErrorDetail ?? fe.errorDetail;
    }
  }

  return {
    data: onPage ? [] : all,
    error: firstError,
    fetchedCount: onPage ? totalFetched : all.length,
    ...(firstErrorDetail ? { errorDetail: firstErrorDetail } : {}),
  };
}

/** Group dimension for POST /leads/api/leads/metrics */
export type LeadsMetricsGroupBy = "flows" | "sender_profiles";

export interface FetchLeadsMetricsResult {
  rows: Array<{ group_uuid: string | null; metrics: Record<string, unknown> }>;
  error: string | null;
  errorDetail?: SourceApiErrorDetail;
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
    const fe = fetchErrorFromUnknown(e);
    return { rows: [], error: fe.error, errorDetail: fe.errorDetail };
  }
}

export type VerifyGetSalesCredentialsResult = { ok: true } | { ok: false; error: string };

/**
 * Lightweight GET to verify base URL + API key (Bearer). Uses GET /flows/api/flows?limit=1&offset=0.
 */
export async function verifyGetSalesCredentials(
  credentials?: ApiCredentials
): Promise<VerifyGetSalesCredentialsResult> {
  const config = resolveCredentials(credentials);
  if (!config) {
    return {
      ok: false,
      error: "SOURCE_API_BASE_URL and SOURCE_API_KEY are required (or set project credentials)",
    };
  }
  const url =
    `${config.baseUrl}${FLOWS_PATH}?limit=1&offset=0` +
    `&order_field=updated_at&order_type=desc`;
  try {
    await fetchJson<unknown>(url, config.apiKey, { method: "GET" });
    return { ok: true };
  } catch (e) {
    const fe = fetchErrorFromUnknown(e);
    return { ok: false, error: fe.error };
  }
}
