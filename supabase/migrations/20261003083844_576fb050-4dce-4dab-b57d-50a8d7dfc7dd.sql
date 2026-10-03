CREATE OR REPLACE FUNCTION private.driver_application_document_review(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_dec text := upper(coalesce(p->>'decision',''));
  v_note text := left(nullif(btrim(coalesce(p->>'notes','')),''),1000);
  d public.driver_application_documents;
  a public.driver_applications;
BEGIN
  IF NOT private._driver_application_staff() THEN RETURN jsonb_build_object('error',true,'code','NOT_AUTHORISED'); END IF;
  SELECT * INTO d FROM public.driver_application_documents WHERE id=(p->>'document_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error',true,'code','UNKNOWN_DOCUMENT'); END IF;
  IF d.storage_path IS NULL THEN RETURN jsonb_build_object('error',true,'code','NOTHING_UPLOADED'); END IF;
  IF v_dec NOT IN ('VERIFY','REJECT') THEN RETURN jsonb_build_object('error',true,'code','UNKNOWN_DECISION'); END IF;
  IF v_dec='REJECT' AND v_note IS NULL THEN RETURN jsonb_build_object('error',true,'code','REASON_REQUIRED'); END IF;
  IF v_dec='VERIFY' AND d.expires_on IS NOT NULL AND d.expires_on < current_date THEN
    RETURN jsonb_build_object('error',true,'code','DOCUMENT_EXPIRED');
  END IF;
  SELECT * INTO a FROM public.driver_applications WHERE id=d.application_id;
  UPDATE public.driver_application_documents SET
    state = CASE WHEN v_dec='VERIFY' THEN 'VERIFIED' ELSE 'REJECTED' END,
    review_notes = v_note, reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  WHERE id=d.id;
  INSERT INTO public.driver_application_events (application_id, action, status_from, status_to, note, actor_user_id)
  VALUES (a.id, 'DOCUMENT_'||v_dec, a.status, a.status, d.doc_label||coalesce(': '||v_note,''), auth.uid());
  RETURN jsonb_build_object('ok',true,'state', CASE WHEN v_dec='VERIFY' THEN 'VERIFIED' ELSE 'REJECTED' END);
END $$;
REVOKE ALL ON FUNCTION private.driver_application_document_review(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.driver_application_document_review(jsonb) TO authenticated;
CREATE OR REPLACE FUNCTION public.driver_application_document_review(p jsonb)
RETURNS jsonb LANGUAGE sql SET search_path TO 'public' AS $$ SELECT private.driver_application_document_review($1) $$;
REVOKE ALL ON FUNCTION public.driver_application_document_review(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_application_document_review(jsonb) TO authenticated;