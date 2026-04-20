/**
 * Shared analytics-funnel aggregation helpers used by:
 *  - `find_project_analytics` tool (JSON output)
 *  - `render_funnel_chart` tool (chart rendering)
 *  - `GET /api/project-analytics` (frontend Analytics page)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ANALYTICS_SNAPSHOTS_TABLE,
  CONTACTS_TABLE,
  FLOWS_TABLE,
  FLOW_LEADS_TABLE,
  PIPELINE_STAGES_TABLE,
  getHypothesesWithCounts,
  getHypothesisTagContacts,
} from "./supabase.js";

function logAnalyticsPerf(message: string): void {
  console.info(`[analytics-perf] ${message}`);
}

export interface FunnelMetrics {
  /** LinkedIn messages sent (`linkedin_sent_count`), typically ≥ connection requests. */
  messages_sent: number;
  connection_sent: number;
  connection_accepted: number;
  inbox: number;
  positive_replies: number;
  /** Share of messages that included a connection request (when `messages_sent` > 0). */
  connection_request_rate_pct: number | null;
  /** connection_accepted / connection_sent (null if sent = 0). */
  accepted_rate_pct: number | null;
  /** inbox / connection_accepted (null if accepted = 0). */
  inbox_rate_pct: number | null;
  /** positive_replies / inbox (null if inbox = 0). */
  positive_rate_pct: number | null;
}

export function emptyMetrics(): FunnelMetrics {
  return {
    messages_sent: 0,
    connection_sent: 0,
    connection_accepted: 0,
    inbox: 0,
    positive_replies: 0,
    connection_request_rate_pct: null,
    accepted_rate_pct: null,
    inbox_rate_pct: null,
    positive_rate_pct: null,
  };
}

export function toInt(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function finalizeRates(m: FunnelMetrics): FunnelMetrics {
  m.connection_request_rate_pct =
    m.messages_sent > 0 ? (100 * m.connection_sent) / m.messages_sent : null;
  m.accepted_rate_pct =
    m.connection_sent > 0 ? (100 * m.connection_accepted) / m.connection_sent : null;
  m.inbox_rate_pct =
    m.connection_accepted > 0 ? (100 * m.inbox) / m.connection_accepted : null;
  m.positive_rate_pct = m.inbox > 0 ? (100 * m.positive_replies) / m.inbox : null;
  return m;
}

export function addMetricsInto(
  dst: FunnelMetrics,
  metrics: Record<string, unknown>
): void {
  dst.messages_sent += toInt(metrics.linkedin_sent_count);
  dst.connection_sent += toInt(metrics.linkedin_connection_request_sent_count);
  dst.connection_accepted += toInt(metrics.linkedin_connection_request_accepted_count);
  dst.inbox += toInt(metrics.linkedin_inbox_count);
  dst.positive_replies += toInt(metrics.linkedin_positive_count);
}

export function daysBetween(fromYmd: string, toYmd: string): number | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(fromYmd) || !re.test(toYmd)) return null;
  const a = new Date(fromYmd + "T00:00:00Z").getTime();
  const b = new Date(toYmd + "T00:00:00Z").getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (b < a) return null;
  return Math.floor((b - a) / 86_400_000) + 1;
}

/** Return { dateFrom, dateTo } covering the last `days` days up to (and including) today in UTC. */
export function defaultDateRange(days = 7): { dateFrom: string; dateTo: string } {
  const today = new Date();
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { dateFrom: fmt(start), dateTo: fmt(end) };
}

