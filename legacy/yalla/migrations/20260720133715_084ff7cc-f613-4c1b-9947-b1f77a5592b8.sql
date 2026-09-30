
CREATE TABLE IF NOT EXISTS public.projection_drift_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_interval interval NOT NULL DEFAULT '24 hours',
  scanned int NOT NULL DEFAULT 0,
  healthy int NOT NULL DEFAULT 0,
  minor int NOT NULL DEFAULT 0,
  major int NOT NULL DEFAULT 0,
  critical int NOT NULL DEFAULT 0,
  drift_score numeric(5,2) NOT NULL DEFAULT 100,
  blocked_promotion boolean NOT NULL DEFAULT false,
  duration_ms int,
  triggered_by text NOT NULL DEFAULT 'system',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.projection_drift_scans TO authenticated;
GRANT ALL ON public.projection_drift_scans TO service_role;
ALTER TABLE public.projection_drift_scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drift_scans_admin_read" ON public.projection_drift_scans
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'finance_admin'));
CREATE POLICY "drift_scans_service_write" ON public.projection_drift_scans
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_drift_scans_created ON public.projection_drift_scans (created_at DESC);

CREATE TABLE IF NOT EXISTS public.projection_drift_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.projection_drift_scans(id) ON DELETE CASCADE,
  payment_attempt_id uuid NOT NULL,
  correlation_id text,
  projection_name text NOT NULL,
  canonical_state text NOT NULL,
  projection_state text,
  severity text NOT NULL CHECK (severity IN ('healthy','minor','major','critical')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.projection_drift_findings TO authenticated;
GRANT ALL ON public.projection_drift_findings TO service_role;
ALTER TABLE public.projection_drift_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drift_findings_admin_read" ON public.projection_drift_findings
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'finance_admin'));
CREATE POLICY "drift_findings_service_write" ON public.projection_drift_findings
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_drift_findings_scan ON public.projection_drift_findings (scan_id, severity);
CREATE INDEX IF NOT EXISTS idx_drift_findings_attempt ON public.projection_drift_findings (payment_attempt_id);

CREATE TABLE IF NOT EXISTS public.projection_replay_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_attempt_id uuid NOT NULL,
  correlation_id text,
  before_hash text NOT NULL,
  after_hash text NOT NULL,
  equal boolean NOT NULL,
  passed boolean NOT NULL,
  expected_delta jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  replay_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_ms int,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.projection_replay_certifications TO authenticated;
