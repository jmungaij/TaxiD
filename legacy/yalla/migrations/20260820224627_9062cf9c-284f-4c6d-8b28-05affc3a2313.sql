DO $$ BEGIN
  CREATE TYPE public.intern_pipeline_stage AS ENUM (
    'DRAFT','PUBLISHED','APPLICATION_OPEN','APPLICATION_RECEIVED','ELIGIBILITY_SCREENING',
    'ACADEMIC_PROFILE_VALIDATION','CURRICULUM_MATCH','EVIDENCE_REVIEW','CAPABILITY_ASSESSMENT',
    'SHORTLIST_REVIEW','INTERVIEW_INVITED','INTERVIEW_SCHEDULED','INTERVIEW_COMPLETED',
    'SELECTION_REVIEW','SELECTED','OFFER_GENERATED','OFFER_SENT','OFFER_ACCEPTED',
    'DOCUMENT_COLLECTION','ONBOARDING','INTERN_ACTIVATED','INTERNS_360',
    'REJECTED','WITHDRAWN','DECLINED','EXPIRED','NO_SHOW','INELIGIBLE','POSITION_FILLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.intern_recruitment_authority(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.intern_programme_authority(p_user);
$$;
GRANT EXECUTE ON FUNCTION public.intern_recruitment_authority(uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.intern_curriculum_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution text NOT NULL,
  institution_type text,
  programme text NOT NULL,
  qualification_level text NOT NULL,
  specialisation text,
  curriculum_version text NOT NULL DEFAULT 'v1',
  source text,
  source_url text,
  source_date date,
  retrieved_at timestamptz NOT NULL DEFAULT now(),
  verification_status text NOT NULL DEFAULT 'UNVERIFIED',
  review_due date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS intern_curriculum_sources_key
  ON public.intern_curriculum_sources(institution, programme, qualification_level, COALESCE(specialisation,''), curriculum_version);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intern_curriculum_sources TO authenticated;
GRANT ALL ON public.intern_curriculum_sources TO service_role;
ALTER TABLE public.intern_curriculum_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY curriculum_sources_read ON public.intern_curriculum_sources FOR SELECT TO authenticated
  USING (public.intern_recruitment_authority(auth.uid()));
CREATE POLICY curriculum_sources_write ON public.intern_curriculum_sources FOR ALL TO authenticated
  USING (public.intern_recruitment_authority(auth.uid())) WITH CHECK (public.intern_recruitment_authority(auth.uid()));

CREATE TABLE IF NOT EXISTS public.intern_course_competencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid REFERENCES public.intern_curriculum_sources(id) ON DELETE SET NULL,
  course text NOT NULL,
  competency text NOT NULL,
  competency_category text,
  yalla_capability text NOT NULL,
  track_code text,
  proficiency_signal text NOT NULL DEFAULT 'EXPOSURE',
  match_kind text NOT NULL DEFAULT 'PRIMARY',
  curriculum_version text NOT NULL DEFAULT 'v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course, competency, curriculum_version)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intern_course_competencies TO authenticated;
GRANT ALL ON public.intern_course_competencies TO service_role;
ALTER TABLE public.intern_course_competencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY course_comp_read ON public.intern_course_competencies FOR SELECT TO authenticated USING (true);
CREATE POLICY course_comp_write ON public.intern_course_competencies FOR ALL TO authenticated
  USING (public.intern_recruitment_authority(auth.uid())) WITH CHECK (public.intern_recruitment_authority(auth.uid()));

CREATE TABLE IF NOT EXISTS public.intern_recruitment_weight_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id uuid REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'ACTIVE',
  weights jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS intern_weight_sets_key
  ON public.intern_recruitment_weight_sets(COALESCE(vacancy_id, '00000000-0000-0000-0000-000000000000'::uuid), version);
GRANT SELECT, INSERT, UPDATE ON public.intern_recruitment_weight_sets TO authenticated;
GRANT ALL ON public.intern_recruitment_weight_sets TO service_role;
ALTER TABLE public.intern_recruitment_weight_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY weight_sets_read ON public.intern_recruitment_weight_sets FOR SELECT TO authenticated USING (true);
CREATE POLICY weight_sets_write ON public.intern_recruitment_weight_sets FOR ALL TO authenticated
  USING (public.intern_recruitment_authority(auth.uid())) WITH CHECK (public.intern_recruitment_authority(auth.uid()));

INSERT INTO public.intern_recruitment_weight_sets (vacancy_id, version, weights)
SELECT NULL, 1, '{"academic_relevance":15,"curriculum_relevance":15,"skills":10,"evidence":15,"assessment":20,"learning_agility":10,"communication":5,"problem_solving":5,"interview":5}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.intern_recruitment_weight_sets WHERE vacancy_id IS NULL AND version = 1);

CREATE TABLE IF NOT EXISTS public.intern_academic_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  candidate_id uuid REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  qualification_level text NOT NULL,
  programme text NOT NULL,
  institution text NOT NULL,
  institution_type text,
  specialisation text,
  curriculum_version text,
  curriculum_source_id uuid REFERENCES public.intern_curriculum_sources(id) ON DELETE SET NULL,
  year_of_study integer,
  semester integer,
  academic_stage text,
  relevant_courses text[] NOT NULL DEFAULT '{}',
  attachment_done boolean NOT NULL DEFAULT false,
  attachment_detail text,
  projects text[] NOT NULL DEFAULT '{}',
  skills text[] NOT NULL DEFAULT '{}',
  portfolio_url text,
  work_experience text,
  learning_objectives text[] NOT NULL DEFAULT '{}',
  expected_outcomes text[] NOT NULL DEFAULT '{}',
  validated_by uuid,
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.intern_academic_profiles TO authenticated;
GRANT ALL ON public.intern_academic_profiles TO service_role;
ALTER TABLE public.intern_academic_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY academic_profiles_read ON public.intern_academic_profiles FOR SELECT TO authenticated
  USING (public.intern_recruitment_authority(auth.uid())
      OR EXISTS (SELECT 1 FROM public.rec_candidates c WHERE c.id = candidate_id AND c.user_id = auth.uid()));
CREATE POLICY academic_profiles_write ON public.intern_academic_profiles FOR ALL TO authenticated
  USING (public.intern_recruitment_authority(auth.uid())) WITH CHECK (public.intern_recruitment_authority(auth.uid()));

CREATE TABLE IF NOT EXISTS public.intern_candidate_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  competency text NOT NULL,
  evidence_kind text NOT NULL,
  where_learned text,
  where_applied text,
  produced text,
  evidence_url text,
  classification text NOT NULL DEFAULT 'CLAIMED',
  reviewed_by uuid,
  reviewed_at timestamptz,
  verified_by uuid,
  verified_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_classification_ck
    CHECK (classification IN ('CLAIMED','UPLOADED','REVIEWED','ASSESSED','VERIFIED'))
);
GRANT SELECT, INSERT, UPDATE ON public.intern_candidate_evidence TO authenticated;
GRANT ALL ON public.intern_candidate_evidence TO service_role;
ALTER TABLE public.intern_candidate_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY candidate_evidence_read ON public.intern_candidate_evidence FOR SELECT TO authenticated
  USING (public.intern_recruitment_authority(auth.uid()));
CREATE POLICY candidate_evidence_write ON public.intern_candidate_evidence FOR ALL TO authenticated
  USING (public.intern_recruitment_authority(auth.uid())) WITH CHECK (public.intern_recruitment_authority(auth.uid()));

CREATE TABLE IF NOT EXISTS public.intern_recruitment_pipeline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  candidate_id uuid REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  vacancy_id uuid REFERENCES public.rec_vacancies(id) ON DELETE SET NULL,
  programme_id uuid REFERENCES public.intern_programmes(id) ON DELETE SET NULL,
  cohort_id uuid REFERENCES public.intern_cohorts(id) ON DELETE SET NULL,
  primary_track_id uuid REFERENCES public.intern_tracks(id) ON DELETE SET NULL,
  secondary_track_id uuid REFERENCES public.intern_tracks(id) ON DELETE SET NULL,
  development_track_id uuid REFERENCES public.intern_tracks(id) ON DELETE SET NULL,
  intern_id uuid REFERENCES public.intern_profiles(id) ON DELETE SET NULL,
  stage public.intern_pipeline_stage NOT NULL DEFAULT 'APPLICATION_RECEIVED',
  stage_entered_at timestamptz NOT NULL DEFAULT now(),
  last_action_at timestamptz NOT NULL DEFAULT now(),
  sla_target_hours integer NOT NULL DEFAULT 72,
  eligibility_status text NOT NULL DEFAULT 'REVIEW_REQUIRED',
  eligibility_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  curriculum_score numeric,
  evidence_score numeric,
  assessment_score numeric,
  interview_score numeric,
  match_score numeric,
  score_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  scoring_weight_set_id uuid REFERENCES public.intern_recruitment_weight_sets(id) ON DELETE SET NULL,
  screening_recommendation text,
  selection_decision text,
  selection_reason text,
  decided_by uuid,
  decided_at timestamptz,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  owner_staff_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  CONSTRAINT pipeline_eligibility_ck CHECK (eligibility_status IN
    ('ELIGIBLE','CONDITIONALLY_ELIGIBLE','INELIGIBLE','REVIEW_REQUIRED')),
  CONSTRAINT pipeline_screening_ck CHECK (screening_recommendation IS NULL OR screening_recommendation IN
    ('ADVANCE','REVIEW','HOLD','REJECT'))
);
CREATE INDEX IF NOT EXISTS intern_pipeline_stage_idx ON public.intern_recruitment_pipeline(stage);
GRANT SELECT, INSERT, UPDATE ON public.intern_recruitment_pipeline TO authenticated;
GRANT ALL ON public.intern_recruitment_pipeline TO service_role;
ALTER TABLE public.intern_recruitment_pipeline ENABLE ROW LEVEL SECURITY;
CREATE POLICY pipeline_read ON public.intern_recruitment_pipeline FOR SELECT TO authenticated
  USING (public.intern_recruitment_authority(auth.uid())
      OR EXISTS (SELECT 1 FROM public.rec_candidates c WHERE c.id = candidate_id AND c.user_id = auth.uid()));
