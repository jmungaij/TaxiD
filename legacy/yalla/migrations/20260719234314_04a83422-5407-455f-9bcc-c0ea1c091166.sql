
-- ============================================================
-- Phase D5.1 — Production Qualification & Financial Integrity
-- ============================================================

-- ---------- 1. Helper columns ----------

ALTER TABLE public.journals
  ADD COLUMN IF NOT EXISTS reversal_reason text;

ALTER TABLE public.journal_lines
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.fraud_alerts
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.forbidden_update_attempts
  ADD COLUMN IF NOT EXISTS actor_role text;

-- Wallet lifecycle status
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wallet_lifecycle_status') THEN
    CREATE TYPE public.wallet_lifecycle_status AS ENUM ('ACTIVE','CLOSED');
  END IF;
END $$;

ALTER TABLE public.wallets
  ADD COLUMN IF NOT EXISTS lifecycle_status public.wallet_lifecycle_status NOT NULL DEFAULT 'ACTIVE';

-- ---------- 2. Current user primary role helper ----------

CREATE OR REPLACE FUNCTION public.current_user_primary_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::text
  FROM public.user_roles
  WHERE user_id = auth.uid()
  ORDER BY CASE role::text
    WHEN 'super_admin' THEN 0
    WHEN 'admin' THEN 1
    WHEN 'finance_admin' THEN 2
    WHEN 'operations_admin' THEN 3
    WHEN 'compliance_admin' THEN 4
    ELSE 9
  END
  LIMIT 1
$$;

-- Backfill forbidden_update_attempts.actor_role from existing user_roles
UPDATE public.forbidden_update_attempts f
SET actor_role = ur.role::text
FROM public.user_roles ur
WHERE f.actor_role IS NULL
  AND ur.user_id = f.actor_user_id;

-- ---------- 3. Journal immutability triggers ----------

CREATE OR REPLACE FUNCTION public.tg_journal_immutable_after_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'POSTED' THEN
      RAISE EXCEPTION 'Journal % is POSTED and cannot be deleted (use reversal journal)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'POSTED' THEN
    -- Only allow the reversal linkage flip to REVERSED, nothing else may change
    IF NEW.status = 'REVERSED'
       AND NEW.source = OLD.source
       AND NEW.reference IS NOT DISTINCT FROM OLD.reference
       AND NEW.description IS NOT DISTINCT FROM OLD.description
       AND NEW.posted_at IS NOT DISTINCT FROM OLD.posted_at
       AND NEW.posted_by IS NOT DISTINCT FROM OLD.posted_by
       AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
       AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
       AND NEW.batch_id IS NOT DISTINCT FROM OLD.batch_id
    THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Journal % is POSTED and immutable. Create a reversal journal instead.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_journal_immutable_after_post ON public.journals;
CREATE TRIGGER tg_journal_immutable_after_post
  BEFORE UPDATE OR DELETE ON public.journals
  FOR EACH ROW EXECUTE FUNCTION public.tg_journal_immutable_after_post();

CREATE OR REPLACE FUNCTION public.tg_journal_lines_frozen_after_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  parent_status text;
  target_journal uuid;
BEGIN
  target_journal := COALESCE(NEW.journal_id, OLD.journal_id);
  SELECT status::text INTO parent_status FROM public.journals WHERE id = target_journal;
  IF parent_status = 'POSTED' THEN
    RAISE EXCEPTION 'journal_lines for POSTED journal % are immutable', target_journal
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tg_journal_lines_frozen_after_post ON public.journal_lines;
CREATE TRIGGER tg_journal_lines_frozen_after_post
  BEFORE INSERT OR UPDATE OR DELETE ON public.journal_lines
  FOR EACH ROW EXECUTE FUNCTION public.tg_journal_lines_frozen_after_post();

-- ---------- 4. Wallet no-delete-with-activity trigger ----------

CREATE OR REPLACE FUNCTION public.tg_wallet_no_delete_with_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.wallet_transactions WHERE wallet_id = OLD.id) THEN
    RAISE EXCEPTION 'Wallet % has transactions and cannot be deleted (close it instead)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tg_wallet_no_delete_with_activity ON public.wallets;
