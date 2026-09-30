
-- ============================================================
-- Slice 3 engine-first: Scenario + Workflow registries + Readiness
-- ============================================================

-- 1) Scenario Registry (data-driven; no hard-coded lists)
CREATE TABLE IF NOT EXISTS public.certification_scenarios_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_key text NOT NULL UNIQUE,
  scenario_name text NOT NULL,
  description text,
  workflow_key text NOT NULL,
  expected_outcome text NOT NULL,
  simulation_kind text NOT NULL,            -- how the runner should synthesize evidence
  simulation_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  timeout_ms integer NOT NULL DEFAULT 15000,
  retry_policy jsonb NOT NULL DEFAULT '{"max_attempts":1,"backoff_ms":0}'::jsonb,
  severity text NOT NULL DEFAULT 'high',
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  last_run_status text,
  last_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.certification_scenarios_registry TO authenticated;
GRANT ALL ON public.certification_scenarios_registry TO service_role;

ALTER TABLE public.certification_scenarios_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read scenario registry"
  ON public.certification_scenarios_registry FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'finance_admin'));

CREATE POLICY "Service role manages scenario registry"
  ON public.certification_scenarios_registry FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_cert_scenarios_enabled ON public.certification_scenarios_registry(enabled);
CREATE INDEX IF NOT EXISTS idx_cert_scenarios_workflow ON public.certification_scenarios_registry(workflow_key);

-- 2) Workflow Registry (per-business-workflow certification status)
CREATE TABLE IF NOT EXISTS public.certification_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_key text NOT NULL UNIQUE,
  workflow_name text NOT NULL,
  description text,
  owner text,
  criticality text NOT NULL DEFAULT 'high',
  status text NOT NULL DEFAULT 'UNKNOWN',   -- CERTIFIED | DEGRADED | FAILED | UNKNOWN
  last_certified_at timestamptz,
  last_run_id uuid,
  score numeric(5,2),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.certification_workflows TO authenticated;
GRANT ALL ON public.certification_workflows TO service_role;

ALTER TABLE public.certification_workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read workflow registry"
  ON public.certification_workflows FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'finance_admin'));

CREATE POLICY "Service role manages workflow registry"
  ON public.certification_workflows FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- 3) Platform Readiness Snapshots
CREATE TABLE IF NOT EXISTS public.platform_readiness_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  computed_at timestamptz NOT NULL DEFAULT now(),
  ready boolean NOT NULL,
  readiness_score numeric(5,2) NOT NULL,
  signal_scores jsonb NOT NULL DEFAULT '{}'::jsonb, -- {callback: 100, oauth: 100, ledger: 100, settlement: 70, ...}
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,       -- [{signal, ok, detail}, ...]
  failed_signals text[] NOT NULL DEFAULT '{}',
  run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.platform_readiness_snapshots TO authenticated;
GRANT ALL ON public.platform_readiness_snapshots TO service_role;

ALTER TABLE public.platform_readiness_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read readiness snapshots"
  ON public.platform_readiness_snapshots FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'finance_admin'));

CREATE POLICY "Service role writes readiness snapshots"
  ON public.platform_readiness_snapshots FOR ALL
  TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_readiness_computed_at ON public.platform_readiness_snapshots(computed_at DESC);

-- 4) Seed workflows
INSERT INTO public.certification_workflows(workflow_key, workflow_name, description, criticality) VALUES
  ('checkout','Checkout','Client -> STK invocation handshake','critical'),
  ('wallet_topup','Wallet Top-Up','M-Pesa wallet top-up end-to-end','critical'),
  ('ride_payment','Ride Payment','Trip fare payment lifecycle','critical'),
  ('corporate_payment','Corporate Payment','Corporate paybill + approval + settlement','high'),
  ('settlement','Settlement','Batch settlement to merchants/drivers','high'),
  ('reconciliation','Reconciliation','Daraja vs ledger reconciliation','high'),
  ('notifications','Notifications','Payment success/failure notifications delivery','medium')
ON CONFLICT (workflow_key) DO NOTHING;

-- 5) Seed initial scenario registry (matches previously hard-coded set)
INSERT INTO public.certification_scenarios_registry
  (scenario_key, scenario_name, workflow_key, expected_outcome, simulation_kind, simulation_params, severity)
