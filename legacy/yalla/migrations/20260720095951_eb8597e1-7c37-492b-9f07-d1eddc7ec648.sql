
-- Workstream 2 — Twin Reference Schema Mapper support
CREATE OR REPLACE FUNCTION public.twin_describe_table(_table text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  _cols jsonb;
  _enums jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'name', column_name,
    'udt_name', udt_name,
    'data_type', data_type,
    'is_nullable', is_nullable
  ) ORDER BY ordinal_position), '[]'::jsonb)
  INTO _cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = _table;

  SELECT coalesce(jsonb_object_agg(column_name, labels), '{}'::jsonb)
  INTO _enums
  FROM (
    SELECT c.column_name,
           (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)
              FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
             WHERE t.typname = c.udt_name) AS labels
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.table_name = _table
       AND c.data_type = 'USER-DEFINED'
  ) s
  WHERE labels IS NOT NULL;

  RETURN jsonb_build_object('columns', _cols, 'enums', _enums);
END;
$$;

REVOKE ALL ON FUNCTION public.twin_describe_table(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.twin_describe_table(text) TO service_role, authenticated;

-- Workstream 3 — Qualification Governance versioned read layer
CREATE OR REPLACE VIEW public.v_qualification_governance_runs
WITH (security_invoker = on) AS
SELECT
  id::text        AS id,
  chain_key,
  status,
  passed_steps    AS passed,
  failed_steps    AS failed,
  triggered_at    AS started_at
FROM public.payment_continuous_qualification_runs
ORDER BY triggered_at DESC;

CREATE OR REPLACE VIEW public.v_qualification_forecast_accuracy
WITH (security_invoker = on) AS
SELECT
  id::text        AS id,
  metric,
  predicted_value,
  actual_value,
  percent_error,
  drift_flag,
  window_end
FROM public.payment_forecast_accuracy
ORDER BY window_end DESC;

GRANT SELECT ON public.v_qualification_governance_runs   TO authenticated, service_role;
GRANT SELECT ON public.v_qualification_forecast_accuracy TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_qualification_governance_overview(_limit int DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _runs jsonb;
  _acc  jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')
       OR public.has_role(auth.uid(), 'super_admin')
       OR public.has_role(auth.uid(), 'finance_admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO _runs
    FROM (SELECT * FROM public.v_qualification_governance_runs LIMIT _limit) r;

  SELECT coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO _acc
    FROM (SELECT * FROM public.v_qualification_forecast_accuracy LIMIT _limit) a;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'runs',           _runs,
    'accuracy',       _acc
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_qualification_governance_overview(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_qualification_governance_overview(int) TO authenticated, service_role;
