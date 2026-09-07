import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Velvetech outreach analytics.
 *
 * Every number here is counted by us, from our own ledgers, with two exceptions that
 * LinkedIn gives us no independent record of — connections sent and accepted, which come
 * from GetSales. Each stage carries the source that produced it so the page can say so
 * rather than presenting a vendor count as our own.
 */

/**
 * Sends are counted inside a window, never lifetime. Velvetech ran an earlier batch in
 * June-July whose sends belong to a different campaign; counting them alongside the current
 * one overstated every stage. The window defaults to the current batch.
 */
export const DEFAULT_WINDOW_START = "2026-08-01";
const FUNNEL_FN = "gtm_velvetech_outreach_funnel";
const CAMPAIGNS_FN = "gtm_velvetech_campaigns";
const DEPT_FN = "gtm_velvetech_dept_stats";
/**
 * Research status and the pipeline funnel are read from snapshots, not live views: the live
 * research view runs correlated subqueries over every n8n result and takes ~22s, far past the
 * API statement timeout. Both snapshots carry refreshed_at so the page can date them, and
 * `refreshVelvetechAnalytics` rebuilds them on demand.
 */
const RESEARCH_MV = "gtm_velvetech_research_stats_mv";
const PIPELINE_MV = "gtm_velvetech_pipeline_mv";

export type StageSource = "ours" | "getsales" | "smartlead";

export interface FunnelStage {
  channel: "email" | "linkedin";
  stage: string;
  ord: number;
  people: number;
  source: StageSource;
  note: string | null;
  /** Conversion from the stage directly above, as a percentage. Null on the first stage. */
  stepPct: number | null;
  /** Share of the channel's first stage, as a percentage. */
  ofTopPct: number | null;
}

export interface CampaignRow {
  channel: string;
  vendor: string;
  campaignId: string;
  campaignName: string | null;
  campaignStatus: string | null;
  capturedAt: string | null;
  leadsTotal: number | null;
  sent: number | null;
  opened: number | null;
  replied: number | null;
  bounced: number | null;
  connectionsSent: number | null;
  connectionsAccepted: number | null;
}

export interface DeptRow {
  dept: string;
  people: number;
  sentTo: number;
  emailsSent: number;
  reachedStep2: number;
  reachedStep3: number;
  replied: number;
  unsubscribed: number;
  lastSent: string | null;
}

export interface ResearchStats {
  companies: number;
  researched: number;
  partial: number;
  none: number;
  withDeep: number;
  withPov: number;
  withEvidence: number;
  withContactResearch: number;
  enrolledWithoutResearch: number;
  refreshedAt: string | null;
}

export interface PipelineStage {
  stage: string;
  ord: number;
  companies: number;
  people: number;
  note: string | null;
}

export interface AnalyticsWindow {
  from: string;
  to: string;
}

export interface VelvetechAnalyticsPayload {
  window: AnalyticsWindow;
  funnel: FunnelStage[];
  campaigns: CampaignRow[];
  departments: DeptRow[];
  research: ResearchStats | null;
  pipeline: PipelineStage[];
  /** Latest vendor capture per channel — the page must show how stale a channel is. */
  capturedAt: Record<string, string | null>;
  warnings: string[];
}

function num(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) return Number(raw);
  return 0;
}

function numOrNull(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  return num(raw);
}

function str(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() !== "" ? raw : null;
}

