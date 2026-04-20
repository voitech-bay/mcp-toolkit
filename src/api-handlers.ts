/**
 * HTTP handlers for Supabase state and sync. Used by Vercel serverless api/supabase-state and api/supabase-sync.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getSupabase,
  getTableCounts,
  getLatestRows,
  queryTableWithFilters,
  getConversation,
  listCompanyContextsByCompanyId,
  addCompanyContextEntry,
  getCompanyContextCounts,
  listContactContextsByContactId,
  addContactContextEntry,
  getContactContextCounts,
  getProjects,
  getProjectById,
  updateProjectCredentials,
  getProjectEntityCounts,
  getProjectLatestRows,
  getActiveSyncRun,
  getSyncHistory,
  createSyncRun,
  markSyncRunFinishedIfStillRunning,
  getAllCompanies,
  addCompaniesToProject,
  getProjectCompanies,
  getHypothesesWithCounts,
  getHypothesisTargets,
  createHypothesis,
  updateHypothesis,
  deleteHypothesis,
  markGetSalesTagsAsHypotheses,
  unmarkGetSalesTagsAsHypotheses,
  getHypothesisTagContacts,
  addCompaniesToHypothesis,
  removeCompaniesFromHypothesis,
  getContextSnapshots,
  saveContextSnapshot,
  getConversationsList,
  listContactPipelineStages,
  type ConversationReplyTag,
  getCompanyHypotheses,
  getContactsByCompany,
  createCompany,
  updateContactCompany,
  getCompaniesByIds,
  type TableQueryFilters,
  listEnrichmentAgentsForEntityType,
  listAllEnrichmentAgents,
  createEnrichmentAgent,
  updateEnrichmentAgent,
  getEnrichmentTableData,
  listContactListsForProject,
  listGetSalesTagsForProject,
  enqueueEnrichmentTasks,
  listEnrichmentQueueTasksForProject,
  listEnrichmentAgentRunsForProject,
  getEnrichmentBatchDetail,
  stopEnrichmentQueueTask,
  restartEnrichmentQueueTask,
  getEnrichmentPromptSettingsEffective,
  getEnrichmentPromptSettingsRow,
  upsertEnrichmentPromptSettings,
  getEnrichmentAgentResultsMapForEntity,
  getEnrichmentAgentByName,
  getCollectedAnalyticsDays,
  getAutomationFlowFunnelByFlow,
  aggregateAutomationFlowFunnelTotals,
  getProjectDashboardSnapshot,
  type EnrichmentEntityType,
  createGeneratedMessage,
  listGeneratedMessagesByContact,
  deleteGeneratedMessageById,
  listGeneratedMessagePresets,
  listGeneratedMessagePresetVersions,
  setGeneratedMessagePresetDefault,
  getGeneratedMessagePresetById,
  getGeneratedMessagePresetByHash,
  createGeneratedMessagePresetVersion,
  insertFirefliesWebhookEvent,
  updateFirefliesWebhookEventProcessing,
  PROJECT_COMPANIES_TABLE,
  COMPANIES_TABLE,
  CONTACTS_TABLE,
} from "./services/supabase.js";
import {
  getProjectAnalyticsDashboard,
  getProjectAnalyticsDailySeries,
  type ProjectAnalyticsDashboardTotals,
} from "./services/analytics-funnel.js";
import { getProjectConversationGeoAggregates } from "./services/project-conversation-geo.js";
import { buildCompanyEntitiesForPrompt } from "./services/enrichment-entity-assembler.js";
import {
  resolvePromptForBatch,
  type EnrichmentEntityType as PromptEntityType,
} from "./services/prompt-resolver.js";
import {
  buildReplyContextPrompt,
  generateContextText,
  type BuildContextNodes,
} from "./services/reply-context-prompt.js";
import {
  syncSupabaseFromSource,
  syncAnalyticsSnapshots,
  isSyncEntityKey,
  mapContactForSupabase,
  type SyncEntityKey,
} from "./services/sync-supabase.js";
import { fetchContactByUuid, verifyGetSalesCredentials } from "./services/source-api.js";
import { listOpenRouterModels, generateOpenRouterMessage } from "./services/openrouter.js";
import {
  buildGeneratedMessagePrompt,
  evaluateGeneratedMessageQuality,
  type GenerationTone,
  type MentionBlock,
  type GenerationGoal,
  type GenerationCtaStyle,
  type PersonalizationDepth,
  type ReadingLevel,
  type FormalityLevel,
  type EmojiPolicy,
  type ReadingLevelPreset,
  type TonePreset,
  type LengthPreset,
  type MethodologyPreset,
  type FocusPreset,
  type CtaType,
} from "./services/generated-message-prompt.js";
import {
  normalizePresetWithLlm,
  normalizationHash,
  type RawPresetSettings,
} from "./services/generated-message-preset-normalizer.js";
import {
  requestSyncCancellation,
  SyncCancelledError,
  isLocalSyncRunActive,
} from "./services/sync-cancellation.js";
import {
  getActiveWorkers,
  isWorkerHeartbeatAuthOk,
  recordWorkerHeartbeat,
  type WorkerHeartbeatPayload,
  type WorkerPendingBatchProgress,
} from "./services/worker-registry.js";
import { persistWorkerPresenceToSupabase } from "./services/worker-presence-db.js";
import { getWorkersUiSnapshot } from "./services/worker-ui-snapshot.js";
import { broadcastEnrichmentBatchStarted } from "./services/enrichment-realtime.js";
import {
  verifyFirefliesHubSignature,
  normalizeFirefliesPayload,
  buildContextAgentJob,
  isTranscriptReadyEvent,
} from "./services/fireflies-webhook.js";
import {
  cancelBatchWorkerJob,
  createBatchWorkerJobFromEnrichment,
  getLegacyBatchDetailFromBatchWorker,
  isBatchWorkerEnabled,
  listLegacyQueueFromBatchWorker,
  listLegacyRunsFromBatchWorker,
  retryBatchWorkerJob,
} from "./services/batch-worker-client.js";

export { generateContextText };

/** Raw UTF-8 body (e.g. Fireflies webhook HMAC). */
async function getRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function getParsedBody(req: IncomingMessage): Promise<unknown> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.includes("application/json")) return undefined;
  const raw = await getRawBody(req);
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export type NodeHandler = (
  req: IncomingMessage,
  res: ServerResponse
) => Promise<void>;

export async function handleSupabaseState(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const limit = parseLatestLimit(req);
  const [countsResult, latestResult] = await Promise.all([
    getTableCounts(client),
    getLatestRows(client, limit),
  ]);
  if (countsResult.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: countsResult.error, counts: null, latest: null }));
    return;
  }
  res.writeHead(200);
  res.end(
    JSON.stringify({
      counts: countsResult.counts,
      latest: latestResult.error ? null : latestResult.latest,
      latestError: latestResult.error ?? undefined,
    })
  );
}

/** Parse ?latest=N from URL (default 10, max 100). */
function parseLatestLimit(req: IncomingMessage): number {
  const url = req.url ?? "";
  const q = url.includes("?") ? url.slice(url.indexOf("?")) : "";
  const params = new URLSearchParams(q);
  const n = params.get("latest");
  if (n == null) return 10;
  const parsed = parseInt(n, 10);
  if (Number.isNaN(parsed)) return 10;
  return Math.min(Math.max(parsed, 1), 100);
}

export async function handleSupabaseSync(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");

  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }

  const body = (await getParsedBody(req)) as {
    projectId?: string;
    entities?: string[];
    syncDateRange?: { from?: string; to?: string };
  } | undefined;
  const projectId = body?.projectId;

  let syncDateRange: { from: string; to: string } | undefined;
  if (body?.syncDateRange !== undefined) {
    const dr = body.syncDateRange;
    if (
      dr == null ||
      typeof dr.from !== "string" ||
      typeof dr.to !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(dr.from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(dr.to)
    ) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "syncDateRange must be { from, to } with YYYY-MM-DD strings" }));
      return;
    }
    if (dr.from > dr.to) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "syncDateRange.from must be <= syncDateRange.to" }));
      return;
    }
    syncDateRange = { from: dr.from, to: dr.to };
  }

  let entities: SyncEntityKey[] | undefined;
  if (body?.entities !== undefined) {
    if (!Array.isArray(body.entities)) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "entities must be an array of entity keys" }));
      return;
    }
    if (body.entities.length === 0) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "entities must include at least one key" }));
      return;
    }
    const invalid = body.entities.find((e) => typeof e !== "string" || !isSyncEntityKey(e));
    if (invalid !== undefined) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: `Invalid entity key: ${String(invalid)}` }));
      return;
    }
    entities = body.entities as SyncEntityKey[];
  }

  const { data: activeRun } = await getActiveSyncRun(client);
  if (activeRun) {
    res.writeHead(409);
    res.end(JSON.stringify({
      error: "sync already running",
      activeRunId: activeRun.id,
      activeProjectId: activeRun.project_id ?? null,
    }));
    return;
  }

  const runResult = await createSyncRun(client, projectId);
  if (runResult.error || !runResult.id) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: runResult.error ?? "Failed to create sync run" }));
    return;
  }

  const runId = runResult.id;

  res.writeHead(200);
  res.end(JSON.stringify({ runId }));

  syncSupabaseFromSource(projectId, runId, {
    ...(entities !== undefined ? { entities } : {}),
    ...(syncDateRange !== undefined ? { syncDateRange } : {}),
  }).catch((err) => {
    if (err instanceof SyncCancelledError) {
      console.log(`[sync] run ${runId} cancelled`);
      return;
    }
    console.error("[sync] background sync error:", err);
  });
}

/** POST /api/supabase-sync-cancel — body: { runId }. Cooperatively stops in-process sync; if none (e.g. redeploy), clears stale DB lock. */
export async function handleSupabaseSyncCancel(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const body = (await getParsedBody(req)) as { runId?: string } | undefined;
  const runId = body?.runId;
  if (!runId || typeof runId !== "string") {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "runId is required" }));
    return;
  }
  requestSyncCancellation(runId);

  if (isLocalSyncRunActive(runId)) {
    res.writeHead(200);
    res.end(JSON.stringify({ ok: true, runId, mode: "cooperative" }));
    return;
  }

  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured — cannot clear stale sync lock" }));
    return;
  }

  const { updated, error: dbError } = await markSyncRunFinishedIfStillRunning(client, runId, {
    error:
      "Stopped: no sync process on this server (restart, redeploy, or different instance). Database lock cleared.",
  });
  if (dbError) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: dbError }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true, runId, mode: updated ? "clearedStaleLock" : "noop", staleLockCleared: updated }));
}

