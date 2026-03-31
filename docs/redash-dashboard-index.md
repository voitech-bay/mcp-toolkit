# Redash Dashboard Index

---

## GetSales / Weekly (id: 2, slug: `getsales-weekly`)

**Global filters:** `DateRange` (datetime-range) + `Project` (query dropdown from `Projects dropdown` query id 10)

| ID | Name | Tables | Viz type | Widget section |
|----|------|--------|----------|----------------|
| 11 | GetSales / Analytics KPI strip | AnalyticsSnapshots | TABLE | Exec — KPIs |
| 12 | GetSales / Campaign leaderboard | AnalyticsSnapshots + Flows | TABLE | Exec — campaigns |
| 13 | GetSales / Weekly trend | AnalyticsSnapshots | CHART (column+line) | Exec — trend |
| 14 | GetSales / Sender leaderboard | AnalyticsSnapshots + Senders | CHART (column+line) | Internal — senders |
| 15 | GetSales / Active campaigns (Flows) | Flows | TABLE | Exec — active flows |
| 16 | GetSales / Period-over-period KPIs | AnalyticsSnapshots | TABLE | Exec — WoW delta |
| 17 | GetSales / Flow funnel (FlowLeads status) | FlowLeads + Flows | CHART (stacked bar) | Gaps — funnel |
| 18 | GetSales / Job title breakdown (ICP) | FlowLeads + Contacts + LinkedinMessages | CHART (bar) | Gaps — ICP |

---

## VT (id: 1, slug: `vt`)

**Global filters:** `DateRange` (datetime-range) + `Project` (query dropdown, query id 10)  
**dashboard_filters_enabled:** true

### Original widgets (LinkedinMessages analysis)

| ID | Name | Tables | Viz type | Widget section |
|----|------|--------|----------|----------------|
| 2 | Total/Replied Conversations | LinkedinMessages + Contacts | TABLE | Exec — overview |
| 3 | Conversation Replies By Day | LinkedinMessages + Contacts | CHART (line) | Exec — trend |
| 5 | Stats By Sender | LinkedinMessages + Contacts | TABLE | Internal — senders |
| 6 | Funnel conversations | LinkedinMessages + Contacts | TABLE | Exec — funnel |
| 7 | Messages before first reply | LinkedinMessages | TABLE + CHART | Internal — depth |
| 8 | Connection notes stats | LinkedinMessages | TABLE | Internal — notes |
| 9 | Drill table | LinkedinMessages + Contacts | TABLE | Internal — drill |

### New widgets added (VT Dashboard Upgrade)

#### Executive row — KPIs & Analytics

| Query ID | Name | Tables | Section |
|----------|------|--------|---------|
| 11 | GetSales / Analytics KPI strip | AnalyticsSnapshots | Exec — connection + reply rates |
| 12 | GetSales / Campaign leaderboard | AnalyticsSnapshots + Flows | Exec — per campaign |
| 25 | VT / Weekly snapshots WoW | AnalyticsSnapshots | Exec — week-over-week |

#### Funnel & Leads

| Query ID | Name | Tables | Section |
|----------|------|--------|---------|
| 32 | VT / Automation flow funnel | **AnalyticsSnapshots** | `flow_name::multiFilter`, `Status`, `Total` (count), `%` columns. Chart **viz 50**: grouped bars. |
| 37 | VT / Automation flow funnel — conversion rates | **AnalyticsSnapshots** | `flow_name::multiFilter`, `Status` (3 stages), `% vs connection sent`, `% vs previous stage`. Chart **viz 57**: line chart per flow. |
| 38 | VT / Automation flow funnel — funnel by selected flows | **AnalyticsSnapshots** | `flow_name::multiFilter`, `Stage`, `Value` (per-flow rows). Chart **viz 61** sums **Value** per **Stage** after filter = totals. Table = detail. |
| 39 | VT / Automation flow funnel — daily metrics by flow | **AnalyticsSnapshots** | `day`, `flow_name::multiFilter`, `Metric`, `Value` — counts **that calendar day** per metric. Chart **viz 63**: 4 lines vs day. |
| 40 | VT / Automation flow funnel — stage conversion rates | **AnalyticsSnapshots** | `flow_name::multiFilter`, `Conversion` (3 transitions), `Rate` (%). Chart **viz 65**: grouped bars; one flow selected → 3 bars. |
| 36 | VT / Automation funnel — project totals (funnel viz) | **AnalyticsSnapshots** | `Stage`, `Value`, same **%** columns (project totals). **FUNNEL** viz **55** maps Stage+Value only. |
| — | VT / Automation funnel — per-flow wide | **AnalyticsSnapshots** + Flows | Funnel — same totals + rate columns (block 2 in SQL file) |
| 33 | VT / Automation funnel — samples Started | FlowLeads + Flows + Contacts | Funnel — latest FlowLeads in range |
| 34 | VT / Automation funnel — samples Connected | LinkedinMessages + FlowLeads + Flows | Funnel — latest connection notes in range |
| 35 | VT / Automation funnel — samples Replied | LinkedinMessages + FlowLeads + Contacts | Funnel — latest first-inbox-in-range |
| 27 | VT / Job title breakdown (ICP) | FlowLeads + Contacts + LinkedinMessages | ICP — who replies |
| 29 | VT / Funnel velocity (days per status) | FlowLeads + Flows | Funnel — velocity |
| 30 | VT / Strongest leads | FlowLeads + Contacts + Flows | Leads — hot list |

