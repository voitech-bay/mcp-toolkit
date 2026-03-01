/**
 * Local HTTP server for testing Streamable HTTP (GET SSE + POST) before deploying.
 * Run: npm run dev:http
 * Then use MCP client with URL: http://localhost:3000/mcp
 */
import "dotenv/config";
import { createServer } from "node:http";
import { createMcpHandler } from "./server.js";

const PORT = Number(process.env.PORT) || 3000;
const handler = createMcpHandler();

const server = createServer(async (req, res) => {
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, mcp: "/mcp" }));
    return;
  }
  if (req.url?.startsWith("/mcp")) {
    await handler(req, res);
    return;
  }
  res.writeHead(404).end("Not found");
});

server.listen(PORT, () => {
  console.log(`MCP Toolkit HTTP server: http://localhost:${PORT}/mcp`);
});
