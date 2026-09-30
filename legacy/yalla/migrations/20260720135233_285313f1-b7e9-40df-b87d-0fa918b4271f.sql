
-- =====================================================================
-- Phase D5.5 — Forensic Certification & Sequential Qualification
-- =====================================================================

-- 1. Forensic records ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_certification_forensics (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id     uuid NOT NULL UNIQUE REFERENCES public.payment_certification_scenarios(id) ON DELETE CASCADE,
  run_id          uuid NOT NULL,
  scenario_key    text NOT NULL,
  stage           text NOT NULL,               -- checkout|session|stk|daraja|callback|wallet|ledger|settlement|notification|runner
  edge_function   text,
  rpc_name        text,
  db_mutation     jsonb NOT NULL DEFAULT '{}'::jsonb,
  failure_class   text NOT NULL,               -- HTTP_5XX|RLS_DENIED|TRIGGER_BLOCKED|DUPLICATE|TIMEOUT|UPSTREAM|DATA_DRIFT|RUNTIME_ERROR|UNKNOWN
  correlation_id  uuid,
  trace_id        text,
  evidence        jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommended_fix text NOT NULL,
  classified_at   timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pcf_scenario_key ON public.payment_certification_forensics(scenario_key);
CREATE INDEX IF NOT EXISTS idx_pcf_run_id       ON public.payment_certification_forensics(run_id);
CREATE INDEX IF NOT EXISTS idx_pcf_failure_class ON public.payment_certification_forensics(failure_class);

GRANT SELECT, INSERT, UPDATE ON public.payment_certification_forensics TO authenticated;
GRANT ALL ON public.payment_certification_forensics TO service_role;
ALTER TABLE public.payment_certification_forensics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pcf_admin_read"
  ON public.payment_certification_forensics FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin')
      OR public.has_role(auth.uid(),'finance_admin')
      OR public.has_role(auth.uid(),'super_admin'));

CREATE POLICY "pcf_admin_write"
  ON public.payment_certification_forensics FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- 2. Regression pins -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_certification_regressions (
  scenario_key        text PRIMARY KEY,
  pinned_fingerprint  jsonb NOT NULL,
  pinned_at           timestamptz NOT NULL DEFAULT now(),
  pinned_by           uuid,
  last_verified_at    timestamptz,
  last_verify_status  text,          -- GREEN|DIVERGED|STALE
  last_run_id         uuid,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_certification_regressions TO authenticated;
GRANT ALL ON public.payment_certification_regressions TO service_role;
ALTER TABLE public.payment_certification_regressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pcr_admin_read"
  ON public.payment_certification_regressions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin')
      OR public.has_role(auth.uid(),'finance_admin')
      OR public.has_role(auth.uid(),'super_admin'));

CREATE POLICY "pcr_admin_write"
  ON public.payment_certification_regressions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- 3. Deterministic forensic classifier ----------------------------------
CREATE OR REPLACE FUNCTION public.payment_certification_classify_failure(_scenario_id uuid)
RETURNS public.payment_certification_forensics
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sc          public.payment_certification_scenarios;
  v_stage       text;
  v_class       text := 'UNKNOWN';
  v_fn          text;
  v_rpc         text;
  v_mut         jsonb := '{}'::jsonb;
  v_trace_id    text;
  v_first_bad   record;
  v_inv         record;
  v_fix         text;
  v_ev          jsonb;
  v_out         public.payment_certification_forensics;
