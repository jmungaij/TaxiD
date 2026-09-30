-- ============================================================ driver intake
CREATE TABLE public.driver_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_reference text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'SUBMITTED'
    CHECK (status IN ('SUBMITTED','UNDER_REVIEW','INFO_REQUESTED','APPROVED','REJECTED','WITHDRAWN')),
  first_name text NOT NULL,
  middle_name text,
  last_name text NOT NULL,
  gender text,
  date_of_birth date,
  national_id text NOT NULL,
  kra_pin text,
  contact_email text NOT NULL,
  contact_phone text NOT NULL,
  county text,
  town text,
  country text NOT NULL DEFAULT 'KE',
  driver_type text NOT NULL DEFAULT 'individual',
  licence_number text NOT NULL,
  licence_classes text[] NOT NULL DEFAULT '{}',
  licence_expiry date,
  psv_badge_number text,
  years_experience integer,
  vehicle_ownership text NOT NULL DEFAULT 'NONE'
    CHECK (vehicle_ownership IN ('NONE','OWNER','FLEET_ASSIGNED')),
  vehicle_registration text,
  vehicle_make_model text,
  service_categories text[] NOT NULL DEFAULT '{}',
  preferred_city text,
  notes text,
  applicant_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  claim_token text NOT NULL,
  review_notes text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  decided_at timestamptz,
  driver_id uuid,
  carrier_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX driver_applications_status_idx ON public.driver_applications (status, created_at DESC);
CREATE INDEX driver_applications_applicant_idx ON public.driver_applications (applicant_user_id);

GRANT SELECT ON public.driver_applications TO authenticated;
GRANT ALL ON public.driver_applications TO service_role;
ALTER TABLE public.driver_applications ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._driver_application_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_staff_permission('staff.logistics.compliance.manage')
      OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]);
$$;

REVOKE ALL ON FUNCTION public._driver_application_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._driver_application_staff() TO authenticated, service_role;

CREATE POLICY "Staff read driver applications"
  ON public.driver_applications FOR SELECT TO authenticated
  USING (public._driver_application_staff());

CREATE POLICY "Applicants read their own driver application"
  ON public.driver_applications FOR SELECT TO authenticated
  USING (applicant_user_id = auth.uid());

CREATE TABLE public.driver_application_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.driver_applications(id) ON DELETE CASCADE,
  doc_code text NOT NULL,
  doc_label text NOT NULL,
  is_mandatory boolean NOT NULL DEFAULT true,
  state text NOT NULL DEFAULT 'MISSING'
    CHECK (state IN ('MISSING','PENDING_REVIEW','VERIFIED','REJECTED','EXPIRED')),
  storage_path text,
  document_number text,
  issuing_authority text,
  issued_on date,
  expires_on date,
  review_notes text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, doc_code)
);

GRANT SELECT ON public.driver_application_documents TO authenticated;
GRANT ALL ON public.driver_application_documents TO service_role;
ALTER TABLE public.driver_application_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read driver application documents"
  ON public.driver_application_documents FOR SELECT TO authenticated
  USING (public._driver_application_staff());

CREATE POLICY "Applicants read their own driver application documents"
  ON public.driver_application_documents FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.driver_applications a
     WHERE a.id = application_id AND a.applicant_user_id = auth.uid()
  ));

CREATE TABLE public.driver_application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.driver_applications(id) ON DELETE CASCADE,
  action text NOT NULL,
  status_from text,
  status_to text,
  note text,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX driver_application_events_app_idx ON public.driver_application_events (application_id, created_at DESC);

GRANT SELECT ON public.driver_application_events TO authenticated;
GRANT ALL ON public.driver_application_events TO service_role;
ALTER TABLE public.driver_application_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read driver application events"
  ON public.driver_application_events FOR SELECT TO authenticated
  USING (public._driver_application_staff());

CREATE OR REPLACE FUNCTION public._driver_application_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'DRIVER_APPLICATION_EVENTS_APPEND_ONLY';
END; $$;

