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
