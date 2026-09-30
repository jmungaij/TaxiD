CREATE OR REPLACE FUNCTION public.intern_compute_performance(p_intern uuid, p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  w jsonb;
  v_weeks numeric;
  v_modules_total int; v_modules_validated int; v_avg_assessment numeric;
  v_accepted int; v_submitted int; v_avg_quality numeric; v_rework int;
  v_ontime int; v_due int;
  v_leads int; v_qualified int; v_opps int; v_assists int; v_revenue numeric;
  v_flags int; v_reviews numeric;
  learning numeric; productivity numeric; quality numeric;
  commercial numeric; operational numeric; conduct numeric;
  wl numeric; wp numeric; wq numeric; wc numeric; wo numeric; wd numeric; wtot numeric;
  idx numeric; confidence numeric; breakdown jsonb;
BEGIN
  IF NOT public.intern_programme_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised to compute intern performance.';
  END IF;

  SELECT COALESCE(t.performance_weights,
                  '{"learning":15,"productivity":20,"quality":15,"commercial":25,"operational":15,"conduct":10}'::jsonb)
    INTO w
  FROM public.intern_profiles p LEFT JOIN public.intern_tracks t ON t.id = p.track_id
  WHERE p.id = p_intern;
  IF w IS NULL THEN RAISE EXCEPTION 'Intern % not found.', p_intern; END IF;

  -- Track scorecards may omit a dimension or use track-specific ones (e.g.
  -- supply_development). Missing weights count as zero, supply development is
  -- scored through the commercial dimension, and the index is normalised on the
  -- weights actually defined — so a partial scorecard can never yield NULL.
  wl := GREATEST(0, COALESCE((w->>'learning')::numeric, 0));
  wp := GREATEST(0, COALESCE((w->>'productivity')::numeric, 0));
  wq := GREATEST(0, COALESCE((w->>'quality')::numeric, 0));
  wc := GREATEST(0, COALESCE((w->>'commercial')::numeric, 0))
      + GREATEST(0, COALESCE((w->>'supply_development')::numeric, 0));
  wo := GREATEST(0, COALESCE((w->>'operational')::numeric, 0));
  wd := GREATEST(0, COALESCE((w->>'conduct')::numeric, 0));
  wtot := wl + wp + wq + wc + wo + wd;
  IF wtot <= 0 THEN
    wl := 15; wp := 20; wq := 15; wc := 25; wo := 15; wd := 10; wtot := 100;
  END IF;

  v_weeks := GREATEST(1, (p_end - p_start)::numeric / 7.0);

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'validated'),
         COALESCE(AVG(assessment_score) FILTER (WHERE assessment_score IS NOT NULL), 0)
    INTO v_modules_total, v_modules_validated, v_avg_assessment
  FROM public.intern_learning_progress WHERE intern_id = p_intern;

  SELECT COUNT(*) FILTER (WHERE status IN ('ACCEPTED','COMPLETED')),
         COUNT(*) FILTER (WHERE status IN ('SUBMITTED','UNDER_REVIEW','ACCEPTED','COMPLETED','REWORK')),
         COALESCE(AVG(quality_score) FILTER (WHERE quality_score IS NOT NULL), 0),
         COALESCE(SUM(rework_count), 0),
         COUNT(*) FILTER (WHERE deadline IS NOT NULL AND accepted_at IS NOT NULL AND accepted_at <= deadline),
         COUNT(*) FILTER (WHERE deadline IS NOT NULL)
    INTO v_accepted, v_submitted, v_avg_quality, v_rework, v_ontime, v_due
  FROM public.intern_work_items
  WHERE intern_id = p_intern AND created_at::date BETWEEN p_start AND p_end;

  SELECT COUNT(*) FILTER (WHERE attribution_type = 'LEAD_CREATED' AND verified),
         COUNT(*) FILTER (WHERE attribution_type = 'LEAD_QUALIFIED' AND verified),
         COUNT(*) FILTER (WHERE attribution_type = 'OPPORTUNITY_CREATED' AND verified),
         COUNT(*) FILTER (WHERE attribution_type IN ('SALES_ASSIST','BOOKING_ASSIST','CONVERSION_ASSIST') AND verified),
         COALESCE(SUM(amount_kes) FILTER (WHERE attribution_type = 'REVENUE_ATTRIBUTED' AND verified AND source_system <> 'manual'), 0)
    INTO v_leads, v_qualified, v_opps, v_assists, v_revenue
  FROM public.intern_commercial_attributions
  WHERE intern_id = p_intern AND created_at::date BETWEEN p_start AND p_end;

  SELECT COUNT(*) INTO v_flags FROM public.intern_integrity_flags
  WHERE intern_id = p_intern AND status = 'SUBSTANTIATED';

  SELECT COALESCE(AVG(subjective_rating), 0) INTO v_reviews FROM public.intern_reviews
  WHERE intern_id = p_intern AND subjective_rating IS NOT NULL
    AND created_at::date BETWEEN p_start AND p_end;

  learning := COALESCE(CASE WHEN v_modules_total = 0 THEN 0
    ELSE LEAST(100, (v_modules_validated::numeric / v_modules_total) * 70
                    + (v_avg_assessment * 0.30)) END, 0);
  productivity := COALESCE(LEAST(100, (v_accepted::numeric / v_weeks) / 5.0 * 100), 0);
  quality := COALESCE(GREATEST(0, LEAST(100, v_avg_quality - LEAST(30, v_rework * 5))), 0);
  commercial := COALESCE(LEAST(100, v_leads * 2 + v_qualified * 5 + v_opps * 8 + v_assists * 10
                           + LEAST(40, v_revenue / 50000.0 * 20)), 0);
  operational := COALESCE(CASE WHEN v_due = 0 THEN CASE WHEN v_accepted > 0 THEN 70 ELSE 0 END
                      ELSE (v_ontime::numeric / v_due) * 100 END, 0);
  conduct := COALESCE(GREATEST(0, 100 - v_flags * 25
                     - CASE WHEN v_reviews > 0 AND v_reviews < 3 THEN 20 ELSE 0 END), 0);

  idx := COALESCE(ROUND((learning * wl + productivity * wp + quality * wq
                       + commercial * wc + operational * wo + conduct * wd) / wtot, 2), 0);

  confidence := COALESCE(ROUND(LEAST(100,
      (CASE WHEN v_modules_validated > 0 THEN 25 ELSE 0 END)
    + (CASE WHEN v_accepted > 0 THEN 25 ELSE 0 END)
    + (CASE WHEN v_avg_quality > 0 THEN 25 ELSE 0 END)
    + (CASE WHEN v_leads + v_qualified + v_opps + v_assists > 0 OR v_revenue > 0 THEN 25 ELSE 0 END)), 2), 0);

  breakdown := jsonb_build_object(
    'weights', w,
    'weights_applied', jsonb_build_object('learning', wl, 'productivity', wp, 'quality', wq,
                                          'commercial', wc, 'operational', wo, 'conduct', wd,
                                          'total', wtot,
                                          'note', 'Missing dimensions weighted zero; supply_development scored as commercial'),
    'weeks_in_period', ROUND(v_weeks, 2),
    'learning', jsonb_build_object('modules_total', v_modules_total, 'modules_validated', v_modules_validated,
                                   'avg_assessment', ROUND(v_avg_assessment,2), 'score', ROUND(learning,2)),
    'productivity', jsonb_build_object('accepted_work', v_accepted, 'submitted_work', v_submitted,
                                       'expected_per_week', 5, 'score', ROUND(productivity,2)),
    'quality', jsonb_build_object('avg_quality_score', ROUND(v_avg_quality,2), 'rework_events', v_rework,
                                  'score', ROUND(quality,2)),
    'commercial', jsonb_build_object('verified_leads', v_leads, 'verified_qualified', v_qualified,
                                     'verified_opportunities', v_opps, 'verified_assists', v_assists,
                                     'verified_revenue_kes', v_revenue, 'score', ROUND(commercial,2),
                                     'note', 'Unverified or manually declared revenue is excluded'),
    'operational', jsonb_build_object('items_with_deadline', v_due, 'delivered_on_time', v_ontime,
                                      'score', ROUND(operational,2)),
    'conduct', jsonb_build_object('substantiated_integrity_flags', v_flags,
                                  'avg_supervisor_rating', ROUND(v_reviews,2), 'score', ROUND(conduct,2))
  );

  INSERT INTO public.intern_performance_scores(
    intern_id, period_start, period_end, learning_score, productivity_score, quality_score,
    commercial_score, operational_score, conduct_score, performance_index, evidence_confidence,
    breakdown, computed_at, computed_by)
  VALUES (p_intern, p_start, p_end, ROUND(learning,2), ROUND(productivity,2), ROUND(quality,2),
          ROUND(commercial,2), ROUND(operational,2), ROUND(conduct,2), idx, confidence,
          breakdown, now(), auth.uid())
  ON CONFLICT (intern_id, period_start, period_end) DO UPDATE SET
    learning_score = EXCLUDED.learning_score, productivity_score = EXCLUDED.productivity_score,
    quality_score = EXCLUDED.quality_score, commercial_score = EXCLUDED.commercial_score,
    operational_score = EXCLUDED.operational_score, conduct_score = EXCLUDED.conduct_score,
    performance_index = EXCLUDED.performance_index, evidence_confidence = EXCLUDED.evidence_confidence,
    breakdown = EXCLUDED.breakdown, computed_at = now(), computed_by = auth.uid();

  INSERT INTO public.intern_audit_log(intern_id, actor_id, action, entity, entity_id, after_state)
  VALUES (p_intern, auth.uid(), 'performance_computed', 'intern_performance_scores', p_intern,
          jsonb_build_object('period_start', p_start, 'period_end', p_end, 'performance_index', idx));

  RETURN jsonb_build_object('intern_id', p_intern, 'period_start', p_start, 'period_end', p_end,
    'performance_index', idx, 'evidence_confidence', confidence, 'breakdown', breakdown);
END; $function$;