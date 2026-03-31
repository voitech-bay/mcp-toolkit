-- =============================================================================
-- Redash SQL pack: VT / Automation flow funnel — from AnalyticsSnapshots
--
-- Source: public."AnalyticsSnapshots" rows with group_by = 'sender_profiles' and
-- flow_uuid set (per-flow sync). Metrics JSON keys match LEADS_METRICS_REQUEST_KEYS
-- in src/services/source-api.ts. Values are summed over calendar days in the range
-- and across sender profiles within each flow.
--
-- Stage mapping (GetSales API aggregates — not the same as legacy FlowLead dates):
--   Connection sent     → metrics.linkedin_connection_request_sent_count
--   Connection accepted → metrics.linkedin_connection_request_accepted_count
--   Inbox               → metrics.linkedin_inbox_count
--   Positive replies    → metrics.linkedin_positive_count
--
-- Query 32: one row per (flow, stage) plus a **synthetic series per flow** for charting:
-- **`{FlowName} · % vs sent`** with Total = that flow's **% vs connection sent** (same math as the % column).
-- Count rows use plain **FlowName**; **BaseFlowName** repeats the flow name on every row for dashboard filters.
-- Chart maps FlowName / Status / Total. Filter widgets: **BaseFlowName** (so bars + % lines stay in sync).
--   % vs connection sent: stage count / connection sent × 100 (sent row = 100).
--   % vs previous stage: accepted/sent, inbox/accepted, positive/inbox; NULL on first stage.
-- Query 36: project-wide four rows + same two % columns; FUNNEL viz uses Stage + Value only.
-- Query 39: per calendar day × flow × metric (block 1d); line chart viz 63 over Date range.
-- Query 40: three stage-pair conversion % per flow (block 1e); bar chart viz 65.
--
-- Optional: add Redash parameter flow_uuid (comma-separated UUIDs) and uncomment
-- the flow_pick CTE + AND clauses in snap/flows below. Live Redash query 32 uses the
-- version WITHOUT flow_pick (DateRange + project_id only).
--
-- Parameters: DateRange (datetime-range), project_id (uuid); optional flow_uuid
--
-- Drill-down samples (FlowLeads / LinkedinMessages) remain in blocks 3–5 below.
-- Legacy FlowLead-count funnel (Started / Connected / Replied by row dates) is in
-- the appendix at the bottom for ad-hoc comparison only.
--
-- Paste ONE block at a time into Redash (each block is a separate saved query).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Automation funnel — **by flow × status** (Redash query 32)
-- -----------------------------------------------------------------------------
-- Counts only. Chart viz 50: X=Status, Series=FlowName, Y=Total (grouped bars, left Y).
-- Conversion rates live in query 37 / viz 57.
-- Parameters: DateRange, project_id only. Flow filtering = Redash dashboard multiFilter widget on "flow_name::multiFilter" column.
-- IMPORTANT: always alias the flow name column as "flow_name::multiFilter" (snake_case) so the dashboard filter widget works and stays consistent with other queries.
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
pid AS (
  SELECT NULLIF(BTRIM('{{ project_id }}'), '')::uuid AS project_id
),
snap AS (
  SELECT
    s.flow_uuid,
    s.metrics
  FROM public."AnalyticsSnapshots" s
  CROSS JOIN bounds b
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND s.project_id = p.project_id
    AND s.group_by = 'sender_profiles'
    AND s.flow_uuid IS NOT NULL
    AND s.snapshot_date BETWEEN b.d_from AND b.d_to
),
by_flow AS (
  SELECT
    s.flow_uuid::text AS flow_uuid,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_connection_request_sent_count', ''))::bigint, 0)) AS connections_sent,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_connection_request_accepted_count', ''))::bigint, 0)) AS connections_accepted,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_inbox_count', ''))::bigint, 0)) AS inbox_replies,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_positive_count', ''))::bigint, 0)) AS positive_replies
  FROM snap s
  GROUP BY s.flow_uuid::text
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
joined AS (
  SELECT
    flw.flow_name,
    COALESCE(b.connections_sent, 0)::bigint AS s,
    COALESCE(b.connections_accepted, 0)::bigint AS a,
    COALESCE(b.inbox_replies, 0)::bigint AS ib,
    COALESCE(b.positive_replies, 0)::bigint AS pr
  FROM flows flw
  LEFT JOIN by_flow b ON b.flow_uuid = flw.flow_uuid
)
SELECT
  sub.flow_name AS "flow_name::multiFilter",
  sub.status_label AS "Status",
  sub.metric AS "Total",
  sub.pct_vs_sent AS "% vs connection sent",
  sub.pct_vs_prev AS "% vs previous stage"
