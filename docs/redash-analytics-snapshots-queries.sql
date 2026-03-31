-- =============================================================================
-- Redash SQL pack: AnalyticsSnapshots KPIs, campaign leaderboard, weekly trend,
-- sender leaderboard, active campaigns (Flows), period-over-period KPIs (WoW-style)
-- Tables: public."AnalyticsSnapshots" + LEFT JOIN public."Flows" | public."Senders"
-- Companion (FlowLeads funnel, job titles): docs/redash-flowleads-funnel-icp-queries.sql
-- Parameters (add in Redash query options):
--   - DateRange: type datetime-range, names DateRange.start / DateRange.end
--     Use quoted placeholders below ('{{ DateRange.start }}') so substituted datetimes are valid SQL literals.
--   - project_id: type query (dropdown from Projects) returning uuid as value
-- Metrics keys match LEADS_METRICS_REQUEST_KEYS in src/services/source-api.ts
--
-- Paste ONE block at a time into Redash (each block is a separate saved query).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) KPI strip — single row, sums over the selected range (flows group only)
--    Widget: counter / single-row table
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
daily AS (
  SELECT
    s.snapshot_date,
    s.group_uuid,
    s.metrics,
    EXISTS (
      SELECT 1
      FROM public."AnalyticsSnapshots" t
      CROSS JOIN bounds b
      WHERE t.project_id = '{{ project_id }}'::uuid
        AND t.snapshot_date = s.snapshot_date
        AND t.snapshot_date BETWEEN b.d_from AND b.d_to
        AND t.group_by = 'flows'
        AND t.group_uuid IS NULL
    ) AS has_total_for_day
  FROM public."AnalyticsSnapshots" s
  CROSS JOIN bounds b
  WHERE s.project_id = '{{ project_id }}'::uuid
    AND s.group_by = 'flows'
    AND s.snapshot_date BETWEEN b.d_from AND b.d_to
),
filtered AS (
  SELECT snapshot_date, metrics
  FROM daily
  WHERE (has_total_for_day AND group_uuid IS NULL)
     OR (NOT has_total_for_day AND group_uuid IS NOT NULL)
)
SELECT
  SUM(COALESCE((NULLIF(metrics->>'linkedin_connection_request_sent_count', ''))::bigint, 0))       AS linkedin_connection_request_sent,
  SUM(COALESCE((NULLIF(metrics->>'linkedin_connection_request_accepted_count', ''))::bigint, 0)) AS linkedin_connection_request_accepted,
  SUM(COALESCE((NULLIF(metrics->>'linkedin_sent_count', ''))::bigint, 0))                       AS linkedin_sent,
  SUM(COALESCE((NULLIF(metrics->>'linkedin_opened_count', ''))::bigint, 0))                     AS linkedin_opened,
  SUM(COALESCE((NULLIF(metrics->>'linkedin_inbox_count', ''))::bigint, 0))                       AS linkedin_inbox,
  SUM(COALESCE((NULLIF(metrics->>'linkedin_inmail_sent_count', ''))::bigint, 0))                AS linkedin_inmail_sent,
  SUM(COALESCE((NULLIF(metrics->>'linkedin_inmail_replied_count', ''))::bigint, 0))             AS linkedin_inmail_replied,
  SUM(COALESCE((NULLIF(metrics->>'linkedin_positive_count', ''))::bigint, 0))                   AS linkedin_positive,
  SUM(COALESCE((NULLIF(metrics->>'email_sent_count', ''))::bigint, 0))                          AS email_sent,
  SUM(COALESCE((NULLIF(metrics->>'email_opened_count', ''))::bigint, 0))                       AS email_opened,
  SUM(COALESCE((NULLIF(metrics->>'email_clicked_count', ''))::bigint, 0))                       AS email_clicked,
  SUM(COALESCE((NULLIF(metrics->>'email_bounced_count', ''))::bigint, 0))                       AS email_bounced,
  SUM(COALESCE((NULLIF(metrics->>'email_unsubscribed_count', ''))::bigint, 0))                  AS email_unsubscribed,
  SUM(COALESCE((NULLIF(metrics->>'email_inbox_count', ''))::bigint, 0))                         AS email_inbox,
  SUM(COALESCE((NULLIF(metrics->>'email_positive_count', ''))::bigint, 0))                    AS email_positive,
  CASE WHEN SUM(COALESCE((NULLIF(metrics->>'linkedin_sent_count', ''))::bigint, 0)) > 0
    THEN ROUND(
      100.0 * SUM(COALESCE((NULLIF(metrics->>'linkedin_inbox_count', ''))::bigint, 0))::numeric
      / NULLIF(SUM(COALESCE((NULLIF(metrics->>'linkedin_sent_count', ''))::bigint, 0)), 0),
      2
    )
    ELSE NULL
  END AS linkedin_reply_rate_pct,
  CASE WHEN SUM(COALESCE((NULLIF(metrics->>'email_sent_count', ''))::bigint, 0)) > 0
    THEN ROUND(
      100.0 * SUM(COALESCE((NULLIF(metrics->>'email_inbox_count', ''))::bigint, 0))::numeric
      / NULLIF(SUM(COALESCE((NULLIF(metrics->>'email_sent_count', ''))::bigint, 0)), 0),
      2
    )
    ELSE NULL
  END AS email_reply_rate_pct,
  CASE WHEN SUM(COALESCE((NULLIF(metrics->>'linkedin_connection_request_sent_count', ''))::bigint, 0)) > 0
    THEN ROUND(
      100.0 * SUM(COALESCE((NULLIF(metrics->>'linkedin_connection_request_accepted_count', ''))::bigint, 0))::numeric
      / NULLIF(SUM(COALESCE((NULLIF(metrics->>'linkedin_connection_request_sent_count', ''))::bigint, 0)), 0),
      2
    )
    ELSE NULL
  END AS linkedin_connection_rate_pct
