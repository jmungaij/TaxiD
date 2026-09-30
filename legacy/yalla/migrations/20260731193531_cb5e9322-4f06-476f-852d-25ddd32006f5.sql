DROP POLICY IF EXISTS drep_read_authenticated ON public.driver_reputation;

CREATE POLICY drep_read_own_or_privileged
ON public.driver_reputation
FOR SELECT
TO authenticated
USING (
  driver_id = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'operations_admin'::app_role)
  OR public.has_role(auth.uid(), 'compliance_admin'::app_role)
);