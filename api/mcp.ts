/**
 * Vercel serverless function: MCP over Streamable HTTP (SSE + POST).
 * Endpoint: GET/POST/DELETE /api/mcp
 *
 * Build first: npm run build (produces dist/). Then deploy to Vercel.
 * Set env vars in Vercel: SUPABASE_*, APOLLO_API_KEY, OCEAN_API_TOKEN, etc.
 */
import { createMcpHandler } from "../dist/server.js";

const handler = createMcpHandler();

export default handler;
