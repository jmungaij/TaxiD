
-- Expense code core table
CREATE TABLE IF NOT EXISTS public.corporate_expense_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  expense_code text NOT NULL,
  description text,
  start_time timestamptz,
  end_time timestamptz,
  ride_cap integer CHECK (ride_cap IS NULL OR ride_cap > 0),
  rides_used integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (corporate_id, expense_code)
);
CREATE INDEX IF NOT EXISTS idx_exp_codes_corp ON public.corporate_expense_codes(corporate_id);
CREATE INDEX IF NOT EXISTS idx_exp_codes_active ON public.corporate_expense_codes(corporate_id, active);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_expense_codes TO authenticated;
GRANT ALL ON public.corporate_expense_codes TO service_role;
ALTER TABLE public.corporate_expense_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY exp_codes_admin_all ON public.corporate_expense_codes FOR ALL TO authenticated
  USING (public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE POLICY exp_codes_member_select ON public.corporate_expense_codes FOR SELECT TO authenticated
  USING (
    public.has_corporate_role(auth.uid(), corporate_id, 'corporate_manager')
    OR public.has_corporate_role(auth.uid(), corporate_id, 'corporate_employee')
  );

-- Expense code creation level enum
DO $$ BEGIN
  CREATE TYPE public.expense_code_level AS ENUM ('CORPORATE','GROUP','EMPLOYEE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Scopes (allocations)
CREATE TABLE IF NOT EXISTS public.corporate_expense_code_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  expense_code_id uuid NOT NULL REFERENCES public.corporate_expense_codes(id) ON DELETE CASCADE,
  level public.expense_code_level NOT NULL,
  department_id uuid REFERENCES public.corporate_departments(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.corporate_employees(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (expense_code_id, level, department_id, employee_id),
  CHECK (
    (level = 'CORPORATE' AND department_id IS NULL AND employee_id IS NULL) OR
    (level = 'GROUP' AND department_id IS NOT NULL AND employee_id IS NULL) OR
    (level = 'EMPLOYEE' AND employee_id IS NOT NULL AND department_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_exp_scopes_code ON public.corporate_expense_code_scopes(expense_code_id);
CREATE INDEX IF NOT EXISTS idx_exp_scopes_employee ON public.corporate_expense_code_scopes(employee_id);
CREATE INDEX IF NOT EXISTS idx_exp_scopes_dept ON public.corporate_expense_code_scopes(department_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_expense_code_scopes TO authenticated;
GRANT ALL ON public.corporate_expense_code_scopes TO service_role;
ALTER TABLE public.corporate_expense_code_scopes ENABLE ROW LEVEL SECURITY;

CREATE POLICY exp_scopes_admin_all ON public.corporate_expense_code_scopes FOR ALL TO authenticated
  USING (public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE POLICY exp_scopes_member_select ON public.corporate_expense_code_scopes FOR SELECT TO authenticated
  USING (
    public.has_corporate_role(auth.uid(), corporate_id, 'corporate_manager')
    OR public.has_corporate_role(auth.uid(), corporate_id, 'corporate_employee')
  );

-- Audit log
CREATE TABLE IF NOT EXISTS public.corporate_expense_code_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  expense_code text NOT NULL,
  action text NOT NULL,
  level public.expense_code_level,
  created_for text,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ip_address text,
  payload jsonb,
  result text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_exp_audit_corp ON public.corporate_expense_code_audit(corporate_id, created_at DESC);

GRANT SELECT, INSERT ON public.corporate_expense_code_audit TO authenticated;
GRANT ALL ON public.corporate_expense_code_audit TO service_role;
ALTER TABLE public.corporate_expense_code_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY exp_audit_admin_select ON public.corporate_expense_code_audit FOR SELECT TO authenticated
  USING (public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE POLICY exp_audit_insert ON public.corporate_expense_code_audit FOR INSERT TO authenticated
  WITH CHECK (public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin') OR public.has_role(auth.uid(),'super_admin'));

-- Trigger to keep updated_at fresh
CREATE TRIGGER trg_exp_codes_updated_at
BEFORE UPDATE ON public.corporate_expense_codes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Validate function used by booking
CREATE OR REPLACE FUNCTION public.validate_expense_code_for_ride(
  _employee_id uuid,
  _expense_code text,
  _at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_emp record;
  v_code record;
  v_has_scope boolean;
BEGIN
  SELECT id, corporate_id, department_id INTO v_emp
  FROM public.corporate_employees WHERE id = _employee_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Employee not found');
  END IF;

  SELECT * INTO v_code FROM public.corporate_expense_codes
  WHERE corporate_id = v_emp.corporate_id AND expense_code = _expense_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Expense code not found');
  END IF;
  IF NOT v_code.active THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Expense code inactive');
  END IF;
  IF v_code.start_time IS NOT NULL AND _at < v_code.start_time THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Expense code not yet active');
  END IF;
  IF v_code.end_time IS NOT NULL AND _at > v_code.end_time THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Expense code expired');
  END IF;
  IF v_code.ride_cap IS NOT NULL AND v_code.rides_used >= v_code.ride_cap THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Ride cap reached');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.corporate_expense_code_scopes s
    WHERE s.expense_code_id = v_code.id AND (
      s.level = 'CORPORATE'
      OR (s.level = 'EMPLOYEE' AND s.employee_id = _employee_id)
      OR (s.level = 'GROUP' AND s.department_id = v_emp.department_id)
    )
  ) INTO v_has_scope;
  IF NOT v_has_scope THEN
    RETURN jsonb_build_object('valid', false, 'message', 'Expense code not allocated to employee');
  END IF;

  RETURN jsonb_build_object('valid', true, 'expense_code_id', v_code.id);
END $$;

GRANT EXECUTE ON FUNCTION public.validate_expense_code_for_ride(uuid, text, timestamptz) TO authenticated, service_role;
