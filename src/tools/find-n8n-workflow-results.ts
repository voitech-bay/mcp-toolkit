import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  findCompanies,
  findContactsByNameLikeGlobal,
  getN8nWorkflowResultsByForeignIds,
  getSupabase,
} from "../services/supabase.js";

const findN8nWorkflowResultsSchema = z.object({
  companyName: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Substring to match against companies.name or domain (ILIKE). Use this OR contactName, not both."
    ),
  contactName: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Substring to match against Contacts name, first_name, or last_name (ILIKE). Use this OR companyName, not both."
    ),
  entityMatchLimit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max companies or contacts to consider when resolving ids (default 50)."),
  resultsLimit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Max n8n_workflow_results rows to return (default 200, newest first)."),
});

const findN8nWorkflowResultsInput = findN8nWorkflowResultsSchema.refine(
  (a) => {
    const c = a.companyName?.trim().length ?? 0;
    const t = a.contactName?.trim().length ?? 0;
    return (c > 0 && t === 0) || (t > 0 && c === 0);
  },
  { message: "Provide exactly one non-empty value: companyName OR contactName." }
);

/**
 * `find_n8n_workflow_results` — resolve companies or contacts by name (ILIKE), then return matching n8n agent result rows.
 */
export function registerFindN8nWorkflowResultsTool(server: McpServer): void {
  server.tool(
    "find_n8n_workflow_results",
    "Find n8n workflow result rows (table n8n_workflow_results). Pass exactly one of: companyName (ILIKE companies.name or domain) or contactName (ILIKE Contacts name/first_name/last_name). Resolves matching entity ids, then returns results where company_id or contact_id matches (newest first).",
    findN8nWorkflowResultsSchema.shape,
    async (args: unknown) => {
      const parsed = findN8nWorkflowResultsInput.safeParse(args);
      if (!parsed.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: parsed.error.issues.map((i) => i.message).join("; "),
            },
          ],
          isError: true,
        };
      }

      const client = getSupabase();
      if (!client) {
        return {
          content: [{ type: "text" as const, text: "Supabase not configured." }],
          isError: true,
        };
      }

      const entityLimit = Math.min(Math.max(parsed.data.entityMatchLimit ?? 50, 1), 100);
      const resultsLimit = Math.min(Math.max(parsed.data.resultsLimit ?? 200, 1), 500);

      if (parsed.data.companyName?.trim()) {
        const nameLike = parsed.data.companyName.trim();
        const { data: companies, error: coErr } = await findCompanies(client, {
          nameLike,
          limit: entityLimit,
        });
        if (coErr) {
          return {
            content: [{ type: "text" as const, text: `Error finding companies: ${coErr}` }],
            isError: true,
          };
        }
        const ids = companies.map((c) => c.id);
        const { data: results, error: resErr } = await getN8nWorkflowResultsByForeignIds(client, {
          column: "company_id",
          ids,
          limit: resultsLimit,
        });
        if (resErr) {
          return {
            content: [{ type: "text" as const, text: `Error loading n8n results: ${resErr}` }],
            isError: true,
          };
        }
        const payload = {
          mode: "company" as const,
          search: nameLike,
          matched_companies: companies.map((c) => ({
            id: c.id,
            name: c.name,
            domain: c.domain,
          })),
          matched_company_count: companies.length,
          n8n_workflow_results: results,
          n8n_row_count: results.length,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
        };
      }

      const contactName = (parsed.data.contactName ?? "").trim();
      if (!contactName) {
        return {
          content: [
            {
              type: "text" as const,
              text: "contactName was empty after validation; use companyName or contactName.",
            },
          ],
          isError: true,
        };
      }
      const { data: contacts, error: ctErr } = await findContactsByNameLikeGlobal(client, {
        nameLike: contactName,
        limit: entityLimit,
      });
      if (ctErr) {
        return {
          content: [{ type: "text" as const, text: `Error finding contacts: ${ctErr}` }],
          isError: true,
        };
      }
      const uuids = contacts
        .map((r) => (typeof r.uuid === "string" ? r.uuid : ""))
        .filter((u) => u.length > 0);
      const { data: results, error: resErr } = await getN8nWorkflowResultsByForeignIds(client, {
        column: "contact_id",
        ids: uuids,
        limit: resultsLimit,
      });
      if (resErr) {
        return {
          content: [{ type: "text" as const, text: `Error loading n8n results: ${resErr}` }],
          isError: true,
        };
      }
      const payload = {
        mode: "contact" as const,
        search: contactName,
        matched_contacts: contacts.map((c) => ({
          uuid: c.uuid,
          name: c.name,
          first_name: c.first_name,
          last_name: c.last_name,
          company_name: c.company_name,
          project_id: c.project_id,
        })),
        matched_contact_count: contacts.length,
        n8n_workflow_results: results,
        n8n_row_count: results.length,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    }
  );
}
