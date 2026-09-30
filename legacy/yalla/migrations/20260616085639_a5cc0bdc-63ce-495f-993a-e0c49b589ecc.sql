
-- ============================================================
-- DRIVER ACADEMY 3.0
-- ============================================================

-- Sequences
CREATE SEQUENCE IF NOT EXISTS public.training_certificate_seq START 100001;

-- =========================
-- CATEGORIES
-- =========================
CREATE TABLE IF NOT EXISTS public.training_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  icon text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.training_categories TO anon, authenticated;
GRANT ALL ON public.training_categories TO service_role;
ALTER TABLE public.training_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY tc_read ON public.training_categories FOR SELECT USING (true);
CREATE POLICY tc_admin ON public.training_categories FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- =========================
-- COURSES
-- =========================
CREATE TABLE IF NOT EXISTS public.training_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  level int NOT NULL DEFAULT 0,
  category_id uuid REFERENCES public.training_categories(id) ON DELETE SET NULL,
  description text,
  duration_minutes int NOT NULL DEFAULT 0,
  pass_mark int NOT NULL DEFAULT 80,
  required_for_activation boolean NOT NULL DEFAULT false,
  certification_kind text,
  cpd_points int NOT NULL DEFAULT 0,
  is_published boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tcourses_level ON public.training_courses(level);
CREATE INDEX IF NOT EXISTS idx_tcourses_published ON public.training_courses(is_published, sort_order);
GRANT SELECT ON public.training_courses TO anon, authenticated;
GRANT ALL ON public.training_courses TO service_role;
ALTER TABLE public.training_courses ENABLE ROW LEVEL SECURITY;
CREATE POLICY tco_read ON public.training_courses FOR SELECT USING (true);
CREATE POLICY tco_admin ON public.training_courses FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- =========================
-- MODULES
-- =========================
CREATE TABLE IF NOT EXISTS public.training_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
  code text,
  title text NOT NULL,
  description text,
  sort_order int NOT NULL DEFAULT 0,
  duration_minutes int NOT NULL DEFAULT 0,
  pass_mark int,
  is_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tmod_course ON public.training_modules(course_id, sort_order);
GRANT SELECT ON public.training_modules TO anon, authenticated;
GRANT ALL ON public.training_modules TO service_role;
ALTER TABLE public.training_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY tmod_read ON public.training_modules FOR SELECT USING (true);
CREATE POLICY tmod_admin ON public.training_modules FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- =========================
-- LESSONS
-- =========================
CREATE TABLE IF NOT EXISTS public.training_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id uuid NOT NULL REFERENCES public.training_modules(id) ON DELETE CASCADE,
  title text NOT NULL,
  lesson_type text NOT NULL DEFAULT 'reading',
  content_md text,
  duration_minutes int NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  is_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tless_module ON public.training_lessons(module_id, sort_order);
