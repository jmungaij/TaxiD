
-- ============================================================
-- CORPORATE RIDE POLICIES ENGINE
-- ============================================================

-- Enums
DO $$ BEGIN
  CREATE TYPE public.corporate_employee_role AS ENUM ('corporate_admin','corporate_manager','corporate_employee');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.corporate_employee_status AS ENUM ('invited','active','suspended','removed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.corporate_invitation_status AS ENUM ('pending','accepted','revoked','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.corporate_policy_scope AS ENUM ('corporate','department','employee');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.corporate_approval_status AS ENUM ('pending','approved','rejected','expired','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.corporate_decision AS ENUM ('allow','requires_approval','block');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add corporate_manager / corporate_employee to app_role enum if missing
DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'corporate_manager';
EXCEPTION WHEN others THEN NULL; END $$;

-- ============================================================
-- Departments
-- ============================================================
CREATE TABLE IF NOT EXISTS public.corporate_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  cost_center text,
  monthly_budget_cents bigint,
  manager_user_id uuid,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (corporate_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_departments TO authenticated;
GRANT ALL ON public.corporate_departments TO service_role;
ALTER TABLE public.corporate_departments ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Employees
-- ============================================================
CREATE TABLE IF NOT EXISTS public.corporate_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  user_id uuid,
  department_id uuid REFERENCES public.corporate_departments(id) ON DELETE SET NULL,
  email text NOT NULL,
  full_name text,
  phone text,
  employee_code text,
  role public.corporate_employee_role NOT NULL DEFAULT 'corporate_employee',
  status public.corporate_employee_status NOT NULL DEFAULT 'invited',
  monthly_cap_cents bigint,
  per_trip_cap_cents bigint,
  manager_user_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  invited_at timestamptz,
  activated_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (corporate_id, email)
);
CREATE INDEX IF NOT EXISTS idx_corporate_employees_user ON public.corporate_employees(user_id);
CREATE INDEX IF NOT EXISTS idx_corporate_employees_corp ON public.corporate_employees(corporate_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_employees TO authenticated;
GRANT ALL ON public.corporate_employees TO service_role;
ALTER TABLE public.corporate_employees ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Invitations
-- ============================================================
CREATE TABLE IF NOT EXISTS public.corporate_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.corporate_departments(id) ON DELETE SET NULL,
  email text NOT NULL,
  full_name text,
  role public.corporate_employee_role NOT NULL DEFAULT 'corporate_employee',
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(24), 'hex'),
  status public.corporate_invitation_status NOT NULL DEFAULT 'pending',
  invited_by uuid,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_corp_invitations_corp ON public.corporate_invitations(corporate_id);
CREATE INDEX IF NOT EXISTS idx_corp_invitations_email ON public.corporate_invitations(email);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_invitations TO authenticated;
GRANT ALL ON public.corporate_invitations TO service_role;
ALTER TABLE public.corporate_invitations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Policies + Rules
-- ============================================================
CREATE TABLE IF NOT EXISTS public.corporate_ride_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  scope public.corporate_policy_scope NOT NULL DEFAULT 'corporate',
  department_id uuid REFERENCES public.corporate_departments(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.corporate_employees(id) ON DELETE CASCADE,
  priority integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_corp_policies_corp ON public.corporate_ride_policies(corporate_id, active);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_ride_policies TO authenticated;
GRANT ALL ON public.corporate_ride_policies TO service_role;
ALTER TABLE public.corporate_ride_policies ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.corporate_policy_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES public.corporate_ride_policies(id) ON DELETE CASCADE,
  -- Rule kind controls which fields apply
  rule_kind text NOT NULL CHECK (rule_kind IN (
    'ride_type_allow','ride_type_block',
    'max_fare_per_trip','max_distance_km',
    'time_window','day_of_week',
    'monthly_spend_cap','weekly_spend_cap',
    'requires_approval_above','geo_allowlist','geo_blocklist'
  )),
  -- Generic parameters
  allowed_ride_types text[],
  blocked_ride_types text[],
  max_fare_cents bigint,
  max_distance_km numeric,
  time_start time,
  time_end time,
  days_of_week integer[],         -- 0=Sun..6=Sat
  cap_cents bigint,
  threshold_cents bigint,
  geo_zones text[],
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  severity text NOT NULL DEFAULT 'block' CHECK (severity IN ('warn','approval','block')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_corp_policy_rules_policy ON public.corporate_policy_rules(policy_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_policy_rules TO authenticated;
GRANT ALL ON public.corporate_policy_rules TO service_role;
ALTER TABLE public.corporate_policy_rules ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Approvals queue
-- ============================================================
CREATE TABLE IF NOT EXISTS public.corporate_ride_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.corporate_employees(id) ON DELETE CASCADE,
  department_id uuid REFERENCES public.corporate_departments(id) ON DELETE SET NULL,
  requested_by uuid NOT NULL,
  trip_request_id uuid,
  ride_type text,
  pickup_address text,
  dropoff_address text,
  estimated_fare_cents bigint NOT NULL,
  estimated_distance_km numeric,
  scheduled_for timestamptz,
  justification text,
  triggering_policy_id uuid REFERENCES public.corporate_ride_policies(id) ON DELETE SET NULL,
  triggering_rule_id uuid REFERENCES public.corporate_policy_rules(id) ON DELETE SET NULL,
  status public.corporate_approval_status NOT NULL DEFAULT 'pending',
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_corp_approvals_corp_status ON public.corporate_ride_approvals(corporate_id, status);
CREATE INDEX IF NOT EXISTS idx_corp_approvals_employee ON public.corporate_ride_approvals(employee_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_ride_approvals TO authenticated;
GRANT ALL ON public.corporate_ride_approvals TO service_role;
ALTER TABLE public.corporate_ride_approvals ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Violations
-- ============================================================
CREATE TABLE IF NOT EXISTS public.corporate_policy_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.corporate_employees(id) ON DELETE SET NULL,
  user_id uuid,
  policy_id uuid REFERENCES public.corporate_ride_policies(id) ON DELETE SET NULL,
  rule_id uuid REFERENCES public.corporate_policy_rules(id) ON DELETE SET NULL,
  decision public.corporate_decision NOT NULL,
  reason text NOT NULL,
  ride_type text,
  fare_cents bigint,
  distance_km numeric,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_corp_violations_corp ON public.corporate_policy_violations(corporate_id, created_at DESC);
GRANT SELECT, INSERT ON public.corporate_policy_violations TO authenticated;
GRANT ALL ON public.corporate_policy_violations TO service_role;
ALTER TABLE public.corporate_policy_violations ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Audit log
-- ============================================================
CREATE TABLE IF NOT EXISTS public.corporate_policy_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  actor_user_id uuid,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  before jsonb,
  after jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_corp_audit_corp ON public.corporate_policy_audit_log(corporate_id, created_at DESC);
GRANT SELECT, INSERT ON public.corporate_policy_audit_log TO authenticated;
GRANT ALL ON public.corporate_policy_audit_log TO service_role;
ALTER TABLE public.corporate_policy_audit_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Helper: is current user a member of corporate (and role)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_corporate_member(_user_id uuid, _corporate_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.corporate_employees
    WHERE user_id = _user_id AND corporate_id = _corporate_id AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.has_corporate_role(_user_id uuid, _corporate_id uuid, _role public.corporate_employee_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.corporate_employees
    WHERE user_id = _user_id AND corporate_id = _corporate_id AND status = 'active' AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_corporates()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT corporate_id FROM public.corporate_employees
  WHERE user_id = auth.uid() AND status = 'active';
$$;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- corporate_departments
CREATE POLICY corp_dept_member_select ON public.corporate_departments FOR SELECT TO authenticated
  USING (corporate_id IN (SELECT public.current_user_corporates()) OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY corp_dept_admin_write ON public.corporate_departments FOR ALL TO authenticated
  USING (public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin') OR public.has_role(auth.uid(),'super_admin'));

-- corporate_employees
CREATE POLICY corp_emp_self_select ON public.corporate_employees FOR SELECT TO authenticated
  USING (user_id = auth.uid()
      OR public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin')
      OR public.has_corporate_role(auth.uid(), corporate_id, 'corporate_manager')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY corp_emp_admin_write ON public.corporate_employees FOR ALL TO authenticated
  USING (public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin') OR public.has_role(auth.uid(),'super_admin'));

-- corporate_invitations
CREATE POLICY corp_inv_admin_all ON public.corporate_invitations FOR ALL TO authenticated
  USING (public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin') OR public.has_role(auth.uid(),'super_admin'));

-- corporate_ride_policies
CREATE POLICY corp_pol_member_select ON public.corporate_ride_policies FOR SELECT TO authenticated
  USING (corporate_id IN (SELECT public.current_user_corporates()) OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY corp_pol_admin_write ON public.corporate_ride_policies FOR ALL TO authenticated
  USING (public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin') OR public.has_role(auth.uid(),'super_admin'));

-- corporate_policy_rules
CREATE POLICY corp_pol_rules_member_select ON public.corporate_policy_rules FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.corporate_ride_policies p
                 WHERE p.id = policy_id
                   AND (p.corporate_id IN (SELECT public.current_user_corporates())
                        OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))));
CREATE POLICY corp_pol_rules_admin_write ON public.corporate_policy_rules FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.corporate_ride_policies p
                 WHERE p.id = policy_id
                   AND (public.has_corporate_role(auth.uid(), p.corporate_id, 'corporate_admin')
                        OR public.has_role(auth.uid(),'super_admin'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.corporate_ride_policies p
                 WHERE p.id = policy_id
                   AND (public.has_corporate_role(auth.uid(), p.corporate_id, 'corporate_admin')
                        OR public.has_role(auth.uid(),'super_admin'))));

-- corporate_ride_approvals
CREATE POLICY corp_appr_view ON public.corporate_ride_approvals FOR SELECT TO authenticated
  USING (requested_by = auth.uid()
      OR public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin')
      OR public.has_corporate_role(auth.uid(), corporate_id, 'corporate_manager')
      OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY corp_appr_insert_self ON public.corporate_ride_approvals FOR INSERT TO authenticated
  WITH CHECK (requested_by = auth.uid() AND EXISTS (
    SELECT 1 FROM public.corporate_employees e
    WHERE e.id = employee_id AND e.user_id = auth.uid() AND e.corporate_id = corporate_id AND e.status='active'
  ));
CREATE POLICY corp_appr_update_manager ON public.corporate_ride_approvals FOR UPDATE TO authenticated
  USING (public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin')
      OR public.has_corporate_role(auth.uid(), corporate_id, 'corporate_manager')
      OR requested_by = auth.uid())
  WITH CHECK (public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin')
      OR public.has_corporate_role(auth.uid(), corporate_id, 'corporate_manager')
      OR requested_by = auth.uid());

-- violations
CREATE POLICY corp_viol_view ON public.corporate_policy_violations FOR SELECT TO authenticated
  USING (user_id = auth.uid()
      OR public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin')
      OR public.has_corporate_role(auth.uid(), corporate_id, 'corporate_manager')
      OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY corp_viol_insert ON public.corporate_policy_violations FOR INSERT TO authenticated
  WITH CHECK (true);  -- inserted by booking flow & edge functions

-- audit log
CREATE POLICY corp_audit_view ON public.corporate_policy_audit_log FOR SELECT TO authenticated
  USING (public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY corp_audit_insert ON public.corporate_policy_audit_log FOR INSERT TO authenticated
  WITH CHECK (true);

-- ============================================================
-- update_updated_at triggers
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_corp_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DO $$ BEGIN
  PERFORM 1;
  CREATE TRIGGER trg_corp_dept_touch BEFORE UPDATE ON public.corporate_departments
    FOR EACH ROW EXECUTE FUNCTION public.tg_corp_touch_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER trg_corp_emp_touch BEFORE UPDATE ON public.corporate_employees
    FOR EACH ROW EXECUTE FUNCTION public.tg_corp_touch_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER trg_corp_inv_touch BEFORE UPDATE ON public.corporate_invitations
    FOR EACH ROW EXECUTE FUNCTION public.tg_corp_touch_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER trg_corp_pol_touch BEFORE UPDATE ON public.corporate_ride_policies
    FOR EACH ROW EXECUTE FUNCTION public.tg_corp_touch_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER trg_corp_pol_rules_touch BEFORE UPDATE ON public.corporate_policy_rules
    FOR EACH ROW EXECUTE FUNCTION public.tg_corp_touch_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TRIGGER trg_corp_appr_touch BEFORE UPDATE ON public.corporate_ride_approvals
    FOR EACH ROW EXECUTE FUNCTION public.tg_corp_touch_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- RPC: evaluate_corporate_ride_policy
-- ============================================================
-- Returns one row per evaluation with the strongest decision found.
-- Decision precedence: block > requires_approval > allow.
CREATE OR REPLACE FUNCTION public.evaluate_corporate_ride_policy(
  _employee_id uuid,
  _ride_type text,
  _fare_cents bigint,
  _distance_km numeric DEFAULT NULL,
  _scheduled_for timestamptz DEFAULT now()
)
RETURNS TABLE (
  decision public.corporate_decision,
  reason text,
  policy_id uuid,
  rule_id uuid,
  rule_kind text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_corp uuid;
  v_dept uuid;
  v_emp_cap bigint;
  v_emp_trip_cap bigint;
  v_month_spend bigint;
  v_week_spend bigint;
  v_dow int := EXTRACT(DOW FROM _scheduled_for)::int;
  v_t time := _scheduled_for::time;
  r record;
  v_best public.corporate_decision := 'allow';
  v_best_reason text := 'within policy';
  v_best_policy uuid;
  v_best_rule uuid;
  v_best_kind text;
BEGIN
  SELECT corporate_id, department_id, monthly_cap_cents, per_trip_cap_cents
    INTO v_corp, v_dept, v_emp_cap, v_emp_trip_cap
  FROM public.corporate_employees WHERE id = _employee_id;
  IF v_corp IS NULL THEN
    RETURN QUERY SELECT 'block'::public.corporate_decision, 'employee not found'::text,
                        NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  -- Employee-level hard caps
  IF v_emp_trip_cap IS NOT NULL AND _fare_cents > v_emp_trip_cap THEN
    v_best := 'block';
    v_best_reason := format('Trip fare %s exceeds per-trip cap %s', _fare_cents, v_emp_trip_cap);
    v_best_kind := 'per_trip_cap';
  END IF;

  IF v_emp_cap IS NOT NULL THEN
    SELECT COALESCE(SUM(estimated_fare_cents),0) INTO v_month_spend
      FROM public.corporate_ride_approvals
      WHERE employee_id = _employee_id AND status='approved'
        AND created_at >= date_trunc('month', now());
    IF (v_month_spend + _fare_cents) > v_emp_cap THEN
      v_best := 'block';
      v_best_reason := format('Monthly spend %s would exceed cap %s', v_month_spend + _fare_cents, v_emp_cap);
      v_best_kind := 'employee_monthly_cap';
    END IF;
  END IF;

  -- Iterate matching active rules across all relevant policies
  FOR r IN
    SELECT pr.*, p.id AS pid
    FROM public.corporate_policy_rules pr
    JOIN public.corporate_ride_policies p ON p.id = pr.policy_id
    WHERE p.corporate_id = v_corp
      AND p.active
      AND (p.effective_to IS NULL OR p.effective_to > now())
      AND p.effective_from <= now()
      AND (
        p.scope = 'corporate'
        OR (p.scope = 'department' AND p.department_id = v_dept)
        OR (p.scope = 'employee'   AND p.employee_id  = _employee_id)
      )
    ORDER BY p.priority ASC
  LOOP
    DECLARE
      v_hit boolean := false;
      v_reason text;
      v_dec public.corporate_decision;
    BEGIN
      IF r.rule_kind = 'ride_type_block' AND _ride_type = ANY(COALESCE(r.blocked_ride_types,'{}')) THEN
        v_hit := true; v_reason := format('Ride type "%s" is blocked', _ride_type);
      ELSIF r.rule_kind = 'ride_type_allow' AND r.allowed_ride_types IS NOT NULL
            AND NOT (_ride_type = ANY(r.allowed_ride_types)) THEN
        v_hit := true; v_reason := format('Ride type "%s" not in allowed list', _ride_type);
      ELSIF r.rule_kind = 'max_fare_per_trip' AND r.max_fare_cents IS NOT NULL AND _fare_cents > r.max_fare_cents THEN
        v_hit := true; v_reason := format('Fare %s exceeds max %s', _fare_cents, r.max_fare_cents);
      ELSIF r.rule_kind = 'max_distance_km' AND r.max_distance_km IS NOT NULL AND _distance_km IS NOT NULL AND _distance_km > r.max_distance_km THEN
        v_hit := true; v_reason := format('Distance %s km exceeds max %s km', _distance_km, r.max_distance_km);
      ELSIF r.rule_kind = 'time_window' AND r.time_start IS NOT NULL AND r.time_end IS NOT NULL
            AND NOT (v_t BETWEEN r.time_start AND r.time_end) THEN
        v_hit := true; v_reason := format('Ride at %s outside allowed window %s-%s', v_t, r.time_start, r.time_end);
      ELSIF r.rule_kind = 'day_of_week' AND r.days_of_week IS NOT NULL AND NOT (v_dow = ANY(r.days_of_week)) THEN
        v_hit := true; v_reason := 'Day not allowed by policy';
      ELSIF r.rule_kind = 'requires_approval_above' AND r.threshold_cents IS NOT NULL AND _fare_cents > r.threshold_cents THEN
        v_hit := true; v_reason := format('Fare %s above approval threshold %s', _fare_cents, r.threshold_cents);
      ELSIF r.rule_kind = 'monthly_spend_cap' AND r.cap_cents IS NOT NULL THEN
        SELECT COALESCE(SUM(estimated_fare_cents),0) INTO v_month_spend
          FROM public.corporate_ride_approvals
          WHERE employee_id = _employee_id AND status='approved'
            AND created_at >= date_trunc('month', now());
        IF (v_month_spend + _fare_cents) > r.cap_cents THEN
          v_hit := true; v_reason := format('Monthly spend would exceed policy cap %s', r.cap_cents);
        END IF;
      ELSIF r.rule_kind = 'weekly_spend_cap' AND r.cap_cents IS NOT NULL THEN
        SELECT COALESCE(SUM(estimated_fare_cents),0) INTO v_week_spend
          FROM public.corporate_ride_approvals
          WHERE employee_id = _employee_id AND status='approved'
            AND created_at >= date_trunc('week', now());
        IF (v_week_spend + _fare_cents) > r.cap_cents THEN
          v_hit := true; v_reason := format('Weekly spend would exceed policy cap %s', r.cap_cents);
        END IF;
      END IF;

      IF v_hit THEN
        v_dec := CASE r.severity
                   WHEN 'block' THEN 'block'::public.corporate_decision
                   WHEN 'approval' THEN 'requires_approval'::public.corporate_decision
                   ELSE 'allow'::public.corporate_decision
                 END;
        -- precedence
        IF v_dec = 'block'
           OR (v_dec = 'requires_approval' AND v_best <> 'block') THEN
          v_best := v_dec; v_best_reason := v_reason;
          v_best_policy := r.pid; v_best_rule := r.id; v_best_kind := r.rule_kind;
        END IF;
      END IF;
    END;
  END LOOP;

  RETURN QUERY SELECT v_best, v_best_reason, v_best_policy, v_best_rule, v_best_kind;
END $$;

GRANT EXECUTE ON FUNCTION public.evaluate_corporate_ride_policy(uuid,text,bigint,numeric,timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_corporate_member(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_corporate_role(uuid,uuid,public.corporate_employee_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_corporates() TO authenticated, service_role;