FROM (
  SELECT
    j.flow_name,
    v.stage_ord,
    v.status_label,
    v.metric,
    CASE
      WHEN v.status_label = 'Connection sent' THEN 100.0::numeric
      ELSE ROUND(100.0 * v.metric::numeric / NULLIF(j.s, 0), 2)
    END AS pct_vs_sent,
    CASE v.status_label
      WHEN 'Connection sent' THEN NULL::numeric
      WHEN 'Connection accepted' THEN ROUND(100.0 * v.metric::numeric / NULLIF(j.s, 0), 2)
      WHEN 'Inbox' THEN ROUND(100.0 * v.metric::numeric / NULLIF(j.a, 0), 2)
      WHEN 'Positive replies' THEN ROUND(100.0 * v.metric::numeric / NULLIF(j.ib, 0), 2)
    END AS pct_vs_prev
  FROM joined j
  CROSS JOIN LATERAL (
    VALUES
      (1, 'Connection sent', j.s),
      (2, 'Connection accepted', j.a),
      (3, 'Inbox', j.ib),
      (4, 'Positive replies', j.pr)
  ) AS v(stage_ord, status_label, metric)
) sub
ORDER BY sub.stage_ord, sub.flow_name;


-- -----------------------------------------------------------------------------
-- 1b) Automation funnel — **conversion rates by flow** (Redash query 37)
-- -----------------------------------------------------------------------------
-- Line chart viz 57: X=Status (3 stages, Connection sent excluded), Series=FlowName,
-- Y=% vs connection sent. Each flow is one line trending left to right.
-- Parameters: DateRange, project_id only. Flow filtering = Redash dashboard multiFilter widget on "flow_name::multiFilter" column.
-- IMPORTANT: always alias the flow name column as "flow_name::multiFilter" (snake_case) — same as query 32.
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
pid AS (
  SELECT NULLIF(BTRIM('{{ project_id }}'), '')::uuid AS project_id
),
snap AS (
  SELECT
    s.flow_uuid,
    s.metrics
  FROM public."AnalyticsSnapshots" s
  CROSS JOIN bounds b
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND s.project_id = p.project_id
    AND s.group_by = 'sender_profiles'
    AND s.flow_uuid IS NOT NULL
    AND s.snapshot_date BETWEEN b.d_from AND b.d_to
),
by_flow AS (
  SELECT
    s.flow_uuid::text AS flow_uuid,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_connection_request_sent_count', ''))::bigint, 0)) AS connections_sent,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_connection_request_accepted_count', ''))::bigint, 0)) AS connections_accepted,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_inbox_count', ''))::bigint, 0)) AS inbox_replies,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_positive_count', ''))::bigint, 0)) AS positive_replies
  FROM snap s
  GROUP BY s.flow_uuid::text
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
joined AS (
  SELECT
    flw.flow_name,
    COALESCE(b.connections_sent, 0)::bigint AS s,
    COALESCE(b.connections_accepted, 0)::bigint AS a,
    COALESCE(b.inbox_replies, 0)::bigint AS ib,
    COALESCE(b.positive_replies, 0)::bigint AS pr
  FROM flows flw
  LEFT JOIN by_flow b ON b.flow_uuid = flw.flow_uuid
)
SELECT
  sub.flow_name AS "flow_name::multiFilter",
  sub.status_label AS "Status",
  sub.pct_vs_sent AS "% vs connection sent",
  sub.pct_vs_prev AS "% vs previous stage"
