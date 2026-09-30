-- 1. Inject a staff-permission guard into privileged back-office RPCs.
DO $inject$
DECLARE
  r record;
  v_def text;
  v_new text;
  m jsonb := '{
    "capture_charter_financials":"staff.commercial.manage",
    "capture_trip_financials":"staff.commercial.manage",
    "certify_phase_8_5_with_gaps":"staff.commercial.read",
    "charter_wallet_daily_reconciliation":"staff.commercial.manage",
    "commercial_morning_brief":"staff.commercial.read",
    "commercial_revenue_at_risk":"staff.commercial.read",
    "commercial_revenue_explain":"staff.commercial.read",
    "commercial_revenue_integrity":"staff.commercial.read",
    "commercial_transaction_trace":"staff.commercial.read",
    "compute_platform_health":"staff.commercial.read",
    "compute_platform_readiness":"staff.commercial.read",
    "compute_platform_readiness_v2":"staff.commercial.read",
    "create_settlement_obligation":"staff.commercial.manage",
    "emit_eligible_revenue_events":"staff.commercial.manage",
    "escalate_breached_exceptions":"staff.commercial.manage",
    "partner_profile_upsert":"staff.partners.manage",
    "payment_certification_classify_failure":"staff.commercial.read",
    "payment_certification_next_action":"staff.commercial.read",
    "payment_group_alerts":"staff.commercial.read",
    "payment_projection_drift_scan":"staff.commercial.manage",
    "rebuild_commercial_lineage":"staff.commercial.manage",
    "reconcile_settlement_batch":"staff.commercial.manage",
    "run_commercial_money_reconciliation":"staff.commercial.manage",
    "sweep_exception_sla_breaches":"staff.commercial.manage"
  }'::jsonb;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, l.lanname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public' AND m ? p.proname
  LOOP
    IF r.lanname <> 'plpgsql' THEN
      RAISE EXCEPTION 'guard injection expects plpgsql: %', r.proname;
    END IF;
    v_def := pg_get_functiondef(r.oid);
    IF position('require_staff' in v_def) > 0 THEN
      CONTINUE;
    END IF;
    v_new := regexp_replace(
      v_def,
      '(AS \$function\$.*?\mBEGIN\M)',
      '\1' || format(E'\n  PERFORM public.require_staff(%L);', m ->> r.proname)
    );
    IF position('require_staff' in v_new) = 0 THEN
      RAISE EXCEPTION 'guard injection failed for %', r.proname;
    END IF;
    EXECUTE v_new;
  END LOOP;
END;
$inject$;

-- 2. Internal worker / ledger / sequence functions: trusted services only.
DO $lock$
DECLARE
  r record;
  names text[] := ARRAY[
    '_commercial_document_number','_snapshot_surge_zone','acquire_mpesa_token',
    'advance_audit_schedule','advance_report_export_schedule','certify_driver_withdrawal',
    'charter_wallet_apply_funding_callback','charter_wallet_debit',
    'charter_wallet_funding_expire_stale','charter_wallet_record_alert_attempt',
    'charter_wallet_register_stk_attempt','classify_qualification_failure',
    'cleanup_export_audit_log','cleanup_governance_replay_guard','cleanup_mpesa_idempotency_keys',
    'commercial_next_quote_number','comms_claim_dispatch','compute_payment_reliability_score',
    'create_payment_attempt','credit_wallet','credit_wallet_exactly_once','debit_wallet',
    'delete_email','doc_new_security_number','doc_next_number','driver_accrue_tax_for_revenue',
    'driver_withdrawal_certification_recover','email_queue_dispatch','emit_dispatch_approval_alert',
    'enqueue_email','enqueue_event','enqueue_payment_event','ensure_event_store_partition',
    'escalate_overdue_document_slas','exception_escalate','get_or_create_wallet_account',
    'intern_recruitment_certify_cohort','invoke_scheduled_function','mark_export_batch',
    'mark_role_grant_drift_notified','move_to_dlq','nav_registry_log','next_commercial_action_id',
    'next_commercial_transaction_id','next_corporate_invoice_number','next_driver_etims_invoice_number',
    'next_driver_payout_batch_number','next_etims_invoice_number','ops_enqueue_event',
    'ops_enqueue_propagation','ops_sweep_document_expiry','ops_sweep_slas','paf_expire_exceptions',
    'payment_certification_promote_baseline','payment_projection_replay_certify',
    'payment_record_forecast_accuracy','payment_replay_projection','payment_verify_projections',
    'raise_commercial_exception','read_email_batch','rec_comm_next_ref',
    'rec_delivery_confirm_delivered','rec_delivery_mark_failed','rec_enqueue_notification',
    'rec_mig_audit','rec_public_apply_core','rec_seq_code','recompute_driver_achievement_progress',
    'reconcile_settlement_obligation','record_edge_function_invocation','report_export_run_fail',
    'sync_mpesa_transactions_projection','sync_wallet_transactions_projection',
    'training_issue_certificate','transition_payment_state'
  ];
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(names)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', r.proname, r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', r.proname, r.args);
  END LOOP;
END;
$lock$;