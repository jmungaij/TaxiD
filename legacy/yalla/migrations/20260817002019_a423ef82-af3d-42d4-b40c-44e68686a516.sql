-- ============================================================
-- Recruitment 360 — governed pipeline action flow
-- validation → interview → evaluation → selection → offer →
-- acceptance → pre-employment checks → onboarding → staff register
-- ============================================================

CREATE OR REPLACE FUNCTION public.rec_seq_code(p_prefix text)
RETURNS text LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT p_prefix || '-' || to_char(now(), 'YYMM') || '-' ||
         upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
$$;

-- 1. Validation gate (screening -> shortlisted) --------------------------
CREATE OR REPLACE FUNCTION public.rec_validate_application(
  p_application_id uuid, p_decision text, p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_app record; v_eval record;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not_authorized: recruitment write access required'; END IF;
  IF p_decision NOT IN ('validated','rejected') THEN RAISE EXCEPTION 'decision must be validated or rejected'; END IF;
  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;

  SELECT * INTO v_eval FROM public.rec_application_evaluations WHERE application_id = p_application_id AND is_current;
  IF p_decision = 'validated' AND v_eval.id IS NULL THEN
    RAISE EXCEPTION 'evidence evaluation required before validation';
  END IF;
  IF p_decision = 'validated' AND v_eval.eligibility = 'ineligible' THEN
    RAISE EXCEPTION 'ineligible evaluation cannot be validated (hard gate failures)';
  END IF;

  IF v_app.stage IN ('applied','received') THEN
    PERFORM public.rec_application_transition(p_application_id, 'screening', p_notes);
  END IF;

  IF p_decision = 'validated' THEN
    PERFORM public.rec_application_transition(p_application_id, 'shortlisted', p_notes);
    PERFORM public.rec_enqueue_notification(p_application_id, 'stage:shortlisted', 'candidate_shortlisted', 'email',
      'Your Yalla Mobility application has progressed', NULL,
      jsonb_build_object('stage', 'shortlisted'));
  ELSE
    IF p_notes IS NULL THEN RAISE EXCEPTION 'rejection requires a reason'; END IF;
    PERFORM public.rec_application_transition(p_application_id, 'rejected', p_notes);
    PERFORM public.rec_enqueue_notification(p_application_id, 'stage:rejected', 'candidate_regret', 'email',
      'Update on your Yalla Mobility application', NULL, jsonb_build_object('stage', 'rejected'));
  END IF;

  RETURN jsonb_build_object('ok', true, 'decision', p_decision);
END; $$;

-- 2. Interview scheduling ------------------------------------------------
CREATE OR REPLACE FUNCTION public.rec_schedule_interview(
  p_application_id uuid,
  p_scheduled_at timestamptz,
  p_interview_stage text DEFAULT 'first',
  p_interview_type text DEFAULT 'competency',
  p_mode text DEFAULT 'virtual',
  p_duration_minutes integer DEFAULT 45,
  p_location text DEFAULT NULL,
  p_meeting_link text DEFAULT NULL,
  p_instructions text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_app record; v_id uuid;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not_authorized: recruitment write access required'; END IF;
  IF p_scheduled_at IS NULL OR p_scheduled_at < now() - interval '1 day' THEN
    RAISE EXCEPTION 'interview must be scheduled in the future';
  END IF;
  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;
  IF v_app.stage NOT IN ('shortlisted','interview','evaluation') THEN
    RAISE EXCEPTION 'candidate must be shortlisted before interview scheduling (stage %)', v_app.stage;
  END IF;

  INSERT INTO public.rec_interviews (application_id, vacancy_id, interview_stage, interview_type, mode,
    scheduled_at, duration_minutes, location, meeting_link, instructions, status, feedback_due_at)
  VALUES (p_application_id, v_app.vacancy_id, p_interview_stage, p_interview_type, p_mode,
    p_scheduled_at, COALESCE(p_duration_minutes, 45), p_location, p_meeting_link, p_instructions,
    'scheduled', p_scheduled_at + interval '2 days')
  RETURNING id INTO v_id;

  IF v_app.stage = 'shortlisted' THEN
    PERFORM public.rec_application_transition(p_application_id, 'interview', 'interview scheduled');
  END IF;

  PERFORM public.rec_enqueue_notification(p_application_id, 'interview:' || v_id::text, 'candidate_interview_invite', 'email',
    'Interview invitation — Yalla Mobility', NULL,
    jsonb_build_object('interview_id', v_id, 'scheduled_at', p_scheduled_at, 'mode', p_mode, 'meeting_link', p_meeting_link));
  PERFORM public.rec_enqueue_notification(p_application_id, 'interview:' || v_id::text, 'candidate_interview_invite', 'sms',
    NULL, NULL, jsonb_build_object('interview_id', v_id, 'scheduled_at', p_scheduled_at));

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, new_state, source)
  VALUES (auth.uid(), 'interview.scheduled', 'rec_interview', v_id,
          jsonb_build_object('application_id', p_application_id, 'scheduled_at', p_scheduled_at), 'recruitment_360');

  RETURN jsonb_build_object('ok', true, 'interview_id', v_id);
END; $$;

-- 3. Interview evaluation ------------------------------------------------
CREATE OR REPLACE FUNCTION public.rec_submit_interview_evaluation(
  p_interview_id uuid,
  p_criteria_scores jsonb,
  p_overall_score numeric,
  p_recommendation text,
  p_strengths text DEFAULT NULL,
  p_concerns text DEFAULT NULL,
  p_comments text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_int record; v_app record; v_id uuid;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not_authorized: recruitment write access required'; END IF;
  IF p_recommendation NOT IN ('advance','hold','reject') THEN RAISE EXCEPTION 'recommendation must be advance, hold or reject'; END IF;
  SELECT * INTO v_int FROM public.rec_interviews WHERE id = p_interview_id;
  IF v_int.id IS NULL THEN RAISE EXCEPTION 'interview not found'; END IF;
  SELECT * INTO v_app FROM public.rec_applications WHERE id = v_int.application_id;

  INSERT INTO public.rec_evaluations (interview_id, application_id, evaluator_staff_id, criteria_scores,
    overall_score, recommendation, strengths, concerns, comments, status, submitted_at)
  VALUES (p_interview_id, v_int.application_id,
    (SELECT id FROM public.staff_members WHERE user_id = auth.uid() LIMIT 1),
    COALESCE(p_criteria_scores, '[]'::jsonb), p_overall_score, p_recommendation,
    p_strengths, p_concerns, p_comments, 'submitted', now())
  RETURNING id INTO v_id;

  UPDATE public.rec_interviews SET status = 'completed', updated_at = now() WHERE id = p_interview_id;

  IF v_app.stage = 'interview' THEN
    PERFORM public.rec_application_transition(v_int.application_id, 'evaluation', 'interview evaluation submitted');
  END IF;

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, new_state, source)
  VALUES (auth.uid(), 'interview.evaluated', 'rec_evaluation', v_id,
          jsonb_build_object('interview_id', p_interview_id, 'recommendation', p_recommendation, 'score', p_overall_score),
          'recruitment_360');

  RETURN jsonb_build_object('ok', true, 'evaluation_id', v_id);
END; $$;

-- 4. Offer creation / dispatch / response --------------------------------
CREATE OR REPLACE FUNCTION public.rec_offer_create(
  p_application_id uuid,
  p_base_salary_cents bigint,
  p_start_date date,
  p_employment_type text DEFAULT 'permanent',
  p_currency text DEFAULT 'KES',
  p_allowances_cents bigint DEFAULT 0,
  p_benefits text[] DEFAULT '{}'::text[],
  p_terms text DEFAULT NULL,
  p_expiry_date date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_app record; v_id uuid; v_no text;
BEGIN
  IF NOT public.rec_is_hiring_authority() THEN RAISE EXCEPTION 'not_authorized: offers require hiring authority'; END IF;
  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rec_selection_decisions
                  WHERE application_id = p_application_id AND decision = 'selected') THEN
    RAISE EXCEPTION 'an offer requires a recorded human final selection';
  END IF;
  IF p_base_salary_cents IS NULL OR p_base_salary_cents <= 0 THEN RAISE EXCEPTION 'base salary is required'; END IF;
  IF p_start_date IS NULL THEN RAISE EXCEPTION 'start date is required'; END IF;
  IF EXISTS (SELECT 1 FROM public.rec_offers WHERE application_id = p_application_id AND status IN ('draft','sent','accepted')) THEN
    RAISE EXCEPTION 'an active offer already exists for this application';
  END IF;

  v_no := public.rec_seq_code('OFR');
  INSERT INTO public.rec_offers (offer_no, application_id, candidate_id, vacancy_id, base_salary_cents,
    currency, allowances_cents, benefits, employment_type, terms, start_date, expiry_date, status)
  VALUES (v_no, p_application_id, v_app.candidate_id, v_app.vacancy_id, p_base_salary_cents,
    COALESCE(p_currency,'KES'), COALESCE(p_allowances_cents,0), COALESCE(p_benefits,'{}'::text[]),
    COALESCE(p_employment_type,'permanent'), p_terms, p_start_date,
    COALESCE(p_expiry_date, p_start_date - interval '7 days')::date, 'draft')
  RETURNING id INTO v_id;

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, new_state, source)
  VALUES (auth.uid(), 'offer.created', 'rec_offer', v_id,
          jsonb_build_object('offer_no', v_no, 'application_id', p_application_id), 'recruitment_360');
  RETURN jsonb_build_object('ok', true, 'offer_id', v_id, 'offer_no', v_no);
