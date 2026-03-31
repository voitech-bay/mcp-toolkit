-- =============================================================================
-- Redash SQL pack: LinkedIn no-response rate + response-time distribution
-- Tables: public."LinkedinMessages" + public."Contacts" (project scope)
-- Parameters (match other dashboard queries):
--   - DateRange: datetime-range → DateRange.start / DateRange.end
--   - project_id: query dropdown (uuid)
--
-- Direction uses type, then linkedin_type (same as app: inbox / outbox).
-- Messages are filtered to the UTC date window on COALESCE(sent_at, created_at).
-- Conversations are keyed by COALESCE(linkedin_conversation_uuid, lead) so rows
-- without a conversation id still roll up per lead.
--
-- Paste ONE block at a time into Redash.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) No-response among conversations with outbound in range
--    Definition: ≥1 outbox message in range, 0 inbox in range (same window).
--    Widget: KPI counters + reply rate complement
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
scoped AS (
  SELECT
    m.lead_uuid,
    COALESCE(
      NULLIF(BTRIM(m.linkedin_conversation_uuid), ''),
      'lead:' || m.lead_uuid
    ) AS conversation_key,
    COALESCE(m.sent_at, m.created_at) AS msg_ts,
    LOWER(TRIM(COALESCE(NULLIF(m.type, ''), m.linkedin_type, ''))) AS dir
  FROM public."LinkedinMessages" m
  INNER JOIN public."Contacts" c
    ON c.uuid = m.lead_uuid
   AND c.project_id = m.project_id
  CROSS JOIN bounds b
  WHERE m.project_id = '{{ project_id }}'::uuid
    AND COALESCE(m.sent_at, m.created_at) IS NOT NULL
    AND (COALESCE(m.sent_at, m.created_at) AT TIME ZONE 'UTC')::date BETWEEN b.d_from AND b.d_to
),
by_conv AS (
  SELECT
    conversation_key,
    lead_uuid,
    COUNT(*) FILTER (WHERE dir = 'inbox') AS inbox_n,
    COUNT(*) FILTER (WHERE dir = 'outbox') AS outbox_n
  FROM scoped
  GROUP BY conversation_key, lead_uuid
),
flags AS (
  SELECT
    *,
    (outbox_n > 0 AND inbox_n = 0) AS is_no_response,
    (outbox_n > 0 AND inbox_n > 0) AS has_reply
  FROM by_conv
)
SELECT
  COUNT(*) AS conversations_in_range,
  COUNT(*) FILTER (WHERE outbox_n > 0) AS conversations_with_outbound,
  COUNT(*) FILTER (WHERE is_no_response) AS no_response_count,
  COUNT(*) FILTER (WHERE has_reply) AS replied_count,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE is_no_response)::numeric
    / NULLIF(COUNT(*) FILTER (WHERE outbox_n > 0), 0),
    2
  ) AS no_response_pct_of_outbound
FROM flags;