FROM filtered;


-- -----------------------------------------------------------------------------
-- 2) Campaign leaderboard — per flow (and workspace total row when present)
--    Widget: table / bar chart; sort in visualization or add ORDER BY
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
daily AS (
  SELECT
    s.snapshot_date,
    s.group_uuid,
    s.metrics,
    EXISTS (
      SELECT 1
      FROM public."AnalyticsSnapshots" t
      CROSS JOIN bounds b
      WHERE t.project_id = '{{ project_id }}'::uuid
        AND t.snapshot_date = s.snapshot_date
        AND t.snapshot_date BETWEEN b.d_from AND b.d_to
        AND t.group_by = 'flows'
        AND t.group_uuid IS NULL
    ) AS has_total_for_day
  FROM public."AnalyticsSnapshots" s
  CROSS JOIN bounds b
  WHERE s.project_id = '{{ project_id }}'::uuid
    AND s.group_by = 'flows'
    AND s.snapshot_date BETWEEN b.d_from AND b.d_to
),
filtered AS (
  SELECT
    snapshot_date,
    group_uuid,
    metrics,
    CASE
      WHEN group_uuid IS NULL THEN '(Workspace total)'
      ELSE COALESCE(f.name, '(Unknown flow)')
    END AS campaign_label
  FROM daily
  LEFT JOIN public."Flows" f
    ON f.uuid = daily.group_uuid
   AND f.project_id = '{{ project_id }}'::uuid
  WHERE (has_total_for_day AND daily.group_uuid IS NULL)
     OR (NOT has_total_for_day AND daily.group_uuid IS NOT NULL)
)
SELECT
  MAX(campaign_label) AS campaign_label,
  group_uuid,
  SUM(COALESCE((NULLIF(metrics->>'linkedin_connection_request_sent_count', ''))::bigint, 0))       AS linkedin_connection_request_sent,
  SUM(COALESCE((NULLIF(metrics->>'linkedin_connection_request_accepted_count', ''))::bigint, 0)) AS linkedin_connection_request_accepted,
  SUM(COALESCE((NULLIF(metrics->>'linkedin_sent_count', ''))::bigint, 0))                       AS linkedin_sent,
  SUM(COALESCE((NULLIF(metrics->>'linkedin_inbox_count', ''))::bigint, 0))                       AS linkedin_inbox,
  SUM(COALESCE((NULLIF(metrics->>'linkedin_positive_count', ''))::bigint, 0))                   AS linkedin_positive,
  SUM(COALESCE((NULLIF(metrics->>'email_sent_count', ''))::bigint, 0))                          AS email_sent,
  SUM(COALESCE((NULLIF(metrics->>'email_inbox_count', ''))::bigint, 0))                         AS email_inbox,
  CASE WHEN SUM(COALESCE((NULLIF(metrics->>'linkedin_sent_count', ''))::bigint, 0)) > 0
    THEN ROUND(
      100.0 * SUM(COALESCE((NULLIF(metrics->>'linkedin_inbox_count', ''))::bigint, 0))::numeric
      / NULLIF(SUM(COALESCE((NULLIF(metrics->>'linkedin_sent_count', ''))::bigint, 0)), 0),
      2
    )
    ELSE NULL
  END AS linkedin_reply_rate_pct,
  CASE WHEN SUM(COALESCE((NULLIF(metrics->>'linkedin_connection_request_sent_count', ''))::bigint, 0)) > 0
    THEN ROUND(
      100.0 * SUM(COALESCE((NULLIF(metrics->>'linkedin_connection_request_accepted_count', ''))::bigint, 0))::numeric
      / NULLIF(SUM(COALESCE((NULLIF(metrics->>'linkedin_connection_request_sent_count', ''))::bigint, 0)), 0),
      2
    )
    ELSE NULL
  END AS linkedin_connection_rate_pct
