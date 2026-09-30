-- =========================================================
-- Yalla API Partners — credential lifecycle & usage telemetry
-- =========================================================

CREATE TYPE public.partner_api_environment AS ENUM ('sandbox', 'production');
CREATE TYPE public.partner_api_credential_status AS ENUM ('active', 'rotating', 'revoked');

CREATE TABLE public.partner_api_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  environment public.partner_api_environment NOT NULL DEFAULT 'sandbox',
  label text NOT NULL,
  client_id text NOT NULL UNIQUE,
  secret_hash text NOT NULL,
  secret_fingerprint text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  tier text NOT NULL DEFAULT 'integrate',
  status public.partner_api_credential_status NOT NULL DEFAULT 'active',
  rate_limit_per_min integer NOT NULL DEFAULT 2000,
  monthly_quota integer NOT NULL DEFAULT 500000,
  last_used_at timestamptz,
  rotated_at timestamptz,
  rotated_from uuid REFERENCES public.partner_api_credentials(id) ON DELETE SET NULL,
  grace_expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_partner_api_credentials_partner ON public.partner_api_credentials(partner_id, environment, status);

CREATE TABLE public.partner_api_credential_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id uuid REFERENCES public.partner_api_credentials(id) ON DELETE SET NULL,
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  action text NOT NULL,
  environment public.partner_api_environment NOT NULL,
  actor_id uuid,
  actor_label text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_partner_api_credential_audit_partner ON public.partner_api_credential_audit(partner_id, created_at DESC);

CREATE TABLE public.partner_api_usage_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  credential_id uuid REFERENCES public.partner_api_credentials(id) ON DELETE CASCADE,
  environment public.partner_api_environment NOT NULL,
  usage_date date NOT NULL,
  domain_key text NOT NULL DEFAULT 'all',
  requests integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  throttled integer NOT NULL DEFAULT 0,
  p95_latency_ms integer,
  UNIQUE (credential_id, environment, usage_date, domain_key)
);

CREATE INDEX idx_partner_api_usage_daily_lookup ON public.partner_api_usage_daily(partner_id, environment, usage_date DESC);

GRANT SELECT ON public.partner_api_credentials TO authenticated;
GRANT SELECT ON public.partner_api_credential_audit TO authenticated;
GRANT SELECT ON public.partner_api_usage_daily TO authenticated;
GRANT ALL ON public.partner_api_credentials TO service_role;
GRANT ALL ON public.partner_api_credential_audit TO service_role;
GRANT ALL ON public.partner_api_usage_daily TO service_role;

ALTER TABLE public.partner_api_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_api_credential_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_api_usage_daily ENABLE ROW LEVEL SECURITY;

-- Membership helper (security definer; avoids recursive RLS on partner_users)
CREATE OR REPLACE FUNCTION public.partner_api_is_member(_partner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.partner_users pu
    WHERE pu.partner_id = _partner_id
      AND pu.user_id = auth.uid()
      AND pu.is_active
  );
$$;

CREATE OR REPLACE FUNCTION public.partner_api_is_manager(_partner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.partner_users pu
    WHERE pu.partner_id = _partner_id
      AND pu.user_id = auth.uid()
      AND pu.is_active
      AND pu.partner_role::text IN ('owner', 'admin')
  );
$$;

GRANT EXECUTE ON FUNCTION public.partner_api_is_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.partner_api_is_manager(uuid) TO authenticated, service_role;

