-- ============================================================
-- Wave 2B — Assessment blueprint + versioned snapshot
-- ============================================================

-- 1. Question bank metadata ---------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.rec_question_no_seq;

ALTER TABLE public.rec_question_bank
  ADD COLUMN IF NOT EXISTS question_no text,
  ADD COLUMN IF NOT EXISTS difficulty text NOT NULL DEFAULT 'intermediate',
  ADD COLUMN IF NOT EXISTS rubric jsonb;

UPDATE public.rec_question_bank
   SET question_no = 'QB-' || lpad(nextval('public.rec_question_no_seq')::text, 5, '0')
 WHERE question_no IS NULL;

ALTER TABLE public.rec_question_bank
  ALTER COLUMN question_no SET DEFAULT 'QB-' || lpad(nextval('public.rec_question_no_seq')::text, 5, '0');

CREATE UNIQUE INDEX IF NOT EXISTS rec_question_bank_question_no_key
  ON public.rec_question_bank(question_no);

DO $$ BEGIN
  ALTER TABLE public.rec_question_bank
    ADD CONSTRAINT rec_question_bank_difficulty_chk
    CHECK (difficulty IN ('foundation','intermediate','advanced','expert'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The rubric is the authoritative scoring guide; fall back to legacy anchors.
UPDATE public.rec_question_bank
   SET rubric = jsonb_build_object('anchors', COALESCE(scoring_anchors, '[]'::jsonb))
 WHERE rubric IS NULL;

-- 2. Canonical competency register -------------------------------------------
CREATE TABLE IF NOT EXISTS public.rec_competencies (
  code            text PRIMARY KEY,
  label           text NOT NULL,
  description     text,
  role_family     text NOT NULL DEFAULT 'general',
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_competencies TO authenticated;
GRANT ALL ON public.rec_competencies TO service_role;
ALTER TABLE public.rec_competencies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rec_competencies_read" ON public.rec_competencies;
CREATE POLICY "rec_competencies_read" ON public.rec_competencies
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.recruitment.read'));
DROP POLICY IF EXISTS "rec_competencies_write" ON public.rec_competencies;
CREATE POLICY "rec_competencies_write" ON public.rec_competencies
  FOR ALL TO authenticated
  USING (public.has_staff_permission('staff.recruitment.manage'))
  WITH CHECK (public.has_staff_permission('staff.recruitment.manage'));

-- Seed from the questions that already exist — no invented competencies.
INSERT INTO public.rec_competencies(code, label, role_family)
SELECT DISTINCT q.competency_code, q.competency_label, COALESCE(q.role_family, 'general')
  FROM public.rec_question_bank q
 WHERE q.competency_code IS NOT NULL
ON CONFLICT (code) DO NOTHING;

-- 3. Vacancy competency map ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rec_vacancy_competencies (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id       uuid NOT NULL REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  competency_code  text NOT NULL REFERENCES public.rec_competencies(code),
  weight           numeric NOT NULL DEFAULT 1,
  min_marks        numeric,
  mandatory        boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 0,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vacancy_id, competency_code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_vacancy_competencies TO authenticated;
GRANT ALL ON public.rec_vacancy_competencies TO service_role;
ALTER TABLE public.rec_vacancy_competencies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rec_vacancy_competencies_read" ON public.rec_vacancy_competencies;
CREATE POLICY "rec_vacancy_competencies_read" ON public.rec_vacancy_competencies
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.recruitment.read'));
DROP POLICY IF EXISTS "rec_vacancy_competencies_write" ON public.rec_vacancy_competencies;
CREATE POLICY "rec_vacancy_competencies_write" ON public.rec_vacancy_competencies
  FOR ALL TO authenticated
  USING (public.has_staff_permission('staff.recruitment.manage'))
  WITH CHECK (public.has_staff_permission('staff.recruitment.manage'));

CREATE TRIGGER rec_vacancy_competencies_touch
  BEFORE UPDATE ON public.rec_vacancy_competencies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER rec_competencies_touch
  BEFORE UPDATE ON public.rec_competencies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Papers record their blueprint provenance --------------------------------
ALTER TABLE public.rec_assessment_templates
  ADD COLUMN IF NOT EXISTS blueprint_id uuid,
  ADD COLUMN IF NOT EXISTS blueprint_version integer,
  ADD COLUMN IF NOT EXISTS coverage jsonb,
  ADD COLUMN IF NOT EXISTS activated_by uuid;

-- 5. Snapshot immutability: items are only editable while the paper is draft --
CREATE OR REPLACE FUNCTION public._rec_template_items_frozen()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.rec_assessment_templates
   WHERE id = COALESCE(NEW.template_id, OLD.template_id);
  IF v_status IS NOT NULL AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'assessment paper is % — its question list is frozen; compose a new version instead', v_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;

DROP TRIGGER IF EXISTS rec_template_items_frozen ON public.rec_assessment_template_items;
CREATE TRIGGER rec_template_items_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON public.rec_assessment_template_items
  FOR EACH ROW EXECUTE FUNCTION public._rec_template_items_frozen();

-- 6. Set a vacancy's assessed competencies -----------------------------------
CREATE OR REPLACE FUNCTION public.rec_vacancy_competencies_set(p_vacancy uuid, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  IF NOT public.has_staff_permission('staff.recruitment.manage') THEN
    RAISE EXCEPTION 'not authorised to configure vacancy competencies';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rec_vacancies WHERE id = p_vacancy) THEN
    RAISE EXCEPTION 'vacancy not found';
  END IF;

  DELETE FROM public.rec_vacancy_competencies
   WHERE vacancy_id = p_vacancy
     AND competency_code NOT IN (
       SELECT x->>'competency_code' FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) x);

  INSERT INTO public.rec_vacancy_competencies(
    vacancy_id, competency_code, weight, min_marks, mandatory, sort_order, created_by)
  SELECT p_vacancy,
         x->>'competency_code',
         COALESCE((x->>'weight')::numeric, 1),
         NULLIF(x->>'min_marks','')::numeric,
         COALESCE((x->>'mandatory')::boolean, true),
         COALESCE((x->>'sort_order')::integer, 0),
         auth.uid()
    FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) x
  ON CONFLICT (vacancy_id, competency_code) DO UPDATE
     SET weight = EXCLUDED.weight,
         min_marks = EXCLUDED.min_marks,
         mandatory = EXCLUDED.mandatory,
         sort_order = EXCLUDED.sort_order,
         updated_at = now();

  SELECT count(*) INTO v_count FROM public.rec_vacancy_competencies WHERE vacancy_id = p_vacancy;
  RETURN jsonb_build_object('vacancy_id', p_vacancy, 'competencies', v_count);
END; $$;

-- 7. Coverage report: can this vacancy be assessed from published questions? --
CREATE OR REPLACE FUNCTION public.rec_assessment_coverage(p_vacancy uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'vacancy_id', p_vacancy,
    'competencies', COALESCE(jsonb_agg(jsonb_build_object(
        'competency_code', vc.competency_code,
        'competency_label', c.label,
        'weight', vc.weight,
        'min_marks', vc.min_marks,
        'mandatory', vc.mandatory,
        'published_questions', (
          SELECT count(*) FROM public.rec_question_bank q
           WHERE q.competency_code = vc.competency_code AND q.publication_status = 'published'),
        'available_marks', (
          SELECT COALESCE(SUM(q.max_marks), 0) FROM public.rec_question_bank q
           WHERE q.competency_code = vc.competency_code AND q.publication_status = 'published')
      ) ORDER BY vc.sort_order, vc.competency_code), '[]'::jsonb),
    'gaps', COALESCE((
      SELECT jsonb_agg(g.competency_code)
        FROM public.rec_vacancy_competencies g
       WHERE g.vacancy_id = p_vacancy AND g.mandatory
         AND NOT EXISTS (SELECT 1 FROM public.rec_question_bank q
                          WHERE q.competency_code = g.competency_code
                            AND q.publication_status = 'published')), '[]'::jsonb)
  )
  FROM public.rec_vacancy_competencies vc
  JOIN public.rec_competencies c ON c.code = vc.competency_code
 WHERE vc.vacancy_id = p_vacancy;
$$;

-- 8. Compose a draft paper from the vacancy blueprint ------------------------
CREATE OR REPLACE FUNCTION public.rec_assessment_blueprint_compose(
  p_vacancy uuid,
  p_per_competency integer DEFAULT NULL,
  p_difficulties text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.rec_vacancies; v_key text; v_version integer; v_tpl uuid;
        v_bp_id uuid; v_bp_version integer; v_total numeric := 0; v_cov jsonb;
BEGIN
  IF NOT public.has_staff_permission('staff.recruitment.manage') THEN
    RAISE EXCEPTION 'not authorised to compose assessment papers';
  END IF;

  SELECT * INTO v FROM public.rec_vacancies WHERE id = p_vacancy;
  IF v.id IS NULL THEN RAISE EXCEPTION 'vacancy not found'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.rec_vacancy_competencies WHERE vacancy_id = p_vacancy) THEN
    RAISE EXCEPTION 'this vacancy has no assessed competencies — map competencies before composing a paper';
  END IF;

  SELECT id, version INTO v_bp_id, v_bp_version
    FROM public.rec_blueprints WHERE vacancy_id = p_vacancy
   ORDER BY version DESC LIMIT 1;

  v_key := 'vac-' || COALESCE(v.vacancy_no, left(p_vacancy::text, 8));
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM public.rec_assessment_templates WHERE template_key = v_key;

  INSERT INTO public.rec_assessment_templates(
    template_key, version, title, role_family, vacancy_id, status, total_marks,
    blueprint_id, blueprint_version, created_by, notes)
  VALUES (v_key, v_version, v.title || ' — profession assessment v' || v_version,
          COALESCE(v.blueprint_key, 'general'), p_vacancy, 'draft', 0,
          v_bp_id, v_bp_version, auth.uid(),
          'Composed from the vacancy competency map on ' || to_char(now(), 'YYYY-MM-DD'))
  RETURNING id INTO v_tpl;

  INSERT INTO public.rec_assessment_template_items(
    template_id, question_id, sort_order, max_marks, critical_min, mandatory)
  SELECT v_tpl, s.id, s.rn, s.max_marks, s.min_marks, s.mandatory
    FROM (
      SELECT q.id, q.max_marks, vc.min_marks, vc.mandatory,
             row_number() OVER (ORDER BY vc.sort_order, vc.competency_code,
               CASE q.difficulty WHEN 'foundation' THEN 0 WHEN 'intermediate' THEN 1
                                 WHEN 'advanced' THEN 2 ELSE 3 END, q.question_key) AS rn,
             row_number() OVER (PARTITION BY vc.competency_code ORDER BY
               CASE q.difficulty WHEN 'foundation' THEN 0 WHEN 'intermediate' THEN 1
                                 WHEN 'advanced' THEN 2 ELSE 3 END, q.question_key) AS per
        FROM public.rec_vacancy_competencies vc
        JOIN public.rec_question_bank q
          ON q.competency_code = vc.competency_code
         AND q.publication_status = 'published'
         AND (p_difficulties IS NULL OR q.difficulty = ANY(p_difficulties))
       WHERE vc.vacancy_id = p_vacancy
    ) s
   WHERE p_per_competency IS NULL OR s.per <= p_per_competency;

  SELECT COALESCE(SUM(max_marks), 0) INTO v_total
    FROM public.rec_assessment_template_items WHERE template_id = v_tpl;

  v_cov := public.rec_assessment_coverage(p_vacancy);

  UPDATE public.rec_assessment_templates
     SET total_marks = v_total, coverage = v_cov, updated_at = now()
   WHERE id = v_tpl;

  RETURN jsonb_build_object(
    'template_id', v_tpl, 'template_key', v_key, 'version', v_version,
    'status', 'draft', 'total_marks', v_total,
    'question_count', (SELECT count(*) FROM public.rec_assessment_template_items WHERE template_id = v_tpl),
    'blueprint_id', v_bp_id, 'blueprint_version', v_bp_version,
    'coverage', v_cov);
END; $$;

-- 9. Activate a paper (version snapshot becomes authoritative) ---------------
CREATE OR REPLACE FUNCTION public.rec_assessment_template_activate(p_template uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t public.rec_assessment_templates; v_gaps jsonb; v_items integer; v_retired integer := 0;
BEGIN
  IF NOT public.has_staff_permission('staff.recruitment.manage') THEN
    RAISE EXCEPTION 'not authorised to activate assessment papers';
  END IF;

  SELECT * INTO t FROM public.rec_assessment_templates WHERE id = p_template;
  IF t.id IS NULL THEN RAISE EXCEPTION 'assessment paper not found'; END IF;
  IF t.status <> 'draft' THEN RAISE EXCEPTION 'only a draft paper can be activated (this one is %)', t.status; END IF;
  IF t.created_by IS NOT NULL AND t.created_by = auth.uid() THEN
    RAISE EXCEPTION 'four-eyes control: the person who composed this paper cannot activate it';
  END IF;

  SELECT count(*) INTO v_items FROM public.rec_assessment_template_items WHERE template_id = p_template;
  IF v_items = 0 THEN RAISE EXCEPTION 'this paper has no questions'; END IF;

  IF t.vacancy_id IS NOT NULL THEN
    v_gaps := public.rec_assessment_coverage(t.vacancy_id) -> 'gaps';
    IF jsonb_array_length(COALESCE(v_gaps, '[]'::jsonb)) > 0 THEN
      RAISE EXCEPTION 'competency coverage gap — no published question for: %',
        (SELECT string_agg(x::text, ', ') FROM jsonb_array_elements_text(v_gaps) x);
    END IF;

    UPDATE public.rec_assessment_templates
       SET status = 'retired', retired_at = now(), updated_at = now()
     WHERE vacancy_id = t.vacancy_id AND id <> p_template AND status IN ('active','pilot');
    GET DIAGNOSTICS v_retired = ROW_COUNT;
  END IF;

  UPDATE public.rec_assessment_templates
     SET status = 'active', activated_at = now(), activated_by = auth.uid(), updated_at = now()
   WHERE id = p_template;

  RETURN jsonb_build_object('template_id', p_template, 'status', 'active',
                            'questions', v_items, 'retired_previous', v_retired);
END; $$;

-- 10. Console reads ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rec_assessment_papers(p_vacancy uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'template_id', t.id, 'template_key', t.template_key, 'version', t.version,
      'title', t.title, 'status', t.status, 'total_marks', t.total_marks,
      'vacancy_id', t.vacancy_id, 'vacancy_title', v.title, 'vacancy_no', v.vacancy_no,
      'blueprint_id', t.blueprint_id, 'blueprint_version', t.blueprint_version,
      'coverage', t.coverage, 'created_by', t.created_by, 'activated_by', t.activated_by,
      'activated_at', t.activated_at, 'created_at', t.created_at,
      'question_count', (SELECT count(*) FROM public.rec_assessment_template_items i WHERE i.template_id = t.id),
      'attempts', (SELECT count(*) FROM public.rec_profession_attempts a WHERE a.template_id = t.id)
    ) ORDER BY t.created_at DESC), '[]'::jsonb)
    FROM public.rec_assessment_templates t
    LEFT JOIN public.rec_vacancies v ON v.id = t.vacancy_id
   WHERE public.has_staff_permission('staff.recruitment.read')
     AND (p_vacancy IS NULL OR t.vacancy_id = p_vacancy);
$$;

CREATE OR REPLACE FUNCTION public.rec_assessment_paper_detail(p_template uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'template_id', t.id, 'template_key', t.template_key, 'version', t.version,
    'title', t.title, 'status', t.status, 'total_marks', t.total_marks,
    'vacancy_id', t.vacancy_id, 'blueprint_id', t.blueprint_id,
    'blueprint_version', t.blueprint_version, 'coverage', t.coverage,
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'item_id', i.id, 'question_id', q.id, 'question_no', q.question_no,
          'question_key', q.question_key, 'question_version', q.version,
          'question_type', q.question_type, 'competency_code', q.competency_code,
          'competency_label', q.competency_label, 'difficulty', q.difficulty,
          'prompt', q.prompt, 'max_marks', i.max_marks, 'critical_min', i.critical_min,
          'mandatory', i.mandatory, 'sort_order', i.sort_order,
          'has_answer_key', q.answer_key IS NOT NULL, 'rubric', q.rubric
        ) ORDER BY i.sort_order)
        FROM public.rec_assessment_template_items i
        JOIN public.rec_question_bank q ON q.id = i.question_id
       WHERE i.template_id = t.id), '[]'::jsonb))
    FROM public.rec_assessment_templates t
   WHERE t.id = p_template AND public.has_staff_permission('staff.recruitment.read');
