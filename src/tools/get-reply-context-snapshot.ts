import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSupabase, getContextSnapshotById } from "../services/supabase.js";

/**
 * Primary path for Cursor reply flow: the UI calls /api/build-context first, then opens a short
 * deeplink that references snapshotId; this tool loads the stored context_text (full reply prompt).
 */
export function registerGetReplyContextSnapshotTool(server: McpServer): void {
  server.tool(
    "get_reply_context_snapshot",
    "Loads a reply context snapshot by UUID after the app saved it via POST /api/build-context. Returns context_text (the full reply-agent prompt). The Start reply modal always creates the snapshot first, then passes only snapshotId in the Cursor deeplink.",
    {
      snapshotId: z.string().uuid().describe("Context snapshot row id (UUID)."),
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
      const result = await getContextSnapshotById(client, args.snapshotId);
      if (result.error) {
        return {
          content: [{ type: "text" as const, text: result.error }],
          isError: true,
        };
      }
      if (!result.data) {
        return {
          content: [{ type: "text" as const, text: "No snapshot found for that id." }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text" as const, text: result.data.context_text }],
      };
    }
  );
}
