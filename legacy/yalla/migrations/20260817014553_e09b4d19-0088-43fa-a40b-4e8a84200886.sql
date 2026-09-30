CREATE OR REPLACE FUNCTION public.rec_migration_stage_records(
  p_batch_id uuid, p_rows jsonb, p_mapping jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r jsonb; v_key text; v_rec_id uuid; v_inserted int := 0; v_skipped int := 0; v_linked int := 0;
  v_norm jsonb; h text;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not authorised'; END IF;

  FOR r IN SELECT jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) LOOP
    -- deterministic source key: caller-supplied, else a content fingerprint
    v_key := coalesce(nullif(r->>'source_row_key',''), md5(coalesce(r->'raw', '{}'::jsonb)::text));

    v_norm := jsonb_strip_nulls(jsonb_build_object(
      'full_name',        nullif(trim(coalesce(r#>>'{normalized,full_name}','')),''),
      'email',            public.rec_mig_norm_email(r#>>'{normalized,email}'),
      'phone',            public.rec_mig_norm_phone(r#>>'{normalized,phone}'),
      'location',         nullif(trim(coalesce(r#>>'{normalized,location}','')),''),
      'current_employer', nullif(trim(coalesce(r#>>'{normalized,current_employer}','')),''),
      'current_title',    nullif(trim(coalesce(r#>>'{normalized,current_title}','')),''),
      'years_experience', nullif(r#>>'{normalized,years_experience}','')::numeric,
      'cover_letter',     nullif(trim(coalesce(r#>>'{normalized,cover_letter}','')),''),
      'skills',           coalesce(r#>'{normalized,skills}', '[]'::jsonb),
      'qualifications',   coalesce(r#>'{normalized,qualifications}', '[]'::jsonb)
    ));

    SELECT id INTO v_rec_id FROM public.rec_migration_records
    WHERE batch_id = p_batch_id AND source_row_key = v_key;

    IF v_rec_id IS NULL THEN
      INSERT INTO public.rec_migration_records (
        batch_id, source_row_key, source_row_no, source_platform,
        source_candidate_ref, source_application_ref, source_vacancy_ref,
        source_status, source_applied_at, raw_payload, normalized, state)
      VALUES (
        p_batch_id, v_key, nullif(r->>'source_row_no','')::int,
        nullif(r->>'source_platform',''),
        nullif(r->>'source_candidate_ref',''), nullif(r->>'source_application_ref',''),
        nullif(r->>'source_vacancy_ref',''), nullif(r->>'source_status',''),
        nullif(r->>'source_applied_at','')::timestamptz,
        coalesce(r->'raw', '{}'::jsonb), v_norm, 'VALIDATING')
      RETURNING id INTO v_rec_id;
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;

    FOR h IN SELECT jsonb_array_elements_text(coalesce(r->'file_refs','[]'::jsonb)) LOOP
      INSERT INTO public.rec_migration_record_files (record_id, file_id, doc_type, match_method, match_confidence)
      SELECT v_rec_id, f.id, f.doc_type,
             CASE WHEN f.sha256 = h THEN 'hash' ELSE 'filename' END,
             CASE WHEN f.sha256 = h THEN 100 ELSE 85 END
      FROM public.rec_migration_files f
      WHERE f.batch_id = p_batch_id AND (f.sha256 = h OR f.original_file_name = h)
      ON CONFLICT DO NOTHING;
      v_linked := v_linked + 1;
    END LOOP;

    UPDATE public.rec_migration_records SET
      state = CASE
        WHEN state IN ('IMPORTED','APPROVED','REJECTED') THEN state
        WHEN EXISTS (SELECT 1 FROM public.rec_migration_record_files rf WHERE rf.record_id = v_rec_id)
          THEN 'QUEUED' ELSE 'PARSED' END
    WHERE id = v_rec_id;
  END LOOP;

  UPDATE public.rec_migration_batches
  SET status = CASE WHEN status IN ('draft','ingesting') THEN 'processing' ELSE status END,
      mapping = CASE WHEN p_mapping = '{}'::jsonb THEN mapping ELSE p_mapping END,
      started_at = coalesce(started_at, now())
  WHERE id = p_batch_id;

  PERFORM public.rec_mig_audit(p_batch_id, NULL, 'records_staged', NULL,
    jsonb_build_object('inserted', v_inserted, 'already_present', v_skipped, 'documents_linked', v_linked));

  RETURN jsonb_build_object('inserted', v_inserted, 'already_present', v_skipped, 'documents_linked', v_linked);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rec_migration_stage_records(uuid,jsonb,jsonb) FROM anon;