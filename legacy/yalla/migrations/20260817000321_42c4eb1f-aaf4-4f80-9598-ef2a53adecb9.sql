-- ============================================================================
-- Recruitment 360 — governed selection actions
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.rec_is_recruiter() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rec_is_hiring_authority() FROM anon;

-- ---------------------------------------------------------- scorecard upsert --
CREATE OR REPLACE FUNCTION public.rec_scorecard_save(
  p_vacancy_id uuid,
  p_criteria jsonb,
  p_notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_version integer;
  v_id uuid;
  v_scored integer;
  v_item jsonb;
  v_idx integer := 0;
BEGIN
  IF NOT public.rec_is_recruiter() THEN
    RAISE EXCEPTION 'not authorized to configure vacancy scorecards';
  END IF;
  IF jsonb_typeof(p_criteria) <> 'array' OR jsonb_array_length(p_criteria) = 0 THEN
    RAISE EXCEPTION 'a scorecard requires at least one criterion';
  END IF;

  -- Scored + preferred weights are the denominator of every candidate score, so
  -- they must be a real 100-point scale. Hard gates carry no weight by design.
  SELECT COALESCE(SUM((c->>'weight')::int), 0) INTO v_scored
    FROM jsonb_array_elements(p_criteria) c
   WHERE c->>'criterion_type' IN ('scored','preferred');
  IF v_scored <> 100 THEN
    RAISE EXCEPTION 'scored and preferred weights must total 100 (received %)', v_scored;
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM public.rec_scorecards WHERE vacancy_id = p_vacancy_id;

  UPDATE public.rec_scorecards SET status = 'archived', updated_at = now()
   WHERE vacancy_id = p_vacancy_id AND status = 'active';

  INSERT INTO public.rec_scorecards (vacancy_id, version, status, notes, created_by, activated_at)
  VALUES (p_vacancy_id, v_version, 'active', p_notes, auth.uid(), now())
  RETURNING id INTO v_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_criteria) LOOP
    v_idx := v_idx + 1;
    INSERT INTO public.rec_scorecard_criteria (
      scorecard_id, code, label, criterion_type, weight, min_threshold,
      evidence_source, scoring_method, guidance, sort_order
    ) VALUES (
      v_id,
      v_item->>'code',
      v_item->>'label',
      v_item->>'criterion_type',
      COALESCE((v_item->>'weight')::int, 0),
      NULLIF(v_item->>'min_threshold','')::numeric,
      COALESCE(v_item->>'evidence_source','cv'),
      COALESCE(v_item->>'scoring_method','threshold'),
      v_item->>'guidance',
      v_idx
    );
  END LOOP;

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, new_state, source)
  VALUES (auth.uid(), 'scorecard.published', 'rec_scorecard', v_id,
          jsonb_build_object('vacancy_id', p_vacancy_id, 'version', v_version, 'criteria', p_criteria),
          'rec_scorecard_save');

  RETURN jsonb_build_object('scorecard_id', v_id, 'version', v_version);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rec_scorecard_save(uuid, jsonb, text) FROM anon;

