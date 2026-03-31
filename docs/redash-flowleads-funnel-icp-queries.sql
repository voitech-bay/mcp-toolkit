-- =============================================================================
-- Redash SQL pack: FlowLeads funnel + job-title (ICP) breakdown
-- Tables: public."FlowLeads" + LEFT JOIN public."Flows" + LEFT JOIN public."Contacts"
-- (Blocks 4–5 also use public."LinkedinMessages" for reply proxy.)
--
-- VT / Automation flow funnel (GetSales metrics from AnalyticsSnapshots) lives in:
--   docs/redash-automation-flow-funnel-queries.sql
-- Status-based FlowLeads funnels are in this file (blocks 1+).
-- Parameters (add in Redash query options; match other dashboard queries):
--   - DateRange: type datetime-range, names DateRange.start / DateRange.end
--   - project_id: type query (dropdown from Projects) returning uuid as value
--
-- Date scope: rows where flow-lead created_at falls in [d_from, d_to] (UTC date).
-- To use last activity instead, replace fl.created_at with fl.updated_at in the filter.
--
-- Paste ONE block at a time into Redash (each block is a separate saved query).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Flow funnel — status distribution per campaign (flow)
--    Widget: table, bar/stacked bar, or funnel visualization
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
agg AS (
  SELECT
    COALESCE(f.name, '(Unknown flow)') AS campaign_name,
    fl.flow_uuid,
    COALESCE(fl.status, '(no status)') AS status,
    COUNT(*) AS lead_count
  FROM public."FlowLeads" fl
  CROSS JOIN bounds b
  LEFT JOIN public."Flows" f
    ON f.uuid = fl.flow_uuid
   AND f.project_id = fl.project_id
  WHERE fl.project_id = '{{ project_id }}'::uuid
    AND fl.created_at IS NOT NULL
    AND (fl.created_at AT TIME ZONE 'UTC')::date BETWEEN b.d_from AND b.d_to
  GROUP BY f.name, fl.flow_uuid, fl.status
)
SELECT
  campaign_name,
  flow_uuid,
  status,
  lead_count,
  ROUND(
    100.0 * lead_count::numeric / NULLIF(SUM(lead_count) OVER (PARTITION BY flow_uuid), 0),
    2
  ) AS pct_of_campaign
FROM agg
ORDER BY campaign_name, lead_count DESC;


-- -----------------------------------------------------------------------------
-- 2) Job title breakdown — top titles by lead volume (project + date range)
--    Widget: table or bar chart; adjust LIMIT as needed
--    Uses COALESCE(position, title) from Contacts; "(No title)" when missing.
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
labeled AS (
  SELECT
    COALESCE(
      NULLIF(BTRIM(COALESCE(c.position, c.title)), ''),
      '(No title)'
    ) AS job_title,
    fl.uuid
  FROM public."FlowLeads" fl
  CROSS JOIN bounds b
  LEFT JOIN public."Contacts" c
    ON c.uuid::text = fl.lead_uuid
   AND c.project_id = fl.project_id
  WHERE fl.project_id = '{{ project_id }}'::uuid
    AND fl.created_at IS NOT NULL
    AND (fl.created_at AT TIME ZONE 'UTC')::date BETWEEN b.d_from AND b.d_to
)
SELECT
  job_title,
  COUNT(*) AS lead_count
FROM labeled
GROUP BY job_title
ORDER BY lead_count DESC
LIMIT 50;


-- -----------------------------------------------------------------------------
-- 3) Job title × campaign — same as (2) but segmented by flow (optional drill-down)
--    Widget: pivot table or grouped bar
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
labeled AS (
  SELECT
    COALESCE(f.name, '(Unknown flow)') AS campaign_name,
    fl.flow_uuid,
    COALESCE(
      NULLIF(BTRIM(COALESCE(c.position, c.title)), ''),
      '(No title)'
    ) AS job_title,
    fl.uuid
  FROM public."FlowLeads" fl
  CROSS JOIN bounds b
  LEFT JOIN public."Flows" f
    ON f.uuid = fl.flow_uuid
   AND f.project_id = fl.project_id
  LEFT JOIN public."Contacts" c
    ON c.uuid = fl.lead_uuid
   AND c.project_id = fl.project_id
  WHERE fl.project_id = '{{ project_id }}'::uuid
    AND fl.created_at IS NOT NULL
    AND (fl.created_at AT TIME ZONE 'UTC')::date BETWEEN b.d_from AND b.d_to
)
SELECT
  campaign_name,
  flow_uuid,
  job_title,
  COUNT(*) AS lead_count
FROM labeled
GROUP BY campaign_name, flow_uuid, job_title
ORDER BY campaign_name, lead_count DESC;


-- -----------------------------------------------------------------------------
-- 4) Project-wide funnel — status totals (all campaigns combined)
--    Widget: single stacked bar or funnel
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
)
SELECT
  COALESCE(fl.status, '(no status)') AS status,
  COUNT(*) AS lead_count,
  ROUND(
    100.0 * COUNT(*)::numeric / NULLIF(SUM(COUNT(*)) OVER (), 0),
    2
  ) AS pct_of_project
FROM public."FlowLeads" fl
CROSS JOIN bounds b
WHERE fl.project_id = '{{ project_id }}'::uuid
  AND fl.created_at IS NOT NULL
  AND (fl.created_at AT TIME ZONE 'UTC')::date BETWEEN b.d_from AND b.d_to
GROUP BY fl.status
ORDER BY lead_count DESC;


-- -----------------------------------------------------------------------------
-- 5) Job title — leads with ≥1 LinkedIn inbox message in range (reply proxy)
--    Widget: bar chart; compare with block 2 (volume-only) for “who replies”
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
labeled AS (
  SELECT
    COALESCE(
      NULLIF(BTRIM(COALESCE(c.position, c.title)), ''),
      '(No title)'
    ) AS job_title,
    fl.uuid,
    EXISTS (
      SELECT 1
      FROM public."LinkedinMessages" m
      WHERE m.lead_uuid = fl.lead_uuid
        AND m.project_id = fl.project_id
        AND LOWER(TRIM(COALESCE(NULLIF(m.type, ''), m.linkedin_type, ''))) = 'inbox'
        AND COALESCE(m.sent_at, m.created_at) IS NOT NULL
        AND (COALESCE(m.sent_at, m.created_at) AT TIME ZONE 'UTC')::date BETWEEN b.d_from AND b.d_to
    ) AS has_inbox_in_range
  FROM public."FlowLeads" fl
  CROSS JOIN bounds b
  LEFT JOIN public."Contacts" c
    ON c.uuid = fl.lead_uuid
   AND c.project_id = fl.project_id
  WHERE fl.project_id = '{{ project_id }}'::uuid
    AND fl.created_at IS NOT NULL
    AND (fl.created_at AT TIME ZONE 'UTC')::date BETWEEN b.d_from AND b.d_to
)
SELECT
  job_title,
  COUNT(*) FILTER (WHERE has_inbox_in_range) AS leads_with_inbox_reply,
  COUNT(*) AS leads_total_in_range,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE has_inbox_in_range)::numeric / NULLIF(COUNT(*), 0),
    2
  ) AS pct_leads_with_inbox_reply
FROM labeled
GROUP BY job_title
ORDER BY leads_with_inbox_reply DESC
LIMIT 50;
