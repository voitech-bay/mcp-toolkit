import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { renderAndSaveChart } from "../services/charts-public.js";

/** Tool listing text: teaches valid \`option\` JSON so the model need not use helper scripts. */
const RENDER_CHART_INSTRUCTIONS = `
Generic ECharts renderer for ad-hoc bar/line/pie/scatter charts from arbitrary data.

DO NOT USE for LinkedIn outreach funnels by flow or hypothesis — use \`render_funnel_chart\` instead.
That tool fetches AnalyticsSnapshots and builds the funnel (Sent → Accepted → Inbox → Positive) correctly.
Only fall back to \`render_chart\` for funnels if the user explicitly supplies custom data / stages
that don't come from analytics.

Server renders Apache ECharts (SVG in memory), saves PNG or SVG to charts-public/, returns a public image URL.
Default output is PNG (smaller, universal for chat/embed). Pass format "svg" for vector output.
Use JSON only—no Python. Param option = same object as ECharts chart.setOption() in JavaScript.

Rules: series is always an array. For category xAxis, xAxis.data.length must match each cartesian series[].data.length. Use string types: "category", "value", "bar", "line", "pie", ...
Defaults: width 800, height 500. Set env CHARTS_PUBLIC_BASE_URL in production for correct absolute URLs.

BAR (template):
{"title":{"text":"Title"},"tooltip":{},"xAxis":{"type":"category","data":["A","B","C"]},"yAxis":{"type":"value"},"series":[{"name":"S","type":"bar","data":[1,2,3]}]}

LINE:
{"title":{"text":"T"},"xAxis":{"type":"category","data":["M1","M2"]},"yAxis":{"type":"value"},"series":[{"type":"line","data":[10,25]}]}

PIE (no x/y axes):
{"title":{"text":"T"},"series":[{"type":"pie","radius":"55%","data":[{"name":"x","value":4},{"name":"y","value":6}]}]}
`.trim();

/**
 * `render_chart` — server-side ECharts (SVG), saved to charts-public/ with a public URL.
 */
export function registerRenderChartTool(server: McpServer): void {
  server.tool(
    "render_chart",
    RENDER_CHART_INSTRUCTIONS,
    {
      option: z
        .record(z.unknown())
        .describe(
          "ECharts setOption object. See tool description for bar/line/pie templates; full reference: https://echarts.apache.org/en/option.html"
        ),
      width: z
        .number()
        .int()
        .min(16)
        .max(4000)
        .optional()
        .describe("Chart width in px (default 800)."),
      height: z
        .number()
        .int()
        .min(16)
        .max(4000)
        .optional()
        .describe("Chart height in px (default 500)."),
      filenameBase: z
        .string()
        .optional()
        .describe(
          "Optional safe filename prefix (letters, digits, ._- only, max 80 chars); a unique suffix is always appended."
        ),
      format: z
        .enum(["png", "svg"])
        .optional()
        .describe(
          'File format: "png" (default, raster) or "svg" (vector). PNG is produced by rasterizing the SSR SVG.'
        ),
    },
    async (args) => {
      try {
        const result = await renderAndSaveChart({
          option: args.option,
          width: args.width,
          height: args.height,
          filenameBase: args.filenameBase,
          format: args.format ?? "png",
        });
        const out = args.format ?? "png";
        const mime = out === "svg" ? "image/svg+xml" : "image/png";
        const payload = {
          url: result.url,
          filename: result.filename,
          format: mime,
          note:
            out === "svg"
              ? "Vector SVG URL."
              : "Raster PNG URL (ECharts SSR SVG rasterized server-side).",
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `render_chart failed: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