GRANT SELECT ON public.training_lessons TO anon, authenticated;
GRANT ALL ON public.training_lessons TO service_role;
ALTER TABLE public.training_lessons ENABLE ROW LEVEL SECURITY;
CREATE POLICY tless_read ON public.training_lessons FOR SELECT USING (true);
CREATE POLICY tless_admin ON public.training_lessons FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- =========================
-- VIDEOS
-- =========================
CREATE TABLE IF NOT EXISTS public.training_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES public.training_lessons(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'youtube',
  url text NOT NULL,
  title text,
  duration_seconds int NOT NULL DEFAULT 0,
  min_watch_percent int NOT NULL DEFAULT 90,
  checkpoints jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tvid_lesson ON public.training_videos(lesson_id);
GRANT SELECT ON public.training_videos TO anon, authenticated;
GRANT ALL ON public.training_videos TO service_role;
ALTER TABLE public.training_videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY tvid_read ON public.training_videos FOR SELECT USING (true);
CREATE POLICY tvid_admin ON public.training_videos FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- =========================
-- DOCUMENTS
-- =========================
CREATE TABLE IF NOT EXISTS public.training_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES public.training_lessons(id) ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL,
  kind text NOT NULL DEFAULT 'pdf',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.training_documents TO anon, authenticated;
GRANT ALL ON public.training_documents TO service_role;
ALTER TABLE public.training_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tdoc_read ON public.training_documents FOR SELECT USING (true);
CREATE POLICY tdoc_admin ON public.training_documents FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- =========================
-- ASSESSMENTS
-- =========================
CREATE TABLE IF NOT EXISTS public.training_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
  module_id uuid REFERENCES public.training_modules(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'final',
  title text NOT NULL,
  description text,
  pass_mark int NOT NULL DEFAULT 80,
  time_limit_min int,
  max_attempts int NOT NULL DEFAULT 3,
  randomize boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tassess_course ON public.training_assessments(course_id);
GRANT SELECT ON public.training_assessments TO anon, authenticated;
GRANT ALL ON public.training_assessments TO service_role;
ALTER TABLE public.training_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tassess_read ON public.training_assessments FOR SELECT USING (true);
CREATE POLICY tassess_admin ON public.training_assessments FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- =========================
-- QUESTIONS
-- =========================
CREATE TABLE IF NOT EXISTS public.training_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.training_assessments(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'mcq',
  prompt text NOT NULL,
  image_url text,
  video_url text,
  explanation text,
  points int NOT NULL DEFAULT 1,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tq_assess ON public.training_questions(assessment_id, sort_order);
GRANT SELECT ON public.training_questions TO authenticated;
GRANT ALL ON public.training_questions TO service_role;
ALTER TABLE public.training_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tq_read ON public.training_questions FOR SELECT TO authenticated USING (true);
CREATE POLICY tq_admin ON public.training_questions FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- =========================
-- ANSWERS  (is_correct hidden via column policy via security barrier function)
-- =========================
CREATE TABLE IF NOT EXISTS public.training_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.training_questions(id) ON DELETE CASCADE,
  label text NOT NULL,
  is_correct boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ta_question ON public.training_answers(question_id);
GRANT SELECT ON public.training_answers TO authenticated;
GRANT ALL ON public.training_answers TO service_role;
ALTER TABLE public.training_answers ENABLE ROW LEVEL SECURITY;
-- Drivers can see labels for exam UI, but is_correct is not exposed via UI logic.
-- Admins can manage all.
CREATE POLICY ta_read ON public.training_answers FOR SELECT TO authenticated USING (true);
CREATE POLICY ta_admin ON public.training_answers FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- =========================
-- ENROLLMENTS
-- =========================
CREATE TABLE IF NOT EXISTS public.training_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  course_id uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'in_progress',
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  progress_pct int NOT NULL DEFAULT 0,
  UNIQUE(driver_id, course_id)
);
CREATE INDEX IF NOT EXISTS idx_tenroll_driver ON public.training_enrollments(driver_id, status);
GRANT SELECT, INSERT, UPDATE ON public.training_enrollments TO authenticated;
GRANT ALL ON public.training_enrollments TO service_role;
ALTER TABLE public.training_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenroll_self ON public.training_enrollments FOR ALL TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
              OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- =========================
-- PROGRESS
-- =========================
CREATE TABLE IF NOT EXISTS public.training_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  course_id uuid NOT NULL,
  lesson_id uuid NOT NULL REFERENCES public.training_lessons(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'in_progress',
  progress_pct int NOT NULL DEFAULT 0,
  last_position_seconds int NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(driver_id, lesson_id)
);
CREATE INDEX IF NOT EXISTS idx_tprog_driver_course ON public.training_progress(driver_id, course_id);
GRANT SELECT, INSERT, UPDATE ON public.training_progress TO authenticated;
GRANT ALL ON public.training_progress TO service_role;
ALTER TABLE public.training_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY tprog_self ON public.training_progress FOR ALL TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
              OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- =========================
-- VIDEO COMPLETION
-- =========================
CREATE TABLE IF NOT EXISTS public.video_completion_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  video_id uuid NOT NULL REFERENCES public.training_videos(id) ON DELETE CASCADE,
  watched_seconds int NOT NULL DEFAULT 0,
  watched_percent int NOT NULL DEFAULT 0,
  checkpoints_passed jsonb NOT NULL DEFAULT '[]'::jsonb,
  completed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(driver_id, video_id)
);
GRANT SELECT, INSERT, UPDATE ON public.video_completion_logs TO authenticated;
GRANT ALL ON public.video_completion_logs TO service_role;
ALTER TABLE public.video_completion_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY vcl_self ON public.video_completion_logs FOR ALL TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid()));

-- =========================
-- ATTEMPTS
-- =========================
CREATE TABLE IF NOT EXISTS public.training_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  assessment_id uuid NOT NULL REFERENCES public.training_assessments(id) ON DELETE CASCADE,
  course_id uuid NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  score numeric(5,2),
  passed boolean,
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tattempt_driver ON public.training_attempts(driver_id, assessment_id);
GRANT SELECT, INSERT ON public.training_attempts TO authenticated;
GRANT ALL ON public.training_attempts TO service_role;
ALTER TABLE public.training_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tattempt_self ON public.training_attempts FOR ALL TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
              OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- =========================