FROM (
  SELECT
    j.flow_name,
    v.stage_ord,
    v.status_label,
    CASE
      WHEN v.status_label = 'Connection sent' THEN 100.0::numeric
      ELSE ROUND(100.0 * v.metric::numeric / NULLIF(j.s, 0), 2)
    END AS pct_vs_sent,
    CASE v.status_label
      WHEN 'Connection sent' THEN NULL::numeric
      WHEN 'Connection accepted' THEN ROUND(100.0 * v.metric::numeric / NULLIF(j.s, 0), 2)
      WHEN 'Inbox' THEN ROUND(100.0 * v.metric::numeric / NULLIF(j.a, 0), 2)
      WHEN 'Positive replies' THEN ROUND(100.0 * v.metric::numeric / NULLIF(j.ib, 0), 2)
    END AS pct_vs_prev
  FROM joined j
  CROSS JOIN LATERAL (
    VALUES
      (1, 'Connection sent', j.s),
      (2, 'Connection accepted', j.a),
      (3, 'Inbox', j.ib),
      (4, 'Positive replies', j.pr)
  ) AS v(stage_ord, status_label, metric)
) sub
WHERE sub.status_label <> 'Connection sent'
ORDER BY sub.stage_ord, sub.flow_name;


-- -----------------------------------------------------------------------------
-- 1c) Funnel counts — **per flow × stage** + filtered totals (Redash query 38)
-- -----------------------------------------------------------------------------
-- flow_name::multiFilter only (same as query 32). Table = one row per flow per stage.
-- Chart viz 61 "Totals by stage (filtered)": column chart X=Stage Y=Value — Redash sums
-- duplicate X after the dashboard filter, so you see one bar per stage = total for selected flows.
-- Do not use FUNNEL viz for multi-flow totals (Redash funnel does not aggregate same Stage).
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
pid AS (
  SELECT NULLIF(BTRIM('{{ project_id }}'), '')::uuid AS project_id
),
snap AS (
  SELECT
    s.flow_uuid,
    s.metrics
  FROM public."AnalyticsSnapshots" s
  CROSS JOIN bounds b
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND s.project_id = p.project_id
    AND s.group_by = 'sender_profiles'
    AND s.flow_uuid IS NOT NULL
    AND s.snapshot_date BETWEEN b.d_from AND b.d_to
),
by_flow AS (
  SELECT
    s.flow_uuid::text AS flow_uuid,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_connection_request_sent_count', ''))::bigint, 0))     AS s,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_connection_request_accepted_count', ''))::bigint, 0)) AS a,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_inbox_count', ''))::bigint, 0))                       AS ib,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_positive_count', ''))::bigint, 0))                    AS pr
  FROM snap s
  GROUP BY s.flow_uuid::text
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
joined AS (
  SELECT
    flw.flow_name,
    COALESCE(b.s,  0)::bigint AS s,
    COALESCE(b.a,  0)::bigint AS a,
    COALESCE(b.ib, 0)::bigint AS ib,
    COALESCE(b.pr, 0)::bigint AS pr
  FROM flows flw
  LEFT JOIN by_flow b ON b.flow_uuid = flw.flow_uuid
)
SELECT
  j.flow_name AS "flow_name::multiFilter",
  v.stage_ord AS "stage_ord",
  v.stage     AS "Stage",
  v.value     AS "Value"
FROM joined j
CROSS JOIN LATERAL (
  VALUES
    (1, 'Connection sent',     j.s),
    (2, 'Connection accepted', j.a),
    (3, 'Inbox',               j.ib),
    (4, 'Positive replies',    j.pr)
) AS v(stage_ord, stage, value)
ORDER BY v.stage_ord, j.flow_name;


