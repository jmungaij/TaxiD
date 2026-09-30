CREATE TABLE public.intern_programmes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE TABLE public.intern_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id uuid NOT NULL REFERENCES public.intern_programmes(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  focus text,
  sequence int NOT NULL DEFAULT 0,
  performance_weights jsonb NOT NULL DEFAULT '{"learning":15,"productivity":20,"quality":15,"commercial":25,"operational":15,"conduct":10}'::jsonb,
  matching_weights jsonb NOT NULL DEFAULT '{"academic":15,"skills":15,"capability":20,"communication":10,"learning_agility":10,"problem_solving":10,"commercial":10,"digital":5,"evidence":5}'::jsonb,
  kpis jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.intern_cohorts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id uuid NOT NULL REFERENCES public.intern_programmes(id) ON DELETE CASCADE,
  name text NOT NULL UNIQUE,
  start_date date,
  end_date date,
  duration_weeks int,
  intake_size int,
  status text NOT NULL DEFAULT 'PLANNED'
    CHECK (status IN ('PLANNED','RECRUITING','SELECTION','ONBOARDING','ACTIVE','ASSESSMENT','COMPLETION','CLOSED')),
  supervisor_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  target_outcomes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE TABLE public.intern_learning_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id uuid NOT NULL REFERENCES public.intern_tracks(id) ON DELETE CASCADE,
  code text NOT NULL,
  title text NOT NULL,
  competency text NOT NULL,
  sequence int NOT NULL DEFAULT 0,
  hours numeric(6,2) NOT NULL DEFAULT 2,
  requires_practical boolean NOT NULL DEFAULT true,
  resource_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (track_id, code)
);

CREATE TABLE public.intern_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES public.rec_candidates(id) ON DELETE SET NULL,
  application_id uuid REFERENCES public.rec_applications(id) ON DELETE SET NULL,
  staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  user_id uuid,
  cohort_id uuid REFERENCES public.intern_cohorts(id) ON DELETE SET NULL,
  track_id uuid REFERENCES public.intern_tracks(id) ON DELETE SET NULL,
  secondary_track_ids uuid[] NOT NULL DEFAULT '{}',
  full_name text NOT NULL,
  work_email text,
  institution text,
  programme_of_study text,
  qualification text,
  qualification_level text,
  year_of_study text,
  graduation_date date,
  attachment_requirement text,
  availability text,
  location text,
  work_arrangement text,
  mentor_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  supervisor_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  start_date date,
  expected_end_date date,
  actual_end_date date,
  status text NOT NULL DEFAULT 'APPLICANT'
    CHECK (status IN ('APPLICANT','ELIGIBLE','ASSESSED','SHORTLISTED','INTERVIEWED','SELECTED','OFFERED','ACCEPTED','ONBOARDING','ACTIVE','COMPLETED','WITHDRAWN','TERMINATED')),
  talent_level text NOT NULL DEFAULT 'APPLICANT'
    CHECK (talent_level IN ('APPLICANT','APPRENTICE','OPERATOR','PRODUCER','YALLA_TALENT')),
  conversion_status text NOT NULL DEFAULT 'NONE'
    CHECK (conversion_status IN ('NONE','HIGH_POTENTIAL','TALENT_REVIEW','EXTENSION','PAID_ENGAGEMENT','FIXED_TERM','PERMANENT','TALENT_POOL','NOT_PROGRESSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  deleted_at timestamptz
);
CREATE INDEX intern_profiles_cohort_idx ON public.intern_profiles(cohort_id);
CREATE INDEX intern_profiles_track_idx ON public.intern_profiles(track_id);
CREATE INDEX intern_profiles_user_idx ON public.intern_profiles(user_id);

CREATE TABLE public.intern_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id uuid NOT NULL REFERENCES public.intern_profiles(id) ON DELETE CASCADE,
  category text NOT NULL,
  skill text NOT NULL,
  classification text NOT NULL DEFAULT 'developmental' CHECK (classification IN ('required','preferred','developmental')),
  level int NOT NULL DEFAULT 1 CHECK (level BETWEEN 0 AND 5),
  evidence text,
  source text,
  confidence numeric(5,2) NOT NULL DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100),
  assessed_by uuid,
  last_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (intern_id, skill)
);

