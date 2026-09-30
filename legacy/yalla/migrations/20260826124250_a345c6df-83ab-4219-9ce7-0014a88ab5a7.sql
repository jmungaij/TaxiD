CREATE OR REPLACE FUNCTION public.rec_document_replace(
  p_document_id uuid,
  p_storage_path text,
  p_file_name text,
  p_size_bytes bigint DEFAULT NULL,
  p_mime_type text DEFAULT NULL,
  p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old public.rec_candidate_documents;
  v_new_id uuid;
  v_reason text := nullif(trim(p_reason),'');
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF nullif(trim(p_storage_path),'') IS NULL OR nullif(trim(p_file_name),'') IS NULL THEN
    RAISE EXCEPTION 'storage_path_and_file_name_required';
  END IF;
  IF coalesce(p_size_bytes, 1) <= 0 THEN RAISE EXCEPTION 'empty_file'; END IF;

  SELECT * INTO v_old FROM public.rec_candidate_documents WHERE id = p_document_id;
  IF v_old.id IS NULL THEN RAISE EXCEPTION 'document_not_found'; END IF;

  -- The superseded version is retained for audit; it is never overwritten.
  UPDATE public.rec_candidate_documents
     SET superseded_at = now(), verification_status = 'superseded', updated_at = now()
   WHERE id = v_old.id;

  INSERT INTO public.rec_candidate_documents (
    candidate_id, application_id, doc_type, doc_key, academic_year, consolidated,
    requirement_rule_id, file_name, storage_path, mime_type, size_bytes,
    uploaded_by, version_no, upload_status, verification_status, replaces_document_id)
  VALUES (
    v_old.candidate_id, v_old.application_id, v_old.doc_type, v_old.doc_key,
    v_old.academic_year, v_old.consolidated, v_old.requirement_rule_id,
    left(p_file_name, 200), p_storage_path, nullif(p_mime_type,''), p_size_bytes,
    auth.uid(), v_old.version_no + 1, 'complete', 'uploaded', v_old.id)
  RETURNING id INTO v_new_id;

  INSERT INTO public.rec_document_events (
    document_id, application_id, candidate_id, doc_key, academic_year, action,
    actor_id, previous_status, new_status, reason, document_version, context)
  VALUES (v_new_id, v_old.application_id, v_old.candidate_id, v_old.doc_key, v_old.academic_year,
          'DOCUMENT_REPLACED', auth.uid(), v_old.verification_status, 'uploaded', v_reason,
          v_old.version_no + 1,
          jsonb_build_object('replaces_document_id', v_old.id, 'file_name', p_file_name));

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, previous_state, new_state, source)
  VALUES (auth.uid(), 'recruitment_document_replaced', 'candidate_document', v_new_id,
          jsonb_build_object('document_id', v_old.id, 'version', v_old.version_no),
          jsonb_build_object('document_id', v_new_id, 'version', v_old.version_no + 1, 'reason', v_reason),
          'recruitment_360');

  RETURN jsonb_build_object('document_id', v_new_id, 'version_no', v_old.version_no + 1,
                            'replaces_document_id', v_old.id, 'verification_status', 'uploaded');
END; $$;
GRANT EXECUTE ON FUNCTION public.rec_document_replace(uuid, text, text, bigint, text, text) TO authenticated;