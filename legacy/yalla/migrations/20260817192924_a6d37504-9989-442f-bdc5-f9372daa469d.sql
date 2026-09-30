-- Recruitment 360: panel review, offer approval controls, offer expiry

CREATE TABLE IF NOT EXISTS public.rec_panel_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  vacancy_id uuid NOT NULL REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'locked',
  evaluation_count integer NOT NULL DEFAULT 0,
  average_score numeric,
  recommendation_mix jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_hash text,
  panel_decision text,
  decision_notes text,
  reason_code text REFERENCES public.rec_rejection_reasons(code),
  opened_by uuid,
  opened_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_panel_reviews_status_ck CHECK (status = ANY (ARRAY['locked','decided'])),
  CONSTRAINT rec_panel_reviews_decision_ck CHECK (panel_decision IS NULL OR panel_decision = ANY (ARRAY['advance','hold','reject']))
);

CREATE UNIQUE INDEX IF NOT EXISTS rec_panel_reviews_open_uk
  ON public.rec_panel_reviews (application_id) WHERE status = 'locked';
CREATE INDEX IF NOT EXISTS rec_panel_reviews_app_idx
  ON public.rec_panel_reviews (application_id, opened_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.rec_panel_reviews TO authenticated;
GRANT ALL ON public.rec_panel_reviews TO service_role;
ALTER TABLE public.rec_panel_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rec staff read rec_panel_reviews" ON public.rec_panel_reviews;
CREATE POLICY "rec staff read rec_panel_reviews" ON public.rec_panel_reviews
  FOR SELECT TO authenticated USING (public.rec_can_read());
DROP POLICY IF EXISTS "rec staff insert rec_panel_reviews" ON public.rec_panel_reviews;
CREATE POLICY "rec staff insert rec_panel_reviews" ON public.rec_panel_reviews
  FOR INSERT TO authenticated WITH CHECK (public.rec_can_write());
DROP POLICY IF EXISTS "rec staff update rec_panel_reviews" ON public.rec_panel_reviews
;
CREATE POLICY "rec staff update rec_panel_reviews" ON public.rec_panel_reviews
  FOR UPDATE TO authenticated USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());

-- Locked evidence is immutable: only the decision fields may change, once.
CREATE OR REPLACE FUNCTION public.rec_panel_review_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'decided' THEN
    RAISE EXCEPTION 'a decided panel review is immutable';
  END IF;
  IF NEW.evidence IS DISTINCT FROM OLD.evidence
     OR NEW.evidence_hash IS DISTINCT FROM OLD.evidence_hash
     OR NEW.evaluation_count IS DISTINCT FROM OLD.evaluation_count
     OR NEW.average_score IS DISTINCT FROM OLD.average_score
     OR NEW.application_id IS DISTINCT FROM OLD.application_id THEN
    RAISE EXCEPTION 'panel review evidence is locked and cannot be altered';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rec_panel_reviews_guard ON public.rec_panel_reviews;
CREATE TRIGGER trg_rec_panel_reviews_guard BEFORE UPDATE ON public.rec_panel_reviews
  FOR EACH ROW EXECUTE FUNCTION public.rec_panel_review_guard();

/* ------------------------- panel review aggregation ---------------------- */

CREATE OR REPLACE FUNCTION public.rec_panel_review_summary(p_application_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_evals jsonb; v_count integer; v_avg numeric; v_mix jsonb; v_review record; v_app record;
BEGIN
  IF NOT public.rec_can_read() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'evaluation_id', e.id, 'interview_id', e.interview_id,
           'interview_stage', i.interview_stage,
           'evaluator_staff_id', e.evaluator_staff_id,
           'overall_score', e.overall_score, 'recommendation', e.recommendation,
           'strengths', e.strengths, 'concerns', e.concerns,
           'criteria_scores', e.criteria_scores,
           'submitted_at', e.submitted_at
         ) ORDER BY e.submitted_at), '[]'::jsonb),
         count(*), round(avg(e.overall_score), 2)
    INTO v_evals, v_count, v_avg
    FROM public.rec_evaluations e
    JOIN public.rec_interviews i ON i.id = e.interview_id
   WHERE e.application_id = p_application_id AND e.status IN ('submitted','reviewed');

  SELECT coalesce(jsonb_object_agg(r.recommendation, r.n), '{}'::jsonb) INTO v_mix
    FROM (SELECT coalesce(recommendation, 'unspecified') AS recommendation, count(*) AS n
            FROM public.rec_evaluations
           WHERE application_id = p_application_id AND status IN ('submitted','reviewed')
           GROUP BY 1) r;

  SELECT * INTO v_review FROM public.rec_panel_reviews
   WHERE application_id = p_application_id ORDER BY opened_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'application_id', p_application_id,
    'stage', v_app.stage,
    'evaluation_count', coalesce(v_count, 0),
    'average_score', v_avg,
    'recommendation_mix', v_mix,
    'evaluations', v_evals,
    'review', CASE WHEN v_review.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_review.id, 'status', v_review.status, 'panel_decision', v_review.panel_decision,
      'decision_notes', v_review.decision_notes, 'reason_code', v_review.reason_code,
      'evaluation_count', v_review.evaluation_count, 'average_score', v_review.average_score,
      'recommendation_mix', v_review.recommendation_mix, 'evidence_hash', v_review.evidence_hash,
      'opened_at', v_review.opened_at, 'decided_at', v_review.decided_at) END
  );
