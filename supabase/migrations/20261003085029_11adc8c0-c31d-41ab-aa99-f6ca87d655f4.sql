CREATE OR REPLACE FUNCTION private.driver_application_checklist_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.doc_code = 'PASSPORT_PHOTO' THEN NEW.doc_code := 'FULL_PHOTO'; END IF;
  SELECT c.label, c.mandatory INTO NEW.doc_label, NEW.is_mandatory FROM private.driver_doc_checklist() c WHERE c.code = NEW.doc_code;
  IF NEW.doc_code IN ('KRA_PIN','NATIONAL_ID','FULL_PHOTO') THEN NEW.expires_on := NULL; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.driver_application_document_attach(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
  v_path text := btrim(coalesce(p->>'storage_path',''));
  v_issued date;
  v_expires date;
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
  BEGIN
    v_issued := nullif(p->>'issued_on','')::date;
    v_expires := nullif(p->>'expires_on','')::date;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RETURN jsonb_build_object('error',true,'code','INVALID_DOCUMENT_DATE');
  END;
  IF v_issued IS NULL OR v_issued > current_date THEN
    RETURN jsonb_build_object('error',true,'code','ISSUE_DATE_REQUIRED');
  END IF;
  IF d.doc_code NOT IN ('KRA_PIN','NATIONAL_ID','FULL_PHOTO') AND (v_expires IS NULL OR v_expires <= current_date OR v_expires <= v_issued) THEN
    RETURN jsonb_build_object('error',true,'code','VALID_EXPIRY_REQUIRED');
  END IF;
  IF a.applicant_user_id IS NULL THEN
    UPDATE public.driver_applications SET applicant_user_id = v_uid WHERE id = a.id;
  END IF;
  UPDATE public.driver_application_documents SET
    storage_path = v_path,
    document_number = left(nullif(btrim(coalesce(p->>'document_number','')),''),80),
    issuing_authority = left(nullif(btrim(coalesce(p->>'issuing_authority','')),''),120),
    issued_on = v_issued,
    expires_on = CASE WHEN d.doc_code IN ('KRA_PIN','NATIONAL_ID','FULL_PHOTO') THEN NULL ELSE v_expires END,
    state = 'PENDING_REVIEW', submitted_at = now(), review_notes = NULL, reviewed_by = NULL, reviewed_at = NULL, updated_at = now()
  WHERE id = d.id;
  INSERT INTO public.driver_application_events (application_id, action, status_from, status_to, note, actor_user_id)
  VALUES (a.id, 'DOCUMENT_SUBMITTED', a.status, a.status, d.doc_label, v_uid);
  RETURN jsonb_build_object('ok',true,'document_id',d.id,'state','PENDING_REVIEW');
END $$;