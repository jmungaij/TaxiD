-- =========================================================
-- Recruitment 360 — Evidence-based assessment engine
-- =========================================================

CREATE TABLE IF NOT EXISTS public.rec_question_bank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_key text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  competency_code text NOT NULL,
  competency_label text NOT NULL,
  prompt text NOT NULL,
  scenario text,
  question_type text NOT NULL DEFAULT 'behavioural',
  max_marks numeric NOT NULL CHECK (max_marks > 0),
  probes text[] NOT NULL DEFAULT '{}',
  good_indicators text[] NOT NULL DEFAULT '{}',
  weak_indicators text[] NOT NULL DEFAULT '{}',
  scoring_anchors jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_evidence text,
  role_family text NOT NULL DEFAULT 'general',
  status text NOT NULL DEFAULT 'active',
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_question_bank_version_uk UNIQUE (question_key, version),
  CONSTRAINT rec_question_bank_status_ck CHECK (status IN ('draft','active','retired')),
  CONSTRAINT rec_question_bank_type_ck CHECK (question_type IN (
    'cv_validation','behavioural','situational','role_specific','commercial',
    'operational','productivity','role_play','work_simulation'))
);

CREATE TABLE IF NOT EXISTS public.rec_assessment_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  title text NOT NULL,
  role_family text NOT NULL DEFAULT 'general',
  vacancy_id uuid REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft',
  total_marks numeric NOT NULL DEFAULT 0,
  band_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_by uuid DEFAULT auth.uid(),
  activated_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_assessment_templates_version_uk UNIQUE (template_key, version),
  CONSTRAINT rec_assessment_templates_status_ck CHECK (status IN ('draft','pilot','active','retired'))
);

CREATE TABLE IF NOT EXISTS public.rec_assessment_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.rec_assessment_templates(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.rec_question_bank(id),
  sort_order integer NOT NULL DEFAULT 0,
  max_marks numeric NOT NULL CHECK (max_marks > 0),
  critical_min numeric,
  mandatory boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_template_items_uk UNIQUE (template_id, question_id)
);

CREATE TABLE IF NOT EXISTS public.rec_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id uuid NOT NULL REFERENCES public.rec_interviews(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  vacancy_id uuid NOT NULL REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.rec_assessment_templates(id),
  template_key text NOT NULL,
  template_version integer NOT NULL,
  assessor_user_id uuid NOT NULL DEFAULT auth.uid(),
  assessor_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  assessor_name text,
  status text NOT NULL DEFAULT 'draft',
  total_score numeric,
  max_score numeric NOT NULL DEFAULT 0,
  percentage numeric,
  band text,
  gate_status jsonb NOT NULL DEFAULT '[]'::jsonb,
  gates_passed boolean,
  recommendation text,
  strengths text,
  concerns text,
  risks text,
  submitted_at timestamptz,
  amended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_assessments_assessor_uk UNIQUE (interview_id, assessor_user_id),
  CONSTRAINT rec_assessments_status_ck CHECK (status IN ('draft','submitted','amended')),
  CONSTRAINT rec_assessments_reco_ck CHECK (recommendation IS NULL OR recommendation IN
    ('strong_advance','advance','hold','reject','strong_reject'))
);

CREATE INDEX IF NOT EXISTS rec_assessments_app_idx ON public.rec_assessments (application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rec_assessments_vac_idx ON public.rec_assessments (vacancy_id, status);

CREATE TABLE IF NOT EXISTS public.rec_assessment_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.rec_assessments(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.rec_question_bank(id),
  question_key text NOT NULL,
  question_version integer NOT NULL,
  question_snapshot jsonb NOT NULL,
  competency_code text NOT NULL,
  competency_label text NOT NULL,
  max_marks numeric NOT NULL,
  critical_min numeric,
  mandatory boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  answer_text text,
  evidence_text text,
  verification_status text NOT NULL DEFAULT 'unverified',
  evidence_confidence text NOT NULL DEFAULT 'unverified',
  score numeric,
  rationale text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_answer_uk UNIQUE (assessment_id, question_id),
  CONSTRAINT rec_answer_score_ck CHECK (score IS NULL OR (score >= 0 AND score <= max_marks)),
  CONSTRAINT rec_answer_verif_ck CHECK (verification_status IN
    ('claimed','verified','demonstrated','partially_verified','unverified','contradicted','not_applicable')),
  CONSTRAINT rec_answer_conf_ck CHECK (evidence_confidence IN ('high','medium','low','unverified'))
);

CREATE TABLE IF NOT EXISTS public.rec_assessment_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id uuid NOT NULL REFERENCES public.rec_assessments(id) ON DELETE CASCADE,
  answer_id uuid REFERENCES public.rec_assessment_answers(id) ON DELETE SET NULL,
  before_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_value jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL,
  actor_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rec_cv_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  claim_type text NOT NULL,
  claim_text text NOT NULL,
  source_document text,
  source_reference text,
  extracted_by text NOT NULL DEFAULT 'staff',
  verification_status text NOT NULL DEFAULT 'claimed',
  confidence text NOT NULL DEFAULT 'unverified',
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_cv_claims_verif_ck CHECK (verification_status IN
    ('claimed','verified','demonstrated','partially_verified','unverified','contradicted')),
  CONSTRAINT rec_cv_claims_conf_ck CHECK (confidence IN ('high','medium','low','unverified'))
);

CREATE INDEX IF NOT EXISTS rec_cv_claims_app_idx ON public.rec_cv_claims (application_id, created_at);

