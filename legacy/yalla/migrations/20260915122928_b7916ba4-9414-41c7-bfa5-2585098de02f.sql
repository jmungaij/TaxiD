-- ============ approved bank account channel ============
ALTER TABLE public.yalla_payment_channels ADD COLUMN IF NOT EXISTS source_document text;

INSERT INTO public.yalla_payment_channels
  (channel_type, display_name, paybill_number, bank_name, account_name, account_number, branch, reference_instructions, currency, is_active, source_document)
VALUES
  ('BANK_ACCOUNT', 'Yalla KCB bank account', NULL, 'KCB', 'Yalla Beena Limited', '1334972281', 'Thika Branch',
   'Use your company name and the booking reference as the payment reference, then share the payment confirmation.', 'KES', true,
   'Yalla Mobility payment advice supplied by the account owner')
ON CONFLICT DO NOTHING;

UPDATE public.yalla_payment_channels
   SET account_name = 'Yalla Beena Limited',
       source_document = 'Yalla Mobility payment advice supplied by the account owner'
 WHERE channel_type = 'MPESA_PAYBILL' AND paybill_number = '4148095';

-- ============ enums ============
DO $$ BEGIN CREATE TYPE public.ride_payment_state AS ENUM
  ('AWAITING_PAYMENT','PAYMENT_VERIFIED','CREDIT_AUTHORIZED','CREDIT_SETTLED','CANCELLED','FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.ride_receivable_state AS ENUM
  ('OPEN','INVOICED','SETTLED','WRITTEN_OFF','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.fin_ledger_entry_kind AS ENUM
  ('BOOKING','PAYMENT','RECEIVABLE','CREDIT_UTILISATION','RECONCILIATION','ADJUSTMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ ledger (append only, always balanced) ============
CREATE TABLE IF NOT EXISTS public.fin_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_group uuid NOT NULL,
  kind public.fin_ledger_entry_kind NOT NULL,
  account_code text NOT NULL,
  account_name text NOT NULL,
  debit_cents bigint NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
  credit_cents bigint NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
  currency text NOT NULL DEFAULT 'KES',
  corporate_id uuid,
  intent_id uuid,
  reference text,
  memo text,
  correlation_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((debit_cents = 0) <> (credit_cents = 0))
);
CREATE INDEX IF NOT EXISTS fin_ledger_group_idx ON public.fin_ledger_entries(entry_group);
CREATE INDEX IF NOT EXISTS fin_ledger_intent_idx ON public.fin_ledger_entries(intent_id);
CREATE INDEX IF NOT EXISTS fin_ledger_corp_idx ON public.fin_ledger_entries(corporate_id, created_at DESC);

GRANT SELECT ON public.fin_ledger_entries TO authenticated;
GRANT ALL ON public.fin_ledger_entries TO service_role;
ALTER TABLE public.fin_ledger_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY fin_ledger_finance_read ON public.fin_ledger_entries
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['finance_admin','admin','super_admin']::public.app_role[]));

CREATE OR REPLACE FUNCTION public._fin_ledger_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'fin_ledger_entries is append-only';
END $$;

DROP TRIGGER IF EXISTS trg_fin_ledger_immutable ON public.fin_ledger_entries;
CREATE TRIGGER trg_fin_ledger_immutable
  BEFORE UPDATE OR DELETE ON public.fin_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public._fin_ledger_immutable();

-- ============ trip payment intents ============
CREATE TABLE IF NOT EXISTS public.ride_payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  corporate_id uuid REFERENCES public.corporate_accounts(id),
  booking_id uuid,
  trip_request_id uuid,
  approval_id uuid,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'KES',
  mode text NOT NULL CHECK (mode IN ('CASH','CREDIT')),
  state public.ride_payment_state NOT NULL DEFAULT 'AWAITING_PAYMENT',
  channel_id uuid REFERENCES public.yalla_payment_channels(id),
  decision text,
  decision_reasons text[] NOT NULL DEFAULT '{}',
  reservation_id uuid REFERENCES public.corporate_credit_reservations(id),
  receivable_id uuid,
  invoice_id uuid REFERENCES public.corporate_invoices(id),
  paid_amount_cents bigint NOT NULL DEFAULT 0,
  mpesa_receipt text,
  verified_at timestamptz,
  cancelled_at timestamptz,
  failure_reason text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ride_payment_receipt_uniq
  ON public.ride_payment_intents(mpesa_receipt) WHERE mpesa_receipt IS NOT NULL;
CREATE INDEX IF NOT EXISTS ride_payment_corp_idx ON public.ride_payment_intents(corporate_id, created_at DESC);

