
-- ============================================================
-- RECRUITMENT 360 — data foundation
-- ============================================================

CREATE OR REPLACE FUNCTION public.rec_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Internal recruitment actor: any resolved staff-portal member.
CREATE OR REPLACE FUNCTION public.rec_can_read()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_staff_member() OR public.is_platform_admin();
$$;

CREATE OR REPLACE FUNCTION public.rec_can_write()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_staff_member() OR public.is_platform_admin();
$$;

-- ---------- Requisitions -------------------------------------
CREATE TABLE public.rec_requisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_no text NOT NULL UNIQUE,
  title text NOT NULL,
  unit_id uuid REFERENCES public.org_units(id) ON DELETE SET NULL,
  position_id uuid REFERENCES public.org_positions(id) ON DELETE SET NULL,
  requested_by_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  hiring_manager_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  headcount integer NOT NULL DEFAULT 1 CHECK (headcount > 0),
  is_replacement boolean NOT NULL DEFAULT false,
  employment_type text NOT NULL DEFAULT 'permanent',
  location text,
  justification text,
  budget_min_cents bigint,
  budget_max_cents bigint,
  currency text NOT NULL DEFAULT 'KES',
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  target_hire_date date,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','department_review','budget_review','approval','approved','recruitment_open','closed','cancelled')),
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid,
  decision_notes text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_requisitions TO authenticated;
GRANT ALL ON public.rec_requisitions TO service_role;
ALTER TABLE public.rec_requisitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec staff read requisitions" ON public.rec_requisitions FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec staff write requisitions" ON public.rec_requisitions FOR INSERT TO authenticated WITH CHECK (public.rec_can_write());
CREATE POLICY "rec staff update requisitions" ON public.rec_requisitions FOR UPDATE TO authenticated USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());
CREATE POLICY "rec admin delete requisitions" ON public.rec_requisitions FOR DELETE TO authenticated USING (public.is_platform_admin());
CREATE TRIGGER trg_rec_requisitions_touch BEFORE UPDATE ON public.rec_requisitions FOR EACH ROW EXECUTE FUNCTION public.rec_touch_updated_at();

-- ---------- Vacancies ----------------------------------------
CREATE TABLE public.rec_vacancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_no text NOT NULL UNIQUE,
  requisition_id uuid REFERENCES public.rec_requisitions(id) ON DELETE SET NULL,
  title text NOT NULL,
  blueprint_key text,
  unit_id uuid REFERENCES public.org_units(id) ON DELETE SET NULL,
  position_id uuid REFERENCES public.org_positions(id) ON DELETE SET NULL,
  hiring_manager_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  recruiter_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  employment_type text NOT NULL DEFAULT 'permanent',
  work_arrangement text NOT NULL DEFAULT 'onsite' CHECK (work_arrangement IN ('onsite','hybrid','remote','field')),
  location text,
  headcount integer NOT NULL DEFAULT 1 CHECK (headcount > 0),
  is_replacement boolean NOT NULL DEFAULT false,
  salary_min_cents bigint,
  salary_max_cents bigint,
  currency text NOT NULL DEFAULT 'KES',
  required_skills text[] NOT NULL DEFAULT '{}',
  preferred_skills text[] NOT NULL DEFAULT '{}',
  qualifications text[] NOT NULL DEFAULT '{}',
  competencies text[] NOT NULL DEFAULT '{}',
  min_years_experience numeric,
  responsibilities text[] NOT NULL DEFAULT '{}',
  kpis text[] NOT NULL DEFAULT '{}',
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  target_hire_date date,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  sla_days integer NOT NULL DEFAULT 30,
  approval_status text NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('pending','approved','rejected')),
  publication_status text NOT NULL DEFAULT 'draft' CHECK (publication_status IN ('draft','published','paused','closed','archived')),
  published_at timestamptz,
  channels text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','on_hold','filled','closed','cancelled')),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_vacancies TO authenticated;
