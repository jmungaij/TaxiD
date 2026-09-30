-- Sharper RN-01 probe: prove the transition table itself, not the activation gate,
-- plus a real measurement of the availability path for RN-13.

CREATE OR REPLACE FUNCTION public.rental_probe_transition_table(_environment text DEFAULT 'live')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ok boolean := false; msg text; uid uuid;
BEGIN
  BEGIN
    INSERT INTO public.rental_fleet_units (plate, make, model, status, provenance)
    VALUES ('PROBE-RN01B','Probe','Unit','RETIRED','CERTIFICATION_PROBE') RETURNING id INTO uid;
    BEGIN
      -- RETIRED -> UNDER_SERVICE is absent from the transition table and does
      -- not touch the activation gate, so only the state machine can refuse it.
      UPDATE public.rental_fleet_units SET status = 'UNDER_SERVICE' WHERE id = uid;
      ok := false; msg := 'transition was accepted';
    EXCEPTION WHEN OTHERS THEN
      ok := SQLERRM LIKE '%ILLEGAL_TRANSITION_VEHICLE%'; msg := SQLERRM;
    END;
    RAISE EXCEPTION 'PROBE_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'PROBE_ROLLBACK' THEN ok := false; msg := SQLERRM; END IF;
  END;

  INSERT INTO public.rental_control_evidence (control_code, verdict, environment, executed_by, evidence)
  VALUES ('RN-01', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, _environment, 'rental_probe_transition_table',
          jsonb_build_object('probe','RETIRED -> UNDER_SERVICE on a real row','database_response', msg));

  RETURN jsonb_build_object('ok', ok, 'database_response', msg);
END; $$;
REVOKE ALL ON FUNCTION public.rental_probe_transition_table(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_probe_transition_table(text) TO service_role;

CREATE OR REPLACE FUNCTION public.rental_probe_latency(
  _environment text DEFAULT 'live', _iterations integer DEFAULT 20
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE i int; t0 timestamptz; ms numeric; samples numeric[] := '{}';
        avail_p95 numeric; recon_ms numeric; tower_ms numeric; budget numeric := 400;
        verdict text;
BEGIN
  FOR i IN 1..greatest(1, least(coalesce(_iterations,20), 100)) LOOP
    t0 := clock_timestamp();
    PERFORM public.rental_fleet_availability('SELF_DRIVE', current_date + (i % 30), 3);
    ms := extract(epoch FROM clock_timestamp() - t0) * 1000;
    samples := samples || ms;
  END LOOP;

  SELECT percentile_disc(0.95) WITHIN GROUP (ORDER BY s) INTO avail_p95 FROM unnest(samples) s;

  t0 := clock_timestamp();
  PERFORM count(*) FROM public.v_rental_reconciliation;
  recon_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;

  t0 := clock_timestamp();
  PERFORM * FROM public.v_rental_control_tower;
  tower_ms := extract(epoch FROM clock_timestamp() - t0) * 1000;

  verdict := CASE WHEN avail_p95 <= budget AND recon_ms <= 1000 AND tower_ms <= 1000
                  THEN 'PARTIAL' ELSE 'FAIL' END;

  INSERT INTO public.rental_control_evidence (control_code, verdict, environment, executed_by, evidence, blocked_reason)
  VALUES ('RN-13', verdict, _environment, 'rental_probe_latency',
    jsonb_build_object('availability_p95_ms', round(avail_p95,2), 'availability_budget_ms', budget,
                       'reconciliation_view_ms', round(recon_ms,2), 'control_tower_view_ms', round(tower_ms,2),
                       'iterations', array_length(samples,1)),
    'Database paths measured. End-to-end quote, booking and payment-callback latency still needs measuring under load.');

  RETURN jsonb_build_object('ok', true, 'verdict', verdict,
    'availability_p95_ms', round(avail_p95,2), 'reconciliation_view_ms', round(recon_ms,2),
    'control_tower_view_ms', round(tower_ms,2));
END; $$;
REVOKE ALL ON FUNCTION public.rental_probe_latency(text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_probe_latency(text,integer) TO service_role;