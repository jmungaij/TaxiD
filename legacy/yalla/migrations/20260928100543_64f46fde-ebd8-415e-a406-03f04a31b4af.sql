CREATE TABLE public.partner_golive_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  programme text NOT NULL CHECK (programme IN ('api','white_label','technology')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
  checklist jsonb NOT NULL DEFAULT '{"contract_signed":false,"sandbox_calls_passed":false,"webhook_verified":false,"security_contact":false,"support_contact":false,"data_flows_agreed":false}'::jsonb,
  security_contact text, support_contact text, notes text,
  submitted_by uuid, submitted_at timestamptz,
  decided_by uuid, decided_at timestamptz, decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, programme)
);
CREATE TABLE public.partner_golive_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.partner_golive_reviews(id) ON DELETE CASCADE,
  action text NOT NULL, actor_id uuid, note text, snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.partner_wl_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  domain text NOT NULL UNIQUE CHECK (domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$'),
  txt_token text NOT NULL DEFAULT 'yalla-verify=' || encode(extensions.gen_random_bytes(12),'hex'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','failed')),
  checked_at timestamptz, check_note text, requested_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.partner_golive_reviews, public.partner_golive_events, public.partner_wl_domains TO authenticated;
GRANT ALL ON public.partner_golive_reviews, public.partner_golive_events, public.partner_wl_domains TO service_role;
ALTER TABLE public.partner_golive_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_golive_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_wl_domains ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._partner_golive_is_staff() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT COALESCE(public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'), false) $$;
CREATE OR REPLACE FUNCTION public._partner_is_member(_partner uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.partner_users WHERE partner_id=_partner AND user_id=auth.uid() AND is_active) $$;

CREATE POLICY "golive read" ON public.partner_golive_reviews FOR SELECT TO authenticated USING (public._partner_is_member(partner_id) OR public._partner_golive_is_staff());
CREATE POLICY "golive events read" ON public.partner_golive_events FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.partner_golive_reviews r WHERE r.id=review_id AND (public._partner_is_member(r.partner_id) OR public._partner_golive_is_staff())));
CREATE POLICY "domains read" ON public.partner_wl_domains FOR SELECT TO authenticated USING (public._partner_is_member(partner_id) OR public._partner_golive_is_staff());

CREATE OR REPLACE FUNCTION public._golive_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'go-live events are append-only'; END $$;
CREATE TRIGGER golive_events_append_only BEFORE UPDATE OR DELETE ON public.partner_golive_events FOR EACH ROW EXECUTE FUNCTION public._golive_events_append_only();

CREATE OR REPLACE FUNCTION public.partner_golive_save(_partner uuid, _programme text, _checklist jsonb, _security text, _support text, _notes text, _submit boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.partner_golive_reviews; k text;
BEGIN
  IF NOT (public.partner_api_is_manager(_partner) IS TRUE) THEN RAISE EXCEPTION 'only partner owners/admins can edit the go-live review'; END IF;
  IF _programme NOT IN ('api','white_label','technology') THEN RAISE EXCEPTION 'unknown programme'; END IF;
  SELECT * INTO r FROM public.partner_golive_reviews WHERE partner_id=_partner AND programme=_programme FOR UPDATE;
  IF FOUND AND r.status IN ('submitted','approved') THEN RAISE EXCEPTION 'review is % and cannot be edited', r.status; END IF;
  INSERT INTO public.partner_golive_reviews (partner_id, programme) VALUES (_partner,_programme) ON CONFLICT (partner_id, programme) DO NOTHING;
  UPDATE public.partner_golive_reviews SET
    checklist = (SELECT jsonb_object_agg(key, COALESCE((_checklist->>key)::boolean,false)) FROM jsonb_each(checklist)),
    security_contact=left(_security,200), support_contact=left(_support,200), notes=left(_notes,2000), updated_at=now()
  WHERE partner_id=_partner AND programme=_programme RETURNING * INTO r;
  IF _submit THEN
    FOR k IN SELECT key FROM jsonb_each_text(r.checklist) WHERE value<>'true' LOOP RAISE EXCEPTION 'checklist item % is not complete', k; END LOOP;
    IF coalesce(trim(r.security_contact),'')='' OR coalesce(trim(r.support_contact),'')='' THEN RAISE EXCEPTION 'security and support contacts are required'; END IF;
    UPDATE public.partner_golive_reviews SET status='submitted', submitted_by=auth.uid(), submitted_at=now(), decided_by=null, decided_at=null WHERE id=r.id RETURNING * INTO r;
  END IF;
  INSERT INTO public.partner_golive_events (review_id, action, actor_id, snapshot) VALUES (r.id, CASE WHEN _submit THEN 'submitted' ELSE 'saved' END, auth.uid(), to_jsonb(r));
  RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION public.partner_golive_decide(_review uuid, _approve boolean, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r public.partner_golive_reviews;
BEGIN
  IF NOT (public._partner_golive_is_staff() IS TRUE) THEN RAISE EXCEPTION 'only Yalla admins can decide go-live'; END IF;
  SELECT * INTO r FROM public.partner_golive_reviews WHERE id=_review FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'review not found'; END IF;
  IF r.status <> 'submitted' THEN RAISE EXCEPTION 'only submitted reviews can be decided'; END IF;
  IF r.submitted_by = auth.uid() THEN RAISE EXCEPTION 'four-eyes: you cannot decide a review you submitted'; END IF;
  IF NOT _approve AND coalesce(trim(_note),'')='' THEN RAISE EXCEPTION 'a reason is required to reject'; END IF;
  UPDATE public.partner_golive_reviews SET status=CASE WHEN _approve THEN 'approved' ELSE 'rejected' END, decided_by=auth.uid(), decided_at=now(), decision_note=left(_note,2000), updated_at=now() WHERE id=_review RETURNING * INTO r;
  INSERT INTO public.partner_golive_events (review_id, action, actor_id, note, snapshot) VALUES (r.id, r.status, auth.uid(), _note, to_jsonb(r));
  RETURN to_jsonb(r);
END $$;

CREATE OR REPLACE FUNCTION public.partner_golive_approved(_partner uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.partner_golive_reviews WHERE partner_id=_partner AND programme IN ('api','white_label') AND status='approved') $$;

CREATE OR REPLACE FUNCTION public.partner_api_credential_issue(_partner_id uuid, _environment partner_api_environment, _label text, _scopes text[] DEFAULT '{}'::text[], _tier text DEFAULT 'integrate'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_secret text; v_client_id text; v_row public.partner_api_credentials;
BEGIN
  IF NOT (COALESCE(public.partner_api_is_manager(_partner_id),false) OR COALESCE(public.has_role(auth.uid(), 'admin'),false)) THEN
    RAISE EXCEPTION 'not authorised to issue partner API credentials';
  END IF;
  IF _environment <> 'sandbox' AND NOT (public.partner_golive_approved(_partner_id) IS TRUE) THEN
    RAISE EXCEPTION 'live credentials require an approved go-live review';
  END IF;
  v_client_id := 'yc_' || CASE WHEN _environment = 'sandbox' THEN 'sbx_' ELSE 'live_' END || replace(gen_random_uuid()::text, '-', '');
  v_secret := 'ys_' || CASE WHEN _environment = 'sandbox' THEN 'sbx_' ELSE 'live_' END || encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.partner_api_credentials (partner_id, environment, label, client_id, secret_hash, secret_fingerprint, scopes, tier, created_by, rate_limit_per_min, monthly_quota)
  VALUES (_partner_id, _environment, _label, v_client_id, encode(digest(v_secret, 'sha256'), 'hex'), right(v_secret, 6),
    COALESCE(_scopes, '{}'), COALESCE(_tier, 'integrate'), auth.uid(),
    CASE _tier WHEN 'infrastructure' THEN 25000 WHEN 'scale' THEN 10000 ELSE 2000 END,
    CASE _tier WHEN 'infrastructure' THEN 5000000 WHEN 'scale' THEN 2000000 ELSE 500000 END) RETURNING * INTO v_row;
  INSERT INTO public.partner_api_credential_audit (credential_id, partner_id, action, environment, actor_id, metadata)
  VALUES (v_row.id, _partner_id, 'created', _environment, auth.uid(), jsonb_build_object('label', _label, 'scopes', COALESCE(_scopes, '{}'), 'tier', _tier));
  RETURN jsonb_build_object('credential_id', v_row.id, 'client_id', v_row.client_id, 'client_secret', v_secret, 'environment', _environment, 'scopes', v_row.scopes, 'tier', v_row.tier);
END; $function$;

CREATE OR REPLACE FUNCTION public.partner_wl_domain_request(_partner uuid, _domain text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.partner_wl_domains;
BEGIN
  IF NOT (public.partner_api_is_manager(_partner) IS TRUE) THEN RAISE EXCEPTION 'only partner owners/admins can request a domain'; END IF;
  INSERT INTO public.partner_wl_domains (partner_id, domain, requested_by) VALUES (_partner, lower(trim(_domain)), auth.uid()) RETURNING * INTO d;
  RETURN to_jsonb(d);
END $$;

CREATE OR REPLACE FUNCTION public.partner_wl_domain_mark(_domain uuid, _verified boolean, _note text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d public.partner_wl_domains;
BEGIN
  IF NOT (public._partner_golive_is_staff() IS TRUE) THEN RAISE EXCEPTION 'only Yalla admins can verify domains'; END IF;
  UPDATE public.partner_wl_domains SET status=CASE WHEN _verified THEN 'verified' ELSE 'failed' END, checked_at=now(), check_note=left(_note,500), updated_at=now() WHERE id=_domain RETURNING * INTO d;
  IF NOT FOUND THEN RAISE EXCEPTION 'domain not found'; END IF;
  RETURN to_jsonb(d);
END $$;

CREATE OR REPLACE FUNCTION public.partner_api_public_status() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object(
    'window_hours', 24,
    'requests', count(*),
    'server_errors', count(*) FILTER (WHERE http_status >= 500),
    'error_rate', CASE WHEN count(*)=0 THEN null ELSE round((count(*) FILTER (WHERE http_status >= 500))::numeric / count(*), 4) END,
    'p95_latency_ms', percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms),
    'last_request_at', max(created_at))
  FROM public.logistics_api_requests WHERE created_at > now() - interval '24 hours' AND environment = 'production' $$;

REVOKE ALL ON FUNCTION public.partner_golive_save(uuid,text,jsonb,text,text,text,boolean), public.partner_golive_decide(uuid,boolean,text), public.partner_golive_approved(uuid), public.partner_wl_domain_request(uuid,text), public.partner_wl_domain_mark(uuid,boolean,text), public._partner_golive_is_staff(), public._partner_is_member(uuid), public.partner_api_public_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_golive_save(uuid,text,jsonb,text,text,text,boolean), public.partner_golive_decide(uuid,boolean,text), public.partner_golive_approved(uuid), public.partner_wl_domain_request(uuid,text), public.partner_wl_domain_mark(uuid,boolean,text), public._partner_golive_is_staff(), public._partner_is_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_api_public_status() TO anon, authenticated;