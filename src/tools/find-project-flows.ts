import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  FLOWS_TABLE,
  FLOW_LEADS_TABLE,
  getSupabase,
} from "../services/supabase.js";

/**
 * `find_project_flows` — list every Flow that belongs to a project plus the count
 * of distinct contacts linked to each flow via FlowLeads.
 */
export function registerFindProjectFlowsTool(server: McpServer): void {
  server.tool(
    "find_project_flows",
    "List all Flows for a project with contacts_count (distinct contacts/leads per flow, via FlowLeads.lead_uuid). Returns flow uuid, name, status, created_at, updated_at, contacts_count.",
    {
      projectId: z.string().uuid().describe("Supabase project id (from find_projects)."),
    },
    async (args) => {
      const client = getSupabase();
      if (!client) {
        return {
          content: [{ type: "text" as const, text: "Supabase not configured." }],
          isError: true,
        };
      }

      const { data: flowsData, error: flowsErr } = await client
        .from(FLOWS_TABLE)
        .select("uuid, name, status, created_at, updated_at")
        .eq("project_id", args.projectId)
        .order("created_at", { ascending: false });

      if (flowsErr) {
        return {
          content: [{ type: "text" as const, text: `Error: ${flowsErr.message}` }],
          isError: true,
        };
      }

      const flows = (flowsData ?? []) as Array<Record<string, unknown>>;

      // Distinct contacts per flow — paginate FlowLeads and dedupe lead_uuid.
      const pageSize = 1000;
      const leadsByFlow = new Map<string, Set<string>>();
      for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await client
          .from(FLOW_LEADS_TABLE)
          .select("flow_uuid, lead_uuid")
          .eq("project_id", args.projectId)
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
          const lu = row.lead_uuid as string | null;
          if (!fu || !lu) continue;
          if (!leadsByFlow.has(fu)) leadsByFlow.set(fu, new Set());
          leadsByFlow.get(fu)!.add(lu);
        }
        if (rows.length < pageSize) break;
      }

      const payload = {
        project_id: args.projectId,
        count: flows.length,
        flows: flows.map((f) => ({
          uuid: f.uuid as string,
          name: (f.name as string | null) ?? null,
          status: (f.status as string | null) ?? null,
          created_at: (f.created_at as string | null) ?? null,
          updated_at: (f.updated_at as string | null) ?? null,
          contacts_count: leadsByFlow.get(f.uuid as string)?.size ?? 0,
        })),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    }
  );
}
