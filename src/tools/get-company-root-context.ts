import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSupabase, getCompanyContextByCompanyId } from "../services/supabase.js";

export function registerGetCompanyRootContextTool(server: McpServer): void {
  server.tool(
    "get_company_root_context",
    "Get the root context for a company from the CompaniesContext table. Searches by company_id (companies.id UUID). Returns the row with id, company_id, rootContext, created_at, or null if not found. Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).",
    {
      companyId: z.string().uuid().describe("Company UUID (companies.id)."),
    },
    async (args) => {
      const client = getSupabase();
      if (!client) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) in .env.",
            },
          ],
          isError: true,
        };
      }
      const result = await getCompanyContextByCompanyId(client, args.companyId);
      if (result.error) {
        return {
          content: [{ type: "text" as const, text: result.error }],
          isError: true,
        };
      }
      const text = result.data == null
        ? "No company context found for that company_id."
        : JSON.stringify(result.data, null, 2);
      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );
}
