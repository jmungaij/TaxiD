-- ============================================================================
-- Recruitment 360 — Selection Intelligence Spine
-- Extends the existing rec_* ATS + ops event backbone. No new event engine,
-- no new task engine, no new candidate/employee master.
-- ============================================================================

-- ---------------------------------------------------------------- authority --
CREATE OR REPLACE FUNCTION public.rec_is_recruiter()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_staff_member() OR public.is_platform_admin();
$$;

-- Final employment authority is deliberately narrower than recruiter access.
CREATE OR REPLACE FUNCTION public.rec_is_hiring_authority()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'super_admin')
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'operations_admin');
$$;

-- --------------------------------------------------------------- scorecards --
CREATE TABLE public.rec_scorecards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id uuid NOT NULL REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft',
  notes text,
  created_by uuid,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_scorecards_status_ck CHECK (status IN ('draft','active','archived')),
  CONSTRAINT rec_scorecards_version_uk UNIQUE (vacancy_id, version)
);
GRANT SELECT, INSERT, UPDATE ON public.rec_scorecards TO authenticated;
GRANT ALL ON public.rec_scorecards TO service_role;
ALTER TABLE public.rec_scorecards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Recruitment staff read scorecards" ON public.rec_scorecards
  FOR SELECT TO authenticated USING (public.rec_is_recruiter());
CREATE POLICY "Recruitment staff write scorecards" ON public.rec_scorecards
  FOR ALL TO authenticated USING (public.rec_is_recruiter()) WITH CHECK (public.rec_is_recruiter());

CREATE UNIQUE INDEX rec_scorecards_one_active ON public.rec_scorecards (vacancy_id)
  WHERE status = 'active';

CREATE TABLE public.rec_scorecard_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scorecard_id uuid NOT NULL REFERENCES public.rec_scorecards(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  criterion_type text NOT NULL,
  weight integer NOT NULL DEFAULT 0,
  min_threshold numeric,
  evidence_source text NOT NULL DEFAULT 'cv',
  scoring_method text NOT NULL DEFAULT 'threshold',
  guidance text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_criteria_type_ck CHECK (criterion_type IN ('hard_gate','scored','preferred','evidence')),
  CONSTRAINT rec_criteria_method_ck CHECK (scoring_method IN ('threshold','presence','ratio','manual')),
  CONSTRAINT rec_criteria_weight_ck CHECK (weight >= 0 AND weight <= 100),
  CONSTRAINT rec_criteria_code_uk UNIQUE (scorecard_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_scorecard_criteria TO authenticated;
GRANT ALL ON public.rec_scorecard_criteria TO service_role;
ALTER TABLE public.rec_scorecard_criteria ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Recruitment staff manage criteria" ON public.rec_scorecard_criteria
  FOR ALL TO authenticated USING (public.rec_is_recruiter()) WITH CHECK (public.rec_is_recruiter());

-- --------------------------------------------------- evidence w/ provenance --
CREATE TABLE public.rec_evidence_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  attribute text NOT NULL,
  value_text text,
  value_numeric numeric,
  source_kind text NOT NULL,
  source_ref text NOT NULL,
  source_locator text,
  confidence numeric NOT NULL,
  extracted_by text NOT NULL DEFAULT 'system',
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_evidence_source_ck CHECK (source_kind IN ('cv','document','form','assessment','interview','reference','manual')),
  CONSTRAINT rec_evidence_conf_ck CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT rec_evidence_value_ck CHECK (value_text IS NOT NULL OR value_numeric IS NOT NULL)
);
GRANT SELECT, INSERT, UPDATE ON public.rec_evidence_facts TO authenticated;
GRANT ALL ON public.rec_evidence_facts TO service_role;
ALTER TABLE public.rec_evidence_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Recruitment staff manage evidence" ON public.rec_evidence_facts
  FOR ALL TO authenticated USING (public.rec_is_recruiter()) WITH CHECK (public.rec_is_recruiter());
CREATE INDEX rec_evidence_app_attr_idx ON public.rec_evidence_facts (application_id, attribute);
CREATE INDEX rec_evidence_candidate_idx ON public.rec_evidence_facts (candidate_id, attribute);

-- ------------------------------------------------ append-only  evaluations --
CREATE TABLE public.rec_application_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  vacancy_id uuid NOT NULL REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  scorecard_id uuid NOT NULL REFERENCES public.rec_scorecards(id),
  scorecard_version integer NOT NULL,
  eligibility text NOT NULL,
  weighted_score numeric NOT NULL DEFAULT 0,
  max_score numeric NOT NULL DEFAULT 0,
  criterion_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  gate_failures text[] NOT NULL DEFAULT '{}',
  missing_evidence text[] NOT NULL DEFAULT '{}',
  recommendation text NOT NULL,
  confidence numeric,
  engine text NOT NULL DEFAULT 'rec_evaluate_application/v1',
  computed_by uuid,
  computed_at timestamptz NOT NULL DEFAULT now(),
  is_current boolean NOT NULL DEFAULT true,
  CONSTRAINT rec_eval_eligibility_ck CHECK (eligibility IN ('eligible','not_eligible','requires_review')),
  CONSTRAINT rec_eval_reco_ck CHECK (recommendation IN ('advance','review','do_not_advance'))
);
GRANT SELECT, INSERT ON public.rec_application_evaluations TO authenticated;
GRANT ALL ON public.rec_application_evaluations TO service_role;
ALTER TABLE public.rec_application_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Recruitment staff read evaluations" ON public.rec_application_evaluations
  FOR SELECT TO authenticated USING (public.rec_is_recruiter());