GRANT SELECT ON public.ride_payment_intents TO authenticated;
GRANT ALL ON public.ride_payment_intents TO service_role;
ALTER TABLE public.ride_payment_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY ride_payment_read ON public.ride_payment_intents
  FOR SELECT TO authenticated
  USING (
    (corporate_id IS NOT NULL AND public.is_corporate_member(auth.uid(), corporate_id))
    OR created_by = auth.uid()
    OR public.has_any_role(auth.uid(), ARRAY['finance_admin','admin','super_admin']::public.app_role[])
  );

-- ============ receivables ============
CREATE TABLE IF NOT EXISTS public.ride_receivables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id),
  intent_id uuid NOT NULL REFERENCES public.ride_payment_intents(id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  settled_cents bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'KES',
  state public.ride_receivable_state NOT NULL DEFAULT 'OPEN',
  due_date date NOT NULL,
  invoice_id uuid REFERENCES public.corporate_invoices(id),
  reservation_id uuid REFERENCES public.corporate_credit_reservations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (intent_id)
);
GRANT SELECT ON public.ride_receivables TO authenticated;
GRANT ALL ON public.ride_receivables TO service_role;
ALTER TABLE public.ride_receivables ENABLE ROW LEVEL SECURITY;

CREATE POLICY ride_receivable_read ON public.ride_receivables
  FOR SELECT TO authenticated
  USING (
    public.is_corporate_member(auth.uid(), corporate_id)
    OR public.has_any_role(auth.uid(), ARRAY['finance_admin','admin','super_admin']::public.app_role[])
  );

-- ============ bank / paybill receipts + reconciliation ============
CREATE TABLE IF NOT EXISTS public.fin_bank_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.yalla_payment_channels(id),
  external_reference text NOT NULL,
  payer_reference text,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'KES',
  paid_at timestamptz NOT NULL,
  statement_reference text,
  evidence_note text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel_id, external_reference)
);
GRANT SELECT ON public.fin_bank_receipts TO authenticated;
GRANT ALL ON public.fin_bank_receipts TO service_role;
ALTER TABLE public.fin_bank_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY fin_bank_receipts_finance ON public.fin_bank_receipts
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['finance_admin','admin','super_admin']::public.app_role[]));

CREATE TABLE IF NOT EXISTS public.fin_reconciliation_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id uuid NOT NULL REFERENCES public.ride_payment_intents(id),
  receipt_id uuid NOT NULL REFERENCES public.fin_bank_receipts(id),
  matched_amount_cents bigint NOT NULL,
  variance_cents bigint NOT NULL,
  state text NOT NULL CHECK (state IN ('MATCHED','VARIANCE')),
  note text,
  reconciled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (intent_id, receipt_id)
);
GRANT SELECT ON public.fin_reconciliation_matches TO authenticated;
GRANT ALL ON public.fin_reconciliation_matches TO service_role;
ALTER TABLE public.fin_reconciliation_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY fin_recon_finance ON public.fin_reconciliation_matches
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['finance_admin','admin','super_admin']::public.app_role[]));

