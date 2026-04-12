/**
 * Incremental sync: for each table we take the latest created_at in Supabase, then fetch from
 * the source API (newest first) until we reach that row, and upsert only the new rows.
 * GetSales pages are streamed (no giant in-memory arrays in source-api); mapped rows are buffered
 * and flushed to Supabase in batches (see SOURCE_SYNC_FETCH_BUFFER_ROWS, default 10000).
 * Order: companies → contacts → linkedin_messages, senders, contact_lists, getsales_tags, pipeline_stages, flows, flow_leads.
 * Optional `entities` limits which steps run; dependencies are expanded (e.g. contacts → companies; flow_leads → flows).
 * Requires SUPABASE_SERVICE_ROLE_KEY (not anon key) so upserts bypass Row Level Security.
 * Row mappers whitelist columns to match current DB schema and avoid overwriting backfilled fields.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabase,
  getLatestCreatedAt,
  getLatestUpdatedAt,
  getProjectById,
  getActiveSyncRun,
  CONTACTS_TABLE,
  LINKEDIN_MESSAGES_TABLE,
  SENDERS_TABLE,
  FLOWS_TABLE,
  FLOW_LEADS_TABLE,
  CONTACT_LISTS_TABLE,
  GET_SALES_TAGS_TABLE,
  PIPELINE_STAGES_TABLE,
  COMPANIES_TABLE,
  createSyncRun,
  reconcileHypothesisGetSalesTags,
  updateSyncRun,
  insertSyncLogEntry,
  type SyncRunStatus,
  getCollectedAnalyticsDays,
  replaceAnalyticsSnapshotsForDay,
  getFlowsForProject,
  addCompaniesToProject,
} from "./supabase.js";
import {
  CONTACTS_COLUMNS,
  CONTACTS_BACKFILLED_COLUMNS,
  LINKEDIN_MESSAGES_COLUMNS,
  LINKEDIN_MESSAGES_SYNC_OMIT_UNLESS_IN_API,
  SENDERS_COLUMNS,
  FLOWS_COLUMNS,
  FLOW_LEADS_COLUMNS,
  CONTACT_LISTS_COLUMNS,
  GET_SALES_TAGS_COLUMNS,
  PIPELINE_STAGES_COLUMNS,
  mapCompanyForSupabase,
  pickColumns,
} from "./supabase-schema.js";
import {
  fetchContactsIncremental,
  fetchLinkedInMessagesIncremental,
  fetchSendersIncremental,
  fetchFlowsIncremental,
  fetchFlowLeadsIncremental,
  fetchContactListsIncremental,
  fetchTagsIncremental,
  fetchPipelineStagesIncremental,
  fetchCompaniesIncremental,
  fetchLeadsMetricsForRange,
  dayBoundsUtc,
  enumerateDatesInclusive,
  truncateSourceApiErrorDetailForStorage,
  SOURCE_API_ERROR_BODY_STORE_MAX_CHARS,
  type ApiCredentials,
  type FetchLogger,
  type SourceApiErrorDetail,
  type DateRangeFilter,
} from "./source-api.js";
import { syncEventBus } from "./sync-event-bus.js";
import {
  SyncCancelledError,
  clearSyncCancellation,
  isSyncCancelled,
  registerLocalSyncRun,
  unregisterLocalSyncRun,
} from "./sync-cancellation.js";

/** Keys for selective main-pipeline sync (order matches fetch sequence). */
export type SyncEntityKey =
  | "companies"
  | "contacts"
  | "linkedin_messages"
  | "senders"
  | "contact_lists"
  | "getsales_tags"
  | "pipeline_stages"
  | "flows"
  | "flow_leads";

export const SYNC_ENTITY_PIPELINE: readonly SyncEntityKey[] = [
  "companies",
  "contacts",
  "linkedin_messages",
  "senders",
  "contact_lists",
  "getsales_tags",
  "pipeline_stages",
  "flows",
  "flow_leads",
] as const;

const SYNC_ENTITY_KEY_SET = new Set<string>(SYNC_ENTITY_PIPELINE);

export function isSyncEntityKey(s: string): s is SyncEntityKey {
  return SYNC_ENTITY_KEY_SET.has(s);
}

/** Add FK prerequisites so partial syncs do not break inserts. */
export function expandSyncEntities(requested: SyncEntityKey[]): SyncEntityKey[] {
  const s = new Set<SyncEntityKey>();
  for (const e of requested) s.add(e);
  if (s.has("contacts") || s.has("linkedin_messages")) s.add("companies");
  if (s.has("linkedin_messages")) {
    s.add("contacts");
    s.add("senders");
  }
  if (s.has("flow_leads")) s.add("flows");
  return SYNC_ENTITY_PIPELINE.filter((k) => s.has(k));
}

export interface SyncSupabaseOptions {
  /** If omitted, all entities are synced. If set, only these (plus expanded dependencies) run. */
  entities?: SyncEntityKey[];
  /**
   * Optional inclusive calendar range (YYYY-MM-DD) for partitioned fetches (contacts, companies).
   * Narrows API `created_at` / `updated_at` filters; omit for default month-by-month backfill from today.
   * Flow leads ignore this — `POST /flows/api/flows-leads/list` does not use the same date filter as LeadFilter.
   */
  syncDateRange?: DateRangeFilter;
}

const CHUNK_SIZE = 100;

/** Sync log + UI: GetSales request/response (response body truncated for DB if huge; server prints full body to console). */
function buildSourceApiFetchErrorLog(
  error: string,
  errorDetail: SourceApiErrorDetail | undefined,
  extra: Record<string, unknown>
): Record<string, unknown> {
  const d = truncateSourceApiErrorDetailForStorage(errorDetail);
  if (!d) return { error, ...extra };
  return {
    error,
    ...extra,
    request: d.request,
    ...(d.response ? { response: d.response } : {}),
  };
}

function truncateResponseBodyForSyncLogStore(data: Record<string, unknown>): Record<string, unknown> {
  const r = data.response;
  if (r && typeof r === "object" && r !== null && "body" in r) {
    const body = (r as { body?: unknown }).body;
    if (typeof body === "string" && body.length > SOURCE_API_ERROR_BODY_STORE_MAX_CHARS) {
      return {
        ...data,
        response: {
          ...(r as Record<string, unknown>),
          body: `${body.slice(0, SOURCE_API_ERROR_BODY_STORE_MAX_CHARS)}\n...[truncated for storage; see server log for full body]`,
          bodyTruncated: true,
        },
      };
    }
  }
  return data;
}
/** Max rows to hold from GetSales before flushing to Supabase (memory stability). Override with SOURCE_SYNC_FETCH_BUFFER_ROWS. */
function getSyncFetchBufferRows(): number {
  const raw = process.env.SOURCE_SYNC_FETCH_BUFFER_ROWS;
  const n = raw != null && raw !== "" ? Number.parseInt(raw, 10) : 10_000;
  if (!Number.isFinite(n) || n < 500) return 10_000;
  return n;
}
const METRICS_REQUEST_DELAY_MS = 800;
const LOG_PREFIX = "[sync]";
const UPSERT_MAX_RETRIES = 3;
const UPSERT_RETRY_DELAY_MS = 1500;

interface FailedRow {
  row: Record<string, unknown>;
  error: string;
}

interface UpsertChunkResult {
  inserted: number;
  failed: FailedRow[];
  error: string | null;
}

type SyncLogger = {
  log(msg: string, data?: Record<string, unknown>): Promise<void>;
  logError(msg: string, data?: Record<string, unknown>): Promise<void>;
  logUpsert(tableName: string, rowCount: number): Promise<void>;
};

