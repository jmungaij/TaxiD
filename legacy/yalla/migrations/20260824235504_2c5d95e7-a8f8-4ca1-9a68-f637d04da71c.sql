-- =========================================================
-- Yalla White-Label Partners — tenancy, ops console, evidence
-- =========================================================

CREATE TYPE public.partner_wl_tenant_status AS ENUM ('draft','provisioning','certifying','live','suspended');
CREATE TYPE public.partner_wl_incident_status AS ENUM ('open','mitigating','monitoring','resolved','closed');
CREATE TYPE public.partner_wl_change_status AS ENUM ('proposed','approved','applied','rolled_back','rejected');

-- ---------- 1. tenants ----------
CREATE TABLE public.partner_wl_tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  tenant_code text NOT NULL UNIQUE,
  display_name text NOT NULL,
  environment public.partner_api_environment NOT NULL DEFAULT 'sandbox',
  status public.partner_wl_tenant_status NOT NULL DEFAULT 'draft',
  markets text[] NOT NULL DEFAULT '{}',
  services text[] NOT NULL DEFAULT '{}',
  certified_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_partner_wl_tenants_partner ON public.partner_wl_tenants(partner_id, environment, status);

GRANT SELECT ON public.partner_wl_tenants TO authenticated;
GRANT ALL ON public.partner_wl_tenants TO service_role;
ALTER TABLE public.partner_wl_tenants ENABLE ROW LEVEL SECURITY;

-- ---------- 2. brand configuration ----------
CREATE TABLE public.partner_wl_brand_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.partner_wl_tenants(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  logo_url text,
  primary_color text,
  accent_color text,
  font_family text,
  email_sender_name text,
  support_email text,
  legal_entity text,
  policy_url text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.partner_wl_brand_config TO authenticated;
GRANT ALL ON public.partner_wl_brand_config TO service_role;
ALTER TABLE public.partner_wl_brand_config ENABLE ROW LEVEL SECURITY;

-- ---------- 3. environments ----------
CREATE TABLE public.partner_wl_environments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.partner_wl_tenants(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  environment public.partner_api_environment NOT NULL,
  base_url text NOT NULL,
  webhook_url text,
  webhook_secret_fingerprint text,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, environment)
);
GRANT SELECT ON public.partner_wl_environments TO authenticated;
GRANT ALL ON public.partner_wl_environments TO service_role;
ALTER TABLE public.partner_wl_environments ENABLE ROW LEVEL SECURITY;