GRANT ALL ON public.projection_replay_certifications TO service_role;
ALTER TABLE public.projection_replay_certifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "replay_cert_admin_read" ON public.projection_replay_certifications
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'finance_admin'));
CREATE POLICY "replay_cert_service_write" ON public.projection_replay_certifications
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_replay_cert_attempt ON public.projection_replay_certifications (payment_attempt_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.payment_projection_drift_scan(
  _window interval DEFAULT '24 hours',
  _triggered_by text DEFAULT 'system'
) RETURNS public.projection_drift_scans
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_scan public.projection_drift_scans;
  v_scan_id uuid := gen_random_uuid();
  v_t0 timestamptz := clock_timestamp();
  v_row record;
  v_expected_mpesa text;
  v_mpesa_state text;
  v_wallet_posted boolean;
  v_severity text;
  v_scanned int := 0;
  v_healthy int := 0;
  v_minor int := 0;
  v_major int := 0;
  v_critical int := 0;
  v_score numeric(5,2);
BEGIN
  INSERT INTO public.projection_drift_scans(id, window_interval, triggered_by)
  VALUES (v_scan_id, _window, _triggered_by);

  FOR v_row IN
    SELECT id, state::text AS state, checkout_request_id, wallet_posted, wallet_id, amount_cents,
           COALESCE(metadata->>'correlation_id', id::text) AS correlation_id
      FROM public.payment_attempts
     WHERE updated_at > now() - _window
       AND state::text IN ('COMPLETED','FAILED','CANCELLED','TIMED_OUT','REVERSED','RECONCILED')
  LOOP
    v_scanned := v_scanned + 1;

    SELECT status::text INTO v_mpesa_state
      FROM public.mpesa_transactions
     WHERE checkout_request_id = v_row.checkout_request_id
     ORDER BY updated_at DESC LIMIT 1;

    v_expected_mpesa := CASE v_row.state
      WHEN 'COMPLETED' THEN 'SUCCESS'
      WHEN 'FAILED' THEN 'FAILED'
      WHEN 'CANCELLED' THEN 'CANCELLED'
      WHEN 'TIMED_OUT' THEN 'FAILED'
      WHEN 'REVERSED' THEN 'REVERSED'
      WHEN 'RECONCILED' THEN 'SUCCESS'
      ELSE NULL END;

    IF v_mpesa_state IS NULL THEN v_severity := 'major';
    ELSIF v_mpesa_state = v_expected_mpesa THEN v_severity := 'healthy';
    ELSIF v_mpesa_state IN ('PENDING','PROCESSING') THEN v_severity := 'critical';
    ELSE v_severity := 'major'; END IF;

    INSERT INTO public.projection_drift_findings(
      scan_id, payment_attempt_id, correlation_id, projection_name,
      canonical_state, projection_state, severity, detail)
    VALUES (v_scan_id, v_row.id, v_row.correlation_id, 'mpesa_transactions',
            v_row.state, v_mpesa_state, v_severity,
            jsonb_build_object('expected', v_expected_mpesa));

    IF v_severity='critical' THEN v_critical := v_critical+1;
    ELSIF v_severity='major' THEN v_major := v_major+1;
    ELSIF v_severity='minor' THEN v_minor := v_minor+1;
    ELSE v_healthy := v_healthy+1; END IF;

    IF v_row.state IN ('COMPLETED','RECONCILED') THEN
      SELECT EXISTS(SELECT 1 FROM public.wallet_transactions
                     WHERE reference = v_row.checkout_request_id) INTO v_wallet_posted;
      IF v_wallet_posted THEN v_severity := 'healthy'; ELSE v_severity := 'critical'; END IF;
      INSERT INTO public.projection_drift_findings(
        scan_id, payment_attempt_id, correlation_id, projection_name,
        canonical_state, projection_state, severity, detail)
      VALUES (v_scan_id, v_row.id, v_row.correlation_id, 'wallet_transactions',
              v_row.state, CASE WHEN v_wallet_posted THEN 'POSTED' ELSE 'MISSING' END,
              v_severity, jsonb_build_object('wallet_posted_flag', v_row.wallet_posted));
      IF v_severity='critical' THEN v_critical := v_critical+1; ELSE v_healthy := v_healthy+1; END IF;
    END IF;
  END LOOP;

  v_score := GREATEST(0, 100 - (v_critical*10 + v_major*3 + v_minor));

  UPDATE public.projection_drift_scans SET
    scanned=v_scanned, healthy=v_healthy, minor=v_minor, major=v_major, critical=v_critical,
    drift_score=v_score, blocked_promotion=(v_critical>0 OR v_major>0),
    duration_ms=extract(millisecond from clock_timestamp()-v_t0)::int
  WHERE id=v_scan_id RETURNING * INTO v_scan;

  IF v_critical > 0 THEN
    INSERT INTO public.payment_projection_incidents(
      payment_attempt_id, projection_name, severity, status, opened_at, details)
    SELECT DISTINCT f.payment_attempt_id, f.projection_name, 'critical', 'open', now(),
           jsonb_build_object('scan_id', v_scan_id, 'canonical', f.canonical_state,
                              'projection', f.projection_state)
      FROM public.projection_drift_findings f
     WHERE f.scan_id=v_scan_id AND f.severity='critical'
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_projection_incidents pi
          WHERE pi.payment_attempt_id=f.payment_attempt_id
            AND pi.projection_name=f.projection_name
            AND pi.status='open');
  END IF;

  RETURN v_scan;
