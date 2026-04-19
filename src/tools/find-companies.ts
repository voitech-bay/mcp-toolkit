import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { findCompanies, getSupabase } from "../services/supabase.js";

const findCompaniesSchema = z.object({
  projectId: z
    .string()
    .uuid()
    .optional()
    .describe(
      "When set, only companies linked to this project via project_companies are returned (still require nameLike and/or companyIds)."
    ),
  nameLike: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Case-insensitive substring match on company name or domain (SQL ILIKE). AND with companyIds when both are set."
    ),
  companyIds: z
    .array(z.string().uuid())
    .max(100)
    .optional()
    .describe("Exact companies.id uuid(s). AND with nameLike when both are set."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max rows (default 50, max 100)."),
});

const findCompaniesInput = findCompaniesSchema.refine(
  (a) => (a.nameLike?.trim().length ?? 0) > 0 || (a.companyIds?.length ?? 0) > 0,
  { message: "Provide at least one of: nameLike or companyIds." }
);

/**
 * `find_companies` — search the shared companies table by name/domain (ILIKE) and/or exact id(s).
 */
export function registerFindCompaniesTool(server: McpServer): void {
  server.tool(
    "find_companies",
    "Search companies by nameLike (ILIKE on name or domain) and/or companyIds (exact companies.id). Optional projectId scopes to companies linked to that project (project_companies). Returns id, name, domain, linkedin, created_at, and project_company_id when scoped to a project.",
    findCompaniesSchema.shape,
    async (args: unknown) => {
      const parsed = findCompaniesInput.safeParse(args);
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

      const { data, error } = await findCompanies(client, {
        projectId: parsed.data.projectId,
        nameLike: parsed.data.nameLike,
        companyIds: parsed.data.companyIds,
        limit: parsed.data.limit,
      });

      if (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error}` }],
          isError: true,
        };
      }

      const payload = {
        project_id: parsed.data.projectId ?? null,
        count: data.length,
        companies: data,
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    }
  );
}
