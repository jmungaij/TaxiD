-- Verification of the selection engine against real data, plus a live scorecard
-- for the Sales Manager vacancy. Asserts that scores are derived from recorded
-- evidence and that authorisation is enforced inside the engine itself.
DO $$
DECLARE
  v_admin uuid;
  v_vacancy uuid := 'f1f335ad-4128-457e-9ff4-f9a36b72683b';
  v_app uuid := '65f50607-6044-474f-8496-c522a0fe63ca';
  v_sc jsonb;
  v_facts integer;
  v_eval jsonb;
  v_row public.rec_application_evaluations;
  v_queue jsonb;
BEGIN
  SELECT user_id INTO v_admin FROM public.user_roles
   WHERE role::text IN ('admin','super_admin') LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE NOTICE 'no admin user present; skipping selection engine verification';
    RETURN;
  END IF;

  -- Engine must refuse an unauthenticated caller before doing any work.
  PERFORM set_config('request.jwt.claims', NULL, true);
  BEGIN
    PERFORM public.rec_evaluate_application(v_app);
    RAISE EXCEPTION 'selection engine evaluated an application for an unauthorised caller';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'selection engine evaluated%' THEN RAISE; END IF;
  END;

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text,
    true
  );

  v_sc := public.rec_scorecard_save(
    v_vacancy,
    '[{"code":"required_certification","label":"Required professional certification","criterion_type":"hard_gate","weight":0,"evidence_source":"document","scoring_method":"presence"},
      {"code":"relevant_experience","label":"Relevant commercial experience","criterion_type":"scored","weight":60,"min_threshold":3,"evidence_source":"cv","scoring_method":"threshold"},
      {"code":"sector_exposure","label":"Mobility sector exposure","criterion_type":"preferred","weight":40,"evidence_source":"cv","scoring_method":"presence"}]'::jsonb,
    'Baseline scorecard published during selection engine verification'
  );
  IF (v_sc->>'version')::int < 1 THEN
    RAISE EXCEPTION 'scorecard was not versioned: %', v_sc;
  END IF;

  v_facts := public.rec_record_evidence(
    v_app,
    '[{"attribute":"relevant_experience","value_numeric":10,"source_kind":"cv","source_ref":"application","source_locator":"years_experience","confidence":0.9},
      {"attribute":"sector_exposure","value_text":"Mobility operations","source_kind":"cv","source_ref":"application","confidence":0.7}]'::jsonb
  );
  IF v_facts <> 2 THEN
    RAISE EXCEPTION 'expected 2 evidence facts, recorded %', v_facts;
  END IF;

  v_eval := public.rec_evaluate_application(v_app);

  SELECT * INTO v_row FROM public.rec_application_evaluations
   WHERE application_id = v_app AND is_current LIMIT 1;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'evaluation was not persisted';
  END IF;

  -- A missing hard-gate document must send the candidate to human review, never
  -- to an automatic rejection.
  IF v_row.eligibility <> 'requires_review' THEN
    RAISE EXCEPTION 'missing hard-gate evidence produced eligibility % instead of requires_review', v_row.eligibility;
  END IF;
  IF v_row.recommendation <> 'review' THEN
    RAISE EXCEPTION 'expected a review recommendation, got %', v_row.recommendation;
  END IF;
  IF NOT (v_row.missing_evidence @> ARRAY['Required professional certification']) THEN
    RAISE EXCEPTION 'missing evidence was not explained: %', v_row.missing_evidence;
  END IF;
  -- 10 years against a 3-year threshold earns the full 60 points; the preferred
  -- criterion is scaled by the 0.70 extraction confidence of its evidence
  -- (40 * 0.70 = 28), so a low-confidence extraction cannot masquerade as proof.
  IF v_row.weighted_score <> 88.00 THEN
    RAISE EXCEPTION 'expected a confidence-weighted score of 88 from recorded evidence, got %', v_row.weighted_score;
  END IF;
  IF jsonb_array_length(v_row.criterion_results) <> 3 THEN
    RAISE EXCEPTION 'criterion breakdown incomplete: %', v_row.criterion_results;
  END IF;

  -- The candidate must now surface in the eligibility review queue, not in "new".
  v_queue := public.rec_review_queue(v_vacancy, 'eligibility_review', 10, 0, NULL);
  IF (v_queue->>'total')::int < 1 THEN
    RAISE EXCEPTION 'evaluated candidate did not reach the eligibility review queue: %', v_queue;
  END IF;

  RAISE NOTICE 'selection engine verified: score %, eligibility %, recommendation %',
    v_row.weighted_score, v_row.eligibility, v_row.recommendation;
END $$;