-- =============================================================================
-- Redash SQL pack: VT / Flow detail dashboard (tables, full history, no DateRange)
--
-- Mirrors AnalyticsSnapshots patterns in docs/redash-automation-flow-funnel-queries.sql:
--   group_by = 'sender_profiles', flow_uuid set, metrics JSON keys aligned with
--   LEADS_METRICS_REQUEST_KEYS in src/services/source-api.ts.
--
-- Parameters: project_id only (query dropdown from saved query id 10 — Projects).
-- No DateRange: all blocks scan full history for the selected project.
--
-- Dashboard filter: expose flow name as column alias **flow_name::multiFilter** (snake_case)
-- on every widget query so Redash multi-filter works like the automation funnel dashboard.
--
-- Edge cases (lifecycle):
--   Flow never recorded connection sends → flow_start_date / flow_end_date NULL.
--   Dates reflect snapshot rows only (sparse sync ≠ calendar “silence”).
--
-- Paste each numbered block (1, 1b, 2–4, 4b, 4c, 5) into its own saved query in Redash.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) Flow lifecycle — start/end from daily connection sends (full history)
-- -----------------------------------------------------------------------------
-- One row per flow in the project. flow_start_date = first snapshot_date where
-- daily sum of linkedin_connection_request_sent_count > 0; flow_end_date = last
-- such day with sum >= 1 (same as > 0 for integer counts).
WITH pid AS (
  SELECT NULLIF(BTRIM('{{ project_id }}'), '')::uuid AS project_id
),
snap AS (
  SELECT
    s.flow_uuid,
    s.snapshot_date,
    s.metrics
  FROM public."AnalyticsSnapshots" s
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND s.project_id = p.project_id
    AND s.group_by = 'sender_profiles'
    AND s.flow_uuid IS NOT NULL
),
daily_sent AS (
  SELECT
    s.flow_uuid::text AS flow_uuid,
    s.snapshot_date,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_connection_request_sent_count', ''))::bigint, 0)) AS linkedin_connection_request_sent_daily
  FROM snap s
  GROUP BY s.flow_uuid::text, s.snapshot_date
),
lifecycle AS (
  SELECT
    d.flow_uuid,
    MIN(d.snapshot_date) FILTER (WHERE d.linkedin_connection_request_sent_daily > 0) AS flow_start_date,
    MAX(d.snapshot_date) FILTER (WHERE d.linkedin_connection_request_sent_daily >= 1) AS flow_end_date
  FROM daily_sent d
  GROUP BY d.flow_uuid
),
flows AS (
  SELECT
    f.uuid::text AS flow_uuid,
    COALESCE(f.name, '(Unknown flow)') AS flow_name
  FROM public."Flows" f
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND f.project_id = p.project_id
)
SELECT
  flw.flow_name AS "flow_name::multiFilter",
  flw.flow_uuid,
  lc.flow_start_date,
  lc.flow_end_date
FROM flows flw
LEFT JOIN lifecycle lc ON lc.flow_uuid = flw.flow_uuid
ORDER BY flw.flow_name;


