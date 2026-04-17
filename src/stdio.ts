#!/usr/bin/env node
/**
 * Local stdio transport (for development with Cursor/IDE MCP config).
 * For production, use the HTTP/SSE endpoint (e.g. /api/mcp on Vercel).
 */
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerFindProjectsTool } from "./tools/find-projects.js";
import { registerFindProjectLinkedinConversationsTool } from "./tools/find-project-linkedin-conversations.js";
import { registerFindProjectFlowsTool } from "./tools/find-project-flows.js";
import { registerFindProjectHypothesisTool } from "./tools/find-project-hypothesis.js";
import { registerFindProjectAnalyticsTool } from "./tools/find-project-analytics.js";
import { registerGetProjectSyncStatusTool } from "./tools/get-project-sync-status.js";
import { registerStartProjectSyncTool } from "./tools/start-project-sync.js";
import { registerRenderChartTool } from "./tools/render-chart.js";
import { registerRenderFunnelChartTool } from "./tools/render-funnel-chart.js";

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

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("MCP Toolkit server running on stdio");