FROM filtered
GROUP BY group_uuid
ORDER BY linkedin_sent DESC NULLS LAST;


-- -----------------------------------------------------------------------------
-- 3) Weekly trend — metrics summed by calendar week (Monday start, PostgreSQL)
--    Widget: line or column chart; X = week_start
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
daily AS (
  SELECT
    s.snapshot_date,
    s.group_uuid,
    s.metrics,
    EXISTS (
      SELECT 1
      FROM public."AnalyticsSnapshots" t
      CROSS JOIN bounds b
      WHERE t.project_id = '{{ project_id }}'::uuid
        AND t.snapshot_date = s.snapshot_date
        AND t.snapshot_date BETWEEN b.d_from AND b.d_to
        AND t.group_by = 'flows'
        AND t.group_uuid IS NULL
    ) AS has_total_for_day
  FROM public."AnalyticsSnapshots" s
  CROSS JOIN bounds b
  WHERE s.project_id = '{{ project_id }}'::uuid
    AND s.group_by = 'flows'
    AND s.snapshot_date BETWEEN b.d_from AND b.d_to
),
filtered AS (
  SELECT snapshot_date, metrics
  FROM daily
  WHERE (has_total_for_day AND group_uuid IS NULL)
     OR (NOT has_total_for_day AND group_uuid IS NOT NULL)
),
weekly AS (
  SELECT
    date_trunc('week', snapshot_date::timestamp)::date AS week_start,
    metrics
  FROM filtered
)
SELECT
  week_start,
  SUM(COALESCE((NULLIF(metrics->>'linkedin_connection_request_sent_count', ''))::bigint, 0))       AS linkedin_connection_request_sent,
  SUM(COALESCE((NULLIF(metrics->>'linkedin_connection_request_accepted_count', ''))::bigint, 0)) AS linkedin_connection_request_accepted,
  SUM(COALESCE((NULLIF(metrics->>'linkedin_sent_count', ''))::bigint, 0))                       AS linkedin_sent,
  SUM(COALESCE((NULLIF(metrics->>'linkedin_inbox_count', ''))::bigint, 0))                       AS linkedin_inbox,
  SUM(COALESCE((NULLIF(metrics->>'linkedin_positive_count', ''))::bigint, 0))                   AS linkedin_positive,
  SUM(COALESCE((NULLIF(metrics->>'email_sent_count', ''))::bigint, 0))                          AS email_sent,
  SUM(COALESCE((NULLIF(metrics->>'email_inbox_count', ''))::bigint, 0))                         AS email_inbox