END; $$;

CREATE OR REPLACE FUNCTION public.rec_offer_send(p_offer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_offer record; v_app record;
BEGIN
  IF NOT public.rec_is_hiring_authority() THEN RAISE EXCEPTION 'not_authorized: offers require hiring authority'; END IF;
  SELECT * INTO v_offer FROM public.rec_offers WHERE id = p_offer_id;
  IF v_offer.id IS NULL THEN RAISE EXCEPTION 'offer not found'; END IF;
  IF v_offer.status <> 'draft' THEN RAISE EXCEPTION 'only a draft offer can be sent (status %)', v_offer.status; END IF;

  UPDATE public.rec_offers SET status = 'sent', sent_at = now(), updated_at = now() WHERE id = p_offer_id;

  SELECT * INTO v_app FROM public.rec_applications WHERE id = v_offer.application_id;
  IF v_app.stage IN ('evaluation','interview') THEN
    PERFORM public.rec_application_transition(v_offer.application_id, 'offer', 'offer issued');
  END IF;

  PERFORM public.rec_enqueue_notification(v_offer.application_id, 'offer:' || p_offer_id::text || ':sent',
    'candidate_offer', 'email', 'Your Yalla Mobility offer of employment', NULL,
    jsonb_build_object('offer_id', p_offer_id, 'offer_no', v_offer.offer_no, 'start_date', v_offer.start_date));
  PERFORM public.rec_enqueue_notification(v_offer.application_id, 'offer:' || p_offer_id::text || ':sent',
    'candidate_offer', 'sms', NULL, NULL, jsonb_build_object('offer_no', v_offer.offer_no));

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, new_state, source)
  VALUES (auth.uid(), 'offer.sent', 'rec_offer', p_offer_id, jsonb_build_object('offer_no', v_offer.offer_no), 'recruitment_360');
  RETURN jsonb_build_object('ok', true, 'status', 'sent');
