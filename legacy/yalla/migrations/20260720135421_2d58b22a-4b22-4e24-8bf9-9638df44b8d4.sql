
CREATE OR REPLACE FUNCTION public.payment_certification_next_action(_suite text DEFAULT 'chain')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row record;
BEGIN
  SELECT s.id, s.scenario_key INTO v_row
    FROM public.payment_certification_scenarios s
    LEFT JOIN public.payment_certification_forensics f ON f.scenario_id = s.id
   WHERE s.status = 'FAILED'
     AND s.scenario_key LIKE (_suite||'\_%') ESCAPE '\'
     AND f.id IS NULL
   ORDER BY s.started_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('action','CLASSIFY','scenario_id',v_row.id,
      'scenario_key',v_row.scenario_key,'reason','No forensic record yet.');
  END IF;

  SELECT s.id, s.scenario_key, f.failure_class INTO v_row
    FROM public.payment_certification_scenarios s
    JOIN public.payment_certification_forensics f ON f.scenario_id = s.id
    LEFT JOIN public.payment_certification_regressions r ON r.scenario_key = s.scenario_key
   WHERE s.status = 'FAILED'
     AND s.scenario_key LIKE (_suite||'\_%') ESCAPE '\'
     AND (r.scenario_key IS NULL OR r.last_verify_status <> 'GREEN')
   ORDER BY s.started_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('action','REPAIR_AND_REPLAY','scenario_id',v_row.id,
      'scenario_key',v_row.scenario_key,'reason','Classified but no green regression pin.',
      'failure_class', v_row.failure_class);
  END IF;

  RETURN jsonb_build_object('action','NONE','reason','All '||_suite||'_* scenarios have green pins.');
END $$;

CREATE OR REPLACE FUNCTION public.compute_platform_readiness_v2()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_snap public.platform_readiness_snapshots;
  v_failed int := 0; v_classified int := 0; v_pinned int := 0; v_chain_total int := 0;
  v_blocking text; v_first_fail timestamptz;
  v_functions text[]; v_recommend text;
  v_confidence numeric; v_next jsonb; v_first_signal text;
BEGIN
  BEGIN
    v_snap := public.compute_platform_readiness();
  EXCEPTION WHEN OTHERS THEN
    -- Legacy readiness function has a known array bug in some datasets; degrade gracefully.
    v_snap := NULL;
  END;

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
  v_first_signal := CASE WHEN v_snap.failed_signals IS NOT NULL AND array_length(v_snap.failed_signals,1)>0
                         THEN v_snap.failed_signals[1] ELSE NULL END;

  IF COALESCE(v_snap.ready,false) AND v_failed = 0 THEN
    v_blocking := NULL;
    v_recommend := 'None — platform is READY.';
  ELSE
    v_blocking := CASE
      WHEN v_failed > 0 THEN 'certification.'||COALESCE((v_next->>'scenario_key'),'chain_suite')
      WHEN v_first_signal IS NOT NULL THEN v_first_signal
      ELSE 'unknown' END;
    v_recommend := CASE v_next->>'action'
      WHEN 'CLASSIFY'          THEN 'Classify '||(v_next->>'scenario_key')||' failure (auto-forensics).'
      WHEN 'REPAIR_AND_REPLAY' THEN 'Repair '||(v_next->>'scenario_key')||' ('||COALESCE(v_next->>'failure_class','?')||') then replay in isolation, then pin regression.'
      ELSE                          'Resolve failed signal: '||COALESCE(v_first_signal,'unknown')||'.'
    END;
  END IF;

  v_confidence := round(
    LEAST(1.0,
      (CASE WHEN v_failed = 0 THEN 1.0 ELSE v_classified::numeric / GREATEST(v_failed,1) END) * 0.4
      + (CASE WHEN v_chain_total = 0 THEN 1.0 ELSE v_pinned::numeric / v_chain_total END) * 0.4
      + (COALESCE(v_snap.readiness_score,0) / 100.0) * 0.2
    ) * 100, 2);

  RETURN jsonb_build_object(
    'status',                 CASE WHEN COALESCE(v_snap.ready,false) AND v_failed=0 THEN 'READY' ELSE 'BLOCKED' END,
    'readiness_score',        COALESCE(v_snap.readiness_score, 0),
    'signal_scores',          COALESCE(v_snap.signal_scores, '{}'::jsonb),
    'reasons',                COALESCE(v_snap.reasons, '[]'::jsonb),
    'failed_signals',         COALESCE(v_snap.failed_signals, ARRAY[]::text[]),
    'evidence_confidence',    v_confidence,
    'blocking_component',     v_blocking,
    'first_failure_at',       v_first_fail,
    'affected_functions',     COALESCE(v_functions, ARRAY[]::text[]),
    'recovery_recommendation',v_recommend,
    'chain_progress',         jsonb_build_object(
      'total', v_chain_total, 'failing', v_failed,
      'classified', v_classified, 'green_pinned', v_pinned),
    'next_action',            v_next,
    'snapshot_id',            v_snap.id,
    'computed_at',            COALESCE(v_snap.computed_at, now()));
END $$;
