-- ============================================================
-- 1. QUESTION BANK — SME APPROVAL / PUBLICATION LIFECYCLE
-- ============================================================
ALTER TABLE public.rec_question_bank
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'human',
  ADD COLUMN IF NOT EXISTS answer_key jsonb,
  ADD COLUMN IF NOT EXISTS options jsonb,
  ADD COLUMN IF NOT EXISTS publication_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS sme_approved_by uuid,
  ADD COLUMN IF NOT EXISTS sme_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_by uuid,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  ALTER TABLE public.rec_question_bank
    ADD CONSTRAINT rec_question_bank_pubstatus_chk
    CHECK (publication_status IN ('draft','sme_review','sme_approved','published','rejected','retired'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.rec_question_bank
    ADD CONSTRAINT rec_question_bank_origin_chk CHECK (origin IN ('human','ai_drafted'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Existing active questions are treated as already published (no rewriting of history,
-- they were authored and used by staff before this lifecycle existed).
UPDATE public.rec_question_bank
   SET publication_status = 'published', published_at = COALESCE(published_at, created_at)
 WHERE publication_status = 'draft' AND status = 'active';

CREATE TABLE IF NOT EXISTS public.rec_question_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.rec_question_bank(id) ON DELETE CASCADE,
  question_key text NOT NULL,
  question_version integer NOT NULL,
  action text NOT NULL,
  status_before text,
  status_after text NOT NULL,
  actor_user_id uuid,
  note text,
  question_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.rec_question_review_events TO authenticated;
GRANT ALL ON public.rec_question_review_events TO service_role;
ALTER TABLE public.rec_question_review_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recruitment staff read question review events"
  ON public.rec_question_review_events FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.recruitment.read'));

CREATE OR REPLACE FUNCTION public._rec_question_events_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'rec_question_review_events is append-only';
END; $$;

DROP TRIGGER IF EXISTS rec_question_events_append_only ON public.rec_question_review_events;
CREATE TRIGGER rec_question_events_append_only
  BEFORE UPDATE OR DELETE ON public.rec_question_review_events
  FOR EACH ROW EXECUTE FUNCTION public._rec_question_events_append_only();

CREATE OR REPLACE FUNCTION public._rec_question_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS rec_question_touch ON public.rec_question_bank;
CREATE TRIGGER rec_question_touch BEFORE UPDATE ON public.rec_question_bank
  FOR EACH ROW EXECUTE FUNCTION public._rec_question_touch();

-- Lifecycle transitions -------------------------------------------------
CREATE OR REPLACE FUNCTION public.rec_question_review_action(
  p_question uuid, p_action text, p_note text DEFAULT NULL
) RETURNS public.rec_question_bank
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.rec_question_bank; v_before text; v_after text; v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_staff_permission('staff.recruitment.manage') THEN
    RAISE EXCEPTION 'not authorised to govern the question bank';
  END IF;

  SELECT * INTO q FROM public.rec_question_bank WHERE id = p_question FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'question not found'; END IF;
  v_before := q.publication_status;

  IF p_action = 'submit' THEN
    IF v_before NOT IN ('draft','rejected') THEN RAISE EXCEPTION 'question is % — cannot submit for review', v_before; END IF;
    v_after := 'sme_review';
    UPDATE public.rec_question_bank SET publication_status = v_after,
      submitted_by = v_uid, submitted_at = now(), rejection_reason = NULL
      WHERE id = p_question RETURNING * INTO q;

  ELSIF p_action = 'sme_approve' THEN
    IF v_before <> 'sme_review' THEN RAISE EXCEPTION 'question is % — nothing to approve', v_before; END IF;
    IF q.submitted_by IS NOT NULL AND q.submitted_by = v_uid THEN
      RAISE EXCEPTION 'the author cannot be the subject-matter approver';
    END IF;
    v_after := 'sme_approved';
    UPDATE public.rec_question_bank SET publication_status = v_after,
      sme_approved_by = v_uid, sme_approved_at = now() WHERE id = p_question RETURNING * INTO q;

  ELSIF p_action = 'publish' THEN
    IF v_before <> 'sme_approved' THEN RAISE EXCEPTION 'question must be approved by a subject-matter expert before publication (currently %)', v_before; END IF;
    IF q.sme_approved_by = v_uid THEN
      RAISE EXCEPTION 'publication requires a second person (four-eyes)';
    END IF;
    IF q.question_type IN ('knowledge','multiple_choice') AND (q.answer_key IS NULL OR q.options IS NULL) THEN
      RAISE EXCEPTION 'auto-marked questions need both options and an answer key before publication';
    END IF;
    IF q.question_type NOT IN ('knowledge','multiple_choice')
       AND (q.scoring_anchors IS NULL OR jsonb_array_length(q.scoring_anchors) = 0) THEN
      RAISE EXCEPTION 'rubric-scored questions need scoring anchors before publication';
    END IF;
    v_after := 'published';
    UPDATE public.rec_question_bank SET publication_status = v_after, status = 'active',
      published_by = v_uid, published_at = now() WHERE id = p_question RETURNING * INTO q;

  ELSIF p_action = 'reject' THEN
    IF v_before NOT IN ('sme_review','sme_approved') THEN RAISE EXCEPTION 'question is % — nothing to reject', v_before; END IF;
    IF COALESCE(btrim(p_note), '') = '' THEN RAISE EXCEPTION 'a rejection reason is required'; END IF;
    v_after := 'rejected';
    UPDATE public.rec_question_bank SET publication_status = v_after, rejection_reason = p_note
      WHERE id = p_question RETURNING * INTO q;

  ELSIF p_action = 'retire' THEN
    IF v_before <> 'published' THEN RAISE EXCEPTION 'only a published question can be retired'; END IF;
    v_after := 'retired';
    UPDATE public.rec_question_bank SET publication_status = v_after, status = 'retired',
      effective_to = now() WHERE id = p_question RETURNING * INTO q;
  ELSE
    RAISE EXCEPTION 'unknown action %', p_action;
  END IF;

  INSERT INTO public.rec_question_review_events(
    question_id, question_key, question_version, action, status_before, status_after,
    actor_user_id, note, question_snapshot)
  VALUES (q.id, q.question_key, q.version, p_action, v_before, v_after, v_uid, p_note, to_jsonb(q));

  RETURN q;
END; $$;

REVOKE ALL ON FUNCTION public.rec_question_review_action(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_question_review_action(uuid, text, text) TO authenticated, service_role;

-- Only published questions may be placed on a paper.
CREATE OR REPLACE FUNCTION public._rec_template_item_published_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  SELECT publication_status INTO v_status FROM public.rec_question_bank WHERE id = NEW.question_id;
  IF v_status IS DISTINCT FROM 'published' THEN
    RAISE EXCEPTION 'question % is % — only published questions can be placed on an assessment paper', NEW.question_id, COALESCE(v_status,'missing');
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS rec_template_item_published_only ON public.rec_assessment_template_items;
CREATE TRIGGER rec_template_item_published_only
  BEFORE INSERT OR UPDATE ON public.rec_assessment_template_items
  FOR EACH ROW EXECUTE FUNCTION public._rec_template_item_published_only();

-- ============================================================
-- 2. PROFESSION ATTEMPTS — candidate-sat, post-application
--    (rec_assessments is assessor/interview-bound, so attempts are separate)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rec_profession_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  vacancy_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  template_id uuid NOT NULL REFERENCES public.rec_assessment_templates(id),
  template_key text NOT NULL,
  template_version integer NOT NULL,
  attempt_no integer NOT NULL DEFAULT 1,
  attempt_token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'issued',
  band_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  issued_by uuid,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  started_at timestamptz,
  submitted_at timestamptz,
  auto_score numeric,
  rubric_score numeric,
  total_score numeric,
  max_score numeric NOT NULL DEFAULT 0,
  percentage numeric,
  band text,
  gate_status jsonb NOT NULL DEFAULT '{}'::jsonb,
  gates_passed boolean,
  recommendation text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_profession_attempts_status_chk
    CHECK (status IN ('issued','in_progress','submitted','scored','expired','void')),
  CONSTRAINT rec_profession_attempts_unique UNIQUE (application_id, template_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS rec_profession_attempts_app_idx ON public.rec_profession_attempts(application_id);
CREATE INDEX IF NOT EXISTS rec_profession_attempts_status_idx ON public.rec_profession_attempts(status);

CREATE TABLE IF NOT EXISTS public.rec_profession_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.rec_profession_attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.rec_question_bank(id),
  question_key text NOT NULL,
  question_version integer NOT NULL,
  question_type text NOT NULL,
  question_snapshot jsonb NOT NULL,
  competency_code text NOT NULL,
  competency_label text NOT NULL,
  max_marks numeric NOT NULL,
  critical_min numeric,
  mandatory boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  scoring_mode text NOT NULL DEFAULT 'rubric',
  response_text text,
  selected_options jsonb,
  work_sample_document_id uuid REFERENCES public.rec_candidate_documents(id) ON DELETE SET NULL,
  auto_score numeric,
  rubric_score numeric,
  score numeric,
  anchor_level text,
  rationale text,
  scored_by uuid,
  scored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_profession_responses_mode_chk CHECK (scoring_mode IN ('auto','rubric')),
  CONSTRAINT rec_profession_responses_unique UNIQUE (attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS rec_profession_responses_attempt_idx ON public.rec_profession_responses(attempt_id);

GRANT SELECT ON public.rec_profession_attempts TO authenticated;
GRANT SELECT ON public.rec_profession_responses TO authenticated;
GRANT ALL ON public.rec_profession_attempts TO service_role;
GRANT ALL ON public.rec_profession_responses TO service_role;

ALTER TABLE public.rec_profession_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rec_profession_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recruitment staff read profession attempts"
  ON public.rec_profession_attempts FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.recruitment.read'));

CREATE POLICY "Recruitment staff read profession responses"
  ON public.rec_profession_responses FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.recruitment.read'));

CREATE OR REPLACE FUNCTION public._rec_profession_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS rec_profession_attempts_touch ON public.rec_profession_attempts;
CREATE TRIGGER rec_profession_attempts_touch BEFORE UPDATE ON public.rec_profession_attempts
  FOR EACH ROW EXECUTE FUNCTION public._rec_profession_touch();

DROP TRIGGER IF EXISTS rec_profession_responses_touch ON public.rec_profession_responses;
CREATE TRIGGER rec_profession_responses_touch BEFORE UPDATE ON public.rec_profession_responses
  FOR EACH ROW EXECUTE FUNCTION public._rec_profession_touch();

-- Answers are frozen once the candidate submits.
CREATE OR REPLACE FUNCTION public._rec_profession_response_freeze()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.rec_profession_attempts WHERE id = NEW.attempt_id;
  IF v_status IN ('submitted','scored')
     AND (NEW.response_text IS DISTINCT FROM OLD.response_text
       OR NEW.selected_options IS DISTINCT FROM OLD.selected_options
       OR NEW.work_sample_document_id IS DISTINCT FROM OLD.work_sample_document_id) THEN
    RAISE EXCEPTION 'a submitted attempt cannot be edited';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS rec_profession_response_freeze ON public.rec_profession_responses;
CREATE TRIGGER rec_profession_response_freeze BEFORE UPDATE ON public.rec_profession_responses
  FOR EACH ROW EXECUTE FUNCTION public._rec_profession_response_freeze();

-- ---------- issue (staff) ----------
CREATE OR REPLACE FUNCTION public.rec_profession_attempt_issue(
  p_application uuid, p_template uuid DEFAULT NULL, p_valid_days integer DEFAULT 7
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.rec_applications; t public.rec_assessment_templates;
        v_attempt public.rec_profession_attempts; v_no integer; v_token text; v_max numeric := 0;
BEGIN
  IF NOT public.has_staff_permission('staff.recruitment.manage') THEN
    RAISE EXCEPTION 'not authorised to issue assessments';
  END IF;

  SELECT * INTO a FROM public.rec_applications WHERE id = p_application;
  IF a.id IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;

  IF p_template IS NOT NULL THEN
    SELECT * INTO t FROM public.rec_assessment_templates WHERE id = p_template;
  ELSE
    SELECT * INTO t FROM public.rec_assessment_templates
     WHERE vacancy_id = a.vacancy_id AND status = 'active' AND retired_at IS NULL
     ORDER BY version DESC LIMIT 1;
  END IF;
  IF t.id IS NULL THEN RAISE EXCEPTION 'no active assessment paper for this vacancy'; END IF;

  SELECT COALESCE(MAX(attempt_no), 0) + 1 INTO v_no
    FROM public.rec_profession_attempts WHERE application_id = p_application AND template_id = t.id;

  v_token := encode(gen_random_bytes(24), 'hex');

  INSERT INTO public.rec_profession_attempts(
    application_id, vacancy_id, candidate_id, template_id, template_key, template_version,
    attempt_no, attempt_token, band_rules, issued_by, expires_at)
  VALUES (a.id, a.vacancy_id, a.candidate_id, t.id, t.template_key, t.version,
          v_no, v_token, t.band_rules, auth.uid(),
          now() + make_interval(days => GREATEST(COALESCE(p_valid_days, 7), 1)))
  RETURNING * INTO v_attempt;

  INSERT INTO public.rec_profession_responses(
    attempt_id, question_id, question_key, question_version, question_type, question_snapshot,
    competency_code, competency_label, max_marks, critical_min, mandatory, sort_order, scoring_mode)
  SELECT v_attempt.id, q.id, q.question_key, q.version, q.question_type, to_jsonb(q),
         q.competency_code, q.competency_label, i.max_marks, i.critical_min, i.mandatory, i.sort_order,
         CASE WHEN q.question_type IN ('knowledge','multiple_choice') AND q.answer_key IS NOT NULL
              THEN 'auto' ELSE 'rubric' END
    FROM public.rec_assessment_template_items i
    JOIN public.rec_question_bank q ON q.id = i.question_id
   WHERE i.template_id = t.id AND q.publication_status = 'published';

  SELECT COALESCE(SUM(max_marks), 0) INTO v_max
    FROM public.rec_profession_responses WHERE attempt_id = v_attempt.id;
  IF v_max = 0 THEN RAISE EXCEPTION 'this paper has no published questions'; END IF;

  UPDATE public.rec_profession_attempts SET max_score = v_max WHERE id = v_attempt.id;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt.id, 'attempt_token', v_token, 'attempt_no', v_no,
    'template_key', t.template_key, 'template_version', t.version,
    'max_score', v_max, 'expires_at', v_attempt.expires_at);
END; $$;

REVOKE ALL ON FUNCTION public.rec_profession_attempt_issue(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_profession_attempt_issue(uuid, uuid, integer) TO authenticated, service_role;

-- ---------- load (candidate, token) ----------
CREATE OR REPLACE FUNCTION public.rec_profession_attempt_load(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.rec_profession_attempts; v_items jsonb;
BEGIN
  SELECT * INTO v FROM public.rec_profession_attempts WHERE attempt_token = p_token;
  IF v.id IS NULL THEN RETURN jsonb_build_object('found', false); END IF;

  IF v.status IN ('issued','in_progress') AND v.expires_at < now() THEN
    UPDATE public.rec_profession_attempts SET status = 'expired' WHERE id = v.id RETURNING * INTO v;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'question_id', r.question_id, 'question_key', r.question_key,
      'question_type', r.question_type, 'competency_code', r.competency_code,
      'competency_label', r.competency_label, 'max_marks', r.max_marks,
      'mandatory', r.mandatory, 'sort_order', r.sort_order,
      'prompt', r.question_snapshot->>'prompt', 'scenario', r.question_snapshot->>'scenario',
      'expected_evidence', r.question_snapshot->>'expected_evidence',
      'options', r.question_snapshot->'options',
      'response_text', r.response_text, 'selected_options', r.selected_options,
      'work_sample_document_id', r.work_sample_document_id
    ) ORDER BY r.sort_order), '[]'::jsonb)
    INTO v_items FROM public.rec_profession_responses r WHERE r.attempt_id = v.id;

  RETURN jsonb_build_object(
    'found', true, 'attempt_id', v.id, 'status', v.status,
    'template_key', v.template_key, 'template_version', v.template_version,
    'max_score', v.max_score, 'expires_at', v.expires_at,
    'submitted_at', v.submitted_at, 'questions', v_items);
END; $$;

REVOKE ALL ON FUNCTION public.rec_profession_attempt_load(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_profession_attempt_load(text) TO anon, authenticated, service_role;

-- ---------- save (candidate, token) ----------
CREATE OR REPLACE FUNCTION public.rec_profession_attempt_save(p_token text, p_responses jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.rec_profession_attempts; item jsonb; v_saved integer := 0;
BEGIN
  SELECT * INTO v FROM public.rec_profession_attempts WHERE attempt_token = p_token FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'assessment link not recognised'; END IF;
  IF v.expires_at < now() THEN
    UPDATE public.rec_profession_attempts SET status = 'expired' WHERE id = v.id;
    RAISE EXCEPTION 'this assessment link has expired';
  END IF;
  IF v.status NOT IN ('issued','in_progress') THEN
    RAISE EXCEPTION 'this assessment is % and can no longer be edited', v.status;
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_responses, '[]'::jsonb)) LOOP
    UPDATE public.rec_profession_responses SET
      response_text = NULLIF(btrim(COALESCE(item->>'response_text','')), ''),
      selected_options = item->'selected_options',
      work_sample_document_id = NULLIF(item->>'work_sample_document_id','')::uuid
    WHERE attempt_id = v.id AND question_key = item->>'question_key';
    v_saved := v_saved + 1;
  END LOOP;

  UPDATE public.rec_profession_attempts
     SET status = 'in_progress', started_at = COALESCE(started_at, now())
   WHERE id = v.id;

  RETURN jsonb_build_object('saved', v_saved, 'status', 'in_progress');
END; $$;

REVOKE ALL ON FUNCTION public.rec_profession_attempt_save(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_profession_attempt_save(text, jsonb) TO anon, authenticated, service_role;

-- ---------- submit (candidate, token) — server auto-marks objective items ----------
CREATE OR REPLACE FUNCTION public.rec_profession_attempt_submit(p_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.rec_profession_attempts; r record; v_missing text[] := '{}';
        v_auto numeric := 0; v_key jsonb; v_sel jsonb; v_correct boolean;
BEGIN
  SELECT * INTO v FROM public.rec_profession_attempts WHERE attempt_token = p_token FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'assessment link not recognised'; END IF;
  IF v.status = 'submitted' OR v.status = 'scored' THEN
    RETURN jsonb_build_object('status', v.status, 'already_submitted', true);
  END IF;
  IF v.expires_at < now() THEN
    UPDATE public.rec_profession_attempts SET status = 'expired' WHERE id = v.id;
    RAISE EXCEPTION 'this assessment link has expired';
  END IF;

  FOR r IN SELECT * FROM public.rec_profession_responses WHERE attempt_id = v.id ORDER BY sort_order LOOP
    IF r.mandatory AND COALESCE(btrim(COALESCE(r.response_text,'')),'') = ''
       AND r.selected_options IS NULL AND r.work_sample_document_id IS NULL THEN
      v_missing := v_missing || r.question_key;
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'incomplete assessment: % question(s) still unanswered (%)',
      array_length(v_missing,1), array_to_string(v_missing, ', ');
  END IF;

  FOR r IN SELECT * FROM public.rec_profession_responses WHERE attempt_id = v.id LOOP
    IF r.scoring_mode = 'auto' THEN
      v_key := r.question_snapshot->'answer_key';
      v_sel := COALESCE(r.selected_options, '[]'::jsonb);
      v_correct := (v_key IS NOT NULL) AND (
        SELECT COALESCE(bool_and(x), false) FROM (
          SELECT (SELECT COALESCE(bool_and(e IN (SELECT jsonb_array_elements_text(v_sel))), false)
                    FROM jsonb_array_elements_text(v_key) e) AS x
          UNION ALL
          SELECT (SELECT COALESCE(bool_and(s IN (SELECT jsonb_array_elements_text(v_key))), false)
                    FROM jsonb_array_elements_text(v_sel) s)
        ) q
      );
      UPDATE public.rec_profession_responses
         SET auto_score = CASE WHEN v_correct THEN r.max_marks ELSE 0 END,
             score = CASE WHEN v_correct THEN r.max_marks ELSE 0 END,
             scored_at = now()
       WHERE id = r.id;
      v_auto := v_auto + CASE WHEN v_correct THEN r.max_marks ELSE 0 END;
    END IF;
  END LOOP;

  UPDATE public.rec_profession_attempts
     SET status = 'submitted', submitted_at = now(), auto_score = v_auto
   WHERE id = v.id RETURNING * INTO v;

  RETURN jsonb_build_object('status', 'submitted', 'submitted_at', v.submitted_at,
    'awaiting_review', EXISTS (SELECT 1 FROM public.rec_profession_responses
                               WHERE attempt_id = v.id AND scoring_mode = 'rubric'));
END; $$;

REVOKE ALL ON FUNCTION public.rec_profession_attempt_submit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_profession_attempt_submit(text) TO anon, authenticated, service_role;

-- ---------- rubric scoring + authoritative gating (staff) ----------
CREATE OR REPLACE FUNCTION public.rec_profession_attempt_score(
  p_attempt uuid, p_scores jsonb, p_finalise boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.rec_profession_attempts; item jsonb; r record;
        v_total numeric := 0; v_rubric numeric := 0; v_pct numeric; v_band text;
        v_gates jsonb := '[]'::jsonb; v_pass boolean := true; v_unscored integer;
        v_score numeric;
BEGIN
  IF NOT public.has_staff_permission('staff.recruitment.manage') THEN
    RAISE EXCEPTION 'not authorised to score assessments';
  END IF;

  SELECT * INTO v FROM public.rec_profession_attempts WHERE id = p_attempt FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'attempt not found'; END IF;
  IF v.status NOT IN ('submitted','scored') THEN
    RAISE EXCEPTION 'attempt is % — only a submitted attempt can be scored', v.status;
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(COALESCE(p_scores, '[]'::jsonb)) LOOP
    SELECT * INTO r FROM public.rec_profession_responses
      WHERE attempt_id = v.id AND question_key = item->>'question_key' AND scoring_mode = 'rubric';
    IF r.id IS NULL THEN CONTINUE; END IF;
    v_score := (item->>'score')::numeric;
    IF v_score IS NULL OR v_score < 0 OR v_score > r.max_marks THEN
      RAISE EXCEPTION 'score for % must be between 0 and %', r.question_key, r.max_marks;
    END IF;
    IF COALESCE(btrim(COALESCE(item->>'rationale','')),'') = '' THEN
      RAISE EXCEPTION 'a rubric score for % needs a written rationale', r.question_key;
    END IF;
    UPDATE public.rec_profession_responses
       SET rubric_score = v_score, score = v_score, anchor_level = item->>'anchor_level',
           rationale = item->>'rationale', scored_by = auth.uid(), scored_at = now()
     WHERE id = r.id;
  END LOOP;

  SELECT COUNT(*) INTO v_unscored FROM public.rec_profession_responses
    WHERE attempt_id = v.id AND score IS NULL;
  SELECT COALESCE(SUM(score),0), COALESCE(SUM(rubric_score),0) INTO v_total, v_rubric
    FROM public.rec_profession_responses WHERE attempt_id = v.id;

  FOR r IN SELECT * FROM public.rec_profession_responses
            WHERE attempt_id = v.id AND critical_min IS NOT NULL LOOP
    v_gates := v_gates || jsonb_build_object(
      'question_key', r.question_key, 'competency', r.competency_code,
      'minimum', r.critical_min, 'score', r.score,
      'passed', COALESCE(r.score, -1) >= r.critical_min);
    IF COALESCE(r.score, -1) < r.critical_min THEN v_pass := false; END IF;
  END LOOP;

  v_pct := CASE WHEN v.max_score > 0 THEN round(v_total * 100 / v.max_score, 1) ELSE NULL END;
  v_band := CASE
    WHEN v_pct IS NULL THEN NULL
    WHEN v_pct >= 90 THEN 'exceptional'
    WHEN v_pct >= 80 THEN 'strong'
    WHEN v_pct >= 70 THEN 'competent'
    WHEN v_pct >= 60 THEN 'borderline'
    ELSE 'not_recommended' END;

  IF p_finalise AND v_unscored > 0 THEN
    RAISE EXCEPTION 'cannot finalise: % answer(s) are still unscored', v_unscored;
  END IF;

  UPDATE public.rec_profession_attempts SET
    rubric_score = v_rubric, total_score = v_total, percentage = v_pct,
    band = v_band, gate_status = v_gates,
    gates_passed = CASE WHEN v_unscored = 0 THEN v_pass ELSE NULL END,
    status = CASE WHEN p_finalise THEN 'scored' ELSE status END,
    reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = v.id RETURNING * INTO v;

  RETURN jsonb_build_object('attempt_id', v.id, 'status', v.status, 'total_score', v_total,
    'max_score', v.max_score, 'percentage', v_pct, 'band', v_band,
    'gates_passed', v.gates_passed, 'gate_status', v_gates, 'unscored', v_unscored);
END; $$;

REVOKE ALL ON FUNCTION public.rec_profession_attempt_score(uuid, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_profession_attempt_score(uuid, jsonb, boolean) TO authenticated, service_role;