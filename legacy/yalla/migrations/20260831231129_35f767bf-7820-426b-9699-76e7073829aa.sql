-- ============================================================================
-- Recruitment 360 — Education stage authority (Wave 1)
--
-- Forensic finding: the Education stage was completable without academic
-- evidence and no server-side stage transition existed at all, so progression
-- was entirely a frontend decision. This migration makes the server the
-- authority for the Education gate and records every transition attempt.
--
-- ONE canonical requirement engine: the gate reuses rec_document_evaluate
-- (the same engine rec_public_apply enforces at submission) so the frontend,
-- the stage gate and the terminal submit can never disagree.
-- ============================================================================

-- 1. Append-only audit trail for stage transition attempts ------------------
CREATE TABLE IF NOT EXISTS public.rec_education_gate_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id   uuid REFERENCES public.rec_vacancies(id) ON DELETE SET NULL,
  public_slug  text,
  draft_ref    text,
  stage        text NOT NULL,
  allowed      boolean NOT NULL,
  code         text,
  outstanding  jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.rec_education_gate_events TO authenticated;
GRANT ALL    ON public.rec_education_gate_events TO service_role;

ALTER TABLE public.rec_education_gate_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recruitment staff read education gate events"
  ON public.rec_education_gate_events;
CREATE POLICY "recruitment staff read education gate events"
  ON public.rec_education_gate_events FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.recruitment.read'));

CREATE INDEX IF NOT EXISTS rec_education_gate_events_vacancy_idx
  ON public.rec_education_gate_events (vacancy_id, created_at DESC);

CREATE OR REPLACE FUNCTION public._rec_education_gate_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'rec_education_gate_events is append-only';
END; $$;

DROP TRIGGER IF EXISTS rec_education_gate_events_immutable
  ON public.rec_education_gate_events;
CREATE TRIGGER rec_education_gate_events_immutable
  BEFORE UPDATE OR DELETE ON public.rec_education_gate_events
  FOR EACH ROW EXECUTE FUNCTION public._rec_education_gate_events_append_only();