END $$;
REVOKE ALL ON FUNCTION public.payment_projection_drift_scan(interval, text) FROM public;
GRANT EXECUTE ON FUNCTION public.payment_projection_drift_scan(interval, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.payment_projection_replay_certify(_attempt_id uuid)
RETURNS public.projection_replay_certifications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.projection_replay_certifications;
  v_before jsonb;
  v_after jsonb;
  v_before_hash text;
  v_after_hash text;
  v_replay jsonb;
  v_attempt record;
  v_t0 timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_attempt FROM public.payment_attempts WHERE id = _attempt_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;

  SELECT jsonb_build_object(
    'mpesa', (SELECT to_jsonb(m) - 'raw_callback' - 'updated_at'
                FROM public.mpesa_transactions m
               WHERE m.checkout_request_id = v_attempt.checkout_request_id
               ORDER BY updated_at DESC LIMIT 1),
    'wallet', (SELECT jsonb_agg(to_jsonb(w) - 'created_at' ORDER BY w.id)
                 FROM public.wallet_transactions w
                WHERE w.reference = v_attempt.checkout_request_id),
    'attempt_state', v_attempt.state::text,
    'wallet_posted', v_attempt.wallet_posted
  ) INTO v_before;
  v_before_hash := encode(digest(v_before::text, 'sha256'), 'hex');

  v_replay := public.payment_replay_projection(_attempt_id, v_attempt.checkout_request_id, NULL);

  SELECT jsonb_build_object(
    'mpesa', (SELECT to_jsonb(m) - 'raw_callback' - 'updated_at'
                FROM public.mpesa_transactions m
               WHERE m.checkout_request_id = v_attempt.checkout_request_id
               ORDER BY updated_at DESC LIMIT 1),
    'wallet', (SELECT jsonb_agg(to_jsonb(w) - 'created_at' ORDER BY w.id)
                 FROM public.wallet_transactions w
                WHERE w.reference = v_attempt.checkout_request_id),
    'attempt_state', (SELECT state::text FROM public.payment_attempts WHERE id = _attempt_id),
    'wallet_posted', (SELECT wallet_posted FROM public.payment_attempts WHERE id = _attempt_id)
  ) INTO v_after;
  v_after_hash := encode(digest(v_after::text, 'sha256'), 'hex');

  INSERT INTO public.projection_replay_certifications(
    payment_attempt_id, correlation_id, before_hash, after_hash,
    equal, passed, before_snapshot, after_snapshot, replay_result, duration_ms)
  VALUES (
    _attempt_id, v_attempt.checkout_request_id, v_before_hash, v_after_hash,
    v_before_hash=v_after_hash, v_before_hash=v_after_hash,
    v_before, v_after, v_replay,
    extract(millisecond from clock_timestamp()-v_t0)::int)
  RETURNING * INTO v_row;
  RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.payment_projection_replay_certify(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.payment_projection_replay_certify(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.compute_platform_readiness()
 RETURNS platform_readiness_snapshots
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_health record; v_workflow_ok int; v_workflow_total int;
  v_signal jsonb := '{}'::jsonb; v_reasons jsonb := '[]'::jsonb;
  v_failed text[] := '{}'; v_score numeric(5,2); v_ready boolean;
  v_snap public.platform_readiness_snapshots;
  v_callback numeric := 100; v_oauth numeric := 100; v_stk numeric := 100;
  v_settlement numeric := 100; v_projection numeric := 100;
  v_last_scan record;
BEGIN
  SELECT * INTO v_health FROM public.payment_platform_health ORDER BY window_end DESC LIMIT 1;
  IF v_health IS NOT NULL THEN
    v_callback := COALESCE(v_health.callback_success_rate,100);
    v_oauth := COALESCE(v_health.oauth_success_rate,100);
    v_stk := COALESCE(v_health.stk_success_rate,100);
  END IF;
  SELECT count(*) FILTER (WHERE status='CERTIFIED'), count(*)
    INTO v_workflow_ok, v_workflow_total
    FROM public.certification_workflows WHERE enabled;
  SELECT * INTO v_last_scan FROM public.projection_drift_scans
    WHERE created_at > now() - interval '24 hours'
    ORDER BY created_at DESC LIMIT 1;
  IF v_last_scan IS NOT NULL THEN v_projection := v_last_scan.drift_score; END IF;

  v_signal := jsonb_build_object(
    'callback',v_callback,'oauth',v_oauth,'stk',v_stk,'settlement',v_settlement,
    'workflows',CASE WHEN v_workflow_total=0 THEN 100 ELSE round((v_workflow_ok::numeric*100)/v_workflow_total,2) END,
    'projection_consistency', v_projection);

  IF v_callback<95 THEN v_failed:=v_failed||'callback';
    v_reasons:=v_reasons||jsonb_build_object('signal','callback','ok',false,'detail',v_callback||'%');
  ELSE v_reasons:=v_reasons||jsonb_build_object('signal','callback','ok',true,'detail','healthy'); END IF;
  IF v_oauth<95 THEN v_failed:=v_failed||'oauth';
    v_reasons:=v_reasons||jsonb_build_object('signal','oauth','ok',false,'detail',v_oauth||'%');
  ELSE v_reasons:=v_reasons||jsonb_build_object('signal','oauth','ok',true,'detail','healthy'); END IF;
  IF v_stk<90 THEN v_failed:=v_failed||'stk';
    v_reasons:=v_reasons||jsonb_build_object('signal','stk','ok',false,'detail',v_stk||'%');
  ELSE v_reasons:=v_reasons||jsonb_build_object('signal','stk','ok',true,'detail','healthy'); END IF;
  IF v_workflow_total>0 AND v_workflow_ok<v_workflow_total THEN v_failed:=v_failed||'workflows';
    v_reasons:=v_reasons||jsonb_build_object('signal','workflows','ok',false,'detail',v_workflow_ok||'/'||v_workflow_total);
  ELSE v_reasons:=v_reasons||jsonb_build_object('signal','workflows','ok',true,'detail','all certified'); END IF;
  IF v_projection<100 THEN v_failed:=v_failed||'projection_consistency';
    v_reasons:=v_reasons||jsonb_build_object('signal','projection_consistency','ok',false,'detail',v_projection||'% (drift detected)');
  ELSE v_reasons:=v_reasons||jsonb_build_object('signal','projection_consistency','ok',true,'detail','100% synchronized'); END IF;

  v_score := round((v_callback*0.25 + v_oauth*0.15 + v_stk*0.15 + v_settlement*0.10
                   + (CASE WHEN v_workflow_total=0 THEN 100 ELSE (v_workflow_ok::numeric*100)/v_workflow_total END)*0.20
                   + v_projection*0.15), 2);
  v_ready := array_length(v_failed,1) IS NULL AND v_score >= 90;

  INSERT INTO public.platform_readiness_snapshots(ready, readiness_score, signal_scores, reasons, failed_signals)
  VALUES (v_ready, v_score, v_signal, v_reasons, v_failed) RETURNING * INTO v_snap;
  RETURN v_snap;
END; $function$;

CREATE OR REPLACE FUNCTION public.compute_payment_reliability_score(_window_minutes integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_callback numeric := 0; v_journey numeric := 0; v_edge numeric := 0;
  v_slo numeric := 0; v_cert numeric := 0; v_projection numeric := 100;
  v_score numeric := 0; v_details jsonb := '{}'::jsonb;
  v_cb record; v_ef_total int; v_ef_healthy int;
  v_slo_total int; v_slo_ok int;
  v_cert_total int; v_cert_pass int;
  v_journey_total int; v_journey_ok int;
  v_last_scan record;
BEGIN
  SELECT * INTO v_cb FROM public.v_callback_invocation_health;
  v_callback := CASE WHEN v_cb.inv_24h=0 THEN 0 ELSE v_cb.success_rate_24h END;

  SELECT count(*), count(*) FILTER (WHERE health='HEALTHY') INTO v_ef_total, v_ef_healthy
    FROM public.v_edge_function_health WHERE is_payment_critical;
  v_edge := CASE WHEN v_ef_total=0 THEN 100 ELSE (v_ef_healthy::numeric/v_ef_total)*100 END;

  SELECT count(*), count(*) FILTER (WHERE compliant) INTO v_slo_total, v_slo_ok
    FROM (SELECT DISTINCT ON (slo_id) slo_id, compliant FROM public.payment_slo_measurements
           WHERE window_end > now() - (_window_minutes||' minutes')::interval
           ORDER BY slo_id, window_end DESC) latest;
  v_slo := CASE WHEN v_slo_total=0 THEN 100 ELSE (v_slo_ok::numeric/v_slo_total)*100 END;

  SELECT count(*), count(*) FILTER (WHERE status='PASSED') INTO v_cert_total, v_cert_pass
    FROM public.payment_certification_runs
    WHERE completed_at > now() - (_window_minutes||' minutes')::interval;
  v_cert := CASE WHEN v_cert_total=0 THEN 100 ELSE (v_cert_pass::numeric/v_cert_total)*100 END;

  SELECT count(*), count(*) FILTER (WHERE status='PASS') INTO v_journey_total, v_journey_ok
    FROM public.payment_journey_validations
    WHERE computed_at > now() - (_window_minutes||' minutes')::interval;
  v_journey := CASE WHEN v_journey_total=0 THEN coalesce(v_callback,0)
                    ELSE (v_journey_ok::numeric/v_journey_total)*100 END;

  SELECT * INTO v_last_scan FROM public.projection_drift_scans
    WHERE created_at > now() - (_window_minutes||' minutes')::interval
    ORDER BY created_at DESC LIMIT 1;
  IF v_last_scan IS NOT NULL THEN v_projection := v_last_scan.drift_score; END IF;

  v_score := round(
    (v_callback*0.25) + (v_journey*0.20) + (v_edge*0.15) + (v_slo*0.10)
    + (v_cert*0.10) + (v_projection*0.20), 2);

  v_details := jsonb_build_object(
    'callback', jsonb_build_object('score',v_callback,'inv_24h',v_cb.inv_24h,'success_rate_24h',v_cb.success_rate_24h,'health',v_cb.health),
    'edge_functions', jsonb_build_object('score',v_edge,'healthy',v_ef_healthy,'total',v_ef_total),
    'slo', jsonb_build_object('score',v_slo,'compliant',v_slo_ok,'total',v_slo_total),
    'certification', jsonb_build_object('score',v_cert,'passed',v_cert_pass,'total',v_cert_total),
    'journey', jsonb_build_object('score',v_journey,'passed',v_journey_ok,'total',v_journey_total),
    'projection_consistency', jsonb_build_object('score',v_projection,'scan_id', v_last_scan.id));

  INSERT INTO public.payment_reliability_snapshots(
    reliability_score, callback_score, journey_score, edge_function_score, slo_score, certification_score,
    window_minutes, details)
  VALUES (v_score, v_callback, v_journey, v_edge, v_slo, v_cert, _window_minutes, v_details);
  RETURN jsonb_build_object('reliability_score', v_score, 'window_minutes', _window_minutes, 'details', v_details);
END $function$;

INSERT INTO public.certification_scenarios_registry
  (scenario_key, scenario_name, description, workflow_key, expected_outcome, simulation_kind, simulation_params, severity, enabled)
VALUES
  ('projection_consistency_success','Projection consistency: success','Verify successful payment converges across all projections','wallet_topup','PASS','projection_drift','{"outcome":"success"}'::jsonb,'high',true),
  ('projection_consistency_cancelled','Projection consistency: cancelled','Cancelled payment produces no wallet posting and CANCELLED terminal state','wallet_topup','PASS','projection_drift','{"outcome":"cancelled","result_code":1032}'::jsonb,'high',true),
  ('projection_consistency_timeout','Projection consistency: timeout','Timeout produces FAILED terminal state with no drift','wallet_topup','PASS','projection_drift','{"outcome":"timeout","result_code":1037}'::jsonb,'high',true),
  ('projection_replay_idempotent','Projection replay idempotency','10x replay leaves wallet balance unchanged','wallet_topup','PASS','projection_replay','{"iterations":10}'::jsonb,'critical',true),
  ('projection_callback_replay','Duplicate callback replay','Duplicate callback yields exactly-once wallet credit','wallet_topup','PASS','projection_replay','{"duplicate_callback":true}'::jsonb,'critical',true),
  ('projection_worker_restart','Worker restart recovery','Interrupted projection sync converges after restart','wallet_topup','PASS','projection_replay','{"simulate":"restart"}'::jsonb,'high',true)
ON CONFLICT (scenario_key) DO NOTHING;
