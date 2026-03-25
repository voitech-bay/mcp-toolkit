#!/usr/bin/env node
/**
 * Local stdio transport (for development with Cursor/IDE MCP config).
 * For production, use the HTTP/SSE endpoint (e.g. /api/mcp on Vercel).
 */
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerGetLinkedinMessagesTool } from "./tools/get-linkedin-messages.js";
import { registerGetContactsTool } from "./tools/get-contacts.js";
import { registerGetConversationByContactNameTool } from "./tools/get-conversation-by-contact-name.js";
import { registerGetConversationBySenderTool } from "./tools/get-conversation-by-sender.js";
import { registerGetConversationByMessageTool } from "./tools/get-conversation-by-message.js";
import { registerCompanyEnrichmentTools } from "./tools/company-enrichment.js";
import { registerSetCompanyRootContextTool } from "./tools/set-company-root-context.js";
import { registerGetReplyContextSnapshotTool } from "./tools/get-reply-context-snapshot.js";

const server = new McpServer({
  name: "mcp-toolkit",
  version: "0.1.0",
});

registerGetLinkedinMessagesTool(server);
registerGetContactsTool(server);
registerGetConversationByContactNameTool(server);
registerGetConversationBySenderTool(server);
registerGetConversationByMessageTool(server);
registerCompanyEnrichmentTools(server);
registerSetCompanyRootContextTool(server);
registerGetReplyContextSnapshotTool(server);

const transport = new StdioServerTransport();
await server.connect(transport);

console.error("MCP Toolkit server running on stdio");