END;
$$;

-- Open (and lock) the panel review for an application at evaluation stage.
CREATE OR REPLACE FUNCTION public.rec_panel_review_open(p_application_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_app record; v_sum jsonb; v_id uuid;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not_authorized: recruitment write access required'; END IF;
  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;
  IF v_app.stage <> 'evaluation' THEN
    RAISE EXCEPTION 'panel review requires the application to be at evaluation stage (current %)', v_app.stage;
  END IF;

  SELECT id INTO v_id FROM public.rec_panel_reviews
   WHERE application_id = p_application_id AND status = 'locked';
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'review_id', v_id, 'idempotent', true);
  END IF;

  v_sum := public.rec_panel_review_summary(p_application_id);
  IF (v_sum->>'evaluation_count')::int = 0 THEN
    RAISE EXCEPTION 'panel review requires at least one submitted assessment';
  END IF;

  INSERT INTO public.rec_panel_reviews (
    application_id, vacancy_id, candidate_id, status, evaluation_count, average_score,
    recommendation_mix, evidence, evidence_hash, opened_by)
  VALUES (
    p_application_id, v_app.vacancy_id, v_app.candidate_id, 'locked',
    (v_sum->>'evaluation_count')::int,
    NULLIF(v_sum->>'average_score','')::numeric,
    v_sum->'recommendation_mix',
    jsonb_build_object('evaluations', v_sum->'evaluations'),
    md5((v_sum->'evaluations')::text),
    auth.uid())
  RETURNING id INTO v_id;

  UPDATE public.rec_evaluations
     SET status = 'reviewed', reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
   WHERE application_id = p_application_id AND status = 'submitted';

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, new_state, source)
  VALUES (auth.uid(), 'panel_review.opened', 'rec_panel_review', v_id,
          jsonb_build_object('application_id', p_application_id,
                             'evaluation_count', v_sum->'evaluation_count',
                             'evidence_hash', md5((v_sum->'evaluations')::text)),
          'recruitment_360');

  RETURN jsonb_build_object('ok', true, 'review_id', v_id, 'evaluation_count', (v_sum->>'evaluation_count')::int);
END;
$$;

CREATE OR REPLACE FUNCTION public.rec_panel_review_decide(
  p_review_id uuid, p_decision text, p_notes text DEFAULT NULL, p_reason_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_review record;
BEGIN
  IF NOT public.rec_is_hiring_authority() THEN
    RAISE EXCEPTION 'not_authorized: a panel decision requires hiring authority';
  END IF;
  IF p_decision NOT IN ('advance','hold','reject') THEN
    RAISE EXCEPTION 'panel decision must be advance, hold or reject';
  END IF;
  SELECT * INTO v_review FROM public.rec_panel_reviews WHERE id = p_review_id;
  IF v_review.id IS NULL THEN RAISE EXCEPTION 'panel review not found'; END IF;
  IF v_review.status <> 'locked' THEN RAISE EXCEPTION 'this panel review is already decided'; END IF;
  IF p_decision <> 'advance' AND coalesce(btrim(p_notes), '') = '' THEN
    RAISE EXCEPTION 'a hold or reject panel decision requires notes';
  END IF;
  IF p_decision = 'reject' AND p_reason_code IS NULL THEN
    RAISE EXCEPTION 'a reject panel decision requires a reason code';
  END IF;

  UPDATE public.rec_panel_reviews
     SET status = 'decided', panel_decision = p_decision, decision_notes = p_notes,
         reason_code = p_reason_code, decided_by = auth.uid(), decided_at = now()
   WHERE id = p_review_id;

  IF p_decision = 'reject' THEN
    PERFORM public.rec_final_selection(v_review.application_id, 'not_selected', p_reason_code, p_notes);
  END IF;

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, previous_state, new_state, source)
  VALUES (auth.uid(), 'panel_review.decided', 'rec_panel_review', p_review_id,
          jsonb_build_object('status', 'locked'),
          jsonb_build_object('panel_decision', p_decision, 'reason_code', p_reason_code),
          'recruitment_360');

  RETURN jsonb_build_object('ok', true, 'review_id', p_review_id, 'panel_decision', p_decision);
