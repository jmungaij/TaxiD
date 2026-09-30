-- ============================================================================
-- Governed transitions. Staff never write these tables directly (RLS grants
-- read only); every consequential change runs through one of these functions,
-- which authorise, validate, transition and audit in a single transaction.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rec_comm_actor_ok()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NULL OR public.rec_can_write();
$$;

CREATE OR REPLACE FUNCTION public.rec_comm_next_ref(p_comm_type text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text;
BEGIN
  v_code := CASE p_comm_type
    WHEN 'interview_invitation' THEN 'INT'
    WHEN 'reschedule_notice' THEN 'RSC'
    WHEN 'interview_cancellation' THEN 'CAN'
    WHEN 'regret' THEN 'REG'
    WHEN 'appointment_letter' THEN 'APP'
    WHEN 'offer_letter' THEN 'OFR'
    WHEN 'onboarding_pack' THEN 'ONB'
    ELSE 'GEN' END;
  RETURN 'YLM/R360/' || v_code || '/' || to_char(now(), 'YYYY') || '/' ||
         lpad(nextval('public.rec_comm_ref_seq')::text, 6, '0');
END $$;

-- Create (or return) a communication request bound to authoritative records.
CREATE OR REPLACE FUNCTION public.rec_comm_request_create(
  p_comm_type text,
  p_template_key text,
  p_application_id uuid DEFAULT NULL,
  p_interview_id uuid DEFAULT NULL,
  p_offer_id uuid DEFAULT NULL,
  p_onboarding_case_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tpl public.rec_letter_templates;
  v_app public.rec_applications;
  v_interview public.rec_interviews;
  v_cand public.rec_candidates;
  v_revision integer;
  v_business_key text;
  v_idem text;
  v_existing public.rec_comm_requests;
  v_id uuid;
  v_ref text;
BEGIN
  IF NOT public.rec_comm_actor_ok() THEN
    RAISE EXCEPTION 'not_authorised: recruitment write role required';
  END IF;

  SELECT * INTO v_tpl FROM public.rec_letter_templates
   WHERE template_key = p_template_key AND status = 'active'
   ORDER BY version DESC LIMIT 1;
  IF v_tpl.id IS NULL THEN RAISE EXCEPTION 'template_not_active: %', p_template_key; END IF;
  IF v_tpl.comm_type <> p_comm_type THEN
    RAISE EXCEPTION 'template_type_mismatch: % is not a % template', p_template_key, p_comm_type;
  END IF;

  IF p_interview_id IS NOT NULL THEN
    SELECT * INTO v_interview FROM public.rec_interviews WHERE id = p_interview_id;
    IF v_interview.id IS NULL THEN RAISE EXCEPTION 'interview_not_found'; END IF;
    p_application_id := COALESCE(p_application_id, v_interview.application_id);
  END IF;

  IF p_application_id IS NULL THEN RAISE EXCEPTION 'application_required'; END IF;
  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'application_not_found'; END IF;

  SELECT * INTO v_cand FROM public.rec_candidates WHERE id = v_app.candidate_id;
  IF v_cand.email IS NULL OR length(trim(v_cand.email)) = 0 THEN
    RAISE EXCEPTION 'candidate_email_missing: correct the candidate record before issuing a letter';
  END IF;

  -- Business key includes the interview revision so a reschedule produces a new
  -- communication instead of corrupting the original invitation.
  v_revision := COALESCE(v_interview.reschedule_count, 0) + 1;
  v_business_key := concat_ws(':', p_application_id::text, p_comm_type,
                              COALESCE(p_interview_id::text, COALESCE(p_offer_id::text, '-')),
                              v_revision::text);
  v_idem := COALESCE(NULLIF(trim(p_idempotency_key), ''), v_business_key);

  SELECT * INTO v_existing FROM public.rec_comm_requests
   WHERE idempotency_key = v_idem OR business_key = v_business_key LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('request_id', v_existing.id, 'document_ref', v_existing.document_ref,
                              'state', v_existing.state, 'idempotent', true);
  END IF;

  v_ref := public.rec_comm_next_ref(p_comm_type);

  INSERT INTO public.rec_comm_requests (
    document_ref, comm_type, state, revision, candidate_id, application_id, interview_id,
    offer_id, onboarding_case_id, template_id, template_key, template_version,
    recipient_email, recipient_name, event_at, event_timezone, business_key, idempotency_key,
    requires_approval)
  VALUES (
    v_ref, p_comm_type,
    CASE WHEN v_tpl.requires_approval THEN 'pending_approval' ELSE 'approved' END,
    v_revision, v_cand.id, v_app.id, p_interview_id, p_offer_id, p_onboarding_case_id,
    v_tpl.id, v_tpl.template_key, v_tpl.version,
    lower(trim(v_cand.email)), v_cand.full_name,
    v_interview.scheduled_at, COALESCE(v_interview.timezone, 'Africa/Nairobi'),
    v_business_key, v_idem, v_tpl.requires_approval)
  RETURNING id INTO v_id;

  IF NOT v_tpl.requires_approval THEN
    UPDATE public.rec_comm_requests SET approved_at = now(), approved_by = auth.uid() WHERE id = v_id;
  END IF;

  INSERT INTO public.rec_audit_events (action, object_type, object_id, new_state, context)
  VALUES ('comm_request_created', 'rec_comm_request', v_id,
          jsonb_build_object('state', CASE WHEN v_tpl.requires_approval THEN 'pending_approval' ELSE 'approved' END),
          jsonb_build_object('comm_type', p_comm_type, 'document_ref', v_ref,
                             'template', v_tpl.template_key, 'template_version', v_tpl.version,
                             'business_key', v_business_key));

  RETURN jsonb_build_object('request_id', v_id, 'document_ref', v_ref,
                            'state', CASE WHEN v_tpl.requires_approval THEN 'pending_approval' ELSE 'approved' END,
                            'idempotent', false);
END $$;

-- Approval is a business policy: a different authorised person must approve.
CREATE OR REPLACE FUNCTION public.rec_comm_approve(p_request_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req public.rec_comm_requests;
BEGIN
  IF NOT public.rec_is_recruiter() THEN RAISE EXCEPTION 'not_authorised: approver role required'; END IF;
  SELECT * INTO v_req FROM public.rec_comm_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF v_req.state <> 'pending_approval' THEN
    RAISE EXCEPTION 'invalid_transition: % cannot be approved', v_req.state;
  END IF;
  IF v_req.requested_by IS NOT NULL AND v_req.requested_by = auth.uid()
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'maker_checker: a different authorised person must approve this letter';
  END IF;

  UPDATE public.rec_comm_requests
     SET state = 'approved', approved_by = auth.uid(), approved_at = now(),
         approval_note = p_note, updated_at = now()
   WHERE id = p_request_id;

  INSERT INTO public.rec_audit_events (action, object_type, object_id, previous_state, new_state, context)
  VALUES ('comm_request_approved', 'rec_comm_request', p_request_id,
          jsonb_build_object('state', v_req.state), jsonb_build_object('state', 'approved'),
          jsonb_build_object('note', p_note));

  RETURN jsonb_build_object('ok', true, 'state', 'approved');
END $$;

-- Claim approved requests for document generation (single-flight).
CREATE OR REPLACE FUNCTION public.rec_comm_claim_for_generation(p_limit integer DEFAULT 5)
RETURNS SETOF public.rec_comm_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.rec_comm_actor_ok() THEN RAISE EXCEPTION 'not_authorised'; END IF;
  RETURN QUERY
  WITH claimed AS (
    SELECT id FROM public.rec_comm_requests
     WHERE state = 'approved'
     ORDER BY created_at
     LIMIT GREATEST(LEAST(p_limit, 25), 1)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.rec_comm_requests r
     SET state = 'generating', claimed_at = now(), updated_at = now()
   WHERE r.id IN (SELECT id FROM claimed)
  RETURNING r.*;
END $$;

-- Register the immutable snapshot + sealed document, then queue for dispatch.
CREATE OR REPLACE FUNCTION public.rec_comm_document_register(
  p_request_id uuid,
  p_rendered_subject text,
  p_rendered_body text,
  p_data_snapshot jsonb,
  p_branding jsonb,
  p_storage_path text,
  p_byte_size integer,
  p_sha256 text,
  p_signature text,
  p_verification_code text,
  p_classification text,
  p_watermark_text text,
  p_page_count integer DEFAULT 1
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req public.rec_comm_requests;
BEGIN
  IF NOT public.rec_comm_actor_ok() THEN RAISE EXCEPTION 'not_authorised'; END IF;
  SELECT * INTO v_req FROM public.rec_comm_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF v_req.state NOT IN ('generating','approved') THEN
    RAISE EXCEPTION 'invalid_transition: cannot register a document while %', v_req.state;
  END IF;

  INSERT INTO public.rec_comm_snapshots (
    request_id, template_key, template_version, rendered_subject, rendered_body,
    data_snapshot, branding, content_hash)
  VALUES (p_request_id, v_req.template_key, v_req.template_version, p_rendered_subject,
          p_rendered_body, p_data_snapshot, COALESCE(p_branding, '{}'::jsonb), p_sha256)
  ON CONFLICT (request_id) DO NOTHING;

  INSERT INTO public.rec_comm_documents (
    request_id, document_ref, verification_code, storage_path, byte_size, sha256, signature,
    classification, watermark_text, page_count, issued_by)
  VALUES (p_request_id, v_req.document_ref, p_verification_code, p_storage_path, p_byte_size,
          p_sha256, p_signature, p_classification, p_watermark_text, GREATEST(p_page_count, 1), auth.uid())
  ON CONFLICT (request_id) DO NOTHING;

  UPDATE public.rec_comm_requests
     SET state = 'queued', queued_at = now(), updated_at = now(), last_error = NULL
   WHERE id = p_request_id;

  INSERT INTO public.rec_audit_events (action, object_type, object_id, new_state, context)
  VALUES ('comm_document_issued', 'rec_comm_request', p_request_id,
          jsonb_build_object('state', 'queued'),
          jsonb_build_object('document_ref', v_req.document_ref, 'sha256', p_sha256,
                             'classification', p_classification, 'bytes', p_byte_size));

  RETURN jsonb_build_object('ok', true, 'state', 'queued', 'document_ref', v_req.document_ref);
END $$;

-- Claim queued requests for email dispatch.
CREATE OR REPLACE FUNCTION public.rec_comm_claim_for_dispatch(p_limit integer DEFAULT 10)
RETURNS SETOF public.rec_comm_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.rec_comm_actor_ok() THEN RAISE EXCEPTION 'not_authorised'; END IF;
  RETURN QUERY
  WITH claimed AS (
    SELECT id FROM public.rec_comm_requests
     WHERE state IN ('queued','retry_pending') AND attempts < 5
     ORDER BY queued_at NULLS FIRST
     LIMIT GREATEST(LEAST(p_limit, 50), 1)
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.rec_comm_requests r
     SET attempts = r.attempts + 1, claimed_at = now(), updated_at = now()
   WHERE r.id IN (SELECT id FROM claimed)
  RETURNING r.*;
END $$;

-- Record a dispatch attempt. "provider_accepted" is a provider acknowledgement,
-- never a UI click; delivery is only asserted by a provider event.
CREATE OR REPLACE FUNCTION public.rec_comm_record_attempt(
  p_request_id uuid, p_outcome text, p_provider text,
  p_provider_message_id text DEFAULT NULL, p_error text DEFAULT NULL,
  p_detail jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req public.rec_comm_requests; v_state text;
BEGIN
  IF NOT public.rec_comm_actor_ok() THEN RAISE EXCEPTION 'not_authorised'; END IF;
  SELECT * INTO v_req FROM public.rec_comm_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'request_not_found'; END IF;

  INSERT INTO public.rec_comm_dispatch_attempts (
    request_id, attempt, outcome, provider, provider_message_id, error, detail)
  VALUES (p_request_id, v_req.attempts, p_outcome, p_provider, p_provider_message_id, p_error,
          COALESCE(p_detail, '{}'::jsonb))
  ON CONFLICT (request_id, attempt) DO NOTHING;

  v_state := CASE
    WHEN p_outcome = 'provider_accepted' THEN 'provider_accepted'
    WHEN p_outcome = 'suppressed' THEN 'failed'
    WHEN v_req.attempts >= 5 THEN 'failed'
    ELSE 'retry_pending' END;

  UPDATE public.rec_comm_requests
     SET state = v_state,
         provider_accepted_at = CASE WHEN v_state = 'provider_accepted' THEN now() ELSE provider_accepted_at END,
         failed_at = CASE WHEN v_state = 'failed' THEN now() ELSE failed_at END,
         last_error = p_error, updated_at = now()
   WHERE id = p_request_id;

  INSERT INTO public.rec_audit_events (action, object_type, object_id, new_state, context)
  VALUES ('comm_dispatch_attempt', 'rec_comm_request', p_request_id,
          jsonb_build_object('state', v_state),
          jsonb_build_object('attempt', v_req.attempts, 'outcome', p_outcome,
                             'provider', p_provider, 'provider_message_id', p_provider_message_id));

  RETURN jsonb_build_object('ok', true, 'state', v_state);
END $$;

-- Provider callbacks are the only source of delivery truth. Duplicates are no-ops.
CREATE OR REPLACE FUNCTION public.rec_comm_apply_provider_event(
  p_provider text, p_provider_event_id text, p_event_type text,
  p_provider_message_id text DEFAULT NULL, p_request_id uuid DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT now(), p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_request_id uuid; v_inserted uuid; v_state text;
BEGIN
  IF NOT public.rec_comm_actor_ok() THEN RAISE EXCEPTION 'not_authorised'; END IF;

  v_request_id := p_request_id;
  IF v_request_id IS NULL AND p_provider_message_id IS NOT NULL THEN
    SELECT request_id INTO v_request_id FROM public.rec_comm_dispatch_attempts
     WHERE provider_message_id = p_provider_message_id ORDER BY created_at DESC LIMIT 1;
  END IF;

  INSERT INTO public.rec_comm_provider_events (
    request_id, provider, provider_message_id, provider_event_id, event_type, occurred_at, payload)
  VALUES (v_request_id, p_provider, p_provider_message_id, p_provider_event_id, p_event_type,
          COALESCE(p_occurred_at, now()), COALESCE(p_payload, '{}'::jsonb))
  ON CONFLICT (provider, provider_event_id) DO NOTHING
  RETURNING id INTO v_inserted;

  IF v_inserted IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'request_id', v_request_id);
  END IF;

  IF v_request_id IS NOT NULL THEN
    v_state := CASE p_event_type
      WHEN 'delivered' THEN 'delivered'
      WHEN 'bounced' THEN 'failed'
      WHEN 'failed' THEN 'failed'
      WHEN 'complaint' THEN 'failed'
      WHEN 'suppressed' THEN 'failed'
      ELSE NULL END;
    IF v_state IS NOT NULL THEN
      UPDATE public.rec_comm_requests
         SET state = v_state,
             delivered_at = CASE WHEN v_state = 'delivered' THEN COALESCE(p_occurred_at, now()) ELSE delivered_at END,
             failed_at = CASE WHEN v_state = 'failed' THEN COALESCE(p_occurred_at, now()) ELSE failed_at END,
             updated_at = now()
       WHERE id = v_request_id AND state NOT IN ('superseded','cancelled','archived');
    END IF;
    INSERT INTO public.rec_audit_events (action, object_type, object_id, new_state, context)
    VALUES ('comm_provider_event', 'rec_comm_request', v_request_id,
            jsonb_build_object('state', COALESCE(v_state, p_event_type)),
            jsonb_build_object('provider', p_provider, 'event_type', p_event_type,
                               'provider_event_id', p_provider_event_id));
  END IF;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'request_id', v_request_id,
                            'state', v_state);
END $$;

-- Issue a single-use candidate action token bound to the communication.
CREATE OR REPLACE FUNCTION public.rec_comm_issue_action_token(
  p_request_id uuid, p_token_hash text, p_expires_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_interview uuid;
BEGIN
  IF NOT public.rec_comm_actor_ok() THEN RAISE EXCEPTION 'not_authorised'; END IF;
  SELECT interview_id INTO v_interview FROM public.rec_comm_requests WHERE id = p_request_id;
  INSERT INTO public.rec_comm_candidate_actions (request_id, interview_id, token_hash, expires_at)
  VALUES (p_request_id, v_interview, p_token_hash, p_expires_at)
  ON CONFLICT (token_hash) DO UPDATE SET expires_at = EXCLUDED.expires_at
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Candidate confirmation / reschedule request. Writes the authoritative
-- interview record — the letter is never the source of truth.
CREATE OR REPLACE FUNCTION public.rec_comm_candidate_respond(
  p_token_hash text, p_action text, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_action public.rec_comm_candidate_actions;
BEGIN
  IF NOT public.rec_comm_actor_ok() THEN RAISE EXCEPTION 'not_authorised'; END IF;
  IF p_action NOT IN ('confirmed','reschedule_requested','declined') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;

  SELECT * INTO v_action FROM public.rec_comm_candidate_actions
   WHERE token_hash = p_token_hash FOR UPDATE;
  IF v_action.id IS NULL THEN RAISE EXCEPTION 'token_not_found'; END IF;
  IF v_action.expires_at < now() THEN RAISE EXCEPTION 'token_expired'; END IF;
  IF v_action.responded_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'action', v_action.action);
  END IF;

  UPDATE public.rec_comm_candidate_actions
     SET action = p_action, note = left(COALESCE(p_note, ''), 500), responded_at = now()
   WHERE id = v_action.id;

  IF v_action.interview_id IS NOT NULL THEN
    UPDATE public.rec_interviews
       SET candidate_response = p_action, candidate_responded_at = now(),
           candidate_response_note = left(COALESCE(p_note, ''), 500), updated_at = now()
     WHERE id = v_action.interview_id;
  END IF;

  INSERT INTO public.rec_audit_events (action, object_type, object_id, new_state, context, source)
  VALUES ('comm_candidate_response', 'rec_comm_request', v_action.request_id,
          jsonb_build_object('candidate_action', p_action),
          jsonb_build_object('interview_id', v_action.interview_id), 'candidate_portal');

  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'action', p_action,
                            'interview_id', v_action.interview_id);
END $$;

-- Supersede an issued communication (reschedule / correction). The original
-- record and document remain immutable and historically visible.
CREATE OR REPLACE FUNCTION public.rec_comm_supersede(
  p_request_id uuid, p_replacement_id uuid, p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req public.rec_comm_requests;
BEGIN
  IF NOT public.rec_comm_actor_ok() THEN RAISE EXCEPTION 'not_authorised'; END IF;
  IF COALESCE(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO v_req FROM public.rec_comm_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF v_req.state IN ('superseded','cancelled','archived') THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'state', v_req.state);
  END IF;

  UPDATE public.rec_comm_requests
     SET state = 'superseded', superseded_by_id = p_replacement_id,
         state_reason = p_reason, updated_at = now()
   WHERE id = p_request_id;
  IF p_replacement_id IS NOT NULL THEN
    UPDATE public.rec_comm_requests SET supersedes_id = p_request_id WHERE id = p_replacement_id;
  END IF;

  INSERT INTO public.rec_audit_events (action, object_type, object_id, previous_state, new_state, context)
  VALUES ('comm_superseded', 'rec_comm_request', p_request_id,
          jsonb_build_object('state', v_req.state), jsonb_build_object('state', 'superseded'),
          jsonb_build_object('reason', p_reason, 'replacement', p_replacement_id));

  RETURN jsonb_build_object('ok', true, 'state', 'superseded');
END $$;

CREATE OR REPLACE FUNCTION public.rec_comm_cancel(p_request_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req public.rec_comm_requests;
BEGIN
  IF NOT public.rec_is_recruiter() THEN RAISE EXCEPTION 'not_authorised'; END IF;
  IF COALESCE(trim(p_reason), '') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO v_req FROM public.rec_comm_requests WHERE id = p_request_id FOR UPDATE;
  IF v_req.id IS NULL THEN RAISE EXCEPTION 'request_not_found'; END IF;
  IF v_req.state IN ('provider_accepted','delivered') THEN
    RAISE EXCEPTION 'already_dispatched: supersede this communication instead of cancelling it';
  END IF;
  UPDATE public.rec_comm_requests
     SET state = 'cancelled', cancelled_at = now(), state_reason = p_reason, updated_at = now()
   WHERE id = p_request_id;
  INSERT INTO public.rec_audit_events (action, object_type, object_id, previous_state, new_state, context)
  VALUES ('comm_cancelled', 'rec_comm_request', p_request_id,
          jsonb_build_object('state', v_req.state), jsonb_build_object('state', 'cancelled'),
          jsonb_build_object('reason', p_reason));
  RETURN jsonb_build_object('ok', true, 'state', 'cancelled');
END $$;

-- Reconciliation: find communications whose state disagrees with their
-- documents, attempts and provider events; repair only safe cases and record
-- every finding. Never silently repairs a delivery claim.
CREATE OR REPLACE FUNCTION public.rec_comm_reconcile(p_stale_minutes integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run uuid; v_scanned integer := 0; v_findings integer := 0; v_repaired integer := 0;
  r record;
BEGIN
  IF NOT public.rec_comm_actor_ok() THEN RAISE EXCEPTION 'not_authorised'; END IF;
  INSERT INTO public.rec_comm_reconciliation_runs DEFAULT VALUES RETURNING id INTO v_run;

  FOR r IN
    SELECT q.*, d.id AS document_id,
           (SELECT count(*) FROM public.rec_comm_provider_events e
             WHERE e.request_id = q.id AND e.event_type = 'delivered') AS delivered_events,
           (SELECT provider_message_id FROM public.rec_comm_dispatch_attempts a
             WHERE a.request_id = q.id AND a.outcome = 'provider_accepted'
             ORDER BY a.created_at DESC LIMIT 1) AS accepted_message_id
      FROM public.rec_comm_requests q
      LEFT JOIN public.rec_comm_documents d ON d.request_id = q.id
     WHERE q.state NOT IN ('delivered','cancelled','superseded','archived')
  LOOP
    v_scanned := v_scanned + 1;

    IF r.state = 'generating' AND r.document_id IS NULL
       AND r.claimed_at < now() - make_interval(mins => p_stale_minutes) THEN
      UPDATE public.rec_comm_requests SET state = 'approved', claimed_at = NULL,
             state_reason = 'reclaimed_after_stalled_generation', updated_at = now()
       WHERE id = r.id;
      INSERT INTO public.rec_comm_reconciliation_findings (run_id, request_id, finding_code, severity, observed_state, action_taken)
      VALUES (v_run, r.id, 'generation_stalled', 'warning', r.state, 'returned_to_approved');
      v_findings := v_findings + 1; v_repaired := v_repaired + 1;

    ELSIF r.state IN ('generating','approved') AND r.document_id IS NOT NULL THEN
      UPDATE public.rec_comm_requests SET state = 'queued', queued_at = COALESCE(queued_at, now()), updated_at = now()
       WHERE id = r.id;
      INSERT INTO public.rec_comm_reconciliation_findings (run_id, request_id, finding_code, severity, observed_state, action_taken)
      VALUES (v_run, r.id, 'document_without_queue', 'warning', r.state, 'queued');
      v_findings := v_findings + 1; v_repaired := v_repaired + 1;

    ELSIF r.delivered_events > 0 AND r.state <> 'delivered' THEN
      UPDATE public.rec_comm_requests SET state = 'delivered', delivered_at = COALESCE(delivered_at, now()), updated_at = now()
       WHERE id = r.id;
      INSERT INTO public.rec_comm_reconciliation_findings (run_id, request_id, finding_code, severity, observed_state, action_taken)
      VALUES (v_run, r.id, 'delivery_event_unapplied', 'warning', r.state, 'marked_delivered');
      v_findings := v_findings + 1; v_repaired := v_repaired + 1;

    ELSIF r.state = 'provider_accepted' AND r.accepted_message_id IS NOT NULL
          AND r.provider_accepted_at < now() - make_interval(mins => p_stale_minutes * 3) THEN
      INSERT INTO public.rec_comm_reconciliation_findings (run_id, request_id, finding_code, severity, observed_state, action_taken, detail)
      VALUES (v_run, r.id, 'delivery_callback_missing', 'attention', r.state, 'reported_only',
              jsonb_build_object('provider_message_id', r.accepted_message_id));
      v_findings := v_findings + 1;

    ELSIF r.state = 'retry_pending' AND r.attempts >= 5 THEN
      UPDATE public.rec_comm_requests SET state = 'failed', failed_at = now(), updated_at = now() WHERE id = r.id;
      INSERT INTO public.rec_comm_reconciliation_findings (run_id, request_id, finding_code, severity, observed_state, action_taken)
      VALUES (v_run, r.id, 'dispatch_exhausted', 'critical', r.state, 'marked_failed');
      v_findings := v_findings + 1; v_repaired := v_repaired + 1;
    END IF;
  END LOOP;

  UPDATE public.rec_comm_reconciliation_runs
     SET finished_at = now(), scanned = v_scanned, findings = v_findings, repaired = v_repaired
   WHERE id = v_run;

  RETURN jsonb_build_object('run_id', v_run, 'scanned', v_scanned,
                            'findings', v_findings, 'repaired', v_repaired);
END $$;

-- Public document verification: proves issuance without exposing candidate PII.
CREATE OR REPLACE FUNCTION public.rec_comm_verify_document(p_document_ref text, p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_doc record;
BEGIN
  SELECT d.document_ref, d.issued_at, d.classification, d.sha256, r.comm_type, r.state
    INTO v_doc
    FROM public.rec_comm_documents d
    JOIN public.rec_comm_requests r ON r.id = d.request_id
   WHERE upper(d.document_ref) = upper(trim(p_document_ref))
     AND upper(d.verification_code) = upper(trim(p_code));
  IF v_doc.document_ref IS NULL THEN
    RETURN jsonb_build_object('verified', false);
  END IF;
  RETURN jsonb_build_object('verified', true, 'document_ref', v_doc.document_ref,
                            'issued_at', v_doc.issued_at, 'document_type', v_doc.comm_type,
                            'classification', v_doc.classification,
                            'integrity_hash', v_doc.sha256, 'issuer', 'Yalla Mobility Recruitment 360',
                            'lifecycle_state', v_doc.state);
END $$;

REVOKE ALL ON FUNCTION public.rec_comm_request_create(text,text,uuid,uuid,uuid,uuid,text) FROM anon;
REVOKE ALL ON FUNCTION public.rec_comm_candidate_respond(text,text,text) FROM anon;
REVOKE ALL ON FUNCTION public.rec_comm_approve(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION public.rec_comm_cancel(uuid,text) FROM anon;
REVOKE ALL ON FUNCTION public.rec_comm_supersede(uuid,uuid,text) FROM anon;
REVOKE ALL ON FUNCTION public.rec_comm_reconcile(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.rec_comm_verify_document(text,text) TO anon, authenticated, service_role;