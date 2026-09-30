-- 1. audit trail: record the authoritative source of every entry
ALTER TABLE public.org_audit_log
  ADD COLUMN IF NOT EXISTS source_of_record text,
  ADD COLUMN IF NOT EXISTS source_record_id uuid,
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS org_audit_log_staff_idx ON public.org_audit_log(staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS org_audit_log_source_idx ON public.org_audit_log(source_of_record, source_record_id);

-- 2. work items: review lifecycle
ALTER TABLE public.staff_work_items
  ADD COLUMN IF NOT EXISTS review_state text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS reviewer_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

ALTER TABLE public.staff_work_items DROP CONSTRAINT IF EXISTS staff_work_items_review_state_check;
ALTER TABLE public.staff_work_items ADD CONSTRAINT staff_work_items_review_state_check
  CHECK (review_state = ANY (ARRAY['not_required','submitted','approved','returned']));

ALTER TABLE public.staff_work_items DROP CONSTRAINT IF EXISTS staff_work_items_status_check;
ALTER TABLE public.staff_work_items ADD CONSTRAINT staff_work_items_status_check
  CHECK (status = ANY (ARRAY['open','in_progress','in_review','blocked','done','cancelled']));

-- 3. manager review decisions
CREATE TABLE IF NOT EXISTS public.staff_work_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid NOT NULL REFERENCES public.staff_work_items(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  reviewer_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  reviewer_user_id uuid,
  decision text NOT NULL CHECK (decision = ANY (ARRAY['submitted','approved','returned','changes_requested'])),
  rationale text NOT NULL,
  quality_rating text CHECK (quality_rating = ANY (ARRAY['good','rework','escalated'])),
  required_action text,
  source_of_record text,
  source_record_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_work_reviews_item_idx ON public.staff_work_reviews(work_item_id, created_at DESC);

GRANT SELECT, INSERT ON public.staff_work_reviews TO authenticated;
GRANT ALL ON public.staff_work_reviews TO service_role;
ALTER TABLE public.staff_work_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read work reviews" ON public.staff_work_reviews
  FOR SELECT TO authenticated USING (public.is_staff_member());
CREATE POLICY "Admins record work reviews" ON public.staff_work_reviews
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());

-- 4. corrective actions for rework / blocked work
CREATE TABLE IF NOT EXISTS public.staff_corrective_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id uuid REFERENCES public.staff_work_items(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  objective_id uuid REFERENCES public.org_objectives(id) ON DELETE SET NULL,
  trigger_kind text NOT NULL CHECK (trigger_kind = ANY (ARRAY['rework','blocked','escalated','sla_breach'])),
  cause_category text NOT NULL CHECK (cause_category = ANY (ARRAY[
    'missing_information','system_defect','process_gap','dependency_delay','capability_gap',
    'customer_delay','pricing_approval','data_quality','third_party','other'])),
  cause_description text NOT NULL,
  evidence_source_table text,
  evidence_source_id uuid,
  evidence_note text,
  impact_days numeric,
  impact_value_cents bigint,
  corrective_action text,
  owner_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  due_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status = ANY (ARRAY['open','in_progress','resolved','ineffective','closed'])),
  resolution text,
  resolved_at timestamptz,
  reported_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_corrective_actions_staff_idx ON public.staff_corrective_actions(staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS staff_corrective_actions_objective_idx ON public.staff_corrective_actions(objective_id);

GRANT SELECT, INSERT, UPDATE ON public.staff_corrective_actions TO authenticated;
GRANT ALL ON public.staff_corrective_actions TO service_role;
ALTER TABLE public.staff_corrective_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read corrective actions" ON public.staff_corrective_actions
  FOR SELECT TO authenticated USING (public.is_staff_member());
CREATE POLICY "Staff log corrective actions" ON public.staff_corrective_actions
  FOR INSERT TO authenticated WITH CHECK (public.is_staff_member());
CREATE POLICY "Admins resolve corrective actions" ON public.staff_corrective_actions
  FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE TRIGGER staff_corrective_actions_touch
  BEFORE UPDATE ON public.staff_corrective_actions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. automatic, source-attributed audit for the four governed events
CREATE OR REPLACE FUNCTION public.staff360_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_staff uuid;
  v_source text;
  v_source_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'staff_members' THEN
    v_staff := NEW.id;
    v_source := 'staff_members';
    v_source_id := NEW.id;
    IF TG_OP = 'INSERT' THEN
      v_action := 'staff_created';
    ELSIF NEW.position_id IS DISTINCT FROM OLD.position_id
       OR NEW.unit_id IS DISTINCT FROM OLD.unit_id
       OR NEW.manager_staff_id IS DISTINCT FROM OLD.manager_staff_id THEN
      v_action := 'staff_assignment_changed';
    ELSIF NEW.employment_status IS DISTINCT FROM OLD.employment_status THEN
      v_action := 'staff_status_changed';
    ELSE
      RETURN NEW;
    END IF;

  ELSIF TG_TABLE_NAME = 'org_objectives' THEN
    v_staff := NEW.staff_id;
    v_source := 'org_objectives';
    v_source_id := NEW.id;
    IF TG_OP = 'INSERT' THEN
      v_action := CASE WHEN NEW.parent_objective_id IS NOT NULL THEN 'objective_cascaded' ELSE 'objective_created' END;
    ELSIF NEW.actual IS DISTINCT FROM OLD.actual OR NEW.status IS DISTINCT FROM OLD.status THEN
      v_action := 'objective_result_recorded';
    ELSE
      RETURN NEW;
    END IF;

  ELSIF TG_TABLE_NAME = 'staff_qualifications' THEN
    v_staff := NEW.staff_id;
    v_source := 'staff_qualifications';
    v_source_id := NEW.id;
    IF TG_OP = 'INSERT' THEN
      v_action := 'qualification_recorded';
    ELSIF NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
      v_action := 'qualification_assessed';
    ELSE
      RETURN NEW;
    END IF;

  ELSIF TG_TABLE_NAME = 'staff_competencies' THEN
    v_staff := NEW.staff_id;
    v_source := 'staff_competencies';
    v_source_id := NEW.id;
    v_action := 'competency_assessed';

  ELSIF TG_TABLE_NAME = 'staff_work_items' THEN
    v_staff := NEW.staff_id;
    v_source := COALESCE(NEW.source_table, 'staff_work_items');
    v_source_id := COALESCE(NEW.source_id, NEW.id);
    IF TG_OP = 'INSERT' THEN
      v_action := 'work_assigned';
    ELSIF NEW.staff_id IS DISTINCT FROM OLD.staff_id THEN
      v_action := 'work_reassigned';
    ELSIF NEW.review_state IS DISTINCT FROM OLD.review_state THEN
      v_action := 'work_review_' || NEW.review_state;
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      v_action := 'work_stage_' || NEW.status;
    ELSE
      RETURN NEW;
    END IF;

  ELSIF TG_TABLE_NAME = 'staff_corrective_actions' THEN
    v_staff := NEW.staff_id;
    v_source := COALESCE(NEW.evidence_source_table, 'staff_corrective_actions');
    v_source_id := COALESCE(NEW.evidence_source_id, NEW.id);
    v_action := CASE WHEN TG_OP = 'INSERT' THEN 'corrective_action_opened' ELSE 'corrective_action_' || NEW.status END;

  ELSIF TG_TABLE_NAME = 'staff_work_reviews' THEN
    v_staff := NEW.staff_id;
    v_source := COALESCE(NEW.source_of_record, 'staff_work_reviews');
    v_source_id := COALESCE(NEW.source_record_id, NEW.work_item_id);
    v_action := 'work_review_decision_' || NEW.decision;

  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.org_audit_log (
    actor_user_id, entity_table, entity_id, action, before_data, after_data,
    source_of_record, source_record_id, staff_id
  ) VALUES (
    auth.uid(), TG_TABLE_NAME, NEW.id, v_action,
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW), v_source, v_source_id, v_staff
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff360_audit_staff ON public.staff_members;
CREATE TRIGGER staff360_audit_staff AFTER INSERT OR UPDATE ON public.staff_members
  FOR EACH ROW EXECUTE FUNCTION public.staff360_audit();

DROP TRIGGER IF EXISTS staff360_audit_objectives ON public.org_objectives;
CREATE TRIGGER staff360_audit_objectives AFTER INSERT OR UPDATE ON public.org_objectives
  FOR EACH ROW EXECUTE FUNCTION public.staff360_audit();

DROP TRIGGER IF EXISTS staff360_audit_qualifications ON public.staff_qualifications;
CREATE TRIGGER staff360_audit_qualifications AFTER INSERT OR UPDATE ON public.staff_qualifications
  FOR EACH ROW EXECUTE FUNCTION public.staff360_audit();

DROP TRIGGER IF EXISTS staff360_audit_competencies ON public.staff_competencies;
CREATE TRIGGER staff360_audit_competencies AFTER INSERT OR UPDATE ON public.staff_competencies
  FOR EACH ROW EXECUTE FUNCTION public.staff360_audit();

DROP TRIGGER IF EXISTS staff360_audit_work ON public.staff_work_items;
CREATE TRIGGER staff360_audit_work AFTER INSERT OR UPDATE ON public.staff_work_items
  FOR EACH ROW EXECUTE FUNCTION public.staff360_audit();

DROP TRIGGER IF EXISTS staff360_audit_corrective ON public.staff_corrective_actions;
CREATE TRIGGER staff360_audit_corrective AFTER INSERT OR UPDATE ON public.staff_corrective_actions
  FOR EACH ROW EXECUTE FUNCTION public.staff360_audit();

DROP TRIGGER IF EXISTS staff360_audit_reviews ON public.staff_work_reviews;
CREATE TRIGGER staff360_audit_reviews AFTER INSERT ON public.staff_work_reviews
  FOR EACH ROW EXECUTE FUNCTION public.staff360_audit();