-- ---------- 4. incidents ----------
CREATE TABLE public.partner_wl_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.partner_wl_tenants(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  reference text NOT NULL,
  severity text NOT NULL DEFAULT 'sev3',
  title text NOT NULL,
  detail text,
  status public.partner_wl_incident_status NOT NULL DEFAULT 'open',
  correlation_id text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_partner_wl_incidents_tenant ON public.partner_wl_incidents(tenant_id, status, opened_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.partner_wl_incidents TO authenticated;
GRANT ALL ON public.partner_wl_incidents TO service_role;
ALTER TABLE public.partner_wl_incidents ENABLE ROW LEVEL SECURITY;

-- ---------- 5. change management ----------
CREATE TABLE public.partner_wl_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.partner_wl_tenants(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  change_class text NOT NULL,
  title text NOT NULL,
  detail text,
  rollback_plan text,
  status public.partner_wl_change_status NOT NULL DEFAULT 'proposed',
  requested_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_partner_wl_changes_tenant ON public.partner_wl_changes(tenant_id, status, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.partner_wl_changes TO authenticated;
GRANT ALL ON public.partner_wl_changes TO service_role;
ALTER TABLE public.partner_wl_changes ENABLE ROW LEVEL SECURITY;

-- ---------- 6. append-only, hash-chained evidence ----------
CREATE TABLE public.partner_wl_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.partner_wl_tenants(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  kind text NOT NULL,
  subject_ref text,
  statement text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash text,
  entry_hash text NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_partner_wl_evidence_tenant ON public.partner_wl_evidence(tenant_id, created_at DESC);
GRANT SELECT ON public.partner_wl_evidence TO authenticated;
GRANT ALL ON public.partner_wl_evidence TO service_role;
ALTER TABLE public.partner_wl_evidence ENABLE ROW LEVEL SECURITY;

-- ---------- 7. production readiness checklist ----------
CREATE TABLE public.partner_wl_readiness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.partner_wl_tenants(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  evidence_ref text,
  note text,
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, item_key)
);
GRANT SELECT, INSERT, UPDATE ON public.partner_wl_readiness TO authenticated;
GRANT ALL ON public.partner_wl_readiness TO service_role;
ALTER TABLE public.partner_wl_readiness ENABLE ROW LEVEL SECURITY;

-- ---------- RLS ----------
CREATE POLICY "wl members read tenants" ON public.partner_wl_tenants
  FOR SELECT TO authenticated
  USING (public.partner_api_is_member(partner_id) OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "wl members read brand" ON public.partner_wl_brand_config
  FOR SELECT TO authenticated
  USING (public.partner_api_is_member(partner_id) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "wl managers write brand" ON public.partner_wl_brand_config
  FOR UPDATE TO authenticated
  USING (public.partner_api_is_manager(partner_id) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.partner_api_is_manager(partner_id) OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "wl members read environments" ON public.partner_wl_environments
  FOR SELECT TO authenticated
  USING (public.partner_api_is_member(partner_id) OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "wl members read incidents" ON public.partner_wl_incidents
  FOR SELECT TO authenticated
  USING (public.partner_api_is_member(partner_id) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "wl managers insert incidents" ON public.partner_wl_incidents
  FOR INSERT TO authenticated
  WITH CHECK (public.partner_api_is_manager(partner_id) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "wl managers update incidents" ON public.partner_wl_incidents
  FOR UPDATE TO authenticated
  USING (public.partner_api_is_manager(partner_id) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.partner_api_is_manager(partner_id) OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "wl members read changes" ON public.partner_wl_changes
  FOR SELECT TO authenticated
  USING (public.partner_api_is_member(partner_id) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "wl managers insert changes" ON public.partner_wl_changes
  FOR INSERT TO authenticated
  WITH CHECK (public.partner_api_is_manager(partner_id) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "wl managers update changes" ON public.partner_wl_changes
  FOR UPDATE TO authenticated
  USING (public.partner_api_is_manager(partner_id) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.partner_api_is_manager(partner_id) OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "wl members read evidence" ON public.partner_wl_evidence
  FOR SELECT TO authenticated
  USING (public.partner_api_is_member(partner_id) OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "wl members read readiness" ON public.partner_wl_readiness
  FOR SELECT TO authenticated
  USING (public.partner_api_is_member(partner_id) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "wl managers insert readiness" ON public.partner_wl_readiness
  FOR INSERT TO authenticated
  WITH CHECK (public.partner_api_is_manager(partner_id) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "wl managers update readiness" ON public.partner_wl_readiness
  FOR UPDATE TO authenticated
  USING (public.partner_api_is_manager(partner_id) OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.partner_api_is_manager(partner_id) OR public.has_role(auth.uid(),'admin'));

-- evidence is append-only
CREATE OR REPLACE FUNCTION public.partner_wl_evidence_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'partner_wl_evidence is append-only';
END;
$$;
CREATE TRIGGER trg_partner_wl_evidence_immutable
  BEFORE UPDATE OR DELETE ON public.partner_wl_evidence
  FOR EACH ROW EXECUTE FUNCTION public.partner_wl_evidence_immutable();

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.partner_wl_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_wl_tenants_touch BEFORE UPDATE ON public.partner_wl_tenants FOR EACH ROW EXECUTE FUNCTION public.partner_wl_touch();
CREATE TRIGGER trg_wl_brand_touch BEFORE UPDATE ON public.partner_wl_brand_config FOR EACH ROW EXECUTE FUNCTION public.partner_wl_touch();
CREATE TRIGGER trg_wl_env_touch BEFORE UPDATE ON public.partner_wl_environments FOR EACH ROW EXECUTE FUNCTION public.partner_wl_touch();
CREATE TRIGGER trg_wl_inc_touch BEFORE UPDATE ON public.partner_wl_incidents FOR EACH ROW EXECUTE FUNCTION public.partner_wl_touch();
CREATE TRIGGER trg_wl_chg_touch BEFORE UPDATE ON public.partner_wl_changes FOR EACH ROW EXECUTE FUNCTION public.partner_wl_touch();
CREATE TRIGGER trg_wl_rdy_touch BEFORE UPDATE ON public.partner_wl_readiness FOR EACH ROW EXECUTE FUNCTION public.partner_wl_touch();

-- ---------- evidence writer (hash chain) ----------
CREATE OR REPLACE FUNCTION public.partner_wl_record_evidence(
  _tenant_id uuid,
  _kind text,
  _statement text,
  _subject_ref text DEFAULT NULL,
  _payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_partner uuid;
  v_prev text;
  v_hash text;
  v_id uuid;
BEGIN
  SELECT partner_id INTO v_partner FROM public.partner_wl_tenants WHERE id = _tenant_id;
  IF v_partner IS NULL THEN RAISE EXCEPTION 'tenant not found'; END IF;
  IF NOT (public.partner_api_is_manager(v_partner) OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'not authorised to record tenant evidence';
  END IF;

  SELECT entry_hash INTO v_prev FROM public.partner_wl_evidence
   WHERE tenant_id = _tenant_id ORDER BY created_at DESC, id DESC LIMIT 1;

  v_hash := encode(digest(
    COALESCE(v_prev,'genesis') || '|' || _tenant_id::text || '|' || _kind || '|' ||
    COALESCE(_subject_ref,'') || '|' || _statement || '|' || COALESCE(_payload::text,'{}'),
    'sha256'), 'hex');

  INSERT INTO public.partner_wl_evidence (tenant_id, partner_id, kind, subject_ref, statement, payload, prev_hash, entry_hash, actor_id)
  VALUES (_tenant_id, v_partner, _kind, _subject_ref, _statement, COALESCE(_payload,'{}'::jsonb), v_prev, v_hash, auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('evidence_id', v_id, 'entry_hash', v_hash, 'prev_hash', v_prev);
END;
$$;
GRANT EXECUTE ON FUNCTION public.partner_wl_record_evidence(uuid, text, text, text, jsonb) TO authenticated, service_role;

-- ---------- provisioning workflow ----------
CREATE OR REPLACE FUNCTION public.partner_wl_provision_tenant(
  _partner_id uuid,
  _tenant_code text,
  _display_name text,
  _brand jsonb DEFAULT '{}'::jsonb,
  _markets text[] DEFAULT '{}',
  _services text[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant public.partner_wl_tenants;
  v_code text;
  v_cred jsonb;
BEGIN
  IF NOT (public.partner_api_is_manager(_partner_id) OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'not authorised to provision a white-label tenant';
  END IF;

  v_code := lower(regexp_replace(COALESCE(_tenant_code,''), '[^a-zA-Z0-9]+', '-', 'g'));
  IF length(v_code) < 3 THEN RAISE EXCEPTION 'tenant code must be at least 3 characters'; END IF;
  IF EXISTS (SELECT 1 FROM public.partner_wl_tenants WHERE tenant_code = v_code) THEN
    RAISE EXCEPTION 'tenant code already in use';
  END IF;

  INSERT INTO public.partner_wl_tenants (partner_id, tenant_code, display_name, environment, status, markets, services, created_by)
  VALUES (_partner_id, v_code, _display_name, 'sandbox', 'provisioning',
          COALESCE(_markets,'{}'), COALESCE(_services,'{}'), auth.uid())
  RETURNING * INTO v_tenant;

  INSERT INTO public.partner_wl_brand_config (
    tenant_id, partner_id, logo_url, primary_color, accent_color, font_family,
    email_sender_name, support_email, legal_entity, policy_url, updated_by
  ) VALUES (
    v_tenant.id, _partner_id,
    _brand->>'logo_url', _brand->>'primary_color', _brand->>'accent_color', _brand->>'font_family',
    _brand->>'email_sender_name', _brand->>'support_email', _brand->>'legal_entity', _brand->>'policy_url',
    auth.uid()
  );

  INSERT INTO public.partner_wl_environments (tenant_id, partner_id, environment, base_url, is_enabled)
  VALUES
    (v_tenant.id, _partner_id, 'sandbox', 'https://sandbox.api.yalla.africa/v1', true),
    (v_tenant.id, _partner_id, 'production', 'https://api.yalla.africa/v1', false);

  v_cred := public.partner_api_credential_issue(_partner_id, 'sandbox',
              'White-label ' || v_code || ' sandbox', '{}'::text[], 'integrate');

  PERFORM public.partner_wl_record_evidence(
    v_tenant.id, 'provisioning',
    'Tenant provisioned with brand configuration, sandbox and production environments and an initial sandbox credential.',
    v_code,
    jsonb_build_object('markets', COALESCE(_markets,'{}'), 'services', COALESCE(_services,'{}'),
                       'credential_id', v_cred->>'credential_id')
  );

  RETURN jsonb_build_object(
    'tenant_id', v_tenant.id,
    'tenant_code', v_code,
    'status', v_tenant.status,
    'credential', v_cred
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.partner_wl_provision_tenant(uuid, text, text, jsonb, text[], text[]) TO authenticated, service_role;

-- ---------- certification gate ----------
CREATE OR REPLACE FUNCTION public.partner_wl_certify_tenant(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_partner uuid;
  v_pending integer;
BEGIN
  SELECT partner_id INTO v_partner FROM public.partner_wl_tenants WHERE id = _tenant_id;
  IF v_partner IS NULL THEN RAISE EXCEPTION 'tenant not found'; END IF;
  IF NOT (public.partner_api_is_manager(v_partner) OR public.has_role(auth.uid(),'admin')) THEN
    RAISE EXCEPTION 'not authorised to certify this tenant';
  END IF;

  SELECT count(*) INTO v_pending FROM public.partner_wl_readiness
   WHERE tenant_id = _tenant_id AND status <> 'verified';

  IF v_pending > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'readiness_incomplete', 'pending', v_pending);
  END IF;

  UPDATE public.partner_wl_tenants
     SET status = 'live', environment = 'production', certified_at = now()
   WHERE id = _tenant_id;
  UPDATE public.partner_wl_environments SET is_enabled = true
   WHERE tenant_id = _tenant_id AND environment = 'production';

  PERFORM public.partner_wl_record_evidence(_tenant_id, 'certification',
    'Production readiness checklist fully verified; tenant certified for production exposure.', NULL, '{}'::jsonb);

  RETURN jsonb_build_object('ok', true, 'status', 'live');
END;
$$;
GRANT EXECUTE ON FUNCTION public.partner_wl_certify_tenant(uuid) TO authenticated, service_role;