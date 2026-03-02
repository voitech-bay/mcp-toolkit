import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSupabase, getCompanyContextByName } from "../services/supabase.js";

export function registerGetCompanyRootContextTool(server: McpServer): void {
  server.tool(
    "get_company_root_context",
    "Get the root context for a company from the CompaniesContext table. Searches by company name (exact match). Returns the row with id, name, rootContext, created_at, or null if not found. Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).",
    {
      companyName: z.string().describe("Company name to look up (exact match)."),
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
      const result = await getCompanyContextByName(client, args.companyName);
      if (result.error) {
        return {
          content: [{ type: "text" as const, text: result.error }],
          isError: true,
        };
      }
      const text = result.data == null
        ? "No company context found for that name."
        : JSON.stringify(result.data, null, 2);
      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );
}