CREATE POLICY "Recruitment staff insert evaluations" ON public.rec_application_evaluations
  FOR INSERT TO authenticated WITH CHECK (public.rec_is_recruiter());
CREATE INDEX rec_eval_current_idx ON public.rec_application_evaluations (vacancy_id, is_current, weighted_score DESC);
CREATE UNIQUE INDEX rec_eval_one_current ON public.rec_application_evaluations (application_id) WHERE is_current;

CREATE OR REPLACE FUNCTION public.rec_block_evaluation_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Superseding an evaluation flips is_current only; nothing else may change,
  -- and nothing may ever be deleted. Scores must stay reproducible.
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'rec_application_evaluations is append-only';
  END IF;
  IF NEW.weighted_score IS DISTINCT FROM OLD.weighted_score
     OR NEW.criterion_results IS DISTINCT FROM OLD.criterion_results
     OR NEW.eligibility IS DISTINCT FROM OLD.eligibility
     OR NEW.recommendation IS DISTINCT FROM OLD.recommendation
     OR NEW.application_id IS DISTINCT FROM OLD.application_id THEN
    RAISE EXCEPTION 'evaluation records are immutable; compute a new evaluation instead';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rec_eval_immutable
  BEFORE UPDATE OR DELETE ON public.rec_application_evaluations
  FOR EACH ROW EXECUTE FUNCTION public.rec_block_evaluation_mutation();

-- ------------------------------------------------- rejection reason catalogue --
CREATE TABLE public.rec_rejection_reasons (
  code text PRIMARY KEY,
  label text NOT NULL,
  category text NOT NULL,
  template_key text,
  requires_approval boolean NOT NULL DEFAULT false,
  exposes_comparative boolean NOT NULL DEFAULT false,
  candidate_message text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rec_rejection_reasons TO authenticated;
GRANT ALL ON public.rec_rejection_reasons TO service_role;
ALTER TABLE public.rec_rejection_reasons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read reason codes" ON public.rec_rejection_reasons
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.rec_rejection_reasons (code, label, category, template_key, candidate_message, sort_order) VALUES
 ('qualification_not_met','Essential qualification not met','eligibility','rejection_qualification',
  'After reviewing your application against the essential requirements for the role, we will not be progressing your application at this stage.',10),
 ('experience_not_demonstrated','Required experience not demonstrated','eligibility','rejection_experience',
  'Your application demonstrated relevant experience; however, the role requires a level of directly relevant experience that was not sufficiently demonstrated in this application.',20),
 ('certification_missing','Mandatory certification or licence absent','eligibility','rejection_qualification',
  'The role requires a mandatory certification that was not evidenced in your application.',30),
 ('assessment_threshold','Assessment threshold not met','assessment','rejection_assessment',
  'Following the role assessment, your result did not meet the threshold required for this position.',40),
 ('interview_outcome','Interview outcome','interview','rejection_interview',
  'Thank you for attending the interview. On this occasion we will not be progressing your application further.',50),
 ('competitive_field','Stronger competitive field','selection','rejection_competitive',
  'We received a strong field of applications and have decided to progress candidates whose experience more closely matches the current requirements of the role.',60),
 ('incomplete_application','Incomplete application','validation','rejection_incomplete',
  'Your application could not be assessed because required information or documents were missing.',70),
 ('duplicate_application','Duplicate application','validation',NULL,NULL,80),
 ('vacancy_closed','Vacancy closed or withdrawn','administrative','rejection_vacancy_closed',
  'This vacancy has now closed and we are not progressing applications further.',90),
 ('candidate_withdrew','Candidate withdrew','administrative',NULL,NULL,100),
 ('other_authorized','Other authorised reason','administrative','rejection_generic',
  'Following review of your application, we will not be progressing your application at this stage.',110);

UPDATE public.rec_rejection_reasons SET exposes_comparative = true WHERE code = 'competitive_field';

-- --------------------------------------------- immutable selection decisions --
CREATE TABLE public.rec_selection_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  vacancy_id uuid NOT NULL REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  decision text NOT NULL,
  stage_at_decision text NOT NULL,
  ai_recommendation text,
  ai_confidence numeric,
  is_override boolean NOT NULL DEFAULT false,
  reason_code text REFERENCES public.rec_rejection_reasons(code),
  reason_notes text,
  evaluation_id uuid REFERENCES public.rec_application_evaluations(id),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision_maker uuid,
  decision_role text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_selection_decision_ck CHECK (decision IN ('advance','not_selected','selected','hold'))
);
GRANT SELECT, INSERT ON public.rec_selection_decisions TO authenticated;
GRANT ALL ON public.rec_selection_decisions TO service_role;
ALTER TABLE public.rec_selection_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Recruitment staff read decisions" ON public.rec_selection_decisions
  FOR SELECT TO authenticated USING (public.rec_is_recruiter());
CREATE POLICY "Recruitment staff insert decisions" ON public.rec_selection_decisions
  FOR INSERT TO authenticated WITH CHECK (public.rec_is_recruiter());
CREATE INDEX rec_selection_app_idx ON public.rec_selection_decisions (application_id, decided_at DESC);

CREATE OR REPLACE FUNCTION public.rec_block_decision_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'rec_selection_decisions is immutable';
END;
$$;
CREATE TRIGGER rec_decision_immutable
  BEFORE UPDATE OR DELETE ON public.rec_selection_decisions
  FOR EACH ROW EXECUTE FUNCTION public.rec_block_decision_mutation();

CREATE TRIGGER rec_scorecards_touch BEFORE UPDATE ON public.rec_scorecards
  FOR EACH ROW EXECUTE FUNCTION public.rec_touch_updated_at();