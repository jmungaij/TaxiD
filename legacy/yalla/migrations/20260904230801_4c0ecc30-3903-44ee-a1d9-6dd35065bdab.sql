ALTER TABLE public.partner_applications
  ADD COLUMN IF NOT EXISTS carrier_application_id uuid REFERENCES public.carrier_applications(id),
  ADD COLUMN IF NOT EXISTS carrier_id uuid REFERENCES public.carrier_profiles(id),
  ADD COLUMN IF NOT EXISTS converted_at timestamptz,
  ADD COLUMN IF NOT EXISTS converted_by uuid,
  ADD COLUMN IF NOT EXISTS review_status text;

CREATE TABLE IF NOT EXISTS public.partner_application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.partner_applications(id) ON DELETE CASCADE,
  action text NOT NULL,
  status_from text,
  status_to text,
  note text,
  actor_user_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.partner_application_events TO authenticated;
GRANT ALL ON public.partner_application_events TO service_role;
ALTER TABLE public.partner_application_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partner_application_events_staff_read ON public.partner_application_events;
CREATE POLICY partner_application_events_staff_read
  ON public.partner_application_events FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.partners.read'));

CREATE OR REPLACE FUNCTION public._partner_application_events_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'PARTNER_APPLICATION_EVENTS_APPEND_ONLY';
END; $$;

DROP TRIGGER IF EXISTS partner_application_events_append_only ON public.partner_application_events;
CREATE TRIGGER partner_application_events_append_only
  BEFORE UPDATE OR DELETE ON public.partner_application_events
  FOR EACH ROW EXECUTE FUNCTION public._partner_application_events_append_only();

CREATE INDEX IF NOT EXISTS partner_application_events_app_idx
  ON public.partner_application_events(application_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.partner_application_review(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := (p->>'application_id')::uuid;
  v_action text := upper(coalesce(p->>'action',''));
  v_note text := nullif(btrim(coalesce(p->>'note','')),'');
  a public.partner_applications;
  v_to text;
BEGIN
  IF NOT public.has_staff_permission('staff.partners.manage') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  SELECT * INTO a FROM public.partner_applications WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','UNKNOWN_APPLICATION'); END IF;

  IF v_action = 'REVIEW' THEN
    v_to := 'UNDER_REVIEW';
  ELSIF v_action = 'REQUEST_INFO' THEN
    IF v_note IS NULL THEN RETURN jsonb_build_object('error', true, 'code','NOTE_REQUIRED'); END IF;
    v_to := 'INFO_REQUESTED';
  ELSIF v_action = 'REJECT' THEN
    IF v_note IS NULL THEN RETURN jsonb_build_object('error', true, 'code','REASON_REQUIRED'); END IF;
    v_to := 'REJECTED';
  ELSIF v_action = 'QUALIFY' THEN
    v_to := 'QUALIFIED';
  ELSE
    RETURN jsonb_build_object('error', true, 'code','UNKNOWN_ACTION');
  END IF;

  IF coalesce(a.review_status, a.status) = 'REJECTED' AND v_action <> 'REVIEW' THEN
    RETURN jsonb_build_object('error', true, 'code','APPLICATION_CLOSED', 'status', a.review_status);
  END IF;

  UPDATE public.partner_applications SET
    review_status = v_to,
    review_notes = coalesce(v_note, review_notes),
    reviewed_by = auth.uid(),
    reviewed_at = now()
  WHERE id = v_id;

  INSERT INTO public.partner_application_events
    (application_id, action, status_from, status_to, note, actor_user_id)
  VALUES (v_id, v_action, coalesce(a.review_status, a.status), v_to, v_note, auth.uid());

  RETURN jsonb_build_object('ok', true, 'status', v_to);
END; $$;

REVOKE ALL ON FUNCTION public.partner_application_review(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_application_review(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.partner_application_to_fleet_owner(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := (p->>'application_id')::uuid;
  a public.partner_applications;
  v_ref text;
  v_app uuid;
BEGIN
  IF NOT public.has_staff_permission('staff.partners.manage') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  SELECT * INTO a FROM public.partner_applications WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','UNKNOWN_APPLICATION'); END IF;

  IF a.carrier_application_id IS NOT NULL THEN
    SELECT application_reference INTO v_ref FROM public.carrier_applications WHERE id = a.carrier_application_id;
    RETURN jsonb_build_object('ok', true, 'already_converted', true,
      'carrier_application_id', a.carrier_application_id, 'application_reference', v_ref);
  END IF;

  IF coalesce(a.review_status,'') <> 'QUALIFIED' THEN
    RETURN jsonb_build_object('error', true, 'code','NOT_QUALIFIED',
      'status', coalesce(a.review_status, a.status));
  END IF;

  IF a.contact_email IS NULL OR a.contact_phone IS NULL OR a.organisation_name IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code','INCOMPLETE_APPLICANT_CONTRACT');
  END IF;

  v_ref := 'FOA-' || to_char(now(),'YYYYMM') || '-' ||
           upper(substr(md5(v_id::text || clock_timestamp()::text), 1, 6));

  INSERT INTO public.carrier_applications (
    application_reference, status, legal_entity_name, trading_name,
    country, town, contact_name, contact_email, contact_phone,
    applicant_user_id, claim_token, notes
  ) VALUES (
    v_ref, 'SUBMITTED', a.organisation_name, nullif(a.organisation_name,''),
    coalesce(a.country,'KE'), a.city, a.contact_name, a.contact_email, a.contact_phone,
    a.submitted_by, encode(gen_random_bytes(16),'hex'),
    'Converted from partner application ' || a.reference
  ) RETURNING id INTO v_app;

  UPDATE public.partner_applications SET
    carrier_application_id = v_app,
    converted_at = now(),
    converted_by = auth.uid(),
    review_status = 'ONBOARDING'
  WHERE id = v_id;

  INSERT INTO public.partner_application_events
    (application_id, action, status_from, status_to, note, actor_user_id, detail)
  VALUES (v_id, 'CONVERT_TO_FLEET_OWNER', 'QUALIFIED', 'ONBOARDING',
    'Fleet Owner application ' || v_ref, auth.uid(),
    jsonb_build_object('carrier_application_id', v_app, 'application_reference', v_ref));

  INSERT INTO public.carrier_application_events
    (application_id, action, status_from, status_to, note, actor_user_id)
  VALUES (v_app, 'CREATED_FROM_PARTNER_APPLICATION', NULL, 'SUBMITTED',
    'Partner application ' || a.reference, auth.uid());

  RETURN jsonb_build_object('ok', true, 'carrier_application_id', v_app,
    'application_reference', v_ref);
END; $$;

REVOKE ALL ON FUNCTION public.partner_application_to_fleet_owner(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_application_to_fleet_owner(jsonb) TO authenticated, service_role;