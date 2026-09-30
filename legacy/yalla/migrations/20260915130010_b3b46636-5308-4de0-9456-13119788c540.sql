CREATE OR REPLACE FUNCTION public.corp_billing_period_current(_corporate_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_start date := date_trunc('month', now())::date;
  v_end date := (date_trunc('month', now()) + interval '1 month - 1 day')::date;
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.corporate_billing_periods
   WHERE corporate_id = _corporate_id AND period_start = v_start;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.corporate_billing_periods (corporate_id, period_start, period_end, status)
  VALUES (_corporate_id, v_start, v_end, 'OPEN')
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.corporate_billing_periods
     WHERE corporate_id = _corporate_id AND period_start = v_start;
  END IF;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.corp_billing_period_current(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.corp_billing_period_current(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.corp_payment_intent_open(
  _corporate_id uuid,
  _amount_cents bigint,
  _requested_mode text,
  _booking_id uuid DEFAULT NULL,
  _trip_request_id uuid DEFAULT NULL,
  _approval_id uuid DEFAULT NULL,
  _idempotency_key text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_key text;
  v_existing uuid;
  v_intent public.ride_payment_intents;
  v_decision jsonb;
  v_decision_code text;
  v_ref text;
  v_reservation jsonb;
  v_receivable uuid;
  v_invoice uuid;
  v_period uuid;
  v_terms int;
  v_channel uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  IF NOT public.is_corporate_member(v_uid, _corporate_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;
  IF _amount_cents IS NULL OR _amount_cents <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  v_key := COALESCE(NULLIF(trim(_idempotency_key), ''),
                    _corporate_id::text || ':' || COALESCE(_booking_id::text, _trip_request_id::text, gen_random_uuid()::text));

  SELECT id INTO v_existing FROM public.ride_payment_intents
   WHERE reference = 'YP-' || upper(substr(md5(v_key), 1, 10));
  IF v_existing IS NOT NULL THEN
    SELECT * INTO v_intent FROM public.ride_payment_intents WHERE id = v_existing;
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'intent_id', v_intent.id,
      'reference', v_intent.reference, 'state', v_intent.state, 'mode', v_intent.mode);
  END IF;

  v_decision := public.corp_payment_decide(_corporate_id, _amount_cents, _requested_mode, NULL);
  v_decision_code := v_decision->>'decision';
  v_ref := 'YP-' || upper(substr(md5(v_key), 1, 10));

  IF v_decision_code = 'ALLOW_GUARANTEED_CREDIT' THEN
    v_reservation := public.corp_credit_reserve(_corporate_id, _amount_cents, v_key, _booking_id, _trip_request_id, NULL);
    IF COALESCE((v_reservation->>'ok')::boolean, false) IS NOT TRUE THEN
      RETURN jsonb_build_object('ok', false, 'error', 'credit_reservation_refused',
        'detail', v_reservation, 'decision', v_decision_code);
    END IF;

    INSERT INTO public.ride_payment_intents
      (reference, corporate_id, booking_id, trip_request_id, approval_id, amount_cents, mode, state,
       decision, decision_reasons, reservation_id, created_by)
    VALUES (v_ref, _corporate_id, _booking_id, _trip_request_id, _approval_id, _amount_cents, 'CREDIT',
            'CREDIT_AUTHORIZED', v_decision_code,
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_decision->'reason_codes')), '{}'),
            (v_reservation->>'reservation_id')::uuid, v_uid)
    RETURNING * INTO v_intent;

    SELECT COALESCE(payment_terms_days, 30) INTO v_terms FROM public.corporate_accounts WHERE id = _corporate_id;
    v_period := public.corp_billing_period_current(_corporate_id);

    INSERT INTO public.ride_receivables
      (corporate_id, intent_id, amount_cents, due_date, reservation_id, state)
    VALUES (_corporate_id, v_intent.id, _amount_cents, (now() + make_interval(days => COALESCE(v_terms, 30)))::date,
            v_intent.reservation_id, 'OPEN')
    RETURNING id INTO v_receivable;

    INSERT INTO public.corporate_invoices
      (corporate_id, period_id, invoice_number, status, subtotal_cents, tax_total_cents, total_cents, balance_cents,
       currency, issued_at, due_at, metadata)
    VALUES (_corporate_id, v_period,
            'YINV-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(v_ref), 1, 6)),
            'ISSUED'::public.corporate_invoice_status, _amount_cents, 0, _amount_cents, _amount_cents, 'KES', now(),
            now() + make_interval(days => COALESCE(v_terms, 30)),
            jsonb_build_object('source', 'ride_credit', 'intent_reference', v_ref))
    RETURNING id INTO v_invoice;

    UPDATE public.ride_receivables SET invoice_id = v_invoice, state = 'INVOICED', updated_at = now()
     WHERE id = v_receivable;
    UPDATE public.ride_payment_intents SET receivable_id = v_receivable, invoice_id = v_invoice, updated_at = now()
     WHERE id = v_intent.id;

    PERFORM public.fin_ledger_post('BOOKING', jsonb_build_array(
        jsonb_build_object('account_code','1100','account_name','Trade receivables','debit_cents',_amount_cents),
        jsonb_build_object('account_code','4000','account_name','Trip revenue','credit_cents',_amount_cents)
      ), _corporate_id, v_intent.id, v_ref, 'Trip authorised on guarantee-backed credit', v_intent.correlation_id);

    PERFORM public.fin_ledger_post('CREDIT_UTILISATION', jsonb_build_array(
        jsonb_build_object('account_code','2900','account_name','Credit facility utilisation','debit_cents',_amount_cents),
        jsonb_build_object('account_code','2901','account_name','Credit facility available','credit_cents',_amount_cents)
      ), _corporate_id, v_intent.id, v_ref, 'Guarantee-backed credit reserved', v_intent.correlation_id);

    RETURN jsonb_build_object('ok', true, 'intent_id', v_intent.id, 'reference', v_ref, 'mode', 'CREDIT',
      'state', 'CREDIT_AUTHORIZED', 'decision', v_decision_code, 'receivable_id', v_receivable,
      'invoice_id', v_invoice, 'reason_codes', v_decision->'reason_codes');
  END IF;

  SELECT id INTO v_channel FROM public.yalla_payment_channels
   WHERE is_active AND channel_type = 'MPESA_PAYBILL' ORDER BY created_at LIMIT 1;

  INSERT INTO public.ride_payment_intents
    (reference, corporate_id, booking_id, trip_request_id, approval_id, amount_cents, mode, state,
     channel_id, decision, decision_reasons, created_by)
  VALUES (v_ref, _corporate_id, _booking_id, _trip_request_id, _approval_id, _amount_cents, 'CASH',
          'AWAITING_PAYMENT', v_channel, v_decision_code,
          COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_decision->'reason_codes')), '{}'), v_uid)
  RETURNING * INTO v_intent;

  PERFORM public.fin_ledger_post('BOOKING', jsonb_build_array(
      jsonb_build_object('account_code','1100','account_name','Trade receivables','debit_cents',_amount_cents),
      jsonb_build_object('account_code','4000','account_name','Trip revenue','credit_cents',_amount_cents)
    ), _corporate_id, v_intent.id, v_ref, 'Trip booked, awaiting verified payment', v_intent.correlation_id);

  RETURN jsonb_build_object('ok', true, 'intent_id', v_intent.id, 'reference', v_ref, 'mode', 'CASH',
    'state', 'AWAITING_PAYMENT', 'decision', v_decision_code, 'reason_codes', v_decision->'reason_codes',
    'credit_refused', (_requested_mode = 'CREDIT'));
END $$;

REVOKE ALL ON FUNCTION public.corp_payment_intent_open(uuid, bigint, text, uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corp_payment_intent_open(uuid, bigint, text, uuid, uuid, uuid, text) TO authenticated, service_role;