END;
$$;

/* ------------------ final selection now requires the panel --------------- */

CREATE OR REPLACE FUNCTION public.rec_final_selection(
  p_application_id uuid, p_decision text, p_reason_code text DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_app record; v_eval record; v_id uuid; v_panel record;
BEGIN
  IF NOT public.rec_is_hiring_authority() THEN
    RAISE EXCEPTION 'final selection requires hiring authority';
  END IF;
  IF p_decision NOT IN ('selected','not_selected') THEN
    RAISE EXCEPTION 'final decision must be selected or not_selected';
  END IF;
  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;

  IF p_decision = 'selected' THEN
    IF v_app.stage NOT IN ('evaluation','offer') THEN
      RAISE EXCEPTION 'candidate must complete interview and evaluation before final selection (current stage %)', v_app.stage;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.rec_evaluations e
                    JOIN public.rec_interviews i ON i.id = e.interview_id
                   WHERE i.application_id = p_application_id) THEN
      RAISE EXCEPTION 'no interview evaluation on record for this application';
    END IF;
    SELECT * INTO v_panel FROM public.rec_panel_reviews
     WHERE application_id = p_application_id AND status = 'decided' AND panel_decision = 'advance'
     ORDER BY decided_at DESC LIMIT 1;
    IF v_panel.id IS NULL THEN
      RAISE EXCEPTION 'selection requires a decided panel review recommending advance';
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
    jsonb_build_object('score', v_eval.weighted_score, 'eligibility', v_eval.eligibility,
                       'panel_review_id', v_panel.id, 'panel_evidence_hash', v_panel.evidence_hash),
    auth.uid(), 'hiring_authority'
  ) RETURNING id INTO v_id;

  IF p_decision = 'not_selected' AND v_app.stage NOT IN ('rejected','withdrawn') THEN
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

/* ------------------------- offer approval controls ---------------------- */

CREATE OR REPLACE FUNCTION public.rec_offer_submit_for_approval(p_offer_id uuid, p_approver_role text DEFAULT 'hiring_authority')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_offer record;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not_authorized: recruitment write access required'; END IF;
  SELECT * INTO v_offer FROM public.rec_offers WHERE id = p_offer_id;
  IF v_offer.id IS NULL THEN RAISE EXCEPTION 'offer not found'; END IF;
  IF v_offer.status <> 'draft' THEN RAISE EXCEPTION 'only a draft offer can be routed for approval (status %)', v_offer.status; END IF;

  UPDATE public.rec_offers SET status = 'approval', updated_at = now() WHERE id = p_offer_id;

  INSERT INTO public.rec_offer_approvals (offer_id, step_order, approver_role, decision)
  VALUES (p_offer_id, 1, coalesce(p_approver_role, 'hiring_authority'), 'pending')
  ON CONFLICT (offer_id, step_order) DO UPDATE SET decision = 'pending', decided_by = NULL, decided_at = NULL, updated_at = now();

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, previous_state, new_state, source)
  VALUES (auth.uid(), 'offer.submitted_for_approval', 'rec_offer', p_offer_id,
          jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'approval'), 'recruitment_360');
  RETURN jsonb_build_object('ok', true, 'status', 'approval');
END;
$$;

