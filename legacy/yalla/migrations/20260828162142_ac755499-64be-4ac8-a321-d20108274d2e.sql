-- =========================================================================
-- PHASE 7 ENGINES — server-authoritative freight financial operations
-- =========================================================================

CREATE OR REPLACE FUNCTION public._freight_fin_guard(_perm text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF current_setting('role', true) = 'service_role' THEN RETURN uid; END IF;
  IF uid IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF NOT public.has_staff_permission(_perm) THEN
    RAISE EXCEPTION 'permission denied: % required', _perm;
  END IF;
  RETURN uid;
END $$;
REVOKE ALL ON FUNCTION public._freight_fin_guard(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._freight_fin_guard(text) TO service_role;

-- ------------------------------------------------------------------ charges
CREATE OR REPLACE FUNCTION public.freight_charge_create(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := public._freight_fin_guard('staff.finance.charge.manage');
  key text := coalesce(p->>'idempotency_key', '');
  existing public.freight_charges%ROWTYPE;
  qty numeric := coalesce((p->>'quantity')::numeric, 1);
  rate numeric := coalesce((p->>'unit_rate')::numeric, 0);
  amt numeric;
  tax numeric := coalesce((p->>'tax_amount')::numeric, 0);
  rl public.carrier_rate_lines%ROWTYPE;
  newid uuid;
  num text;
BEGIN
  IF key = '' THEN RAISE EXCEPTION 'idempotency_key is required'; END IF;
  SELECT * INTO existing FROM public.freight_charges WHERE idempotency_key = key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'charge_id', existing.id,
                              'charge_number', existing.charge_number, 'amount', existing.amount);
  END IF;

  -- Server-authoritative rate: when a rate line is given it overrides any client rate.
  IF (p->>'rate_line_id') IS NOT NULL THEN
    SELECT * INTO rl FROM public.carrier_rate_lines WHERE id = (p->>'rate_line_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'rate line % not found', p->>'rate_line_id'; END IF;
    rate := rl.unit_rate;
    amt := greatest(round(rate * qty, 2), rl.minimum_charge);
  ELSE
    amt := round(rate * qty, 2);
  END IF;

  num := 'FCH-' || to_char(now(),'YYYYMM') || '-' || lpad(nextval('public.freight_charge_seq')::text, 6, '0');

  INSERT INTO public.freight_charges (
    charge_number, party, status, customer_user_id, corporate_account_id, carrier_id,
    order_id, package_id, booking_id, award_id, manifest_id, route_id, stop_id,
    quote_id, rate_card_id, rate_line_id, charge_code, basis, quantity, unit_rate,
    amount, tax_amount, currency, commercial_snapshot, operational_evidence,
    reason_code, correlation_id, request_id, idempotency_key, created_by)
  VALUES (
    num, (p->>'party')::public.freight_charge_party, 'CALCULATED',
    nullif(p->>'customer_user_id','')::uuid, nullif(p->>'corporate_account_id','')::uuid,
    nullif(p->>'carrier_id','')::uuid, nullif(p->>'order_id','')::uuid,
    nullif(p->>'package_id','')::uuid, nullif(p->>'booking_id','')::uuid,
    nullif(p->>'award_id','')::uuid, nullif(p->>'manifest_id','')::uuid,
    nullif(p->>'route_id','')::uuid, nullif(p->>'stop_id','')::uuid,
    nullif(p->>'quote_id','')::uuid, nullif(p->>'rate_card_id','')::uuid,
    nullif(p->>'rate_line_id','')::uuid, coalesce(p->>'charge_code','FREIGHT'),
    (p->>'basis')::public.freight_pricing_basis, qty, rate, amt, tax,
    coalesce(p->>'currency','KES'),
    coalesce(p->'commercial_snapshot','{}'::jsonb) ||
      jsonb_build_object('captured_at', now(), 'rate_line', to_jsonb(rl)),
    coalesce(p->'operational_evidence','{}'::jsonb),
    p->>'reason_code', coalesce(nullif(p->>'correlation_id','')::uuid, gen_random_uuid()),
    p->>'request_id', key, actor)
  RETURNING id INTO newid;

  INSERT INTO public.freight_charge_events (charge_id, from_status, to_status, reason_code, note, actor_id, detail)
  VALUES (newid, NULL, 'CALCULATED', p->>'reason_code', 'charge calculated', actor,
          jsonb_build_object('amount', amt, 'basis', p->>'basis'));

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'charge_id', newid,
                            'charge_number', num, 'amount', amt);
END $$;

CREATE OR REPLACE FUNCTION public.freight_charge_transition(
  _charge_id uuid, _to public.freight_charge_status, _reason_code text DEFAULT NULL, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := public._freight_fin_guard('staff.finance.charge.manage');
  c public.freight_charges%ROWTYPE;
  allowed public.freight_charge_status[];
BEGIN
  SELECT * INTO c FROM public.freight_charges WHERE id = _charge_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'charge not found'; END IF;
  IF c.status = _to THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'status', c.status);
  END IF;

  allowed := CASE c.status
    WHEN 'CALCULATED' THEN ARRAY['PENDING_REVIEW','APPROVED','VOID']::public.freight_charge_status[]
    WHEN 'PENDING_REVIEW' THEN ARRAY['APPROVED','VOID']::public.freight_charge_status[]
    WHEN 'APPROVED' THEN ARRAY['INVOICED','VOID']::public.freight_charge_status[]
    WHEN 'INVOICED' THEN ARRAY['PAID','VOID']::public.freight_charge_status[]
    WHEN 'PAID' THEN ARRAY['SETTLED']::public.freight_charge_status[]
    ELSE ARRAY[]::public.freight_charge_status[] END;

  IF NOT (_to = ANY(allowed)) THEN
    RAISE EXCEPTION 'illegal charge transition % -> %', c.status, _to;
  END IF;
  IF _to = 'VOID' AND coalesce(_reason_code,'') = '' THEN
    RAISE EXCEPTION 'void requires a reason code';
  END IF;

  UPDATE public.freight_charges
     SET status = _to,
         approved_by = CASE WHEN _to = 'APPROVED' THEN actor ELSE approved_by END,
         approved_at = CASE WHEN _to = 'APPROVED' THEN now() ELSE approved_at END,
         voided_at = CASE WHEN _to = 'VOID' THEN now() ELSE voided_at END,
         reason_code = coalesce(_reason_code, reason_code)
   WHERE id = _charge_id;

  INSERT INTO public.freight_charge_events (charge_id, from_status, to_status, reason_code, note, actor_id, correlation_id)
  VALUES (_charge_id, c.status, _to, _reason_code, _note, actor, c.correlation_id);

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'status', _to);
END $$;

CREATE OR REPLACE FUNCTION public.freight_charge_adjust(
  _charge_id uuid, _kind text, _amount numeric, _reason_code text,
  _reason_note text DEFAULT NULL, _idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := public._freight_fin_guard('staff.finance.charge.manage');
  key text := coalesce(_idempotency_key, 'adj:' || _charge_id || ':' || _kind || ':' || _amount || ':' || _reason_code);
  ex public.freight_charge_adjustments%ROWTYPE;
  newid uuid;
BEGIN
  IF coalesce(_reason_code,'') = '' THEN RAISE EXCEPTION 'reason code required'; END IF;
  IF _amount IS NULL OR _amount = 0 THEN RAISE EXCEPTION 'adjustment amount must be non-zero'; END IF;
  SELECT * INTO ex FROM public.freight_charge_adjustments WHERE idempotency_key = key;
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'duplicate', true, 'adjustment_id', ex.id); END IF;

  INSERT INTO public.freight_charge_adjustments
    (charge_id, kind, amount, reason_code, reason_note, requested_by, idempotency_key,
     correlation_id, currency)
  SELECT _charge_id, _kind, _amount, _reason_code, _reason_note, actor, key, c.correlation_id, c.currency
    FROM public.freight_charges c WHERE c.id = _charge_id
  RETURNING id INTO newid;
  IF newid IS NULL THEN RAISE EXCEPTION 'charge not found'; END IF;

  INSERT INTO public.freight_charge_events (charge_id, from_status, to_status, reason_code, note, actor_id, detail)
  SELECT _charge_id, c.status, c.status, _reason_code, 'adjustment requested', actor,
         jsonb_build_object('kind', _kind, 'amount', _amount)
    FROM public.freight_charges c WHERE c.id = _charge_id;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'adjustment_id', newid, 'status', 'PENDING');
