
-- =====================================================================
-- Phase 3: Realtime authorization guard + audit
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.realtime_subscription_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  role_claim text,
  stream text NOT NULL,
  channel text,
  outcome text NOT NULL CHECK (outcome IN ('allowed','denied')),
  reason text,
  request_ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.realtime_subscription_audit TO authenticated;
GRANT ALL ON public.realtime_subscription_audit TO service_role;

ALTER TABLE public.realtime_subscription_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read realtime audit" ON public.realtime_subscription_audit;
CREATE POLICY "Admins read realtime audit"
  ON public.realtime_subscription_audit FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

DROP POLICY IF EXISTS "Service writes realtime audit" ON public.realtime_subscription_audit;
CREATE POLICY "Service writes realtime audit"
  ON public.realtime_subscription_audit FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Central authorization decider for realtime topics.
-- Returns TRUE only when the caller's JWT role + user matches the topic policy.
CREATE OR REPLACE FUNCTION public.authorize_realtime_topic(
  _user_id uuid,
  _stream text
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  is_admin boolean;
  is_ops   boolean;
  is_noc   boolean;
BEGIN
  IF _user_id IS NULL THEN RETURN false; END IF;
  is_admin := public.has_role(_user_id, 'admin') OR public.has_role(_user_id, 'super_admin');
  is_ops   := public.has_role(_user_id, 'ops') OR is_admin;
  is_noc   := public.has_role(_user_id, 'noc') OR is_admin;

  RETURN CASE
    WHEN _stream IN ('alerts_events','privileged_update_audit','forbidden_update_attempts') THEN is_admin
    WHEN _stream IN ('dispatch_surge_zones','dispatch_requests','dispatch_assignments')     THEN is_ops
    WHEN _stream IN ('service_alerts','service_incidents','system_health_events')           THEN is_noc
    WHEN _stream IN ('trip_tracking','trip_bookings')                                        THEN true  -- row-level RLS handles scoping
    ELSE false
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_realtime_topic(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.authorize_realtime_topic(uuid, text) TO authenticated, service_role;

-- Belt-and-braces: strip any sensitive tables still on the publication.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'fraud_alerts','fraud_cases','fraud_investigations','fraud_signals','fraud_rules',
    'financial_risk_events','payment_fraud_cases','payment_risk_events','payment_disputes',
    'chargebacks','account_takeover_alerts','authentication_events','login_risk_scores',
    'suspicious_transactions','wallet_freezes','wallet_abuse_cases','security_alerts',
    'security_incidents','security_events','trust_cases','trust_incidents','trust_investigations',
    'rider_fraud_signals','driver_risk_events','privileged_update_audit','forbidden_update_attempts',
    'admin_login_events','admin_audit_log','admin_sessions','admin_mfa_devices','admin_backup_codes',
    'trip_share_links'
  ])
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- =====================================================================
-- Phase 4: SECURITY DEFINER hardening — pin search_path, revoke PUBLIC EXECUTE
-- =====================================================================
DO $$
DECLARE r record;
  has_search_path boolean;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, p.oid, pg_get_function_identity_arguments(p.oid) AS args, p.proconfig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    has_search_path := false;
    IF r.proconfig IS NOT NULL THEN
      has_search_path := EXISTS (
        SELECT 1 FROM unnest(r.proconfig) c WHERE c LIKE 'search_path=%'
      );
    END IF;
    IF NOT has_search_path THEN
      EXECUTE format(
        'ALTER FUNCTION public.%I(%s) SET search_path = public, pg_temp',
        r.proname, r.args
      );
    END IF;
    -- Always revoke PUBLIC EXECUTE on definer functions; keep granted roles intact.
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC', r.proname, r.args);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
END $$;

-- Re-grant EXECUTE on functions that are legitimately called by app roles.
DO $$
DECLARE fn text;
BEGIN
  FOR fn IN SELECT unnest(ARRAY[
    'has_role(uuid, app_role)',
    'is_alert_muted(text, text)',
    'authorize_realtime_topic(uuid, text)'
  ])
  LOOP
    BEGIN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;
END $$;

-- =====================================================================
-- Signed, expiring, revocable one-time trip share tokens
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.trip_share_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_booking_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,      -- sha256(hex) of the raw token; raw never stored
  pin_hash text,                         -- optional bcrypt/sha256 pin
  max_uses int NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
  used_count int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trip_share_tokens_trip ON public.trip_share_tokens(trip_booking_id);
