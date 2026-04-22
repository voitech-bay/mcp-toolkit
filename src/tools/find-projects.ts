import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getSupabase, getProjects } from "../services/supabase.js";

/**
 * `find_projects` — list every project the toolkit has access to.
 * Returns a compact JSON payload with id + name + description so the LLM can pick one.
 */
export function registerFindProjectsTool(server: McpServer): void {
  server.tool(
    "find_projects",
    "List all projects in Supabase. Returns id, name, description, created_at, api_key_set, source_api_base_url, image_url. Use the returned id as projectId for other find_project_* tools.",
    {},
    async () => {
      const client = getSupabase();
      if (!client) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Supabase not configured. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY).",
            },
          ],
          isError: true,
        };
      }

      const { data, error } = await getProjects(client);
      if (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${error}` }],
          isError: true,
        };
      }

      const payload = {
        count: data.length,
        projects: data.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          created_at: p.created_at,
          api_key_set: p.api_key_set,
          source_api_base_url: p.source_api_base_url,
          image_url: p.image_url,
        })),
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    }
  );
}