GRANT SELECT ON public.rec_vacancies TO anon;
GRANT ALL ON public.rec_vacancies TO service_role;
ALTER TABLE public.rec_vacancies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec public read published vacancies" ON public.rec_vacancies FOR SELECT TO anon, authenticated
  USING (publication_status = 'published' AND status = 'open');
CREATE POLICY "rec staff read vacancies" ON public.rec_vacancies FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec staff insert vacancies" ON public.rec_vacancies FOR INSERT TO authenticated WITH CHECK (public.rec_can_write());
CREATE POLICY "rec staff update vacancies" ON public.rec_vacancies FOR UPDATE TO authenticated USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());
CREATE POLICY "rec admin delete vacancies" ON public.rec_vacancies FOR DELETE TO authenticated USING (public.is_platform_admin());
CREATE TRIGGER trg_rec_vacancies_touch BEFORE UPDATE ON public.rec_vacancies FOR EACH ROW EXECUTE FUNCTION public.rec_touch_updated_at();
CREATE INDEX idx_rec_vacancies_status ON public.rec_vacancies(status, publication_status);
CREATE INDEX idx_rec_vacancies_unit ON public.rec_vacancies(unit_id);

-- ---------- Job descriptions ---------------------------------
CREATE TABLE public.rec_job_descriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id uuid NOT NULL REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  summary text,
  body text NOT NULL DEFAULT '',
  responsibilities text[] NOT NULL DEFAULT '{}',
  requirements text[] NOT NULL DEFAULT '{}',
  benefits text[] NOT NULL DEFAULT '{}',
  origin text NOT NULL DEFAULT 'human' CHECK (origin IN ('human','ai_draft','blueprint','template')),
  ai_model text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','published','archived')),
  approved_by uuid,
  approved_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vacancy_id, version)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_job_descriptions TO authenticated;
GRANT SELECT ON public.rec_job_descriptions TO anon;
GRANT ALL ON public.rec_job_descriptions TO service_role;
ALTER TABLE public.rec_job_descriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec public read published jd" ON public.rec_job_descriptions FOR SELECT TO anon, authenticated
  USING (status = 'published' AND EXISTS (SELECT 1 FROM public.rec_vacancies v WHERE v.id = vacancy_id AND v.publication_status = 'published'));
CREATE POLICY "rec staff read jd" ON public.rec_job_descriptions FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec staff insert jd" ON public.rec_job_descriptions FOR INSERT TO authenticated WITH CHECK (public.rec_can_write());
CREATE POLICY "rec staff update jd" ON public.rec_job_descriptions FOR UPDATE TO authenticated USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());
CREATE POLICY "rec admin delete jd" ON public.rec_job_descriptions FOR DELETE TO authenticated USING (public.is_platform_admin());
CREATE TRIGGER trg_rec_jd_touch BEFORE UPDATE ON public.rec_job_descriptions FOR EACH ROW EXECUTE FUNCTION public.rec_touch_updated_at();

-- ---------- Candidates ---------------------------------------
CREATE TABLE public.rec_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_no text NOT NULL UNIQUE,
  full_name text NOT NULL,
  email text,
  phone text,
  location text,
  headline text,
  summary text,
  linkedin_url text,
  portfolio_url text,
  years_experience numeric,
  current_employer text,
  current_title text,
  source text NOT NULL DEFAULT 'careers_site',
  owner_recruiter_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  engagement_status text NOT NULL DEFAULT 'active' CHECK (engagement_status IN ('active','passive','unresponsive','withdrawn','hired','blocked')),
  consent_given boolean NOT NULL DEFAULT false,
  consent_at timestamptz,
  record_state text NOT NULL DEFAULT 'active' CHECK (record_state IN ('active','archived','locked','redacted')),
  last_contact_at timestamptz,
  next_action text,
  next_action_due date,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_candidates TO authenticated;
