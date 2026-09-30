-- Authorization surface conformance: bring live EXECUTE grants back in line with
-- src/lib/security/executeGrantContract.ts. Each function below already proves
-- authority in its own body; removing the anonymous grant is defence in depth
-- (deny-by-default at the database boundary).
DO $$
DECLARE
  r record;
  -- Staff / authenticated business operations: anon revoked, authenticated kept.
  staff_fns text[] := ARRAY[
    'comms_account_upsert','comms_grant_set','comms_import_platform_history',
    'comms_log_access','comms_message_ingest','comms_overview','comms_thread_detail',
    'comms_thread_update','contract_amend','corporate_department_budget_report',
    'crm_log_email_interaction','decide_corporate_ride_request','driver_application_decide',
    'driver_application_document_attach','driver_application_document_review',
    'partner_lead_link_requisition','provider_admin_finance_console',
    'provider_capacity_photos_set','provider_verification_console',
    'provider_verification_history','provider_verification_set',
    'rec_paper_assessment_record','rec_role_assessment_session_open',
    'rec_suitability_determine','request_corporate_ride','rls_helper_integrity',
    'sales_lead_delivery_tracking','staff_dashboard_snapshot','staff_my_team_overview',
    '_provider_payout_tier'
  ];
  -- Internal helpers: no browser role at all.
  internal_fns text[] := ARRAY[
    '_contract_number','_partner_resolve_candidate','_sales_work_ensure_triaged'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY (staff_fns)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY (internal_fns)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;