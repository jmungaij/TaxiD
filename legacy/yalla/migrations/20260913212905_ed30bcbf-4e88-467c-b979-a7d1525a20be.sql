-- ============================================================
-- PHASE 1: TENANT ISOLATION HARDENING (real cross-tenant defect)
-- ============================================================
DROP POLICY IF EXISTS corp_accounts_read ON public.corporate_accounts;
CREATE POLICY corp_accounts_read ON public.corporate_accounts
FOR SELECT TO authenticated
USING (
  public.is_corporate_member(auth.uid(), id)
  OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[])
);

DROP POLICY IF EXISTS corp_inv_read ON public.corporate_invoices;
CREATE POLICY corp_inv_read ON public.corporate_invoices
FOR SELECT TO authenticated
USING (
  public.is_corporate_manager_or_admin(auth.uid(), corporate_id)
  OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[])
);

-- ============================================================
-- PHASE 1: AUTHENTICATION POLICY REGISTER (per organisation)
-- ============================================================
CREATE TABLE public.identity_auth_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('PLATFORM','ORGANISATION')),
  corporate_id uuid REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  label text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  email_domains text[] NOT NULL DEFAULT '{}',
  password_enabled boolean NOT NULL DEFAULT true,
  passwordless_enabled boolean NOT NULL DEFAULT true,
  google_enabled boolean NOT NULL DEFAULT true,
  sso_enabled boolean NOT NULL DEFAULT false,
  sso_provider text,
  mfa_required boolean NOT NULL DEFAULT false,
  session_idle_minutes integer NOT NULL DEFAULT 60,
  session_absolute_hours integer NOT NULL DEFAULT 12,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','ACTIVE','RETIRED')),
  approved_by uuid,
  approved_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_policy_scope_shape CHECK (
    (scope = 'ORGANISATION' AND corporate_id IS NOT NULL)
    OR (scope = 'PLATFORM' AND corporate_id IS NULL)
  ),
  CONSTRAINT identity_policy_approved_shape CHECK (
    state <> 'ACTIVE' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX identity_policy_one_active_org
  ON public.identity_auth_policies (corporate_id) WHERE state = 'ACTIVE' AND scope = 'ORGANISATION';
CREATE UNIQUE INDEX identity_policy_one_active_platform
  ON public.identity_auth_policies ((1)) WHERE state = 'ACTIVE' AND scope = 'PLATFORM';
CREATE INDEX identity_policy_domains ON public.identity_auth_policies USING gin (email_domains);

GRANT SELECT ON public.identity_auth_policies TO authenticated;
GRANT ALL ON public.identity_auth_policies TO service_role;
ALTER TABLE public.identity_auth_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY identity_policy_read ON public.identity_auth_policies
FOR SELECT TO authenticated
USING (
  scope = 'PLATFORM'
  OR public.is_corporate_member(auth.uid(), corporate_id)
  OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
);

CREATE POLICY identity_policy_admin_write ON public.identity_auth_policies
FOR ALL TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE OR REPLACE FUNCTION public.identity_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER trg_identity_policy_touch BEFORE UPDATE ON public.identity_auth_policies
FOR EACH ROW EXECUTE FUNCTION public.identity_touch();

-- ============================================================
-- DISCOVERY LOG (append only) + RATE BUCKETS
-- ============================================================
CREATE TABLE public.identity_discovery_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash text NOT NULL,
  email_domain text,
  outcome text NOT NULL,
  corporate_id uuid REFERENCES public.corporate_accounts(id) ON DELETE SET NULL,
  policy_id uuid REFERENCES public.identity_auth_policies(id) ON DELETE SET NULL,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  metadata jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX identity_discovery_occurred ON public.identity_discovery_events (occurred_at DESC);
GRANT SELECT ON public.identity_discovery_events TO authenticated;
GRANT ALL ON public.identity_discovery_events TO service_role;
ALTER TABLE public.identity_discovery_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY identity_discovery_staff_read ON public.identity_discovery_events
FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE OR REPLACE FUNCTION public.identity_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'APPEND_ONLY_TABLE'; END; $$;
CREATE TRIGGER trg_identity_discovery_append_only
BEFORE UPDATE OR DELETE ON public.identity_discovery_events
FOR EACH ROW EXECUTE FUNCTION public.identity_append_only();

CREATE TABLE public.identity_discovery_rate (
  bucket text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT now(),
  hits integer NOT NULL DEFAULT 0
);
GRANT ALL ON public.identity_discovery_rate TO service_role;
ALTER TABLE public.identity_discovery_rate ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- ACCOUNT DISCOVERY (no account enumeration)
-- ============================================================
CREATE OR REPLACE FUNCTION public.identity_discover(_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(coalesce(_email, '')));
  v_domain text;
  v_hash text;
  v_bucket text;
  v_hits integer;
  v_policy public.identity_auth_policies;
  v_org public.corporate_accounts;
  v_outcome text := 'PLATFORM_POLICY';
  v_corr uuid := gen_random_uuid();
BEGIN
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_EMAIL');
  END IF;

  v_domain := split_part(v_email, '@', 2);
  v_hash := md5(v_email || 'yalla-identity-discovery');
  v_bucket := 'discover:' || v_hash;

  INSERT INTO public.identity_discovery_rate (bucket, window_start, hits)
  VALUES (v_bucket, date_trunc('hour', now()), 1)
  ON CONFLICT (bucket) DO UPDATE
    SET hits = CASE WHEN public.identity_discovery_rate.window_start < date_trunc('hour', now())
                    THEN 1 ELSE public.identity_discovery_rate.hits + 1 END,
        window_start = CASE WHEN public.identity_discovery_rate.window_start < date_trunc('hour', now())
                    THEN date_trunc('hour', now()) ELSE public.identity_discovery_rate.window_start END
  RETURNING hits INTO v_hits;

  IF v_hits > 20 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'RATE_LIMITED');
  END IF;

  SELECT p.* INTO v_policy
  FROM public.identity_auth_policies p
  WHERE p.state = 'ACTIVE' AND p.scope = 'ORGANISATION' AND v_domain = ANY (p.email_domains)
  LIMIT 1;

  IF v_policy.id IS NOT NULL THEN
    SELECT * INTO v_org FROM public.corporate_accounts WHERE id = v_policy.corporate_id;
    v_outcome := 'ORGANISATION_POLICY';
  ELSE
    SELECT p.* INTO v_policy
    FROM public.identity_auth_policies p
    WHERE p.state = 'ACTIVE' AND p.scope = 'PLATFORM'
    LIMIT 1;
  END IF;

  INSERT INTO public.identity_discovery_events (email_hash, email_domain, outcome, corporate_id, policy_id, correlation_id)
  VALUES (v_hash, v_domain, v_outcome, v_policy.corporate_id, v_policy.id, v_corr);

  IF v_policy.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_ACTIVE_POLICY', 'correlation_id', v_corr);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'correlation_id', v_corr,
    'outcome', v_outcome,
    'domain', v_domain,
    'organisation', CASE WHEN v_org.id IS NULL THEN NULL
      ELSE jsonb_build_object('name', coalesce(v_org.trading_name, v_org.legal_name)) END,
    'policy', jsonb_build_object('id', v_policy.id, 'label', v_policy.label, 'version', v_policy.version),
    'methods', jsonb_build_object(
      'password', v_policy.password_enabled,
      'passwordless', v_policy.passwordless_enabled,
      'google', v_policy.google_enabled,
      'sso', v_policy.sso_enabled,
      'sso_provider', v_policy.sso_provider
    ),
    'mfa_required', v_policy.mfa_required,
    'session', jsonb_build_object('idle_minutes', v_policy.session_idle_minutes,
                                  'absolute_hours', v_policy.session_absolute_hours)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.identity_discover(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.identity_discover(text) TO anon, authenticated, service_role;

-- ============================================================
-- IDENTITY CONTEXT (server authoritative)
-- ============================================================
CREATE OR REPLACE FUNCTION public.identity_tenant_context()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_verified boolean;
  v_memberships jsonb;
  v_roles text[];
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('authenticated', false);
  END IF;

  SELECT u.email, u.email_confirmed_at IS NOT NULL INTO v_email, v_verified
  FROM auth.users u WHERE u.id = v_uid;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'membership_id', e.id,
           'corporate_id', e.corporate_id,
           'organisation', coalesce(a.trading_name, a.legal_name),
           'role', e.role::text,
           'status', e.status::text,
           'policy_id', p.id,
           'mfa_required', coalesce(p.mfa_required, false)
         ) ORDER BY a.legal_name), '[]'::jsonb)
  INTO v_memberships
  FROM public.corporate_employees e
  JOIN public.corporate_accounts a ON a.id = e.corporate_id
  LEFT JOIN public.identity_auth_policies p
    ON p.corporate_id = e.corporate_id AND p.state = 'ACTIVE'
  WHERE e.user_id = v_uid;

  SELECT coalesce(array_agg(r.role::text), '{}') INTO v_roles
  FROM public.user_roles r WHERE r.user_id = v_uid;

  RETURN jsonb_build_object(
    'authenticated', true,
    'identity_id', v_uid,
    'email', v_email,
    'email_verified', v_verified,
    'platform_roles', to_jsonb(v_roles),
    'memberships', v_memberships,
    'auth_strength', coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', 'aal1'),
    'session_id', nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.identity_tenant_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.identity_tenant_context() TO authenticated, service_role;

-- ============================================================
-- SECURITY CENTRE READS (own data only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.identity_my_sessions()
RETURNS TABLE (
  session_id uuid,
  created_at timestamptz,
  refreshed_at timestamptz,
  not_after timestamptz,
  user_agent text,
  approximate_location text,
  auth_strength text,
  is_current boolean
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT s.id,
         s.created_at,
         coalesce(s.refreshed_at::timestamptz, s.updated_at),
         s.not_after,
         s.user_agent,
         CASE WHEN s.ip IS NULL THEN NULL ELSE host(network(set_masklen(s.ip, 24))) END,
         s.aal::text,
         s.id::text = (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id')
  FROM auth.sessions s
  WHERE auth.uid() IS NOT NULL AND s.user_id = auth.uid()
  ORDER BY coalesce(s.refreshed_at::timestamptz, s.updated_at) DESC;
$$;
REVOKE ALL ON FUNCTION public.identity_my_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.identity_my_sessions() TO authenticated;

CREATE OR REPLACE FUNCTION public.identity_my_devices()
RETURNS TABLE (
  fingerprint_hash text,
  platform text,
  os text,
  app_version text,
  user_agent text,
  timezone text,
  first_seen timestamptz,
  last_seen timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT d.fingerprint_hash, d.platform, d.os, d.app_version, d.user_agent,
         d.timezone, d.first_seen, d.last_seen
  FROM public.device_fingerprints d
  WHERE auth.uid() IS NOT NULL AND d.user_id = auth.uid()
  ORDER BY d.last_seen DESC NULLS LAST;
$$;
REVOKE ALL ON FUNCTION public.identity_my_devices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.identity_my_devices() TO authenticated;

CREATE OR REPLACE FUNCTION public.identity_my_auth_events(_limit integer DEFAULT 50)
RETURNS TABLE (
  occurred_at timestamptz,
  event_type text,
  method text,
  success boolean,
  failure_reason text,
  approximate_location text,
  user_agent text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT e.occurred_at, e.event_type, e.method, e.success, e.failure_reason,
         coalesce(nullif(concat_ws(', ', e.city, e.country), ''),
                  CASE WHEN e.ip_address IS NULL THEN NULL
                       ELSE host(network(set_masklen(e.ip_address, 24))) END),
         e.user_agent
  FROM public.authentication_events e
  WHERE auth.uid() IS NOT NULL AND e.user_id = auth.uid()
  ORDER BY e.occurred_at DESC
  LIMIT greatest(1, least(coalesce(_limit, 50), 200));
$$;
REVOKE ALL ON FUNCTION public.identity_my_auth_events(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.identity_my_auth_events(integer) TO authenticated;

-- Platform default policy (reflects what is actually configured today)
INSERT INTO public.identity_auth_policies
  (scope, label, version, password_enabled, passwordless_enabled, google_enabled,
   sso_enabled, mfa_required, state, approved_by, approved_at, note)
VALUES
  ('PLATFORM', 'Yalla platform default', 1, true, true, true, false, false,
   'ACTIVE', '00000000-0000-0000-0000-000000000000', now(),
   'Reflects the methods actually enabled on the auth server: email+password, email sign-in link, Google. Organisation SSO and MFA are not configured for customers.');
