-- =====================================================================
-- Recruitment 360 — Migration Engine (Part 2: processing functions)
-- Domain: recruitment
-- Fairness note: scoring uses only job-related evidence (skills,
-- qualifications, experience, industry, location/work arrangement).
-- Protected characteristics are never extracted into scoring inputs.
-- =====================================================================

-- ---------- normalisation helpers (original values are never altered) ----------
CREATE OR REPLACE FUNCTION public.rec_mig_norm_email(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT nullif(lower(trim(coalesce(p,''))), '');
$$;

CREATE OR REPLACE FUNCTION public.rec_mig_norm_phone(p text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE d text;
BEGIN
  d := regexp_replace(coalesce(p,''), '[^0-9]', '', 'g');
  IF d = '' THEN RETURN NULL; END IF;
  IF length(d) = 9 THEN RETURN '+254' || d; END IF;
  IF length(d) = 10 AND left(d,1) = '0' THEN RETURN '+254' || right(d,9); END IF;
  IF length(d) = 12 AND left(d,3) = '254' THEN RETURN '+' || d; END IF;
  RETURN '+' || d;
END;
$$;

CREATE OR REPLACE FUNCTION public.rec_mig_norm_name(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT nullif(regexp_replace(lower(trim(coalesce(p,''))), '\s+', ' ', 'g'), '');
$$;

-- Flattens ["a"] or [{"value":"a"}] evidence arrays into text[]
CREATE OR REPLACE FUNCTION public.rec_mig_flat(p jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(array_agg(DISTINCT lower(trim(v))) FILTER (WHERE trim(coalesce(v,'')) <> ''), '{}'::text[])
  FROM (
    SELECT CASE WHEN jsonb_typeof(e) = 'object' THEN e->>'value' ELSE e #>> '{}' END AS v
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p) = 'array' THEN p ELSE '[]'::jsonb END) e
  ) s;
$$;

CREATE OR REPLACE FUNCTION public.rec_mig_coverage(p_required text[], p_have text[])
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_required IS NULL OR cardinality(p_required) = 0 THEN NULL
    ELSE round(
      100.0 * (
        SELECT count(*) FROM unnest(p_required) r
        WHERE EXISTS (
          SELECT 1 FROM unnest(coalesce(p_have,'{}'::text[])) h
          WHERE lower(trim(h)) = lower(trim(r))
             OR position(lower(trim(r)) in lower(trim(h))) > 0
             OR position(lower(trim(h)) in lower(trim(r))) > 0
        )
      )::numeric / cardinality(p_required), 1)
  END;
$$;

CREATE OR REPLACE FUNCTION public.rec_mig_audit(
  p_batch_id uuid, p_record_id uuid, p_action text,
  p_before jsonb DEFAULT NULL, p_after jsonb DEFAULT NULL,
  p_reason text DEFAULT NULL, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.rec_migration_events (batch_id, record_id, action, before_state, after_state, reason, detail)
  VALUES (p_batch_id, p_record_id, p_action, p_before, p_after, p_reason, coalesce(p_detail,'{}'::jsonb));
$$;

-- ---------- Step 1/2: create batch ----------
CREATE OR REPLACE FUNCTION public.rec_migration_create_batch(p_payload jsonb)
RETURNS public.rec_migration_batches
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.rec_migration_batches;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not authorised'; END IF;
  IF coalesce(trim(p_payload->>'name'),'') = '' THEN RAISE EXCEPTION 'a migration batch name is required'; END IF;

  INSERT INTO public.rec_migration_batches (
    batch_no, name, source_kind, source_platform, source_organization,
    original_campaign, import_date, owner_staff_id, notes, status, mapping
  ) VALUES (
    'MIG-' || to_char(now(),'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),
    left(trim(p_payload->>'name'), 160),
    coalesce(nullif(p_payload->>'source_kind',''), 'unknown'),
    left(nullif(trim(coalesce(p_payload->>'source_platform','')),''), 120),
    left(nullif(trim(coalesce(p_payload->>'source_organization','')),''), 160),
    left(nullif(trim(coalesce(p_payload->>'original_campaign','')),''), 160),
    coalesce(nullif(p_payload->>'import_date','')::date, current_date),
    nullif(p_payload->>'owner_staff_id','')::uuid,
    nullif(trim(coalesce(p_payload->>'notes','')),''),
    'draft',
    coalesce(p_payload->'mapping', '{}'::jsonb)
  ) RETURNING * INTO v;

  PERFORM public.rec_mig_audit(v.id, NULL, 'batch_created', NULL, to_jsonb(v));
  RETURN v;
END;
$$;

-- ---------- Step 3: file ingestion (idempotent on hash) ----------
CREATE OR REPLACE FUNCTION public.rec_migration_register_file(
  p_batch_id uuid, p_original_file_name text, p_storage_path text,
  p_mime text, p_size bigint, p_sha256 text,
  p_file_kind text DEFAULT 'document', p_doc_type text DEFAULT 'cv')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_dup boolean := false;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not authorised'; END IF;
  IF coalesce(p_sha256,'') = '' THEN RAISE EXCEPTION 'file hash is required'; END IF;

  SELECT id INTO v_id FROM public.rec_migration_files
  WHERE batch_id = p_batch_id AND sha256 = p_sha256 AND original_file_name = p_original_file_name;

  IF v_id IS NOT NULL THEN
    v_dup := true;
  ELSE
    INSERT INTO public.rec_migration_files (
      batch_id, original_file_name, storage_path, mime_type, size_bytes, sha256,
      file_kind, doc_type, status)
    VALUES (p_batch_id, p_original_file_name, p_storage_path, p_mime, p_size, p_sha256,
      coalesce(p_file_kind,'document'), coalesce(p_doc_type,'cv'),
      CASE WHEN coalesce(p_file_kind,'document') = 'document' THEN 'queued' ELSE 'stored' END)
    RETURNING id INTO v_id;
    PERFORM public.rec_mig_audit(p_batch_id, NULL, 'file_registered', NULL,
      jsonb_build_object('file_id', v_id, 'name', p_original_file_name, 'sha256', p_sha256));
  END IF;

  UPDATE public.rec_migration_batches SET status = CASE WHEN status = 'draft' THEN 'ingesting' ELSE status END
  WHERE id = p_batch_id;

  RETURN jsonb_build_object('file_id', v_id, 'duplicate', v_dup);
END;
$$;

-- ---------- reusable column mappings ----------
CREATE OR REPLACE FUNCTION public.rec_migration_save_mapping(
  p_name text, p_source_kind text, p_source_platform text, p_mapping jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not authorised'; END IF;
  INSERT INTO public.rec_migration_mappings (name, source_kind, source_platform, mapping)
  VALUES (trim(p_name), coalesce(p_source_kind,'unknown'), p_source_platform, coalesce(p_mapping,'{}'::jsonb))
  ON CONFLICT (name) DO UPDATE SET mapping = excluded.mapping,
    source_kind = excluded.source_kind, source_platform = excluded.source_platform, updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ---------- Step 4/5: stage source rows (idempotent) ----------
CREATE OR REPLACE FUNCTION public.rec_migration_stage_records(
  p_batch_id uuid, p_rows jsonb, p_mapping jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r jsonb; v_key text; v_rec_id uuid; v_inserted int := 0; v_skipped int := 0; v_linked int := 0;
  v_norm jsonb; h text;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not authorised'; END IF;

  FOR r IN SELECT jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) LOOP
    v_key := coalesce(nullif(r->>'source_row_key',''),
                      encode(digest(coalesce(r->>'raw','') || coalesce(r->'raw'::text,''), 'sha256'), 'hex'));
    v_key := coalesce(v_key, md5(r::text));

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

    -- attach documents by file hash or by file name
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

    -- queued when documents exist, otherwise straight to PARSED (structured only)
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

-- ---------- document parsing worker contract ----------
CREATE OR REPLACE FUNCTION public.rec_migration_claim_files(p_batch_id uuid, p_limit integer DEFAULT 10)
RETURNS SETOF public.rec_migration_files
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not authorised'; END IF;
  RETURN QUERY
  UPDATE public.rec_migration_files f
  SET status = 'parsing', attempts = f.attempts + 1
  WHERE f.id IN (
    SELECT id FROM public.rec_migration_files
    WHERE batch_id = p_batch_id AND status IN ('queued','parsing')
      AND file_kind = 'document' AND attempts < 4
    ORDER BY created_at
    LIMIT greatest(1, least(coalesce(p_limit,10), 50))
    FOR UPDATE SKIP LOCKED)
  RETURNING f.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.rec_migration_record_parse(
  p_file_id uuid, p_text text, p_extraction jsonb DEFAULT '{}'::jsonb,
  p_confidence numeric DEFAULT NULL, p_page_count integer DEFAULT NULL,
  p_error text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_batch uuid; v_rec uuid;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not authorised'; END IF;
  SELECT batch_id INTO v_batch FROM public.rec_migration_files WHERE id = p_file_id;
  IF v_batch IS NULL THEN RAISE EXCEPTION 'file not found'; END IF;

  UPDATE public.rec_migration_files SET
    status = CASE WHEN p_error IS NOT NULL THEN 'failed' ELSE 'parsed' END,
    parse_error = p_error,
    extracted_text = coalesce(left(p_text, 200000), extracted_text),
    page_count = coalesce(p_page_count, page_count)
  WHERE id = p_file_id;

  IF p_error IS NULL THEN
    FOR v_rec IN SELECT record_id FROM public.rec_migration_record_files WHERE file_id = p_file_id LOOP
      UPDATE public.rec_migration_records SET
        extraction = extraction || coalesce(p_extraction,'{}'::jsonb),
        extraction_confidence = greatest(coalesce(extraction_confidence,0), coalesce(p_confidence,0)),
        state = CASE WHEN state IN ('QUEUED','PARSING','FAILED','EXCEPTION') THEN 'PARSED' ELSE state END,
        exception_code = NULL, exception_reason = NULL
      WHERE id = v_rec;
    END LOOP;
  ELSE
    UPDATE public.rec_migration_records r SET
      state = CASE WHEN r.state IN ('QUEUED','PARSING') THEN 'EXCEPTION' ELSE r.state END,
      exception_code = 'parse_failed', exception_reason = left(p_error, 500)
    WHERE r.id IN (SELECT record_id FROM public.rec_migration_record_files WHERE file_id = p_file_id);
  END IF;

  PERFORM public.rec_mig_audit(v_batch, NULL, CASE WHEN p_error IS NULL THEN 'file_parsed' ELSE 'file_parse_failed' END,
    NULL, jsonb_build_object('file_id', p_file_id), p_error);

  RETURN jsonb_build_object('ok', p_error IS NULL, 'file_id', p_file_id);
END;
$$;

-- ---------- Steps 6–9: identity, duplicates, vacancy mapping, scoring ----------
CREATE OR REPLACE FUNCTION public.rec_migration_process(p_batch_id uuid, p_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec public.rec_migration_records;
  v_email text; v_phone text; v_name text;
  v_cand public.rec_candidates;
  v_kind text; v_sim numeric; v_signals jsonb;
  v_vac public.rec_vacancies; v_vac_kind text;
  v_skills text[]; v_quals text[]; v_years numeric;
  v_req numeric; v_pref numeric; v_qual numeric; v_exp numeric; v_mand numeric; v_overall numeric;
  v_breakdown jsonb; v_processed int := 0; v_dupes int := 0; v_unmatched int := 0;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not authorised'; END IF;

  FOR rec IN
    SELECT * FROM public.rec_migration_records
    WHERE batch_id = p_batch_id
      AND state IN ('PARSED','IDENTITY_MATCHING','VACANCY_MAPPING','MATCHING')
    ORDER BY source_row_no NULLS LAST, created_at
    LIMIT greatest(1, least(coalesce(p_limit,200), 1000))
  LOOP
    v_email := coalesce(public.rec_mig_norm_email(rec.normalized->>'email'),
                        public.rec_mig_norm_email(rec.extraction#>>'{identity,email}'));
    v_phone := coalesce(public.rec_mig_norm_phone(rec.normalized->>'phone'),
                        public.rec_mig_norm_phone(rec.extraction#>>'{identity,phone}'));
    v_name  := coalesce(public.rec_mig_norm_name(rec.normalized->>'full_name'),
                        public.rec_mig_norm_name(rec.extraction#>>'{identity,full_name}'));

    -- ---- identity resolution ----
    v_cand := NULL; v_kind := 'new'; v_sim := 0; v_signals := '[]'::jsonb;

    IF v_email IS NOT NULL THEN
      SELECT * INTO v_cand FROM public.rec_candidates WHERE lower(email) = v_email LIMIT 1;
      IF v_cand.id IS NOT NULL THEN
        v_kind := 'exact'; v_sim := 100;
        v_signals := v_signals || jsonb_build_array(jsonb_build_object('signal','email','match',true));
      END IF;
    END IF;

    IF v_cand.id IS NULL AND v_phone IS NOT NULL THEN
      SELECT * INTO v_cand FROM public.rec_candidates
      WHERE public.rec_mig_norm_phone(phone) = v_phone LIMIT 1;
      IF v_cand.id IS NOT NULL THEN
        v_kind := CASE WHEN public.rec_mig_norm_name(v_cand.full_name) = v_name THEN 'probable' ELSE 'possible' END;
        v_sim := CASE WHEN public.rec_mig_norm_name(v_cand.full_name) = v_name THEN 94 ELSE 72 END;
        v_signals := v_signals || jsonb_build_array(
          jsonb_build_object('signal','phone','match',true),
          jsonb_build_object('signal','name','match', public.rec_mig_norm_name(v_cand.full_name) = v_name));
      END IF;
    END IF;

    IF v_cand.id IS NULL AND v_name IS NOT NULL THEN
      SELECT * INTO v_cand FROM public.rec_candidates
      WHERE public.rec_mig_norm_name(full_name) = v_name LIMIT 1;
      IF v_cand.id IS NOT NULL THEN
        v_kind := 'possible'; v_sim := 66;
        v_signals := v_signals || jsonb_build_array(jsonb_build_object('signal','name','match',true));
      END IF;
    END IF;

    IF v_cand.id IS NULL THEN
      v_kind := 'new'; v_sim := 0;
    ELSE
      INSERT INTO public.rec_migration_duplicates (batch_id, record_id, candidate_id, classification, similarity, signals)
      VALUES (p_batch_id, rec.id, v_cand.id, v_kind, v_sim, v_signals)
      ON CONFLICT (record_id, candidate_id) DO UPDATE
        SET classification = excluded.classification, similarity = excluded.similarity, signals = excluded.signals
        WHERE public.rec_migration_duplicates.resolution = 'pending';
      IF v_kind <> 'exact' THEN v_dupes := v_dupes + 1; END IF;
    END IF;

    -- ---- vacancy mapping (never silently move a candidate) ----
    v_vac := NULL; v_vac_kind := 'unmatched';
    IF rec.vacancy_id IS NOT NULL THEN
      SELECT * INTO v_vac FROM public.rec_vacancies WHERE id = rec.vacancy_id;
      v_vac_kind := CASE WHEN v_vac.is_historical THEN 'historical' ELSE 'existing' END;
    ELSIF coalesce(rec.source_vacancy_ref,'') <> '' THEN
      SELECT * INTO v_vac FROM public.rec_vacancies
      WHERE source_vacancy_ref = rec.source_vacancy_ref
         OR lower(title) = lower(trim(rec.source_vacancy_ref))
         OR vacancy_no = rec.source_vacancy_ref
      ORDER BY is_historical, opened_at DESC LIMIT 1;
      IF v_vac.id IS NOT NULL THEN
        v_vac_kind := CASE WHEN v_vac.is_historical THEN 'historical' ELSE 'existing' END;
      END IF;
    END IF;
    IF v_vac.id IS NULL THEN v_unmatched := v_unmatched + 1; END IF;

    -- ---- explainable, job-related matching ----
    v_skills := array_cat(public.rec_mig_flat(rec.normalized->'skills'), public.rec_mig_flat(rec.extraction->'skills'));
    v_quals  := array_cat(public.rec_mig_flat(rec.normalized->'qualifications'), public.rec_mig_flat(rec.extraction->'qualifications'));
    v_years  := coalesce(nullif(rec.normalized->>'years_experience','')::numeric,
                         nullif(rec.extraction#>>'{experience,total_years}','')::numeric);

    v_overall := NULL; v_breakdown := jsonb_build_object('evaluated', false, 'reason', 'no vacancy mapped');

    IF v_vac.id IS NOT NULL THEN
      v_req  := public.rec_mig_coverage(v_vac.required_skills, v_skills);
      v_pref := public.rec_mig_coverage(v_vac.preferred_skills, v_skills);
      v_qual := public.rec_mig_coverage(v_vac.qualifications, v_quals);
      v_exp  := CASE
                  WHEN v_vac.min_years_experience IS NULL OR v_vac.min_years_experience = 0 THEN NULL
                  WHEN v_years IS NULL THEN NULL
                  ELSE round(least(100, 100.0 * v_years / v_vac.min_years_experience), 1) END;

      v_mand := (SELECT round(avg(x),1) FROM unnest(ARRAY[v_req, v_qual, v_exp]) x WHERE x IS NOT NULL);

      v_overall := round(
        coalesce(v_mand, 50) * 0.60
        + coalesce(v_pref, 50) * 0.15
        + coalesce(v_req, coalesce(v_mand,50)) * 0.15
        + coalesce(v_exp, coalesce(v_mand,50)) * 0.10, 1);

      -- a mandatory gap can never yield a high overall recommendation
      IF v_mand IS NOT NULL AND v_mand < 100 THEN v_overall := least(v_overall, 40 + v_mand * 0.35); END IF;

      v_breakdown := jsonb_build_object(
        'evaluated', true,
        'vacancy_id', v_vac.id,
        'vacancy_title', v_vac.title,
        'mandatory', jsonb_build_object(
          'score', v_mand,
          'required_skills', jsonb_build_object('score', v_req, 'required', to_jsonb(v_vac.required_skills)),
          'qualifications', jsonb_build_object('score', v_qual, 'required', to_jsonb(v_vac.qualifications)),
          'experience', jsonb_build_object('score', v_exp, 'min_years', v_vac.min_years_experience,
                                           'candidate_years', v_years,
                                           'status', CASE WHEN v_years IS NULL THEN 'requires verification' ELSE 'stated' END)),
        'preferred', jsonb_build_object('score', v_pref, 'preferred', to_jsonb(v_vac.preferred_skills)),
        'evidence_confidence', rec.extraction_confidence,
        'candidate_skills', to_jsonb(v_skills),
        'unmet', to_jsonb(
          coalesce((SELECT array_agg(r) FROM unnest(v_vac.required_skills) r
                    WHERE NOT EXISTS (SELECT 1 FROM unnest(v_skills) h WHERE lower(h) = lower(r)
                                        OR position(lower(r) in lower(h)) > 0)), '{}'::text[])),
        'fairness', 'protected characteristics excluded from scoring');
    END IF;

    UPDATE public.rec_migration_records SET
      candidate_id = CASE WHEN v_kind = 'exact' THEN v_cand.id ELSE candidate_id END,
      identity_match_kind = v_kind,
      identity_similarity = v_sim,
      vacancy_id = coalesce(vacancy_id, v_vac.id),
      vacancy_map_kind = v_vac_kind,
      match_score = v_overall,
      match_breakdown = v_breakdown,
      exception_code = CASE
        WHEN v_vac.id IS NULL THEN 'unmatched_vacancy'
        WHEN v_name IS NULL THEN 'missing_identity'
        WHEN v_email IS NULL AND v_phone IS NULL THEN 'missing_contact'
        WHEN coalesce(extraction_confidence, 0) < 40
             AND EXISTS (SELECT 1 FROM public.rec_migration_record_files rf WHERE rf.record_id = rec.id)
          THEN 'low_confidence'
        ELSE NULL END,
      exception_reason = CASE
        WHEN v_vac.id IS NULL THEN 'No vacancy could be matched from the source data'
        WHEN v_name IS NULL THEN 'No candidate name found in source data or CV'
        WHEN v_email IS NULL AND v_phone IS NULL THEN 'No email or phone found — identity cannot be verified'
        WHEN coalesce(extraction_confidence, 0) < 40
             AND EXISTS (SELECT 1 FROM public.rec_migration_record_files rf WHERE rf.record_id = rec.id)
          THEN 'Document extraction confidence is low — verify before import'
        ELSE NULL END,
      state = CASE
        WHEN v_kind IN ('probable','possible') THEN 'DUPLICATE_REVIEW'
        ELSE 'READY_FOR_REVIEW' END
    WHERE id = rec.id;

    v_processed := v_processed + 1;
  END LOOP;

  UPDATE public.rec_migration_batches SET status = 'review'
  WHERE id = p_batch_id AND status IN ('processing','ingesting','draft');

  PERFORM public.rec_mig_audit(p_batch_id, NULL, 'batch_processed', NULL,
    jsonb_build_object('processed', v_processed, 'duplicates', v_dupes, 'unmatched_vacancies', v_unmatched));

  RETURN jsonb_build_object('processed', v_processed, 'duplicate_reviews', v_dupes,
    'unmatched_vacancies', v_unmatched,
    'remaining', (SELECT count(*) FROM public.rec_migration_records
                  WHERE batch_id = p_batch_id AND state IN ('QUEUED','PARSING','PARSED')));
END;
$$;

-- ---------- historical vacancy reconstruction ----------
CREATE OR REPLACE FUNCTION public.rec_migration_create_historical_vacancy(
  p_batch_id uuid, p_title text, p_source_ref text DEFAULT NULL,
  p_location text DEFAULT NULL, p_opened_at timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not authorised'; END IF;
  IF coalesce(trim(p_title),'') = '' THEN RAISE EXCEPTION 'a vacancy title is required'; END IF;

  SELECT id INTO v_id FROM public.rec_vacancies
  WHERE is_historical AND migration_batch_id = p_batch_id
    AND (source_vacancy_ref = p_source_ref OR lower(title) = lower(trim(p_title)))
  LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.rec_vacancies (
    vacancy_no, title, location, status, approval_status, publication_status,
    is_historical, migration_batch_id, source_vacancy_ref, opened_at, closed_at)
  VALUES (
    'VAC-HIST-' || to_char(now(),'YYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,5)),
    left(trim(p_title),160), p_location, 'closed', 'approved', 'draft',
    true, p_batch_id, p_source_ref, coalesce(p_opened_at, now()), now())
  RETURNING id INTO v_id;

  PERFORM public.rec_mig_audit(p_batch_id, NULL, 'historical_vacancy_created', NULL,
    jsonb_build_object('vacancy_id', v_id, 'title', p_title));
  RETURN v_id;
END;
$$;

-- ---------- Step 10: human review (bulk, audited) ----------
CREATE OR REPLACE FUNCTION public.rec_migration_review(
  p_record_ids uuid[], p_action text, p_reason text DEFAULT NULL, p_value uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int := 0; v_batch uuid;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not authorised'; END IF;
  IF p_record_ids IS NULL OR cardinality(p_record_ids) = 0 THEN RAISE EXCEPTION 'no records selected'; END IF;

  SELECT batch_id INTO v_batch FROM public.rec_migration_records WHERE id = p_record_ids[1];

  IF p_action = 'approve' THEN
    UPDATE public.rec_migration_records SET
      state = 'APPROVED', review_decision = 'import',
      reviewed_by = auth.uid(), reviewed_at = now(), review_notes = p_reason
    WHERE id = ANY(p_record_ids) AND state NOT IN ('IMPORTED','ROLLED_BACK')
      AND vacancy_id IS NOT NULL;
  ELSIF p_action = 'approve_after_review' THEN
    UPDATE public.rec_migration_records SET
      review_decision = 'import_after_review', state = 'READY_FOR_REVIEW',
      reviewed_by = auth.uid(), reviewed_at = now(), review_notes = p_reason
    WHERE id = ANY(p_record_ids) AND state NOT IN ('IMPORTED','ROLLED_BACK');
  ELSIF p_action = 'reject' THEN
    UPDATE public.rec_migration_records SET
      state = 'REJECTED', review_decision = 'do_not_import',
      reviewed_by = auth.uid(), reviewed_at = now(), review_notes = p_reason
    WHERE id = ANY(p_record_ids) AND state NOT IN ('IMPORTED','ROLLED_BACK');
  ELSIF p_action = 'assign_vacancy' THEN
    IF p_value IS NULL THEN RAISE EXCEPTION 'a vacancy is required'; END IF;
    UPDATE public.rec_migration_records r SET
      vacancy_id = p_value,
      vacancy_map_kind = CASE WHEN (SELECT is_historical FROM public.rec_vacancies WHERE id = p_value)
                              THEN 'historical' ELSE 'existing' END,
      state = CASE WHEN r.state IN ('READY_FOR_REVIEW','EXCEPTION','FAILED') THEN 'MATCHING' ELSE r.state END,
      exception_code = CASE WHEN r.exception_code = 'unmatched_vacancy' THEN NULL ELSE r.exception_code END,
      exception_reason = CASE WHEN r.exception_code = 'unmatched_vacancy' THEN NULL ELSE r.exception_reason END
    WHERE r.id = ANY(p_record_ids) AND r.state NOT IN ('IMPORTED','ROLLED_BACK');
  ELSIF p_action = 'retry' THEN
    UPDATE public.rec_migration_records SET
      state = CASE WHEN EXISTS (SELECT 1 FROM public.rec_migration_record_files rf WHERE rf.record_id = id)
                   THEN 'QUEUED' ELSE 'PARSED' END,
      exception_code = NULL, exception_reason = NULL
    WHERE id = ANY(p_record_ids) AND state NOT IN ('IMPORTED','ROLLED_BACK');
    UPDATE public.rec_migration_files SET status = 'queued', attempts = 0, parse_error = NULL
    WHERE id IN (SELECT file_id FROM public.rec_migration_record_files WHERE record_id = ANY(p_record_ids))
      AND status = 'failed';
  ELSIF p_action = 'mark_reviewed' THEN
    UPDATE public.rec_migration_records SET
      reviewed_by = auth.uid(), reviewed_at = now(), review_notes = p_reason,
      state = CASE WHEN state = 'DUPLICATE_REVIEW' THEN 'READY_FOR_REVIEW' ELSE state END
    WHERE id = ANY(p_record_ids) AND state NOT IN ('IMPORTED','ROLLED_BACK');
  ELSE
    RAISE EXCEPTION 'unsupported review action: %', p_action;
  END IF;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM public.rec_mig_audit(v_batch, NULL, 'review_' || p_action, NULL,
    jsonb_build_object('records', to_jsonb(p_record_ids), 'affected', v_count, 'value', p_value), p_reason);

  RETURN jsonb_build_object('action', p_action, 'affected', v_count);
END;
$$;

-- ---------- duplicate resolution ----------
CREATE OR REPLACE FUNCTION public.rec_migration_resolve_duplicate(
  p_duplicate_id uuid, p_action text, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.rec_migration_duplicates;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not authorised'; END IF;
  SELECT * INTO d FROM public.rec_migration_duplicates WHERE id = p_duplicate_id;
  IF d.id IS NULL THEN RAISE EXCEPTION 'duplicate suggestion not found'; END IF;
  IF d.resolution <> 'pending' THEN RETURN jsonb_build_object('already_resolved', true, 'resolution', d.resolution); END IF;

  IF p_action = 'merge' THEN
    UPDATE public.rec_migration_duplicates SET resolution = 'merged', resolved_by = auth.uid(),
      resolved_at = now(), resolution_notes = p_notes WHERE id = d.id;
    UPDATE public.rec_migration_records SET candidate_id = d.candidate_id,
      identity_match_kind = 'exact', state = 'READY_FOR_REVIEW' WHERE id = d.record_id;
  ELSIF p_action = 'keep_separate' THEN
    UPDATE public.rec_migration_duplicates SET resolution = 'kept_separate', resolved_by = auth.uid(),
      resolved_at = now(), resolution_notes = p_notes WHERE id = d.id;
    UPDATE public.rec_migration_records SET candidate_id = NULL, identity_match_kind = 'new',
      state = 'READY_FOR_REVIEW' WHERE id = d.record_id;
  ELSE
    RAISE EXCEPTION 'unsupported duplicate action: %', p_action;
  END IF;

  PERFORM public.rec_mig_audit(d.batch_id, d.record_id, 'duplicate_' || p_action,
    to_jsonb(d), NULL, p_notes);
  RETURN jsonb_build_object('ok', true, 'action', p_action);
END;
$$;

-- ---------- Step 11: preview ----------
CREATE OR REPLACE FUNCTION public.rec_migration_preview(p_batch_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'records', (SELECT count(*) FROM public.rec_migration_records WHERE batch_id = p_batch_id),
    'by_state', (SELECT coalesce(jsonb_object_agg(state, c), '{}'::jsonb)
                 FROM (SELECT state, count(*) c FROM public.rec_migration_records
                       WHERE batch_id = p_batch_id GROUP BY state) s),
    'new_candidates', (SELECT count(*) FROM public.rec_migration_records
                       WHERE batch_id = p_batch_id AND candidate_id IS NULL AND state IN ('READY_FOR_REVIEW','APPROVED')),
    'existing_candidates', (SELECT count(*) FROM public.rec_migration_records
                       WHERE batch_id = p_batch_id AND candidate_id IS NOT NULL),
    'possible_duplicates', (SELECT count(*) FROM public.rec_migration_duplicates
                       WHERE batch_id = p_batch_id AND resolution = 'pending' AND classification <> 'exact'),
    'exceptions', (SELECT count(*) FROM public.rec_migration_records
                       WHERE batch_id = p_batch_id AND exception_code IS NOT NULL),
    'approved', (SELECT count(*) FROM public.rec_migration_records
                       WHERE batch_id = p_batch_id AND state = 'APPROVED'),
    'applications_by_vacancy', (SELECT coalesce(jsonb_object_agg(title, c), '{}'::jsonb) FROM (
        SELECT coalesce(v.title, 'Unmatched') title, count(*) c
        FROM public.rec_migration_records r LEFT JOIN public.rec_vacancies v ON v.id = r.vacancy_id
        WHERE r.batch_id = p_batch_id GROUP BY 1) t),
    'documents', (SELECT coalesce(jsonb_object_agg(doc_type, c), '{}'::jsonb) FROM (
        SELECT doc_type, count(*) c FROM public.rec_migration_files
        WHERE batch_id = p_batch_id AND file_kind = 'document' GROUP BY 1) d)
  );
$$;

-- ---------- Step 12: transactional, idempotent import ----------
CREATE OR REPLACE FUNCTION public.rec_migration_commit(p_batch_id uuid, p_limit integer DEFAULT 200)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec public.rec_migration_records;
  b public.rec_migration_batches;
  v_cand_id uuid; v_app_id uuid; v_new_cand boolean; v_stage text;
  v_email text; v_phone text; v_name text;
  f record; v_imported int := 0; v_existing int := 0; v_skipped int := 0; v_failed int := 0;
  v_version int;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not authorised'; END IF;
  SELECT * INTO b FROM public.rec_migration_batches WHERE id = p_batch_id;
  IF b.id IS NULL THEN RAISE EXCEPTION 'batch not found'; END IF;
  IF b.status = 'rolled_back' THEN RAISE EXCEPTION 'batch has been rolled back'; END IF;

  UPDATE public.rec_migration_batches SET status = 'importing' WHERE id = p_batch_id;

  FOR rec IN
    SELECT * FROM public.rec_migration_records
    WHERE batch_id = p_batch_id AND state = 'APPROVED' AND imported_application_id IS NULL
    ORDER BY source_row_no NULLS LAST, created_at
    LIMIT greatest(1, least(coalesce(p_limit,200), 1000))
  LOOP
    BEGIN
      IF rec.vacancy_id IS NULL THEN
        UPDATE public.rec_migration_records SET state = 'EXCEPTION', exception_code = 'unmatched_vacancy',
          exception_reason = 'Cannot import without a mapped vacancy' WHERE id = rec.id;
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      v_email := coalesce(public.rec_mig_norm_email(rec.normalized->>'email'),
                          public.rec_mig_norm_email(rec.extraction#>>'{identity,email}'));
      v_phone := coalesce(public.rec_mig_norm_phone(rec.normalized->>'phone'),
                          public.rec_mig_norm_phone(rec.extraction#>>'{identity,phone}'));
      v_name  := coalesce(nullif(trim(coalesce(rec.normalized->>'full_name','')),''),
                          nullif(trim(coalesce(rec.extraction#>>'{identity,full_name}','')),''));

      IF v_name IS NULL THEN
        UPDATE public.rec_migration_records SET state = 'EXCEPTION', exception_code = 'missing_identity',
          exception_reason = 'Cannot import without a candidate name' WHERE id = rec.id;
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- candidate: reuse the resolved identity, else the email owner, else create
      v_cand_id := rec.candidate_id;
      IF v_cand_id IS NULL AND v_email IS NOT NULL THEN
        SELECT id INTO v_cand_id FROM public.rec_candidates WHERE lower(email) = v_email LIMIT 1;
      END IF;
      v_new_cand := v_cand_id IS NULL;

      IF v_new_cand THEN
        INSERT INTO public.rec_candidates (
          candidate_no, full_name, email, phone, location, current_employer, current_title,
          years_experience, source, engagement_status, consent_given,
          migration_batch_id, source_platform, source_candidate_ref, created_by_migration)
        VALUES (
          'CAN-' || to_char(now(),'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,5)),
          left(v_name,160), v_email, v_phone,
          left(nullif(coalesce(rec.normalized->>'location', rec.extraction#>>'{identity,location}'),''),160),
          left(nullif(coalesce(rec.normalized->>'current_employer', rec.extraction#>>'{professional,current_employer}'),''),160),
          left(nullif(coalesce(rec.normalized->>'current_title', rec.extraction#>>'{professional,current_title}'),''),160),
          coalesce(nullif(rec.normalized->>'years_experience','')::numeric,
                   nullif(rec.extraction#>>'{experience,total_years}','')::numeric),
          'migration', 'passive', false,
          p_batch_id, coalesce(rec.source_platform, b.source_platform), rec.source_candidate_ref, true)
        RETURNING id INTO v_cand_id;
      ELSE
        -- enrich only empty fields; never overwrite curated data
        UPDATE public.rec_candidates SET
          phone = coalesce(phone, v_phone),
          location = coalesce(location, left(nullif(rec.normalized->>'location',''),160)),
          current_employer = coalesce(current_employer, left(nullif(rec.normalized->>'current_employer',''),160)),
          current_title = coalesce(current_title, left(nullif(rec.normalized->>'current_title',''),160)),
          updated_at = now()
        WHERE id = v_cand_id AND record_state <> 'locked';
      END IF;

      -- historical status is preserved, never assumed
      v_stage := CASE lower(coalesce(rec.source_status,''))
        WHEN 'hired' THEN 'hired'
        WHEN 'rejected' THEN 'rejected'
        WHEN 'withdrawn' THEN 'withdrawn'
        WHEN 'shortlisted' THEN 'shortlisted'
        WHEN 'interviewed' THEN 'interview'
        WHEN 'interview' THEN 'interview'
        WHEN 'screened' THEN 'screening'
        WHEN 'screening' THEN 'screening'
        ELSE 'applied' END;

      SELECT id INTO v_app_id FROM public.rec_applications
      WHERE candidate_id = v_cand_id AND vacancy_id = rec.vacancy_id LIMIT 1;

      IF v_app_id IS NULL THEN
        INSERT INTO public.rec_applications (
          application_no, candidate_id, vacancy_id, source, source_detail, cover_letter,
          stage, status, priority, applied_at, ai_match_score,
          migration_batch_id, source_platform, source_application_ref, source_vacancy_ref,
          source_status, source_applied_at, created_by_migration)
        VALUES (
          'APP-' || to_char(now(),'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),
          v_cand_id, rec.vacancy_id, 'migration', left(coalesce(b.source_platform, b.name),120),
          nullif(rec.normalized->>'cover_letter',''),
          v_stage, CASE WHEN v_stage IN ('rejected','withdrawn','hired') THEN 'closed' ELSE 'active' END,
          'normal', coalesce(rec.source_applied_at, now()), rec.match_score,
          p_batch_id, coalesce(rec.source_platform, b.source_platform),
          rec.source_application_ref, rec.source_vacancy_ref, rec.source_status, rec.source_applied_at, true)
        RETURNING id INTO v_app_id;
        v_imported := v_imported + 1;
      ELSE
        v_existing := v_existing + 1;
      END IF;

      -- documents: versioned, never overwritten, deduplicated on hash
      FOR f IN
        SELECT mf.*, rf.doc_type AS link_doc_type
        FROM public.rec_migration_record_files rf
        JOIN public.rec_migration_files mf ON mf.id = rf.file_id
        WHERE rf.record_id = rec.id
      LOOP
        SELECT count(*) + 1 INTO v_version FROM public.rec_candidate_documents
        WHERE candidate_id = v_cand_id AND doc_type = coalesce(f.link_doc_type, f.doc_type);

        INSERT INTO public.rec_candidate_documents (
          candidate_id, application_id, doc_type, file_name, storage_path, mime_type, size_bytes,
          migration_batch_id, original_file_name, file_hash, version_no, is_preferred, created_by_migration)
        VALUES (
          v_cand_id, v_app_id,
          CASE WHEN coalesce(f.link_doc_type, f.doc_type) IN
            ('cv','cover_letter','certificate','identification','other')
            THEN coalesce(f.link_doc_type, f.doc_type) ELSE 'other' END,
          f.original_file_name, f.storage_path, f.mime_type, f.size_bytes,
          p_batch_id, f.original_file_name, f.sha256, v_version,
          coalesce(f.link_doc_type, f.doc_type) = 'cv', true)
        ON CONFLICT (candidate_id, file_hash) WHERE file_hash IS NOT NULL DO NOTHING;
      END LOOP;

      UPDATE public.rec_migration_records SET
        state = 'IMPORTED', candidate_id = v_cand_id,
        imported_candidate_id = v_cand_id, imported_application_id = v_app_id,
        imported_at = now(),
        import_outcome = CASE WHEN v_new_cand THEN 'candidate_created' ELSE 'candidate_matched' END,
        exception_code = NULL, exception_reason = NULL
      WHERE id = rec.id;

      PERFORM public.rec_mig_audit(p_batch_id, rec.id, 'record_imported', NULL,
        jsonb_build_object('candidate_id', v_cand_id, 'application_id', v_app_id,
                           'new_candidate', v_new_cand, 'stage', v_stage));

    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      UPDATE public.rec_migration_records SET state = 'FAILED', exception_code = 'import_failed',
        exception_reason = left(SQLERRM, 500) WHERE id = rec.id;
      PERFORM public.rec_mig_audit(p_batch_id, rec.id, 'record_import_failed', NULL, NULL, left(SQLERRM,500));
    END;
  END LOOP;

  UPDATE public.rec_migration_batches SET
    status = CASE
      WHEN EXISTS (SELECT 1 FROM public.rec_migration_records
                   WHERE batch_id = p_batch_id AND state IN ('APPROVED','READY_FOR_REVIEW','DUPLICATE_REVIEW','QUEUED','PARSED'))
        THEN 'partially_imported' ELSE 'imported' END,
    completed_at = now(),
    totals = public.rec_migration_preview(p_batch_id)
  WHERE id = p_batch_id;

  PERFORM public.rec_mig_audit(p_batch_id, NULL, 'batch_import_run', NULL,
    jsonb_build_object('imported', v_imported, 'existing_applications', v_existing,
                       'skipped', v_skipped, 'failed', v_failed));

  RETURN jsonb_build_object('imported', v_imported, 'already_imported', v_existing,
    'skipped', v_skipped, 'failed', v_failed,
    'pending', (SELECT count(*) FROM public.rec_migration_records
                WHERE batch_id = p_batch_id AND state = 'APPROVED'));
END;
$$;

-- ---------- Step 13: verification & report ----------
CREATE OR REPLACE FUNCTION public.rec_migration_verify(p_batch_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'candidates_created', (SELECT count(*) FROM public.rec_candidates WHERE migration_batch_id = p_batch_id),
    'applications_created', (SELECT count(*) FROM public.rec_applications WHERE migration_batch_id = p_batch_id),
    'documents_attached', (SELECT count(*) FROM public.rec_candidate_documents WHERE migration_batch_id = p_batch_id),
    'vacancies_linked', (SELECT count(DISTINCT vacancy_id) FROM public.rec_applications WHERE migration_batch_id = p_batch_id),
    'duplicates_resolved', (SELECT count(*) FROM public.rec_migration_duplicates WHERE batch_id = p_batch_id AND resolution <> 'pending'),
    'duplicates_pending', (SELECT count(*) FROM public.rec_migration_duplicates WHERE batch_id = p_batch_id AND resolution = 'pending'),
    'records_imported', (SELECT count(*) FROM public.rec_migration_records WHERE batch_id = p_batch_id AND state = 'IMPORTED'),
    'records_failed', (SELECT count(*) FROM public.rec_migration_records WHERE batch_id = p_batch_id AND state = 'FAILED'),
    'provenance_complete', NOT EXISTS (
       SELECT 1 FROM public.rec_applications
       WHERE migration_batch_id = p_batch_id AND (source_platform IS NULL AND source_application_ref IS NULL AND source_status IS NULL)),
    'orphan_applications', (SELECT count(*) FROM public.rec_applications a
       WHERE a.migration_batch_id = p_batch_id
         AND NOT EXISTS (SELECT 1 FROM public.rec_candidates c WHERE c.id = a.candidate_id)),
    'rollback_available', (SELECT rollback_available AND status <> 'rolled_back' FROM public.rec_migration_batches WHERE id = p_batch_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.rec_migration_report(p_batch_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'batch', (SELECT to_jsonb(b) FROM public.rec_migration_batches b WHERE b.id = p_batch_id),
    'files', jsonb_build_object(
      'received', (SELECT count(*) FROM public.rec_migration_files WHERE batch_id = p_batch_id),
      'parsed', (SELECT count(*) FROM public.rec_migration_files WHERE batch_id = p_batch_id AND status = 'parsed'),
      'failed', (SELECT count(*) FROM public.rec_migration_files WHERE batch_id = p_batch_id AND status = 'failed'),
      'by_type', (SELECT coalesce(jsonb_object_agg(doc_type, c),'{}'::jsonb) FROM
        (SELECT doc_type, count(*) c FROM public.rec_migration_files WHERE batch_id = p_batch_id GROUP BY 1) t)),
    'preview', public.rec_migration_preview(p_batch_id),
    'verification', public.rec_migration_verify(p_batch_id),
    'extraction', jsonb_build_object(
      'high', (SELECT count(*) FROM public.rec_migration_records WHERE batch_id = p_batch_id AND extraction_confidence >= 80),
      'medium', (SELECT count(*) FROM public.rec_migration_records WHERE batch_id = p_batch_id AND extraction_confidence >= 50 AND extraction_confidence < 80),
      'low', (SELECT count(*) FROM public.rec_migration_records WHERE batch_id = p_batch_id AND coalesce(extraction_confidence,0) < 50)),
    'exceptions', (SELECT coalesce(jsonb_object_agg(exception_code, c),'{}'::jsonb) FROM
      (SELECT exception_code, count(*) c FROM public.rec_migration_records
       WHERE batch_id = p_batch_id AND exception_code IS NOT NULL GROUP BY 1) e),
    'quality', (
      SELECT jsonb_build_object(
        'total', count(*),
        'vacancy_mapping_rate', round(100.0 * count(*) FILTER (WHERE vacancy_id IS NOT NULL) / greatest(count(*),1), 1),
        'identity_confidence', round(coalesce(avg(nullif(identity_similarity,0)), 0), 1),
        'extraction_confidence', round(coalesce(avg(extraction_confidence), 0), 1),
        'exception_rate', round(100.0 * count(*) FILTER (WHERE exception_code IS NOT NULL) / greatest(count(*),1), 1),
        'duplicate_rate', round(100.0 * count(*) FILTER (WHERE identity_match_kind IN ('probable','possible')) / greatest(count(*),1), 1),
        'overall', round(
          0.4 * (100.0 * count(*) FILTER (WHERE vacancy_id IS NOT NULL) / greatest(count(*),1))
        + 0.3 * (100.0 - 100.0 * count(*) FILTER (WHERE exception_code IS NOT NULL) / greatest(count(*),1))
        + 0.3 * coalesce(avg(coalesce(extraction_confidence, 70)), 70), 1))
      FROM public.rec_migration_records WHERE batch_id = p_batch_id)
  );
$$;

-- ---------- Step 14: safe rollback (only rows this batch created) ----------
CREATE OR REPLACE FUNCTION public.rec_migration_rollback(p_batch_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_docs int; v_apps int; v_cands int;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'only a platform administrator can roll back a migration'; END IF;
  IF coalesce(trim(p_reason),'') = '' THEN RAISE EXCEPTION 'a rollback reason is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rec_migration_batches
                 WHERE id = p_batch_id AND rollback_available AND status <> 'rolled_back') THEN
    RAISE EXCEPTION 'this batch cannot be rolled back';
  END IF;

  -- evidence snapshot before anything is removed
  PERFORM public.rec_mig_audit(p_batch_id, NULL, 'rollback_started', public.rec_migration_report(p_batch_id), NULL, p_reason);

  DELETE FROM public.rec_candidate_documents
  WHERE migration_batch_id = p_batch_id AND created_by_migration;
  GET DIAGNOSTICS v_docs = ROW_COUNT;

  DELETE FROM public.rec_applications
  WHERE migration_batch_id = p_batch_id AND created_by_migration;
  GET DIAGNOSTICS v_apps = ROW_COUNT;

  -- only candidates this migration created, and only if nothing else now depends on them
  DELETE FROM public.rec_candidates c
  WHERE c.migration_batch_id = p_batch_id AND c.created_by_migration
    AND NOT EXISTS (SELECT 1 FROM public.rec_applications a WHERE a.candidate_id = c.id);
  GET DIAGNOSTICS v_cands = ROW_COUNT;

  UPDATE public.rec_migration_records SET state = 'ROLLED_BACK',
    imported_candidate_id = NULL, imported_application_id = NULL, imported_at = NULL,
    import_outcome = 'rolled_back'
  WHERE batch_id = p_batch_id AND state = 'IMPORTED';

  UPDATE public.rec_migration_batches SET status = 'rolled_back', rollback_available = false,
    rolled_back_at = now(), rolled_back_by = auth.uid() WHERE id = p_batch_id;

  PERFORM public.rec_mig_audit(p_batch_id, NULL, 'rollback_completed', NULL,
    jsonb_build_object('documents_removed', v_docs, 'applications_removed', v_apps, 'candidates_removed', v_cands), p_reason);

  RETURN jsonb_build_object('documents_removed', v_docs, 'applications_removed', v_apps,
    'candidates_removed', v_cands, 'preexisting_candidates_preserved', true);
END;
$$;

-- ---------- review queue reader ----------
CREATE OR REPLACE FUNCTION public.rec_migration_queue(
  p_batch_id uuid, p_queue text DEFAULT 'all', p_search text DEFAULT NULL,
  p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
RETURNS TABLE (
  id uuid, source_row_no integer, full_name text, email text, phone text,
  state text, exception_code text, exception_reason text,
  identity_match_kind text, identity_similarity numeric,
  vacancy_id uuid, vacancy_title text, vacancy_map_kind text,
  match_score numeric, extraction_confidence numeric,
  source_status text, source_applied_at timestamptz,
  review_decision text, document_count bigint, duplicate_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.source_row_no,
    coalesce(r.normalized->>'full_name', r.extraction#>>'{identity,full_name}') AS full_name,
    coalesce(r.normalized->>'email', r.extraction#>>'{identity,email}') AS email,
    coalesce(r.normalized->>'phone', r.extraction#>>'{identity,phone}') AS phone,
    r.state, r.exception_code, r.exception_reason,
    r.identity_match_kind, r.identity_similarity,
    r.vacancy_id, v.title, r.vacancy_map_kind,
    r.match_score, r.extraction_confidence,
    r.source_status, r.source_applied_at, r.review_decision,
    (SELECT count(*) FROM public.rec_migration_record_files rf WHERE rf.record_id = r.id),
    (SELECT count(*) FROM public.rec_migration_duplicates d WHERE d.record_id = r.id AND d.resolution = 'pending')
  FROM public.rec_migration_records r
  LEFT JOIN public.rec_vacancies v ON v.id = r.vacancy_id
  WHERE r.batch_id = p_batch_id
    AND public.rec_can_read()
    AND (
      p_queue = 'all'
      OR (p_queue = 'ready' AND r.state = 'READY_FOR_REVIEW' AND r.exception_code IS NULL)
      OR (p_queue = 'needs_review' AND r.exception_code IS NOT NULL AND r.state NOT IN ('IMPORTED','REJECTED'))
      OR (p_queue = 'duplicates' AND r.state = 'DUPLICATE_REVIEW')
      OR (p_queue = 'unmatched_vacancy' AND r.exception_code = 'unmatched_vacancy')
      OR (p_queue = 'low_confidence' AND r.exception_code = 'low_confidence')
      OR (p_queue = 'parsing_failed' AND r.exception_code = 'parse_failed')
      OR (p_queue = 'approved' AND r.state = 'APPROVED')
      OR (p_queue = 'imported' AND r.state = 'IMPORTED')
      OR (p_queue = 'rejected' AND r.state = 'REJECTED')
      OR (p_queue = 'failed' AND r.state IN ('FAILED','EXCEPTION'))
    )
    AND (
      p_search IS NULL OR trim(p_search) = ''
      OR coalesce(r.normalized->>'full_name','') ILIKE '%' || trim(p_search) || '%'
      OR coalesce(r.normalized->>'email','') ILIKE '%' || trim(p_search) || '%'
      OR coalesce(r.normalized->>'phone','') ILIKE '%' || trim(p_search) || '%'
      OR coalesce(r.source_vacancy_ref,'') ILIKE '%' || trim(p_search) || '%'
    )
  ORDER BY r.source_row_no NULLS LAST, r.created_at
  LIMIT greatest(1, least(coalesce(p_limit,100), 500)) OFFSET greatest(0, coalesce(p_offset,0));
$$;

REVOKE EXECUTE ON FUNCTION public.rec_migration_create_batch(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rec_migration_register_file(uuid,text,text,text,bigint,text,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rec_migration_stage_records(uuid,jsonb,jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rec_migration_claim_files(uuid,integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rec_migration_record_parse(uuid,text,jsonb,numeric,integer,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rec_migration_process(uuid,integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rec_migration_review(uuid[],text,text,uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rec_migration_resolve_duplicate(uuid,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rec_migration_preview(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rec_migration_commit(uuid,integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rec_migration_verify(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rec_migration_report(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rec_migration_rollback(uuid,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rec_migration_queue(uuid,text,text,integer,integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rec_migration_create_historical_vacancy(uuid,text,text,text,timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.rec_migration_save_mapping(text,text,text,jsonb) FROM anon;