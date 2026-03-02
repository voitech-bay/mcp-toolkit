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
