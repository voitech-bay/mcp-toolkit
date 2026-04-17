type BatchWorkerJobStatus =
  | "queued"
  | "validating"
  | "planning"
  | "running"
  | "mapping"
  | "ready_to_publish"
  | "publishing"
  | "completed"
  | "failed"
  | "cancelled";

type BatchWorkerJobSummary = {
  id: string;
  projectId: string | null;
  status: BatchWorkerJobStatus;
  createdAt: string;
  updatedAt: string;
  rowCount: number;
  metadata?: Record<string, unknown>;
};

type BatchWorkerBatchSummary = {
  id: string;
  status: string;
  batchNumber: number;
  rowCount: number;
  rowStart: number;
  rowEnd: number;
  createdAt: string;
  updatedAt: string;
};

export type BatchWorkerCreateJobInput = {
  tenantId?: string;
  projectId?: string | null;
  entityType: "contacts" | "companies";
  prompt?: string;
  mappingProfileId?: string | null;
  metadata?: Record<string, unknown>;
  sourceRows: Record<string, unknown>[];
  batchSize?: number;
};

export type BatchWorkerCreateJobResponse = {
  id: string;
  status: BatchWorkerJobStatus;
  rowCount: number;
  batchCount: number;
};

export type BatchWorkerJobDetail = {
  id: string;
  tenantId: string;
  projectId: string | null;
  entityType: "contacts" | "companies";
  status: BatchWorkerJobStatus;
  promptTemplate: string;
  mappingProfileId: string | null;
  rowCount: number;
  completedRows: number;
  failedRows: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
};

type BatchWorkerResultPayload = {
  jobId?: string;
  status?: BatchWorkerJobStatus;
  publishEvents?: Array<{ id: string }>;
  publishEvent?: Record<string, unknown>;
  raw?: Array<Record<string, unknown>>;
  mappings?: Array<Record<string, unknown>>;
  totalRawRows?: number;
};

function parseJson<T>(raw: unknown): T {
  return raw as T;
}

function mapJobStatusToLegacyQueueStatus(status: BatchWorkerJobStatus): string {
  if (status === "queued" || status === "validating" || status === "planning") return "queued";
  if (status === "running" || status === "mapping" || status === "publishing") return "running";
  if (status === "completed" || status === "ready_to_publish") return "done";
  if (status === "cancelled") return "cancelled";
  return "error";
}

function mapJobStatusToLegacyRunStatus(status: BatchWorkerJobStatus): string {
  if (status === "queued" || status === "validating" || status === "planning") return "running";
  if (status === "running" || status === "mapping" || status === "publishing") return "running";
  if (status === "completed" || status === "ready_to_publish") return "success";
  if (status === "cancelled") return "cancelled";
  return "error";
}

export function getBatchWorkerApiBaseUrl(): string | null {
  const raw = process.env.BATCH_WORKER_API_BASE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export function isBatchWorkerEnabled(): boolean {
  return Boolean(getBatchWorkerApiBaseUrl());
}

async function callBatchWorker<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getBatchWorkerApiBaseUrl();
  if (!base) throw new Error("BATCH_WORKER_API_BASE_URL is not configured");
  const apiToken = process.env.BATCH_WORKER_API_TOKEN?.trim();
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message =
      payload && typeof payload.error === "string"
        ? payload.error
        : `Batch worker request failed (${response.status})`;
    throw new Error(message);
  }
  return parseJson<T>(payload);
}

