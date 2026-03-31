# MCP Toolkit — project overview

**Last updated:** 2026-03-27

Single reference for architecture, data, analytics, deployment, backlog, and Linear hygiene.

---

## Deployments

| Component | Where |
|-----------|--------|
| **Backend API + MCP + built frontend** | **Railway** — this repo’s Node service (API, sync, enrichment worker paths as configured). |
| **Redash** (BI / SQL dashboards) | **AWS** — instance hosts dashboards that query the same Postgres (Supabase) data. |

Historical note: README still documents Vercel-style deploy for MCP over HTTP; production for this team is Railway + AWS Redash as above.

---

## What this repo is

- **MCP server** (`src/server.ts`, `src/stdio.ts`): tools for LinkedIn conversations, contacts, senders, company context, Apollo/Ocean search, enrichment helpers.
- **HTTP API** (`src/api-server.ts`, `src/api-handlers.ts`): REST used by the **Vue 3 frontend** (`frontend/`) — table browser, sync UI, companies/contacts/hypotheses, enrichment queue, worker presence, etc.
- **Sync layer** (`src/services/sync-supabase.ts`, `src/services/source-api.ts`): pulls **GetSales-style** data (contacts, messages, sender profiles, flows, flow leads, companies, analytics/metrics) into **Supabase Postgres** using `SOURCE_API_BASE_URL`, `SOURCE_API_KEY`, optional `SOURCE_TEAM_ID`, plus per-project credentials on `Projects`.

---

## Database (Supabase Postgres)

Data lives in **Supabase** (managed Postgres). The app treats it as the operational warehouse for GTM automation and experimentation.

### Core entities

- **`Projects`** — workspace scope; `id` (uuid), optional `source_api_base_url` / `source_api_key` for sync.
- **`companies`** — company records; **`id` is the GetSales company uuid** (not domain-keyed); domain nullable with partial unique index where present.
- **`Contacts`** — people; `uuid` PK, `company_uuid` / FK relationships to companies, `project_id`, profile fields, `list_uuid`, etc.
- **`Senders`** — LinkedIn sender profiles used in automation.
- **`LinkedinMessages`** — conversation rows keyed by lead/sender/conversation ids; optional `generated_message_id`, `reply_received` (per schema work).
- **`project_companies`** — links companies to projects (status, hypotheses targeting, etc.).
- **`company_context`** — structured context per company (migrated from legacy `CompaniesContext`).
- **`company_tags`**, **`hypotheses`**, **`hypothesis_targets`**, **`generated_messages`** (where applied) — experimentation and tagging.

### Automation & analytics (GetSales sync)

- **`Flows`** — campaigns / automation flows; `project_id`, metadata from API.
- **`FlowLeads`** — enrollment of contacts in flows; FK wiring to `Flows` and `Contacts` (see migrations `2025032712*` … `2025032716*`).
- **`AnalyticsSnapshots`** — daily (or periodic) **jsonb `metrics`** keyed by `project_id`, `snapshot_date`, `group_by`, `group_uuid`, optional **`flow_uuid`** for per-flow analytics; unique index on project + date + group + coalesce(group_uuid).

### Enrichment

- **`enrichment_agents`**, **`enrichment_agent_results`**, queue/run tables (see `src/services/supabase-schema.ts` and worker code) — LLM/agent enrichment with claim RPCs for workers.

### Conventions

- Mixed **`uuid` vs `text`** for external ids: joins often need **`::text` casts** (documented in `docs/redash-dashboard-index.md`).
- Migrations in-repo under `supabase/migrations/` add FKs and schema alignment (FlowLeads ↔ Flows/Contacts/Companies, AnalyticsSnapshots ↔ Flows, companies GetSales columns, etc.).

---

## How it works (runtime)

1. **Ingest:** Scheduled or manual sync calls the external API (`source-api.ts`) and upserts into whitelisted columns (`supabase-schema.ts`) to avoid clobbering backfills.
2. **Analytics snapshots:** Metrics from GetSales (`LEADS_METRICS_*` keys) roll into `AnalyticsSnapshots` (sender- and flow-level groupings).
3. **App:** Operators use the web UI for tables, sync logs, enrichment, hypotheses, and context building; MCP clients use tools for research and messaging workflows.
4. **BI:** Redash runs SQL against the same database for executive and operational views.

---