CREATE POLICY "partner members read credentials"
  ON public.partner_api_credentials FOR SELECT TO authenticated
  USING (public.partner_api_is_member(partner_id) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "partner members read credential audit"
  ON public.partner_api_credential_audit FOR SELECT TO authenticated
  USING (public.partner_api_is_member(partner_id) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "partner members read usage"
  ON public.partner_api_usage_daily FOR SELECT TO authenticated
  USING (public.partner_api_is_member(partner_id) OR public.has_role(auth.uid(), 'admin'));

-- Audit rows are append-only: no UPDATE/DELETE policies, plus a hard guard.
CREATE OR REPLACE FUNCTION public.partner_api_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'partner_api_credential_audit is append-only';
END;
$$;

CREATE TRIGGER trg_partner_api_audit_immutable
  BEFORE UPDATE OR DELETE ON public.partner_api_credential_audit
  FOR EACH ROW EXECUTE FUNCTION public.partner_api_audit_immutable();

-- ---------------------------------------------------------
-- Issue a credential. Returns the plaintext secret ONCE.
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_api_credential_issue(
  _partner_id uuid,
  _environment public.partner_api_environment,
  _label text,
  _scopes text[] DEFAULT '{}',
  _tier text DEFAULT 'integrate'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
  v_client_id text;
  v_row public.partner_api_credentials;
BEGIN
  IF NOT (public.partner_api_is_manager(_partner_id) OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'not authorised to issue partner API credentials';
  END IF;

  v_client_id := 'yc_' || CASE WHEN _environment = 'sandbox' THEN 'sbx_' ELSE 'live_' END
                 || replace(gen_random_uuid()::text, '-', '');
  v_secret := 'ys_' || CASE WHEN _environment = 'sandbox' THEN 'sbx_' ELSE 'live_' END
              || encode(gen_random_bytes(32), 'hex');

  INSERT INTO public.partner_api_credentials (
    partner_id, environment, label, client_id, secret_hash, secret_fingerprint,
    scopes, tier, created_by,
    rate_limit_per_min, monthly_quota
  ) VALUES (
    _partner_id, _environment, _label, v_client_id,
    encode(digest(v_secret, 'sha256'), 'hex'),
    right(v_secret, 6),
    COALESCE(_scopes, '{}'), COALESCE(_tier, 'integrate'), auth.uid(),
    CASE _tier WHEN 'infrastructure' THEN 25000 WHEN 'scale' THEN 10000 ELSE 2000 END,
    CASE _tier WHEN 'infrastructure' THEN 5000000 WHEN 'scale' THEN 2000000 ELSE 500000 END
  ) RETURNING * INTO v_row;

  INSERT INTO public.partner_api_credential_audit (credential_id, partner_id, action, environment, actor_id, metadata)
  VALUES (v_row.id, _partner_id, 'created', _environment, auth.uid(),
          jsonb_build_object('label', _label, 'scopes', COALESCE(_scopes, '{}'), 'tier', _tier));

  RETURN jsonb_build_object(
    'credential_id', v_row.id,
    'client_id', v_row.client_id,
    'client_secret', v_secret,
    'environment', _environment,
    'scopes', v_row.scopes,
    'tier', v_row.tier
  );
END;
$$;

-- ---------------------------------------------------------
-- Rotate: mint a replacement, put the old one in grace.
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_api_credential_rotate(
  _credential_id uuid,
  _grace_hours integer DEFAULT 24,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old public.partner_api_credentials;
  v_secret text;
  v_client_id text;
  v_new public.partner_api_credentials;
BEGIN
  SELECT * INTO v_old FROM public.partner_api_credentials WHERE id = _credential_id;
  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'credential not found';
  END IF;
  IF NOT (public.partner_api_is_manager(v_old.partner_id) OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'not authorised to rotate partner API credentials';
  END IF;
  IF v_old.status = 'revoked' THEN
    RAISE EXCEPTION 'cannot rotate a revoked credential';
  END IF;

  v_client_id := 'yc_' || CASE WHEN v_old.environment = 'sandbox' THEN 'sbx_' ELSE 'live_' END
                 || replace(gen_random_uuid()::text, '-', '');
  v_secret := 'ys_' || CASE WHEN v_old.environment = 'sandbox' THEN 'sbx_' ELSE 'live_' END
              || encode(gen_random_bytes(32), 'hex');

  INSERT INTO public.partner_api_credentials (
    partner_id, environment, label, client_id, secret_hash, secret_fingerprint,
    scopes, tier, created_by, rotated_from, rotated_at,
    rate_limit_per_min, monthly_quota
  ) VALUES (
    v_old.partner_id, v_old.environment, v_old.label, v_client_id,
    encode(digest(v_secret, 'sha256'), 'hex'), right(v_secret, 6),
    v_old.scopes, v_old.tier, auth.uid(), v_old.id, now(),
    v_old.rate_limit_per_min, v_old.monthly_quota
  ) RETURNING * INTO v_new;

  UPDATE public.partner_api_credentials
     SET status = 'rotating',
         grace_expires_at = now() + make_interval(hours => GREATEST(0, COALESCE(_grace_hours, 24))),
         updated_at = now()
   WHERE id = v_old.id;

  INSERT INTO public.partner_api_credential_audit (credential_id, partner_id, action, environment, actor_id, reason, metadata)
  VALUES (v_new.id, v_old.partner_id, 'rotated', v_old.environment, auth.uid(), _reason,
          jsonb_build_object('replaces', v_old.client_id, 'grace_hours', COALESCE(_grace_hours, 24)));

  RETURN jsonb_build_object(
    'credential_id', v_new.id,
    'client_id', v_new.client_id,
    'client_secret', v_secret,
    'environment', v_new.environment,
    'replaces_client_id', v_old.client_id,
    'grace_expires_at', now() + make_interval(hours => GREATEST(0, COALESCE(_grace_hours, 24)))
  );
END;
$$;

-- ---------------------------------------------------------
-- Revoke immediately.
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.partner_api_credential_revoke(
  _credential_id uuid,
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.partner_api_credentials;
BEGIN
  SELECT * INTO v_row FROM public.partner_api_credentials WHERE id = _credential_id;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'credential not found';
  END IF;
  IF NOT (public.partner_api_is_manager(v_row.partner_id) OR public.has_role(auth.uid(), 'admin')) THEN
    RAISE EXCEPTION 'not authorised to revoke partner API credentials';
  END IF;

  UPDATE public.partner_api_credentials
     SET status = 'revoked', revoked_at = now(), revoked_by = auth.uid(),
         revoke_reason = _reason, grace_expires_at = NULL, updated_at = now()
   WHERE id = _credential_id;

  INSERT INTO public.partner_api_credential_audit (credential_id, partner_id, action, environment, actor_id, reason)
  VALUES (_credential_id, v_row.partner_id, 'revoked', v_row.environment, auth.uid(), _reason);
END;
$$;

GRANT EXECUTE ON FUNCTION public.partner_api_credential_issue(uuid, public.partner_api_environment, text, text[], text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.partner_api_credential_rotate(uuid, integer, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.partner_api_credential_revoke(uuid, text) TO authenticated, service_role;