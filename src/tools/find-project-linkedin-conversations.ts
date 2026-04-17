import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  CONTACTS_TABLE,
  SENDERS_TABLE,
  getConversationsList,
  getLinkedinMessages,
  getSupabase,
} from "../services/supabase.js";

/**
 * Extract the essential message fields we want to surface to the LLM
 * (full LinkedinMessages rows are noisy).
 */
function compactMessage(m: Record<string, unknown>) {
  return {
    uuid: (m.uuid as string | null) ?? null,
    direction: (m.direction as string | null) ?? null,
    type: (m.type as string | null) ?? (m.linkedin_type as string | null) ?? null,
    sent_at: (m.sent_at as string | null) ?? (m.created_at as string | null) ?? null,
    sender: (m.sender as string | null) ?? null,
    text: (m.text as string | null) ?? (m.content as string | null) ?? null,
  };
}

/**
 * `find_project_linkedin_conversations` — most recent conversations within a project
 * with the last N messages + contact (receiver) + sender info for each.
 */
export function registerFindProjectLinkedinConversationsTool(server: McpServer): void {
  server.tool(
    "find_project_linkedin_conversations",
    "Return the most recent LinkedIn conversations for a project. For each conversation includes the contact (receiver) info, the sender profile info, and the last N messages (newest→oldest). Use `limit` for # of conversations (default 10, max 50) and `messageLimit` for # of messages per conversation (default 4, max 20).",
    {
      projectId: z.string().uuid().describe("Supabase project id (from find_projects)."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Max number of conversations to return (default 10)."),
      messageLimit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .describe("Max number of recent messages per conversation (default 4)."),
    },
    async (args) => {
      const client = getSupabase();
      if (!client) {
        return {
          content: [
            { type: "text" as const, text: "Supabase not configured." },
          ],
          isError: true,
        };
      }

      const limit = args.limit ?? 10;
      const messageLimit = args.messageLimit ?? 4;

      const listRes = await getConversationsList(client, args.projectId, { limit, offset: 0 });
      if (listRes.error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${listRes.error}` }],
          isError: true,
        };
      }

      const conversations = listRes.data;

      const contactUuids = [
        ...new Set(
          conversations.map((c) => c.leadUuid).filter((u): u is string => !!u)
        ),
      ];
      const senderUuids = [
        ...new Set(
          conversations
            .map((c) => c.senderProfileUuid)
            .filter((u): u is string => !!u)
        ),
      ];

      const contactById = new Map<string, Record<string, unknown>>();
      if (contactUuids.length > 0) {
        const { data: contacts } = await client
          .from(CONTACTS_TABLE)
          .select(
            "uuid, name, first_name, last_name, position, headline, company_name, company_uuid, linkedin, work_email, avatar_url"
          )
          .in("uuid", contactUuids);
        for (const row of (contacts ?? []) as Array<Record<string, unknown>>) {
          const u = row.uuid as string | undefined;
          if (u) contactById.set(u, row);
        }
      }

      const senderById = new Map<string, Record<string, unknown>>();
      if (senderUuids.length > 0) {
        const { data: senders } = await client
          .from(SENDERS_TABLE)
          .select("uuid, first_name, last_name, label, linkedin, email")
          .in("uuid", senderUuids);
        for (const row of (senders ?? []) as Array<Record<string, unknown>>) {
          const u = row.uuid as string | undefined;
          if (u) senderById.set(u, row);
        }
      }

      const rich = await Promise.all(
        conversations.map(async (c) => {
          const { data: msgs, error: msgErr } = await getLinkedinMessages(client, {
            conversationUuid: c.conversationUuid,
            orderBy: "sent_at",
            order: "desc",
            limit: messageLimit,
          });
          const messages = msgErr
            ? []
            : (msgs as Array<Record<string, unknown>>).map(compactMessage);

          const contactRow = c.leadUuid ? contactById.get(c.leadUuid) ?? null : null;
          const senderRow = c.senderProfileUuid
            ? senderById.get(c.senderProfileUuid) ?? null
            : null;

          return {
            conversation_uuid: c.conversationUuid,
            last_message_at: c.lastMessageAt,
            reply_tag: c.replyTag,
            message_count: c.messageCount,
            inbox_count: c.inboxCount,
            outbox_count: c.outboxCount,
            last_message_is_outbox: c.lastMessageIsOutbox,
            contact: contactRow
              ? {
                  uuid: contactRow.uuid ?? null,
                  name:
                    (contactRow.name as string | null) ??
                    ([contactRow.first_name, contactRow.last_name]
                      .filter(Boolean)
                      .join(" ") ||
                      null),
                  position: contactRow.position ?? null,
                  headline: contactRow.headline ?? null,
                  company_name: contactRow.company_name ?? null,
                  company_uuid: contactRow.company_uuid ?? null,
                  linkedin: contactRow.linkedin ?? null,
                  work_email: contactRow.work_email ?? null,
                }
              : {
                  uuid: c.leadUuid,
                  name: c.receiverDisplayName,
                  position: c.receiverTitle,
                  company_name: c.receiverCompanyName,
                  company_uuid: c.receiverCompanyId,
                  linkedin: null,
                  work_email: null,
                  headline: null,
                },
            sender: senderRow
              ? {
                  uuid: senderRow.uuid ?? null,
                  name:
                    [senderRow.first_name, senderRow.last_name]
                      .filter(Boolean)
                      .join(" ") ||
                    (senderRow.label as string | null) ||
                    c.senderDisplayName,
                  label: senderRow.label ?? null,
                  linkedin: senderRow.linkedin ?? null,
                  email: senderRow.email ?? null,
                }
              : {
                  uuid: c.senderProfileUuid,
                  name: c.senderDisplayName,
                  label: null,
                  linkedin: null,
                  email: null,
                },
            recent_messages: messages,
          };
        })
      );

      const payload = {
        project_id: args.projectId,
        returned: rich.length,
        total_conversations: listRes.total,
        message_limit_per_conversation: messageLimit,
        conversations: rich,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    }
  );
}
