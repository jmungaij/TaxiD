-- 1. driver_reputation: restrict public read to authenticated users
DROP POLICY IF EXISTS "drep_read" ON public.driver_reputation;
CREATE POLICY "drep_read_authenticated"
ON public.driver_reputation
FOR SELECT
TO authenticated
USING (true);
REVOKE SELECT ON public.driver_reputation FROM anon;
GRANT SELECT ON public.driver_reputation TO authenticated;

-- 2. mpesa_rate_limit_buckets: restrict internal rate limiter state to privileged roles
DROP POLICY IF EXISTS "Authenticated read mpesa rate buckets" ON public.mpesa_rate_limit_buckets;
CREATE POLICY "Admins read mpesa rate buckets"
ON public.mpesa_rate_limit_buckets
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'finance_admin'::app_role)
);
REVOKE SELECT ON public.mpesa_rate_limit_buckets FROM anon;
GRANT ALL ON public.mpesa_rate_limit_buckets TO service_role;