-- CERTIFICATES
-- =========================
CREATE TABLE IF NOT EXISTS public.training_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  course_id uuid NOT NULL REFERENCES public.training_courses(id),
  certificate_number text NOT NULL UNIQUE,
  kind text NOT NULL,
  title text NOT NULL,
  score numeric(5,2),
  qr_payload text NOT NULL,
  signature_hash text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tcert_driver ON public.training_certificates(driver_id);
CREATE INDEX IF NOT EXISTS idx_tcert_kind ON public.training_certificates(driver_id, kind) WHERE revoked_at IS NULL;
GRANT SELECT ON public.training_certificates TO authenticated;
GRANT ALL ON public.training_certificates TO service_role;
ALTER TABLE public.training_certificates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tcert_self ON public.training_certificates FOR SELECT TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- =========================
-- CPD POINTS
-- =========================
CREATE TABLE IF NOT EXISTS public.training_cpd_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  source_type text NOT NULL,
  source_id uuid,
  points int NOT NULL,
  year int NOT NULL DEFAULT extract(year FROM now())::int,
  awarded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cpd_driver_year ON public.training_cpd_points(driver_id, year);
GRANT SELECT ON public.training_cpd_points TO authenticated;
GRANT ALL ON public.training_cpd_points TO service_role;
ALTER TABLE public.training_cpd_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY cpd_self ON public.training_cpd_points FOR SELECT TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- =========================
-- PRACTICAL ASSESSMENTS
-- =========================
CREATE TABLE IF NOT EXISTS public.practical_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  course_id uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE CASCADE,
  evaluator_id uuid,
  status text NOT NULL DEFAULT 'pending',
  score numeric(5,2),
  notes text,
  evaluated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.practical_assessments TO authenticated;
GRANT ALL ON public.practical_assessments TO service_role;
ALTER TABLE public.practical_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY pa_self ON public.practical_assessments FOR SELECT TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));
CREATE POLICY pa_admin ON public.practical_assessments FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- =========================
-- ENGINE FUNCTIONS
-- =========================