END $$;

CREATE OR REPLACE FUNCTION public.freight_adjustment_approve(_adjustment_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := public._freight_fin_guard('staff.finance.settlement.approve');
  a public.freight_charge_adjustments%ROWTYPE;
  delta numeric;
BEGIN
  SELECT * INTO a FROM public.freight_charge_adjustments WHERE id = _adjustment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'adjustment not found'; END IF;
  IF a.status <> 'PENDING' THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'status', a.status);
  END IF;
  IF a.requested_by = actor THEN
    RAISE EXCEPTION 'four-eyes: the requester cannot approve their own adjustment';
  END IF;

  UPDATE public.freight_charge_adjustments
     SET status = CASE WHEN _approve THEN 'APPROVED' ELSE 'REJECTED' END,
         approved_by = actor, approved_at = now()
   WHERE id = _adjustment_id;

  IF _approve THEN
    delta := CASE WHEN a.kind = 'CREDIT' THEN -abs(a.amount)
                  WHEN a.kind = 'REVERSAL' THEN -abs(a.amount)
                  ELSE abs(a.amount) END;
    UPDATE public.freight_charges SET amount = amount + delta WHERE id = a.charge_id;
  END IF;

  INSERT INTO public.freight_charge_events (charge_id, from_status, to_status, reason_code, note, actor_id, detail)
  SELECT a.charge_id, c.status, c.status, a.reason_code,
         coalesce(_note, CASE WHEN _approve THEN 'adjustment approved' ELSE 'adjustment rejected' END),
         actor, jsonb_build_object('adjustment_id', a.id, 'approved', _approve, 'delta', delta)
    FROM public.freight_charges c WHERE c.id = a.charge_id;

  RETURN jsonb_build_object('ok', true, 'duplicate', false,
                            'status', CASE WHEN _approve THEN 'APPROVED' ELSE 'REJECTED' END);
END $$;

