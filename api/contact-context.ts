/**
 * Vercel serverless: GET /api/contact-context?contact_id=... and POST|PUT /api/contact-context (body: { contact_id, rootContext }).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleGetContactContext, handleSetContactContext } from "../dist/api-handlers.js";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (req.method === "GET") {
    await handleGetContactContext(req, res);
  } else if (req.method === "POST" || req.method === "PUT") {
    await handleSetContactContext(req, res);
  } else {
    res.writeHead(405, { Allow: "GET, POST, PUT" });
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
  }
}