/** Aggregate AnalyticsSnapshots metrics grouped by flow_uuid for a project + date range. */
export async function aggregateMetricsByFlow(
  client: SupabaseClient,
  projectId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ data: Map<string, FunnelMetrics>; error: string | null }> {
  const startedAt = Date.now();
  const metricsByFlow = new Map<string, FunnelMetrics>();
  const pageSize = 1000;
  let pages = 0;
  let rowsRead = 0;
  for (let offset = 0; ; offset += pageSize) {
    pages += 1;
    const { data, error } = await client
      .from(ANALYTICS_SNAPSHOTS_TABLE)
      .select("flow_uuid, metrics")
      .eq("project_id", projectId)
      .eq("group_by", "sender_profiles")
      .not("flow_uuid", "is", null)
      .gte("snapshot_date", dateFrom)
      .lte("snapshot_date", dateTo)
      .range(offset, offset + pageSize - 1);
    if (error) return { data: metricsByFlow, error: error.message };
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    rowsRead += rows.length;
    if (rows.length === 0) break;
    for (const row of rows) {
      const fu = row.flow_uuid as string | null;
      if (!fu) continue;
      const m =
        row.metrics && typeof row.metrics === "object"
          ? (row.metrics as Record<string, unknown>)
          : {};
      if (!metricsByFlow.has(fu)) metricsByFlow.set(fu, emptyMetrics());
      addMetricsInto(metricsByFlow.get(fu)!, m);
    }
    if (rows.length < pageSize) break;
  }
  logAnalyticsPerf(
    `aggregateMetricsByFlow project=${projectId} from=${dateFrom} to=${dateTo} pages=${pages} rows=${rowsRead} flows=${metricsByFlow.size} elapsedMs=${Date.now() - startedAt}`
  );
  return { data: metricsByFlow, error: null };
}

export async function getFlowNameMap(
  client: SupabaseClient,
  projectId: string
): Promise<{ data: Map<string, string>; error: string | null }> {
  const { data, error } = await client
    .from(FLOWS_TABLE)
    .select("uuid, name")
    .eq("project_id", projectId);
  if (error) return { data: new Map(), error: error.message };
  const map = new Map<string, string>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const u = row.uuid as string | undefined;
    const n = (row.name as string | null) ?? null;
    if (u) map.set(u, n ?? "(unnamed flow)");
  }
  return { data: map, error: null };
}

export interface HypothesisWithFlows {
  id: string;
  name: string | null;
  description: string | null;
  getsales_tag_uuid: string | null;
  getsales_tag_name: string | null;
  contacts_count: number;
  flow_uuids: string[];
  tag_lookup_error: string | null;
}

/**
 * Resolve hypotheses → flow uuids (via GetSales tag → contacts → FlowLeads).
 * If `hypothesisIds` is omitted/empty, returns all hypotheses for the project.
 */
export async function resolveHypothesisFlows(
  client: SupabaseClient,
  projectId: string,
  hypothesisIds?: string[]
): Promise<{ data: HypothesisWithFlows[]; error: string | null }> {
  const { data: allHyps, error } = await getHypothesesWithCounts(client, projectId);
  if (error) return { data: [], error };
  const selected =
    hypothesisIds && hypothesisIds.length > 0
      ? allHyps.filter((h) => hypothesisIds.includes(h.id))
      : allHyps;

  const out: HypothesisWithFlows[] = [];
  for (const h of selected) {
    const tagRes = await getHypothesisTagContacts(client, h.id);
    const contactUuids = (tagRes.error ? [] : tagRes.data)
      .map((c) => c.contact_uuid)
      .filter((x): x is string => typeof x === "string" && x.length > 0);

    const flowUuids = new Set<string>();
    if (contactUuids.length > 0) {
      const chunkSize = 500;
      for (let i = 0; i < contactUuids.length; i += chunkSize) {
        const chunk = contactUuids.slice(i, i + chunkSize);
        const { data } = await client
          .from(FLOW_LEADS_TABLE)
          .select("flow_uuid")
          .eq("project_id", projectId)
          .in("lead_uuid", chunk);
        for (const row of (data ?? []) as Array<Record<string, unknown>>) {
          const fu = row.flow_uuid as string | null;
          if (fu) flowUuids.add(fu);
        }
      }
    }

    out.push({
      id: h.id,
      name: h.name,
      description: h.description,
      getsales_tag_uuid: h.getsales_tag_uuid,
      getsales_tag_name: h.getsales_tag_name,
      contacts_count: contactUuids.length,
      flow_uuids: [...flowUuids],
      tag_lookup_error: tagRes.error ?? null,
    });
  }
  return { data: out, error: null };
}