-- 2. Canonical education policy for a vacancy ------------------------------
CREATE OR REPLACE FUNCTION public.rec_education_policy(p_vacancy_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_cfg jsonb := '{}'::jsonb;
  v_default jsonb := jsonb_build_object(
    'primary_required',       true,
    'secondary_required',     true,
    'tertiary_required',      true,
    'qualification_required', true,
    'completion_required',    true,
    'transcript_required',    true,
    'allowed_levels',         jsonb_build_array('certificate','diploma','degree'),
    'duration_options',       jsonb_build_object(
                                'certificate', jsonb_build_array(1,2),
                                'diploma',     jsonb_build_array(2,3),
                                'degree',      jsonb_build_array(3,4,5,6)),
    'required_duration_years', NULL,
    'primary_certificate_label',   'KCPE certificate (or equivalent)',
    'secondary_certificate_label', 'KCSE / GCSE certificate (or equivalent)');
BEGIN
  SELECT coalesce(b.sections->'education', '{}'::jsonb) INTO v_cfg
    FROM public.rec_blueprints b
   WHERE b.vacancy_id = p_vacancy_id AND b.status = 'active'
   LIMIT 1;

  -- Vacancy configuration overrides the platform default key by key, so a
  -- vacancy can never silently lose a mandatory section.
  RETURN v_default || coalesce(v_cfg, '{}'::jsonb);
END; $$;

REVOKE ALL ON FUNCTION public.rec_education_policy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_education_policy(uuid) TO anon, authenticated, service_role;

-- 3. Authoritative Education stage gate ------------------------------------
--    Structured academic data AND persisted documentary evidence.
CREATE OR REPLACE FUNCTION public.rec_public_stage_gate(
  p_slug text, p_stage text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_vac        public.rec_vacancies;
  v_policy     jsonb;
  v_edu        jsonb := coalesce(p_payload->'education', '{}'::jsonb);
  v_pri        jsonb := coalesce(v_edu->'primary', '{}'::jsonb);
  v_sec        jsonb := coalesce(v_edu->'secondary', '{}'::jsonb);
  v_ter        jsonb := coalesce(v_edu->'tertiary', '{}'::jsonb);
  v_qual       jsonb := coalesce(v_edu->'qualification', '{}'::jsonb);
  v_out        text[] := '{}';
  v_docs       jsonb;
  v_item       jsonb;
  v_level      text;
  v_duration   integer;
  v_consolidated boolean;
  v_stage      text := lower(coalesce(nullif(trim(p_stage),''), 'education'));
  v_code       text;
  v_allowed    boolean;
  v_placeholder text := '^(n/?a|na|none|nil|test|x{3,}|abc|asdf+|\.+|-+)$';
BEGIN
  SELECT * INTO v_vac FROM public.rec_vacancies
   WHERE public_slug = nullif(trim(p_slug),'')
     AND approval_status = 'approved' AND publication_status = 'published'
     AND status = 'open' AND published_at IS NOT NULL;

  IF v_vac.id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'stage', v_stage,
      'code', 'VACANCY_NOT_OPEN', 'outstanding', '[]'::jsonb);
  END IF;

  -- The Education gate protects Education itself and every downstream stage.
  IF v_stage NOT IN ('education','experience','attachment','profession',
                     'questions','documents','review','submission') THEN
    RETURN jsonb_build_object('allowed', false, 'stage', v_stage,
      'code', 'UNKNOWN_STAGE', 'outstanding', '[]'::jsonb);
  END IF;

  v_policy := public.rec_education_policy(v_vac.id);

  -- ---- structured academic data ----
  IF coalesce((v_policy->>'primary_required')::boolean, true) THEN
    IF coalesce(length(btrim(v_pri->>'name')),0) < 3
       OR btrim(lower(coalesce(v_pri->>'name',''))) ~ v_placeholder THEN
      v_out := v_out || 'Primary school name';
    END IF;
    IF (v_pri->>'start_date') IS NULL OR (v_pri->>'end_date') IS NULL
       OR (v_pri->>'end_date')::date <= (v_pri->>'start_date')::date
       OR (v_pri->>'end_date')::date > current_date THEN
      v_out := v_out || 'Primary education period';
    END IF;
  END IF;

  IF coalesce((v_policy->>'secondary_required')::boolean, true) THEN
    IF coalesce(length(btrim(v_sec->>'name')),0) < 3
       OR btrim(lower(coalesce(v_sec->>'name',''))) ~ v_placeholder THEN
      v_out := v_out || 'Secondary school name';
    END IF;
    IF (v_sec->>'start_date') IS NULL OR (v_sec->>'end_date') IS NULL
       OR (v_sec->>'end_date')::date <= (v_sec->>'start_date')::date
       OR (v_sec->>'end_date')::date > current_date THEN
      v_out := v_out || 'Secondary education period';
    END IF;
  END IF;

  v_level      := lower(nullif(btrim(v_ter->>'qualification_level'),''));
  v_duration   := nullif(v_ter->>'duration_years','')::integer;
  v_consolidated := lower(coalesce(v_ter->>'transcript_mode','annual')) = 'consolidated';

  IF coalesce((v_policy->>'tertiary_required')::boolean, true) THEN
    IF coalesce(length(btrim(v_ter->>'institution')),0) < 3 THEN
      v_out := v_out || 'Institution name';
    END IF;
    IF coalesce(length(btrim(v_ter->>'programme')),0) < 3 THEN
      v_out := v_out || 'Programme of study';
    END IF;
    IF v_level IS NULL OR NOT (v_policy->'allowed_levels' ? v_level) THEN
      v_out := v_out || 'Qualification level accepted for this vacancy';
    END IF;
    IF (v_ter->>'admission_date') IS NULL OR (v_ter->>'completion_date') IS NULL
       OR (v_ter->>'completion_date')::date <= (v_ter->>'admission_date')::date THEN
      v_out := v_out || 'Admission and completion dates';
    END IF;
    IF coalesce(length(btrim(v_ter->>'institution_phone')),0) < 8 THEN
      v_out := v_out || 'Institution telephone';
    END IF;
    IF coalesce(v_ter->>'institution_email','') !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$'
       OR lower(split_part(coalesce(v_ter->>'institution_email',''),'@',2)) = ANY (ARRAY[
         'gmail.com','googlemail.com','yahoo.com','yahoo.co.uk','hotmail.com','outlook.com',
         'live.com','icloud.com','aol.com','protonmail.com','proton.me','mail.com',
         'yandex.com','zoho.com','gmx.com','mailinator.com','yopmail.com']) THEN
      v_out := v_out || 'Institution official email';
    END IF;
    IF v_duration IS NULL OR v_level IS NULL
       OR NOT (coalesce(v_policy->'duration_options'->v_level,'[]'::jsonb) ? v_duration::text) THEN
      v_out := v_out || 'Programme duration';
    ELSIF (v_policy->>'required_duration_years') IS NOT NULL
       AND v_duration < (v_policy->>'required_duration_years')::integer THEN
      v_out := v_out || format('Programme duration of at least %s academic years',
                               v_policy->>'required_duration_years');
    END IF;
    IF coalesce((v_policy->>'completion_required')::boolean, true)
       AND upper(coalesce(v_ter->>'completion_status','')) <> 'COMPLETED' THEN
      v_out := v_out || 'Completed studies';
    END IF;
  END IF;

  IF coalesce((v_policy->>'qualification_required')::boolean, true) THEN
    IF nullif(btrim(v_qual->>'qualification_type'),'') IS NULL THEN
      v_out := v_out || 'Qualification type';
    END IF;
    IF coalesce(length(btrim(v_qual->>'programme')),0) < 3 THEN
      v_out := v_out || 'Qualification programme of study';
    END IF;
    IF coalesce(length(btrim(v_qual->>'specialisation')),0) < 3 THEN
      v_out := v_out || 'Area of specialisation';
    END IF;
    IF (v_qual->>'graduation_date') IS NULL
       OR (v_qual->>'graduation_date')::date > current_date THEN
      v_out := v_out || 'Graduation date';
    END IF;
    IF coalesce(v_qual->>'award_classification','') NOT IN (
         'First Class','Second Class Upper Division','Second Class Lower Division','Pass') THEN
      v_out := v_out || 'Award classification';
    END IF;
  END IF;

  -- ---- persisted documentary evidence (canonical requirement engine) ----
  -- A requirement clears only when the document actually persisted; a browser
  -- filename is never accepted as evidence.
  v_docs := public.rec_document_evaluate(
    v_vac.id,
    CASE WHEN upper(coalesce(v_ter->>'completion_status','')) = 'COMPLETED'
         THEN 'graduated' ELSE 'currently_studying' END,
    v_level,
    v_duration,
    v_consolidated,
    coalesce(p_payload->'documents','[]'::jsonb));

  FOR v_item IN SELECT jsonb_array_elements(coalesce(v_docs->'items','[]'::jsonb))
  LOOP
    IF coalesce((v_item->>'mandatory')::boolean,false)
       AND (v_item->>'doc_class') IN ('education','graduation')
       AND coalesce(v_item->>'state','missing') <> 'uploaded' THEN
      v_out := v_out || (v_item->>'label');
    END IF;
  END LOOP;

  SELECT array_agg(DISTINCT x) INTO v_out FROM unnest(v_out) x;
  v_out := coalesce(v_out, '{}');

  v_allowed := array_length(v_out,1) IS NULL;
  v_code := CASE WHEN v_allowed THEN NULL ELSE 'EDUCATION_REQUIREMENTS_INCOMPLETE' END;

  INSERT INTO public.rec_education_gate_events(
    vacancy_id, public_slug, draft_ref, stage, allowed, code, outstanding)
  VALUES (v_vac.id, v_vac.public_slug,
          nullif(btrim(p_payload->>'draft_ref'),''), v_stage,
          v_allowed, v_code, to_jsonb(v_out));

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'stage', v_stage,
    'code', v_code,
    'policy', v_policy,
    'outstanding', to_jsonb(v_out));