VALUES
  ('stk_success','Successful STK Push','wallet_topup','COMPLETED','callback_result',
    '{"callback_result_code":0}','critical'),
  ('customer_cancel','Customer Cancels Payment','wallet_topup','CANCELLED','callback_result',
    '{"callback_result_code":1032}','high'),
  ('customer_timeout','Customer Timeout','wallet_topup','TIMED_OUT','callback_result',
    '{"callback_result_code":1037}','high'),
  ('wrong_pin','Incorrect PIN','wallet_topup','FAILED','callback_result',
    '{"callback_result_code":2001}','high'),
  ('oauth_failure','OAuth Failure','wallet_topup','FAILED','stk_failure',
    '{"stk_status":"FAILED","fail_step":"oauth_token","skip_callback":true}','critical'),
  ('callback_offline','Callback Endpoint Offline','wallet_topup','STALLED','stk_failure',
    '{"skip_callback":true}','critical'),
  ('duplicate_callback','Duplicate Callback Delivery','wallet_topup','IDEMPOTENT','callback_result',
    '{"callback_result_code":0,"duplicate_callback":true}','high'),
  ('duplicate_stk','Duplicate STK Push Request','wallet_topup','DEDUPED','callback_result',
    '{"callback_result_code":0}','high'),
  ('circuit_breaker','Circuit Breaker Open','wallet_topup','REJECTED','stk_failure',
    '{"stk_status":"REJECTED","fail_step":"circuit_breaker","skip_callback":true}','high'),
  ('daraja_unavailable','Daraja API Unavailable','wallet_topup','RETRYING','stk_failure',
    '{"stk_status":"RETRY","fail_step":"daraja_request","skip_callback":true}','high'),
  ('fraud_block','Fraud Engine Blocks Payment','wallet_topup','BLOCKED','stk_failure',
    '{"stk_status":"BLOCKED","fail_step":"fraud_evaluation","skip_callback":true}','high'),
  ('wallet_failure','Wallet Posting Failure','wallet_topup','COMPENSATED','callback_result',
    '{"callback_result_code":0,"fail_step":"wallet_credit"}','critical'),
  ('settlement_failure','Settlement Failure','settlement','RETRY_SCHEDULED','callback_result',
    '{"callback_result_code":0,"fail_step":"settlement"}','high'),
  ('high_concurrency','High-Concurrency Certification','wallet_topup','NO_RACE','concurrency',
    '{"count":25}','high'),
  ('tenant_isolation','Regional / Tenant Certification','wallet_topup','ISOLATED','callback_result',
    '{"callback_result_code":0}','medium'),
  ('checkout_handshake','Checkout Handshake','checkout','COMPLETED','callback_result',
    '{"callback_result_code":0}','critical'),
  ('ride_payment_success','Ride Payment Success','ride_payment','COMPLETED','callback_result',
    '{"callback_result_code":0}','critical'),
  ('corporate_paybill_success','Corporate Paybill Success','corporate_payment','COMPLETED','callback_result',
    '{"callback_result_code":0}','high'),
  ('reconciliation_match','Reconciliation Match','reconciliation','COMPLETED','callback_result',
    '{"callback_result_code":0}','high'),
  ('notification_delivered','Notification Delivered','notifications','COMPLETED','callback_result',
    '{"callback_result_code":0}','medium')
ON CONFLICT (scenario_key) DO NOTHING;

-- 6) compute_platform_readiness RPC — folds health + workflows + latest run into a single score
CREATE OR REPLACE FUNCTION public.compute_platform_readiness()
RETURNS public.platform_readiness_snapshots
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_health record;
  v_workflow_ok int;
  v_workflow_total int;
  v_signal jsonb := '{}'::jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_failed text[] := '{}';
  v_score numeric(5,2);
  v_ready boolean;
  v_snap public.platform_readiness_snapshots;
  v_callback numeric := 100;
  v_oauth numeric := 100;
  v_stk numeric := 100;
  v_settlement numeric := 100;
