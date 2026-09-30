-- Enum for expense-limit reset cadence
DO $$ BEGIN
  CREATE TYPE public.designation_limit_period AS ENUM ('weekly','fortnightly','monthly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- corporate_designations
-- ============================================================
CREATE TABLE IF NOT EXISTS public.corporate_designations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id UUID NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  department_id UUID REFERENCES public.corporate_departments(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  expense_limit_cents BIGINT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'KES',
  limit_period public.designation_limit_period NOT NULL DEFAULT 'monthly',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (corporate_id, department_id, title)
);
CREATE INDEX IF NOT EXISTS idx_corp_designations_corp ON public.corporate_designations(corporate_id);
CREATE INDEX IF NOT EXISTS idx_corp_designations_dept ON public.corporate_designations(department_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_designations TO authenticated;
GRANT ALL ON public.corporate_designations TO service_role;

ALTER TABLE public.corporate_designations ENABLE ROW LEVEL SECURITY;

CREATE POLICY corp_desig_member_select ON public.corporate_designations
  FOR SELECT TO authenticated
  USING (
    corporate_id IN (SELECT public.current_user_corporates())
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'super_admin')
  );
CREATE POLICY corp_desig_admin_write ON public.corporate_designations
  FOR ALL TO authenticated
  USING (
    public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin')
    OR public.has_role(auth.uid(),'super_admin')
  )
  WITH CHECK (
    public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin')
    OR public.has_role(auth.uid(),'super_admin')
  );

-- ============================================================
-- corporate_employee_approvers
-- ============================================================
CREATE TABLE IF NOT EXISTS public.corporate_employee_approvers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id UUID NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.corporate_employees(id) ON DELETE CASCADE,
  approver_user_id UUID NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, approver_user_id)
);
CREATE INDEX IF NOT EXISTS idx_corp_emp_approvers_emp ON public.corporate_employee_approvers(employee_id);
CREATE INDEX IF NOT EXISTS idx_corp_emp_approvers_appr ON public.corporate_employee_approvers(approver_user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_employee_approvers TO authenticated;
GRANT ALL ON public.corporate_employee_approvers TO service_role;

ALTER TABLE public.corporate_employee_approvers ENABLE ROW LEVEL SECURITY;

CREATE POLICY corp_emp_appr_select ON public.corporate_employee_approvers
  FOR SELECT TO authenticated
  USING (
    approver_user_id = auth.uid()
    OR employee_id IN (SELECT id FROM public.corporate_employees WHERE user_id = auth.uid())
    OR public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin')
    OR public.has_corporate_role(auth.uid(), corporate_id, 'corporate_manager')
    OR public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'super_admin')
  );
CREATE POLICY corp_emp_appr_admin_write ON public.corporate_employee_approvers
  FOR ALL TO authenticated
  USING (
    public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin')
    OR public.has_role(auth.uid(),'super_admin')
  )
  WITH CHECK (
    public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin')
    OR public.has_role(auth.uid(),'super_admin')
  );

-- updated_at triggers
CREATE TRIGGER trg_corp_designations_updated
  BEFORE UPDATE ON public.corporate_designations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_corp_emp_approvers_updated
  BEFORE UPDATE ON public.corporate_employee_approvers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();