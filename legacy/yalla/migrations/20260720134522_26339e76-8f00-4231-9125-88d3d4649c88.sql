
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

  -- Open incidents for criticals (correct schema: expected_state / actual_state / metadata; open = resolved_at IS NULL)
  IF v_critical > 0 THEN
    INSERT INTO public.payment_projection_incidents(
      payment_attempt_id, projection_name, expected_state, actual_state,
      severity, opened_at, metadata)
    SELECT DISTINCT f.payment_attempt_id, f.projection_name,
           f.detail->>'expected', f.projection_state,
           'critical', now(),
           jsonb_build_object('scan_id', v_scan_id, 'canonical', f.canonical_state)
      FROM public.projection_drift_findings f
     WHERE f.scan_id=v_scan_id AND f.severity='critical'
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_projection_incidents pi
          WHERE pi.payment_attempt_id=f.payment_attempt_id
            AND pi.projection_name=f.projection_name
            AND pi.resolved_at IS NULL);
  END IF;

  RETURN v_scan;
END $$;