CREATE TRIGGER tg_wallet_no_delete_with_activity
  BEFORE DELETE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.tg_wallet_no_delete_with_activity();

-- ---------- 5. post_reversal_journal RPC ----------

CREATE OR REPLACE FUNCTION public.post_reversal_journal(
  _original_id uuid,
  _reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  orig public.journals%ROWTYPE;
  new_id uuid;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
      ARRAY['super_admin','admin','finance_admin']::app_role[])
     AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'insufficient privileges';
  END IF;

  SELECT * INTO orig FROM public.journals WHERE id = _original_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'journal % not found', _original_id; END IF;
  IF orig.status <> 'POSTED' THEN RAISE EXCEPTION 'only POSTED journals can be reversed'; END IF;

  INSERT INTO public.journals (source, reference, description, status, reverses_journal_id, reversal_reason, created_by)
  VALUES (orig.source, 'REV-' || COALESCE(orig.reference, orig.id::text),
          'Reversal of ' || orig.id::text || ': ' || _reason,
          'DRAFT', orig.id, _reason, auth.uid())
  RETURNING id INTO new_id;

  INSERT INTO public.journal_lines (journal_id, account_id, direction, amount_cents, currency, transaction_id, memo, metadata)
  SELECT new_id, account_id,
         CASE direction WHEN 'DEBIT'::ledger_direction THEN 'CREDIT'::ledger_direction ELSE 'DEBIT'::ledger_direction END,
         amount_cents, currency, transaction_id,
         'Reversal of line ' || id::text,
         jsonb_build_object('reverses_line_id', id)
  FROM public.journal_lines WHERE journal_id = _original_id;

  -- Flip the flag on the original (allowed by trigger since only status→REVERSED)
  UPDATE public.journals SET status = 'REVERSED' WHERE id = _original_id;

  RETURN new_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_reversal_journal(uuid, text) TO authenticated, service_role;

-- ---------- 6. Freeze policy: stabilization_mode ----------

INSERT INTO public.platform_settings (id, brand_name, feature_flags)
SELECT gen_random_uuid(), 'Yalla Ride', '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.platform_settings);

UPDATE public.platform_settings
SET feature_flags = feature_flags || jsonb_build_object('stabilization_mode', true)
WHERE (feature_flags->>'stabilization_mode') IS NULL;

CREATE OR REPLACE FUNCTION public.is_stabilization_mode()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((feature_flags->>'stabilization_mode')::boolean, false)
  FROM public.platform_settings
  ORDER BY created_at ASC
  LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.is_stabilization_mode() TO authenticated, anon, service_role;

-- Block orchestrator promotion while stabilization mode is on
CREATE OR REPLACE FUNCTION public.tg_orchestrator_freeze_promotion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_stabilization_mode()
     AND NEW.rollout_percent IS DISTINCT FROM OLD.rollout_percent
     AND NEW.rollout_percent > OLD.rollout_percent THEN
    RAISE EXCEPTION 'STABILIZATION_MODE is active — orchestrator promotion is frozen';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='payment_orchestrator_flag'
               AND column_name='rollout_percent') THEN
    DROP TRIGGER IF EXISTS tg_orchestrator_freeze_promotion ON public.payment_orchestrator_flag;
    CREATE TRIGGER tg_orchestrator_freeze_promotion
      BEFORE UPDATE ON public.payment_orchestrator_flag
      FOR EACH ROW EXECUTE FUNCTION public.tg_orchestrator_freeze_promotion();
  END IF;
END $$;

-- ---------- 7. DLQ operator-actions audit ----------

CREATE TABLE IF NOT EXISTS public.event_outbox_dlq_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dlq_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('replay','retry','discard','quarantine','bulk_replay')),
  reason text,
  actor_user_id uuid,
  actor_role text,
  correlation_id text,
  outcome text NOT NULL DEFAULT 'accepted',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dlq_actions_dlq ON public.event_outbox_dlq_actions(dlq_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dlq_actions_actor ON public.event_outbox_dlq_actions(actor_user_id, created_at DESC);

GRANT SELECT ON public.event_outbox_dlq_actions TO authenticated;
GRANT ALL ON public.event_outbox_dlq_actions TO service_role;

ALTER TABLE public.event_outbox_dlq_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY dlq_actions_admin_read ON public.event_outbox_dlq_actions
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['admin','super_admin','operations_admin','finance_admin']::app_role[]));

