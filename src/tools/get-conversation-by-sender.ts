import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSupabase, getConversation } from "../services/supabase.js";

export function registerGetConversationBySenderTool(server: McpServer): void {
  server.tool(
    "get_conversation_by_sender",
    "Return all LinkedIn messages sent by a given sender (all conversations involving that sender). Use when the user asks to find or list all conversations by sender, e.g. 'show all conversations for sender X' or 'messages from sender uuid abc-...'. Identifies the sender by sender_profile_uuid (the Senders table uuid). Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).",
    {
      senderProfileUuid: z
        .string()
        .uuid()
        .describe("UUID of the sender (Senders.uuid). Used to filter messages by sender_profile_uuid."),
      messageLimit: z
        .number()
        .min(1)
        .max(1000)
        .optional()
        .describe("Max messages to return (default 500, max 1000)."),
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

      const result = await getConversation(client, {
        senderProfileUuid: args.senderProfileUuid,
        messageLimit: args.messageLimit,
      });

      if (result.error) {
        return {
          content: [{ type: "text" as const, text: result.error }],
          isError: true,
        };
      }

      const payload = {
        messages: result.messages,
        messageCount: result.messages.length,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    }
  );
}
