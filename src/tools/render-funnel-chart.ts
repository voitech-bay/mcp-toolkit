import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSupabase } from "../services/supabase.js";
import {
  aggregateMetricsByFlow,
  daysBetween,
  defaultDateRange,
  emptyMetrics,
  finalizeRates,
  getFlowNameMap,
  resolveHypothesisFlows,
  type FunnelMetrics,
} from "../services/analytics-funnel.js";
import { renderAndSaveChart } from "../services/charts-public.js";

interface FunnelCell {
  /** Display title (e.g. flow name, or "Hypothesis / Flow" for hypothesis grouping). */
  title: string;
  /** Raw flow uuid (lets caller cross-reference). */
  flowUuid: string;
  metrics: FunnelMetrics;
}

/** Clamp + round to 1 decimal for % display. */
function pct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

/**
 * Build ECharts option: N funnels laid out in a grid. Each funnel has 4 stages
 * (connection sent → accepted → inbox → positive; same counts as AnalyticsSnapshots).
 * Uses one `funnel` series per cell with pixel-free percentage positioning.
 */
function buildFunnelChartOption(opts: {
  cells: FunnelCell[];
  headerText: string;
  cols: number;
  rows: number;
}): Record<string, unknown> {
  const { cells, headerText, cols, rows } = opts;
  const stageNames = [
    "Connection sent",
    "Connection accepted",
    "Inbox reply",
    "Inbox positive",
  ];
  const palette = ["#5470c6", "#91cc75", "#fac858", "#ee6666"];

  // Reserve header (top) and legend area. Grid starts below.
  const headerPct = 10; // %
  const gridTopPct = headerPct + 4;
  const gridBottomPct = 4;
  const gridLeftPct = 2;
  const gridRightPct = 2;

  const usableW = 100 - gridLeftPct - gridRightPct;
  const usableH = 100 - gridTopPct - gridBottomPct;
  const cellW = usableW / cols;
  const cellH = usableH / rows;

  // Per-cell paddings (% within cell).
  const cellTitleReserve = 0.18; // 18% for title
  const cellPadSide = 0.08;
  const cellPadBottom = 0.06;

  const titles: Array<Record<string, unknown>> = [
    {
      text: headerText,
      left: "center",
      top: "1%",
      textStyle: { fontSize: 16, fontWeight: 600 },
    },
  ];

  const series: Array<Record<string, unknown>> = [];

  cells.forEach((cell, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cellLeft = gridLeftPct + col * cellW;
    const cellTop = gridTopPct + row * cellH;

    const funnelLeft = cellLeft + cellW * cellPadSide;
    const funnelWidth = cellW * (1 - 2 * cellPadSide);
    const funnelTop = cellTop + cellH * cellTitleReserve;
    const funnelHeight = cellH * (1 - cellTitleReserve - cellPadBottom);

    const m = cell.metrics;
    const subtitle =
      `sent ${m.connection_sent}  ·  acc ${pct(m.accepted_rate_pct)}  ·  ` +
      `inbox ${pct(m.inbox_rate_pct)}  ·  pos ${pct(m.positive_rate_pct)}` +
      (m.messages_sent > 0
        ? `  ·  LinkedIn msgs (all sends) ${m.messages_sent}` +
          (m.connection_request_rate_pct != null
            ? ` (${pct(m.connection_request_rate_pct)} with conn. req.)`
            : "")
        : "");

    titles.push({
      text: cell.title,
      subtext: subtitle,
      left: `${cellLeft + cellW / 2}%`,
      top: `${cellTop + cellH * 0.02}%`,
      textAlign: "center",
      textStyle: { fontSize: 13, fontWeight: 600 },
      subtextStyle: { fontSize: 11, color: "#666" },
    });

    series.push({
      name: cell.title,
      type: "funnel",
      left: `${funnelLeft}%`,
      top: `${funnelTop}%`,
      width: `${funnelWidth}%`,
      height: `${funnelHeight}%`,
      min: 0,
      minSize: "15%",
      maxSize: "100%",
      sort: "none",
      gap: 2,
      label: {
        show: true,
        position: "inside",
        color: "#fff",
        fontSize: 11,
        formatter: (p: { name: string; value: number }) =>
          `${p.name}: ${p.value}`,
      },
      labelLine: { show: false },
      itemStyle: { borderColor: "#fff", borderWidth: 1 },
      data: [
        { value: m.connection_sent, name: "Connection sent", itemStyle: { color: palette[0] } },
        { value: m.connection_accepted, name: "Connection accepted", itemStyle: { color: palette[1] } },
        { value: m.inbox, name: "Inbox reply", itemStyle: { color: palette[2] } },
        { value: m.positive_replies, name: "Inbox positive", itemStyle: { color: palette[3] } },
      ],
    });
  });

  return {
    backgroundColor: "#fff",
    title: titles,
    legend: {
      data: stageNames,
      top: `${headerPct - 2}%`,
      textStyle: { fontSize: 11 },
    },
    tooltip: {
      trigger: "item",
      formatter: "{a} · {b}: {c}",
    },
    series,
  };
}

