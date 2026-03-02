# MCP Toolkit

Single MCP server merging **Supabase messages** and **Company enrichment** tools. Exposes MCP over **Streamable HTTP (SSE + POST)** for easy deployment (e.g. Vercel).

## Tools

- **get_linkedin_messages** – LinkedIn messages from Supabase (table LinkedinMessages)
- **get_senders** – Senders from Supabase (table Senders)
- **get_contacts** – Contacts from Supabase (table Contacts)
- **get_conversation_by_contact_name** – Find contact by name, return that contact + full LinkedIn conversation (by lead_uuid)
- **get_conversation_by_sender** – All LinkedIn messages (all conversations) for a sender (by sender_profile_uuid)
- **get_conversation_by_message** – Full conversation thread by message id or by conversation UUID
- **search_companies** – Apollo organization search
- **search_people** – Apollo people search
- **search_lookalike_companies** – Ocean.io lookalike companies

### Conversation tools – when to use

| Scenario | MCP tool | Example Cursor prompt |
|----------|----------|------------------------|
| Find conversation by contact name | `get_conversation_by_contact_name` | "Find conversation with John Doe" / "Show LinkedIn thread for contact named Alice Smith" |
| Find all conversations by sender | `get_conversation_by_sender` | "Show all messages from sender uuid abc-123..." / "All conversations for this sender" |
| Find conversation by a specific message | `get_conversation_by_message` | "Get the full thread for message id xyz" / "Show conversation containing this message" |

### Example MCP calls (Cursor / API)

**1. By contact name**

```json
{ "name": "get_conversation_by_contact_name", "arguments": { "contactFullName": "John Doe" } }
```

Optional: `"messageLimit": 500` (default 500, max 1000).

**2. By sender (all conversations)**

```json
{ "name": "get_conversation_by_sender", "arguments": { "senderProfileUuid": "550e8400-e29b-41d4-a716-446655440000" } }
```

Optional: `"messageLimit": 500`.

**3. By message (full thread)**

By message id (tool looks up `linkedin_conversation_uuid` from that message):

```json
{ "name": "get_conversation_by_message", "arguments": { "messageId": "msg-123" } }
```

By conversation UUID if you already have it:

```json
{ "name": "get_conversation_by_message", "arguments": { "conversationUuid": "550e8400-e29b-41d4-a716-446655440000" } }
```

Optional: `"messageLimit": 500`.

### Deeplinks (app URLs for Cursor / sharing)

Use these URLs to open the web app on the right table so you can use the row actions (“Find conversation by contact”, “Find conversation by message”, “Find all conversations by sender”). Replace `https://your-app.vercel.app` with your deployed base URL (or `http://localhost:5173` when running the frontend locally).

| Scenario | Deeplink |
|----------|----------|
| Find conversation by contact | `https://your-app.vercel.app/?table=contacts` |
| Find conversation by message | `https://your-app.vercel.app/?table=linkedin_messages` |
| Find all conversations by sender | `https://your-app.vercel.app/?table=senders` |

From each table, use the **Actions** column (message icon) on a row to load that conversation in the modal. You can share a link with filters and pagination, e.g. `?table=contacts&page=2&cols=name,uuid` (see app URL query params).

## Local development

```bash
npm install
cp .env.example .env   # fill in keys
```

- **Stdio (for Cursor/IDE MCP):**  
  `npm run dev` — use in Cursor MCP config as a command: `npx tsx src/stdio.ts` (or `node dist/stdio.js` after build).

- **HTTP (test SSE endpoint):**  
  `npm run dev:http` — server at `http://localhost:3000/mcp`. Use this URL in MCP clients that support Streamable HTTP / SSE.

- **Frontend (Vue 3 + TypeScript):**  
  `npm run dev:frontend` — Vite dev server with hot reload. Proxies `/api` to `http://localhost:3000`, so run `npm run dev:http` in another terminal to hit the API. After `npm run build`, the app is in `public/` (built from `frontend/`).

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

- `src/` – backend (MCP server, API handlers)
  - `services/` – supabase, apollo, ocean, source-api, sync-supabase
  - `tools/` – get-linkedin-messages, get-senders, get-contacts, get-conversation-by-contact-name, get-conversation-by-sender, get-conversation-by-message, company-enrichment
  - `server.ts` – merged MCP server + Streamable HTTP handler
  - `stdio.ts` – stdio entry for local MCP
  - `standalone-http.ts` – local HTTP server
- `frontend/` – Vue 3 + TypeScript app (builds into `public/`)
  - `src/` – App.vue, components (CountCards, LatestTables), types
  - `index.html` – Vite entry
- `api/` – Vercel serverless (mcp, supabase-state, supabase-sync)