-- ----------------------------------------------------------------- invoices
CREATE OR REPLACE FUNCTION public.freight_invoice_build(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := public._freight_fin_guard('staff.finance.invoice.manage');
  key text := coalesce(p->>'idempotency_key','');
  ex public.freight_invoices%ROWTYPE;
  inv_id uuid; num text; n integer := 0;
  sub numeric := 0; tax numeric := 0;
  ids uuid[] := ARRAY(SELECT (jsonb_array_elements_text(p->'charge_ids'))::uuid);
  c public.freight_charges%ROWTYPE;
BEGIN
  IF key = '' THEN RAISE EXCEPTION 'idempotency_key is required'; END IF;
  SELECT * INTO ex FROM public.freight_invoices WHERE idempotency_key = key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'invoice_id', ex.id,
                              'invoice_number', ex.invoice_number, 'total', ex.total);
  END IF;
  IF coalesce(array_length(ids,1),0) = 0 THEN RAISE EXCEPTION 'no charges supplied'; END IF;

  num := (SELECT coalesce(value->>'prefix','FIN') FROM public.freight_billing_config WHERE key='invoice.numbering')
         || '-' || to_char(now(),'YYYYMM') || '-'
         || lpad(nextval('public.freight_invoice_seq')::text, 6, '0');

  INSERT INTO public.freight_invoices
    (invoice_number, party, status, customer_user_id, corporate_account_id, carrier_id,
     currency, period_start, period_end, due_at, idempotency_key, created_by)
  VALUES (num, coalesce((p->>'party')::public.freight_charge_party,'CUSTOMER'), 'DRAFT',
          nullif(p->>'customer_user_id','')::uuid, nullif(p->>'corporate_account_id','')::uuid,
          nullif(p->>'carrier_id','')::uuid, coalesce(p->>'currency','KES'),
          nullif(p->>'period_start','')::date, nullif(p->>'period_end','')::date,
          nullif(p->>'due_at','')::timestamptz, key, actor)
  RETURNING id INTO inv_id;

  FOREACH inv_id IN ARRAY ARRAY[inv_id] LOOP END LOOP; -- keep inv_id scope explicit

  FOR c IN SELECT * FROM public.freight_charges WHERE id = ANY(ids) ORDER BY created_at LOOP
    IF c.status <> 'APPROVED' THEN
      RAISE EXCEPTION 'charge % is % — only APPROVED charges can be invoiced', c.charge_number, c.status;
    END IF;
    IF c.invoice_id IS NOT NULL THEN
      RAISE EXCEPTION 'charge % is already invoiced (duplicate shipment billing refused)', c.charge_number;
    END IF;
    n := n + 1;
    INSERT INTO public.freight_invoice_lines
      (invoice_id, line_no, charge_id, description, quantity, unit_rate, amount, tax_amount, lineage)
    VALUES (inv_id, n, c.id,
            c.charge_code || ' · ' || c.basis::text, c.quantity, c.unit_rate, c.amount, c.tax_amount,
            jsonb_build_object('charge_id', c.id, 'charge_number', c.charge_number,
                               'quote_id', c.quote_id, 'rate_card_id', c.rate_card_id,
                               'rate_line_id', c.rate_line_id, 'booking_id', c.booking_id,
                               'package_id', c.package_id, 'order_id', c.order_id,
                               'manifest_id', c.manifest_id,
                               'commercial_snapshot', c.commercial_snapshot,
                               'operational_evidence', c.operational_evidence));
    sub := sub + c.amount;
    tax := tax + c.tax_amount;
    UPDATE public.freight_charges SET invoice_id = inv_id WHERE id = c.id;
    PERFORM public.freight_charge_transition(c.id, 'INVOICED', 'invoiced', num);
  END LOOP;

  UPDATE public.freight_invoices
     SET subtotal = sub, tax_total = tax, total = sub + tax
   WHERE id = inv_id;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'invoice_id', inv_id,
                            'invoice_number', num, 'lines', n, 'total', sub + tax);
END $$;

CREATE OR REPLACE FUNCTION public.freight_invoice_issue(_invoice_id uuid, _due_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := public._freight_fin_guard('staff.finance.invoice.manage');
  i public.freight_invoices%ROWTYPE;
BEGIN
  SELECT * INTO i FROM public.freight_invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;
  IF i.status <> 'DRAFT' THEN RETURN jsonb_build_object('ok', true, 'duplicate', true, 'status', i.status); END IF;
  IF i.total <= 0 THEN RAISE EXCEPTION 'cannot issue an invoice with no value'; END IF;
  UPDATE public.freight_invoices
     SET status='ISSUED', issued_at=now(), due_at=coalesce(_due_at, due_at, now() + interval '14 days')
   WHERE id=_invoice_id;
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'status', 'ISSUED');
END $$;

CREATE OR REPLACE FUNCTION public.freight_invoice_void(_invoice_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := public._freight_fin_guard('staff.finance.invoice.manage');
  i public.freight_invoices%ROWTYPE;
BEGIN
  IF coalesce(_reason,'') = '' THEN RAISE EXCEPTION 'void reason required'; END IF;
  SELECT * INTO i FROM public.freight_invoices WHERE id=_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;
  IF i.status = 'VOID' THEN RETURN jsonb_build_object('ok', true, 'duplicate', true); END IF;
  IF i.paid_total > 0 THEN RAISE EXCEPTION 'cannot void an invoice with allocated payments — reverse the allocation first'; END IF;
  UPDATE public.freight_invoices SET status='VOID', voided_at=now(), void_reason=_reason WHERE id=_invoice_id;
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'status','VOID');
END $$;