CREATE POLICY dlq_actions_service_write ON public.event_outbox_dlq_actions
  FOR INSERT TO service_role WITH CHECK (true);

-- Deny UPDATE/DELETE outright (append-only)
CREATE OR REPLACE FUNCTION public.tg_dlq_actions_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'event_outbox_dlq_actions is append-only';
END $$;

DROP TRIGGER IF EXISTS tg_dlq_actions_append_only ON public.event_outbox_dlq_actions;
CREATE TRIGGER tg_dlq_actions_append_only
  BEFORE UPDATE OR DELETE ON public.event_outbox_dlq_actions
  FOR EACH ROW EXECUTE FUNCTION public.tg_dlq_actions_append_only();

-- ---------- 8. Evidence envelope columns ----------

ALTER TABLE public.payment_evidence_exports
  ADD COLUMN IF NOT EXISTS canonical_payload_sha256 text,
  ADD COLUMN IF NOT EXISTS signature_sha256 text,
  ADD COLUMN IF NOT EXISTS canonicalization_version text,
  ADD COLUMN IF NOT EXISTS signing_key_id text,
  ADD COLUMN IF NOT EXISTS migration_version text,
  ADD COLUMN IF NOT EXISTS runner_version text,
  ADD COLUMN IF NOT EXISTS verification_verdict text,
  ADD COLUMN IF NOT EXISTS verification_last_at timestamptz;

CREATE OR REPLACE FUNCTION public.payment_verify_evidence_bundle(
  _export_id uuid,
  _client_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec public.payment_evidence_exports%ROWTYPE;
  server_hash text;
  verdict text;
BEGIN
  IF NOT public.has_any_role(auth.uid(),
     ARRAY['admin','super_admin','finance_admin','operations_admin','compliance_admin']::app_role[]) THEN
    RAISE EXCEPTION 'insufficient privileges';
  END IF;

  SELECT * INTO rec FROM public.payment_evidence_exports WHERE id = _export_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'export not found'; END IF;

  server_hash := encode(digest(rec.bundle::text, 'sha256'), 'hex');

  verdict := CASE
    WHEN server_hash = rec.canonical_payload_sha256
     AND server_hash = _client_hash
     AND rec.canonical_payload_sha256 IS NOT NULL
    THEN 'PASS'
    ELSE 'INVALID'
  END;

  UPDATE public.payment_evidence_exports
     SET verification_verdict = verdict, verification_last_at = now()
   WHERE id = _export_id;

  IF verdict = 'INVALID' THEN
    INSERT INTO public.payment_alerts (severity, category, title, message, metadata)
    VALUES ('CRITICAL','evidence_integrity','Evidence 3-way SHA mismatch',
            'Export '||_export_id::text||' failed three-way verification',
            jsonb_build_object('server_hash',server_hash,'stored_hash',rec.canonical_payload_sha256,'client_hash',_client_hash));
  END IF;

  RETURN jsonb_build_object(
    'server_hash', server_hash,
    'stored_hash', rec.canonical_payload_sha256,
    'client_hash', _client_hash,
    'verdict', verdict
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.payment_verify_evidence_bundle(uuid, text) TO authenticated, service_role;

-- ---------- 9. Stability windows ----------

CREATE TABLE IF NOT EXISTS public.payment_stability_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  callback_success_pct numeric NOT NULL DEFAULT 0,
  regressions_count integer NOT NULL DEFAULT 0,
  financial_integrity_score numeric NOT NULL DEFAULT 0,
  evidence_integrity_score numeric NOT NULL DEFAULT 0,
  schema_consistency_score numeric NOT NULL DEFAULT 0,
  continuous_qualification_pass_rate numeric NOT NULL DEFAULT 0,
  critical_incidents integer NOT NULL DEFAULT 0,
  stability_score numeric NOT NULL DEFAULT 0,
  gate_status text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stability_windows_end ON public.payment_stability_windows(window_end DESC);

GRANT SELECT ON public.payment_stability_windows TO authenticated;
GRANT ALL ON public.payment_stability_windows TO service_role;

ALTER TABLE public.payment_stability_windows ENABLE ROW LEVEL SECURITY;

CREATE POLICY stability_windows_read ON public.payment_stability_windows
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(),
    ARRAY['admin','super_admin','operations_admin','finance_admin','compliance_admin']::app_role[]));

