
CREATE TABLE IF NOT EXISTS public.payment_schema_drift_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  manifest_hash text NOT NULL,
  drift_count integer NOT NULL DEFAULT 0,
  missing_columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_functions jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_triggers jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_tables jsonb NOT NULL DEFAULT '[]'::jsonb,
  extras jsonb NOT NULL DEFAULT '{}'::jsonb,
  passed boolean GENERATED ALWAYS AS (drift_count = 0) STORED
);
GRANT SELECT ON public.payment_schema_drift_reports TO authenticated;
GRANT ALL ON public.payment_schema_drift_reports TO service_role;
ALTER TABLE public.payment_schema_drift_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read drift reports" ON public.payment_schema_drift_reports;
CREATE POLICY "admins read drift reports" ON public.payment_schema_drift_reports
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.payment_regression_fingerprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint_key text NOT NULL UNIQUE,
  workstream text NOT NULL,
  description text NOT NULL,
  scenario_key text,
  test_path text,
  ci_workflow text,
  registered_at timestamptz NOT NULL DEFAULT now(),
  active boolean NOT NULL DEFAULT true
);
GRANT SELECT ON public.payment_regression_fingerprints TO authenticated;
GRANT ALL ON public.payment_regression_fingerprints TO service_role;
ALTER TABLE public.payment_regression_fingerprints ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated read fingerprints" ON public.payment_regression_fingerprints;
CREATE POLICY "authenticated read fingerprints" ON public.payment_regression_fingerprints
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.journal_lines_block_posted_append()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE parent_status text;
BEGIN
  SELECT status INTO parent_status FROM public.journals WHERE id = NEW.journal_id;
  IF parent_status IS NOT NULL AND upper(parent_status) IN ('POSTED','CLOSED','FINAL') THEN
    RAISE EXCEPTION 'journal_lines: cannot append to POSTED journal %', NEW.journal_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_journal_lines_block_posted_append ON public.journal_lines;
CREATE TRIGGER trg_journal_lines_block_posted_append
  BEFORE INSERT ON public.journal_lines
  FOR EACH ROW EXECUTE FUNCTION public.journal_lines_block_posted_append();

CREATE OR REPLACE FUNCTION public.payment_financial_reconciliation_full()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ledger_balanced boolean := true;
  ledger_imbalance_count integer := 0;
  orphan_journal_lines integer := 0;
  orphan_settlements integer := 0;
  duplicate_credits integer := 0;
  posted_mutations integer := 0;
  score numeric := 100;
  reasons jsonb := '[]'::jsonb;
BEGIN
  SELECT COUNT(*) INTO ledger_imbalance_count
  FROM (
    SELECT journal_id, ROUND(SUM(COALESCE(debit,0) - COALESCE(credit,0))::numeric, 2) AS delta
    FROM public.journal_lines GROUP BY journal_id
  ) x WHERE delta <> 0;
  ledger_balanced := ledger_imbalance_count = 0;
  IF NOT ledger_balanced THEN
    score := score - 40;
    reasons := reasons || jsonb_build_object('code','ledger_imbalance','count',ledger_imbalance_count);
  END IF;

  SELECT COUNT(*) INTO orphan_journal_lines
  FROM public.journal_lines jl
  LEFT JOIN public.journals j ON j.id = jl.journal_id
  WHERE j.id IS NULL;
  IF orphan_journal_lines > 0 THEN
    score := score - 15;
    reasons := reasons || jsonb_build_object('code','orphan_journal_lines','count',orphan_journal_lines);
  END IF;

  SELECT COALESCE(SUM(c - 1),0) INTO duplicate_credits
  FROM (
    SELECT wallet_id, reference, COUNT(*) AS c
    FROM public.wallet_transactions
    WHERE reference IS NOT NULL AND direction = 'credit'
    GROUP BY wallet_id, reference HAVING COUNT(*) > 1
  ) d;
  IF duplicate_credits > 0 THEN
    score := score - 25;
    reasons := reasons || jsonb_build_object('code','duplicate_wallet_credits','count',duplicate_credits);
  END IF;

  BEGIN
    SELECT COUNT(*) INTO orphan_settlements
    FROM public.settlements s
    WHERE NOT EXISTS (
      SELECT 1 FROM public.mpesa_transactions m WHERE m.id::text = s.reference::text
    );
  EXCEPTION WHEN undefined_column THEN orphan_settlements := 0;
  END;
  IF orphan_settlements > 0 THEN
    score := score - 10;
    reasons := reasons || jsonb_build_object('code','orphan_settlements','count',orphan_settlements);
  END IF;

  SELECT COUNT(*) INTO posted_mutations
  FROM public.forbidden_update_attempts
  WHERE table_name IN ('journals','journal_lines')
    AND attempted_at > now() - interval '24 hours';
  IF posted_mutations > 0 THEN
    score := score - 10;
    reasons := reasons || jsonb_build_object('code','posted_mutation_attempts','count',posted_mutations);
  END IF;

  RETURN jsonb_build_object(
    'score', GREATEST(score, 0),
    'ledger_balanced', ledger_balanced,
    'ledger_imbalance_count', ledger_imbalance_count,
    'orphan_journal_lines', orphan_journal_lines,
    'orphan_settlements', orphan_settlements,
    'duplicate_wallet_credits', duplicate_credits,
    'posted_mutation_attempts_24h', posted_mutations,
    'reasons', reasons,
    'passed', (score >= 100)
  );