-- ------------------------------------------------- payment allocation (M-Pesa authority is external)
CREATE OR REPLACE FUNCTION public.freight_payment_allocate(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := public._freight_fin_guard('staff.finance.payment.allocate');
  key text := coalesce(p->>'idempotency_key','');
  ex public.freight_payment_allocations%ROWTYPE;
  inv public.freight_invoices%ROWTYPE;
  amt numeric := (p->>'amount')::numeric;
  attempt public.payment_attempts%ROWTYPE;
  mtx public.mpesa_transactions%ROWTYPE;
  provider_status text;
  outstanding numeric;
  st public.freight_alloc_state;
  newid uuid;
BEGIN
  IF key = '' THEN RAISE EXCEPTION 'idempotency_key is required'; END IF;
  SELECT * INTO ex FROM public.freight_payment_allocations WHERE idempotency_key = key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'allocation_id', ex.id, 'state', ex.state);
  END IF;
  IF amt IS NULL OR amt <= 0 THEN RAISE EXCEPTION 'allocation amount must be positive'; END IF;

  -- Read-only consumption of the existing payment authority. Never mutated here.
  IF (p->>'payment_attempt_id') IS NOT NULL THEN
    SELECT * INTO attempt FROM public.payment_attempts WHERE id = (p->>'payment_attempt_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'payment attempt not found in the payment authority'; END IF;
    provider_status := attempt.state;
  END IF;
  IF (p->>'mpesa_transaction_id') IS NOT NULL THEN
    SELECT * INTO mtx FROM public.mpesa_transactions WHERE id = (p->>'mpesa_transaction_id')::uuid;
    IF NOT FOUND THEN RAISE EXCEPTION 'M-Pesa transaction not found in the payment authority'; END IF;
    provider_status := coalesce(provider_status, mtx.status::text);
  END IF;

  IF provider_status IS NOT NULL
     AND lower(provider_status) NOT IN ('succeeded','success','completed','paid') THEN
    RAISE EXCEPTION 'payment is % — only settled payments may be allocated (no fabricated success)', provider_status;
  END IF;

  IF (p->>'invoice_id') IS NULL THEN
    st := 'UNMATCHED';
    INSERT INTO public.freight_payment_allocations
      (invoice_id, payment_attempt_id, mpesa_transaction_id, provider, provider_reference,
       provider_status, amount, currency, state, unmatched_reason, idempotency_key, allocated_by,
       correlation_id, request_id)
    VALUES (NULL, nullif(p->>'payment_attempt_id','')::uuid, nullif(p->>'mpesa_transaction_id','')::uuid,
            coalesce(p->>'provider','mpesa'), p->>'provider_reference', provider_status, amt,
            coalesce(p->>'currency','KES'), st, coalesce(p->>'unmatched_reason','no invoice supplied'),
            key, actor, nullif(p->>'correlation_id','')::uuid, p->>'request_id')
    RETURNING id INTO newid;
    RETURN jsonb_build_object('ok', true, 'duplicate', false, 'allocation_id', newid, 'state', st);
  END IF;

  SELECT * INTO inv FROM public.freight_invoices WHERE id = (p->>'invoice_id')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invoice not found'; END IF;
  IF inv.status = 'VOID' THEN RAISE EXCEPTION 'cannot allocate to a voided invoice'; END IF;

  -- Duplicate provider transaction guard: same provider reference, same invoice.
  IF p->>'provider_reference' IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.freight_payment_allocations a
       WHERE a.invoice_id = inv.id AND a.provider = coalesce(p->>'provider','mpesa')
         AND a.provider_reference = p->>'provider_reference' AND a.reversed_at IS NULL) THEN
    INSERT INTO public.freight_payment_allocations
      (invoice_id, payment_attempt_id, mpesa_transaction_id, provider, provider_reference,
       provider_status, amount, currency, state, unmatched_reason, idempotency_key, allocated_by)
    VALUES (inv.id, nullif(p->>'payment_attempt_id','')::uuid, nullif(p->>'mpesa_transaction_id','')::uuid,
            coalesce(p->>'provider','mpesa'), p->>'provider_reference', provider_status, amt,
            inv.currency, 'DUPLICATE', 'provider reference already allocated to this invoice', key, actor)
    RETURNING id INTO newid;
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'allocation_id', newid, 'state', 'DUPLICATE');
  END IF;

  outstanding := inv.total - inv.paid_total;
  st := CASE
          WHEN amt > outstanding AND outstanding > 0 THEN 'OVERPAYMENT'
          WHEN outstanding <= 0 THEN 'OVERPAYMENT'
          WHEN amt < outstanding THEN 'PARTIAL'
          ELSE 'ALLOCATED' END;

  INSERT INTO public.freight_payment_allocations
    (invoice_id, invoice_line_id, payment_attempt_id, mpesa_transaction_id, provider,
     provider_reference, provider_status, amount, currency, state, idempotency_key,
     allocated_by, correlation_id, request_id)
  VALUES (inv.id, nullif(p->>'invoice_line_id','')::uuid, nullif(p->>'payment_attempt_id','')::uuid,
          nullif(p->>'mpesa_transaction_id','')::uuid, coalesce(p->>'provider','mpesa'),
          p->>'provider_reference', provider_status, amt, inv.currency, st, key, actor,
          nullif(p->>'correlation_id','')::uuid, p->>'request_id')
  RETURNING id INTO newid;

  UPDATE public.freight_invoices
     SET paid_total = paid_total + amt,
         status = CASE WHEN paid_total + amt >= total THEN 'PAID'::public.freight_invoice_status
                       ELSE 'PARTIALLY_PAID'::public.freight_invoice_status END
   WHERE id = inv.id;

  IF (SELECT paid_total >= total FROM public.freight_invoices WHERE id = inv.id) THEN
    PERFORM public.freight_charge_transition(c.id, 'PAID', 'invoice_paid', inv.invoice_number)
      FROM public.freight_charges c WHERE c.invoice_id = inv.id AND c.status = 'INVOICED';
  END IF;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'allocation_id', newid,
                            'state', st, 'outstanding', greatest(outstanding - amt, 0));
END $$;

CREATE OR REPLACE FUNCTION public.freight_payment_allocation_reverse(_allocation_id uuid, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := public._freight_fin_guard('staff.finance.payment.allocate');
  a public.freight_payment_allocations%ROWTYPE;
BEGIN
  IF coalesce(_reason,'') = '' THEN RAISE EXCEPTION 'reversal reason required'; END IF;
  SELECT * INTO a FROM public.freight_payment_allocations WHERE id=_allocation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'allocation not found'; END IF;
  IF a.reversed_at IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'duplicate', true); END IF;

  UPDATE public.freight_payment_allocations
     SET state='REVERSED', reversed_at=now(), reversal_reason=_reason WHERE id=_allocation_id;

  IF a.invoice_id IS NOT NULL AND a.state <> 'DUPLICATE' AND a.state <> 'UNMATCHED' THEN
    UPDATE public.freight_invoices
       SET paid_total = greatest(paid_total - a.amount, 0),
           status = CASE WHEN greatest(paid_total - a.amount,0) <= 0 THEN 'ISSUED'::public.freight_invoice_status
                         WHEN greatest(paid_total - a.amount,0) < total THEN 'PARTIALLY_PAID'::public.freight_invoice_status
                         ELSE status END
     WHERE id = a.invoice_id;
  END IF;
  -- The original M-Pesa record is never modified; only this allocation is reversed.
  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'state','REVERSED');
END $$;

