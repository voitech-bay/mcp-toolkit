# Project status — VT / MCP toolkit

**Date:** March 27, 2026  

Short summary for leadership (e.g. with invoice).

---

## Done

- **Live stack:** Application backend and related services deployed on **Railway**; **Redash** (reporting) running on **AWS**, connected to our **Supabase** database.
- **Data pipeline:** GetSales-style source data synced into Supabase — contacts, companies, LinkedIn messages, campaigns (flows), funnel positions (flow leads), and analytics snapshots for reporting.
- **Product UI:** Web app for browsing data, running sync, managing companies/contacts, hypotheses, and enrichment workflows.
- **Reporting:** Executive and operational **Redash** dashboards (weekly KPIs, campaigns, funnels, hypotheses, message quality metrics). SQL definitions maintained in-repo for repeatability.
- **Database:** Core CRM + experimentation schema (projects, companies, contacts, hypotheses, project–company links, analytics tables aligned with GetSales IDs and foreign keys where applicable).
- **Manual conversation reply (local Cursor):** Operators can work through LinkedIn threads **inside Cursor** using the MCP connection: pull conversations and context from Supabase via tools, draft or refine replies in the chat, and keep the human-in-the-loop loop on the desktop without a separate “reply product” yet.
- **Batching for Cursor / LLM agents (enrichment):** A dedicated **enrichment worker** process (runs locally or next to the API, e.g. on Railway) **claims tasks** from a **Supabase-backed queue** (atomic claim so multiple workers can scale safely). Tasks are **grouped into batches per registered agent**: each agent has a **batch size**, an **optional wait window** (`ENRICHMENT_BATCH_WAIT_MS`) so partial batches flush after a timeout or when the queue is drained, and **prompt text** merged with **project-level prompt settings** (prefix/suffix, profiles). **Prompts** support `{{placeholders}}` for company/contact fields and prior agent outputs (`prompt-resolver`); the worker **assembles entities**, resolves the final prompt, and sends it through an **LLM adapter** (e.g. Cursor Cloud) so each batch becomes one model call where configured. **Worker presence** (heartbeats + optional WebSockets) lets the **web UI** show which workers are live, what they are running, and **pending batch buffers** (counts waiting to hit full batch vs. timer flush).

---

## To do

- **Sequence launch at scale:** One-click or scripted bulk “add to GetSales flow” from Supabase (config, batching, dry-run, runbook) — partially specified in backlog; not fully shipped as an end-to-end product path yet.
- **Deeper GTM analytics:** PipeDrive/HubSpot-style stages, calendar/calls, email — **not** in the database yet; dashboards call out these as a future phase.
- **Ongoing:** Sender profile extra fields, optional CRM data pull, and automation/testing items (e.g. Playwright flows) per product backlog.

---

## In progress / focus areas

- **Dashboard:** Reshaping reporting so leadership sees **weekly insights** clearly (trends, comparisons, and the metrics that matter for the operating rhythm).
- Company and contact **context** for replies and positioning.
- **Reply** workflow (ingest → context → draft options → human send via GetSales API) — productization in motion.

---

*Questions or scope changes: refer to the engineering team or `docs/project-overview.md` for technical detail.*
