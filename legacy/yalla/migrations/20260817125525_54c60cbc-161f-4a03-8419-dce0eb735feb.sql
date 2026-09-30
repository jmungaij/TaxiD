-- ============ Contact recovery spine ============
CREATE TABLE IF NOT EXISTS public.rec_contact_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  vacancy_id uuid REFERENCES public.rec_vacancies(id) ON DELETE SET NULL,
  requested_fields text[] NOT NULL DEFAULT ARRAY['email','phone']::text[],
  channel text NOT NULL DEFAULT 'email',
  status text NOT NULL DEFAULT 'pending',
  attempt_no integer NOT NULL DEFAULT 1,
  notification_job_id uuid,
  recipient text,
  message_note text,
  response_email text,
  response_phone text,
  response_notes text,
  responder_kind text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  requested_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_contact_req_channel_chk CHECK (channel = ANY (ARRAY['email','sms','phone_call','whatsapp','manual'])),
  CONSTRAINT rec_contact_req_status_chk CHECK (status = ANY (ARRAY['pending','awaiting_manual','sent','responded','no_response','cancelled'])),
  CONSTRAINT rec_contact_req_responder_chk CHECK (responder_kind IS NULL OR responder_kind = ANY (ARRAY['candidate','recruiter','referrer','system']))
);

CREATE INDEX IF NOT EXISTS idx_rec_contact_requests_candidate
  ON public.rec_contact_requests (candidate_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_rec_contact_requests_app
  ON public.rec_contact_requests (application_id, status);

GRANT SELECT, INSERT, UPDATE ON public.rec_contact_requests TO authenticated;
GRANT ALL ON public.rec_contact_requests TO service_role;

ALTER TABLE public.rec_contact_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rec staff read contact requests" ON public.rec_contact_requests;
CREATE POLICY "rec staff read contact requests" ON public.rec_contact_requests
  FOR SELECT TO authenticated USING (public.rec_can_read());

DROP POLICY IF EXISTS "rec staff insert contact requests" ON public.rec_contact_requests;
CREATE POLICY "rec staff insert contact requests" ON public.rec_contact_requests
  FOR INSERT TO authenticated WITH CHECK (public.rec_can_write());

DROP POLICY IF EXISTS "rec staff update contact requests" ON public.rec_contact_requests;
CREATE POLICY "rec staff update contact requests" ON public.rec_contact_requests
  FOR UPDATE TO authenticated USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());

DROP TRIGGER IF EXISTS trg_rec_contact_requests_touch ON public.rec_contact_requests;
CREATE TRIGGER trg_rec_contact_requests_touch BEFORE UPDATE ON public.rec_contact_requests
  FOR EACH ROW EXECUTE FUNCTION public.rec_touch_updated_at();

