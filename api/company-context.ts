/**
 * Vercel serverless: GET /api/company-context?name=... and POST|PUT /api/company-context (body: { name, rootContext }).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleGetCompanyContext, handleSetCompanyContext } from "../dist/api-handlers.js";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method === "GET") {
    await handleGetCompanyContext(req, res);
  } else if (req.method === "POST" || req.method === "PUT") {
    await handleSetCompanyContext(req, res);
  } else {
    res.writeHead(405, { Allow: "GET, POST, PUT" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
  }
}