CREATE POLICY stability_windows_service_write ON public.payment_stability_windows
  FOR INSERT TO service_role WITH CHECK (true);

-- ---------- 10. Financial integrity + stability scoring RPCs ----------

CREATE OR REPLACE FUNCTION public.payment_financial_integrity_score()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ledger_balanced boolean;
  wallet_reconciled_pct numeric;
  orphan_wallet_txn integer;
  total_wallets integer;
  matching_wallets integer;
  score numeric;
BEGIN
  SELECT NOT EXISTS (
    SELECT 1
    FROM (
      SELECT j.id,
             SUM(CASE WHEN jl.direction = 'DEBIT' THEN jl.amount_cents ELSE 0 END) AS d,
             SUM(CASE WHEN jl.direction = 'CREDIT' THEN jl.amount_cents ELSE 0 END) AS c
      FROM public.journals j
      JOIN public.journal_lines jl ON jl.journal_id = j.id
      WHERE j.status = 'POSTED'
      GROUP BY j.id
    ) x
    WHERE d <> c
  ) INTO ledger_balanced;

  SELECT COUNT(*) INTO total_wallets FROM public.wallets;
  SELECT COUNT(*) INTO matching_wallets
  FROM public.wallets w
  LEFT JOIN (
    SELECT wallet_id, COALESCE(SUM(amount_cents),0) AS bal
    FROM public.wallet_transactions
    GROUP BY wallet_id
  ) wt ON wt.wallet_id = w.id
  WHERE COALESCE(wt.bal,0) = w.balance_cents;

  wallet_reconciled_pct := CASE WHEN total_wallets = 0 THEN 100
    ELSE ROUND((matching_wallets::numeric / total_wallets) * 100, 2) END;

  SELECT COUNT(*) INTO orphan_wallet_txn
  FROM public.wallet_transactions wt
  LEFT JOIN public.wallets w ON w.id = wt.wallet_id
  WHERE w.id IS NULL;

  score := (CASE WHEN ledger_balanced THEN 50 ELSE 0 END)
         + (wallet_reconciled_pct/2)
         - LEAST(orphan_wallet_txn, 50);

  RETURN jsonb_build_object(
    'score', GREATEST(0, LEAST(100, score)),
    'ledger_balanced', ledger_balanced,
    'wallet_reconciled_pct', wallet_reconciled_pct,
    'orphan_wallet_transactions', orphan_wallet_txn,
    'total_wallets', total_wallets
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.payment_financial_integrity_score() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.payment_stability_score()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  latest public.payment_stability_windows%ROWTYPE;
BEGIN
  SELECT * INTO latest FROM public.payment_stability_windows
   ORDER BY window_end DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('score', 0, 'status', 'NO_WINDOW');
  END IF;
  RETURN jsonb_build_object(
    'score', latest.stability_score,
    'status', latest.gate_status,
    'window_end', latest.window_end,
    'callback_success_pct', latest.callback_success_pct,
    'regressions', latest.regressions_count,
    'critical_incidents', latest.critical_incidents
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.payment_stability_score() TO authenticated, service_role;

-- ---------- 11. Register D5.1 certification scenarios ----------

INSERT INTO public.certification_scenarios_registry
  (scenario_key, scenario_name, description, workflow_key, expected_outcome, simulation_kind, severity)
VALUES
  ('fi_ledger_balanced','Financial Integrity: Ledger balanced','Every POSTED journal has Σ debits = Σ credits','financial_integrity','PASS','db_assertion','critical'),
  ('fi_journal_immutable','Financial Integrity: Journal immutable','UPDATE on POSTED journal must fail','financial_integrity','FAIL_EXPECTED','db_trigger','critical'),
  ('fi_journal_lines_frozen','Financial Integrity: Journal lines frozen','DML on POSTED journal lines must fail','financial_integrity','FAIL_EXPECTED','db_trigger','critical'),
  ('fi_wallet_reconcile','Financial Integrity: Wallet reconciles','Σ wallet_transactions = wallet.balance_cents','financial_integrity','PASS','db_assertion','critical'),
  ('fi_settlement_reconcile','Financial Integrity: Settlement reconciles','Σ settlements = Σ reconciled payment_attempts','financial_integrity','PASS','db_assertion','critical'),
  ('fi_no_orphan_wallet_txn','Financial Integrity: No orphan wallet txns','Every wallet_transactions.wallet_id resolves','financial_integrity','PASS','db_assertion','high'),
  ('ei_three_way_sha','Evidence: Three-way SHA verification','Client, server, and stored SHA all match','evidence_integrity','PASS','edge_function','critical'),
  ('ei_digital_twin_replay','Evidence: Digital twin replay','Historical replay yields identical fingerprint','evidence_integrity','PASS','edge_function','critical'),
  ('ei_canonical_payload','Evidence: Canonical payload','RFC 8785 canonicalization is deterministic','evidence_integrity','PASS','db_assertion','high'),
  ('infra_dlq_replay_roundtrip','Infra: DLQ replay round-trip','Poison → DLQ → replay → delivered','infrastructure','PASS','edge_function','critical'),
  ('infra_schema_consistency','Infra: Schema consistency','All code references resolve in live schema','infrastructure','PASS','ci_gate','critical'),
  ('infra_trigger_certification','Infra: Trigger certification','All triggers fire per role fixture','infrastructure','PASS','ci_gate','high'),
  ('op_callback_availability','Op: Callback availability','No unexplained zero-callback windows','operational','PASS','db_assertion','critical'),
  ('op_continuous_qualification','Op: 15-min continuous qualification','14-step chain passes end-to-end','operational','PASS','edge_function','critical'),
  ('regression_actor_role_trigger','Regression: forbidden_update actor_role','actor_role populated on trigger fire','regression','PASS','db_assertion','high'),
  ('regression_journal_lines_metadata','Regression: journal_lines.metadata column','Metadata column exists','regression','PASS','db_assertion','high'),
  ('regression_fraud_alerts_metadata','Regression: fraud_alerts.metadata column','Metadata column exists','regression','PASS','db_assertion','high'),
  ('regression_notification_dedup','Regression: Notification dedup','No duplicate notifications for same event','regression','PASS','db_assertion','high'),
  ('regression_callback_zero_invocation','Regression: Callback zero invocation','Callback invocations > 0 in rolling window','regression','PASS','db_assertion','critical'),
  ('regression_evidence_sha_mismatch','Regression: Evidence SHA mismatch','Three-way SHA never diverges','regression','PASS','db_assertion','critical')
ON CONFLICT (scenario_key) DO UPDATE
  SET scenario_name = EXCLUDED.scenario_name,
      description = EXCLUDED.description,
      workflow_key = EXCLUDED.workflow_key,
      expected_outcome = EXCLUDED.expected_outcome,
      simulation_kind = EXCLUDED.simulation_kind,
      severity = EXCLUDED.severity,
      updated_at = now();

-- ---------- 12. New operational SLOs ----------

INSERT INTO public.payment_infra_slos (slo_key, display_name, unit, direction, target_value, warn_value, critical_value)
VALUES
  ('callback_latency_p95','Callback latency (p95)','ms','lower_is_better',3000,5000,8000),
  ('notification_latency_p95','Notification latency (p95)','ms','lower_is_better',5000,10000,15000),
  ('outbox_depth','Outbox depth','rows','lower_is_better',100,500,1000),
  ('dlq_depth','DLQ depth','rows','lower_is_better',0,10,50),
  ('replay_duration_p95','Replay duration (p95)','ms','lower_is_better',5000,10000,20000),
  ('controller_latency_p95','Controller latency (p95)','ms','lower_is_better',500,1000,2000),
  ('edge_function_latency_p95','Edge function latency (p95)','ms','lower_is_better',2000,4000,8000),
  ('certification_duration_p95','Certification duration (p95)','ms','lower_is_better',30000,60000,120000)
ON CONFLICT (slo_key) DO NOTHING;