-- -----------------------------------------------------------------------------
-- 1b) Flow KPI summary — connected leads, inbox (messages vs analytics)
-- -----------------------------------------------------------------------------
-- connected_leads_total: distinct FlowLeads.lead_uuid per flow with at least one
--   LinkedinMessages row where linkedin_type = connection_note (legacy funnel “Connected”).
-- inbox_messages_connected_leads_total: count of type=inbox messages for leads enrolled
--   in that flow who also have a connection_note (same “connected” definition).
-- analytics_linkedin_inbox_total / analytics_connection_accepted_total: all-time sums
--   from AnalyticsSnapshots metrics (same keys as automation funnel).
WITH pid AS (
  SELECT NULLIF(BTRIM('{{ project_id }}'), '')::uuid AS project_id
),
flows AS (
  SELECT
    f.uuid::text AS flow_uuid,
    COALESCE(f.name, '(Unknown flow)') AS flow_name
  FROM public."Flows" f
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND f.project_id = p.project_id
),
connected_leads AS (
  SELECT
    fl.flow_uuid::text AS flow_uuid,
    COUNT(DISTINCT fl.lead_uuid)::bigint AS n
  FROM public."FlowLeads" fl
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND fl.project_id = p.project_id
    AND EXISTS (
      SELECT 1
      FROM public."LinkedinMessages" m
      WHERE m.lead_uuid::text = fl.lead_uuid
        AND m.project_id = fl.project_id
        AND LOWER(TRIM(COALESCE(m.linkedin_type, ''))) = 'connection_note'
        AND COALESCE(m.sent_at, m.created_at) IS NOT NULL
    )
  GROUP BY fl.flow_uuid::text
),
inbox_connected AS (
  SELECT
    fl.flow_uuid::text AS flow_uuid,
    COUNT(*)::bigint AS n
  FROM public."LinkedinMessages" m
  INNER JOIN public."FlowLeads" fl
    ON fl.lead_uuid = m.lead_uuid::text
   AND fl.project_id = m.project_id
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND m.project_id = p.project_id
    AND LOWER(TRIM(COALESCE(m.type, ''))) = 'inbox'
    AND COALESCE(m.sent_at, m.created_at) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public."LinkedinMessages" m2
      WHERE m2.lead_uuid::text = fl.lead_uuid
        AND m2.project_id = fl.project_id
        AND LOWER(TRIM(COALESCE(m2.linkedin_type, ''))) = 'connection_note'
        AND COALESCE(m2.sent_at, m2.created_at) IS NOT NULL
    )
  GROUP BY fl.flow_uuid::text
),
snap AS (
  SELECT
    s.flow_uuid,
    s.metrics
  FROM public."AnalyticsSnapshots" s
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND s.project_id = p.project_id
    AND s.group_by = 'sender_profiles'
    AND s.flow_uuid IS NOT NULL
),
analytics_by_flow AS (
  SELECT
    s.flow_uuid::text AS flow_uuid,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_inbox_count', ''))::bigint, 0)) AS inbox_analytics,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_connection_request_accepted_count', ''))::bigint, 0)) AS accepted_analytics
  FROM snap s
  GROUP BY s.flow_uuid::text
)
SELECT
  flw.flow_name AS "flow_name::multiFilter",
  flw.flow_uuid,
  COALESCE(cl.n, 0)::bigint AS connected_leads_total,
  COALESCE(ic.n, 0)::bigint AS inbox_messages_connected_leads_total,
  COALESCE(ab.inbox_analytics, 0)::bigint AS analytics_linkedin_inbox_total,
  COALESCE(ab.accepted_analytics, 0)::bigint AS analytics_connection_accepted_total
FROM flows flw
LEFT JOIN connected_leads cl ON cl.flow_uuid = flw.flow_uuid
LEFT JOIN inbox_connected ic ON ic.flow_uuid = flw.flow_uuid
LEFT JOIN analytics_by_flow ab ON ab.flow_uuid = flw.flow_uuid
ORDER BY flw.flow_name;


-- -----------------------------------------------------------------------------
-- 2) Daily connection sends — all history, one row per flow per snapshot_date
-- -----------------------------------------------------------------------------
-- CHART viz: line, X = day, Series = flow_name::multiFilter, Y = linkedin_connection_request_sent_daily.
-- Table export: same columns. Same daily sum definition as block 1.
WITH pid AS (
  SELECT NULLIF(BTRIM('{{ project_id }}'), '')::uuid AS project_id
),
snap AS (
  SELECT
    s.flow_uuid,
    s.snapshot_date,
    s.metrics
  FROM public."AnalyticsSnapshots" s
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND s.project_id = p.project_id
    AND s.group_by = 'sender_profiles'
    AND s.flow_uuid IS NOT NULL
),
daily_sent AS (
  SELECT
    s.flow_uuid::text AS flow_uuid,
    s.snapshot_date,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_connection_request_sent_count', ''))::bigint, 0)) AS linkedin_connection_request_sent_daily
  FROM snap s
  GROUP BY s.flow_uuid::text, s.snapshot_date
),
flows AS (
  SELECT
    f.uuid::text AS flow_uuid,
    COALESCE(f.name, '(Unknown flow)') AS flow_name
  FROM public."Flows" f
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND f.project_id = p.project_id
)
SELECT
  d.snapshot_date AS day,
  f.flow_name AS "flow_name::multiFilter",
  d.linkedin_connection_request_sent_daily
FROM daily_sent d
INNER JOIN flows f ON f.flow_uuid = d.flow_uuid
ORDER BY d.snapshot_date ASC, f.flow_name;


