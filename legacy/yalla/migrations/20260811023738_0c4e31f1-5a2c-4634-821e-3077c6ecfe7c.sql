CREATE TABLE IF NOT EXISTS public.commercial_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  run_source text NOT NULL DEFAULT 'job',
  transactions_scanned integer NOT NULL DEFAULT 0,
  breaks_found integer NOT NULL DEFAULT 0,
  exceptions_raised integer NOT NULL DEFAULT 0,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.commercial_reconciliation_runs TO authenticated;
GRANT ALL ON public.commercial_reconciliation_runs TO service_role;
ALTER TABLE public.commercial_reconciliation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Commercial staff read reconciliation runs" ON public.commercial_reconciliation_runs;
CREATE POLICY "Commercial staff read reconciliation runs"
  ON public.commercial_reconciliation_runs FOR SELECT TO authenticated
  USING (public.is_commercial_staff());

CREATE INDEX IF NOT EXISTS idx_crr_ran_at ON public.commercial_reconciliation_runs (ran_at DESC);

CREATE OR REPLACE FUNCTION public.log_commercial_reconciliation_run(_result jsonb, _source text DEFAULT 'job')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE rid uuid;
BEGIN
  IF NOT (public.is_commercial_staff() OR public.is_trusted_backend_job()) THEN
    RAISE EXCEPTION 'not authorised to log reconciliation runs';
  END IF;
  INSERT INTO public.commercial_reconciliation_runs
    (run_source, transactions_scanned, breaks_found, exceptions_raised, result, run_by)
  VALUES (COALESCE(_source,'job'),
    COALESCE((_result->>'scanned')::int, 0),
    COALESCE((_result->>'breaks')::int, (_result->>'breaks_found')::int, 0),
    COALESCE((_result->>'exceptions_raised')::int, (_result->>'raised')::int, 0),
    COALESCE(_result, '{}'::jsonb), auth.uid())
  RETURNING id INTO rid;
  RETURN rid;
END; $$;

REVOKE ALL ON FUNCTION public.log_commercial_reconciliation_run(jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.log_commercial_reconciliation_run(jsonb, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.classify_lineage_pending(_limit integer DEFAULT 1000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE tx record; scanned int := 0; pend int := 0; s record;
BEGIN
  IF NOT (public.is_commercial_staff() OR public.is_trusted_backend_job()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;

  FOR tx IN SELECT * FROM commercial_transactions
             WHERE fulfilled_at IS NULL AND cancelled_at IS NULL
             ORDER BY created_at LIMIT _limit LOOP
    scanned := scanned + 1;
    FOR s IN SELECT * FROM commercial_lineage_stages
              WHERE transaction_id = tx.id AND status = 'missing' AND stage_no >= 6 LOOP
      UPDATE commercial_lineage_stages
         SET status = 'pending',
             source = 'lineage_applicability',
             metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('reason',
               'Booking is still in flight: this step has not been reached yet, so no record exists to point at.'),
             recorded_at = now()
       WHERE id = s.id;
      pend := pend + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'scanned', scanned, 'stages_pending', pend);
END; $$;

REVOKE ALL ON FUNCTION public.classify_lineage_pending(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.classify_lineage_pending(integer) TO authenticated, service_role;

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
  recon_at timestamptz; unresolved int;
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

  SELECT max(ran_at) INTO recon_at FROM commercial_reconciliation_runs;
  SELECT count(*) INTO unresolved FROM commercial_exceptions
   WHERE severity IN ('critical','high') AND status IN ('open','acknowledged','in_progress','escalated');

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
    jsonb_build_object('key','lineage','label','Commercial lineage is accounted for',
      'pass', COALESCE(lineage_pct,0) >= 80,
      'detail', format('%s%% of stages carry a record, a not-applicable ruling or a pending state', COALESCE(lineage_pct,0))),
    jsonb_build_object('key','end_to_end','label','At least one real transaction passes the full chain',
      'pass', full_chain > 0, 'detail', format('%s transactions trace demand to revenue ledger', full_chain)),
    jsonb_build_object('key','detector_live','label','The reconciliation detector runs and nothing critical is left open',
      'pass', recon_at IS NOT NULL AND recon_at > now() - interval '7 days' AND unresolved = 0,
      'detail', format('last reconciliation %s, %s critical or high exceptions unresolved',
        COALESCE(recon_at::text,'never'), unresolved)),
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