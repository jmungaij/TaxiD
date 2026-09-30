-- ============================================================
-- SOCIAL DISTRIBUTION & BRAND ENTITY PLATFORM
-- ============================================================

CREATE TABLE IF NOT EXISTS public.social_platforms (
  slug            text PRIMARY KEY,
  name            text NOT NULL,
  icon_key        text NOT NULL,
  hostnames       text[] NOT NULL,
  purpose         text NOT NULL,
  channel_kind    text NOT NULL DEFAULT 'PROFILE' CHECK (channel_kind IN ('PROFILE','CONVERSATION')),
  enabled         boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 100,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.social_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_slug       text NOT NULL REFERENCES public.social_platforms(slug) ON DELETE RESTRICT,
  market              text NOT NULL DEFAULT 'GLOBAL',
  display_name        text NOT NULL,
  handle              text,
  profile_url         text,
  status              text NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','PENDING_VERIFICATION','VERIFIED','APPROVED','ACTIVE','SUSPENDED','ARCHIVED')),
  verification_status text NOT NULL DEFAULT 'UNVERIFIED'
                      CHECK (verification_status IN ('UNVERIFIED','VERIFIED')),
  ownership_evidence  text,
  is_public           boolean NOT NULL DEFAULT false,
  is_active           boolean NOT NULL DEFAULT false,
  aria_label          text,
  tracking_enabled    boolean NOT NULL DEFAULT true,
  campaign_source     text,
  sort_order          integer NOT NULL DEFAULT 100,
  verified_by         uuid,
  verified_at         timestamptz,
  approved_by         uuid,
  approved_at         timestamptz,
  activated_by        uuid,
  activated_at        timestamptz,
  archived_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform_slug, market)
);

CREATE TABLE IF NOT EXISTS public.social_account_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid REFERENCES public.social_accounts(id) ON DELETE SET NULL,
  platform_slug  text,
  actor_user_id  uuid,
  action         text NOT NULL,
  old_value      jsonb,
  new_value      jsonb,
  reason         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_account_events_account_idx ON public.social_account_events(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.social_link_health (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  checked_at      timestamptz NOT NULL DEFAULT now(),
  state           text NOT NULL CHECK (state IN ('HEALTHY','REDIRECTED','UNREACHABLE','INVALID','SUSPENDED','PENDING_REVIEW')),
  http_status     integer,
  redirect_target text,
  attempt         integer NOT NULL DEFAULT 1,
  error_detail    text
);
CREATE INDEX IF NOT EXISTS social_link_health_account_idx ON public.social_link_health(account_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS public.social_campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,
  objective     text,
  platform_slug text REFERENCES public.social_platforms(slug) ON DELETE SET NULL,
  market        text NOT NULL DEFAULT 'GLOBAL',
  landing_path  text NOT NULL DEFAULT '/',
  utm_source    text NOT NULL,
  utm_medium    text NOT NULL DEFAULT 'social',
  utm_campaign  text NOT NULL,
  start_date    date,
  end_date      date,
  status        text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','PAUSED','ENDED')),
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- grants ----------
GRANT SELECT ON public.social_platforms TO anon, authenticated;
GRANT ALL    ON public.social_platforms TO service_role;
GRANT SELECT ON public.social_accounts TO anon, authenticated;
GRANT ALL    ON public.social_accounts TO service_role;
GRANT SELECT ON public.social_account_events TO authenticated;
GRANT ALL    ON public.social_account_events TO service_role;
GRANT SELECT ON public.social_link_health TO authenticated;
GRANT ALL    ON public.social_link_health TO service_role;
GRANT SELECT ON public.social_campaigns TO authenticated;
GRANT ALL    ON public.social_campaigns TO service_role;

-- ---------- RLS ----------
ALTER TABLE public.social_platforms      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_accounts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_account_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_link_health    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_campaigns      ENABLE ROW LEVEL SECURITY;

CREATE POLICY social_platforms_public_read ON public.social_platforms
  FOR SELECT TO anon, authenticated USING (enabled = true);
CREATE POLICY social_platforms_admin_write ON public.social_platforms
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin'));

-- Publication gate: only verified + active + public accounts are ever readable
-- by the public. Everything else is admin-only.
CREATE POLICY social_accounts_published_read ON public.social_accounts
  FOR SELECT TO anon, authenticated
  USING (status = 'ACTIVE' AND verification_status = 'VERIFIED' AND is_public = true AND is_active = true AND profile_url IS NOT NULL);
CREATE POLICY social_accounts_admin_read ON public.social_accounts
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin'));

CREATE POLICY social_account_events_admin_read ON public.social_account_events
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin'));
CREATE POLICY social_link_health_admin_read ON public.social_link_health
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin'));
CREATE POLICY social_campaigns_staff_read ON public.social_campaigns
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'operations_admin'));
CREATE POLICY social_campaigns_admin_write ON public.social_campaigns
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin'));

