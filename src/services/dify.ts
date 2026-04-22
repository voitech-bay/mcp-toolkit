/**
 * Dify app API client (server-side). Keys must not be exposed to the browser.
 * @see https://docs.dify.ai/api-reference/workflow-runs/list-workflow-logs
 */

export function normalizeDifyApiBase(): string {
  return (process.env.DIFY_API_BASE ?? "https://api.dify.ai/v1").trim().replace(/\/+$/, "");
}

/** Resolve API keys: DIFY_API_KEYS_JSON (array of strings) > DIFY_API_KEYS (comma-separated) > DIFY_API_KEY */
export function listDifyApiKeysFromEnv(): string[] {
  const jsonRaw = process.env.DIFY_API_KEYS_JSON?.trim();
  if (jsonRaw) {
    try {
      const parsed = JSON.parse(jsonRaw) as unknown;
      if (Array.isArray(parsed)) {
        const keys = parsed
          .map((x) => (typeof x === "string" ? x.trim() : ""))
          .filter(Boolean);
        if (keys.length) return keys;
      }
    } catch {
      // fall through
    }
  }
  const csv = process.env.DIFY_API_KEYS?.trim();
  if (csv) {
    const keys = csv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (keys.length) return keys;
  }
  const one = process.env.DIFY_API_KEY?.trim();
  return one ? [one] : [];
}

export function getDifyLogMaxPages(): number {
  const n = Number(process.env.DIFY_LOG_MAX_PAGES);
  if (Number.isFinite(n) && n >= 1) return Math.min(500, Math.floor(n));
  return 50;
}

export function getDifyRunDetailConcurrency(): number {
  const n = Number(process.env.DIFY_RUN_DETAIL_CONCURRENCY);
  if (Number.isFinite(n) && n >= 1) return Math.min(20, Math.floor(n));
  return 6;
}

export function getDifyRunDetailBatchMax(): number {
  const n = Number(process.env.DIFY_RUN_DETAIL_BATCH_MAX);
  if (Number.isFinite(n) && n >= 1) return Math.min(1000, Math.floor(n));
  return 250;
}

export interface DifyAppInfo {
  name?: string;
  description?: string;
  mode?: string;
  tags?: string[];
  author_name?: string;
}

