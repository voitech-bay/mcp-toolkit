import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSupabase, getConversationByContactFullName } from "../services/supabase.js";

export function registerGetConversationByContactNameTool(server: McpServer): void {
  server.tool(
    "get_conversation_by_contact_name",
    "Find a contact in the DB by full name and return that contact plus the full LinkedIn conversation (all messages linked to the contact via lead_uuid). Use when the user asks to find a conversation by contact name, e.g. 'show conversation with John Doe'. Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).",
    {
      contactFullName: z
        .string()
        .min(1)
        .describe("Full name of the contact to search for (case-insensitive match on Contacts.name)."),
      messageLimit: z
        .number()
        .min(1)
        .max(1000)
        .optional()
        .describe("Max messages to return in the conversation (default 500)."),
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

      const result = await getConversationByContactFullName(client, args.contactFullName, {
        messageLimit: args.messageLimit,
      });

      if (result.error) {
        return {
          content: [{ type: "text" as const, text: result.error }],
          isError: true,
        };
      }

      const payload = {
        contact: result.contact,
        messages: result.messages,
        messageCount: result.messages.length,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    }
  );
}
