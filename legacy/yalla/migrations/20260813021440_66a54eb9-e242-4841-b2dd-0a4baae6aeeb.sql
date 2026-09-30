-- ============================================================
-- 1. Public API metrics (latency / failure observability)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rec_public_api_metrics (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  operation text NOT NULL CHECK (operation IN ('list_vacancies','get_vacancy','submit_application','upload_document')),
  slug text,
  duration_ms integer NOT NULL CHECK (duration_ms >= 0),
  outcome text NOT NULL CHECK (outcome IN ('success','empty','error')),
  row_count integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.rec_public_api_metrics TO authenticated;
GRANT ALL ON public.rec_public_api_metrics TO service_role;
ALTER TABLE public.rec_public_api_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recruitment staff read public api metrics"
ON public.rec_public_api_metrics FOR SELECT TO authenticated
USING (public.rec_can_read());

CREATE INDEX IF NOT EXISTS idx_rec_public_api_metrics_created ON public.rec_public_api_metrics (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rec_public_api_metrics_outcome ON public.rec_public_api_metrics (outcome, created_at DESC);

-- Anon-callable writer (no direct table grant to anon)
CREATE OR REPLACE FUNCTION public.rec_log_public_api(
  p_operation text,
  p_duration_ms integer,
  p_outcome text,
  p_slug text DEFAULT NULL,
  p_row_count integer DEFAULT NULL,
  p_error_message text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_operation NOT IN ('list_vacancies','get_vacancy','submit_application','upload_document') THEN
    RETURN;
  END IF;
  IF p_outcome NOT IN ('success','empty','error') THEN
    RETURN;
  END IF;
  INSERT INTO public.rec_public_api_metrics (operation, slug, duration_ms, outcome, row_count, error_message)
  VALUES (
    p_operation,
    nullif(left(coalesce(p_slug, ''), 160), ''),
    greatest(0, least(coalesce(p_duration_ms, 0), 600000)),
    p_outcome,
    p_row_count,
    left(p_error_message, 400)
  );
END;
$$;

-- ============================================================
-- 2. Application attempt log (abuse / rate limiting)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rec_public_apply_attempts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  email text,
  vacancy_slug text,
  outcome text NOT NULL CHECK (outcome IN ('accepted','duplicate','rejected')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.rec_public_apply_attempts TO authenticated;
GRANT ALL ON public.rec_public_apply_attempts TO service_role;
ALTER TABLE public.rec_public_apply_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recruitment staff read apply attempts"
ON public.rec_public_apply_attempts FOR SELECT TO authenticated
USING (public.rec_can_read());

CREATE INDEX IF NOT EXISTS idx_rec_apply_attempts_email ON public.rec_public_apply_attempts (email, vacancy_slug, created_at DESC);

-- ============================================================
-- 3. Hardened public application intake
-- ============================================================
CREATE OR REPLACE FUNCTION public.rec_public_apply(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_vac public.rec_vacancies;
  v_slug text := nullif(trim(p_payload->>'vacancy_slug'), '');
  v_email text := lower(nullif(trim(p_payload->>'email'), ''));
  v_name text := nullif(trim(p_payload->>'full_name'), '');
  v_phone text := nullif(trim(p_payload->>'phone'), '');
  v_candidate public.rec_candidates;
  v_app_id uuid;
  v_app_no text;
  v_doc jsonb;
  v_docs jsonb := coalesce(p_payload->'documents', '[]'::jsonb);
  v_skills text[];
  v_has_cv boolean := false;
  v_attempts integer;
  v_reason text;
  v_allowed_mimes text[] := ARRAY[
    'application/pdf','application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png','image/jpeg','image/jpg','text/plain'
  ];
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
  IF nullif(trim(p_payload->>'linkedin_url'),'') IS NOT NULL
     AND p_payload->>'linkedin_url' !~* '^https?://[^\s]{4,300}$' THEN
    v_reason := 'linkedin_url must be a valid http(s) link'; RAISE EXCEPTION '%', v_reason;
  END IF;
  IF nullif(trim(p_payload->>'portfolio_url'),'') IS NOT NULL
     AND p_payload->>'portfolio_url' !~* '^https?://[^\s]{4,300}$' THEN
    v_reason := 'portfolio_url must be a valid http(s) link'; RAISE EXCEPTION '%', v_reason;
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
      v_reason := 'documents must be 15 MB or smaller'; RAISE EXCEPTION '%', v_reason;
    END IF;
    IF nullif(v_doc->>'mime_type','') IS NOT NULL
       AND lower(v_doc->>'mime_type') <> ALL (v_allowed_mimes) THEN
      v_reason := 'document file type is not accepted'; RAISE EXCEPTION '%', v_reason;
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
      linkedin_url, portfolio_url, years_experience, current_employer, current_title,
      source, engagement_status, consent_given, consent_at
    ) VALUES (
      'CAN-' || to_char(now(), 'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,5)),
      v_name, v_email, v_phone, left(nullif(trim(p_payload->>'location'),''), 160),
      left(nullif(trim(p_payload->>'headline'),''), 200), left(nullif(trim(p_payload->>'summary'),''), 2000),
      nullif(trim(p_payload->>'linkedin_url'),''), nullif(trim(p_payload->>'portfolio_url'),''),
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

  v_app_no := 'APP-' || to_char(now(), 'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  INSERT INTO public.rec_applications (
    application_no, candidate_id, vacancy_id, source, cover_letter,
    stage, status, priority, recruiter_staff_id, hiring_manager_staff_id
  ) VALUES (
    v_app_no, v_candidate.id, v_vac.id, 'public_careers',
    nullif(trim(p_payload->>'cover_letter'),''),
    'applied', 'active', 'normal', v_vac.recruiter_staff_id, v_vac.hiring_manager_staff_id
  ) RETURNING id INTO v_app_id;

  INSERT INTO public.rec_application_profiles (
    application_id, candidate_id, academic_qualifications, professional_qualifications,
    employment_history, skills, consent_privacy, consent_at
  ) VALUES (
    v_app_id, v_candidate.id,
    coalesce(p_payload->'academic_qualifications', '[]'::jsonb),
    coalesce(p_payload->'professional_qualifications', '[]'::jsonb),
    coalesce(p_payload->'employment_history', '[]'::jsonb),
    coalesce(v_skills, '{}'),
    true, now()
  );

  FOR v_doc IN SELECT * FROM jsonb_array_elements(v_docs) LOOP
    INSERT INTO public.rec_candidate_documents (candidate_id, application_id, doc_type, file_name, storage_path, mime_type, size_bytes)
    VALUES (
      v_candidate.id, v_app_id,
      coalesce(v_doc->>'doc_type','supporting'),
      left(coalesce(v_doc->>'file_name','document'), 200),
      v_doc->>'storage_path',
      v_doc->>'mime_type',
      nullif(v_doc->>'size_bytes','')::bigint
    );
  END LOOP;

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, new_state, context, source)
  VALUES (
    auth.uid(), 'application.submitted', 'application', v_app_id,
    jsonb_build_object('stage', 'applied', 'status', 'active'),
    jsonb_build_object('application_no', v_app_no, 'vacancy_id', v_vac.id, 'vacancy_title', v_vac.title, 'candidate_id', v_candidate.id),
    'public_careers'
  );

  INSERT INTO public.rec_public_apply_attempts (email, vacancy_slug, outcome, reason)
  VALUES (v_email, v_slug, 'accepted', v_app_no);

  RETURN jsonb_build_object('duplicate', false, 'application_id', v_app_id, 'application_no', v_app_no, 'vacancy_title', v_vac.title, 'vacancy_id', v_vac.id);
END;
$$;

-- ============================================================
-- 4. Publication health (staff-only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rec_publication_health()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_public_ids uuid[];
  v_mismatches jsonb;
  v_latency jsonb;
  v_failures jsonb;
  v_attempts jsonb;
BEGIN
  IF NOT public.rec_can_read() THEN
    RAISE EXCEPTION 'not authorised to read recruitment publication health';
  END IF;

  SELECT coalesce(array_agg(id), '{}') INTO v_public_ids FROM public.rec_public_vacancies();

  SELECT coalesce(jsonb_agg(m ORDER BY m->>'severity', m->>'vacancy_no'), '[]'::jsonb) INTO v_mismatches
  FROM (
    SELECT jsonb_build_object(
      'vacancy_id', v.id,
      'vacancy_no', v.vacancy_no,
      'title', v.title,
      'approval_status', v.approval_status,
      'publication_status', v.publication_status,
      'status', v.status,
      'public_slug', v.public_slug,
      'published_at', v.published_at,
      'visible_publicly', v.id = ANY(v_public_ids),
      'issue', CASE
        WHEN v.publication_status = 'published' AND v.public_slug IS NULL THEN 'published_without_public_slug'
        WHEN v.publication_status = 'published' AND v.published_at IS NULL THEN 'published_without_timestamp'
        WHEN v.publication_status = 'published' AND v.approval_status <> 'approved' THEN 'published_but_not_approved'
        WHEN v.publication_status = 'published' AND v.status <> 'open' THEN 'published_but_not_open'
        WHEN v.publication_status = 'published' AND v.approval_status = 'approved' AND v.status = 'open'
             AND NOT (v.id = ANY(v_public_ids)) THEN 'expected_public_but_hidden'
        WHEN v.publication_status <> 'published' AND v.id = ANY(v_public_ids) THEN 'unpublished_but_visible'
        ELSE NULL
      END,
      'severity', CASE
        WHEN v.publication_status <> 'published' AND v.id = ANY(v_public_ids) THEN 'critical'
        WHEN v.publication_status = 'published' AND v.approval_status = 'approved' AND v.status = 'open'
             AND NOT (v.id = ANY(v_public_ids)) THEN 'critical'
        ELSE 'warning'
      END
    ) AS m
    FROM public.rec_vacancies v
  ) s
  WHERE (s.m->>'issue') IS NOT NULL;

  SELECT jsonb_build_object(
    'window_hours', 24,
    'requests', count(*),
    'errors', count(*) FILTER (WHERE outcome = 'error'),
    'avg_ms', round(coalesce(avg(duration_ms), 0)),
    'p95_ms', coalesce(percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms), 0),
    'max_ms', coalesce(max(duration_ms), 0)
  ) INTO v_latency
  FROM public.rec_public_api_metrics
  WHERE created_at > now() - interval '24 hours';

  SELECT coalesce(jsonb_agg(f), '[]'::jsonb) INTO v_failures
  FROM (
    SELECT jsonb_build_object('operation', operation, 'slug', slug, 'error_message', error_message,
                              'duration_ms', duration_ms, 'created_at', created_at) AS f
    FROM public.rec_public_api_metrics
    WHERE outcome = 'error' AND created_at > now() - interval '7 days'
    ORDER BY created_at DESC LIMIT 25
  ) x;

  SELECT jsonb_build_object(
    'window_hours', 24,
    'accepted', count(*) FILTER (WHERE outcome = 'accepted'),
    'duplicate', count(*) FILTER (WHERE outcome = 'duplicate'),
    'rejected', count(*) FILTER (WHERE outcome = 'rejected'),
    'top_rejections', coalesce((
      SELECT jsonb_agg(jsonb_build_object('reason', reason, 'count', c))
      FROM (SELECT reason, count(*) c FROM public.rec_public_apply_attempts
            WHERE outcome = 'rejected' AND created_at > now() - interval '24 hours'
            GROUP BY reason ORDER BY c DESC LIMIT 5) r
    ), '[]'::jsonb)
  ) INTO v_attempts
  FROM public.rec_public_apply_attempts
  WHERE created_at > now() - interval '24 hours';

  RETURN jsonb_build_object(
    'checked_at', now(),
    'public_count', coalesce(array_length(v_public_ids, 1), 0),
    'total_vacancies', (SELECT count(*) FROM public.rec_vacancies),
    'mismatches', v_mismatches,
    'mismatch_count', jsonb_array_length(v_mismatches),
    'critical_count', (SELECT count(*) FROM jsonb_array_elements(v_mismatches) e WHERE e->>'severity' = 'critical'),
    'latency', v_latency,
    'recent_failures', v_failures,
    'applications', v_attempts
  );
END;
$$;

-- ============================================================
-- 5. Admin-only test harness (QA fixtures only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.rec_test_upsert_vacancy(
  p_vacancy_no text,
  p_title text,
  p_slug text,
  p_approval_status text,
  p_publication_status text,
  p_status text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  IF p_vacancy_no NOT LIKE 'VAC-QA-%' OR p_slug NOT LIKE 'qa-%' THEN
    RAISE EXCEPTION 'test harness only accepts VAC-QA-* fixtures';
  END IF;

  INSERT INTO public.rec_vacancies (
    vacancy_no, title, employment_type, work_arrangement, location, headcount,
    sla_days, priority, approval_status, publication_status, status, public_slug, public_summary
  ) VALUES (
    p_vacancy_no, p_title, 'permanent', 'onsite', 'Nairobi', 1,
    30, 'normal', p_approval_status, p_publication_status, p_status, p_slug,
    'Automated publication-lifecycle test fixture.'
  )
  ON CONFLICT (vacancy_no) DO UPDATE SET
    approval_status = excluded.approval_status,
    publication_status = excluded.publication_status,
    status = excluded.status,
    public_slug = excluded.public_slug,
    title = excluded.title,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'vacancy_no', p_vacancy_no, 'public_slug', p_slug);
END;
$$;

CREATE OR REPLACE FUNCTION public.rec_test_set_publication_state(
  p_vacancy_no text,
  p_approval_status text DEFAULT NULL,
  p_publication_status text DEFAULT NULL,
  p_status text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_row public.rec_vacancies;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  IF p_vacancy_no NOT LIKE 'VAC-QA-%' THEN
    RAISE EXCEPTION 'test harness only accepts VAC-QA-* fixtures';
  END IF;

  UPDATE public.rec_vacancies SET
    approval_status = coalesce(p_approval_status, approval_status),
    publication_status = coalesce(p_publication_status, publication_status),
    status = coalesce(p_status, status),
    updated_at = now()
  WHERE vacancy_no = p_vacancy_no
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'fixture % not found', p_vacancy_no;
  END IF;

  RETURN jsonb_build_object(
    'vacancy_no', v_row.vacancy_no,
    'approval_status', v_row.approval_status,
    'publication_status', v_row.publication_status,
    'status', v_row.status,
    'published_at', v_row.published_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rec_test_cleanup_vacancies(p_prefix text DEFAULT 'VAC-QA-')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_count integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  IF p_prefix IS DISTINCT FROM 'VAC-QA-' THEN
    RAISE EXCEPTION 'test harness only removes VAC-QA-* fixtures';
  END IF;

  DELETE FROM public.rec_candidates
  WHERE email LIKE 'qa-applicant+%@yalla.test';

  DELETE FROM public.rec_public_apply_attempts WHERE vacancy_slug LIKE 'qa-%';

  WITH d AS (DELETE FROM public.rec_vacancies WHERE vacancy_no LIKE 'VAC-QA-%' RETURNING 1)
  SELECT count(*) INTO v_count FROM d;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.rec_test_upsert_vacancy(text,text,text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rec_test_set_publication_state(text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rec_test_cleanup_vacancies(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rec_publication_health() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rec_test_upsert_vacancy(text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_test_set_publication_state(text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_test_cleanup_vacancies(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_publication_health() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_log_public_api(text,integer,text,text,integer,text) TO anon, authenticated;