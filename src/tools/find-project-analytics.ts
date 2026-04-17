import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSupabase } from "../services/supabase.js";
import {
  aggregateMetricsByFlow,
  daysBetween,
  emptyMetrics,
  finalizeRates,
  getFlowNameMap,
  resolveHypothesisFlows,
} from "../services/analytics-funnel.js";

/**
 * `find_project_analytics` — aggregate AnalyticsSnapshots for a date range (≤ 30 days).
 * Group by flow or by hypothesis. When grouping by hypothesis each group contains
 * multiple flows (resolved via hypothesis→GetSales tag→contacts→FlowLeads→flow).
 */
export function registerFindProjectAnalyticsTool(server: McpServer): void {
  server.tool(
    "find_project_analytics",
    "Aggregate AnalyticsSnapshots (funnel metrics) for a project over a DATE_RANGE (max 30 days), grouped by 'flow' (1 group = 1 flow) or 'hypothesis' (1 group = N flows, mapped via hypothesis tag→contacts→FlowLeads). Metrics: connection_sent, connection_accepted, inbox, positive_replies and derived rate %. Pass `entityIds` to limit to specific flow uuids or hypothesis ids; omit to return all.",
    {
      projectId: z.string().uuid().describe("Supabase project id."),
      dateFrom: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe("Start date inclusive (YYYY-MM-DD)."),
      dateTo: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .describe("End date inclusive (YYYY-MM-DD). Range must be ≤ 30 days."),
      type: z
        .enum(["flow", "hypothesis"])
        .describe("Grouping: 'flow' (1 group per flow) or 'hypothesis' (1 group per hypothesis with flows breakdown)."),
      entityIds: z
        .array(z.string())
        .optional()
        .describe("Optional list of flow uuids (type='flow') or hypothesis ids (type='hypothesis'). Omit to return all."),
    },
    async (args) => {
      const client = getSupabase();
      if (!client) {
        return {
          content: [{ type: "text" as const, text: "Supabase not configured." }],
          isError: true,
        };
      }

      const days = daysBetween(args.dateFrom, args.dateTo);
      if (days == null) {
        return {
          content: [
            { type: "text" as const, text: "Invalid DATE_RANGE. Use YYYY-MM-DD and dateTo ≥ dateFrom." },
          ],
          isError: true,
        };
      }
      if (days > 30) {
        return {
          content: [
            { type: "text" as const, text: `DATE_RANGE too large: ${days} days (max 30).` },
          ],
          isError: true,
        };
      }

      const agg = await aggregateMetricsByFlow(client, args.projectId, args.dateFrom, args.dateTo);
      if (agg.error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${agg.error}` }],
          isError: true,
        };
      }
      const metricsByFlow = agg.data;

      const flowNames = await getFlowNameMap(client, args.projectId);
      if (flowNames.error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${flowNames.error}` }],
          isError: true,
        };
      }
      const flowNameByUuid = flowNames.data;

      if (args.type === "flow") {
        const filterIds = args.entityIds && args.entityIds.length > 0
          ? new Set(args.entityIds)
          : null;
        const flowIds = filterIds
          ? [...filterIds]
          : [...new Set<string>([...metricsByFlow.keys(), ...flowNameByUuid.keys()])];

        const groups = flowIds
          .filter((id) => filterIds ? filterIds.has(id) : true)
          .map((id) => {
            const m = metricsByFlow.get(id) ?? emptyMetrics();
            return {
              type: "flow" as const,
              flow: { uuid: id, name: flowNameByUuid.get(id) ?? null },
              metrics: finalizeRates({ ...m }),
            };
          });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  project_id: args.projectId,
                  type: args.type,
                  date_from: args.dateFrom,
                  date_to: args.dateTo,
                  days,
                  groups,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // type === "hypothesis"
      const hypsRes = await resolveHypothesisFlows(client, args.projectId, args.entityIds);
      if (hypsRes.error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${hypsRes.error}` }],
          isError: true,
        };
      }

      const groups = hypsRes.data.map((h) => {
        const flowsBreakdown = h.flow_uuids
          .map((fu) => ({
            uuid: fu,
            name: flowNameByUuid.get(fu) ?? null,
            metrics: finalizeRates({ ...(metricsByFlow.get(fu) ?? emptyMetrics()) }),
          }))
          .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

        const total = emptyMetrics();
        for (const f of flowsBreakdown) {
          total.connection_sent += f.metrics.connection_sent;
          total.connection_accepted += f.metrics.connection_accepted;
          total.inbox += f.metrics.inbox;
          total.positive_replies += f.metrics.positive_replies;
        }
        finalizeRates(total);

        return {
          type: "hypothesis" as const,
          hypothesis: {
            id: h.id,
            name: h.name,
            description: h.description,
            getsales_tag_uuid: h.getsales_tag_uuid,
            getsales_tag_name: h.getsales_tag_name,
          },
          contacts_count: h.contacts_count,
          flows_count: flowsBreakdown.length,
          metrics: total,
          flows: flowsBreakdown,
          tag_lookup_error: h.tag_lookup_error,
        };
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                project_id: args.projectId,
                type: args.type,
                date_from: args.dateFrom,
                date_to: args.dateTo,
                days,
                groups,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
