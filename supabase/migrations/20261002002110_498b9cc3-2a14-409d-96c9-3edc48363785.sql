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

REVOKE ALL ON FUNCTION public.payout_disbursement_mark_submitted(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payout_disbursement_apply_result(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_disbursement_mark_submitted(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.payout_disbursement_apply_result(jsonb) TO service_role;