END; $$;

CREATE OR REPLACE FUNCTION public.rec_offer_respond(
  p_offer_id uuid, p_response text, p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_offer record; v_case_id uuid; v_case_no text; v_vac record;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not_authorized: recruitment write access required'; END IF;
  IF p_response NOT IN ('accepted','declined') THEN RAISE EXCEPTION 'response must be accepted or declined'; END IF;
  SELECT * INTO v_offer FROM public.rec_offers WHERE id = p_offer_id;
  IF v_offer.id IS NULL THEN RAISE EXCEPTION 'offer not found'; END IF;
  IF v_offer.status <> 'sent' THEN RAISE EXCEPTION 'only a sent offer can be answered (status %)', v_offer.status; END IF;

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
END; $$;

-- 5. Pre-employment checks & onboarding tasks ---------------------------
CREATE OR REPLACE FUNCTION public.rec_preemployment_decide(
  p_check_id uuid, p_status text, p_notes text DEFAULT NULL,
  p_provider text DEFAULT NULL, p_reference text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_chk record;
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not_authorized: recruitment write access required'; END IF;
  IF p_status NOT IN ('in_progress','passed','failed','waived') THEN RAISE EXCEPTION 'invalid check status %', p_status; END IF;
  SELECT * INTO v_chk FROM public.rec_preemployment_checks WHERE id = p_check_id;
  IF v_chk.id IS NULL THEN RAISE EXCEPTION 'check not found'; END IF;
  IF p_status = 'waived' AND NOT public.rec_is_hiring_authority() THEN
    RAISE EXCEPTION 'waiving a pre-employment check requires hiring authority';
  END IF;

  UPDATE public.rec_preemployment_checks
     SET status = p_status, notes = COALESCE(p_notes, notes), provider = COALESCE(p_provider, provider),
         reference = COALESCE(p_reference, reference),
         decided_by = auth.uid(), decided_at = now(), updated_at = now()
   WHERE id = p_check_id;

  IF p_status = 'failed' AND v_chk.is_blocking THEN
    UPDATE public.rec_onboarding_cases SET status = 'blocked', updated_at = now() WHERE id = v_chk.onboarding_case_id;
  END IF;

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, previous_state, new_state, source)
  VALUES (auth.uid(), 'preemployment.' || p_status, 'rec_preemployment_check', p_check_id,
          jsonb_build_object('status', v_chk.status), jsonb_build_object('status', p_status), 'recruitment_360');
  RETURN jsonb_build_object('ok', true, 'status', p_status);
END; $$;

CREATE OR REPLACE FUNCTION public.rec_onboarding_task_complete(p_task_id uuid, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.rec_can_write() THEN RAISE EXCEPTION 'not_authorized: recruitment write access required'; END IF;
  UPDATE public.rec_onboarding_tasks
     SET status = 'completed', completed_at = now(), notes = COALESCE(p_notes, notes), updated_at = now()
   WHERE id = p_task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found'; END IF;
  RETURN jsonb_build_object('ok', true);
END; $$;

-- 6. Exactly-once hire into Staff Register / Staff 360 -------------------
CREATE OR REPLACE FUNCTION public.rec_onboarding_complete(p_case_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_case record; v_cand record; v_vac record; v_existing record;
  v_staff_id uuid; v_staff_no text; v_org uuid; v_pending integer;
BEGIN
  IF NOT public.rec_is_hiring_authority() THEN RAISE EXCEPTION 'not_authorized: hire completion requires hiring authority'; END IF;
  SELECT * INTO v_case FROM public.rec_onboarding_cases WHERE id = p_case_id;
  IF v_case.id IS NULL THEN RAISE EXCEPTION 'onboarding case not found'; END IF;

  -- Idempotent: already provisioned -> return the same staff record.
  SELECT * INTO v_existing FROM public.rec_staff_provisioning WHERE application_id = v_case.application_id;
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'created', false, 'staff_member_id', v_existing.staff_member_id,
                              'staff_no', v_existing.staff_no, 'idempotent', true);
  END IF;

  SELECT count(*) INTO v_pending FROM public.rec_preemployment_checks
   WHERE application_id = v_case.application_id AND is_blocking AND status <> 'passed' AND status <> 'waived';
  IF v_pending > 0 THEN
    RAISE EXCEPTION 'cannot complete onboarding: % blocking pre-employment check(s) outstanding', v_pending;
  END IF;

  SELECT count(*) INTO v_pending FROM public.rec_onboarding_tasks
   WHERE case_id = p_case_id AND status <> 'completed' AND status <> 'waived';
  IF v_pending > 0 THEN
    RAISE EXCEPTION 'cannot complete onboarding: % onboarding task(s) outstanding', v_pending;
  END IF;

  SELECT * INTO v_cand FROM public.rec_candidates WHERE id = v_case.candidate_id;
  SELECT * INTO v_vac FROM public.rec_vacancies WHERE id = v_case.vacancy_id;
  SELECT id INTO v_org FROM public.org_entities ORDER BY created_at LIMIT 1;
  IF v_org IS NULL THEN RAISE EXCEPTION 'no organisation entity configured'; END IF;

  v_staff_no := public.rec_seq_code('YM');
  INSERT INTO public.staff_members (org_id, user_id, staff_no, full_name, work_email, personal_email, phone,
    employment_status, employment_type, start_date, unit_id, position_id, manager_staff_id, location,
    years_experience, provenance)
  VALUES (v_org, v_cand.user_id, v_staff_no, v_cand.full_name, NULL, v_cand.email, v_cand.phone,
    'onboarding', COALESCE(v_vac.employment_type, 'permanent'), v_case.start_date,
    COALESCE(v_case.unit_id, v_vac.unit_id), v_vac.position_id, v_case.manager_staff_id,
    COALESCE(v_cand.location, v_vac.location), v_cand.years_experience, 'LIVE')
  RETURNING id INTO v_staff_id;

  INSERT INTO public.rec_staff_provisioning (application_id, onboarding_case_id, staff_member_id, staff_no)
  VALUES (v_case.application_id, p_case_id, v_staff_id, v_staff_no);

  UPDATE public.rec_onboarding_cases
     SET status = 'completed', staff_member_id = v_staff_id, handover_completed_at = now(), updated_at = now()
   WHERE id = p_case_id;

  PERFORM public.rec_application_transition(v_case.application_id, 'hired', 'onboarding completed');

  PERFORM public.rec_enqueue_notification(v_case.application_id, 'hire:' || p_case_id::text,
    'candidate_hired', 'email', 'You are officially part of Yalla Mobility', NULL,
    jsonb_build_object('staff_no', v_staff_no, 'start_date', v_case.start_date));

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, new_state, source)
  VALUES (auth.uid(), 'hire.provisioned', 'staff_member', v_staff_id,
          jsonb_build_object('staff_no', v_staff_no, 'application_id', v_case.application_id, 'case_id', p_case_id),
          'recruitment_360');

  RETURN jsonb_build_object('ok', true, 'created', true, 'staff_member_id', v_staff_id, 'staff_no', v_staff_no);
END; $$;

-- 7. Live pipeline state -------------------------------------------------
CREATE OR REPLACE FUNCTION public.rec_pipeline_state(p_vacancy_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.rec_is_recruiter() THEN RAISE EXCEPTION 'not_authorized to read recruitment pipeline'; END IF;
  SELECT jsonb_build_object(
    'vacancy_id', p_vacancy_id,
    'stages', (
      SELECT COALESCE(jsonb_object_agg(stage, cnt), '{}'::jsonb)
        FROM (SELECT stage, count(*) AS cnt FROM public.rec_applications
               WHERE vacancy_id = p_vacancy_id GROUP BY stage) s
    ),
    'validation', jsonb_build_object(
      'awaiting_evaluation', (SELECT count(*) FROM public.rec_applications a
         LEFT JOIN public.rec_application_evaluations e ON e.application_id = a.id AND e.is_current
        WHERE a.vacancy_id = p_vacancy_id AND a.status = 'active' AND e.id IS NULL),
      'requires_review', (SELECT count(*) FROM public.rec_application_evaluations
        WHERE vacancy_id = p_vacancy_id AND is_current AND eligibility = 'requires_review'),
      'eligible', (SELECT count(*) FROM public.rec_application_evaluations
        WHERE vacancy_id = p_vacancy_id AND is_current AND eligibility = 'eligible')
    ),
    'interviews', jsonb_build_object(
      'scheduled', (SELECT count(*) FROM public.rec_interviews WHERE vacancy_id = p_vacancy_id AND status = 'scheduled'),
      'completed', (SELECT count(*) FROM public.rec_interviews WHERE vacancy_id = p_vacancy_id AND status = 'completed'),
      'awaiting_feedback', (SELECT count(*) FROM public.rec_interviews i
        WHERE i.vacancy_id = p_vacancy_id AND i.status = 'completed'
          AND NOT EXISTS (SELECT 1 FROM public.rec_evaluations e WHERE e.interview_id = i.id AND e.status = 'submitted'))
    ),
    'selection', jsonb_build_object(
      'selected', (SELECT count(*) FROM public.rec_selection_decisions WHERE vacancy_id = p_vacancy_id AND decision = 'selected'),
      'not_selected', (SELECT count(*) FROM public.rec_selection_decisions WHERE vacancy_id = p_vacancy_id AND decision = 'not_selected'),
      'overrides', (SELECT count(*) FROM public.rec_selection_decisions WHERE vacancy_id = p_vacancy_id AND is_override)
    ),
    'offers', (
      SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb)
        FROM (SELECT status, count(*) AS cnt FROM public.rec_offers WHERE vacancy_id = p_vacancy_id GROUP BY status) o
    ),
    'checks', (
      SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb)
        FROM (SELECT c.status, count(*) AS cnt FROM public.rec_preemployment_checks c
               JOIN public.rec_applications a ON a.id = c.application_id
              WHERE a.vacancy_id = p_vacancy_id GROUP BY c.status) k
    ),
    'onboarding', (
      SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb)
        FROM (SELECT status, count(*) AS cnt FROM public.rec_onboarding_cases
               WHERE vacancy_id = p_vacancy_id GROUP BY status) n
    ),
    'hires', (SELECT count(*) FROM public.rec_staff_provisioning p
                JOIN public.rec_applications a ON a.id = p.application_id
               WHERE a.vacancy_id = p_vacancy_id),
    'notifications', jsonb_build_object(
      'queued', (SELECT count(*) FROM public.rec_notification_jobs j JOIN public.rec_applications a ON a.id = j.application_id
                  WHERE a.vacancy_id = p_vacancy_id AND j.status IN ('queued','sending')),
      'delivered', (SELECT count(*) FROM public.rec_notification_jobs j JOIN public.rec_applications a ON a.id = j.application_id
                  WHERE a.vacancy_id = p_vacancy_id AND j.status IN ('sent','delivered')),
      'failed', (SELECT count(*) FROM public.rec_notification_jobs j JOIN public.rec_applications a ON a.id = j.application_id
                  WHERE a.vacancy_id = p_vacancy_id AND j.status = 'failed')
    )
  ) INTO v_result;
  RETURN v_result;