-- -----------------------------------------------------------------------------
-- 3) Per-flow metrics — all LEADS_METRICS keys, all-time sums + enrollment counts
-- -----------------------------------------------------------------------------
-- Sums metrics JSON over all snapshot rows (all dates, all sender profiles) per flow.
-- Includes FlowLeads row count and distinct lead_uuid for operational context.
WITH pid AS (
  SELECT NULLIF(BTRIM('{{ project_id }}'), '')::uuid AS project_id
),
snap AS (
  SELECT
    s.flow_uuid,
    s.metrics
  FROM public."AnalyticsSnapshots" s
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND s.project_id = p.project_id
    AND s.group_by = 'sender_profiles'
    AND s.flow_uuid IS NOT NULL
),
by_flow AS (
  SELECT
    s.flow_uuid::text AS flow_uuid,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_connection_request_sent_count', ''))::bigint, 0)) AS linkedin_connection_request_sent_count,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_connection_request_accepted_count', ''))::bigint, 0)) AS linkedin_connection_request_accepted_count,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_sent_count', ''))::bigint, 0)) AS linkedin_sent_count,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_opened_count', ''))::bigint, 0)) AS linkedin_opened_count,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_inbox_count', ''))::bigint, 0)) AS linkedin_inbox_count,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_inmail_sent_count', ''))::bigint, 0)) AS linkedin_inmail_sent_count,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_inmail_replied_count', ''))::bigint, 0)) AS linkedin_inmail_replied_count,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_positive_count', ''))::bigint, 0)) AS linkedin_positive_count,
    SUM(COALESCE((NULLIF(s.metrics->>'email_sent_count', ''))::bigint, 0)) AS email_sent_count,
    SUM(COALESCE((NULLIF(s.metrics->>'email_opened_count', ''))::bigint, 0)) AS email_opened_count,
    SUM(COALESCE((NULLIF(s.metrics->>'email_clicked_count', ''))::bigint, 0)) AS email_clicked_count,
    SUM(COALESCE((NULLIF(s.metrics->>'email_bounced_count', ''))::bigint, 0)) AS email_bounced_count,
    SUM(COALESCE((NULLIF(s.metrics->>'email_unsubscribed_count', ''))::bigint, 0)) AS email_unsubscribed_count,
    SUM(COALESCE((NULLIF(s.metrics->>'email_inbox_count', ''))::bigint, 0)) AS email_inbox_count,
    SUM(COALESCE((NULLIF(s.metrics->>'email_positive_count', ''))::bigint, 0)) AS email_positive_count
  FROM snap s
  GROUP BY s.flow_uuid::text
),
enrollment AS (
  SELECT
    fl.flow_uuid::text AS flow_uuid,
    COUNT(*)::bigint AS flow_leads_row_count,
    COUNT(DISTINCT fl.lead_uuid)::bigint AS flow_lead_distinct_contacts
  FROM public."FlowLeads" fl
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND fl.project_id = p.project_id
  GROUP BY fl.flow_uuid::text
),
flows AS (
  SELECT
    f.uuid::text AS flow_uuid,
    COALESCE(f.name, '(Unknown flow)') AS flow_name
  FROM public."Flows" f
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND f.project_id = p.project_id
)
SELECT
  flw.flow_name AS "flow_name::multiFilter",
  COALESCE(bf.linkedin_connection_request_sent_count, 0)::bigint AS linkedin_connection_request_sent_count,
  COALESCE(bf.linkedin_connection_request_accepted_count, 0)::bigint AS linkedin_connection_request_accepted_count,
  COALESCE(bf.linkedin_sent_count, 0)::bigint AS linkedin_sent_count,
  COALESCE(bf.linkedin_opened_count, 0)::bigint AS linkedin_opened_count,
  COALESCE(bf.linkedin_inbox_count, 0)::bigint AS linkedin_inbox_count,
  COALESCE(bf.linkedin_inmail_sent_count, 0)::bigint AS linkedin_inmail_sent_count,
  COALESCE(bf.linkedin_inmail_replied_count, 0)::bigint AS linkedin_inmail_replied_count,
  COALESCE(bf.linkedin_positive_count, 0)::bigint AS linkedin_positive_count,
  COALESCE(bf.email_sent_count, 0)::bigint AS email_sent_count,
  COALESCE(bf.email_opened_count, 0)::bigint AS email_opened_count,
  COALESCE(bf.email_clicked_count, 0)::bigint AS email_clicked_count,
  COALESCE(bf.email_bounced_count, 0)::bigint AS email_bounced_count,
  COALESCE(bf.email_unsubscribed_count, 0)::bigint AS email_unsubscribed_count,
  COALESCE(bf.email_inbox_count, 0)::bigint AS email_inbox_count,
  COALESCE(bf.email_positive_count, 0)::bigint AS email_positive_count,
  COALESCE(e.flow_leads_row_count, 0)::bigint AS flow_leads_row_count,
  COALESCE(e.flow_lead_distinct_contacts, 0)::bigint AS flow_lead_distinct_contacts
