-- ============================================================================
-- Phase 4 Slice 4.1 — Payment Reliability Signals
-- ============================================================================

-- 1) Orchestrator flag (single row) --------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_orchestrator_flag (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  enabled boolean NOT NULL DEFAULT false,
  shadow_mode boolean NOT NULL DEFAULT true,
  rollout_percent int NOT NULL DEFAULT 0 CHECK (rollout_percent BETWEEN 0 AND 100),
  kill_switch boolean NOT NULL DEFAULT false,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  note text
);

GRANT SELECT ON public.payment_orchestrator_flag TO authenticated;
GRANT ALL ON public.payment_orchestrator_flag TO service_role;

ALTER TABLE public.payment_orchestrator_flag ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read orchestrator flag" ON public.payment_orchestrator_flag
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'finance_admin'));

CREATE POLICY "Super admin updates orchestrator flag" ON public.payment_orchestrator_flag
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

INSERT INTO public.payment_orchestrator_flag (id) VALUES (true) ON CONFLICT DO NOTHING;

-- Immutable audit of every flip via admin_audit_log
CREATE OR REPLACE FUNCTION public.audit_orchestrator_flag_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.admin_audit_log(actor_id, action, entity_type, entity_id, before_state, after_state)
  VALUES (
    coalesce(NEW.updated_by, auth.uid()),
    'payment_orchestrator_flag_change',
    'payment_orchestrator_flag',
    'singleton',
    to_jsonb(OLD),
    to_jsonb(NEW)
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_audit_orchestrator_flag ON public.payment_orchestrator_flag;
CREATE TRIGGER trg_audit_orchestrator_flag
  AFTER UPDATE ON public.payment_orchestrator_flag
  FOR EACH ROW EXECUTE FUNCTION public.audit_orchestrator_flag_change();

-- 2) Shadow diffs --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_orchestrator_shadow_diffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id text NOT NULL,
  legacy_outcome jsonb NOT NULL,
  shadow_outcome jsonb NOT NULL,
  diff_keys text[] NOT NULL DEFAULT '{}',
  is_equivalent boolean NOT NULL,
  legacy_duration_ms int,
  shadow_duration_ms int,
  deployment_version text,
  git_revision text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shadow_diffs_corr ON public.payment_orchestrator_shadow_diffs(correlation_id);
CREATE INDEX IF NOT EXISTS idx_shadow_diffs_created ON public.payment_orchestrator_shadow_diffs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shadow_diffs_eq ON public.payment_orchestrator_shadow_diffs(is_equivalent);

GRANT SELECT ON public.payment_orchestrator_shadow_diffs TO authenticated;
GRANT ALL ON public.payment_orchestrator_shadow_diffs TO service_role;

ALTER TABLE public.payment_orchestrator_shadow_diffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read shadow diffs" ON public.payment_orchestrator_shadow_diffs
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'finance_admin'));

-- 3) Reliability snapshots (trend history) ------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_reliability_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  computed_at timestamptz NOT NULL DEFAULT now(),
  reliability_score numeric(5,2) NOT NULL,
  callback_score numeric(5,2) NOT NULL,
  journey_score numeric(5,2) NOT NULL,
  edge_function_score numeric(5,2) NOT NULL,
  slo_score numeric(5,2) NOT NULL,
  certification_score numeric(5,2) NOT NULL,
  window_minutes int NOT NULL DEFAULT 60,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_reliability_snapshots_computed ON public.payment_reliability_snapshots(computed_at DESC);

GRANT SELECT ON public.payment_reliability_snapshots TO authenticated;
GRANT ALL ON public.payment_reliability_snapshots TO service_role;

ALTER TABLE public.payment_reliability_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read reliability snapshots" ON public.payment_reliability_snapshots
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'finance_admin'));