/** Pick a (cols, rows) grid for N cells. */
function pickGrid(n: number): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n <= 3) return { cols: n, rows: 1 };
  if (n <= 4) return { cols: 2, rows: 2 };
  if (n <= 6) return { cols: 3, rows: 2 };
  if (n <= 9) return { cols: 3, rows: 3 };
  const cols = Math.ceil(Math.sqrt(n));
  return { cols, rows: Math.ceil(n / cols) };
}

const FUNNEL_CHART_INSTRUCTIONS = `
ALWAYS use this tool (NOT render_chart) for any LinkedIn outreach funnel chart by flow or hypothesis.
Do NOT hand-build a funnel via render_chart — this tool fetches AnalyticsSnapshots, aggregates metrics,
and renders the funnel server-side with correct stages and rates.

Trigger phrases (non-exhaustive): "funnel", "funnel chart", "render funnel", "draw funnel",
"show funnel for flow/hypothesis", "outreach funnel", "conversion funnel", "LinkedIn funnel".

Output: PNG (default) or SVG saved under charts-public/, returns the public image URL.
Each funnel shows 4 stages: Connection sent → Connection accepted → Inbox reply → Inbox positive (AnalyticsSnapshots). Subtitle adds rates (accepted ÷ sent, inbox ÷ accepted, positive ÷ inbox) and optional LinkedIn “all messages sent” count (not a funnel stage).

type="flows": one funnel per flow; entityIds = flow uuids (omit for all flows in project).
type="hypothesis": resolves hypothesis→flows via GetSales tag→contacts→FlowLeads; one funnel per flow,
  titled "Hypothesis / Flow". entityIds = hypothesis ids (omit for all hypotheses).

Date range is inclusive YYYY-MM-DD, max 30 days. Defaults to last 7 days (today-6 … today, UTC).
`.trim();