CREATE INDEX IF NOT EXISTS idx_trip_share_tokens_expires ON public.trip_share_tokens(expires_at);

GRANT SELECT, INSERT, UPDATE ON public.trip_share_tokens TO authenticated;
GRANT ALL ON public.trip_share_tokens TO service_role;

ALTER TABLE public.trip_share_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners manage own share tokens" ON public.trip_share_tokens;
CREATE POLICY "Owners manage own share tokens"
  ON public.trip_share_tokens FOR ALL
  TO authenticated
  USING (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.trip_share_access_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL,
  trip_booking_id uuid,
  ip inet,
  user_agent text,
  outcome text NOT NULL CHECK (outcome IN ('ok','invalid','expired','revoked','exhausted','pin_required','pin_wrong')),
  accessed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trip_share_access_token ON public.trip_share_access_log(token_hash);

GRANT SELECT ON public.trip_share_access_log TO authenticated;
GRANT ALL ON public.trip_share_access_log TO service_role;

ALTER TABLE public.trip_share_access_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner or admin reads share access log" ON public.trip_share_access_log;
CREATE POLICY "Owner or admin reads share access log"
  ON public.trip_share_access_log FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.trip_share_tokens t
      WHERE t.token_hash = trip_share_access_log.token_hash
        AND t.owner_id = auth.uid()
    )
  );

-- Owner-side issue helper: caller supplies pre-computed sha256 hash.
CREATE OR REPLACE FUNCTION public.issue_trip_share_token(
  _trip_booking_id uuid,
  _token_hash text,
  _pin_hash text,
  _ttl_seconds int,
  _max_uses int
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  new_id uuid;
  is_owner boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.trip_bookings b
    WHERE b.id = _trip_booking_id AND b.rider_id = auth.uid()
  ) INTO is_owner;
  IF NOT is_owner AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _ttl_seconds IS NULL OR _ttl_seconds <= 0 OR _ttl_seconds > 86400 THEN
    RAISE EXCEPTION 'invalid_ttl';
  END IF;
  INSERT INTO public.trip_share_tokens(
    trip_booking_id, owner_id, token_hash, pin_hash, expires_at, max_uses
  ) VALUES (
    _trip_booking_id, auth.uid(), _token_hash, _pin_hash,
    now() + make_interval(secs => _ttl_seconds),
    COALESCE(_max_uses, 1)
  )
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.issue_trip_share_token(uuid, text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_trip_share_token(uuid, text, text, int, int) TO authenticated;

-- Redeem: called by service-role edge function only.
CREATE OR REPLACE FUNCTION public.redeem_trip_share_token(
  _token_hash text,
  _pin_hash text,
  _ip inet,
  _user_agent text
) RETURNS TABLE(trip_booking_id uuid, outcome text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t public.trip_share_tokens%ROWTYPE;
  result_outcome text;
BEGIN
  SELECT * INTO t FROM public.trip_share_tokens WHERE token_hash = _token_hash FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.trip_share_access_log(token_hash, ip, user_agent, outcome)
    VALUES (_token_hash, _ip, _user_agent, 'invalid');
    RETURN QUERY SELECT NULL::uuid, 'invalid'::text;
    RETURN;
  END IF;
  IF t.revoked_at IS NOT NULL THEN result_outcome := 'revoked';
  ELSIF t.expires_at < now() THEN  result_outcome := 'expired';
  ELSIF t.used_count >= t.max_uses THEN result_outcome := 'exhausted';
  ELSIF t.pin_hash IS NOT NULL AND _pin_hash IS NULL THEN result_outcome := 'pin_required';
  ELSIF t.pin_hash IS NOT NULL AND t.pin_hash <> _pin_hash THEN result_outcome := 'pin_wrong';
  ELSE
    UPDATE public.trip_share_tokens SET used_count = used_count + 1 WHERE id = t.id;
    result_outcome := 'ok';
  END IF;
  INSERT INTO public.trip_share_access_log(token_hash, trip_booking_id, ip, user_agent, outcome)
  VALUES (_token_hash, t.trip_booking_id, _ip, _user_agent, result_outcome);
  RETURN QUERY SELECT CASE WHEN result_outcome='ok' THEN t.trip_booking_id ELSE NULL END, result_outcome;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_trip_share_token(text, text, inet, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_trip_share_token(text, text, inet, text) TO service_role;
