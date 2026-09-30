CREATE TABLE public.carrier_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_reference text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'SUBMITTED'
    CHECK (status IN ('SUBMITTED','UNDER_REVIEW','INFO_REQUESTED','APPROVED','REJECTED','WITHDRAWN')),
  legal_entity_name text NOT NULL,
  trading_name text,
  registration_number text,
  tax_identifier text,
  country text NOT NULL DEFAULT 'KE',
  county text,
  town text,
  contact_name text NOT NULL,
  contact_position text,
  contact_email text NOT NULL,
  contact_phone text NOT NULL,
  fleet_size integer,
  vehicle_types text[] NOT NULL DEFAULT '{}',
  service_categories text[] NOT NULL DEFAULT '{}',
  corridors text[] NOT NULL DEFAULT '{}',
  notes text,
  applicant_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  claim_token text NOT NULL,
  review_notes text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  decided_at timestamptz,
  partner_id uuid,
  carrier_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX carrier_applications_status_idx ON public.carrier_applications (status, created_at DESC);
CREATE INDEX carrier_applications_applicant_idx ON public.carrier_applications (applicant_user_id);

GRANT SELECT ON public.carrier_applications TO authenticated;
GRANT ALL ON public.carrier_applications TO service_role;
ALTER TABLE public.carrier_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read carrier applications"
  ON public.carrier_applications FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.compliance.manage'));

CREATE POLICY "Applicants read their own application"
  ON public.carrier_applications FOR SELECT TO authenticated
  USING (applicant_user_id = auth.uid());

CREATE TABLE public.carrier_application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.carrier_applications(id) ON DELETE CASCADE,
  action text NOT NULL,
  status_from text,
  status_to text,
  note text,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX carrier_application_events_app_idx ON public.carrier_application_events (application_id, created_at DESC);

GRANT SELECT ON public.carrier_application_events TO authenticated;
GRANT ALL ON public.carrier_application_events TO service_role;
ALTER TABLE public.carrier_application_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read carrier application events"
  ON public.carrier_application_events FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.compliance.manage'));

CREATE OR REPLACE FUNCTION public._carrier_application_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'CARRIER_APPLICATION_EVENTS_APPEND_ONLY';
END; $$;

CREATE TRIGGER carrier_application_events_immutable
  BEFORE UPDATE OR DELETE ON public.carrier_application_events
  FOR EACH ROW EXECUTE FUNCTION public._carrier_application_events_append_only();

CREATE TRIGGER carrier_applications_touch
  BEFORE UPDATE ON public.carrier_applications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Submit: validated definer entrypoint. No direct table insert privilege exists.