-- -------------------------------------------------------------- settlements
CREATE OR REPLACE FUNCTION public.freight_settlement_calculate(
  _carrier_id uuid, _period_start date, _period_end date,
  _carrier_claimed_amount numeric DEFAULT NULL, _idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := public._freight_fin_guard('staff.finance.charge.manage');
  key text := coalesce(_idempotency_key, 'set:'||_carrier_id||':'||_period_start||':'||_period_end);
  ex public.freight_carrier_settlements%ROWTYPE;
  sid uuid; num text; gross numeric := 0; n integer := 0;
  b RECORD;
BEGIN
  SELECT * INTO ex FROM public.freight_carrier_settlements WHERE idempotency_key = key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'settlement_id', ex.id,
                              'net_payable', ex.net_payable);
  END IF;

  num := 'FST-' || to_char(now(),'YYYYMM') || '-' || lpad(nextval('public.freight_settlement_seq')::text, 5, '0');

  INSERT INTO public.freight_carrier_settlements
    (settlement_number, carrier_id, contract_id, status, period_start, period_end,
     carrier_claimed_amount, idempotency_key, created_by)
  VALUES (num, _carrier_id,
          (SELECT id FROM public.carrier_contracts
            WHERE carrier_id=_carrier_id AND effective_from <= _period_end
              AND (effective_until IS NULL OR effective_until >= _period_start)
            ORDER BY effective_from DESC LIMIT 1),
          'CALCULATED', _period_start, _period_end, _carrier_claimed_amount, key, actor)
  RETURNING id INTO sid;

  -- Eligible = executed bookings only (actual execution, never a carrier-submitted figure).
  FOR b IN
    SELECT fb.id AS booking_id, fb.booking_number, fb.agreed_total, fb.completed_at, fb.state
      FROM public.freight_bookings fb
     WHERE fb.carrier_id = _carrier_id
       AND fb.completed_at IS NOT NULL
       AND fb.completed_at::date BETWEEN _period_start AND _period_end
       AND NOT EXISTS (SELECT 1 FROM public.freight_settlement_lines l WHERE l.booking_id = fb.id)
  LOOP
    n := n + 1;
    gross := gross + b.agreed_total;
    INSERT INTO public.freight_settlement_lines
      (settlement_id, booking_id, description, eligible_amount, net_amount, evidence)
    VALUES (sid, b.booking_id, 'Executed booking ' || b.booking_number, b.agreed_total, b.agreed_total,
            jsonb_build_object('completed_at', b.completed_at, 'state', b.state));
  END LOOP;

  UPDATE public.freight_carrier_settlements
     SET gross_amount = gross, net_payable = gross,
         variance_amount = coalesce(_carrier_claimed_amount, gross) - gross
   WHERE id = sid;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'settlement_id', sid,
                            'settlement_number', num, 'lines', n, 'net_payable', gross,
                            'variance', coalesce(_carrier_claimed_amount, gross) - gross);
END $$;

CREATE OR REPLACE FUNCTION public.freight_settlement_transition(
  _settlement_id uuid, _to public.freight_settlement_status,
  _reason text DEFAULT NULL, _payout_reference text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := public._freight_fin_guard('staff.finance.settlement.approve');
  s public.freight_carrier_settlements%ROWTYPE;
  allowed public.freight_settlement_status[];
BEGIN
  SELECT * INTO s FROM public.freight_carrier_settlements WHERE id=_settlement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement not found'; END IF;
  IF s.status = _to THEN RETURN jsonb_build_object('ok', true, 'duplicate', true, 'status', s.status); END IF;

  allowed := CASE s.status
    WHEN 'CALCULATED' THEN ARRAY['PENDING_REVIEW','APPROVED']::public.freight_settlement_status[]
    WHEN 'PENDING_REVIEW' THEN ARRAY['APPROVED','REVERSED']::public.freight_settlement_status[]
    WHEN 'APPROVED' THEN ARRAY['PAID','REVERSED']::public.freight_settlement_status[]
    WHEN 'PAID' THEN ARRAY['REVERSED']::public.freight_settlement_status[]
    ELSE ARRAY[]::public.freight_settlement_status[] END;
  IF NOT (_to = ANY(allowed)) THEN
    RAISE EXCEPTION 'illegal settlement transition % -> %', s.status, _to;
  END IF;
  IF _to = 'APPROVED' AND s.created_by = actor THEN
    RAISE EXCEPTION 'four-eyes: the preparer cannot approve their own settlement';
  END IF;
  IF _to = 'PAID' AND coalesce(_payout_reference,'') = '' THEN
    RAISE EXCEPTION 'payout reference required — no fabricated payout';
  END IF;
  IF _to = 'REVERSED' AND coalesce(_reason,'') = '' THEN
    RAISE EXCEPTION 'reversal reason required';
  END IF;

  UPDATE public.freight_carrier_settlements
     SET status=_to,
         approved_by = CASE WHEN _to='APPROVED' THEN actor ELSE approved_by END,
         approved_at = CASE WHEN _to='APPROVED' THEN now() ELSE approved_at END,
         paid_at = CASE WHEN _to='PAID' THEN now() ELSE paid_at END,
         payout_reference = coalesce(_payout_reference, payout_reference),
         reversed_at = CASE WHEN _to='REVERSED' THEN now() ELSE reversed_at END,
         reversal_reason = CASE WHEN _to='REVERSED' THEN _reason ELSE reversal_reason END
   WHERE id=_settlement_id;

  IF _to = 'PAID' THEN
    UPDATE public.freight_charges c SET settlement_id = _settlement_id
      FROM public.freight_settlement_lines l
     WHERE l.settlement_id = _settlement_id AND l.charge_id = c.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'status', _to);
END $$;