/** GET /api/project-dashboard?projectId= — overview stats for the home page. */
export async function handleProjectDashboard(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const projectId = getQueryParams(req).get("projectId");
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing projectId query parameter" }));
    return;
  }
  const { snapshot, error } = await getProjectDashboardSnapshot(client, projectId);
  if (error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify(snapshot));
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const PROJECT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function funnelInclusiveDayCount(dateFrom: string, dateTo: string): number {
  const a = new Date(`${dateFrom}T12:00:00`).getTime();
  const b = new Date(`${dateTo}T12:00:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

function funnelAddDaysYmd(ymd: string, delta: number): string {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** GET /api/flow-funnel?projectId=&dateFrom=&dateTo= — per-flow funnel metrics (AnalyticsSnapshots). */
export async function handleFlowFunnel(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const q = getQueryParams(req);
  const projectId = q.get("projectId")?.trim() ?? "";
  const dateFrom = q.get("dateFrom")?.trim() ?? "";
  const dateTo = q.get("dateTo")?.trim() ?? "";
  if (!projectId || !PROJECT_ID_RE.test(projectId)) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing or invalid projectId" }));
    return;
  }
  if (!YMD_RE.test(dateFrom) || !YMD_RE.test(dateTo)) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "dateFrom and dateTo are required (YYYY-MM-DD)" }));
    return;
  }
  if (dateFrom > dateTo) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "dateFrom must be <= dateTo" }));
    return;
  }
  const { flows, error, warnings } = await getAutomationFlowFunnelByFlow(
    client,
    projectId,
    dateFrom,
    dateTo
  );
  if (error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error }));
    return;
  }
  const projectTotals = aggregateAutomationFlowFunnelTotals(flows);
  const windowDays = funnelInclusiveDayCount(dateFrom, dateTo);
  const previousTo = funnelAddDaysYmd(dateFrom, -1);
  const previousFrom = funnelAddDaysYmd(previousTo, -(windowDays - 1));
  const mergedWarnings = [...warnings];
  let comparison: {
    previousDateFrom: string;
    previousDateTo: string;
    totals: ReturnType<typeof aggregateAutomationFlowFunnelTotals>;
  } | null = null;
  const prevRes = await getAutomationFlowFunnelByFlow(
    client,
    projectId,
    previousFrom,
    previousTo
  );
  if (prevRes.error) {
    mergedWarnings.push(`Previous window funnel (${previousFrom}…${previousTo}): ${prevRes.error}`);
  } else {
    mergedWarnings.push(...prevRes.warnings);
    comparison = {
      previousDateFrom: previousFrom,
      previousDateTo: previousTo,
      totals: aggregateAutomationFlowFunnelTotals(prevRes.flows),
    };
  }
  res.writeHead(200);
  res.end(
    JSON.stringify({
      flows,
      dateFrom,
      dateTo,
      warnings: mergedWarnings,
      projectTotals,
      comparison,
    })
  );
}

function projectAnalyticsTotalsToJson(t: ProjectAnalyticsDashboardTotals) {
  return {
    messagesSent: t.messagesSent,
    connectionSent: t.connectionSent,
    connectionAccepted: t.connectionAccepted,
    inbox: t.inbox,
    positiveReplies: t.positiveReplies,
    connectionRequestRatePct: t.connectionRequestRatePct,
    acceptedRatePct: t.acceptedRatePct,
    inboxRatePct: t.inboxRatePct,
    positiveRatePct: t.positiveRatePct,
  };
}

/**
 * GET /api/project-analytics?projectId=&dateFrom=&dateTo=&groupBy=flow|hypothesis
 * — same aggregation as `find_project_analytics` MCP tool (flow vs hypothesis rollups).
 */
export async function handleProjectAnalytics(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const q = getQueryParams(req);
  const projectId = q.get("projectId")?.trim() ?? "";
  const dateFrom = q.get("dateFrom")?.trim() ?? "";
  const dateTo = q.get("dateTo")?.trim() ?? "";
  const groupByRaw = (q.get("groupBy") ?? "flow").trim().toLowerCase();
  const groupBy = groupByRaw === "hypothesis" ? "hypothesis" : "flow";

  if (!projectId || !PROJECT_ID_RE.test(projectId)) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing or invalid projectId" }));
    return;
  }
  if (!YMD_RE.test(dateFrom) || !YMD_RE.test(dateTo)) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "dateFrom and dateTo are required (YYYY-MM-DD)" }));
    return;
  }
  if (dateFrom > dateTo) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "dateFrom must be <= dateTo" }));
    return;
  }
  if (groupByRaw !== "flow" && groupByRaw !== "hypothesis") {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "groupBy must be flow or hypothesis" }));
    return;
  }

  const windowDays = funnelInclusiveDayCount(dateFrom, dateTo);
  const previousTo = funnelAddDaysYmd(dateFrom, -1);
  const previousFrom = funnelAddDaysYmd(previousTo, -(windowDays - 1));
  const requestStartedAt = Date.now();
  const [dash, prevDash] = await Promise.all([
    getProjectAnalyticsDashboard(client, projectId, dateFrom, dateTo, groupBy),
    getProjectAnalyticsDashboard(client, projectId, previousFrom, previousTo, groupBy, {
      totalsOnly: true,
    }),
  ]);
  if (dash.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: dash.error }));
    return;
  }
  const mergedWarnings = [...dash.warnings];
  let comparison: {
    previousDateFrom: string;
    previousDateTo: string;
    totals: ReturnType<typeof projectAnalyticsTotalsToJson>;
  } | null = null;
  if (prevDash.error) {
    mergedWarnings.push(
      `Previous window (${previousFrom}…${previousTo}): ${prevDash.error}`
    );
  } else {
    mergedWarnings.push(...prevDash.warnings);
    comparison = {
      previousDateFrom: previousFrom,
      previousDateTo: previousTo,
      totals: projectAnalyticsTotalsToJson(prevDash.projectTotals),
    };
  }
  const elapsedMs = Date.now() - requestStartedAt;
  console.info(
    `[project-analytics] project=${projectId} groupBy=${groupBy} from=${dateFrom} to=${dateTo} elapsedMs=${elapsedMs}`
  );

  res.writeHead(200);
  res.end(
    JSON.stringify({
      groupBy,
      flows: dash.flows,
      pipelineStages: dash.pipelineStages,
      dateFrom,
      dateTo,
      warnings: mergedWarnings,
      projectTotals: projectAnalyticsTotalsToJson(dash.projectTotals),
      comparison,
    })
  );
}

/**
 * GET /api/project-analytics-daily?projectId=&dateFrom=&dateTo=&groupBy=flow|hypothesis&entityIds=uuid,uuid
 * — per-day sums of AnalyticsSnapshots for the union of flows behind the selected entities.
 */
export async function handleProjectAnalyticsDaily(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const q = getQueryParams(req);
  const projectId = q.get("projectId")?.trim() ?? "";
  const dateFrom = q.get("dateFrom")?.trim() ?? "";
  const dateTo = q.get("dateTo")?.trim() ?? "";
  const groupByRaw = (q.get("groupBy") ?? "flow").trim().toLowerCase();
  const groupBy = groupByRaw === "hypothesis" ? "hypothesis" : "flow";
  const entityIdsParam = q.get("entityIds")?.trim() ?? "";
  const entityIds = entityIdsParam
    .split(",")
    .map((s) => s.trim())
    .filter((id) => PROJECT_ID_RE.test(id));
  const perEntityRaw = (q.get("perEntity") ?? "").trim().toLowerCase();
  const perEntity = perEntityRaw === "1" || perEntityRaw === "true" || perEntityRaw === "yes";

  if (!projectId || !PROJECT_ID_RE.test(projectId)) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing or invalid projectId" }));
    return;
  }
  if (!YMD_RE.test(dateFrom) || !YMD_RE.test(dateTo)) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "dateFrom and dateTo are required (YYYY-MM-DD)" }));
    return;
  }
  if (dateFrom > dateTo) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "dateFrom must be <= dateTo" }));
    return;
  }
  if (groupByRaw !== "flow" && groupByRaw !== "hypothesis") {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "groupBy must be flow or hypothesis" }));
    return;
  }

  const result = await getProjectAnalyticsDailySeries(
    client,
    projectId,
    dateFrom,
    dateTo,
    groupBy,
    entityIds,
    { perEntity }
  );
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(
    JSON.stringify({
      groupBy,
      entityIds,
      dateFrom,
      dateTo,
      perEntity,
      series: result.data,
      ...(result.byEntity != null && result.byEntity.length > 0 ? { byEntity: result.byEntity } : {}),
      warnings: result.warnings,
    })
  );
}

/** GET /api/analytics-collected-days?projectId= — distinct snapshot dates already stored. */
export async function handleAnalyticsCollectedDays(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const projectId = getQueryParams(req).get("projectId");
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing projectId query parameter" }));
    return;
  }
  const { dates, error } = await getCollectedAnalyticsDays(client, projectId);
  if (error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ dates }));
}

/** POST /api/analytics-sync — body: { projectId, dateFrom, dateTo } (YYYY-MM-DD). */
export async function handleAnalyticsSync(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const body = (await getParsedBody(req)) as
    | { projectId?: string; dateFrom?: string; dateTo?: string }
    | undefined;
  const projectId = body?.projectId?.trim();
  const dateFrom = body?.dateFrom?.trim();
  const dateTo = body?.dateTo?.trim();
  if (!projectId || !dateFrom || !dateTo) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Body must include projectId, dateFrom, and dateTo (YYYY-MM-DD)" }));
    return;
  }
  const result = await syncAnalyticsSnapshots(projectId, dateFrom, dateTo);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify(result));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify(result));
}

/** Parse query string from req.url. */
function getQueryParams(req: IncomingMessage): URLSearchParams {
  const url = req.url ?? "";
  const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  return new URLSearchParams(q);
}

export async function handleSupabaseTableQuery(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const table = params.get("table");
  const validTables = ["contacts", "linkedin_messages", "senders"];
  if (!table || !validTables.includes(table)) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing or invalid query: table (contacts|linkedin_messages|senders)" }));
    return;
  }
  let filters: TableQueryFilters = {};
  const filtersParam = params.get("filters");
  if (filtersParam) {
    try {
      const decoded = decodeURIComponent(filtersParam);
      const parsed = JSON.parse(decoded) as TableQueryFilters;
      if (typeof parsed === "object" && parsed !== null) {
        filters = parsed;
      }
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "Invalid filters JSON" }));
      return;
    }
  }
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "25", 10) || 25, 1), 100);
  const offset = Math.max(parseInt(params.get("offset") ?? "0", 10) || 0, 0);
  const search = params.get("search") ?? undefined;
  const result = await queryTableWithFilters(client, table, { filters, search, limit, offset });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], total: 0, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data, total: result.total }));
}

export async function handleConversation(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const leadUuid = params.get("leadUuid") ?? undefined;
  const conversationUuid = params.get("conversationUuid") ?? undefined;
  const senderProfileUuid = params.get("senderProfileUuid") ?? undefined;
  const result = await getConversation(client, {
    leadUuid: leadUuid || undefined,
    conversationUuid: conversationUuid || undefined,
    senderProfileUuid: senderProfileUuid || undefined,
    messageLimit: Math.min(parseInt(params.get("limit") ?? "500", 10) || 500, 1000),
  });
  if (result.error) {
    res.writeHead(200);
    res.end(JSON.stringify({ contact: result.contact ?? null, messages: result.messages, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ contact: result.contact ?? null, messages: result.messages }));
}

const ALLOWED_GENERATION_TONES = new Set<GenerationTone>([
  "professional",
  "friendly",
  "confident",
  "consultative",
  "direct",
]);

const ALLOWED_MENTION_BLOCKS = new Set<MentionBlock>([
  "contact_experience",
  "contact_posts",
  "contact_headline",
  "company_about",
  "company_industry",
  "conversation_recap",
]);
const ALLOWED_GOALS = new Set<GenerationGoal>([
  "book_call",
  "ask_question",
  "reengage",
  "follow_up",
  "close_loop",
]);
const ALLOWED_CTA_STYLES = new Set<GenerationCtaStyle>(["soft", "medium", "hard", "no_cta"]);
const ALLOWED_PERSONALIZATION_DEPTH = new Set<PersonalizationDepth>(["low", "medium", "high"]);
const ALLOWED_READING_LEVEL = new Set<ReadingLevel>(["simple", "expert"]);
const ALLOWED_FORMALITY = new Set<FormalityLevel>(["casual", "formal"]);
const ALLOWED_EMOJI_POLICY = new Set<EmojiPolicy>(["none", "light", "allowed"]);
const ALLOWED_READING_LEVEL_PRESET = new Set<ReadingLevelPreset>([
  "eighth_grade",
  "high_school",
  "college",
  "professional",
]);
const ALLOWED_TONE_PRESET = new Set<TonePreset>(["casual", "neutral", "formal"]);
const ALLOWED_LENGTH_PRESET = new Set<LengthPreset>([
  "extra_short",
  "short",
  "medium",
  "long",
  "extra_long",
]);
const ALLOWED_METHODOLOGY_PRESET = new Set<MethodologyPreset>([
  "pas",
  "aida",
  "bab",
  "jtbd",
]);
const ALLOWED_FOCUS_PRESET = new Set<FocusPreset>(["pain", "neutral", "benefits"]);
const ALLOWED_CTA_TYPE = new Set<CtaType>([
  "initiate_conversation",
  "schedule_meeting",
  "request_introduction",
  "ask_for_feedback",
  "find_time_to_connect",
  "politely_disengage",
  "smart_cta",
  "custom",
]);

function parseGenerationTone(raw: unknown): GenerationTone {
  if (typeof raw === "string" && ALLOWED_GENERATION_TONES.has(raw as GenerationTone)) {
    return raw as GenerationTone;
  }
  return "professional";
}

function parseMentionBlocks(raw: unknown): MentionBlock[] {
  if (!Array.isArray(raw)) return ["conversation_recap", "contact_experience", "company_about"];
  const values = raw.filter((v): v is MentionBlock =>
    typeof v === "string" && ALLOWED_MENTION_BLOCKS.has(v as MentionBlock)
  );
  const unique = [...new Set(values)];
  return unique.length > 0 ? unique : ["conversation_recap", "contact_experience", "company_about"];
}

function parseEnumOrDefault<T extends string>(raw: unknown, allowed: Set<T>, fallback: T): T {
  if (typeof raw === "string" && allowed.has(raw as T)) return raw as T;
  return fallback;
}

function parseGenerationFormat(raw: unknown): { sentences: number; paragraphs: number } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { sentences: 3, paragraphs: 1 };
  }
  const rec = raw as Record<string, unknown>;
  const sentences = Math.min(
    12,
    Math.max(1, Number.isFinite(Number(rec.sentences)) ? Math.floor(Number(rec.sentences)) : 3)
  );
  const paragraphs = Math.min(
    6,
    Math.max(1, Number.isFinite(Number(rec.paragraphs)) ? Math.floor(Number(rec.paragraphs)) : 1)
  );
  return { sentences, paragraphs };
}

/** GET /api/openrouter/models */
export async function handleGetOpenRouterModels(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  try {
    const result = await listOpenRouterModels();
    if (result.error) {
      res.writeHead(500);
      res.end(JSON.stringify({ data: [], error: result.error }));
      return;
    }
    res.writeHead(200);
    res.end(JSON.stringify({ data: result.data }));
  } catch (e) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], error: e instanceof Error ? e.message : String(e) }));
  }
}

/** GET /api/generated-messages?contactId=... */
export async function handleGetGeneratedMessages(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const contactId = params.get("contactId")?.trim() ?? "";
  if (!contactId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing query param: contactId" }));
    return;
  }
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "20", 10) || 20, 1), 100);
  const offset = Math.max(parseInt(params.get("offset") ?? "0", 10) || 0, 0);
  const result = await listGeneratedMessagesByContact(client, contactId, { limit, offset });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], total: 0, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data, total: result.total }));
}

/** GET /api/generated-message-presets?projectId=... */
export async function handleGetGeneratedMessagePresets(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const projectId = getQueryParams(req).get("projectId")?.trim() ?? "";
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing query param: projectId" }));
    return;
  }
  const result = await listGeneratedMessagePresets(client, projectId);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

/** GET /api/generated-message-presets/:id/versions */
export async function handleGetGeneratedMessagePresetVersions(
  req: IncomingMessage,
  res: ServerResponse,
  presetId: string
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const result = await listGeneratedMessagePresetVersions(client, presetId);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

/** POST /api/generated-message-presets/:id/set-default */
export async function handlePostSetGeneratedMessagePresetDefault(
  req: IncomingMessage,
  res: ServerResponse,
  presetId: string
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const result = await setGeneratedMessagePresetDefault(client, presetId);
  if (result.error || !result.data) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error ?? "Failed to set default preset." }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

/** POST /api/generated-message-presets/:id/rollback */
export async function handlePostRollbackGeneratedMessagePreset(
  req: IncomingMessage,
  res: ServerResponse,
  presetId: string
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const current = await getGeneratedMessagePresetById(client, presetId);
  if (current.error || !current.data) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: current.error ?? "Preset not found." }));
    return;
  }
  const body = (await getParsedBody(req)) as { isDefault?: boolean } | undefined;
  const created = await createGeneratedMessagePresetVersion(client, {
    projectId: current.data.project_id,
    name: current.data.name,
    icon: current.data.icon,
    isDefault: body?.isDefault === true || current.data.is_default === true,
    status: "active",
    rawSettings: current.data.raw_settings,
    normalizedSystemPrompt: current.data.normalized_system_prompt,
    normalizedStrategy: current.data.normalized_strategy,
    normalizationModel: current.data.normalization_model,
    normalizationHash: current.data.normalization_hash,
    qualityNotes: { rollbackFromPresetId: current.data.id },
  });
  if (created.error || !created.data) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: created.error ?? "Failed to rollback preset." }));
    return;
  }
  if (body?.isDefault === true || current.data.is_default === true) {
    await setGeneratedMessagePresetDefault(client, created.data.id);
  }
  res.writeHead(201);
  res.end(JSON.stringify({ data: created.data }));
}

/** POST /api/generated-message-presets/save */
export async function handlePostSaveGeneratedMessagePreset(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as
    | {
        projectId?: string;
        name?: string;
        icon?: string | null;
        isDefault?: boolean;
        model?: string;
        settings?: RawPresetSettings;
      }
    | undefined;
  const projectId = body?.projectId?.trim() ?? "";
  const name = body?.name?.trim() ?? "";
  const settings =
    typeof body?.settings === "object" && body?.settings != null
      ? (body.settings as RawPresetSettings)
      : null;
  if (!projectId || !name || settings == null) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "projectId, name, settings are required." }));
    return;
  }
  const hash = normalizationHash(settings);
  const cached = await getGeneratedMessagePresetByHash(client, projectId, name, hash);
  if (cached.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: cached.error }));
    return;
  }
  if (cached.data) {
    const reused = await createGeneratedMessagePresetVersion(client, {
      projectId,
      name,
      icon: body?.icon ?? null,
      isDefault: body?.isDefault === true,
      rawSettings: settings,
      normalizedSystemPrompt: cached.data.normalized_system_prompt,
      normalizedStrategy: cached.data.normalized_strategy,
      normalizationModel: cached.data.normalization_model,
      normalizationHash: cached.data.normalization_hash,
      qualityNotes: { reusedFromPresetId: cached.data.id },
    });
    if (reused.error || !reused.data) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: reused.error ?? "Failed to save preset version." }));
      return;
    }
    if (body?.isDefault === true) {
      await setGeneratedMessagePresetDefault(client, reused.data.id);
    }
    console.log(`[generated-message-presets] reused normalized strategy for ${projectId}/${name}`);
    res.writeHead(201);
    res.end(JSON.stringify({ data: reused.data, reused: true }));
    return;
  }

  const normalized = await normalizePresetWithLlm({
    rawSettings: settings,
    model: body?.model,
  });
  const created = await createGeneratedMessagePresetVersion(client, {
    projectId,
    name,
    icon: body?.icon ?? null,
    isDefault: body?.isDefault === true,
    status: normalized.error ? "failed" : "active",
    rawSettings: settings,
    normalizedSystemPrompt: normalized.strategy.systemPromptCompact,
    normalizedStrategy: normalized.strategy as unknown as Record<string, unknown>,
    normalizationModel: normalized.model,
    normalizationHash: hash,
    qualityNotes: normalized.error ? { normalizationError: normalized.error } : null,
  });
  if (created.error || !created.data) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: created.error ?? "Failed to save preset." }));
    return;
  }
  if (normalized.error) {
    console.warn(
      `[generated-message-presets] normalization fallback used for ${projectId}/${name}: ${normalized.error}`
    );
  } else {
    console.log(`[generated-message-presets] normalized preset saved for ${projectId}/${name}`);
  }
  if (body?.isDefault === true) {
    await setGeneratedMessagePresetDefault(client, created.data.id);
  }
  res.writeHead(201);
  res.end(JSON.stringify({ data: created.data, reused: false, normalizationError: normalized.error ?? null }));
}

/** DELETE /api/generated-messages/:id */
export async function handleDeleteGeneratedMessage(
  req: IncomingMessage,
  res: ServerResponse,
  generatedMessageId: string
): Promise<void> {
  if (req.method !== "DELETE") {
    res.writeHead(405, { Allow: "DELETE" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const result = await deleteGeneratedMessageById(client, generatedMessageId);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true }));
}

/** POST /api/generated-messages/generate */
export async function handlePostGenerateMessage(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as
    | {
        projectId?: string;
        conversationUuid?: string;
        model?: string;
        tone?: GenerationTone;
        format?: { sentences?: number; paragraphs?: number };
        mentionBlocks?: MentionBlock[];
        additionalInstructions?: string;
        messageExamples?: string[];
        hypothesisId?: string | null;
        presetId?: string | null;
        temperature?: number;
        goal?: GenerationGoal;
        ctaStyle?: GenerationCtaStyle;
        personalizationDepth?: PersonalizationDepth;
        readingLevel?: ReadingLevel;
        formality?: FormalityLevel;
        emojiPolicy?: EmojiPolicy;
        questionCountMax?: 0 | 1 | 2;
        readingLevelPreset?: ReadingLevelPreset;
        tonePreset?: TonePreset;
        lengthPreset?: LengthPreset;
        methodology?: MethodologyPreset;
        focus?: FocusPreset;
        ctaType?: CtaType;
      }
    | undefined;
  const projectId = body?.projectId?.trim();
  const conversationUuid = body?.conversationUuid?.trim();
  const model = body?.model?.trim();
  const hypothesisId =
    typeof body?.hypothesisId === "string" && body.hypothesisId.trim()
      ? body.hypothesisId.trim()
      : null;
  const presetId =
    typeof body?.presetId === "string" && body.presetId.trim()
      ? body.presetId.trim()
      : null;
  if (!projectId || !conversationUuid || !model) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "projectId, conversationUuid, and model are required" }));
    return;
  }

  const conv = await getConversation(client, { conversationUuid, messageLimit: 200 });
  if (conv.error) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: conv.error }));
    return;
  }
  const contact = conv.contact ?? null;
  if (!contact) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Conversation has no linked contact." }));
    return;
  }
  const contactIdRaw = contact.uuid;
  const contactId = typeof contactIdRaw === "string" ? contactIdRaw.trim() : "";
  if (!contactId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Contact UUID missing for conversation." }));
    return;
  }
  const companyIdRaw = contact.company_uuid ?? contact.company_id;
  const companyId = typeof companyIdRaw === "string" ? companyIdRaw.trim() : "";
  if (!companyId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Contact is not linked to a company in DB." }));
    return;
  }

  const [{ data: company, error: companyError }, { data: projectCompany, error: projectCompanyError }] =
    await Promise.all([
      client
        .from(COMPANIES_TABLE)
        .select("id,name,domain,website,industry,about,tagline")
        .eq("id", companyId)
        .maybeSingle(),
      client
        .from(PROJECT_COMPANIES_TABLE)
        .select("id")
        .eq("project_id", projectId)
        .eq("company_id", companyId)
        .limit(1)
        .maybeSingle(),
    ]);
  if (companyError) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: companyError.message }));
    return;
  }
  if (projectCompanyError) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: projectCompanyError.message }));
    return;
  }
  const projectCompanyId =
    projectCompany && typeof projectCompany.id === "string" ? projectCompany.id : null;
  if (!projectCompanyId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Company is not attached to selected project." }));
    return;
  }

  const tone = parseGenerationTone(body?.tone);
  const format = parseGenerationFormat(body?.format);
  const mentionBlocks = parseMentionBlocks(body?.mentionBlocks);
  const goal = parseEnumOrDefault(body?.goal, ALLOWED_GOALS, "follow_up");
  const ctaStyle = parseEnumOrDefault(body?.ctaStyle, ALLOWED_CTA_STYLES, "soft");
  const personalizationDepth = parseEnumOrDefault(
    body?.personalizationDepth,
    ALLOWED_PERSONALIZATION_DEPTH,
    "medium"
  );
  const readingLevel = parseEnumOrDefault(body?.readingLevel, ALLOWED_READING_LEVEL, "simple");
  const formality = parseEnumOrDefault(body?.formality, ALLOWED_FORMALITY, "casual");
  const emojiPolicy = parseEnumOrDefault(body?.emojiPolicy, ALLOWED_EMOJI_POLICY, "none");
  const questionCountMaxRaw =
    typeof body?.questionCountMax === "number" && Number.isFinite(body.questionCountMax)
      ? Math.floor(body.questionCountMax)
      : 1;
  const questionCountMax = questionCountMaxRaw <= 0 ? 0 : questionCountMaxRaw >= 2 ? 2 : 1;
  const readingLevelPreset = parseEnumOrDefault(
    body?.readingLevelPreset,
    ALLOWED_READING_LEVEL_PRESET,
    "high_school"
  );
  const tonePreset = parseEnumOrDefault(body?.tonePreset, ALLOWED_TONE_PRESET, "casual");
  const lengthPreset = parseEnumOrDefault(body?.lengthPreset, ALLOWED_LENGTH_PRESET, "medium");
  const methodology = parseEnumOrDefault(body?.methodology, ALLOWED_METHODOLOGY_PRESET, "pas");
  const focus = parseEnumOrDefault(body?.focus, ALLOWED_FOCUS_PRESET, "pain");
  const ctaType = parseEnumOrDefault(body?.ctaType, ALLOWED_CTA_TYPE, "initiate_conversation");
  const temperature =
    typeof body?.temperature === "number" && Number.isFinite(body.temperature)
      ? Math.min(2, Math.max(0, body.temperature))
      : 0.7;
  const messageExamples = Array.isArray(body?.messageExamples)
    ? body.messageExamples
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const prompt = buildGeneratedMessagePrompt({
    tone,
    goal,
    ctaStyle,
    personalizationDepth,
    readingLevel,
    formality,
    emojiPolicy,
    questionCountMax,
    readingLevelPreset,
    tonePreset,
    lengthPreset,
    methodology,
    focus,
    ctaType,
    format,
    mentionBlocks,
    additionalInstructions: typeof body?.additionalInstructions === "string" ? body.additionalInstructions : "",
    messageExamples,
    contact,
    company: (company as Record<string, unknown> | null) ?? null,
    messages: (conv.messages ?? []) as Array<Record<string, unknown>>,
  });
  let normalizedPreset: { id: string; model: string; strategy: Record<string, unknown> } | null = null;
  let resolvedSystemPrompt = prompt.systemPrompt;
  if (presetId != null) {
    const preset = await getGeneratedMessagePresetById(client, presetId);
    if (!preset.error && preset.data && preset.data.status === "active") {
      resolvedSystemPrompt = preset.data.normalized_system_prompt;
      normalizedPreset = {
        id: preset.data.id,
        model: preset.data.normalization_model,
        strategy: preset.data.normalized_strategy,
      };
      console.log(`[generated-message] using normalized preset ${preset.data.id}`);
    }
  }

  const llmRes = await generateOpenRouterMessage({
    model,
    systemPrompt: resolvedSystemPrompt,
    userPrompt: prompt.userPrompt,
    temperature,
    user: `contact:${contactId}`,
    sessionId: `conversation:${conversationUuid}`,
    trace: {
      trace_id: `conversation:${conversationUuid}`,
      trace_name: "Generated Message",
      span_name: "Generate LinkedIn Reply",
      generation_name: "OpenRouter Completion",
      feature: "generated-message",
      project_id: projectId,
      conversation_uuid: conversationUuid,
      contact_id: contactId,
      hypothesis_id: hypothesisId,
      methodology,
      goal,
      cta_type: ctaType,
    },
  });
  if (llmRes.error || !llmRes.data) {
    res.writeHead(502);
    res.end(JSON.stringify({ error: llmRes.error ?? "Generation failed" }));
    return;
  }
  const quality = evaluateGeneratedMessageQuality(llmRes.data.text, {
    tone,
    goal,
    ctaStyle,
    personalizationDepth,
    readingLevel,
    formality,
    emojiPolicy,
    questionCountMax,
    readingLevelPreset,
    tonePreset,
    lengthPreset,
    methodology,
    focus,
    ctaType,
    format,
    mentionBlocks,
    additionalInstructions: typeof body?.additionalInstructions === "string" ? body.additionalInstructions : "",
    messageExamples,
    contact,
    company: (company as Record<string, unknown> | null) ?? null,
    messages: (conv.messages ?? []) as Array<Record<string, unknown>>,
  });

  const insertRes = await createGeneratedMessage(client, {
    hypothesisId,
    contactId,
    projectCompanyId,
    content: llmRes.data.text,
    generationContext: {
      provider: "openrouter",
      provider_run_id: llmRes.data.id,
      provider_model: llmRes.data.model,
      conversation_uuid: conversationUuid,
      temperature,
      preset_id: presetId,
      normalized_preset: normalizedPreset,
      quality,
      ...prompt.contextPayload,
    },
  });
  if (insertRes.error || !insertRes.data) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: insertRes.error ?? "Failed to persist generated message." }));
    return;
  }

  res.writeHead(201);
  res.end(JSON.stringify({
    data: {
      generatedMessage: insertRes.data,
      content: llmRes.data.text,
      model: llmRes.data.model,
    },
  }));
}

export async function handleGetCompanyContext(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const companyId = params.get("company_id") ?? "";
  if (!companyId.trim()) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "company_id is required", data: null }));
    return;
  }
  const result = await listCompanyContextsByCompanyId(client, companyId);
  if (result.error) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: result.error, data: null }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

export async function handleSetCompanyContext(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST" && req.method !== "PUT") {
    res.writeHead(405, { Allow: "POST, PUT" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as { rootContext?: string; company_id?: string | null } | undefined;
  const companyId = body?.company_id != null ? (body.company_id === null ? null : String(body.company_id)) : null;
  const rootContext = body?.rootContext !== undefined ? (body.rootContext === null ? null : String(body.rootContext)) : null;
  if (!companyId || !companyId.trim()) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "company_id is required", data: null }));
    return;
  }
  const result = await addCompanyContextEntry(client, companyId, rootContext);
  if (result.error) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: result.error, data: null }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

/** GET /api/company-context-counts?company_ids=id1,id2,id3 → { data: { [id]: count } } */
export async function handleGetCompanyContextCounts(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const raw = params.get("company_ids") ?? "";
  const companyIds = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const result = await getCompanyContextCounts(client, companyIds);
  if (result.error) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: result.error, data: null }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

export async function handleGetContactContext(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const contactId = params.get("contact_id") ?? "";
  if (!contactId.trim()) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "contact_id is required", data: null }));
    return;
  }
  const result = await listContactContextsByContactId(client, contactId);
  if (result.error) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: result.error, data: null }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

export async function handleSetContactContext(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST" && req.method !== "PUT") {
    res.writeHead(405, { Allow: "POST, PUT" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as { rootContext?: string; contact_id?: string | null } | undefined;
  const contactId = body?.contact_id != null ? (body.contact_id === null ? null : String(body.contact_id)) : null;
  const rootContext = body?.rootContext !== undefined ? (body.rootContext === null ? null : String(body.rootContext)) : null;
  if (!contactId || !contactId.trim()) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "contact_id is required", data: null }));
    return;
  }
  const result = await addContactContextEntry(client, contactId, rootContext);
  if (result.error) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: result.error, data: null }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

/** GET /api/contact-context-counts?contact_ids=id1,id2,id3 → { data: { [id]: count } } */
export async function handleGetContactContextCounts(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const raw = params.get("contact_ids") ?? "";
  const contactIds = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const result = await getContactContextCounts(client, contactIds);
  if (result.error) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: result.error, data: null }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

// --- Project & Sync endpoints ---

export async function handleGetProjects(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const result = await getProjects(client);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

export async function handleUpdateProjectCredentials(
  req: IncomingMessage,
  res: ServerResponse,
  projectId: string
): Promise<void> {
  if (req.method !== "PUT") {
    res.writeHead(405, { Allow: "PUT" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const { data: project } = await getProjectById(client, projectId);
  if (!project) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: `Project not found: ${projectId}` }));
    return;
  }
  const body = (await getParsedBody(req)) as {
    apiKey?: string | null;
    baseUrl?: string | null;
  } | undefined;
  if (!body) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "JSON body required" }));
    return;
  }
  const result = await updateProjectCredentials(client, projectId, {
    apiKey: body.apiKey,
    baseUrl: body.baseUrl,
  });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true }));
}

export async function handleSourceApiCheck(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  let body: unknown;
  try {
    body = await getParsedBody(req);
  } catch {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "JSON body required" }));
    return;
  }
  const b = body as { projectId?: string; baseUrl?: string; apiKey?: string };
  const projectId = b.projectId;
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "projectId is required" }));
    return;
  }
  const { data: project, error: pErr } = await getProjectById(client, projectId);
  if (pErr || !project) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Project not found" }));
    return;
  }
  const baseUrl =
    (b.baseUrl?.trim() || project.source_api_base_url || process.env.SOURCE_API_BASE_URL)?.replace(
      /\/$/,
      ""
    ) ?? "";
  const apiKey = (b.apiKey?.trim() || project.source_api_key || process.env.SOURCE_API_KEY) ?? "";
  if (!baseUrl || !apiKey) {
    res.writeHead(400);
    res.end(
      JSON.stringify({
        error: "Base URL and API key are required (save credentials or enter values to test)",
      })
    );
    return;
  }
  const result = await verifyGetSalesCredentials({ baseUrl, apiKey });
  res.writeHead(200);
  res.end(JSON.stringify(result));
}

export async function handleSyncPreflight(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId");
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing query param: projectId" }));
    return;
  }
  const [countsResult, latestResult, activeRunResult, projectResult] = await Promise.all([
    getProjectEntityCounts(client, projectId),
    getProjectLatestRows(client, projectId, 3),
    getActiveSyncRun(client),
    getProjectById(client, projectId),
  ]);
  if (projectResult.error || !projectResult.data) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Project not found" }));
    return;
  }
  const project = projectResult.data;
  const baseUrl =
    (project.source_api_base_url ?? process.env.SOURCE_API_BASE_URL)?.replace(/\/$/, "") ?? "";
  const apiKey = project.source_api_key ?? process.env.SOURCE_API_KEY ?? "";
  let sourceApiCheck: { ok: boolean; error?: string };
  if (baseUrl && apiKey) {
    const v = await verifyGetSalesCredentials({ baseUrl, apiKey });
    sourceApiCheck = v.ok ? { ok: true } : { ok: false, error: v.error };
  } else {
    sourceApiCheck = {
      ok: false,
      error: "Missing GetSales base URL or API key (configure project or environment variables)",
    };
  }
  res.writeHead(200);
  res.end(JSON.stringify({
    projectId,
    counts: countsResult.counts,
    countsError: countsResult.error ?? undefined,
    latest: latestResult.latest,
    latestError: latestResult.error ?? undefined,
    activeSyncRun: activeRunResult.data
      ? { id: activeRunResult.data.id, project_id: activeRunResult.data.project_id }
      : null,
    sourceApiCheck,
  }));
}

export async function handleSyncStatus(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const { data, error } = await getActiveSyncRun(client);
  if (error) {
    res.writeHead(500);
    res.end(JSON.stringify({ running: false, error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({
    running: data != null,
    activeRun: data
      ? {
          id: data.id,
          started_at: data.started_at,
          project_id: data.project_id,
        }
      : null,
  }));
}

export async function handleSyncHistory(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId") ?? undefined;
  const limitStr = params.get("limit");
  const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 20, 1), 100) : undefined;
  const result = await getSyncHistory(client, { projectId, limit });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

// --- Global companies list + project membership ---

export async function handleGetAllCompanies(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId") ?? undefined;
  const search = params.get("search") ?? undefined;
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "25", 10) || 25, 1), 100);
  const offset = Math.max(parseInt(params.get("offset") ?? "0", 10) || 0, 0);
  const result = await getAllCompanies(client, { search, limit, offset, projectId });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], total: 0, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data, total: result.total }));
}

export async function handleAddCompaniesToProject(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as { projectId?: string; companyIds?: string[] } | undefined;
  if (!body?.projectId || !Array.isArray(body.companyIds) || body.companyIds.length === 0) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Body must include projectId and non-empty companyIds array" }));
    return;
  }
  const result = await addCompaniesToProject(client, body.projectId, body.companyIds);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(201);
  res.end(JSON.stringify({ added: result.data.length, data: result.data }));
}

// --- Companies & Hypotheses endpoints ---

export async function handleGetProjectCompanies(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId");
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing query param: projectId" }));
    return;
  }
  const search = params.get("search") ?? undefined;
  const companyId = params.get("companyId") ?? undefined;
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "25", 10) || 25, 1), 100);
  const offset = Math.max(parseInt(params.get("offset") ?? "0", 10) || 0, 0);
  const result = await getProjectCompanies(client, projectId, { search, limit, offset, companyId });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], total: 0, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data, total: result.total }));
}

export async function handleGetHypotheses(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId");
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing query param: projectId" }));
    return;
  }
  const result = await getHypothesesWithCounts(client, projectId);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

export async function handleCreateHypothesis(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as {
    projectId?: string;
    name?: string;
    description?: string | null;
    targetPersona?: string | null;
  } | undefined;
  if (!body?.projectId || !body?.name) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Body must include projectId and name" }));
    return;
  }
  const result = await createHypothesis(client, {
    projectId: body.projectId,
    name: body.name,
    description: body.description,
    targetPersona: body.targetPersona,
  });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(201);
  res.end(JSON.stringify({ data: result.data }));
}

export async function handleUpdateHypothesis(
  req: IncomingMessage,
  res: ServerResponse,
  hypothesisId: string
): Promise<void> {
  if (req.method !== "PUT") {
    res.writeHead(405, { Allow: "PUT" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as {
    name?: string;
    description?: string | null;
    targetPersona?: string | null;
  } | undefined;
  if (!body) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "JSON body required" }));
    return;
  }
  const result = await updateHypothesis(client, hypothesisId, {
    name: body.name,
    description: body.description,
    targetPersona: body.targetPersona,
  });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true }));
}

export async function handleDeleteHypothesis(
  req: IncomingMessage,
  res: ServerResponse,
  hypothesisId: string
): Promise<void> {
  if (req.method !== "DELETE") {
    res.writeHead(405, { Allow: "DELETE" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const result = await deleteHypothesis(client, hypothesisId);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true }));
}

export async function handleGetHypothesisTargets(
  req: IncomingMessage,
  res: ServerResponse,
  hypothesisId: string
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const result = await getHypothesisTargets(client, hypothesisId);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

export async function handleAddHypothesisTargets(
  req: IncomingMessage,
  res: ServerResponse,
  hypothesisId: string
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as {
    projectCompanyIds?: string[];
    score?: number | null;
  } | undefined;
  if (!body?.projectCompanyIds || !Array.isArray(body.projectCompanyIds) || body.projectCompanyIds.length === 0) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Body must include non-empty projectCompanyIds array" }));
    return;
  }
  const result = await addCompaniesToHypothesis(client, {
    hypothesisId,
    projectCompanyIds: body.projectCompanyIds,
    score: body.score,
  });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(201);
  res.end(JSON.stringify({ ok: true, inserted: body.projectCompanyIds.length }));
}

export async function handleRemoveHypothesisTargets(
  req: IncomingMessage,
  res: ServerResponse,
  hypothesisId: string
): Promise<void> {
  if (req.method !== "DELETE") {
    res.writeHead(405, { Allow: "DELETE" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as { projectCompanyIds?: string[] } | undefined;
  if (!body?.projectCompanyIds || !Array.isArray(body.projectCompanyIds) || body.projectCompanyIds.length === 0) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Body must include non-empty projectCompanyIds array" }));
    return;
  }
  const result = await removeCompaniesFromHypothesis(client, {
    hypothesisId,
    projectCompanyIds: body.projectCompanyIds,
  });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true }));
}

// ── Context Snapshots list ───────────────────────────────────────────────────

export async function handleGetContextSnapshots(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId")?.trim();
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "projectId is required" }));
    return;
  }
  const limit = Math.min(parseInt(params.get("limit") ?? "50", 10) || 50, 200);
  const offset = Math.max(parseInt(params.get("offset") ?? "0", 10) || 0, 0);
  const result = await getContextSnapshots(client, { projectId, limit, offset });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], total: 0, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data, total: result.total }));
}

// ── Build Context ────────────────────────────────────────────────────────────

export async function handleBuildContext(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");

  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }

  const body = (await getParsedBody(req)) as {
    projectId?: string;
    name?: string;
    selectedNodes?: BuildContextNodes;
  } | undefined;

  const projectId = body?.projectId?.trim();
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "projectId is required" }));
    return;
  }

  const selectedNodes: BuildContextNodes = {
    hypotheses: body?.selectedNodes?.hypotheses ?? [],
    companies: body?.selectedNodes?.companies ?? [],
    contacts: body?.selectedNodes?.contacts ?? [],
    conversations: body?.selectedNodes?.conversations ?? [],
  };

  const contextText = await buildReplyContextPrompt(client, projectId, selectedNodes);

  const result = await saveContextSnapshot(client, {
    projectId,
    name: body?.name ?? null,
    nodes: selectedNodes as unknown as Record<string, unknown>,
    contextText,
  });

  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }

  res.writeHead(201);
  res.end(
    JSON.stringify({
      data: {
        id: result.data!.id,
        context_text: result.data!.context_text,
        created_at: result.data!.created_at,
      },
    })
  );
}

// ── Conversations list ────────────────────────────────────────────────────────

export async function handleGetConversationsList(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId");
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing query param: projectId" }));
    return;
  }
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "50", 10) || 50, 1), 200);
  const offset = Math.max(parseInt(params.get("offset") ?? "0", 10) || 0, 0);
  const search = params.get("search")?.trim() ?? "";
  const replyTagRaw = params.get("replyTag")?.trim() ?? "";
  const pipelineStageUuid = params.get("pipelineStageUuid")?.trim() ?? "";
  const allowedTags = new Set<string>(["no_response", "waiting_for_response", "got_response"]);
  const replyTag: ConversationReplyTag | null =
    replyTagRaw && allowedTags.has(replyTagRaw) ? (replyTagRaw as ConversationReplyTag) : null;
  const needAttention = replyTagRaw === "need_attention";

  const result = await getConversationsList(client, projectId, {
    limit,
    offset,
    search: search || null,
    replyTag,
    needAttention,
    pipelineStageUuid: pipelineStageUuid || null,
  });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], total: 0, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data, total: result.total }));
}

/**
 * Aggregated country-level metrics for a project's most recent LinkedIn
 * conversations. Used by the Geo insights tab to render a world map,
 * top-countries bar, and flow→country→reply sankey.
 */
export async function handleProjectConversationGeo(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId")?.trim() ?? "";
  if (!projectId || !PROJECT_ID_RE.test(projectId)) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing or invalid projectId" }));
    return;
  }
  const limit = Math.min(
    Math.max(parseInt(params.get("limit") ?? "500", 10) || 500, 1),
    2000
  );
  const flowUuids = (params.get("flowUuids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((id) => PROJECT_ID_RE.test(id));
  const result = await getProjectConversationGeoAggregates(client, projectId, {
    limit,
    flowUuids,
  });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify(result));
}

export async function handleGetContactPipelineStages(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId");
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing query param: projectId" }));
    return;
  }
  const result = await listContactPipelineStages(client, projectId);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

// ── Company hypotheses ────────────────────────────────────────────────────────

export async function handleGetCompanyHypotheses(
  req: IncomingMessage,
  res: ServerResponse,
  companyId: string
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId");
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing query param: projectId" }));
    return;
  }
  const result = await getCompanyHypotheses(client, companyId, projectId);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], projectCompanyId: null, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data, projectCompanyId: result.projectCompanyId }));
}

// ── Contacts by company ───────────────────────────────────────────────────────

export async function handleGetContactsByCompany(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const companyId = params.get("companyId");
  const projectId = params.get("projectId");
  if (!companyId || !projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing query params: companyId and projectId required" }));
    return;
  }
  const result = await getContactsByCompany(client, companyId, projectId);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

/**
 * POST /api/contacts/find-by-uuid — on-demand rehydrate a single Contacts row by GetSales UUID.
 * Body: { projectId, leadUuid }. Calls GET /leads/api/leads/{uuid}, upserts into Contacts (uuid conflict),
 * returns the stored row so UI can replace `dialogueContact`.
 */
export async function handlePostFindContactByUuid(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as
    | { projectId?: string; leadUuid?: string }
    | undefined;
  const projectId = body?.projectId?.trim() ?? "";
  const leadUuid = body?.leadUuid?.trim() ?? "";
  if (!projectId || !leadUuid) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "projectId and leadUuid are required." }));
    return;
  }
  const { data: project, error: projectErr } = await getProjectById(client, projectId);
  if (projectErr || !project) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: projectErr ?? "Project not found" }));
    return;
  }
  const baseUrl =
    (project.source_api_base_url ?? process.env.SOURCE_API_BASE_URL)?.replace(/\/$/, "") ?? "";
  const apiKey = project.source_api_key ?? process.env.SOURCE_API_KEY ?? "";
  if (!baseUrl || !apiKey) {
    res.writeHead(400);
    res.end(
      JSON.stringify({
        error: "GetSales credentials missing on project and environment.",
      })
    );
    return;
  }
  let fetched: Record<string, unknown> | null = null;
  try {
    fetched = await fetchContactByUuid({ baseUrl, apiKey }, leadUuid);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.writeHead(502);
    res.end(JSON.stringify({ error: `GetSales request failed: ${message}` }));
    return;
  }
  if (!fetched) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Contact not found in GetSales.", notFound: true }));
    return;
  }
  const mapped = mapContactForSupabase(fetched);
  if (typeof mapped.uuid !== "string" || !mapped.uuid) {
    mapped.uuid = leadUuid;
  }
  mapped.project_id = projectId;
  const { error: upsertErr } = await client
    .from(CONTACTS_TABLE)
    .upsert([mapped], { onConflict: "uuid" });
  if (upsertErr) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: `Failed to store contact: ${upsertErr.message}` }));
    return;
  }
  const { data: stored, error: selectErr } = await client
    .from(CONTACTS_TABLE)
    .select("*")
    .eq("uuid", mapped.uuid as string)
    .maybeSingle();
  if (selectErr) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: selectErr.message }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: stored ?? mapped }));
}

// ── Create company ────────────────────────────────────────────────────────────

export async function handleCreateCompany(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as { name?: string; domain?: string | null } | undefined;
  if (!body?.name?.trim()) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Body must include name" }));
    return;
  }
  const result = await createCompany(client, { name: body.name.trim(), domain: body.domain ?? null });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(201);
  res.end(JSON.stringify({ id: result.id }));
}

// ── Get companies by IDs ─────────────────────────────────────────────────────

export async function handleGetCompaniesByIds(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const ids = params.getAll("ids[]").concat(
    (params.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
  );
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) {
    res.writeHead(200);
    res.end(JSON.stringify({ data: [] }));
    return;
  }
  const result = await getCompaniesByIds(client, unique);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

// ── Patch contact company ────────────────────────────────────────────────────

export async function handlePatchContactCompany(
  req: IncomingMessage,
  res: ServerResponse,
  contactId: string
): Promise<void> {
  if (req.method !== "PATCH") {
    res.writeHead(405, { Allow: "PATCH" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as { companyId?: string; companyName?: string | null } | undefined;
  if (!body?.companyId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Body must include companyId" }));
    return;
  }
  const result = await updateContactCompany(client, contactId, body.companyId, body.companyName ?? null);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true }));
}

// ── Enrichment table API ─────────────────────────────────────────────────────

function parseEnrichmentEntityType(raw: string | null): EnrichmentEntityType | null {
  if (raw === "company" || raw === "contact") return raw;
  return null;
}

/** GET /api/enrichment/agents?entityType=company|contact */
export async function handleGetEnrichmentAgents(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const entityType = parseEnrichmentEntityType(params.get("entityType"));
  if (!entityType) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing or invalid query: entityType (company|contact)" }));
    return;
  }
  const result = await listEnrichmentAgentsForEntityType(client, entityType);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

/** GET /api/contact-lists?projectId= — ContactLists rows for dropdowns (synced from GetSales). */
export async function handleGetContactLists(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId")?.trim();
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing query param: projectId" }));
    return;
  }
  const result = await listContactListsForProject(client, projectId);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error, data: [] }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

/** GET /api/getsales-tags?projectId= — GetSalesTags rows (synced from GetSales). */
export async function handleGetGetSalesTags(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId")?.trim();
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing query param: projectId" }));
    return;
  }
  const result = await listGetSalesTagsForProject(client, projectId);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error, data: [] }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

/** POST /api/getsales-tags/mark-hypothesis — body: { projectId, tagUuids: string[] } */
export async function handlePostMarkGetSalesTagsAsHypotheses(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as {
    projectId?: string;
    tagUuids?: string[];
  } | undefined;
  const projectId = body?.projectId?.trim();
  const tagUuids = Array.isArray(body?.tagUuids) ? body!.tagUuids : [];
  if (!projectId || tagUuids.length === 0) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Body must include projectId and non-empty tagUuids" }));
    return;
  }
  const result = await markGetSalesTagsAsHypotheses(client, projectId, tagUuids);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ created: result.created, skipped: result.skipped }));
}

/** POST /api/getsales-tags/unmark-hypothesis — body: { projectId, tagUuids: string[] } */
export async function handlePostUnmarkGetSalesTagsAsHypotheses(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as {
    projectId?: string;
    tagUuids?: string[];
  } | undefined;
  const projectId = body?.projectId?.trim();
  const tagUuids = Array.isArray(body?.tagUuids) ? body!.tagUuids : [];
  if (!projectId || tagUuids.length === 0) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Body must include projectId and non-empty tagUuids" }));
    return;
  }
  const result = await unmarkGetSalesTagsAsHypotheses(client, projectId, tagUuids);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true }));
}

/** GET /api/hypotheses/:id/tag-contacts — contacts whose company/contact tags match the linked GetSales tag name. */
export async function handleGetHypothesisTagContacts(
  req: IncomingMessage,
  res: ServerResponse,
  hypothesisId: string
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const result = await getHypothesisTagContacts(client, hypothesisId);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], tagName: null, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data, tagName: result.tagName }));
}

/** GET /api/enrichment-table?entityType=company|contact&projectId=...&limit=&offset=&listUuid= */
export async function handleGetEnrichmentTable(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const entityType = parseEnrichmentEntityType(params.get("entityType"));
  const projectId = params.get("projectId")?.trim();
  if (!entityType || !projectId) {
    res.writeHead(400);
    res.end(
      JSON.stringify({
        error: "Missing or invalid query: entityType (company|contact) and projectId are required",
      })
    );
    return;
  }
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "25", 10) || 25, 1), 100);
  const offset = Math.max(parseInt(params.get("offset") ?? "0", 10) || 0, 0);
  const listUuidRaw = params.get("listUuid")?.trim();
  const listUuid = listUuidRaw ? listUuidRaw : null;
  const result = await getEnrichmentTableData(client, projectId, entityType, limit, offset, listUuid);
  if (result.error) {
    res.writeHead(500);
    res.end(
      JSON.stringify({
        total: 0,
        agentNames: [],
        rows: [],
        error: result.error,
      })
    );
    return;
  }
  res.writeHead(200);
  res.end(
    JSON.stringify({
      total: result.total,
      agentNames: result.agentNames,
      rows: result.rows,
    })
  );
}

/** POST /api/enrichment/enqueue */
export async function handlePostEnrichmentEnqueue(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as
    | {
        projectId?: string;
        entityType?: string;
        agentName?: string;
        companyIds?: string[];
        contactIds?: string[];
        operationName?: string | null;
        meta?: Record<string, unknown> | null;
      }
    | undefined;
  const projectId = body?.projectId?.trim();
  const entityType = parseEnrichmentEntityType(
    body?.entityType != null ? String(body.entityType) : null
  );
  const agentName = body?.agentName?.trim();
  if (!projectId || !entityType || !agentName) {
    res.writeHead(400);
    res.end(
      JSON.stringify({
        error: "Body must include projectId, entityType (company|contact), and agentName",
      })
    );
    return;
  }
  if (isBatchWorkerEnabled()) {
    try {
      const created = await createBatchWorkerJobFromEnrichment({
        projectId,
        entityType,
        agentName,
        companyIds: body?.companyIds,
        contactIds: body?.contactIds,
        operationName: body?.operationName,
        meta: body?.meta,
      });
      res.writeHead(201);
      res.end(JSON.stringify({ inserted: created.inserted, batchJobId: created.jobId || null }));
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to enqueue batch job";
      res.writeHead(502);
      res.end(JSON.stringify({ error: message, inserted: 0 }));
      return;
    }
  }
  const enqueueResult = await enqueueEnrichmentTasks(client, {
    projectId,
    entityType,
    agentName,
    companyIds: body?.companyIds,
    contactIds: body?.contactIds,
    operationName: body?.operationName,
    meta: body?.meta,
  });
  if (enqueueResult.error) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: enqueueResult.error, inserted: 0 }));
    return;
  }
  res.writeHead(201);
  res.end(JSON.stringify({ inserted: enqueueResult.inserted }));
}

/** GET /api/enrichment/agents/registry — all agents (admin). */
export async function handleGetEnrichmentAgentsRegistry(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const result = await listAllEnrichmentAgents(client);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data }));
}

/** POST /api/enrichment/agents/registry — create agent. */
export async function handlePostEnrichmentAgent(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as
    | {
        name?: string;
        entity_type?: string;
        operation_name?: string | null;
        prompt?: string;
        batch_size?: number;
        is_active?: boolean;
      }
    | undefined;
  const result = await createEnrichmentAgent(client, {
    name: body?.name ?? "",
    entity_type: body?.entity_type ?? "",
    operation_name: body?.operation_name,
    prompt: body?.prompt,
    batch_size: body?.batch_size,
    is_active: body?.is_active,
  });
  if (result.error) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(201);
  res.end(JSON.stringify({ ok: true }));
}

/** PUT /api/enrichment/agents/registry — update agent by name. */
export async function handlePutEnrichmentAgent(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "PUT") {
    res.writeHead(405, { Allow: "PUT" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as
    | {
        name?: string;
        entity_type?: string;
        operation_name?: string | null;
        prompt?: string;
        batch_size?: number;
        is_active?: boolean;
      }
    | undefined;
  const name = body?.name?.trim();
  if (!name) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Body must include name" }));
    return;
  }
  const result = await updateEnrichmentAgent(client, name, {
    entity_type: body?.entity_type,
    operation_name: body?.operation_name,
    prompt: body?.prompt,
    batch_size: body?.batch_size,
    is_active: body?.is_active,
  });
  if (result.error) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true }));
}

/** GET /api/enrichment/queue?projectId=&limit=&offset=&status= */
export async function handleGetEnrichmentQueue(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId")?.trim();
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "projectId is required" }));
    return;
  }
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "25", 10) || 25, 1), 100);
  const offset = Math.max(parseInt(params.get("offset") ?? "0", 10) || 0, 0);
  const status = params.get("status")?.trim() || null;
  if (isBatchWorkerEnabled()) {
    try {
      const result = await listLegacyQueueFromBatchWorker(projectId);
      const rows = status ? result.data.filter((row) => row.status === status) : result.data;
      const paged = rows.slice(offset, offset + limit);
      res.writeHead(200);
      res.end(JSON.stringify({ data: paged, total: rows.length }));
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read batch worker queue";
      res.writeHead(502);
      res.end(JSON.stringify({ data: [], total: 0, error: message }));
      return;
    }
  }
  const result = await listEnrichmentQueueTasksForProject(client, projectId, {
    limit,
    offset,
    status,
  });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], total: 0, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data, total: result.total }));
}

/** GET /api/enrichment/runs?projectId=&limit=&offset=&status= */
export async function handleGetEnrichmentRunsList(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId")?.trim();
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "projectId is required" }));
    return;
  }
  const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "25", 10) || 25, 1), 100);
  const offset = Math.max(parseInt(params.get("offset") ?? "0", 10) || 0, 0);
  const status = params.get("status")?.trim() || null;
  if (isBatchWorkerEnabled()) {
    try {
      const result = await listLegacyRunsFromBatchWorker(projectId);
      const rows = status ? result.data.filter((row) => row.status === status) : result.data;
      const paged = rows.slice(offset, offset + limit);
      res.writeHead(200);
      res.end(JSON.stringify({ data: paged, total: rows.length }));
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read batch worker runs";
      res.writeHead(502);
      res.end(JSON.stringify({ data: [], total: 0, error: message }));
      return;
    }
  }
  const result = await listEnrichmentAgentRunsForProject(client, projectId, {
    limit,
    offset,
    status,
  });
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ data: [], total: 0, error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ data: result.data, total: result.total }));
}

/** GET /api/enrichment/batch?batchId=&projectId= (optional project check) */
export async function handleGetEnrichmentBatchDetail(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const batchId = params.get("batchId")?.trim();
  if (!batchId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "batchId is required" }));
    return;
  }
  const projectId = params.get("projectId")?.trim() ?? null;
  if (isBatchWorkerEnabled()) {
    try {
      const detail = await getLegacyBatchDetailFromBatchWorker(batchId);
      if (!detail) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "Batch not found" }));
        return;
      }
      if (projectId && typeof detail.batch.project_id === "string" && detail.batch.project_id !== projectId) {
        res.writeHead(403);
        res.end(JSON.stringify({ error: "batch does not belong to this project" }));
        return;
      }
      res.writeHead(200);
      res.end(JSON.stringify(detail));
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read batch detail";
      res.writeHead(502);
      res.end(JSON.stringify({ error: message }));
      return;
    }
  }
  const result = await getEnrichmentBatchDetail(client, batchId);
  if (result.error) {
    const notFound = result.error === "Batch not found";
    res.writeHead(notFound ? 404 : 500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  if (!result.data) {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Batch not found" }));
    return;
  }
  if (projectId && result.data.batch.project_id !== projectId) {
    res.writeHead(403);
    res.end(JSON.stringify({ error: "batch does not belong to this project" }));
    return;
  }
  res.writeHead(200);
  res.end(
    JSON.stringify({
      batch: result.data.batch,
      runs: result.data.runs,
    })
  );
}

/** POST /api/enrichment/stop — body: { projectId, queueTaskId } */
export async function handlePostEnrichmentStop(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as
    | { projectId?: string; queueTaskId?: string }
    | undefined;
  const projectId = body?.projectId?.trim();
  const queueTaskId = body?.queueTaskId?.trim();
  if (!projectId || !queueTaskId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "projectId and queueTaskId are required" }));
    return;
  }
  if (isBatchWorkerEnabled()) {
    try {
      await cancelBatchWorkerJob(queueTaskId);
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Stop failed";
      res.writeHead(400);
      res.end(JSON.stringify({ error: message }));
      return;
    }
  }
  const result = await stopEnrichmentQueueTask(client, projectId, queueTaskId);
  if (!result.ok) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: result.error ?? "Stop failed" }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true }));
}

/** POST /api/enrichment/restart — body: { projectId, queueTaskId } */
export async function handlePostEnrichmentRestart(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const body = (await getParsedBody(req)) as
    | { projectId?: string; queueTaskId?: string }
    | undefined;
  const projectId = body?.projectId?.trim();
  const queueTaskId = body?.queueTaskId?.trim();
  if (!projectId || !queueTaskId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "projectId and queueTaskId are required" }));
    return;
  }
  if (isBatchWorkerEnabled()) {
    try {
      await retryBatchWorkerJob(queueTaskId);
      res.writeHead(201);
      res.end(JSON.stringify({ ok: true, newTaskId: queueTaskId }));
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Restart failed";
      res.writeHead(400);
      res.end(JSON.stringify({ error: message }));
      return;
    }
  }
  const result = await restartEnrichmentQueueTask(client, projectId, queueTaskId);
  if (!result.ok) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: result.error ?? "Restart failed" }));
    return;
  }
  res.writeHead(201);
  res.end(JSON.stringify({ ok: true, newTaskId: result.newTaskId }));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** POST /api/workers/heartbeat — JSON body from worker processes. */
export async function handlePostWorkerHeartbeat(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  if (!isWorkerHeartbeatAuthOk(req)) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  const raw = await getParsedBody(req);
  if (!isRecord(raw)) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "JSON body required" }));
    return;
  }
  const workerId = parseString(raw.workerId);
  const name = parseString(raw.name);
  const kind = parseString(raw.kind) ?? "unknown";
  const statusRaw = parseString(raw.status);
  if (!workerId || !name) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "workerId and name are required" }));
    return;
  }
  const status =
    statusRaw === "idle" || statusRaw === "busy" || statusRaw === "stopping" ? statusRaw : "idle";

  let tasksInProgress: WorkerHeartbeatPayload["tasksInProgress"];
  if (Array.isArray(raw.tasksInProgress)) {
    tasksInProgress = [];
    for (const item of raw.tasksInProgress) {
      if (!isRecord(item)) continue;
      const taskId = parseString(item.taskId);
      const agentName = parseString(item.agentName);
      if (!taskId || !agentName) continue;
      const operationName =
        item.operationName === null || item.operationName === undefined
          ? undefined
          : typeof item.operationName === "string"
            ? item.operationName
            : String(item.operationName);
      tasksInProgress.push({ taskId, agentName, operationName });
    }
  }

  let pendingBatches: WorkerPendingBatchProgress[] | undefined;
  if (Array.isArray(raw.pendingBatches)) {
    pendingBatches = [];
    for (const item of raw.pendingBatches) {
      if (!isRecord(item)) continue;
      const agentName = parseString(item.agentName);
      const count = typeof item.count === "number" && Number.isFinite(item.count) ? item.count : 0;
      const batchSize =
        typeof item.batchSize === "number" && Number.isFinite(item.batchSize) ? item.batchSize : 1;
      const waitingSince =
        typeof item.waitingSince === "string" && item.waitingSince.trim()
          ? item.waitingSince.trim()
          : "";
      if (!agentName || !waitingSince) continue;
      pendingBatches.push({
        agentName,
        count: Math.max(0, Math.floor(count)),
        batchSize: Math.max(1, Math.floor(batchSize)),
        waitingSince,
      });
    }
  }

  let runtime: Record<string, string | number> | undefined;
  if (isRecord(raw.runtime)) {
    const out: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(raw.runtime)) {
      if (k.length > 80) continue;
      if (typeof v === "string" || typeof v === "number") {
        if (typeof v === "number" && !Number.isFinite(v)) continue;
        out[k] = v;
      }
    }
    if (Object.keys(out).length > 0) runtime = out;
  }

  const payload: WorkerHeartbeatPayload = {
    workerId,
    name,
    kind,
    status,
    tasksInProgress,
    pendingBatches,
    runtime,
  };
  await persistWorkerPresenceToSupabase(payload);
  recordWorkerHeartbeat(payload);
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true }));
}

/** GET /api/workers — recent worker heartbeats (for UI). */
export async function handleGetWorkers(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  res.writeHead(200);
  try {
    const snap = await getWorkersUiSnapshot();
    res.end(JSON.stringify(snap));
  } catch {
    res.end(JSON.stringify(getActiveWorkers()));
  }
}

function parseEntityTypeForPromptArg(raw: string | undefined): PromptEntityType {
  if (raw === "company" || raw === "contact" || raw === "both") return raw;
  return "both";
}

/** GET /api/enrichment/prompt-settings?projectId=uuid */
export async function handleGetEnrichmentPromptSettings(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.writeHead(405, { Allow: "GET" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const params = getQueryParams(req);
  const projectId = params.get("projectId")?.trim();
  if (!projectId) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Missing query: projectId" }));
    return;
  }
  const [effective, projectRowRes, globalRowRes] = await Promise.all([
    getEnrichmentPromptSettingsEffective(client, projectId),
    getEnrichmentPromptSettingsRow(client, projectId),
    getEnrichmentPromptSettingsRow(client, null),
  ]);
  if (projectRowRes.error || globalRowRes.error) {
    res.writeHead(500);
    res.end(
      JSON.stringify({
        error: projectRowRes.error ?? globalRowRes.error ?? "Failed to load prompt settings rows",
      })
    );
    return;
  }
  res.writeHead(200);
  res.end(
    JSON.stringify({
      effective,
      projectRow: projectRowRes.data,
      globalRow: globalRowRes.data,
    })
  );
}

/** PATCH /api/enrichment/prompt-settings — body: { projectId: string | null, global_prompt_prefix?, global_prompt_suffix?, companies_placeholder_config? } */
export async function handlePatchEnrichmentPromptSettings(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "PATCH") {
    res.writeHead(405, { Allow: "PATCH" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const raw = await getParsedBody(req);
  if (!isRecord(raw)) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "JSON body required" }));
    return;
  }
  const projectIdRaw = raw.projectId;
  const projectId =
    projectIdRaw === null
      ? null
      : typeof projectIdRaw === "string"
        ? projectIdRaw.trim() || null
        : undefined;
  if (projectId === undefined) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "projectId is required (null for global row)" }));
    return;
  }
  const patch: {
    global_prompt_prefix?: string;
    global_prompt_suffix?: string;
    companies_placeholder_config?: Record<string, unknown>;
    prompt_profiles?: Record<string, unknown>;
  } = {};
  if (typeof raw.global_prompt_prefix === "string") {
    patch.global_prompt_prefix = raw.global_prompt_prefix;
  }
  if (typeof raw.global_prompt_suffix === "string") {
    patch.global_prompt_suffix = raw.global_prompt_suffix;
  }
  if (raw.companies_placeholder_config !== undefined) {
    if (!isRecord(raw.companies_placeholder_config)) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "companies_placeholder_config must be an object" }));
      return;
    }
    patch.companies_placeholder_config = raw.companies_placeholder_config;
  }
  if (raw.prompt_profiles !== undefined) {
    if (!isRecord(raw.prompt_profiles)) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "prompt_profiles must be an object" }));
      return;
    }
    patch.prompt_profiles = raw.prompt_profiles;
  }
  if (Object.keys(patch).length === 0) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "No fields to update" }));
    return;
  }
  const result = await upsertEnrichmentPromptSettings(client, projectId, patch);
  if (result.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: result.error }));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true, row: result.data }));
}

/** POST /api/enrichment/prompt-preview — resolved prompt using same pipeline as the worker (company entities). */
export async function handlePostEnrichmentPromptPreview(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  const client = getSupabase();
  if (!client) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }
  const raw = await getParsedBody(req);
  if (!isRecord(raw)) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "JSON body required" }));
    return;
  }
  const projectId = parseString(raw.projectId);
  const prompt = typeof raw.prompt === "string" ? raw.prompt : "";
  const agentName = parseString(raw.agentName);
  const batchSize = Math.max(
    1,
    Math.min(100, Number.parseInt(String(raw.batchSize ?? "1"), 10) || 1)
  );
  const rowKind = raw.rowKind === "contact" ? "contact" : "company";
  if (!projectId || !agentName) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "projectId and agentName are required" }));
    return;
  }
  const companyIdsRaw = raw.companyIds;
  const companyIds = Array.isArray(companyIdsRaw)
    ? companyIdsRaw
        .filter((x): x is string => typeof x === "string" && x.length > 0)
        .slice(0, 40)
    : [];

  if (rowKind === "company" && companyIds.length === 0) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "companyIds (non-empty array) required when rowKind is company" }));
    return;
  }

  const { data: agentRow } = await getEnrichmentAgentByName(client, agentName);
  const entityType = parseEntityTypeForPromptArg(agentRow?.entity_type);

  const systemPromptType =
    typeof raw.systemPromptType === "string" ? raw.systemPromptType.trim() : "";
  const settings = await getEnrichmentPromptSettingsEffective(
    client,
    projectId,
    systemPromptType || undefined
  );

  if (rowKind === "contact") {
    res.writeHead(400);
    res.end(
      JSON.stringify({
        error: "Contact preview is not implemented; use the table preview for contact rows.",
      })
    );
    return;
  }

  const assembled = await buildCompanyEntitiesForPrompt(
    client,
    projectId,
    companyIds,
    settings.companies_placeholder_config
  );
  if (assembled.error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: assembled.error }));
    return;
  }
  const entities = assembled.entities;
  const refId = companyIds[0] ?? "";
  const agentResultsByAgentName = refId
    ? (await getEnrichmentAgentResultsMapForEntity(client, projectId, "company", refId)).data
    : {};

  const resolvedPrompt = resolvePromptForBatch(prompt, entities, {
    batchSize,
    entityType,
    rowKind: "company",
    agentResultsByAgentName,
  });
  const finalPrompt = `${settings.global_prompt_prefix}${resolvedPrompt}${settings.global_prompt_suffix}`;

  res.writeHead(200);
  res.end(
    JSON.stringify({
      resolvedPrompt,
      finalPrompt,
      entityCount: entities.length,
    })
  );
}

/** POST /api/enrichment/worker-batch-event — worker notifies UI that a batch run is starting (same auth as worker heartbeat). */
export async function handlePostEnrichmentWorkerBatchEvent(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }
  res.setHeader("Content-Type", "application/json");
  if (!isWorkerHeartbeatAuthOk(req)) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  const raw = await getParsedBody(req);
  if (!isRecord(raw)) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "JSON body required" }));
    return;
  }
  const projectId = parseString(raw.projectId);
  const agentName = parseString(raw.agentName);
  const workerName = parseString(raw.workerName) ?? null;
  if (!projectId || !agentName) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "projectId and agentName are required" }));
    return;
  }
  const itemsRaw = raw.items;
  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "items must be a non-empty array" }));
    return;
  }
  const items: Array<{ taskId: string; companyId: string | null; contactId: string | null }> = [];
  for (const el of itemsRaw) {
    if (!isRecord(el)) continue;
    const taskId = parseString(el.taskId);
    if (!taskId) continue;
    const companyId =
      el.companyId === undefined
        ? null
        : typeof el.companyId === "string"
          ? el.companyId
          : null;
    const contactId =
      el.contactId === undefined
        ? null
        : typeof el.contactId === "string"
          ? el.contactId
          : null;
    if (!companyId && !contactId) continue;
    items.push({ taskId, companyId, contactId });
  }
  if (items.length === 0) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: "no valid items" }));
    return;
  }
  broadcastEnrichmentBatchStarted({ projectId, agentName, workerName, items });
  res.writeHead(200);
  res.end(JSON.stringify({ ok: true, broadcast: items.length }));
}

/**
 * POST /api/webhooks/fireflies — Fireflies.ai transcription / lifecycle webhooks.
 * @see docs/fireflies-webhooks.md
 */
export async function handleFirefliesWebhook(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "POST") {
    res.writeHead(405, { Allow: "POST" });
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const client = getSupabase();
  if (!client) {
    console.error("[fireflies] webhook: Supabase not configured");
    res.writeHead(500);
    res.end(JSON.stringify({ error: "Supabase not configured" }));
    return;
  }

  const rawUtf8 = await getRawBody(req);
  if (!rawUtf8.trim()) {
    console.warn("[fireflies] webhook: empty body");
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Empty body" }));
    return;
  }

  const secret = process.env.FIREFLIES_WEBHOOK_SECRET?.trim();
  const sigHeader =
    (req.headers["x-hub-signature"] as string | undefined) ??
    (req.headers["X-Hub-Signature"] as string | undefined);

  let signatureValid: boolean | null = null;
  if (secret) {
    if (!verifyFirefliesHubSignature(rawUtf8, sigHeader, secret)) {
      console.warn("[fireflies] webhook: invalid signature");
      res.writeHead(401);
      res.end(JSON.stringify({ error: "Invalid webhook signature" }));
      return;
    }
    signatureValid = true;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawUtf8) as unknown;
  } catch {
    console.warn("[fireflies] webhook: invalid JSON");
    res.writeHead(400);
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }
  if (!isRecord(parsed)) {
    console.warn("[fireflies] webhook: JSON must be an object");
    res.writeHead(400);
    res.end(JSON.stringify({ error: "JSON must be an object" }));
    return;
  }

  const normalized = normalizeFirefliesPayload(parsed);
  const { id, error: insErr } = await insertFirefliesWebhookEvent(client, {
    payload_variant: normalized.payloadVariant,
    event_type: normalized.eventType,
    meeting_id: normalized.meetingId,
    client_reference_id: normalized.clientReferenceId,
    fireflies_timestamp_ms: normalized.firefliesTimestampMs,
    payload: parsed,
    signature_header: sigHeader ?? null,
    signature_valid: signatureValid,
    processing_status: "received",
  });

  if (insErr || !id) {
    console.error("[fireflies] webhook: insert failed", insErr ?? "no id");
    res.writeHead(500);
    res.end(JSON.stringify({ error: insErr ?? "Insert failed" }));
    return;
  }

  console.log(
    "[fireflies] webhook stored",
    JSON.stringify({
      id,
      variant: normalized.payloadVariant,
      event: normalized.eventType,
      meeting_id: normalized.meetingId,
    })
  );

  res.writeHead(200);
  res.end(JSON.stringify({ ok: true, id }));

  const forwardUrl = process.env.FIREFLIES_CONTEXT_AGENT_WEBHOOK_URL?.trim();
  if (forwardUrl && isTranscriptReadyEvent(normalized)) {
    const job = buildContextAgentJob(id, normalized, parsed);
    console.log("[fireflies] forwarding to context agent", { id, url: forwardUrl });
    setImmediate(() => {
      void (async () => {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        const bearer = process.env.FIREFLIES_CONTEXT_AGENT_WEBHOOK_BEARER?.trim();
        if (bearer) headers.Authorization = `Bearer ${bearer}`;
        try {
          const r = await fetch(forwardUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(job),
          });
          if (!r.ok) {
            const t = await r.text().catch(() => "");
            throw new Error(`HTTP ${r.status} ${t.slice(0, 500)}`);
          }
          await updateFirefliesWebhookEventProcessing(client, id, {
            processing_status: "context_agent_queued",
          });
          console.log("[fireflies] context agent OK", { id, status: r.status });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[fireflies] context agent failed", { id, error: msg });
          await updateFirefliesWebhookEventProcessing(client, id, {
            processing_status: "context_agent_error",
            context_agent_error: msg,
          });
        }
      })();
    });
  } else if (forwardUrl && !isTranscriptReadyEvent(normalized)) {
    console.log("[fireflies] skip context agent (not transcript-ready event)", {
      id,
      event: normalized.eventType,
    });
  }
}
