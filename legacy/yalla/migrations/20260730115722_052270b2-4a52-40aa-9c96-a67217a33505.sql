
-- ============================================================
-- 1. Sensitive read audit
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sensitive_read_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  user_roles text[] NOT NULL DEFAULT '{}'::text[],
  resource text NOT NULL,
  action text NOT NULL DEFAULT 'select',
  row_count integer NOT NULL DEFAULT 0,
  allowed boolean NOT NULL DEFAULT true,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sensitive_read_audit TO authenticated;
GRANT ALL ON public.sensitive_read_audit TO service_role;
ALTER TABLE public.sensitive_read_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sra_admin_read" ON public.sensitive_read_audit;
CREATE POLICY "sra_admin_read" ON public.sensitive_read_audit
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'compliance_admin'::app_role)
);

CREATE INDEX IF NOT EXISTS sensitive_read_audit_resource_idx
  ON public.sensitive_read_audit (resource, created_at DESC);
CREATE INDEX IF NOT EXISTS sensitive_read_audit_user_idx
  ON public.sensitive_read_audit (user_id, created_at DESC);

-- Append-only: block updates/deletes even for privileged app roles.
CREATE OR REPLACE FUNCTION public.block_sensitive_read_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'sensitive_read_audit is append-only';
END;
$$;

DROP TRIGGER IF EXISTS sensitive_read_audit_immutable ON public.sensitive_read_audit;
CREATE TRIGGER sensitive_read_audit_immutable
BEFORE UPDATE OR DELETE ON public.sensitive_read_audit
FOR EACH ROW EXECUTE FUNCTION public.block_sensitive_read_audit_mutation();

-- Helper: current caller's roles as text[]
CREATE OR REPLACE FUNCTION public.current_user_role_names()
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(role::text ORDER BY role::text), '{}'::text[])
  FROM public.user_roles WHERE user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.current_user_role_names() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_role_names() TO authenticated;

