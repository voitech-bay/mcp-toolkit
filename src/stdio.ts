#!/usr/bin/env node
/**
 * Local stdio transport (for development with Cursor/IDE MCP config).
 * For production, use the HTTP/SSE endpoint (e.g. /api/mcp on Vercel).
 */
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerGetLinkedinMessagesTool } from "./tools/get-linkedin-messages.js";
import { registerGetSendersTool } from "./tools/get-senders.js";
import { registerGetContactsTool } from "./tools/get-contacts.js";
import { registerGetConversationByContactNameTool } from "./tools/get-conversation-by-contact-name.js";
import { registerGetConversationBySenderTool } from "./tools/get-conversation-by-sender.js";
import { registerGetConversationByMessageTool } from "./tools/get-conversation-by-message.js";
import { registerCompanyEnrichmentTools } from "./tools/company-enrichment.js";
import { registerGetCompanyRootContextTool } from "./tools/get-company-root-context.js";
import { registerSetCompanyRootContextTool } from "./tools/set-company-root-context.js";

const server = new McpServer({
  name: "mcp-toolkit",
  version: "0.1.0",
});

registerGetLinkedinMessagesTool(server);
registerGetSendersTool(server);
registerGetContactsTool(server);
registerGetConversationByContactNameTool(server);
registerGetConversationBySenderTool(server);
registerGetConversationByMessageTool(server);
registerCompanyEnrichmentTools(server);
registerGetCompanyRootContextTool(server);
registerSetCompanyRootContextTool(server);

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("MCP Toolkit server running on stdio");
