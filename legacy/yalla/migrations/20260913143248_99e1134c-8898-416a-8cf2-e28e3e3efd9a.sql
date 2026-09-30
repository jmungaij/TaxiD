-- =====================================================================
-- RENTAL ORCHESTRATION — PHASE 3: LEDGER, RECONCILIATION, REFUNDS
-- =====================================================================

CREATE TABLE public.rental_ledger_accounts (
  account     text PRIMARY KEY,
  label       text NOT NULL,
  normal_side text NOT NULL CHECK (normal_side IN ('DEBIT','CREDIT')),
  note        text
);
GRANT SELECT ON public.rental_ledger_accounts TO authenticated;
GRANT ALL ON public.rental_ledger_accounts TO service_role;
ALTER TABLE public.rental_ledger_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read rental ledger accounts" ON public.rental_ledger_accounts
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_staff_permission('staff.finance.read')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

INSERT INTO public.rental_ledger_accounts (account, label, normal_side, note) VALUES
 ('CUSTOMER_RECEIVABLE','Customer receivable','DEBIT','What the customer owes for a rental.'),
 ('CASH_MPESA','Cash — M-Pesa','DEBIT','Only credited from a verified provider record.'),
 ('RENTAL_REVENUE','Rental revenue','CREDIT','Net of VAT.'),
 ('VAT_PAYABLE','VAT payable','CREDIT','Tax element of the quotation.'),
 ('DEPOSIT_HELD','Security deposit held','CREDIT','Deposit rules are POLICY_REQUIRED — unused until defined.'),
 ('PROVIDER_PAYABLE','Provider payable','CREDIT','Owed to a third-party rental provider.'),
 ('COMMISSION_REVENUE','Yalla commission revenue','CREDIT','Requires an agreed provider commission rate.'),
 ('FEES_REVENUE','Fees and charges','CREDIT','Late return, excess mileage — POLICY_REQUIRED.'),
 ('REFUND_PAYABLE','Refund payable','CREDIT','Raised only by an authorised human decision.'),
 ('ADJUSTMENTS','Adjustments','DEBIT','Corrections, always paired and never a silent edit.');

CREATE TABLE public.rental_ledger_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type     text NOT NULL CHECK (entry_type IN
                   ('CHARGE','PAYMENT','REFUND','DEPOSIT_HELD','DEPOSIT_RELEASED',
                    'FEE','PROVIDER_PAYABLE','COMMISSION','ADJUSTMENT','REVERSAL')),
  booking_id     uuid REFERENCES public.rental_bookings(id) ON DELETE RESTRICT,
  quote_id       uuid REFERENCES public.rental_quote_requests(id) ON DELETE RESTRICT,
  correlation_id uuid,
  source_ref     text NOT NULL,
  memo           text,
  currency       text NOT NULL DEFAULT 'KES',
  posted_at      timestamptz NOT NULL DEFAULT now(),
  posted_by      uuid,
  UNIQUE (entry_type, source_ref)
);
COMMENT ON TABLE public.rental_ledger_entries IS
  'Append-only rental ledger. (entry_type, source_ref) is unique so a replayed callback cannot double-post.';
CREATE INDEX idx_rental_ledger_entries_booking ON public.rental_ledger_entries (booking_id, posted_at);

