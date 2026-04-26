import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getDecryptedIntegrationSecret,
  getProjectById,
  PIPEDRIVE_DEAL_FIELDS_TABLE,
  PIPEDRIVE_DEALS_TABLE,
  PIPEDRIVE_RELATED_OBJECTS_TABLE,
} from "./supabase.js";

const DEFAULT_PIPEDRIVE_BASE_URL = "https://api.pipedrive.com/v1";
const PAGE_LIMIT = 500;
const DEAL_FIELDS_PAGE_LIMIT = 100;
const UPSERT_CHUNK_SIZE = 200;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_FETCH_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_000;

interface PipedrivePagination {
  more_items_in_collection?: boolean;
  next_start?: number;
}

interface PipedriveDealsResponse {
  success?: boolean;
  data?: unknown[];
  additional_data?: {
    pagination?: PipedrivePagination;
  };
  related_objects?: Record<string, Record<string, unknown>>;
}

interface PipedriveListResponse {
  success?: boolean;
  data?: unknown[];
  additional_data?: {
    pagination?: PipedrivePagination;
  };
  related_objects?: Record<string, Record<string, unknown>>;
}

interface PipedriveDealField {
  id?: number | string;
  key?: string;
  name?: string;
}

export interface PipedriveDealsSyncResult {
  ok: boolean;
  projectId: string;
  dealCount: number;
  upserted: number;
  dealFieldCount: number;
  dealFieldsUpserted: number;
  relatedObjectCount: number;
  relatedObjectsUpserted: number;
  pageCount: number;
  syncedAt: string;
}