FROM flows flw
LEFT JOIN by_flow bf ON bf.flow_uuid = flw.flow_uuid
LEFT JOIN enrollment e ON e.flow_uuid = flw.flow_uuid
ORDER BY COALESCE(bf.linkedin_connection_request_sent_count, 0) DESC, flw.flow_name;


-- -----------------------------------------------------------------------------
-- 4) Contacts in flow — FlowLeads + Contacts + pipeline stage
-- -----------------------------------------------------------------------------
-- Identity: FlowLeads.lead_uuid is the contact id (Contacts.uuid); join with ::text on uuid side.
-- pipeline_stage_uuid on Contacts is text in DB; PipelineStages.uuid is uuid — cast both to text.
WITH pid AS (
  SELECT NULLIF(BTRIM('{{ project_id }}'), '')::uuid AS project_id
)
SELECT
  COALESCE(f.name, '(Unknown flow)') AS "flow_name::multiFilter",
  fl.uuid AS flow_lead_uuid,
  fl.flow_uuid::text AS flow_uuid,
  fl.lead_uuid,
  fl.status AS flow_lead_status,
  fl.created_at AS flow_lead_created_at,
  c.uuid AS contact_uuid,
  c.first_name,
  c.last_name,
  c.email,
  c.work_email,
  c.linkedin,
  c.linkedin_url,
  c.company_name,
  ps.name AS pipeline_stage_name,
  ps.stage_type AS pipeline_stage_type
FROM public."FlowLeads" fl
INNER JOIN public."Flows" f
  ON f.uuid = fl.flow_uuid
 AND f.project_id = fl.project_id
CROSS JOIN pid p
LEFT JOIN public."Contacts" c
  ON c.uuid::text = fl.lead_uuid
 AND c.project_id = fl.project_id
LEFT JOIN public."PipelineStages" ps
  ON ps.uuid::text = c.pipeline_stage_uuid::text
 AND ps.project_id = c.project_id
WHERE p.project_id IS NOT NULL
  AND fl.project_id = p.project_id
ORDER BY f.name, fl.created_at DESC NULLS LAST;


-- -----------------------------------------------------------------------------
-- 4b) Pipeline stage totals — per flow × stage (enrolled contacts)
-- -----------------------------------------------------------------------------
-- Redash (query 52): TABLE viz + **CHART** “Pipeline stages by flow (stacked)” — X=flow,
--   series=pipeline_stage_name, Y=contacts_in_stage_total, stacked columns. Second CHART
--   “(grouped)” — X=pipeline stage, series=flow, grouped columns (compare flows per stage).
-- One row per (flow, pipeline stage). Counts distinct FlowLeads.lead_uuid in that flow
-- whose contact maps to that stage (or "(No stage)" if contact missing / no stage).
-- Joins match block 4 (text/uuid casts on Contacts ↔ PipelineStages).
WITH pid AS (
  SELECT NULLIF(BTRIM('{{ project_id }}'), '')::uuid AS project_id
)
SELECT
  COALESCE(f.name, '(Unknown flow)') AS "flow_name::multiFilter",
  f.uuid::text AS flow_uuid,
  COALESCE(ps.name, '(No stage)') AS pipeline_stage_name,
  COALESCE(ps.stage_type, '') AS pipeline_stage_type,
  COALESCE(ps.uuid::text, '') AS pipeline_stage_uuid,
  MIN(COALESCE(ps.stage_order, 2147483647)) AS pipeline_stage_order,
  COUNT(DISTINCT fl.lead_uuid)::bigint AS contacts_in_stage_total
FROM public."FlowLeads" fl
INNER JOIN public."Flows" f
  ON f.uuid = fl.flow_uuid
 AND f.project_id = fl.project_id
CROSS JOIN pid p
LEFT JOIN public."Contacts" c
  ON c.uuid::text = fl.lead_uuid
 AND c.project_id = fl.project_id
LEFT JOIN public."PipelineStages" ps
  ON ps.uuid::text = c.pipeline_stage_uuid::text
 AND ps.project_id = c.project_id