-- ============ ledger posting helper (balanced or nothing) ============
CREATE OR REPLACE FUNCTION public.fin_ledger_post(
  _kind public.fin_ledger_entry_kind,
  _legs jsonb,
  _corporate_id uuid,
  _intent_id uuid,
  _reference text,
  _memo text,
  _correlation_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_group uuid := gen_random_uuid();
  v_debit bigint := 0;
  v_credit bigint := 0;
  v_leg jsonb;
BEGIN
  IF _legs IS NULL OR jsonb_array_length(_legs) < 2 THEN
    RAISE EXCEPTION 'a ledger entry needs at least two legs';
  END IF;
  FOR v_leg IN SELECT jsonb_array_elements(_legs) LOOP
    v_debit := v_debit + COALESCE((v_leg->>'debit_cents')::bigint, 0);
    v_credit := v_credit + COALESCE((v_leg->>'credit_cents')::bigint, 0);
  END LOOP;
  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'ledger entry is unbalanced: debits % credits %', v_debit, v_credit;
  END IF;

  INSERT INTO public.fin_ledger_entries
    (entry_group, kind, account_code, account_name, debit_cents, credit_cents,
     currency, corporate_id, intent_id, reference, memo, correlation_id, created_by)
  SELECT v_group, _kind, l->>'account_code', l->>'account_name',
         COALESCE((l->>'debit_cents')::bigint, 0), COALESCE((l->>'credit_cents')::bigint, 0),
         COALESCE(l->>'currency', 'KES'), _corporate_id, _intent_id, _reference, _memo, _correlation_id, auth.uid()
    FROM jsonb_array_elements(_legs) l;

  RETURN v_group;
END $$;

REVOKE ALL ON FUNCTION public.fin_ledger_post(public.fin_ledger_entry_kind, jsonb, uuid, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fin_ledger_post(public.fin_ledger_entry_kind, jsonb, uuid, uuid, text, text, uuid) TO service_role;

-- ============ open a payment intent for a trip ============
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
  v_decision jsonb;
  v_decision_code text;
  v_ref text;
  v_intent public.ride_payment_intents;
  v_channel uuid;
  v_reservation jsonb;
  v_receivable uuid;
  v_invoice uuid;
  v_terms int;
  v_key text;
  v_existing uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  IF NOT (public.is_corporate_member(v_uid, _corporate_id)
          OR public.has_any_role(v_uid, ARRAY['finance_admin','admin','super_admin']::public.app_role[])) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;
  IF _amount_cents IS NULL OR _amount_cents <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;
  IF _requested_mode NOT IN ('CASH','CREDIT') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_mode');
  END IF;

  v_key := COALESCE(_idempotency_key, 'intent:' || COALESCE(_booking_id::text, _trip_request_id::text, gen_random_uuid()::text));

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

    INSERT INTO public.ride_receivables
      (corporate_id, intent_id, amount_cents, due_date, reservation_id, state)
    VALUES (_corporate_id, v_intent.id, _amount_cents, (now() + make_interval(days => COALESCE(v_terms, 30)))::date,
            v_intent.reservation_id, 'OPEN')
    RETURNING id INTO v_receivable;

    INSERT INTO public.corporate_invoices
      (corporate_id, invoice_number, status, subtotal_cents, tax_total_cents, total_cents, balance_cents,
       currency, issued_at, due_at, metadata)
    VALUES (_corporate_id, 'YINV-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(md5(v_ref), 1, 6)),
            'issued', _amount_cents, 0, _amount_cents, _amount_cents, 'KES', now(),
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

  -- everything else is cash-first
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

-- ============ confirm a cash trip from a verified M-Pesa receipt (server only) ============
CREATE OR REPLACE FUNCTION public.corp_payment_confirm_mpesa(
  _reference text,
  _mpesa_receipt text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_intent public.ride_payment_intents;
  v_tx public.mpesa_transactions;
BEGIN
  SELECT * INTO v_intent FROM public.ride_payment_intents WHERE reference = _reference FOR UPDATE;
  IF v_intent.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unknown_reference'); END IF;

  IF v_intent.state = 'PAYMENT_VERIFIED' THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'state', 'PAYMENT_VERIFIED',
      'intent_id', v_intent.id, 'mpesa_receipt', v_intent.mpesa_receipt);
  END IF;
  IF v_intent.state <> 'AWAITING_PAYMENT' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'intent_not_awaiting_payment', 'state', v_intent.state);
  END IF;

  SELECT * INTO v_tx FROM public.mpesa_transactions
   WHERE mpesa_receipt = _mpesa_receipt AND deleted_at IS NULL
   ORDER BY created_at DESC LIMIT 1;
  IF v_tx.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'receipt_not_found');
  END IF;
  IF v_tx.status::text NOT IN ('success','completed','SUCCESS','COMPLETED') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'receipt_not_successful', 'status', v_tx.status);
  END IF;
  IF v_tx.amount_cents < v_intent.amount_cents THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_short',
      'paid_cents', v_tx.amount_cents, 'expected_cents', v_intent.amount_cents);
  END IF;

  UPDATE public.ride_payment_intents
     SET state = 'PAYMENT_VERIFIED', mpesa_receipt = _mpesa_receipt,
         paid_amount_cents = v_tx.amount_cents, verified_at = now(), updated_at = now()
   WHERE id = v_intent.id;

  PERFORM public.fin_ledger_post('PAYMENT', jsonb_build_array(
      jsonb_build_object('account_code','1200','account_name','M-Pesa clearing account','debit_cents',v_tx.amount_cents),
      jsonb_build_object('account_code','1100','account_name','Trade receivables','credit_cents',v_tx.amount_cents)
    ), v_intent.corporate_id, v_intent.id, v_intent.reference,
    'M-Pesa receipt ' || _mpesa_receipt || ' verified', v_intent.correlation_id);

  RETURN jsonb_build_object('ok', true, 'state', 'PAYMENT_VERIFIED', 'intent_id', v_intent.id,
    'paid_cents', v_tx.amount_cents, 'mpesa_receipt', _mpesa_receipt);
END $$;