-- -----------------------------------------------------------------------------
-- 2) Response time (days) — first inbox after first outbox, same conversation
--    Only pairs where both occur in range and first_inbox > first_outbox.
--    Widget: histogram (bucket) or table
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
scoped AS (
  SELECT
    m.lead_uuid,
    COALESCE(
      NULLIF(BTRIM(m.linkedin_conversation_uuid), ''),
      'lead:' || m.lead_uuid
    ) AS conversation_key,
    COALESCE(m.sent_at, m.created_at) AS msg_ts,
    LOWER(TRIM(COALESCE(NULLIF(m.type, ''), m.linkedin_type, ''))) AS dir
  FROM public."LinkedinMessages" m
  INNER JOIN public."Contacts" c
    ON c.uuid = m.lead_uuid
   AND c.project_id = m.project_id
  CROSS JOIN bounds b
  WHERE m.project_id = '{{ project_id }}'::uuid
    AND COALESCE(m.sent_at, m.created_at) IS NOT NULL
    AND (COALESCE(m.sent_at, m.created_at) AT TIME ZONE 'UTC')::date BETWEEN b.d_from AND b.d_to
),
first_out AS (
  SELECT conversation_key, lead_uuid, MIN(msg_ts) AS first_out_ts
  FROM scoped
  WHERE dir = 'outbox'
  GROUP BY conversation_key, lead_uuid
),
first_in AS (
  SELECT conversation_key, lead_uuid, MIN(msg_ts) AS first_in_ts
  FROM scoped
  WHERE dir = 'inbox'
  GROUP BY conversation_key, lead_uuid
),
paired AS (
  SELECT
    o.conversation_key,
    o.lead_uuid,
    o.first_out_ts,
    i.first_in_ts,
    GREATEST(
      0,
      EXTRACT(EPOCH FROM (i.first_in_ts - o.first_out_ts)) / 86400.0
    )::numeric AS days_to_first_inbox
  FROM first_out o
  INNER JOIN first_in i
    ON i.conversation_key = o.conversation_key
   AND i.lead_uuid = o.lead_uuid
  WHERE i.first_in_ts > o.first_out_ts
),
bucketed AS (
  SELECT
    days_to_first_inbox,
    CASE
      WHEN days_to_first_inbox < 1 THEN 1
      WHEN days_to_first_inbox < 2 THEN 2
      WHEN days_to_first_inbox < 3 THEN 3
      WHEN days_to_first_inbox < 7 THEN 4
      WHEN days_to_first_inbox < 14 THEN 5
      ELSE 6
    END AS bucket_ord,
    CASE
      WHEN days_to_first_inbox < 1 THEN '0–<1d'
      WHEN days_to_first_inbox < 2 THEN '1–<2d'
      WHEN days_to_first_inbox < 3 THEN '2–<3d'
      WHEN days_to_first_inbox < 7 THEN '3–<7d'
      WHEN days_to_first_inbox < 14 THEN '7–<14d'
      ELSE '14d+'
    END AS days_bucket
  FROM paired
)
SELECT
  days_bucket,
  COUNT(*) AS conversation_count,
  ROUND(AVG(days_to_first_inbox), 2) AS avg_days_in_bucket,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_to_first_inbox), 2) AS median_days_in_bucket
FROM bucketed
GROUP BY bucket_ord, days_bucket
ORDER BY bucket_ord;


-- -----------------------------------------------------------------------------
-- 3) Response time — summary percentiles (single row)
--    Widget: small table next to the histogram
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
scoped AS (
  SELECT
    m.lead_uuid,
    COALESCE(
      NULLIF(BTRIM(m.linkedin_conversation_uuid), ''),
      'lead:' || m.lead_uuid
    ) AS conversation_key,
    COALESCE(m.sent_at, m.created_at) AS msg_ts,
    LOWER(TRIM(COALESCE(NULLIF(m.type, ''), m.linkedin_type, ''))) AS dir
  FROM public."LinkedinMessages" m
  INNER JOIN public."Contacts" c
    ON c.uuid = m.lead_uuid
   AND c.project_id = m.project_id
  CROSS JOIN bounds b
  WHERE m.project_id = '{{ project_id }}'::uuid
    AND COALESCE(m.sent_at, m.created_at) IS NOT NULL
    AND (COALESCE(m.sent_at, m.created_at) AT TIME ZONE 'UTC')::date BETWEEN b.d_from AND b.d_to
),
first_out AS (
  SELECT conversation_key, lead_uuid, MIN(msg_ts) AS first_out_ts
  FROM scoped
  WHERE dir = 'outbox'
  GROUP BY conversation_key, lead_uuid
),
first_in AS (
  SELECT conversation_key, lead_uuid, MIN(msg_ts) AS first_in_ts
  FROM scoped
  WHERE dir = 'inbox'
  GROUP BY conversation_key, lead_uuid
),
paired AS (
  SELECT
    GREATEST(
      0,
      EXTRACT(EPOCH FROM (i.first_in_ts - o.first_out_ts)) / 86400.0
    )::numeric AS days_to_first_inbox
  FROM first_out o
  INNER JOIN first_in i
    ON i.conversation_key = o.conversation_key
   AND i.lead_uuid = o.lead_uuid
  WHERE i.first_in_ts > o.first_out_ts
)
SELECT
  COUNT(*) AS replied_conversations,
  ROUND(AVG(days_to_first_inbox), 2) AS avg_days,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days_to_first_inbox), 2) AS p50_days,
  ROUND(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY days_to_first_inbox), 2) AS p90_days
FROM paired;
