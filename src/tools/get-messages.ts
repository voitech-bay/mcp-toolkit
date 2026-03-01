import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSupabase, getMessagesTable, getMessages } from "../services/supabase.js";

export function registerGetMessagesTool(server: McpServer): void {
  server.tool(
    "get_messages",
    "Get messages from Supabase. Filter by sender, sender_id, contact_id, lead_uuid, lead_id, message id, channel, direction, status, and date range. Supports limit, offset, and ordering. Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) in env. Table name defaults to 'messages' (set SUPABASE_MESSAGES_TABLE to override).",
    {
      sender: z.string().optional().describe("Filter by sender (e.g. phone number or identifier)."),
      senderId: z.string().optional().describe("Filter by sender_id (user/account id who sent)."),
      contactId: z.string().optional().describe("Filter by contact_id."),
      leadUuid: z.string().uuid().optional().describe("Filter by lead_uuid."),
      leadId: z.string().optional().describe("Filter by lead_id."),
      conversationUuid: z.string().uuid().optional().describe("Filter by linkedin_conversation_uuid (all messages in a conversation)."),
      messageId: z.string().optional().describe("Return a single message by id."),
      channel: z.string().optional().describe("Filter by channel (e.g. sms, whatsapp, email)."),
      direction: z.string().optional().describe("Filter by direction (e.g. inbound, outbound)."),
      status: z.string().optional().describe("Filter by status (e.g. sent, delivered, read)."),
      createdAfter: z.string().optional().describe("Messages created after this timestamp (ISO 8601)."),
      createdBefore: z.string().optional().describe("Messages created before this timestamp (ISO 8601)."),
      limit: z.number().min(1).max(1000).optional().describe("Max number of messages to return (default 100, max 1000)."),
      offset: z.number().min(0).optional().describe("Number of messages to skip (default 0)."),
      orderBy: z.string().optional().describe("Column to sort by (default created_at)."),
      order: z.enum(["asc", "desc"]).optional().describe("Sort order (default desc)."),
    },
    async (args) => {
      const client = getSupabase();
      if (!client) {
        return {
          content: [{ type: "text" as const, text: "Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) in .env." }],
          isError: true,
        };
      }

      const table = getMessagesTable();
      const result = await getMessages(client, table, {
        sender: args.sender,
        senderId: args.senderId,
        contactId: args.contactId,
        leadUuid: args.leadUuid,
        leadId: args.leadId,
        conversationUuid: args.conversationUuid,
        messageId: args.messageId,
        channel: args.channel,
        direction: args.direction,
        status: args.status,
        createdAfter: args.createdAfter,
        createdBefore: args.createdBefore,
        limit: args.limit,
        offset: args.offset,
        orderBy: args.orderBy,
        order: args.order,
      });

      if (result.error) {
        return {
          content: [{ type: "text" as const, text: result.error }],
          isError: true,
        };
      }

      const payload = {
        messages: result.data,
        count: result.data.length,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    }
  );
}