/** One row for the analytics dashboard (flow or hypothesis as `flowUuid` / `flowName`). */
export interface ProjectAnalyticsDashboardFlow {
  flowUuid: string;
  flowName: string;
  messagesSent: number;
  connectionSent: number;
  connectionAccepted: number;
  inbox: number;
  positiveReplies: number;
  connectionRequestRatePct: number | null;
  acceptedRatePct: number | null;
  inboxRatePct: number | null;
  positiveRatePct: number | null;
  /** Tag-linked contacts (hypothesis groupBy only). */
  linkedContactsCount?: number;
  /** Distinct flows rolled into this row (hypothesis groupBy only). */
  linkedFlowsCount?: number;
  /** Distinct flow leads currently in each contact pipeline stage for this flow row. */
  pipelineStageBreakdown?: Array<{
    stageUuid: string;
    stageName: string;
    stageOrder: number | null;
    contactsCount: number;
  }>;
}

export interface ProjectAnalyticsPipelineStage {
  stageUuid: string;
  stageName: string;
  stageOrder: number | null;
}

/** Project-wide totals (sum of all flow-level snapshot metrics in range). */
export interface ProjectAnalyticsDashboardTotals {
  messagesSent: number;
  connectionSent: number;
  connectionAccepted: number;
  inbox: number;
  positiveReplies: number;
  connectionRequestRatePct: number | null;
  acceptedRatePct: number | null;
  inboxRatePct: number | null;
  positiveRatePct: number | null;
}

function funnelMetricsToDashboardFlow(
  id: string,
  name: string,
  m: FunnelMetrics,
  links?: { linkedContactsCount: number; linkedFlowsCount?: number },
  pipelineStageBreakdown?: Array<{
    stageUuid: string;
    stageName: string;
    stageOrder: number | null;
    contactsCount: number;
  }>
): ProjectAnalyticsDashboardFlow {
  return {
    flowUuid: id,
    flowName: name,
    messagesSent: m.messages_sent,
    connectionSent: m.connection_sent,
    connectionAccepted: m.connection_accepted,
    inbox: m.inbox,
    positiveReplies: m.positive_replies,
    connectionRequestRatePct: m.connection_request_rate_pct,
    acceptedRatePct: m.accepted_rate_pct,
    inboxRatePct: m.inbox_rate_pct,
    positiveRatePct: m.positive_rate_pct,
    ...(links
      ? {
          linkedContactsCount: links.linkedContactsCount,
          ...(links.linkedFlowsCount != null ? { linkedFlowsCount: links.linkedFlowsCount } : {}),
        }
      : {}),
    ...(pipelineStageBreakdown && pipelineStageBreakdown.length > 0
      ? { pipelineStageBreakdown }
      : {}),
  };
}

type FlowStageBreakdown = {
  stageUuid: string;
  stageName: string;
  stageOrder: number | null;
  contactsCount: number;
};

