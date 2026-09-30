CREATE OR REPLACE FUNCTION public.is_staff_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('admin','super_admin','finance_admin','compliance_admin','operations_admin','pricing_manager','dispatch_manager')
  )
$$;

CREATE TABLE public.staff_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coordination_key text NOT NULL,
  policy_key text NOT NULL,
  event_key text NOT NULL,
  title text NOT NULL,
  requested_class text NOT NULL,
  effective_class text NOT NULL,
  approver text NOT NULL,
  sla_class text NOT NULL DEFAULT 'today',
  deadline_at timestamptz,
  status text NOT NULL DEFAULT 'pending',
  priority_score numeric NOT NULL DEFAULT 0,
  confidence numeric,
  recommendation text,
  selected_option text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by uuid,
  decided_by uuid,
  decided_at timestamptz,
  decision_rationale text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_decisions_status_chk CHECK (status IN ('pending','approved','rejected','withdrawn','expired','executed','measured'))
);

GRANT SELECT, INSERT, UPDATE ON public.staff_decisions TO authenticated;
GRANT ALL ON public.staff_decisions TO service_role;
ALTER TABLE public.staff_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read decisions" ON public.staff_decisions FOR SELECT TO authenticated USING (public.is_staff_user());
CREATE POLICY "Staff raise decisions" ON public.staff_decisions FOR INSERT TO authenticated WITH CHECK (public.is_staff_user() AND requested_by = auth.uid());
CREATE POLICY "Staff decide decisions" ON public.staff_decisions FOR UPDATE TO authenticated USING (public.is_staff_user()) WITH CHECK (public.is_staff_user());

CREATE INDEX staff_decisions_status_idx ON public.staff_decisions (status, priority_score DESC);

CREATE TABLE public.staff_decision_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES public.staff_decisions(id) ON DELETE CASCADE,
  step text NOT NULL,
  actor uuid,
  actor_roles text[] NOT NULL DEFAULT '{}',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.staff_decision_audit TO authenticated;
GRANT ALL ON public.staff_decision_audit TO service_role;
ALTER TABLE public.staff_decision_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read decision audit" ON public.staff_decision_audit FOR SELECT TO authenticated USING (public.is_staff_user());
CREATE POLICY "Staff append decision audit" ON public.staff_decision_audit FOR INSERT TO authenticated WITH CHECK (public.is_staff_user() AND (actor = auth.uid() OR actor IS NULL));

CREATE INDEX staff_decision_audit_decision_idx ON public.staff_decision_audit (decision_id, created_at);

CREATE OR REPLACE FUNCTION public.deny_staff_decision_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'staff_decision_audit is append-only';
END;
$$;

CREATE TRIGGER staff_decision_audit_append_only
BEFORE UPDATE OR DELETE ON public.staff_decision_audit
FOR EACH ROW EXECUTE FUNCTION public.deny_staff_decision_audit_mutation();

CREATE TABLE public.staff_action_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid REFERENCES public.staff_decisions(id) ON DELETE CASCADE,
  agent_key text NOT NULL,
  measure_key text NOT NULL,
  unit text NOT NULL DEFAULT 'count',
  expected_value numeric,
  actual_value numeric,
  succeeded boolean,
  lesson text,
  adaptation text,
  recorded_by uuid,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.staff_action_outcomes TO authenticated;
GRANT ALL ON public.staff_action_outcomes TO service_role;
ALTER TABLE public.staff_action_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read outcomes" ON public.staff_action_outcomes FOR SELECT TO authenticated USING (public.is_staff_user());
CREATE POLICY "Staff record outcomes" ON public.staff_action_outcomes FOR INSERT TO authenticated WITH CHECK (public.is_staff_user() AND recorded_by = auth.uid());

CREATE INDEX staff_action_outcomes_agent_idx ON public.staff_action_outcomes (agent_key, measure_key, recorded_at DESC);

CREATE TRIGGER staff_decisions_touch
BEFORE UPDATE ON public.staff_decisions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();