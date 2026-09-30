-- 1. Review-flag columns
ALTER TABLE public.rec_applications ADD COLUMN IF NOT EXISTS review_flagged boolean NOT NULL DEFAULT false;
ALTER TABLE public.rec_applications ADD COLUMN IF NOT EXISTS review_flag_reason text;

-- 2. rec_public_apply: flag (not reject) applications that answer "No" to an
--    informational boolean acknowledgement question.
CREATE OR REPLACE FUNCTION public.rec_public_apply(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vac public.rec_vacancies;
  v_bp public.rec_blueprints;
  v_slug text := nullif(trim(p_payload->>'vacancy_slug'), '');
  v_email text := lower(nullif(trim(p_payload->>'email'), ''));
  v_name text := nullif(trim(p_payload->>'full_name'), '');
  v_phone text := nullif(trim(p_payload->>'phone'), '');
  v_candidate public.rec_candidates;
  v_app_id uuid;
  v_app_no text;
  v_doc jsonb;
  v_docs jsonb := coalesce(p_payload->'documents', '[]'::jsonb);
  v_answers jsonb := coalesce(p_payload->'answers', '{}'::jsonb);
  v_q public.rec_blueprint_questions;
  v_req jsonb;
  v_ans jsonb;
  v_ans_text text;
  v_score numeric;
  v_ko boolean;
  v_ko_flag boolean := false;
  v_review_flag boolean := false;
  v_review_keys text[] := '{}';
  v_skills text[];
  v_skill text;
  v_skill_id uuid;
  v_notice text;
  v_has_cv boolean := false;
  v_attempts integer;
  v_reason text;
  v_ext text;
  v_allowed_mimes text[] := ARRAY[
    'application/pdf','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png','image/jpeg','image/jpg','image/webp','image/heic','image/heif','text/plain'
  ];
  v_allowed_exts text[] := ARRAY['pdf','doc','docx','png','jpg','jpeg','webp','heic','heif','txt'];
BEGIN
  -- ---- identity + consent ----
  IF v_slug IS NULL THEN
    v_reason := 'vacancy_slug is required'; RAISE EXCEPTION '%', v_reason;
  END IF;
  IF v_name IS NULL OR char_length(v_name) < 2 OR char_length(v_name) > 120 THEN
    v_reason := 'full_name must be between 2 and 120 characters'; RAISE EXCEPTION '%', v_reason;
  END IF;
  IF v_email IS NULL OR char_length(v_email) > 254
     OR v_email !~ '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$' THEN
    v_reason := 'a valid email address is required'; RAISE EXCEPTION '%', v_reason;
  END IF;
  IF coalesce((p_payload->>'consent_privacy')::boolean, false) IS NOT TRUE THEN
    v_reason := 'privacy consent is required'; RAISE EXCEPTION '%', v_reason;
  END IF;
  IF coalesce((p_payload->>'declaration_accuracy')::boolean, false) IS NOT TRUE THEN
    v_reason := 'you must declare that the information provided is accurate';
    RAISE EXCEPTION '%', v_reason;
  END IF;

  -- ---- rate limit: 5 attempts / hour / email+vacancy ----
  SELECT count(*) INTO v_attempts
  FROM public.rec_public_apply_attempts
  WHERE email = v_email AND vacancy_slug = v_slug AND created_at > now() - interval '1 hour';

  IF v_attempts >= 5 THEN
    INSERT INTO public.rec_public_apply_attempts (email, vacancy_slug, outcome, reason)
    VALUES (v_email, v_slug, 'rejected', 'rate_limited');
    RAISE EXCEPTION 'too many application attempts for this vacancy — please try again later';
  END IF;

  -- ---- optional field shape ----
  IF v_phone IS NOT NULL AND (char_length(v_phone) < 7 OR char_length(v_phone) > 24 OR v_phone !~ '^[0-9+()\-\s]+$') THEN
    v_reason := 'phone number format is invalid'; RAISE EXCEPTION '%', v_reason;
  END IF;
  IF char_length(coalesce(p_payload->>'cover_letter','')) > 8000 THEN
    v_reason := 'cover letter is too long (max 8000 characters)'; RAISE EXCEPTION '%', v_reason;
  END IF;
  IF nullif(p_payload->>'years_experience','') IS NOT NULL
     AND ((p_payload->>'years_experience')::numeric < 0 OR (p_payload->>'years_experience')::numeric > 60) THEN
    v_reason := 'years_experience must be between 0 and 60'; RAISE EXCEPTION '%', v_reason;
  END IF;

  -- ---- collection sizes ----
  IF jsonb_typeof(coalesce(p_payload->'academic_qualifications','[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(p_payload->'professional_qualifications','[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(p_payload->'employment_history','[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(p_payload->'skills','[]'::jsonb)) <> 'array'
     OR jsonb_typeof(v_docs) <> 'array' THEN
    v_reason := 'academic, professional, employment, skills and documents must be lists';
    RAISE EXCEPTION '%', v_reason;
  END IF;
  IF jsonb_typeof(v_answers) <> 'object' THEN
    v_reason := 'answers must be an object keyed by question'; RAISE EXCEPTION '%', v_reason;
  END IF;
  IF jsonb_array_length(coalesce(p_payload->'academic_qualifications','[]'::jsonb)) > 20
     OR jsonb_array_length(coalesce(p_payload->'professional_qualifications','[]'::jsonb)) > 20
     OR jsonb_array_length(coalesce(p_payload->'employment_history','[]'::jsonb)) > 25
     OR jsonb_array_length(coalesce(p_payload->'skills','[]'::jsonb)) > 60
     OR jsonb_array_length(v_docs) > 10 THEN
    v_reason := 'too many entries submitted'; RAISE EXCEPTION '%', v_reason;
  END IF;

  SELECT coalesce(array_agg(left(trim(value), 80)) FILTER (WHERE trim(value) <> ''), '{}')
    INTO v_skills
  FROM jsonb_array_elements_text(coalesce(p_payload->'skills','[]'::jsonb)) AS t(value);

  -- ---- vacancy eligibility (server is the authority) ----
  SELECT * INTO v_vac FROM public.rec_vacancies
  WHERE public_slug = v_slug
    AND approval_status = 'approved'
    AND publication_status = 'published'
    AND status = 'open'
    AND published_at IS NOT NULL;

  IF v_vac.id IS NULL THEN
    INSERT INTO public.rec_public_apply_attempts (email, vacancy_slug, outcome, reason)
    VALUES (v_email, v_slug, 'rejected', 'vacancy_not_open');
    RAISE EXCEPTION 'vacancy is not open for applications';
  END IF;

  SELECT * INTO v_bp FROM public.rec_blueprints WHERE vacancy_id = v_vac.id AND status = 'active';

  -- ---- blueprint rules: cover letter + required questions ----
  IF v_bp.id IS NOT NULL THEN
    IF v_bp.cover_letter_mode = 'required'
       AND char_length(coalesce(trim(p_payload->>'cover_letter'),'')) < 50 THEN
      v_reason := 'a cover letter is required for this vacancy';
      INSERT INTO public.rec_public_apply_attempts (email, vacancy_slug, outcome, reason)
      VALUES (v_email, v_slug, 'rejected', 'cover_letter_missing');
      RAISE EXCEPTION '%', v_reason;
    END IF;

    FOR v_q IN SELECT * FROM public.rec_blueprint_questions WHERE blueprint_id = v_bp.id ORDER BY ord LOOP
      v_ans := v_answers -> v_q.question_key;
      v_ans_text := CASE
        WHEN v_ans IS NULL OR jsonb_typeof(v_ans) = 'null' THEN NULL
        WHEN jsonb_typeof(v_ans) = 'string' THEN nullif(trim(v_ans #>> '{}'), '')
        WHEN jsonb_typeof(v_ans) = 'array' AND jsonb_array_length(v_ans) = 0 THEN NULL
        ELSE v_ans::text
      END;

      IF v_q.is_required AND v_ans_text IS NULL THEN
        INSERT INTO public.rec_public_apply_attempts (email, vacancy_slug, outcome, reason)
        VALUES (v_email, v_slug, 'rejected', 'question_missing:' || v_q.question_key);
        RAISE EXCEPTION 'please answer: %', v_q.prompt;
      END IF;
      IF v_ans_text IS NOT NULL AND char_length(v_ans_text) > 6000 THEN
        RAISE EXCEPTION 'answer to "%" is too long', v_q.prompt;
      END IF;
    END LOOP;

    FOR v_req IN SELECT * FROM jsonb_array_elements(v_bp.document_requirements) LOOP
      IF coalesce((v_req->>'required')::boolean, false)
         AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_docs) d
           WHERE d->>'doc_type' = v_req->>'doc_type') THEN
        INSERT INTO public.rec_public_apply_attempts (email, vacancy_slug, outcome, reason)
        VALUES (v_email, v_slug, 'rejected', 'document_missing:' || coalesce(v_req->>'doc_type','?'));
        RAISE EXCEPTION '% is required', coalesce(v_req->>'label', v_req->>'doc_type');
      END IF;
    END LOOP;
  END IF;

  -- ---- document security rules ----
  FOR v_doc IN SELECT * FROM jsonb_array_elements(v_docs) LOOP
    IF coalesce(v_doc->>'storage_path','') = '' THEN
      v_reason := 'each document requires a storage_path'; RAISE EXCEPTION '%', v_reason;
    END IF;
    IF v_doc->>'storage_path' NOT LIKE 'public-applications/' || v_slug || '/%'
       OR v_doc->>'storage_path' LIKE '%..%' THEN
      v_reason := 'document upload path is not permitted for this vacancy';
      RAISE EXCEPTION '%', v_reason;
    END IF;
    IF coalesce(v_doc->>'doc_type','supporting') NOT IN ('cv','cover_letter','certificate','supporting') THEN
      v_reason := 'unsupported document type'; RAISE EXCEPTION '%', v_reason;
    END IF;
    IF coalesce(nullif(v_doc->>'size_bytes','')::bigint, 0) > 15728640 THEN
      v_reason := coalesce(v_doc->>'file_name','document') || ': must be 15 MB or smaller';
      RAISE EXCEPTION '%', v_reason;
    END IF;
    IF coalesce(nullif(v_doc->>'size_bytes','')::bigint, 1) <= 0 THEN
      v_reason := coalesce(v_doc->>'file_name','document') || ': the uploaded file is empty';
      RAISE EXCEPTION '%', v_reason;
    END IF;
    IF nullif(v_doc->>'mime_type','') IS NOT NULL
       AND lower(v_doc->>'mime_type') <> ALL (v_allowed_mimes) THEN
      v_reason := coalesce(v_doc->>'file_name','document') || ': file type is not accepted (PDF, Word, PNG, JPEG, WEBP, HEIC or TXT)';
      RAISE EXCEPTION '%', v_reason;
    END IF;
    v_ext := lower(regexp_replace(coalesce(v_doc->>'file_name',''), '^.*\.', ''));
    IF v_ext = '' OR v_ext <> ALL (v_allowed_exts) THEN
      v_reason := coalesce(v_doc->>'file_name','document') || ': file extension is not accepted (PDF, Word, PNG, JPEG, WEBP, HEIC or TXT)';
      RAISE EXCEPTION '%', v_reason;
    END IF;
    IF coalesce(v_doc->>'doc_type','') = 'cv' THEN
      v_has_cv := true;
    END IF;
  END LOOP;

  IF NOT v_has_cv THEN
    INSERT INTO public.rec_public_apply_attempts (email, vacancy_slug, outcome, reason)
    VALUES (v_email, v_slug, 'rejected', 'cv_missing');
    RAISE EXCEPTION 'a CV document is required';
  END IF;

  -- ---- candidate upsert ----
  SELECT * INTO v_candidate FROM public.rec_candidates WHERE lower(email) = v_email LIMIT 1;

  IF v_candidate.id IS NULL THEN
    INSERT INTO public.rec_candidates (
      candidate_no, full_name, email, phone, location, headline, summary,
      years_experience, current_employer, current_title,
      source, engagement_status, consent_given, consent_at
    ) VALUES (
      'CAN-' || to_char(now(), 'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,5)),
      v_name, v_email, v_phone, left(nullif(trim(p_payload->>'location'),''), 160),
      left(nullif(trim(p_payload->>'headline'),''), 200), left(nullif(trim(p_payload->>'summary'),''), 2000),
      nullif(p_payload->>'years_experience','')::numeric,
      left(nullif(trim(p_payload->>'current_employer'),''), 160),
      left(nullif(trim(p_payload->>'current_title'),''), 160),
      'public_careers', 'active', true, now()
    ) RETURNING * INTO v_candidate;
  ELSE
    UPDATE public.rec_candidates SET
      full_name = coalesce(v_name, full_name),
      phone = coalesce(v_phone, phone),
      location = coalesce(left(nullif(trim(p_payload->>'location'),''), 160), location),
      current_employer = coalesce(left(nullif(trim(p_payload->>'current_employer'),''), 160), current_employer),
      current_title = coalesce(left(nullif(trim(p_payload->>'current_title'),''), 160), current_title),
      consent_given = true,
      consent_at = coalesce(consent_at, now()),
      updated_at = now()
    WHERE id = v_candidate.id AND record_state <> 'locked';
  END IF;

  -- ---- duplicate guard ----
  SELECT id, application_no INTO v_app_id, v_app_no
  FROM public.rec_applications
  WHERE candidate_id = v_candidate.id AND vacancy_id = v_vac.id
  LIMIT 1;

  IF v_app_id IS NOT NULL THEN
    INSERT INTO public.rec_public_apply_attempts (email, vacancy_slug, outcome, reason)
    VALUES (v_email, v_slug, 'duplicate', v_app_no);
    RETURN jsonb_build_object('duplicate', true, 'application_id', v_app_id, 'application_no', v_app_no, 'vacancy_title', v_vac.title);
  END IF;

  SELECT version INTO v_notice FROM public.rec_privacy_notices WHERE is_current LIMIT 1;

  v_app_no := 'APP-' || to_char(now(), 'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  INSERT INTO public.rec_applications (
    application_no, candidate_id, vacancy_id, source, source_detail, cover_letter,
    stage, status, priority, recruiter_staff_id, hiring_manager_staff_id,
    vacancy_version, blueprint_id, blueprint_version, privacy_notice_version
  ) VALUES (
    v_app_no, v_candidate.id, v_vac.id, 'public_careers',
    left(nullif(trim(p_payload->>'source_detail'),''), 120),
    nullif(trim(p_payload->>'cover_letter'),''),
    'applied', 'active', 'normal', v_vac.recruiter_staff_id, v_vac.hiring_manager_staff_id,
    v_vac.content_version, v_bp.id, v_bp.version, v_notice
  ) RETURNING id INTO v_app_id;

  INSERT INTO public.rec_application_profiles (
    application_id, candidate_id, academic_qualifications, professional_qualifications,
    employment_history, skills, consent_privacy, consent_at,
    consent_talent_pool, consent_privacy_version, declaration_accuracy
  ) VALUES (
    v_app_id, v_candidate.id,
    coalesce(p_payload->'academic_qualifications', '[]'::jsonb),
    coalesce(p_payload->'professional_qualifications', '[]'::jsonb),
    coalesce(p_payload->'employment_history', '[]'::jsonb),
    coalesce(v_skills, '{}'),
    true, now(),
    coalesce((p_payload->>'consent_talent_pool')::boolean, false),
    v_notice, true
  );

  -- ---- answers ----
  IF v_bp.id IS NOT NULL THEN
    FOR v_q IN SELECT * FROM public.rec_blueprint_questions WHERE blueprint_id = v_bp.id ORDER BY ord LOOP
      v_ans := coalesce(v_answers -> v_q.question_key, 'null'::jsonb);
      v_ko := false;
      v_score := NULL;

      IF v_q.classification = 'knockout' AND v_q.kind = 'boolean'
         AND coalesce((v_ans #>> '{}')::boolean, false) IS NOT TRUE THEN
        v_ko := true;
        v_ko_flag := true;
      END IF;

      -- Informational boolean acknowledgements: a "No" never rejects — it flags
      -- the application for recruiter review (e.g. commission-model acknowledgement).
      IF v_q.classification = 'informational' AND v_q.kind = 'boolean'
         AND jsonb_typeof(v_ans) = 'boolean'
         AND (v_ans #>> '{}')::boolean IS NOT TRUE THEN
        v_review_flag := true;
        v_review_keys := v_review_keys || v_q.question_key;
      END IF;

      IF v_q.classification IN ('scored','preferred') THEN
        v_score := CASE
          WHEN jsonb_typeof(v_ans) = 'null' THEN 0
          WHEN jsonb_typeof(v_ans) = 'boolean' THEN CASE WHEN (v_ans #>> '{}')::boolean THEN v_q.weight ELSE 0 END
          WHEN jsonb_typeof(v_ans) = 'array' THEN least(v_q.weight, jsonb_array_length(v_ans)::numeric)
          WHEN jsonb_typeof(v_ans) = 'number' THEN least(v_q.weight, (v_ans #>> '{}')::numeric)
          ELSE CASE WHEN char_length(coalesce(v_ans #>> '{}','')) >= 50 THEN v_q.weight ELSE v_q.weight / 2 END
        END;
      END IF;

      INSERT INTO public.rec_application_answers (
        application_id, blueprint_id, blueprint_version, question_key, question_prompt,
        question_kind, classification, answer, score, knockout_failed
      ) VALUES (
        v_app_id, v_bp.id, v_bp.version, v_q.question_key, v_q.prompt,
        v_q.kind, v_q.classification, v_ans, v_score, v_ko
      ) ON CONFLICT (application_id, question_key) DO NOTHING;
    END LOOP;

    IF v_ko_flag THEN
      UPDATE public.rec_applications SET knockout_flagged = true WHERE id = v_app_id;
    END IF;
    IF v_review_flag THEN
      UPDATE public.rec_applications
         SET review_flagged = true,
             review_flag_reason = 'declined acknowledgement: ' || array_to_string(v_review_keys, ', ')
       WHERE id = v_app_id;
    END IF;
  END IF;

  -- ---- canonical skills ----
  FOREACH v_skill IN ARRAY coalesce(v_skills, '{}') LOOP
    INSERT INTO public.rec_skills (name, slug)
    VALUES (v_skill, regexp_replace(lower(trim(v_skill)), '[^a-z0-9]+', '-', 'g'))
    ON CONFLICT (slug) DO UPDATE SET name = public.rec_skills.name
    RETURNING id INTO v_skill_id;

    INSERT INTO public.rec_candidate_skills (candidate_id, skill, skill_id)
    VALUES (v_candidate.id, v_skill, v_skill_id)
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- ---- documents ----
  FOR v_doc IN SELECT * FROM jsonb_array_elements(v_docs) LOOP
    INSERT INTO public.rec_candidate_documents (candidate_id, application_id, doc_type, file_name, storage_path, mime_type, size_bytes)
    VALUES (
      v_app_id IS NOT NULL AND TRUE OR TRUE, -- placeholder replaced below
      NULL, NULL, NULL, NULL, NULL, NULL
    );
  END LOOP;
END;
$function$;