DROP POLICY IF EXISTS corp_appr_insert_self ON public.corporate_ride_approvals;

CREATE POLICY corp_appr_insert_self
ON public.corporate_ride_approvals
FOR INSERT
TO authenticated
WITH CHECK (
  requested_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.corporate_employees e
    WHERE e.id = corporate_ride_approvals.employee_id
      AND e.user_id = auth.uid()
      AND e.corporate_id = corporate_ride_approvals.corporate_id
      AND e.status = 'active'::corporate_employee_status
  )
);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.wallets FROM anon, authenticated;
REVOKE ALL ON public.wallets FROM anon;
GRANT SELECT ON public.wallets TO authenticated;
GRANT ALL ON public.wallets TO service_role;

DROP POLICY IF EXISTS wallets_no_client_write ON public.wallets;
CREATE POLICY wallets_no_client_write
ON public.wallets
AS RESTRICTIVE
FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (false);

COMMENT ON TABLE public.wallets IS 'Read-only for the owning user (and admins). All wallet creation and balance changes are performed by service_role edge functions / RPCs; client writes are blocked by both privileges and a restrictive policy.';