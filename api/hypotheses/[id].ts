/**
 * Vercel serverless: PUT /api/hypotheses/:id and DELETE /api/hypotheses/:id
 * Vercel passes the dynamic segment via req.query.id (VercelRequest) or the URL.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleUpdateHypothesis, handleDeleteHypothesis } from "../../dist/api-handlers.js";

function extractId(req: IncomingMessage): string | null {
  const query = (req as unknown as Record<string, unknown>).query as Record<string, string> | undefined;
  if (query?.id) return query.id;
  const url = req.url ?? "";
  const match = url.match(/\/hypotheses\/([^/?]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const id = extractId(req);
  if (!id) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing hypothesis id" }));
    return;
  }
  if (req.method === "PUT") {
    await handleUpdateHypothesis(req, res, id);
  } else if (req.method === "DELETE") {
    await handleDeleteHypothesis(req, res, id);
  } else {
    res.writeHead(405, { Allow: "PUT, DELETE" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
  }
}