-- 4) Views ---------------------------------------------------------------------
-- Callback invocation health — the KPI that answers the original bug
CREATE OR REPLACE VIEW public.v_callback_invocation_health AS
WITH inv AS (
  SELECT
    count(*) FILTER (WHERE created_at > now() - interval '15 minutes') AS inv_15m,
    count(*) FILTER (WHERE created_at > now() - interval '1 hour')     AS inv_1h,
    count(*) FILTER (WHERE created_at > now() - interval '24 hours')   AS inv_24h,
    count(*) FILTER (WHERE created_at > now() - interval '24 hours' AND status_code BETWEEN 200 AND 299) AS ok_24h,
    max(created_at) AS last_invocation_at
  FROM public.edge_function_invocations
  WHERE function_name = 'mpesa-callback'
)
SELECT
  inv_15m, inv_1h, inv_24h, ok_24h, last_invocation_at,
  CASE WHEN inv_24h = 0 THEN 0
       ELSE round((ok_24h::numeric / inv_24h) * 100, 2)
  END AS success_rate_24h,
  CASE
    WHEN inv_15m = 0 AND (last_invocation_at IS NULL OR last_invocation_at < now() - interval '15 minutes') THEN 'CRITICAL'
    WHEN inv_1h  = 0 THEN 'DEGRADED'
    WHEN inv_24h > 0 AND (ok_24h::numeric / greatest(inv_24h,1)) < 0.95 THEN 'DEGRADED'
    ELSE 'HEALTHY'
  END AS health
FROM inv;

GRANT SELECT ON public.v_callback_invocation_health TO authenticated;

-- Per-function health for every payment edge function
CREATE OR REPLACE VIEW public.v_edge_function_health AS
WITH fns(function_name, is_payment_critical) AS (
  VALUES
    ('mpesa-stkpush', true),
    ('mpesa-callback', true),
    ('mpesa-status', true),
    ('mpesa-reconcile-recent', true),
    ('mpesa-recover-stale', true),
    ('callback-certification-run', true),
    ('outbox-processor', true),
    ('payment-reconcile', true),
    ('payment-certification-runner', false)
),
stats AS (
  SELECT
    fns.function_name,
    fns.is_payment_critical,
    count(i.*) FILTER (WHERE i.created_at > now() - interval '1 hour') AS inv_1h,
    count(i.*) FILTER (WHERE i.created_at > now() - interval '24 hours') AS inv_24h,
    count(i.*) FILTER (WHERE i.created_at > now() - interval '24 hours' AND i.status_code BETWEEN 200 AND 299) AS ok_24h,
    max(i.created_at) AS last_invocation_at,
    max(i.created_at) FILTER (WHERE i.status_code BETWEEN 200 AND 299) AS last_success_at,
    avg(i.latency_ms) FILTER (WHERE i.created_at > now() - interval '1 hour') AS avg_latency_1h
  FROM fns
  LEFT JOIN public.edge_function_invocations i ON i.function_name = fns.function_name
  GROUP BY fns.function_name, fns.is_payment_critical
)
SELECT
  function_name, is_payment_critical,
  inv_1h, inv_24h, ok_24h, last_invocation_at, last_success_at,
  round(coalesce(avg_latency_1h, 0)::numeric, 1) AS avg_latency_1h_ms,
  CASE WHEN inv_24h = 0 THEN 0
       ELSE round((ok_24h::numeric / inv_24h) * 100, 2)
  END AS success_rate_24h,
  CASE
    WHEN is_payment_critical AND inv_24h = 0 THEN 'CRITICAL'
    WHEN inv_24h > 0 AND (ok_24h::numeric / greatest(inv_24h,1)) < 0.95 THEN 'DEGRADED'
    WHEN inv_1h  = 0 AND is_payment_critical THEN 'STALE'
    ELSE 'HEALTHY'
  END AS health
FROM stats;

GRANT SELECT ON public.v_edge_function_health TO authenticated;

-- 5) Reliability score RPC ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_payment_reliability_score(_window_minutes int DEFAULT 60)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_callback numeric := 0;
  v_journey numeric := 0;
  v_edge numeric := 0;
  v_slo numeric := 0;
  v_cert numeric := 0;
  v_score numeric := 0;
  v_details jsonb := '{}'::jsonb;
  v_cb record;
  v_ef_total int; v_ef_healthy int;
  v_slo_total int; v_slo_ok int;
  v_cert_total int; v_cert_pass int;
  v_journey_total int; v_journey_ok int;
