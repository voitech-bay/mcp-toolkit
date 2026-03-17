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
  getProjectById,
  getActiveSyncRun,
  CONTACTS_TABLE,
  LINKEDIN_MESSAGES_TABLE,
  SENDERS_TABLE,
  getCompanyIdsByDomains,
  ensureCompanies,
  createSyncRun,
  updateSyncRun,
  insertSyncLogEntry,
  type SyncRunStatus,
} from "./supabase.js";
import {
  CONTACTS_COLUMNS,
  CONTACTS_BACKFILLED_COLUMNS,
  LINKEDIN_MESSAGES_COLUMNS,
  LINKEDIN_MESSAGES_SYNC_OMIT_UNLESS_IN_API,
  SENDERS_COLUMNS,
  pickColumns,
} from "./supabase-schema.js";
import {
  fetchContactsIncremental,
  fetchLinkedInMessagesIncremental,
  fetchSendersIncremental,
  type ApiCredentials,
  type FetchLogger,
} from "./source-api.js";
import { syncEventBus } from "./sync-event-bus.js";

const CHUNK_SIZE = 100;
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

/** Normalize domain: lowercase, trim. Return null if empty or invalid. */
function normalizeDomain(domain: unknown): string | null {
  if (domain == null) return null;
  const s = typeof domain === "string" ? domain.trim().toLowerCase() : String(domain).trim().toLowerCase();
  return s.length > 0 ? s : null;
}

/** Derive domain from contact: work_email_domain, or from work_email (part after @). */
function contactDomain(contact: Record<string, unknown>): string | null {
  const fromDomain = normalizeDomain(contact.work_email_domain);
  if (fromDomain) return fromDomain;
  const email = contact.work_email;
  if (typeof email !== "string" || !email.includes("@")) return null;
  const after = email.split("@")[1];
  return normalizeDomain(after ?? "");
}

/**
 * Resolve company_id for each contact: ensure a company row exists per unique domain
 * (from work_email_domain or work_email), then set contact.company_id. Mutates rows in place.
 */
async function resolveContactCompanyIds(
  client: SupabaseClient,
  contacts: Record<string, unknown>[],
  logger: SyncLogger
): Promise<{ error: string | null }> {
  const domainToMeta = new Map<string, { name?: string }>();
  for (const c of contacts) {
    const domain = contactDomain(c);
    if (!domain) continue;
    if (!domainToMeta.has(domain)) {
      domainToMeta.set(domain, {
        name: typeof c.company_name === "string" ? c.company_name : undefined,
      });
    }
  }
  const domains = [...domainToMeta.keys()];
  if (domains.length === 0) return { error: null };

  const { map: existing, error: getErr } = await getCompanyIdsByDomains(client, domains);
  if (getErr) return { error: getErr };

  const missing = domains.filter((d) => !existing[d]);
  if (missing.length > 0) {
    await logger.log("companies: ensuring", { count: missing.length, domains: missing.slice(0, 10) });
    const toInsert = missing.map((d) => ({
      domain: d,
      name: domainToMeta.get(d)?.name ?? d,
      linkedin_url: null,
    }));
    const { map: inserted, error: ensureErr } = await ensureCompanies(client, toInsert);
    if (ensureErr) return { error: ensureErr };
    for (const [d, id] of Object.entries(inserted)) existing[d] = id;
  }

  for (const c of contacts) {
    const domain = contactDomain(c);
    const id = domain ? existing[domain] : null;
    if (id) c.company_id = id;
  }
  return { error: null };
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
  contacts: { fetched: number; upserted: number; error: string | null };
  linkedin_messages: { fetched: number; upserted: number; error: string | null };
  senders: { fetched: number; upserted: number; error: string | null };
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

export async function syncSupabaseFromSource(projectId?: string, existingRunId?: string): Promise<SyncResult> {
  const client = getSupabase();
  const result: SyncResult = {
    contacts: { fetched: 0, upserted: 0, error: null },
    linkedin_messages: { fetched: 0, upserted: 0, error: null },
    senders: { fetched: 0, upserted: 0, error: null },
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

  // Resolve latest created_at per table, filtered by project_id so each project syncs independently
  const [contactsLatest, messagesLatest, sendersLatest] = await Promise.all([
    latestCreatedAt(client, CONTACTS_TABLE, projectId),
    latestCreatedAt(client, LINKEDIN_MESSAGES_TABLE, projectId),
    latestCreatedAt(client, SENDERS_TABLE, projectId),
  ]);
  await logger.log("cursors resolved", {
    contactsSince: contactsLatest ?? "null",
    messagesSince: messagesLatest ?? "null",
    sendersSince: sendersLatest ?? "null",
  });

  // --- Contacts (incremental: only rows with created_at > contactsLatest) ---
  await logger.log("contacts: fetching from source");
  const fetchLog: FetchLogger = (msg, data) => logger.log(msg, data);
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
      const resolveResult = await resolveContactCompanyIds(client, chunk, logger);
      if (resolveResult.error) {
        contactErrors.push(`chunk ${chunkIdx}: company_id resolve failed: ${resolveResult.error}`);
        await logger.logError("contacts: resolve company_id error", {
          error: resolveResult.error,
          chunkIndex: chunkIdx,
          totalChunks: contactChunkCount,
          chunkSize: chunk.length,
        });
        continue;
      }
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
            company_id: f.row.company_id as string ?? null,
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

  const hasError =
    result.error != null ||
    result.contacts.error != null ||
    result.linkedin_messages.error != null ||
    result.senders.error != null;
  const status: SyncRunStatus = result.error != null ? "error" : hasError ? "partial" : "success";
  await logger.log("sync finished", {
    ok: !hasError,
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