-- ------------------------------------------------------------ evidence intake --
CREATE OR REPLACE FUNCTION public.rec_record_evidence(
  p_application_id uuid,
  p_facts jsonb
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_candidate uuid;
  v_fact jsonb;
  v_count integer := 0;
BEGIN
  IF NOT public.rec_is_recruiter() THEN
    RAISE EXCEPTION 'not authorized to record candidate evidence';
  END IF;
  SELECT candidate_id INTO v_candidate FROM public.rec_applications WHERE id = p_application_id;
  IF v_candidate IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;

  FOR v_fact IN SELECT * FROM jsonb_array_elements(p_facts) LOOP
    -- Provenance is mandatory: an unsourced "fact" is an AI invention, not evidence.
    IF COALESCE(v_fact->>'source_kind','') = '' OR COALESCE(v_fact->>'source_ref','') = ''
       OR v_fact->>'confidence' IS NULL THEN
      RAISE EXCEPTION 'evidence for % requires source_kind, source_ref and confidence',
        COALESCE(v_fact->>'attribute','(unnamed)');
    END IF;
    INSERT INTO public.rec_evidence_facts (
      candidate_id, application_id, attribute, value_text, value_numeric,
      source_kind, source_ref, source_locator, confidence, extracted_by
    ) VALUES (
      v_candidate, p_application_id,
      v_fact->>'attribute',
      v_fact->>'value_text',
      NULLIF(v_fact->>'value_numeric','')::numeric,
      v_fact->>'source_kind',
      v_fact->>'source_ref',
      v_fact->>'source_locator',
      (v_fact->>'confidence')::numeric,
      COALESCE(v_fact->>'extracted_by','system')
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rec_record_evidence(uuid, jsonb) FROM anon;

-- ------------------------------------------------------- evaluation engine --
CREATE OR REPLACE FUNCTION public.rec_evaluate_application(p_application_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_app record;
  v_card record;
  v_crit record;
  v_results jsonb := '[]'::jsonb;
  v_gate_failures text[] := '{}';
  v_missing text[] := '{}';
  v_earned numeric := 0;
  v_weight numeric := 0;
  v_conf_sum numeric := 0;
  v_conf_n integer := 0;
  v_fact record;
  v_crit_earned numeric;
  v_crit_status text;
  v_evidence text;
  v_score numeric;
  v_eligibility text;
  v_reco text;
  v_eval_id uuid;
BEGIN
  IF NOT public.rec_is_recruiter() THEN
    RAISE EXCEPTION 'not authorized to evaluate applications';
  END IF;
  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;

  SELECT * INTO v_card FROM public.rec_scorecards
   WHERE vacancy_id = v_app.vacancy_id AND status = 'active';
  IF v_card IS NULL THEN
    RAISE EXCEPTION 'vacancy has no active scorecard — publish one before evaluating candidates';
  END IF;

  FOR v_crit IN
    SELECT * FROM public.rec_scorecard_criteria WHERE scorecard_id = v_card.id ORDER BY sort_order
  LOOP
    -- Best available evidence for this criterion: highest confidence wins.
    SELECT * INTO v_fact
      FROM public.rec_evidence_facts
     WHERE attribute = v_crit.code
       AND (application_id = p_application_id OR candidate_id = v_app.candidate_id)
     ORDER BY confidence DESC, created_at DESC
     LIMIT 1;

    v_crit_earned := 0;
    IF v_fact IS NULL THEN
      v_crit_status := 'missing_evidence';
      v_evidence := 'No evidence recorded';
      v_missing := v_missing || v_crit.label;
      IF v_crit.criterion_type = 'hard_gate' THEN
        -- Ambiguity is never an automatic rejection; a human must look.
        v_crit_status := 'requires_review';
      END IF;
    ELSE
      v_conf_sum := v_conf_sum + v_fact.confidence;
      v_conf_n := v_conf_n + 1;
      v_evidence := format('%s (%s%s, confidence %s)',
        COALESCE(v_fact.value_text, v_fact.value_numeric::text),
        v_fact.source_kind,
        COALESCE(' ' || v_fact.source_locator, ''),
        round(v_fact.confidence, 2));

      IF v_crit.min_threshold IS NOT NULL AND v_fact.value_numeric IS NOT NULL THEN
        IF v_fact.value_numeric >= v_crit.min_threshold THEN
          v_crit_status := 'pass';
          v_crit_earned := v_crit.weight;
        ELSE
          v_crit_status := CASE WHEN v_crit.criterion_type = 'hard_gate' THEN 'fail' ELSE 'partial' END;
          v_crit_earned := CASE
            WHEN v_crit.criterion_type = 'hard_gate' THEN 0
            ELSE round(v_crit.weight * LEAST(1, v_fact.value_numeric / NULLIF(v_crit.min_threshold, 0)), 2)
          END;
        END IF;
      ELSE
        -- Presence-based: confidence scales the credit, never invents it.
        v_crit_status := CASE WHEN v_fact.confidence >= 0.6 THEN 'pass' ELSE 'requires_review' END;
        v_crit_earned := round(v_crit.weight * LEAST(1, v_fact.confidence), 2);
      END IF;

      IF v_crit.criterion_type = 'hard_gate' AND v_crit_status = 'fail' THEN
        v_gate_failures := v_gate_failures || v_crit.label;
      END IF;
    END IF;

    IF v_crit.criterion_type IN ('scored','preferred') THEN
      v_weight := v_weight + v_crit.weight;
      v_earned := v_earned + v_crit_earned;
    END IF;

    v_results := v_results || jsonb_build_object(
      'code', v_crit.code,
      'label', v_crit.label,
      'type', v_crit.criterion_type,
      'weight', v_crit.weight,
      'earned', CASE WHEN v_crit.criterion_type IN ('scored','preferred') THEN v_crit_earned ELSE NULL END,
      'status', v_crit_status,
      'evidence', v_evidence,
      'source_kind', v_fact.source_kind,
      'source_ref', v_fact.source_ref,
      'confidence', v_fact.confidence
    );
  END LOOP;

  v_score := CASE WHEN v_weight > 0 THEN round(100 * v_earned / v_weight, 2) ELSE 0 END;

  v_eligibility := CASE
    WHEN array_length(v_gate_failures, 1) > 0 THEN 'not_eligible'
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_results) r
       WHERE r->>'type' = 'hard_gate' AND r->>'status' IN ('requires_review','missing_evidence')
    ) THEN 'requires_review'
    ELSE 'eligible'
  END;

  v_reco := CASE
    WHEN v_eligibility = 'not_eligible' THEN 'do_not_advance'
    WHEN v_eligibility = 'requires_review' THEN 'review'
    WHEN v_score >= 70 THEN 'advance'
    WHEN v_score >= 50 THEN 'review'
    ELSE 'do_not_advance'
  END;

  UPDATE public.rec_application_evaluations
     SET is_current = false
   WHERE application_id = p_application_id AND is_current;

  INSERT INTO public.rec_application_evaluations (
    application_id, vacancy_id, scorecard_id, scorecard_version, eligibility,
    weighted_score, max_score, criterion_results, gate_failures, missing_evidence,
    recommendation, confidence, computed_by
  ) VALUES (
    p_application_id, v_app.vacancy_id, v_card.id, v_card.version, v_eligibility,
    v_score, 100, v_results, v_gate_failures, v_missing, v_reco,
    CASE WHEN v_conf_n > 0 THEN round(v_conf_sum / v_conf_n, 2) ELSE NULL END,
    auth.uid()
  ) RETURNING id INTO v_eval_id;

  -- The suggestion lands on the application for ranking; the human decision
  -- fields (score / stage) are untouched.
  UPDATE public.rec_applications
     SET ai_match_score = v_score,
         knockout_flagged = (v_eligibility = 'not_eligible'),
         updated_at = now()
   WHERE id = p_application_id;

  RETURN jsonb_build_object(
    'evaluation_id', v_eval_id, 'eligibility', v_eligibility, 'score', v_score,
    'recommendation', v_reco, 'gate_failures', v_gate_failures,
    'missing_evidence', v_missing, 'criteria', v_results
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rec_evaluate_application(uuid) FROM anon;

CREATE OR REPLACE FUNCTION public.rec_evaluate_vacancy_batch(
  p_vacancy_id uuid,
  p_limit integer DEFAULT 200
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_app uuid;
  v_done integer := 0;
  v_failed integer := 0;
BEGIN
  IF NOT public.rec_is_recruiter() THEN
    RAISE EXCEPTION 'not authorized to evaluate applications';
  END IF;
  FOR v_app IN
    SELECT a.id FROM public.rec_applications a
     WHERE a.vacancy_id = p_vacancy_id
       AND a.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM public.rec_application_evaluations e
          WHERE e.application_id = a.id AND e.is_current
       )
     ORDER BY a.applied_at
     LIMIT GREATEST(1, LEAST(p_limit, 1000))
  LOOP
    BEGIN
      PERFORM public.rec_evaluate_application(v_app);
      v_done := v_done + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
    END;
  END LOOP;

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, new_state, source)
  VALUES (auth.uid(), 'evaluation.batch', 'rec_vacancy', p_vacancy_id,
          jsonb_build_object('evaluated', v_done, 'failed', v_failed), 'rec_evaluate_vacancy_batch');

  RETURN jsonb_build_object('evaluated', v_done, 'failed', v_failed,
    'remaining', (SELECT count(*) FROM public.rec_applications a
                   WHERE a.vacancy_id = p_vacancy_id AND a.status = 'active'
                     AND NOT EXISTS (SELECT 1 FROM public.rec_application_evaluations e
                                      WHERE e.application_id = a.id AND e.is_current)));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rec_evaluate_vacancy_batch(uuid, integer) FROM anon;

-- ------------------------------------------------------- funnel and queues --
CREATE OR REPLACE FUNCTION public.rec_vacancy_funnel(p_vacancy_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public.rec_is_recruiter() THEN
    RAISE EXCEPTION 'not authorized to read recruitment funnels';
  END IF;
  SELECT jsonb_build_object(
    'received',   count(*),
    'valid',      count(*) FILTER (WHERE a.status <> 'invalid'),
    'evaluated',  count(e.id),
    'eligible',   count(*) FILTER (WHERE e.eligibility = 'eligible'),
    'review',     count(*) FILTER (WHERE e.eligibility = 'requires_review'),
    'ineligible', count(*) FILTER (WHERE e.eligibility = 'not_eligible'),
    'recommended',count(*) FILTER (WHERE e.recommendation = 'advance'),
    'screened',   count(*) FILTER (WHERE a.stage NOT IN ('applied')),
    'assessment', count(*) FILTER (WHERE a.stage = 'assessment'),
    'shortlist',  count(*) FILTER (WHERE a.stage = 'shortlisted'),
    'interview',  count(*) FILTER (WHERE a.stage = 'interview'),
    'offer',      count(*) FILTER (WHERE a.stage = 'offer'),
    'hired',      count(*) FILTER (WHERE a.stage = 'hired'),
    'not_selected', count(*) FILTER (WHERE a.stage = 'rejected'),
    'talent_pool',  count(*) FILTER (WHERE a.stage = 'talent_pool')
  ) INTO v_out
  FROM public.rec_applications a
  LEFT JOIN public.rec_application_evaluations e
         ON e.application_id = a.id AND e.is_current
  WHERE a.vacancy_id = p_vacancy_id;
  RETURN COALESCE(v_out, '{}'::jsonb);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rec_vacancy_funnel(uuid) FROM anon;

CREATE OR REPLACE FUNCTION public.rec_review_queue(
  p_vacancy_id uuid,
  p_queue text DEFAULT 'human_review',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rows jsonb;
  v_total integer;
BEGIN
  IF NOT public.rec_is_recruiter() THEN
    RAISE EXCEPTION 'not authorized to read recruitment queues';
  END IF;

  WITH base AS (
    SELECT a.id, a.application_no, a.stage, a.priority, a.applied_at, a.stage_entered_at,
           c.full_name, c.location, c.years_experience,
           e.eligibility, e.weighted_score, e.recommendation, e.confidence,
           e.gate_failures, e.missing_evidence, e.id AS evaluation_id
      FROM public.rec_applications a
      JOIN public.rec_candidates c ON c.id = a.candidate_id
      LEFT JOIN public.rec_application_evaluations e
             ON e.application_id = a.id AND e.is_current
     WHERE a.vacancy_id = p_vacancy_id
       AND a.status = 'active'
       AND (p_search IS NULL OR p_search = '' OR c.full_name ILIKE '%' || p_search || '%')
       AND CASE p_queue
             WHEN 'new'               THEN a.stage = 'applied' AND e.id IS NULL
             WHEN 'eligibility_review'THEN e.eligibility = 'requires_review'
             WHEN 'ai_recommended'    THEN e.recommendation = 'advance' AND a.stage IN ('applied','screening')
             WHEN 'human_review'      THEN e.id IS NOT NULL AND a.stage IN ('applied','screening')
             WHEN 'shortlist'         THEN a.stage = 'shortlisted'
             WHEN 'interview'         THEN a.stage = 'interview'
             WHEN 'final_decision'    THEN a.stage IN ('evaluation','offer')
             WHEN 'ineligible'        THEN e.eligibility = 'not_eligible'
             ELSE true
           END
  )
  SELECT count(*) INTO v_total FROM base;

  WITH base AS (
    SELECT a.id, a.application_no, a.stage, a.priority, a.applied_at, a.stage_entered_at,
           c.full_name, c.location, c.years_experience,
           e.eligibility, e.weighted_score, e.recommendation, e.confidence,
           e.gate_failures, e.missing_evidence, e.id AS evaluation_id
      FROM public.rec_applications a
      JOIN public.rec_candidates c ON c.id = a.candidate_id
      LEFT JOIN public.rec_application_evaluations e
             ON e.application_id = a.id AND e.is_current
     WHERE a.vacancy_id = p_vacancy_id
       AND a.status = 'active'
       AND (p_search IS NULL OR p_search = '' OR c.full_name ILIKE '%' || p_search || '%')
       AND CASE p_queue
             WHEN 'new'               THEN a.stage = 'applied' AND e.id IS NULL
             WHEN 'eligibility_review'THEN e.eligibility = 'requires_review'
             WHEN 'ai_recommended'    THEN e.recommendation = 'advance' AND a.stage IN ('applied','screening')
             WHEN 'human_review'      THEN e.id IS NOT NULL AND a.stage IN ('applied','screening')
             WHEN 'shortlist'         THEN a.stage = 'shortlisted'
             WHEN 'interview'         THEN a.stage = 'interview'
             WHEN 'final_decision'    THEN a.stage IN ('evaluation','offer')
             WHEN 'ineligible'        THEN e.eligibility = 'not_eligible'
             ELSE true
           END
     ORDER BY e.weighted_score DESC NULLS LAST, a.applied_at
     LIMIT GREATEST(1, LEAST(p_limit, 200)) OFFSET GREATEST(0, p_offset)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(base)), '[]'::jsonb) INTO v_rows FROM base;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows,
                            'limit', p_limit, 'offset', p_offset, 'queue', p_queue);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rec_review_queue(uuid, text, integer, integer, text) FROM anon;

-- --------------------------------------------------------------- bulk decide --
CREATE OR REPLACE FUNCTION public.rec_bulk_decide(
  p_application_ids uuid[],
  p_action text,
  p_reason_code text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_send_feedback boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_app record;
  v_reason record;
  v_eval record;
  v_stage text;
  v_applied integer := 0;
  v_skipped integer := 0;
  v_queued integer := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.rec_is_recruiter() THEN
    RAISE EXCEPTION 'not authorized to process applications';
  END IF;
  IF p_action NOT IN ('screen','shortlist','invite_assessment','invite_interview','not_selected','talent_pool','hold') THEN
    RAISE EXCEPTION 'unsupported bulk action %', p_action;
  END IF;
  IF p_action = 'not_selected' THEN
    SELECT * INTO v_reason FROM public.rec_rejection_reasons
     WHERE code = p_reason_code AND is_active;
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'non-selection requires an active reason code';
    END IF;
  END IF;

  v_stage := CASE p_action
    WHEN 'screen' THEN 'screening'
    WHEN 'shortlist' THEN 'shortlisted'
    WHEN 'invite_assessment' THEN 'assessment'
    WHEN 'invite_interview' THEN 'interview'
    WHEN 'not_selected' THEN 'rejected'
    WHEN 'talent_pool' THEN 'talent_pool'
    ELSE NULL END;

  FOREACH p_reason_code IN ARRAY ARRAY[COALESCE(p_reason_code,'')] LOOP END LOOP; -- keep param stable

  FOR v_app IN
    SELECT a.*, c.full_name, c.email, v.title AS vacancy_title
      FROM public.rec_applications a
      JOIN public.rec_candidates c ON c.id = a.candidate_id
      JOIN public.rec_vacancies v ON v.id = a.vacancy_id
     WHERE a.id = ANY (p_application_ids)
  LOOP
    SELECT * INTO v_eval FROM public.rec_application_evaluations
     WHERE application_id = v_app.id AND is_current;

    BEGIN
      IF v_stage IS NOT NULL AND v_app.stage <> v_stage THEN
        PERFORM public.rec_application_transition(v_app.id, v_stage, p_notes);
      END IF;

      INSERT INTO public.rec_selection_decisions (
        application_id, vacancy_id, candidate_id, decision, stage_at_decision,
        ai_recommendation, ai_confidence, is_override, reason_code, reason_notes,
        evaluation_id, evidence, decision_maker, decision_role
      ) VALUES (
        v_app.id, v_app.vacancy_id, v_app.candidate_id,
        CASE WHEN p_action = 'not_selected' THEN 'not_selected'
             WHEN p_action = 'hold' THEN 'hold' ELSE 'advance' END,
        v_app.stage, v_eval.recommendation, v_eval.confidence,
        -- An override is a human decision that contradicts the recommendation.
        CASE
          WHEN v_eval.recommendation IS NULL THEN false
          WHEN p_action = 'not_selected' AND v_eval.recommendation = 'advance' THEN true
          WHEN p_action <> 'not_selected' AND v_eval.recommendation = 'do_not_advance' THEN true
          ELSE false
        END,
        NULLIF(p_reason_code,''), p_notes, v_eval.id,
        jsonb_build_object('score', v_eval.weighted_score, 'eligibility', v_eval.eligibility,
                           'gate_failures', v_eval.gate_failures, 'bulk', true),
        auth.uid(), 'recruiter'
      );

      -- Idempotent candidate feedback: one message per application per decision
      -- kind, so event retries cannot send a second rejection.
      IF p_send_feedback AND p_action = 'not_selected' AND v_app.email IS NOT NULL
         AND v_reason.template_key IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.rec_communications
            WHERE application_id = v_app.id AND template_key = v_reason.template_key
         ) THEN
        INSERT INTO public.rec_communications (
          candidate_id, application_id, channel, direction, subject, body,
          template_key, status, actor_id
        ) VALUES (
          v_app.candidate_id, v_app.id, 'email', 'outbound',
          format('Your application for %s', v_app.vacancy_title),
          format(E'Dear %s,\n\nThank you for applying for the %s position at Yalla Mobility.\n\n%s\n\nWe appreciate the time you invested in your application and wish you every success.\n\nYalla Mobility Talent Acquisition',
                 v_app.full_name, v_app.vacancy_title,
                 COALESCE(v_reason.candidate_message, 'Following review of your application, we will not be progressing your application at this stage.')),
          v_reason.template_key, 'queued', auth.uid()
        );
        v_queued := v_queued + 1;
      END IF;

      INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, previous_state, new_state, context, source)
      VALUES (auth.uid(), 'application.bulk_' || p_action, 'rec_application', v_app.id,
              jsonb_build_object('stage', v_app.stage),
              jsonb_build_object('stage', COALESCE(v_stage, v_app.stage), 'reason_code', NULLIF(p_reason_code,'')),
              jsonb_build_object('batch_size', array_length(p_application_ids, 1), 'notes', p_notes),
              'rec_bulk_decide');

      -- Recruiter work is raised through the existing operations backbone.
      IF p_action IN ('invite_assessment','invite_interview') THEN
        PERFORM public.ops_ingest_event(
          _event_type := 'recruitment.' || p_action,
          _source_portal := 'staff',
          _chain_stage := 'recruitment',
          _entity_type := 'rec_application',
          _entity_id := v_app.id,
          _disposition := 'work',
          _title := format('%s: %s (%s)', initcap(replace(p_action,'_',' ')), v_app.full_name, v_app.vacancy_title),
          _required_action := 'Confirm scheduling and candidate instructions',
          _ops_queue := 'recruitment',
          _work_kind := 'task',
          _entity_ref := v_app.application_no,
          _dedupe_key := 'rec:' || v_app.id::text || ':' || p_action
        );
      END IF;

      v_applied := v_applied + 1;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      v_errors := v_errors || jsonb_build_object('application_id', v_app.id, 'error', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('applied', v_applied, 'skipped', v_skipped,
                            'feedback_queued', v_queued, 'errors', v_errors);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rec_bulk_decide(uuid[], text, text, text, boolean) FROM anon;

-- ------------------------------------------------------------ final selection --
CREATE OR REPLACE FUNCTION public.rec_final_selection(
  p_application_id uuid,
  p_decision text,
  p_reason_code text DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_app record;
  v_eval record;
  v_id uuid;
BEGIN
  IF NOT public.rec_is_hiring_authority() THEN
    RAISE EXCEPTION 'final selection requires hiring authority';
  END IF;
  IF p_decision NOT IN ('selected','not_selected') THEN
    RAISE EXCEPTION 'final decision must be selected or not_selected';
  END IF;
  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;

  -- No application may jump the selection process.
  IF p_decision = 'selected' THEN
    IF v_app.stage NOT IN ('evaluation','offer') THEN
      RAISE EXCEPTION 'candidate must complete interview and evaluation before final selection (current stage %)', v_app.stage;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.rec_evaluations e
                    JOIN public.rec_interviews i ON i.id = e.interview_id
                   WHERE i.application_id = p_application_id) THEN
      RAISE EXCEPTION 'no interview evaluation on record for this application';
    END IF;
  ELSIF p_reason_code IS NULL THEN
    RAISE EXCEPTION 'non-selection requires a reason code';
  END IF;

  SELECT * INTO v_eval FROM public.rec_application_evaluations
   WHERE application_id = p_application_id AND is_current;

  INSERT INTO public.rec_selection_decisions (
    application_id, vacancy_id, candidate_id, decision, stage_at_decision,
    ai_recommendation, ai_confidence, is_override, reason_code, reason_notes,
    evaluation_id, evidence, decision_maker, decision_role
  ) VALUES (
    p_application_id, v_app.vacancy_id, v_app.candidate_id, p_decision, v_app.stage,
    v_eval.recommendation, v_eval.confidence,
    (p_decision = 'not_selected' AND v_eval.recommendation = 'advance'),
    p_reason_code, p_notes, v_eval.id,
    jsonb_build_object('score', v_eval.weighted_score, 'eligibility', v_eval.eligibility),
    auth.uid(), 'hiring_authority'
  ) RETURNING id INTO v_id;

  IF p_decision = 'not_selected' AND v_app.stage <> 'rejected' THEN
    PERFORM public.rec_application_transition(p_application_id, 'rejected', p_reason_code);
  END IF;

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, previous_state, new_state, source)
  VALUES (auth.uid(), 'application.final_selection', 'rec_application', p_application_id,
          jsonb_build_object('stage', v_app.stage),
          jsonb_build_object('decision', p_decision, 'reason_code', p_reason_code, 'decision_id', v_id),
          'rec_final_selection');

  RETURN jsonb_build_object('decision_id', v_id, 'decision', p_decision);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rec_final_selection(uuid, text, text, text) FROM anon;