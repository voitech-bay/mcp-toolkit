import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  FLOWS_TABLE,
  FLOW_LEADS_TABLE,
  getHypothesesWithCounts,
  getHypothesisTagContacts,
  getSupabase,
} from "../services/supabase.js";

/**
 * `find_project_hypothesis` — list hypotheses for a project with:
 *  - contacts_count (distinct contacts tagged with the hypothesis's GetSales tag)
 *  - flows_count + flows[] (distinct flows those contacts appear in via FlowLeads)
 *
 * Hypothesis→contacts mapping mirrors the existing "Hypothesis → contacts (by tag)" view:
 * hypotheses.getsales_tag_uuid → Contacts.tags (or companies.tags).
 */
export function registerFindProjectHypothesisTool(server: McpServer): void {
  server.tool(
    "find_project_hypothesis",
    "List all hypotheses for a project with contacts_count (via GetSales tag → Contacts), flows_count and flows[] (distinct flows reached via those contacts through FlowLeads). Returns id, name, description, target_persona, target_count (companies), getsales_tag_uuid, getsales_tag_name, contacts_count, flows_count, flows[].",
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

      const { data: hyps, error: hErr } = await getHypothesesWithCounts(client, args.projectId);
      if (hErr) {
        return {
          content: [{ type: "text" as const, text: `Error: ${hErr}` }],
          isError: true,
        };
      }

      // Pre-fetch all flows for the project (to resolve uuid → name)
      const { data: flowsData, error: fErr } = await client
        .from(FLOWS_TABLE)
        .select("uuid, name")
        .eq("project_id", args.projectId);
      if (fErr) {
        return {
          content: [{ type: "text" as const, text: `Error: ${fErr.message}` }],
          isError: true,
        };
      }
      const flowNameByUuid = new Map<string, string>();
      for (const row of (flowsData ?? []) as Array<Record<string, unknown>>) {
        const u = row.uuid as string | undefined;
        const n = (row.name as string | null) ?? null;
        if (u) flowNameByUuid.set(u, n ?? "(unnamed flow)");
      }

      const results = await Promise.all(
        hyps.map(async (h) => {
          // Contacts matching the hypothesis's tag
          const tagRes = await getHypothesisTagContacts(client, h.id);
          const contacts = tagRes.error ? [] : tagRes.data;
          const contactUuids = contacts.map((c) => c.contact_uuid).filter(Boolean);
          const contactsCount = contactUuids.length;

          // Distinct flows those contacts belong to (FlowLeads)
          const flowUuids = new Set<string>();
          if (contactUuids.length > 0) {
            const chunkSize = 500;
            for (let i = 0; i < contactUuids.length; i += chunkSize) {
              const chunk = contactUuids.slice(i, i + chunkSize);
              const { data, error } = await client
                .from(FLOW_LEADS_TABLE)
                .select("flow_uuid")
                .eq("project_id", args.projectId)
                .in("lead_uuid", chunk);
              if (error) continue;
              for (const row of (data ?? []) as Array<Record<string, unknown>>) {
                const fu = row.flow_uuid as string | null;
                if (fu) flowUuids.add(fu);
              }
            }
          }

          const flows = [...flowUuids]
            .map((u) => ({ uuid: u, name: flowNameByUuid.get(u) ?? null }))
            .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));

          return {
            id: h.id,
            name: h.name,
            description: h.description,
            target_persona: h.target_persona,
            target_count: h.target_count,
            getsales_tag_uuid: h.getsales_tag_uuid,
            getsales_tag_name: h.getsales_tag_name,
            contacts_count: contactsCount,
            flows_count: flows.length,
            flows,
            tag_lookup_error: tagRes.error ?? null,
          };
        })
      );

      const payload = {
        project_id: args.projectId,
        count: results.length,
        hypotheses: results,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    }
  );
}