FROM weekly
GROUP BY week_start
ORDER BY week_start;


-- -----------------------------------------------------------------------------
-- 4) Sender leaderboard — per sender profile (and workspace total when present)
--    Widget: table / bar chart; uses group_by = 'sender_profiles' + LEFT JOIN "Senders"
--    Total-only rows: EXISTS uses sender_profiles + group_uuid IS NULL (not flows).
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
daily AS (
  SELECT
    s.snapshot_date,
    s.group_uuid,
    s.metrics,
    EXISTS (
      SELECT 1
      FROM public."AnalyticsSnapshots" t
      CROSS JOIN bounds b
      WHERE t.project_id = '{{ project_id }}'::uuid
        AND t.snapshot_date = s.snapshot_date
        AND t.snapshot_date BETWEEN b.d_from AND b.d_to
        AND t.group_by = 'sender_profiles'
        AND t.group_uuid IS NULL
    ) AS has_total_for_day
  FROM public."AnalyticsSnapshots" s
  CROSS JOIN bounds b
  WHERE s.project_id = '{{ project_id }}'::uuid
    AND s.group_by = 'sender_profiles'
    AND s.snapshot_date BETWEEN b.d_from AND b.d_to
),
filtered AS (
  SELECT
    snapshot_date,
    group_uuid,
    metrics,
    CASE
      WHEN group_uuid IS NULL THEN '(Workspace total)'
      ELSE COALESCE(
        NULLIF(TRIM(se.label), ''),
        NULLIF(TRIM(CONCAT(COALESCE(se.first_name, ''), ' ', COALESCE(se.last_name, ''))), ''),
        '(Unknown sender)'
      )
    END AS sender_label
  FROM daily
  LEFT JOIN public."Senders" se
    ON se.uuid::text = daily.group_uuid
   AND se.project_id = '{{ project_id }}'::uuid
  WHERE (has_total_for_day AND daily.group_uuid IS NULL)
     OR (NOT has_total_for_day AND daily.group_uuid IS NOT NULL)
)
SELECT
  MAX(sender_label) AS sender_label,
  group_uuid,
  SUM(COALESCE((NULLIF(metrics->>'linkedin_connection_request_sent_count', ''))::bigint, 0))       AS linkedin_connection_request_sent,
  SUM(COALESCE((NULLIF(metrics->>'linkedin_connection_request_accepted_count', ''))::bigint, 0)) AS linkedin_connection_request_accepted,
  SUM(COALESCE((NULLIF(metrics->>'linkedin_sent_count', ''))::bigint, 0))                       AS linkedin_sent,
  SUM(COALESCE((NULLIF(metrics->>'linkedin_inbox_count', ''))::bigint, 0))                       AS linkedin_inbox,
  SUM(COALESCE((NULLIF(metrics->>'linkedin_positive_count', ''))::bigint, 0))                   AS linkedin_positive,
  SUM(COALESCE((NULLIF(metrics->>'email_sent_count', ''))::bigint, 0))                          AS email_sent,
  SUM(COALESCE((NULLIF(metrics->>'email_inbox_count', ''))::bigint, 0))                         AS email_inbox,
  CASE WHEN SUM(COALESCE((NULLIF(metrics->>'linkedin_sent_count', ''))::bigint, 0)) > 0
    THEN ROUND(
      100.0 * SUM(COALESCE((NULLIF(metrics->>'linkedin_inbox_count', ''))::bigint, 0))::numeric
      / NULLIF(SUM(COALESCE((NULLIF(metrics->>'linkedin_sent_count', ''))::bigint, 0)), 0),
      2
    )
    ELSE NULL
  END AS linkedin_reply_rate_pct