GRANT ALL ON public.rec_candidates TO service_role;
ALTER TABLE public.rec_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec staff read candidates" ON public.rec_candidates FOR SELECT TO authenticated USING (public.rec_can_read() OR user_id = auth.uid());
CREATE POLICY "rec staff insert candidates" ON public.rec_candidates FOR INSERT TO authenticated WITH CHECK (public.rec_can_write());
CREATE POLICY "rec staff update candidates" ON public.rec_candidates FOR UPDATE TO authenticated USING (public.rec_can_write() AND record_state <> 'locked') WITH CHECK (public.rec_can_write());
CREATE POLICY "rec admin manage candidates" ON public.rec_candidates FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE TRIGGER trg_rec_candidates_touch BEFORE UPDATE ON public.rec_candidates FOR EACH ROW EXECUTE FUNCTION public.rec_touch_updated_at();
CREATE INDEX idx_rec_candidates_email ON public.rec_candidates(lower(email));

CREATE TABLE public.rec_candidate_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  skill text NOT NULL,
  proficiency text CHECK (proficiency IN ('basic','intermediate','advanced','expert')),
  years numeric,
  evidence text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.rec_candidate_experience (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  employer text NOT NULL,
  title text NOT NULL,
  start_date date,
  end_date date,
  is_current boolean NOT NULL DEFAULT false,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.rec_candidate_qualifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  qualification text NOT NULL,
  institution text,
  award_year integer,
  kind text NOT NULL DEFAULT 'education' CHECK (kind IN ('education','certification','licence','language')),
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.rec_candidate_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  application_id uuid,
  doc_type text NOT NULL DEFAULT 'cv' CHECK (doc_type IN ('cv','cover_letter','certificate','identification','offer_letter','contract','onboarding','other')),
  file_name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  crm_document_id uuid REFERENCES public.crm_documents(id) ON DELETE SET NULL,
  uploaded_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Applications -------------------------------------
CREATE TABLE public.rec_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_no text NOT NULL UNIQUE,
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  vacancy_id uuid NOT NULL REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'careers_site',
  applied_at timestamptz NOT NULL DEFAULT now(),
  cover_letter text,
  stage text NOT NULL DEFAULT 'applied'
    CHECK (stage IN ('applied','received','screening','shortlisted','interview','evaluation','offer','accepted','onboarding','hired','rejected','withdrawn','talent_pool')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_hold','closed')),
  score numeric,
  ai_match_score numeric,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  recruiter_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  hiring_manager_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  next_action text,
  next_action_due date,
  stage_entered_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, vacancy_id)
);
CREATE INDEX idx_rec_applications_stage ON public.rec_applications(stage, vacancy_id);

-- ---------- Screening ----------------------------------------
CREATE TABLE public.rec_screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  knockout_failed boolean NOT NULL DEFAULT false,
  ai_score numeric,
  ai_recommendation text CHECK (ai_recommendation IN ('advance','review','reject')),
  ai_rationale text,
  ai_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  human_score numeric,
  human_decision text CHECK (human_decision IN ('advance','reject','hold')),
  human_decision_by uuid,
  human_decision_at timestamptz,
  decision_notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Shortlisting -------------------------------------
CREATE TABLE public.rec_shortlist_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id uuid NOT NULL REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  rank integer,
  reviewer_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  reason text,
  decision text NOT NULL DEFAULT 'shortlisted' CHECK (decision IN ('shortlisted','removed','advanced','second_opinion')),
  added_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vacancy_id, application_id)
);

