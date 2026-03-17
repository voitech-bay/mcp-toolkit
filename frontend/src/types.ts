export interface TableCounts {
  contacts: number;
  linkedin_messages: number;
  senders: number;
}

export interface LatestRows {
  contacts: Record<string, unknown>[];
  linkedin_messages: Record<string, unknown>[];
  senders: Record<string, unknown>[];
}

export interface StateResponse {
  counts: TableCounts;
  latest: LatestRows | null;
  latestError?: string;
}

export interface SyncResult {
  contacts: { fetched: number; upserted: number; error: string | null };
  linkedin_messages: { fetched: number; upserted: number; error: string | null };
  senders: { fetched: number; upserted: number; error: string | null };
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

export type SyncRunStatus = "running" | "success" | "partial" | "error";

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