CREATE OR REPLACE FUNCTION public.carrier_application_submit(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name text := btrim(coalesce(p->>'legal_entity_name',''));
  v_contact text := btrim(coalesce(p->>'contact_name',''));
  v_email text := lower(btrim(coalesce(p->>'contact_email','')));
  v_phone text := btrim(coalesce(p->>'contact_phone',''));
  v_ref text;
  v_token text;
  v_id uuid;
  v_existing public.carrier_applications;
BEGIN
  IF length(v_name) < 3 OR length(v_name) > 200 THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_LEGAL_ENTITY_NAME');
  END IF;
  IF length(v_contact) < 3 OR length(v_contact) > 120 THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_CONTACT_NAME');
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' OR length(v_email) > 200 THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_CONTACT_EMAIL');
  END IF;
  IF v_phone !~ '^[0-9+ ()-]{9,20}$' THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_CONTACT_PHONE');
  END IF;
  IF length(coalesce(p->>'notes','')) > 4000 THEN
    RETURN jsonb_build_object('error', true, 'code', 'NOTES_TOO_LONG');
  END IF;

  -- Idempotent re-submission: same business + email while still open.
  SELECT * INTO v_existing FROM public.carrier_applications
   WHERE lower(legal_entity_name) = lower(v_name)
     AND contact_email = v_email
     AND status IN ('SUBMITTED','UNDER_REVIEW','INFO_REQUESTED')
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true,
      'application_reference', v_existing.application_reference,
      'claim_token', v_existing.claim_token,
      'status', v_existing.status);
  END IF;

  v_ref := 'FOA-' || to_char(now(), 'YYYYMM') || '-' || upper(substr(encode(gen_random_bytes(4),'hex'), 1, 6));
  v_token := encode(gen_random_bytes(16), 'hex');

  INSERT INTO public.carrier_applications (
    application_reference, legal_entity_name, trading_name, registration_number,
    tax_identifier, country, county, town, contact_name, contact_position,
    contact_email, contact_phone, fleet_size, vehicle_types, service_categories,
    corridors, notes, applicant_user_id, claim_token
  ) VALUES (
    v_ref, v_name, nullif(btrim(coalesce(p->>'trading_name','')),''),
    nullif(btrim(coalesce(p->>'registration_number','')),''),
    nullif(btrim(coalesce(p->>'tax_identifier','')),''),
    coalesce(nullif(btrim(coalesce(p->>'country','')),''), 'KE'),
    nullif(btrim(coalesce(p->>'county','')),''),
    nullif(btrim(coalesce(p->>'town','')),''),
    v_contact, nullif(btrim(coalesce(p->>'contact_position','')),''),
    v_email, v_phone,
    nullif(p->>'fleet_size','')::int,
    coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(p->'vehicle_types','[]'::jsonb)) t(x)), '{}'),
    coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(p->'service_categories','[]'::jsonb)) t(x)), '{}'),
    coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(p->'corridors','[]'::jsonb)) t(x)), '{}'),
    nullif(btrim(coalesce(p->>'notes','')),''),
    auth.uid(), v_token
  ) RETURNING id INTO v_id;

  INSERT INTO public.carrier_application_events (application_id, action, status_to, actor_user_id)
  VALUES (v_id, 'SUBMITTED', 'SUBMITTED', auth.uid());

  RETURN jsonb_build_object('ok', true, 'application_reference', v_ref,
    'claim_token', v_token, 'status', 'SUBMITTED');
END; $$;

