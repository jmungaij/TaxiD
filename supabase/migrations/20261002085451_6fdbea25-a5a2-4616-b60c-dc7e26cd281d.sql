CREATE TABLE public.corporate_invoice_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.corporate_invoices(id) ON DELETE CASCADE,
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (event IN ('TRIP_ADDED','ISSUED','SENT','PAYMENT_REPORTED','PAYMENT_CONFIRMED','PAID')),
  amount_cents bigint, reference text, note text, recipients jsonb,
  actor uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX corporate_invoice_events_inv_idx ON public.corporate_invoice_events(invoice_id, created_at);
GRANT SELECT ON public.corporate_invoice_events TO authenticated;
GRANT ALL ON public.corporate_invoice_events TO service_role;
ALTER TABLE public.corporate_invoice_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company managers and finance read invoice history" ON public.corporate_invoice_events FOR SELECT TO authenticated
USING (public.is_corporate_manager_or_admin(auth.uid(), corporate_id) OR public.has_role(auth.uid(),'finance_admin') OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- Every completed business trip becomes an invoice line; wallet part is pre-paid.
CREATE OR REPLACE FUNCTION private.corporate_trip_settle(_booking_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE b trip_bookings%ROWTYPE; a corporate_billing_arrangements%ROWTYPE; s corporate_trip_settlements%ROWTYPE;
  m text; fare bigint; wal bigint; cred bigint; use_w bigint := 0; use_c bigint := 0; reason text;
  led uuid; fac uuid; inv uuid; item uuid; ln int; emp text;
BEGIN
  SELECT * INTO b FROM trip_bookings WHERE id=_booking_id FOR UPDATE;
  IF NOT FOUND OR b.booking_context<>'business' OR b.corporate_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','NOT_A_BUSINESS_TRIP'); END IF;
  IF b.status<>'completed' THEN RETURN jsonb_build_object('ok',false,'error','TRIP_NOT_COMPLETED'); END IF;
  SELECT * INTO s FROM corporate_trip_settlements WHERE booking_id=_booking_id FOR UPDATE;
  IF FOUND AND s.status='SETTLED' THEN RETURN jsonb_build_object('ok',true,'already',true,'status','SETTLED','invoice_id',s.invoice_id); END IF;

  fare := round(coalesce(b.total_fare,0)*100)::bigint;
  SELECT * INTO a FROM corporate_billing_arrangements WHERE corporate_id=b.corporate_id;
  m := coalesce(a.mode,'PREPAID_WALLET');
  PERFORM 1 FROM corporate_accounts WHERE id=b.corporate_id FOR UPDATE;
  wal := private.corporate_wallet_cents(b.corporate_id);
  fac := private.corporate_active_facility(b.corporate_id);
  cred := private.corporate_available_credit_cents(b.corporate_id);

  IF fare <= 0 THEN reason := 'NO_FINAL_FARE';
  ELSIF coalesce(a.status,'ACTIVE')='SUSPENDED' THEN reason := 'BILLING_SUSPENDED';
  ELSIF m='PREPAID_WALLET' THEN IF wal >= fare THEN use_w := fare; ELSE reason := 'WALLET_INSUFFICIENT'; END IF;
  ELSIF m='CREDIT' THEN IF fac IS NULL THEN reason := 'NO_ACTIVE_CREDIT_FACILITY'; ELSIF cred >= fare THEN use_c := fare; ELSE reason := 'CREDIT_LIMIT_EXCEEDED'; END IF;
  ELSE use_w := least(greatest(wal,0), fare); use_c := fare - use_w;
    IF use_c > 0 AND (fac IS NULL OR cred < use_c) THEN reason := 'WALLET_AND_CREDIT_INSUFFICIENT'; use_w := 0; use_c := 0; END IF;
  END IF;

  IF reason IS NOT NULL THEN
    INSERT INTO corporate_trip_settlements(booking_id, corporate_id, mode, fare_cents, status, exception_reason)
      VALUES (_booking_id, b.corporate_id, m, fare, 'EXCEPTION', reason)
      ON CONFLICT (booking_id) DO UPDATE SET mode=EXCLUDED.mode, fare_cents=EXCLUDED.fare_cents, exception_reason=EXCLUDED.exception_reason, attempts=corporate_trip_settlements.attempts+1;
    RETURN jsonb_build_object('ok',false,'status','EXCEPTION','reason',reason);
  END IF;

  IF use_w > 0 THEN
    INSERT INTO corporate_cash_ledger(corporate_id, entry_type, amount_cents, balance_after_cents, reference, description, source_kind, source_id, created_by, occurred_at, created_at, metadata)
      VALUES (b.corporate_id, 'ride_charge', -use_w, wal - use_w, b.booking_number, 'Business trip '||b.booking_number, 'trip_booking', b.id, auth.uid(), clock_timestamp(), clock_timestamp(),
        jsonb_build_object('trip_purpose', b.trip_purpose, 'cost_center', b.cost_center_code)) RETURNING id INTO led;
  END IF;
  IF use_c > 0 THEN
    UPDATE corporate_credit_facilities SET utilized_credit_cents = coalesce(utilized_credit_cents,0) + use_c, updated_at=now() WHERE id=fac;
  END IF;

  inv := private.corporate_cycle_invoice(b.corporate_id, coalesce(a.credit_period_days,1));
  SELECT coalesce(max(line_number),0)+1 INTO ln FROM corporate_invoice_items WHERE invoice_id=inv;
  SELECT coalesce(e.full_name, p.full_name, e.email) INTO emp FROM corporate_employees e LEFT JOIN profiles p ON p.user_id=e.user_id WHERE e.id=b.corporate_employee_id;
  INSERT INTO corporate_invoice_items(invoice_id, line_number, source_ref, description, employee_user_id, employee_name, cost_center,
    trip_origin, trip_destination, trip_started_at, trip_ended_at, quantity, unit_price_cents, taxable_cents, tax_cents, total_cents, metadata)
    VALUES (inv, ln, b.booking_number, 'Business trip '||b.booking_number||coalesce(' — '||b.trip_purpose,''), b.rider_user_id, emp, b.cost_center_code,
      b.pickup_address, b.dropoff_address, b.started_at, b.completed_at, 1, fare, fare, 0, fare,
      jsonb_build_object('booking_id', b.id, 'wallet_cents', use_w, 'credit_cents', use_c, 'facility_id', fac))
    RETURNING id INTO item;
  UPDATE corporate_invoices SET subtotal_cents=subtotal_cents+fare, total_cents=total_cents+fare, paid_cents=coalesce(paid_cents,0)+use_w,
    balance_cents=balance_cents+use_c, updated_at=now() WHERE id=inv;
  INSERT INTO corporate_invoice_events(invoice_id, corporate_id, event, amount_cents, reference, note)
    VALUES (inv, b.corporate_id, 'TRIP_ADDED', fare, b.booking_number,
      CASE WHEN use_c=0 THEN 'Paid from company wallet' WHEN use_w=0 THEN 'On company credit' ELSE 'Wallet + credit' END);

  INSERT INTO corporate_trip_settlements(booking_id, corporate_id, mode, fare_cents, wallet_cents, credit_cents, status, cash_ledger_id, facility_id, invoice_id, invoice_item_id, settled_at)
    VALUES (_booking_id, b.corporate_id, m, fare, use_w, use_c, 'SETTLED', led, CASE WHEN use_c>0 THEN fac END, inv, item, now())
    ON CONFLICT (booking_id) DO UPDATE SET mode=EXCLUDED.mode, fare_cents=EXCLUDED.fare_cents, wallet_cents=EXCLUDED.wallet_cents, credit_cents=EXCLUDED.credit_cents,
      status='SETTLED', exception_reason=NULL, cash_ledger_id=EXCLUDED.cash_ledger_id, facility_id=EXCLUDED.facility_id, invoice_id=EXCLUDED.invoice_id,
      invoice_item_id=EXCLUDED.invoice_item_id, settled_at=now(), attempts=corporate_trip_settlements.attempts+1;
  RETURN jsonb_build_object('ok',true,'status','SETTLED','wallet_cents',use_w,'credit_cents',use_c,'invoice_id',inv);
END $$;

-- Issue and send to the company's finance contacts (TaxiD finance).
CREATE OR REPLACE FUNCTION private.corporate_invoice_issue(_invoice_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE i corporate_invoices%ROWTYPE; rcp jsonb; days int;
BEGIN
  IF NOT private.corporate_is_finance(auth.uid()) THEN RAISE EXCEPTION 'NOT_AUTHORISED' USING ERRCODE='42501'; END IF;
  SELECT * INTO i FROM corporate_invoices WHERE id=_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','UNKNOWN_INVOICE'); END IF;
  IF i.status<>'DRAFT' THEN RETURN jsonb_build_object('ok',false,'error','ALREADY_ISSUED','status',i.status); END IF;
  IF i.total_cents<=0 THEN RETURN jsonb_build_object('ok',false,'error','INVOICE_EMPTY'); END IF;
  days := coalesce((i.metadata->>'credit_period_days')::int,1);
  UPDATE corporate_billing_periods SET status='BILLED', locked_at=now(), billed_at=now(), updated_at=now() WHERE id=i.period_id AND status='OPEN';
  UPDATE corporate_invoices SET status = CASE WHEN balance_cents<=0 THEN 'PAID' ELSE 'ISSUED' END::corporate_invoice_status,
    issued_at=now(), due_at=now() + make_interval(days => days), paid_at = CASE WHEN balance_cents<=0 THEN now() END, updated_at=now() WHERE id=i.id;
  SELECT coalesce(jsonb_agg(DISTINCT x),'[]'::jsonb) INTO rcp FROM (
    SELECT billing_email AS x FROM corporate_accounts WHERE id=i.corporate_id AND billing_email IS NOT NULL
    UNION SELECT email FROM corporate_employees WHERE corporate_id=i.corporate_id AND status IN ('active','invited')
      AND (role IN ('corporate_admin') OR metadata->>'billing_contact'='true')) q;
  INSERT INTO corporate_invoice_events(invoice_id, corporate_id, event, amount_cents, actor) VALUES (i.id, i.corporate_id, 'ISSUED', i.total_cents, auth.uid());
  INSERT INTO corporate_invoice_events(invoice_id, corporate_id, event, amount_cents, recipients, note, actor)
    VALUES (i.id, i.corporate_id, 'SENT', i.balance_cents, rcp, 'Available in the company billing panel', auth.uid());
  IF i.balance_cents<=0 THEN
    INSERT INTO corporate_invoice_events(invoice_id, corporate_id, event, amount_cents, note, actor) VALUES (i.id, i.corporate_id, 'PAID', i.total_cents, 'Fully paid from company wallet', auth.uid());
  END IF;
  RETURN jsonb_build_object('ok',true,'recipients',rcp);
END $$;

-- Company reports a payment (admin/manager of that company).
CREATE OR REPLACE FUNCTION private.corporate_invoice_report_payment(_invoice_id uuid, _amount_cents bigint, _reference text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE i corporate_invoices%ROWTYPE;
BEGIN
  SELECT * INTO i FROM corporate_invoices WHERE id=_invoice_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','UNKNOWN_INVOICE'); END IF;
  IF NOT (public.is_corporate_manager_or_admin(auth.uid(), i.corporate_id) OR private.corporate_is_finance(auth.uid())) THEN RAISE EXCEPTION 'NOT_AUTHORISED' USING ERRCODE='42501'; END IF;
  IF i.status NOT IN ('ISSUED','PARTIALLY_PAID','OVERDUE') THEN RETURN jsonb_build_object('ok',false,'error','NOT_AWAITING_PAYMENT'); END IF;
  IF coalesce(_amount_cents,0)<=0 OR length(btrim(coalesce(_reference,'')))<4 THEN RETURN jsonb_build_object('ok',false,'error','REFERENCE_AND_AMOUNT_REQUIRED'); END IF;
  INSERT INTO corporate_invoice_events(invoice_id, corporate_id, event, amount_cents, reference, actor)
    VALUES (i.id, i.corporate_id, 'PAYMENT_REPORTED', _amount_cents, left(btrim(_reference),60), auth.uid());
  RETURN jsonb_build_object('ok',true);
END $$;

-- TaxiD finance confirms money received; restores credit.
CREATE OR REPLACE FUNCTION private.corporate_invoice_confirm_payment(_invoice_id uuid, _amount_cents bigint, _reference text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE i corporate_invoices%ROWTYPE; amt bigint; fac uuid;
BEGIN
  IF NOT private.corporate_is_finance(auth.uid()) THEN RAISE EXCEPTION 'NOT_AUTHORISED' USING ERRCODE='42501'; END IF;
  SELECT * INTO i FROM corporate_invoices WHERE id=_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','UNKNOWN_INVOICE'); END IF;
  IF i.status NOT IN ('ISSUED','PARTIALLY_PAID','OVERDUE') THEN RETURN jsonb_build_object('ok',false,'error','NOT_AWAITING_PAYMENT'); END IF;
  IF length(btrim(coalesce(_reference,'')))<4 THEN RETURN jsonb_build_object('ok',false,'error','REFERENCE_AND_AMOUNT_REQUIRED'); END IF;
  amt := least(coalesce(_amount_cents,0), i.balance_cents);
  IF amt<=0 THEN RETURN jsonb_build_object('ok',false,'error','REFERENCE_AND_AMOUNT_REQUIRED'); END IF;
  UPDATE corporate_invoices SET paid_cents=paid_cents+amt, balance_cents=balance_cents-amt,
    status = CASE WHEN balance_cents-amt<=0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END::corporate_invoice_status,
    paid_at = CASE WHEN balance_cents-amt<=0 THEN now() ELSE paid_at END, updated_at=now() WHERE id=i.id;
  fac := private.corporate_active_facility(i.corporate_id);
  IF fac IS NOT NULL THEN UPDATE corporate_credit_facilities SET utilized_credit_cents=greatest(coalesce(utilized_credit_cents,0)-amt,0), updated_at=now() WHERE id=fac; END IF;
  INSERT INTO corporate_invoice_events(invoice_id, corporate_id, event, amount_cents, reference, actor)
    VALUES (i.id, i.corporate_id, 'PAYMENT_CONFIRMED', amt, left(btrim(_reference),60), auth.uid());
  IF i.balance_cents-amt<=0 THEN
    INSERT INTO corporate_invoice_events(invoice_id, corporate_id, event, amount_cents, actor) VALUES (i.id, i.corporate_id, 'PAID', i.total_cents, auth.uid());
    UPDATE corporate_billing_periods SET status='SETTLED', settled_at=now(), updated_at=now() WHERE id=i.period_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'paid_cents',amt,'balance_cents',i.balance_cents-amt);
END $$;

-- Invoice list with lines and history for the panel.
CREATE OR REPLACE FUNCTION private.corporate_invoices_board(_corporate_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (private.corporate_is_finance(auth.uid()) OR public.is_corporate_manager_or_admin(auth.uid(), _corporate_id)) THEN RAISE EXCEPTION 'NOT_AUTHORISED' USING ERRCODE='42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', i.id, 'invoice_number', i.invoice_number, 'status', i.status, 'total_cents', i.total_cents, 'paid_cents', i.paid_cents,
      'balance_cents', i.balance_cents, 'issued_at', i.issued_at, 'due_at', i.due_at, 'paid_at', i.paid_at, 'created_at', i.created_at,
      'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object('ref', source_ref, 'employee', employee_name, 'from', trip_origin, 'to', trip_destination,
                 'total_cents', total_cents, 'wallet_cents', (metadata->>'wallet_cents')::bigint, 'credit_cents', (metadata->>'credit_cents')::bigint) ORDER BY line_number),'[]'::jsonb)
                FROM corporate_invoice_items WHERE invoice_id=i.id),
      'events', (SELECT coalesce(jsonb_agg(jsonb_build_object('event', event, 'amount_cents', amount_cents, 'reference', reference, 'note', note, 'recipients', recipients, 'at', created_at) ORDER BY created_at),'[]'::jsonb)
                FROM corporate_invoice_events WHERE invoice_id=i.id)
    ) ORDER BY i.created_at DESC)
    FROM corporate_invoices i WHERE i.corporate_id=_corporate_id AND i.metadata->>'kind'='credit_cycle'), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION private.corporate_invoice_issue(uuid), private.corporate_invoice_report_payment(uuid,bigint,text), private.corporate_invoice_confirm_payment(uuid,bigint,text), private.corporate_invoices_board(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.corporate_invoice_issue(uuid), private.corporate_invoice_report_payment(uuid,bigint,text), private.corporate_invoice_confirm_payment(uuid,bigint,text), private.corporate_invoices_board(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.corporate_invoice_issue(_invoice_id uuid) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.corporate_invoice_issue(_invoice_id) $$;
CREATE OR REPLACE FUNCTION public.corporate_invoice_report_payment(_invoice_id uuid, _amount_cents bigint, _reference text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.corporate_invoice_report_payment(_invoice_id,_amount_cents,_reference) $$;
CREATE OR REPLACE FUNCTION public.corporate_invoice_confirm_payment(_invoice_id uuid, _amount_cents bigint, _reference text) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.corporate_invoice_confirm_payment(_invoice_id,_amount_cents,_reference) $$;
CREATE OR REPLACE FUNCTION public.corporate_invoices_board(_corporate_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.corporate_invoices_board(_corporate_id) $$;
REVOKE ALL ON FUNCTION public.corporate_invoice_issue(uuid), public.corporate_invoice_report_payment(uuid,bigint,text), public.corporate_invoice_confirm_payment(uuid,bigint,text), public.corporate_invoices_board(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corporate_invoice_issue(uuid), public.corporate_invoice_report_payment(uuid,bigint,text), public.corporate_invoice_confirm_payment(uuid,bigint,text), public.corporate_invoices_board(uuid) TO authenticated;