DO $migration$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.proname = ANY (ARRAY[
      'credit_wallet','credit_wallet_exactly_once','debit_wallet','charter_wallet_debit','charter_wallet_apply_funding_callback','get_or_create_wallet_account','create_payment_attempt','transition_payment_state','enqueue_payment_event','payment_replay_projection','payment_verify_projections','payment_projection_replay_certify','payment_certification_promote_baseline','sync_mpesa_transactions_projection','sync_wallet_transactions_projection','reconcile_settlement_obligation','driver_accrue_tax_for_revenue','certify_driver_withdrawal','training_issue_certificate','acquire_mpesa_token','invoke_scheduled_function','enqueue_email','read_email_batch','delete_email','email_queue_dispatch','comms_claim_dispatch','rec_enqueue_notification','next_corporate_invoice_number','next_etims_invoice_number','next_driver_etims_invoice_number','next_driver_payout_batch_number','next_commercial_transaction_id','next_commercial_action_id','commercial_next_quote_number','doc_next_number','doc_new_security_number','rec_seq_code','move_to_dlq','ops_enqueue_event','ops_enqueue_propagation','logistics_event_emit','logistics_event_emit_internal','logistics_webhook_claim_deliveries','logistics_webhook_record_attempt','logistics_order_context','logistics_api_authenticate','logistics_api_entitled_tenants','logistics_api_can_see_order','logistics_api_order','logistics_api_package','logistics_api_tracking','logistics_api_route','logistics_api_delivery_attempt','logistics_api_pod','logistics_api_return','logistics_api_exceptions','logistics_api_create_order','logistics_api_create_return','logistics_api_rate_check','logistics_api_idempotency_begin','logistics_api_idempotency_complete','logistics_api_log_request','_freight_audit','_freight_seq','capacity_expiry_sweep','freight_tender_expiry_sweep','_lg_offline_apply','_lg_offline_conflict','lg_offline_worker_tick','ct_alert_raise','ct_emit_command_event','di00_record_health','di00_backup_complete','di00_restore_complete','di00_fixture_complete','di00_action_validate','infra_log','st_execution_start','st_execution_complete','st_run_complete','st_evidence_invalidate','_logistics_notify','di00_orch_start','di00_orch_step','di00_orch_finish','legal_raise_compliance_alert','rec_blueprint_provision','rec_notification_mark_dispatched','social_claim_jobs','social_complete_job','social_fail_job','social_ingest_webhook','sync_role_function_grants'
      ]::text[])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.signature);
  END LOOP;
END
$migration$;