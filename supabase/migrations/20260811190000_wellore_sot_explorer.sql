-- Wellore SoT explorer: expose verification on wellore_companies + list RPCs.

CREATE OR REPLACE VIEW public.wellore_companies AS
SELECT
  id,
  slug,
  name,
  domain,
  website,
  linkedin_company_url,
  hq_country,
  geo_region,
  employee_count,
  prospeo_status,
  coresignal_company_id,
  level,
  segment,
  source_list,
  released_count,
  upcoming_count,
  has_hit,
  best_title,
  score,
  score_total,
  filters,
  recommended_channel,
  notes,
  researched_at,
  pov,
  legal_name,
  hq_city,
  founded,
  play_developer_id,
  play_developer_url,
  company_priority_segment,
  company_segment_reason,
  disqualification_reason,
  outreach_eligible_company,
  canonical_company_id,
  identity_verification_status,
  geo_verification_status,
  size_verification_status,
  title_verification_status,
  contact_search_status,
  final_verification_status,
  identity_checked_at,
  geo_checked_at,
  size_checked_at,
  title_checked_at,
  contact_checked_at,
  verification_evidence
FROM wellore.companies;

CREATE OR REPLACE VIEW public.wellore_contacts AS
SELECT
  id,
  company_id,
  name,
  title,
  linkedin_url,
  email_status,
  source,
  icp_fit,
  notes,
  contact_segment,
  decision_power,
  contact_segment_reason,
  contact_outreach_eligible,
  contact_exclusion_reason,
  outreach_decision,
  outreach_list,
  outreach_channel,
  routing_reason,
  refresh_run_id,
  refreshed_at,
  verification_status,
  fit,
  role_type,
  fit_reasons,
  email,
  role_fit_status,
  employer_verification_status,
  email_verification_status,
  verification_checked_at,
  verification_evidence
FROM wellore.contacts;

