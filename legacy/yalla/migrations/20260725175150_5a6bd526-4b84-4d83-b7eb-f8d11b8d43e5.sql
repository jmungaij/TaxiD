-- P0 perf: composite index for hottest query (payment_orchestrator_decisions ORDER BY decided_at DESC filtered by action)
CREATE INDEX IF NOT EXISTS idx_orch_decisions_action_decided_at
  ON public.payment_orchestrator_decisions (action, decided_at DESC);

-- P0 security hardening: explicit deny-by-default INSERT policy on trip_share_access_log.
-- Edge functions already write via service_role (bypasses RLS); this makes intent explicit
-- and prevents any accidental future GRANT from allowing client-side writes.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='trip_share_access_log' AND cmd='INSERT'
  ) THEN
    EXECUTE $p$CREATE POLICY "Deny client inserts to trip_share_access_log"
      ON public.trip_share_access_log FOR INSERT TO authenticated, anon
      WITH CHECK (false)$p$;
  END IF;
END $$;