WHERE p.project_id IS NOT NULL
  AND fl.project_id = p.project_id
GROUP BY
  f.uuid,
  f.name,
  COALESCE(ps.uuid::text, ''),
  COALESCE(ps.name, '(No stage)'),
  COALESCE(ps.stage_type, '')
ORDER BY f.name, MIN(COALESCE(ps.stage_order, 2147483647)), pipeline_stage_name;


-- -----------------------------------------------------------------------------
-- 4c) Pipeline stage rates per flow (named buckets + other / no stage)
-- -----------------------------------------------------------------------------
-- Denominator: distinct FlowLeads.lead_uuid in the flow (all enrolled contacts).
-- Numerator: contacts whose **current** PipelineStages.name (trimmed) maps to a bucket.
-- Buckets use **exact** TRIM(ps.name) (DB sample 2026-04 — distinct names):
--   Active Opportunity, Approaching, Bad Data, Bad Timing, Current Customer, Do Not Contact,
--   Engaging, Handraiser, Low fit, Need referral, New, No Active Contacts, Not Interested,
--   Opportunity, Replied, Replied - Negative, Replied - Positive, Unresponsive.
-- Rollups: Replied - Negative → replied; Active Opportunity → opportunity; Do Not Contact → not_interested.
-- All other names → other. Extend CASE IN (...) if you add stages.
-- Exposed: *rate_pct = 100 × count / contacts_in_flow_total; raw n_* counts for QA.
WITH pid AS (
  SELECT NULLIF(BTRIM('{{ project_id }}'), '')::uuid AS project_id
),
enriched AS (
  SELECT
    f.uuid::text AS flow_uuid,
    COALESCE(f.name, '(Unknown flow)') AS flow_name,
    fl.lead_uuid,
    CASE
      WHEN ps.uuid IS NULL THEN 'no_stage'
      WHEN NULLIF(TRIM(COALESCE(ps.name, '')), '') IN ('Not Interested', 'Do Not Contact') THEN 'not_interested'
      WHEN NULLIF(TRIM(COALESCE(ps.name, '')), '') = 'Replied - Positive' THEN 'replied_positive'
      WHEN NULLIF(TRIM(COALESCE(ps.name, '')), '') IN ('Replied', 'Replied - Negative') THEN 'replied'
      WHEN NULLIF(TRIM(COALESCE(ps.name, '')), '') IN ('Opportunity', 'Active Opportunity') THEN 'opportunity'
      WHEN NULLIF(TRIM(COALESCE(ps.name, '')), '') = 'Engaging' THEN 'engaging'
      WHEN NULLIF(TRIM(COALESCE(ps.name, '')), '') = 'Approaching' THEN 'approaching'
      ELSE 'other'
    END AS stage_bucket
  FROM public."FlowLeads" fl
  INNER JOIN public."Flows" f
    ON f.uuid = fl.flow_uuid
   AND f.project_id = fl.project_id
  CROSS JOIN pid p
  LEFT JOIN public."Contacts" c
    ON c.uuid::text = fl.lead_uuid
   AND c.project_id = fl.project_id
  LEFT JOIN public."PipelineStages" ps
    ON ps.uuid::text = c.pipeline_stage_uuid::text
   AND ps.project_id = c.project_id
  WHERE p.project_id IS NOT NULL
    AND fl.project_id = p.project_id
),
agg AS (
  SELECT
    e.flow_uuid,
    e.flow_name,
    COUNT(DISTINCT e.lead_uuid)::bigint AS contacts_in_flow_total,
    COUNT(DISTINCT e.lead_uuid) FILTER (WHERE e.stage_bucket = 'approaching')::bigint AS n_approaching,
    COUNT(DISTINCT e.lead_uuid) FILTER (WHERE e.stage_bucket = 'engaging')::bigint AS n_engaging,
    COUNT(DISTINCT e.lead_uuid) FILTER (WHERE e.stage_bucket = 'replied')::bigint AS n_replied,
    COUNT(DISTINCT e.lead_uuid) FILTER (WHERE e.stage_bucket = 'replied_positive')::bigint AS n_replied_positive,
    COUNT(DISTINCT e.lead_uuid) FILTER (WHERE e.stage_bucket = 'opportunity')::bigint AS n_opportunity,
    COUNT(DISTINCT e.lead_uuid) FILTER (WHERE e.stage_bucket = 'not_interested')::bigint AS n_not_interested,
    COUNT(DISTINCT e.lead_uuid) FILTER (WHERE e.stage_bucket = 'other')::bigint AS n_other,
    COUNT(DISTINCT e.lead_uuid) FILTER (WHERE e.stage_bucket = 'no_stage')::bigint AS n_no_stage
  FROM enriched e
  GROUP BY e.flow_uuid, e.flow_name
)
SELECT
  a.flow_name AS "flow_name::multiFilter",
  a.flow_uuid,
  a.contacts_in_flow_total,
  a.n_approaching,
  a.n_engaging,
  a.n_replied,
  a.n_replied_positive,
  a.n_opportunity,
  a.n_not_interested,
  a.n_other,
  a.n_no_stage,
  ROUND(100.0 * a.n_approaching / NULLIF(a.contacts_in_flow_total, 0), 2) AS approaching_rate_pct,
  ROUND(100.0 * a.n_engaging / NULLIF(a.contacts_in_flow_total, 0), 2) AS engaging_rate_pct,
  ROUND(100.0 * a.n_replied / NULLIF(a.contacts_in_flow_total, 0), 2) AS replied_rate_pct,
  ROUND(100.0 * a.n_replied_positive / NULLIF(a.contacts_in_flow_total, 0), 2) AS replied_positive_rate_pct,
  ROUND(100.0 * a.n_opportunity / NULLIF(a.contacts_in_flow_total, 0), 2) AS opportunity_rate_pct,
  ROUND(100.0 * a.n_not_interested / NULLIF(a.contacts_in_flow_total, 0), 2) AS not_interested_rate_pct
