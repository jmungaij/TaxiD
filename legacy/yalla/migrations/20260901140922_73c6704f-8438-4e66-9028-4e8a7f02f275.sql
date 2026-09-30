CREATE OR REPLACE FUNCTION public._rec_evaluate_application_requirements(p_application_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_app public.rec_applications;
  v_sets uuid[];
  v_docs jsonb;
  v_check jsonb;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_doc jsonb;
  v_needs_ver boolean;
  v_vstate text;
  v_evidence boolean;
  v_verified boolean;
  v_academic boolean;
  v_ev_out text[] := '{}';
  v_ver_out text[] := '{}';
  v_acad_out text[] := '{}';
BEGIN
  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'application_not_found'; END IF;

  SELECT array_agg(x) INTO v_sets FROM (
    SELECT unnest(ARRAY[v_app.document_requirement_set_id,
                        v_app.document_requirement_universal_set_id]) AS x) s
   WHERE x IS NOT NULL;

  -- Full persisted document identity: the requirement matcher resolves a
  -- requirement only against a document that actually exists in storage
  -- (storage_path + size + completed upload), so those fields must travel.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id, 'doc_key', coalesce(d.doc_key, d.doc_type), 'doc_type', d.doc_type,
    'academic_year', d.academic_year, 'consolidated', d.consolidated,
    'file_name', d.file_name, 'storage_path', d.storage_path, 'mime_type', d.mime_type,
    'size_bytes', d.size_bytes, 'upload_status', d.upload_status,
    'verification_status', d.verification_status, 'verified_at', d.verified_at,
    'verified_by', d.verified_by, 'review_reason', d.review_reason,
    'attested_at', d.attested_at, 'version_no', d.version_no,
    'superseded_at', d.superseded_at) ORDER BY d.created_at), '[]'::jsonb)
  INTO v_docs FROM public.rec_candidate_documents d WHERE d.application_id = p_application_id;

  v_check := public.rec_document_evaluate_versioned(
    v_app.vacancy_id, v_sets, v_app.education_status, v_app.qualification_level,
    v_app.completed_years, v_app.consolidated_transcript,
    (SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM jsonb_array_elements(v_docs) x
      WHERE x->>'superseded_at' IS NULL
        AND coalesce(x->>'verification_status','uploaded') NOT IN ('rejected','replacement_required')));

  FOR v_item IN SELECT jsonb_array_elements(coalesce(v_check->'items','[]'::jsonb))
  LOOP
    v_needs_ver := coalesce((v_item->>'requires_verification')::boolean, true);
    v_evidence  := coalesce(v_item->>'state','missing') = 'uploaded';

    SELECT x INTO v_doc FROM jsonb_array_elements(v_docs) x
     WHERE x->>'superseded_at' IS NULL
       AND coalesce(x->>'doc_key','') = coalesce(v_item->>'doc_key','')
       AND coalesce(nullif(x->>'academic_year','')::int, -1)
           = coalesce(nullif(v_item->>'academic_year','')::int, -1)
     ORDER BY (x->>'version_no')::int DESC LIMIT 1;

    v_vstate := coalesce(v_doc->>'verification_status', CASE WHEN v_evidence THEN 'uploaded' ELSE 'absent' END);
    v_verified := v_vstate IN ('verified','waived');

    -- Academic evidence includes legacy rows carried in the `universal` class.
    v_academic := (v_item->>'doc_class') IN ('education','graduation')
      OR coalesce(v_item->>'doc_key','') ~ '^(kcpe|kcse)(_certificate)?$'
      OR coalesce(v_item->>'doc_key','') LIKE 'transcript%';

    IF coalesce((v_item->>'mandatory')::boolean,false) THEN
      IF NOT v_evidence THEN
        v_ev_out := v_ev_out || (v_item->>'label');
        IF v_academic THEN v_acad_out := v_acad_out || (v_item->>'label'); END IF;
      END IF;
      IF v_needs_ver AND NOT v_verified THEN
        v_ver_out := v_ver_out || format('%s (%s)', v_item->>'label',
          CASE WHEN v_vstate IN ('rejected','replacement_required') THEN 'rejected — replacement required'
               WHEN v_evidence THEN 'awaiting verification' ELSE 'not provided' END);
      END IF;
    END IF;

    v_items := v_items || jsonb_build_array(v_item || jsonb_build_object(
      'document_id', v_doc->>'id',
      'document_status', v_vstate,
      'academic', v_academic,
      'verification_required', v_needs_ver,
      'evidence_satisfied', v_evidence,
      'verified', v_verified,
      'satisfied', v_evidence AND (NOT v_needs_ver OR v_verified)));
  END LOOP;

  RETURN jsonb_build_object(
    'application_id', p_application_id,
    'vacancy_id', v_app.vacancy_id,
    'stage', v_app.stage,
    'requirement_version', v_app.document_requirement_version,
    'requirement_set_ids', to_jsonb(coalesce(v_sets, '{}'::uuid[])),
    'requirement_binding', v_check->'requirement_binding',
    'mandatory_total', v_check->'mandatory_total',
    'mandatory_satisfied', v_check->'mandatory_satisfied',
    'education', jsonb_build_object(
      'complete', array_length(v_acad_out,1) IS NULL,
      'verified_complete', array_length(v_ver_out,1) IS NULL AND array_length(v_ev_out,1) IS NULL,
      'outstanding_evidence', to_jsonb(v_acad_out),
      'outstanding_verification', to_jsonb(v_ver_out),
      'requirements', v_items),
    'gates', jsonb_build_object(
      'education_gate', jsonb_build_object(
        'allowed', array_length(v_acad_out,1) IS NULL,
        'basis', 'persisted_evidence', 'outstanding', to_jsonb(v_acad_out)),
      'submission_gate', jsonb_build_object(
        'allowed', array_length(v_ev_out,1) IS NULL,
        'basis', 'persisted_evidence', 'outstanding', to_jsonb(v_ev_out)),
      'progression_gate', jsonb_build_object(
        'allowed', array_length(v_ev_out,1) IS NULL AND array_length(v_ver_out,1) IS NULL,
        'basis', 'staff_verified_evidence',
        'outstanding', to_jsonb(array_cat(v_ev_out, v_ver_out)))),
    'documents', v_docs,
    'evaluated_at', now());
END; $$;

REVOKE ALL ON FUNCTION public._rec_evaluate_application_requirements(uuid) FROM PUBLIC, anon, authenticated;