END; $$;

-- 8. AI governance dossier for one application ---------------------------
CREATE OR REPLACE FUNCTION public.rec_application_governance(p_application_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF NOT public.rec_is_recruiter() THEN RAISE EXCEPTION 'not_authorized to read recruitment governance'; END IF;
  SELECT jsonb_build_object(
    'application_id', p_application_id,
    'evaluation', (
      SELECT to_jsonb(e) || jsonb_build_object(
        'process_id', 'recruitment.selection.evidence_evaluation',
        'model', COALESCE(e.engine, 'rec_evaluate_application'),
        'scorecard_ref', e.scorecard_id::text || '@v' || e.scorecard_version::text)
        FROM public.rec_application_evaluations e
       WHERE e.application_id = p_application_id AND e.is_current
    ),
    'evidence', (
      SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.created_at DESC), '[]'::jsonb)
        FROM public.rec_evidence_facts f WHERE f.application_id = p_application_id
    ),
    'ai_recommendations', (
      SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC), '[]'::jsonb)
        FROM public.rec_ai_recommendations r
       WHERE r.subject_type = 'application' AND r.subject_id = p_application_id
    ),
    'decisions', (
      SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.decided_at DESC), '[]'::jsonb)
        FROM public.rec_selection_decisions d WHERE d.application_id = p_application_id
    ),
    'interviews', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'interview', to_jsonb(i),
               'evaluations', (SELECT COALESCE(jsonb_agg(to_jsonb(ev)), '[]'::jsonb)
                                 FROM public.rec_evaluations ev WHERE ev.interview_id = i.id)
             ) ORDER BY i.scheduled_at), '[]'::jsonb)
        FROM public.rec_interviews i WHERE i.application_id = p_application_id
    ),
    'offers', (
      SELECT COALESCE(jsonb_agg(to_jsonb(o) ORDER BY o.created_at DESC), '[]'::jsonb)
        FROM public.rec_offers o WHERE o.application_id = p_application_id
    ),
    'checks', (
      SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.check_type), '[]'::jsonb)
        FROM public.rec_preemployment_checks c WHERE c.application_id = p_application_id
    ),
    'onboarding', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'case', to_jsonb(n),
               'tasks', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at), '[]'::jsonb)
                           FROM public.rec_onboarding_tasks t WHERE t.case_id = n.id)
             )), '[]'::jsonb)
        FROM public.rec_onboarding_cases n WHERE n.application_id = p_application_id
    ),
    'notifications', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'job', to_jsonb(j),
               'attempts', (SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.created_at), '[]'::jsonb)
                              FROM public.rec_notification_deliveries d WHERE d.job_id = j.id)
             ) ORDER BY j.created_at DESC), '[]'::jsonb)
        FROM public.rec_notification_jobs j WHERE j.application_id = p_application_id
    ),
    'audit', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'action', ae.action, 'object_type', ae.object_type, 'actor_id', ae.actor_id,
               'previous_state', ae.previous_state, 'new_state', ae.new_state,
               'source', ae.source, 'created_at', ae.created_at) ORDER BY ae.created_at DESC), '[]'::jsonb)
        FROM public.rec_audit_events ae
       WHERE ae.object_id = p_application_id
          OR ae.object_id IN (SELECT id FROM public.rec_interviews WHERE application_id = p_application_id)
          OR ae.object_id IN (SELECT id FROM public.rec_offers WHERE application_id = p_application_id)
          OR ae.object_id IN (SELECT id FROM public.rec_notification_jobs WHERE application_id = p_application_id)
    ),
    'provisioning', (
      SELECT to_jsonb(p) FROM public.rec_staff_provisioning p WHERE p.application_id = p_application_id
    )
  ) INTO v_result;
  RETURN v_result;
END; $$;