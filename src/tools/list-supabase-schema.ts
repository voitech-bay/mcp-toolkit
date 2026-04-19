import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { listSupabaseSchemaSimple } from "../services/readonly-postgres.js";

/**
 * `list_supabase_schema` — list tables and columns via the read-only Postgres connection.
 */
export function registerListSupabaseSchemaTool(server: McpServer): void {
  server.tool(
    "list_supabase_schema",
    "List database tables and columns (information_schema) using the read-only SQL role. Requires SUPABASE_READONLY_DATABASE_URL or READONLY_DATABASE_URL. Returns schema name, table name, and columns with data_type and is_nullable.",
    {},
    async () => {
      const { data, error } = await listSupabaseSchemaSimple();
      if (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error}` }],
          isError: true,
        };
      }

      const payload = {
        tables_count: data?.length ?? 0,
        tables: data ?? [],
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    }
  );
}
