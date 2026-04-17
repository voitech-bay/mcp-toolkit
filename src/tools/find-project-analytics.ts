import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  ANALYTICS_SNAPSHOTS_TABLE,
  FLOWS_TABLE,
  FLOW_LEADS_TABLE,
  getHypothesesWithCounts,
  getHypothesisTagContacts,
  getSupabase,
} from "../services/supabase.js";

interface FunnelMetrics {
  connection_sent: number;
  connection_accepted: number;
  inbox: number;
  positive_replies: number;
  accepted_rate_pct: number | null;
  inbox_rate_pct: number | null;
  positive_rate_pct: number | null;
}

function emptyMetrics(): FunnelMetrics {
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

function toInt(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function finalizeRates(m: FunnelMetrics): FunnelMetrics {
  if (m.connection_sent > 0) {
    m.accepted_rate_pct = (100 * m.connection_accepted) / m.connection_sent;
    m.inbox_rate_pct = (100 * m.inbox) / m.connection_sent;
    m.positive_rate_pct = (100 * m.positive_replies) / m.connection_sent;
  }
  return m;
}

function addInto(dst: FunnelMetrics, metrics: Record<string, unknown>): void {
  dst.connection_sent += toInt(metrics.linkedin_connection_request_sent_count);
  dst.connection_accepted += toInt(metrics.linkedin_connection_request_accepted_count);
  dst.inbox += toInt(metrics.linkedin_inbox_count);
  dst.positive_replies += toInt(metrics.linkedin_positive_count);
}

function daysBetween(fromYmd: string, toYmd: string): number | null {
  const m = /^\d{4}-\d{2}-\d{2}$/;
  if (!m.test(fromYmd) || !m.test(toYmd)) return null;
  const a = new Date(fromYmd + "T00:00:00Z").getTime();
  const b = new Date(toYmd + "T00:00:00Z").getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (b < a) return null;
  return Math.floor((b - a) / 86_400_000) + 1;
}

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

      // Aggregate snapshot metrics per flow_uuid (paginated).
      const metricsByFlow = new Map<string, FunnelMetrics>();
      const pageSize = 1000;
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await client
          .from(ANALYTICS_SNAPSHOTS_TABLE)
          .select("flow_uuid, metrics")
          .eq("project_id", args.projectId)
          .eq("group_by", "sender_profiles")
          .not("flow_uuid", "is", null)
          .gte("snapshot_date", args.dateFrom)
          .lte("snapshot_date", args.dateTo)
          .range(offset, offset + pageSize - 1);
        if (error) {
          return {
            content: [{ type: "text" as const, text: `Error: ${error.message}` }],
            isError: true,
          };
        }
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
          addInto(metricsByFlow.get(fu)!, m);
        }
        if (rows.length < pageSize) break;
      }

      // Resolve flow names for the project
      const { data: flowRows, error: flowErr } = await client
        .from(FLOWS_TABLE)
        .select("uuid, name")
        .eq("project_id", args.projectId);
      if (flowErr) {
        return {
          content: [{ type: "text" as const, text: `Error: ${flowErr.message}` }],
          isError: true,
        };
      }
      const flowNameByUuid = new Map<string, string>();
      for (const row of (flowRows ?? []) as Array<Record<string, unknown>>) {
        const u = row.uuid as string | undefined;
        const n = (row.name as string | null) ?? null;
        if (u) flowNameByUuid.set(u, n ?? "(unnamed flow)");
      }

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
      const { data: allHyps, error: hErr } = await getHypothesesWithCounts(client, args.projectId);
      if (hErr) {
        return {
          content: [{ type: "text" as const, text: `Error: ${hErr}` }],
          isError: true,
        };
      }
      const selectedHyps = args.entityIds && args.entityIds.length > 0
        ? allHyps.filter((h) => args.entityIds!.includes(h.id))
        : allHyps;

      const groups = [];
      for (const h of selectedHyps) {
        // Hypothesis → contacts (via GetSales tag)
        const tagRes = await getHypothesisTagContacts(client, h.id);
        const contactUuids = (tagRes.error ? [] : tagRes.data)
          .map((c) => c.contact_uuid)
          .filter(Boolean);

        // Contacts → flow_uuids via FlowLeads
        const flowUuids = new Set<string>();
        if (contactUuids.length > 0) {
          const chunkSize = 500;
          for (let i = 0; i < contactUuids.length; i += chunkSize) {
            const chunk = contactUuids.slice(i, i + chunkSize);
            const { data } = await client
              .from(FLOW_LEADS_TABLE)
              .select("flow_uuid")
              .eq("project_id", args.projectId)
              .in("lead_uuid", chunk);
            for (const row of (data ?? []) as Array<Record<string, unknown>>) {
              const fu = row.flow_uuid as string | null;
              if (fu) flowUuids.add(fu);
            }
          }
        }

        const flowsBreakdown = [...flowUuids]
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

        groups.push({
          type: "hypothesis" as const,
          hypothesis: {
            id: h.id,
            name: h.name,
            description: h.description,
            getsales_tag_uuid: h.getsales_tag_uuid,
            getsales_tag_name: h.getsales_tag_name,
          },
          contacts_count: contactUuids.length,
          flows_count: flowsBreakdown.length,
          metrics: total,
          flows: flowsBreakdown,
          tag_lookup_error: tagRes.error ?? null,
        });
      }

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