function secretString(payload: Record<string, unknown> | null, ...keys: string[]): string | null {
  if (!payload) return null;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function normalizeBaseUrl(raw: string | null): string {
  return (raw || DEFAULT_PIPEDRIVE_BASE_URL).replace(/\/$/, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

function shouldRetryStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function fetchWithTimeout(url: URL): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function loadPipedriveCredentials(
  client: SupabaseClient,
  projectId: string
): Promise<{ apiToken: string; baseUrl: string }> {
  const { data: project, error: projectError } = await getProjectById(client, projectId);
  if (projectError) throw new Error(`Failed to load project: ${projectError}`);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  const { data: secret, error } = await getDecryptedIntegrationSecret(client, projectId, "pipedrive");
  if (error) throw new Error(`Failed to load Pipedrive credentials: ${error}`);
  const apiToken = secretString(secret, "api_token", "apiToken");
  const baseUrl = normalizeBaseUrl(secretString(secret, "api_base_url", "apiBaseUrl", "base_url", "baseUrl"));
  if (!apiToken) throw new Error("Pipedrive API token is not configured for this project");
  return { apiToken, baseUrl };
}

async function fetchPipedriveListPage(
  baseUrl: string,
  apiToken: string,
  path: string,
  limit: number,
  start: number
): Promise<PipedriveListResponse> {
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set("api_token", apiToken);
  url.searchParams.set("start", String(start));
  url.searchParams.set("limit", String(limit));
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    let res: Response;
    try {
      res = await fetchWithTimeout(url);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (attempt < MAX_FETCH_ATTEMPTS) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
      throw new Error(`Pipedrive ${path} request failed after ${attempt} attempts: ${lastError}`);
    }
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const suffix = text ? `: ${text.slice(0, 1000)}` : "";
      const message = `Pipedrive ${path} request failed (${res.status} ${res.statusText})${suffix}`;
      if (attempt < MAX_FETCH_ATTEMPTS && shouldRetryStatus(res.status)) {
        await sleep(retryAfterMs(res) ?? RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
      throw new Error(message);
    }
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Pipedrive ${path} response is not a JSON object`);
    }
    const body = parsed as PipedriveListResponse;
    if (body.success === false) throw new Error(`Pipedrive ${path} response success=false: ${text.slice(0, 1000)}`);
    if (!Array.isArray(body.data)) throw new Error(`Pipedrive ${path} response data is not an array`);
    return body;
  }
  throw new Error(`Pipedrive ${path} request failed after ${MAX_FETCH_ATTEMPTS} attempts: ${lastError ?? "unknown error"}`);
}

async function fetchPipedriveDealsPage(
  baseUrl: string,
  apiToken: string,
  start: number
): Promise<PipedriveDealsResponse> {
  return fetchPipedriveListPage(baseUrl, apiToken, "/deals", PAGE_LIMIT, start) as Promise<PipedriveDealsResponse>;
}

async function fetchAllPipedriveDealFields(
  baseUrl: string,
  apiToken: string
): Promise<unknown[]> {
  const fields: unknown[] = [];
  let start = 0;
  for (;;) {
    const page = await fetchPipedriveListPage(baseUrl, apiToken, "/dealFields", DEAL_FIELDS_PAGE_LIMIT, start);
    fields.push(...(page.data ?? []));
    const pagination = page.additional_data?.pagination;
    if (!pagination?.more_items_in_collection) break;
    if (typeof pagination.next_start !== "number") {
      throw new Error("Pipedrive dealFields pagination says more pages exist but next_start is missing");
    }
    start = pagination.next_start;
  }
  return fields;
}

async function fetchAllPipedriveDeals(
  baseUrl: string,
  apiToken: string
): Promise<{ deals: unknown[]; relatedObjects: RelatedObjectInput[]; pageCount: number }> {
  const deals: unknown[] = [];
  const relatedObjects: RelatedObjectInput[] = [];
  let pageCount = 0;
  let start = 0;
  for (;;) {
    const page = await fetchPipedriveDealsPage(baseUrl, apiToken, start);
    pageCount += 1;
    deals.push(...(page.data ?? []));
    relatedObjects.push(...extractRelatedObjects(page.related_objects));
    const pagination = page.additional_data?.pagination;
    if (!pagination?.more_items_in_collection) break;
    if (typeof pagination.next_start !== "number") {
      throw new Error("Pipedrive pagination says more pages exist but next_start is missing");
    }
    start = pagination.next_start;
  }
  return { deals, relatedObjects, pageCount };
}

interface RelatedObjectInput {
  objectType: string;
  objectId: string;
  payload: unknown;
}

function extractRelatedObjects(relatedObjects: PipedriveDealsResponse["related_objects"]): RelatedObjectInput[] {
  if (!relatedObjects || typeof relatedObjects !== "object") return [];
  const rows: RelatedObjectInput[] = [];
  for (const [objectType, byId] of Object.entries(relatedObjects)) {
    if (!byId || typeof byId !== "object" || Array.isArray(byId)) continue;
    for (const [objectId, payload] of Object.entries(byId)) {
      rows.push({ objectType, objectId, payload });
    }
  }
  return rows;
}

function dealFieldKey(field: unknown): string | null {
  if (field == null || typeof field !== "object" || Array.isArray(field)) return null;
  const key = (field as PipedriveDealField).key;
  return typeof key === "string" && key.trim().length > 0 ? key.trim() : null;
}

function dealFieldName(field: unknown): string | null {
  if (field == null || typeof field !== "object" || Array.isArray(field)) return null;
  const name = (field as PipedriveDealField).name;
  return typeof name === "string" && name.trim().length > 0 ? name.trim() : null;
}

function dealFieldId(field: unknown): number | null {
  if (field == null || typeof field !== "object" || Array.isArray(field)) return null;
  const raw = (field as PipedriveDealField).id;
  const id = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isInteger(id) ? id : null;
}

function buildDealFieldNameMap(fields: unknown[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const field of fields) {
    const key = dealFieldKey(field);
    const name = dealFieldName(field);
    if (key && name) map.set(key, name);
  }
  return map;
}

function mapDealCustomFields(deal: Record<string, unknown>, fieldNameByKey: Map<string, string>): Record<string, unknown> {
  const customFields: Record<string, unknown> = {};
  for (const [key, name] of fieldNameByKey.entries()) {
    if (Object.prototype.hasOwnProperty.call(deal, key)) {
      customFields[name] = deal[key];
    }
  }
  return customFields;
}

function mapDealForSupabase(
  projectId: string,
  deal: unknown,
  syncedAt: string,
  fieldNameByKey: Map<string, string>
): Record<string, unknown> {
  if (deal == null || typeof deal !== "object" || Array.isArray(deal)) {
    throw new Error("Pipedrive deal row is not an object");
  }
  const dealRow = deal as Record<string, unknown>;
  const rawId = dealRow.id;
  const id = typeof rawId === "number" ? rawId : typeof rawId === "string" ? Number(rawId) : NaN;
  if (!Number.isInteger(id)) throw new Error("Pipedrive deal row has invalid id");
  return {
    project_id: projectId,
    pipedrive_deal_id: id,
    synced_at: syncedAt,
    updated_at: syncedAt,
    custom_fields: mapDealCustomFields(dealRow, fieldNameByKey),
    payload: deal,
  };
}

function mapDealFieldForSupabase(projectId: string, field: unknown, syncedAt: string): Record<string, unknown> {
  const key = dealFieldKey(field);
  if (!key) throw new Error("Pipedrive deal field row has invalid key");
  return {
    project_id: projectId,
    pipedrive_field_id: dealFieldId(field),
    field_key: key,
    name: dealFieldName(field),
    synced_at: syncedAt,
    updated_at: syncedAt,
    payload: field,
  };
}

async function upsertPipedriveDealFields(
  client: SupabaseClient,
  projectId: string,
  fields: unknown[],
  syncedAt: string
): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < fields.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = fields.slice(i, i + UPSERT_CHUNK_SIZE).map((field) => mapDealFieldForSupabase(projectId, field, syncedAt));
    const { error } = await client
      .from(PIPEDRIVE_DEAL_FIELDS_TABLE)
      .upsert(chunk, { onConflict: "project_id,field_key" });
    if (error) throw new Error(`Failed to upsert Pipedrive deal fields: ${error.message}`);
    upserted += chunk.length;
  }
  return upserted;
}

async function upsertPipedriveDeals(
  client: SupabaseClient,
  projectId: string,
  deals: unknown[],
  syncedAt: string,
  fieldNameByKey: Map<string, string>
): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < deals.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = deals.slice(i, i + UPSERT_CHUNK_SIZE).map((deal) => mapDealForSupabase(projectId, deal, syncedAt, fieldNameByKey));
    const { error } = await client
      .from(PIPEDRIVE_DEALS_TABLE)
      .upsert(chunk, { onConflict: "project_id,pipedrive_deal_id" });
    if (error) throw new Error(`Failed to upsert Pipedrive deals: ${error.message}`);
    upserted += chunk.length;
  }
  return upserted;
}

function mapRelatedObjectForSupabase(
  projectId: string,
  relatedObject: RelatedObjectInput,
  syncedAt: string
): Record<string, unknown> {
  return {
    project_id: projectId,
    object_type: relatedObject.objectType,
    pipedrive_object_id: relatedObject.objectId,
    synced_at: syncedAt,
    updated_at: syncedAt,
    payload: relatedObject.payload,
  };
}

async function upsertPipedriveRelatedObjects(
  client: SupabaseClient,
  projectId: string,
  relatedObjects: RelatedObjectInput[],
  syncedAt: string
): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < relatedObjects.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = relatedObjects
      .slice(i, i + UPSERT_CHUNK_SIZE)
      .map((relatedObject) => mapRelatedObjectForSupabase(projectId, relatedObject, syncedAt));
    const { error } = await client
      .from(PIPEDRIVE_RELATED_OBJECTS_TABLE)
      .upsert(chunk, { onConflict: "project_id,object_type,pipedrive_object_id" });
    if (error) throw new Error(`Failed to upsert Pipedrive related objects: ${error.message}`);
    upserted += chunk.length;
  }
  return upserted;
}

export async function syncPipedriveDeals(
  client: SupabaseClient,
  projectId: string
): Promise<PipedriveDealsSyncResult> {
  const syncedAt = new Date().toISOString();
  const { apiToken, baseUrl } = await loadPipedriveCredentials(client, projectId);
  const dealFields = await fetchAllPipedriveDealFields(baseUrl, apiToken);
  const fieldNameByKey = buildDealFieldNameMap(dealFields);
  const dealFieldsUpserted = await upsertPipedriveDealFields(client, projectId, dealFields, syncedAt);
  const { deals, relatedObjects, pageCount } = await fetchAllPipedriveDeals(baseUrl, apiToken);
  const upserted = await upsertPipedriveDeals(client, projectId, deals, syncedAt, fieldNameByKey);
  const relatedObjectsUpserted = await upsertPipedriveRelatedObjects(
    client,
    projectId,
    relatedObjects,
    syncedAt
  );
  return {
    ok: true,
    projectId,
    dealCount: deals.length,
    upserted,
    dealFieldCount: dealFields.length,
    dealFieldsUpserted,
    relatedObjectCount: relatedObjects.length,
    relatedObjectsUpserted,
    pageCount,
    syncedAt,
  };
}