REVOKE ALL ON FUNCTION public.corp_payment_confirm_mpesa(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.corp_payment_confirm_mpesa(text, text) TO service_role;

-- ============ finance records a real bank / paybill receipt and confirms the trip ============
CREATE OR REPLACE FUNCTION public.fin_record_bank_receipt(
  _channel_id uuid,
  _external_reference text,
  _amount_cents bigint,
  _paid_at timestamptz,
  _payer_reference text DEFAULT NULL,
  _statement_reference text DEFAULT NULL,
  _evidence_note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['finance_admin','admin','super_admin']::public.app_role[]) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;
  IF _amount_cents IS NULL OR _amount_cents <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;
  IF _external_reference IS NULL OR length(trim(_external_reference)) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reference_required');
  END IF;

  INSERT INTO public.fin_bank_receipts
    (channel_id, external_reference, payer_reference, amount_cents, paid_at, statement_reference, evidence_note, recorded_by)
  VALUES (_channel_id, trim(_external_reference), _payer_reference, _amount_cents, COALESCE(_paid_at, now()),
          _statement_reference, _evidence_note, auth.uid())
  ON CONFLICT (channel_id, external_reference) DO UPDATE SET statement_reference = COALESCE(EXCLUDED.statement_reference, public.fin_bank_receipts.statement_reference)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'receipt_id', v_id);
END $$;

