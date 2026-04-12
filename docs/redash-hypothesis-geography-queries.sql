-- =============================================================================
-- Redash SQL pack: hypothesis geography (reply rate + connection activity by country)
-- Membership: UNION DISTINCT of (1) tag-based contacts when hypotheses.getsales_tag_uuid
--   matches Contacts.tags or companies.tags (uuid strings in jsonb arrays), and
--   (2) contacts whose company is a hypothesis target (hypothesis_targets → project_companies).
-- Parameters (match VT dashboards):
--   - DateRange: datetime-range → DateRange.start / DateRange.end
--   - project_id: query dropdown (uuid) — use "Projects dropdown" query
--   - hypothesis_id: query dropdown (uuid) — use "VT / Hypotheses dropdown (by project)" query
-- Paste ONE block at a time into Redash (each block is a separate saved query).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: hypotheses for selected project (dropdown source for hypothesis_id)
-- -----------------------------------------------------------------------------
SELECT
  h.id::text AS value,
  h.name AS name
FROM public.hypotheses h
WHERE h.project_id = '{{ project_id }}'::uuid
ORDER BY h.name;


-- -----------------------------------------------------------------------------
-- Main: per-country metrics for hypothesis contacts (maps + table)
-- Choropleth expects ISO 3166-1 alpha-2 in column iso_a2 when using built-in world map.
-- -----------------------------------------------------------------------------
WITH bounds AS (
  SELECT
    ('{{ DateRange.start }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_from,
    ('{{ DateRange.end }}'::timestamptz AT TIME ZONE 'UTC')::date AS d_to
),
hyp AS (
  SELECT
    h.id,
    h.project_id,
    h.getsales_tag_uuid
  FROM public.hypotheses h
  WHERE h.id = '{{ hypothesis_id }}'::uuid
    AND h.project_id = '{{ project_id }}'::uuid
),
tag_path AS (
  SELECT DISTINCT c.uuid
  FROM hyp
  INNER JOIN public."Contacts" c
    ON c.project_id = hyp.project_id
  LEFT JOIN public.companies co
    ON co.id = COALESCE(c.company_uuid, c.company_id)
  WHERE hyp.getsales_tag_uuid IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(COALESCE(c.tags, '[]'::jsonb)) elem
        WHERE lower(trim(elem)) = lower(trim(hyp.getsales_tag_uuid))
      )
      OR (
        co IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(co.tags, '[]'::jsonb)) elem
          WHERE lower(trim(elem)) = lower(trim(hyp.getsales_tag_uuid))
        )
      )
    )
),
company_path AS (
  SELECT DISTINCT c.uuid
  FROM hyp
  INNER JOIN public.hypothesis_targets ht
    ON ht.hypothesis_id = hyp.id
  INNER JOIN public.project_companies pc
    ON pc.id = ht.project_company_id
   AND pc.project_id = hyp.project_id
  INNER JOIN public."Contacts" c
    ON COALESCE(c.company_uuid, c.company_id) = pc.company_id
   AND c.project_id = hyp.project_id
),
hypothesis_contacts AS (
  SELECT uuid FROM tag_path
  UNION
  SELECT uuid FROM company_path
),
country_raw AS (
  SELECT
    hc.uuid AS contact_uuid,
    NULLIF(
      trim(
        both ' '
        FROM COALESCE(
          CASE
            WHEN c.location IS NOT NULL
              AND trim(c.location) <> ''
              AND left(trim(c.location), 1) = '{'
            THEN (c.location::jsonb->>'country')
            ELSE NULL
          END,
          CASE
            WHEN c.raw_address IS NOT NULL AND length(trim(c.raw_address)) > 0
            THEN trim(
              both ' '
              FROM split_part(c.raw_address, ',', array_length(string_to_array(c.raw_address, ','), 1))
            )
            ELSE NULL
          END
        )
      ),
      ''
    ) AS country_name
  FROM hypothesis_contacts hc
  INNER JOIN public."Contacts" c ON c.uuid = hc.uuid
),
iso_map(country_name, iso_a2) AS (
  VALUES
    ('Afghanistan', 'AF'), ('Albania', 'AL'), ('Algeria', 'DZ'), ('Argentina', 'AR'),
    ('Australia', 'AU'), ('Austria', 'AT'), ('Bahrain', 'BH'), ('Bangladesh', 'BD'),
    ('Belarus', 'BY'), ('Belgium', 'BE'), ('Bolivia', 'BO'), ('Brazil', 'BR'),
    ('Bulgaria', 'BG'), ('Canada', 'CA'), ('Chile', 'CL'), ('China', 'CN'),
    ('Colombia', 'CO'), ('Costa Rica', 'CR'), ('Croatia', 'HR'), ('Cyprus', 'CY'),
    ('Czech Republic', 'CZ'), ('Czechia', 'CZ'), ('Denmark', 'DK'), ('Dominican Republic', 'DO'),
    ('Ecuador', 'EC'), ('Egypt', 'EG'), ('Estonia', 'EE'), ('Finland', 'FI'),
    ('France', 'FR'), ('Germany', 'DE'), ('Ghana', 'GH'), ('Greece', 'GR'),
    ('Guatemala', 'GT'), ('Hong Kong', 'HK'), ('Hungary', 'HU'), ('Iceland', 'IS'),
    ('India', 'IN'), ('Indonesia', 'ID'), ('Ireland', 'IE'), ('Israel', 'IL'),
    ('Italy', 'IT'), ('Japan', 'JP'), ('Jordan', 'JO'), ('Kazakhstan', 'KZ'),
    ('Kenya', 'KE'), ('Kuwait', 'KW'), ('Latvia', 'LV'), ('Lebanon', 'LB'),
    ('Lithuania', 'LT'), ('Luxembourg', 'LU'), ('Malaysia', 'MY'), ('Malta', 'MT'),
    ('Mexico', 'MX'), ('Morocco', 'MA'), ('Netherlands', 'NL'), ('New Zealand', 'NZ'),
    ('Nigeria', 'NG'), ('Norway', 'NO'), ('Pakistan', 'PK'), ('Panama', 'PA'),
    ('Peru', 'PE'), ('Philippines', 'PH'), ('Poland', 'PL'), ('Portugal', 'PT'),
    ('Qatar', 'QA'), ('Romania', 'RO'), ('Russia', 'RU'), ('Russian Federation', 'RU'),
    ('Saudi Arabia', 'SA'), ('Serbia', 'RS'), ('Singapore', 'SG'), ('Slovakia', 'SK'),
    ('Slovenia', 'SI'), ('South Africa', 'ZA'), ('South Korea', 'KR'), ('Korea', 'KR'),
    ('Spain', 'ES'), ('Sweden', 'SE'), ('Switzerland', 'CH'), ('Taiwan', 'TW'),
    ('Thailand', 'TH'), ('Turkey', 'TR'), ('Türkiye', 'TR'), ('Ukraine', 'UA'),
    ('United Arab Emirates', 'AE'), ('UAE', 'AE'), ('United Kingdom', 'GB'), ('UK', 'GB'),
    ('United States', 'US'), ('USA', 'US'), ('Uruguay', 'UY'), ('Venezuela', 'VE'),
    ('Vietnam', 'VN'), ('Viet Nam', 'VN')
),
contacts_labeled AS (
  SELECT
    cr.contact_uuid,
    cr.country_name,
    COALESCE(m.iso_a2, 'ZZ') AS iso_a2,
    CASE WHEN m.iso_a2 IS NULL THEN 1 ELSE 0 END AS unknown_country
  FROM country_raw cr
  LEFT JOIN iso_map m ON lower(trim(cr.country_name)) = lower(trim(m.country_name))
),
msg AS (
  SELECT
    m.lead_uuid,
    COUNT(*) FILTER (
      WHERE lower(trim(COALESCE(m.type, ''))) = 'inbox'
        AND (COALESCE(m.sent_at, m.created_at) AT TIME ZONE 'UTC')::date BETWEEN b.d_from AND b.d_to
    ) AS inbox_n,
    COUNT(*) FILTER (
      WHERE lower(trim(COALESCE(m.linkedin_type, ''))) = 'connection_note'
        AND (COALESCE(m.sent_at, m.created_at) AT TIME ZONE 'UTC')::date BETWEEN b.d_from AND b.d_to
    ) AS conn_note_n
  FROM public."LinkedinMessages" m
  CROSS JOIN bounds b
  INNER JOIN hypothesis_contacts hc ON m.lead_uuid = hc.uuid
  WHERE m.project_id = '{{ project_id }}'::uuid
  GROUP BY m.lead_uuid
),
enriched AS (
  SELECT
    cl.contact_uuid,
    cl.country_name,
    cl.iso_a2,
    cl.unknown_country,
    COALESCE(msg.inbox_n, 0) AS inbox_n,
    COALESCE(msg.conn_note_n, 0) AS conn_note_n,
    (COALESCE(msg.inbox_n, 0) > 0) AS has_inbox_in_range,
    NULLIF(regexp_replace(COALESCE(c.connections_number, ''), '[^0-9]', '', 'g'), '')::numeric AS conn_prof
  FROM contacts_labeled cl
  LEFT JOIN msg ON msg.lead_uuid = cl.contact_uuid
  LEFT JOIN public."Contacts" c ON c.uuid = cl.contact_uuid
)
SELECT
  e.iso_a2,
  max(e.country_name) AS country_name,
  count(*)::bigint AS contacts,
  sum(e.unknown_country)::bigint AS unknown_country_rows,
  round(100.0 * count(*) FILTER (WHERE e.has_inbox_in_range)::numeric / nullif(count(*), 0), 2) AS reply_rate_pct,
  sum(e.conn_note_n)::bigint AS connection_notes_total,
  round(sum(e.conn_note_n)::numeric / nullif(count(*), 0), 4) AS avg_connection_notes_per_contact,
  round(avg(e.conn_prof) FILTER (WHERE e.conn_prof IS NOT NULL), 1) AS avg_profile_connections,
  round(avg(e.inbox_n), 2) AS avg_inbox_messages_per_contact
