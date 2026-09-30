-- =====================================================================
-- RECRUITMENT 360 — CANDIDATE APPLICATION ARCHITECTURE (PHASE 1)
-- =====================================================================

-- ---------- 1. PRIVACY NOTICES ----------
CREATE TABLE public.rec_privacy_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  title text NOT NULL,
  body_markdown text NOT NULL,
  effective_from date NOT NULL DEFAULT current_date,
  is_current boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rec_privacy_notices TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_privacy_notices TO authenticated;
GRANT ALL ON public.rec_privacy_notices TO service_role;
ALTER TABLE public.rec_privacy_notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "privacy notices are public" ON public.rec_privacy_notices FOR SELECT USING (true);
CREATE POLICY "admins manage privacy notices" ON public.rec_privacy_notices FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE UNIQUE INDEX rec_privacy_notices_one_current ON public.rec_privacy_notices (is_current) WHERE is_current;

-- ---------- 2. VACANCY VERSIONING ----------
ALTER TABLE public.rec_vacancies
  ADD COLUMN IF NOT EXISTS content_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS content_hash text;

CREATE TABLE public.rec_vacancy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id uuid NOT NULL REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  version integer NOT NULL,
  content_hash text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (vacancy_id, version)
);
GRANT SELECT, INSERT ON public.rec_vacancy_versions TO authenticated;
GRANT ALL ON public.rec_vacancy_versions TO service_role;
ALTER TABLE public.rec_vacancy_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec staff read vacancy versions" ON public.rec_vacancy_versions FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec admin delete vacancy versions" ON public.rec_vacancy_versions FOR DELETE TO authenticated USING (public.is_platform_admin());

CREATE OR REPLACE FUNCTION public.rec_vacancy_content_snapshot(v public.rec_vacancies)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'title', v.title, 'public_summary', v.public_summary, 'location', v.location,
    'employment_type', v.employment_type, 'work_arrangement', v.work_arrangement,
    'headcount', v.headcount, 'required_skills', v.required_skills,
    'preferred_skills', v.preferred_skills, 'qualifications', v.qualifications,
    'competencies', v.competencies, 'responsibilities', v.responsibilities,
    'min_years_experience', v.min_years_experience, 'salary_min_cents', v.salary_min_cents,
    'salary_max_cents', v.salary_max_cents, 'currency', v.currency,
    'target_hire_date', v.target_hire_date, 'position_id', v.position_id, 'unit_id', v.unit_id
  );
$$;

CREATE OR REPLACE FUNCTION public.rec_vacancy_version_bump()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_hash text;
BEGIN
  v_hash := md5(public.rec_vacancy_content_snapshot(NEW)::text);
  IF TG_OP = 'INSERT' THEN
    NEW.content_hash := v_hash;
    NEW.content_version := 1;
  ELSIF v_hash IS DISTINCT FROM OLD.content_hash THEN
    NEW.content_hash := v_hash;
    NEW.content_version := coalesce(OLD.content_version, 1) + 1;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.rec_vacancy_version_record()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.rec_vacancy_versions (vacancy_id, version, content_hash, snapshot, created_by)
  VALUES (NEW.id, NEW.content_version, NEW.content_hash, public.rec_vacancy_content_snapshot(NEW), auth.uid())
  ON CONFLICT (vacancy_id, version) DO NOTHING;
  RETURN NULL;
END; $$;

CREATE TRIGGER rec_vacancies_version_bump BEFORE INSERT OR UPDATE ON public.rec_vacancies
  FOR EACH ROW EXECUTE FUNCTION public.rec_vacancy_version_bump();
CREATE TRIGGER rec_vacancies_version_record AFTER INSERT OR UPDATE ON public.rec_vacancies
  FOR EACH ROW EXECUTE FUNCTION public.rec_vacancy_version_record();

-- ---------- 3. SLUG ALIASES ----------
CREATE TABLE public.rec_vacancy_slug_aliases (
  slug text PRIMARY KEY,
  vacancy_id uuid NOT NULL REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rec_vacancy_slug_aliases TO authenticated;
GRANT ALL ON public.rec_vacancy_slug_aliases TO service_role;
ALTER TABLE public.rec_vacancy_slug_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec staff read slug aliases" ON public.rec_vacancy_slug_aliases FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec staff write slug aliases" ON public.rec_vacancy_slug_aliases FOR ALL TO authenticated
  USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());

