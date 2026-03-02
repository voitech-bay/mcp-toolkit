import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSupabase, setCompanyRootContext } from "../services/supabase.js";

export function registerSetCompanyRootContextTool(server: McpServer): void {
  server.tool(
    "set_company_root_context",
    "Set or update the root context for a company in the CompaniesContext table. If a row with the given company name exists, it is updated; otherwise a new row is created. Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).",
    {
      companyName: z.string().describe("Company name. Used to find existing row (exact match) or as name for a new row."),
      rootContext: z.string().nullable().describe("The root context text to store. Pass null or omit to clear."),
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
      const rootContext = args.rootContext ?? null;
      const result = await setCompanyRootContext(client, args.companyName, rootContext);
      if (result.error) {
        return {
          content: [{ type: "text" as const, text: result.error }],
          isError: true,
        };
      }
      const text = result.data == null
        ? "Failed to save company context."
        : JSON.stringify(result.data, null, 2);
      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );
}
