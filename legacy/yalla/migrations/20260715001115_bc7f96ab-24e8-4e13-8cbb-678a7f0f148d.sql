
-- ============================================================
-- Policy Assurance Framework (PAF) — foundation
-- ============================================================

CREATE TABLE IF NOT EXISTS public.paf_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  ran_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  trigger text NOT NULL DEFAULT 'manual',       -- manual | scheduled | ci
  scores jsonb NOT NULL DEFAULT '{}'::jsonb,     -- coverage, health, zero_trust, etc.
  inventory jsonb NOT NULL DEFAULT '{}'::jsonb,  -- discovered resources
  classification jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation jsonb NOT NULL DEFAULT '{}'::jsonb, -- per-policy findings
  drift jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_register jsonb NOT NULL DEFAULT '[]'::jsonb,
  remediation jsonb NOT NULL DEFAULT '[]'::jsonb,
  critical_count int NOT NULL DEFAULT 0,
  high_count int NOT NULL DEFAULT 0,
  medium_count int NOT NULL DEFAULT 0,
  low_count int NOT NULL DEFAULT 0,
  passed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.paf_runs TO authenticated;
GRANT ALL ON public.paf_runs TO service_role;

ALTER TABLE public.paf_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "paf_runs admin read"
  ON public.paf_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "paf_runs service write"
  ON public.paf_runs FOR ALL TO service_role
  USING (true) WITH CHECK (true);


CREATE TABLE IF NOT EXISTS public.paf_resource_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_kind text NOT NULL,   -- table | view | function | bucket | publication | edge_function
  resource_name text NOT NULL,
  domain text NOT NULL,          -- public | internal | confidential | financial | regulatory | secret
  sensitivity text NOT NULL,     -- low | medium | high | critical
  scope text,                    -- owner | tenant | fleet | corporate | admin | service_role | public
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_kind, resource_name)
);

GRANT SELECT ON public.paf_resource_classifications TO authenticated;
GRANT ALL ON public.paf_resource_classifications TO service_role;

ALTER TABLE public.paf_resource_classifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "paf_classifications admin read"
  ON public.paf_resource_classifications FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "paf_classifications admin write"
  ON public.paf_resource_classifications FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "paf_classifications service"
  ON public.paf_resource_classifications FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- Auto-classifier