CREATE OR REPLACE FUNCTION public.wellore_contact_is_person(p_source text, p_name text, p_linkedin_url text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    coalesce(p_source, '') IS DISTINCT FROM 'google_play_support_email'
    AND (
      NULLIF(trim(coalesce(p_name, '')), '') IS NOT NULL
      OR NULLIF(trim(coalesce(p_linkedin_url, '')), '') IS NOT NULL
    );
$$;

CREATE OR REPLACE FUNCTION public.wellore_contact_is_gp_support(p_source text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(p_source, '') = 'google_play_support_email';
$$;

CREATE OR REPLACE FUNCTION public.wellore_is_foxdata_company(p_slug text, p_source_list text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    coalesce(p_slug, '') LIKE 'uaefx-%'
    OR coalesce(p_slug, '') LIKE 'vnfx-%'
    OR coalesce(p_source_list, '') ILIKE '%foxdata%'
    OR coalesce(p_source_list, '') ILIKE 'uae-foxdata%'
    OR coalesce(p_source_list, '') ILIKE 'vn-foxdata%';
$$;

DROP FUNCTION IF EXISTS public.filter_wellore_companies(text, text, text, text, text, text, text, text, text, integer, integer, text, text);

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

DROP FUNCTION IF EXISTS public.filter_wellore_contacts(text, text, text, text, text, text, text, text, text, text, text, boolean, text, bigint, text, integer, integer, text, text);

CREATE OR REPLACE FUNCTION public.filter_wellore_contacts(
  p_population text DEFAULT 'foxdata',
  p_company_segment text DEFAULT NULL,
  p_presence text DEFAULT 'people',
  p_source text DEFAULT NULL,
  p_email_status text DEFAULT NULL,
  p_fit text DEFAULT NULL,
  p_icp_fit text DEFAULT NULL,
  p_contact_segment text DEFAULT NULL,
  p_outreach_list text DEFAULT NULL,
  p_outreach_channel text DEFAULT NULL,
  p_outreach_decision text DEFAULT NULL,
  p_eligible boolean DEFAULT NULL,
  p_verification_status text DEFAULT NULL,
  p_company_id bigint DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_sort_by text DEFAULT 'name',
  p_sort_direction text DEFAULT 'asc'
)
RETURNS TABLE(
  id bigint,
  company_id bigint,
  company_name text,
  company_domain text,
  company_final_verification_status text,
  name text,
  title text,
  linkedin_url text,
  email text,
  email_status text,
  source text,
  icp_fit text,
  fit text,
  role_type text,
  contact_segment text,
  decision_power text,
  contact_outreach_eligible boolean,
  outreach_decision text,
  outreach_list text,
  outreach_channel text,
  verification_status text,
  employer_verification_status text,
  email_verification_status text,
  role_fit_status text,
  is_person boolean,
  is_gp_support boolean,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'wellore'
AS $$
DECLARE
  v_pop text := lower(trim(coalesce(p_population, 'foxdata')));
  v_cseg text := NULLIF(lower(trim(coalesce(p_company_segment, ''))), '');
  v_presence text := lower(trim(coalesce(p_presence, 'people')));
  v_search text := NULLIF(trim(coalesce(p_search, '')), '');
  v_asc boolean := lower(coalesce(p_sort_direction, 'asc')) = 'asc';
  v_sort text := CASE lower(coalesce(p_sort_by, 'name'))
    WHEN 'title' THEN 'title'
    WHEN 'company_name' THEN 'company_name'
    WHEN 'source' THEN 'source'
    WHEN 'fit' THEN 'fit'
    WHEN 'email_status' THEN 'email_status'
    WHEN 'outreach_list' THEN 'outreach_list'
    ELSE 'name'
  END;
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT
      ct.id,
      ct.company_id,
      co.name AS company_name,
      co.domain AS company_domain,
      co.final_verification_status AS company_final_verification_status,
      ct.name,
      ct.title,
      ct.linkedin_url,
      ct.email,
      ct.email_status,
      ct.source,
      ct.icp_fit,
      ct.fit,
      ct.role_type,
      ct.contact_segment,
      ct.decision_power,
      ct.contact_outreach_eligible,
      ct.outreach_decision,
      ct.outreach_list,
      ct.outreach_channel,
      ct.verification_status,
      ct.employer_verification_status,
      ct.email_verification_status,
      ct.role_fit_status,
      public.wellore_contact_is_person(ct.source, ct.name, ct.linkedin_url) AS is_person,
      public.wellore_contact_is_gp_support(ct.source) AS is_gp_support
    FROM wellore.contacts ct
    JOIN wellore.companies co ON co.id = ct.company_id
    WHERE
      (p_company_id IS NULL OR ct.company_id = p_company_id)
      AND (
        v_pop = 'all'
        OR public.wellore_is_foxdata_company(co.slug, co.source_list)
      )
      AND (
        v_cseg IS NULL
        OR v_cseg = 'all'
        OR (
          v_cseg = 'verified'
          AND co.final_verification_status IN ('launch_ready_email', 'launch_ready_linkedin')
        )
        OR (
          v_cseg = 'disqualified'
          AND coalesce(co.final_verification_status, '') LIKE 'disqualified%'
        )
        OR (
          v_cseg = 'backlog'
          AND (
            co.final_verification_status = 'qualified_no_contact_found'
            OR co.final_verification_status IS NULL
          )
        )
      )
      AND (
        v_presence = 'all'
        OR (
          v_presence = 'people'
          AND public.wellore_contact_is_person(ct.source, ct.name, ct.linkedin_url)
        )
        OR (
          v_presence = 'gp_support'
          AND public.wellore_contact_is_gp_support(ct.source)
        )
      )
      AND (
        NULLIF(trim(coalesce(p_source, '')), '') IS NULL
        OR ct.source = trim(p_source)
      )
      AND (
        NULLIF(trim(coalesce(p_email_status, '')), '') IS NULL
        OR ct.email_status = trim(p_email_status)
      )
      AND (
        NULLIF(trim(coalesce(p_fit, '')), '') IS NULL
        OR lower(coalesce(ct.fit, '')) = lower(trim(p_fit))
      )
      AND (
        NULLIF(trim(coalesce(p_icp_fit, '')), '') IS NULL
        OR lower(coalesce(ct.icp_fit, '')) = lower(trim(p_icp_fit))
      )
      AND (
        NULLIF(trim(coalesce(p_contact_segment, '')), '') IS NULL
        OR ct.contact_segment = trim(p_contact_segment)
      )
      AND (
        NULLIF(trim(coalesce(p_outreach_list, '')), '') IS NULL
        OR ct.outreach_list = trim(p_outreach_list)
      )
      AND (
        NULLIF(trim(coalesce(p_outreach_channel, '')), '') IS NULL
        OR ct.outreach_channel = trim(p_outreach_channel)
      )
      AND (
        NULLIF(trim(coalesce(p_outreach_decision, '')), '') IS NULL
        OR ct.outreach_decision = trim(p_outreach_decision)
      )
      AND (
        p_eligible IS NULL
        OR ct.contact_outreach_eligible IS NOT DISTINCT FROM p_eligible
      )
      AND (
        NULLIF(trim(coalesce(p_verification_status, '')), '') IS NULL
        OR ct.verification_status = trim(p_verification_status)
      )
      AND (
        v_search IS NULL
        OR coalesce(ct.name, '') ILIKE '%' || v_search || '%'
        OR coalesce(ct.title, '') ILIKE '%' || v_search || '%'
        OR coalesce(ct.email, '') ILIKE '%' || v_search || '%'
        OR coalesce(co.name, '') ILIKE '%' || v_search || '%'
      )
  ),
  counted AS (
    SELECT b.*, count(*) OVER() AS total_count
    FROM base b
  )
  SELECT
    c.id,
    c.company_id,
    c.company_name,
    c.company_domain,
    c.company_final_verification_status,
    c.name,
    c.title,
    c.linkedin_url,
    c.email,
    c.email_status,
    c.source,
    c.icp_fit,
    c.fit,
    c.role_type,
    c.contact_segment,
    c.decision_power,
    c.contact_outreach_eligible,
    c.outreach_decision,
    c.outreach_list,
    c.outreach_channel,
    c.verification_status,
    c.employer_verification_status,
    c.email_verification_status,
    c.role_fit_status,
    c.is_person,
    c.is_gp_support,
    c.total_count
  FROM counted c
  ORDER BY
    CASE WHEN NOT v_asc AND v_sort = 'name' THEN c.name END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'name' THEN c.name END ASC NULLS LAST,
    CASE WHEN NOT v_asc AND v_sort = 'title' THEN c.title END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'title' THEN c.title END ASC NULLS LAST,
    CASE WHEN NOT v_asc AND v_sort = 'company_name' THEN c.company_name END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'company_name' THEN c.company_name END ASC NULLS LAST,
    CASE WHEN NOT v_asc AND v_sort = 'source' THEN c.source END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'source' THEN c.source END ASC NULLS LAST,
    CASE WHEN NOT v_asc AND v_sort = 'fit' THEN c.fit END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'fit' THEN c.fit END ASC NULLS LAST,
    CASE WHEN NOT v_asc AND v_sort = 'email_status' THEN c.email_status END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'email_status' THEN c.email_status END ASC NULLS LAST,
    CASE WHEN NOT v_asc AND v_sort = 'outreach_list' THEN c.outreach_list END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'outreach_list' THEN c.outreach_list END ASC NULLS LAST,
    c.id ASC
  LIMIT greatest(1, least(coalesce(p_limit, 25), 100))
  OFFSET greatest(0, coalesce(p_offset, 0));
END;
$$;

GRANT SELECT ON public.wellore_companies TO authenticated, service_role, anon;
GRANT SELECT ON public.wellore_contacts TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.wellore_contact_is_person(text, text, text) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.wellore_contact_is_gp_support(text) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.wellore_is_foxdata_company(text, text) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.filter_wellore_companies(text, text, text, text, text, text, text, text, text, integer, integer, text, text) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.filter_wellore_contacts(text, text, text, text, text, text, text, text, text, text, text, boolean, text, bigint, text, integer, integer, text, text) TO authenticated, service_role, anon;
