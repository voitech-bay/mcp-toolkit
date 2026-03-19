import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSupabase } from "../services/supabase.js";
import {
  buildReplyContextPrompt,
  type BuildContextNodes,
} from "../services/reply-context-prompt.js";

const nodeRecord = z.record(z.string(), z.unknown());

const selectedNodesSchema = z.object({
  hypotheses: z.array(nodeRecord).default([]),
  companies: z.array(nodeRecord).default([]),
  contacts: z.array(nodeRecord).default([]),
  conversations: z.array(nodeRecord).default([]),
});

function toBuildContextNodes(raw: z.infer<typeof selectedNodesSchema>): BuildContextNodes {
  return {
    hypotheses: raw.hypotheses as unknown as BuildContextNodes["hypotheses"],
    companies: raw.companies as unknown as BuildContextNodes["companies"],
    contacts: raw.contacts as unknown as BuildContextNodes["contacts"],
    conversations: raw.conversations as unknown as BuildContextNodes["conversations"],
  };
}

export function registerBuildReplyContextPromptTool(server: McpServer): void {
  server.tool(
    "build_reply_context_prompt",
    "Builds the full LinkedIn reply-agent prompt from a project id and selected graph nodes (hypotheses, companies, contacts, conversations). Same logic as the web app's /api/build-context. Returns the large prompt text to use as context for drafting replies. Requires Supabase credentials.",
    {
      projectId: z.string().uuid().describe("Project UUID."),
      selectedNodes: selectedNodesSchema.describe(
        "Selected nodes: { hypotheses, companies, contacts, conversations } — same shape as the build-context API."
      ),
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
      try {
        const nodes = toBuildContextNodes(args.selectedNodes);
        const promptText = await buildReplyContextPrompt(client, args.projectId, nodes);
        return {
          content: [{ type: "text" as const, text: promptText }],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text" as const, text: `Failed to build reply context: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
