CREATE OR REPLACE FUNCTION public._provider_wallet_post(
  _uid uuid, _type text, _amount bigint,
  _avail bigint, _held bigint, _reserved bigint,
  _reference text, _detail jsonb DEFAULT '{}'::jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_w public.provider_wallets;
BEGIN
  INSERT INTO public.provider_wallets (provider_user_id) VALUES (_uid)
  ON CONFLICT (provider_user_id) DO NOTHING;
  PERFORM 1 FROM public.provider_wallets WHERE provider_user_id = _uid FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.provider_wallet_ledger
              WHERE provider_user_id = _uid AND entry_type = _type AND reference = _reference) THEN
    RETURN false;
  END IF;
  UPDATE public.provider_wallets
     SET available_cents = available_cents + _avail,
         held_cents = held_cents + _held,
         reserved_cents = reserved_cents + _reserved,
         lifetime_earned_cents = lifetime_earned_cents + CASE WHEN _type = 'RELEASE' THEN _amount ELSE 0 END,
         lifetime_withdrawn_cents = lifetime_withdrawn_cents + CASE WHEN _type = 'WITHDRAWAL_PAID' THEN _amount ELSE 0 END,
         lifetime_fees_cents = lifetime_fees_cents + CASE WHEN _type = 'WITHDRAWAL_FEE' THEN _amount ELSE 0 END
   WHERE provider_user_id = _uid
  RETURNING * INTO v_w;
  INSERT INTO public.provider_wallet_ledger
    (provider_user_id, entry_type, amount_cents, available_delta, held_delta, reserved_delta,
     available_after, held_after, reserved_after, currency, reference, detail)
  VALUES (_uid, _type, _amount, _avail, _held, _reserved,
          v_w.available_cents, v_w.held_cents, v_w.reserved_cents, v_w.currency, _reference,
          coalesce(_detail, '{}'::jsonb));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.provider_settlement_run()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_set public.provider_settlement_settings;
  r record;
  v_accrued integer := 0; v_trip integer := 0; v_held integer := 0; v_credited integer := 0;
