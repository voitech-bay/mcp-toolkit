# MCP Toolkit

Single MCP server merging **Supabase messages** and **Company enrichment** tools. Exposes MCP over **Streamable HTTP (SSE + POST)** for easy deployment (e.g. Vercel).

## Tools

- **get_messages** – Supabase messages (filter by sender, contact, lead, channel, date range, etc.)
- **search_companies** – Apollo organization search
- **search_people** – Apollo people search
- **search_lookalike_companies** – Ocean.io lookalike companies

## Local development

```bash
npm install
cp .env.example .env   # fill in keys
```

- **Stdio (for Cursor/IDE MCP):**  
  `npm run dev` — use in Cursor MCP config as a command: `npx tsx src/stdio.ts` (or `node dist/stdio.js` after build).

- **HTTP (test SSE endpoint):**  
  `npm run dev:http` — server at `http://localhost:3000/mcp`. Use this URL in MCP clients that support Streamable HTTP / SSE.

## Deploy to Vercel

1. Build: `npm run build` (required before deploy; produces `dist/`).
2. Deploy: `vercel` (or connect the repo in Vercel dashboard).
3. Set **Environment variables** in Vercel for the tools you use:
   - Supabase: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_ANON_KEY`), optional `SUPABASE_MESSAGES_TABLE`
   - Apollo: `APOLLO_API_KEY`
   - Ocean: `OCEAN_API_TOKEN`
4. MCP endpoint: **`https://your-app.vercel.app/api/mcp`**  
   Use this as the MCP server URL (Streamable HTTP / SSE) in Cursor or other clients.

## Project layout

- `src/` – all app code
  - `services/` – supabase, apollo, ocean
  - `tools/` – get-messages, company-enrichment
  - `server.ts` – merged MCP server + Streamable HTTP handler
  - `stdio.ts` – stdio entry for local MCP
  - `standalone-http.ts` – local HTTP server
- `api/mcp.ts` – Vercel serverless entry (GET/POST/DELETE `/api/mcp`)
