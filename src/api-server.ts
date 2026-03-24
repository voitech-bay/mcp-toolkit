/**
 * Local HTTP server that mirrors Vercel API routes for local testing.
 * Run: npm run dev:api (or tsx src/api-server.ts)
 * Then point the frontend at this server (e.g. Vite proxy /api -> http://localhost:3001).
 */
import "dotenv/config";
import { createServer } from "node:http";
import { URL } from "node:url";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import {
  handleSupabaseState,
  handleSupabaseTableQuery,
  handleSupabaseSync,
  handleConversation,
  handleGetCompanyContext,
  handleSetCompanyContext,
  handleGetCompanyContextCounts,
  handleGetContactContext,
  handleSetContactContext,
  handleGetContactContextCounts,
  handleGetProjects,
  handleUpdateProjectCredentials,
  handleSyncPreflight,
  handleSyncStatus,
  handleSyncHistory,
  handleGetAllCompanies,
  handleAddCompaniesToProject,
  handleGetProjectCompanies,
  handleGetHypotheses,
  handleCreateHypothesis,
  handleUpdateHypothesis,
  handleDeleteHypothesis,
  handleGetHypothesisTargets,
  handleAddHypothesisTargets,
  handleRemoveHypothesisTargets,
  handleBuildContext,
  handleGetContextSnapshots,
  handleGetConversationsList,
  handleGetCompanyHypotheses,
  handleGetContactsByCompany,
  handleCreateCompany,
  handlePatchContactCompany,
  handleGetCompaniesByIds,
} from "./api-handlers.js";
import { syncEventBus, type SyncEvent } from "./services/sync-event-bus.js";

const PORT = Number(process.env.PORT ?? process.env.API_PORT) || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATIC_ROOT = path.resolve(__dirname, "../public");

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const servesStatic = async (pathname: string, res: import("node:http").ServerResponse) => {
  const decodedPath = decodeURIComponent(pathname);
  const requested = decodedPath === "/" ? "/index.html" : decodedPath;
  const resolvedPath = path.resolve(STATIC_ROOT, `.${requested}`);

  // Prevent directory traversal outside static root.
  if (!resolvedPath.startsWith(STATIC_ROOT)) {
    return false;
  }

  let filePath = resolvedPath;
  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
  } catch {
    filePath = path.join(STATIC_ROOT, "index.html");
  }

  try {
    const body = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": filePath.endsWith("index.html")
        ? "no-cache"
        : "public, max-age=31536000, immutable",
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
};

