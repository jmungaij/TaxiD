
-- ================================================================
-- Phase 5 — Payment Digital Twin + Critical Callback Incident RPCs
-- ================================================================

CREATE OR REPLACE FUNCTION public.payment_digital_twin(p_identifier text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt         public.payment_attempts%ROWTYPE;
  v_correlation     text;
  v_checkout        text;
  v_merchant        text;
  v_events          jsonb;
  v_traces          jsonb;
  v_transitions     jsonb;
  v_stk             jsonb;
  v_callbacks       jsonb;
  v_wallet          jsonb;
  v_certification   jsonb;
BEGIN
  -- authz: only privileged roles
  IF NOT (public.has_role(auth.uid(), 'admin')
       OR public.has_role(auth.uid(), 'super_admin')
       OR public.has_role(auth.uid(), 'finance_admin')) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_identifier IS NULL OR length(trim(p_identifier)) = 0 THEN
    RETURN jsonb_build_object('found', false, 'reason', 'empty_identifier');
  END IF;

  -- Try attempt lookup by every accepted key
  SELECT * INTO v_attempt FROM public.payment_attempts
   WHERE correlation_id = p_identifier
      OR checkout_request_id = p_identifier
      OR merchant_request_id = p_identifier
      OR request_id = p_identifier
      OR idempotency_key = p_identifier
      OR mpesa_receipt_number = p_identifier
      OR id::text = p_identifier
   ORDER BY created_at DESC
   LIMIT 1;

  v_correlation := COALESCE(v_attempt.correlation_id, p_identifier);
  v_checkout    := v_attempt.checkout_request_id;
  v_merchant    := v_attempt.merchant_request_id;

  SELECT COALESCE(jsonb_agg(to_jsonb(e) ORDER BY e.occurred_at), '[]'::jsonb)
    INTO v_events
    FROM public.payment_journey_events e
   WHERE e.correlation_id = v_correlation;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.occurred_at), '[]'::jsonb)
    INTO v_traces
    FROM public.payment_step_traces t
   WHERE t.correlation_id = v_correlation;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.occurred_at), '[]'::jsonb)
    INTO v_transitions
    FROM public.payment_state_transitions s
   WHERE s.correlation_id = v_correlation
      OR (v_attempt.id IS NOT NULL AND s.payment_attempt_id = v_attempt.id);

  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.created_at), '[]'::jsonb)
    INTO v_stk
    FROM public.mpesa_stk_attempts a
   WHERE a.correlation_id = v_correlation
      OR (v_attempt.id IS NOT NULL AND a.payment_attempt_id = v_attempt.id)
      OR (v_checkout IS NOT NULL AND a.checkout_request_id = v_checkout)
      OR (v_merchant IS NOT NULL AND a.merchant_request_id = v_merchant);

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'id', c.id,
             'checkout_request_id', c.checkout_request_id,
             'merchant_request_id', c.merchant_request_id,
             'received_at', c.received_at,
             'verified', c.verified,
             'verification_notes', c.verification_notes,
             'ip_address', c.ip_address::text,
             'headers', c.headers,
             'payload', c.payload
           ) ORDER BY c.received_at
         ), '[]'::jsonb)
    INTO v_callbacks
    FROM public.mpesa_callback_logs c
   WHERE (v_checkout IS NOT NULL AND c.checkout_request_id = v_checkout)
      OR (v_merchant IS NOT NULL AND c.merchant_request_id = v_merchant)
      OR (v_attempt.id IS NOT NULL AND c.payment_attempt_id = v_attempt.id);

  SELECT COALESCE(jsonb_agg(to_jsonb(w) ORDER BY w.created_at), '[]'::jsonb)
    INTO v_wallet
    FROM public.wallet_transactions w
   WHERE (v_attempt.id IS NOT NULL AND (w.reference = v_attempt.id::text OR w.metadata ? 'payment_attempt_id' AND w.metadata->>'payment_attempt_id' = v_attempt.id::text))
      OR (v_attempt.mpesa_receipt_number IS NOT NULL AND w.mpesa_receipt = v_attempt.mpesa_receipt_number);

  SELECT to_jsonb(r) INTO v_certification
    FROM public.payment_certification_runs r
   ORDER BY r.started_at DESC
   LIMIT 1;

  RETURN jsonb_build_object(
    'found', v_attempt.id IS NOT NULL OR jsonb_array_length(v_events) > 0,
    'identifier', p_identifier,
    'resolved', jsonb_build_object(
      'correlation_id', v_correlation,
      'checkout_request_id', v_checkout,
      'merchant_request_id', v_merchant,
      'payment_attempt_id', v_attempt.id
    ),
    'attempt', CASE WHEN v_attempt.id IS NULL THEN NULL ELSE to_jsonb(v_attempt) END,
    'events', v_events,
    'traces', v_traces,
    'state_transitions', v_transitions,
    'stk_attempts', v_stk,
    'callbacks', v_callbacks,
    'wallet_activity', v_wallet,
    'latest_certification', v_certification
  );
END;
$$;

REVOKE ALL ON FUNCTION public.payment_digital_twin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_digital_twin(text) TO authenticated, service_role;

-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_critical_callback_incident(p_window_minutes int DEFAULT 15)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since        timestamptz := now() - make_interval(mins => p_window_minutes);
  v_stk_total    int;
  v_stk_accepted int;
  v_callbacks    int;
  v_samples      jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')
       OR public.has_role(auth.uid(), 'super_admin')
       OR public.has_role(auth.uid(), 'finance_admin')) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT count(*) INTO v_stk_total
    FROM public.mpesa_stk_attempts
   WHERE created_at >= v_since;

  SELECT count(*) INTO v_stk_accepted
    FROM public.mpesa_stk_attempts
   WHERE created_at >= v_since
     AND checkout_request_id IS NOT NULL;

  SELECT count(*) INTO v_callbacks
    FROM public.mpesa_callback_logs
   WHERE received_at >= v_since;

  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v_samples FROM (
    SELECT a.correlation_id,
           a.checkout_request_id,
           a.merchant_request_id,
           a.payment_attempt_id,
           a.phone_masked,
           a.amount_cents,
           a.created_at
      FROM public.mpesa_stk_attempts a
     WHERE a.created_at >= v_since
       AND a.checkout_request_id IS NOT NULL
     ORDER BY a.created_at DESC
     LIMIT 10
  ) x;

  RETURN jsonb_build_object(
    'window_minutes', p_window_minutes,
    'since', v_since,
    'stk_total', v_stk_total,
    'stk_accepted', v_stk_accepted,
    'callbacks', v_callbacks,
    'detected', v_stk_accepted > 0 AND v_callbacks = 0,
    'samples', v_samples
  );
END;
$$;

REVOKE ALL ON FUNCTION public.payment_critical_callback_incident(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_critical_callback_incident(int) TO authenticated, service_role;
