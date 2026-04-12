export interface TableCounts {
  /** Total rows in shared `companies` table (all projects). */
  companies: number;
  /** Companies linked to the project via `project_companies` (preflight); 0 on global state. */
  companies_in_project: number;
  contacts: number;
  linkedin_messages: number;
  senders: number;
  contact_lists: number;
  getsales_tags: number;
  pipeline_stages: number;
  flows: number;
  flow_leads: number;
}

export interface LatestRows {
  companies: Record<string, unknown>[];
  contacts: Record<string, unknown>[];
  linkedin_messages: Record<string, unknown>[];
  senders: Record<string, unknown>[];
  contact_lists: Record<string, unknown>[];
  getsales_tags: Record<string, unknown>[];
  pipeline_stages: Record<string, unknown>[];
  flows: Record<string, unknown>[];
  flow_leads: Record<string, unknown>[];
}

export interface StateResponse {
  counts: TableCounts;
  latest: LatestRows | null;
  latestError?: string;
}

/** Main sync pipeline entity keys (matches server `SYNC_ENTITY_PIPELINE`). */
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

export const ALL_SYNC_ENTITY_KEYS: readonly SyncEntityKey[] = [
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

export function defaultSyncEntitySelection(): Record<SyncEntityKey, boolean> {
  return Object.fromEntries(ALL_SYNC_ENTITY_KEYS.map((k) => [k, true])) as Record<SyncEntityKey, boolean>;
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
}

// --- Project-aware sync types ---

export interface Project {
  id: string;
  name: string;
  description: string | null;
  api_key_set: boolean;
  source_api_base_url: string | null;
  created_at: string;
}

export interface SyncLogEntry {
  kind: "log" | "upsert";
  level: "info" | "error";
  message: string;
  table_name: string | null;
  row_count: number | null;
  data: Record<string, unknown> | null;
  created_at: string;
}

export type SyncRunStatus = "running" | "success" | "partial" | "error" | "cancelled";

export interface SyncRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: SyncRunStatus;
  result_summary: Record<string, unknown> | null;
  error: string | null;
  project_id: string | null;
  log_entries: Array<{
    id: string;
    created_at: string;
    kind: string;
    level: string;
    message: string;
    table_name: string | null;
    row_count: number | null;
    data: Record<string, unknown> | null;
  }>;
}

export interface PreflightResult {
  projectId: string;
  counts: TableCounts | null;
  countsError?: string;
  latest: LatestRows | null;
  latestError?: string;
  activeSyncRun: { id: string; project_id: string | null } | null;
  /** GET /flows/api/flows?limit=1 — verifies saved or env GetSales credentials. */
  sourceApiCheck?: { ok: boolean; error?: string };
}

export type SyncWsMessage =
  | {
      type: "log";
      runId: string;
      entry: SyncLogEntry;
    }
  | {
      type: "complete";
      runId: string;
      result: Record<string, unknown>;
    };
