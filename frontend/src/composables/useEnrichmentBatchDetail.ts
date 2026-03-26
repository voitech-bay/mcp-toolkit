/** Shared types + fetch for enrichment batch detail (table + jobs pages). */

export type EnrichmentBatchDetailBatch = {
  id: string;
  project_id: string;
  agent_name: string;
  worker_name: string;
  created_at: string;
};

export type EnrichmentBatchDetailRun = {
  id: string;
  queue_task_id: string;
  company_id: string | null;
  contact_id: string | null;
  status: string;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  resultPreview?: unknown;
};

export type EnrichmentBatchDetailResponse = {
  batch: EnrichmentBatchDetailBatch;
  runs: EnrichmentBatchDetailRun[];
};

export async function fetchEnrichmentBatchDetail(
  projectId: string,
  batchId: string
): Promise<EnrichmentBatchDetailResponse> {
  const q = new URLSearchParams({ batchId: batchId.trim(), projectId: projectId.trim() });
  const r = await fetch(`/api/enrichment/batch?${q}`);
  const j = (await r.json()) as { error?: string } & Partial<EnrichmentBatchDetailResponse>;
  if (!r.ok) {
    throw new Error(j.error ?? `HTTP ${r.status}`);
  }
  if (!j.batch || !j.runs) {
    throw new Error("Invalid batch response");
  }
  return { batch: j.batch, runs: j.runs };
}