CREATE OR REPLACE FUNCTION public.log_sensitive_read(
  _resource text,
  _row_count integer DEFAULT 0,
  _allowed boolean DEFAULT true,
  _action text DEFAULT 'select',
  _context jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.sensitive_read_audit (user_id, user_roles, resource, action, row_count, allowed, context)
  VALUES (auth.uid(), public.current_user_role_names(), _resource, _action,
          GREATEST(COALESCE(_row_count, 0), 0), COALESCE(_allowed, true), COALESCE(_context, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_sensitive_read(text, integer, boolean, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_sensitive_read(text, integer, boolean, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_sensitive_read(text, integer, boolean, text, jsonb) TO service_role;

-- ============================================================
-- 2. Audited accessors for the two role-restricted resources
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_driver_reputation_audited(_limit integer DEFAULT 100)
RETURNS TABLE (
  driver_id uuid, rating numeric, trips_total integer,
  reviews_count integer, badges jsonb, achievements jsonb, updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    PERFORM public.log_sensitive_read('driver_reputation', 0, false, 'select', '{}'::jsonb);
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT r.driver_id, r.rating, r.trips_total, r.reviews_count, r.badges, r.achievements, r.updated_at
  FROM public.driver_reputation r
  ORDER BY r.rating DESC NULLS LAST
  LIMIT LEAST(GREATEST(COALESCE(_limit, 100), 1), 500);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM public.log_sensitive_read('driver_reputation', v_count, true, 'select',
    jsonb_build_object('limit', _limit));
END;
$$;

REVOKE ALL ON FUNCTION public.get_driver_reputation_audited(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_driver_reputation_audited(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_mpesa_rate_limit_state_audited()
RETURNS TABLE (
  shortcode text, tokens double precision, capacity integer,
  refill_rate_per_sec integer, last_refill_at timestamptz, updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_allowed boolean;
BEGIN
  v_allowed :=
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_role(auth.uid(), 'finance_admin'::app_role);

  IF NOT v_allowed THEN
    PERFORM public.log_sensitive_read('mpesa_rate_limit_buckets', 0, false, 'select', '{}'::jsonb);
    RAISE EXCEPTION 'insufficient privilege' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT b.shortcode, b.tokens, b.capacity, b.refill_rate_per_sec, b.last_refill_at, b.updated_at
  FROM public.mpesa_rate_limit_buckets b
  ORDER BY b.shortcode;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM public.log_sensitive_read('mpesa_rate_limit_buckets', v_count, true, 'select', '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.get_mpesa_rate_limit_state_audited() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mpesa_rate_limit_state_audited() TO authenticated;

-- ============================================================
-- 3. Security findings registry + scan runs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.security_findings_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  internal_id text NOT NULL UNIQUE,
  scanner_name text NOT NULL DEFAULT 'supabase_lov',
  finding_code text,
  name text NOT NULL,
  description text,
  severity text NOT NULL DEFAULT 'warn',
  status text NOT NULL DEFAULT 'open',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  fixed_at timestamptz,
  regressed_at timestamptz,
  last_scan_at timestamptz NOT NULL DEFAULT now(),
  occurrences integer NOT NULL DEFAULT 1,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_findings_registry_status_chk
    CHECK (status IN ('open','fixed','regressed','ignored'))
);

GRANT SELECT ON public.security_findings_registry TO authenticated;
GRANT ALL ON public.security_findings_registry TO service_role;
ALTER TABLE public.security_findings_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sfr_admin_read" ON public.security_findings_registry;
CREATE POLICY "sfr_admin_read" ON public.security_findings_registry
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'compliance_admin'::app_role)
);

CREATE TABLE IF NOT EXISTS public.security_scan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scanner_name text NOT NULL DEFAULT 'supabase_lov',
  trigger_source text NOT NULL DEFAULT 'scheduled',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  total_findings integer NOT NULL DEFAULT 0,
  new_findings integer NOT NULL DEFAULT 0,
  regressed_findings integer NOT NULL DEFAULT 0,
  resolved_findings integer NOT NULL DEFAULT 0,
  alerted boolean NOT NULL DEFAULT false,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.security_scan_runs TO authenticated;
GRANT ALL ON public.security_scan_runs TO service_role;
ALTER TABLE public.security_scan_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ssr_admin_read" ON public.security_scan_runs;
CREATE POLICY "ssr_admin_read" ON public.security_scan_runs
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'compliance_admin'::app_role)
);

CREATE INDEX IF NOT EXISTS security_scan_runs_started_idx
  ON public.security_scan_runs (started_at DESC);

CREATE OR REPLACE FUNCTION public.touch_security_findings_registry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS security_findings_registry_touch ON public.security_findings_registry;
CREATE TRIGGER security_findings_registry_touch
BEFORE UPDATE ON public.security_findings_registry
FOR EACH ROW EXECUTE FUNCTION public.touch_security_findings_registry();

-- ============================================================
-- 4. Per-role alert notification preferences
-- ============================================================
CREATE TABLE IF NOT EXISTS public.alert_notification_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL UNIQUE,
  email_enabled boolean NOT NULL DEFAULT true,
  slack_enabled boolean NOT NULL DEFAULT true,
  severity_info boolean NOT NULL DEFAULT false,
  severity_warning boolean NOT NULL DEFAULT true,
  severity_critical boolean NOT NULL DEFAULT true,
  slack_webhook_url text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.alert_notification_prefs TO authenticated;
GRANT ALL ON public.alert_notification_prefs TO service_role;
ALTER TABLE public.alert_notification_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anp_admin_read" ON public.alert_notification_prefs;
CREATE POLICY "anp_admin_read" ON public.alert_notification_prefs
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
);

DROP POLICY IF EXISTS "anp_admin_write" ON public.alert_notification_prefs;
CREATE POLICY "anp_admin_write" ON public.alert_notification_prefs
FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
);

DROP TRIGGER IF EXISTS alert_notification_prefs_touch ON public.alert_notification_prefs;
CREATE TRIGGER alert_notification_prefs_touch
BEFORE UPDATE ON public.alert_notification_prefs
FOR EACH ROW EXECUTE FUNCTION public.touch_security_findings_registry();

INSERT INTO public.alert_notification_prefs (role, email_enabled, slack_enabled, severity_info, severity_warning, severity_critical)
VALUES
  ('admin', true, true, false, true, true),
  ('super_admin', true, true, false, true, true),
  ('finance_admin', true, false, false, true, true),
  ('compliance_admin', true, false, false, false, true)
ON CONFLICT (role) DO NOTHING;

-- Seed the two findings resolved in the previous remediation pass.
INSERT INTO public.security_findings_registry
  (internal_id, scanner_name, finding_code, name, description, severity, status, fixed_at, resolution_note)
VALUES
  ('driver_reputation_public_select', 'supabase_lov', 'PUBLIC_BUSINESS_DATA',
   'Driver reputation data readable by anyone',
   'Anonymous SELECT policy on driver_reputation exposed ratings, trip counts and badges.',
   'warn', 'fixed', now(), 'Public USING(true) policy replaced with authenticated-only policy; anon SELECT grant revoked.'),
  ('mpesa_rate_limit_buckets_authenticated_read', 'supabase_lov', 'PUBLIC_BUSINESS_DATA',
   'Internal rate-limiter state readable by any authenticated user',
   'Any authenticated user could read M-Pesa token bucket state.',
   'warn', 'fixed', now(), 'Role-gated to admin, super_admin and finance_admin via has_role(); anon revoked.')
ON CONFLICT (internal_id) DO NOTHING;