export async function createBatchWorkerJobFromEnrichment(input: {
  projectId: string;
  entityType: "company" | "contact";
  agentName: string;
  companyIds?: string[];
  contactIds?: string[];
  operationName?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<{ jobId: string; inserted: number }> {
  const sourceRows =
    input.entityType === "company"
      ? (input.companyIds ?? []).map((companyId) => ({ company_id: companyId }))
      : (input.contactIds ?? []).map((contactId) => ({ contact_id: contactId }));

  const inserted = sourceRows.length;
  if (inserted === 0) {
    return { jobId: "", inserted: 0 };
  }

  const payload = await callBatchWorker<{ id: string }>("/jobs", {
    method: "POST",
    body: JSON.stringify({
      tenantId: "mcp-toolkit",
      projectId: input.projectId,
      entityType: input.entityType === "company" ? "companies" : "contacts",
      prompt: input.agentName,
      metadata: {
        source: "mcp-toolkit-enrichment",
        legacyAgentName: input.agentName,
        operationName: input.operationName ?? null,
        ...(input.meta ?? {}),
      },
      sourceRows,
    }),
  });

  return { jobId: payload.id, inserted };
}

export async function listBatchWorkerJobs(projectId: string): Promise<BatchWorkerJobSummary[]> {
  const payload = await callBatchWorker<{ data: BatchWorkerJobSummary[] }>(
    `/jobs?projectId=${encodeURIComponent(projectId)}`
  );
  return payload.data ?? [];
}

export async function listLegacyQueueFromBatchWorker(projectId: string): Promise<{
  data: Array<Record<string, unknown>>;
  total: number;
}> {
  const jobs = await listBatchWorkerJobs(projectId);
  const rows = jobs.map((job) => ({
    id: job.id,
    project_id: job.projectId,
    status: mapJobStatusToLegacyQueueStatus(job.status),
    created_at: job.createdAt,
    updated_at: job.updatedAt,
    meta: job.metadata ?? {},
  }));
  return { data: rows, total: rows.length };
}

export async function listLegacyRunsFromBatchWorker(projectId: string): Promise<{
  data: Array<Record<string, unknown>>;
  total: number;
}> {
  const jobs = await listBatchWorkerJobs(projectId);
  const rows = jobs.map((job) => ({
    id: job.id,
    project_id: job.projectId,
    status: mapJobStatusToLegacyRunStatus(job.status),
    started_at: job.createdAt,
    finished_at:
      job.status === "completed" || job.status === "failed" || job.status === "cancelled"
        ? job.updatedAt
        : null,
    error: job.status === "failed" ? "batch worker job failed" : null,
    meta: job.metadata ?? {},
  }));
  return { data: rows, total: rows.length };
}

export async function getLegacyBatchDetailFromBatchWorker(
  batchId: string
): Promise<{ batch: Record<string, unknown>; runs: Record<string, unknown>[] } | null> {
  const maybeJob = await callBatchWorker<BatchWorkerJobSummary | { error: string }>(`/jobs/${batchId}`).catch(
    () => null
  );
  if (maybeJob && "id" in maybeJob) {
    const data = maybeJob as BatchWorkerJobSummary;
    return {
      batch: {
        id: data.id,
        status: mapJobStatusToLegacyQueueStatus(data.status),
        created_at: data.createdAt,
        updated_at: data.updatedAt,
      },
      runs: [
        {
          id: data.id,
          status: mapJobStatusToLegacyRunStatus(data.status),
        },
      ],
    };
  }

  const jobBatches = await callBatchWorker<{ data: BatchWorkerBatchSummary[] }>(`/jobs/${batchId}/batches`).catch(
    () => null
  );
  if (!jobBatches) return null;
  const found = (jobBatches.data ?? []).find((batch) => batch.id === batchId);
  if (!found) return null;
  return {
    batch: {
      id: found.id,
      status: found.status,
      row_start: found.rowStart,
      row_end: found.rowEnd,
      row_count: found.rowCount,
      created_at: found.createdAt,
      updated_at: found.updatedAt,
    },
    runs: [],
  };
}

export async function cancelBatchWorkerJob(jobId: string): Promise<void> {
  await callBatchWorker(`/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
}

export async function retryBatchWorkerJob(jobId: string): Promise<void> {
  await callBatchWorker(`/jobs/${encodeURIComponent(jobId)}/retry`, { method: "POST" });
}

export async function previewBatchWorkerMapping(jobId: string): Promise<BatchWorkerResultPayload> {
  return await callBatchWorker<BatchWorkerResultPayload>(
    `/jobs/${encodeURIComponent(jobId)}/mapping/preview`,
    { method: "POST", body: JSON.stringify({}) }
  );
}

export async function publishBatchWorkerResults(jobId: string): Promise<BatchWorkerResultPayload> {
  return await callBatchWorker<BatchWorkerResultPayload>(
    `/jobs/${encodeURIComponent(jobId)}/publish`,
    { method: "POST", body: JSON.stringify({}) }
  );
}

export async function createBatchWorkerJob(input: BatchWorkerCreateJobInput): Promise<BatchWorkerCreateJobResponse> {
  return await callBatchWorker<BatchWorkerCreateJobResponse>("/jobs", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getBatchWorkerJobStatus(jobId: string): Promise<BatchWorkerJobDetail> {
  return await callBatchWorker<BatchWorkerJobDetail>(`/jobs/${encodeURIComponent(jobId)}`);
}

export async function getBatchWorkerJobResults(jobId: string): Promise<BatchWorkerResultPayload> {
  return await callBatchWorker<BatchWorkerResultPayload>(`/jobs/${encodeURIComponent(jobId)}/results`);
}
