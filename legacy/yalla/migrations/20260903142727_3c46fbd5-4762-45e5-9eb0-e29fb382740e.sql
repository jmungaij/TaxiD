-- ============================================================
-- Carrier / Fleet Owner disbursement rail (single payment spine)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.payout_disbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  disbursement_reference text NOT NULL UNIQUE,
  beneficiary_type text NOT NULL CHECK (beneficiary_type IN ('DRIVER','FLEET_OWNER')),
  beneficiary_id uuid NOT NULL,
  carrier_id uuid REFERENCES public.carrier_profiles(id),
  partner_id uuid,
  source_kind text NOT NULL CHECK (source_kind IN ('carrier_withdrawal','driver_payout')),
  source_id uuid NOT NULL,
  destination_id uuid REFERENCES public.carrier_settlement_destinations(id),
  destination_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  msisdn text NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'KES',
  provider text NOT NULL DEFAULT 'MPESA_B2C',
  state text NOT NULL DEFAULT 'DRAFT'
    CHECK (state IN ('DRAFT','INITIATED','PROCESSING','SUCCESS','FAILED','UNKNOWN','REVERSED','CANCELLED')),
  provider_conversation_id text,
  provider_originator_conversation_id text,
  provider_transaction_id text,
  provider_response_code text,
  result_code text,
  result_desc text,
  payment_evidence jsonb,
  ledger_entry_id uuid,
  reversal_ledger_entry_id uuid,
  settlement_reference text,
  reconciliation_state text NOT NULL DEFAULT 'PENDING'
    CHECK (reconciliation_state IN ('PENDING','MATCHED','EXCEPTION','REVERSED')),
  reconciliation_detail jsonb,
  failure_reason text,
  idempotency_key text NOT NULL UNIQUE,
  initiated_by uuid,
  initiated_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payout_disbursements_open_per_source
  ON public.payout_disbursements (source_kind, source_id)
  WHERE state IN ('DRAFT','INITIATED','PROCESSING','UNKNOWN','SUCCESS');

CREATE INDEX IF NOT EXISTS payout_disbursements_conversation_idx
  ON public.payout_disbursements (provider_conversation_id);

GRANT SELECT ON public.payout_disbursements TO authenticated;
GRANT ALL ON public.payout_disbursements TO service_role;
ALTER TABLE public.payout_disbursements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "finance staff read payouts" ON public.payout_disbursements
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.finance.settlement.manage'));

CREATE POLICY "carrier reads own payouts" ON public.payout_disbursements
  FOR SELECT TO authenticated
  USING (carrier_id IS NOT NULL AND public._carrier_is_member(carrier_id));

CREATE POLICY "service role manages payouts" ON public.payout_disbursements
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Append-only raw provider evidence -------------------------------------
CREATE TABLE IF NOT EXISTS public.payout_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  disbursement_id uuid REFERENCES public.payout_disbursements(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'MPESA_B2C',
  event_type text NOT NULL,
  provider_conversation_id text,
  provider_transaction_id text,
  result_code text,
  result_desc text,
  amount numeric(14,2),
  recipient text,
  transacted_at timestamptz,
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, payload_hash)
);

GRANT SELECT ON public.payout_provider_events TO authenticated;
GRANT ALL ON public.payout_provider_events TO service_role;
ALTER TABLE public.payout_provider_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "finance staff read provider events" ON public.payout_provider_events
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.finance.settlement.manage'));

CREATE POLICY "service role manages provider events" ON public.payout_provider_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public._payout_provider_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'payout_provider_events is append-only';
END $$;

DROP TRIGGER IF EXISTS payout_provider_events_append_only ON public.payout_provider_events;
CREATE TRIGGER payout_provider_events_append_only
  BEFORE UPDATE OR DELETE ON public.payout_provider_events
  FOR EACH ROW EXECUTE FUNCTION public._payout_provider_events_append_only();

CREATE OR REPLACE FUNCTION public._payout_disbursements_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  -- Financial identity of a payout is immutable once created.
  IF NEW.amount <> OLD.amount OR NEW.beneficiary_id <> OLD.beneficiary_id
     OR NEW.msisdn <> OLD.msisdn OR NEW.source_id <> OLD.source_id
     OR NEW.idempotency_key <> OLD.idempotency_key THEN
    RAISE EXCEPTION 'payout identity is immutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payout_disbursements_touch ON public.payout_disbursements;
