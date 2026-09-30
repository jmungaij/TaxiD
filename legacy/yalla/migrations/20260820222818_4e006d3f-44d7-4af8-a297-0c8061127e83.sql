CREATE OR REPLACE FUNCTION public.intern_programme_authority(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(p_user, ARRAY['admin','super_admin','director','general_manager','operations_admin']::app_role[])
      OR (p_user IS NULL AND current_user IN ('postgres','service_role','supabase_admin','supabase_migration_admin','supabase_storage_admin'));
$$;

DO $mig$
DECLARE d text;
BEGIN
  SELECT pg_get_functiondef(to_regprocedure('public.intern_review_capstone(uuid,text,jsonb,text)')) INTO d;
  d := replace(d, 'DECLARE c record;', 'DECLARE c public.intern_capstones;');
  EXECUTE d;
  RAISE NOTICE 'migration role: %', current_user;
END $mig$;

CREATE TABLE IF NOT EXISTS public.intern_certification_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_by uuid,
  verdict text NOT NULL,
  gaps integer NOT NULL DEFAULT 0,
  total_checks integer NOT NULL DEFAULT 0,
  role_context text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.intern_certification_runs TO authenticated;
GRANT ALL ON public.intern_certification_runs TO service_role;
ALTER TABLE public.intern_certification_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS intern_certification_runs_read ON public.intern_certification_runs;
CREATE POLICY intern_certification_runs_read ON public.intern_certification_runs
  FOR SELECT TO authenticated USING (public.intern_programme_authority(auth.uid()));

CREATE OR REPLACE FUNCTION public.intern_certify_and_record()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF NOT public.intern_certify_authorised() THEN
    RAISE EXCEPTION 'Only a programme authority may run the certification suite.';
  END IF;
  r := public.intern_certify_suite();
  INSERT INTO public.intern_certification_runs(ran_by, verdict, gaps, total_checks, role_context, result)
  VALUES (auth.uid(), r->>'verdict', (r->>'gaps')::int, (r->>'total_checks')::int, current_user, r);
  RETURN r;
END; $$;
REVOKE ALL ON FUNCTION public.intern_certify_and_record() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.intern_certify_and_record() TO authenticated, service_role;

DO $mig$
DECLARE r jsonb;
BEGIN
  BEGIN
    r := public.intern_certify_and_record();
    RAISE NOTICE 'certification: %', r->>'verdict';
  EXCEPTION WHEN others THEN
    INSERT INTO public.intern_certification_runs(verdict, gaps, total_checks, role_context, result)
    VALUES ('ERROR', -1, 0, current_user, jsonb_build_object('error', SQLERRM));
  END;
END $mig$;