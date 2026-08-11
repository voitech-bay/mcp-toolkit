-- Add contact_exclusion_reason to contacts list + richer contacts summary
DROP FUNCTION IF EXISTS public.filter_wellore_contacts(
  text, text, text, text, text, text, text, text, text, text, text, boolean, text, bigint, text, integer, integer, text, text
);

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
  contact_exclusion_reason text,
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
      ct.contact_exclusion_reason,
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
    c.contact_exclusion_reason,
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

GRANT EXECUTE ON FUNCTION public.filter_wellore_contacts(
  text, text, text, text, text, text, text, text, text, text, text, boolean, text, bigint, text, integer, integer, text, text
) TO authenticated, service_role, anon;

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
      'all', count(*)::int,
      'with_email', count(*) FILTER (
        WHERE public.wellore_contact_is_person(ct.source, ct.name, ct.linkedin_url)
          AND nullif(trim(coalesce(ct.email, '')), '') IS NOT NULL
      )::int,
      'eligible', count(*) FILTER (
        WHERE public.wellore_contact_is_person(ct.source, ct.name, ct.linkedin_url)
          AND ct.contact_outreach_eligible IS TRUE
      )::int
    )
    FROM wellore.contacts ct
    JOIN wellore.companies co ON co.id = ct.company_id
    WHERE
      v_pop = 'all'
      OR public.wellore_is_foxdata_company(co.slug, co.source_list)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.wellore_contacts_summary(text) TO authenticated, service_role, anon;