GRANT SELECT ON public.rental_ledger_entries TO authenticated;
GRANT ALL ON public.rental_ledger_entries TO service_role;
ALTER TABLE public.rental_ledger_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read rental ledger entries" ON public.rental_ledger_entries
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_staff_permission('staff.finance.read')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE TABLE public.rental_ledger_lines (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id   uuid NOT NULL REFERENCES public.rental_ledger_entries(id) ON DELETE CASCADE,
  account    text NOT NULL REFERENCES public.rental_ledger_accounts(account),
  direction  text NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  amount_kes numeric(14,2) NOT NULL CHECK (amount_kes > 0),
  detail     jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX idx_rental_ledger_lines_entry ON public.rental_ledger_lines (entry_id);
GRANT SELECT ON public.rental_ledger_lines TO authenticated;
GRANT ALL ON public.rental_ledger_lines TO service_role;
ALTER TABLE public.rental_ledger_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read rental ledger lines" ON public.rental_ledger_lines
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_staff_permission('staff.finance.read')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- Immutability: postings are never edited or deleted.
CREATE OR REPLACE FUNCTION public._rental_ledger_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'RENTAL_LEDGER_IS_APPEND_ONLY — post a REVERSAL instead'; END; $$;
REVOKE ALL ON FUNCTION public._rental_ledger_immutable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._rental_ledger_immutable() TO service_role;
CREATE TRIGGER trg_rental_ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON public.rental_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public._rental_ledger_immutable();
CREATE TRIGGER trg_rental_ledger_lines_immutable
  BEFORE UPDATE OR DELETE ON public.rental_ledger_lines
  FOR EACH ROW EXECUTE FUNCTION public._rental_ledger_immutable();

-- Every entry must balance. Checked at transaction end, so an unbalanced
-- posting can never be committed by any code path.
CREATE OR REPLACE FUNCTION public._rental_ledger_balanced()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE dr numeric(14,2); cr numeric(14,2);
BEGIN
  SELECT coalesce(sum(CASE WHEN direction='DEBIT'  THEN amount_kes END),0),
         coalesce(sum(CASE WHEN direction='CREDIT' THEN amount_kes END),0)
    INTO dr, cr
    FROM public.rental_ledger_lines WHERE entry_id = NEW.entry_id;
  IF dr <> cr THEN
    RAISE EXCEPTION 'RENTAL_LEDGER_ENTRY_NOT_BALANCED: debit % <> credit %', dr, cr;
  END IF;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public._rental_ledger_balanced() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._rental_ledger_balanced() TO service_role;
CREATE CONSTRAINT TRIGGER trg_rental_ledger_balanced
  AFTER INSERT ON public.rental_ledger_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public._rental_ledger_balanced();

-- ------------------------------------------------------ posting API
CREATE OR REPLACE FUNCTION public.rental_ledger_post(
  _entry_type text, _source_ref text, _lines jsonb,
  _booking_id uuid DEFAULT NULL, _quote_id uuid DEFAULT NULL,
  _correlation_id uuid DEFAULT NULL, _memo text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE e public.rental_ledger_entries; l jsonb;
BEGIN
  INSERT INTO public.rental_ledger_entries
    (entry_type, source_ref, booking_id, quote_id, correlation_id, memo)
  VALUES (upper(_entry_type), _source_ref, _booking_id, _quote_id, _correlation_id, _memo)
  ON CONFLICT (entry_type, source_ref) DO NOTHING
  RETURNING * INTO e;

  IF e.id IS NULL THEN
    SELECT * INTO e FROM public.rental_ledger_entries
     WHERE entry_type = upper(_entry_type) AND source_ref = _source_ref;
    RETURN jsonb_build_object('ok', true, 'replay', true, 'entry_id', e.id);
  END IF;

  FOR l IN SELECT * FROM jsonb_array_elements(coalesce(_lines,'[]'::jsonb)) LOOP
    INSERT INTO public.rental_ledger_lines (entry_id, account, direction, amount_kes, detail)
    VALUES (e.id, l ->> 'account', upper(l ->> 'direction'),
            round((l ->> 'amount_kes')::numeric, 2), coalesce(l -> 'detail','{}'::jsonb));
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'replay', false, 'entry_id', e.id);
END; $$;
REVOKE ALL ON FUNCTION public.rental_ledger_post(text,text,jsonb,uuid,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_ledger_post(text,text,jsonb,uuid,uuid,uuid,text) TO service_role;

-- Charge + payment for a settled rental. Idempotent on the quote reference.
CREATE OR REPLACE FUNCTION public.rental_ledger_post_settlement(_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.rental_quote_requests; b public.rental_bookings;
        net numeric(14,2); charge jsonb; pay jsonb;
BEGIN
  SELECT * INTO q FROM public.rental_quote_requests WHERE id = _quote_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason_code','QUOTE_NOT_FOUND'); END IF;
  SELECT * INTO b FROM public.rental_bookings WHERE quote_id = q.id;

  net := round(q.total_kes - coalesce(q.vat_kes,0), 2);

  charge := public.rental_ledger_post('CHARGE', q.reference,
    jsonb_build_array(
      jsonb_build_object('account','CUSTOMER_RECEIVABLE','direction','DEBIT','amount_kes', q.total_kes),
      jsonb_build_object('account','RENTAL_REVENUE','direction','CREDIT','amount_kes', net),
      jsonb_build_object('account','VAT_PAYABLE','direction','CREDIT','amount_kes', round(coalesce(q.vat_kes,0),2))
    ), b.id, q.id, q.correlation_id, 'Rental charge at accepted quotation terms');

  pay := public.rental_ledger_post('PAYMENT', coalesce(q.mpesa_receipt, q.reference || ':payment'),
    jsonb_build_array(
      jsonb_build_object('account','CASH_MPESA','direction','DEBIT','amount_kes', q.amount_paid_kes),
      jsonb_build_object('account','CUSTOMER_RECEIVABLE','direction','CREDIT','amount_kes', q.amount_paid_kes)
    ), b.id, q.id, q.correlation_id, 'Verified M-Pesa payment');

  RETURN jsonb_build_object('ok', true, 'charge', charge, 'payment', pay);
END; $$;
REVOKE ALL ON FUNCTION public.rental_ledger_post_settlement(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_ledger_post_settlement(uuid) TO service_role;

-- ------------------------------------------------------------ refunds
CREATE TABLE public.rental_refunds (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     uuid NOT NULL REFERENCES public.rental_bookings(id) ON DELETE RESTRICT,
  correlation_id uuid,
  amount_kes     numeric(14,2),
  reason         text NOT NULL,
  state          text NOT NULL DEFAULT 'REQUESTED'
                   CHECK (state IN ('REQUESTED','POLICY_REQUIRED','AUTHORISED','PAID','DECLINED','FAILED')),
  policy_basis   text,
  requested_by   uuid,
  authorised_by  uuid,
  authorised_at  timestamptz,
  paid_reference text,
  paid_at        timestamptz,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.rental_refunds IS
  'Refund lifecycle. An amount is only ever set by an authorised human — there is no automatic refund percentage because no refund policy has been defined.';
GRANT SELECT ON public.rental_refunds TO authenticated;
GRANT ALL ON public.rental_refunds TO service_role;
ALTER TABLE public.rental_refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read rental refunds" ON public.rental_refunds
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_staff_permission('staff.finance.read')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE TRIGGER trg_rental_refunds_touch BEFORE UPDATE ON public.rental_refunds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------- reconciliation view
CREATE OR REPLACE VIEW public.v_rental_reconciliation
WITH (security_invoker = true) AS
SELECT b.booking_reference,
       q.reference                                   AS quote_reference,
       b.status                                      AS booking_status,
       b.total_kes,
       b.amount_paid_kes,
       coalesce(led.cash_kes, 0)                     AS ledger_cash_kes,
       coalesce(led.receivable_kes, 0)               AS ledger_receivable_kes,
       coalesce(prov.verified_kes, 0)                AS provider_verified_kes,
       coalesce(prov.verified_payments, 0)           AS verified_payment_count,
       CASE
         WHEN coalesce(prov.verified_payments,0) = 0 THEN 'NO_VERIFIED_PAYMENT'
         WHEN coalesce(prov.verified_payments,0) > 1 THEN 'DUPLICATE_PROVIDER_PAYMENT'
         WHEN round(coalesce(led.cash_kes,0),2) <> round(coalesce(prov.verified_kes,0),2) THEN 'LEDGER_VS_PROVIDER_MISMATCH'
         WHEN round(b.amount_paid_kes,2) <> round(coalesce(led.cash_kes,0),2) THEN 'BOOKING_VS_LEDGER_MISMATCH'
         WHEN round(b.amount_paid_kes,2) < round(b.total_kes,2) THEN 'UNDERPAID'
         ELSE 'RECONCILED'
       END                                           AS reconciliation_state,
       b.created_at
  FROM public.rental_bookings b
  JOIN public.rental_quote_requests q ON q.id = b.quote_id
  LEFT JOIN (
    SELECT e.booking_id,
           sum(CASE WHEN li.account='CASH_MPESA' AND li.direction='DEBIT' THEN li.amount_kes ELSE 0 END) AS cash_kes,
           sum(CASE WHEN li.account='CUSTOMER_RECEIVABLE' AND li.direction='DEBIT' THEN li.amount_kes
                    WHEN li.account='CUSTOMER_RECEIVABLE' AND li.direction='CREDIT' THEN -li.amount_kes ELSE 0 END) AS receivable_kes
      FROM public.rental_ledger_entries e
      JOIN public.rental_ledger_lines li ON li.entry_id = e.id
     GROUP BY e.booking_id
  ) led ON led.booking_id = b.id
  LEFT JOIN (
    SELECT upper(coalesce(t.account_reference,'')) AS ref,
           count(*) AS verified_payments,
           sum(round(t.amount_cents::numeric/100,2)) AS verified_kes
      FROM public.mpesa_transactions t
     WHERE t.status = 'SUCCESS' AND t.deleted_at IS NULL
     GROUP BY 1
  ) prov ON prov.ref = q.reference;

GRANT SELECT ON public.v_rental_reconciliation TO authenticated;

-- Reconciliation sweep: raises a human exception on every break.
CREATE OR REPLACE FUNCTION public.rental_reconciliation_sweep()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; breaks int := 0; checked int := 0;
BEGIN
  FOR r IN
    SELECT v.booking_reference, v.reconciliation_state, v.total_kes, v.amount_paid_kes,
           v.ledger_cash_kes, v.provider_verified_kes, b.id AS booking_id, b.correlation_id
      FROM public.v_rental_reconciliation v
      JOIN public.rental_bookings b ON b.booking_reference = v.booking_reference
     WHERE b.status <> 'CANCELLED'
     LIMIT 500
  LOOP
    checked := checked + 1;
    IF r.reconciliation_state <> 'RECONCILED' THEN
      PERFORM public.rental_exception_open('RECONCILIATION_BREAK','booking', r.booking_id,
        r.booking_reference, r.correlation_id,
        jsonb_build_object('reconciliation_state', r.reconciliation_state,
                           'total_kes', r.total_kes, 'amount_paid_kes', r.amount_paid_kes,
                           'ledger_cash_kes', r.ledger_cash_kes,
                           'provider_verified_kes', r.provider_verified_kes));
      breaks := breaks + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'bookings_checked', checked, 'breaks_raised', breaks, 'swept_at', now());
END; $$;
REVOKE ALL ON FUNCTION public.rental_reconciliation_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_reconciliation_sweep() TO service_role;

-- ------------------------- settlement now posts to the ledger too
CREATE OR REPLACE FUNCTION public.rental_quote_settle_payment(
  _reference text, _checkout_request_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.rental_quote_requests; t public.mpesa_transactions;
        paid_kes numeric(14,2); alloc jsonb; verified int; run uuid;
BEGIN
  SELECT * INTO q FROM public.rental_quote_requests
   WHERE reference = upper(coalesce(_reference,'')) FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('settled', false, 'reason_code', 'QUOTE_NOT_FOUND');
  END IF;

  IF q.payment_status = 'paid' THEN
    alloc := public.rental_allocate_for_quote(q.id);
    PERFORM public.rental_ledger_post_settlement(q.id);
    RETURN jsonb_build_object('settled', true, 'reason_code', 'ALREADY_SETTLED',
      'reference', q.reference, 'booking_reference', alloc ->> 'booking_reference',
      'booking_status', alloc ->> 'status');
  END IF;

  run := public.rental_saga_start('QUOTE_TO_BOOKING','quote', q.id, q.reference, q.correlation_id);

  SELECT count(*) INTO verified FROM public.mpesa_transactions
   WHERE status = 'SUCCESS' AND deleted_at IS NULL
     AND upper(coalesce(account_reference,'')) = q.reference;

  IF verified > 1 THEN
    PERFORM public.rental_saga_record_step(run,'VERIFY_PAYMENT','FAILED',NULL,
      jsonb_build_object('verified_payments', verified));
    PERFORM public.rental_saga_close(run,'ESCALATED','DUPLICATE_PAYMENT');
    PERFORM public.rental_exception_open('DUPLICATE_PAYMENT','quote', q.id, q.reference, q.correlation_id,
      jsonb_build_object('verified_payments', verified), run);
    RETURN jsonb_build_object('settled', false, 'reason_code', 'DUPLICATE_PAYMENT_REQUIRES_FINANCE',
      'reference', q.reference);
  END IF;

  SELECT * INTO t FROM public.mpesa_transactions
   WHERE status = 'SUCCESS' AND deleted_at IS NULL
     AND upper(coalesce(account_reference,'')) = q.reference
     AND (_checkout_request_id IS NULL OR checkout_request_id = _checkout_request_id)
   ORDER BY created_at DESC LIMIT 1;

  IF NOT FOUND THEN
    PERFORM public.rental_saga_record_step(run,'VERIFY_PAYMENT','FAILED',NULL,
      jsonb_build_object('reason','NO_VERIFIED_PAYMENT'));
    PERFORM public.rental_saga_close(run,'COMPENSATED','NO_VERIFIED_PAYMENT');
    RETURN jsonb_build_object('settled', false, 'reason_code', 'NO_VERIFIED_PAYMENT', 'reference', q.reference);
  END IF;

  paid_kes := round(t.amount_cents::numeric / 100, 2);
  IF paid_kes < q.total_kes THEN
    INSERT INTO public.rental_quote_events (quote_id, event_type, detail)
    VALUES (q.id, 'PAYMENT_SHORTFALL', jsonb_build_object('amount_paid_kes', paid_kes, 'total_kes', q.total_kes));
    PERFORM public.rental_saga_record_step(run,'VERIFY_PAYMENT','FAILED',NULL,
      jsonb_build_object('amount_paid_kes', paid_kes, 'total_kes', q.total_kes));
    PERFORM public.rental_saga_close(run,'ESCALATED','PAYMENT_SHORTFALL');
    PERFORM public.rental_exception_open('PAYMENT_SHORTFALL','quote', q.id, q.reference, q.correlation_id,
      jsonb_build_object('amount_paid_kes', paid_kes, 'total_kes', q.total_kes), run);
    RETURN jsonb_build_object('settled', false, 'reason_code', 'AMOUNT_SHORTFALL',
      'reference', q.reference, 'amount_paid_kes', paid_kes, 'total_kes', q.total_kes);
  END IF;

  UPDATE public.rental_quote_requests
     SET payment_status = 'paid', status = 'CONFIRMED', amount_paid_kes = paid_kes,
         mpesa_receipt = t.mpesa_receipt, paid_at = coalesce(t.updated_at, now())
   WHERE id = q.id
   RETURNING * INTO q;

  INSERT INTO public.rental_quote_events (quote_id, event_type, detail)
  VALUES (q.id, 'PAYMENT_CONFIRMED', jsonb_build_object(
    'amount_paid_kes', paid_kes, 'mpesa_receipt', t.mpesa_receipt,
    'checkout_request_id', t.checkout_request_id));
  PERFORM public.rental_saga_record_step(run,'VERIFY_PAYMENT','DONE',NULL,
    jsonb_build_object('mpesa_receipt', t.mpesa_receipt));
  PERFORM public.rental_emit_event('PaymentVerified','quote', q.id, q.reference, q.correlation_id,
    jsonb_build_object('amount_paid_kes', paid_kes, 'mpesa_receipt', t.mpesa_receipt),
    NULL, NULL, coalesce(t.mpesa_receipt,'payment'));

  alloc := public.rental_allocate_for_quote(q.id);
  PERFORM public.rental_saga_record_step(run,'ALLOCATE_VEHICLE',
    CASE WHEN (alloc ->> 'unit_id') IS NULL THEN 'FAILED' ELSE 'DONE' END, NULL, alloc);

  PERFORM public.rental_ledger_post_settlement(q.id);
  PERFORM public.rental_saga_record_step(run,'POST_LEDGER','DONE',NULL,
    jsonb_build_object('total_kes', q.total_kes, 'amount_paid_kes', paid_kes));

  IF (alloc ->> 'unit_id') IS NULL THEN
    PERFORM public.rental_saga_close(run,'ESCALATED','ALLOCATION_PENDING');
    PERFORM public.rental_exception_open('ALLOCATION_PENDING','booking',
      NULL, alloc ->> 'booking_reference', q.correlation_id,
      jsonb_build_object('quote_reference', q.reference), run);
  ELSE
    PERFORM public.rental_saga_close(run,'COMPLETED');
    PERFORM public.rental_emit_event('BookingConfirmed','booking', NULL, alloc ->> 'booking_reference',
      q.correlation_id, jsonb_build_object('quote_reference', q.reference, 'unit_id', alloc ->> 'unit_id'),
      NULL, NULL, 'confirm');
  END IF;

  RETURN jsonb_build_object('settled', true, 'reason_code', 'SETTLED', 'reference', q.reference,
    'amount_paid_kes', paid_kes, 'mpesa_receipt', t.mpesa_receipt,
    'booking_reference', alloc ->> 'booking_reference', 'booking_status', alloc ->> 'status',
    'correlation_id', q.correlation_id);
END; $$;
REVOKE ALL ON FUNCTION public.rental_quote_settle_payment(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_quote_settle_payment(text, text) TO service_role;