CREATE OR REPLACE FUNCTION public.training_current_driver_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.drivers WHERE user_id = auth.uid() LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.training_enroll(_course_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _did uuid; _eid uuid;
BEGIN
  _did := public.training_current_driver_id();
  IF _did IS NULL THEN RAISE EXCEPTION 'No driver profile'; END IF;
  INSERT INTO public.training_enrollments (driver_id, course_id)
  VALUES (_did, _course_id)
  ON CONFLICT (driver_id, course_id) DO UPDATE SET status = EXCLUDED.status
  RETURNING id INTO _eid;
  RETURN _eid;
END $$;

CREATE OR REPLACE FUNCTION public.training_complete_lesson(_lesson_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _did uuid; _cid uuid; _id uuid;
BEGIN
  _did := public.training_current_driver_id();
  IF _did IS NULL THEN RAISE EXCEPTION 'No driver profile'; END IF;
  SELECT m.course_id INTO _cid
  FROM public.training_lessons l JOIN public.training_modules m ON m.id = l.module_id
  WHERE l.id = _lesson_id;
  IF _cid IS NULL THEN RAISE EXCEPTION 'Lesson not found'; END IF;

  INSERT INTO public.training_progress (driver_id, course_id, lesson_id, status, progress_pct, completed_at)
  VALUES (_did, _cid, _lesson_id, 'completed', 100, now())
  ON CONFLICT (driver_id, lesson_id)
  DO UPDATE SET status='completed', progress_pct=100, completed_at=now(), updated_at=now()
  RETURNING id INTO _id;

  -- recompute course progress
  UPDATE public.training_enrollments te
     SET progress_pct = COALESCE((
       SELECT round(100.0 * count(*) FILTER (WHERE tp.status='completed')::numeric / NULLIF(count(*),0))::int
       FROM public.training_lessons tl
       JOIN public.training_modules tm ON tm.id = tl.module_id
       LEFT JOIN public.training_progress tp
         ON tp.lesson_id = tl.id AND tp.driver_id = _did
       WHERE tm.course_id = _cid
     ), 0)
   WHERE te.driver_id = _did AND te.course_id = _cid;

  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.training_record_video_watch(
  _video_id uuid, _watched_seconds int, _watched_percent int, _checkpoint text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _did uuid; _min int; _lesson uuid;
BEGIN
  _did := public.training_current_driver_id();
  IF _did IS NULL THEN RETURN; END IF;
  SELECT min_watch_percent, lesson_id INTO _min, _lesson
  FROM public.training_videos WHERE id = _video_id;

  INSERT INTO public.video_completion_logs (driver_id, video_id, watched_seconds, watched_percent, checkpoints_passed, completed, updated_at)
  VALUES (_did, _video_id, _watched_seconds, _watched_percent,
          CASE WHEN _checkpoint IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(_checkpoint) END,
          _watched_percent >= COALESCE(_min,90), now())
  ON CONFLICT (driver_id, video_id) DO UPDATE
    SET watched_seconds = GREATEST(EXCLUDED.watched_seconds, video_completion_logs.watched_seconds),
        watched_percent = GREATEST(EXCLUDED.watched_percent, video_completion_logs.watched_percent),
        checkpoints_passed = CASE
          WHEN _checkpoint IS NULL THEN video_completion_logs.checkpoints_passed
          ELSE video_completion_logs.checkpoints_passed || jsonb_build_array(_checkpoint)
        END,
        completed = (GREATEST(EXCLUDED.watched_percent, video_completion_logs.watched_percent) >= COALESCE(_min,90)),
        updated_at = now();

  IF _watched_percent >= COALESCE(_min,90) AND _lesson IS NOT NULL THEN
    PERFORM public.training_complete_lesson(_lesson);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.training_issue_certificate(
  _driver_id uuid, _course_id uuid, _score numeric DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid := gen_random_uuid(); _num text; _kind text; _title text; _expiry timestamptz; _cpd int;
BEGIN
  SELECT COALESCE(certification_kind, 'GENERAL'), title, cpd_points
    INTO _kind, _title, _cpd FROM public.training_courses WHERE id = _course_id;

  _num := 'YR-ACAD-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.training_certificate_seq')::text,6,'0');
  _expiry := now() + interval '2 years';

  INSERT INTO public.training_certificates
    (id, driver_id, course_id, certificate_number, kind, title, score, qr_payload, signature_hash, issued_at, expires_at)
  VALUES
    (_id, _driver_id, _course_id, _num, _kind, _title, _score,
     'https://yallaride.com/verify/' || _num,
     encode(digest(_id::text || _driver_id::text || _course_id::text || _num, 'sha256'), 'hex'),
     now(), _expiry);

  IF COALESCE(_cpd,0) > 0 THEN
    INSERT INTO public.training_cpd_points (driver_id, source_type, source_id, points)
    VALUES (_driver_id, 'CERTIFICATE', _id, _cpd);
  END IF;

  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.training_submit_assessment(
  _assessment_id uuid, _answers jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _did uuid; _cid uuid; _kind text; _pass int;
  _attempt_id uuid := gen_random_uuid();
  _total int := 0; _correct int := 0;
  _score numeric; _passed boolean;
  _q record; _selected uuid;
  _cert_id uuid;
BEGIN
  _did := public.training_current_driver_id();
  IF _did IS NULL THEN RAISE EXCEPTION 'No driver profile'; END IF;

  SELECT course_id, kind, pass_mark INTO _cid, _kind, _pass
    FROM public.training_assessments WHERE id = _assessment_id;
  IF _cid IS NULL THEN RAISE EXCEPTION 'Assessment not found'; END IF;

  FOR _q IN SELECT id, points FROM public.training_questions WHERE assessment_id = _assessment_id LOOP
    _total := _total + _q.points;
    _selected := NULLIF(_answers->>(_q.id::text),'')::uuid;
    IF _selected IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.training_answers WHERE id = _selected AND question_id = _q.id AND is_correct = true
    ) THEN _correct := _correct + _q.points; END IF;
  END LOOP;

  _score := CASE WHEN _total > 0 THEN round(100.0 * _correct / _total, 2) ELSE 0 END;
  _passed := _score >= _pass;

  INSERT INTO public.training_attempts (id, driver_id, assessment_id, course_id, answers, score, passed, submitted_at)
  VALUES (_attempt_id, _did, _assessment_id, _cid, _answers, _score, _passed, now());

  IF _passed AND _kind = 'final' THEN
    -- only issue if no active cert yet
    IF NOT EXISTS (
      SELECT 1 FROM public.training_certificates
      WHERE driver_id = _did AND course_id = _cid AND revoked_at IS NULL
    ) THEN
      _cert_id := public.training_issue_certificate(_did, _cid, _score);
    END IF;
    UPDATE public.training_enrollments
       SET status='completed', completed_at=now(), progress_pct=100
     WHERE driver_id=_did AND course_id=_cid;
  END IF;

  RETURN jsonb_build_object(
    'attempt_id', _attempt_id, 'score', _score, 'passed', _passed,
    'total_points', _total, 'correct_points', _correct, 'certificate_id', _cert_id
  );
END $$;

CREATE OR REPLACE FUNCTION public.training_driver_summary(_driver_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _did uuid; _r jsonb;
BEGIN
  _did := COALESCE(_driver_id, public.training_current_driver_id());
  IF _did IS NULL THEN RETURN '{}'::jsonb; END IF;
  SELECT jsonb_build_object(
    'driver_id', _did,
    'courses_completed', (SELECT count(*) FROM public.training_enrollments WHERE driver_id=_did AND status='completed'),
    'courses_in_progress', (SELECT count(*) FROM public.training_enrollments WHERE driver_id=_did AND status='in_progress'),
    'certificates', (SELECT count(*) FROM public.training_certificates WHERE driver_id=_did AND revoked_at IS NULL),
    'learning_minutes', (
      SELECT COALESCE(sum(c.duration_minutes),0) FROM public.training_enrollments e
      JOIN public.training_courses c ON c.id = e.course_id
      WHERE e.driver_id=_did AND e.status='completed'
    ),
    'cpd_year', extract(year FROM now())::int,
    'cpd_points', (SELECT COALESCE(sum(points),0) FROM public.training_cpd_points
                    WHERE driver_id=_did AND year=extract(year FROM now())::int),
    'compliance_ok', NOT EXISTS (
      SELECT 1 FROM public.training_courses c
      WHERE c.required_for_activation = true
        AND NOT EXISTS (SELECT 1 FROM public.training_certificates tc
                          WHERE tc.driver_id=_did AND tc.course_id=c.id AND tc.revoked_at IS NULL)
    ),
    'expiring_soon', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'certificate_number', certificate_number, 'title', title, 'expires_at', expires_at
      )), '[]'::jsonb)
      FROM public.training_certificates
      WHERE driver_id=_did AND revoked_at IS NULL
        AND expires_at IS NOT NULL AND expires_at < now() + interval '60 days'
    )
  ) INTO _r;
  RETURN _r;