async function getFlowPipelineStageBreakdown(
  client: SupabaseClient,
  projectId: string,
  flowUuids: string[]
): Promise<{ data: Map<string, FlowStageBreakdown[]>; error: string | null }> {
  const startedAt = Date.now();
  const out = new Map<string, FlowStageBreakdown[]>();
  if (flowUuids.length === 0) return { data: out, error: null };
  try {
    const leadsByFlow = new Map<string, Set<string>>();
    const leadAll = new Set<string>();
    const flowChunks = chunkIds(flowUuids, 80);
    let flowLeadRowsRead = 0;
    let contactRowsRead = 0;
    for (const chunk of flowChunks) {
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await client
          .from(FLOW_LEADS_TABLE)
          .select("flow_uuid, lead_uuid")
          .eq("project_id", projectId)
          .in("flow_uuid", chunk)
          .range(offset, offset + pageSize - 1);
        if (error) return { data: out, error: error.message };
        const rows = (data ?? []) as Array<Record<string, unknown>>;
        flowLeadRowsRead += rows.length;
        if (rows.length === 0) break;
        for (const row of rows) {
          const flow = typeof row.flow_uuid === "string" ? row.flow_uuid : "";
          const lead = typeof row.lead_uuid === "string" ? row.lead_uuid : "";
          if (!flow || !lead) continue;
          if (!leadsByFlow.has(flow)) leadsByFlow.set(flow, new Set<string>());
          leadsByFlow.get(flow)!.add(lead);
          leadAll.add(lead);
        }
        if (rows.length < pageSize) break;
      }
    }

    if (leadAll.size === 0) return { data: out, error: null };

    const contactToStage = new Map<string, string>();
    const contactIdChunks = chunkIds([...leadAll], 300);
    const contactChunkBatchSize = 6;
    for (let i = 0; i < contactIdChunks.length; i += contactChunkBatchSize) {
      const batch = contactIdChunks.slice(i, i + contactChunkBatchSize);
      const batchResults = await Promise.all(
        batch.map(async (ids) =>
          client
            .from(CONTACTS_TABLE)
            .select("uuid, pipeline_stage_uuid")
            .eq("project_id", projectId)
            .in("uuid", ids)
        )
      );
      for (const result of batchResults) {
        if (result.error) return { data: out, error: result.error.message };
        const rows = (result.data ?? []) as Array<Record<string, unknown>>;
        contactRowsRead += rows.length;
        for (const row of rows) {
          const uuid = typeof row.uuid === "string" ? row.uuid : "";
          const stage = typeof row.pipeline_stage_uuid === "string" ? row.pipeline_stage_uuid : "";
          if (uuid && stage) contactToStage.set(uuid, stage);
        }
      }
    }

    const { data: stageRows, error: stageErr } = await client
      .from(PIPELINE_STAGES_TABLE)
      .select("uuid, name, stage_order")
      .eq("project_id", projectId)
      .eq("entity_object", "lead");
    if (stageErr) return { data: out, error: stageErr.message };

    const stageMeta = new Map<string, { name: string; order: number | null }>();
    for (const row of (stageRows ?? []) as Array<Record<string, unknown>>) {
      const uuid = typeof row.uuid === "string" ? row.uuid : "";
      const nameRaw = typeof row.name === "string" ? row.name.trim() : "";
      const orderRaw = row.stage_order;
      const order =
        typeof orderRaw === "number"
          ? Math.trunc(orderRaw)
          : typeof orderRaw === "string" && /^\d+$/.test(orderRaw)
            ? parseInt(orderRaw, 10)
            : null;
      if (!uuid || !nameRaw) continue;
      stageMeta.set(uuid, { name: nameRaw, order });
    }

    for (const flow of flowUuids) {
      const leads = leadsByFlow.get(flow);
      if (!leads || leads.size === 0) continue;
      const counts = new Map<string, FlowStageBreakdown>();
      for (const lead of leads) {
        const stageUuid = contactToStage.get(lead);
        if (!stageUuid) continue;
        const meta = stageMeta.get(stageUuid);
        if (!meta || !meta.name) continue;
        const cur = counts.get(stageUuid);
        if (cur) {
          cur.contactsCount += 1;
        } else {
          counts.set(stageUuid, {
            stageUuid,
            stageName: meta.name,
            stageOrder: meta.order,
            contactsCount: 1,
          });
        }
      }
      const arr = [...counts.values()]
        .filter((x) => x.contactsCount > 0)
        .sort((a, b) => {
          const ao = a.stageOrder ?? Number.MAX_SAFE_INTEGER;
          const bo = b.stageOrder ?? Number.MAX_SAFE_INTEGER;
          return ao - bo || b.contactsCount - a.contactsCount || a.stageName.localeCompare(b.stageName);
        });
      if (arr.length > 0) out.set(flow, arr);
    }

    logAnalyticsPerf(
      `getFlowPipelineStageBreakdown project=${projectId} flowInputs=${flowUuids.length} leads=${leadAll.size} flowLeadRows=${flowLeadRowsRead} contactRows=${contactRowsRead} contactChunks=${contactIdChunks.length} flowsWithStages=${out.size} elapsedMs=${Date.now() - startedAt}`
    );
    return { data: out, error: null };
  } catch (error) {
    return {
      data: out,
      error: error instanceof Error ? error.message : "Pipeline stage lookup failed",
    };
  }
}

function sumAllFlowMetrics(metricsByFlow: Map<string, FunnelMetrics>): FunnelMetrics {
  const t = emptyMetrics();
  for (const m of metricsByFlow.values()) {
    t.messages_sent += m.messages_sent;
    t.connection_sent += m.connection_sent;
    t.connection_accepted += m.connection_accepted;
    t.inbox += m.inbox;
    t.positive_replies += m.positive_replies;
  }
  return finalizeRates({ ...t });
}