-- Audit trail is append-only.
CREATE OR REPLACE FUNCTION public.social_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'social_account_events is append-only';
END $$;
DROP TRIGGER IF EXISTS social_events_append_only_trg ON public.social_account_events;
CREATE TRIGGER social_events_append_only_trg
  BEFORE UPDATE OR DELETE ON public.social_account_events
  FOR EACH ROW EXECUTE FUNCTION public.social_events_append_only();

-- Direct writes are impossible: no INSERT/UPDATE/DELETE policy exists for
-- authenticated users. All mutation happens through the routines below.

-- ---------- seed platforms ----------
INSERT INTO public.social_platforms (slug, name, icon_key, hostnames, purpose, channel_kind, sort_order) VALUES
  ('linkedin','LinkedIn','linkedin', ARRAY['linkedin.com','www.linkedin.com'], 'Corporate reputation, B2B, partnerships, recruitment, enterprise mobility','PROFILE',10),
  ('facebook','Facebook','facebook', ARRAY['facebook.com','www.facebook.com','fb.com','web.facebook.com'], 'Broad consumer reach, community, announcements','PROFILE',20),
  ('instagram','Instagram','instagram', ARRAY['instagram.com','www.instagram.com'], 'Visual brand, lifestyle, travel, mobility stories','PROFILE',30),
  ('youtube','YouTube','youtube', ARRAY['youtube.com','www.youtube.com','m.youtube.com'], 'Long-form video, explainers, safety, corporate stories','PROFILE',40),
  ('tiktok','TikTok','tiktok', ARRAY['tiktok.com','www.tiktok.com'], 'Short-form discovery, culture, mobility education','PROFILE',50),
  ('x','X','x', ARRAY['x.com','www.x.com','twitter.com','www.twitter.com'], 'Real-time updates, announcements, public conversation','PROFILE',60),
  ('whatsapp','WhatsApp','whatsapp', ARRAY['wa.me','api.whatsapp.com','web.whatsapp.com','whatsapp.com'], 'Direct customer conversation, support and lead conversion','CONVERSATION',70)
ON CONFLICT (slug) DO NOTHING;

-- ---------- seed the seven official accounts in DRAFT ----------
INSERT INTO public.social_accounts (platform_slug, market, display_name, aria_label, campaign_source, sort_order)
SELECT p.slug, 'GLOBAL', 'Yalla Mobility on ' || p.name, 'Yalla Mobility on ' || p.name, p.slug, p.sort_order
FROM public.social_platforms p
ON CONFLICT (platform_slug, market) DO NOTHING;

-- ---------- validation + lifecycle ----------
CREATE OR REPLACE FUNCTION public.social_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin')
$$;

