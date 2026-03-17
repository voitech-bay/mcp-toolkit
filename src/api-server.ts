/**
 * Local HTTP server that mirrors Vercel API routes for local testing.
 * Run: npm run dev:api (or tsx src/api-server.ts)
 * Then point the frontend at this server (e.g. Vite proxy /api -> http://localhost:3001).
 */
import "dotenv/config";
import { createServer } from "node:http";
import { URL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import {
  handleSupabaseState,
  handleSupabaseTableQuery,
  handleSupabaseSync,
  handleConversation,
  handleGetCompanyContext,
  handleSetCompanyContext,
  handleGetProjects,
  handleUpdateProjectCredentials,
  handleSyncPreflight,
  handleSyncStatus,
  handleSyncHistory,
} from "./api-handlers.js";
import { syncEventBus, type SyncEvent } from "./services/sync-event-bus.js";

const PORT = Number(process.env.API_PORT) || 3000;

const server = createServer(async (req, res) => {
  const url = req.url ?? "";
  const pathname = url.includes("?") ? url.slice(0, url.indexOf("?")) : url;

  // Allow frontend dev server (and any origin when testing locally)
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.writeHead(204);
    res.end();
    return;
  }

  // Match /api/projects/:id/credentials
  const projectCredentialsMatch = pathname.match(
    /^\/api\/projects\/([^/]+)\/credentials$/
  );

  try {
    if (projectCredentialsMatch) {
      const projectId = decodeURIComponent(projectCredentialsMatch[1]);
      await handleUpdateProjectCredentials(req, res, projectId);
      return;
    }

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
      case "/api/projects":
        await handleGetProjects(req, res);
        return;
      case "/api/sync-preflight":
        await handleSyncPreflight(req, res);
        return;
      case "/api/sync-status":
        await handleSyncStatus(req, res);
        return;
      case "/api/sync-history":
        await handleSyncHistory(req, res);
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

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "", `http://localhost:${PORT}`);
  if (url.pathname !== "/api/sync-ws") {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  const runId = url.searchParams.get("runId");
  if (!runId) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req, runId);
  });
});

wss.on("connection", (ws: WebSocket, _req: unknown, runId: string) => {
  console.log(`[sync-ws] client connected for runId=${runId}`);

  const listener = (event: SyncEvent) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(event));
    }
  };

  syncEventBus.onRun(runId, listener);

  ws.on("close", () => {
    console.log(`[sync-ws] client disconnected for runId=${runId}`);
    syncEventBus.offRun(runId, listener);
  });

  ws.on("error", (err: Error) => {
    console.error(`[sync-ws] error for runId=${runId}`, err);
    syncEventBus.offRun(runId, listener);
  });
});

server.listen(PORT, () => {
  console.log(`API server: http://localhost:${PORT}`);
  console.log("  GET  /api/supabase-state");
  console.log("  POST /api/supabase-sync");
  console.log("  GET  /api/supabase-table-query");
  console.log("  GET  /api/conversation");
  console.log("  GET  /api/company-context");
  console.log("  POST /api/company-context");
  console.log("  GET  /api/projects");
  console.log("  PUT  /api/projects/:id/credentials");
  console.log("  GET  /api/sync-preflight?projectId=<id>");
  console.log("  GET  /api/sync-status");
  console.log("  GET  /api/sync-history");
  console.log("  WS   /api/sync-ws?runId=<id>");
});