BEGIN
  SELECT * INTO v_set FROM public.provider_settlement_settings WHERE id;

  WITH ins AS (
    INSERT INTO public.provider_earnings
      (provider_user_id, booking_id, booking_reference, gross_cents, commission_bps,
       commission_cents, net_cents, currency, state)
    SELECT b.provider_user_id, b.id, b.booking_reference, b.amount_cents, v_set.commission_bps,
           round(b.amount_cents::numeric * v_set.commission_bps / 10000),
           b.amount_cents - round(b.amount_cents::numeric * v_set.commission_bps / 10000),
           coalesce(b.currency,'KES'), 'ACCRUED'
      FROM public.provider_bookings b
     WHERE b.status IN ('CONFIRMED','DELIVERED') AND b.is_test = false AND b.amount_cents > 0
    ON CONFLICT (booking_id) DO NOTHING
    RETURNING 1)
  SELECT count(*) INTO v_accrued FROM ins;

  WITH ins2 AS (
    INSERT INTO public.provider_earnings
      (provider_user_id, trip_booking_id, booking_reference, gross_cents, commission_bps,
       commission_cents, net_cents, currency, state)
    SELECT d.user_id, b.id, coalesce(b.booking_number, b.id::text),
           round(coalesce(b.total_fare,0) * 100)::bigint, v_set.commission_bps,
           round(round(coalesce(b.total_fare,0) * 100)::numeric * v_set.commission_bps / 10000),
           round(coalesce(b.total_fare,0) * 100)::bigint
             - round(round(coalesce(b.total_fare,0) * 100)::numeric * v_set.commission_bps / 10000),
           coalesce(b.currency,'KES'), 'ACCRUED'
      FROM public.trip_bookings b
      JOIN public.drivers d ON d.id = b.driver_id
     WHERE d.user_id IS NOT NULL AND b.cancelled_at IS NULL AND coalesce(b.total_fare,0) > 0
       AND b.status IN ('assigned','scheduled','pending','in_progress','started','arrived','completed')
       AND NOT EXISTS (SELECT 1 FROM public.provider_earnings e WHERE e.trip_booking_id = b.id)
    RETURNING 1)
  SELECT count(*) INTO v_trip FROM ins2;
  v_accrued := v_accrued + v_trip;

  UPDATE public.provider_earnings SET state = 'ACCRUED' WHERE state = 'PAYABLE';

  FOR r IN
    SELECT e.id, e.provider_user_id, e.gross_cents, e.net_cents, e.booking_reference
      FROM public.provider_earnings e
     WHERE e.state = 'ACCRUED'
       AND ((e.booking_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.provider_bookings b JOIN public.tax_invoices i ON i.id = b.invoice_id
             WHERE b.id = e.booking_id AND i.status = 'paid' AND i.paid_cents >= i.total_cents))
         OR (e.trip_booking_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.trip_bookings tb
             WHERE tb.id = e.trip_booking_id
               AND lower(coalesce(tb.payment_status,'')) IN ('paid','completed','succeeded'))))
  LOOP
    PERFORM public._provider_wallet_post(
      r.provider_user_id, 'HOLD', r.net_cents, 0, r.net_cents, 0, 'earning:' || r.id::text,
      jsonb_build_object('booking_reference', r.booking_reference,
                         'reason', 'client paid in full; held in the Yalla Mobility wallet until fulfilment'));
    PERFORM public._platform_wallet_post(
      'CLIENT_PAYMENT', r.gross_cents, r.gross_cents, r.gross_cents, 0, 0,
      'earning:' || r.id::text, 'provider_earning', r.id, r.provider_user_id,
      jsonb_build_object('booking_reference', r.booking_reference,
                         'operator_share_cents', r.net_cents,
                         'reason', 'client funds in custody; only fulfilment releases them'));
    UPDATE public.provider_earnings
       SET state = 'HELD', customer_paid_at = coalesce(customer_paid_at, now()), held_at = coalesce(held_at, now())
     WHERE id = r.id;
    v_held := v_held + 1;
  END LOOP;

  FOR r IN
    SELECT e.id, e.provider_user_id, e.gross_cents, e.net_cents, e.commission_cents,
           e.commission_bps, e.currency, e.booking_reference, e.booking_id, e.trip_booking_id
      FROM public.provider_earnings e
     WHERE e.state = 'HELD'
       AND ((e.booking_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.provider_bookings b WHERE b.id = e.booking_id AND b.status = 'DELIVERED'))
         OR (e.trip_booking_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.trip_bookings tb WHERE tb.id = e.trip_booking_id AND tb.status = 'completed')))
  LOOP
    PERFORM public._provider_wallet_post(
      r.provider_user_id, 'RELEASE', r.net_cents, r.net_cents, -r.net_cents, 0,
      'earning:' || r.id::text,
      jsonb_build_object('booking_reference', r.booking_reference,
                         'reason', 'trip fulfilled; funds available for withdrawal'));
    PERFORM public._platform_wallet_post(
      'FULFILMENT_RELEASE', r.gross_cents, 0, -r.gross_cents, r.net_cents, r.commission_cents,
      'earning:' || r.id::text, 'provider_earning', r.id, r.provider_user_id,
      jsonb_build_object('booking_reference', r.booking_reference,
                         'operator_share_cents', r.net_cents,
                         'commission_cents', r.commission_cents,
                         'commission_bps', r.commission_bps,
                         'paybill', v_set.platform_paybill));
    INSERT INTO public.provider_platform_postings
      (posting_type, provider_user_id, amount_cents, currency, paybill, rate_bps,
       source_kind, source_id, reference, detail)
    VALUES ('COMMISSION', r.provider_user_id, r.commission_cents, r.currency,
            v_set.platform_paybill, r.commission_bps, 'provider_earning', r.id,
            'commission:' || r.id::text,
            jsonb_build_object('booking_reference', r.booking_reference,
                              'booking_id', r.booking_id, 'trip_booking_id', r.trip_booking_id))
    ON CONFLICT (reference) DO NOTHING;
    UPDATE public.provider_earnings
       SET state = 'CREDITED', fulfilled_at = coalesce(fulfilled_at, now()), credited_at = coalesce(credited_at, now())
     WHERE id = r.id;
    v_credited := v_credited + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'accrued', v_accrued, 'trip_accrued', v_trip,
    'held', v_held, 'credited', v_credited, 'made_payable', v_credited);
