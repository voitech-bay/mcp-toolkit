import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getDecryptedIntegrationSecret,
  getProjectById,
  PIPEDRIVE_DEALS_TABLE,
  PIPEDRIVE_RELATED_OBJECTS_TABLE,
} from "./supabase.js";

const DEFAULT_PIPEDRIVE_BASE_URL = "https://api.pipedrive.com/v1";
const PAGE_LIMIT = 500;
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

export interface PipedriveDealsSyncResult {
  ok: boolean;
  projectId: string;
  dealCount: number;
  upserted: number;
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

async function fetchPipedriveDealsPage(
  baseUrl: string,
  apiToken: string,
  start: number
): Promise<PipedriveDealsResponse> {
  const url = new URL(`${baseUrl}/deals`);
  url.searchParams.set("api_token", apiToken);
  url.searchParams.set("start", String(start));
  url.searchParams.set("limit", String(PAGE_LIMIT));
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
      throw new Error(`Pipedrive deals request failed after ${attempt} attempts: ${lastError}`);
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
      const message = `Pipedrive deals request failed (${res.status} ${res.statusText})${suffix}`;
      if (attempt < MAX_FETCH_ATTEMPTS && shouldRetryStatus(res.status)) {
        await sleep(retryAfterMs(res) ?? RETRY_BASE_DELAY_MS * attempt);
        continue;
      }
      throw new Error(message);
    }
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Pipedrive deals response is not a JSON object");
    }
    const body = parsed as PipedriveDealsResponse;
    if (body.success === false) throw new Error(`Pipedrive deals response success=false: ${text.slice(0, 1000)}`);
    if (!Array.isArray(body.data)) throw new Error("Pipedrive deals response data is not an array");
    return body;
  }
  throw new Error(`Pipedrive deals request failed after ${MAX_FETCH_ATTEMPTS} attempts: ${lastError ?? "unknown error"}`);
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

function mapDealForSupabase(projectId: string, deal: unknown, syncedAt: string): Record<string, unknown> {
  if (deal == null || typeof deal !== "object" || Array.isArray(deal)) {
    throw new Error("Pipedrive deal row is not an object");
  }
  const rawId = (deal as Record<string, unknown>).id;
  const id = typeof rawId === "number" ? rawId : typeof rawId === "string" ? Number(rawId) : NaN;
  if (!Number.isInteger(id)) throw new Error("Pipedrive deal row has invalid id");
  return {
    project_id: projectId,
    pipedrive_deal_id: id,
    synced_at: syncedAt,
    updated_at: syncedAt,
    payload: deal,
  };
}

async function upsertPipedriveDeals(
  client: SupabaseClient,
  projectId: string,
  deals: unknown[],
  syncedAt: string
): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < deals.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = deals.slice(i, i + UPSERT_CHUNK_SIZE).map((deal) => mapDealForSupabase(projectId, deal, syncedAt));
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
  const { deals, relatedObjects, pageCount } = await fetchAllPipedriveDeals(baseUrl, apiToken);
  const upserted = await upsertPipedriveDeals(client, projectId, deals, syncedAt);
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
    relatedObjectCount: relatedObjects.length,
    relatedObjectsUpserted,
    pageCount,
    syncedAt,
  };
}