CREATE TRIGGER payout_disbursements_touch
  BEFORE UPDATE ON public.payout_disbursements
  FOR EACH ROW EXECUTE FUNCTION public._payout_disbursements_touch();

-- ============================================================
-- APPROVED -> EXECUTED requires real provider evidence
-- ============================================================
CREATE OR REPLACE FUNCTION public._carrier_withdrawal_requires_provider_evidence()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.state = 'EXECUTED' AND COALESCE(OLD.state,'') <> 'EXECUTED' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.payout_disbursements d
       WHERE d.source_kind = 'carrier_withdrawal'
         AND d.source_id = NEW.id
         AND d.state = 'SUCCESS'
         AND d.provider_transaction_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'PROVIDER_EVIDENCE_REQUIRED: no successful provider disbursement for withdrawal %', NEW.request_reference;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS carrier_withdrawal_provider_evidence ON public.carrier_withdrawal_requests;
CREATE TRIGGER carrier_withdrawal_provider_evidence
  BEFORE UPDATE ON public.carrier_withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION public._carrier_withdrawal_requires_provider_evidence();

-- ============================================================
-- Eligibility gate + payout claim
-- ============================================================
CREATE OR REPLACE FUNCTION public.payout_disbursement_claim(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_src uuid := (p->>'withdrawal_id')::uuid;
  v_row public.carrier_withdrawal_requests;
  v_dest public.carrier_settlement_destinations;
  v_existing public.payout_disbursements;
  v_partner uuid;
  v_available numeric;
  v_key text;
  v_ref text;
  v_id uuid;
BEGIN
  IF current_user <> 'service_role'
     AND NOT public.has_staff_permission('staff.finance.settlement.manage') THEN
    RETURN jsonb_build_object('error', true, 'code','AUTHORIZATION_ERROR');
  END IF;

  SELECT * INTO v_row FROM public.carrier_withdrawal_requests WHERE id = v_src FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','UNKNOWN_REQUEST'); END IF;

  v_key := 'payout:carrier_withdrawal:' || v_src::text;
  SELECT * INTO v_existing FROM public.payout_disbursements WHERE idempotency_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'disbursement_id', v_existing.id,
      'reference', v_existing.disbursement_reference, 'state', v_existing.state,
      'msisdn', v_existing.msisdn, 'amount', v_existing.amount,
      'provider_conversation_id', v_existing.provider_conversation_id);
  END IF;

  IF v_row.state <> 'APPROVED' THEN
    RETURN jsonb_build_object('error', true, 'code','PAYOUT_NOT_APPROVED', 'state', v_row.state);
  END IF;
  IF v_row.amount_kes IS NULL OR v_row.amount_kes <= 0 THEN
    RETURN jsonb_build_object('error', true, 'code','INVALID_AMOUNT');
  END IF;

  IF NOT (public.carrier_matchability(v_row.carrier_id)->>'matchable')::boolean THEN
    RETURN jsonb_build_object('error', true, 'code','BENEFICIARY_NOT_IN_GOOD_STANDING');
  END IF;

  SELECT * INTO v_dest FROM public.carrier_settlement_destinations
   WHERE id = v_row.destination_id AND carrier_id = v_row.carrier_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','DESTINATION_NOT_FOUND'); END IF;
  IF v_dest.verification_state <> 'VERIFIED' THEN
    RETURN jsonb_build_object('error', true, 'code','DESTINATION_NOT_VERIFIED',
      'verification_state', v_dest.verification_state);
  END IF;
  IF v_dest.destination_type <> 'MPESA' OR v_dest.msisdn IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code','DESTINATION_NOT_MPESA');
  END IF;

  SELECT partner_id INTO v_partner FROM public.carrier_profiles WHERE id = v_row.carrier_id;
  SELECT (balance - reserved) INTO v_available FROM public.partner_wallets WHERE partner_id = v_partner;
  IF v_available IS NULL THEN RETURN jsonb_build_object('error', true, 'code','WALLET_NOT_CONFIGURED'); END IF;
  IF v_row.amount_kes > v_available THEN
    RETURN jsonb_build_object('error', true, 'code','INSUFFICIENT_AVAILABLE_BALANCE',
      'available_kes', v_available, 'requested_kes', v_row.amount_kes);
  END IF;

  v_ref := 'PYT-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(v_key), 1, 8));

  INSERT INTO public.payout_disbursements
    (disbursement_reference, beneficiary_type, beneficiary_id, carrier_id, partner_id,
     source_kind, source_id, destination_id, destination_snapshot, msisdn, amount, currency,
     state, idempotency_key, initiated_by)
  VALUES (v_ref, 'FLEET_OWNER', v_row.carrier_id, v_row.carrier_id, v_partner,
     'carrier_withdrawal', v_src, v_dest.id,
     jsonb_build_object('destination_id', v_dest.id, 'type', v_dest.destination_type,
                        'account_name', v_dest.account_name,
                        'verification_state', v_dest.verification_state,
                        'verified_at', v_dest.verified_at),
     v_dest.msisdn, v_row.amount_kes, coalesce(v_row.currency,'KES'),
     'DRAFT', v_key, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.carrier_withdrawal_events (request_id, event_type, from_state, to_state, actor, detail)
  VALUES (v_src, 'PAYOUT_CREATED', v_row.state, v_row.state, auth.uid(),
          jsonb_build_object('disbursement_id', v_id, 'reference', v_ref));

  RETURN jsonb_build_object('ok', true, 'disbursement_id', v_id, 'reference', v_ref,
    'state','DRAFT', 'msisdn', v_dest.msisdn, 'amount', v_row.amount_kes,
    'carrier_id', v_row.carrier_id, 'withdrawal_reference', v_row.request_reference);
END $$;

-- Provider submission recorded (NOT payment success) ---------------------
CREATE OR REPLACE FUNCTION public.payout_disbursement_mark_submitted(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid := (p->>'disbursement_id')::uuid;
  v_row public.payout_disbursements;
BEGIN
  IF current_user <> 'service_role' THEN
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
DECLARE
  v_id uuid := (p->>'disbursement_id')::uuid;
BEGIN
  IF current_user <> 'service_role' THEN
    RETURN jsonb_build_object('error', true, 'code','AUTHORIZATION_ERROR');
  END IF;
  UPDATE public.payout_disbursements
     SET state = 'UNKNOWN',
         failure_reason = coalesce(p->>'reason','provider state unknown after submission')
   WHERE id = v_id AND state IN ('DRAFT','INITIATED','PROCESSING');
  RETURN jsonb_build_object('ok', true, 'state','UNKNOWN');
END $$;

-- ============================================================
-- Authoritative provider result -> evidence, ledger, settlement, recon
-- ============================================================
CREATE OR REPLACE FUNCTION public.payout_disbursement_apply_result(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conv text := p->>'conversation_id';
  v_id uuid := nullif(p->>'disbursement_id','')::uuid;
  v_row public.payout_disbursements;
  v_code text := p->>'result_code';
  v_txn text := nullif(p->>'provider_transaction_id','');
  v_amount numeric := nullif(p->>'amount','')::numeric;
  v_hash text;
  v_entry uuid;
  v_recon text;
  v_evidence jsonb;
BEGIN
  IF current_user <> 'service_role' THEN
    RETURN jsonb_build_object('error', true, 'code','AUTHORIZATION_ERROR');
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.payout_disbursements WHERE id = v_id FOR UPDATE;
  ELSE
    SELECT * INTO v_row FROM public.payout_disbursements
     WHERE provider_conversation_id = v_conv FOR UPDATE;
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

  -- Duplicate callback: terminal state already applied -> harmless replay.
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
    UPDATE public.carrier_withdrawal_requests
       SET state='FAILED', failure_reason=coalesce(p->>'result_desc','provider failure')
     WHERE id = v_row.source_id AND state IN ('APPROVED','EXECUTED');
    INSERT INTO public.carrier_withdrawal_events (request_id, event_type, from_state, to_state, actor, detail)
    VALUES (v_row.source_id, 'PAYOUT_FAILED', 'APPROVED', 'FAILED', NULL,
            jsonb_build_object('result_code', v_code, 'result_desc', p->>'result_desc'));
    RETURN jsonb_build_object('ok', true, 'state','FAILED', 'result_code', v_code);
  END IF;

  IF v_txn IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code','INCOMPLETE_EVIDENCE',
      'detail','provider transaction reference missing; payout not marked executed');
  END IF;

  v_recon := CASE WHEN v_amount IS NULL THEN 'EXCEPTION'
                  WHEN v_amount = v_row.amount THEN 'MATCHED'
                  ELSE 'EXCEPTION' END;

  v_evidence := jsonb_strip_nulls(jsonb_build_object(
    'provider', v_row.provider,
    'provider_transaction_id', v_txn,
    'conversation_id', v_conv,
    'result_code', v_code,
    'result_desc', p->>'result_desc',
    'amount', v_amount,
    'recipient', p->>'recipient',
    'transacted_at', p->>'transacted_at',
    'disbursement_id', v_row.id,
    'disbursement_reference', v_row.disbursement_reference,
    'payload_hash', v_hash));

  -- Wallet is the source of the payout: debit on confirmed disbursement.
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
  VALUES (v_row.source_id, 'EXECUTED', 'APPROVED', 'EXECUTED', NULL,
          jsonb_build_object('payment_evidence', v_evidence, 'ledger_entry_id', v_entry,
                             'reconciliation_state', v_recon));

  RETURN jsonb_build_object('ok', true, 'state','SUCCESS', 'ledger_entry_id', v_entry,
    'reconciliation_state', v_recon, 'provider_transaction_id', v_txn,
    'settlement_reference', 'STL-' || v_row.disbursement_reference);
END $$;

CREATE OR REPLACE FUNCTION public.payout_disbursement_reverse(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid := (p->>'disbursement_id')::uuid;
  v_row public.payout_disbursements;
  v_entry uuid;
BEGIN
  IF current_user <> 'service_role' THEN
    RETURN jsonb_build_object('error', true, 'code','AUTHORIZATION_ERROR');
  END IF;
  SELECT * INTO v_row FROM public.payout_disbursements WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','NOT_FOUND'); END IF;
  IF v_row.state = 'REVERSED' THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'state','REVERSED');
  END IF;
  IF v_row.state <> 'SUCCESS' THEN
    RETURN jsonb_build_object('error', true, 'code','NOT_REVERSIBLE', 'state', v_row.state);
  END IF;

  v_entry := public.partner_ledger_post(
    v_row.partner_id, 'reversal'::partner_ledger_kind, 'CREDIT'::ledger_direction,
    v_row.amount, 'Reversal of payout ' || v_row.disbursement_reference,
    NULL, NULL, v_row.disbursement_reference,
    'payout_reversal:' || v_row.id::text, true);

  UPDATE public.payout_disbursements
     SET state='REVERSED', reconciliation_state='REVERSED',
         reversal_ledger_entry_id=v_entry,
         failure_reason=coalesce(p->>'reason','provider reversal')
   WHERE id = v_id;

  UPDATE public.carrier_withdrawal_requests
     SET state='FAILED', failure_reason=coalesce(p->>'reason','payout reversed by provider')
   WHERE id = v_row.source_id;

  INSERT INTO public.carrier_withdrawal_events (request_id, event_type, from_state, to_state, actor, detail)
  VALUES (v_row.source_id, 'PAYOUT_REVERSED', 'EXECUTED', 'FAILED', NULL,
          jsonb_build_object('reversal_ledger_entry_id', v_entry));

  RETURN jsonb_build_object('ok', true, 'state','REVERSED', 'reversal_ledger_entry_id', v_entry);
END $$;

REVOKE ALL ON FUNCTION public.payout_disbursement_claim(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.payout_disbursement_mark_submitted(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payout_disbursement_mark_unknown(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payout_disbursement_apply_result(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.payout_disbursement_reverse(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payout_disbursement_claim(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.payout_disbursement_mark_submitted(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.payout_disbursement_mark_unknown(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.payout_disbursement_apply_result(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.payout_disbursement_reverse(jsonb) TO service_role;