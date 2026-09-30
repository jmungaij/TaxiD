-- Risk-tier remediation: internal worker / orchestrator RPCs must not be
-- reachable by ordinary signed-in users. Each function below performs
-- privileged writes with no in-body authorization check and is only ever
-- invoked by edge functions, cron, or other SECURITY DEFINER functions.
DO $$
DECLARE
  target text;
  r record;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    '_logistics_notify',
    'di00_orch_start', 'di00_orch_step', 'di00_orch_finish',
    'legal_raise_compliance_alert',
    'rec_blueprint_provision',
    'rec_notification_mark_dispatched',
    'social_claim_jobs', 'social_complete_job', 'social_fail_job', 'social_ingest_webhook',
    'st_execution_start', 'st_execution_complete', 'st_run_complete', 'st_evidence_invalidate',
    'sync_role_function_grants'
  ]
  LOOP
    FOR r IN
      SELECT p.oid::regprocedure::text AS sig
      FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = target
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    END LOOP;
  END LOOP;
END $$;