export async function difyGetJson<T>(
  apiKey: string,
  pathWithLeadingSlash: string,
  searchParams?: URLSearchParams
): Promise<{ ok: boolean; status: number; body: T | null; rawText: string }> {
  const base = normalizeDifyApiBase();
  const path = pathWithLeadingSlash.startsWith("/") ? pathWithLeadingSlash : `/${pathWithLeadingSlash}`;
  const qs = searchParams?.toString();
  const url = `${base}${path}${qs ? `?${qs}` : ""}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  const rawText = await r.text();
  let body: T | null = null;
  if (rawText) {
    try {
      body = JSON.parse(rawText) as T;
    } catch {
      body = null;
    }
  }
  return { ok: r.ok, status: r.status, body, rawText };
}

export async function difyFetchAppInfo(
  apiKey: string
): Promise<{ info: DifyAppInfo | null; error?: string; status: number }> {
  const { ok, status, body, rawText } = await difyGetJson<DifyAppInfo>(apiKey, "/info");
  if (!ok || !body) {
    const hint = rawText.length > 200 ? `${rawText.slice(0, 200)}…` : rawText;
    return { info: null, status, error: hint || `HTTP ${status}` };
  }
  return { info: body, status };
}

export interface DifyWorkflowRunSummary {
  id?: string;
  version?: string;
  status?: string;
  error?: string | null;
  elapsed_time?: number;
  total_tokens?: number;
  total_steps?: number;
  created_at?: number;
  finished_at?: number | null;
  exceptions_count?: number;
  triggered_from?: string;
}

export interface DifyWorkflowLogItem {
  id?: string;
  workflow_run?: DifyWorkflowRunSummary;
  created_at?: number;
  created_from?: string;
  created_by_role?: string;
}

export interface DifyWorkflowLogsPage {
  page?: number;
  limit?: number;
  total?: number;
  has_more?: boolean;
  data?: DifyWorkflowLogItem[];
}

function workflowLogCreatedMs(item: DifyWorkflowLogItem): number {
  const wr = item.workflow_run;
  const sec =
    typeof wr?.created_at === "number"
      ? wr.created_at
      : typeof item.created_at === "number"
        ? item.created_at
        : 0;
  if (!sec) return 0;
  return sec < 1e12 ? Math.round(sec * 1000) : Math.round(sec);
}

export async function difyFetchAllWorkflowLogs(
  apiKey: string,
  maxPages: number
): Promise<{
  items: DifyWorkflowLogItem[];
  pagesFetched: number;
  truncated: boolean;
  totalReported: number | null;
  error?: string;
}> {
  const items: DifyWorkflowLogItem[] = [];
  let page = 1;
  let totalReported: number | null = null;
  let truncated = false;

  while (page <= maxPages) {
    const sp = new URLSearchParams();
    sp.set("page", String(page));
    sp.set("limit", "100");
    const { ok, status, body } = await difyGetJson<DifyWorkflowLogsPage>(apiKey, "/workflows/logs", sp);
    if (!ok || !body) {
      return {
        items,
        pagesFetched: page - 1,
        truncated,
        totalReported,
        error: `Dify /workflows/logs failed (HTTP ${status})`,
      };
    }
    if (typeof body.total === "number") totalReported = body.total;
    const chunk = Array.isArray(body.data) ? body.data : [];
    items.push(...chunk);
    const hasMore = Boolean(body.has_more);
    if (!hasMore || chunk.length === 0) {
      return {
        items,
        pagesFetched: page,
        truncated: false,
        totalReported,
      };
    }
    page += 1;
  }

  truncated = true;
  return { items, pagesFetched: maxPages, truncated, totalReported };
}

export function normalizeDifyRunRow(item: DifyWorkflowLogItem): {
  logId: string;
  runId: string;
  createdAtMs: number;
  finishedAtMs: number | null;
  status: string | null;
  elapsedTime: number | null;
  totalTokens: number | null;
  totalSteps: number | null;
  error: string | null;
  triggeredFrom: string | null;
} | null {
  const logId = typeof item.id === "string" ? item.id : "";
  const wr = item.workflow_run;
  const runId = typeof wr?.id === "string" ? wr.id : "";
  const createdAtMs = workflowLogCreatedMs(item);
  if (!logId || !runId || !createdAtMs) return null;

  let finishedAtMs: number | null = null;
  if (typeof wr?.finished_at === "number" && wr.finished_at > 0) {
    finishedAtMs = wr.finished_at < 1e12 ? Math.round(wr.finished_at * 1000) : Math.round(wr.finished_at);
  }

  return {
    logId,
    runId,
    createdAtMs,
    finishedAtMs,
    status: typeof wr?.status === "string" ? wr.status : null,
    elapsedTime: typeof wr?.elapsed_time === "number" ? wr.elapsed_time : null,
    totalTokens: typeof wr?.total_tokens === "number" ? wr.total_tokens : null,
    totalSteps: typeof wr?.total_steps === "number" ? wr.total_steps : null,
    error: typeof wr?.error === "string" ? wr.error : null,
    triggeredFrom: typeof wr?.triggered_from === "string" ? wr.triggered_from : null,
  };
}

/** GET /v1/workflows/run/{id} — inputs + outputs for one run. */
export async function difyFetchWorkflowRunDetail(
  apiKey: string,
  runId: string
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null; rawText: string }> {
  return difyGetJson<Record<string, unknown>>(
    apiKey,
    `/workflows/run/${encodeURIComponent(runId)}`
  );
}

export type DifyRunDetailResult = {
  runId: string;
  ok: boolean;
  outputs: unknown;
  inputs: unknown;
  status: string | null;
  error: string | null;
  httpStatus: number;
};

export async function difyFetchManyRunDetails(
  apiKey: string,
  runIds: string[],
  concurrency: number
): Promise<DifyRunDetailResult[]> {
  const results: DifyRunDetailResult[] = new Array(runIds.length);
  let next = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= runIds.length) return;
      const runId = runIds[i]!;
      const { ok, status, body } = await difyFetchWorkflowRunDetail(apiKey, runId);
      const rec = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
      const apiMessage =
        rec && typeof rec.message === "string" ? rec.message : null;
      const apiErr =
        rec && rec.error != null && String(rec.error).length > 0 ? String(rec.error) : null;
      const errMsg = apiErr ?? apiMessage;
      results[i] = {
        runId,
        ok,
        outputs: ok && rec && "outputs" in rec ? rec.outputs : null,
        inputs: ok && rec && "inputs" in rec ? rec.inputs : null,
        status: rec && typeof rec.status === "string" ? rec.status : null,
        error: ok ? errMsg : errMsg ?? `HTTP ${status}`,
        httpStatus: status,
      };
    }
  }

  const n = Math.max(1, Math.min(concurrency, runIds.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}