CREATE OR REPLACE FUNCTION public.rec_offer_approve(p_offer_id uuid, p_decision text, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_offer record;
BEGIN
  IF NOT public.rec_is_hiring_authority() THEN RAISE EXCEPTION 'not_authorized: offer approval requires hiring authority'; END IF;
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'decision must be approved or rejected'; END IF;
  SELECT * INTO v_offer FROM public.rec_offers WHERE id = p_offer_id;
  IF v_offer.id IS NULL THEN RAISE EXCEPTION 'offer not found'; END IF;
  IF v_offer.status <> 'approval' THEN RAISE EXCEPTION 'only an offer awaiting approval can be decided (status %)', v_offer.status; END IF;
  IF v_offer.created_by IS NOT NULL AND v_offer.created_by = auth.uid() THEN
    RAISE EXCEPTION 'maker-checker: an offer must be approved by someone other than its author';
  END IF;
  IF p_decision = 'rejected' AND coalesce(btrim(p_notes), '') = '' THEN
    RAISE EXCEPTION 'rejecting an offer requires notes';
  END IF;

  UPDATE public.rec_offers
     SET status = CASE WHEN p_decision = 'approved' THEN 'approved' ELSE 'draft' END, updated_at = now()
   WHERE id = p_offer_id;

  UPDATE public.rec_offer_approvals
     SET decision = p_decision, decided_by = auth.uid(), decided_at = now(), notes = p_notes, updated_at = now()
   WHERE offer_id = p_offer_id AND step_order = 1;

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, previous_state, new_state, source)
  VALUES (auth.uid(), 'offer.' || p_decision, 'rec_offer', p_offer_id,
          jsonb_build_object('status', 'approval'), jsonb_build_object('decision', p_decision, 'notes', p_notes), 'recruitment_360');
  RETURN jsonb_build_object('ok', true, 'decision', p_decision);
END;
$$;

-- Sending now accepts an approved offer as well as a draft one.
CREATE OR REPLACE FUNCTION public.rec_offer_send(p_offer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_offer record; v_app record;
BEGIN
  IF NOT public.rec_is_hiring_authority() THEN RAISE EXCEPTION 'not_authorized: offers require hiring authority'; END IF;
  SELECT * INTO v_offer FROM public.rec_offers WHERE id = p_offer_id;
  IF v_offer.id IS NULL THEN RAISE EXCEPTION 'offer not found'; END IF;
  IF v_offer.status NOT IN ('draft','approved') THEN
    RAISE EXCEPTION 'only a draft or approved offer can be sent (status %)', v_offer.status;
  END IF;
  IF v_offer.expiry_date IS NOT NULL AND v_offer.expiry_date < current_date THEN
    RAISE EXCEPTION 'the offer expiry date has already passed';
  END IF;

  UPDATE public.rec_offers SET status = 'sent', sent_at = now(), updated_at = now() WHERE id = p_offer_id;

  SELECT * INTO v_app FROM public.rec_applications WHERE id = v_offer.application_id;
  IF v_app.stage IN ('evaluation','interview') THEN
    PERFORM public.rec_application_transition(v_offer.application_id, 'offer', 'offer issued');
  END IF;

  PERFORM public.rec_enqueue_notification(v_offer.application_id, 'offer:' || p_offer_id::text || ':sent',
    'candidate_offer', 'email', 'Your Yalla Mobility offer of employment', NULL,
    jsonb_build_object('offer_id', p_offer_id, 'offer_no', v_offer.offer_no, 'start_date', v_offer.start_date,
                       'expiry_date', v_offer.expiry_date));
  PERFORM public.rec_enqueue_notification(v_offer.application_id, 'offer:' || p_offer_id::text || ':sent',
    'candidate_offer', 'sms', NULL, NULL, jsonb_build_object('offer_no', v_offer.offer_no));

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, new_state, source)
  VALUES (auth.uid(), 'offer.sent', 'rec_offer', p_offer_id, jsonb_build_object('offer_no', v_offer.offer_no), 'recruitment_360');
  RETURN jsonb_build_object('ok', true, 'status', 'sent');
END;
$$;

-- Expire offers whose expiry date has passed without a response.
CREATE OR REPLACE FUNCTION public.rec_offer_expire_due()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row record; v_count integer := 0;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not_authorized: recruitment write access required'; END IF;
  FOR v_row IN
    SELECT * FROM public.rec_offers
     WHERE status IN ('sent','viewed') AND expiry_date IS NOT NULL AND expiry_date < current_date
  LOOP
    UPDATE public.rec_offers SET status = 'expired', updated_at = now() WHERE id = v_row.id;
    BEGIN
      PERFORM public.rec_application_transition(v_row.application_id, 'withdrawn', 'offer expired without response');
    EXCEPTION WHEN others THEN NULL;
    END;
    INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, previous_state, new_state, source)
    VALUES (auth.uid(), 'offer.expired', 'rec_offer', v_row.id,
            jsonb_build_object('status', v_row.status),
            jsonb_build_object('status', 'expired', 'expiry_date', v_row.expiry_date), 'recruitment_360');
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'expired', v_count);
END;
$$;