END; $$;

REVOKE ALL ON FUNCTION public.rec_public_stage_gate(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_public_stage_gate(text, text, jsonb)
  TO anon, authenticated, service_role;

-- 4. Publish the education policy with the application blueprint -----------
--    so the candidate-facing form renders exactly the policy the server holds.
CREATE OR REPLACE FUNCTION public.rec_public_application_blueprint(p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_vac public.rec_vacancies;
  v_bp public.rec_blueprints;
  v_alias uuid;
  v_slug text := p_slug;
BEGIN
  SELECT * INTO v_vac FROM public.rec_vacancies
   WHERE public_slug = v_slug AND approval_status = 'approved'
     AND publication_status = 'published' AND status = 'open' AND published_at IS NOT NULL;

  IF v_vac.id IS NULL THEN
    SELECT vacancy_id INTO v_alias FROM public.rec_vacancy_slug_aliases WHERE slug = v_slug;
    IF v_alias IS NOT NULL THEN
      SELECT * INTO v_vac FROM public.rec_vacancies
       WHERE id = v_alias AND approval_status = 'approved'
         AND publication_status = 'published' AND status = 'open' AND published_at IS NOT NULL;
    END IF;
  END IF;

  IF v_vac.id IS NULL THEN
    RETURN jsonb_build_object('open', false);
  END IF;

  SELECT * INTO v_bp FROM public.rec_blueprints WHERE vacancy_id = v_vac.id AND status = 'active';

  RETURN jsonb_build_object(
    'open', true,
    'canonical_slug', v_vac.public_slug,
    'education_policy', public.rec_education_policy(v_vac.id),
    'vacancy', jsonb_build_object(
      'id', v_vac.id, 'vacancy_no', v_vac.vacancy_no, 'title', v_vac.title,
      'content_version', v_vac.content_version, 'location', v_vac.location,
      'employment_type', v_vac.employment_type, 'work_arrangement', v_vac.work_arrangement,
      'min_years_experience', v_vac.min_years_experience,
      'required_skills', v_vac.required_skills, 'preferred_skills', v_vac.preferred_skills
    ),
    'blueprint', CASE WHEN v_bp.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_bp.id, 'version', v_bp.version, 'cover_letter_mode', v_bp.cover_letter_mode,
      'sections', v_bp.sections, 'document_requirements', v_bp.document_requirements,
      'education', public.rec_education_policy(v_vac.id),
      'questions', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'question_key', q.question_key, 'prompt', q.prompt, 'help_text', q.help_text,
          'kind', q.kind, 'options', q.options, 'is_required', q.is_required,
          'classification', CASE WHEN q.classification = 'knockout' THEN 'required' ELSE q.classification END
        ) ORDER BY q.ord)
        FROM public.rec_blueprint_questions q WHERE q.blueprint_id = v_bp.id), '[]'::jsonb)
    ) END,
    'privacy_notice', (
      SELECT jsonb_build_object('version', n.version, 'title', n.title, 'body_markdown', n.body_markdown)
      FROM public.rec_privacy_notices n WHERE n.is_current LIMIT 1)
  );
END; $$;