CREATE OR REPLACE FUNCTION public.social_validate_url(_platform text, _url text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE host text; allowed text[];
BEGIN
  IF _url IS NULL OR _url = '' THEN RETURN false; END IF;
  IF _url !~* '^https://[a-z0-9.-]+\.[a-z]{2,}(/[^\s<>"'']*)?$' THEN RETURN false; END IF;
  host := lower(split_part(regexp_replace(_url, '^https://', ''), '/', 1));
  SELECT hostnames INTO allowed FROM public.social_platforms WHERE slug = _platform;
  IF allowed IS NULL THEN RETURN false; END IF;
  RETURN host = ANY(allowed);
END $$;

CREATE OR REPLACE FUNCTION public.social_transition_allowed(_from text, _to text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT (_from, _to) IN (
    ('DRAFT','PENDING_VERIFICATION'),
    ('PENDING_VERIFICATION','PENDING_VERIFICATION'),
    ('PENDING_VERIFICATION','VERIFIED'),
    ('PENDING_VERIFICATION','DRAFT'),
    ('VERIFIED','APPROVED'),
    ('VERIFIED','PENDING_VERIFICATION'),
    ('APPROVED','ACTIVE'),
    ('APPROVED','PENDING_VERIFICATION'),
    ('ACTIVE','SUSPENDED'),
    ('ACTIVE','PENDING_VERIFICATION'),
    ('SUSPENDED','ACTIVE'),
    ('SUSPENDED','ARCHIVED'),
    ('DRAFT','ARCHIVED'),
    ('ARCHIVED','DRAFT')
  )
$$;

CREATE OR REPLACE FUNCTION public.social_log_event(_account uuid, _action text, _old jsonb, _new jsonb, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.social_account_events (account_id, platform_slug, actor_user_id, action, old_value, new_value, reason)
  VALUES (_account, (SELECT platform_slug FROM public.social_accounts WHERE id = _account), auth.uid(), _action, _old, _new, _reason);
END $$;

CREATE OR REPLACE FUNCTION public.social_apply_transition(
  _account uuid, _action text, _to_status text,
  _url text DEFAULT NULL, _handle text DEFAULT NULL, _display_name text DEFAULT NULL,
  _evidence text DEFAULT NULL, _reason text DEFAULT NULL
) RETURNS public.social_accounts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE before_row public.social_accounts; after_row public.social_accounts;
BEGIN
  IF NOT public.social_is_admin() THEN
    RAISE EXCEPTION 'not_authorized: social account administration requires admin or super_admin';
  END IF;
  SELECT * INTO before_row FROM public.social_accounts WHERE id = _account FOR UPDATE;
  IF before_row.id IS NULL THEN RAISE EXCEPTION 'not_found: social account %', _account; END IF;
  IF NOT public.social_transition_allowed(before_row.status, _to_status) THEN
    RAISE EXCEPTION 'invalid_transition: % -> %', before_row.status, _to_status;
  END IF;

  IF _action = 'SOCIAL_URL_CHANGED' THEN
    IF NOT public.social_validate_url(before_row.platform_slug, _url) THEN
      RAISE EXCEPTION 'invalid_url: % is not an approved https destination for %', _url, before_row.platform_slug;
    END IF;
  END IF;

  IF _to_status = 'VERIFIED' AND (before_row.profile_url IS NULL AND _url IS NULL) THEN
    RAISE EXCEPTION 'no_url: an official destination must be supplied before verification';
  END IF;

  IF _to_status = 'ACTIVE' AND NOT (before_row.verification_status = 'VERIFIED' AND before_row.approved_at IS NOT NULL AND before_row.profile_url IS NOT NULL) THEN
    RAISE EXCEPTION 'not_publishable: account must be verified, approved and hold a destination';
  END IF;

  UPDATE public.social_accounts SET
    profile_url         = COALESCE(_url, profile_url),
    handle              = COALESCE(_handle, handle),
    display_name        = COALESCE(_display_name, display_name),
    ownership_evidence  = COALESCE(_evidence, ownership_evidence),
    status              = _to_status,
    verification_status = CASE
                            WHEN _action = 'SOCIAL_URL_CHANGED' THEN 'UNVERIFIED'
                            WHEN _to_status = 'VERIFIED' THEN 'VERIFIED'
                            ELSE verification_status END,
    verified_by         = CASE WHEN _to_status = 'VERIFIED' THEN auth.uid() ELSE verified_by END,
    verified_at         = CASE WHEN _to_status = 'VERIFIED' THEN now() ELSE verified_at END,
    approved_by         = CASE WHEN _to_status = 'APPROVED' THEN auth.uid() ELSE approved_by END,
    approved_at         = CASE WHEN _to_status = 'APPROVED' THEN now() ELSE approved_at END,
    activated_by        = CASE WHEN _to_status = 'ACTIVE' THEN auth.uid() ELSE activated_by END,
    activated_at        = CASE WHEN _to_status = 'ACTIVE' THEN now() ELSE activated_at END,
    archived_at         = CASE WHEN _to_status = 'ARCHIVED' THEN now() ELSE NULL END,
    is_active           = (_to_status = 'ACTIVE'),
    is_public           = (_to_status = 'ACTIVE'),
    updated_at          = now()
  WHERE id = _account
  RETURNING * INTO after_row;

  PERFORM public.social_log_event(
    _account, _action,
    to_jsonb(before_row) - 'created_at', to_jsonb(after_row) - 'created_at', _reason);
  RETURN after_row;
END $$;

CREATE OR REPLACE FUNCTION public.social_set_url(_account uuid, _url text, _handle text DEFAULT NULL, _display_name text DEFAULT NULL, _reason text DEFAULT NULL)
RETURNS public.social_accounts LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.social_apply_transition(_account,'SOCIAL_URL_CHANGED','PENDING_VERIFICATION',_url,_handle,_display_name,NULL,_reason)
$$;

CREATE OR REPLACE FUNCTION public.social_verify_account(_account uuid, _evidence text, _reason text DEFAULT NULL)
RETURNS public.social_accounts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _evidence IS NULL OR length(btrim(_evidence)) < 10 THEN
    RAISE EXCEPTION 'evidence_required: record how ownership of this account was proven';
  END IF;
  RETURN public.social_apply_transition(_account,'SOCIAL_ACCOUNT_VERIFIED','VERIFIED',NULL,NULL,NULL,_evidence,_reason);
END $$;

CREATE OR REPLACE FUNCTION public.social_approve_account(_account uuid, _reason text DEFAULT NULL)
RETURNS public.social_accounts LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.social_apply_transition(_account,'SOCIAL_ACCOUNT_APPROVED','APPROVED',NULL,NULL,NULL,NULL,_reason)
$$;

CREATE OR REPLACE FUNCTION public.social_activate_account(_account uuid, _reason text DEFAULT NULL)
RETURNS public.social_accounts LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.social_apply_transition(_account,'SOCIAL_ACCOUNT_ACTIVATED','ACTIVE',NULL,NULL,NULL,NULL,_reason)
$$;

CREATE OR REPLACE FUNCTION public.social_deactivate_account(_account uuid, _reason text DEFAULT NULL)
RETURNS public.social_accounts LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.social_apply_transition(_account,'SOCIAL_ACCOUNT_SUSPENDED','SUSPENDED',NULL,NULL,NULL,NULL,_reason)
$$;

CREATE OR REPLACE FUNCTION public.social_archive_account(_account uuid, _reason text DEFAULT NULL)
RETURNS public.social_accounts LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.social_apply_transition(_account,'SOCIAL_ACCOUNT_ARCHIVED','ARCHIVED',NULL,NULL,NULL,NULL,_reason)
$$;

CREATE OR REPLACE FUNCTION public.social_record_health(_account uuid, _state text, _http_status integer DEFAULT NULL, _redirect text DEFAULT NULL, _attempt integer DEFAULT 1, _error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.social_is_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  INSERT INTO public.social_link_health (account_id, state, http_status, redirect_target, attempt, error_detail)
  VALUES (_account, _state, _http_status, _redirect, _attempt, _error);
END $$;

REVOKE ALL ON FUNCTION public.social_apply_transition(uuid,text,text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.social_set_url(uuid,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_verify_account(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_approve_account(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_activate_account(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_deactivate_account(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_archive_account(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_record_health(uuid,text,integer,text,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_validate_url(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_transition_allowed(text,text) TO authenticated;

-- ============================================================
-- SECURITY REMEDIATION
-- ============================================================

-- 1. Charter booking owners may not touch financial columns.
CREATE OR REPLACE FUNCTION public.charter_bookings_guard_financials()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'finance_admin') OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  NEW.payment_status              := OLD.payment_status;
  NEW.commission_bps              := OLD.commission_bps;
  NEW.commission_cents            := OLD.commission_cents;
  NEW.partner_entitlement_cents   := OLD.partner_entitlement_cents;
  NEW.financials_source           := OLD.financials_source;
  NEW.total_amount                := OLD.total_amount;
  NEW.currency                    := OLD.currency;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS charter_bookings_guard_financials_trg ON public.charter_bookings;
CREATE TRIGGER charter_bookings_guard_financials_trg
  BEFORE UPDATE ON public.charter_bookings
  FOR EACH ROW EXECUTE FUNCTION public.charter_bookings_guard_financials();

-- 2. Drivers may not self-verify compliance documents.
DROP POLICY IF EXISTS "Driver updates own pending docs" ON public.driver_documents;
CREATE POLICY "Driver updates own pending docs" ON public.driver_documents
  FOR UPDATE TO authenticated
  USING (driver_id = auth.uid() AND status = 'PENDING')
  WITH CHECK (driver_id = auth.uid() AND status = 'PENDING');

-- 3. Replace SECURITY DEFINER views with explicit read-only routines.
DROP VIEW IF EXISTS public.city_pricing_public;
DROP VIEW IF EXISTS public.surge_rules_public;

CREATE OR REPLACE FUNCTION public.city_pricing_public()
RETURNS TABLE (
  category_slug text, city text, country_code text,
  base_fare_override numeric, per_km_override numeric, per_min_override numeric, minimum_fare_override numeric,
  fuel_cost_per_km numeric, maintenance_per_km numeric, insurance_monthly numeric,
  avg_trips_per_hour numeric, avg_km_per_trip numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT category_slug, city, country_code,
         base_fare_override, per_km_override, per_min_override, minimum_fare_override,
         fuel_cost_per_km, maintenance_per_km, insurance_monthly,
         avg_trips_per_hour, avg_km_per_trip
  FROM public.city_pricing_rules
  WHERE is_active = true
$$;

CREATE OR REPLACE FUNCTION public.surge_rules_public()
RETURNS TABLE (city text, category_slug text, hour_of_week integer, multiplier numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT city, category_slug, hour_of_week, multiplier
  FROM public.surge_rules
  WHERE is_active = true
$$;

GRANT EXECUTE ON FUNCTION public.city_pricing_public() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.surge_rules_public() TO anon, authenticated;