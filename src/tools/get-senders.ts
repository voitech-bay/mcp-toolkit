import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSupabase, getSenders } from "../services/supabase.js";

export function registerGetSendersTool(server: McpServer): void {
  server.tool(
    "get_senders",
    "Get Senders from Supabase (table Senders). Filter by uuid, team_id, linkedin_browser_id, linkedin_account_uuid, assignee_user_id, first_name, last_name, label, smart_limits_enabled, avatar_url, status, user_id, last_automation_server_id, notification_emails, and date ranges (created_at, updated_at, hold_tasks_till). Supports limit, offset, and ordering. Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).",
    {
      uuid: z.string().uuid().optional().describe("Filter by sender uuid."),
      teamId: z.number().optional().describe("Filter by team_id."),
      linkedinBrowserId: z.number().optional().describe("Filter by linkedin_browser_id."),
      linkedinAccountUuid: z.string().uuid().optional().describe("Filter by linkedin_account_uuid."),
      assigneeUserId: z.number().optional().describe("Filter by assignee_user_id."),
      firstName: z.string().optional().describe("Filter by first_name."),
      lastName: z.string().optional().describe("Filter by last_name."),
      label: z.string().optional().describe("Filter by label."),
      smartLimitsEnabled: z.boolean().optional().describe("Filter by smart_limits_enabled."),
      avatarUrl: z.string().optional().describe("Filter by avatar_url."),
      status: z.string().optional().describe("Filter by status."),
      userId: z.number().optional().describe("Filter by user_id."),
      lastAutomationServerId: z.number().optional().describe("Filter by last_automation_server_id."),
      notificationEmails: z.string().optional().describe("Filter by notification_emails."),
      createdAfter: z.string().optional().describe("Created after (ISO 8601)."),
      createdBefore: z.string().optional().describe("Created before (ISO 8601)."),
      updatedAfter: z.string().optional().describe("Updated after (ISO 8601)."),
      updatedBefore: z.string().optional().describe("Updated before (ISO 8601)."),
      holdTasksTillAfter: z.string().optional().describe("hold_tasks_till after (ISO 8601)."),
      holdTasksTillBefore: z.string().optional().describe("hold_tasks_till before (ISO 8601)."),
      limit: z.number().min(1).max(1000).optional().describe("Max records (default 100, max 1000)."),
      offset: z.number().min(0).optional().describe("Skip N records (default 0)."),
      orderBy: z.string().optional().describe("Sort column (default created_at)."),
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
      const result = await getSenders(client, {
        uuid: args.uuid,
        teamId: args.teamId,
        linkedinBrowserId: args.linkedinBrowserId,
        linkedinAccountUuid: args.linkedinAccountUuid,
        assigneeUserId: args.assigneeUserId,
        firstName: args.firstName,
        lastName: args.lastName,
        label: args.label,
        smartLimitsEnabled: args.smartLimitsEnabled,
        avatarUrl: args.avatarUrl,
        status: args.status,
        userId: args.userId,
        lastAutomationServerId: args.lastAutomationServerId,
        notificationEmails: args.notificationEmails,
        createdAfter: args.createdAfter,
        createdBefore: args.createdBefore,
        updatedAfter: args.updatedAfter,
        updatedBefore: args.updatedBefore,
        holdTasksTillAfter: args.holdTasksTillAfter,
        holdTasksTillBefore: args.holdTasksTillBefore,
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
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ senders: result.data, count: result.data.length }, null, 2) }],
      };
    }
  );
}
