-- Filter helpers for Companies/Contacts list outreach filters.
-- LinkedIn vs Email enrollment is inferred from Flows.name (GetSales has both LI and email flows).
-- Email also includes Contacts.email_sent_count > 0 (GetSales/Smartlead markers).

CREATE OR REPLACE FUNCTION public.flow_is_email_channel(p_name text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    p_name IS NOT NULL
    AND lower(p_name) ~ '(e-?mails?)'
    AND lower(p_name) !~ 'inmails?'
    AND lower(p_name) !~ 'no[[:space:]]+e-?mail';
$$;

CREATE OR REPLACE FUNCTION public.outreach_enrollment_statuses(p_bucket text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(p_bucket, ''))
    WHEN 'enrolled' THEN ARRAY['in_progress','ready','restarted','need_enrichment','active_limit','failed']
    WHEN 'finished' THEN ARRAY['finished']
    WHEN 'paused' THEN ARRAY['paused']
    ELSE ARRAY[]::text[]
  END;
$$;

CREATE OR REPLACE FUNCTION public.filter_project_contact_ids(
  p_project_id uuid,
  p_linkedin_outreach text DEFAULT NULL,
  p_email_outreach text DEFAULT NULL,
  p_reply_status text DEFAULT NULL,
  p_connection_status text DEFAULT NULL,
  p_list_uuid uuid DEFAULT NULL,
  p_position text DEFAULT NULL,
  p_work_email text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_sort_by text DEFAULT 'created_at',
  p_sort_direction text DEFAULT 'desc'
)
RETURNS TABLE(
  uuid uuid,
  first_name text,
  last_name text,
  name text,
  "position" text,
  avatar_url text,
  company_name text,
  work_email text,
  email text,
  company_uuid uuid,
  project_id uuid,
  created_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_search text := NULLIF(trim(coalesce(p_search, '')), '');
  v_sort text := CASE lower(coalesce(p_sort_by, 'created_at'))
    WHEN 'first_name' THEN 'first_name'
    WHEN 'last_name' THEN 'last_name'
    WHEN 'position' THEN 'position'
    WHEN 'work_email' THEN 'work_email'
    WHEN 'company_name' THEN 'company_name'
    WHEN 'location' THEN 'location'
    ELSE 'created_at'
  END;
  v_asc boolean := lower(coalesce(p_sort_direction, 'desc')) = 'asc';
  v_li text := NULLIF(lower(trim(coalesce(p_linkedin_outreach, ''))), '');
  v_em text := NULLIF(lower(trim(coalesce(p_email_outreach, ''))), '');
  v_reply text := NULLIF(lower(trim(coalesce(p_reply_status, ''))), '');
  v_conn text := NULLIF(lower(trim(coalesce(p_connection_status, ''))), '');
BEGIN
  RETURN QUERY
  WITH base AS (
    SELECT c.*
    FROM public."Contacts" c
    WHERE c.project_id = p_project_id
      AND (p_list_uuid IS NULL OR c.list_uuid = p_list_uuid)
      AND (NULLIF(trim(coalesce(p_position, '')), '') IS NULL OR c."position" = trim(p_position))
      AND (NULLIF(trim(coalesce(p_work_email, '')), '') IS NULL OR c.work_email = trim(p_work_email))
      AND (
        v_search IS NULL
        OR c.first_name ILIKE '%' || v_search || '%'
        OR c.last_name ILIKE '%' || v_search || '%'
        OR c.name ILIKE '%' || v_search || '%'
        OR c."position" ILIKE '%' || v_search || '%'
        OR c.work_email ILIKE '%' || v_search || '%'
        OR c.company_name ILIKE '%' || v_search || '%'
      )
      AND (
        v_conn IS NULL
        OR (v_conn = 'accepted' AND c.gs_connection_accepted_at IS NOT NULL)
        OR (
          v_conn = 'withdrawn'
          AND c.gs_connection_lost_at IS NOT NULL
          AND c.gs_connection_accepted_at IS NULL
        )
        OR (
          v_conn = 'sent'
          AND c.gs_connection_sent_at IS NOT NULL
          AND c.gs_connection_accepted_at IS NULL
          AND c.gs_connection_lost_at IS NULL
        )
        OR (
          v_conn = 'none'
          AND c.gs_connection_sent_at IS NULL
          AND c.gs_connection_accepted_at IS NULL
          AND c.gs_connection_lost_at IS NULL
        )
      )
      AND (
        v_reply IS NULL
        OR (
          v_reply = 'positive'
          AND EXISTS (
            SELECT 1 FROM public."PipelineStages" ps
            WHERE ps.uuid = c.pipeline_stage_uuid::text
              AND (
                lower(ps.name) LIKE '%replied - positive%'
                OR (lower(coalesce(ps.category, '')) = 'positive' AND lower(ps.name) LIKE '%replied%')
              )
          )
        )
        OR (
          v_reply = 'negative'
          AND EXISTS (
            SELECT 1 FROM public."PipelineStages" ps
            WHERE ps.uuid = c.pipeline_stage_uuid::text
              AND (
                lower(ps.name) LIKE '%replied - negative%'
                OR (lower(coalesce(ps.category, '')) = 'negative' AND lower(ps.name) LIKE '%replied%')
              )
          )
        )
        OR (
          v_reply = 'neutral'
          AND EXISTS (
            SELECT 1 FROM public."PipelineStages" ps
            WHERE ps.uuid = c.pipeline_stage_uuid::text
              AND lower(trim(ps.name)) = 'replied'
          )
        )
        OR (
          v_reply = 'no_reply'
          AND (
            c.pipeline_stage_uuid IS NULL
            OR EXISTS (
              SELECT 1 FROM public."PipelineStages" ps
              WHERE ps.uuid = c.pipeline_stage_uuid::text
                AND lower(ps.name) NOT LIKE '%replied%'
            )
          )
          AND coalesce(c.email_inbox_count, 0) = 0
          AND NOT EXISTS (
            SELECT 1 FROM public."LinkedinMessages" m
            WHERE m.lead_uuid = c.uuid AND m.type = 'inbox'
          )
        )
      )
      AND (
        v_li IS NULL
        OR (
          v_li = 'enrolled'
          AND EXISTS (
            SELECT 1
            FROM public."FlowLeads" fl
            JOIN public."Flows" f ON f.uuid = fl.flow_uuid
            WHERE fl.project_id = p_project_id
              AND fl.lead_uuid = c.uuid::text
              AND NOT public.flow_is_email_channel(f.name)
              AND fl.status = ANY (public.outreach_enrollment_statuses('enrolled'))
          )
        )
        OR (
          v_li = 'finished'
          AND EXISTS (
            SELECT 1
            FROM public."FlowLeads" fl
            JOIN public."Flows" f ON f.uuid = fl.flow_uuid
            WHERE fl.project_id = p_project_id
              AND fl.lead_uuid = c.uuid::text
              AND NOT public.flow_is_email_channel(f.name)
              AND fl.status = ANY (public.outreach_enrollment_statuses('finished'))
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public."FlowLeads" fl
            JOIN public."Flows" f ON f.uuid = fl.flow_uuid
            WHERE fl.project_id = p_project_id
              AND fl.lead_uuid = c.uuid::text
              AND NOT public.flow_is_email_channel(f.name)
              AND fl.status = ANY (public.outreach_enrollment_statuses('enrolled'))
          )
        )
        OR (
          v_li = 'paused'
          AND EXISTS (
            SELECT 1
            FROM public."FlowLeads" fl
            JOIN public."Flows" f ON f.uuid = fl.flow_uuid
            WHERE fl.project_id = p_project_id
              AND fl.lead_uuid = c.uuid::text
              AND NOT public.flow_is_email_channel(f.name)
              AND fl.status = ANY (public.outreach_enrollment_statuses('paused'))
          )
        )
        OR (
          v_li = 'not_enrolled'
          AND NOT EXISTS (
            SELECT 1
            FROM public."FlowLeads" fl
            JOIN public."Flows" f ON f.uuid = fl.flow_uuid
            WHERE fl.project_id = p_project_id
              AND fl.lead_uuid = c.uuid::text
              AND NOT public.flow_is_email_channel(f.name)
              AND fl.status IS DISTINCT FROM 'canceled'
          )
        )
      )
      AND (
        v_em IS NULL
        OR (
          v_em = 'enrolled'
          AND (
            coalesce(c.email_sent_count, 0) > 0
            OR EXISTS (
              SELECT 1
              FROM public."FlowLeads" fl
              JOIN public."Flows" f ON f.uuid = fl.flow_uuid
              WHERE fl.project_id = p_project_id
                AND fl.lead_uuid = c.uuid::text
                AND public.flow_is_email_channel(f.name)
                AND fl.status = ANY (public.outreach_enrollment_statuses('enrolled'))
            )
          )
        )
        OR (
          v_em = 'finished'
          AND EXISTS (
            SELECT 1
            FROM public."FlowLeads" fl
            JOIN public."Flows" f ON f.uuid = fl.flow_uuid
            WHERE fl.project_id = p_project_id
              AND fl.lead_uuid = c.uuid::text
              AND public.flow_is_email_channel(f.name)
              AND fl.status = ANY (public.outreach_enrollment_statuses('finished'))
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public."FlowLeads" fl
            JOIN public."Flows" f ON f.uuid = fl.flow_uuid
            WHERE fl.project_id = p_project_id
              AND fl.lead_uuid = c.uuid::text
              AND public.flow_is_email_channel(f.name)
              AND fl.status = ANY (public.outreach_enrollment_statuses('enrolled'))
          )
        )
        OR (
          v_em = 'paused'
          AND EXISTS (
            SELECT 1
            FROM public."FlowLeads" fl
            JOIN public."Flows" f ON f.uuid = fl.flow_uuid
            WHERE fl.project_id = p_project_id
              AND fl.lead_uuid = c.uuid::text
              AND public.flow_is_email_channel(f.name)
              AND fl.status = ANY (public.outreach_enrollment_statuses('paused'))
          )
        )
        OR (
          v_em = 'not_enrolled'
          AND coalesce(c.email_sent_count, 0) = 0
          AND NOT EXISTS (
            SELECT 1
            FROM public."FlowLeads" fl
            JOIN public."Flows" f ON f.uuid = fl.flow_uuid
            WHERE fl.project_id = p_project_id
              AND fl.lead_uuid = c.uuid::text
              AND public.flow_is_email_channel(f.name)
              AND fl.status IS DISTINCT FROM 'canceled'
          )
        )
      )
  ),
  counted AS (
    SELECT b.*, count(*) OVER() AS total_count
    FROM base b
  )
  SELECT
    c.uuid,
    c.first_name,
    c.last_name,
    c.name,
    c."position",
    c.avatar_url,
    c.company_name,
    c.work_email,
    c.email,
    c.company_uuid,
    c.project_id,
    c.created_at,
    c.total_count
  FROM counted c
  ORDER BY
    CASE WHEN NOT v_asc AND v_sort = 'created_at' THEN c.created_at END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'created_at' THEN c.created_at END ASC NULLS LAST,
    CASE WHEN NOT v_asc AND v_sort = 'first_name' THEN c.first_name END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'first_name' THEN c.first_name END ASC NULLS LAST,
    CASE WHEN NOT v_asc AND v_sort = 'last_name' THEN c.last_name END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'last_name' THEN c.last_name END ASC NULLS LAST,
    CASE WHEN NOT v_asc AND v_sort = 'position' THEN c."position" END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'position' THEN c."position" END ASC NULLS LAST,
    CASE WHEN NOT v_asc AND v_sort = 'work_email' THEN c.work_email END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'work_email' THEN c.work_email END ASC NULLS LAST,
    CASE WHEN NOT v_asc AND v_sort = 'company_name' THEN c.company_name END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'company_name' THEN c.company_name END ASC NULLS LAST,
    c.uuid ASC
  LIMIT greatest(1, least(coalesce(p_limit, 25), 100))
  OFFSET greatest(0, coalesce(p_offset, 0));
END;
$$;

CREATE OR REPLACE FUNCTION public.filter_project_company_ids_by_outreach(
  p_project_id uuid,
  p_linkedin_outreach text DEFAULT NULL,
  p_email_outreach text DEFAULT NULL,
  p_reply_status text DEFAULT NULL,
  p_connection_status text DEFAULT NULL,
  p_list_uuid uuid DEFAULT NULL,
  p_search_pattern text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_employees_range text DEFAULT NULL,
  p_hypothesis_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0,
  p_sort_by text DEFAULT 'created_at',
  p_sort_direction text DEFAULT 'desc'
)
RETURNS TABLE(pc_id uuid, company_id uuid, total_count bigint)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_sort text := CASE lower(coalesce(p_sort_by, 'created_at'))
    WHEN 'name' THEN 'name'
    WHEN 'domain' THEN 'domain'
    WHEN 'industry' THEN 'industry'
    WHEN 'employees_range' THEN 'employees_range'
    WHEN 'status' THEN 'status'
    ELSE 'created_at'
  END;
  v_asc boolean := lower(coalesce(p_sort_direction, 'desc')) = 'asc';
  v_li text := NULLIF(lower(trim(coalesce(p_linkedin_outreach, ''))), '');
  v_em text := NULLIF(lower(trim(coalesce(p_email_outreach, ''))), '');
  v_reply text := NULLIF(lower(trim(coalesce(p_reply_status, ''))), '');
  v_conn text := NULLIF(lower(trim(coalesce(p_connection_status, ''))), '');
  v_has_outreach boolean := v_li IS NOT NULL OR v_em IS NOT NULL OR v_reply IS NOT NULL OR v_conn IS NOT NULL;
BEGIN
  RETURN QUERY
  WITH matching_companies AS (
    SELECT DISTINCT c.company_uuid AS company_id
    FROM public."Contacts" c
    WHERE c.project_id = p_project_id
      AND c.company_uuid IS NOT NULL
      AND (p_list_uuid IS NULL OR c.list_uuid = p_list_uuid)
      AND (
        v_conn IS NULL
        OR (v_conn = 'accepted' AND c.gs_connection_accepted_at IS NOT NULL)
        OR (v_conn = 'withdrawn' AND c.gs_connection_lost_at IS NOT NULL AND c.gs_connection_accepted_at IS NULL)
        OR (v_conn = 'sent' AND c.gs_connection_sent_at IS NOT NULL AND c.gs_connection_accepted_at IS NULL AND c.gs_connection_lost_at IS NULL)
        OR (v_conn = 'none' AND c.gs_connection_sent_at IS NULL AND c.gs_connection_accepted_at IS NULL AND c.gs_connection_lost_at IS NULL)
      )
      AND (
        v_reply IS NULL
        OR (v_reply = 'positive' AND EXISTS (
          SELECT 1 FROM public."PipelineStages" ps WHERE ps.uuid = c.pipeline_stage_uuid::text
            AND (lower(ps.name) LIKE '%replied - positive%' OR (lower(coalesce(ps.category,'')) = 'positive' AND lower(ps.name) LIKE '%replied%'))
        ))
        OR (v_reply = 'negative' AND EXISTS (
          SELECT 1 FROM public."PipelineStages" ps WHERE ps.uuid = c.pipeline_stage_uuid::text
            AND (lower(ps.name) LIKE '%replied - negative%' OR (lower(coalesce(ps.category,'')) = 'negative' AND lower(ps.name) LIKE '%replied%'))
        ))
        OR (v_reply = 'neutral' AND EXISTS (
          SELECT 1 FROM public."PipelineStages" ps WHERE ps.uuid = c.pipeline_stage_uuid::text AND lower(trim(ps.name)) = 'replied'
        ))
        OR (v_reply = 'no_reply'
          AND (c.pipeline_stage_uuid IS NULL OR EXISTS (
            SELECT 1 FROM public."PipelineStages" ps WHERE ps.uuid = c.pipeline_stage_uuid::text AND lower(ps.name) NOT LIKE '%replied%'
          ))
          AND coalesce(c.email_inbox_count, 0) = 0
          AND NOT EXISTS (SELECT 1 FROM public."LinkedinMessages" m WHERE m.lead_uuid = c.uuid AND m.type = 'inbox')
        )
      )
      AND (
        v_li IS NULL
        OR (v_li = 'enrolled' AND EXISTS (
          SELECT 1 FROM public."FlowLeads" fl JOIN public."Flows" f ON f.uuid = fl.flow_uuid
          WHERE fl.project_id = p_project_id AND fl.lead_uuid = c.uuid::text AND NOT public.flow_is_email_channel(f.name)
            AND fl.status = ANY (public.outreach_enrollment_statuses('enrolled'))
        ))
        OR (v_li = 'finished' AND EXISTS (
          SELECT 1 FROM public."FlowLeads" fl JOIN public."Flows" f ON f.uuid = fl.flow_uuid
          WHERE fl.project_id = p_project_id AND fl.lead_uuid = c.uuid::text AND NOT public.flow_is_email_channel(f.name)
            AND fl.status = ANY (public.outreach_enrollment_statuses('finished'))
        ) AND NOT EXISTS (
          SELECT 1 FROM public."FlowLeads" fl JOIN public."Flows" f ON f.uuid = fl.flow_uuid
          WHERE fl.project_id = p_project_id AND fl.lead_uuid = c.uuid::text AND NOT public.flow_is_email_channel(f.name)
            AND fl.status = ANY (public.outreach_enrollment_statuses('enrolled'))
        ))
        OR (v_li = 'paused' AND EXISTS (
          SELECT 1 FROM public."FlowLeads" fl JOIN public."Flows" f ON f.uuid = fl.flow_uuid
          WHERE fl.project_id = p_project_id AND fl.lead_uuid = c.uuid::text AND NOT public.flow_is_email_channel(f.name)
            AND fl.status = ANY (public.outreach_enrollment_statuses('paused'))
        ))
        OR (v_li = 'not_enrolled' AND NOT EXISTS (
          SELECT 1 FROM public."FlowLeads" fl JOIN public."Flows" f ON f.uuid = fl.flow_uuid
          WHERE fl.project_id = p_project_id AND fl.lead_uuid = c.uuid::text AND NOT public.flow_is_email_channel(f.name)
            AND fl.status IS DISTINCT FROM 'canceled'
        ))
      )
      AND (
        v_em IS NULL
        OR (v_em = 'enrolled' AND (
          coalesce(c.email_sent_count, 0) > 0
          OR EXISTS (
            SELECT 1 FROM public."FlowLeads" fl JOIN public."Flows" f ON f.uuid = fl.flow_uuid
            WHERE fl.project_id = p_project_id AND fl.lead_uuid = c.uuid::text AND public.flow_is_email_channel(f.name)
              AND fl.status = ANY (public.outreach_enrollment_statuses('enrolled'))
          )
        ))
        OR (v_em = 'finished' AND EXISTS (
          SELECT 1 FROM public."FlowLeads" fl JOIN public."Flows" f ON f.uuid = fl.flow_uuid
          WHERE fl.project_id = p_project_id AND fl.lead_uuid = c.uuid::text AND public.flow_is_email_channel(f.name)
            AND fl.status = ANY (public.outreach_enrollment_statuses('finished'))
        ) AND NOT EXISTS (
          SELECT 1 FROM public."FlowLeads" fl JOIN public."Flows" f ON f.uuid = fl.flow_uuid
          WHERE fl.project_id = p_project_id AND fl.lead_uuid = c.uuid::text AND public.flow_is_email_channel(f.name)
            AND fl.status = ANY (public.outreach_enrollment_statuses('enrolled'))
        ))
        OR (v_em = 'paused' AND EXISTS (
          SELECT 1 FROM public."FlowLeads" fl JOIN public."Flows" f ON f.uuid = fl.flow_uuid
          WHERE fl.project_id = p_project_id AND fl.lead_uuid = c.uuid::text AND public.flow_is_email_channel(f.name)
            AND fl.status = ANY (public.outreach_enrollment_statuses('paused'))
        ))
        OR (v_em = 'not_enrolled' AND coalesce(c.email_sent_count, 0) = 0 AND NOT EXISTS (
          SELECT 1 FROM public."FlowLeads" fl JOIN public."Flows" f ON f.uuid = fl.flow_uuid
          WHERE fl.project_id = p_project_id AND fl.lead_uuid = c.uuid::text AND public.flow_is_email_channel(f.name)
            AND fl.status IS DISTINCT FROM 'canceled'
        ))
      )
  ),
  base AS (
    SELECT pc.id AS pc_id, pc.company_id, pc.status, pc.created_at,
           co.name, co.domain, co.industry, co.employees_range
    FROM public.project_companies pc
    JOIN public.companies co ON co.id = pc.company_id
    WHERE pc.project_id = p_project_id
      AND (p_status IS NULL OR pc.status = p_status)
      AND (p_industry IS NULL OR co.industry = p_industry)
      AND (p_employees_range IS NULL OR co.employees_range = p_employees_range)
      AND (
        p_hypothesis_id IS NULL
        OR EXISTS (
          SELECT 1 FROM public.hypothesis_targets ht
          WHERE ht.project_company_id = pc.id AND ht.hypothesis_id = p_hypothesis_id
        )
      )
      AND (
        p_list_uuid IS NULL
        OR EXISTS (
          SELECT 1 FROM public."Contacts" c
          WHERE c.project_id = p_project_id
            AND c.company_uuid = pc.company_id
            AND c.list_uuid = p_list_uuid
        )
      )
      AND (
        p_search_pattern IS NULL OR trim(p_search_pattern) = ''
        OR co.name ILIKE p_search_pattern
        OR co.domain ILIKE p_search_pattern
      )
      AND (
        NOT v_has_outreach
        OR pc.company_id IN (SELECT mc.company_id FROM matching_companies mc)
      )
  ),
  counted AS (
    SELECT b.*, count(*) OVER() AS total_count FROM base b
  )
  SELECT c.pc_id, c.company_id, c.total_count
  FROM counted c
  ORDER BY
    CASE WHEN NOT v_asc AND v_sort = 'created_at' THEN c.created_at END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'created_at' THEN c.created_at END ASC NULLS LAST,
    CASE WHEN NOT v_asc AND v_sort = 'name' THEN c.name END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'name' THEN c.name END ASC NULLS LAST,
    CASE WHEN NOT v_asc AND v_sort = 'domain' THEN c.domain END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'domain' THEN c.domain END ASC NULLS LAST,
    CASE WHEN NOT v_asc AND v_sort = 'industry' THEN c.industry END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'industry' THEN c.industry END ASC NULLS LAST,
    CASE WHEN NOT v_asc AND v_sort = 'employees_range' THEN c.employees_range END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'employees_range' THEN c.employees_range END ASC NULLS LAST,
    CASE WHEN NOT v_asc AND v_sort = 'status' THEN c.status END DESC NULLS LAST,
    CASE WHEN v_asc AND v_sort = 'status' THEN c.status END ASC NULLS LAST,
    c.pc_id ASC
  LIMIT greatest(1, least(coalesce(p_limit, 25), 100))
  OFFSET greatest(0, coalesce(p_offset, 0));
END;
$$;

GRANT EXECUTE ON FUNCTION public.flow_is_email_channel(text) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.outreach_enrollment_statuses(text) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.filter_project_contact_ids(uuid, text, text, text, text, uuid, text, text, text, integer, integer, text, text) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.filter_project_company_ids_by_outreach(uuid, text, text, text, text, uuid, text, text, text, text, uuid, integer, integer, text, text) TO authenticated, service_role, anon;
