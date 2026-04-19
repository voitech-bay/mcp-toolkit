import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { executeReadonlyUserSql } from "../services/readonly-postgres.js";

const executeReadonlySqlSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(100_000)
    .describe(
      "Single SQL statement. Must be read-only: SELECT / WITH / TABLE / VALUES / SHOW (optional leading EXPLAIN …). Mutating keywords (INSERT, UPDATE, DELETE, DDL, COPY, SET at start, etc.) are rejected before execution. Uses SUPABASE_READONLY_DATABASE_URL or READONLY_DATABASE_URL."
    ),
});

/**
 * `execute_readonly_sql` — run one guarded read-only query on the dedicated Postgres role.
 */
export function registerExecuteReadonlySqlTool(server: McpServer): void {
  server.tool(
    "execute_readonly_sql",
    "Execute exactly one read-only SQL statement against the database using a separate SELECT-only connection (SUPABASE_READONLY_DATABASE_URL or READONLY_DATABASE_URL). Guardrails reject non-SELECT-style / mutating constructs before sending to the server. Returns rows, rowCount, and field names. Connection uses a 60s statement_timeout.",
    executeReadonlySqlSchema.shape,
    async (args: unknown) => {
      const parsed = executeReadonlySqlSchema.safeParse(args);
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

      const { data, error } = await executeReadonlyUserSql(parsed.data.query);
      if (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error}` }],
          isError: true,
        };
      }

      const payload = {
        row_count: data?.rowCount ?? 0,
        fields: data?.fields ?? [],
        rows: data?.rows ?? [],
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    }
  );
}