-- ------------------------------------------------------------ freight audit
CREATE OR REPLACE FUNCTION public.freight_audit_run(_from timestamptz, _to timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := public._freight_fin_guard('staff.finance.audit.run');
  run_id uuid; f integer := 0; crit integer := 0;
  r RECORD;
  fp text;
BEGIN
  IF _to <= _from THEN RAISE EXCEPTION 'invalid window'; END IF;
  INSERT INTO public.freight_audit_runs (window_start, window_end, triggered_by)
  VALUES (_from, _to, actor) RETURNING id INTO run_id;

  -- 1. RATE_MISMATCH: booking agreed total differs from the awarded total.
  FOR r IN
    SELECT fb.id booking_id, fb.award_id, fb.carrier_id, fb.agreed_total, fa.awarded_total, fb.currency
      FROM public.freight_bookings fb
      JOIN public.freight_awards fa ON fa.id = fb.award_id
     WHERE fb.created_at >= _from AND fb.created_at < _to
       AND round(fb.agreed_total,2) <> round(fa.awarded_total,2)
  LOOP
    fp := 'RATE_MISMATCH:' || r.booking_id;
    INSERT INTO public.freight_audit_findings
      (run_id, reason_code, severity, booking_id, award_id, carrier_id,
       expected_amount, actual_amount, variance_amount, currency, detail, source_records, fingerprint)
    VALUES (run_id, 'RATE_MISMATCH', 'CRITICAL', r.booking_id, r.award_id, r.carrier_id,
            r.awarded_total, r.agreed_total, r.agreed_total - r.awarded_total, r.currency,
            'Booking agreed total does not match the awarded total.',
            jsonb_build_object('booking_id', r.booking_id, 'award_id', r.award_id), fp)
    ON CONFLICT DO NOTHING;
    f := f + 1; crit := crit + 1;
  END LOOP;

  -- 2. CHARGE_WITHOUT_OPERATIONAL_EVIDENCE
  FOR r IN
    SELECT c.id, c.carrier_id, c.amount, c.currency FROM public.freight_charges c
     WHERE c.created_at >= _from AND c.created_at < _to AND c.status <> 'VOID'
       AND c.booking_id IS NULL AND c.package_id IS NULL AND c.manifest_id IS NULL
       AND c.operational_evidence = '{}'::jsonb
  LOOP
    fp := 'NO_EVIDENCE:' || r.id;
    INSERT INTO public.freight_audit_findings
      (run_id, reason_code, severity, charge_id, carrier_id, actual_amount, variance_amount,
       currency, detail, source_records, fingerprint)
    VALUES (run_id, 'CHARGE_WITHOUT_OPERATIONAL_EVIDENCE', 'MAJOR', r.id, r.carrier_id, r.amount, r.amount,
            r.currency, 'Charge has no supporting operational record.',
            jsonb_build_object('charge_id', r.id), fp)
    ON CONFLICT DO NOTHING;
    f := f + 1;
  END LOOP;

  -- 3. DUPLICATE_CHARGE: same booking + charge code billed twice.
  FOR r IN
    SELECT booking_id, charge_code, count(*) n, sum(amount) total,
           min(carrier_id) carrier_id, min(currency) currency
      FROM public.freight_charges
     WHERE created_at >= _from AND created_at < _to AND status <> 'VOID' AND booking_id IS NOT NULL
     GROUP BY booking_id, charge_code HAVING count(*) > 1
  LOOP
    fp := 'DUP_CHARGE:' || r.booking_id || ':' || r.charge_code;
    INSERT INTO public.freight_audit_findings
      (run_id, reason_code, severity, booking_id, carrier_id, actual_amount, variance_amount,
       currency, detail, source_records, fingerprint)
    VALUES (run_id, 'DUPLICATE_CHARGE', 'CRITICAL', r.booking_id, r.carrier_id, r.total, r.total,
            r.currency, 'Booking charged ' || r.n || ' times for ' || r.charge_code || '.',
            jsonb_build_object('booking_id', r.booking_id, 'charge_code', r.charge_code, 'count', r.n), fp)
    ON CONFLICT DO NOTHING;
    f := f + 1; crit := crit + 1;
  END LOOP;

  -- 4. UNAPPROVED_CHARGE_INVOICED
  FOR r IN
    SELECT c.id, c.invoice_id, c.amount, c.currency FROM public.freight_charges c
     WHERE c.invoice_id IS NOT NULL AND c.approved_at IS NULL
       AND c.created_at >= _from AND c.created_at < _to
  LOOP
    fp := 'UNAPPROVED:' || r.id;
    INSERT INTO public.freight_audit_findings
      (run_id, reason_code, severity, charge_id, invoice_id, actual_amount, currency,
       detail, source_records, fingerprint)
    VALUES (run_id, 'UNAPPROVED_RATE', 'CRITICAL', r.id, r.invoice_id, r.amount, r.currency,
            'Charge was invoiced without an approval record.',
            jsonb_build_object('charge_id', r.id), fp)
    ON CONFLICT DO NOTHING;
    f := f + 1; crit := crit + 1;
  END LOOP;

  -- 5. MISSING_CARRIER_CHARGE: executed booking with no carrier-side charge.
  FOR r IN
    SELECT fb.id booking_id, fb.carrier_id, fb.agreed_total, fb.currency
      FROM public.freight_bookings fb
     WHERE fb.completed_at >= _from AND fb.completed_at < _to
       AND NOT EXISTS (SELECT 1 FROM public.freight_charges c
                        WHERE c.booking_id = fb.id AND c.party='CARRIER' AND c.status <> 'VOID')
  LOOP
    fp := 'MISSING_CARRIER_CHARGE:' || r.booking_id;
    INSERT INTO public.freight_audit_findings
      (run_id, reason_code, severity, booking_id, carrier_id, expected_amount, variance_amount,
       currency, detail, source_records, fingerprint)
    VALUES (run_id, 'MISSING_CARRIER_CHARGE', 'MAJOR', r.booking_id, r.carrier_id, r.agreed_total,
            r.agreed_total, r.currency, 'Executed booking has no carrier charge.',
            jsonb_build_object('booking_id', r.booking_id), fp)
    ON CONFLICT DO NOTHING;
    f := f + 1;
  END LOOP;

  -- 6. DUPLICATE_INVOICE_ALLOCATION
  FOR r IN
    SELECT invoice_id, provider, provider_reference, count(*) n
      FROM public.freight_payment_allocations
     WHERE created_at >= _from AND created_at < _to AND provider_reference IS NOT NULL
       AND reversed_at IS NULL
     GROUP BY invoice_id, provider, provider_reference HAVING count(*) > 1
  LOOP
    fp := 'DUP_ALLOC:' || coalesce(r.invoice_id::text,'none') || ':' || r.provider_reference;
    INSERT INTO public.freight_audit_findings
      (run_id, reason_code, severity, invoice_id, detail, source_records, fingerprint)
    VALUES (run_id, 'DUPLICATE_PAYMENT_ALLOCATION', 'CRITICAL', r.invoice_id,
            'Provider reference allocated ' || r.n || ' times.',
            jsonb_build_object('provider_reference', r.provider_reference), fp)
    ON CONFLICT DO NOTHING;
    f := f + 1; crit := crit + 1;
  END LOOP;

  UPDATE public.freight_audit_runs
     SET findings = f, critical = crit, balanced = (f = 0),
         bookings_scanned = (SELECT count(*) FROM public.freight_bookings WHERE created_at >= _from AND created_at < _to),
         charges_scanned  = (SELECT count(*) FROM public.freight_charges  WHERE created_at >= _from AND created_at < _to),
         invoices_scanned = (SELECT count(*) FROM public.freight_invoices WHERE created_at >= _from AND created_at < _to)
   WHERE id = run_id;

  RETURN jsonb_build_object('ok', true, 'run_id', run_id, 'findings', f, 'critical', crit, 'balanced', f = 0);
END $$;

CREATE OR REPLACE FUNCTION public.freight_finding_resolve(
  _finding_id uuid, _state public.freight_finding_state, _notes text, _evidence jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor uuid := public._freight_fin_guard('staff.finance.audit.run');
BEGIN
  IF _state IN ('RESOLVED','WAIVED') AND coalesce(_notes,'') = '' THEN
    RAISE EXCEPTION 'resolution notes required';
  END IF;
  UPDATE public.freight_audit_findings
     SET state=_state, resolution_notes=_notes, resolution_evidence=_evidence,
         resolved_by = CASE WHEN _state IN ('RESOLVED','WAIVED') THEN actor ELSE resolved_by END,
         resolved_at = CASE WHEN _state IN ('RESOLVED','WAIVED') THEN now() ELSE resolved_at END,
         fingerprint = CASE WHEN _state IN ('RESOLVED','WAIVED') THEN NULL ELSE fingerprint END
   WHERE id=_finding_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'finding not found'; END IF;
  RETURN jsonb_build_object('ok', true, 'state', _state);
END $$;

-- ------------------------------------------------ three-way reconciliation
CREATE OR REPLACE FUNCTION public.freight_recon_run(_from timestamptz, _to timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := public._freight_fin_guard('staff.finance.audit.run');
  run_id uuid; n integer := 0; e integer := 0; crit integer := 0;
  r RECORD; variance numeric; rc text; sev public.freight_finding_severity;
BEGIN
  IF _to <= _from THEN RAISE EXCEPTION 'invalid window'; END IF;
  INSERT INTO public.freight_recon_runs (window_start, window_end, triggered_by)
  VALUES (_from, _to, actor) RETURNING id INTO run_id;

  FOR r IN
    SELECT fb.id booking_id, fb.order_id, fb.carrier_id, fb.currency,
           fa.awarded_total AS expected,
           coalesce((SELECT sum(c.amount) FROM public.freight_charges c
                      WHERE c.booking_id = fb.id AND c.status <> 'VOID'), 0) AS charged,
           coalesce((SELECT sum(l.amount + l.tax_amount) FROM public.freight_invoice_lines l
                      JOIN public.freight_charges c2 ON c2.id = l.charge_id
                     WHERE c2.booking_id = fb.id), 0) AS invoiced,
           coalesce((SELECT sum(a.amount) FROM public.freight_payment_allocations a
                      JOIN public.freight_invoices i ON i.id = a.invoice_id
                     WHERE a.reversed_at IS NULL AND a.state IN ('ALLOCATED','PARTIAL','OVERPAYMENT')
                       AND EXISTS (SELECT 1 FROM public.freight_invoice_lines l2
                                     JOIN public.freight_charges c3 ON c3.id = l2.charge_id
                                    WHERE l2.invoice_id = i.id AND c3.booking_id = fb.id)), 0) AS paid,
           coalesce((SELECT sum(sl.net_amount) FROM public.freight_settlement_lines sl
                     WHERE sl.booking_id = fb.id), 0) AS settled,
           coalesce((SELECT sum(sl2.net_amount) FROM public.freight_settlement_lines sl2
                      JOIN public.freight_carrier_settlements s ON s.id = sl2.settlement_id
                     WHERE sl2.booking_id = fb.id AND s.status = 'PAID'), 0) AS carrier_paid
      FROM public.freight_bookings fb
      LEFT JOIN public.freight_awards fa ON fa.id = fb.award_id
     WHERE fb.created_at >= _from AND fb.created_at < _to
  LOOP
    n := n + 1;
    variance := coalesce(r.charged,0) - coalesce(r.expected,0);

    IF abs(variance) > 0.5 THEN
      rc := 'EXPECTED_VS_CHARGED_VARIANCE'; sev := 'CRITICAL';
    ELSIF r.charged > 0 AND r.invoiced = 0 THEN
      rc := 'CHARGED_NOT_INVOICED'; sev := 'MAJOR'; variance := r.charged;
    ELSIF r.invoiced > 0 AND r.paid = 0 THEN
      rc := 'INVOICED_NOT_PAID'; sev := 'MINOR'; variance := r.invoiced;
    ELSIF r.paid > r.invoiced + 0.5 THEN
      rc := 'PAID_EXCEEDS_INVOICED'; sev := 'CRITICAL'; variance := r.paid - r.invoiced;
    ELSIF r.carrier_paid > r.settled + 0.5 THEN
      rc := 'CARRIER_OVERPAID'; sev := 'CRITICAL'; variance := r.carrier_paid - r.settled;
    ELSE
      CONTINUE;
    END IF;

    INSERT INTO public.freight_recon_exceptions
      (run_id, booking_id, order_id, carrier_id, reason_code, severity,
       expected_amount, charged_amount, invoiced_amount, paid_amount, settled_amount,
       carrier_paid_amount, variance_amount, currency, detail, evidence)
    VALUES (run_id, r.booking_id, r.order_id, r.carrier_id, rc, sev,
            coalesce(r.expected,0), r.charged, r.invoiced, r.paid, r.settled, r.carrier_paid,
            variance, coalesce(r.currency,'KES'),
            'Operational, commercial and financial truth disagree for this booking.',
            jsonb_build_object('booking_id', r.booking_id));
    e := e + 1;
    IF sev = 'CRITICAL' THEN crit := crit + 1; END IF;
  END LOOP;

  UPDATE public.freight_recon_runs
     SET transactions_scanned = n, exceptions = e, critical = crit, balanced = (e = 0)
   WHERE id = run_id;

  RETURN jsonb_build_object('ok', true, 'run_id', run_id, 'scanned', n,
                            'exceptions', e, 'critical', crit, 'balanced', e = 0);
END $$;

CREATE OR REPLACE FUNCTION public.freight_recon_exception_resolve(
  _exception_id uuid, _state public.freight_finding_state, _notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor uuid := public._freight_fin_guard('staff.finance.audit.run');
BEGIN
  IF coalesce(_notes,'') = '' THEN RAISE EXCEPTION 'resolution notes required'; END IF;
  UPDATE public.freight_recon_exceptions
     SET state=_state, resolution_notes=_notes,
         resolved_by = CASE WHEN _state IN ('RESOLVED','WAIVED') THEN actor ELSE resolved_by END,
         resolved_at = CASE WHEN _state IN ('RESOLVED','WAIVED') THEN now() ELSE resolved_at END
   WHERE id=_exception_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'exception not found'; END IF;
  RETURN jsonb_build_object('ok', true, 'state', _state);
END $$;

-- --------------------------------------------------------------- lineage
CREATE OR REPLACE FUNCTION public.freight_charge_lineage(_charge_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.freight_charges%ROWTYPE;
  uid uuid := auth.uid();
BEGIN
  SELECT * INTO c FROM public.freight_charges WHERE id = _charge_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'charge not found'; END IF;
  IF NOT (public.has_staff_permission('staff.finance.read')
          OR c.customer_user_id = uid
          OR (c.carrier_id IS NOT NULL AND public._carrier_is_member(c.carrier_id))) THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  RETURN jsonb_build_object(
    'charge', to_jsonb(c),
    'quote', (SELECT to_jsonb(q) FROM public.freight_quotes q WHERE q.id = c.quote_id),
    'rate_card', (SELECT to_jsonb(rc) FROM public.carrier_rate_cards rc WHERE rc.id = c.rate_card_id),
    'rate_line', (SELECT to_jsonb(rl) FROM public.carrier_rate_lines rl WHERE rl.id = c.rate_line_id),
    'booking', (SELECT to_jsonb(b) FROM public.freight_bookings b WHERE b.id = c.booking_id),
    'award', (SELECT to_jsonb(a) FROM public.freight_awards a WHERE a.id = c.award_id),
    'manifest', (SELECT to_jsonb(m) FROM public.logistics_manifests m WHERE m.id = c.manifest_id),
    'package', (SELECT to_jsonb(p) FROM public.packages p WHERE p.id = c.package_id),
    'invoice', (SELECT to_jsonb(i) FROM public.freight_invoices i WHERE i.id = c.invoice_id),
    'invoice_line', (SELECT to_jsonb(l) FROM public.freight_invoice_lines l WHERE l.charge_id = c.id),
    'allocations', coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM public.freight_payment_allocations a
                              WHERE a.invoice_id = c.invoice_id), '[]'::jsonb),
    'adjustments', coalesce((SELECT jsonb_agg(to_jsonb(adj)) FROM public.freight_charge_adjustments adj
                              WHERE adj.charge_id = c.id), '[]'::jsonb),
    'events', coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at)
                          FROM public.freight_charge_events e WHERE e.charge_id = c.id), '[]'::jsonb),
    'settlement', (SELECT to_jsonb(s) FROM public.freight_carrier_settlements s WHERE s.id = c.settlement_id)
  );