-- -----------------------------------------------------------------------------
-- 1d) Daily counts by stage — **per day × flow** (Redash query 39)
-- -----------------------------------------------------------------------------
-- One row per (day, flow, metric). flow_name::multiFilter + DateRange + project_id.
-- Chart viz 63: line chart X=day, Series=Metric, Y=Value — four lines; multiple
-- flows selected → Redash sums same day+Metric across rows.
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
pid AS (
  SELECT NULLIF(BTRIM('{{ project_id }}'), '')::uuid AS project_id
),
snap AS (
  SELECT
    s.snapshot_date AS snap_day,
    s.flow_uuid,
    s.metrics
  FROM public."AnalyticsSnapshots" s
  CROSS JOIN bounds b
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND s.project_id = p.project_id
    AND s.group_by = 'sender_profiles'
    AND s.flow_uuid IS NOT NULL
    AND s.snapshot_date BETWEEN b.d_from AND b.d_to
),
by_day_flow AS (
  SELECT
    s.snap_day AS day,
    s.flow_uuid::text AS flow_uuid,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_connection_request_sent_count', ''))::bigint, 0))     AS s,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_connection_request_accepted_count', ''))::bigint, 0)) AS a,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_inbox_count', ''))::bigint, 0))                       AS ib,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_positive_count', ''))::bigint, 0))                    AS pr
  FROM snap s
  GROUP BY s.snap_day, s.flow_uuid::text
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
  b.day AS "day",
  f.flow_name AS "flow_name::multiFilter",
  v.metric AS "Metric",
  v.val::bigint AS "Value"
FROM by_day_flow b
INNER JOIN flows f ON f.flow_uuid = b.flow_uuid
CROSS JOIN LATERAL (
  VALUES
    ('Connections sent', b.s),
    ('Connections accepted', b.a),
    ('Inbox', b.ib),
    ('Positive replies', b.pr)
) AS v(metric, val)
ORDER BY b.day, f.flow_name, v.metric;


-- -----------------------------------------------------------------------------
-- 1e) Stage-to-stage **conversion rates** per flow (Redash query 40)
-- -----------------------------------------------------------------------------
-- Over Date range: sums snapshot counts per flow, then
--   Sent → Accepted   = 100 * accepted / sent
--   Accepted → Inbox  = 100 * inbox / accepted
--   Inbox → Positive  = 100 * positive / inbox
-- flow_name::multiFilter. Chart viz 65: grouped columns (one series per flow;
-- select one flow for exactly three bars).
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
pid AS (
  SELECT NULLIF(BTRIM('{{ project_id }}'), '')::uuid AS project_id
),
snap AS (
  SELECT
    s.flow_uuid,
    s.metrics
  FROM public."AnalyticsSnapshots" s
  CROSS JOIN bounds b
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND s.project_id = p.project_id
    AND s.group_by = 'sender_profiles'
    AND s.flow_uuid IS NOT NULL
    AND s.snapshot_date BETWEEN b.d_from AND b.d_to
),
by_flow AS (
  SELECT
    s.flow_uuid::text AS flow_uuid,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_connection_request_sent_count', ''))::bigint, 0))     AS s,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_connection_request_accepted_count', ''))::bigint, 0)) AS a,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_inbox_count', ''))::bigint, 0))                       AS ib,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_positive_count', ''))::bigint, 0))                    AS pr
  FROM snap s
  GROUP BY s.flow_uuid::text
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
joined AS (
  SELECT
    flw.flow_name,
    COALESCE(b.s,  0)::bigint AS s,
    COALESCE(b.a,  0)::bigint AS a,
    COALESCE(b.ib, 0)::bigint AS ib,
    COALESCE(b.pr, 0)::bigint AS pr
  FROM flows flw
  LEFT JOIN by_flow b ON b.flow_uuid = flw.flow_uuid
)
SELECT
  j.flow_name AS "flow_name::multiFilter",
  v.conv_ord AS "conv_ord",
  v.conversion AS "Conversion",
  v.rate AS "Rate"
FROM joined j
CROSS JOIN LATERAL (
  VALUES
    (1, 'Sent → Accepted',   ROUND(100.0 * j.a::numeric  / NULLIF(j.s,  0), 2)),
    (2, 'Accepted → Inbox',  ROUND(100.0 * j.ib::numeric / NULLIF(j.a,  0), 2)),
    (3, 'Inbox → Positive', ROUND(100.0 * j.pr::numeric / NULLIF(j.ib, 0), 2))
) AS v(conv_ord, conversion, rate)
ORDER BY v.conv_ord, j.flow_name;