BEGIN
  SELECT * INTO v_sc FROM public.payment_certification_scenarios WHERE id = _scenario_id;
  IF v_sc IS NULL THEN RAISE EXCEPTION 'scenario % not found', _scenario_id; END IF;

  -- Stage inference from scenario_key (canonical chain mapping)
  v_stage := CASE
    WHEN v_sc.scenario_key IN ('chain_auth')                 THEN 'session'
    WHEN v_sc.scenario_key IN ('chain_checkout','chain_quote','chain_fee_apply','chain_tax_apply') THEN 'checkout'
    WHEN v_sc.scenario_key IN ('chain_stkpush')              THEN 'stk'
    WHEN v_sc.scenario_key IN ('chain_callback','chain_verify') THEN 'callback'
    WHEN v_sc.scenario_key IN ('chain_wallet_credit')        THEN 'wallet'
    WHEN v_sc.scenario_key IN ('chain_ledger_post')          THEN 'ledger'
    WHEN v_sc.scenario_key IN ('chain_settlement','chain_reconciliation','chain_payout','chain_close') THEN 'settlement'
    WHEN v_sc.scenario_key LIKE 'notification%'              THEN 'notification'
    ELSE 'runner'
  END;

  -- First failed step for this correlation (if any)
  SELECT * INTO v_first_bad
    FROM public.payment_step_traces
   WHERE correlation_id = v_sc.correlation_id
     AND status IN ('FAILED','ERROR')
   ORDER BY step_number ASC LIMIT 1;

  IF v_first_bad IS NOT NULL THEN
    v_fn := v_first_bad.function_name;
    v_mut := jsonb_build_object(
      'error_code', v_first_bad.error_code,
      'error_message', v_first_bad.error_message,
      'step_key', v_first_bad.step_key);
  END IF;

  -- Correlate to an edge function invocation (worst status wins)
  SELECT * INTO v_inv
    FROM public.edge_function_invocations
   WHERE correlation_id = v_sc.correlation_id
   ORDER BY (status_code >= 500) DESC, created_at DESC LIMIT 1;
  IF v_inv IS NOT NULL THEN
    v_fn := COALESCE(v_fn, v_inv.function_name);
    v_trace_id := v_inv.trace_id;
  END IF;

  -- Failure class heuristics
  IF v_sc.error_message ILIKE '%Cannot read properties of null%'
     OR v_sc.error_message ILIKE '%undefined%is not a function%'
     OR v_sc.error_message ILIKE '%TypeError%' THEN
    v_class := 'RUNTIME_ERROR';
    v_fn := COALESCE(v_fn, 'payment-certification-runner');
    v_stage := 'runner';
  ELSIF v_inv.status_code >= 500 THEN v_class := 'HTTP_5XX';
  ELSIF v_first_bad.error_message ILIKE '%row-level security%' OR v_first_bad.error_code = '42501' THEN v_class := 'RLS_DENIED';
  ELSIF v_first_bad.error_code = '23505' OR v_first_bad.error_message ILIKE '%duplicate%' THEN v_class := 'DUPLICATE';
  ELSIF v_first_bad.error_message ILIKE '%trigger%' OR v_first_bad.error_code = 'P0001' THEN v_class := 'TRIGGER_BLOCKED';
  ELSIF v_sc.error_message ILIKE '%timeout%' OR v_first_bad.error_message ILIKE '%timeout%' THEN v_class := 'TIMEOUT';
  ELSIF v_inv IS NOT NULL AND v_inv.status_code BETWEEN 400 AND 499 THEN v_class := 'UPSTREAM';
  ELSIF v_first_bad IS NOT NULL THEN v_class := 'DATA_DRIFT';
  END IF;

  -- Recommended fix
  v_fix := CASE v_class
    WHEN 'RUNTIME_ERROR'   THEN 'Patch payment-certification-runner: null-guard fixture setup for stage '||v_stage||' and add a step_trace before validation.'
    WHEN 'HTTP_5XX'        THEN 'Investigate '||COALESCE(v_fn,'target function')||' 5xx during '||v_stage||'; check upstream (Daraja/webhook) and DLQ.'
    WHEN 'RLS_DENIED'      THEN 'Grant service_role / admin RLS on the target table used by '||v_stage||' or update the policy predicate.'
    WHEN 'DUPLICATE'       THEN 'Enforce idempotency at '||v_stage||' (check idempotency_keys / unique constraint on correlation_id).'
    WHEN 'TRIGGER_BLOCKED' THEN 'Trigger raised for '||v_stage||' — reconcile with immutable-field or state-machine constraints.'
    WHEN 'TIMEOUT'         THEN 'Raise scenario timeout_ms or reduce '||v_stage||' latency; check circuit breakers.'
    WHEN 'UPSTREAM'        THEN 'Upstream 4xx from '||COALESCE(v_fn,'edge function')||' — validate request payload and auth.'
    WHEN 'DATA_DRIFT'      THEN 'Schema/data drift at '||v_stage||' — re-run schema-drift scan and reconcile projections.'
    ELSE                        'Manually investigate '||v_sc.scenario_key||' — evidence insufficient for automated classification.'
  END;

  v_ev := jsonb_build_object(
    'scenario_correlation_id', v_sc.correlation_id,
    'raw_error', v_sc.error_message,
    'first_failed_step', to_jsonb(v_first_bad),
    'edge_invocation', to_jsonb(v_inv),
    'log_query', jsonb_build_object(
      'edge_function_invocations', 'correlation_id = '''||v_sc.correlation_id||'''',
      'payment_step_traces',        'correlation_id = '''||v_sc.correlation_id||''''));

  INSERT INTO public.payment_certification_forensics(
    scenario_id, run_id, scenario_key, stage, edge_function, rpc_name,
    db_mutation, failure_class, correlation_id, trace_id, evidence, recommended_fix)
  VALUES (
    v_sc.id, v_sc.run_id, v_sc.scenario_key, v_stage, v_fn, v_rpc,
    v_mut, v_class, v_sc.correlation_id, v_trace_id, v_ev, v_fix)
  ON CONFLICT (scenario_id) DO UPDATE SET
    stage=EXCLUDED.stage, edge_function=EXCLUDED.edge_function, rpc_name=EXCLUDED.rpc_name,
    db_mutation=EXCLUDED.db_mutation, failure_class=EXCLUDED.failure_class,
    correlation_id=EXCLUDED.correlation_id, trace_id=EXCLUDED.trace_id,
    evidence=EXCLUDED.evidence, recommended_fix=EXCLUDED.recommended_fix,
    classified_at=now()
  RETURNING * INTO v_out;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.payment_certification_classify_failure(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.payment_certification_classify_failure(uuid) TO authenticated, service_role;

-- 4. Sequential next-action ---------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_certification_next_action(_suite text DEFAULT 'chain')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row record;
BEGIN
  -- 1) latest FAILED scenario without a forensic record
  SELECT s.* INTO v_row
    FROM public.payment_certification_scenarios s
    LEFT JOIN public.payment_certification_forensics f ON f.scenario_id = s.id
   WHERE s.status = 'FAILED'
     AND s.scenario_key LIKE (_suite||'\_%') ESCAPE '\'
     AND f.id IS NULL
   ORDER BY s.started_at DESC LIMIT 1;
  IF v_row IS NOT NULL THEN
    RETURN jsonb_build_object('action','CLASSIFY','scenario_id',v_row.id,
      'scenario_key',v_row.scenario_key,'reason','No forensic record yet.');
  END IF;

  -- 2) classified failure whose scenario_key has no green pin
  SELECT s.*, f.failure_class INTO v_row
    FROM public.payment_certification_scenarios s
    JOIN public.payment_certification_forensics f ON f.scenario_id = s.id
    LEFT JOIN public.payment_certification_regressions r ON r.scenario_key = s.scenario_key
   WHERE s.status = 'FAILED'
     AND s.scenario_key LIKE (_suite||'\_%') ESCAPE '\'
     AND (r.scenario_key IS NULL OR r.last_verify_status <> 'GREEN')
   ORDER BY s.started_at DESC LIMIT 1;
  IF v_row IS NOT NULL THEN
    RETURN jsonb_build_object('action','REPAIR_AND_REPLAY','scenario_id',v_row.id,
      'scenario_key',v_row.scenario_key,'reason','Classified but no green regression pin.',
      'failure_class', v_row.failure_class);
  END IF;

  -- 3) fully green
  RETURN jsonb_build_object('action','NONE','reason','All '||_suite||'_* scenarios have green pins.');
END $$;
REVOKE ALL ON FUNCTION public.payment_certification_next_action(text) FROM public;
GRANT EXECUTE ON FUNCTION public.payment_certification_next_action(text) TO authenticated, service_role;

-- 5. Regression pin RPC --------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_certification_pin_regression(
  _scenario_key text, _fingerprint jsonb, _run_id uuid DEFAULT NULL)
RETURNS public.payment_certification_regressions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_out public.payment_certification_regressions;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  INSERT INTO public.payment_certification_regressions(
    scenario_key, pinned_fingerprint, pinned_by, last_verified_at, last_verify_status, last_run_id)
  VALUES (_scenario_key, _fingerprint, auth.uid(), now(), 'GREEN', _run_id)
  ON CONFLICT (scenario_key) DO UPDATE SET
    pinned_fingerprint = EXCLUDED.pinned_fingerprint,
    pinned_by = EXCLUDED.pinned_by,
    last_verified_at = now(),
    last_verify_status = 'GREEN',
    last_run_id = EXCLUDED.last_run_id,
    updated_at = now()
  RETURNING * INTO v_out;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.payment_certification_pin_regression(text, jsonb, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.payment_certification_pin_regression(text, jsonb, uuid) TO authenticated, service_role;

-- 6. Evidence-rich readiness (v2) ---------------------------------------
CREATE OR REPLACE FUNCTION public.compute_platform_readiness_v2()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_snap public.platform_readiness_snapshots;
  v_failed int; v_classified int;
  v_pinned int; v_chain_total int;
  v_blocking text; v_first_fail timestamptz;
  v_functions text[]; v_recommend text;
  v_confidence numeric; v_next jsonb;
BEGIN
  v_snap := public.compute_platform_readiness();

  SELECT count(*) INTO v_chain_total FROM public.certification_scenarios_registry
   WHERE scenario_key LIKE 'chain\_%' ESCAPE '\' AND enabled;

  SELECT count(DISTINCT s.scenario_key) INTO v_failed
    FROM public.payment_certification_scenarios s
   WHERE s.status='FAILED' AND s.scenario_key LIKE 'chain\_%' ESCAPE '\';

  SELECT count(DISTINCT f.scenario_key) INTO v_classified
    FROM public.payment_certification_forensics f
   WHERE f.scenario_key LIKE 'chain\_%' ESCAPE '\';

  SELECT count(*) INTO v_pinned FROM public.payment_certification_regressions
   WHERE scenario_key LIKE 'chain\_%' ESCAPE '\' AND last_verify_status='GREEN';

  SELECT min(s.started_at) INTO v_first_fail
    FROM public.payment_certification_scenarios s
    LEFT JOIN public.payment_certification_regressions r ON r.scenario_key=s.scenario_key
   WHERE s.status='FAILED' AND s.scenario_key LIKE 'chain\_%' ESCAPE '\'
     AND (r.scenario_key IS NULL OR r.last_verify_status <> 'GREEN');

  SELECT array_agg(DISTINCT f.edge_function) FILTER (WHERE f.edge_function IS NOT NULL)
    INTO v_functions FROM public.payment_certification_forensics f
   WHERE f.scenario_key LIKE 'chain\_%' ESCAPE '\';

  v_next := public.payment_certification_next_action('chain');

  IF v_snap.ready AND v_failed = 0 THEN
    v_blocking := NULL;
    v_recommend := 'None — platform is READY.';
  ELSE
    v_blocking := CASE
      WHEN v_failed > 0 THEN 'certification.'||COALESCE((v_next->>'scenario_key'), 'chain_suite')
      WHEN array_length(v_snap.failed_signals,1) > 0 THEN v_snap.failed_signals[1]
      ELSE 'unknown' END;
    v_recommend := CASE v_next->>'action'
      WHEN 'CLASSIFY'          THEN 'Classify '||(v_next->>'scenario_key')||' failure (auto-forensics).'
      WHEN 'REPAIR_AND_REPLAY' THEN 'Repair '||(v_next->>'scenario_key')||' ('||(v_next->>'failure_class')||') then replay in isolation, then pin regression.'
      ELSE                          'Resolve failed signal: '||COALESCE(v_snap.failed_signals[1],'unknown')||'.'
    END;
  END IF;

  v_confidence := round(
    LEAST(1.0,
      (CASE WHEN v_failed = 0 THEN 1.0 ELSE v_classified::numeric / GREATEST(v_failed,1) END) * 0.4
      + (CASE WHEN v_chain_total = 0 THEN 1.0 ELSE v_pinned::numeric / v_chain_total END) * 0.4
      + (v_snap.readiness_score / 100.0) * 0.2
    ) * 100, 2);

  RETURN jsonb_build_object(
    'status',                 CASE WHEN v_snap.ready AND v_failed = 0 THEN 'READY' ELSE 'BLOCKED' END,
    'readiness_score',        v_snap.readiness_score,
    'signal_scores',          v_snap.signal_scores,
    'reasons',                v_snap.reasons,
    'failed_signals',         v_snap.failed_signals,
    'evidence_confidence',    v_confidence,
    'blocking_component',     v_blocking,
    'first_failure_at',       v_first_fail,
    'affected_functions',     COALESCE(v_functions,'{}'::text[]),
    'recovery_recommendation',v_recommend,
    'chain_progress',         jsonb_build_object(
      'total', v_chain_total, 'failing', v_failed,
      'classified', v_classified, 'green_pinned', v_pinned),
    'next_action',            v_next,
    'snapshot_id',            v_snap.id,
    'computed_at',            v_snap.computed_at);
END $$;
REVOKE ALL ON FUNCTION public.compute_platform_readiness_v2() FROM public;
GRANT EXECUTE ON FUNCTION public.compute_platform_readiness_v2() TO authenticated, service_role;