-- ---------- 4. RECRUITMENT BLUEPRINT ----------
CREATE TABLE public.rec_blueprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id uuid NOT NULL REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','retired')),
  cover_letter_mode text NOT NULL DEFAULT 'optional' CHECK (cover_letter_mode IN ('none','optional','required')),
  sections jsonb NOT NULL DEFAULT '{"education":true,"qualifications":true,"employment":true,"skills":true}'::jsonb,
  document_requirements jsonb NOT NULL DEFAULT '[{"doc_type":"cv","label":"CV / Résumé","required":true}]'::jsonb,
  assessment jsonb NOT NULL DEFAULT '{}'::jsonb,
  interview jsonb NOT NULL DEFAULT '{}'::jsonb,
  workflow jsonb NOT NULL DEFAULT '{}'::jsonb,
  fairness_reviewed_by uuid,
  fairness_reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vacancy_id, version)
);
CREATE UNIQUE INDEX rec_blueprints_one_active ON public.rec_blueprints (vacancy_id) WHERE status = 'active';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_blueprints TO authenticated;
GRANT ALL ON public.rec_blueprints TO service_role;
ALTER TABLE public.rec_blueprints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec staff read blueprints" ON public.rec_blueprints FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec staff write blueprints" ON public.rec_blueprints FOR ALL TO authenticated
  USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());

CREATE TABLE public.rec_blueprint_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id uuid NOT NULL REFERENCES public.rec_blueprints(id) ON DELETE CASCADE,
  ord integer NOT NULL DEFAULT 1,
  question_key text NOT NULL,
  prompt text NOT NULL,
  help_text text,
  kind text NOT NULL CHECK (kind IN ('text','long_text','single_choice','multi_choice','boolean','number','date')),
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_required boolean NOT NULL DEFAULT true,
  classification text NOT NULL DEFAULT 'informational'
    CHECK (classification IN ('required','preferred','knockout','scored','informational')),
  weight numeric NOT NULL DEFAULT 0,
  expected jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blueprint_id, question_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_blueprint_questions TO authenticated;
GRANT ALL ON public.rec_blueprint_questions TO service_role;
ALTER TABLE public.rec_blueprint_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec staff read blueprint questions" ON public.rec_blueprint_questions FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec staff write blueprint questions" ON public.rec_blueprint_questions FOR ALL TO authenticated
  USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());

-- ---------- 5. APPLICATION ANSWERS ----------
CREATE TABLE public.rec_application_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  blueprint_id uuid REFERENCES public.rec_blueprints(id) ON DELETE SET NULL,
  blueprint_version integer,
  question_key text NOT NULL,
  question_prompt text NOT NULL,
  question_kind text NOT NULL,
  classification text NOT NULL,
  answer jsonb NOT NULL DEFAULT 'null'::jsonb,
  score numeric,
  knockout_failed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, question_key)
);
GRANT SELECT, INSERT, UPDATE ON public.rec_application_answers TO authenticated;
GRANT ALL ON public.rec_application_answers TO service_role;
ALTER TABLE public.rec_application_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec staff read answers" ON public.rec_application_answers FOR SELECT TO authenticated
  USING (public.rec_can_read() OR EXISTS (
    SELECT 1 FROM public.rec_applications a JOIN public.rec_candidates c ON c.id = a.candidate_id
    WHERE a.id = rec_application_answers.application_id AND c.user_id = auth.uid()));
CREATE POLICY "rec staff write answers" ON public.rec_application_answers FOR ALL TO authenticated
  USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());

-- ---------- 6. DRAFTS (SAVE & RESUME) ----------
CREATE TABLE public.rec_application_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id uuid NOT NULL REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  email text NOT NULL,
  token_hash text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  current_step integer NOT NULL DEFAULT 1,
  save_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '60 days',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vacancy_id, email)
);
GRANT SELECT ON public.rec_application_drafts TO authenticated;
GRANT ALL ON public.rec_application_drafts TO service_role;
ALTER TABLE public.rec_application_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec admin read drafts" ON public.rec_application_drafts FOR SELECT TO authenticated USING (public.is_platform_admin());

-- ---------- 7. CANONICAL SKILLS ----------
CREATE TABLE public.rec_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  category text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rec_skills TO anon;
GRANT SELECT, INSERT, UPDATE ON public.rec_skills TO authenticated;
GRANT ALL ON public.rec_skills TO service_role;
ALTER TABLE public.rec_skills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "skills are public reference data" ON public.rec_skills FOR SELECT USING (true);
CREATE POLICY "rec staff write skills" ON public.rec_skills FOR ALL TO authenticated
  USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());

ALTER TABLE public.rec_candidate_skills
  ADD COLUMN IF NOT EXISTS skill_id uuid REFERENCES public.rec_skills(id) ON DELETE SET NULL;