const server = createServer(async (req, res) => {
  const url = req.url ?? "";
  const pathname = url.includes("?") ? url.slice(0, url.indexOf("?")) : url;

  // Allow frontend dev server (and any origin when testing locally)
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.writeHead(204);
    res.end();
    return;
  }

  // Match /api/projects/:id/credentials
  const projectCredentialsMatch = pathname.match(
    /^\/api\/projects\/([^/]+)\/credentials$/
  );
  // Match /api/hypotheses/:id/targets
  const hypothesisTargetsMatch = pathname.match(
    /^\/api\/hypotheses\/([^/]+)\/targets$/
  );
  // Match /api/hypotheses/:id  (no trailing segment)
  const hypothesisIdMatch = !hypothesisTargetsMatch && pathname.match(
    /^\/api\/hypotheses\/([^/]+)$/
  );
  // Match /api/companies/:id/hypotheses
  const companyHypothesesMatch = pathname.match(
    /^\/api\/companies\/([^/]+)\/hypotheses$/
  );
  // Match /api/contacts/:id — exclude known sub-paths like "by-company"
  const contactIdMatch =
    pathname !== "/api/contacts/by-company" &&
    pathname.match(/^\/api\/contacts\/([^/]+)$/);

  try {
    if (projectCredentialsMatch) {
      const projectId = decodeURIComponent(projectCredentialsMatch[1]);
      await handleUpdateProjectCredentials(req, res, projectId);
      return;
    }

    if (hypothesisTargetsMatch) {
      const hypothesisId = decodeURIComponent(hypothesisTargetsMatch[1]);
      if (req.method === "GET") {
        await handleGetHypothesisTargets(req, res, hypothesisId);
      } else if (req.method === "POST") {
        await handleAddHypothesisTargets(req, res, hypothesisId);
      } else if (req.method === "DELETE") {
        await handleRemoveHypothesisTargets(req, res, hypothesisId);
      } else {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
      }
      return;
    }

    if (hypothesisIdMatch) {
      const hypothesisId = decodeURIComponent(hypothesisIdMatch[1]);
      if (req.method === "PUT") {
        await handleUpdateHypothesis(req, res, hypothesisId);
      } else if (req.method === "DELETE") {
        await handleDeleteHypothesis(req, res, hypothesisId);
      } else {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
      }
      return;
    }

    if (companyHypothesesMatch) {
      const companyId = decodeURIComponent(companyHypothesesMatch[1]);
      if (req.method === "GET") {
        await handleGetCompanyHypotheses(req, res, companyId);
      } else {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
      }
      return;
    }

    if (contactIdMatch) {
      const contactId = decodeURIComponent(contactIdMatch[1]);
      if (req.method === "PATCH") {
        await handlePatchContactCompany(req, res, contactId);
      } else {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Method not allowed" }));
      }
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
      case "/api/conversations":
        if (req.method === "GET") {
          await handleGetConversationsList(req, res);
        } else {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed" }));
        }
        return;
      case "/api/contacts/by-company":
        if (req.method === "GET") {
          await handleGetContactsByCompany(req, res);
        } else {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed" }));
        }
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
      case "/api/company-context-counts":
        if (req.method === "GET") {
          await handleGetCompanyContextCounts(req, res);
        } else {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed" }));
        }
        return;
      case "/api/contact-context":
        if (req.method === "GET") {
          await handleGetContactContext(req, res);
        } else if (req.method === "POST" || req.method === "PUT") {
          await handleSetContactContext(req, res);
        } else {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed" }));
        }
        return;
      case "/api/contact-context-counts":
        if (req.method === "GET") {
          await handleGetContactContextCounts(req, res);
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
      case "/api/companies":
        if (req.method === "GET") {
          await handleGetAllCompanies(req, res);
        } else if (req.method === "POST") {
          await handleCreateCompany(req, res);
        } else {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed" }));
        }
        return;
      case "/api/companies/by-ids":
        await handleGetCompaniesByIds(req, res);
        return;
      case "/api/project-companies":
        if (req.method === "GET") {
          await handleGetProjectCompanies(req, res);
        } else if (req.method === "POST") {
          await handleAddCompaniesToProject(req, res);
        } else {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed" }));
        }
        return;
      case "/api/hypotheses":
        if (req.method === "GET") {
          await handleGetHypotheses(req, res);
        } else if (req.method === "POST") {
          await handleCreateHypothesis(req, res);
        } else {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed" }));
        }
        return;
      case "/api/build-context":
        if (req.method === "POST") {
          await handleBuildContext(req, res);
        } else {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed" }));
        }
        return;
      case "/api/context-snapshots":
        if (req.method === "GET") {
          await handleGetContextSnapshots(req, res);
        } else {
          res.writeHead(405, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Method not allowed" }));
        }
        return;
      default:
        if (req.method === "GET" || req.method === "HEAD") {
          const wasServed = await servesStatic(pathname, res);
          if (wasServed) {
            return;
          }
        }
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`API server: http://localhost:${PORT}`);
  console.log("  GET  /api/supabase-state");
  console.log("  POST /api/supabase-sync");
  console.log("  GET  /api/supabase-table-query");
  console.log("  GET  /api/conversation");
  console.log("  GET  /api/company-context");
  console.log("  POST /api/company-context");
  console.log("  GET  /api/company-context-counts?company_ids=...");
  console.log("  GET  /api/contact-context");
  console.log("  POST /api/contact-context");
  console.log("  GET  /api/contact-context-counts?contact_ids=...");
  console.log("  GET  /api/projects");
  console.log("  PUT  /api/projects/:id/credentials");
  console.log("  GET  /api/sync-preflight?projectId=<id>");
  console.log("  GET  /api/sync-status");
  console.log("  GET  /api/sync-history");
  console.log("  GET  /api/project-companies?projectId=<id>");
  console.log("  GET  /api/hypotheses?projectId=<id>");
  console.log("  POST /api/hypotheses");
  console.log("  PUT  /api/hypotheses/:id");
  console.log("  DELETE /api/hypotheses/:id");
  console.log("  GET  /api/hypotheses/:id/targets");
  console.log("  POST /api/hypotheses/:id/targets");
  console.log("  DELETE /api/hypotheses/:id/targets");
  console.log("  POST /api/build-context");
  console.log("  GET  /api/context-snapshots?projectId=<id>");
  console.log("  WS   /api/sync-ws?runId=<id>");
});
