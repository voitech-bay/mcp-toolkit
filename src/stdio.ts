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

const server = new McpServer({
  name: "mcp-toolkit",
  version: "0.1.0",
});

registerFindProjectsTool(server);
registerFindProjectLinkedinConversationsTool(server);
registerFindProjectFlowsTool(server);
registerFindProjectHypothesisTool(server);
registerFindProjectAnalyticsTool(server);

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("MCP Toolkit server running on stdio");