CREATE TABLE public.intern_learning_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id uuid NOT NULL REFERENCES public.intern_profiles(id) ON DELETE CASCADE,
  module_id uuid NOT NULL REFERENCES public.intern_learning_modules(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','in_progress','submitted','validated','failed')),
  assessment_score numeric(5,2) CHECK (assessment_score IS NULL OR assessment_score BETWEEN 0 AND 100),
  attempts int NOT NULL DEFAULT 0,
  application_evidence text,
  started_at timestamptz,
  completed_at timestamptz,
  validated_by uuid,
  validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (intern_id, module_id)
);

CREATE TABLE public.intern_work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id uuid NOT NULL REFERENCES public.intern_profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  work_kind text NOT NULL DEFAULT 'task',
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'ASSIGNED'
    CHECK (status IN ('BACKLOG','ASSIGNED','IN_PROGRESS','BLOCKED','SUBMITTED','UNDER_REVIEW','ACCEPTED','REWORK','COMPLETED')),
  deadline timestamptz,
  deliverable_url text,
  quality_criteria text,
  quality_score numeric(5,2) CHECK (quality_score IS NULL OR quality_score BETWEEN 0 AND 100),
  complexity int NOT NULL DEFAULT 2 CHECK (complexity BETWEEN 1 AND 5),
  impact int NOT NULL DEFAULT 2 CHECK (impact BETWEEN 1 AND 5),
  rework_count int NOT NULL DEFAULT 0,
  reviewer_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  accepted_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX intern_work_items_intern_idx ON public.intern_work_items(intern_id, status);

CREATE TABLE public.intern_commercial_attributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id uuid NOT NULL REFERENCES public.intern_profiles(id) ON DELETE CASCADE,
  attribution_type text NOT NULL CHECK (attribution_type IN (
    'LEAD_CREATED','LEAD_QUALIFIED','OPPORTUNITY_CREATED','SALES_ASSIST',
    'BOOKING_ASSIST','CONVERSION_ASSIST','REVENUE_ATTRIBUTED')),
  channel text,
  product_line text,
  subject_ref text,
  subject_id uuid,
  amount_kes numeric(14,2),
  source_system text NOT NULL DEFAULT 'manual',
  verified boolean NOT NULL DEFAULT false,
  verified_by uuid,
  verified_at timestamptz,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX intern_commercial_intern_idx ON public.intern_commercial_attributions(intern_id, attribution_type);

CREATE TABLE public.intern_performance_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id uuid NOT NULL REFERENCES public.intern_profiles(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  learning_score numeric(5,2) NOT NULL DEFAULT 0,
  productivity_score numeric(5,2) NOT NULL DEFAULT 0,
  quality_score numeric(5,2) NOT NULL DEFAULT 0,
  commercial_score numeric(5,2) NOT NULL DEFAULT 0,
  operational_score numeric(5,2) NOT NULL DEFAULT 0,
  conduct_score numeric(5,2) NOT NULL DEFAULT 0,
  performance_index numeric(5,2) NOT NULL DEFAULT 0,
  evidence_confidence numeric(5,2) NOT NULL DEFAULT 0,
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  computed_by uuid,
  UNIQUE (intern_id, period_start, period_end)
);