REVOKE ALL ON FUNCTION public.fin_record_bank_receipt(uuid, text, bigint, timestamptz, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_record_bank_receipt(uuid, text, bigint, timestamptz, text, text, text) TO authenticated, service_role;

-- ============ reconcile a cash trip against a real received amount ============
CREATE OR REPLACE FUNCTION public.fin_reconcile_intent(
  _intent_id uuid,
  _receipt_id uuid,
  _note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_intent public.ride_payment_intents;
  v_receipt public.fin_bank_receipts;
  v_variance bigint;
  v_state text;
  v_bank_code text;
  v_bank_name text;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['finance_admin','admin','super_admin']::public.app_role[]) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;

  SELECT * INTO v_intent FROM public.ride_payment_intents WHERE id = _intent_id FOR UPDATE;
  IF v_intent.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unknown_intent'); END IF;
  SELECT * INTO v_receipt FROM public.fin_bank_receipts WHERE id = _receipt_id;
  IF v_receipt.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unknown_receipt'); END IF;

  IF EXISTS (SELECT 1 FROM public.fin_reconciliation_matches WHERE intent_id = _intent_id AND receipt_id = _receipt_id) THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;

  v_variance := v_receipt.amount_cents - v_intent.amount_cents;
  v_state := CASE WHEN v_variance = 0 THEN 'MATCHED' ELSE 'VARIANCE' END;

  SELECT CASE WHEN channel_type = 'BANK_ACCOUNT' THEN '1010' ELSE '1200' END,
         CASE WHEN channel_type = 'BANK_ACCOUNT' THEN bank_name || ' bank account ' || account_number
              ELSE 'M-Pesa clearing account' END
    INTO v_bank_code, v_bank_name
    FROM public.yalla_payment_channels WHERE id = v_receipt.channel_id;

  INSERT INTO public.fin_reconciliation_matches
    (intent_id, receipt_id, matched_amount_cents, variance_cents, state, note, reconciled_by)
  VALUES (_intent_id, _receipt_id, v_receipt.amount_cents, v_variance, v_state, _note, auth.uid());

  IF v_intent.state = 'AWAITING_PAYMENT' AND v_receipt.amount_cents >= v_intent.amount_cents THEN
    UPDATE public.ride_payment_intents
       SET state = 'PAYMENT_VERIFIED', paid_amount_cents = v_receipt.amount_cents,
           verified_at = now(), updated_at = now()
     WHERE id = _intent_id;

    PERFORM public.fin_ledger_post('PAYMENT', jsonb_build_array(
        jsonb_build_object('account_code', v_bank_code, 'account_name', v_bank_name, 'debit_cents', v_receipt.amount_cents),
        jsonb_build_object('account_code','1100','account_name','Trade receivables','credit_cents',v_receipt.amount_cents)
      ), v_intent.corporate_id, _intent_id, v_intent.reference,
      'Payment received, reference ' || v_receipt.external_reference, v_intent.correlation_id);
  ELSIF v_intent.state = 'PAYMENT_VERIFIED' AND v_intent.mpesa_receipt IS NOT NULL THEN
    PERFORM public.fin_ledger_post('RECONCILIATION', jsonb_build_array(
        jsonb_build_object('account_code', v_bank_code, 'account_name', v_bank_name, 'debit_cents', v_receipt.amount_cents),
        jsonb_build_object('account_code','1200','account_name','M-Pesa clearing account','credit_cents',v_receipt.amount_cents)
      ), v_intent.corporate_id, _intent_id, v_intent.reference,
      'Settled into the bank account, statement ' || COALESCE(v_receipt.statement_reference, v_receipt.external_reference),
      v_intent.correlation_id);
  END IF;

  RETURN jsonb_build_object('ok', true, 'state', v_state, 'variance_cents', v_variance,
    'intent_state', (SELECT state FROM public.ride_payment_intents WHERE id = _intent_id));
END $$;

REVOKE ALL ON FUNCTION public.fin_reconcile_intent(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_reconcile_intent(uuid, uuid, text) TO authenticated, service_role;

-- ============ lodge a bank guarantee document ============
CREATE OR REPLACE FUNCTION public.corp_guarantee_upload(
  _corporate_id uuid,
  _guarantee_number text,
  _issuing_bank text,
  _legal_entity_name text,
  _guaranteed_amount_cents bigint,
  _issue_date date,
  _effective_date date,
  _expiry_date date,
  _document_storage_path text,
  _document_sha256 text DEFAULT NULL,
  _document_reference text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  IF NOT (public.is_corporate_manager_or_admin(v_uid, _corporate_id)
          OR public.has_any_role(v_uid, ARRAY['finance_admin','admin','super_admin']::public.app_role[])) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;
  IF _guaranteed_amount_cents IS NULL OR _guaranteed_amount_cents <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;
  IF _document_storage_path IS NULL OR length(trim(_document_storage_path)) < 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'document_required');
  END IF;
  IF _expiry_date IS NULL OR _expiry_date <= CURRENT_DATE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'expiry_must_be_in_the_future');
  END IF;
  IF _effective_date IS NULL OR _effective_date > _expiry_date THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_validity_window');
  END IF;

  INSERT INTO public.corporate_bank_guarantees
    (corporate_id, guarantee_number, issuing_bank, beneficiary, legal_entity_name, guaranteed_amount_cents,
     currency, issue_date, effective_date, expiry_date, document_storage_path, document_sha256,
     document_reference, state, external_verification_required, created_by)
  VALUES (_corporate_id, trim(_guarantee_number), trim(_issuing_bank), 'Yalla Beena Limited',
          trim(_legal_entity_name), _guaranteed_amount_cents, 'KES', _issue_date, _effective_date, _expiry_date,
          _document_storage_path, _document_sha256, _document_reference, 'UPLOADED', true, v_uid)
  RETURNING id INTO v_id;

  INSERT INTO public.corporate_bank_guarantee_events (guarantee_id, event_type, from_state, to_state, actor_id, reason)
  VALUES (v_id, 'UPLOADED', NULL, 'UPLOADED', v_uid, 'Guarantee document lodged');

  RETURN jsonb_build_object('ok', true, 'guarantee_id', v_id, 'state', 'UPLOADED');
END $$;

REVOKE ALL ON FUNCTION public.corp_guarantee_upload(uuid, text, text, text, bigint, date, date, date, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corp_guarantee_upload(uuid, text, text, text, bigint, date, date, date, text, text, text) TO authenticated, service_role;

-- finance staff need to read lodged guarantee documents
DROP POLICY IF EXISTS "Finance read corporate guarantee files" ON storage.objects;
CREATE POLICY "Finance read corporate guarantee files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'corporate-documents'
         AND public.has_any_role(auth.uid(), ARRAY['finance_admin','admin','super_admin']::public.app_role[]));

-- ============ company-facing view of its own payment position ============
CREATE OR REPLACE VIEW public.v_corporate_payment_position
WITH (security_invoker = true) AS
SELECT i.corporate_id,
       count(*) FILTER (WHERE i.state = 'AWAITING_PAYMENT') AS awaiting_payment,
       count(*) FILTER (WHERE i.state = 'PAYMENT_VERIFIED') AS paid_trips,
       count(*) FILTER (WHERE i.state = 'CREDIT_AUTHORIZED') AS credit_trips,
       COALESCE(sum(i.amount_cents) FILTER (WHERE i.state = 'AWAITING_PAYMENT'), 0) AS awaiting_cents,
       COALESCE(sum(r.amount_cents - r.settled_cents) FILTER (WHERE r.state IN ('OPEN','INVOICED')), 0) AS outstanding_receivable_cents
  FROM public.ride_payment_intents i
  LEFT JOIN public.ride_receivables r ON r.intent_id = i.id
 WHERE i.corporate_id IS NOT NULL
 GROUP BY i.corporate_id;

GRANT SELECT ON public.v_corporate_payment_position TO authenticated;