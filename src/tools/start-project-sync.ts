import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  createSyncRun,
  getActiveSyncRun,
  getProjectById,
  getSupabase,
} from "../services/supabase.js";
import { syncSupabaseFromSource } from "../services/sync-supabase.js";
import { SyncCancelledError } from "../services/sync-cancellation.js";

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoYmd(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `start_project_sync` — kick off the same pipeline as the UI "Sync" button.
 * Fires a background run and returns the runId; poll `get_project_sync_status` for progress.
 * Defaults to last 30 days when dateFrom/dateTo are omitted. Ask the user for the period.
 */
export function registerStartProjectSyncTool(server: McpServer): void {
  server.tool(
    "start_project_sync",
    "Start the default project sync pipeline (same as UI sync button). Returns runId immediately; sync continues in background (poll get_project_sync_status). If dateFrom/dateTo omitted, defaults to last 30 days from today. Fails if any sync is already running (global lock). ALWAYS ask the user which period to sync before calling — default = last 30 days.",
    {
      projectId: z.string().uuid().describe("Supabase project id (from find_projects)."),
      dateFrom: z
        .string()
        .regex(YMD_RE)
        .optional()
        .describe("Start date inclusive (YYYY-MM-DD). Defaults to today − 30 days."),
      dateTo: z
        .string()
        .regex(YMD_RE)
        .optional()
        .describe("End date inclusive (YYYY-MM-DD). Defaults to today."),
    },
    async (args) => {
      const client = getSupabase();
      if (!client) {
        return {
          content: [{ type: "text" as const, text: "Supabase not configured." }],
          isError: true,
        };
      }

      const dateTo = args.dateTo ?? todayYmd();
      const dateFrom = args.dateFrom ?? daysAgoYmd(30);
      if (dateFrom > dateTo) {
        return {
          content: [
            { type: "text" as const, text: `Invalid range: dateFrom (${dateFrom}) > dateTo (${dateTo}).` },
          ],
          isError: true,
        };
      }

      const { data: project, error: projErr } = await getProjectById(client, args.projectId);
      if (projErr) {
        return {
          content: [{ type: "text" as const, text: `Error: ${projErr}` }],
          isError: true,
        };
      }
      if (!project) {
        return {
          content: [{ type: "text" as const, text: `Project not found: ${args.projectId}` }],
          isError: true,
        };
      }

      const { data: activeRun } = await getActiveSyncRun(client);
      if (activeRun) {
        const payload = {
          started: false,
          reason: "sync_already_running",
          active_run: {
            id: activeRun.id,
            project_id: activeRun.project_id ?? null,
            started_at: activeRun.started_at,
            belongs_to_this_project: (activeRun.project_id ?? null) === args.projectId,
          },
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
          isError: true,
        };
      }

      const runResult = await createSyncRun(client, args.projectId);
      if (runResult.error || !runResult.id) {
        return {
          content: [
            { type: "text" as const, text: `Failed to create sync run: ${runResult.error ?? "unknown error"}` },
          ],
          isError: true,
        };
      }
      const runId = runResult.id;

      // Fire-and-forget: mirrors handleSupabaseSync. Do NOT await.
      void syncSupabaseFromSource(args.projectId, runId, {
        syncDateRange: { from: dateFrom, to: dateTo },
      }).catch((err: unknown) => {
        if (err instanceof SyncCancelledError) {
          console.log(`[sync] run ${runId} cancelled`);
          return;
        }
        console.error("[sync] background sync error:", err);
      });

      const payload = {
        started: true,
        run_id: runId,
        project_id: args.projectId,
        date_from: dateFrom,
        date_to: dateTo,
        note:
          "Sync running in background. Call get_project_sync_status with this project_id to track progress.",
      };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
      };
    }
  );
}