function emptyDashboardTotals(): ProjectAnalyticsDashboardTotals {
  return {
    messagesSent: 0,
    connectionSent: 0,
    connectionAccepted: 0,
    inbox: 0,
    positiveReplies: 0,
    connectionRequestRatePct: null,
    acceptedRatePct: null,
    inboxRatePct: null,
    positiveRatePct: null,
  };
}

function totalsFromFunnelMetrics(m: FunnelMetrics): ProjectAnalyticsDashboardTotals {
  return {
    messagesSent: m.messages_sent,
    connectionSent: m.connection_sent,
    connectionAccepted: m.connection_accepted,
    inbox: m.inbox,
    positiveReplies: m.positive_replies,
    connectionRequestRatePct: m.connection_request_rate_pct,
    acceptedRatePct: m.accepted_rate_pct,
    inboxRatePct: m.inbox_rate_pct,
    positiveRatePct: m.positive_rate_pct,
  };
}

/**
 * Dashboard payload: per-entity rows + project totals (always summed over all flows in range).
 * `groupBy` = `flow` matches `find_project_analytics` flow mode; `hypothesis` rolls up by hypothesis.
 */
export async function getProjectAnalyticsDashboard(
  client: SupabaseClient,
  projectId: string,
  dateFrom: string,
  dateTo: string,
  groupBy: "flow" | "hypothesis",
  opts?: { totalsOnly?: boolean }
): Promise<{
  flows: ProjectAnalyticsDashboardFlow[];
  pipelineStages: ProjectAnalyticsPipelineStage[];
  projectTotals: ProjectAnalyticsDashboardTotals;
  warnings: string[];
  error: string | null;
}> {
  const totalsOnly = opts?.totalsOnly === true;
  const startedAt = Date.now();
  const agg = await aggregateMetricsByFlow(client, projectId, dateFrom, dateTo);
  if (agg.error) {
    return {
      flows: [],
      pipelineStages: [],
      projectTotals: emptyDashboardTotals(),
      warnings: [],
      error: agg.error,
    };
  }
  const metricsByFlow = agg.data;
  const afterAggAt = Date.now();

  const projectTotals = totalsFromFunnelMetrics(sumAllFlowMetrics(metricsByFlow));
  if (totalsOnly) {
    logAnalyticsPerf(
      `dashboard totals-only project=${projectId} groupBy=${groupBy} from=${dateFrom} to=${dateTo} flowsWithMetrics=${metricsByFlow.size} tAggMs=${afterAggAt - startedAt} tTotalMs=${Date.now() - startedAt}`
    );
    return {
      flows: [],
      pipelineStages: [],
      projectTotals,
      warnings: [],
      error: null,
    };
  }

  const flowNames = await getFlowNameMap(client, projectId);
  if (flowNames.error) {
    return {
      flows: [],
      pipelineStages: [],
      projectTotals: emptyDashboardTotals(),
      warnings: [],
      error: flowNames.error,
    };
  }
  const flowNameByUuid = flowNames.data;
  const afterFlowNamesAt = Date.now();

  const warnings: string[] = [];
  const pipelineStages: ProjectAnalyticsPipelineStage[] = [];
  const stageListStartedAt = Date.now();
  const { data: stageRows, error: stageErr } = await client
    .from(PIPELINE_STAGES_TABLE)
    .select("uuid, name, stage_order")
    .eq("project_id", projectId)
    .eq("entity_object", "lead");
  if (stageErr) {
    warnings.push(`Pipeline stages list: ${stageErr.message}`);
  } else {
    const seen = new Set<string>();
    for (const row of (stageRows ?? []) as Array<Record<string, unknown>>) {
      const stageUuid = typeof row.uuid === "string" ? row.uuid : "";
      const stageName = typeof row.name === "string" ? row.name.trim() : "";
      const orderRaw = row.stage_order;
      const stageOrder =
        typeof orderRaw === "number"
          ? Math.trunc(orderRaw)
          : typeof orderRaw === "string" && /^\d+$/.test(orderRaw)
            ? parseInt(orderRaw, 10)
            : null;
      if (!stageUuid || !stageName || seen.has(stageUuid)) continue;
      seen.add(stageUuid);
      pipelineStages.push({ stageUuid, stageName, stageOrder });
    }
    pipelineStages.sort((a, b) => {
      const ao = a.stageOrder ?? Number.MAX_SAFE_INTEGER;
      const bo = b.stageOrder ?? Number.MAX_SAFE_INTEGER;
      return ao - bo || a.stageName.localeCompare(b.stageName);
    });
  }
  const afterStageListAt = Date.now();
  logAnalyticsPerf(
    `dashboard base project=${projectId} groupBy=${groupBy} from=${dateFrom} to=${dateTo} flowsWithMetrics=${metricsByFlow.size} pipelineStages=${pipelineStages.length} tAggMs=${afterAggAt - startedAt} tFlowNamesMs=${afterFlowNamesAt - afterAggAt} tStageListMs=${afterStageListAt - stageListStartedAt}`
  );

  if (groupBy === "flow") {
    const flowBranchStartedAt = Date.now();
    const flowIds = [...new Set<string>([...metricsByFlow.keys(), ...flowNameByUuid.keys()])];
    const stageRes = await getFlowPipelineStageBreakdown(client, projectId, flowIds);
    // Keep funnel payload clean if optional pipeline enrichment fails.
    const flows = flowIds.map((id) => {
      const m = finalizeRates({ ...(metricsByFlow.get(id) ?? emptyMetrics()) });
      return funnelMetricsToDashboardFlow(
        id,
        flowNameByUuid.get(id) ?? "(Unknown flow)",
        m,
        undefined,
        stageRes.data.get(id) ?? []
      );
    });
    flows.sort(
      (a, b) =>
        b.connectionSent - a.connectionSent ||
        a.flowName.localeCompare(b.flowName, undefined, { sensitivity: "base" })
    );
    logAnalyticsPerf(
      `dashboard flow branch project=${projectId} from=${dateFrom} to=${dateTo} flowIds=${flowIds.length} rows=${flows.length} tFlowBranchMs=${Date.now() - flowBranchStartedAt} tTotalMs=${Date.now() - startedAt}`
    );
    return { flows, pipelineStages, projectTotals, warnings, error: null };
  }

  const hypBranchStartedAt = Date.now();
  const hypsRes = await resolveHypothesisFlows(client, projectId);
  if (hypsRes.error) {
    return { flows: [], pipelineStages, projectTotals, warnings: [], error: hypsRes.error };
  }

  const allHypFlowUuids = [...new Set(hypsRes.data.flatMap((h) => h.flow_uuids))];
  const stageRes = await getFlowPipelineStageBreakdown(
    client,
    projectId,
    allHypFlowUuids
  );
  // Keep funnel payload clean if optional pipeline enrichment fails.

  const flows: ProjectAnalyticsDashboardFlow[] = [];
  for (const h of hypsRes.data) {
    if (h.tag_lookup_error) {
      warnings.push(`${h.name ?? h.id.slice(0, 8)}: ${h.tag_lookup_error}`);
    }
    const total = emptyMetrics();
    for (const fu of h.flow_uuids) {
      const fm = metricsByFlow.get(fu);
      if (!fm) continue;
      total.messages_sent += fm.messages_sent;
      total.connection_sent += fm.connection_sent;
      total.connection_accepted += fm.connection_accepted;
      total.inbox += fm.inbox;
      total.positive_replies += fm.positive_replies;
    }
    finalizeRates(total);
    const stageAgg = new Map<string, FlowStageBreakdown>();
    for (const fu of h.flow_uuids) {
      const list = stageRes.data.get(fu) ?? [];
      for (const s of list) {
        const key = s.stageUuid || s.stageName;
        const cur = stageAgg.get(key);
        if (cur) {
          cur.contactsCount += s.contactsCount;
        } else {
          stageAgg.set(key, { ...s });
        }
      }
    }
    const pipelineStageBreakdown = [...stageAgg.values()].sort((a, b) => {
      const ao = a.stageOrder ?? Number.MAX_SAFE_INTEGER;
      const bo = b.stageOrder ?? Number.MAX_SAFE_INTEGER;
      return ao - bo || b.contactsCount - a.contactsCount || a.stageName.localeCompare(b.stageName);
    });
    flows.push(
      funnelMetricsToDashboardFlow(
        h.id,
        h.name?.trim() ? (h.name as string) : h.id.slice(0, 8),
        total,
        {
          linkedContactsCount: h.contacts_count,
          linkedFlowsCount: h.flow_uuids.length,
        },
        pipelineStageBreakdown
      )
    );
  }

  flows.sort(
    (a, b) =>
      b.connectionSent - a.connectionSent ||
      a.flowName.localeCompare(b.flowName, undefined, { sensitivity: "base" })
  );
  logAnalyticsPerf(
    `dashboard hypothesis branch project=${projectId} from=${dateFrom} to=${dateTo} hypotheses=${hypsRes.data.length} hypFlows=${allHypFlowUuids.length} rows=${flows.length} tHypBranchMs=${Date.now() - hypBranchStartedAt} tTotalMs=${Date.now() - startedAt}`
  );
  return { flows, pipelineStages, projectTotals, warnings, error: null };
}