-- -----------------------------------------------------------------------------
-- 1-funnel) Project totals — **FUNNEL** viz + table (Redash query 36)
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
pid AS (
  SELECT NULLIF(BTRIM('{{ project_id }}'), '')::uuid AS project_id
),
snap AS (
  SELECT s.metrics
  FROM public."AnalyticsSnapshots" s
  CROSS JOIN bounds b
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND s.project_id = p.project_id
    AND s.group_by = 'sender_profiles'
    AND s.flow_uuid IS NOT NULL
    AND s.snapshot_date BETWEEN b.d_from AND b.d_to
),
totals AS (
  SELECT
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_connection_request_sent_count', ''))::bigint, 0))::bigint AS s,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_connection_request_accepted_count', ''))::bigint, 0))::bigint AS a,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_inbox_count', ''))::bigint, 0))::bigint AS ib,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_positive_count', ''))::bigint, 0))::bigint AS pr
  FROM snap s
),
rows AS (
  SELECT 1 AS ord, 'Connection sent'::text AS stage, t.s AS val FROM totals t
  UNION ALL
  SELECT 2, 'Connection accepted', t.a FROM totals t
  UNION ALL
  SELECT 3, 'Inbox', t.ib FROM totals t
  UNION ALL
  SELECT 4, 'Positive replies', t.pr FROM totals t
)
SELECT
  r.stage AS "Stage",
  r.val AS "Value",
  CASE
    WHEN r.stage = 'Connection sent' THEN 100.0::numeric
    ELSE ROUND(100.0 * r.val::numeric / NULLIF(t.s, 0), 2)
  END AS "% vs connection sent",
  CASE r.stage
    WHEN 'Connection sent' THEN NULL::numeric
    WHEN 'Connection accepted' THEN ROUND(100.0 * r.val::numeric / NULLIF(t.s, 0), 2)
    WHEN 'Inbox' THEN ROUND(100.0 * r.val::numeric / NULLIF(t.a, 0), 2)
    WHEN 'Positive replies' THEN ROUND(100.0 * r.val::numeric / NULLIF(t.ib, 0), 2)
  END AS "% vs previous stage"
FROM rows r
CROSS JOIN totals t
ORDER BY r.ord;


-- -----------------------------------------------------------------------------
-- 1-alt) OPTIONAL — wide table **per flow** (legacy wide layout)
-- -----------------------------------------------------------------------------
/*
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
pid AS (
  SELECT NULLIF(BTRIM('{{ project_id }}'), '')::uuid AS project_id
),
snap AS (
  SELECT s.flow_uuid, s.metrics
  FROM public."AnalyticsSnapshots" s
  CROSS JOIN bounds b
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND s.project_id = p.project_id
    AND s.group_by = 'sender_profiles'
    AND s.flow_uuid IS NOT NULL
    AND s.snapshot_date BETWEEN b.d_from AND b.d_to
),
by_flow AS (
  SELECT
    s.flow_uuid::text AS flow_uuid,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_connection_request_sent_count', ''))::bigint, 0)) AS connections_sent,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_connection_request_accepted_count', ''))::bigint, 0)) AS connections_accepted,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_inbox_count', ''))::bigint, 0)) AS inbox_replies,
    SUM(COALESCE((NULLIF(s.metrics->>'linkedin_positive_count', ''))::bigint, 0)) AS positive_replies
  FROM snap s
  GROUP BY s.flow_uuid::text
),
flows AS (
  SELECT f.uuid::text AS flow_uuid, COALESCE(f.name, '(Unknown flow)') AS flow_name
  FROM public."Flows" f
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL AND f.project_id = p.project_id
)
SELECT
  flw.flow_name AS "FlowName",
  COALESCE(b.connections_sent, 0)::bigint AS "1 Connection sent",
  COALESCE(b.connections_accepted, 0)::bigint AS "2 Connection accepted",
  COALESCE(b.inbox_replies, 0)::bigint AS "3 Inbox",
  COALESCE(b.positive_replies, 0)::bigint AS "4 Positive replies"
FROM flows flw
LEFT JOIN by_flow b ON b.flow_uuid = flw.flow_uuid
ORDER BY COALESCE(b.connections_sent, 0) DESC NULLS LAST;
*/