-- ============================================================
CREATE OR REPLACE FUNCTION public.paf_classify(_name text)
RETURNS TABLE(domain text, sensitivity text, scope text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN _name ~* '(mpesa|wallet|ledger|journal|settle|refund|commission|invoice|payment|tax|etims|fx|treasury|payout|revenue)' THEN 'financial'
      WHEN _name ~* '(fraud|trust|incident|investig|risk|abuse|takeover|suspicious|forbidden|denials|blocked)' THEN 'regulatory'
      WHEN _name ~* '(admin_|admin$|security_|authent|authoriz|privileged|role|permission|capabilit|policy_|token|secret|crypto|backup_code)' THEN 'secret'
      WHEN _name ~* '(corporate|trip|dispatch|driver|rider|delivery|package|manifest|kyc|kyb|document|message|support|gps|location|tracking)' THEN 'confidential'
      WHEN _name ~* '(country|language|currency|ride_type|vehicle_type|region|city|fleet|faq|marketing|pricing_model|ride_categor)' THEN 'public'
      ELSE 'internal'
    END AS domain,
    CASE
      WHEN _name ~* '(mpesa|wallet|ledger|journal|settle|fraud|admin_|security_|privileged|token|secret|kyc|kyb|payment)' THEN 'critical'
      WHEN _name ~* '(corporate|trip|dispatch|driver|rider|delivery|invoice|tax|etims|risk|incident)' THEN 'high'
      WHEN _name ~* '(analytics|metric|snapshot|log$|_log|audit|event)' THEN 'medium'
      ELSE 'low'
    END AS sensitivity,
    CASE
      WHEN _name ~* '(admin_|privileged|forbidden|blocked|takeover)' THEN 'admin'
      WHEN _name ~* '(corporate)' THEN 'corporate'
      WHEN _name ~* '(fleet)' THEN 'fleet'
      WHEN _name ~* '(driver)' THEN 'driver'
      WHEN _name ~* '(rider)' THEN 'rider'
      WHEN _name ~* '(country|language|currency|marketing|faq)' THEN 'public'
      ELSE 'tenant'
    END AS scope;
$$;

REVOKE ALL ON FUNCTION public.paf_classify(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.paf_classify(text) TO authenticated, service_role;

-- ============================================================
-- Discovery + validation
-- ============================================================
CREATE OR REPLACE FUNCTION public.paf_discover()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_tables jsonb;
  v_policies jsonb;
  v_defs jsonb;
  v_pubs jsonb;
  v_grants jsonb;
  v_summary jsonb;
  v_total int;
  v_rls_on int;
  v_permissive int;
BEGIN
  -- Only admins / service role
  IF NOT (public.has_role(auth.uid(),'admin')
       OR public.has_role(auth.uid(),'super_admin')
       OR current_setting('role', true) = 'service_role') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  -- Tables + RLS status
  SELECT jsonb_agg(jsonb_build_object(
    'name', c.relname,
    'rls_enabled', c.relrowsecurity,
    'rls_forced', c.relforcerowsecurity,
    'kind', CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned' WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view' END,
    'classification', (SELECT to_jsonb(x) FROM public.paf_classify(c.relname) x)
  ))
  INTO v_tables
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p');

  -- Policies
  SELECT jsonb_agg(jsonb_build_object(
    'table', tablename, 'name', policyname, 'cmd', cmd,
    'roles', roles, 'qual', qual, 'with_check', with_check,
    'permissive_true', (qual = 'true' OR with_check = 'true'),
    'is_service_only', (array['service_role']::name[] = roles)
  ))
  INTO v_policies
  FROM pg_policies WHERE schemaname='public';

  -- SECURITY DEFINER functions granted to PUBLIC
  SELECT jsonb_agg(jsonb_build_object(
    'name', p.proname,
    'granted_public', has_function_privilege('public', p.oid, 'EXECUTE'),
    'granted_authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ))
  INTO v_defs
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.prosecdef = true;

  -- Realtime publication members
  SELECT jsonb_agg(tablename)
  INTO v_pubs
  FROM pg_publication_tables
  WHERE pubname='supabase_realtime' AND schemaname='public';

  -- Grants inventory
  SELECT jsonb_object_agg(table_name, privs) INTO v_grants FROM (
    SELECT table_name, jsonb_agg(DISTINCT grantee || ':' || privilege_type) AS privs
    FROM information_schema.role_table_grants
    WHERE table_schema='public' AND grantee IN ('anon','authenticated','service_role')
    GROUP BY table_name
  ) g;

  -- Scoring
  v_total := COALESCE(jsonb_array_length(v_tables), 0);
  SELECT count(*) INTO v_rls_on
    FROM jsonb_array_elements(COALESCE(v_tables,'[]'::jsonb)) t
    WHERE (t->>'rls_enabled')::boolean;
  SELECT count(*) INTO v_permissive
    FROM jsonb_array_elements(COALESCE(v_policies,'[]'::jsonb)) p
    WHERE (p->>'permissive_true')::boolean AND NOT (p->>'is_service_only')::boolean;

  v_summary := jsonb_build_object(
    'total_tables', v_total,
    'rls_enabled', v_rls_on,
    'rls_coverage_pct', CASE WHEN v_total=0 THEN 100 ELSE round(v_rls_on::numeric*100/v_total, 1) END,
    'permissive_policy_count', v_permissive,
    'realtime_tables', COALESCE(jsonb_array_length(v_pubs),0),
    'security_definer_functions', COALESCE(jsonb_array_length(v_defs),0)
  );

  RETURN jsonb_build_object(
    'generated_at', now(),
    'tables', COALESCE(v_tables,'[]'::jsonb),
    'policies', COALESCE(v_policies,'[]'::jsonb),
    'security_definer', COALESCE(v_defs,'[]'::jsonb),
    'realtime_publication', COALESCE(v_pubs,'[]'::jsonb),
    'grants', COALESCE(v_grants,'{}'::jsonb),
    'summary', v_summary
  );
END;
$$;

REVOKE ALL ON FUNCTION public.paf_discover() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.paf_discover() TO authenticated, service_role;

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.paf_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_paf_classifications_updated ON public.paf_resource_classifications;
CREATE TRIGGER trg_paf_classifications_updated
BEFORE UPDATE ON public.paf_resource_classifications
FOR EACH ROW EXECUTE FUNCTION public.paf_touch_updated_at();