const YMD_DAILY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Every calendar day from `fromYmd` through `toYmd` inclusive (UTC noon stepping). */
export function eachDayInclusiveYmd(fromYmd: string, toYmd: string): string[] {
  if (!YMD_DAILY_RE.test(fromYmd) || !YMD_DAILY_RE.test(toYmd)) return [];
  const out: string[] = [];
  const d = new Date(`${fromYmd}T12:00:00Z`);
  const end = new Date(`${toYmd}T12:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function chunkIds<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Per-day totals (sum of snapshot deltas across distinct flows in the selection). */
export interface ProjectAnalyticsDailyPoint {
  date: string;
  messagesSent: number;
  connectionSent: number;
  connectionAccepted: number;
  inbox: number;
  positiveReplies: number;
}

function emptyDailyPoint(date: string): ProjectAnalyticsDailyPoint {
  return {
    date,
    messagesSent: 0,
    connectionSent: 0,
    connectionAccepted: 0,
    inbox: 0,
    positiveReplies: 0,
  };
}

/** Per-entity daily breakdown (1–2 entities) for small-multiples charts. */
export interface ProjectAnalyticsDailyEntitySeries {
  entityId: string;
  entityName: string;
  series: ProjectAnalyticsDailyPoint[];
}

function dailyPointsFromByDay(
  daySpan: string[],
  byDay: Map<string, FunnelMetrics>
): ProjectAnalyticsDailyPoint[] {
  return daySpan.map((date) => {
    const m = byDay.get(date);
    return {
      date,
      messagesSent: m?.messages_sent ?? 0,
      connectionSent: m?.connection_sent ?? 0,
      connectionAccepted: m?.connection_accepted ?? 0,
      inbox: m?.inbox ?? 0,
      positiveReplies: m?.positive_replies ?? 0,
    };
  });
}

async function accumulateSnapshotsByDayForFlows(
  client: SupabaseClient,
  projectId: string,
  dateFrom: string,
  dateTo: string,
  flowList: string[]
): Promise<{ byDay: Map<string, FunnelMetrics>; error: string | null }> {
  const byDay = new Map<string, FunnelMetrics>();
  if (flowList.length === 0) return { byDay, error: null };

  const pageSize = 1000;
  const inChunk = 80;

  for (const idChunk of chunkIds(flowList, inChunk)) {
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await client
        .from(ANALYTICS_SNAPSHOTS_TABLE)
        .select("snapshot_date, metrics")
        .eq("project_id", projectId)
        .eq("group_by", "sender_profiles")
        .in("flow_uuid", idChunk)
        .gte("snapshot_date", dateFrom)
        .lte("snapshot_date", dateTo)
        .range(offset, offset + pageSize - 1);
      if (error) {
        return { byDay, error: error.message };
      }
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      if (rows.length === 0) break;
      for (const row of rows) {
        const dayRaw = row.snapshot_date;
        const day = typeof dayRaw === "string" ? dayRaw.slice(0, 10) : "";
        if (!YMD_DAILY_RE.test(day)) continue;
        const m =
          row.metrics && typeof row.metrics === "object"
            ? (row.metrics as Record<string, unknown>)
            : {};
        if (!byDay.has(day)) byDay.set(day, emptyMetrics());
        addMetricsInto(byDay.get(day)!, m);
      }
      if (rows.length < pageSize) break;
    }
  }
  return { byDay, error: null };
}

/**
 * Sum AnalyticsSnapshots metrics by `snapshot_date` for all flows linked to the selected entities.
 * `groupBy=flow`: `entityIds` are flow UUIDs. `groupBy=hypothesis`: hypothesis ids → union of underlying
 * flow UUIDs (each flow counted once per day even if it appears under multiple selected hypotheses).
 *
 * `perEntity`: when true and 1–2 `entityIds`, also returns `byEntity` with one series per entity (no cross-entity dedupe).
 */
export async function getProjectAnalyticsDailySeries(
  client: SupabaseClient,
  projectId: string,
  dateFrom: string,
  dateTo: string,
  groupBy: "flow" | "hypothesis",
  entityIds: string[],
  opts?: { perEntity?: boolean }
): Promise<{
  data: ProjectAnalyticsDailyPoint[];
  byEntity?: ProjectAnalyticsDailyEntitySeries[];
  warnings: string[];
  error: string | null;
}> {
  const warnings: string[] = [];
  const daySpan = eachDayInclusiveYmd(dateFrom, dateTo);
  if (entityIds.length === 0) {
    return { data: daySpan.map((date) => emptyDailyPoint(date)), warnings, error: null };
  }

  const flowUuidSet = new Set<string>();
  let hypsResolved: HypothesisWithFlows[] | null = null;
  if (groupBy === "flow") {
    for (const id of entityIds) flowUuidSet.add(id);
  } else {
    const hypsRes = await resolveHypothesisFlows(client, projectId, entityIds);
    if (hypsRes.error) {
      return { data: [], warnings, error: hypsRes.error };
    }
    hypsResolved = hypsRes.data;
    for (const h of hypsRes.data) {
      if (h.tag_lookup_error) {
        warnings.push(`${h.name ?? h.id.slice(0, 8)}: ${h.tag_lookup_error}`);
      }
      for (const fu of h.flow_uuids) flowUuidSet.add(fu);
    }
  }

  if (flowUuidSet.size === 0) {
    return { data: daySpan.map((date) => emptyDailyPoint(date)), warnings, error: null };
  }

  const flowList = [...flowUuidSet];
  const agg = await accumulateSnapshotsByDayForFlows(client, projectId, dateFrom, dateTo, flowList);
  if (agg.error) {
    return { data: [], warnings, error: agg.error };
  }

  const data = dailyPointsFromByDay(daySpan, agg.byDay);

  let byEntity: ProjectAnalyticsDailyEntitySeries[] | undefined;
  if (opts?.perEntity && entityIds.length >= 1 && entityIds.length <= 2) {
    const outEntity: ProjectAnalyticsDailyEntitySeries[] = [];
    if (groupBy === "flow") {
      const nameRes = await getFlowNameMap(client, projectId);
      if (nameRes.error) {
        warnings.push(`Per-entity charts skipped (flow names): ${nameRes.error}`);
      } else {
        const names = nameRes.data;
        for (const eid of entityIds) {
          const { byDay: bd, error: e2 } = await accumulateSnapshotsByDayForFlows(
            client,
            projectId,
            dateFrom,
            dateTo,
            [eid]
          );
          if (e2) {
            warnings.push(`Per-entity ${eid.slice(0, 8)}: ${e2}`);
            continue;
          }
          outEntity.push({
            entityId: eid,
            entityName: names.get(eid) ?? eid.slice(0, 8),
            series: dailyPointsFromByDay(daySpan, bd),
          });
        }
      }
    } else if (hypsResolved) {
      for (const eid of entityIds) {
        const h = hypsResolved.find((x) => x.id === eid);
        if (!h) continue;
        const { byDay: bd, error: e2 } = await accumulateSnapshotsByDayForFlows(
          client,
          projectId,
          dateFrom,
          dateTo,
          [...h.flow_uuids]
        );
        if (e2) {
          warnings.push(`Per-entity ${eid.slice(0, 8)}: ${e2}`);
          continue;
        }
        outEntity.push({
          entityId: eid,
          entityName: h.name?.trim() ? (h.name as string) : eid.slice(0, 8),
          series: dailyPointsFromByDay(daySpan, bd),
        });
      }
    }
    if (outEntity.length > 0) byEntity = outEntity;
  }

  return { data, ...(byEntity != null && byEntity.length > 0 ? { byEntity } : {}), warnings, error: null };
}