export function registerRenderFunnelChartTool(server: McpServer): void {
  server.tool(
    "render_funnel_chart",
    FUNNEL_CHART_INSTRUCTIONS,
    {
      projectId: z.string().uuid().describe("Supabase project id."),
      type: z
        .enum(["flows", "hypothesis"])
        .describe("'flows' (entityIds = flow uuids) or 'hypothesis' (entityIds = hypothesis ids, resolved to flows)."),
      dateFrom: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("Start date inclusive (YYYY-MM-DD). Default: today-6 (UTC)."),
      dateTo: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("End date inclusive (YYYY-MM-DD). Default: today (UTC). Range ≤ 30 days."),
      entityIds: z
        .array(z.string())
        .optional()
        .describe("Optional list: flow uuids (type='flows') or hypothesis ids (type='hypothesis'). Omit for all."),
      format: z
        .enum(["png", "svg"])
        .optional()
        .describe('Output format. Default "png".'),
      width: z
        .number()
        .int()
        .min(200)
        .max(4000)
        .optional()
        .describe("Chart width in px. Default: auto-sized by grid."),
      height: z
        .number()
        .int()
        .min(200)
        .max(4000)
        .optional()
        .describe("Chart height in px. Default: auto-sized by grid."),
    },
    async (args) => {
      const client = getSupabase();
      if (!client) {
        return {
          content: [{ type: "text" as const, text: "Supabase not configured." }],
          isError: true,
        };
      }

      const range = args.dateFrom && args.dateTo
        ? { dateFrom: args.dateFrom, dateTo: args.dateTo }
        : defaultDateRange(7);
      const { dateFrom, dateTo } = range;

      const days = daysBetween(dateFrom, dateTo);
      if (days == null) {
        return {
          content: [{ type: "text" as const, text: "Invalid DATE_RANGE. Use YYYY-MM-DD and dateTo ≥ dateFrom." }],
          isError: true,
        };
      }
      if (days > 30) {
        return {
          content: [{ type: "text" as const, text: `DATE_RANGE too large: ${days} days (max 30).` }],
          isError: true,
        };
      }

      const [agg, flowNames] = await Promise.all([
        aggregateMetricsByFlow(client, args.projectId, dateFrom, dateTo),
        getFlowNameMap(client, args.projectId),
      ]);
      if (agg.error) {
        return { content: [{ type: "text" as const, text: `Error: ${agg.error}` }], isError: true };
      }
      if (flowNames.error) {
        return { content: [{ type: "text" as const, text: `Error: ${flowNames.error}` }], isError: true };
      }
      const metricsByFlow = agg.data;
      const flowNameByUuid = flowNames.data;

      const cells: FunnelCell[] = [];

      if (args.type === "flows") {
        const filterIds = args.entityIds && args.entityIds.length > 0
          ? new Set(args.entityIds)
          : null;
        const flowIds = filterIds
          ? [...filterIds]
          : [...new Set<string>([...metricsByFlow.keys(), ...flowNameByUuid.keys()])];
        for (const id of flowIds) {
          const m = finalizeRates({ ...(metricsByFlow.get(id) ?? emptyMetrics()) });
          cells.push({
            title: flowNameByUuid.get(id) ?? id.slice(0, 8),
            flowUuid: id,
            metrics: m,
          });
        }
      } else {
        const hypsRes = await resolveHypothesisFlows(client, args.projectId, args.entityIds);
        if (hypsRes.error) {
          return { content: [{ type: "text" as const, text: `Error: ${hypsRes.error}` }], isError: true };
        }
        for (const h of hypsRes.data) {
          const hypLabel = h.name ?? h.id.slice(0, 8);
          for (const fu of h.flow_uuids) {
            const m = finalizeRates({ ...(metricsByFlow.get(fu) ?? emptyMetrics()) });
            cells.push({
              title: `${hypLabel} / ${flowNameByUuid.get(fu) ?? fu.slice(0, 8)}`,
              flowUuid: fu,
              metrics: m,
            });
          }
        }
      }

      // Sort cells by total sent desc for consistent visual order.
      cells.sort((a, b) => {
        const d = b.metrics.connection_sent - a.metrics.connection_sent;
        return d !== 0 ? d : b.metrics.messages_sent - a.metrics.messages_sent;
      });

      if (cells.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  note: "No flows matched the filter. Nothing to render.",
                  project_id: args.projectId,
                  type: args.type,
                  date_from: dateFrom,
                  date_to: dateTo,
                  days,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      const { cols, rows } = pickGrid(cells.length);
      const autoWidth = Math.max(600, Math.min(4000, cols * 420 + 80));
      const autoHeight = Math.max(400, Math.min(4000, rows * 360 + 120));
      const width = args.width ?? autoWidth;
      const height = args.height ?? autoHeight;

      const headerText = `Funnel (${args.type}) · ${dateFrom} → ${dateTo} · ${days}d · ${cells.length} flow${cells.length === 1 ? "" : "s"}`;

      const option = buildFunnelChartOption({ cells, headerText, cols, rows });

      try {
        const saved = await renderAndSaveChart({
          option,
          width,
          height,
          filenameBase: `funnel-${args.type}`,
          format: args.format ?? "png",
        });
        const payload = {
          url: saved.url,
          filename: saved.filename,
          format: (args.format ?? "png") === "svg" ? "image/svg+xml" : "image/png",
          project_id: args.projectId,
          type: args.type,
          date_from: dateFrom,
          date_to: dateTo,
          days,
          flows_count: cells.length,
          grid: { cols, rows },
          cells: cells.map((c) => ({
            title: c.title,
            flow_uuid: c.flowUuid,
            metrics: c.metrics,
          })),
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `render_funnel_chart failed: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