function createSyncLogger(
  client: SupabaseClient | null,
  runId: string | null
): SyncLogger {
  const toConsole = (msg: string, data?: Record<string, unknown>) => {
    const line = data ? `${LOG_PREFIX} ${msg} ${JSON.stringify(data)}` : `${LOG_PREFIX} ${msg}`;
    console.log(line);
  };
  const writeEntry = async (
    level: "info" | "error",
    kind: "log" | "upsert",
    message: string,
    extra?: { table_name?: string; row_count?: number; data?: Record<string, unknown> }
  ) => {
    const rawData = extra?.data ?? null;
    const dataForStore =
      level === "error" && rawData && typeof rawData === "object"
        ? truncateResponseBodyForSyncLogStore(rawData as Record<string, unknown>)
        : rawData;
    const entry = {
      kind,
      level,
      message,
      table_name: extra?.table_name ?? null,
      row_count: extra?.row_count ?? null,
      data: dataForStore,
    };
    if (client && runId) {
      const { error } = await insertSyncLogEntry(client, runId, entry);
      if (error) toConsole("sync_log insert failed", { error });
    }
    if (runId) {
      syncEventBus.emitLog(runId, { ...entry, created_at: new Date().toISOString() });
    }
  };
  return {
    async log(msg: string, data?: Record<string, unknown>) {
      toConsole(msg, data);
      await writeEntry("info", "log", msg, { data: data ?? undefined });
    },
    async logError(msg: string, data?: Record<string, unknown>) {
      console.error(`${LOG_PREFIX} ${msg}`);
      if (data && typeof data === "object") {
        const rb =
          data.response &&
          typeof data.response === "object" &&
          data.response !== null &&
          "body" in data.response
            ? (data.response as { body?: unknown }).body
            : undefined;
        if (typeof rb === "string" && rb.length > 0) {
          console.error(`${LOG_PREFIX} --- full HTTP response body (GetSales / API) ---`);
          console.error(rb);
        }
        const req = data.request;
        if (req && typeof req === "object" && req !== null) {
          console.error(`${LOG_PREFIX} --- request --- ${JSON.stringify(req)}`);
        }
        const summary = { ...data };
        if (typeof rb === "string" && rb.length > 12000) {
          if (summary.response && typeof summary.response === "object") {
            summary.response = {
              ...(summary.response as Record<string, unknown>),
              body: `[${rb.length} characters; full body printed above]`,
            };
          }
        }
        console.error(`${LOG_PREFIX} context: ${JSON.stringify(summary)}`);
      }
      await writeEntry("error", "log", msg, { data: data ?? undefined });
    },
    async logUpsert(tableName: string, rowCount: number) {
      const msg = `upserted ${rowCount} rows into ${tableName}`;
      toConsole(msg);
      await writeEntry("info", "upsert", msg, { table_name: tableName, row_count: rowCount });
    },
  };
}

const CONTACTS_ALLOWED = new Set<string>(CONTACTS_COLUMNS);
const LINKEDIN_MESSAGES_ALLOWED = new Set<string>(LINKEDIN_MESSAGES_COLUMNS);
const SENDERS_ALLOWED = new Set<string>(SENDERS_COLUMNS);
const FLOWS_ALLOWED = new Set<string>(FLOWS_COLUMNS);
const FLOW_LEADS_ALLOWED = new Set<string>(FLOW_LEADS_COLUMNS);
const CONTACT_LISTS_ALLOWED = new Set<string>(CONTACT_LISTS_COLUMNS);
const GET_SALES_TAGS_ALLOWED = new Set<string>(GET_SALES_TAGS_COLUMNS);
const PIPELINE_STAGES_ALLOWED = new Set<string>(PIPELINE_STAGES_COLUMNS);

/** Whitelist to Contacts columns; omit backfilled columns unless present in API row. */
function mapContactForSupabase(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    if (!CONTACTS_ALLOWED.has(key)) continue;
    if (CONTACTS_BACKFILLED_COLUMNS.has(key) && row[key] === undefined) continue;
    out[key] = row[key];
  }
  return out;
}

/**
 * Map message row for LinkedinMessages: ensure uuid (use id if API sends id not uuid), whitelist
 * columns, omit generated_message_id/reply_received unless API sends them.
 */
function mapMessageForSupabase(row: Record<string, unknown>): Record<string, unknown> {
  const base = { ...row };
  if (base.uuid == null && base.id != null) {
    base.uuid = base.id;
  }
  delete base.id;
  const picked = pickColumns(base, LINKEDIN_MESSAGES_ALLOWED);
  for (const key of LINKEDIN_MESSAGES_SYNC_OMIT_UNLESS_IN_API) {
    if (row[key] === undefined) delete picked[key];
  }
  return picked;
}

/** Whitelist to Senders columns. */
function mapSenderForSupabase(row: Record<string, unknown>): Record<string, unknown> {
  return pickColumns(row, SENDERS_ALLOWED);
}

function mapFlowForSupabase(row: Record<string, unknown>): Record<string, unknown> {
  const base = { ...row };
  if (base.uuid == null && base.id != null) {
    base.uuid = base.id;
  }
  delete base.id;
  return pickColumns(base, FLOWS_ALLOWED);
}

function mapContactListForSupabase(row: Record<string, unknown>): Record<string, unknown> {
  const base = { ...row };
  if (base.uuid == null && base.id != null) {
    base.uuid = base.id;
  }
  delete base.id;
  return pickColumns(base, CONTACT_LISTS_ALLOWED);
}

function mapGetSalesTagForSupabase(row: Record<string, unknown>): Record<string, unknown> {
  const base = { ...row };
  if (base.uuid == null && base.id != null) {
    base.uuid = base.id;
  }
  delete base.id;
  return pickColumns(base, GET_SALES_TAGS_ALLOWED);
}