END $function$;

CREATE OR REPLACE FUNCTION public.provider_payout_claim(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_src uuid := (p->>'request_id')::uuid;
  v_row public.provider_payout_requests;
  v_acct public.provider_payout_accounts;
  v_existing public.payout_disbursements;
  v_key text; v_ref text; v_id uuid;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role'
     AND NOT public.has_staff_permission('staff.finance.settlement.manage') THEN
    RETURN jsonb_build_object('error', true, 'code','AUTHORIZATION_ERROR');
  END IF;
  SELECT * INTO v_row FROM public.provider_payout_requests WHERE id = v_src FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','UNKNOWN_REQUEST'); END IF;
  v_key := 'payout:provider_payout:' || v_src::text;
  SELECT * INTO v_existing FROM public.payout_disbursements WHERE idempotency_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'disbursement_id', v_existing.id,
      'reference', v_existing.disbursement_reference, 'state', v_existing.state,
      'msisdn', v_existing.msisdn, 'amount', v_existing.amount);
  END IF;
  IF v_row.state <> 'APPROVED' THEN
    RETURN jsonb_build_object('error', true, 'code','PAYOUT_NOT_APPROVED', 'state', v_row.state);
  END IF;
  IF v_row.approvals_count < v_row.required_approvals THEN
    RETURN jsonb_build_object('error', true, 'code','SECOND_APPROVER_REQUIRED', 'state', v_row.state);
  END IF;
  IF v_row.released_at IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code','PAYOUT_NOT_RELEASED', 'state', v_row.state);
  END IF;
  SELECT * INTO v_acct FROM public.provider_payout_accounts
   WHERE id = v_row.account_id AND provider_user_id = v_row.provider_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','DESTINATION_NOT_FOUND'); END IF;
  IF v_acct.verification_state <> 'VERIFIED' THEN
    RETURN jsonb_build_object('error', true, 'code','DESTINATION_NOT_VERIFIED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.provider_earnings WHERE payout_request_id = v_src AND state = 'RESERVED') THEN
    RETURN jsonb_build_object('error', true, 'code','NO_RESERVED_EARNINGS');
  END IF;
  v_ref := 'PYT-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(v_key), 1, 8));
  INSERT INTO public.payout_disbursements
    (disbursement_reference, beneficiary_type, beneficiary_id, source_kind, source_id,
     destination_snapshot, msisdn, amount, currency, state, idempotency_key, initiated_by)
  VALUES (v_ref, 'PROVIDER', v_row.provider_user_id, 'provider_payout', v_src,
     jsonb_build_object('account_id', v_acct.id, 'type','MPESA',
                        'account_name', v_acct.account_name,
                        'verification_state', v_acct.verification_state,
                        'verified_at', v_acct.verified_at,
                        'approvals', v_row.approvals_count,
                        'released_by', v_row.released_by),
     v_acct.msisdn, round(v_row.amount_cents::numeric / 100, 2), coalesce(v_row.currency,'KES'),
     'DRAFT', v_key, auth.uid())
  RETURNING id INTO v_id;
  UPDATE public.provider_payout_requests SET disbursement_id = v_id WHERE id = v_src;
  INSERT INTO public.provider_payout_events (request_id, event_type, state_from, state_to, detail, actor_user_id)
  VALUES (v_src, 'PAYOUT_CREATED', v_row.state, v_row.state,
          jsonb_build_object('disbursement_id', v_id, 'reference', v_ref), auth.uid());
  RETURN jsonb_build_object('ok', true, 'disbursement_id', v_id, 'reference', v_ref,
    'state','DRAFT', 'msisdn', v_acct.msisdn,
    'amount', round(v_row.amount_cents::numeric / 100, 2),
    'request_reference', v_row.request_reference);
END $$;

CREATE OR REPLACE FUNCTION public.provider_payout_prepare()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_run jsonb;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role'
     AND NOT (public.capacity_can_approve(auth.uid())
              OR public.has_staff_permission('staff.finance.settlement.manage')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  v_run := public.provider_settlement_run();
  RETURN jsonb_build_object('ok', true, 'created', 0, 'requests', '[]'::jsonb,
    'held', v_run->'held', 'credited', v_run->'credited',
    'note', 'Wallet balances updated. Operators request their own withdrawals.');
END $$;

CREATE OR REPLACE FUNCTION public.provider_earnings_sync()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role'
     AND NOT (public.capacity_can_approve(auth.uid())
              OR public.has_staff_permission('staff.finance.settlement.manage')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  RETURN public.provider_settlement_run();
END $$;

CREATE OR REPLACE FUNCTION public.payout_disbursement_mark_submitted(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid := (p->>'disbursement_id')::uuid;
  v_row public.payout_disbursements;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN
    RETURN jsonb_build_object('error', true, 'code','AUTHORIZATION_ERROR');
  END IF;
  SELECT * INTO v_row FROM public.payout_disbursements WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','NOT_FOUND'); END IF;
  IF v_row.state NOT IN ('DRAFT','INITIATED') THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'state', v_row.state);
  END IF;
  UPDATE public.payout_disbursements
     SET state = 'PROCESSING',
         provider_conversation_id = coalesce(p->>'conversation_id', provider_conversation_id),
         provider_originator_conversation_id = coalesce(p->>'originator_conversation_id', provider_originator_conversation_id),
         provider_response_code = coalesce(p->>'response_code', provider_response_code),
         initiated_at = coalesce(initiated_at, now())
   WHERE id = v_id;
  INSERT INTO public.payout_provider_events
    (disbursement_id, event_type, provider_conversation_id, amount, recipient, payload, payload_hash)
  VALUES (v_id, 'SUBMISSION_ACK', p->>'conversation_id', v_row.amount, v_row.msisdn,
          coalesce(p->'payload','{}'::jsonb),
          encode(sha256(convert_to(coalesce(p->'payload','{}'::jsonb)::text || v_id::text || 'ack','utf8')),'hex'))
  ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'state','PROCESSING');
END $$;

CREATE OR REPLACE FUNCTION public.payout_disbursement_mark_unknown(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid := (p->>'disbursement_id')::uuid;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN
    RETURN jsonb_build_object('error', true, 'code','AUTHORIZATION_ERROR');
  END IF;
  UPDATE public.payout_disbursements
     SET state = 'UNKNOWN', failure_reason = coalesce(p->>'reason','provider state unknown after submission')
   WHERE id = v_id AND state IN ('DRAFT','INITIATED','PROCESSING');
  RETURN jsonb_build_object('ok', true, 'state','UNKNOWN');
END $$;

CREATE OR REPLACE FUNCTION public.payout_disbursement_apply_result(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv text := p->>'conversation_id';
  v_id uuid := nullif(p->>'disbursement_id','')::uuid;
  v_row public.payout_disbursements;
  v_code text := p->>'result_code';
  v_txn text := nullif(p->>'provider_transaction_id','');
  v_amount numeric := nullif(p->>'amount','')::numeric;
  v_hash text; v_entry uuid; v_recon text; v_evidence jsonb;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' THEN
    RETURN jsonb_build_object('error', true, 'code','AUTHORIZATION_ERROR');
  END IF;
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.payout_disbursements WHERE id = v_id FOR UPDATE;
  ELSE
    SELECT * INTO v_row FROM public.payout_disbursements WHERE provider_conversation_id = v_conv FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','UNMATCHED_RESULT'); END IF;
  v_hash := encode(sha256(convert_to(coalesce(p->'payload','{}'::jsonb)::text,'utf8')),'hex');
  INSERT INTO public.payout_provider_events
    (disbursement_id, event_type, provider_conversation_id, provider_transaction_id,
     result_code, result_desc, amount, recipient, transacted_at, payload, payload_hash)
  VALUES (v_row.id, 'RESULT', v_conv, v_txn, v_code, p->>'result_desc', v_amount,
          p->>'recipient', nullif(p->>'transacted_at','')::timestamptz,
          coalesce(p->'payload','{}'::jsonb), v_hash)
  ON CONFLICT (provider, payload_hash) DO NOTHING;
  IF v_row.state IN ('SUCCESS','FAILED','REVERSED') THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'state', v_row.state,
      'reconciliation_state', v_row.reconciliation_state, 'ledger_entry_id', v_row.ledger_entry_id);
  END IF;
  IF v_code IS DISTINCT FROM '0' THEN
    UPDATE public.payout_disbursements
       SET state='FAILED', result_code=v_code, result_desc=p->>'result_desc',
           failure_reason=coalesce(p->>'result_desc','provider failure'),
           completed_at=now(), reconciliation_state='PENDING'
     WHERE id = v_row.id;
    IF v_row.source_kind = 'provider_payout' THEN
      UPDATE public.provider_payout_requests
         SET state='FAILED', failure_reason=coalesce(p->>'result_desc','provider failure')
       WHERE id = v_row.source_id;
      UPDATE public.provider_earnings SET state='PAYABLE', payout_request_id=NULL
       WHERE payout_request_id = v_row.source_id AND state='RESERVED';
      INSERT INTO public.provider_payout_events (request_id, event_type, state_to, detail)
      VALUES (v_row.source_id, 'PAYOUT_FAILED', 'FAILED',
              jsonb_build_object('result_code', v_code, 'result_desc', p->>'result_desc'));
    ELSE
      UPDATE public.carrier_withdrawal_requests
         SET state='FAILED', failure_reason=coalesce(p->>'result_desc','provider failure')
       WHERE id = v_row.source_id AND state IN ('APPROVED','EXECUTED');
      INSERT INTO public.carrier_withdrawal_events (request_id, event_type, from_state, to_state, actor, detail)
      SELECT v_row.source_id, 'PAYOUT_FAILED', 'APPROVED', 'FAILED', NULL,
             jsonb_build_object('result_code', v_code, 'result_desc', p->>'result_desc')
       WHERE EXISTS (SELECT 1 FROM public.carrier_withdrawal_requests WHERE id = v_row.source_id);
    END IF;
    RETURN jsonb_build_object('ok', true, 'state','FAILED', 'result_code', v_code);
  END IF;
  IF v_txn IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code','INCOMPLETE_EVIDENCE',
      'detail','provider transaction reference missing; payout not marked executed');
  END IF;
  v_recon := CASE WHEN v_amount IS NULL THEN 'EXCEPTION' WHEN v_amount = v_row.amount THEN 'MATCHED' ELSE 'EXCEPTION' END;
  v_evidence := jsonb_strip_nulls(jsonb_build_object(
    'provider', v_row.provider, 'provider_transaction_id', v_txn, 'conversation_id', v_conv,
    'result_code', v_code, 'result_desc', p->>'result_desc', 'amount', v_amount,
    'recipient', p->>'recipient', 'transacted_at', p->>'transacted_at',
    'disbursement_id', v_row.id, 'disbursement_reference', v_row.disbursement_reference,
    'payload_hash', v_hash));
  IF v_row.source_kind = 'provider_payout' THEN
    UPDATE public.payout_disbursements
       SET state='SUCCESS', result_code=v_code, result_desc=p->>'result_desc',
           provider_transaction_id=v_txn, payment_evidence=v_evidence, completed_at=now(),
           settlement_reference='STL-' || v_row.disbursement_reference,
           reconciliation_state=v_recon,
           reconciliation_detail=jsonb_build_object('payout_amount', v_row.amount, 'provider_amount', v_amount)
     WHERE id = v_row.id;
    UPDATE public.provider_payout_requests SET state='PAID', paid_at=now(), provider_transaction_id=v_txn
     WHERE id = v_row.source_id;
    UPDATE public.provider_earnings SET state='PAID', paid_at=now()
     WHERE payout_request_id = v_row.source_id AND state='RESERVED';
    INSERT INTO public.provider_payout_events (request_id, event_type, state_to, detail)
    VALUES (v_row.source_id, 'PAID', 'PAID',
            jsonb_build_object('payment_evidence', v_evidence, 'reconciliation_state', v_recon));
    RETURN jsonb_build_object('ok', true, 'state','SUCCESS', 'provider_transaction_id', v_txn,
      'reconciliation_state', v_recon, 'settlement_reference', 'STL-' || v_row.disbursement_reference);
  END IF;
  v_entry := public.partner_ledger_post(
    v_row.partner_id, 'settlement_payout'::partner_ledger_kind, 'DEBIT'::ledger_direction,
    v_row.amount,
    'Fleet Owner payout ' || v_row.disbursement_reference || ' (M-Pesa ' || v_txn || ')',
    NULL, NULL, v_row.disbursement_reference,
    'payout_disbursement:' || v_row.id::text, true);
  UPDATE public.payout_disbursements
     SET state='SUCCESS', result_code=v_code, result_desc=p->>'result_desc',
         provider_transaction_id=v_txn, payment_evidence=v_evidence,
         ledger_entry_id=v_entry, completed_at=now(),
         settlement_reference='STL-' || v_row.disbursement_reference,
         reconciliation_state=v_recon,
         reconciliation_detail=jsonb_build_object(
           'payable_amount', v_row.amount, 'payout_amount', v_row.amount,
           'provider_amount', v_amount, 'settlement_amount', v_row.amount)
   WHERE id = v_row.id;
  UPDATE public.carrier_withdrawal_requests
     SET state='EXECUTED', executed_at=now(), payment_evidence=v_evidence
   WHERE id = v_row.source_id;
  INSERT INTO public.carrier_withdrawal_events (request_id, event_type, from_state, to_state, actor, detail)
  SELECT v_row.source_id, 'EXECUTED', 'APPROVED', 'EXECUTED', NULL,
         jsonb_build_object('payment_evidence', v_evidence, 'ledger_entry_id', v_entry, 'reconciliation_state', v_recon)
   WHERE EXISTS (SELECT 1 FROM public.carrier_withdrawal_requests WHERE id = v_row.source_id);
  RETURN jsonb_build_object('ok', true, 'state','SUCCESS', 'ledger_entry_id', v_entry,
    'reconciliation_state', v_recon, 'provider_transaction_id', v_txn,
    'settlement_reference', 'STL-' || v_row.disbursement_reference);
END $$;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('_provider_wallet_post','provider_settlement_run','provider_payout_claim','provider_payout_prepare','provider_earnings_sync','payout_disbursement_mark_submitted','payout_disbursement_mark_unknown','payout_disbursement_apply_result')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

ALTER TABLE public.payment_gateway_settings
  ADD COLUMN IF NOT EXISTS b2c_short_code text,
  ADD COLUMN IF NOT EXISTS etims_api_key text,
  ADD COLUMN IF NOT EXISTS etims_base_url text,
  ADD COLUMN IF NOT EXISTS etims_webhook_secret text,
  ADD COLUMN IF NOT EXISTS etims_device_mode text;