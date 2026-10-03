CREATE POLICY "Drivers upload own documents" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'driver-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Drivers read own documents, staff read all" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'driver-documents' AND ((storage.foldername(name))[1] = auth.uid()::text OR public._driver_application_staff()));
CREATE POLICY "Drivers remove own documents" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'driver-documents' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE OR REPLACE FUNCTION private.driver_doc_checklist()
RETURNS TABLE(code text, label text, mandatory boolean)
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  VALUES
    ('NATIONAL_ID','National ID (both sides)', false),
    ('PASSPORT','Passport (instead of National ID)', false),
    ('DRIVING_LICENCE','Driving licence', true),
    ('PSV_BADGE','PSV badge', true),
    ('GOOD_CONDUCT','Certificate of good conduct', true),
    ('FULL_PHOTO','Full-size photograph', true),
    ('KRA_PIN','KRA PIN certificate', true),
    ('VEHICLE_LOGBOOK','Vehicle logbook', true),
    ('VEHICLE_INSURANCE','PSV comprehensive motor insurance certificate', true),
    ('INSURANCE_STICKER','PSV comprehensive insurance sticker', true)
$$;

CREATE OR REPLACE FUNCTION private.driver_doc_checklist_apply(_app uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.driver_application_documents SET doc_code='FULL_PHOTO'
   WHERE application_id=_app AND doc_code='PASSPORT_PHOTO'
     AND NOT EXISTS (SELECT 1 FROM public.driver_application_documents x WHERE x.application_id=_app AND x.doc_code='FULL_PHOTO');
  INSERT INTO public.driver_application_documents (application_id, doc_code, doc_label, is_mandatory)
  SELECT _app, c.code, c.label, c.mandatory FROM private.driver_doc_checklist() c
  ON CONFLICT (application_id, doc_code) DO UPDATE SET doc_label=EXCLUDED.doc_label, is_mandatory=EXCLUDED.is_mandatory;
END $$;
REVOKE ALL ON FUNCTION private.driver_doc_checklist_apply(uuid) FROM PUBLIC, anon, authenticated;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM public.driver_applications WHERE status IN ('SUBMITTED','UNDER_REVIEW','INFO_REQUESTED') LOOP
    PERFORM private.driver_doc_checklist_apply(r.id);
  END LOOP;
  UPDATE public.driver_application_documents SET expires_on=NULL WHERE doc_code IN ('KRA_PIN','NATIONAL_ID','PASSPORT');
END $$;

-- New applications get the new checklist (runs after the submit routine inserts the old list)
CREATE OR REPLACE FUNCTION private.driver_application_checklist_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.doc_code = 'PASSPORT_PHOTO' THEN NEW.doc_code := 'FULL_PHOTO'; END IF;
  SELECT c.label, c.mandatory INTO NEW.doc_label, NEW.is_mandatory FROM private.driver_doc_checklist() c WHERE c.code = NEW.doc_code;
  IF NEW.doc_code IN ('KRA_PIN','NATIONAL_ID','PASSPORT') THEN NEW.expires_on := NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER driver_application_documents_checklist BEFORE INSERT OR UPDATE OF doc_code, expires_on ON public.driver_application_documents
FOR EACH ROW EXECUTE FUNCTION private.driver_application_checklist_trg();

CREATE OR REPLACE FUNCTION private.driver_application_events_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.action = 'SUBMITTED' THEN PERFORM private.driver_doc_checklist_apply(NEW.application_id); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER driver_application_events_checklist AFTER INSERT ON public.driver_application_events
FOR EACH ROW EXECUTE FUNCTION private.driver_application_events_after_insert();

CREATE OR REPLACE FUNCTION private.driver_application_document_attach(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_path text := btrim(coalesce(p->>'storage_path',''));
  d public.driver_application_documents;
  a public.driver_applications;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error',true,'code','AUTHENTICATION_REQUIRED'); END IF;
  SELECT * INTO d FROM public.driver_application_documents WHERE id = (p->>'document_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error',true,'code','UNKNOWN_DOCUMENT'); END IF;
  SELECT * INTO a FROM public.driver_applications WHERE id = d.application_id;
  IF NOT (a.applicant_user_id = v_uid OR lower(a.contact_email) = v_email) THEN
    RETURN jsonb_build_object('error',true,'code','SIGN_IN_WITH_APPLICATION_EMAIL');
  END IF;
  IF a.status NOT IN ('SUBMITTED','UNDER_REVIEW','INFO_REQUESTED') THEN
    RETURN jsonb_build_object('error',true,'code','APPLICATION_CLOSED');
  END IF;
  IF d.state = 'VERIFIED' THEN RETURN jsonb_build_object('error',true,'code','ALREADY_VERIFIED'); END IF;
  IF split_part(v_path,'/',1) <> v_uid::text OR length(v_path) > 500 THEN
    RETURN jsonb_build_object('error',true,'code','INVALID_FILE_PATH');
  END IF;
  IF a.applicant_user_id IS NULL THEN
    UPDATE public.driver_applications SET applicant_user_id = v_uid WHERE id = a.id;
  END IF;
  UPDATE public.driver_application_documents SET
    storage_path = v_path,
    document_number = left(nullif(btrim(coalesce(p->>'document_number','')),''),80),
    issuing_authority = left(nullif(btrim(coalesce(p->>'issuing_authority','')),''),120),
    issued_on = nullif(p->>'issued_on','')::date,
    expires_on = CASE WHEN d.doc_code IN ('KRA_PIN','NATIONAL_ID','PASSPORT') THEN NULL ELSE nullif(p->>'expires_on','')::date END,
    state = 'PENDING_REVIEW', submitted_at = now(), review_notes = NULL, reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
  WHERE id = d.id;
  INSERT INTO public.driver_application_events (application_id, action, status_from, status_to, note, actor_user_id)
  VALUES (a.id, 'DOCUMENT_SUBMITTED', a.status, a.status, d.doc_label, v_uid);
  RETURN jsonb_build_object('ok',true,'document_id',d.id,'state','PENDING_REVIEW');
END $$;
REVOKE ALL ON FUNCTION private.driver_application_document_attach(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.driver_application_document_attach(jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.driver_application_document_attach(p jsonb)
RETURNS jsonb LANGUAGE sql SET search_path TO 'public' AS $$ SELECT private.driver_application_document_attach($1) $$;
REVOKE ALL ON FUNCTION public.driver_application_document_attach(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_application_document_attach(jsonb) TO authenticated;

-- Approval: one of National ID or Passport must be verified
CREATE OR REPLACE FUNCTION private.driver_application_identity_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status = 'APPROVED' AND OLD.status IS DISTINCT FROM 'APPROVED' AND NOT EXISTS (
    SELECT 1 FROM public.driver_application_documents WHERE application_id = NEW.id
      AND doc_code IN ('NATIONAL_ID','PASSPORT') AND state = 'VERIFIED') THEN
    RAISE EXCEPTION 'IDENTITY_DOCUMENT_NOT_VERIFIED';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER driver_applications_identity_guard BEFORE UPDATE OF status ON public.driver_applications
FOR EACH ROW EXECUTE FUNCTION private.driver_application_identity_guard();