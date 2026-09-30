CREATE OR REPLACE FUNCTION public.corporate_trip_settle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _emp public.corporate_employees;
  _amount bigint;
  _occurred timestamptz;
  _rev_id uuid;
  _period_id uuid;
  _period_start date;
  _period_end date;
  _invoice public.corporate_invoices;
  _line int;
  _balance bigint;
  _dept text;
  _cc text;
BEGIN
  IF NEW.status <> 'completed' OR coalesce(OLD.status,'') = 'completed' THEN
    RETURN NEW;
  END IF;
  IF coalesce(NEW.intent,'') <> 'corporate' THEN
    RETURN NEW;
  END IF;

  _amount := round(coalesce(NEW.total_fare, 0) * 100)::bigint;
  IF _amount <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT * INTO _emp
    FROM public.corporate_employees
   WHERE user_id = NEW.rider_user_id
   ORDER BY (status = 'active') DESC, created_at
   LIMIT 1;
  IF _emp.id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Idempotency: one revenue event per booking.
  IF EXISTS (
    SELECT 1 FROM public.revenue_events
     WHERE source_ref = NEW.id::text AND event_type = 'RIDE_COMPLETED'
  ) THEN
    RETURN NEW;
  END IF;

  _occurred := coalesce(NEW.completed_at, now());
  _period_start := date_trunc('month', _occurred)::date;
  _period_end := (date_trunc('month', _occurred) + interval '1 month - 1 day')::date;

  INSERT INTO public.revenue_events (
    event_type, occurred_at, source_ref, driver_id, rider_id, corporate_id,
    gross_amount_cents, currency, status, recognized_at, metadata
  ) VALUES (
    'RIDE_COMPLETED', _occurred, NEW.id::text, NEW.driver_id, NEW.rider_user_id, _emp.corporate_id,
    _amount, coalesce(NEW.currency,'KES'), 'RECOGNIZED', now(),
    jsonb_build_object('booking_number', NEW.booking_number, 'employee_id', _emp.id)
  )
  RETURNING id INTO _rev_id;

  SELECT id INTO _period_id
    FROM public.corporate_billing_periods
   WHERE corporate_id = _emp.corporate_id
     AND period_start = _period_start
     AND period_end = _period_end;

  IF _period_id IS NULL THEN
    INSERT INTO public.corporate_billing_periods (corporate_id, period_start, period_end, status)
    VALUES (_emp.corporate_id, _period_start, _period_end, 'OPEN')
    ON CONFLICT (corporate_id, period_start, period_end) DO NOTHING
    RETURNING id INTO _period_id;

    IF _period_id IS NULL THEN
      SELECT id INTO _period_id
        FROM public.corporate_billing_periods
       WHERE corporate_id = _emp.corporate_id
         AND period_start = _period_start
         AND period_end = _period_end;
    END IF;
  END IF;

  SELECT * INTO _invoice
    FROM public.corporate_invoices
   WHERE corporate_id = _emp.corporate_id AND period_id = _period_id;

  IF _invoice.id IS NULL THEN
    INSERT INTO public.corporate_invoices (
      corporate_id, period_id, invoice_number, status,
      subtotal_cents, tax_total_cents, total_cents, balance_cents,
      currency, issued_at, due_at, metadata
    ) VALUES (
      _emp.corporate_id, _period_id,
      'INV-' || to_char(_period_start, 'YYYYMM') || '-' || substr(replace(_period_id::text,'-',''), 1, 8),
      'DRAFT', 0, 0, 0, 0, coalesce(NEW.currency,'KES'), now(),
      (_period_end + interval '14 days'),
      jsonb_build_object('source','corporate_trip_settle')
    )
    RETURNING * INTO _invoice;
  END IF;

  IF _invoice.status IN ('VOIDED','PAID') THEN
    RETURN NEW;
  END IF;

  SELECT name INTO _dept FROM public.corporate_departments WHERE id = _emp.department_id;
  BEGIN
    EXECUTE 'SELECT code FROM public.corporate_expense_codes WHERE id = $1'
      INTO _cc USING _emp.cost_center_id;
  EXCEPTION WHEN OTHERS THEN
    _cc := NULL;
  END;

  SELECT coalesce(max(line_number), 0) + 1 INTO _line
    FROM public.corporate_invoice_items WHERE invoice_id = _invoice.id;

  INSERT INTO public.corporate_invoice_items (
    invoice_id, line_number, revenue_event_id, source_ref, description,
    employee_user_id, employee_name, department, cost_center,
    trip_origin, trip_destination, trip_started_at, trip_ended_at,
    quantity, unit_price_cents, taxable_cents, tax_cents, total_cents, metadata
  ) VALUES (
    _invoice.id, _line, _rev_id, coalesce(NEW.booking_number, NEW.id::text),
    'Corporate ride ' || coalesce(NEW.booking_number, NEW.id::text),
    NEW.rider_user_id, _emp.full_name, _dept, _cc,
    NEW.pickup_address, NEW.dropoff_address, NEW.started_at, NEW.completed_at,
    1, _amount, _amount, 0, _amount,
    jsonb_build_object('booking_id', NEW.id, 'employee_id', _emp.id)
  );

  UPDATE public.corporate_invoices i
     SET subtotal_cents = agg.sub,
         tax_total_cents = agg.tax,
         total_cents = agg.sub + agg.tax + i.adjustments_cents,
         balance_cents = agg.sub + agg.tax + i.adjustments_cents - i.paid_cents,
         updated_at = now()
    FROM (
      SELECT coalesce(sum(taxable_cents),0) sub, coalesce(sum(tax_cents),0) tax
        FROM public.corporate_invoice_items WHERE invoice_id = _invoice.id
    ) agg
   WHERE i.id = _invoice.id;

  SELECT coalesce(balance_after_cents, 0) INTO _balance
    FROM public.corporate_cash_ledger
   WHERE corporate_id = _emp.corporate_id
   ORDER BY occurred_at DESC, created_at DESC
   LIMIT 1;

  INSERT INTO public.corporate_cash_ledger (
    corporate_id, entry_type, amount_cents, balance_after_cents, currency,
    reference, description, source_kind, source_id, occurred_at, metadata
  ) VALUES (
    _emp.corporate_id, 'ride_charge', -_amount, coalesce(_balance,0) - _amount,
    coalesce(NEW.currency,'KES'),
    coalesce(NEW.booking_number, NEW.id::text),
    'Completed corporate ride',
    'trip', NEW.id, _occurred,
    jsonb_build_object('invoice_id', _invoice.id, 'revenue_event_id', _rev_id)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_corporate_trip_settle ON public.trip_bookings;
CREATE TRIGGER trg_corporate_trip_settle
AFTER UPDATE OF status ON public.trip_bookings
FOR EACH ROW
EXECUTE FUNCTION public.corporate_trip_settle();

REVOKE ALL ON FUNCTION public.corporate_trip_settle() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.corporate_trip_settle() FROM anon, authenticated;