FROM filtered
GROUP BY group_uuid
ORDER BY linkedin_sent DESC NULLS LAST;


-- -----------------------------------------------------------------------------
-- 5) Active campaigns — current Flows for the project (snapshot; not metrics)
--    Widget: table. DateRange is ignored (kept for global dashboard params).
--    Optional: treat paused/archived as non-active via status filter below.
-- -----------------------------------------------------------------------------
SELECT
  f.name AS campaign_name,
  f.uuid AS flow_uuid,
  f.status,
  f.priority,
  f.updated_at
FROM public."Flows" f
WHERE f.project_id = '{{ project_id }}'::uuid
ORDER BY
  CASE
    WHEN LOWER(COALESCE(f.status, '')) IN ('paused', 'archived', 'stopped', 'off', 'draft')
      THEN 1
    ELSE 0
  END,
  f.name;


-- -----------------------------------------------------------------------------
-- 6) Period-over-period KPIs — current DateRange vs equal-length block immediately before
--    Widget: single-row table (exec). Compares flows aggregate (same total-only rule as block 1).
--    "WoW" in spirit: prior window = [d_from - len, d_from - 1] where len = days in range.
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
win AS (
  SELECT
    d_from,
    d_to,
    (d_to - d_from + 1) AS days_len,
    d_from - (d_to - d_from + 1) AS prev_from,
    d_from - 1 AS prev_to
  FROM bounds
),
daily_curr AS (
  SELECT
    s.snapshot_date,
    s.group_uuid,
    s.metrics,
    EXISTS (
      SELECT 1
      FROM public."AnalyticsSnapshots" t
      CROSS JOIN bounds b
      WHERE t.project_id = '{{ project_id }}'::uuid
        AND t.snapshot_date = s.snapshot_date
        AND t.snapshot_date BETWEEN b.d_from AND b.d_to
        AND t.group_by = 'flows'
        AND t.group_uuid IS NULL
    ) AS has_total_for_day
  FROM public."AnalyticsSnapshots" s
  CROSS JOIN bounds b
  WHERE s.project_id = '{{ project_id }}'::uuid
    AND s.group_by = 'flows'
    AND s.snapshot_date BETWEEN b.d_from AND b.d_to
),
filtered_curr AS (
  SELECT snapshot_date, metrics
  FROM daily_curr
  WHERE (has_total_for_day AND group_uuid IS NULL)
     OR (NOT has_total_for_day AND group_uuid IS NOT NULL)
),
daily_prev AS (
  SELECT
    s.snapshot_date,
    s.group_uuid,
    s.metrics,
    EXISTS (
      SELECT 1
      FROM public."AnalyticsSnapshots" t
      CROSS JOIN win w
      WHERE t.project_id = '{{ project_id }}'::uuid
        AND t.snapshot_date = s.snapshot_date
        AND t.snapshot_date BETWEEN w.prev_from AND w.prev_to
        AND t.group_by = 'flows'
        AND t.group_uuid IS NULL
    ) AS has_total_for_day
  FROM public."AnalyticsSnapshots" s
  CROSS JOIN win w
  WHERE s.project_id = '{{ project_id }}'::uuid
    AND s.group_by = 'flows'
    AND s.snapshot_date BETWEEN w.prev_from AND w.prev_to
),
filtered_prev AS (
  SELECT snapshot_date, metrics
  FROM daily_prev
  WHERE (has_total_for_day AND group_uuid IS NULL)
     OR (NOT has_total_for_day AND group_uuid IS NOT NULL)
),
kpi_curr AS (
  SELECT
    SUM(COALESCE((NULLIF(metrics->>'linkedin_sent_count', ''))::bigint, 0)) AS linkedin_sent,
    SUM(COALESCE((NULLIF(metrics->>'linkedin_inbox_count', ''))::bigint, 0)) AS linkedin_inbox,
    SUM(COALESCE((NULLIF(metrics->>'linkedin_positive_count', ''))::bigint, 0)) AS linkedin_positive,
    SUM(COALESCE((NULLIF(metrics->>'email_sent_count', ''))::bigint, 0)) AS email_sent,
    SUM(COALESCE((NULLIF(metrics->>'email_inbox_count', ''))::bigint, 0)) AS email_inbox
  FROM filtered_curr
),
kpi_prev AS (
  SELECT
    SUM(COALESCE((NULLIF(metrics->>'linkedin_sent_count', ''))::bigint, 0)) AS linkedin_sent,
    SUM(COALESCE((NULLIF(metrics->>'linkedin_inbox_count', ''))::bigint, 0)) AS linkedin_inbox,
    SUM(COALESCE((NULLIF(metrics->>'linkedin_positive_count', ''))::bigint, 0)) AS linkedin_positive,
    SUM(COALESCE((NULLIF(metrics->>'email_sent_count', ''))::bigint, 0)) AS email_sent,
    SUM(COALESCE((NULLIF(metrics->>'email_inbox_count', ''))::bigint, 0)) AS email_inbox
  FROM filtered_prev
)
SELECT
  w.prev_from,
  w.prev_to,
  b.d_from AS curr_from,
  b.d_to AS curr_to,
  COALESCE(c.linkedin_sent, 0) AS curr_linkedin_sent,
  COALESCE(p0.linkedin_sent, 0) AS prev_linkedin_sent,
  COALESCE(c.linkedin_sent, 0) - COALESCE(p0.linkedin_sent, 0) AS delta_linkedin_sent,
  CASE WHEN COALESCE(p0.linkedin_sent, 0) > 0
    THEN ROUND(
      100.0 * (COALESCE(c.linkedin_sent, 0) - COALESCE(p0.linkedin_sent, 0))::numeric / p0.linkedin_sent,
      2
    )
  END AS pct_change_linkedin_sent,
  COALESCE(c.linkedin_inbox, 0) AS curr_linkedin_inbox,
  COALESCE(p0.linkedin_inbox, 0) AS prev_linkedin_inbox,
  COALESCE(c.linkedin_inbox, 0) - COALESCE(p0.linkedin_inbox, 0) AS delta_linkedin_inbox,
  CASE WHEN COALESCE(p0.linkedin_inbox, 0) > 0
    THEN ROUND(
      100.0 * (COALESCE(c.linkedin_inbox, 0) - COALESCE(p0.linkedin_inbox, 0))::numeric / p0.linkedin_inbox,
      2
    )
  END AS pct_change_linkedin_inbox,
  COALESCE(c.linkedin_positive, 0) AS curr_linkedin_positive,
  COALESCE(p0.linkedin_positive, 0) AS prev_linkedin_positive,
  COALESCE(c.email_sent, 0) AS curr_email_sent,
  COALESCE(p0.email_sent, 0) AS prev_email_sent,
  COALESCE(c.email_sent, 0) - COALESCE(p0.email_sent, 0) AS delta_email_sent,
  COALESCE(c.email_inbox, 0) AS curr_email_inbox,
  COALESCE(p0.email_inbox, 0) AS prev_email_inbox,
  COALESCE(c.email_inbox, 0) - COALESCE(p0.email_inbox, 0) AS delta_email_inbox
FROM kpi_curr c
CROSS JOIN kpi_prev p0
CROSS JOIN win w
CROSS JOIN bounds b;
