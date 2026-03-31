/**
 * Incremental sync: for each table we take the latest created_at in Supabase, then fetch from
 * the source API (newest first) until we reach that row, and upsert only the new rows.
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
  COMPANIES_TABLE,
  createSyncRun,
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
  fetchCompaniesIncremental,
  fetchLeadsMetricsForRange,
  dayBoundsUtc,
  enumerateDatesInclusive,
  type ApiCredentials,
  type FetchLogger,
} from "./source-api.js";
import { syncEventBus } from "./sync-event-bus.js";

const CHUNK_SIZE = 100;
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
    const entry = {
      kind,
      level,
      message,
      table_name: extra?.table_name ?? null,
      row_count: extra?.row_count ?? null,
      data: extra?.data ?? null,
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
      toConsole(msg, data);
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

export interface SyncResult {
  companies: { fetched: number; upserted: number; error: string | null };
  contacts: { fetched: number; upserted: number; error: string | null };
  linkedin_messages: { fetched: number; upserted: number; error: string | null };
  senders: { fetched: number; upserted: number; error: string | null };
  contact_lists: { fetched: number; upserted: number; error: string | null };
  flows: { fetched: number; upserted: number; error: string | null };
  flow_leads: { fetched: number; upserted: number; error: string | null };
  error: string | null;
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

export async function syncSupabaseFromSource(projectId?: string, existingRunId?: string): Promise<SyncResult> {
  const client = getSupabase();
  const result: SyncResult = {
    companies: { fetched: 0, upserted: 0, error: null },
    contacts: { fetched: 0, upserted: 0, error: null },
    linkedin_messages: { fetched: 0, upserted: 0, error: null },
    senders: { fetched: 0, upserted: 0, error: null },
    contact_lists: { fetched: 0, upserted: 0, error: null },
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

  await logger.log("sync started", { projectId: projectId ?? "none" });

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
    flowsLatestUpdated,
    flowLeadsLatest,
  ] = await Promise.all([
    latestUpdatedAt(client, COMPANIES_TABLE, null),
    latestCreatedAt(client, CONTACTS_TABLE, projectId),
    latestCreatedAt(client, LINKEDIN_MESSAGES_TABLE, projectId),
    latestCreatedAt(client, SENDERS_TABLE, projectId),
    latestUpdatedAt(client, CONTACT_LISTS_TABLE, projectId),
    latestUpdatedAt(client, FLOWS_TABLE, projectId),
    latestCreatedAt(client, FLOW_LEADS_TABLE, projectId),
  ]);
  await logger.log("cursors resolved", {
    companiesSinceUpdated: companiesLatest ?? "null",
    contactsSince: contactsLatest ?? "null",
    messagesSince: messagesLatest ?? "null",
    sendersSince: sendersLatest ?? "null",
    contactListsSinceUpdated: contactListsLatestUpdated ?? "null",
    flowsSinceUpdated: flowsLatestUpdated ?? "null",
    flowLeadsSince: flowLeadsLatest ?? "null",
  });

  const fetchLog: FetchLogger = (msg, data) => logger.log(msg, data);

  // --- Companies (incremental, global — no project_id) ---
  await logger.log("companies: fetching from source");
  const companiesRes = await fetchCompaniesIncremental(companiesLatest, credentials, fetchLog);
  result.companies.fetched = companiesRes.data.length;
  if (companiesRes.error) {
    result.companies.error = companiesRes.error;
    await logger.logError("companies: fetch error", { error: companiesRes.error, since: companiesLatest ?? "full" });
  } else {
    await logger.log("companies: fetched", { count: result.companies.fetched });
    const mappedCompanies = companiesRes.data.map(mapCompanyForSupabase);
    const companyChunkCount = Math.ceil(mappedCompanies.length / CHUNK_SIZE);
    let companyErrors: string[] = [];
    for (let i = 0; i < mappedCompanies.length; i += CHUNK_SIZE) {
      const chunkIdx = Math.floor(i / CHUNK_SIZE) + 1;
      const chunk = mappedCompanies.slice(i, i + CHUNK_SIZE);
      const upsertResult = await upsertChunk(client, COMPANIES_TABLE, chunk, "id");
      result.companies.upserted += upsertResult.inserted;
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
        const errMsg = upsertResult.error + (upsertResult.error.includes("row-level security") ? rlsHint : "");
        companyErrors.push(`chunk ${chunkIdx}/${companyChunkCount}: ${errMsg}`);
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
            id: f.row.id as string ?? null,
            name: f.row.name as string ?? null,
            created_at: f.row.created_at as string ?? null,
          });
        }
        continue;
      }
    }
    if (companyErrors.length > 0) {
      result.companies.error = `${companyErrors.length} chunk(s) failed: ${companyErrors.join("; ")}`;
    }
    await logger.log("companies: upserted", { count: result.companies.upserted });
  }

  // --- Contacts (incremental: only rows with created_at > contactsLatest) ---
  await logger.log("contacts: fetching from source");
  const contactsRes = await fetchContactsIncremental(contactsLatest, credentials, fetchLog);
  result.contacts.fetched = contactsRes.data.length;
  if (contactsRes.error) {
    result.contacts.error = contactsRes.error;
    await logger.logError("contacts: fetch error", { error: contactsRes.error, since: contactsLatest ?? "full" });
  } else {
    await logger.log("contacts: fetched", { count: result.contacts.fetched });
    const mappedContacts = contactsRes.data.map(mapContactForSupabase);
    if (projectId) injectProjectId(mappedContacts, projectId);
    const contactChunkCount = Math.ceil(mappedContacts.length / CHUNK_SIZE);
    let contactErrors: string[] = [];
    for (let i = 0; i < mappedContacts.length; i += CHUNK_SIZE) {
      const chunkIdx = Math.floor(i / CHUNK_SIZE) + 1;
      const chunk = mappedContacts.slice(i, i + CHUNK_SIZE);
      const upsertResult = await upsertChunk(client, CONTACTS_TABLE, chunk, "uuid");
      result.contacts.upserted += upsertResult.inserted;
      if (upsertResult.inserted > 0) {
        await logger.logUpsert(CONTACTS_TABLE, upsertResult.inserted);
      }
      if (upsertResult.error) {
        const errMsg = upsertResult.error + (upsertResult.error.includes("row-level security") ? rlsHint : "");
        contactErrors.push(`chunk ${chunkIdx}/${contactChunkCount}: ${errMsg}`);
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
            uuid: f.row.uuid as string ?? null,
            name: f.row.name as string ?? null,
            created_at: f.row.created_at as string ?? null,
            project_id: f.row.project_id as string ?? null,
            company_uuid: f.row.company_uuid as string ?? null,
            rowKeys: Object.keys(f.row),
          });
        }
        continue;
      }
    }
    if (contactErrors.length > 0) {
      result.contacts.error = `${contactErrors.length} chunk(s) failed: ${contactErrors.join("; ")}`;
    }
    await logger.log("contacts: upserted", { count: result.contacts.upserted });
  }

  // --- LinkedIn Messages (incremental) ---
  await logger.log("linkedin_messages: fetching from source");
  const messagesRes = await fetchLinkedInMessagesIncremental(messagesLatest, credentials, fetchLog);
  result.linkedin_messages.fetched = messagesRes.data.length;
  if (messagesRes.error) {
    result.linkedin_messages.error = messagesRes.error;
    await logger.logError("linkedin_messages: fetch error", { error: messagesRes.error, since: messagesLatest ?? "full" });
  } else {
    await logger.log("linkedin_messages: fetched", { count: result.linkedin_messages.fetched });
    const mapped = messagesRes.data.map(mapMessageForSupabase);
    if (projectId) injectProjectId(mapped, projectId);
    const msgChunkCount = Math.ceil(mapped.length / CHUNK_SIZE);
    let msgErrors: string[] = [];
    for (let i = 0; i < mapped.length; i += CHUNK_SIZE) {
      const chunkIdx = Math.floor(i / CHUNK_SIZE) + 1;
      const chunk = mapped.slice(i, i + CHUNK_SIZE);
      const upsertResult = await upsertChunk(
        client,
        LINKEDIN_MESSAGES_TABLE,
        chunk,
        "uuid"
      );
      result.linkedin_messages.upserted += upsertResult.inserted;
      if (upsertResult.inserted > 0) {
        await logger.logUpsert(LINKEDIN_MESSAGES_TABLE, upsertResult.inserted);
      }
      if (upsertResult.error) {
        const errMsg =
          upsertResult.error +
          (upsertResult.error.includes("sender_id")
            ? " (LinkedinMessages table may use sender_profile_uuid; sync sends API columns as-is.)"
            : "");
        msgErrors.push(`chunk ${chunkIdx}/${msgChunkCount}: ${errMsg}`);
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
            uuid: f.row.uuid as string ?? null,
            lead_uuid: f.row.lead_uuid as string ?? null,
            sender_profile_uuid: f.row.sender_profile_uuid as string ?? null,
            created_at: f.row.created_at as string ?? null,
            project_id: f.row.project_id as string ?? null,
            channel: f.row.channel as string ?? null,
          });
        }
        continue;
      }
    }
    if (msgErrors.length > 0) {
      result.linkedin_messages.error = `${msgErrors.length} chunk(s) failed: ${msgErrors.join("; ")}`;
    }
    await logger.log("linkedin_messages: upserted", { count: result.linkedin_messages.upserted });
  }

  // --- Senders (incremental) ---
  await logger.log("senders: fetching from source");
  const sendersRes = await fetchSendersIncremental(sendersLatest, credentials, fetchLog);
  result.senders.fetched = sendersRes.data.length;
  if (sendersRes.error) {
    result.senders.error = sendersRes.error;
    await logger.logError("senders: fetch error", { error: sendersRes.error, since: sendersLatest ?? "full" });
  } else {
    await logger.log("senders: fetched", { count: result.senders.fetched });
    const mappedSenders = sendersRes.data.map(mapSenderForSupabase);
    if (projectId) injectProjectId(mappedSenders, projectId);
    const senderChunkCount = Math.ceil(mappedSenders.length / CHUNK_SIZE);
    let senderErrors: string[] = [];
    for (let i = 0; i < mappedSenders.length; i += CHUNK_SIZE) {
      const chunkIdx = Math.floor(i / CHUNK_SIZE) + 1;
      const chunk = mappedSenders.slice(i, i + CHUNK_SIZE);
      const upsertResult = await upsertChunk(client, SENDERS_TABLE, chunk, "uuid");
      result.senders.upserted += upsertResult.inserted;
      if (upsertResult.inserted > 0) {
        await logger.logUpsert(SENDERS_TABLE, upsertResult.inserted);
      }
      if (upsertResult.error) {
        const errMsg = upsertResult.error + (upsertResult.error.includes("row-level security") ? rlsHint : "");
        senderErrors.push(`chunk ${chunkIdx}/${senderChunkCount}: ${errMsg}`);
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
            uuid: f.row.uuid as string ?? null,
            first_name: f.row.first_name as string ?? null,
            last_name: f.row.last_name as string ?? null,
            created_at: f.row.created_at as string ?? null,
            project_id: f.row.project_id as string ?? null,
          });
        }
        continue;
      }
    }
    if (senderErrors.length > 0) {
      result.senders.error = `${senderErrors.length} chunk(s) failed: ${senderErrors.join("; ")}`;
    }
    await logger.log("senders: upserted", { count: result.senders.upserted });
  }

  // --- Contact lists (GET /leads/api/lists, incremental by updated_at) ---
  await logger.log("contact_lists: fetching from source");
  const contactListsRes = await fetchContactListsIncremental(contactListsLatestUpdated, credentials, fetchLog);
  result.contact_lists.fetched = contactListsRes.data.length;
  if (contactListsRes.error) {
    result.contact_lists.error = contactListsRes.error;
    await logger.logError("contact_lists: fetch error", {
      error: contactListsRes.error,
      sinceUpdated: contactListsLatestUpdated ?? "full",
    });
  } else {
    await logger.log("contact_lists: fetched", { count: result.contact_lists.fetched });
    const mappedLists = contactListsRes.data.map(mapContactListForSupabase);
    if (projectId) injectProjectId(mappedLists, projectId);
    const listsChunkCount = Math.ceil(mappedLists.length / CHUNK_SIZE);
    let listsErrors: string[] = [];
    for (let i = 0; i < mappedLists.length; i += CHUNK_SIZE) {
      const chunkIdx = Math.floor(i / CHUNK_SIZE) + 1;
      const chunk = mappedLists.slice(i, i + CHUNK_SIZE);
      const upsertResult = await upsertChunk(client, CONTACT_LISTS_TABLE, chunk, "uuid");
      result.contact_lists.upserted += upsertResult.inserted;
      if (upsertResult.inserted > 0) {
        await logger.logUpsert(CONTACT_LISTS_TABLE, upsertResult.inserted);
      }
      if (upsertResult.error) {
        const errMsg = upsertResult.error + (upsertResult.error.includes("row-level security") ? rlsHint : "");
        listsErrors.push(`chunk ${chunkIdx}/${listsChunkCount}: ${errMsg}`);
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
            uuid: f.row.uuid as string ?? null,
            name: f.row.name as string ?? null,
            updated_at: f.row.updated_at as string ?? null,
            project_id: f.row.project_id as string ?? null,
          });
        }
        continue;
      }
    }
    if (listsErrors.length > 0) {
      result.contact_lists.error = `${listsErrors.length} chunk(s) failed: ${listsErrors.join("; ")}`;
    }
    await logger.log("contact_lists: upserted", { count: result.contact_lists.upserted });
  }

  // --- Flows (incremental by updated_at) ---
  await logger.log("flows: fetching from source");
  const flowsRes = await fetchFlowsIncremental(flowsLatestUpdated, credentials, fetchLog);
  result.flows.fetched = flowsRes.data.length;
  if (flowsRes.error) {
    result.flows.error = flowsRes.error;
    await logger.logError("flows: fetch error", { error: flowsRes.error, sinceUpdated: flowsLatestUpdated ?? "full" });
  } else {
    await logger.log("flows: fetched", { count: result.flows.fetched });
    const mappedFlows = flowsRes.data.map(mapFlowForSupabase);
    if (projectId) injectProjectId(mappedFlows, projectId);
    const flowsChunkCount = Math.ceil(mappedFlows.length / CHUNK_SIZE);
    let flowsErrors: string[] = [];
    for (let i = 0; i < mappedFlows.length; i += CHUNK_SIZE) {
      const chunkIdx = Math.floor(i / CHUNK_SIZE) + 1;
      const chunk = mappedFlows.slice(i, i + CHUNK_SIZE);
      const upsertResult = await upsertChunk(client, FLOWS_TABLE, chunk, "uuid");
      result.flows.upserted += upsertResult.inserted;
      if (upsertResult.inserted > 0) {
        await logger.logUpsert(FLOWS_TABLE, upsertResult.inserted);
      }
      if (upsertResult.error) {
        const errMsg = upsertResult.error + (upsertResult.error.includes("row-level security") ? rlsHint : "");
        flowsErrors.push(`chunk ${chunkIdx}/${flowsChunkCount}: ${errMsg}`);
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
            uuid: f.row.uuid as string ?? null,
            name: f.row.name as string ?? null,
            updated_at: f.row.updated_at as string ?? null,
            project_id: f.row.project_id as string ?? null,
          });
        }
        continue;
      }
    }
    if (flowsErrors.length > 0) {
      result.flows.error = `${flowsErrors.length} chunk(s) failed: ${flowsErrors.join("; ")}`;
    }
    await logger.log("flows: upserted", { count: result.flows.upserted });
  }

  // --- Flow leads (incremental by created_at) ---
  await logger.log("flow_leads: fetching from source");
  const flowLeadsRes = await fetchFlowLeadsIncremental(flowLeadsLatest, credentials, fetchLog);
  result.flow_leads.fetched = flowLeadsRes.data.length;
  if (flowLeadsRes.error) {
    result.flow_leads.error = flowLeadsRes.error;
    await logger.logError("flow_leads: fetch error", { error: flowLeadsRes.error, since: flowLeadsLatest ?? "full" });
  } else {
    await logger.log("flow_leads: fetched", { count: result.flow_leads.fetched });
    const mappedFlowLeads = flowLeadsRes.data.map(mapFlowLeadForSupabase);
    if (projectId) injectProjectId(mappedFlowLeads, projectId);
    const flChunkCount = Math.ceil(mappedFlowLeads.length / CHUNK_SIZE);
    let flErrors: string[] = [];
    for (let i = 0; i < mappedFlowLeads.length; i += CHUNK_SIZE) {
      const chunkIdx = Math.floor(i / CHUNK_SIZE) + 1;
      const chunk = mappedFlowLeads.slice(i, i + CHUNK_SIZE);
      const upsertResult = await upsertChunk(client, FLOW_LEADS_TABLE, chunk, "uuid");
      result.flow_leads.upserted += upsertResult.inserted;
      if (upsertResult.inserted > 0) {
        await logger.logUpsert(FLOW_LEADS_TABLE, upsertResult.inserted);
      }
      if (upsertResult.error) {
        const errMsg = upsertResult.error + (upsertResult.error.includes("row-level security") ? rlsHint : "");
        flErrors.push(`chunk ${chunkIdx}/${flChunkCount}: ${errMsg}`);
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
            uuid: f.row.uuid as string ?? null,
            flow_uuid: f.row.flow_uuid as string ?? null,
            lead_uuid: f.row.lead_uuid as string ?? null,
            created_at: f.row.created_at as string ?? null,
            project_id: f.row.project_id as string ?? null,
          });
        }
        continue;
      }
    }
    if (flErrors.length > 0) {
      result.flow_leads.error = `${flErrors.length} chunk(s) failed: ${flErrors.join("; ")}`;
    }
    await logger.log("flow_leads: upserted", { count: result.flow_leads.upserted });
  }

  const hasError =
    result.error != null ||
    result.companies.error != null ||
    result.contacts.error != null ||
    result.linkedin_messages.error != null ||
    result.senders.error != null ||
    result.contact_lists.error != null ||
    result.flows.error != null ||
    result.flow_leads.error != null;
  const status: SyncRunStatus = result.error != null ? "error" : hasError ? "partial" : "success";
  await logger.log("sync finished", {
    ok: !hasError,
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
      error: result.error ?? null,
    });
    syncEventBus.emitComplete(runId, result as unknown as Record<string, unknown>);
  }
  return result;
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
        errors.push(`${day} flow ${flow.uuid}: ${sendersRes.error}`);
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
