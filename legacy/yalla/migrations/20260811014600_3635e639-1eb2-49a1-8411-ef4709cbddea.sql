DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'record_lineage_stage','rebuild_commercial_lineage','emit_revenue_event','emit_eligible_revenue_events',
    'create_settlement_obligation','reconcile_settlement_obligation','raise_commercial_exception',
    'run_commercial_money_reconciliation','escalate_breached_exceptions','commercial_revenue_integrity',
    'commercial_morning_brief','commercial_transaction_trace','commercial_revenue_explain',
    'commercial_revenue_at_risk','certify_phase_8_5','check_revenue_eligibility']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM anon, public', p.proname,
                   pg_get_function_identity_arguments(p.oid))
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = fn;
  END LOOP;
END $$;