FROM enriched e
GROUP BY e.iso_a2
ORDER BY contacts DESC;


-- -----------------------------------------------------------------------------
-- KPI: total contacts in hypothesis scope (counter widget). Unknown country: use
-- iso_a2 = 'ZZ' row in the main query or SUM(unknown_country_rows) in a pivot.
-- -----------------------------------------------------------------------------
WITH hyp AS (
  SELECT h.id, h.project_id, h.getsales_tag_uuid
  FROM public.hypotheses h
  WHERE h.id = '{{ hypothesis_id }}'::uuid
    AND h.project_id = '{{ project_id }}'::uuid
),
tag_path AS (
  SELECT DISTINCT c.uuid
  FROM hyp
  INNER JOIN public."Contacts" c ON c.project_id = hyp.project_id
  LEFT JOIN public.companies co ON co.id = COALESCE(c.company_uuid, c.company_id)
  WHERE hyp.getsales_tag_uuid IS NOT NULL
    AND (
      EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(c.tags, '[]'::jsonb)) elem
        WHERE lower(trim(elem)) = lower(trim(hyp.getsales_tag_uuid))
      )
      OR (
        co IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(co.tags, '[]'::jsonb)) elem
          WHERE lower(trim(elem)) = lower(trim(hyp.getsales_tag_uuid))
        )
      )
    )
),
company_path AS (
  SELECT DISTINCT c.uuid
  FROM hyp
  INNER JOIN public.hypothesis_targets ht ON ht.hypothesis_id = hyp.id
  INNER JOIN public.project_companies pc ON pc.id = ht.project_company_id AND pc.project_id = hyp.project_id
  INNER JOIN public."Contacts" c ON COALESCE(c.company_uuid, c.company_id) = pc.company_id AND c.project_id = hyp.project_id
),
hypothesis_contacts AS (
  SELECT uuid FROM tag_path UNION SELECT uuid FROM company_path
)
SELECT count(*)::bigint AS hypothesis_contacts_total
FROM hypothesis_contacts;