**VT / Automation flow funnel dashboard** (`id` 3, slug `vt-automation-flow-funnel`): queries **32–35** (+ **36**, **37**, **38**, **39**, **40**). Query **38** / **viz 61**: column chart = **totals per stage** for flows picked in **`flow_name::multiFilter`**. Query **39** / **viz 63**: **daily** lines (sent / accepted / inbox / positive) over **Date range**. Query **40** / **viz 65**: **conversion %** for the three stage pairs (per flow; filter to one flow for three single bars). Query **36** / **viz 55**: project-wide FUNNEL.

If **`flow_uuid`** does not appear as a dashboard-level filter, add it in the Redash UI (Edit dashboard → Global filters) so it maps to all widgets. One legacy table widget could not be updated via API (500); re-save or re-map **flow_uuid** on that widget if needed.

#### Hypotheses

| Query ID | Name | Tables | Section |
|----------|------|--------|---------|
| 22 | VT / Hypothesis counts | hypotheses + hypothesis_targets | Hypotheses — summary |
| 23 | VT / Hypothesis leaderboard | hypotheses + hypothesis_targets + project_companies + FlowLeads | Hypotheses — leaderboard |
| 24 | VT / Hypothesis period-over-period | hypotheses + hypothesis_targets + project_companies + FlowLeads | Hypotheses — WoW delta |

#### Messaging quality

| Query ID | Name | Tables | Section |
|----------|------|--------|---------|
| 19 | VT / No-response rate | LinkedinMessages + Contacts | Quality — no-response |
| 20 | VT / Response time histogram | LinkedinMessages + Contacts | Quality — response time distribution |
| 21 | VT / Response time percentiles | LinkedinMessages + Contacts | Quality — response time summary |
| 28 | VT / Follow-up count (re-engagement) | LinkedinMessages | Quality — follow-up intensity |

**SQL source files:**
- `docs/redash-analytics-snapshots-queries.sql` — blocks 1–6 (KPI, campaign, weekly, sender, active flows, WoW); blocks 1 & 2 updated with `linkedin_connection_rate_pct`
- `docs/redash-flowleads-funnel-icp-queries.sql` — blocks 1–5 (status funnel, job title, job×campaign, project status funnel, reply proxy)
- `docs/redash-automation-flow-funnel-queries.sql` — automation funnel from **AnalyticsSnapshots** (connections sent / accepted / inbox), per-flow wide table, samples (FlowLeads / messages), validation; legacy FlowLead-count funnel in SQL appendix
- `docs/redash-messages-noresponse-responsetime-queries.sql` — no-response rate, response-time histogram, percentiles
- `docs/redash-hypotheses-week-wow-queries.sql` — hypotheses / WoW

---

## Phase 2 — CRM / Calendar / Forecast (no DB yet)

The following widgets are **not implemented** — data sources are unavailable in Supabase:

| Metric | Required source | Status |
|--------|-----------------|--------|
| Scheduled calls | Google Calendar / Calendly sync | ❌ Not synced |
| Calls completed (post-call) | CRM — PipeDrive or HubSpot | ❌ Not synced |
| Interested leads → Qualified / SQO | CRM pipeline stage | ❌ Not synced |
| Disqualified leads | CRM | ❌ Not synced |
| Call forecast | CRM / manual input | ❌ Not automated |
| Gmail emails and booked meetings | Google Workspace API | ❌ Not synced |

**Next step:** add a PipeDrive/HubSpot webhook → Supabase table (`CrmDeals`, `CrmActivities`) and re-create these widgets with the same `DateRange` + `project_id` global parameters.

---

## UUID cast notes

`Senders.uuid`, `Contacts.uuid`, and `LinkedinMessages.lead_uuid` are stored as Postgres `uuid` type in Supabase.  
`AnalyticsSnapshots.group_uuid` is `text`. `AnalyticsSnapshots.flow_uuid` references `Flows.uuid` (often `uuid` type). `FlowLeads.lead_uuid`, `FlowLeads.flow_uuid` may be `text` or `uuid` depending on migration — cast at join time when needed.  
All joins across these tables require explicit `::text` casts on the `uuid`-typed side, e.g.:

```sql
LEFT JOIN public."Senders" se ON se.uuid::text = daily.group_uuid
LEFT JOIN public."Contacts" c ON c.uuid::text = fl.lead_uuid
WHERE m.lead_uuid::text = fl.lead_uuid
```