-- A lapsed offer can no longer be accepted.
CREATE OR REPLACE FUNCTION public.rec_offer_respond(p_offer_id uuid, p_response text, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_offer record; v_case_id uuid; v_case_no text; v_vac record;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not_authorized: recruitment write access required'; END IF;
  IF p_response NOT IN ('accepted','declined') THEN RAISE EXCEPTION 'response must be accepted or declined'; END IF;
  SELECT * INTO v_offer FROM public.rec_offers WHERE id = p_offer_id;
  IF v_offer.id IS NULL THEN RAISE EXCEPTION 'offer not found'; END IF;
  IF v_offer.status NOT IN ('sent','viewed') THEN RAISE EXCEPTION 'only a sent offer can be answered (status %)', v_offer.status; END IF;
  IF p_response = 'accepted' AND v_offer.expiry_date IS NOT NULL AND v_offer.expiry_date < current_date THEN
    RAISE EXCEPTION 'this offer expired on % and can no longer be accepted', v_offer.expiry_date;
  END IF;

  UPDATE public.rec_offers
     SET status = p_response, responded_at = now(),
         decline_reason = CASE WHEN p_response = 'declined' THEN p_reason ELSE NULL END,
         updated_at = now()
   WHERE id = p_offer_id;

  IF p_response = 'declined' THEN
    PERFORM public.rec_application_transition(v_offer.application_id, 'withdrawn', COALESCE(p_reason, 'offer declined'));
    PERFORM public.rec_enqueue_notification(v_offer.application_id, 'offer:' || p_offer_id::text || ':declined',
      'candidate_offer_declined_ack', 'email', 'We have received your response', NULL, '{}'::jsonb);
    RETURN jsonb_build_object('ok', true, 'status', 'declined');
  END IF;

  PERFORM public.rec_application_transition(v_offer.application_id, 'accepted', 'offer accepted');
  SELECT * INTO v_vac FROM public.rec_vacancies WHERE id = v_offer.vacancy_id;

  SELECT id INTO v_case_id FROM public.rec_onboarding_cases WHERE offer_id = p_offer_id;
  IF v_case_id IS NULL THEN
    v_case_no := public.rec_seq_code('ONB');
    INSERT INTO public.rec_onboarding_cases (case_no, offer_id, application_id, candidate_id, vacancy_id,
      start_date, unit_id, manager_staff_id, status)
    VALUES (v_case_no, p_offer_id, v_offer.application_id, v_offer.candidate_id, v_offer.vacancy_id,
      v_offer.start_date, v_vac.unit_id, v_vac.hiring_manager_staff_id, 'preboarding')
    RETURNING id INTO v_case_id;

    INSERT INTO public.rec_onboarding_tasks (case_id, title, category, due_date)
    SELECT v_case_id, t.title, t.category, COALESCE(v_offer.start_date, current_date + 14)
      FROM (VALUES
        ('Signed contract returned', 'documentation'),
        ('Statutory details captured (KRA PIN, NSSF, SHIF)', 'documentation'),
        ('Bank details captured for payroll', 'payroll'),
        ('Workspace, device and system access provisioned', 'it'),
        ('Day-1 induction scheduled', 'induction')
      ) AS t(title, category);

    INSERT INTO public.rec_preemployment_checks (application_id, offer_id, onboarding_case_id, check_type, is_blocking)
    SELECT v_offer.application_id, p_offer_id, v_case_id, c.check_type, c.blocking
      FROM (VALUES
        ('identity_verification', true),
        ('reference_check', true),
        ('education_verification', true),
        ('criminal_record_certificate', true),
        ('medical_fitness', false)
      ) AS c(check_type, blocking)
    ON CONFLICT (application_id, check_type) DO NOTHING;
  END IF;

  PERFORM public.rec_enqueue_notification(v_offer.application_id, 'offer:' || p_offer_id::text || ':accepted',
    'candidate_onboarding_welcome', 'email', 'Welcome to Yalla Mobility — next steps', NULL,
    jsonb_build_object('case_id', v_case_id, 'start_date', v_offer.start_date));

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, new_state, source)
  VALUES (auth.uid(), 'offer.accepted', 'rec_offer', p_offer_id,
          jsonb_build_object('onboarding_case_id', v_case_id), 'recruitment_360');

  RETURN jsonb_build_object('ok', true, 'status', 'accepted', 'onboarding_case_id', v_case_id);
END;
$$;

REVOKE ALL ON FUNCTION public.rec_panel_review_summary(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.rec_panel_review_open(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.rec_panel_review_decide(uuid, text, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.rec_offer_submit_for_approval(uuid, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.rec_offer_approve(uuid, text, text) FROM public, anon;
REVOKE ALL ON FUNCTION public.rec_offer_expire_due() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rec_panel_review_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_panel_review_open(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_panel_review_decide(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_offer_submit_for_approval(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_offer_approve(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rec_offer_expire_due() TO authenticated;