-- 1. driver_analytics_events: enforce ownership on insert
DROP POLICY IF EXISTS "driver analytics insert authenticated" ON public.driver_analytics_events;
CREATE POLICY "driver analytics insert own"
ON public.driver_analytics_events
FOR INSERT
TO authenticated
WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- 2. mpesa_transactions: no client-side inserts; service_role only
DROP POLICY IF EXISTS "insert_own_mpesa_transactions" ON public.mpesa_transactions;
REVOKE INSERT ON public.mpesa_transactions FROM authenticated;
REVOKE INSERT ON public.mpesa_transactions FROM anon;