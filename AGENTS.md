# AGENTS.md

## Cursor Cloud specific instructions

Monorepo: Node 20+ TypeScript backend (`src/`) + two Vue 3 / Vite apps (`frontend/`, `client_frontend/`) + an enrichment worker. Railway is prod. Dependencies for all three packages are installed by the environment update script (`npm install` in root, `frontend/`, and `client_frontend/`), so a fresh Cloud Agent already has `node_modules` in each — do not reinstall unless `package.json` changed.

### Services and dev commands (see `package.json` scripts)

- API + MCP HTTP server (required for the main app): `npm run dev:api` (alias `npm run dev:http`). Serves `/api/*`, WebSockets, and MCP at `/mcp`.
- Main frontend (Voitech UI): `npm run dev:frontend` → Vite on `http://localhost:5173`.
- Client analytics portal (optional): `npm run dev:client-frontend`.
- Enrichment worker (optional): `npm run dev:enrichment-worker`.
- MCP stdio for IDE (optional): `npm run dev`.
- Tests: `npm test` (node --test, `src/**/*.test.ts`). There is no lint script.
- Builds: `npm run build:backend` (tsc), `frontend`/`client_frontend` build with `npm run build` in their dir.

### Non-obvious gotchas

- The API server hard-fails at boot without Supabase: `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are asserted immediately in `src/api-server.ts` (throws `SUPABASE_... are required`). There is no local Supabase config (`supabase/migrations` are partial, incremental only), so a functional backend needs the real hosted Supabase service-role credentials in `.env`. Everything else (Apollo, Ocean, OpenRouter, n8n, Hermes, etc.) is lazy — it only errors when its specific tool/route is called.
- Auth is OFF unless `VOITECH_AUTH_ENABLED=true`. When enabled it also needs `VOITECH_AUTH_SESSION_SECRET`, `VOITECH_WORKSPACE_PASSWORD`, `VOITECH_PAUL_PASSWORD`, `VOITECH_VELVETECH_PASSWORD` (see `src/services/auth.ts`).
- Port mismatch: Vite proxies `/api` to `http://localhost:3001` by default, but the API server defaults to port `3000`. Start the API with `API_PORT=3001 npm run dev:api` (or set `VITE_API_PROXY_TARGET=http://localhost:3000`) so the frontend proxy lines up. The README assumes `3001`.
- The frontend calls `/api/auth/session` on load and shows a login screen until it gets a valid session, so the SPA needs the backend (and Supabase) running to reach the real workspace UI — running only the frontend just renders the login/empty-state shell.
- Two frontends each keep their own `node_modules`; run installs per directory (the update script already does this).
- Copy `.env.example` → `.env` and fill Supabase keys for backend work; the worker checklist lives in `.env.worker.example`.