-- -----------------------------------------------------------------------------
-- 3) Samples — Started: latest FlowLeads in range (LIMIT 20)
--    "campaign_name::multiFilter" = cascade flow filter on result
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
pid AS (
  SELECT NULLIF(BTRIM('{{ project_id }}'), '')::uuid AS project_id
)
SELECT
  fl.created_at,
  fl.flow_uuid,
  COALESCE(f.name, '(Unknown flow)') AS flow_name,
  COALESCE(f.name, '(Unknown flow)') AS "flow_name::multiFilter",
  fl.lead_uuid,
  fl.status,
  COALESCE(
    NULLIF(BTRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''),
    c.email,
    fl.lead_uuid
  ) AS contact_label
FROM public."FlowLeads" fl
CROSS JOIN bounds b
CROSS JOIN pid p
LEFT JOIN public."Flows" f
  ON f.uuid = fl.flow_uuid
 AND f.project_id = fl.project_id
LEFT JOIN public."Contacts" c
  ON c.uuid::text = fl.lead_uuid
 AND c.project_id = fl.project_id
WHERE p.project_id IS NOT NULL
  AND fl.project_id = p.project_id
  AND fl.created_at IS NOT NULL
  AND (fl.created_at AT TIME ZONE 'UTC')::date BETWEEN b.d_from AND b.d_to
ORDER BY fl.created_at DESC
LIMIT 20;


-- -----------------------------------------------------------------------------
-- 4) Samples — Connected: latest connection_note messages in range (LIMIT 20)
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
pid AS (
  SELECT NULLIF(BTRIM('{{ project_id }}'), '')::uuid AS project_id
),
scoped_msgs AS (
  SELECT
    m.uuid AS message_uuid,
    m.lead_uuid,
    COALESCE(m.sent_at, m.created_at) AS msg_ts,
    LEFT(COALESCE(m.text, m.custom_content::text, ''), 200) AS text_preview,
    fl.flow_uuid,
    COALESCE(f.name, '(Unknown flow)') AS flow_name,
    COALESCE(f.name, '(Unknown flow)') AS "flow_name::multiFilter"
  FROM public."LinkedinMessages" m
  INNER JOIN public."FlowLeads" fl
    ON fl.lead_uuid = m.lead_uuid::text
   AND fl.project_id = m.project_id
  CROSS JOIN pid p
  LEFT JOIN public."Flows" f
    ON f.uuid = fl.flow_uuid
   AND f.project_id = fl.project_id
  CROSS JOIN bounds b
  WHERE p.project_id IS NOT NULL
    AND m.project_id = p.project_id
    AND LOWER(TRIM(COALESCE(m.linkedin_type, ''))) = 'connection_note'
    AND COALESCE(m.sent_at, m.created_at) IS NOT NULL
    AND (
      COALESCE(m.sent_at, m.created_at) AT TIME ZONE 'UTC'
    )::date BETWEEN b.d_from AND b.d_to
)
SELECT *
FROM scoped_msgs
ORDER BY msg_ts DESC
LIMIT 20;


