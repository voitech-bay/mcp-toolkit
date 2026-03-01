#!/usr/bin/env node
/**
 * Local stdio transport (for development with Cursor/IDE MCP config).
 * For production, use the HTTP/SSE endpoint (e.g. /api/mcp on Vercel).
 */
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerGetMessagesTool } from "./tools/get-messages.js";
import { registerCompanyEnrichmentTools } from "./tools/company-enrichment.js";

const server = new McpServer({
  name: "mcp-toolkit",
  version: "0.1.0",
});

registerGetMessagesTool(server);
registerCompanyEnrichmentTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("MCP Toolkit server running on stdio");