/** Percent to one decimal, or null when the denominator is zero or missing. */
function pct(part: number, whole: number | null | undefined): number | null {
  if (!whole || whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

function buildFunnel(rows: Array<Record<string, unknown>>): FunnelStage[] {
  const byChannel = new Map<string, Array<Record<string, unknown>>>();
  for (const row of rows) {
    const channel = String(row.channel ?? "");
    if (!byChannel.has(channel)) byChannel.set(channel, []);
    byChannel.get(channel)!.push(row);
  }
  const out: FunnelStage[] = [];
  for (const [channel, channelRows] of byChannel) {
    channelRows.sort((a, b) => num(a.ord) - num(b.ord));
    const top = channelRows.length > 0 ? num(channelRows[0].people) : 0;
    channelRows.forEach((row, index) => {
      const people = num(row.people);
      const prevRow = index > 0 ? channelRows[index - 1] : null;
      const prev = prevRow ? num(prevRow.people) : null;
      // A step rate only means something when both stages were counted the same way. Dividing
      // our count by a vendor's produces figures over 100% and reads as a conversion.
      const comparable = prevRow ? prevRow.source === row.source : false;
      out.push({
        channel: channel === "linkedin" ? "linkedin" : "email",
        stage: String(row.stage ?? ""),
        ord: num(row.ord),
        people,
        source: (row.source === "getsales" || row.source === "smartlead" ? row.source : "ours") as StageSource,
        note: str(row.note),
        stepPct: index === 0 || !comparable ? null : pct(people, prev),
        ofTopPct: pct(people, top),
      });
    });
  }
  return out;
}

function buildResearch(row: Record<string, unknown> | null): ResearchStats | null {
  if (!row) return null;
  return {
    companies: num(row.companies),
    researched: num(row.researched),
    partial: num(row.partial),
    none: num(row.none),
    withDeep: num(row.with_deep),
    withPov: num(row.with_pov),
    withEvidence: num(row.with_evidence),
    withContactResearch: num(row.with_contact_research),
    enrolledWithoutResearch: num(row.enrolled_without_research),
    refreshedAt: str(row.refreshed_at),
  };
}

/** Rebuild the research and pipeline snapshots. Slow (tens of seconds) — call it deliberately. */
export async function refreshVelvetechAnalytics(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client.rpc("refresh_velvetech_analytics");
  if (error) throw new Error(error.message);
  return typeof data === "string" ? data : null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Fall back to the default window rather than passing an unparseable date to Postgres. */
export function normalizeWindow(from?: string | null, to?: string | null): AnalyticsWindow {
  return {
    from: from && YMD_RE.test(from) ? from : DEFAULT_WINDOW_START,
    to: to && YMD_RE.test(to) ? to : today(),
  };
}

export async function getVelvetechAnalytics(
  client: SupabaseClient,
  window?: AnalyticsWindow
): Promise<VelvetechAnalyticsPayload> {
  const warnings: string[] = [];
  const win = window ?? normalizeWindow();
  const args = { p_from: win.from, p_to: win.to };

  const [funnelRes, campaignRes, deptRes, researchRes, pipelineRes] = await Promise.all([
    client.rpc(FUNNEL_FN, args),
    client.rpc(CAMPAIGNS_FN, args),
    client.rpc(DEPT_FN, args),
    client.from(RESEARCH_MV).select("*").maybeSingle(),
    client.from(PIPELINE_MV).select("stage, ord, companies, people, note, refreshed_at"),
  ]);

  if (funnelRes.error) warnings.push(`Outreach funnel unavailable: ${funnelRes.error.message}`);
  if (campaignRes.error) warnings.push(`Campaign snapshots unavailable: ${campaignRes.error.message}`);
  if (deptRes.error) warnings.push(`Department breakdown unavailable: ${deptRes.error.message}`);
  if (researchRes.error) warnings.push(`Research snapshot unavailable: ${researchRes.error.message}`);
  if (pipelineRes.error) warnings.push(`Pipeline snapshot unavailable: ${pipelineRes.error.message}`);

  const campaigns: CampaignRow[] = ((campaignRes.data ?? []) as Array<Record<string, unknown>>).map(
    (row) => ({
      channel: String(row.channel ?? ""),
      vendor: String(row.vendor ?? ""),
      campaignId: String(row.campaign_id ?? ""),
      campaignName: str(row.campaign_name),
      campaignStatus: str(row.campaign_status),
      capturedAt: str(row.captured_at),
      leadsTotal: numOrNull(row.leads_total),
      sent: numOrNull(row.sent),
      opened: numOrNull(row.opened),
      replied: numOrNull(row.replied),
      bounced: numOrNull(row.bounced),
      connectionsSent: numOrNull(row.connections_sent),
      connectionsAccepted: numOrNull(row.connections_accepted),
    })
  );

  const capturedAt: Record<string, string | null> = {};
  for (const row of campaigns) {
    if (!row.capturedAt) continue;
    const current = capturedAt[row.channel];
    if (!current || row.capturedAt > current) capturedAt[row.channel] = row.capturedAt;
  }

  const departments: DeptRow[] = ((deptRes.data ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      dept: String(row.dept ?? "Unassigned"),
      people: num(row.people),
      sentTo: num(row.sent_to),
      emailsSent: num(row.emails_sent),
      reachedStep2: num(row.reached_step2),
      reachedStep3: num(row.reached_step3),
      replied: num(row.replied),
      unsubscribed: num(row.unsubscribed),
      lastSent: str(row.last_sent),
    }))
    .sort((a, b) => b.people - a.people);

  const pipeline: PipelineStage[] = ((pipelineRes.data ?? []) as Array<Record<string, unknown>>)
    .map((row) => ({
      stage: String(row.stage ?? ""),
      ord: num(row.ord),
      companies: num(row.companies),
      people: num(row.people),
      note: str(row.note),
    }))
    .sort((a, b) => a.ord - b.ord);

  const pipelineRefreshedAt =
    ((pipelineRes.data ?? []) as Array<Record<string, unknown>>)[0]?.refreshed_at ?? null;
  capturedAt.pipeline = str(pipelineRefreshedAt);

  return {
    window: win,
    funnel: buildFunnel((funnelRes.data ?? []) as Array<Record<string, unknown>>),
    campaigns,
    departments,
    research: researchRes.error ? null : buildResearch((researchRes.data ?? null) as Record<string, unknown> | null),
    pipeline,
    capturedAt,
    warnings,
  };
}