CREATE TABLE public.intern_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id uuid NOT NULL REFERENCES public.intern_profiles(id) ON DELETE CASCADE,
  reviewer_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  reviewer_user_id uuid,
  review_type text NOT NULL DEFAULT 'weekly' CHECK (review_type IN ('weekly','monthly','midpoint','final','coaching')),
  period_label text,
  strengths text,
  concerns text,
  coaching text,
  subjective_rating int CHECK (subjective_rating IS NULL OR subjective_rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.intern_capstones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id uuid NOT NULL REFERENCES public.intern_profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  problem text,
  baseline text,
  research text,
  solution text,
  execution_summary text,
  evidence_url text,
  measured_impact text,
  recommendation text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','under_review','scored','returned')),
  score_problem numeric(5,2),
  score_research numeric(5,2),
  score_solution numeric(5,2),
  score_execution numeric(5,2),
  score_impact numeric(5,2),
  score_presentation numeric(5,2),
  score_reflection numeric(5,2),
  total_score numeric(5,2),
  scored_by uuid,
  scored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.intern_integrity_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id uuid NOT NULL REFERENCES public.intern_profiles(id) ON DELETE CASCADE,
  signal text NOT NULL,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'REVIEW_REQUIRED' CHECK (status IN ('REVIEW_REQUIRED','CLEARED','SUBSTANTIATED')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.intern_conversion_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id uuid NOT NULL REFERENCES public.intern_profiles(id) ON DELETE CASCADE,
  recommended_outcome text NOT NULL,
  decision text CHECK (decision IS NULL OR decision IN ('APPROVED','DECLINED','DEFERRED')),
  outcome text,
  rationale text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommended_by uuid,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.intern_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id uuid REFERENCES public.intern_profiles(id) ON DELETE SET NULL,
  actor_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX intern_audit_log_intern_idx ON public.intern_audit_log(intern_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.intern_programmes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intern_tracks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intern_cohorts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intern_learning_modules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intern_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intern_skills TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intern_learning_progress TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intern_work_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intern_commercial_attributions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intern_performance_scores TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intern_reviews TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intern_capstones TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intern_integrity_flags TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.intern_conversion_decisions TO authenticated;
GRANT SELECT ON public.intern_audit_log TO authenticated;
GRANT ALL ON public.intern_programmes, public.intern_tracks, public.intern_cohorts,
  public.intern_learning_modules, public.intern_profiles, public.intern_skills,
  public.intern_learning_progress, public.intern_work_items,
  public.intern_commercial_attributions, public.intern_performance_scores,
  public.intern_reviews, public.intern_capstones, public.intern_integrity_flags,
  public.intern_conversion_decisions, public.intern_audit_log TO service_role;

CREATE OR REPLACE FUNCTION public.intern_programme_authority(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(p_user, ARRAY['admin','super_admin','director','general_manager','operations_admin']::app_role[]);
$$;

CREATE OR REPLACE FUNCTION public.intern_can_view(p_intern uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.intern_programme_authority(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.intern_profiles p
        LEFT JOIN public.staff_members m ON m.id = p.mentor_staff_id
        LEFT JOIN public.staff_members s ON s.id = p.supervisor_staff_id
        WHERE p.id = p_intern
          AND (p.user_id = auth.uid() OR m.user_id = auth.uid() OR s.user_id = auth.uid())
      );
$$;

CREATE OR REPLACE FUNCTION public.intern_is_self(p_intern uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.intern_profiles p WHERE p.id = p_intern AND p.user_id = auth.uid());
$$;

REVOKE EXECUTE ON FUNCTION public.intern_programme_authority(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.intern_can_view(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.intern_is_self(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.intern_programme_authority(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.intern_can_view(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.intern_is_self(uuid) TO authenticated, service_role;

ALTER TABLE public.intern_programmes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intern_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intern_cohorts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intern_learning_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intern_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intern_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intern_learning_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intern_work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intern_commercial_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intern_performance_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intern_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intern_capstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intern_integrity_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intern_conversion_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.intern_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY intern_programmes_read ON public.intern_programmes FOR SELECT TO authenticated USING (true);
CREATE POLICY intern_programmes_write ON public.intern_programmes FOR ALL TO authenticated
  USING (public.intern_programme_authority(auth.uid())) WITH CHECK (public.intern_programme_authority(auth.uid()));
CREATE POLICY intern_tracks_read ON public.intern_tracks FOR SELECT TO authenticated USING (true);
CREATE POLICY intern_tracks_write ON public.intern_tracks FOR ALL TO authenticated
  USING (public.intern_programme_authority(auth.uid())) WITH CHECK (public.intern_programme_authority(auth.uid()));
CREATE POLICY intern_cohorts_read ON public.intern_cohorts FOR SELECT TO authenticated USING (true);
CREATE POLICY intern_cohorts_write ON public.intern_cohorts FOR ALL TO authenticated
  USING (public.intern_programme_authority(auth.uid())) WITH CHECK (public.intern_programme_authority(auth.uid()));
CREATE POLICY intern_modules_read ON public.intern_learning_modules FOR SELECT TO authenticated USING (true);
CREATE POLICY intern_modules_write ON public.intern_learning_modules FOR ALL TO authenticated
  USING (public.intern_programme_authority(auth.uid())) WITH CHECK (public.intern_programme_authority(auth.uid()));

CREATE POLICY intern_profiles_read ON public.intern_profiles FOR SELECT TO authenticated
  USING (public.intern_can_view(id));
CREATE POLICY intern_profiles_write ON public.intern_profiles FOR ALL TO authenticated
  USING (public.intern_programme_authority(auth.uid())) WITH CHECK (public.intern_programme_authority(auth.uid()));

CREATE POLICY intern_skills_read ON public.intern_skills FOR SELECT TO authenticated USING (public.intern_can_view(intern_id));
CREATE POLICY intern_skills_write ON public.intern_skills FOR ALL TO authenticated
  USING (public.intern_programme_authority(auth.uid())) WITH CHECK (public.intern_programme_authority(auth.uid()));

CREATE POLICY intern_progress_read ON public.intern_learning_progress FOR SELECT TO authenticated USING (public.intern_can_view(intern_id));
CREATE POLICY intern_progress_manage ON public.intern_learning_progress FOR ALL TO authenticated
  USING (public.intern_programme_authority(auth.uid())) WITH CHECK (public.intern_programme_authority(auth.uid()));
CREATE POLICY intern_progress_self_update ON public.intern_learning_progress FOR UPDATE TO authenticated
  USING (public.intern_is_self(intern_id)) WITH CHECK (public.intern_is_self(intern_id));

CREATE POLICY intern_work_read ON public.intern_work_items FOR SELECT TO authenticated USING (public.intern_can_view(intern_id));
CREATE POLICY intern_work_manage ON public.intern_work_items FOR ALL TO authenticated
  USING (public.intern_can_view(intern_id) AND NOT public.intern_is_self(intern_id))
  WITH CHECK (public.intern_can_view(intern_id) AND NOT public.intern_is_self(intern_id));
CREATE POLICY intern_work_self_update ON public.intern_work_items FOR UPDATE TO authenticated
  USING (public.intern_is_self(intern_id)) WITH CHECK (public.intern_is_self(intern_id));

CREATE POLICY intern_commercial_read ON public.intern_commercial_attributions FOR SELECT TO authenticated USING (public.intern_can_view(intern_id));
CREATE POLICY intern_commercial_insert ON public.intern_commercial_attributions FOR INSERT TO authenticated
  WITH CHECK (public.intern_can_view(intern_id));
CREATE POLICY intern_commercial_manage ON public.intern_commercial_attributions FOR UPDATE TO authenticated
  USING (public.intern_programme_authority(auth.uid())) WITH CHECK (public.intern_programme_authority(auth.uid()));
CREATE POLICY intern_commercial_delete ON public.intern_commercial_attributions FOR DELETE TO authenticated
  USING (public.intern_programme_authority(auth.uid()));

CREATE POLICY intern_scores_read ON public.intern_performance_scores FOR SELECT TO authenticated USING (public.intern_can_view(intern_id));
CREATE POLICY intern_scores_write ON public.intern_performance_scores FOR ALL TO authenticated
  USING (public.intern_programme_authority(auth.uid())) WITH CHECK (public.intern_programme_authority(auth.uid()));

CREATE POLICY intern_reviews_read ON public.intern_reviews FOR SELECT TO authenticated USING (public.intern_can_view(intern_id));
CREATE POLICY intern_reviews_write ON public.intern_reviews FOR ALL TO authenticated
  USING (public.intern_can_view(intern_id) AND NOT public.intern_is_self(intern_id))
  WITH CHECK (public.intern_can_view(intern_id) AND NOT public.intern_is_self(intern_id));

CREATE POLICY intern_capstones_read ON public.intern_capstones FOR SELECT TO authenticated USING (public.intern_can_view(intern_id));
CREATE POLICY intern_capstones_self ON public.intern_capstones FOR ALL TO authenticated
  USING (public.intern_is_self(intern_id)) WITH CHECK (public.intern_is_self(intern_id));
CREATE POLICY intern_capstones_manage ON public.intern_capstones FOR ALL TO authenticated
  USING (public.intern_programme_authority(auth.uid())) WITH CHECK (public.intern_programme_authority(auth.uid()));

CREATE POLICY intern_flags_read ON public.intern_integrity_flags FOR SELECT TO authenticated
  USING (public.intern_programme_authority(auth.uid()));
CREATE POLICY intern_flags_write ON public.intern_integrity_flags FOR ALL TO authenticated
  USING (public.intern_programme_authority(auth.uid())) WITH CHECK (public.intern_programme_authority(auth.uid()));

CREATE POLICY intern_conversion_read ON public.intern_conversion_decisions FOR SELECT TO authenticated
  USING (public.intern_programme_authority(auth.uid()));
CREATE POLICY intern_conversion_write ON public.intern_conversion_decisions FOR ALL TO authenticated
  USING (public.intern_programme_authority(auth.uid())) WITH CHECK (public.intern_programme_authority(auth.uid()));

CREATE POLICY intern_audit_read ON public.intern_audit_log FOR SELECT TO authenticated
  USING (public.intern_programme_authority(auth.uid()));

CREATE OR REPLACE FUNCTION public.intern_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER intern_profiles_touch BEFORE UPDATE ON public.intern_profiles
  FOR EACH ROW EXECUTE FUNCTION public.intern_touch_updated_at();
CREATE TRIGGER intern_work_touch BEFORE UPDATE ON public.intern_work_items
  FOR EACH ROW EXECUTE FUNCTION public.intern_touch_updated_at();
CREATE TRIGGER intern_capstones_touch BEFORE UPDATE ON public.intern_capstones
  FOR EACH ROW EXECUTE FUNCTION public.intern_touch_updated_at();

CREATE OR REPLACE FUNCTION public.intern_work_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.intern_programme_authority(auth.uid()) THEN RETURN NEW; END IF;
  IF public.intern_is_self(NEW.intern_id) THEN
    IF NEW.status IN ('ACCEPTED','COMPLETED') AND OLD.status NOT IN ('ACCEPTED','COMPLETED') THEN
      RAISE EXCEPTION 'Interns cannot accept their own work — a reviewer must accept it.';
    END IF;
    IF COALESCE(NEW.quality_score, -1) <> COALESCE(OLD.quality_score, -1) THEN
      RAISE EXCEPTION 'Interns cannot set their own quality score.';
    END IF;
    IF NEW.complexity <> OLD.complexity OR NEW.impact <> OLD.impact THEN
      RAISE EXCEPTION 'Interns cannot change complexity or impact weighting.';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER intern_work_guard_trg BEFORE UPDATE ON public.intern_work_items
  FOR EACH ROW EXECUTE FUNCTION public.intern_work_guard();

CREATE OR REPLACE FUNCTION public.intern_progress_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.intern_programme_authority(auth.uid()) THEN RETURN NEW; END IF;
  IF public.intern_is_self(NEW.intern_id) THEN
    IF NEW.status = 'validated' AND OLD.status <> 'validated' THEN
      RAISE EXCEPTION 'Learning competencies must be validated by a mentor or supervisor.';
    END IF;
    IF COALESCE(NEW.validated_by::text,'') <> COALESCE(OLD.validated_by::text,'') THEN
      RAISE EXCEPTION 'Validation cannot be self-recorded.';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER intern_progress_guard_trg BEFORE UPDATE ON public.intern_learning_progress
  FOR EACH ROW EXECUTE FUNCTION public.intern_progress_guard();

CREATE OR REPLACE FUNCTION public.intern_profile_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.intern_audit_log(intern_id, actor_id, action, entity, entity_id, after_state)
    VALUES (NEW.id, auth.uid(), 'intern_created', 'intern_profiles', NEW.id,
            jsonb_build_object('status', NEW.status, 'talent_level', NEW.talent_level));
    RETURN NEW;
  END IF;
  IF NEW.status <> OLD.status OR NEW.talent_level <> OLD.talent_level
     OR NEW.conversion_status <> OLD.conversion_status THEN
    INSERT INTO public.intern_audit_log(intern_id, actor_id, action, entity, entity_id, before_state, after_state)
    VALUES (NEW.id, auth.uid(), 'intern_transition', 'intern_profiles', NEW.id,
            jsonb_build_object('status', OLD.status, 'talent_level', OLD.talent_level, 'conversion_status', OLD.conversion_status),
            jsonb_build_object('status', NEW.status, 'talent_level', NEW.talent_level, 'conversion_status', NEW.conversion_status));
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER intern_profile_audit_trg AFTER INSERT OR UPDATE ON public.intern_profiles
  FOR EACH ROW EXECUTE FUNCTION public.intern_profile_audit();

INSERT INTO public.intern_programmes (code, name, description)
VALUES ('YMEITA', 'Yalla Mobility Enterprise Internship & Talent Accelerator',
        'Single master programme: learn, produce, sell, discover talent.');

INSERT INTO public.intern_tracks (programme_id, code, name, focus, sequence, performance_weights, kpis)
SELECT p.id, t.code, t.name, t.focus, t.seq, t.weights, t.kpis
FROM public.intern_programmes p,
(VALUES
 ('TRAVEL_OPS','Travel & Mobility Operations','Itinerary, service coordination, supplier and exception management',1,
  '{"learning":15,"productivity":25,"quality":20,"commercial":10,"operational":20,"conduct":10}'::jsonb,
  '["travel requests handled","quote turnaround","booking accuracy","service exceptions resolved","completion quality"]'::jsonb),
 ('SALES','Sales & Commercial Growth','Prospecting, qualification, quotation and conversion',2,
  '{"learning":10,"productivity":15,"quality":15,"commercial":45,"operational":5,"conduct":10}'::jsonb,
  '["qualified leads","opportunities created","quotations issued","bookings assisted","attributed revenue"]'::jsonb),
 ('LOGISTICS','Logistics & Supply Chain','Planning, routing, supplier and delivery coordination',3,
  '{"learning":15,"productivity":25,"quality":20,"commercial":20,"operational":10,"conduct":10}'::jsonb,
  '["shipment cases","quotations","supplier records","route research","delivery exceptions"]'::jsonb),
 ('EVENTS','Events & Business Activation','Event identification, organiser engagement and activation',4,
  '{"learning":10,"productivity":20,"quality":15,"commercial":40,"operational":5,"conduct":10}'::jsonb,
  '["events identified","organisers contacted","proposals issued","bookings assisted","attributed revenue"]'::jsonb),
 ('CX','Customer Experience','Response, resolution, recovery and retention',5,
  '{"learning":15,"productivity":20,"quality":25,"commercial":10,"operational":20,"conduct":10}'::jsonb,
  '["first response time","cases resolved","resolution quality","recovery outcomes","repeat business"]'::jsonb),
 ('DIGITAL','Digital Marketing & Communications','Content, SEO, campaigns and demand generation',6,
  '{"learning":15,"productivity":20,"quality":15,"commercial":35,"operational":5,"conduct":10}'::jsonb,
  '["content published","organic traffic","leads generated","qualified leads","campaign conversion"]'::jsonb)
) AS t(code,name,focus,seq,weights,kpis)
WHERE p.code = 'YMEITA';

INSERT INTO public.intern_learning_modules (track_id, code, title, competency, sequence, hours)
SELECT tr.id, m.code, m.title, m.competency, m.seq, m.hours
FROM public.intern_tracks tr
JOIN (VALUES
 ('ALL','M01','Yalla Mobility Operating Model','business_model',1,2),
 ('ALL','M02','Product Portfolio & Service Lines','product_knowledge',2,3),
 ('ALL','M03','Customer Communication Standards','communication',3,2),
 ('ALL','M04','Data Protection, Privacy & Acceptable Use','compliance',4,2),
 ('ALL','M05','Evidence & Quality Discipline','quality',5,2),
 ('SALES','S01','Prospecting & Qualification Discipline','prospecting',6,3),
 ('SALES','S02','Discovery, Objections & Closing','selling',7,3),
 ('SALES','S03','Quotation Accuracy & CRM Hygiene','crm_discipline',8,2),
 ('TRAVEL_OPS','T01','Itinerary Construction & Accuracy','itinerary',6,3),
 ('TRAVEL_OPS','T02','Supplier Coordination & Exceptions','supplier_coordination',7,3),
 ('LOGISTICS','L01','Route, Load & Delivery Planning','planning',6,3),
 ('LOGISTICS','L02','Supplier & Partner Management','supplier_management',7,2),
 ('EVENTS','E01','Event Pipeline Identification','event_pipeline',6,3),
 ('EVENTS','E02','Activation Planning & Risk','activation',7,3),
 ('CX','C01','Response, Resolution & Recovery','resolution',6,3),
 ('CX','C02','Escalation & Retention','retention',7,2),
 ('DIGITAL','D01','SEO & Content Fundamentals','seo',6,3),
 ('DIGITAL','D02','Campaign Analytics & Conversion','analytics',7,3)
) AS m(track_code,code,title,competency,seq,hours)
  ON m.track_code = 'ALL' OR m.track_code = tr.code;