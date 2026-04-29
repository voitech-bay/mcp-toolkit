import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FLOWS_TABLE,
  PIPEDRIVE_DEAL_FIELDS_TABLE,
  PIPEDRIVE_DEALS_TABLE,
  PIPEDRIVE_RELATED_OBJECTS_TABLE,
  getCollectedAnalyticsDays,
} from "./supabase.js";
import {
  aggregateMetricsByFlow,
  emptyMetrics,
  finalizeRates,
  type FunnelMetrics,
} from "./analytics-funnel.js";
import type {
  ProjectAnalyticsDashboardFlow,
  ProjectAnalyticsPipelineStage,
} from "./analytics-funnel.js";

type StageMeta = {
  stageUuid: string;
  stageName: string;
  stageOrder: number | null;
  /** Pipedrive pipeline id (string) when present; empty when unknown. */
  pipelineId: string;
};

export interface ProjectTotalAnalyticsPayload {
  flows: ProjectAnalyticsDashboardFlow[];
  pipelineStages: ProjectAnalyticsPipelineStage[];
  warnings: string[];
  error: string | null;
}

/** GetSales (LinkedIn) first in combined alluvial; use these `stageUuid` values in `pipelineStageBreakdown` never — only as column keys on the client. */
export const GETSALES_TOTAL_STAGES: ProjectAnalyticsPipelineStage[] = [
  { stageUuid: "__gs:connectionSent", stageName: "Connection request sent", stageOrder: 0, source: "getsales" },
  { stageUuid: "__gs:connectionAccepted", stageName: "Connection accepted", stageOrder: 1, source: "getsales" },
  { stageUuid: "__gs:inbox", stageName: "Inbox (new)", stageOrder: 2, source: "getsales" },
  { stageUuid: "__gs:positiveReplies", stageName: "Positive replies", stageOrder: 3, source: "getsales" },
];

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function normalizeNonEmptyString(raw: unknown): string | null {
  if (typeof raw === "string") {
    const s = raw.trim();
    return s.length > 0 ? s : null;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) return String(raw);
  return null;
}

function normalizeStageId(raw: unknown): string | null {
  return normalizeNonEmptyString(raw);
}

function normalizeCampaign(raw: unknown): string | null {
  if (typeof raw === "string") {
    const s = raw.trim();
    return s.length > 0 ? s : null;
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    return normalizeNonEmptyString(obj.name) ?? normalizeNonEmptyString(obj.value);
  }
  return normalizeNonEmptyString(raw);
}

function intOrNull(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.trunc(raw);
  if (typeof raw === "string" && /^-?\d+$/.test(raw.trim())) return parseInt(raw, 10);
  return null;
}

function stageNameFromPayload(payload: Record<string, unknown>, stageId: string): string {
  return (
    normalizeNonEmptyString(payload.name) ??
    normalizeNonEmptyString(payload.title) ??
    `Stage ${stageId}`
  );
}

function stageOrderFromPayload(payload: Record<string, unknown>): number | null {
  return (
    intOrNull(payload.order_nr) ??
    intOrNull(payload.order) ??
    intOrNull(payload.stage_order) ??
    null
  );
}

function stagePipelineIdFromPayload(payload: Record<string, unknown>): string {
  const direct =
    normalizeNonEmptyString(payload.pipeline_id) ?? normalizeNonEmptyString(payload.pipelineId);
  if (direct) return direct;
  const n = intOrNull(payload.pipeline_id) ?? intOrNull(payload.pipelineId);
  return n == null ? "" : String(n);
}

/**
 * Cumulative deal counts: a deal in stage S (order O) adds +1 to S and to every stage
 * in the same pipeline with order < O (Pipedrive `order_nr`).
 */
function bumpCumulative(
  byStage: Map<string, number>,
  pipelineId: string,
  stageId: string,
  stageOrder: number | null,
  pipelineToSortedOrders: Map<string, number[]>,
  orderToStageIds: Map<string, string[]>
): void {
  byStage.set(stageId, (byStage.get(stageId) ?? 0) + 1);
  if (stageOrder == null) return;
  const pKey = pipelineId || "";
  const orders = pipelineToSortedOrders.get(pKey);
  if (!orders || orders.length === 0) return;
  for (const o of orders) {
    if (o >= stageOrder) break;
    const ids = orderToStageIds.get(`${pKey}::${o}`) ?? [];
    for (const id of ids) {
      if (!id) continue;
      byStage.set(id, (byStage.get(id) ?? 0) + 1);
    }
  }
}