BEGIN
  SELECT * INTO v_health FROM public.payment_platform_health
    ORDER BY window_end DESC LIMIT 1;

  IF v_health IS NOT NULL THEN
    v_callback   := COALESCE(v_health.callback_success_rate, 100);
    v_oauth      := COALESCE(v_health.oauth_success_rate,    100);
    v_stk        := COALESCE(v_health.stk_success_rate,      100);
  END IF;

  SELECT count(*) FILTER (WHERE status IN ('CERTIFIED')),
         count(*)
    INTO v_workflow_ok, v_workflow_total
    FROM public.certification_workflows WHERE enabled;

  v_signal := jsonb_build_object(
    'callback',   v_callback,
    'oauth',      v_oauth,
    'stk',        v_stk,
    'settlement', v_settlement,
    'workflows',  CASE WHEN v_workflow_total = 0 THEN 100
                       ELSE round((v_workflow_ok::numeric * 100) / v_workflow_total, 2) END
  );

  -- Build reasons + failed signals
  IF v_callback < 95   THEN v_failed := v_failed || 'callback';   v_reasons := v_reasons || jsonb_build_object('signal','callback','ok',false,'detail', v_callback||'% success');
    ELSE v_reasons := v_reasons || jsonb_build_object('signal','callback','ok',true,'detail','healthy'); END IF;
  IF v_oauth < 95      THEN v_failed := v_failed || 'oauth';      v_reasons := v_reasons || jsonb_build_object('signal','oauth','ok',false,'detail', v_oauth||'%');
    ELSE v_reasons := v_reasons || jsonb_build_object('signal','oauth','ok',true,'detail','healthy'); END IF;
  IF v_stk < 90        THEN v_failed := v_failed || 'stk';        v_reasons := v_reasons || jsonb_build_object('signal','stk','ok',false,'detail', v_stk||'%');
    ELSE v_reasons := v_reasons || jsonb_build_object('signal','stk','ok',true,'detail','healthy'); END IF;
  IF v_workflow_total > 0 AND v_workflow_ok < v_workflow_total THEN
    v_failed := v_failed || 'workflows';
    v_reasons := v_reasons || jsonb_build_object('signal','workflows','ok',false,'detail', v_workflow_ok||'/'||v_workflow_total||' certified');
  ELSE
    v_reasons := v_reasons || jsonb_build_object('signal','workflows','ok',true,'detail','all certified');
  END IF;

  v_score := round((v_callback*0.30 + v_oauth*0.20 + v_stk*0.20 + v_settlement*0.10
                    + (CASE WHEN v_workflow_total=0 THEN 100 ELSE (v_workflow_ok::numeric*100)/v_workflow_total END)*0.20), 2);
  v_ready := array_length(v_failed,1) IS NULL AND v_score >= 90;

  INSERT INTO public.platform_readiness_snapshots(ready, readiness_score, signal_scores, reasons, failed_signals)
  VALUES (v_ready, v_score, v_signal, v_reasons, v_failed)
  RETURNING * INTO v_snap;

  RETURN v_snap;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_platform_readiness() FROM public;
GRANT EXECUTE ON FUNCTION public.compute_platform_readiness() TO authenticated, service_role;

-- 7) After each scenario finishes, keep registry.last_run_* in sync
CREATE OR REPLACE FUNCTION public.tg_scenario_touch_registry()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('PASSED','FAILED') THEN
    UPDATE public.certification_scenarios_registry
       SET last_run_at = COALESCE(NEW.completed_at, now()),
           last_run_status = NEW.status,
           last_run_id = NEW.run_id,
           updated_at = now()
     WHERE scenario_key = NEW.scenario_key;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_scenario_touch_registry ON public.payment_certification_scenarios;
CREATE TRIGGER trg_scenario_touch_registry
AFTER INSERT OR UPDATE ON public.payment_certification_scenarios
FOR EACH ROW EXECUTE FUNCTION public.tg_scenario_touch_registry();

-- 8) After each run finishes, roll workflow status forward from scenario results
CREATE OR REPLACE FUNCTION public.tg_run_touch_workflows()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record;
BEGIN
  IF NEW.status NOT IN ('PASSED','FAILED') THEN RETURN NEW; END IF;

  FOR r IN
    SELECT reg.workflow_key,
           count(*) FILTER (WHERE s.status='PASSED') AS ok,
           count(*) AS total
      FROM public.payment_certification_scenarios s
      JOIN public.certification_scenarios_registry reg ON reg.scenario_key = s.scenario_key
     WHERE s.run_id = NEW.id
     GROUP BY reg.workflow_key
  LOOP
    UPDATE public.certification_workflows
       SET status = CASE WHEN r.ok = r.total THEN 'CERTIFIED'
                         WHEN r.ok = 0       THEN 'FAILED'
                         ELSE 'DEGRADED' END,
           last_certified_at = CASE WHEN r.ok = r.total THEN now() ELSE last_certified_at END,
           last_run_id = NEW.id,
           score = round((r.ok::numeric * 100) / GREATEST(r.total,1), 2),
           updated_at = now()
     WHERE workflow_key = r.workflow_key;
  END LOOP;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_run_touch_workflows ON public.payment_certification_runs;
CREATE TRIGGER trg_run_touch_workflows
AFTER UPDATE ON public.payment_certification_runs
FOR EACH ROW EXECUTE FUNCTION public.tg_run_touch_workflows();
