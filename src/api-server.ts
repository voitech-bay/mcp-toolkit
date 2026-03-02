/**
 * Local HTTP server that mirrors Vercel API routes for local testing.
 * Run: npm run dev:api (or tsx src/api-server.ts)
 * Then point the frontend at this server (e.g. Vite proxy /api -> http://localhost:3001).
 */
import "dotenv/config";
import { createServer } from "node:http";
import {
  handleSupabaseState,
  handleSupabaseTableQuery,
  handleSupabaseSync,
  handleConversation,
  handleGetCompanyContext,
  handleSetCompanyContext,
} from "./api-handlers.js";

const PORT = Number(process.env.API_PORT) || 3001;

const server = createServer(async (req, res) => {
  const url = req.url ?? "";
  const pathname = url.includes("?") ? url.slice(0, url.indexOf("?")) : url;

  // Allow frontend dev server (and any origin when testing locally)
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    switch (pathname) {
      case "/api/supabase-state":
        if (req.method === "GET") {
          await handleSupabaseState(req, res);
        } else {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed" }));
        }
        return;
      case "/api/supabase-sync":
        await handleSupabaseSync(req, res);
        return;
      case "/api/supabase-table-query":
        await handleSupabaseTableQuery(req, res);
        return;
      case "/api/conversation":
        await handleConversation(req, res);
        return;
      case "/api/company-context":
        if (req.method === "GET") {
          await handleGetCompanyContext(req, res);
        } else if (req.method === "POST" || req.method === "PUT") {
          await handleSetCompanyContext(req, res);
        } else {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed" }));
        }
        return;
      default:
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
    }
  } catch (err) {
    console.error(pathname, err);
    res.setHeader("Content-Type", "application/json");
    res.writeHead(500);
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : "Internal server error" }));
  }
});

server.listen(PORT, () => {
  console.log(`API server: http://localhost:${PORT}`);
  console.log("  GET  /api/supabase-state");
  console.log("  POST /api/supabase-sync");
  console.log("  GET  /api/supabase-table-query");
  console.log("  GET  /api/conversation");
  console.log("  GET  /api/company-context");
  console.log("  POST /api/company-context");
});