function buildOrderIndexes(stages: Map<string, StageMeta>): {
  pipelineToSortedOrders: Map<string, number[]>;
  orderToStageIds: Map<string, string[]>;
} {
  const byPipeOrder = new Map<string, Set<number>>();
  for (const s of stages.values()) {
    if (s.stageOrder == null) continue;
    const p = s.pipelineId || "";
    if (!byPipeOrder.has(p)) byPipeOrder.set(p, new Set());
    byPipeOrder.get(p)!.add(s.stageOrder);
  }
  const pipelineToSortedOrders = new Map<string, number[]>();
  for (const [pipe, set] of byPipeOrder) {
    pipelineToSortedOrders.set(pipe, [...set].sort((a, b) => a - b));
  }
  const orderToStageIds = new Map<string, string[]>();
  for (const s of stages.values()) {
    if (s.stageOrder == null) continue;
    const p = s.pipelineId || "";
    const key = `${p}::${s.stageOrder}`;
    const cur = orderToStageIds.get(key) ?? [];
    cur.push(s.stageUuid);
    orderToStageIds.set(key, cur);
  }
  return { pipelineToSortedOrders, orderToStageIds };
}

function chunkStrings(ids: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

async function collectDealStageIds(
  client: SupabaseClient,
  projectId: string
): Promise<{ ids: Set<string>; error: string | null }> {
  const ids = new Set<string>();
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .from(PIPEDRIVE_DEALS_TABLE)
      .select("payload")
      .eq("project_id", projectId)
      .range(offset, offset + pageSize - 1);
    if (error) return { ids, error: error.message };
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) break;
    for (const row of rows) {
      const stageId = normalizeStageId(asRecord(row.payload).stage_id);
      if (stageId) ids.add(stageId);
    }
    if (rows.length < pageSize) break;
  }
  return { ids, error: null };
}

/** Fetch stage `order_nr` / pipeline for stage ids not already in `stages`. */
async function loadMissingStageMetaRows(
  client: SupabaseClient,
  projectId: string,
  stages: Map<string, StageMeta>,
  neededIds: string[]
): Promise<string | null> {
  const missing = neededIds.filter((id) => !stages.has(id));
  if (missing.length === 0) return null;
  for (const part of chunkStrings(missing, 100)) {
    const { data, error } = await client
      .from(PIPEDRIVE_RELATED_OBJECTS_TABLE)
      .select("pipedrive_object_id, payload")
      .eq("project_id", projectId)
      .eq("object_type", "stage")
      .in("pipedrive_object_id", part);
    if (error) return error.message;
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const stageUuid = normalizeStageId(row.pipedrive_object_id);
      if (!stageUuid) continue;
      const payload = asRecord(row.payload);
      stages.set(stageUuid, {
        stageUuid,
        stageName: stageNameFromPayload(payload, stageUuid),
        stageOrder: stageOrderFromPayload(payload),
        pipelineId: stagePipelineIdFromPayload(payload),
      });
    }
  }
  return null;
}

async function resolveCampaignFieldKey(
  client: SupabaseClient,
  projectId: string
): Promise<{ key: string | null; error: string | null }> {
  const { data, error } = await client
    .from(PIPEDRIVE_DEAL_FIELDS_TABLE)
    .select("field_key, name")
    .eq("project_id", projectId);
  if (error) return { key: null, error: error.message };
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const name = normalizeNonEmptyString(row.name);
    const key = normalizeNonEmptyString(row.field_key);
    if (name?.trim().toLowerCase() === "campaign" && key) return { key, error: null };
  }
  return { key: null, error: "Pipedrive Campaign deal field not found" };
}

async function loadFlowsByName(
  client: SupabaseClient,
  projectId: string,
  warnings: string[]
): Promise<{ byName: Map<string, { uuid: string; name: string }>; flows: Array<{ uuid: string; name: string }>; error: string | null }> {
  const { data, error } = await client
    .from(FLOWS_TABLE)
    .select("uuid, name")
    .eq("project_id", projectId);
  if (error) return { byName: new Map(), flows: [], error: error.message };
  const byName = new Map<string, { uuid: string; name: string }>();
  const flows: Array<{ uuid: string; name: string }> = [];
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const uuid = normalizeNonEmptyString(row.uuid);
    const name = normalizeNonEmptyString(row.name) ?? "(unnamed flow)";
    if (!uuid) continue;
    flows.push({ uuid, name });
    if (byName.has(name)) {
      warnings.push(`Duplicate flow name "${name}" found; total analytics uses the first match.`);
      continue;
    }
    byName.set(name, { uuid, name });
  }
  return { byName, flows, error: null };
}