CREATE TRIGGER driver_application_events_immutable
  BEFORE UPDATE OR DELETE ON public.driver_application_events
  FOR EACH ROW EXECUTE FUNCTION public._driver_application_events_append_only();

CREATE TRIGGER driver_applications_touch
  BEFORE UPDATE ON public.driver_applications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER driver_application_documents_touch
  BEFORE UPDATE ON public.driver_application_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------------ submit
CREATE OR REPLACE FUNCTION public.driver_application_submit(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_first text := btrim(coalesce(p->>'first_name',''));
  v_last text := btrim(coalesce(p->>'last_name',''));
  v_id_no text := btrim(coalesce(p->>'national_id',''));
  v_email text := lower(btrim(coalesce(p->>'contact_email','')));
  v_phone text := btrim(coalesce(p->>'contact_phone',''));
  v_licence text := upper(btrim(coalesce(p->>'licence_number','')));
  v_own text := upper(coalesce(nullif(btrim(coalesce(p->>'vehicle_ownership','')),''),'NONE'));
  v_ref text;
  v_token text;
  v_app_id uuid;
  v_existing public.driver_applications;
  v_doc record;
BEGIN
  IF length(v_first) < 2 OR length(v_first) > 80 THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_FIRST_NAME');
  END IF;
  IF length(v_last) < 2 OR length(v_last) > 80 THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_LAST_NAME');
  END IF;
  IF v_id_no !~ '^[A-Za-z0-9/-]{5,20}$' THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_NATIONAL_ID');
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' OR length(v_email) > 200 THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_CONTACT_EMAIL');
  END IF;
  IF v_phone !~ '^[0-9+ ()-]{9,20}$' THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_CONTACT_PHONE');
  END IF;
  IF length(v_licence) < 4 OR length(v_licence) > 40 THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_LICENCE_NUMBER');
  END IF;
  IF v_own NOT IN ('NONE','OWNER','FLEET_ASSIGNED') THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_VEHICLE_OWNERSHIP');
  END IF;
  IF length(coalesce(p->>'notes','')) > 4000 THEN
    RETURN jsonb_build_object('error', true, 'code', 'NOTES_TOO_LONG');
  END IF;

  SELECT * INTO v_existing FROM public.driver_applications
   WHERE national_id = v_id_no AND contact_email = v_email
     AND status IN ('SUBMITTED','UNDER_REVIEW','INFO_REQUESTED')
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true,
      'application_id', v_existing.id,
      'application_reference', v_existing.application_reference,
      'claim_token', v_existing.claim_token,
      'status', v_existing.status);
  END IF;

  v_ref := 'DRV-' || to_char(now(), 'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 6));
  v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');

  INSERT INTO public.driver_applications (
    application_reference, first_name, middle_name, last_name, gender, date_of_birth,
    national_id, kra_pin, contact_email, contact_phone, county, town, country,
    driver_type, licence_number, licence_classes, licence_expiry, psv_badge_number,
    years_experience, vehicle_ownership, vehicle_registration, vehicle_make_model,
    service_categories, preferred_city, notes, applicant_user_id, claim_token
  ) VALUES (
    v_ref, v_first, nullif(btrim(coalesce(p->>'middle_name','')),''), v_last,
    nullif(btrim(coalesce(p->>'gender','')),''), nullif(p->>'date_of_birth','')::date,
    v_id_no, nullif(btrim(coalesce(p->>'kra_pin','')),''), v_email, v_phone,
    nullif(btrim(coalesce(p->>'county','')),''), nullif(btrim(coalesce(p->>'town','')),''),
    coalesce(nullif(btrim(coalesce(p->>'country','')),''),'KE'),
    coalesce(nullif(btrim(coalesce(p->>'driver_type','')),''),'individual'),
    v_licence,
    coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(p->'licence_classes','[]'::jsonb)) t(x)), '{}'),
    nullif(p->>'licence_expiry','')::date,
    nullif(btrim(coalesce(p->>'psv_badge_number','')),''),
    nullif(p->>'years_experience','')::int,
    v_own,
    nullif(btrim(coalesce(p->>'vehicle_registration','')),''),
    nullif(btrim(coalesce(p->>'vehicle_make_model','')),''),
    coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(p->'service_categories','[]'::jsonb)) t(x)), '{}'),
    nullif(btrim(coalesce(p->>'preferred_city','')),''),
    nullif(btrim(coalesce(p->>'notes','')),''),
    auth.uid(), v_token
  ) RETURNING id INTO v_app_id;

  FOR v_doc IN
    SELECT * FROM (VALUES
      ('NATIONAL_ID','National ID (both sides)', true),
      ('DRIVING_LICENCE','Driving licence', true),
      ('PSV_BADGE','PSV badge', false),
      ('GOOD_CONDUCT','Certificate of good conduct', true),
      ('PASSPORT_PHOTO','Passport photograph', true),
      ('KRA_PIN','KRA PIN certificate', false),
      ('VEHICLE_LOGBOOK','Vehicle logbook', false),
      ('VEHICLE_INSURANCE','Vehicle insurance certificate', false)
    ) AS t(code, label, mandatory)
  LOOP
    INSERT INTO public.driver_application_documents (application_id, doc_code, doc_label, is_mandatory)
    VALUES (v_app_id, v_doc.code, v_doc.label,
      CASE WHEN v_doc.code IN ('VEHICLE_LOGBOOK','VEHICLE_INSURANCE') THEN (v_own = 'OWNER') ELSE v_doc.mandatory END);
  END LOOP;

  INSERT INTO public.driver_application_events (application_id, action, status_to, actor_user_id)
  VALUES (v_app_id, 'SUBMITTED', 'SUBMITTED', auth.uid());

  RETURN jsonb_build_object('ok', true, 'application_id', v_app_id,
    'application_reference', v_ref, 'claim_token', v_token, 'status', 'SUBMITTED');