-- ---------- Interviews ---------------------------------------
CREATE TABLE public.rec_interviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  vacancy_id uuid NOT NULL REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  interview_stage text NOT NULL DEFAULT 'first' CHECK (interview_stage IN ('screening_call','first','technical','panel','final','other')),
  interview_type text NOT NULL DEFAULT 'competency',
  mode text NOT NULL DEFAULT 'virtual' CHECK (mode IN ('virtual','onsite','phone')),
  scheduled_at timestamptz,
  duration_minutes integer NOT NULL DEFAULT 45,
  location text,
  meeting_link text,
  instructions text,
  objectives text[] NOT NULL DEFAULT '{}',
  suggested_questions text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('draft','scheduled','rescheduled','completed','cancelled','no_show')),
  feedback_due_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.rec_interview_panel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id uuid NOT NULL REFERENCES public.rec_interviews(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  panel_role text NOT NULL DEFAULT 'interviewer' CHECK (panel_role IN ('lead','interviewer','observer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (interview_id, staff_id)
);

-- ---------- Evaluations --------------------------------------
CREATE TABLE public.rec_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id uuid NOT NULL REFERENCES public.rec_interviews(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  evaluator_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  criteria_scores jsonb NOT NULL DEFAULT '[]'::jsonb,
  overall_score numeric,
  recommendation text CHECK (recommendation IN ('strong_advance','advance','hold','reject','strong_reject')),
  strengths text,
  concerns text,
  evidence text,
  comments text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','submitted','reviewed')),
  submitted_at timestamptz,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (interview_id, evaluator_staff_id)
);

-- ---------- Offers -------------------------------------------
CREATE TABLE public.rec_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_no text NOT NULL UNIQUE,
  application_id uuid NOT NULL REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  vacancy_id uuid NOT NULL REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  base_salary_cents bigint,
  currency text NOT NULL DEFAULT 'KES',
  allowances_cents bigint,
  benefits text[] NOT NULL DEFAULT '{}',
  employment_type text NOT NULL DEFAULT 'permanent',
  terms text,
  start_date date,
  expiry_date date,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approval','approved','sent','viewed','accepted','declined','withdrawn','expired','closed')),
  sent_at timestamptz,
  viewed_at timestamptz,
  responded_at timestamptz,
  decline_reason text,
  document_path text,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.rec_offer_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.rec_offers(id) ON DELETE CASCADE,
  step_order integer NOT NULL DEFAULT 1,
  approver_role text NOT NULL,
  approver_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  decision text NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','approved','rejected','skipped')),
  decided_by uuid,
  decided_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offer_id, step_order)
);

-- ---------- Onboarding ---------------------------------------
CREATE TABLE public.rec_onboarding_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_no text NOT NULL UNIQUE,
  offer_id uuid NOT NULL REFERENCES public.rec_offers(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  vacancy_id uuid REFERENCES public.rec_vacancies(id) ON DELETE SET NULL,
  staff_member_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  start_date date,
  unit_id uuid REFERENCES public.org_units(id) ON DELETE SET NULL,
  manager_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'preboarding' CHECK (status IN ('preboarding','in_progress','blocked','completed','cancelled')),
  handover_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offer_id)
);
CREATE TABLE public.rec_onboarding_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.rec_onboarding_cases(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'general' CHECK (category IN ('general','documents','compliance','equipment','access','orientation','training')),
  owner_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  due_date date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','blocked','waived')),
  completed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Talent pool --------------------------------------
CREATE TABLE public.rec_talent_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  tags text[] NOT NULL DEFAULT '{}',
  potential_roles text[] NOT NULL DEFAULT '{}',
  availability text,
  desired_location text,
  desired_salary_cents bigint,
  rating numeric,
  entry_reason text NOT NULL DEFAULT 'not_selected',
  added_by uuid DEFAULT auth.uid(),
  last_engaged_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','nurturing','placed','archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id)
);

-- ---------- Communications & templates -----------------------
CREATE TABLE public.rec_communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email','sms','in_app','call','note','system')),
  direction text NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound','inbound','internal')),
  subject text,
  body text,
  template_key text,
  status text NOT NULL DEFAULT 'logged' CHECK (status IN ('draft','queued','sent','delivered','failed','logged')),
  sent_at timestamptz,
  actor_id uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.rec_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('job_description','email','interview_invite','rejection','offer','onboarding','notification')),
  subject text,
  body text NOT NULL DEFAULT '',
  variables text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Configuration ------------------------------------
CREATE TABLE public.rec_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text NOT NULL UNIQUE,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.rec_sla_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sla_key text NOT NULL UNIQUE,
  label text NOT NULL,
  target_hours integer NOT NULL,
  applies_to text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.rec_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_key text NOT NULL UNIQUE,
  name text NOT NULL,
  trigger_event text NOT NULL,
  conditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- AI governance ------------------------------------
