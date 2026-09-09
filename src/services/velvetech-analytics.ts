import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchLeadsMetricsForRange } from "./source-api.js";
import { getGetSalesCredentials } from "./supabase.js";

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
const VELVETECH_PROJECT_ID = "51cc22a1-868e-42c4-974f-9a7c5f5dce20";
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
      const comparable =
        prevRow !== null &&
        prevRow.source === row.source &&
        !LINKEDIN_STAGE_NO_RATE.has(String(row.stage ?? ""));
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

/**
 * LinkedIn stage counts straight from GetSales for the window.
 *
 * The campaign snapshots this used to read are captured on a schedule and hold LIFETIME totals
 * per flow, so they went stale between captures and could not be windowed: on 2026-09-08 they
 * reported 356 connections sent and 22 accepted where GetSales itself reported 485 and 43 for
 * the same window. GetSales is the only party that records these, so we ask it directly.
 */
async function fetchLinkedinStages(
  client: SupabaseClient,
  win: AnalyticsWindow
): Promise<{ counts: Record<string, number> | null; error: string | null; summed?: boolean }> {
  const { credentials, error } = await getGetSalesCredentials(client, VELVETECH_PROJECT_ID);
  if (error) return { counts: null, error };
  if (!credentials) return { counts: null, error: "GetSales credentials are not configured" };


  const res = await fetchLeadsMetricsForRange(
    {
      fromIso: `${win.from}T00:00:00.000Z`,
      toIso: `${win.to}T23:59:59.999Z`,
      groupBy: "flows",
      metrics: [
        "linkedin_connection_request_sent_count",
        "linkedin_connection_request_accepted_count",
      ],
    },
    credentials
  );
  if (res.error) return { counts: null, error: res.error };

  // These counters are unique LEADS, so summing the per-flow rows double-counts anyone enrolled
  // in more than one flow — and three of these flows are duplicates holding the same people.
  // Take the API's own total; only fall back to a sum when it does not return one, and say so.
  const keys = [
    "linkedin_connection_request_sent_count",
    "linkedin_connection_request_accepted_count",
  ];
  const counts: Record<string, number> = { [keys[0]]: 0, [keys[1]]: 0 };
  if (res.total) {
    for (const key of keys) counts[key] = num(res.total[key]);
    return { counts, error: null };
  }
  for (const row of res.rows) {
    for (const key of keys) counts[key] += num(row.metrics[key]);
  }
  return {
    counts,
    error: null,
    summed: true,
  };
}

/** Notes replace the snapshot wording once a stage is answered live. */
const LINKEDIN_STAGE_NOTE: Record<string, string> = {
  "Connection sent": "Invitations GetSales sent inside this window",
  "Connection accepted":
    "Acceptances GetSales recorded inside this window. Some belong to invitations sent " +
    "earlier, so this is not a conversion of the row above and no rate is shown against it.",
};

/**
 * Stages whose base differs from the stage above, so a step percentage between them would be
 * arithmetic on two different populations.
 *
 * GetSales offers two readings of an acceptance: the counter view (how many acceptances landed
 * in the window, whenever the invitation went out) and the cohort view (of the invitations sent
 * in the window, how many have been accepted). We read the counter, which on 2026-09-09 gave 49
 * where the cohort gave 47, and 25 where the cohort gave 17. Dividing the counter by invitations
 * sent produces a rate that belongs to neither reading.
 */
const LINKEDIN_STAGE_NO_RATE = new Set(["Connection accepted"]);

/**
 * Only the two stages we hold no record of come from GetSales.
 *
 * Messages and replies must NOT: GetSales's `linkedin_sent_count` counts flow-attributed sends
 * only, so a message an SDR types by hand does not appear in it. On 2026-09-09 it reported zero
 * messages for a window in which 67 were sent by hand to 37 people, and the page published that
 * zero. Our own message mirror records both automated and manual sends, so it answers these two.
 */
const LINKEDIN_STAGE_METRIC: Record<string, string> = {
  "Connection sent": "linkedin_connection_request_sent_count",
  "Connection accepted": "linkedin_connection_request_accepted_count",
};

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

  const [funnelRes, campaignRes, deptRes, researchRes, pipelineRes, linkedinLive] = await Promise.all([
    client.rpc(FUNNEL_FN, args),
    client.rpc(CAMPAIGNS_FN, args),
    client.rpc(DEPT_FN, args),
    client.from(RESEARCH_MV).select("*").maybeSingle(),
    client.from(PIPELINE_MV).select("stage, ord, companies, people, note, refreshed_at"),
    fetchLinkedinStages(client, win),
  ]);

  if (funnelRes.error) warnings.push(`Outreach funnel unavailable: ${funnelRes.error.message}`);
  if (campaignRes.error) warnings.push(`Campaign snapshots unavailable: ${campaignRes.error.message}`);
  if (deptRes.error) warnings.push(`Department breakdown unavailable: ${deptRes.error.message}`);
  if (researchRes.error) warnings.push(`Research snapshot unavailable: ${researchRes.error.message}`);
  if (pipelineRes.error) warnings.push(`Pipeline snapshot unavailable: ${pipelineRes.error.message}`);

  // GetSales is the only record of the LinkedIn stages, so its live counts win over the
  // scheduled snapshot. On failure the snapshot stands and the page says the numbers are stale.
  const funnelRows = (funnelRes.data ?? []) as Array<Record<string, unknown>>;
  if (linkedinLive.counts) {
    for (const row of funnelRows) {
      if (row.channel !== "linkedin") continue;
      const metric = LINKEDIN_STAGE_METRIC[String(row.stage ?? "")];
      if (!metric) continue;
      row.people = linkedinLive.counts[metric];
      row.source = "getsales";
      row.note = LINKEDIN_STAGE_NOTE[String(row.stage ?? "")] ?? row.note;
    }
    if (linkedinLive.summed) {
      warnings.push(
        "GetSales returned no workspace total, so the LinkedIn connection figures are a sum " +
          "across flows and may double-count anyone enrolled in more than one."
      );
    }
  } else if (linkedinLive.error) {
    warnings.push(
      `LinkedIn stages fell back to the last snapshot, which may be days old: ${linkedinLive.error}`
    );
  }

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
    funnel: buildFunnel(funnelRows),
    campaigns,
    departments,
    research: researchRes.error ? null : buildResearch((researchRes.data ?? null) as Record<string, unknown> | null),
    pipeline,
    capturedAt,
    warnings,
  };
}