## Redash dashboards

Canonical index: **`docs/redash-dashboard-index.md`**. Summary:

| Dashboard | Slug / id | Role |
|-----------|-----------|------|
| **GetSales / Weekly** | `getsales-weekly` (id 2) | KPI strip, campaign leaderboard, weekly trend, sender leaderboard, active flows, WoW KPIs, FlowLeads funnel, ICP job-title breakdown. Global filters: **DateRange**, **Project** (query id 10). |
| **VT** | `vt` (id 1) | Original LinkedIn message widgets + upgraded rows (analytics, automation funnel, hypotheses, messaging quality). Same global filters. |
| **VT / Automation flow funnel** | `vt-automation-flow-funnel` (id 3) | Queries 32–35 — automation funnel from `AnalyticsSnapshots` + samples from FlowLeads/messages. |

**SQL sources** (in `docs/`):

- `redash-analytics-snapshots-queries.sql`
- `redash-flowleads-funnel-icp-queries.sql`
- `redash-automation-flow-funnel-queries.sql`
- `redash-messages-noresponse-responsetime-queries.sql`
- `redash-hypotheses-week-wow-queries.sql`

**Phase 2 gap (not in DB):** CRM calendar, calls, PipeDrive/HubSpot pipeline, Gmail — listed explicitly as “no DB yet” in the dashboard index; future webhooks → tables like `CrmDeals` / `CrmActivities`.

---

## Linear (Iamthedude team)

Workspace: team **Iamthedude**. Project **VT** holds most product work.

### Moved to **Done** on 2026-03-27 (verified in-repo)

| Issue | Title | Rationale |
|-------|--------|-----------|
| [IAM-7](https://linear.app/iamthedude/issue/IAM-7/hypothesis-table-for-sequence-launch) | Hypothesis table for sequence launch | `hypotheses` / `hypothesis_targets` + API + `HypothesesPage.vue`; sequence *launch* remains IAM-6. |
| [IAM-10](https://linear.app/iamthedude/issue/IAM-10/getsales-config-and-auth) | GetSales config and auth | `SOURCE_API_*` env, `resolveCredentials()`, per-project keys in sync; launch-specific defaults still IAM-6 / IAM-11–14. |

### Representative open / in-flight items (not exhaustive)

| Status | Examples |
|--------|-----------|
| **In Progress** | IAM-6 Sequence launch, IAM-8 Company context, IAM-9 Reply simulation & sending |
| **Todo / Backlog** | IAM-11–14 (launch mapping, client, batch script, dry-run), IAM-16/17 Playwright, IAM-31 Sender profile extra fields, IAM-32 CRM pull, IAM-34 Submodule split (parent repo), IAM-35 Cursor cloud agent + Railway |

Statuses in Linear are not always current; prefer this doc + git for ground truth.

---

## Done vs still to do (engineering)

### Largely done

- Supabase schema alignment for CRM + experimentation (parent IAM-18 and children — many marked Done in Linear).
- Sync from GetSales-style API into contacts, messages, senders, flows, flow leads, companies, analytics snapshots.
- Frontend pages for sync, companies, contacts, conversations, hypotheses, enrichment table; API surface in `api-server.ts`.
- Redash VT + GetSales weekly dashboards and supporting SQL docs.
- Railway deployment for backend/app; Redash on AWS.

### Still to do / gaps

- **Sequence launch end-to-end:** add-new-lead (or equivalent) client, batch launcher, dry-run, docs — **not** present as a dedicated implementation in `src/` at review time (IAM-6 family).
- **Sender fields** “role, legend, about” (IAM-31) — not in `SENDERS_COLUMNS` whitelist yet.
- **CRM / calendar / email** analytics — no synced tables; Redash “Phase 2” block.
- **IAM-35** — Cursor cloud agent integration with Railway (research/config).
- **Operational polish:** keep Linear states aligned with shipped work; optional `flow_uuid` global filter on Redash widgets per dashboard index notes.

---

## Related internal docs

- `docs/redash-dashboard-index.md` — dashboard inventory and query IDs  
- `docs/dashboard-requirements.md` — stakeholder goals (RU) for stats and visualization  
- `README.md` — MCP tools, local dev, Vercel-oriented deploy notes  

---

*This file was generated as a single living artifact; update the “Last updated” line when you change deployments or major scope.*
