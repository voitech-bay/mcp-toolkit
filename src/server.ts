import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { registerFindProjectsTool } from "./tools/find-projects.js";
import { registerFindProjectLinkedinConversationsTool } from "./tools/find-project-linkedin-conversations.js";
import { registerFindProjectFlowsTool } from "./tools/find-project-flows.js";
import { registerFindProjectHypothesisTool } from "./tools/find-project-hypothesis.js";
import { registerFindProjectAnalyticsTool } from "./tools/find-project-analytics.js";
import { registerGetProjectSyncStatusTool } from "./tools/get-project-sync-status.js";
import { registerStartProjectSyncTool } from "./tools/start-project-sync.js";
import { registerRenderChartTool } from "./tools/render-chart.js";
import { registerRenderFunnelChartTool } from "./tools/render-funnel-chart.js";

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "mcp-toolkit",
    version: "0.1.0",
  });
  registerFindProjectsTool(server);
  registerGetProjectSyncStatusTool(server);
  registerStartProjectSyncTool(server);
  registerFindProjectLinkedinConversationsTool(server);
  registerFindProjectFlowsTool(server);
  registerFindProjectHypothesisTool(server);
  registerFindProjectAnalyticsTool(server);
  registerRenderChartTool(server);
  registerRenderFunnelChartTool(server);
  return server;
}

/** Read and parse JSON body from Node IncomingMessage (for POST). */
async function getParsedBody(req: IncomingMessage): Promise<unknown> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.includes("application/json")) return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export type NodeHandler = (
  req: IncomingMessage,
  res: ServerResponse
) => Promise<void>;

/**
 * Returns a request handler for Node.js HTTP (e.g. Vercel serverless).
 * Uses MCP Streamable HTTP (SSE + POST) so the server can be deployed to Vercel.
 * Stateless: each request gets a new McpServer and transport (avoids "Already connected" when concurrent).
 */
export function createMcpHandler(): NodeHandler {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless for serverless
    });

    res.on("close", () => {
      transport.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      const parsedBody =
        req.method === "POST" ? await getParsedBody(req) : undefined;
      await transport.handleRequest(req, res, parsedBody);
    } catch (err) {
      console.error("MCP request error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          })
        );
      }
    }
  };
}
