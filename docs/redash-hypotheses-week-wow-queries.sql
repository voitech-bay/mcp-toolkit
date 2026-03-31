-- =============================================================================
-- Redash SQL pack: hypotheses (targets + FlowLeads) + week / period deltas
-- Tables: public.hypotheses, public.hypothesis_targets, public.project_companies,
--         public."FlowLeads", public."AnalyticsSnapshots"
-- Parameters:
--   - DateRange: datetime-range → DateRange.start / DateRange.end
--   - project_id: query dropdown (uuid)
--
-- Join path: hypothesis → hypothesis_targets → project_companies (same project)
--   → FlowLeads on company_uuid = project_companies.company_id.
-- Period comparison (blocks 3–4): prior window has the same inclusive day count
-- immediately before the selected range (aligns with dual-period WoW).
--
-- Paste ONE block at a time into Redash.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Active hypotheses — counts for the project (no date filter)
--    Widget: KPI tiles
-- -----------------------------------------------------------------------------
SELECT
  COUNT(*)::bigint AS hypotheses_total,
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1
      FROM public.hypothesis_targets ht
      WHERE ht.hypothesis_id = h.id
    )
  )::bigint AS hypotheses_with_targets
FROM public.hypotheses h
WHERE h.project_id = '{{ project_id }}'::uuid;


-- -----------------------------------------------------------------------------
-- 2) Hypothesis leaderboard — FlowLeads in date range per hypothesis
--    (Companies linked to a hypothesis get credit for FlowLeads on that company.)
--    Widget: table / bar chart
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
)
SELECT
  h.id AS hypothesis_id,
  h.name AS hypothesis_name,
  COUNT(fl.uuid) AS flow_leads_in_range
FROM public.hypotheses h
LEFT JOIN public.hypothesis_targets ht
  ON ht.hypothesis_id = h.id
LEFT JOIN public.project_companies pc
  ON pc.id = ht.project_company_id
 AND pc.project_id = h.project_id
LEFT JOIN public."FlowLeads" fl
  ON fl.company_uuid = pc.company_id
 AND fl.project_id = h.project_id
 AND fl.created_at IS NOT NULL
 AND (fl.created_at AT TIME ZONE 'UTC')::date BETWEEN b.d_from AND b.d_to
CROSS JOIN bounds b
WHERE h.project_id = '{{ project_id }}'::uuid
GROUP BY h.id, h.name
ORDER BY flow_leads_in_range DESC, h.name;


-- -----------------------------------------------------------------------------
-- 3) Hypothesis period-over-period — FlowLeads vs prior equal-length window
--    Widget: table (sort by delta); highlights which hypotheses grew
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
periods AS (
  SELECT
    d_from,
    d_to,
    d_from - (d_to - d_from + 1) AS prev_from,
    d_from - 1 AS prev_to
  FROM bounds
),
curr AS (
  SELECT
    h.id AS hypothesis_id,
    COUNT(fl.uuid) AS n
  FROM public.hypotheses h
  LEFT JOIN public.hypothesis_targets ht ON ht.hypothesis_id = h.id
  LEFT JOIN public.project_companies pc
    ON pc.id = ht.project_company_id
   AND pc.project_id = h.project_id
  LEFT JOIN public."FlowLeads" fl
    ON fl.company_uuid = pc.company_id
   AND fl.project_id = h.project_id
   AND fl.created_at IS NOT NULL
   AND (fl.created_at AT TIME ZONE 'UTC')::date BETWEEN b.d_from AND b.d_to
  CROSS JOIN bounds b
  WHERE h.project_id = '{{ project_id }}'::uuid
  GROUP BY h.id
),
prev AS (
  SELECT
    h.id AS hypothesis_id,
    COUNT(fl.uuid) AS n
  FROM public.hypotheses h
  LEFT JOIN public.hypothesis_targets ht ON ht.hypothesis_id = h.id
  LEFT JOIN public.project_companies pc
    ON pc.id = ht.project_company_id
   AND pc.project_id = h.project_id
  LEFT JOIN public."FlowLeads" fl
    ON fl.company_uuid = pc.company_id
   AND fl.project_id = h.project_id
   AND fl.created_at IS NOT NULL
   AND (fl.created_at AT TIME ZONE 'UTC')::date BETWEEN p.prev_from AND p.prev_to
  CROSS JOIN periods p
  WHERE h.project_id = '{{ project_id }}'::uuid
  GROUP BY h.id
)
SELECT
  h.name AS hypothesis_name,
  COALESCE(c.n, 0) AS flow_leads_current,
  COALESCE(pr.n, 0) AS flow_leads_prior,
  COALESCE(c.n, 0) - COALESCE(pr.n, 0) AS flow_leads_delta
FROM public.hypotheses h
LEFT JOIN curr c ON c.hypothesis_id = h.id
LEFT JOIN prev pr ON pr.hypothesis_id = h.id
WHERE h.project_id = '{{ project_id }}'::uuid
ORDER BY flow_leads_delta DESC NULLS LAST, h.name;


-- -----------------------------------------------------------------------------
-- 4) AnalyticsSnapshots — weekly KPIs with previous-week deltas (flows rollup)
--    Uses the same total-vs-per-flow daily dedupe as docs/redash-analytics-snapshots-queries.sql
--    Widget: table or bullet chart (one row per metric)
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
    SUM(COALESCE((NULLIF(metrics->>'linkedin_sent_count', ''))::bigint, 0)) AS linkedin_sent,
    SUM(COALESCE((NULLIF(metrics->>'linkedin_inbox_count', ''))::bigint, 0)) AS linkedin_inbox,
    SUM(COALESCE((NULLIF(metrics->>'linkedin_positive_count', ''))::bigint, 0)) AS linkedin_positive,
    SUM(COALESCE((NULLIF(metrics->>'email_sent_count', ''))::bigint, 0)) AS email_sent,
    SUM(COALESCE((NULLIF(metrics->>'email_inbox_count', ''))::bigint, 0)) AS email_inbox
  FROM filtered
  GROUP BY 1
),
ordered AS (
  SELECT
    week_start,
    linkedin_sent,
    linkedin_inbox,
    linkedin_positive,
    email_sent,
    email_inbox,
    LAG(linkedin_sent) OVER (ORDER BY week_start) AS prev_linkedin_sent,
    LAG(linkedin_inbox) OVER (ORDER BY week_start) AS prev_linkedin_inbox,
    LAG(linkedin_positive) OVER (ORDER BY week_start) AS prev_linkedin_positive,
    LAG(email_sent) OVER (ORDER BY week_start) AS prev_email_sent,
    LAG(email_inbox) OVER (ORDER BY week_start) AS prev_email_inbox
  FROM weekly
)
SELECT
  week_start,
  linkedin_sent,
  linkedin_sent - COALESCE(prev_linkedin_sent, 0) AS linkedin_sent_wow_delta,
  linkedin_inbox,
  linkedin_inbox - COALESCE(prev_linkedin_inbox, 0) AS linkedin_inbox_wow_delta,
  linkedin_positive,
  linkedin_positive - COALESCE(prev_linkedin_positive, 0) AS linkedin_positive_wow_delta,
  email_sent,
  email_sent - COALESCE(prev_email_sent, 0) AS email_sent_wow_delta,
  email_inbox,
  email_inbox - COALESCE(prev_email_inbox, 0) AS email_inbox_wow_delta
FROM ordered
ORDER BY week_start DESC;
