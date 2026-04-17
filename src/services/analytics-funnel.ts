/**
 * Shared analytics-funnel aggregation helpers used by:
 *  - `find_project_analytics` tool (JSON output)
 *  - `render_funnel_chart` tool (chart rendering)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ANALYTICS_SNAPSHOTS_TABLE,
  FLOWS_TABLE,
  FLOW_LEADS_TABLE,
  getHypothesesWithCounts,
  getHypothesisTagContacts,
} from "./supabase.js";

export interface FunnelMetrics {
  connection_sent: number;
  connection_accepted: number;
  inbox: number;
  positive_replies: number;
  accepted_rate_pct: number | null;
  inbox_rate_pct: number | null;
  positive_rate_pct: number | null;
}

export function emptyMetrics(): FunnelMetrics {
  return {
    connection_sent: 0,
    connection_accepted: 0,
    inbox: 0,
    positive_replies: 0,
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
  if (m.connection_sent > 0) {
    m.accepted_rate_pct = (100 * m.connection_accepted) / m.connection_sent;
    m.inbox_rate_pct = (100 * m.inbox) / m.connection_sent;
    m.positive_rate_pct = (100 * m.positive_replies) / m.connection_sent;
  }
  return m;
}

export function addMetricsInto(
  dst: FunnelMetrics,
  metrics: Record<string, unknown>
): void {
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
  const metricsByFlow = new Map<string, FunnelMetrics>();
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
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