REVOKE ALL ON FUNCTION public.carrier_application_submit(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.carrier_application_submit(jsonb) TO anon, authenticated;

-- Status lookup bound to the private claim token issued at submission.
CREATE OR REPLACE FUNCTION public.carrier_application_status(_reference text, _token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.carrier_applications;
BEGIN
  IF coalesce(_reference,'') = '' OR coalesce(_token,'') = '' THEN
    RETURN jsonb_build_object('error', true, 'code', 'REFERENCE_AND_TOKEN_REQUIRED');
  END IF;
  SELECT * INTO r FROM public.carrier_applications
   WHERE application_reference = _reference AND claim_token = _token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', true, 'code', 'NOT_FOUND');
  END IF;
  RETURN jsonb_build_object('ok', true,
    'application_reference', r.application_reference,
    'legal_entity_name', r.legal_entity_name,
    'status', r.status,
    'review_notes', r.review_notes,
    'submitted_at', r.created_at,
    'decided_at', r.decided_at,
    'carrier_id', r.carrier_id);
END; $$;

REVOKE ALL ON FUNCTION public.carrier_application_status(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.carrier_application_status(text, text) TO anon, authenticated;

-- Staff decision. Approval provisions the partner account, the Fleet Owner
-- record and its document checklist. It never marks compliance verified.
CREATE OR REPLACE FUNCTION public.carrier_application_decide(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid := (p->>'application_id')::uuid;
  v_action text := upper(coalesce(p->>'action',''));
  v_note text := nullif(btrim(coalesce(p->>'note','')),'');
  a public.carrier_applications;
  v_base text;
  v_code text;
  v_partner uuid;
  v_carrier uuid;
  v_to text;
  v_n int := 0;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.compliance.manage') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  SELECT * INTO a FROM public.carrier_applications WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','UNKNOWN_APPLICATION'); END IF;

  IF v_action = 'APPROVE' AND a.status = 'APPROVED' THEN
    RETURN jsonb_build_object('ok', true, 'already_approved', true,
      'carrier_id', a.carrier_id, 'partner_id', a.partner_id);
  END IF;
  IF a.status IN ('APPROVED','REJECTED','WITHDRAWN') AND v_action <> 'APPROVE' THEN
    RETURN jsonb_build_object('error', true, 'code','APPLICATION_CLOSED', 'status', a.status);
  END IF;

  IF v_action = 'REVIEW' THEN
    v_to := 'UNDER_REVIEW';
  ELSIF v_action = 'REQUEST_INFO' THEN
    IF v_note IS NULL THEN RETURN jsonb_build_object('error', true, 'code','NOTE_REQUIRED'); END IF;
    v_to := 'INFO_REQUESTED';
  ELSIF v_action = 'REJECT' THEN
    IF v_note IS NULL THEN RETURN jsonb_build_object('error', true, 'code','REASON_REQUIRED'); END IF;
    v_to := 'REJECTED';
  ELSIF v_action = 'APPROVE' THEN
    v_to := 'APPROVED';
  ELSE
    RETURN jsonb_build_object('error', true, 'code','UNKNOWN_ACTION');
  END IF;

  IF v_to = 'APPROVED' THEN
    v_base := upper(regexp_replace(a.legal_entity_name, '[^a-zA-Z0-9]', '', 'g'));
    v_base := left(coalesce(nullif(v_base,''), 'FLEET'), 10);
    v_code := v_base || '-' || a.country;
    WHILE EXISTS (SELECT 1 FROM public.carrier_profiles WHERE carrier_code = v_code)
       OR EXISTS (SELECT 1 FROM public.partners WHERE partner_code = v_code) LOOP
      v_n := v_n + 1;
      v_code := v_base || '-' || a.country || v_n::text;
    END LOOP;

    INSERT INTO public.partners (
      partner_code, legal_name, trading_name, partner_type, status,
      verification_status, onboarding_stage, commercial_model, commission_model,
      primary_contact_name, primary_contact_email, primary_contact_phone,
      country, city, created_by
    ) VALUES (
      v_code, a.legal_entity_name, a.trading_name, 'LOGISTICS', 'pending',
      'in_review', 'documents_pending', 'BOOK', 'COMMISSION',
      a.contact_name, a.contact_email, a.contact_phone,
      a.country, a.town, auth.uid()
    ) RETURNING id INTO v_partner;

    INSERT INTO public.carrier_profiles (
      partner_id, carrier_code, legal_entity_name, operating_status,
      service_categories, corridors, operating_countries,
      ops_contact_name, ops_contact_email, ops_contact_phone,
      tax_identifier, contract_status, onboarding_notes, created_by
    ) VALUES (
      v_partner, v_code, a.legal_entity_name, 'ONBOARDING',
      a.service_categories, a.corridors, ARRAY[a.country],
      a.contact_name, a.contact_email, a.contact_phone,
      a.tax_identifier, 'NONE',
      'Approved from application ' || a.application_reference, auth.uid()
    ) RETURNING id INTO v_carrier;

    IF a.applicant_user_id IS NOT NULL THEN
      INSERT INTO public.partner_users (partner_id, user_id, partner_role, is_active)
      VALUES (v_partner, a.applicant_user_id, 'owner', true)
      ON CONFLICT DO NOTHING;
    END IF;

    PERFORM public.carrier_requirements_provision(v_carrier, NULL, NULL);
  END IF;

  UPDATE public.carrier_applications SET
    status = v_to,
    review_notes = coalesce(v_note, review_notes),
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    decided_at = CASE WHEN v_to IN ('APPROVED','REJECTED') THEN now() ELSE decided_at END,
    partner_id = coalesce(v_partner, partner_id),
    carrier_id = coalesce(v_carrier, carrier_id)
   WHERE id = v_id;

  INSERT INTO public.carrier_application_events
    (application_id, action, status_from, status_to, note, actor_user_id)
  VALUES (v_id, v_action, a.status, v_to, v_note, auth.uid());

  RETURN jsonb_build_object('ok', true, 'status', v_to,
    'partner_id', coalesce(v_partner, a.partner_id),
    'carrier_id', coalesce(v_carrier, a.carrier_id));
END; $$;

REVOKE ALL ON FUNCTION public.carrier_application_decide(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.carrier_application_decide(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carrier_application_decide(jsonb) TO service_role;