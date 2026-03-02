import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSupabase, getConversation, getLinkedinMessages } from "../services/supabase.js";

export function registerGetConversationByMessageTool(server: McpServer): void {
  server.tool(
    "get_conversation_by_message",
    "Return the full LinkedIn conversation (thread) that contains a given message. Use when the user has a specific message and wants to see the whole thread, e.g. 'show conversation for this message' or 'get thread by message id'. Provide either the message id (then the message is looked up to get its conversation UUID) or the conversation UUID directly. Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).",
    {
      messageId: z
        .string()
        .optional()
        .describe("Id of any message in the conversation. The message is fetched to get linkedin_conversation_uuid, then the full thread is returned."),
      conversationUuid: z
        .string()
        .uuid()
        .optional()
        .describe("LinkedIn conversation UUID (linkedin_conversation_uuid). Use when you already know the thread id."),
      messageLimit: z
        .number()
        .min(1)
        .max(1000)
        .optional()
        .describe("Max messages to return in the thread (default 500, max 1000)."),
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

      let conversationUuid: string | undefined = args.conversationUuid;

      if (conversationUuid == null && args.messageId) {
        const msgResult = await getLinkedinMessages(client, {
          messageId: args.messageId,
          limit: 1,
        });
        if (msgResult.error) {
          return {
            content: [{ type: "text" as const, text: msgResult.error }],
            isError: true,
          };
        }
        const msg = Array.isArray(msgResult.data) && msgResult.data.length > 0 ? msgResult.data[0] : null;
        if (msg == null || typeof msg !== "object" || !("linkedin_conversation_uuid" in msg)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No message found with id ${args.messageId}, or message has no linkedin_conversation_uuid.`,
              },
            ],
            isError: true,
          };
        }
        conversationUuid = String((msg as { linkedin_conversation_uuid: unknown }).linkedin_conversation_uuid);
      }

      if (!conversationUuid) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Provide either messageId or conversationUuid.",
            },
          ],
          isError: true,
        };
      }

      const result = await getConversation(client, {
        conversationUuid,
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