function mapPipelineStageForSupabase(row: Record<string, unknown>): Record<string, unknown> {
  const uuid = row.uuid ?? row.id;
  const entityObj =
    typeof row.object === "string"
      ? row.object
      : typeof row.entity_object === "string"
        ? row.entity_object
        : null;
  const orderRaw = row.order;
  const stageOrder =
    typeof orderRaw === "number"
      ? orderRaw
      : orderRaw != null && orderRaw !== ""
        ? Number(orderRaw)
        : null;
  const typeRaw = row.type;
  const base: Record<string, unknown> = {
    uuid: uuid != null ? String(uuid) : null,
    team_id: row.team_id,
    entity_object: entityObj,
    name: row.name,
    stage_type: typeRaw != null ? String(typeRaw) : null,
    category:
      typeof row.category === "string"
        ? row.category
        : row.category != null
          ? String(row.category)
          : null,
    stage_order: Number.isFinite(stageOrder as number) ? stageOrder : null,
    user_id: row.user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  return pickColumns(base, PIPELINE_STAGES_ALLOWED);
}

function mapFlowLeadForSupabase(row: Record<string, unknown>): Record<string, unknown> {
  const base = { ...row };
  if (base.uuid == null && base.id != null) {
    base.uuid = base.id;
  }
  delete base.id;
  return pickColumns(base, FLOW_LEADS_ALLOWED);
}

/** Set project_id on every row. Mutates in place. */
function injectProjectId(rows: Record<string, unknown>[], projectId: string): void {
  for (const row of rows) {
    row.project_id = projectId;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatSupabaseError(error: { message: string; code?: string; details?: string; hint?: string }): string {
  const parts = [error.message];
  if (error.code) parts.push(`code=${error.code}`);
  if (error.details) parts.push(`details=${error.details}`);
  if (error.hint) parts.push(`hint=${error.hint}`);
  return parts.join(" | ");
}

async function upsertChunkBulk(
  client: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  conflictColumn: string
): Promise<{ ok: boolean; error: string | null }> {
  for (let attempt = 1; attempt <= UPSERT_MAX_RETRIES; attempt++) {
    const { error } = await client.from(table).upsert(rows, {
      onConflict: conflictColumn,
      ignoreDuplicates: false,
    });
    if (!error) return { ok: true, error: null };

    const fullError = formatSupabaseError(error);
    if (attempt < UPSERT_MAX_RETRIES) {
      const delay = UPSERT_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(
        `${LOG_PREFIX} upsert into ${table} failed (attempt ${attempt}/${UPSERT_MAX_RETRIES}): ${fullError}. ` +
        `Rows in chunk: ${rows.length}. Retrying in ${delay}ms…`
      );
      await sleep(delay);
    } else {
      return { ok: false, error: fullError };
    }
  }
  return { ok: false, error: `upsert failed after ${UPSERT_MAX_RETRIES} retries` };
}

/**
 * Try bulk upsert first. If it fails, fall back to row-by-row upsert so we
 * save every good row and collect the exact rows that failed with their errors.
 */
async function upsertChunk(
  client: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  conflictColumn: string
): Promise<UpsertChunkResult> {
  if (rows.length === 0) return { inserted: 0, failed: [], error: null };

  const bulk = await upsertChunkBulk(client, table, rows, conflictColumn);
  if (bulk.ok) return { inserted: rows.length, failed: [], error: null };

  console.warn(
    `${LOG_PREFIX} bulk upsert into ${table} failed (${rows.length} rows): ${bulk.error}. Falling back to row-by-row…`
  );

  let inserted = 0;
  const failed: FailedRow[] = [];
  for (const row of rows) {
    const { error } = await client.from(table).upsert([row], {
      onConflict: conflictColumn,
      ignoreDuplicates: false,
    });
    if (error) {
      failed.push({ row, error: formatSupabaseError(error) });
    } else {
      inserted++;
    }
  }
  const summaryError = failed.length > 0
    ? `${failed.length}/${rows.length} rows failed in row-by-row fallback`
    : null;
  return { inserted, failed, error: summaryError };
}

async function flushCompanyMappedBatches(
  client: SupabaseClient,
  mappedCompanies: Record<string, unknown>[],
  projectId: string | undefined,
  logger: SyncLogger,
  rlsHint: string
): Promise<{ upserted: number; errors: string[] }> {
  if (mappedCompanies.length === 0) return { upserted: 0, errors: [] };
  const companyChunkCount = Math.ceil(mappedCompanies.length / CHUNK_SIZE);
  const batchErrors: string[] = [];
  let upserted = 0;
  for (let i = 0; i < mappedCompanies.length; i += CHUNK_SIZE) {
    const chunkIdx = Math.floor(i / CHUNK_SIZE) + 1;
    const chunk = mappedCompanies.slice(i, i + CHUNK_SIZE);
    const upsertResult = await upsertChunk(client, COMPANIES_TABLE, chunk, "id");
    upserted += upsertResult.inserted;
    if (upsertResult.inserted > 0) {
      await logger.logUpsert(COMPANIES_TABLE, upsertResult.inserted);
    }
    const failedCompanyIds = new Set(
      upsertResult.failed.map((f) => f.row.id as string).filter(Boolean)
    );
    const companyIdsToLink = chunk
      .map((r) => r.id as string)
      .filter((id) => id && !failedCompanyIds.has(id));
    if (projectId && companyIdsToLink.length > 0) {
      const { error: pcError } = await addCompaniesToProject(client, projectId, companyIdsToLink);
      if (pcError) {
        await logger.logError("companies: project_companies link error", {
          error: pcError,
          chunkIndex: chunkIdx,
          companyCount: companyIdsToLink.length,
        });
      }
    }
    if (upsertResult.error) {
      const errMsg =
        upsertResult.error + (upsertResult.error.includes("row-level security") ? rlsHint : "");
      batchErrors.push(`chunk ${chunkIdx}/${companyChunkCount}: ${errMsg}`);
      await logger.logError("companies: upsert error", {
        error: errMsg,
        chunkIndex: chunkIdx,
        totalChunks: companyChunkCount,
        chunkSize: chunk.length,
        rowsInserted: upsertResult.inserted,
        rowsFailed: upsertResult.failed.length,
      });
      for (const f of upsertResult.failed) {
        await logger.logError("companies: failed row", {
          error: f.error,
          id: (f.row.id as string) ?? null,
          name: (f.row.name as string) ?? null,
          created_at: (f.row.created_at as string) ?? null,
        });
      }
    }
  }
  return { upserted, errors: batchErrors };
}

async function flushContactMappedBatches(
  client: SupabaseClient,
  mappedContacts: Record<string, unknown>[],
  logger: SyncLogger,
  rlsHint: string
): Promise<{ upserted: number; errors: string[] }> {
  if (mappedContacts.length === 0) return { upserted: 0, errors: [] };
  const contactChunkCount = Math.ceil(mappedContacts.length / CHUNK_SIZE);
  const batchErrors: string[] = [];
  let upserted = 0;
  for (let i = 0; i < mappedContacts.length; i += CHUNK_SIZE) {
    const chunkIdx = Math.floor(i / CHUNK_SIZE) + 1;
    const chunk = mappedContacts.slice(i, i + CHUNK_SIZE);
    const upsertResult = await upsertChunk(client, CONTACTS_TABLE, chunk, "uuid");
    upserted += upsertResult.inserted;
    if (upsertResult.inserted > 0) {
      await logger.logUpsert(CONTACTS_TABLE, upsertResult.inserted);
    }
    if (upsertResult.error) {
      const errMsg =
        upsertResult.error + (upsertResult.error.includes("row-level security") ? rlsHint : "");
      batchErrors.push(`chunk ${chunkIdx}/${contactChunkCount}: ${errMsg}`);
      await logger.logError("contacts: upsert error", {
        error: errMsg,
        chunkIndex: chunkIdx,
        totalChunks: contactChunkCount,
        chunkSize: chunk.length,
        rowsInserted: upsertResult.inserted,
        rowsFailed: upsertResult.failed.length,
      });
      for (const f of upsertResult.failed) {
        await logger.logError("contacts: failed row", {
          error: f.error,
          uuid: (f.row.uuid as string) ?? null,
          name: (f.row.name as string) ?? null,
          created_at: (f.row.created_at as string) ?? null,
          project_id: (f.row.project_id as string) ?? null,
          company_uuid: (f.row.company_uuid as string) ?? null,
          rowKeys: Object.keys(f.row),
        });
      }
    }
  }
  return { upserted, errors: batchErrors };
}

async function flushLinkedInMessagesMappedBatches(
  client: SupabaseClient,
  mapped: Record<string, unknown>[],
  logger: SyncLogger
): Promise<{ upserted: number; errors: string[] }> {
  if (mapped.length === 0) return { upserted: 0, errors: [] };
  const msgChunkCount = Math.ceil(mapped.length / CHUNK_SIZE);
  const batchErrors: string[] = [];
  let upserted = 0;
  for (let i = 0; i < mapped.length; i += CHUNK_SIZE) {
    const chunkIdx = Math.floor(i / CHUNK_SIZE) + 1;
    const chunk = mapped.slice(i, i + CHUNK_SIZE);
    const upsertResult = await upsertChunk(client, LINKEDIN_MESSAGES_TABLE, chunk, "uuid");
    upserted += upsertResult.inserted;
    if (upsertResult.inserted > 0) {
      await logger.logUpsert(LINKEDIN_MESSAGES_TABLE, upsertResult.inserted);
    }
    if (upsertResult.error) {
      const errMsg =
        upsertResult.error +
        (upsertResult.error.includes("sender_id")
          ? " (LinkedinMessages table may use sender_profile_uuid; sync sends API columns as-is.)"
          : "");
      batchErrors.push(`chunk ${chunkIdx}/${msgChunkCount}: ${errMsg}`);
      await logger.logError("linkedin_messages: upsert error", {
        error: errMsg,
        chunkIndex: chunkIdx,
        totalChunks: msgChunkCount,
        chunkSize: chunk.length,
        rowsInserted: upsertResult.inserted,
        rowsFailed: upsertResult.failed.length,
      });
      for (const f of upsertResult.failed) {
        await logger.logError("linkedin_messages: failed row", {
          error: f.error,
          uuid: (f.row.uuid as string) ?? null,
          lead_uuid: (f.row.lead_uuid as string) ?? null,
          sender_profile_uuid: (f.row.sender_profile_uuid as string) ?? null,
          created_at: (f.row.created_at as string) ?? null,
          project_id: (f.row.project_id as string) ?? null,
          channel: (f.row.channel as string) ?? null,
        });
      }
    }
  }
  return { upserted, errors: batchErrors };
}

async function flushSendersMappedBatches(
  client: SupabaseClient,
  mapped: Record<string, unknown>[],
  logger: SyncLogger,
  rlsHint: string
): Promise<{ upserted: number; errors: string[] }> {
  if (mapped.length === 0) return { upserted: 0, errors: [] };
  const senderChunkCount = Math.ceil(mapped.length / CHUNK_SIZE);
  const batchErrors: string[] = [];
  let upserted = 0;
  for (let i = 0; i < mapped.length; i += CHUNK_SIZE) {
    const chunkIdx = Math.floor(i / CHUNK_SIZE) + 1;
    const chunk = mapped.slice(i, i + CHUNK_SIZE);
    const upsertResult = await upsertChunk(client, SENDERS_TABLE, chunk, "uuid");
    upserted += upsertResult.inserted;
    if (upsertResult.inserted > 0) {
      await logger.logUpsert(SENDERS_TABLE, upsertResult.inserted);
    }
    if (upsertResult.error) {
      const errMsg =
        upsertResult.error + (upsertResult.error.includes("row-level security") ? rlsHint : "");
      batchErrors.push(`chunk ${chunkIdx}/${senderChunkCount}: ${errMsg}`);
      await logger.logError("senders: upsert error", {
        error: errMsg,
        chunkIndex: chunkIdx,
        totalChunks: senderChunkCount,
        chunkSize: chunk.length,
        rowsInserted: upsertResult.inserted,
        rowsFailed: upsertResult.failed.length,
      });
      for (const f of upsertResult.failed) {
        await logger.logError("senders: failed row", {
          error: f.error,
          uuid: (f.row.uuid as string) ?? null,
          first_name: (f.row.first_name as string) ?? null,
          last_name: (f.row.last_name as string) ?? null,
          created_at: (f.row.created_at as string) ?? null,
          project_id: (f.row.project_id as string) ?? null,
        });
      }
    }
  }
  return { upserted, errors: batchErrors };
}

async function flushContactListsMappedBatches(
  client: SupabaseClient,
  mapped: Record<string, unknown>[],
  logger: SyncLogger,
  rlsHint: string
): Promise<{ upserted: number; errors: string[] }> {
  if (mapped.length === 0) return { upserted: 0, errors: [] };
  const listsChunkCount = Math.ceil(mapped.length / CHUNK_SIZE);
  const batchErrors: string[] = [];
  let upserted = 0;
  for (let i = 0; i < mapped.length; i += CHUNK_SIZE) {
    const chunkIdx = Math.floor(i / CHUNK_SIZE) + 1;
    const chunk = mapped.slice(i, i + CHUNK_SIZE);
    const upsertResult = await upsertChunk(client, CONTACT_LISTS_TABLE, chunk, "uuid");
    upserted += upsertResult.inserted;
    if (upsertResult.inserted > 0) {
      await logger.logUpsert(CONTACT_LISTS_TABLE, upsertResult.inserted);
    }
    if (upsertResult.error) {
      const errMsg =
        upsertResult.error + (upsertResult.error.includes("row-level security") ? rlsHint : "");
      batchErrors.push(`chunk ${chunkIdx}/${listsChunkCount}: ${errMsg}`);
      await logger.logError("contact_lists: upsert error", {
        error: errMsg,
        chunkIndex: chunkIdx,
        totalChunks: listsChunkCount,
        chunkSize: chunk.length,
        rowsInserted: upsertResult.inserted,
        rowsFailed: upsertResult.failed.length,
      });
      for (const f of upsertResult.failed) {
        await logger.logError("contact_lists: failed row", {
          error: f.error,
          uuid: (f.row.uuid as string) ?? null,
          name: (f.row.name as string) ?? null,
          updated_at: (f.row.updated_at as string) ?? null,
          project_id: (f.row.project_id as string) ?? null,
        });
      }
    }
  }
  return { upserted, errors: batchErrors };
}

async function flushGetSalesTagsMappedBatches(
  client: SupabaseClient,
  mapped: Record<string, unknown>[],
  logger: SyncLogger,
  rlsHint: string
): Promise<{ upserted: number; errors: string[] }> {
  if (mapped.length === 0) return { upserted: 0, errors: [] };
  const tagsChunkCount = Math.ceil(mapped.length / CHUNK_SIZE);
  const batchErrors: string[] = [];
  let upserted = 0;
  for (let i = 0; i < mapped.length; i += CHUNK_SIZE) {
    const chunkIdx = Math.floor(i / CHUNK_SIZE) + 1;
    const chunk = mapped.slice(i, i + CHUNK_SIZE);
    const upsertResult = await upsertChunk(client, GET_SALES_TAGS_TABLE, chunk, "uuid");
    upserted += upsertResult.inserted;
    if (upsertResult.inserted > 0) {
      await logger.logUpsert(GET_SALES_TAGS_TABLE, upsertResult.inserted);
    }
    if (upsertResult.error) {
      const errMsg =
        upsertResult.error + (upsertResult.error.includes("row-level security") ? rlsHint : "");
      batchErrors.push(`chunk ${chunkIdx}/${tagsChunkCount}: ${errMsg}`);
      await logger.logError("getsales_tags: upsert error", {
        error: errMsg,
        chunkIndex: chunkIdx,
        totalChunks: tagsChunkCount,
        chunkSize: chunk.length,
        rowsInserted: upsertResult.inserted,
        rowsFailed: upsertResult.failed.length,
      });
      for (const f of upsertResult.failed) {
        await logger.logError("getsales_tags: failed row", {
          error: f.error,
          uuid: (f.row.uuid as string) ?? null,
          name: (f.row.name as string) ?? null,
          updated_at: (f.row.updated_at as string) ?? null,
          project_id: (f.row.project_id as string) ?? null,
        });
      }
    }
  }
  return { upserted, errors: batchErrors };
}

async function flushPipelineStagesMappedBatches(
  client: SupabaseClient,
  mapped: Record<string, unknown>[],
  logger: SyncLogger,
  rlsHint: string
): Promise<{ upserted: number; errors: string[] }> {
  if (mapped.length === 0) return { upserted: 0, errors: [] };
  const psChunkCount = Math.ceil(mapped.length / CHUNK_SIZE);
  const batchErrors: string[] = [];
  let upserted = 0;
  for (let i = 0; i < mapped.length; i += CHUNK_SIZE) {
    const chunkIdx = Math.floor(i / CHUNK_SIZE) + 1;
    const chunk = mapped.slice(i, i + CHUNK_SIZE);
    const upsertResult = await upsertChunk(client, PIPELINE_STAGES_TABLE, chunk, "uuid");
    upserted += upsertResult.inserted;
    if (upsertResult.inserted > 0) {
      await logger.logUpsert(PIPELINE_STAGES_TABLE, upsertResult.inserted);
    }
    if (upsertResult.error) {
      const errMsg =
        upsertResult.error + (upsertResult.error.includes("row-level security") ? rlsHint : "");
      batchErrors.push(`chunk ${chunkIdx}/${psChunkCount}: ${errMsg}`);
      await logger.logError("pipeline_stages: upsert error", {
        error: errMsg,
        chunkIndex: chunkIdx,
        totalChunks: psChunkCount,
        chunkSize: chunk.length,
        rowsInserted: upsertResult.inserted,
        rowsFailed: upsertResult.failed.length,
      });
      for (const f of upsertResult.failed) {
        await logger.logError("pipeline_stages: failed row", {
          error: f.error,
          uuid: (f.row.uuid as string) ?? null,
          name: (f.row.name as string) ?? null,
          entity_object: (f.row.entity_object as string) ?? null,
          updated_at: (f.row.updated_at as string) ?? null,
          project_id: (f.row.project_id as string) ?? null,
        });
      }
    }
  }
  return { upserted, errors: batchErrors };
}

async function flushFlowsMappedBatches(
  client: SupabaseClient,
  mapped: Record<string, unknown>[],
  logger: SyncLogger,
  rlsHint: string
): Promise<{ upserted: number; errors: string[] }> {
  if (mapped.length === 0) return { upserted: 0, errors: [] };
  const flowsChunkCount = Math.ceil(mapped.length / CHUNK_SIZE);
  const batchErrors: string[] = [];
  let upserted = 0;
  for (let i = 0; i < mapped.length; i += CHUNK_SIZE) {
    const chunkIdx = Math.floor(i / CHUNK_SIZE) + 1;
    const chunk = mapped.slice(i, i + CHUNK_SIZE);
    const upsertResult = await upsertChunk(client, FLOWS_TABLE, chunk, "uuid");
    upserted += upsertResult.inserted;
    if (upsertResult.inserted > 0) {
      await logger.logUpsert(FLOWS_TABLE, upsertResult.inserted);
    }
    if (upsertResult.error) {
      const errMsg =
        upsertResult.error + (upsertResult.error.includes("row-level security") ? rlsHint : "");
      batchErrors.push(`chunk ${chunkIdx}/${flowsChunkCount}: ${errMsg}`);
      await logger.logError("flows: upsert error", {
        error: errMsg,
        chunkIndex: chunkIdx,
        totalChunks: flowsChunkCount,
        chunkSize: chunk.length,
        rowsInserted: upsertResult.inserted,
        rowsFailed: upsertResult.failed.length,
      });
      for (const f of upsertResult.failed) {
        await logger.logError("flows: failed row", {
          error: f.error,
          uuid: (f.row.uuid as string) ?? null,
          name: (f.row.name as string) ?? null,
          updated_at: (f.row.updated_at as string) ?? null,
          project_id: (f.row.project_id as string) ?? null,
        });
      }
    }
  }
  return { upserted, errors: batchErrors };
}

async function flushFlowLeadsMappedBatches(
  client: SupabaseClient,
  mapped: Record<string, unknown>[],
  logger: SyncLogger,
  rlsHint: string
): Promise<{ upserted: number; errors: string[] }> {
  if (mapped.length === 0) return { upserted: 0, errors: [] };
  const flChunkCount = Math.ceil(mapped.length / CHUNK_SIZE);
  const batchErrors: string[] = [];
  let upserted = 0;
  for (let i = 0; i < mapped.length; i += CHUNK_SIZE) {
    const chunkIdx = Math.floor(i / CHUNK_SIZE) + 1;
    const chunk = mapped.slice(i, i + CHUNK_SIZE);
    const upsertResult = await upsertChunk(client, FLOW_LEADS_TABLE, chunk, "uuid");
    upserted += upsertResult.inserted;
    if (upsertResult.inserted > 0) {
      await logger.logUpsert(FLOW_LEADS_TABLE, upsertResult.inserted);
    }
    if (upsertResult.error) {
      const errMsg =
        upsertResult.error + (upsertResult.error.includes("row-level security") ? rlsHint : "");
      batchErrors.push(`chunk ${chunkIdx}/${flChunkCount}: ${errMsg}`);
      await logger.logError("flow_leads: upsert error", {
        error: errMsg,
        chunkIndex: chunkIdx,
        totalChunks: flChunkCount,
        chunkSize: chunk.length,
        rowsInserted: upsertResult.inserted,
        rowsFailed: upsertResult.failed.length,
      });
      for (const f of upsertResult.failed) {
        await logger.logError("flow_leads: failed row", {
          error: f.error,
          uuid: (f.row.uuid as string) ?? null,
          flow_uuid: (f.row.flow_uuid as string) ?? null,
          lead_uuid: (f.row.lead_uuid as string) ?? null,
          created_at: (f.row.created_at as string) ?? null,
          project_id: (f.row.project_id as string) ?? null,
        });
      }
    }
  }
  return { upserted, errors: batchErrors };
}

export interface SyncResult {
  companies: { fetched: number; upserted: number; error: string | null };
  contacts: { fetched: number; upserted: number; error: string | null };
  linkedin_messages: { fetched: number; upserted: number; error: string | null };
  senders: { fetched: number; upserted: number; error: string | null };
  contact_lists: { fetched: number; upserted: number; error: string | null };
  getsales_tags: { fetched: number; upserted: number; error: string | null };
  pipeline_stages: { fetched: number; upserted: number; error: string | null };
  flows: { fetched: number; upserted: number; error: string | null };
  flow_leads: { fetched: number; upserted: number; error: string | null };
  error: string | null;
  /** Set when the user stopped the run via POST /api/supabase-sync-cancel. */
  cancelled?: boolean;
}

/** Resolve latest created_at for a table; on error return null (will do full fetch for that table). */
async function latestCreatedAt(
  client: SupabaseClient,
  table: string,
  projectId?: string | null
): Promise<string | null> {
  const { latest, error } = await getLatestCreatedAt(client, table, projectId);
  if (error) return null;
  return latest;
}

/** Resolve latest updated_at for a table (Flows); on error return null. */
async function latestUpdatedAt(
  client: SupabaseClient,
  table: string,
  projectId?: string | null
): Promise<string | null> {
  const { latest, error } = await getLatestUpdatedAt(client, table, projectId);
  if (error) return null;
  return latest;
}

export async function syncSupabaseFromSource(
  projectId?: string,
  existingRunId?: string,
  options?: SyncSupabaseOptions
): Promise<SyncResult> {
  const client = getSupabase();
  const result: SyncResult = {
    companies: { fetched: 0, upserted: 0, error: null },
    contacts: { fetched: 0, upserted: 0, error: null },
    linkedin_messages: { fetched: 0, upserted: 0, error: null },
    senders: { fetched: 0, upserted: 0, error: null },
    contact_lists: { fetched: 0, upserted: 0, error: null },
    getsales_tags: { fetched: 0, upserted: 0, error: null },
    pipeline_stages: { fetched: 0, upserted: 0, error: null },
    flows: { fetched: 0, upserted: 0, error: null },
    flow_leads: { fetched: 0, upserted: 0, error: null },
    error: null,
  };

  if (!client) {
    result.error = "Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)";
    console.log(`${LOG_PREFIX} sync skipped: Supabase not configured`);
    return result;
  }

  // When called without a pre-created run, check sync lock ourselves
  if (!existingRunId) {
    const { data: activeRun, error: lockCheckError } = await getActiveSyncRun(client);
    if (lockCheckError) {
      result.error = `Failed to check sync lock: ${lockCheckError}`;
      return result;
    }
    if (activeRun) {
      result.error = `Sync already running (run ${activeRun.id}, project ${activeRun.project_id ?? "unknown"})`;
      return result;
    }
  }

  // Resolve project credentials (fall back to env vars)
  let credentials: ApiCredentials | undefined;
  if (projectId) {
    const { data: project, error: projectError } = await getProjectById(client, projectId);
    if (projectError) {
      result.error = `Failed to load project: ${projectError}`;
      return result;
    }
    if (!project) {
      result.error = `Project not found: ${projectId}`;
      return result;
    }
    const baseUrl = project.source_api_base_url ?? process.env.SOURCE_API_BASE_URL;
    const apiKey = project.source_api_key ?? process.env.SOURCE_API_KEY;
    if (baseUrl && apiKey) {
      credentials = { baseUrl, apiKey };
    }
  }

  let runId: string | null = existingRunId ?? null;
  if (!runId) {
    const runResult = await createSyncRun(client, projectId);
    if (runResult.id) runId = runResult.id;
  }
  const logger = createSyncLogger(client, runId);

  const entitiesRequested = options?.entities;
  const effectiveList: SyncEntityKey[] =
    entitiesRequested === undefined ? [...SYNC_ENTITY_PIPELINE] : expandSyncEntities(entitiesRequested);
  const effective = new Set(effectiveList);

  const syncDateRange = options?.syncDateRange;

  await logger.log("sync started", {
    projectId: projectId ?? "none",
    entitiesRequested: entitiesRequested ?? "all",
    entitiesEffective: effectiveList,
    syncDateRange: syncDateRange ?? "none",
  });

  const rlsHint =
    " Use SUPABASE_SERVICE_ROLE_KEY (not anon key) so sync bypasses Row Level Security.";

  // Resolve watermark timestamps per table. Companies use updated_at so both new and
  // modified company rows are picked up on each incremental sync.
  const [
    companiesLatest,
    contactsLatest,
    messagesLatest,
    sendersLatest,
    contactListsLatestUpdated,
    getSalesTagsLatestUpdated,
    pipelineStagesLatestUpdated,
    flowsLatestUpdated,
    flowLeadsLatest,
  ] = await Promise.all([
    effective.has("companies") ? latestUpdatedAt(client, COMPANIES_TABLE, null) : Promise.resolve(null),
    effective.has("contacts") ? latestCreatedAt(client, CONTACTS_TABLE, projectId) : Promise.resolve(null),
    effective.has("linkedin_messages")
      ? latestCreatedAt(client, LINKEDIN_MESSAGES_TABLE, projectId)
      : Promise.resolve(null),
    effective.has("senders") ? latestCreatedAt(client, SENDERS_TABLE, projectId) : Promise.resolve(null),
    effective.has("contact_lists")
      ? latestUpdatedAt(client, CONTACT_LISTS_TABLE, projectId)
      : Promise.resolve(null),
    effective.has("getsales_tags")
      ? latestUpdatedAt(client, GET_SALES_TAGS_TABLE, projectId)
      : Promise.resolve(null),
    effective.has("pipeline_stages")
      ? latestUpdatedAt(client, PIPELINE_STAGES_TABLE, projectId)
      : Promise.resolve(null),
    effective.has("flows") ? latestUpdatedAt(client, FLOWS_TABLE, projectId) : Promise.resolve(null),
    effective.has("flow_leads") ? latestCreatedAt(client, FLOW_LEADS_TABLE, projectId) : Promise.resolve(null),
  ]);
  await logger.log("cursors resolved", {
    companiesSinceUpdated: effective.has("companies") ? companiesLatest ?? "null" : "skipped",
    contactsSince: effective.has("contacts") ? contactsLatest ?? "null" : "skipped",
    messagesSince: effective.has("linkedin_messages") ? messagesLatest ?? "null" : "skipped",
    sendersSince: effective.has("senders") ? sendersLatest ?? "null" : "skipped",
    contactListsSinceUpdated: effective.has("contact_lists")
      ? contactListsLatestUpdated ?? "null"
      : "skipped",
    getSalesTagsSinceUpdated: effective.has("getsales_tags")
      ? getSalesTagsLatestUpdated ?? "null"
      : "skipped",
    pipelineStagesSinceUpdated: effective.has("pipeline_stages")
      ? pipelineStagesLatestUpdated ?? "null"
      : "skipped",
    flowsSinceUpdated: effective.has("flows") ? flowsLatestUpdated ?? "null" : "skipped",
    flowLeadsSince: effective.has("flow_leads") ? flowLeadsLatest ?? "null" : "skipped",
  });

  const fetchLog: FetchLogger = (msg, data) => logger.log(msg, data);

  /** Passed to contacts / companies fetchers (always partitioned to avoid ES 10k window). */
  const partitionFetchOpts = {
    useDatePartition: true as const,
    ...(syncDateRange ? { dateRange: syncDateRange } : {}),
  };

  const syncBufferRows = getSyncFetchBufferRows();

  const syncShouldStop = async (): Promise<void> => {
    if (runId && isSyncCancelled(runId)) {
      await logger.log("sync stop requested", {});
      throw new SyncCancelledError();
    }
  };

  try {
    if (runId) registerLocalSyncRun(runId);
    await syncShouldStop();

  if (effective.has("companies")) {
  // --- Companies first (incremental, global — no project_id); stream pages → Supabase in buffers ---
  await logger.log("companies: fetching from source", { fetchBufferRows: syncBufferRows });
  const companyBuf: Record<string, unknown>[] = [];
  let companyUpsertTotal = 0;
  const companyErrorsAcc: string[] = [];
  const flushCompanyBuf = async (batch: Record<string, unknown>[]) => {
    const { upserted, errors } = await flushCompanyMappedBatches(
      client,
      batch,
      projectId,
      logger,
      rlsHint
    );
    companyUpsertTotal += upserted;
    companyErrorsAcc.push(...errors);
  };
  const pushCompanyPage = async (rows: Record<string, unknown>[]) => {
    companyBuf.push(...rows.map(mapCompanyForSupabase));
    while (companyBuf.length >= syncBufferRows) {
      const batch = companyBuf.splice(0, syncBufferRows);
      await flushCompanyBuf(batch);
    }
  };
  const companiesRes = await fetchCompaniesIncremental(companiesLatest, credentials, fetchLog, {
    onPage: pushCompanyPage,
    onBeforePage: syncShouldStop,
    ...partitionFetchOpts,
  });
  result.companies.fetched = companiesRes.fetchedCount;
  if (companyBuf.length > 0) {
    await flushCompanyBuf(companyBuf);
  }
  result.companies.upserted = companyUpsertTotal;
  if (companiesRes.error) {
    result.companies.error = companiesRes.error;
    await logger.logError(
      "companies: fetch error",
      buildSourceApiFetchErrorLog(companiesRes.error, companiesRes.errorDetail, {
        since: companiesLatest ?? "full",
      })
    );
  } else {
    await logger.log("companies: fetched", { count: result.companies.fetched });
    if (companyErrorsAcc.length > 0) {
      result.companies.error = `${companyErrorsAcc.length} chunk(s) failed: ${companyErrorsAcc.join("; ")}`;
    }
    await logger.log("companies: upserted", { count: result.companies.upserted });
  }
  }

  if (effective.has("contacts")) {
  // --- Contacts second (incremental); stream pages → Supabase in buffers ---
  await logger.log("contacts: fetching from source", { fetchBufferRows: syncBufferRows });
  const contactBuf: Record<string, unknown>[] = [];
  let contactUpsertTotal = 0;
  const contactErrorsAcc: string[] = [];
  const flushContactBuf = async (batch: Record<string, unknown>[]) => {
    const { upserted, errors } = await flushContactMappedBatches(client, batch, logger, rlsHint);
    contactUpsertTotal += upserted;
    contactErrorsAcc.push(...errors);
  };
  const pushContactPage = async (rows: Record<string, unknown>[]) => {
    const mapped = rows.map(mapContactForSupabase);
    if (projectId) injectProjectId(mapped, projectId);
    contactBuf.push(...mapped);
    while (contactBuf.length >= syncBufferRows) {
      const batch = contactBuf.splice(0, syncBufferRows);
      await flushContactBuf(batch);
    }
  };
  const contactsRes = await fetchContactsIncremental(contactsLatest, credentials, fetchLog, {
    onPage: pushContactPage,
    onBeforePage: syncShouldStop,
    ...partitionFetchOpts,
  });
  result.contacts.fetched = contactsRes.fetchedCount;
  if (contactBuf.length > 0) {
    await flushContactBuf(contactBuf);
  }
  result.contacts.upserted = contactUpsertTotal;
  if (contactsRes.error) {
    result.contacts.error = contactsRes.error;
    await logger.logError(
      "contacts: fetch error",
      buildSourceApiFetchErrorLog(contactsRes.error, contactsRes.errorDetail, {
        since: contactsLatest ?? "full",
      })
    );
  } else {
    await logger.log("contacts: fetched", { count: result.contacts.fetched });
    if (contactErrorsAcc.length > 0) {
      result.contacts.error = `${contactErrorsAcc.length} chunk(s) failed: ${contactErrorsAcc.join("; ")}`;
    }
    await logger.log("contacts: upserted", { count: result.contacts.upserted });
  }
  }

  if (effective.has("linkedin_messages")) {
  // --- Remaining entities: stream GetSales pages → buffer → Supabase (same flush size) ---
  await logger.log("linkedin_messages: fetching from source", { fetchBufferRows: syncBufferRows });
  const msgBuf: Record<string, unknown>[] = [];
  let msgUpsertTotal = 0;
  const msgErrorsAcc: string[] = [];
  const flushMsgBuf = async (batch: Record<string, unknown>[]) => {
    const { upserted, errors } = await flushLinkedInMessagesMappedBatches(client, batch, logger);
    msgUpsertTotal += upserted;
    msgErrorsAcc.push(...errors);
  };
  const pushMsgPage = async (rows: Record<string, unknown>[]) => {
    const mapped = rows.map(mapMessageForSupabase);
    if (projectId) injectProjectId(mapped, projectId);
    msgBuf.push(...mapped);
    while (msgBuf.length >= syncBufferRows) {
      const batch = msgBuf.splice(0, syncBufferRows);
      await flushMsgBuf(batch);
    }
  };
  const messagesRes = await fetchLinkedInMessagesIncremental(messagesLatest, credentials, fetchLog, {
    onPage: pushMsgPage,
    onBeforePage: syncShouldStop,
  });
  result.linkedin_messages.fetched = messagesRes.fetchedCount;
  if (msgBuf.length > 0) await flushMsgBuf(msgBuf);
  result.linkedin_messages.upserted = msgUpsertTotal;
  if (messagesRes.error) {
    result.linkedin_messages.error = messagesRes.error;
    await logger.logError(
      "linkedin_messages: fetch error",
      buildSourceApiFetchErrorLog(messagesRes.error, messagesRes.errorDetail, {
        since: messagesLatest ?? "full",
      })
    );
  } else {
    await logger.log("linkedin_messages: fetched", { count: result.linkedin_messages.fetched });
    if (msgErrorsAcc.length > 0) {
      result.linkedin_messages.error = `${msgErrorsAcc.length} chunk(s) failed: ${msgErrorsAcc.join("; ")}`;
    }
    await logger.log("linkedin_messages: upserted", { count: result.linkedin_messages.upserted });
  }
  }

  if (effective.has("senders")) {
  await logger.log("senders: fetching from source", { fetchBufferRows: syncBufferRows });
  const senderBuf: Record<string, unknown>[] = [];
  let senderUpsertTotal = 0;
  const senderErrorsAcc: string[] = [];
  const flushSenderBuf = async (batch: Record<string, unknown>[]) => {
    const { upserted, errors } = await flushSendersMappedBatches(client, batch, logger, rlsHint);
    senderUpsertTotal += upserted;
    senderErrorsAcc.push(...errors);
  };
  const pushSenderPage = async (rows: Record<string, unknown>[]) => {
    const mapped = rows.map(mapSenderForSupabase);
    if (projectId) injectProjectId(mapped, projectId);
    senderBuf.push(...mapped);
    while (senderBuf.length >= syncBufferRows) {
      const batch = senderBuf.splice(0, syncBufferRows);
      await flushSenderBuf(batch);
    }
  };
  const sendersRes = await fetchSendersIncremental(sendersLatest, credentials, fetchLog, {
    onPage: pushSenderPage,
    onBeforePage: syncShouldStop,
  });
  result.senders.fetched = sendersRes.fetchedCount;
  if (senderBuf.length > 0) await flushSenderBuf(senderBuf);
  result.senders.upserted = senderUpsertTotal;
  if (sendersRes.error) {
    result.senders.error = sendersRes.error;
    await logger.logError(
      "senders: fetch error",
      buildSourceApiFetchErrorLog(sendersRes.error, sendersRes.errorDetail, {
        since: sendersLatest ?? "full",
      })
    );
  } else {
    await logger.log("senders: fetched", { count: result.senders.fetched });
    if (senderErrorsAcc.length > 0) {
      result.senders.error = `${senderErrorsAcc.length} chunk(s) failed: ${senderErrorsAcc.join("; ")}`;
    }
    await logger.log("senders: upserted", { count: result.senders.upserted });
  }
  }

  if (effective.has("contact_lists")) {
  await logger.log("contact_lists: fetching from source", { fetchBufferRows: syncBufferRows });
  const listsBuf: Record<string, unknown>[] = [];
  let listsUpsertTotal = 0;
  const listsErrorsAcc: string[] = [];
  const flushListsBuf = async (batch: Record<string, unknown>[]) => {
    const { upserted, errors } = await flushContactListsMappedBatches(client, batch, logger, rlsHint);
    listsUpsertTotal += upserted;
    listsErrorsAcc.push(...errors);
  };
  const pushListsPage = async (rows: Record<string, unknown>[]) => {
    const mapped = rows.map(mapContactListForSupabase);
    if (projectId) injectProjectId(mapped, projectId);
    listsBuf.push(...mapped);
    while (listsBuf.length >= syncBufferRows) {
      const batch = listsBuf.splice(0, syncBufferRows);
      await flushListsBuf(batch);
    }
  };
  const contactListsRes = await fetchContactListsIncremental(contactListsLatestUpdated, credentials, fetchLog, {
    onPage: pushListsPage,
    onBeforePage: syncShouldStop,
  });
  result.contact_lists.fetched = contactListsRes.fetchedCount;
  if (listsBuf.length > 0) await flushListsBuf(listsBuf);
  result.contact_lists.upserted = listsUpsertTotal;
  if (contactListsRes.error) {
    result.contact_lists.error = contactListsRes.error;
    await logger.logError(
      "contact_lists: fetch error",
      buildSourceApiFetchErrorLog(contactListsRes.error, contactListsRes.errorDetail, {
        sinceUpdated: contactListsLatestUpdated ?? "full",
      })
    );
  } else {
    await logger.log("contact_lists: fetched", { count: result.contact_lists.fetched });
    if (listsErrorsAcc.length > 0) {
      result.contact_lists.error = `${listsErrorsAcc.length} chunk(s) failed: ${listsErrorsAcc.join("; ")}`;
    }
    await logger.log("contact_lists: upserted", { count: result.contact_lists.upserted });
  }
  }

  if (effective.has("getsales_tags")) {
  await logger.log("getsales_tags: fetching from source", { fetchBufferRows: syncBufferRows });
  const tagsBuf: Record<string, unknown>[] = [];
  let tagsUpsertTotal = 0;
  const tagsErrorsAcc: string[] = [];
  const flushTagsBuf = async (batch: Record<string, unknown>[]) => {
    const { upserted, errors } = await flushGetSalesTagsMappedBatches(client, batch, logger, rlsHint);
    tagsUpsertTotal += upserted;
    tagsErrorsAcc.push(...errors);
  };
  const pushTagsPage = async (rows: Record<string, unknown>[]) => {
    const mapped = rows.map(mapGetSalesTagForSupabase);
    if (projectId) injectProjectId(mapped, projectId);
    tagsBuf.push(...mapped);
    while (tagsBuf.length >= syncBufferRows) {
      const batch = tagsBuf.splice(0, syncBufferRows);
      await flushTagsBuf(batch);
    }
  };
  const getSalesTagsRes = await fetchTagsIncremental(getSalesTagsLatestUpdated, credentials, fetchLog, {
    onPage: pushTagsPage,
    onBeforePage: syncShouldStop,
  });
  result.getsales_tags.fetched = getSalesTagsRes.fetchedCount;
  if (tagsBuf.length > 0) await flushTagsBuf(tagsBuf);
  result.getsales_tags.upserted = tagsUpsertTotal;
  if (getSalesTagsRes.error) {
    result.getsales_tags.error = getSalesTagsRes.error;
    await logger.logError(
      "getsales_tags: fetch error",
      buildSourceApiFetchErrorLog(getSalesTagsRes.error, getSalesTagsRes.errorDetail, {
        sinceUpdated: getSalesTagsLatestUpdated ?? "full",
      })
    );
  } else {
    await logger.log("getsales_tags: fetched", { count: result.getsales_tags.fetched });
    if (tagsErrorsAcc.length > 0) {
      result.getsales_tags.error = `${tagsErrorsAcc.length} chunk(s) failed: ${tagsErrorsAcc.join("; ")}`;
    }
    await logger.log("getsales_tags: upserted", { count: result.getsales_tags.upserted });
    if (projectId) {
      const reconcile = await reconcileHypothesisGetSalesTags(client, projectId);
      await logger.log("hypotheses: reconcile GetSales tags", {
        updated: reconcile.updated,
        error: reconcile.error,
      });
    }
  }
  }

  if (effective.has("pipeline_stages")) {
  await logger.log("pipeline_stages: fetching from source", { fetchBufferRows: syncBufferRows });
  const psBuf: Record<string, unknown>[] = [];
  let psUpsertTotal = 0;
  const psErrorsAcc: string[] = [];
  const flushPsBuf = async (batch: Record<string, unknown>[]) => {
    const { upserted, errors } = await flushPipelineStagesMappedBatches(client, batch, logger, rlsHint);
    psUpsertTotal += upserted;
    psErrorsAcc.push(...errors);
  };
  const pushPsPage = async (rows: Record<string, unknown>[]) => {
    const mapped = rows.map(mapPipelineStageForSupabase);
    if (projectId) injectProjectId(mapped, projectId);
    psBuf.push(...mapped);
    while (psBuf.length >= syncBufferRows) {
      const batch = psBuf.splice(0, syncBufferRows);
      await flushPsBuf(batch);
    }
  };
  const pipelineStagesRes = await fetchPipelineStagesIncremental(
    pipelineStagesLatestUpdated,
    credentials,
    fetchLog,
    {
      onPage: pushPsPage,
      onBeforePage: syncShouldStop,
    }
  );
  result.pipeline_stages.fetched = pipelineStagesRes.fetchedCount;
  if (psBuf.length > 0) await flushPsBuf(psBuf);
  result.pipeline_stages.upserted = psUpsertTotal;
  if (pipelineStagesRes.error) {
    result.pipeline_stages.error = pipelineStagesRes.error;
    await logger.logError(
      "pipeline_stages: fetch error",
      buildSourceApiFetchErrorLog(pipelineStagesRes.error, pipelineStagesRes.errorDetail, {
        sinceUpdated: pipelineStagesLatestUpdated ?? "full",
      })
    );
  } else {
    await logger.log("pipeline_stages: fetched", { count: result.pipeline_stages.fetched });
    if (psErrorsAcc.length > 0) {
      result.pipeline_stages.error = `${psErrorsAcc.length} chunk(s) failed: ${psErrorsAcc.join("; ")}`;
    }
    await logger.log("pipeline_stages: upserted", { count: result.pipeline_stages.upserted });
  }
  }

  if (effective.has("flows")) {
  await logger.log("flows: fetching from source", { fetchBufferRows: syncBufferRows });
  const flowsBuf: Record<string, unknown>[] = [];
  let flowsUpsertTotal = 0;
  const flowsErrorsAcc: string[] = [];
  const flushFlowsBuf = async (batch: Record<string, unknown>[]) => {
    const { upserted, errors } = await flushFlowsMappedBatches(client, batch, logger, rlsHint);
    flowsUpsertTotal += upserted;
    flowsErrorsAcc.push(...errors);
  };
  const pushFlowsPage = async (rows: Record<string, unknown>[]) => {
    const mapped = rows.map(mapFlowForSupabase);
    if (projectId) injectProjectId(mapped, projectId);
    flowsBuf.push(...mapped);
    while (flowsBuf.length >= syncBufferRows) {
      const batch = flowsBuf.splice(0, syncBufferRows);
      await flushFlowsBuf(batch);
    }
  };
  const flowsRes = await fetchFlowsIncremental(flowsLatestUpdated, credentials, fetchLog, {
    onPage: pushFlowsPage,
    onBeforePage: syncShouldStop,
  });
  result.flows.fetched = flowsRes.fetchedCount;
  if (flowsBuf.length > 0) await flushFlowsBuf(flowsBuf);
  result.flows.upserted = flowsUpsertTotal;
  if (flowsRes.error) {
    result.flows.error = flowsRes.error;
    await logger.logError(
      "flows: fetch error",
      buildSourceApiFetchErrorLog(flowsRes.error, flowsRes.errorDetail, {
        sinceUpdated: flowsLatestUpdated ?? "full",
      })
    );
  } else {
    await logger.log("flows: fetched", { count: result.flows.fetched });
    if (flowsErrorsAcc.length > 0) {
      result.flows.error = `${flowsErrorsAcc.length} chunk(s) failed: ${flowsErrorsAcc.join("; ")}`;
    }
    await logger.log("flows: upserted", { count: result.flows.upserted });
  }
  }

  if (effective.has("flow_leads")) {
  await logger.log("flow_leads: fetching from source", { fetchBufferRows: syncBufferRows });
  const flBuf: Record<string, unknown>[] = [];
  let flUpsertTotal = 0;
  const flErrorsAcc: string[] = [];
  const flushFlBuf = async (batch: Record<string, unknown>[]) => {
    const { upserted, errors } = await flushFlowLeadsMappedBatches(client, batch, logger, rlsHint);
    flUpsertTotal += upserted;
    flErrorsAcc.push(...errors);
  };
  const pushFlPage = async (rows: Record<string, unknown>[]) => {
    const mapped = rows.map(mapFlowLeadForSupabase);
    if (projectId) injectProjectId(mapped, projectId);
    flBuf.push(...mapped);
    while (flBuf.length >= syncBufferRows) {
      const batch = flBuf.splice(0, syncBufferRows);
      await flushFlBuf(batch);
    }
  };
  const flowLeadsRes = await fetchFlowLeadsIncremental(flowLeadsLatest, credentials, fetchLog, {
    onPage: pushFlPage,
    onBeforePage: syncShouldStop,
  });
  result.flow_leads.fetched = flowLeadsRes.fetchedCount;
  if (flBuf.length > 0) await flushFlBuf(flBuf);
  result.flow_leads.upserted = flUpsertTotal;
  if (flowLeadsRes.error) {
    result.flow_leads.error = flowLeadsRes.error;
    await logger.logError(
      "flow_leads: fetch error",
      buildSourceApiFetchErrorLog(flowLeadsRes.error, flowLeadsRes.errorDetail, {
        since: flowLeadsLatest ?? "full",
      })
    );
  } else {
    await logger.log("flow_leads: fetched", { count: result.flow_leads.fetched });
    if (flErrorsAcc.length > 0) {
      result.flow_leads.error = `${flErrorsAcc.length} chunk(s) failed: ${flErrorsAcc.join("; ")}`;
    }
    await logger.log("flow_leads: upserted", { count: result.flow_leads.upserted });
  }
  }

  } catch (e) {
    if (e instanceof SyncCancelledError) {
      result.cancelled = true;
      await logger.log("sync cancelled by user", {});
    } else {
      const msg = e instanceof Error ? e.message : String(e);
      result.error = msg;
      await logger.logError("sync failed", { error: msg });
    }
  } finally {
    if (runId) clearSyncCancellation(runId);
  }

  try {
  const hasError =
    result.error != null ||
    result.companies.error != null ||
    result.contacts.error != null ||
    result.linkedin_messages.error != null ||
    result.senders.error != null ||
    result.contact_lists.error != null ||
    result.getsales_tags.error != null ||
    result.pipeline_stages.error != null ||
    result.flows.error != null ||
    result.flow_leads.error != null;
  const status: SyncRunStatus = result.cancelled
    ? "cancelled"
    : result.error != null
      ? "error"
      : hasError
        ? "partial"
        : "success";
  await logger.log("sync finished", {
    entitiesRequested: entitiesRequested ?? "all",
    entitiesEffective: effectiveList,
    syncDateRange: syncDateRange ?? "none",
    cancelled: result.cancelled ?? false,
    ok: !hasError && !result.cancelled,
    companies: {
      fetched: result.companies.fetched,
      upserted: result.companies.upserted,
      error: result.companies.error != null,
    },
    contacts: {
      fetched: result.contacts.fetched,
      upserted: result.contacts.upserted,
      error: result.contacts.error != null,
    },
    linkedin_messages: {
      fetched: result.linkedin_messages.fetched,
      upserted: result.linkedin_messages.upserted,
      error: result.linkedin_messages.error != null,
    },
    senders: {
      fetched: result.senders.fetched,
      upserted: result.senders.upserted,
      error: result.senders.error != null,
    },
    contact_lists: {
      fetched: result.contact_lists.fetched,
      upserted: result.contact_lists.upserted,
      error: result.contact_lists.error != null,
    },
    getsales_tags: {
      fetched: result.getsales_tags.fetched,
      upserted: result.getsales_tags.upserted,
      error: result.getsales_tags.error != null,
    },
    pipeline_stages: {
      fetched: result.pipeline_stages.fetched,
      upserted: result.pipeline_stages.upserted,
      error: result.pipeline_stages.error != null,
    },
    flows: {
      fetched: result.flows.fetched,
      upserted: result.flows.upserted,
      error: result.flows.error != null,
    },
    flow_leads: {
      fetched: result.flow_leads.fetched,
      upserted: result.flow_leads.upserted,
      error: result.flow_leads.error != null,
    },
  });

  if (runId) {
    await updateSyncRun(client, runId, {
      status,
      result_summary: result as unknown as Record<string, unknown>,
      error: result.error ?? (result.cancelled ? "Cancelled by user" : null),
    });
    syncEventBus.emitComplete(runId, result as unknown as Record<string, unknown>);
  }
  return result;
  } finally {
    if (runId) unregisterLocalSyncRun(runId);
  }
}

export interface AnalyticsSyncResult {
  daysRequested: string[];
  daysSkippedAlreadyCollected: string[];
  daysSynced: string[];
  rowsInserted: number;
  /** Successful per-flow metrics fetches (sender_profiles with `flows` filter) across the run. */
  flowsProcessed: number;
  /** Per-day or step errors (partial sync). */
  errors: string[];
  error: string | null;
}

/**
 * For each calendar day in [dateFrom, dateTo] that has no AnalyticsSnapshots yet, for each flow
 * eligible that day (created_at date ≤ day), call POST /leads/api/leads/metrics with
 * group_by sender_profiles and flows: [flow.uuid], tag rows with flow_uuid, and store.
 * Does not use the main sync run lock.
 */
export async function syncAnalyticsSnapshots(
  projectId: string,
  dateFrom: string,
  dateTo: string
): Promise<AnalyticsSyncResult> {
  const empty = (): AnalyticsSyncResult => ({
    daysRequested: [],
    daysSkippedAlreadyCollected: [],
    daysSynced: [],
    rowsInserted: 0,
    flowsProcessed: 0,
    errors: [],
    error: null,
  });

  const client = getSupabase();
  if (!client) {
    return {
      ...empty(),
      error: "Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)",
    };
  }

  const range = enumerateDatesInclusive(dateFrom, dateTo);
  if (!range || range.length === 0) {
    return { ...empty(), error: "Invalid date range (use YYYY-MM-DD)" };
  }

  const { data: project, error: projectError } = await getProjectById(client, projectId);
  if (projectError) {
    return { ...empty(), error: `Failed to load project: ${projectError}` };
  }
  if (!project) {
    return { ...empty(), error: `Project not found: ${projectId}` };
  }

  const baseUrl = project.source_api_base_url ?? process.env.SOURCE_API_BASE_URL;
  const apiKey = project.source_api_key ?? process.env.SOURCE_API_KEY;
  if (!baseUrl || !apiKey) {
    return {
      ...empty(),
      error: "SOURCE_API_BASE_URL and SOURCE_API_KEY (or project credentials) are required",
    };
  }
  const credentials: ApiCredentials = { baseUrl, apiKey };

  const { dates: collected, error: colErr } = await getCollectedAnalyticsDays(client, projectId);
  if (colErr) {
    return { ...empty(), error: `Failed to list collected days: ${colErr}` };
  }
  const collectedSet = new Set(collected);

  const daysRequested = range;
  const daysSkippedAlreadyCollected: string[] = [];
  const daysSynced: string[] = [];
  const errors: string[] = [];
  let rowsInserted = 0;
  let flowsProcessed = 0;

  const fetchLog: FetchLogger = async (msg, data) => {
    console.log(`${LOG_PREFIX} ${msg}`, data ?? "");
  };

  const { flows: allFlows, error: flowsLoadErr } = await getFlowsForProject(client, projectId);
  if (flowsLoadErr) {
    return { ...empty(), error: `Failed to load flows: ${flowsLoadErr}` };
  }

  console.log(`${LOG_PREFIX} analytics: ${allFlows.length} flow(s) for project; per-day metrics use sender_profiles + flows filter only`);

  for (const day of range) {
    if (collectedSet.has(day)) {
      daysSkippedAlreadyCollected.push(day);
      continue;
    }

    const bounds = dayBoundsUtc(day);
    if (!bounds) {
      errors.push(`${day}: invalid day`);
      continue;
    }

    const dayEligible = allFlows.filter((f) => {
      const createdDay = f.created_at.slice(0, 10);
      return createdDay <= day;
    });

    const combined: Array<{
      group_by: string;
      group_uuid: string | null;
      metrics: Record<string, unknown>;
      flow_uuid?: string | null;
    }> = [];

    for (let fi = 0; fi < dayEligible.length; fi++) {
      const flow = dayEligible[fi];
      await fetchLog(`analytics: day ${day} flow ${fi + 1}/${dayEligible.length} (${flow.uuid})`, {});

      const sendersRes = await fetchLeadsMetricsForRange(
        {
          fromIso: bounds.fromIso,
          toIso: bounds.toIso,
          groupBy: "sender_profiles",
          flows: [flow.uuid],
        },
        credentials,
        fetchLog
      );

      if (sendersRes.error) {
        const logPayload = buildSourceApiFetchErrorLog(sendersRes.error, sendersRes.errorDetail, {
          day,
          flowUuid: flow.uuid,
        });
        console.error(`${LOG_PREFIX} analytics metrics POST failed`, logPayload);
        errors.push(`${day} flow ${flow.uuid}: ${sendersRes.error}\n${JSON.stringify(logPayload, null, 2)}`);
      } else {
        flowsProcessed += 1;
        for (const r of sendersRes.rows) {
          combined.push({
            group_by: "sender_profiles",
            group_uuid: r.group_uuid,
            metrics: r.metrics,
            flow_uuid: flow.uuid,
          });
        }
      }

      await sleep(METRICS_REQUEST_DELAY_MS);
    }

    const { error: repErr } = await replaceAnalyticsSnapshotsForDay(client, projectId, day, combined);
    if (repErr) {
      errors.push(`${day} store: ${repErr}`);
      continue;
    }

    daysSynced.push(day);
    rowsInserted += combined.length;
    collectedSet.add(day);
    console.log(`${LOG_PREFIX} analytics: stored day ${day} (${combined.length} row(s), ${dayEligible.length} flow(s) eligible)`);
  }

  console.log(`${LOG_PREFIX} analytics sync finished`, {
    daysSynced: daysSynced.length,
    flowsProcessed,
    rowsInserted,
    errors: errors.length,
  });

  return {
    daysRequested,
    daysSkippedAlreadyCollected,
    daysSynced,
    rowsInserted,
    flowsProcessed,
    errors,
    error: null,
  };
}
