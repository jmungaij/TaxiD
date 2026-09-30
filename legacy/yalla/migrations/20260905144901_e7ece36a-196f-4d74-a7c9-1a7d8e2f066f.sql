-- corporate_cash_ledger
DROP POLICY IF EXISTS corp_ledger_read_members ON public.corporate_cash_ledger;
CREATE POLICY corp_ledger_read_admins
ON public.corporate_cash_ledger
FOR SELECT
TO authenticated
USING (
  public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin'::corporate_employee_role)
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'finance_admin'::app_role)
);

-- corporate_financial_reconciliation
DROP POLICY IF EXISTS "Corporate members view own reconciliation" ON public.corporate_financial_reconciliation;
CREATE POLICY "Corporate admins view own reconciliation"
ON public.corporate_financial_reconciliation
FOR SELECT
TO authenticated
USING (
  public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin'::corporate_employee_role)
);

-- reconciliation_cases
DROP POLICY IF EXISTS "Corporate members view own cases" ON public.reconciliation_cases;
CREATE POLICY "Corporate admins view own cases"
ON public.reconciliation_cases
FOR SELECT
TO authenticated
USING (
  corporate_id IS NOT NULL
  AND public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin'::corporate_employee_role)
);

-- wallet_freezes
DROP POLICY IF EXISTS "Corporates view own freezes" ON public.wallet_freezes;
CREATE POLICY "Corporate admins view own freezes"
ON public.wallet_freezes
FOR SELECT
TO authenticated
USING (
  corporate_id IS NOT NULL
  AND public.has_corporate_role(auth.uid(), corporate_id, 'corporate_admin'::corporate_employee_role)
);