-- -----------------------------------------------------------------------------
-- 5) Samples — Replied: first inbox in range per lead (LIMIT 20 latest)
--    Join one FlowLead row per lead to attach campaign; flow filter is post-query.
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
pid AS (
  SELECT NULLIF(BTRIM('{{ project_id }}'), '')::uuid AS project_id
),
first_inbox AS (
  SELECT DISTINCT ON (m.lead_uuid::text)
    m.uuid AS message_uuid,
    m.lead_uuid::text AS lead_uuid,
    COALESCE(m.sent_at, m.created_at) AS msg_ts,
    LEFT(COALESCE(m.text, m.custom_content::text, ''), 200) AS text_preview
  FROM public."LinkedinMessages" m
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND m.project_id = p.project_id
    AND LOWER(TRIM(COALESCE(m.type, ''))) = 'inbox'
    AND COALESCE(m.sent_at, m.created_at) IS NOT NULL
  ORDER BY m.lead_uuid::text, COALESCE(m.sent_at, m.created_at) ASC
),
in_range AS (
  SELECT fi.*
  FROM first_inbox fi
  CROSS JOIN bounds b
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND (fi.msg_ts AT TIME ZONE 'UTC')::date BETWEEN b.d_from AND b.d_to
    AND EXISTS (
      SELECT 1
      FROM public."FlowLeads" fl
      WHERE fl.lead_uuid = fi.lead_uuid
        AND fl.project_id = p.project_id
    )
),
with_flow AS (
  SELECT DISTINCT ON (ir.lead_uuid)
    ir.msg_ts,
    ir.lead_uuid,
    ir.text_preview,
    COALESCE(f.name, '(Unknown flow)') AS flow_name,
    COALESCE(f.name, '(Unknown flow)') AS "flow_name::multiFilter"
  FROM in_range ir
  INNER JOIN public."FlowLeads" fl
    ON fl.lead_uuid = ir.lead_uuid
   AND fl.project_id = NULLIF(BTRIM('{{ project_id }}'), '')::uuid
  LEFT JOIN public."Flows" f
    ON f.uuid = fl.flow_uuid
   AND f.project_id = fl.project_id
  ORDER BY ir.lead_uuid, ir.msg_ts DESC
)
SELECT
  wf.msg_ts,
  wf.lead_uuid,
  wf.text_preview,
  wf.flow_name,
  wf."flow_name::multiFilter",
  COALESCE(
    NULLIF(BTRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), ''),
    c.email,
    wf.lead_uuid
  ) AS contact_label
FROM with_flow wf
LEFT JOIN public."Contacts" c
  ON c.uuid::text = wf.lead_uuid
 AND c.project_id = NULLIF(BTRIM('{{ project_id }}'), '')::uuid
ORDER BY wf.msg_ts DESC
LIMIT 20;


-- -----------------------------------------------------------------------------
-- 6) Optional validation — compare Replied count: type=inbox only vs inbox fallback
--    (Run ad-hoc; not for dashboard widgets.)
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
pid AS (
  SELECT NULLIF(BTRIM('{{ project_id }}'), '')::uuid AS project_id
),
first_strict AS (
  SELECT DISTINCT ON (m.lead_uuid::text)
    m.lead_uuid::text AS lead_uuid,
    COALESCE(m.sent_at, m.created_at) AS msg_ts
  FROM public."LinkedinMessages" m
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND m.project_id = p.project_id
    AND LOWER(TRIM(COALESCE(m.type, ''))) = 'inbox'
    AND COALESCE(m.sent_at, m.created_at) IS NOT NULL
  ORDER BY m.lead_uuid::text, COALESCE(m.sent_at, m.created_at) ASC
),
first_fallback AS (
  SELECT DISTINCT ON (m.lead_uuid::text)
    m.lead_uuid::text AS lead_uuid,
    COALESCE(m.sent_at, m.created_at) AS msg_ts
  FROM public."LinkedinMessages" m
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND m.project_id = p.project_id
    AND LOWER(TRIM(COALESCE(NULLIF(m.type, ''), m.linkedin_type, ''))) = 'inbox'
    AND COALESCE(m.sent_at, m.created_at) IS NOT NULL
  ORDER BY m.lead_uuid::text, COALESCE(m.sent_at, m.created_at) ASC
)
SELECT
  (
    SELECT COUNT(DISTINCT fs.lead_uuid)
    FROM first_strict fs
    CROSS JOIN bounds b
    WHERE (fs.msg_ts AT TIME ZONE 'UTC')::date BETWEEN b.d_from AND b.d_to
      AND EXISTS (
        SELECT 1
        FROM public."FlowLeads" fl
        CROSS JOIN pid p2
        WHERE p2.project_id IS NOT NULL
          AND fl.lead_uuid = fs.lead_uuid
          AND fl.project_id = p2.project_id
      )
  ) AS replied_first_inbox_type_only,
  (
    SELECT COUNT(DISTINCT ff.lead_uuid)
    FROM first_fallback ff
    CROSS JOIN bounds b
    WHERE (ff.msg_ts AT TIME ZONE 'UTC')::date BETWEEN b.d_from AND b.d_to
      AND EXISTS (
        SELECT 1
        FROM public."FlowLeads" fl
        CROSS JOIN pid p2
        WHERE p2.project_id IS NOT NULL
          AND fl.lead_uuid = ff.lead_uuid
          AND fl.project_id = p2.project_id
      )
  ) AS replied_first_inbox_type_or_linkedin_type;