async function loadStageMeta(
  client: SupabaseClient,
  projectId: string
): Promise<{ stages: Map<string, StageMeta>; error: string | null }> {
  const { data, error } = await client
    .from(PIPEDRIVE_RELATED_OBJECTS_TABLE)
    .select("pipedrive_object_id, payload")
    .eq("project_id", projectId)
    .eq("object_type", "stage");
  if (error) return { stages: new Map(), error: error.message };
  const stages = new Map<string, StageMeta>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const stageUuid = normalizeStageId(row.pipedrive_object_id);
    if (!stageUuid) continue;
    const payload = asRecord(row.payload);
    stages.set(stageUuid, {
      stageUuid,
      stageName: stageNameFromPayload(payload, stageUuid),
      stageOrder: stageOrderFromPayload(payload),
      pipelineId: stagePipelineIdFromPayload(payload),
    });
  }
  return { stages, error: null };
}

function sortStages(a: StageMeta, b: StageMeta): number {
  const ap = a.pipelineId || "\uffff";
  const bp = b.pipelineId || "\uffff";
  if (ap !== bp) return ap.localeCompare(bp);
  const ao = a.stageOrder ?? Number.MAX_SAFE_INTEGER;
  const bo = b.stageOrder ?? Number.MAX_SAFE_INTEGER;
  return ao - bo || a.stageName.localeCompare(b.stageName) || a.stageUuid.localeCompare(b.stageUuid);
}

