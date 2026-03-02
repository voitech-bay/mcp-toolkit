import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { registerGetLinkedinMessagesTool } from "./tools/get-linkedin-messages.js";
import { registerGetSendersTool } from "./tools/get-senders.js";
import { registerGetContactsTool } from "./tools/get-contacts.js";
import { registerGetConversationByContactNameTool } from "./tools/get-conversation-by-contact-name.js";
import { registerGetConversationBySenderTool } from "./tools/get-conversation-by-sender.js";
import { registerGetConversationByMessageTool } from "./tools/get-conversation-by-message.js";
import { registerCompanyEnrichmentTools } from "./tools/company-enrichment.js";

function createMcpServer(): McpServer {
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