END $$;

CREATE OR REPLACE FUNCTION public.training_verify_certificate(_number text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'valid', (revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())),
    'certificate_number', certificate_number,
    'title', title, 'kind', kind,
    'issued_at', issued_at, 'expires_at', expires_at, 'revoked_at', revoked_at
  ) FROM public.training_certificates WHERE certificate_number = _number
$$;
GRANT EXECUTE ON FUNCTION public.training_verify_certificate(text) TO anon, authenticated;

-- =========================
-- ACTIVATION HARD GATE
-- =========================
CREATE OR REPLACE FUNCTION public.assert_activation_training_complete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _missing text;
BEGIN
  IF NEW.to_stage::text <> 'ACTIVE' THEN RETURN NEW; END IF;

  SELECT string_agg(c.title, ', ') INTO _missing
  FROM public.training_courses c
  WHERE c.required_for_activation = true
    AND NOT EXISTS (
      SELECT 1 FROM public.training_certificates tc
      WHERE tc.driver_id = NEW.driver_id
        AND tc.course_id = c.id
        AND tc.revoked_at IS NULL
        AND (tc.expires_at IS NULL OR tc.expires_at > now())
    );

  IF _missing IS NOT NULL AND NOT public.has_any_role(auth.uid(), ARRAY['super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Cannot activate driver: missing required training certificates: %', _missing;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_assert_activation_training ON public.driver_lifecycle_history;
CREATE TRIGGER trg_assert_activation_training
  BEFORE INSERT ON public.driver_lifecycle_history
  FOR EACH ROW EXECUTE FUNCTION public.assert_activation_training_complete();

-- updated_at triggers
CREATE TRIGGER trg_tcourses_upd BEFORE UPDATE ON public.training_courses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_tmod_upd BEFORE UPDATE ON public.training_modules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_tless_upd BEFORE UPDATE ON public.training_lessons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_tassess_upd BEFORE UPDATE ON public.training_assessments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_pa_upd BEFORE UPDATE ON public.practical_assessments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_tcat_upd BEFORE UPDATE ON public.training_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- SEED CATEGORIES
-- =========================
INSERT INTO public.training_categories (code, name, icon, sort_order) VALUES
  ('FOUNDATION','Foundation','GraduationCap',10),
  ('SAFETY','Safety & Compliance','Shield',20),
  ('SERVICE','Customer Service','Heart',30),
  ('CORPORATE','Corporate & Executive','Briefcase',40),
  ('FLEET','Fleet & Operations','Truck',50),
  ('FINANCE','Financial Literacy','Wallet',60),
  ('MENTOR','Mentorship & Leadership','Users',70)
ON CONFLICT (code) DO NOTHING;

-- =========================
-- SEED COURSES (Levels 0–6 + Financial Literacy)
-- =========================
WITH cats AS (SELECT code, id FROM public.training_categories)
INSERT INTO public.training_courses
  (code, slug, title, level, category_id, description, duration_minutes, pass_mark, required_for_activation, certification_kind, cpd_points, sort_order)
SELECT * FROM (VALUES
  ('L0','driver-onboarding-foundation','Driver Onboarding Foundation',0,
    (SELECT id FROM cats WHERE code='FOUNDATION'),
    'Introduction to Yalla Ride ecosystem, policies, code of conduct, professional standards and onboarding requirements.',
    360,80,true,'FOUNDATION',5,10),
  ('L1','certified-yalla-driver','Certified Yalla Driver',1,
    (SELECT id FROM cats WHERE code='SAFETY'),
    'Kenyan road signs, NTSA Highway Code, defensive driving and passenger safety. Required before activation.',
    1080,85,true,'CERTIFIED_DRIVER',15,20),
  ('L2','professional-mobility-operator','Professional Mobility Operator',2,
    (SELECT id FROM cats WHERE code='SERVICE'),
    'Customer service excellence, accessibility, corporate etiquette, reputation management, digital operations and passenger security.',
    1440,85,false,'MOBILITY_OPERATOR',20,30),
  ('L3','advanced-safety-driver','Advanced Safety Driver',3,
    (SELECT id FROM cats WHERE code='SAFETY'),
    'Accident prevention, fatigue management, first aid awareness, security and crisis response.',
    1200,90,false,'SAFETY_DRIVER',20,40),
  ('L4','corporate-mobility-specialist','Corporate Mobility Specialist',4,
    (SELECT id FROM cats WHERE code='CORPORATE'),
    'Corporate transport standards, executive passenger handling, confidentiality, travel policies, airport and VIP transportation.',
    960,90,false,'CORPORATE_SPECIALIST',15,50),
  ('L5','fleet-operations-professional','Fleet Operations Professional',5,
    (SELECT id FROM cats WHERE code='FLEET'),
    'Fleet compliance, vehicle inspections, scheduling, reporting and maintenance awareness.',
    1440,85,false,'FLEET_PROFESSIONAL',20,60),
  ('L6','driver-mentor-trainer','Driver Mentor & Trainer',6,
    (SELECT id FROM cats WHERE code='MENTOR'),
    'Adult learning principles, coaching, safety leadership, incident review and performance mentoring.',
    1800,90,false,'MENTOR',30,70),
  ('FIN','financial-literacy-certification','Financial Literacy Certification',2,
    (SELECT id FROM cats WHERE code='FINANCE'),
    'Budgeting, savings, debt management, insurance, retirement and vehicle financing for drivers.',
    480,80,false,'FINANCIAL_LITERACY',10,80)
) AS v(code,slug,title,level,category_id,description,duration_minutes,pass_mark,required_for_activation,certification_kind,cpd_points,sort_order)
ON CONFLICT (code) DO NOTHING;

-- =========================
-- SEED MODULES
-- =========================
-- Level 0
INSERT INTO public.training_modules (course_id, code, title, sort_order, duration_minutes)
SELECT c.id, m.code, m.title, m.so, m.dur FROM public.training_courses c
JOIN (VALUES
  ('L0-M1','Introduction to Yalla Ride',1,45),
  ('L0-M2','Driver Code of Conduct',2,45),
  ('L0-M3','Platform Policies',3,60),
  ('L0-M4','Professional Standards',4,60),
  ('L0-M5','Driver Success Roadmap',5,30)
) AS m(code,title,so,dur) ON c.code = 'L0'
ON CONFLICT DO NOTHING;

-- Level 1
INSERT INTO public.training_modules (course_id, code, title, sort_order, duration_minutes, pass_mark)
SELECT c.id, m.code, m.title, m.so, m.dur, m.pm FROM public.training_courses c
JOIN (VALUES
  ('L1-M1','Road Signs and Road Markings',1,240,85),
  ('L1-M2','Traffic Rules and Highway Code',2,240,85),
  ('L1-M3','Defensive Driving',3,300,90),
  ('L1-M4','Passenger Safety',4,180,90)
) AS m(code,title,so,dur,pm) ON c.code = 'L1'
ON CONFLICT DO NOTHING;

-- Level 2
INSERT INTO public.training_modules (course_id, code, title, sort_order, duration_minutes)
SELECT c.id, m.code, m.title, m.so, m.dur FROM public.training_courses c
JOIN (VALUES
  ('L2-M1','Customer Service Excellence',1,360),
  ('L2-M2','Accessibility & Inclusion',2,180),
  ('L2-M3','Corporate Etiquette',3,180),
  ('L2-M4','Driver Reputation Management',4,120),
  ('L2-M5','Digital Operations',5,240),
  ('L2-M6','Passenger Security',6,360)
) AS m(code,title,so,dur) ON c.code = 'L2'
ON CONFLICT DO NOTHING;

-- Level 3
INSERT INTO public.training_modules (course_id, code, title, sort_order, duration_minutes)
SELECT c.id, m.code, m.title, m.so, m.dur FROM public.training_courses c
JOIN (VALUES
  ('L3-M1','Accident Prevention',1,200),
  ('L3-M2','Fatigue Management',2,180),
  ('L3-M3','Emergency Response',3,240),
  ('L3-M4','First Aid Awareness',4,180),
  ('L3-M5','Security Awareness',5,200),
  ('L3-M6','Crisis Response',6,200)
) AS m(code,title,so,dur) ON c.code = 'L3'
ON CONFLICT DO NOTHING;

-- Level 4
INSERT INTO public.training_modules (course_id, code, title, sort_order, duration_minutes)
SELECT c.id, m.code, m.title, m.so, m.dur FROM public.training_courses c
JOIN (VALUES
  ('L4-M1','Corporate Transport Standards',1,180),
  ('L4-M2','Executive Passenger Handling',2,180),
  ('L4-M3','Confidentiality',3,120),
  ('L4-M4','Travel Policies',4,120),
  ('L4-M5','Airport Transfers',5,180),
  ('L4-M6','VIP Transportation',6,180)
) AS m(code,title,so,dur) ON c.code = 'L4'
ON CONFLICT DO NOTHING;

-- Level 5
INSERT INTO public.training_modules (course_id, code, title, sort_order, duration_minutes)
SELECT c.id, m.code, m.title, m.so, m.dur FROM public.training_courses c
JOIN (VALUES
  ('L5-M1','Fleet Compliance',1,300),
  ('L5-M2','Vehicle Inspections',2,300),
  ('L5-M3','Driver Scheduling',3,240),
  ('L5-M4','Fleet Reporting',4,300),
  ('L5-M5','Vehicle Maintenance Awareness',5,300)
) AS m(code,title,so,dur) ON c.code = 'L5'
ON CONFLICT DO NOTHING;

-- Level 6
INSERT INTO public.training_modules (course_id, code, title, sort_order, duration_minutes)
SELECT c.id, m.code, m.title, m.so, m.dur FROM public.training_courses c
JOIN (VALUES
  ('L6-M1','Adult Learning Principles',1,360),
  ('L6-M2','Coaching Drivers',2,360),
  ('L6-M3','Safety Leadership',3,360),
  ('L6-M4','Incident Review',4,360),
  ('L6-M5','Performance Mentoring',5,360)
) AS m(code,title,so,dur) ON c.code = 'L6'
ON CONFLICT DO NOTHING;

-- Financial Literacy
INSERT INTO public.training_modules (course_id, code, title, sort_order, duration_minutes)
SELECT c.id, m.code, m.title, m.so, m.dur FROM public.training_courses c
JOIN (VALUES
  ('FIN-M1','Budgeting',1,60),
  ('FIN-M2','Savings',2,60),
  ('FIN-M3','Debt Management',3,60),
  ('FIN-M4','Insurance',4,60),
  ('FIN-M5','Retirement Planning',5,60),
  ('FIN-M6','Vehicle Financing',6,60),
  ('FIN-M7','Tax Awareness',7,60),
  ('FIN-M8','Business Planning',8,60)
) AS m(code,title,so,dur) ON c.code = 'FIN'
ON CONFLICT DO NOTHING;

-- =========================
-- SEED LESSONS — one orientation lesson per module (placeholder readings)
-- =========================
INSERT INTO public.training_lessons (module_id, title, lesson_type, content_md, duration_minutes, sort_order)
SELECT m.id,
       'Overview: ' || m.title,
       'reading',
       '# ' || m.title || E'\n\nThis module introduces ' || m.title ||
       E'.\n\nComplete the reading, watch the assigned videos and pass the assessment to progress.',
       GREATEST(m.duration_minutes / 4, 15),
       1
FROM public.training_modules m
WHERE NOT EXISTS (SELECT 1 FROM public.training_lessons l WHERE l.module_id = m.id);

-- =========================
-- SEED ASSESSMENTS — final exam per course
-- =========================
INSERT INTO public.training_assessments (course_id, kind, title, pass_mark, time_limit_min, max_attempts, randomize)
SELECT c.id, 'final', c.title || ' — Final Exam', c.pass_mark,
       GREATEST(c.duration_minutes / 10, 20), 3, true
FROM public.training_courses c
WHERE NOT EXISTS (SELECT 1 FROM public.training_assessments a WHERE a.course_id = c.id AND a.kind='final');

-- =========================
-- SEED QUESTIONS for L0 Final + L1 Final (sample bank)
-- =========================
DO $seed$
DECLARE _a0 uuid; _a1 uuid; _q uuid;
BEGIN
  SELECT a.id INTO _a0 FROM public.training_assessments a
    JOIN public.training_courses c ON c.id=a.course_id WHERE c.code='L0' AND a.kind='final' LIMIT 1;
  SELECT a.id INTO _a1 FROM public.training_assessments a
    JOIN public.training_courses c ON c.id=a.course_id WHERE c.code='L1' AND a.kind='final' LIMIT 1;

  IF _a0 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.training_questions WHERE assessment_id=_a0) THEN
    -- Q1
    INSERT INTO public.training_questions (assessment_id, kind, prompt, points, sort_order)
    VALUES (_a0,'mcq','What is the minimum acceptable rating for Yalla Ride drivers to remain active?',1,1) RETURNING id INTO _q;
    INSERT INTO public.training_answers (question_id,label,is_correct,sort_order) VALUES
      (_q,'3.0',false,1),(_q,'4.0',false,2),(_q,'4.5',true,3),(_q,'5.0',false,4);
    -- Q2
    INSERT INTO public.training_questions (assessment_id, kind, prompt, points, sort_order)
    VALUES (_a0,'mcq','Which of these is part of the Yalla Driver Code of Conduct?',1,2) RETURNING id INTO _q;
    INSERT INTO public.training_answers (question_id,label,is_correct,sort_order) VALUES
      (_q,'Refusing short trips',false,1),
      (_q,'Treating every passenger with respect and professionalism',true,2),
      (_q,'Accepting cash side payments',false,3),
      (_q,'Driving without inspection',false,4);
    -- Q3
    INSERT INTO public.training_questions (assessment_id, kind, prompt, points, sort_order)
    VALUES (_a0,'tf','Drivers must complete onboarding training before being activated on the platform.',1,3) RETURNING id INTO _q;
    INSERT INTO public.training_answers (question_id,label,is_correct,sort_order) VALUES
      (_q,'True',true,1),(_q,'False',false,2);
  END IF;

  IF _a1 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.training_questions WHERE assessment_id=_a1) THEN
    INSERT INTO public.training_questions (assessment_id, kind, prompt, points, sort_order)
    VALUES (_a1,'mcq','In Kenya, a red triangular road sign indicates:',1,1) RETURNING id INTO _q;
    INSERT INTO public.training_answers (question_id,label,is_correct,sort_order) VALUES
      (_q,'Mandatory action',false,1),
      (_q,'Warning of a hazard ahead',true,2),
      (_q,'End of restriction',false,3),
      (_q,'Direction to a destination',false,4);

    INSERT INTO public.training_questions (assessment_id, kind, prompt, points, sort_order)
    VALUES (_a1,'mcq','The safe following distance recommended in dry conditions is:',1,2) RETURNING id INTO _q;
    INSERT INTO public.training_answers (question_id,label,is_correct,sort_order) VALUES
      (_q,'1 second',false,1),(_q,'2 seconds',false,2),(_q,'3 seconds',true,3),(_q,'5 seconds',false,4);

    INSERT INTO public.training_questions (assessment_id, kind, prompt, points, sort_order)
    VALUES (_a1,'mcq','When approaching a pedestrian crossing in Kenya, a driver must:',1,3) RETURNING id INTO _q;
    INSERT INTO public.training_answers (question_id,label,is_correct,sort_order) VALUES
      (_q,'Speed up to clear the crossing',false,1),
      (_q,'Stop and give way to pedestrians',true,2),
      (_q,'Sound the horn continuously',false,3),
      (_q,'Switch on hazard lights',false,4);

    INSERT INTO public.training_questions (assessment_id, kind, prompt, points, sort_order)
    VALUES (_a1,'tf','Overtaking is permitted on a continuous white line.',1,4) RETURNING id INTO _q;
    INSERT INTO public.training_answers (question_id,label,is_correct,sort_order) VALUES
      (_q,'True',false,1),(_q,'False',true,2);

    INSERT INTO public.training_questions (assessment_id, kind, prompt, points, sort_order)
    VALUES (_a1,'mcq','The single most effective control against driver fatigue on long shifts is:',1,5) RETURNING id INTO _q;
    INSERT INTO public.training_answers (question_id,label,is_correct,sort_order) VALUES
      (_q,'Energy drinks',false,1),
      (_q,'Loud music',false,2),
      (_q,'Scheduled rest breaks and adequate sleep',true,3),
      (_q,'Opening the window',false,4);
  END IF;
END $seed$;
