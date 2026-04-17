import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getActiveSyncRun,
  getSupabase,
  getSyncHistory,
} from "../services/supabase.js";

/**
 * `get_project_sync_status` — most important sync snapshot for a project:
 *  - is any sync currently running for this project?
 *  - latest finished run's status + date + result summary
 *  - global lock info (if another project is syncing, we surface it)
 */
export function registerGetProjectSyncStatusTool(server: McpServer): void {
  server.tool(
    "get_project_sync_status",
    "Return latest Supabase sync status + dates for a project: is_running (this project), active_run (id, started_at, project_id — may belong to another project if global lock is held), last_finished_run (id, status, started_at, finished_at, error, result_summary). Use before starting a new sync.",
    {
      projectId: z.string().uuid().describe("Supabase project id (from find_projects)."),
    },
    async (args) => {
      const client = getSupabase();
      if (!client) {
        return {
          content: [{ type: "text" as const, text: "Supabase not configured." }],
          isError: true,
        };
      }

      const [activeRes, historyRes] = await Promise.all([
        getActiveSyncRun(client),
        getSyncHistory(client, { projectId: args.projectId, limit: 5 }),
      ]);

      if (activeRes.error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${activeRes.error}` }],
          isError: true,
        };
      }
      if (historyRes.error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${historyRes.error}` }],
          isError: true,
        };
      }

      const active = activeRes.data;
      const isRunningForProject =
        !!active && (active.project_id ?? null) === args.projectId;

      const lastFinished = historyRes.data.find((r) => r.finished_at != null) ?? null;
      const recentRuns = historyRes.data.map((r) => ({
        id: r.id,
        status: r.status,
        started_at: r.started_at,
        finished_at: r.finished_at,
        error: r.error,
      }));

      const payload = {
        project_id: args.projectId,
        is_running: isRunningForProject,
        active_run: active
          ? {
              id: active.id,
              started_at: active.started_at,
              project_id: active.project_id ?? null,
              belongs_to_this_project: isRunningForProject,
            }
          : null,
        last_finished_run: lastFinished
          ? {
              id: lastFinished.id,
              status: lastFinished.status,
              started_at: lastFinished.started_at,
              finished_at: lastFinished.finished_at,
              error: lastFinished.error,
              result_summary: lastFinished.result_summary,
            }
          : null,
        recent_runs: recentRuns,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    }
  );
}
