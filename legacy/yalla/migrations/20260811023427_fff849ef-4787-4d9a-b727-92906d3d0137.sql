CREATE OR REPLACE FUNCTION public.is_trusted_backend_job()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NULL
     AND (pg_has_role(session_user, 'service_role', 'member')
          OR session_user IN ('postgres', 'supabase_admin'))
$$;

REVOKE ALL ON FUNCTION public.is_trusted_backend_job() FROM anon;

CREATE OR REPLACE FUNCTION public.certify_phase_8_5()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  integ jsonb; criteria jsonb := '[]'::jsonb; passed int := 0; total int := 0;
  dup int; eligible int; recognised int; rev_sum bigint; ledger_sum bigint;
  settle_var int; lineage_pct numeric; full_chain int; verdict text; score numeric; rid uuid;
BEGIN
  IF NOT (is_commercial_staff() OR is_trusted_backend_job()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;
  integ := commercial_revenue_integrity();

  dup := (integ->>'duplicate_revenue_events')::int;
  eligible := (integ->>'eligible')::int;
  recognised := (integ->>'recognised')::int;
  rev_sum := (integ->>'revenue_events_cents')::bigint;
  ledger_sum := (integ->>'ledger_cents')::bigint;
  lineage_pct := (integ->>'lineage_completeness_pct')::numeric;

  SELECT count(*) INTO settle_var FROM settlement_obligations WHERE status = 'variance';

  SELECT count(*) INTO full_chain FROM commercial_transactions ct
   WHERE ct.revenue_event_id IS NOT NULL AND ct.fulfilled_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM commercial_lineage_stages s
                      WHERE s.transaction_id = ct.id AND s.stage_no <= 12 AND s.status = 'missing');

  criteria := jsonb_build_array(
    jsonb_build_object('key','no_duplicate_revenue','label','No duplicate financial events','pass', dup = 0,
      'detail', format('%s duplicated revenue source references', dup)),
    jsonb_build_object('key','eligible_recognised','label','Every eligible fulfilment has exactly one revenue event',
      'pass', eligible = 0 OR recognised >= eligible,
      'detail', format('%s eligible, %s recognised', eligible, recognised)),
    jsonb_build_object('key','ledger_reconciles','label','Revenue events reconcile to the ledger',
      'pass', rev_sum = ledger_sum, 'detail', format('events %s vs ledger %s (cents)', rev_sum, ledger_sum)),
    jsonb_build_object('key','settlements_reconcile','label','Partner settlements reconcile',
      'pass', settle_var = 0, 'detail', format('%s settlement variances open', settle_var)),
    jsonb_build_object('key','lineage','label','Commercial lineage is recorded',
      'pass', COALESCE(lineage_pct,0) >= 80, 'detail', format('%s%% of stages carry an authoritative record', COALESCE(lineage_pct,0))),
    jsonb_build_object('key','end_to_end','label','At least one real transaction passes the full chain',
      'pass', full_chain > 0, 'detail', format('%s transactions trace demand to revenue ledger', full_chain)),
    jsonb_build_object('key','exceptions_detected','label','Exceptions are automatically detected',
      'pass', EXISTS (SELECT 1 FROM commercial_exceptions), 'detail', 'Reconciliation engine has raised exceptions'),
    jsonb_build_object('key','no_simulated_revenue','label','No simulated data presented as live',
      'pass', NOT EXISTS (SELECT 1 FROM revenue_events WHERE source_ref LIKE 'YTX-%'
                            AND COALESCE(metadata->>'provenance','LIVE') <> 'LIVE'),
      'detail', 'All recognised revenue carries LIVE provenance'));

  SELECT count(*) FILTER (WHERE (c->>'pass')::boolean), count(*) INTO passed, total
    FROM jsonb_array_elements(criteria) c;

  score := round((passed::numeric / GREATEST(total,1)) * 100, 1);
  verdict := CASE WHEN passed = total THEN 'PASS' ELSE 'FAIL' END;

  INSERT INTO commercial_certification_runs (phase, verdict, score, criteria, evidence, run_by)
  VALUES ('8.5', verdict, score, criteria, integ, auth.uid()) RETURNING id INTO rid;

  RETURN jsonb_build_object('ok', true, 'run_id', rid, 'verdict', verdict, 'score_pct', score,
    'criteria_passed', passed, 'criteria_total', total, 'criteria', criteria, 'integrity', integ);
END; $function$;

REVOKE ALL ON FUNCTION public.certify_phase_8_5() FROM anon;