FROM agg a
ORDER BY a.flow_name;


-- -----------------------------------------------------------------------------
-- 5) LinkedIn messages — scoped to contacts enrolled in a project flow
-- -----------------------------------------------------------------------------
-- FlowLeads.lead_uuid is the contact key (same as Contacts.uuid; stored text vs uuid — cast).
-- FlowLeads row ties message.lead_uuid to a flow; Contacts adds name/email for operators.
-- Truncates text for table performance; remove LEFT(...) in Redash if full text needed.
WITH pid AS (
  SELECT NULLIF(BTRIM('{{ project_id }}'), '')::uuid AS project_id
)
SELECT
  COALESCE(f.name, '(Unknown flow)') AS "flow_name::multiFilter",
  m.uuid AS message_uuid,
  m.lead_uuid,
  c.uuid AS contact_uuid,
  c.first_name AS contact_first_name,
  c.last_name AS contact_last_name,
  c.email AS contact_email,
  c.linkedin_url AS contact_linkedin_url,
  COALESCE(
    NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''),
    c.email,
    m.lead_uuid::text
  ) AS contact_label,
  COALESCE(m.sent_at, m.created_at) AS message_at,
  m.type,
  m.linkedin_type,
  LEFT(COALESCE(m.text, m.custom_content::text, ''), 500) AS text_preview
FROM public."LinkedinMessages" m
INNER JOIN public."FlowLeads" fl
  ON fl.lead_uuid = m.lead_uuid::text
 AND fl.project_id = m.project_id
LEFT JOIN public."Flows" f
  ON f.uuid = fl.flow_uuid
 AND f.project_id = fl.project_id
LEFT JOIN public."Contacts" c
  ON c.uuid::text = m.lead_uuid::text
 AND c.project_id = m.project_id
CROSS JOIN pid p
WHERE p.project_id IS NOT NULL
  AND m.project_id = p.project_id
ORDER BY COALESCE(m.sent_at, m.created_at) DESC NULLS LAST;


-- =============================================================================
-- Live Redash (instance used for MCP setup, 2026-04-12)
--   Dashboard id 6, slug vt-flow-detail-tables-
--   Queries 46–53. Project dropdown: query 10.
--   Viz: 77 Table (lifecycle), 78 CHART line (daily sends), 79–81 Table (metrics, contacts,
--   messages), 82 Table (flow KPI), 83 Table + 84 stacked + 85 grouped CHARTs (query 52 pipeline),
--   86 Table (query 53 pipeline stage rates).
--   Widgets 62+ (e.g. 68–70 pipeline rollup; 71 = query 53 rates table).
--   After first open: Edit dashboard → Global filters → map **Project** (project_id) to
--   all widgets; add a **multi-filter** on column **flow_name::multiFilter** (link to each
--   widget / use Redash “dashboard filter” UI as for VT / Automation flow funnel).
--   No DateRange on this dashboard.
-- =============================================================================