CREATE TABLE IF NOT EXISTS public.rec_claim_validations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES public.rec_cv_claims(id) ON DELETE CASCADE,
  assessment_id uuid REFERENCES public.rec_assessments(id) ON DELETE SET NULL,
  question_text text NOT NULL,
  response_text text,
  evidence_text text,
  verification_status text NOT NULL DEFAULT 'unverified',
  confidence text NOT NULL DEFAULT 'unverified',
  validated_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_claim_val_verif_ck CHECK (verification_status IN
    ('claimed','verified','demonstrated','partially_verified','unverified','contradicted','not_applicable')),
  CONSTRAINT rec_claim_val_conf_ck CHECK (confidence IN ('high','medium','low','unverified'))
);

-- ------------------------------------------------------ grants + RLS

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_question_bank TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_assessment_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_assessment_template_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_assessments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_assessment_answers TO authenticated;
GRANT SELECT, INSERT ON public.rec_assessment_amendments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_cv_claims TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_claim_validations TO authenticated;
GRANT ALL ON public.rec_question_bank TO service_role;
GRANT ALL ON public.rec_assessment_templates TO service_role;
GRANT ALL ON public.rec_assessment_template_items TO service_role;
GRANT ALL ON public.rec_assessments TO service_role;
GRANT ALL ON public.rec_assessment_answers TO service_role;
GRANT ALL ON public.rec_assessment_amendments TO service_role;
GRANT ALL ON public.rec_cv_claims TO service_role;
GRANT ALL ON public.rec_claim_validations TO service_role;

ALTER TABLE public.rec_question_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rec_assessment_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rec_assessment_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rec_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rec_assessment_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rec_assessment_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rec_cv_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rec_claim_validations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rec staff read question bank" ON public.rec_question_bank
  FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec authority manage question bank" ON public.rec_question_bank
  FOR ALL TO authenticated USING (public.rec_is_hiring_authority()) WITH CHECK (public.rec_is_hiring_authority());

CREATE POLICY "rec staff read templates" ON public.rec_assessment_templates
  FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec authority manage templates" ON public.rec_assessment_templates
  FOR ALL TO authenticated USING (public.rec_is_hiring_authority()) WITH CHECK (public.rec_is_hiring_authority());

CREATE POLICY "rec staff read template items" ON public.rec_assessment_template_items
  FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec authority manage template items" ON public.rec_assessment_template_items
  FOR ALL TO authenticated USING (public.rec_is_hiring_authority()) WITH CHECK (public.rec_is_hiring_authority());

CREATE POLICY "rec staff read assessments" ON public.rec_assessments
  FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec admin delete assessments" ON public.rec_assessments
  FOR DELETE TO authenticated USING (public.is_platform_admin());

CREATE POLICY "rec staff read assessment answers" ON public.rec_assessment_answers
  FOR SELECT TO authenticated USING (public.rec_can_read());

CREATE POLICY "rec staff read amendments" ON public.rec_assessment_amendments
  FOR SELECT TO authenticated USING (public.rec_can_read());

CREATE POLICY "rec staff read cv claims" ON public.rec_cv_claims
  FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec staff write cv claims" ON public.rec_cv_claims
  FOR ALL TO authenticated USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());

CREATE POLICY "rec staff read claim validations" ON public.rec_claim_validations
  FOR SELECT TO authenticated USING (public.rec_can_read());

-- Amendments are append-only.
CREATE OR REPLACE FUNCTION public.rec_block_amendment_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'assessment amendments are append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_rec_amendments_immutable ON public.rec_assessment_amendments;
CREATE TRIGGER trg_rec_amendments_immutable
  BEFORE UPDATE OR DELETE ON public.rec_assessment_amendments
  FOR EACH ROW EXECUTE FUNCTION public.rec_block_amendment_mutation();

-- Submitted assessments and their answers are immutable outside the governed RPCs.
CREATE OR REPLACE FUNCTION public.rec_assessment_immutability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('rec.assessment_engine', true) = 'on' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'assessments may only be changed through the assessment engine functions';
END;
$$;

DROP TRIGGER IF EXISTS trg_rec_assessments_guard ON public.rec_assessments;
CREATE TRIGGER trg_rec_assessments_guard
  BEFORE INSERT OR UPDATE ON public.rec_assessments
  FOR EACH ROW EXECUTE FUNCTION public.rec_assessment_immutability();

DROP TRIGGER IF EXISTS trg_rec_answers_guard ON public.rec_assessment_answers;
CREATE TRIGGER trg_rec_answers_guard
  BEFORE INSERT OR UPDATE ON public.rec_assessment_answers
  FOR EACH ROW EXECUTE FUNCTION public.rec_assessment_immutability();

DROP TRIGGER IF EXISTS trg_rec_claim_validations_guard ON public.rec_claim_validations;
CREATE TRIGGER trg_rec_claim_validations_guard
  BEFORE UPDATE ON public.rec_claim_validations
  FOR EACH ROW EXECUTE FUNCTION public.rec_assessment_immutability();

DROP TRIGGER IF EXISTS trg_rec_assessments_touch ON public.rec_assessments;
CREATE TRIGGER trg_rec_assessments_touch BEFORE UPDATE ON public.rec_assessments
  FOR EACH ROW EXECUTE FUNCTION public.rec_touch_updated_at();
DROP TRIGGER IF EXISTS trg_rec_templates_touch ON public.rec_assessment_templates;
CREATE TRIGGER trg_rec_templates_touch BEFORE UPDATE ON public.rec_assessment_templates
  FOR EACH ROW EXECUTE FUNCTION public.rec_touch_updated_at();
DROP TRIGGER IF EXISTS trg_rec_cv_claims_touch ON public.rec_cv_claims;
CREATE TRIGGER trg_rec_cv_claims_touch BEFORE UPDATE ON public.rec_cv_claims
  FOR EACH ROW EXECUTE FUNCTION public.rec_touch_updated_at();