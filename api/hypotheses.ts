/**
 * Vercel serverless: GET /api/hypotheses?projectId=<id> and POST /api/hypotheses
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleGetHypotheses, handleCreateHypothesis } from "../dist/api-handlers.js";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method === "GET") {
    await handleGetHypotheses(req, res);
  } else if (req.method === "POST") {
    await handleCreateHypothesis(req, res);
  } else {
    res.writeHead(405, { Allow: "GET, POST" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
  }
}
