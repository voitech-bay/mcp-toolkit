import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findContactsForProject, getSupabase } from "../services/supabase.js";

const findContactsSchema = z.object({
  projectId: z.string().uuid().describe("Supabase project id (from find_projects)."),
  nameLike: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Case-insensitive substring match on contact name, first_name, or last_name (SQL ILIKE). Combined with other filters using AND."
    ),
  contactUuids: z
    .array(z.string().uuid())
    .max(100)
    .optional()
    .describe("Exact contact uuid(s) (Contacts.uuid). AND with other filters when multiple are set."),
  companyNameLike: z
    .string()
    .max(200)
    .optional()
    .describe("Case-insensitive substring match on Contacts.company_name (SQL ILIKE)."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max rows (default 50, max 100)."),
});

const findContactsInput = findContactsSchema.refine(
  (a) =>
    (a.nameLike?.trim().length ?? 0) > 0 ||
    (a.contactUuids?.length ?? 0) > 0 ||
    (a.companyNameLike?.trim().length ?? 0) > 0,
  { message: "Provide at least one of: nameLike, contactUuids, or companyNameLike." }
);

/**
 * `find_contacts` — search contacts in a project by name (ILIKE), uuid(s), and/or company name.
 */
export function registerFindContactsTool(server: McpServer): void {
  server.tool(
    "find_contacts",
    "Search Contacts for a project. Pass at least one filter: nameLike (matches name, first_name, or last_name), contactUuids (exact uuid list), and/or companyNameLike (company_name ILIKE). Multiple filters are ANDed. Returns uuid, names, company_name, company_uuid, position, linkedin, work_email, created_at.",
    findContactsSchema.shape,
    async (args: unknown) => {
      const parsed = findContactsInput.safeParse(args);
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

      const client = getSupabase();
      if (!client) {
        return {
          content: [{ type: "text" as const, text: "Supabase not configured." }],
          isError: true,
        };
      }

      const { data, error } = await findContactsForProject(client, {
        projectId: parsed.data.projectId,
        nameLike: parsed.data.nameLike,
        contactUuids: parsed.data.contactUuids,
        companyNameLike: parsed.data.companyNameLike,
        limit: parsed.data.limit,
      });

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error}` }],
          isError: true,
        };
      }

      const payload = {
        project_id: parsed.data.projectId,
        count: data.length,
        contacts: data,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    }
  );
}
