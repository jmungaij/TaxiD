-- ============ Interns 360 engines ============

CREATE OR REPLACE FUNCTION public.intern_enrol_from_application(
  p_application uuid,
  p_cohort uuid,
  p_track uuid,
  p_mentor uuid DEFAULT NULL,
  p_supervisor uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_intern uuid; v_name text; v_email text; v_candidate uuid;
BEGIN
  IF NOT public.intern_programme_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised to enrol interns.';
  END IF;
  SELECT a.candidate_id, c.full_name, c.email
    INTO v_candidate, v_name, v_email
  FROM public.rec_applications a
  JOIN public.rec_candidates c ON c.id = a.candidate_id
  WHERE a.id = p_application;
  IF v_candidate IS NULL THEN
    RAISE EXCEPTION 'Application % has no linked candidate.', p_application;
  END IF;

  SELECT id INTO v_intern FROM public.intern_profiles WHERE application_id = p_application;
  IF v_intern IS NOT NULL THEN RETURN v_intern; END IF;

  INSERT INTO public.intern_profiles(
    candidate_id, application_id, cohort_id, track_id, full_name, work_email,
    mentor_staff_id, supervisor_staff_id, status, created_by)
  VALUES (v_candidate, p_application, p_cohort, p_track, COALESCE(v_name,'Intern'), v_email,
          p_mentor, p_supervisor, 'ONBOARDING', auth.uid())
  RETURNING id INTO v_intern;

  INSERT INTO public.intern_learning_progress(intern_id, module_id)
  SELECT v_intern, m.id FROM public.intern_learning_modules m WHERE m.track_id = p_track
  ON CONFLICT DO NOTHING;

  INSERT INTO public.intern_audit_log(intern_id, actor_id, action, entity, entity_id, after_state)
  VALUES (v_intern, auth.uid(), 'intern_enrolled', 'intern_profiles', v_intern,
          jsonb_build_object('application_id', p_application, 'cohort_id', p_cohort, 'track_id', p_track));
  RETURN v_intern;
END; $$;

-- Track matching: verified skills + declared capability against track weights
CREATE OR REPLACE FUNCTION public.intern_match_tracks(p_intern uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.intern_can_view(p_intern) THEN
    RAISE EXCEPTION 'Not authorised to view this intern.';
  END IF;
  SELECT jsonb_agg(x ORDER BY (x->>'score')::numeric DESC) INTO v_out
  FROM (
    SELECT jsonb_build_object(
      'track_id', t.id,
      'track_code', t.code,
      'track_name', t.name,
      'score', ROUND(LEAST(100,
          COALESCE(AVG(s.level) FILTER (WHERE s.category = t.code), 0) * 12
        + COALESCE(AVG(s.confidence) FILTER (WHERE s.category = t.code), 0) * 0.2
        + COALESCE(AVG(s.level), 0) * 6
        + COUNT(s.id) FILTER (WHERE s.evidence IS NOT NULL AND s.evidence <> '') * 4
      ), 2),
      'evidenced_skills', COUNT(s.id) FILTER (WHERE s.evidence IS NOT NULL AND s.evidence <> ''),
      'skills_considered', COUNT(s.id),
      'reason', CASE
        WHEN COUNT(s.id) = 0 THEN 'No assessed skills yet — matching is indicative only'
        ELSE 'Scored on assessed skill level, evidence and confidence for this track'
      END
    ) AS x
    FROM public.intern_tracks t
    LEFT JOIN public.intern_skills s ON s.intern_id = p_intern
    GROUP BY t.id, t.code, t.name
  ) q;
  RETURN COALESCE(v_out, '[]'::jsonb);
END; $$;

-- Explainable performance calculation
CREATE OR REPLACE FUNCTION public.intern_compute_performance(
  p_intern uuid, p_start date, p_end date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  learning := CASE WHEN v_modules_total = 0 THEN 0
    ELSE LEAST(100, (v_modules_validated::numeric / v_modules_total) * 70
                    + (v_avg_assessment * 0.30)) END;
  productivity := LEAST(100, (v_accepted::numeric / v_weeks) / 5.0 * 100);
  quality := GREATEST(0, LEAST(100, v_avg_quality - LEAST(30, v_rework * 5)));
  commercial := LEAST(100, v_leads * 2 + v_qualified * 5 + v_opps * 8 + v_assists * 10
                           + LEAST(40, v_revenue / 50000.0 * 20));
  operational := CASE WHEN v_due = 0 THEN CASE WHEN v_accepted > 0 THEN 70 ELSE 0 END
                      ELSE (v_ontime::numeric / v_due) * 100 END;
  conduct := GREATEST(0, 100 - v_flags * 25 - CASE WHEN v_reviews > 0 AND v_reviews < 3 THEN 20 ELSE 0 END);

  idx := ROUND((learning * (w->>'learning')::numeric
              + productivity * (w->>'productivity')::numeric
              + quality * (w->>'quality')::numeric
              + commercial * (w->>'commercial')::numeric
              + operational * (w->>'operational')::numeric
              + conduct * (w->>'conduct')::numeric) / 100.0, 2);

  confidence := ROUND(LEAST(100,
      (CASE WHEN v_modules_validated > 0 THEN 25 ELSE 0 END)
    + (CASE WHEN v_accepted > 0 THEN 25 ELSE 0 END)
    + (CASE WHEN v_avg_quality > 0 THEN 25 ELSE 0 END)
    + (CASE WHEN v_leads + v_qualified + v_opps + v_assists > 0 OR v_revenue > 0 THEN 25 ELSE 0 END)), 2);

  breakdown := jsonb_build_object(
    'weights', w,
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
END; $$;

CREATE OR REPLACE FUNCTION public.intern_recompute_cohort(p_cohort uuid, p_start date, p_end date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n int := 0;
BEGIN
  IF NOT public.intern_programme_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised.';
  END IF;
  FOR r IN SELECT id FROM public.intern_profiles WHERE cohort_id = p_cohort AND deleted_at IS NULL LOOP
    PERFORM public.intern_compute_performance(r.id, p_start, p_end);
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('cohort_id', p_cohort, 'interns_computed', n);
END; $$;

-- Evidence-gated talent-level promotion
CREATE OR REPLACE FUNCTION public.intern_promote_level(
  p_intern uuid, p_level text, p_rationale text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_idx numeric; v_validated int; v_accepted int; v_required numeric; v_old text;
BEGIN
  IF NOT public.intern_programme_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised to change talent level.';
  END IF;
  IF p_level NOT IN ('APPLICANT','APPRENTICE','OPERATOR','PRODUCER','YALLA_TALENT') THEN
    RAISE EXCEPTION 'Unknown talent level %', p_level;
  END IF;
  SELECT talent_level INTO v_old FROM public.intern_profiles WHERE id = p_intern;
  IF v_old IS NULL THEN RAISE EXCEPTION 'Intern not found.'; END IF;

  v_required := CASE p_level WHEN 'APPRENTICE' THEN 0 WHEN 'OPERATOR' THEN 55
                             WHEN 'PRODUCER' THEN 70 WHEN 'YALLA_TALENT' THEN 85 ELSE 0 END;

  SELECT COALESCE(MAX(performance_index), 0) INTO v_idx
  FROM public.intern_performance_scores WHERE intern_id = p_intern;
  SELECT COUNT(*) INTO v_validated FROM public.intern_learning_progress
  WHERE intern_id = p_intern AND status = 'validated';
  SELECT COUNT(*) INTO v_accepted FROM public.intern_work_items
  WHERE intern_id = p_intern AND status IN ('ACCEPTED','COMPLETED');

  IF v_required > 0 AND v_idx < v_required THEN
    RAISE EXCEPTION 'Promotion to % requires a calculated performance index of at least % (current %).',
      p_level, v_required, v_idx;
  END IF;
  IF p_level IN ('OPERATOR','PRODUCER','YALLA_TALENT') AND (v_validated = 0 OR v_accepted = 0) THEN
    RAISE EXCEPTION 'Promotion to % requires validated learning and accepted work as evidence (validated %, accepted %).',
      p_level, v_validated, v_accepted;
  END IF;

  UPDATE public.intern_profiles SET talent_level = p_level WHERE id = p_intern;

  INSERT INTO public.intern_audit_log(intern_id, actor_id, action, entity, entity_id, before_state, after_state)
  VALUES (p_intern, auth.uid(), 'talent_level_changed', 'intern_profiles', p_intern,
          jsonb_build_object('talent_level', v_old),
          jsonb_build_object('talent_level', p_level, 'performance_index', v_idx,
                             'validated_modules', v_validated, 'accepted_work', v_accepted,
                             'rationale', p_rationale));

  RETURN jsonb_build_object('intern_id', p_intern, 'talent_level', p_level,
    'performance_index', v_idx, 'validated_modules', v_validated, 'accepted_work', v_accepted);
END; $$;

-- Anti-gaming scan
CREATE OR REPLACE FUNCTION public.intern_scan_integrity(p_intern uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int := 0; r record;
BEGIN
  IF NOT public.intern_programme_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised.';
  END IF;

  FOR r IN
    SELECT subject_ref, COUNT(*) AS c FROM public.intern_commercial_attributions
    WHERE intern_id = p_intern AND subject_ref IS NOT NULL AND subject_ref <> ''
    GROUP BY subject_ref HAVING COUNT(*) > 1
  LOOP
    INSERT INTO public.intern_integrity_flags(intern_id, signal, severity, detail)
    VALUES (p_intern, 'duplicate_commercial_claim', 'high',
            jsonb_build_object('subject_ref', r.subject_ref, 'claims', r.c));
    n := n + 1;
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.intern_commercial_attributions
             WHERE intern_id = p_intern AND attribution_type = 'REVENUE_ATTRIBUTED'
               AND (NOT verified OR source_system = 'manual')) THEN
    INSERT INTO public.intern_integrity_flags(intern_id, signal, severity, detail)
    VALUES (p_intern, 'unverified_revenue_claim', 'high',
            jsonb_build_object('note', 'Revenue claimed without an authoritative source system'));
    n := n + 1;
  END IF;

  IF EXISTS (SELECT 1 FROM public.intern_work_items
             WHERE intern_id = p_intern AND status IN ('ACCEPTED','COMPLETED')
               AND (deliverable_url IS NULL OR deliverable_url = '')) THEN
    INSERT INTO public.intern_integrity_flags(intern_id, signal, severity, detail)
    VALUES (p_intern, 'completed_work_without_deliverable', 'medium',
            jsonb_build_object('note', 'Work accepted with no deliverable evidence attached'));
    n := n + 1;
  END IF;

  IF EXISTS (SELECT 1 FROM public.intern_learning_progress lp
             JOIN public.intern_learning_modules m ON m.id = lp.module_id
             WHERE lp.intern_id = p_intern AND lp.status = 'validated'
               AND m.requires_practical AND COALESCE(lp.application_evidence,'') = '') THEN
    INSERT INTO public.intern_integrity_flags(intern_id, signal, severity, detail)
    VALUES (p_intern, 'learning_validated_without_practical_evidence', 'medium',
            jsonb_build_object('note', 'Competency validated with no applied evidence'));
    n := n + 1;
  END IF;

  INSERT INTO public.intern_audit_log(intern_id, actor_id, action, entity, entity_id, after_state)
  VALUES (p_intern, auth.uid(), 'integrity_scanned', 'intern_integrity_flags', p_intern,
          jsonb_build_object('flags_raised', n));

  RETURN jsonb_build_object('intern_id', p_intern, 'flags_raised', n);
END; $$;

-- Evidence-based conversion recommendation
CREATE OR REPLACE FUNCTION public.intern_recommend_conversion(p_intern uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_idx numeric; v_capstone numeric; v_flags int; v_commercial numeric; v_outcome text; v_id uuid;
BEGIN
  IF NOT public.intern_programme_authority(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised.';
  END IF;
  SELECT COALESCE(MAX(performance_index),0), COALESCE(MAX(commercial_score),0)
    INTO v_idx, v_commercial FROM public.intern_performance_scores WHERE intern_id = p_intern;
  SELECT COALESCE(MAX(total_score),0) INTO v_capstone FROM public.intern_capstones
   WHERE intern_id = p_intern AND status = 'scored';
  SELECT COUNT(*) INTO v_flags FROM public.intern_integrity_flags
   WHERE intern_id = p_intern AND status = 'SUBSTANTIATED';

  v_outcome := CASE
    WHEN v_flags > 0 THEN 'NOT_PROGRESSED'
    WHEN v_idx >= 85 AND v_capstone >= 70 THEN 'PERMANENT'
    WHEN v_idx >= 75 THEN 'FIXED_TERM'
    WHEN v_idx >= 65 THEN 'PAID_ENGAGEMENT'
    WHEN v_idx >= 55 THEN 'EXTENSION'
    WHEN v_idx > 0 THEN 'TALENT_POOL'
    ELSE 'TALENT_REVIEW' END;

  INSERT INTO public.intern_conversion_decisions(intern_id, recommended_outcome, evidence, recommended_by)
  VALUES (p_intern, v_outcome,
          jsonb_build_object('performance_index', v_idx, 'commercial_score', v_commercial,
                             'capstone_score', v_capstone, 'substantiated_flags', v_flags),
          auth.uid())
  RETURNING id INTO v_id;

  UPDATE public.intern_profiles
     SET conversion_status = CASE WHEN v_idx >= 75 THEN 'HIGH_POTENTIAL' ELSE 'TALENT_REVIEW' END
   WHERE id = p_intern;

  RETURN jsonb_build_object('recommendation_id', v_id, 'recommended_outcome', v_outcome,
    'performance_index', v_idx, 'capstone_score', v_capstone, 'substantiated_flags', v_flags);
END; $$;

REVOKE EXECUTE ON FUNCTION public.intern_enrol_from_application(uuid,uuid,uuid,uuid,uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.intern_match_tracks(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.intern_compute_performance(uuid,date,date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.intern_recompute_cohort(uuid,date,date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.intern_promote_level(uuid,text,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.intern_scan_integrity(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.intern_recommend_conversion(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.intern_enrol_from_application(uuid,uuid,uuid,uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.intern_match_tracks(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.intern_compute_performance(uuid,date,date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.intern_recompute_cohort(uuid,date,date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.intern_promote_level(uuid,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.intern_scan_integrity(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.intern_recommend_conversion(uuid) TO authenticated, service_role;

-- ============ read models (RLS respected) ============
CREATE OR REPLACE VIEW public.v_intern_scoreboard
WITH (security_invoker = on) AS
SELECT
  p.id AS intern_id,
  p.full_name,
  p.status,
  p.talent_level,
  p.conversion_status,
  p.cohort_id,
  c.name AS cohort_name,
  p.track_id,
  t.code AS track_code,
  t.name AS track_name,
  p.institution,
  p.programme_of_study,
  p.start_date,
  p.expected_end_date,
  s.performance_index,
  s.learning_score,
  s.productivity_score,
  s.quality_score,
  s.commercial_score,
  s.operational_score,
  s.conduct_score,
  s.evidence_confidence,
  s.period_start,
  s.period_end,
  (SELECT COUNT(*) FROM public.intern_work_items w
    WHERE w.intern_id = p.id AND w.status IN ('ACCEPTED','COMPLETED')) AS accepted_work,
  (SELECT COUNT(*) FROM public.intern_learning_progress lp
    WHERE lp.intern_id = p.id AND lp.status = 'validated') AS validated_modules,
  (SELECT COALESCE(SUM(a.amount_kes),0) FROM public.intern_commercial_attributions a
    WHERE a.intern_id = p.id AND a.verified AND a.attribution_type = 'REVENUE_ATTRIBUTED'
      AND a.source_system <> 'manual') AS verified_revenue_kes,
  (SELECT COUNT(*) FROM public.intern_integrity_flags f
    WHERE f.intern_id = p.id AND f.status = 'REVIEW_REQUIRED') AS open_integrity_flags
FROM public.intern_profiles p
LEFT JOIN public.intern_cohorts c ON c.id = p.cohort_id
LEFT JOIN public.intern_tracks t ON t.id = p.track_id
LEFT JOIN LATERAL (
  SELECT * FROM public.intern_performance_scores ps
  WHERE ps.intern_id = p.id ORDER BY ps.period_end DESC LIMIT 1
) s ON true
WHERE p.deleted_at IS NULL;

GRANT SELECT ON public.v_intern_scoreboard TO authenticated;

CREATE OR REPLACE VIEW public.v_intern_cohort_health
WITH (security_invoker = on) AS
SELECT
  c.id AS cohort_id,
  c.name AS cohort_name,
  c.status,
  c.start_date,
  c.end_date,
  c.intake_size,
  COUNT(p.id) AS enrolled,
  COUNT(p.id) FILTER (WHERE p.status = 'ACTIVE') AS active,
  COUNT(p.id) FILTER (WHERE p.status = 'COMPLETED') AS completed,
  COUNT(p.id) FILTER (WHERE p.status IN ('WITHDRAWN','TERMINATED')) AS exited,
  COUNT(p.id) FILTER (WHERE p.talent_level = 'YALLA_TALENT') AS yalla_talent,
  ROUND(AVG(sb.performance_index), 2) AS avg_performance_index,
  ROUND(AVG(sb.evidence_confidence), 2) AS avg_evidence_confidence,
  COALESCE(SUM(sb.verified_revenue_kes), 0) AS verified_revenue_kes,
  COALESCE(SUM(sb.open_integrity_flags), 0) AS open_integrity_flags
FROM public.intern_cohorts c
LEFT JOIN public.intern_profiles p ON p.cohort_id = c.id AND p.deleted_at IS NULL
LEFT JOIN public.v_intern_scoreboard sb ON sb.intern_id = p.id
GROUP BY c.id, c.name, c.status, c.start_date, c.end_date, c.intake_size;

GRANT SELECT ON public.v_intern_cohort_health TO authenticated;