END; $$;

REVOKE ALL ON FUNCTION public.driver_application_submit(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_application_submit(jsonb) TO anon, authenticated;

-- ------------------------------------------------------------- status probe
CREATE OR REPLACE FUNCTION public.driver_application_status(_reference text, _token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.driver_applications; v_docs jsonb;
BEGIN
  IF coalesce(_reference,'') = '' OR coalesce(_token,'') = '' THEN
    RETURN jsonb_build_object('error', true, 'code', 'REFERENCE_AND_TOKEN_REQUIRED');
  END IF;
  SELECT * INTO r FROM public.driver_applications
   WHERE application_reference = _reference AND claim_token = _token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', true, 'code', 'NOT_FOUND');
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'doc_code', d.doc_code, 'doc_label', d.doc_label,
    'is_mandatory', d.is_mandatory, 'state', d.state, 'review_notes', d.review_notes,
    'expires_on', d.expires_on) ORDER BY d.doc_code), '[]'::jsonb)
    INTO v_docs FROM public.driver_application_documents d WHERE d.application_id = r.id;

  RETURN jsonb_build_object('ok', true,
    'application_id', r.id,
    'application_reference', r.application_reference,
    'applicant_name', r.first_name || ' ' || r.last_name,
    'status', r.status,
    'review_notes', r.review_notes,
    'submitted_at', r.created_at,
    'decided_at', r.decided_at,
    'driver_id', r.driver_id,
    'documents', v_docs);
END; $$;