$$;

-- 11. One attempt, with the competency breakdown -----------------------------
CREATE OR REPLACE FUNCTION public.rec_profession_attempt_review(p_attempt uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'attempt_id', a.id, 'application_id', a.application_id, 'status', a.status,
    'attempt_no', a.attempt_no, 'template_key', a.template_key,
    'template_version', a.template_version, 'issued_at', a.issued_at,
    'expires_at', a.expires_at, 'submitted_at', a.submitted_at,
    'total_score', a.total_score, 'max_score', a.max_score,
    'percentage', a.percentage, 'band', a.band,
    'gates_passed', a.gates_passed, 'gate_status', a.gate_status,
    'reviewed_at', a.reviewed_at,
    'candidate_name', c.full_name, 'candidate_no', c.candidate_no,
    'responses', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
          'response_id', r.id, 'question_key', r.question_key,
          'question_no', r.question_snapshot->>'question_no',
          'question_type', r.question_type, 'difficulty', r.question_snapshot->>'difficulty',
          'prompt', r.question_snapshot->>'prompt',
          'expected_evidence', r.question_snapshot->>'expected_evidence',
          'rubric', r.question_snapshot->'rubric',
          'competency_code', r.competency_code, 'competency_label', r.competency_label,
          'max_marks', r.max_marks, 'critical_min', r.critical_min, 'mandatory', r.mandatory,
          'scoring_mode', r.scoring_mode, 'response_text', r.response_text,
          'selected_options', r.selected_options,
          'work_sample_document_id', r.work_sample_document_id,
          'auto_score', r.auto_score, 'score', r.score,
          'anchor_level', r.anchor_level, 'rationale', r.rationale,
          'scored_at', r.scored_at
        ) ORDER BY r.sort_order)
        FROM public.rec_profession_responses r WHERE r.attempt_id = a.id), '[]'::jsonb),
    'competency_breakdown', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'competency_code')
        FROM (
          SELECT jsonb_build_object(
              'competency_code', r.competency_code,
              'competency_label', max(r.competency_label),
              'questions', count(*),
              'max_marks', SUM(r.max_marks),
              'score', CASE WHEN count(r.score) = 0 THEN NULL ELSE SUM(COALESCE(r.score, 0)) END,
              'critical_min', max(r.critical_min),
              'unscored', count(*) FILTER (WHERE r.score IS NULL)) AS x
            FROM public.rec_profession_responses r
           WHERE r.attempt_id = a.id
           GROUP BY r.competency_code) g), '[]'::jsonb))
    FROM public.rec_profession_attempts a
    LEFT JOIN public.rec_candidates c ON c.id = a.candidate_id
   WHERE a.id = p_attempt AND public.has_staff_permission('staff.recruitment.read');