CREATE POLICY pipeline_write ON public.intern_recruitment_pipeline FOR ALL TO authenticated
  USING (public.intern_recruitment_authority(auth.uid())) WITH CHECK (public.intern_recruitment_authority(auth.uid()));

CREATE TABLE IF NOT EXISTS public.intern_recruitment_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES public.intern_recruitment_pipeline(id) ON DELETE CASCADE,
  from_stage public.intern_pipeline_stage,
  to_stage public.intern_pipeline_stage NOT NULL,
  actor_id uuid,
  actor_email text,
  reason text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pipeline_id, idempotency_key)
);
GRANT SELECT, INSERT ON public.intern_recruitment_transitions TO authenticated;
GRANT ALL ON public.intern_recruitment_transitions TO service_role;
ALTER TABLE public.intern_recruitment_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY transitions_read ON public.intern_recruitment_transitions FOR SELECT TO authenticated
  USING (public.intern_recruitment_authority(auth.uid()));
CREATE POLICY transitions_insert ON public.intern_recruitment_transitions FOR INSERT TO authenticated
  WITH CHECK (public.intern_recruitment_authority(auth.uid()));

CREATE OR REPLACE FUNCTION public._intern_transitions_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN RAISE EXCEPTION 'intern_recruitment_transitions is append-only.'; END; $$;
DROP TRIGGER IF EXISTS intern_transitions_immutable ON public.intern_recruitment_transitions;
CREATE TRIGGER intern_transitions_immutable BEFORE UPDATE OR DELETE
  ON public.intern_recruitment_transitions FOR EACH ROW
  EXECUTE FUNCTION public._intern_transitions_immutable();