BEGIN
  -- callback score: from view
  SELECT * INTO v_cb FROM public.v_callback_invocation_health;
  v_callback := CASE
    WHEN v_cb.inv_24h = 0 THEN 0
    ELSE v_cb.success_rate_24h
  END;

  -- edge function score: % of payment-critical fns HEALTHY
  SELECT count(*), count(*) FILTER (WHERE health = 'HEALTHY')
    INTO v_ef_total, v_ef_healthy
    FROM public.v_edge_function_health
    WHERE is_payment_critical;
  v_edge := CASE WHEN v_ef_total = 0 THEN 100 ELSE (v_ef_healthy::numeric / v_ef_total) * 100 END;

  -- SLO score: % of latest measurements compliant
  SELECT count(*), count(*) FILTER (WHERE compliant)
    INTO v_slo_total, v_slo_ok
    FROM (
      SELECT DISTINCT ON (slo_id) slo_id, compliant
      FROM public.payment_slo_measurements
      WHERE window_end > now() - (_window_minutes || ' minutes')::interval
      ORDER BY slo_id, window_end DESC
    ) latest;
  v_slo := CASE WHEN v_slo_total = 0 THEN 100 ELSE (v_slo_ok::numeric / v_slo_total) * 100 END;

  -- Certification score: pass rate of runs in window
  SELECT count(*), count(*) FILTER (WHERE status = 'PASSED')
    INTO v_cert_total, v_cert_pass
    FROM public.payment_certification_runs
    WHERE completed_at > now() - (_window_minutes || ' minutes')::interval;
  v_cert := CASE WHEN v_cert_total = 0 THEN 100 ELSE (v_cert_pass::numeric / v_cert_total) * 100 END;

  -- Journey score: % PASS validations in window
  SELECT count(*), count(*) FILTER (WHERE status = 'PASS')
    INTO v_journey_total, v_journey_ok
    FROM public.payment_journey_validations
    WHERE created_at > now() - (_window_minutes || ' minutes')::interval;
  v_journey := CASE WHEN v_journey_total = 0 THEN coalesce(v_callback,0) ELSE (v_journey_ok::numeric / v_journey_total) * 100 END;

  -- Weighted composite (matches directive priorities)
  v_score := round(
    (v_callback * 0.30) +
    (v_journey  * 0.25) +
    (v_edge     * 0.20) +
    (v_slo      * 0.15) +
    (v_cert     * 0.10)
  , 2);

  v_details := jsonb_build_object(
    'callback', jsonb_build_object('score', v_callback, 'inv_24h', v_cb.inv_24h, 'success_rate_24h', v_cb.success_rate_24h, 'health', v_cb.health),
    'edge_functions', jsonb_build_object('score', v_edge, 'healthy', v_ef_healthy, 'total', v_ef_total),
    'slo', jsonb_build_object('score', v_slo, 'compliant', v_slo_ok, 'total', v_slo_total),
    'certification', jsonb_build_object('score', v_cert, 'passed', v_cert_pass, 'total', v_cert_total),
    'journey', jsonb_build_object('score', v_journey, 'passed', v_journey_ok, 'total', v_journey_total)
  );

  INSERT INTO public.payment_reliability_snapshots(
    reliability_score, callback_score, journey_score, edge_function_score, slo_score, certification_score,
    window_minutes, details
  ) VALUES (v_score, v_callback, v_journey, v_edge, v_slo, v_cert, _window_minutes, v_details);

  RETURN jsonb_build_object('reliability_score', v_score, 'window_minutes', _window_minutes, 'details', v_details);
END $$;

GRANT EXECUTE ON FUNCTION public.compute_payment_reliability_score(int) TO authenticated, service_role;

-- 6) Schedule every 5 minutes -------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  PERFORM cron.unschedule('payment-reliability-score-5min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'payment-reliability-score-5min',
  '*/5 * * * *',
  $$ SELECT public.compute_payment_reliability_score(60); $$
);