-- ---------- 8. APPLICATION PROVENANCE COLUMNS ----------
ALTER TABLE public.rec_applications
  ADD COLUMN IF NOT EXISTS vacancy_version integer,
  ADD COLUMN IF NOT EXISTS blueprint_id uuid REFERENCES public.rec_blueprints(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS blueprint_version integer,
  ADD COLUMN IF NOT EXISTS privacy_notice_version text,
  ADD COLUMN IF NOT EXISTS knockout_flagged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_detail text;

ALTER TABLE public.rec_application_profiles
  ADD COLUMN IF NOT EXISTS consent_talent_pool boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_privacy_version text,
  ADD COLUMN IF NOT EXISTS declaration_accuracy boolean NOT NULL DEFAULT false;

-- ---------- 9. CONTROLLED STATUS TRANSITIONS ----------
CREATE OR REPLACE FUNCTION public.rec_application_transition(
  p_application_id uuid, p_next_stage text, p_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_app public.rec_applications;
  v_allowed text[];
BEGIN
  IF NOT public.rec_can_write() THEN
    RAISE EXCEPTION 'not authorised to change application stage';
  END IF;
  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;

  v_allowed := CASE v_app.stage
    WHEN 'applied'      THEN ARRAY['received','screening','rejected','withdrawn','talent_pool']
    WHEN 'received'     THEN ARRAY['screening','rejected','withdrawn','talent_pool']
    WHEN 'screening'    THEN ARRAY['shortlisted','rejected','withdrawn','talent_pool']
    WHEN 'shortlisted'  THEN ARRAY['evaluation','interview','rejected','withdrawn']
    WHEN 'evaluation'   THEN ARRAY['interview','rejected','withdrawn']
    WHEN 'interview'    THEN ARRAY['evaluation','offer','rejected','withdrawn']
    WHEN 'offer'        THEN ARRAY['accepted','rejected','withdrawn']
    WHEN 'accepted'     THEN ARRAY['onboarding','withdrawn']
    WHEN 'onboarding'   THEN ARRAY['hired','withdrawn']
    ELSE ARRAY[]::text[]
  END;

  IF NOT (p_next_stage = ANY (v_allowed)) THEN
    RAISE EXCEPTION 'invalid stage transition % -> %', v_app.stage, p_next_stage;
  END IF;

  UPDATE public.rec_applications
     SET stage = p_next_stage,
         stage_entered_at = now(),
         last_activity_at = now(),
         status = CASE WHEN p_next_stage IN ('rejected','withdrawn','hired') THEN 'closed' ELSE status END,
         rejection_reason = CASE WHEN p_next_stage = 'rejected' THEN p_reason ELSE rejection_reason END,
         updated_at = now()
   WHERE id = p_application_id;

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, previous_state, new_state, context, source)
  VALUES (auth.uid(), 'application_stage_changed', 'application', p_application_id,
          jsonb_build_object('stage', v_app.stage), jsonb_build_object('stage', p_next_stage),
          jsonb_build_object('reason', p_reason), 'recruitment_360');

  RETURN jsonb_build_object('ok', true, 'from', v_app.stage, 'to', p_next_stage);
END; $$;

-- ---------- 10. PUBLIC BLUEPRINT READ ----------
CREATE OR REPLACE FUNCTION public.rec_public_application_blueprint(p_slug text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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

-- ---------- 11. DRAFT SAVE / LOAD ----------
CREATE OR REPLACE FUNCTION public.rec_public_draft_save(
  p_slug text, p_email text, p_token text, p_payload jsonb, p_step integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vac_id uuid;
  v_email text := lower(nullif(trim(p_email), ''));
  v_hash text;
  v_row public.rec_application_drafts;
BEGIN
  IF v_email IS NULL OR v_email !~ '^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'a valid email address is required to save your application';
  END IF;
  IF coalesce(length(p_token), 0) < 20 THEN
    RAISE EXCEPTION 'invalid resume token';
  END IF;
  IF pg_column_size(coalesce(p_payload, '{}'::jsonb)) > 400000 THEN
    RAISE EXCEPTION 'saved application is too large';
  END IF;

  SELECT id INTO v_vac_id FROM public.rec_vacancies
   WHERE public_slug = p_slug AND approval_status = 'approved'
     AND publication_status = 'published' AND status = 'open' AND published_at IS NOT NULL;
  IF v_vac_id IS NULL THEN RAISE EXCEPTION 'vacancy is not open for applications'; END IF;

  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  SELECT * INTO v_row FROM public.rec_application_drafts WHERE vacancy_id = v_vac_id AND email = v_email;

  IF v_row.id IS NULL THEN
    INSERT INTO public.rec_application_drafts (vacancy_id, email, token_hash, payload, current_step, save_count)
    VALUES (v_vac_id, v_email, v_hash, coalesce(p_payload, '{}'::jsonb), greatest(coalesce(p_step,1),1), 1)
    RETURNING * INTO v_row;
  ELSE
    IF v_row.token_hash <> v_hash THEN
      RAISE EXCEPTION 'a saved application already exists for this email — use your resume link to continue';
    END IF;
    IF v_row.save_count > 2000 THEN RAISE EXCEPTION 'too many saves for this application'; END IF;
    UPDATE public.rec_application_drafts
       SET payload = coalesce(p_payload, '{}'::jsonb),
           current_step = greatest(coalesce(p_step, current_step), 1),
           save_count = save_count + 1,
           expires_at = now() + interval '60 days',
           updated_at = now()
     WHERE id = v_row.id RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object('ok', true, 'saved_at', v_row.updated_at, 'step', v_row.current_step);
END; $$;

CREATE OR REPLACE FUNCTION public.rec_public_draft_load(p_slug text, p_email text, p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vac_id uuid;
  v_row public.rec_application_drafts;
BEGIN
  SELECT id INTO v_vac_id FROM public.rec_vacancies WHERE public_slug = p_slug;
  IF v_vac_id IS NULL THEN RETURN jsonb_build_object('found', false); END IF;

  SELECT * INTO v_row FROM public.rec_application_drafts
   WHERE vacancy_id = v_vac_id
     AND email = lower(trim(coalesce(p_email, '')))
     AND token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
     AND expires_at > now();

  IF v_row.id IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  RETURN jsonb_build_object('found', true, 'payload', v_row.payload,
                            'step', v_row.current_step, 'saved_at', v_row.updated_at);
END; $$;

-- ---------- 12. SEED: PRIVACY NOTICE ----------
INSERT INTO public.rec_privacy_notices (version, title, body_markdown, is_current)
VALUES ('1.0', 'Yalla Mobility Recruitment Privacy Notice',
$md$
## Who processes your data
Yalla Mobility ("we") processes the information you provide in this application as the data controller for recruitment purposes.

## Why we collect it
To assess your suitability for the role you applied for, to run our recruitment process (screening, assessment, interviews, offers and pre-employment checks), and to meet our legal and record-keeping obligations.

## What we collect
Identity and contact details, professional profile, education, professional credentials, employment history, skills, your answers to role-specific questions, and the documents you upload.

## Who sees it
Our recruitment team, the hiring manager for this vacancy, and internal approvers. Service providers that host our systems process it on our instructions only.

## Your documents
Documents are stored privately and are never published or made available through public links.

## How long we keep it
Applications are retained for the duration of the recruitment process and for a limited review period afterwards, after which they are deleted or anonymised unless you asked us to keep your details for future opportunities.

## Automated processing
We may use assistive tooling to summarise or match applications. It supports human recruiters — it does not reject applications on its own.

## Your rights
You can request access, correction, deletion or restriction of your data, and you can withdraw optional consent at any time.

## Contact
Email admin@yallabeena.info for any recruitment privacy question or complaint.
$md$, true)
ON CONFLICT (version) DO NOTHING;

-- ---------- 13. DATA CORRECTION: TITLE TYPO + ALIAS ----------
INSERT INTO public.rec_vacancy_slug_aliases (slug, vacancy_id)
SELECT 'customer-success-cordiantor-506f36', id FROM public.rec_vacancies
WHERE public_slug = 'customer-success-cordiantor-506f36'
ON CONFLICT (slug) DO NOTHING;

UPDATE public.rec_vacancies
   SET title = 'Customer Success Coordinator',
       public_slug = 'customer-success-coordinator-506f36',
       updated_at = now()
 WHERE public_slug = 'customer-success-cordiantor-506f36';

-- backfill a version row for vacancies that predate versioning
INSERT INTO public.rec_vacancy_versions (vacancy_id, version, content_hash, snapshot)
SELECT v.id, v.content_version, coalesce(v.content_hash, md5(public.rec_vacancy_content_snapshot(v)::text)),
       public.rec_vacancy_content_snapshot(v)
FROM public.rec_vacancies v
ON CONFLICT (vacancy_id, version) DO NOTHING;

-- ---------- 14. SEED: BLUEPRINTS ----------
INSERT INTO public.rec_blueprints (vacancy_id, version, status, cover_letter_mode, document_requirements)
SELECT v.id, 1, 'active', 'optional',
  '[{"doc_type":"cv","label":"CV / Résumé","required":true},
    {"doc_type":"certificate","label":"Academic or professional certificates","required":false,"multiple":true},
    {"doc_type":"supporting","label":"Other supporting documents","required":false,"multiple":true}]'::jsonb
FROM public.rec_vacancies v
WHERE v.publication_status = 'published'
ON CONFLICT (vacancy_id, version) DO NOTHING;

-- shared baseline questions
INSERT INTO public.rec_blueprint_questions (blueprint_id, ord, question_key, prompt, help_text, kind, options, is_required, classification, weight)
SELECT b.id, 1, 'work_authorisation', 'Are you legally authorised to work in Kenya?', NULL, 'boolean', '[]'::jsonb, true, 'knockout', 0
FROM public.rec_blueprints b ON CONFLICT DO NOTHING;

INSERT INTO public.rec_blueprint_questions (blueprint_id, ord, question_key, prompt, help_text, kind, options, is_required, classification, weight)
SELECT b.id, 2, 'notice_period', 'What is your notice period?', 'Tell us how soon you could start.', 'single_choice',
  '["Immediately","Within 2 weeks","1 month","2 months","3 months or more"]'::jsonb, true, 'informational', 0
FROM public.rec_blueprints b ON CONFLICT DO NOTHING;

-- Customer Success Coordinator specifics
INSERT INTO public.rec_blueprint_questions (blueprint_id, ord, question_key, prompt, help_text, kind, options, is_required, classification, weight)
SELECT b.id, 3, 'cs_years', 'How many years of customer success or client service experience do you have?', NULL, 'number', '[]'::jsonb, true, 'scored', 3
FROM public.rec_blueprints b JOIN public.rec_vacancies v ON v.id = b.vacancy_id
WHERE v.public_slug = 'customer-success-coordinator-506f36' ON CONFLICT DO NOTHING;

INSERT INTO public.rec_blueprint_questions (blueprint_id, ord, question_key, prompt, help_text, kind, options, is_required, classification, weight)
SELECT b.id, 4, 'crm_tools', 'Which CRM or support platforms have you used?', 'Select all that apply.', 'multi_choice',
  '["Salesforce","HubSpot","Zoho","Zendesk","Freshdesk","Intercom","Other","None"]'::jsonb, true, 'scored', 2
FROM public.rec_blueprints b JOIN public.rec_vacancies v ON v.id = b.vacancy_id
WHERE v.public_slug = 'customer-success-coordinator-506f36' ON CONFLICT DO NOTHING;

INSERT INTO public.rec_blueprint_questions (blueprint_id, ord, question_key, prompt, help_text, kind, options, is_required, classification, weight)
SELECT b.id, 5, 'recovery_scenario', 'Describe how you recovered an at-risk corporate client relationship.', 'Around 150–250 words. Focus on what you did and the outcome.', 'long_text', '[]'::jsonb, true, 'scored', 3
FROM public.rec_blueprints b JOIN public.rec_vacancies v ON v.id = b.vacancy_id
WHERE v.public_slug = 'customer-success-coordinator-506f36' ON CONFLICT DO NOTHING;

-- Sales roles specifics
INSERT INTO public.rec_blueprint_questions (blueprint_id, ord, question_key, prompt, help_text, kind, options, is_required, classification, weight)
SELECT b.id, 3, 'sales_quota', 'What annual sales target have you personally carried, and what did you achieve against it?', NULL, 'long_text', '[]'::jsonb, true, 'scored', 3
FROM public.rec_blueprints b JOIN public.rec_vacancies v ON v.id = b.vacancy_id
WHERE v.public_slug IN ('sales-manager-72683b','sales-administration-cd247c') ON CONFLICT DO NOTHING;

INSERT INTO public.rec_blueprint_questions (blueprint_id, ord, question_key, prompt, help_text, kind, options, is_required, classification, weight)
SELECT b.id, 4, 'b2b_experience', 'Do you have B2B / corporate account experience?', NULL, 'boolean', '[]'::jsonb, true, 'preferred', 2
FROM public.rec_blueprints b JOIN public.rec_vacancies v ON v.id = b.vacancy_id
WHERE v.public_slug IN ('sales-manager-72683b','sales-administration-cd247c') ON CONFLICT DO NOTHING;

-- ---------- 15. TIMESTAMP TRIGGERS ----------
CREATE TRIGGER rec_blueprints_touch BEFORE UPDATE ON public.rec_blueprints
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER rec_blueprint_questions_touch BEFORE UPDATE ON public.rec_blueprint_questions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER rec_privacy_notices_touch BEFORE UPDATE ON public.rec_privacy_notices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();