$$;

-- 12. Consolidated HR application review record ------------------------------
CREATE OR REPLACE FUNCTION public.rec_application_review_record(p_application uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'application_id', ap.id, 'application_no', ap.application_no,
    'stage', ap.stage, 'status', ap.status, 'applied_at', ap.applied_at,
    'review_flagged', ap.review_flagged, 'review_flag_reason', ap.review_flag_reason,
    'knockout_flagged', ap.knockout_flagged,
    'vacancy', jsonb_build_object('vacancy_id', v.id, 'vacancy_no', v.vacancy_no,
      'title', v.title, 'public_slug', v.public_slug,
      'employment_type', v.employment_type, 'qualification_level', v.qualification_level),
    'candidate', jsonb_build_object('candidate_id', c.id, 'candidate_no', c.candidate_no,
      'full_name', c.full_name, 'email', c.email, 'phone', c.phone, 'location', c.location),
    'education', jsonb_build_object(
      'status', ap.education_status, 'completed_years', ap.completed_years,
      'consolidated_transcript', ap.consolidated_transcript,
      'qualification_level', ap.qualification_level,
      'qualifications', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('qualification', q.qualification,
                 'institution', q.institution, 'award_year', q.award_year,
                 'kind', q.kind, 'verified', q.verified) ORDER BY q.award_year DESC NULLS LAST)
          FROM public.rec_candidate_qualifications q WHERE q.candidate_id = c.id), '[]'::jsonb),
      'gate_events', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('stage', e.stage, 'allowed', e.allowed,
                 'code', e.code, 'outstanding', e.outstanding, 'created_at', e.created_at)
                 ORDER BY e.created_at DESC)
          FROM public.rec_education_gate_events e
         WHERE e.vacancy_id = ap.vacancy_id AND e.stage = 'education'
         LIMIT 20), '[]'::jsonb)),
    'attachment', COALESCE((
      SELECT jsonb_object_agg(a.question_key, jsonb_build_object(
               'answer', a.answer, 'classification', a.classification,
               'knockout_failed', a.knockout_failed))
        FROM public.rec_application_answers a
       WHERE a.application_id = ap.id
         AND (a.question_key LIKE 'attachment%' OR a.question_key LIKE 'industrial%')), '{}'::jsonb),
    'answers', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('question_key', a.question_key,
               'prompt', a.question_prompt, 'kind', a.question_kind,
               'classification', a.classification, 'answer', a.answer,
               'score', a.score, 'knockout_failed', a.knockout_failed)
               ORDER BY a.created_at)
        FROM public.rec_application_answers a WHERE a.application_id = ap.id), '[]'::jsonb),
    'documents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('document_id', d.id, 'doc_key', d.doc_key,
               'doc_type', d.doc_type, 'file_name', d.file_name,
               'academic_year', d.academic_year, 'consolidated', d.consolidated,
               'version_no', d.version_no, 'upload_status', d.upload_status,
               'verification_status', d.verification_status,
               'review_reason', d.review_reason, 'created_at', d.created_at)
               ORDER BY d.created_at DESC)
        FROM public.rec_candidate_documents d
       WHERE d.application_id = ap.id AND d.superseded_at IS NULL), '[]'::jsonb),
    'assessments', COALESCE((
      SELECT jsonb_agg(public.rec_profession_attempt_review(at.id) ORDER BY at.attempt_no DESC)
        FROM public.rec_profession_attempts at WHERE at.application_id = ap.id), '[]'::jsonb),
    'active_paper', (
      SELECT jsonb_build_object('template_id', t.id, 'template_key', t.template_key,
               'version', t.version, 'total_marks', t.total_marks)
        FROM public.rec_assessment_templates t
       WHERE t.vacancy_id = ap.vacancy_id AND t.status = 'active'
       ORDER BY t.version DESC LIMIT 1))
    FROM public.rec_applications ap
    JOIN public.rec_vacancies v ON v.id = ap.vacancy_id
    JOIN public.rec_candidates c ON c.id = ap.candidate_id
   WHERE ap.id = p_application AND public.has_staff_permission('staff.recruitment.read');
$$;

-- 13. Grants (deny-by-default: staff-authenticated only) ---------------------
REVOKE ALL ON FUNCTION public.rec_vacancy_competencies_set(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rec_assessment_coverage(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rec_assessment_blueprint_compose(uuid, integer, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rec_assessment_template_activate(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rec_assessment_papers(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rec_assessment_paper_detail(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rec_profession_attempt_review(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rec_application_review_record(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rec_vacancy_competencies_set(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_assessment_coverage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_assessment_blueprint_compose(uuid, integer, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_assessment_template_activate(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_assessment_papers(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_assessment_paper_detail(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_profession_attempt_review(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_application_review_record(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_vacancy_competencies_set(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.rec_assessment_blueprint_compose(uuid, integer, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.rec_assessment_template_activate(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.rec_application_review_record(uuid) TO service_role;
