-- Wellore GTM UI: score on list RPC, geo/domain filters, summary RPCs, hypotheses.brief

DROP FUNCTION IF EXISTS public.filter_wellore_companies(text, text, text, text, text, text, text, text, text, integer, integer, text, text);
DROP FUNCTION IF EXISTS public.filter_wellore_companies(text, text, text, text, text, text, text, text, text, text, text, integer, integer, text, text);

CREATE OR REPLACE FUNCTION public.filter_wellore_companies(
  p_population text DEFAULT 'foxdata',
  p_segment text DEFAULT 'verified',
  p_contact_presence text DEFAULT NULL,
  p_channel_mode text DEFAULT NULL,
  p_disqualification_reason text DEFAULT NULL,
  p_priority_segment text DEFAULT NULL,
  p_source_list text DEFAULT NULL,
  p_recommended_channel text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_hq_country text DEFAULT NULL,
  p_has_domain text DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_sort_by text DEFAULT 'name',
  p_sort_direction text DEFAULT 'asc'
)
RETURNS TABLE(
  id bigint,
  slug text,
  name text,
  domain text,
  website text,
  linkedin_company_url text,
  hq_country text,
  employee_count integer,
  source_list text,
  segment text,
  best_title text,
  released_count integer,
  upcoming_count integer,
  has_hit boolean,
  score_total smallint,
  score jsonb,
  recommended_channel text,
  company_priority_segment text,
  company_segment_reason text,
  disqualification_reason text,
  outreach_eligible_company boolean,
  final_verification_status text,
  identity_verification_status text,
  geo_verification_status text,
  size_verification_status text,
  title_verification_status text,
  contact_search_status text,
  people_count bigint,
  gp_support_count bigint,
  has_verified_email boolean,
  has_linkedin_person boolean,
  channel_mode text,
  contact_presence text,
  title_preview text[],
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'wellore'
AS $$
DECLARE
  v_pop text := lower(trim(coalesce(p_population, 'foxdata')));
  v_seg text := lower(trim(coalesce(p_segment, 'verified')));
  v_presence text := NULLIF(lower(trim(coalesce(p_contact_presence, ''))), '');
  v_channel text := NULLIF(lower(trim(coalesce(p_channel_mode, ''))), '');
  v_search text := NULLIF(trim(coalesce(p_search, '')), '');
  v_asc boolean := lower(coalesce(p_sort_direction, 'asc')) = 'asc';
  v_sort text := CASE lower(coalesce(p_sort_by, 'name'))
    WHEN 'domain' THEN 'domain'
    WHEN 'score_total' THEN 'score_total'
    WHEN 'final_verification_status' THEN 'final_verification_status'
    WHEN 'company_priority_segment' THEN 'company_priority_segment'
    WHEN 'people_count' THEN 'people_count'
    WHEN 'researched_at' THEN 'researched_at'
    ELSE 'name'
  END;
BEGIN
  RETURN QUERY
  WITH contact_agg AS (
    SELECT
      c.company_id,
      count(*) FILTER (
        WHERE public.wellore_contact_is_person(c.source, c.name, c.linkedin_url)
      ) AS people_count,
      count(*) FILTER (
        WHERE public.wellore_contact_is_gp_support(c.source)
      ) AS gp_support_count,
      bool_or(
        public.wellore_contact_is_person(c.source, c.name, c.linkedin_url)
        AND NULLIF(trim(coalesce(c.email, '')), '') IS NOT NULL
      ) AS has_email_person,
      bool_or(
        public.wellore_contact_is_person(c.source, c.name, c.linkedin_url)
        AND c.email_status = 'verified'
        AND NULLIF(trim(coalesce(c.email, '')), '') IS NOT NULL
      ) AS has_verified_email,
      bool_or(
        public.wellore_contact_is_person(c.source, c.name, c.linkedin_url)
        AND NULLIF(trim(coalesce(c.linkedin_url, '')), '') IS NOT NULL
      ) AS has_linkedin_person
    FROM wellore.contacts c
    GROUP BY c.company_id
  ),
  title_agg AS (
    SELECT
      t.company_id,
      (array_agg(t.title ORDER BY t.is_hit DESC NULLS LAST, t.id ASC))[1:5] AS title_preview
    FROM wellore.titles t
    WHERE NULLIF(trim(coalesce(t.title, '')), '') IS NOT NULL
    GROUP BY t.company_id
  ),
  base AS (
    SELECT
      co.id,
      co.slug,
      co.name,
      co.domain,
      co.website,
      co.linkedin_company_url,
      co.hq_country,
      co.employee_count,
      co.source_list,
      co.segment,
      co.best_title,
      co.released_count,
      co.upcoming_count,
      co.has_hit,
      co.score_total,
      co.score,
      co.recommended_channel,
      co.company_priority_segment,
      co.company_segment_reason,
      co.disqualification_reason,
      co.outreach_eligible_company,
      co.final_verification_status,
      co.identity_verification_status,
      co.geo_verification_status,
      co.size_verification_status,
      co.title_verification_status,
      co.contact_search_status,
      co.researched_at,
      coalesce(ca.people_count, 0)::bigint AS people_count,
      coalesce(ca.gp_support_count, 0)::bigint AS gp_support_count,
      coalesce(ca.has_verified_email, false) AS has_verified_email,
      coalesce(ca.has_linkedin_person, false) AS has_linkedin_person,
      CASE
        WHEN coalesce(ca.people_count, 0) > 0
          AND coalesce(ca.has_email_person, false)
          AND coalesce(ca.has_linkedin_person, false)
          THEN 'multi'
        WHEN coalesce(ca.people_count, 0) > 0 AND coalesce(ca.has_email_person, false)
          THEN 'email_only'
        WHEN coalesce(ca.people_count, 0) > 0 AND coalesce(ca.has_linkedin_person, false)
          THEN 'linkedin_only'
        WHEN coalesce(ca.gp_support_count, 0) > 0
          THEN 'gp_support_only'
        ELSE 'none'
      END AS channel_mode,
      CASE
        WHEN coalesce(ca.people_count, 0) > 0 THEN 'people'
        WHEN coalesce(ca.gp_support_count, 0) > 0 THEN 'gp_email_only'
        ELSE 'no_contacts'
      END AS contact_presence,
      coalesce(ta.title_preview, ARRAY[]::text[]) AS title_preview
    FROM wellore.companies co
    LEFT JOIN contact_agg ca ON ca.company_id = co.id
    LEFT JOIN title_agg ta ON ta.company_id = co.id
    WHERE
      (
        v_pop = 'all'
        OR public.wellore_is_foxdata_company(co.slug, co.source_list)
      )
      AND (
        v_seg = 'all'
        OR (
          v_seg = 'verified'
          AND co.final_verification_status IN ('launch_ready_email', 'launch_ready_linkedin')
        )
        OR (
          v_seg = 'disqualified'
          AND coalesce(co.final_verification_status, '') LIKE 'disqualified%'
        )
        OR (
          v_seg = 'backlog'
          AND (
            co.final_verification_status = 'qualified_no_contact_found'
            OR co.final_verification_status IS NULL
          )
        )
      )
      AND (
        v_presence IS NULL
        OR (
          v_presence = 'people' AND coalesce(ca.people_count, 0) > 0
        )
        OR (
          v_presence = 'gp_email_only'
          AND coalesce(ca.people_count, 0) = 0
          AND coalesce(ca.gp_support_count, 0) > 0
        )
        OR (
          v_presence = 'no_contacts'
          AND coalesce(ca.people_count, 0) = 0
          AND coalesce(ca.gp_support_count, 0) = 0
        )
        OR v_presence = 'any'
      )
      AND (
        v_channel IS NULL
        OR CASE
          WHEN coalesce(ca.people_count, 0) > 0
            AND coalesce(ca.has_email_person, false)
            AND coalesce(ca.has_linkedin_person, false)
            THEN 'multi'
          WHEN coalesce(ca.people_count, 0) > 0 AND coalesce(ca.has_email_person, false)
            THEN 'email_only'
          WHEN coalesce(ca.people_count, 0) > 0 AND coalesce(ca.has_linkedin_person, false)
            THEN 'linkedin_only'
          WHEN coalesce(ca.gp_support_count, 0) > 0
            THEN 'gp_support_only'
          ELSE 'none'
        END = v_channel
      )
      AND (
        NULLIF(trim(coalesce(p_disqualification_reason, '')), '') IS NULL
        OR co.disqualification_reason = trim(p_disqualification_reason)
      )
      AND (
        NULLIF(trim(coalesce(p_priority_segment, '')), '') IS NULL
        OR co.company_priority_segment = trim(p_priority_segment)
      )
      AND (
        NULLIF(trim(coalesce(p_source_list, '')), '') IS NULL
        OR co.source_list = trim(p_source_list)
      )
      AND (
        NULLIF(trim(coalesce(p_recommended_channel, '')), '') IS NULL
        OR co.recommended_channel = trim(p_recommended_channel)
      )
      AND (
        NULLIF(trim(coalesce(p_hq_country, '')), '') IS NULL
        OR lower(coalesce(co.hq_country, '')) = lower(trim(p_hq_country))
      )
      AND (
        NULLIF(lower(trim(coalesce(p_has_domain, ''))), '') IS NULL
        OR (
          lower(trim(p_has_domain)) IN ('yes', 'true', '1', 'has')
          AND NULLIF(trim(coalesce(co.domain, '')), '') IS NOT NULL
        )
        OR (
          lower(trim(p_has_domain)) IN ('no', 'false', '0', 'none')
          AND NULLIF(trim(coalesce(co.domain, '')), '') IS NULL
        )
      )
      AND (
        v_search IS NULL
        OR co.name ILIKE '%' || v_search || '%'
        OR coalesce(co.domain, '') ILIKE '%' || v_search || '%'
        OR coalesce(co.slug, '') ILIKE '%' || v_search || '%'
        OR coalesce(co.best_title, '') ILIKE '%' || v_search || '%'
      )
  ),
  counted AS (
    SELECT b.*, count(*) OVER() AS total_count
    FROM base b
  )
  SELECT
    c.id,
    c.slug,
    c.name,
    c.domain,
    c.website,
    c.linkedin_company_url,
    c.hq_country,
    c.employee_count,
    c.source_list,
    c.segment,
    c.best_title,
    c.released_count,
    c.upcoming_count,
    c.has_hit,
    c.score_total,
    c.score,
    c.recommended_channel,
    c.company_priority_segment,
    c.company_segment_reason,
    c.disqualification_reason,
    c.outreach_eligible_company,
    c.final_verification_status,
    c.identity_verification_status,
    c.geo_verification_status,
    c.size_verification_status,
    c.title_verification_status,
    c.contact_search_status,
    c.people_count,
    c.gp_support_count,
    c.has_verified_email,
    c.has_linkedin_person,
    c.channel_mode,
    c.contact_presence,
    c.title_preview,
    c.total_count
  FROM counted c
  ORDER BY
    CASE WHEN NOT v_asc AND v_sort = 'name' THEN c.name END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'name' THEN c.name END ASC NULLS LAST,
    CASE WHEN NOT v_asc AND v_sort = 'domain' THEN c.domain END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'domain' THEN c.domain END ASC NULLS LAST,
    CASE WHEN NOT v_asc AND v_sort = 'score_total' THEN c.score_total END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'score_total' THEN c.score_total END ASC NULLS LAST,
    CASE WHEN NOT v_asc AND v_sort = 'final_verification_status' THEN c.final_verification_status END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'final_verification_status' THEN c.final_verification_status END ASC NULLS LAST,
    CASE WHEN NOT v_asc AND v_sort = 'company_priority_segment' THEN c.company_priority_segment END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'company_priority_segment' THEN c.company_priority_segment END ASC NULLS LAST,
    CASE WHEN NOT v_asc AND v_sort = 'people_count' THEN c.people_count END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'people_count' THEN c.people_count END ASC NULLS LAST,
    CASE WHEN NOT v_asc AND v_sort = 'researched_at' THEN c.researched_at END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'researched_at' THEN c.researched_at END ASC NULLS LAST,
    c.id ASC
  LIMIT greatest(1, least(coalesce(p_limit, 25), 100))
  OFFSET greatest(0, coalesce(p_offset, 0));
END;
$$;

GRANT EXECUTE ON FUNCTION public.filter_wellore_companies(text, text, text, text, text, text, text, text, text, text, text, integer, integer, text, text) TO authenticated, service_role, anon;

-- Readiness / facet summary for Wellore Companies strip + hypothesis cards
CREATE OR REPLACE FUNCTION public.wellore_companies_summary(
  p_population text DEFAULT 'foxdata',
  p_segment text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'wellore'
AS $$
DECLARE
  v_pop text := lower(trim(coalesce(p_population, 'foxdata')));
  v_seg text := lower(trim(coalesce(p_segment, 'all')));
  result jsonb;
BEGIN
  WITH contact_agg AS (
    SELECT
      c.company_id,
      count(*) FILTER (
        WHERE public.wellore_contact_is_person(c.source, c.name, c.linkedin_url)
      ) AS people_count,
      count(*) FILTER (
        WHERE public.wellore_contact_is_gp_support(c.source)
      ) AS gp_support_count,
      count(*) FILTER (
        WHERE public.wellore_contact_is_person(c.source, c.name, c.linkedin_url)
          AND c.email_status = 'verified'
          AND NULLIF(trim(coalesce(c.email, '')), '') IS NOT NULL
      ) AS verified_email_people,
      bool_or(
        public.wellore_contact_is_person(c.source, c.name, c.linkedin_url)
      ) AS has_people,
      bool_or(
        public.wellore_contact_is_gp_support(c.source)
      ) AS has_gp
    FROM wellore.contacts c
    GROUP BY c.company_id
  ),
  base AS (
    SELECT
      co.id,
      co.domain,
      co.hq_country,
      co.source_list,
      co.final_verification_status,
      coalesce(ca.people_count, 0) AS people_count,
      coalesce(ca.gp_support_count, 0) AS gp_support_count,
      coalesce(ca.verified_email_people, 0) AS verified_email_people,
      coalesce(ca.has_people, false) AS has_people,
      coalesce(ca.has_gp, false) AS has_gp,
      CASE
        WHEN coalesce(ca.people_count, 0) > 0 THEN 'people'
        WHEN coalesce(ca.gp_support_count, 0) > 0 THEN 'gp_email_only'
        ELSE 'no_contacts'
      END AS contact_presence
    FROM wellore.companies co
    LEFT JOIN contact_agg ca ON ca.company_id = co.id
    WHERE
      v_pop = 'all'
      OR public.wellore_is_foxdata_company(co.slug, co.source_list)
  ),
  scoped AS (
    SELECT * FROM base b
    WHERE
      v_seg = 'all'
      OR (
        v_seg = 'verified'
        AND b.final_verification_status IN ('launch_ready_email', 'launch_ready_linkedin')
      )
      OR (
        v_seg = 'disqualified'
        AND coalesce(b.final_verification_status, '') LIKE 'disqualified%'
      )
      OR (
        v_seg = 'backlog'
        AND (
          b.final_verification_status = 'qualified_no_contact_found'
          OR b.final_verification_status IS NULL
        )
      )
  ),
  pop AS (
    SELECT * FROM base
  )
  SELECT jsonb_build_object(
    'developers', (SELECT count(*)::int FROM scoped),
    'with_domain', (SELECT count(*)::int FROM scoped WHERE NULLIF(trim(coalesce(domain, '')), '') IS NOT NULL),
    'gp_support_emails', (SELECT coalesce(sum(gp_support_count), 0)::int FROM scoped),
    'named_verified_email_people', (SELECT coalesce(sum(verified_email_people), 0)::int FROM scoped),
    'segments', jsonb_build_object(
      'all', (SELECT count(*)::int FROM pop),
      'verified', (SELECT count(*)::int FROM pop WHERE final_verification_status IN ('launch_ready_email', 'launch_ready_linkedin')),
      'verified_email', (SELECT count(*)::int FROM pop WHERE final_verification_status = 'launch_ready_email'),
      'verified_linkedin', (SELECT count(*)::int FROM pop WHERE final_verification_status = 'launch_ready_linkedin'),
      'disqualified', (SELECT count(*)::int FROM pop WHERE coalesce(final_verification_status, '') LIKE 'disqualified%'),
      'backlog', (SELECT count(*)::int FROM pop WHERE final_verification_status = 'qualified_no_contact_found' OR final_verification_status IS NULL)
    ),
    'contact_presence', jsonb_build_object(
      'people', (SELECT count(*)::int FROM pop WHERE contact_presence = 'people'),
      'gp_email_only', (SELECT count(*)::int FROM pop WHERE contact_presence = 'gp_email_only'),
      'no_contacts', (SELECT count(*)::int FROM pop WHERE contact_presence = 'no_contacts')
    ),
    'facets', jsonb_build_object(
      'geos', coalesce((
        SELECT jsonb_agg(x ORDER BY x)
        FROM (
          SELECT DISTINCT NULLIF(trim(hq_country), '') AS x
          FROM pop
          WHERE NULLIF(trim(hq_country), '') IS NOT NULL
        ) s
      ), '[]'::jsonb),
      'source_lists', coalesce((
        SELECT jsonb_agg(x ORDER BY x)
        FROM (
          SELECT DISTINCT NULLIF(trim(source_list), '') AS x
          FROM pop
          WHERE NULLIF(trim(source_list), '') IS NOT NULL
        ) s
      ), '[]'::jsonb)
    )
  ) INTO result;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.wellore_contacts_summary(
  p_population text DEFAULT 'foxdata'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'wellore'
AS $$
DECLARE
  v_pop text := lower(trim(coalesce(p_population, 'foxdata')));
BEGIN
  RETURN (
    SELECT jsonb_build_object(
      'people', count(*) FILTER (WHERE public.wellore_contact_is_person(ct.source, ct.name, ct.linkedin_url))::int,
      'gp_support', count(*) FILTER (WHERE public.wellore_contact_is_gp_support(ct.source))::int,
      'all', count(*)::int
    )
    FROM wellore.contacts ct
    JOIN wellore.companies co ON co.id = ct.company_id
    WHERE
      v_pop = 'all'
      OR public.wellore_is_foxdata_company(co.slug, co.source_list)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.wellore_companies_summary(text, text) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.wellore_contacts_summary(text) TO authenticated, service_role, anon;

-- Hypothesis SoT brief
ALTER TABLE public.hypotheses ADD COLUMN IF NOT EXISTS brief jsonb;

UPDATE public.hypotheses
SET brief = jsonb_build_object(
  'version', 1,
  'thesis', 'Studios with Google Play pre-registration / wishlist titles in UAE+VN are in a launch window where art, touch UI, and launch content matter — before liveops becomes the default conversation.',
  'who', jsonb_build_object(
    'icp', 'Mobile / multiplat game studios (typically ≤250 employees) with upcoming or pre-reg titles on Google Play',
    'signal', 'FoxData-sourced pre-registration / upcoming titles (UAE + Vietnam runs)',
    'why_now', 'Pre-launch positioning beats liveops cosmetics pitches; verified email/LinkedIn paths are stamped for outreach'
  ),
  'sources', jsonb_build_array(
    jsonb_build_object('name', 'FoxData UAE+VN catalog', 'role', 'population / titles'),
    jsonb_build_object('name', 'Google Play listing signals', 'role', 'pre_register / upcoming'),
    jsonb_build_object('name', 'Prospeo / LinkedIn enrich (n8n WLR)', 'role', 'people + channel stamps')
  ),
  'research', jsonb_build_object(
    'steps', jsonb_build_array(
      'Build FoxData cohort (UAE + VN runs)',
      'Score studios (8 datapoints)',
      'n8n WLR enrich (domain, people, Prospeo, channel stamps)',
      'Verify outreach readiness (email / LinkedIn stamps)',
      'Disqualify / backlog rest of population'
    ),
    'exclusions', jsonb_build_array(
      'Treat already-live GP titles as the primary buying signal',
      'Pitch liveops / seasonal cosmetics as the default ask for pre-reg titles'
    ),
    'historical_note', 'E3 plan 39 (21 email + 18 LinkedIn) → live 34 after five later disqualifications (JOYCITY, Ubisoft Entertainment, Ubisoft Nova ×2, Ironbark). Pocketpair stayed verified via LinkedIn.'
  ),
  'scope', jsonb_build_object(
    'population', 'foxdata',
    'geos', jsonb_build_array('AE', 'VN'),
    'segment_default', 'launch_ready',
    'companies_query', jsonb_build_object(
      'population', 'foxdata',
      'segment', 'verified'
    ),
    'attach_policy', 'foxdata_population'
  ),
  'status', 'active'
)
WHERE id = 'c0ec3d5d-85e3-4c67-941f-7fc58a26ea67';