CREATE TABLE public.rec_ai_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL CHECK (subject_type IN ('vacancy','application','candidate','interview','offer','pipeline')),
  subject_id uuid,
  kind text NOT NULL,
  recommendation text NOT NULL,
  rationale text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric,
  model text,
  human_decision text CHECK (human_decision IN ('accepted','overridden','rejected','review_requested')),
  human_decision_by uuid,
  human_decision_at timestamptz,
  override_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Audit trail (append-only) ------------------------
CREATE TABLE public.rec_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid DEFAULT auth.uid(),
  actor_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  action text NOT NULL,
  object_type text NOT NULL,
  object_id uuid,
  previous_state jsonb,
  new_state jsonb,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'staff_portal',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.rec_audit_events TO authenticated;
GRANT ALL ON public.rec_audit_events TO service_role;
ALTER TABLE public.rec_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec staff read audit" ON public.rec_audit_events FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec staff append audit" ON public.rec_audit_events FOR INSERT TO authenticated WITH CHECK (public.rec_can_write());
CREATE INDEX idx_rec_audit_object ON public.rec_audit_events(object_type, object_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.rec_block_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'rec_audit_events is append-only'; END; $$;
CREATE TRIGGER trg_rec_audit_immutable BEFORE UPDATE OR DELETE ON public.rec_audit_events
FOR EACH ROW EXECUTE FUNCTION public.rec_block_audit_mutation();

-- ---------- Shared grants / RLS / triggers for remaining tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'rec_candidate_skills','rec_candidate_experience','rec_candidate_qualifications','rec_candidate_documents',
    'rec_applications','rec_screenings','rec_shortlist_entries','rec_interviews','rec_interview_panel',
    'rec_evaluations','rec_offers','rec_offer_approvals','rec_onboarding_cases','rec_onboarding_tasks',
    'rec_talent_pool','rec_communications','rec_templates','rec_settings','rec_sla_policies','rec_workflows',
    'rec_ai_recommendations'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "rec staff read %1$s" ON public.%1$I FOR SELECT TO authenticated USING (public.rec_can_read())', t);
    EXECUTE format('CREATE POLICY "rec staff insert %1$s" ON public.%1$I FOR INSERT TO authenticated WITH CHECK (public.rec_can_write())', t);
    EXECUTE format('CREATE POLICY "rec staff update %1$s" ON public.%1$I FOR UPDATE TO authenticated USING (public.rec_can_write()) WITH CHECK (public.rec_can_write())', t);
    EXECUTE format('CREATE POLICY "rec admin delete %1$s" ON public.%1$I FOR DELETE TO authenticated USING (public.is_platform_admin())', t);
    EXECUTE format('CREATE TRIGGER trg_%1$s_touch BEFORE UPDATE ON public.%1$I FOR EACH ROW EXECUTE FUNCTION public.rec_touch_updated_at()', t);
  END LOOP;
END $$;

-- Administrative settings tables stay admin-writable only.
DROP POLICY "rec staff insert rec_settings" ON public.rec_settings;
DROP POLICY "rec staff update rec_settings" ON public.rec_settings;
CREATE POLICY "rec admin manage settings" ON public.rec_settings FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
DROP POLICY "rec staff insert rec_sla_policies" ON public.rec_sla_policies;
DROP POLICY "rec staff update rec_sla_policies" ON public.rec_sla_policies;
CREATE POLICY "rec admin manage slas" ON public.rec_sla_policies FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
DROP POLICY "rec staff insert rec_workflows" ON public.rec_workflows;
DROP POLICY "rec staff update rec_workflows" ON public.rec_workflows;
CREATE POLICY "rec admin manage workflows" ON public.rec_workflows FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

ALTER TABLE public.rec_candidate_documents
  ADD CONSTRAINT rec_candidate_documents_application_fk
  FOREIGN KEY (application_id) REFERENCES public.rec_applications(id) ON DELETE SET NULL;