REVOKE ALL ON FUNCTION public.driver_application_status(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_application_status(text, text) TO anon, authenticated;

-- ----------------------------------------------------------- attach evidence
CREATE OR REPLACE FUNCTION public.driver_application_document_attach(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_doc_id uuid := (p->>'document_id')::uuid;
  v_path text := btrim(coalesce(p->>'storage_path',''));
  d public.driver_application_documents;
  a public.driver_applications;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHENTICATION_REQUIRED');
  END IF;
  IF v_path = '' OR length(v_path) > 500 THEN
    RETURN jsonb_build_object('error', true, 'code', 'STORAGE_PATH_REQUIRED');
  END IF;
  SELECT * INTO d FROM public.driver_application_documents WHERE id = v_doc_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'UNKNOWN_DOCUMENT'); END IF;
  SELECT * INTO a FROM public.driver_applications WHERE id = d.application_id;
  IF a.applicant_user_id IS DISTINCT FROM auth.uid() AND NOT public._driver_application_staff() THEN
    RETURN jsonb_build_object('error', true, 'code', 'NOT_AUTHORISED');
  END IF;
  IF a.status IN ('APPROVED','REJECTED','WITHDRAWN') THEN
    RETURN jsonb_build_object('error', true, 'code', 'APPLICATION_CLOSED', 'status', a.status);
  END IF;
  IF d.state = 'VERIFIED' THEN
    RETURN jsonb_build_object('error', true, 'code', 'DOCUMENT_ALREADY_VERIFIED');
  END IF;
  IF v_path NOT LIKE a.applicant_user_id::text || '/%' AND NOT public._driver_application_staff() THEN
    RETURN jsonb_build_object('error', true, 'code', 'EVIDENCE_PATH_NOT_OWNED');
  END IF;

  UPDATE public.driver_application_documents SET
    storage_path = v_path,
    document_number = nullif(btrim(coalesce(p->>'document_number','')),''),
    issuing_authority = nullif(btrim(coalesce(p->>'issuing_authority','')),''),
    issued_on = nullif(p->>'issued_on','')::date,
    expires_on = nullif(p->>'expires_on','')::date,
    state = 'PENDING_REVIEW',
    review_notes = NULL,
    reviewed_by = NULL,
    reviewed_at = NULL,
    submitted_at = now()
   WHERE id = v_doc_id;

  INSERT INTO public.driver_application_events (application_id, action, note, actor_user_id)
  VALUES (a.id, 'DOCUMENT_SUBMITTED', d.doc_code, auth.uid());

  RETURN jsonb_build_object('ok', true, 'document_id', v_doc_id, 'state', 'PENDING_REVIEW');
END; $$;

REVOKE ALL ON FUNCTION public.driver_application_document_attach(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_application_document_attach(jsonb) TO authenticated;

-- ---------------------------------------------------------- review evidence
CREATE OR REPLACE FUNCTION public.driver_application_document_review(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_doc_id uuid := (p->>'document_id')::uuid;
  v_decision text := upper(coalesce(p->>'decision',''));
  v_note text := nullif(btrim(coalesce(p->>'notes','')),'');
  d public.driver_application_documents;
  v_state text;
BEGIN
  IF NOT public._driver_application_staff() THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  SELECT * INTO d FROM public.driver_application_documents WHERE id = v_doc_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'UNKNOWN_DOCUMENT'); END IF;
  IF d.state = 'MISSING' THEN
    RETURN jsonb_build_object('error', true, 'code', 'NO_EVIDENCE_SUBMITTED');
  END IF;
  IF v_decision = 'VERIFY' THEN v_state := 'VERIFIED';
  ELSIF v_decision = 'REJECT' THEN
    IF v_note IS NULL THEN RETURN jsonb_build_object('error', true, 'code', 'REASON_REQUIRED'); END IF;
    v_state := 'REJECTED';
  ELSE RETURN jsonb_build_object('error', true, 'code', 'UNKNOWN_DECISION');
  END IF;

  UPDATE public.driver_application_documents
     SET state = v_state, review_notes = v_note, reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = v_doc_id;

  INSERT INTO public.driver_application_events (application_id, action, note, actor_user_id)
  VALUES (d.application_id, 'DOCUMENT_' || v_state, coalesce(d.doc_code || ': ' || coalesce(v_note,''), d.doc_code), auth.uid());

  RETURN jsonb_build_object('ok', true, 'document_id', v_doc_id, 'state', v_state);
END; $$;

REVOKE ALL ON FUNCTION public.driver_application_document_review(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_application_document_review(jsonb) TO authenticated;

-- ------------------------------------------------------------ staff decision
CREATE OR REPLACE FUNCTION public.driver_application_decide(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid := (p->>'application_id')::uuid;
  v_action text := upper(coalesce(p->>'action',''));
  v_note text := nullif(btrim(coalesce(p->>'note','')),'');
  a public.driver_applications;
  v_to text;
  v_driver uuid;
  v_code text;
  v_base text;
  v_n int := 0;
  v_missing int;
BEGIN
  IF NOT public._driver_application_staff() THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  SELECT * INTO a FROM public.driver_applications WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'UNKNOWN_APPLICATION'); END IF;

  IF v_action = 'APPROVE' AND a.status = 'APPROVED' THEN
    RETURN jsonb_build_object('ok', true, 'already_approved', true, 'driver_id', a.driver_id);
  END IF;
  IF a.status IN ('APPROVED','REJECTED','WITHDRAWN') THEN
    RETURN jsonb_build_object('error', true, 'code', 'APPLICATION_CLOSED', 'status', a.status);
  END IF;

  IF v_action = 'REVIEW' THEN v_to := 'UNDER_REVIEW';
  ELSIF v_action = 'REQUEST_INFO' THEN
    IF v_note IS NULL THEN RETURN jsonb_build_object('error', true, 'code', 'NOTE_REQUIRED'); END IF;
    v_to := 'INFO_REQUESTED';
  ELSIF v_action = 'REJECT' THEN
    IF v_note IS NULL THEN RETURN jsonb_build_object('error', true, 'code', 'REASON_REQUIRED'); END IF;
    v_to := 'REJECTED';
  ELSIF v_action = 'APPROVE' THEN v_to := 'APPROVED';
  ELSE RETURN jsonb_build_object('error', true, 'code', 'UNKNOWN_ACTION');
  END IF;

  IF v_to = 'APPROVED' THEN
    SELECT count(*) INTO v_missing FROM public.driver_application_documents
     WHERE application_id = v_id AND is_mandatory AND state <> 'VERIFIED';
    IF v_missing > 0 THEN
      RETURN jsonb_build_object('error', true, 'code', 'MANDATORY_DOCUMENTS_NOT_VERIFIED',
        'outstanding', v_missing);
    END IF;

    v_base := upper(regexp_replace(a.first_name || a.last_name, '[^a-zA-Z0-9]', '', 'g'));
    v_base := left(coalesce(nullif(v_base,''), 'DRIVER'), 8);
    v_code := 'DR-' || v_base;
    WHILE EXISTS (SELECT 1 FROM public.drivers WHERE driver_code = v_code) LOOP
      v_n := v_n + 1;
      v_code := 'DR-' || v_base || v_n::text;
    END LOOP;

    INSERT INTO public.drivers (
      driver_code, user_id, driver_type, first_name, middle_name, last_name,
      gender, date_of_birth, nationality, national_id, kra_pin, phone_number,
      email, county, city, country, status, application_status,
      verification_status, created_by
    ) VALUES (
      v_code, a.applicant_user_id, a.driver_type::driver_type, a.first_name, a.middle_name, a.last_name,
      a.gender, a.date_of_birth, a.country, a.national_id, a.kra_pin, a.contact_phone,
      a.contact_email, a.county, coalesce(a.preferred_city, a.town), a.country,
      'pending'::driver_status, 'approved',
      'pending'::doc_verification_status, auth.uid()
    ) RETURNING id INTO v_driver;
  END IF;

  UPDATE public.driver_applications SET
    status = v_to,
    review_notes = coalesce(v_note, review_notes),
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    decided_at = CASE WHEN v_to IN ('APPROVED','REJECTED') THEN now() ELSE decided_at END,
    driver_id = coalesce(v_driver, driver_id)
   WHERE id = v_id;

  INSERT INTO public.driver_application_events
    (application_id, action, status_from, status_to, note, actor_user_id)
  VALUES (v_id, v_action, a.status, v_to, v_note, auth.uid());

  RETURN jsonb_build_object('ok', true, 'status', v_to, 'driver_id', coalesce(v_driver, a.driver_id));
END; $$;

REVOKE ALL ON FUNCTION public.driver_application_decide(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_application_decide(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_application_decide(jsonb) TO service_role;