END $$;

-- --------------------------------------------------------------- config
CREATE OR REPLACE FUNCTION public.freight_config_set(_key text, _value jsonb, _state public.freight_config_state)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor uuid := public._freight_fin_guard('staff.finance.config.manage');
BEGIN
  UPDATE public.freight_billing_config
     SET value = coalesce(_value, value), state = _state, updated_by = actor
   WHERE key = _key;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown configuration key %', _key; END IF;
  RETURN jsonb_build_object('ok', true, 'key', _key, 'state', _state);
END $$;

-- ---------------------------------------------------------------- grants
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'freight_charge_create(jsonb)',
    'freight_charge_transition(uuid,freight_charge_status,text,text)',
    'freight_charge_adjust(uuid,text,numeric,text,text,text)',
    'freight_adjustment_approve(uuid,boolean,text)',
    'freight_invoice_build(jsonb)',
    'freight_invoice_issue(uuid,timestamptz)',
    'freight_invoice_void(uuid,text)',
    'freight_payment_allocate(jsonb)',
    'freight_payment_allocation_reverse(uuid,text)',
    'freight_settlement_calculate(uuid,date,date,numeric,text)',
    'freight_settlement_transition(uuid,freight_settlement_status,text,text)',
    'freight_audit_run(timestamptz,timestamptz)',
    'freight_finding_resolve(uuid,freight_finding_state,text,jsonb)',
    'freight_recon_run(timestamptz,timestamptz)',
    'freight_recon_exception_resolve(uuid,freight_finding_state,text)',
    'freight_charge_lineage(uuid)',
    'freight_config_set(text,jsonb,freight_config_state)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon;', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role;', fn);
  END LOOP;
END $$;