-- =============================================================================
-- APPENDIX — Legacy funnel (FlowLead + message dates): "Started" / "Connected" /
-- "Replied" row counts. Different definitions than GetSales metrics above; use for
-- spot checks only. Not used for dashboard query 32 after migration to snapshots.
-- =============================================================================
/*
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
pid AS (
  SELECT NULLIF(BTRIM('{{ project_id }}'), '')::uuid AS project_id
),
flows AS (
  SELECT
    f.uuid AS flow_uuid,
    COALESCE(f.name, '(Unknown flow)') AS flow_name
  FROM public."Flows" f
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND f.project_id = p.project_id
),
started AS (
  SELECT fl.flow_uuid, COUNT(*)::bigint AS n
  FROM public."FlowLeads" fl
  CROSS JOIN bounds b
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND fl.project_id = p.project_id
    AND fl.created_at IS NOT NULL
    AND (fl.created_at AT TIME ZONE 'UTC')::date BETWEEN b.d_from AND b.d_to
  GROUP BY fl.flow_uuid
),
connected AS (
  SELECT fl.flow_uuid, COUNT(*)::bigint AS n
  FROM public."FlowLeads" fl
  CROSS JOIN bounds b
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
        AND (
          COALESCE(m.sent_at, m.created_at) AT TIME ZONE 'UTC'
        )::date BETWEEN b.d_from AND b.d_to
    )
  GROUP BY fl.flow_uuid
),
first_inbox AS (
  SELECT DISTINCT ON (m.lead_uuid::text)
    m.lead_uuid::text AS lead_uuid,
    COALESCE(m.sent_at, m.created_at) AS msg_ts
  FROM public."LinkedinMessages" m
  CROSS JOIN pid p
  WHERE p.project_id IS NOT NULL
    AND m.project_id = p.project_id
    AND LOWER(TRIM(COALESCE(m.type, ''))) = 'inbox'
    AND COALESCE(m.sent_at, m.created_at) IS NOT NULL
  ORDER BY m.lead_uuid::text, COALESCE(m.sent_at, m.created_at) ASC
),
replied AS (
  SELECT fl.flow_uuid, COUNT(DISTINCT fi.lead_uuid)::bigint AS n
  FROM first_inbox fi
  CROSS JOIN bounds b
  CROSS JOIN pid p
  INNER JOIN public."FlowLeads" fl
    ON fl.lead_uuid = fi.lead_uuid
   AND fl.project_id = p.project_id
  WHERE p.project_id IS NOT NULL
    AND (fi.msg_ts AT TIME ZONE 'UTC')::date BETWEEN b.d_from AND b.d_to
  GROUP BY fl.flow_uuid
)
SELECT
  1 AS sort_order,
  'Started' AS stage,
  COALESCE(s.n, 0) AS metric_value,
  flw.flow_name AS "flow_name::multiFilter"
FROM flows flw
LEFT JOIN started s ON s.flow_uuid = flw.flow_uuid
UNION ALL
SELECT
  2,
  'Connected',
  COALESCE(c.n, 0),
  flw.flow_name AS "flow_name::multiFilter"
FROM flows flw
LEFT JOIN connected c ON c.flow_uuid = flw.flow_uuid
UNION ALL
SELECT
  3,
  'Replied',
  COALESCE(r.n, 0),
  flw.flow_name AS "flow_name::multiFilter"
FROM flows flw
LEFT JOIN replied r ON r.flow_uuid = flw.flow_uuid
ORDER BY 1, 4;
*/