-- ============ Raise a request for missing details ============
CREATE OR REPLACE FUNCTION public.rec_request_candidate_contact(
  p_application_id uuid,
  p_fields text[] DEFAULT ARRAY['email','phone']::text[],
  p_channel text DEFAULT 'auto',
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_app record;
  v_cand record;
  v_channel text;
  v_recipient text;
  v_attempt int;
  v_req uuid;
  v_job uuid;
  v_status text;
  v_subject text;
  v_body text;
BEGIN
  IF NOT public.rec_can_write() THEN
    RAISE EXCEPTION 'not authorized to request candidate details';
  END IF;

  SELECT a.*, v.title AS vacancy_title INTO v_app
    FROM public.rec_applications a
    LEFT JOIN public.rec_vacancies v ON v.id = a.vacancy_id
   WHERE a.id = p_application_id;
  IF v_app IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;

  SELECT * INTO v_cand FROM public.rec_candidates WHERE id = v_app.candidate_id;

  -- Pick a reachable channel: honour an explicit request, otherwise infer.
  v_channel := CASE
    WHEN p_channel = 'auto' AND v_cand.email IS NOT NULL THEN 'email'
    WHEN p_channel = 'auto' AND v_cand.phone IS NOT NULL THEN 'sms'
    WHEN p_channel = 'auto' THEN 'manual'
    ELSE p_channel END;
  v_recipient := CASE v_channel WHEN 'email' THEN v_cand.email
                                WHEN 'sms' THEN v_cand.phone
                                WHEN 'whatsapp' THEN v_cand.phone
                                WHEN 'phone_call' THEN v_cand.phone
                                ELSE NULL END;

  SELECT coalesce(max(attempt_no), 0) + 1 INTO v_attempt
    FROM public.rec_contact_requests WHERE candidate_id = v_cand.id;

  v_status := CASE WHEN v_recipient IS NULL THEN 'awaiting_manual' ELSE 'pending' END;

  INSERT INTO public.rec_contact_requests (
    candidate_id, application_id, vacancy_id, requested_fields, channel, status,
    attempt_no, recipient, message_note)
  VALUES (v_cand.id, v_app.id, v_app.vacancy_id, coalesce(p_fields, ARRAY['email','phone']::text[]),
          v_channel, v_status, v_attempt, v_recipient, p_notes)
  RETURNING id INTO v_req;

  IF v_recipient IS NOT NULL AND v_channel IN ('email','sms') THEN
    v_subject := format('Yalla Mobility · %s application — we need your contact details',
                        coalesce(v_app.vacancy_title, 'your'));
    v_body := format(
      'Hello %s,'||E'\n\n'||
      'Thank you for applying for the %s role at Yalla Mobility. To progress your application we still need: %s.'||E'\n\n'||
      'Please reply to this message with the missing details.'||E'\n\n'||
      'Yalla Mobility Talent Acquisition · support@yalla.africa · +254 142 970050',
      v_cand.full_name, coalesce(v_app.vacancy_title, 'advertised'),
      array_to_string(coalesce(p_fields, ARRAY['email','phone']::text[]), ' and '));

    INSERT INTO public.rec_notification_jobs (
      application_id, candidate_id, transition_key, channel, template_key,
      recipient, subject, body, payload, status)
    VALUES (v_app.id, v_cand.id, 'contact_details_request:' || v_attempt, v_channel,
            'candidate_contact_details_request', v_recipient, v_subject, v_body,
            jsonb_build_object('contact_request_id', v_req, 'fields', coalesce(p_fields, ARRAY['email','phone']::text[])),
            'queued')
    ON CONFLICT (application_id, transition_key, channel) DO NOTHING
    RETURNING id INTO v_job;

    UPDATE public.rec_contact_requests
       SET notification_job_id = v_job, status = 'sent'
     WHERE id = v_req;
    v_status := 'sent';
  END IF;

  INSERT INTO public.rec_audit_events (action, object_type, object_id, new_state, context)
  VALUES ('candidate.contact_details_requested', 'rec_candidate', v_cand.id,
          jsonb_build_object('request_id', v_req, 'channel', v_channel, 'status', v_status,
                             'fields', coalesce(p_fields, ARRAY['email','phone']::text[])),
          jsonb_build_object('application_id', v_app.id, 'attempt_no', v_attempt, 'notes', p_notes));

  RETURN jsonb_build_object('request_id', v_req, 'channel', v_channel, 'status', v_status,
                            'recipient', v_recipient, 'notification_job_id', v_job, 'attempt_no', v_attempt);
END;
$$;

-- ============ Manual contact capture ============
CREATE OR REPLACE FUNCTION public.rec_record_candidate_contact(
  p_candidate_id uuid,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_source text DEFAULT 'manual_collection',
  p_notes text DEFAULT NULL,
  p_request_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_before record;
  v_email text := nullif(btrim(p_email), '');
  v_phone text := nullif(btrim(p_phone), '');
BEGIN
  IF NOT public.rec_can_write() THEN
    RAISE EXCEPTION 'not authorized to record candidate contact details';
  END IF;
  IF v_email IS NULL AND v_phone IS NULL THEN
    RAISE EXCEPTION 'supply at least an email address or a telephone number';
  END IF;
  IF v_email IS NOT NULL AND v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'invalid email address';
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^[0-9+][0-9 +()-]{6,}$' THEN
    RAISE EXCEPTION 'invalid telephone number';
  END IF;

  SELECT * INTO v_before FROM public.rec_candidates WHERE id = p_candidate_id;
  IF v_before IS NULL THEN RAISE EXCEPTION 'candidate not found'; END IF;

  UPDATE public.rec_candidates
     SET email = coalesce(v_email, email),
         phone = coalesce(v_phone, phone),
         last_contact_at = now()
   WHERE id = p_candidate_id;

  IF p_request_id IS NOT NULL THEN
    UPDATE public.rec_contact_requests
       SET status = 'responded', responded_at = now(), responder_kind = 'recruiter',
           response_email = v_email, response_phone = v_phone, response_notes = p_notes
     WHERE id = p_request_id;
  END IF;

  INSERT INTO public.rec_audit_events (action, object_type, object_id, previous_state, new_state, context)
  VALUES ('candidate.contact_details_recorded', 'rec_candidate', p_candidate_id,
          jsonb_build_object('email', v_before.email, 'phone', v_before.phone),
          jsonb_build_object('email', coalesce(v_email, v_before.email), 'phone', coalesce(v_phone, v_before.phone)),
          jsonb_build_object('source', p_source, 'notes', p_notes, 'request_id', p_request_id));

  RETURN jsonb_build_object('candidate_id', p_candidate_id,
                            'email', coalesce(v_email, v_before.email),
                            'phone', coalesce(v_phone, v_before.phone),
                            'request_id', p_request_id);
END;
$$;

-- ============ Log a candidate response ============
CREATE OR REPLACE FUNCTION public.rec_log_contact_response(
  p_request_id uuid,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_responder_kind text DEFAULT 'candidate',
  p_no_response boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_req record;
BEGIN
  IF NOT public.rec_can_write() THEN
    RAISE EXCEPTION 'not authorized to log contact responses';
  END IF;
  SELECT * INTO v_req FROM public.rec_contact_requests WHERE id = p_request_id;
  IF v_req IS NULL THEN RAISE EXCEPTION 'contact request not found'; END IF;

  IF p_no_response THEN
    UPDATE public.rec_contact_requests
       SET status = 'no_response', responded_at = now(), response_notes = p_notes
     WHERE id = p_request_id;
    INSERT INTO public.rec_audit_events (action, object_type, object_id, new_state, context)
    VALUES ('candidate.contact_request_unanswered', 'rec_candidate', v_req.candidate_id,
            jsonb_build_object('request_id', p_request_id, 'status', 'no_response'),
            jsonb_build_object('notes', p_notes, 'attempt_no', v_req.attempt_no));
    RETURN jsonb_build_object('request_id', p_request_id, 'status', 'no_response');
  END IF;

  PERFORM public.rec_record_candidate_contact(
    v_req.candidate_id, p_email, p_phone, 'candidate_response', p_notes, NULL);

  UPDATE public.rec_contact_requests
     SET status = 'responded', responded_at = now(),
         responder_kind = coalesce(p_responder_kind, 'candidate'),
         response_email = nullif(btrim(p_email), ''),
         response_phone = nullif(btrim(p_phone), ''),
         response_notes = p_notes
   WHERE id = p_request_id;

  INSERT INTO public.rec_audit_events (action, object_type, object_id, new_state, context)
  VALUES ('candidate.contact_request_answered', 'rec_candidate', v_req.candidate_id,
          jsonb_build_object('request_id', p_request_id, 'email', nullif(btrim(p_email),''), 'phone', nullif(btrim(p_phone),'')),
          jsonb_build_object('responder_kind', coalesce(p_responder_kind,'candidate'), 'notes', p_notes,
                             'attempt_no', v_req.attempt_no));

  RETURN jsonb_build_object('request_id', p_request_id, 'status', 'responded');
END;
$$;

-- ============ Candidate contact / audit timeline ============
CREATE OR REPLACE FUNCTION public.rec_candidate_contact_timeline(p_candidate_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF NOT public.rec_can_read() THEN
    RAISE EXCEPTION 'not authorized to read candidate audit trail';
  END IF;
  SELECT jsonb_build_object(
    'candidate', (SELECT jsonb_build_object('id', c.id, 'full_name', c.full_name, 'email', c.email,
                                            'phone', c.phone, 'last_contact_at', c.last_contact_at)
                    FROM public.rec_candidates c WHERE c.id = p_candidate_id),
    'requests', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.requested_at DESC)
                            FROM public.rec_contact_requests r WHERE r.candidate_id = p_candidate_id), '[]'::jsonb),
    'audit', coalesce((SELECT jsonb_agg(jsonb_build_object(
                                'id', e.id, 'action', e.action, 'created_at', e.created_at,
                                'previous_state', e.previous_state, 'new_state', e.new_state,
                                'context', e.context, 'source', e.source) ORDER BY e.created_at DESC)
                         FROM public.rec_audit_events e
                        WHERE e.object_type = 'rec_candidate' AND e.object_id = p_candidate_id), '[]'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END;
$$;

-- ============ Screening report: coverage + contact request state ============
CREATE OR REPLACE FUNCTION public.rec_screening_report(p_vacancy_id uuid, p_batch_id uuid DEFAULT NULL::uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_vac record;
  v_rows jsonb;
  v_criteria int;
BEGIN
  IF NOT public.rec_can_read() THEN
    RAISE EXCEPTION 'not authorized to read screening results';
  END IF;
  SELECT * INTO v_vac FROM public.rec_vacancies WHERE id = p_vacancy_id;
  IF v_vac IS NULL THEN RAISE EXCEPTION 'vacancy not found'; END IF;

  SELECT count(*) INTO v_criteria
    FROM public.rec_scorecard_criteria sc
    JOIN public.rec_scorecards s ON s.id = sc.scorecard_id
   WHERE s.vacancy_id = p_vacancy_id AND s.status = 'published';

  SELECT jsonb_agg(row_to_json(t)::jsonb ORDER BY t.rank)
    INTO v_rows
    FROM (
      SELECT
        row_number() OVER (ORDER BY COALESCE(e.weighted_score, a.ai_match_score, 0) DESC,
                                    a.applied_at ASC) AS rank,
        a.id AS application_id,
        a.application_no,
        a.candidate_id,
        c.full_name,
        c.email,
        c.phone,
        c.location,
        c.years_experience,
        COALESCE(e.weighted_score, a.ai_match_score) AS score,
        e.eligibility,
        e.recommendation,
        e.confidence AS evidence_confidence,
        e.gate_failures,
        e.missing_evidence,
        a.stage,
        a.status,
        a.rejection_reason,
        d.decision AS human_decision,
        d.reason_code AS human_decision_reason,
        d.decided_at AS human_decided_at,
        (SELECT count(*) FROM public.rec_evidence_adjudications ad WHERE ad.application_id = a.id)
          AS adjudications,
        (SELECT count(DISTINCT ad.attribute) FROM public.rec_evidence_adjudications ad WHERE ad.application_id = a.id)
          AS adjudicated_attributes,
        (SELECT count(*) FROM public.rec_evidence_facts f
          WHERE f.application_id = a.id AND f.superseded_at IS NULL) AS evidence_facts,
        (SELECT count(*) FROM public.rec_evidence_facts f
          WHERE f.application_id = a.id AND f.superseded_at IS NULL AND f.verified_at IS NOT NULL) AS verified_facts,
        (SELECT count(*) FROM public.rec_evidence_facts f
          WHERE f.application_id = a.id AND f.superseded_at IS NULL AND f.confidence < 0.6) AS weak_facts,
        v_criteria AS criteria_count,
        (SELECT count(*) FROM public.rec_contact_requests cr
          WHERE cr.candidate_id = a.candidate_id AND cr.status IN ('pending','awaiting_manual','sent'))
          AS open_contact_requests,
        (SELECT cr.status FROM public.rec_contact_requests cr
          WHERE cr.candidate_id = a.candidate_id
          ORDER BY cr.requested_at DESC LIMIT 1) AS contact_request_status,
        (SELECT string_agg(
                  format('%s: %s [%s%s, conf %s]', f.attribute,
                         COALESCE(f.value_text, f.value_numeric::text),
                         f.source_ref, COALESCE(' · ' || f.source_locator, ''),
                         round(f.confidence, 2)),
                  E'\n' ORDER BY f.confidence DESC)
           FROM public.rec_evidence_facts f
          WHERE f.application_id = a.id AND f.superseded_at IS NULL) AS evidence_citations
      FROM public.rec_applications a
      JOIN public.rec_candidates c ON c.id = a.candidate_id
      LEFT JOIN public.rec_application_evaluations e
             ON e.application_id = a.id AND e.is_current
      LEFT JOIN LATERAL (
        SELECT sd.decision, sd.reason_code, sd.decided_at
          FROM public.rec_selection_decisions sd
         WHERE sd.application_id = a.id
         ORDER BY sd.decided_at DESC LIMIT 1
      ) d ON true
     WHERE a.vacancy_id = p_vacancy_id
       AND (p_batch_id IS NULL OR a.migration_batch_id = p_batch_id)
    ) t;

  RETURN jsonb_build_object(
    'vacancy', jsonb_build_object('id', v_vac.id, 'title', v_vac.title, 'location', v_vac.location),
    'generated_at', now(),
    'batch_id', p_batch_id,
    'criteria_count', v_criteria,
    'rows', COALESCE(v_rows, '[]'::jsonb)
  );
END;
$function$;