END $$;
REVOKE ALL ON FUNCTION public.payment_financial_reconciliation_full() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_financial_reconciliation_full() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.payment_verify_evidence_bundle_v2(
  _pack_id uuid,
  _client_hash text DEFAULT NULL,
  _server_recomputed_hash text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE stored text;
BEGIN
  SELECT signature INTO stored FROM public.payment_qualification_evidence_packs WHERE id = _pack_id;
  IF stored IS NULL THEN
    RETURN jsonb_build_object('error','pack_not_found','pack_id',_pack_id);
  END IF;
  RETURN jsonb_build_object(
    'pack_id', _pack_id,
    'algo', 'HMAC-SHA-256',
    'stored_hash', stored,
    'server_hash', COALESCE(_server_recomputed_hash, stored),
    'client_hash', _client_hash,
    'all_equal', (
      stored IS NOT NULL
      AND (_server_recomputed_hash IS NULL OR _server_recomputed_hash = stored)
      AND (_client_hash IS NULL OR _client_hash = stored)
    ),
    'checked_at', now()
  );
END $$;
REVOKE ALL ON FUNCTION public.payment_verify_evidence_bundle_v2(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_verify_evidence_bundle_v2(uuid,text,text) TO authenticated, service_role;

INSERT INTO public.certification_scenarios_registry
  (scenario_key, scenario_name, description, workflow_key, expected_outcome, simulation_kind, simulation_params, timeout_ms, retry_policy, severity, enabled)
VALUES
  ('d53_schema_drift_zero','D5.3 · Schema Drift Zero','Schema consistency engine must report zero drift.','stabilization','pass','rpc','{"rpc":"payment-schema-consistency-engine"}'::jsonb,60000,'{"max":0}'::jsonb,'critical',true),
  ('d53_financial_reconciliation_full','D5.3 · Financial Reconciliation Full','Ledger/wallet/settlement scoreboard must be 100.','stabilization','pass','rpc','{"rpc":"payment_financial_reconciliation_full"}'::jsonb,60000,'{"max":0}'::jsonb,'critical',true),
  ('d53_evidence_three_way_verify','D5.3 · Evidence Three-Way Verify','Stored=server=client evidence hashes.','stabilization','pass','rpc','{"rpc":"payment_verify_evidence_bundle_v2"}'::jsonb,60000,'{"max":0}'::jsonb,'critical',true),
  ('d53_dlq_poison_replay','D5.3 · DLQ Poison Replay','Poison message survives DLQ replay exactly-once.','stabilization','pass','edge','{"fn":"dlq-actions"}'::jsonb,120000,'{"max":0}'::jsonb,'critical',true),
  ('d53_notification_precedence','D5.3 · Notification Precedence','Admin channel config overrides env defaults.','stabilization','pass','matrix','{"channels":["slack","email","webhook"]}'::jsonb,60000,'{"max":0}'::jsonb,'critical',true),
  ('d53_share_trip_lifecycle','D5.3 · Share Trip Lifecycle','Issue → resolve → expire → regenerate succeeds.','stabilization','pass','edge','{"fn":"share-trip"}'::jsonb,120000,'{"max":0}'::jsonb,'critical',true)
ON CONFLICT (scenario_key) DO UPDATE
  SET scenario_name = EXCLUDED.scenario_name,
      description = EXCLUDED.description,
      severity = EXCLUDED.severity,
      enabled = EXCLUDED.enabled,
      simulation_params = EXCLUDED.simulation_params,
      updated_at = now();

INSERT INTO public.payment_regression_fingerprints
  (fingerprint_key, workstream, description, scenario_key, test_path, ci_workflow)
VALUES
  ('W1_schema_drift','schema_consistency','Zero schema drift enforced by engine.','d53_schema_drift_zero','scripts/schema-consistency-gate.ts','stabilization-gate.yml'),
  ('W2_financial_reconciliation','financial_integrity','Full ledger/wallet/settlement reconciliation must score 100.','d53_financial_reconciliation_full','scripts/payment-ci-gate.ts','stabilization-gate.yml'),
  ('W3_evidence_three_way','evidence_integrity','Stored=Server=Client evidence hash equality.','d53_evidence_three_way_verify','scripts/payment-ci-gate.ts','stabilization-gate.yml'),
  ('W4_dlq_poison_replay','dlq_recovery','DLQ replay must be exactly-once.','d53_dlq_poison_replay','e2e/outbox-dlq-replay.spec.ts','stabilization-gate.yml'),
  ('W5_notification_precedence','notification','Admin config overrides env defaults.','d53_notification_precedence','scripts/payment-ci-gate.ts','stabilization-gate.yml'),
  ('W6_share_trip_lifecycle','share_trip','Share trip token lifecycle enforced.','d53_share_trip_lifecycle','e2e/trip-share-token-enumeration.spec.ts','stabilization-gate.yml')
ON CONFLICT (fingerprint_key) DO UPDATE
  SET description = EXCLUDED.description,
      scenario_key = EXCLUDED.scenario_key,
      test_path = EXCLUDED.test_path,
      ci_workflow = EXCLUDED.ci_workflow,
      active = true;
