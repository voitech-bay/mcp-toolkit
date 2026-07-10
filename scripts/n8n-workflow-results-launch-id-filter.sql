-- Extend n8n workflow results RPC filter builder with launch_id (matches result.launch_id OR result.run_id).
CREATE OR REPLACE FUNCTION public._n8n_build_where_n8n_filters(p_filters jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  parts text[] := ARRAY[]::text[];
  elem jsonb;
  fld text;
  op text;
  val text;
  pat text;
  esc text;
BEGIN
  IF p_filters IS NULL OR jsonb_typeof(p_filters) <> 'array' OR jsonb_array_length(p_filters) = 0 THEN
    RETURN 'true';
  END IF;

  FOR elem IN SELECT value FROM jsonb_array_elements(p_filters) AS t(value)
  LOOP
    fld := elem->>'field';
    op := elem->>'op';
    val := COALESCE(elem->>'value', '');
    IF length(val) > 2000 THEN
      RAISE EXCEPTION 'filter value too long (max 2000)';
    END IF;

    IF fld IS NULL OR op IS NULL THEN
      RAISE EXCEPTION 'each filter must have field and op';
    END IF;

    IF fld = 'execution_id' THEN
      IF op = 'eq' AND val <> '' THEN
        parts := array_append(parts, format('n.execution_id = %L', val));
      ELSIF op = 'neq' AND val <> '' THEN
        parts := array_append(parts, format('NOT (n.execution_id = %L)', val));
      ELSIF op IN ('like', 'not_like') AND val <> '' THEN
        esc := public._n8n_escape_ilike_fragment(val);
        pat := '%' || esc || '%';
        IF op = 'like' THEN
          parts := array_append(parts, format('n.execution_id ILIKE %s ESCAPE E''\\''', quote_literal(pat)));
        ELSE
          parts := array_append(parts, format('NOT (n.execution_id ILIKE %s ESCAPE E''\\'')', quote_literal(pat)));
        END IF;
      ELSE
        RAISE EXCEPTION 'unsupported execution_id filter: op=%', op;
      END IF;

    ELSIF fld = 'workflow' THEN
      IF op = 'eq' AND val <> '' THEN
        parts := array_append(parts, format('n.workflow = %L', val));
      ELSIF op = 'neq' AND val <> '' THEN
        parts := array_append(parts, format('NOT (n.workflow = %L)', val));
      ELSIF op IN ('like', 'not_like') AND val <> '' THEN
        esc := public._n8n_escape_ilike_fragment(val);
        pat := '%' || esc || '%';
        IF op = 'like' THEN
          parts := array_append(parts, format('n.workflow ILIKE %s ESCAPE E''\\''', quote_literal(pat)));
        ELSE
          parts := array_append(parts, format('NOT (n.workflow ILIKE %s ESCAPE E''\\'')', quote_literal(pat)));
        END IF;
      ELSE
        RAISE EXCEPTION 'unsupported workflow filter: op=%', op;
      END IF;

    ELSIF fld = 'created_at' THEN
      IF op = 'gte' AND val <> '' THEN
        parts := array_append(parts, format('n.created_at >= %L::timestamptz', val));
      ELSIF op = 'lte' AND val <> '' THEN
        parts := array_append(parts, format('n.created_at <= %L::timestamptz', val));
      ELSE
        RAISE EXCEPTION 'unsupported created_at filter: op=%', op;
      END IF;

    ELSIF fld = 'contact_id' THEN
      IF op = 'eq' AND val <> '' THEN
        parts := array_append(parts, format('n.contact_id = %L::uuid', val));
      ELSIF op = 'neq' AND val <> '' THEN
        parts := array_append(parts, format('NOT (n.contact_id = %L::uuid)', val));
      ELSE
        RAISE EXCEPTION 'unsupported contact_id filter: op=%', op;
      END IF;

    ELSIF fld = 'company_id' THEN
      IF op = 'eq' AND val <> '' THEN
        parts := array_append(parts, format('n.company_id = %L::uuid', val));
      ELSIF op = 'neq' AND val <> '' THEN
        parts := array_append(parts, format('NOT (n.company_id = %L::uuid)', val));
      ELSE
        RAISE EXCEPTION 'unsupported company_id filter: op=%', op;
      END IF;

    ELSIF fld = 'launch_id' THEN
      IF op = 'eq' AND val <> '' THEN
        parts := array_append(parts, format('(n.result->>''launch_id'' = %L OR n.result->>''run_id'' = %L)', val, val));
      ELSIF op = 'neq' AND val <> '' THEN
        parts := array_append(parts, format('NOT (n.result->>''launch_id'' = %L OR n.result->>''run_id'' = %L)', val, val));
      ELSE
        RAISE EXCEPTION 'unsupported launch_id filter: op=%', op;
      END IF;

    ELSIF fld = 'contact_name' THEN
      IF op IN ('like', 'not_like') AND val <> '' THEN
        esc := public._n8n_escape_ilike_fragment(val);
        pat := '%' || esc || '%';
        IF op = 'like' THEN
          parts := array_append(parts, format(
            'n.contact_id IN (SELECT c.uuid FROM public."Contacts" c WHERE (c.name ILIKE %s OR c.first_name ILIKE %s OR c.last_name ILIKE %s) LIMIT 500)',
            quote_literal(pat), quote_literal(pat), quote_literal(pat)));
        ELSE
          parts := array_append(parts, format(
            'NOT (n.contact_id IS NOT NULL AND EXISTS (SELECT 1 FROM public."Contacts" c WHERE c.uuid = n.contact_id AND (c.name ILIKE %s OR c.first_name ILIKE %s OR c.last_name ILIKE %s)))',
            quote_literal(pat), quote_literal(pat), quote_literal(pat)));
        END IF;
      ELSE
        RAISE EXCEPTION 'unsupported contact_name filter: op=%', op;
      END IF;

    ELSIF fld = 'company_name' THEN
      IF op IN ('like', 'not_like') AND val <> '' THEN
        esc := public._n8n_escape_ilike_fragment(val);
        pat := '%' || esc || '%';
        IF op = 'like' THEN
          parts := array_append(parts, format(
            'n.company_id IN (SELECT co.id FROM public.companies co WHERE (co.name ILIKE %s OR co.domain ILIKE %s) LIMIT 500)',
            quote_literal(pat), quote_literal(pat)));
        ELSE
          parts := array_append(parts, format(
            'NOT (n.company_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.companies co WHERE co.id = n.company_id AND (co.name ILIKE %s OR co.domain ILIKE %s)))',
            quote_literal(pat), quote_literal(pat)));
        END IF;
      ELSE
        RAISE EXCEPTION 'unsupported company_name filter: op=%', op;
      END IF;

    ELSIF fld = 'result_text' THEN
      IF op IN ('like', 'not_like') AND val <> '' THEN
        esc := public._n8n_escape_ilike_fragment(val);
        pat := '%' || esc || '%';
        IF op = 'like' THEN
          parts := array_append(parts, format('n.result::text ILIKE %s ESCAPE E''\\''', quote_literal(pat)));
        ELSE
          parts := array_append(parts, format('NOT (n.result::text ILIKE %s ESCAPE E''\\'')', quote_literal(pat)));
        END IF;
      ELSE
        RAISE EXCEPTION 'unsupported result_text filter: op=%', op;
      END IF;

    ELSE
      RAISE EXCEPTION 'unknown filter field: %', fld;
    END IF;
  END LOOP;

  IF array_length(parts, 1) IS NULL THEN
    RETURN 'true';
  END IF;
  RETURN array_to_string(parts, ' AND ');
END;
$function$;