export async function getProjectTotalAnalytics(
  client: SupabaseClient,
  projectId: string
): Promise<ProjectTotalAnalyticsPayload> {
  const warnings: string[] = [];
  const campaignField = await resolveCampaignFieldKey(client, projectId);
  if (campaignField.error || !campaignField.key) {
    return { flows: [], pipelineStages: [], warnings, error: campaignField.error ?? "Campaign field key missing" };
  }

  const flowRes = await loadFlowsByName(client, projectId, warnings);
  if (flowRes.error) return { flows: [], pipelineStages: [], warnings, error: flowRes.error };

  const { dates, error: daysErr } = await getCollectedAnalyticsDays(client, projectId);
  if (daysErr) warnings.push(`Collected analytics days: ${daysErr}`);
  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = dates.length > 0 ? dates[0]! : "2000-01-01";
  const dateTo = dates.length > 0 ? dates[dates.length - 1]! : today;
  const { data: metricsByFlow, error: snapErr } = await aggregateMetricsByFlow(client, projectId, dateFrom, dateTo);
  if (snapErr) warnings.push(`GetSales snapshot metrics: ${snapErr}`);

  const stageRes = await loadStageMeta(client, projectId);
  if (stageRes.error) warnings.push(`Pipedrive stage labels: ${stageRes.error}`);
  const stageMeta = stageRes.stages;

  const refStages = await collectDealStageIds(client, projectId);
  if (refStages.error) return { flows: [], pipelineStages: [], warnings, error: refStages.error };
  const refErr = await loadMissingStageMetaRows(client, projectId, stageMeta, [...refStages.ids]);
  if (refErr) warnings.push(`Pipedrive stage lookup: ${refErr}`);

  for (const id of refStages.ids) {
    if (stageMeta.has(id)) continue;
    stageMeta.set(id, { stageUuid: id, stageName: `Stage ${id}`, stageOrder: null, pipelineId: "" });
  }
  const stagesMissingOrder = [...refStages.ids].filter((id) => (stageMeta.get(id)?.stageOrder ?? null) == null);
  if (stagesMissingOrder.length > 0) {
    warnings.push(
      `${stagesMissingOrder.length} deal stage_id(s) missing order_nr in Pipedrive related objects; cumulative funnel uses current-stage-only for those.`
    );
  }

  const { pipelineToSortedOrders, orderToStageIds } = buildOrderIndexes(stageMeta);

  const countsByFlow = new Map<string, Map<string, number>>();
  const totalByFlow = new Map<string, number>();
  const unmappedCampaignCounts = new Map<string, number>();
  let missingCampaign = 0;
  let missingStage = 0;

  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client
      .from(PIPEDRIVE_DEALS_TABLE)
      .select("payload")
      .eq("project_id", projectId)
      .range(offset, offset + pageSize - 1);
    if (error) return { flows: [], pipelineStages: [], warnings, error: error.message };
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) break;
    for (const row of rows) {
      const payload = asRecord(row.payload);
      const campaign = normalizeCampaign(payload[campaignField.key]);
      if (!campaign) {
        missingCampaign += 1;
        continue;
      }
      const flow = flowRes.byName.get(campaign);
      if (!flow) {
        unmappedCampaignCounts.set(campaign, (unmappedCampaignCounts.get(campaign) ?? 0) + 1);
        continue;
      }
      const stageId = normalizeStageId(payload.stage_id);
      if (!stageId) {
        missingStage += 1;
        continue;
      }
      if (!countsByFlow.has(flow.uuid)) countsByFlow.set(flow.uuid, new Map());
      const byStage = countsByFlow.get(flow.uuid)!;
      const meta = stageMeta.get(stageId);
      const ord = meta?.stageOrder ?? null;
      const pipe = meta?.pipelineId ?? "";
      if (ord == null) {
        byStage.set(stageId, (byStage.get(stageId) ?? 0) + 1);
      } else {
        bumpCumulative(byStage, pipe, stageId, ord, pipelineToSortedOrders, orderToStageIds);
      }
      totalByFlow.set(flow.uuid, (totalByFlow.get(flow.uuid) ?? 0) + 1);
    }
    if (rows.length < pageSize) break;
  }

  if (missingCampaign > 0) warnings.push(`${missingCampaign.toLocaleString()} Pipedrive deal(s) skipped: Campaign field empty.`);
  if (missingStage > 0) warnings.push(`${missingStage.toLocaleString()} Pipedrive deal(s) skipped: stage_id empty.`);
  if (unmappedCampaignCounts.size > 0) {
    const top = [...unmappedCampaignCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 8)
      .map(([name, count]) => `${name} (${count})`)
      .join(", ");
    warnings.push(`Unmapped Pipedrive campaign(s): ${top}${unmappedCampaignCounts.size > 8 ? ", ..." : ""}`);
  }

  const pipelineStages: ProjectAnalyticsPipelineStage[] = [
    ...GETSALES_TOTAL_STAGES,
    ...[...stageMeta.values()].sort(sortStages).map((s) => ({
      stageUuid: s.stageUuid,
      stageName: s.stageName,
      stageOrder: s.stageOrder,
      source: "pipedrive" as const,
    })),
  ];
  const flows: ProjectAnalyticsDashboardFlow[] = flowRes.flows.map((flow) => {
    const totalDeals = totalByFlow.get(flow.uuid) ?? 0;
    const m = metricsByFlow.get(flow.uuid) ?? emptyMetrics();
    finalizeRates(m);
    const stageCounts = countsByFlow.get(flow.uuid) ?? new Map<string, number>();
    const pipelineStageBreakdown = [...stageCounts.entries()]
      .map(([stageUuid, contactsCount]) => {
        const meta = stageMeta.get(stageUuid);
        return {
          stageUuid,
          stageName: meta?.stageName ?? `Stage ${stageUuid}`,
          stageOrder: meta?.stageOrder ?? null,
          pipelineId: meta?.pipelineId ?? "",
          contactsCount,
        };
      })
      .filter((row) => row.contactsCount > 0)
      .sort(sortStages);
    return {
      flowUuid: flow.uuid,
      flowName: flow.name,
      messagesSent: m.messages_sent,
      connectionSent: m.connection_sent,
      connectionAccepted: m.connection_accepted,
      inbox: m.inbox,
      positiveReplies: m.positive_replies,
      connectionRequestRatePct: m.connection_request_rate_pct,
      acceptedRatePct: m.accepted_rate_pct,
      inboxRatePct: m.inbox_rate_pct,
      positiveRatePct: m.positive_rate_pct,
      pipedriveDealCount: totalDeals,
      pipelineStageBreakdown,
    };
  });
  flows.sort(
    (a, b) =>
      b.connectionSent - a.connectionSent ||
      a.flowName.localeCompare(b.flowName, undefined, { sensitivity: "base" })
  );

  return { flows, pipelineStages, warnings, error: null };
}
