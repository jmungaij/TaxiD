-- =====================================================================
-- RENTAL ORCHESTRATION — PHASE 2b
-- Compensating actions and the autonomous exception sweeper.
-- =====================================================================

-- Compensation: release a lost/void hold and place the booking on another unit.
CREATE OR REPLACE FUNCTION public.rental_reallocate_booking(_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.rental_bookings; new_unit uuid; run uuid;
BEGIN
  SELECT * INTO b FROM public.rental_bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason_code', 'BOOKING_NOT_FOUND'); END IF;
  IF b.status IN ('RETURNED','CANCELLED','PICKED_UP') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'BOOKING_NOT_REALLOCATABLE');
  END IF;

  run := public.rental_saga_start('REALLOCATE_VEHICLE','booking', b.id, b.booking_reference, b.correlation_id);

  PERFORM pg_advisory_xact_lock(hashtext('rental_allocation'));

  -- Release the current hold (compensation for the failed allocation step).
  DELETE FROM public.rental_unit_commitments WHERE booking_id = b.id AND source = 'BOOKING';
  PERFORM public.rental_saga_record_step(run, 'RELEASE_HOLD', 'COMPENSATED', 'delete rental_unit_commitments',
                                         jsonb_build_object('previous_unit_id', b.unit_id));

  SELECT u.id INTO new_unit
    FROM public.rental_fleet_units u
   WHERE u.status = 'AVAILABLE'
     AND u.asset_class = b.asset_class AND u.band_label = b.band_label
     AND ((b.category = 'SELF_DRIVE' AND u.self_drive) OR (b.category = 'CHAUFFEUR' AND u.chauffeur))
     AND NOT EXISTS (
       SELECT 1 FROM public.rental_unit_commitments c
        WHERE c.unit_id = u.id AND c.start_date <= b.end_date AND c.end_date >= b.start_date)
   ORDER BY u.created_at LIMIT 1;

  IF new_unit IS NULL THEN
    UPDATE public.rental_bookings
       SET unit_id = NULL,
           status = CASE WHEN status = 'CONFIRMED' THEN 'AWAITING_ALLOCATION' ELSE status END
     WHERE id = b.id RETURNING * INTO b;
    PERFORM public.rental_saga_record_step(run, 'ALLOCATE_VEHICLE', 'FAILED', NULL,
                                           jsonb_build_object('reason','NO_VEHICLE_FREE'));
    PERFORM public.rental_saga_close(run, 'ESCALATED', 'NO_VEHICLE_FREE');
    PERFORM public.rental_exception_open('ALLOCATION_PENDING','booking', b.id, b.booking_reference,
              b.correlation_id, jsonb_build_object('start_date', b.start_date, 'end_date', b.end_date,
              'asset_class', b.asset_class, 'band_label', b.band_label), run);
    INSERT INTO public.rental_booking_events (booking_id, event_type, detail)
    VALUES (b.id, 'REALLOCATION_FAILED', jsonb_build_object('saga_run_id', run));
    RETURN jsonb_build_object('ok', false, 'reason_code', 'NO_VEHICLE_FREE', 'booking_reference', b.booking_reference);
  END IF;

  INSERT INTO public.rental_unit_commitments (unit_id, booking_id, start_date, end_date, source, note)
  VALUES (new_unit, b.id, b.start_date, b.end_date, 'BOOKING', 'reallocated');

  UPDATE public.rental_bookings
     SET unit_id = new_unit,
         status = CASE WHEN status = 'AWAITING_ALLOCATION' THEN 'CONFIRMED' ELSE status END
   WHERE id = b.id RETURNING * INTO b;

  PERFORM public.rental_saga_record_step(run, 'ALLOCATE_VEHICLE', 'DONE', NULL,
                                         jsonb_build_object('unit_id', new_unit));
  PERFORM public.rental_saga_close(run, 'COMPLETED');
  INSERT INTO public.rental_booking_events (booking_id, event_type, detail)
  VALUES (b.id, 'VEHICLE_REALLOCATED', jsonb_build_object('unit_id', new_unit, 'saga_run_id', run));
  PERFORM public.rental_emit_event('VehicleAssigned','booking', b.id, b.booking_reference, b.correlation_id,
            jsonb_build_object('unit_id', new_unit), NULL, NULL, new_unit::text);

  RETURN jsonb_build_object('ok', true, 'reason_code', 'REALLOCATED',
    'booking_reference', b.booking_reference, 'unit_id', new_unit, 'status', b.status);
END; $$;
REVOKE ALL ON FUNCTION public.rental_reallocate_booking(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_reallocate_booking(uuid) TO service_role;

-- --------------------------------------------------------------------
-- The autonomous sweeper. Deterministic, idempotent, safe to run often.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rental_exception_sweep()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; res jsonb; ex jsonb;
        expired int := 0; replayed int := 0; shortfall int := 0; duplicates int := 0;
        reallocated int := 0; lost int := 0; overdue int := 0; escalated int := 0;
BEGIN
  -- 1. Unpaid quotations past validity.
  FOR r IN
    SELECT id, reference, correlation_id FROM public.rental_quote_requests
     WHERE payment_status <> 'paid' AND status IN ('QUOTED','AWAITING_PAYMENT') AND expires_at < now()
     LIMIT 200
  LOOP
    UPDATE public.rental_quote_requests SET status = 'EXPIRED' WHERE id = r.id;
    INSERT INTO public.rental_quote_events (quote_id, event_type, detail)
    VALUES (r.id, 'QUOTE_EXPIRED', jsonb_build_object('swept_at', now()));
    ex := public.rental_exception_open('QUOTE_VALIDITY_ELAPSED','quote', r.id, r.reference, r.correlation_id);
    PERFORM public.rental_exception_close((ex ->> 'exception_id')::uuid, 'AUTO_RESOLVED', 'Quotation expired automatically.');
    PERFORM public.rental_emit_event('ReservationExpired','quote', r.id, r.reference, r.correlation_id,
              jsonb_build_object('swept', true), NULL, NULL, 'sweep');
    expired := expired + 1;
  END LOOP;

  -- 2. Verified payment with no settlement (missing or delayed callback).
  FOR r IN
    SELECT q.id, q.reference, q.correlation_id, q.total_kes,
           (SELECT count(*) FROM public.mpesa_transactions t
             WHERE t.status = 'SUCCESS' AND t.deleted_at IS NULL
               AND upper(coalesce(t.account_reference,'')) = q.reference) AS success_count,
           (SELECT max(round(t.amount_cents::numeric/100,2)) FROM public.mpesa_transactions t
             WHERE t.status = 'SUCCESS' AND t.deleted_at IS NULL
               AND upper(coalesce(t.account_reference,'')) = q.reference) AS paid_kes
      FROM public.rental_quote_requests q
     WHERE q.payment_status <> 'paid'
       AND q.status <> 'CANCELLED'
       AND EXISTS (SELECT 1 FROM public.mpesa_transactions t
                    WHERE t.status = 'SUCCESS' AND t.deleted_at IS NULL
                      AND upper(coalesce(t.account_reference,'')) = q.reference)
     LIMIT 200
  LOOP
    IF r.success_count > 1 THEN
      ex := public.rental_exception_open('DUPLICATE_PAYMENT','quote', r.id, r.reference, r.correlation_id,
              jsonb_build_object('verified_payments', r.success_count));
      duplicates := duplicates + 1; escalated := escalated + 1;
      CONTINUE;   -- never auto-settled or auto-refunded
    END IF;
    IF coalesce(r.paid_kes,0) < r.total_kes THEN
      ex := public.rental_exception_open('PAYMENT_SHORTFALL','quote', r.id, r.reference, r.correlation_id,
              jsonb_build_object('amount_paid_kes', r.paid_kes, 'total_kes', r.total_kes));
      shortfall := shortfall + 1; escalated := escalated + 1;
      CONTINUE;
    END IF;
    ex := public.rental_exception_open('PAYMENT_CALLBACK_MISSING','quote', r.id, r.reference, r.correlation_id,
            jsonb_build_object('amount_paid_kes', r.paid_kes));
    res := public.rental_quote_settle_payment(r.reference, NULL);
    IF coalesce((res ->> 'settled')::boolean, false) THEN
      PERFORM public.rental_exception_close((ex ->> 'exception_id')::uuid, 'AUTO_RESOLVED',
              'Settlement replayed from the verified provider record.');
      replayed := replayed + 1;
    END IF;
  END LOOP;

  -- 3. Paid bookings still without a vehicle.
  FOR r IN
    SELECT id, booking_reference FROM public.rental_bookings
     WHERE status = 'AWAITING_ALLOCATION' LIMIT 100
  LOOP
    res := public.rental_reallocate_booking(r.id);
    IF coalesce((res ->> 'ok')::boolean, false) THEN reallocated := reallocated + 1;
    ELSE escalated := escalated + 1; END IF;
  END LOOP;

  -- 4. Confirmed booking whose vehicle is no longer lettable, or whose hold vanished.
  FOR r IN
    SELECT b.id, b.booking_reference, b.correlation_id, b.unit_id
      FROM public.rental_bookings b
      LEFT JOIN public.rental_fleet_units u ON u.id = b.unit_id
     WHERE b.status = 'CONFIRMED'
       AND (b.unit_id IS NULL
            OR u.status <> 'AVAILABLE'
            OR NOT EXISTS (SELECT 1 FROM public.rental_unit_commitments c
                            WHERE c.booking_id = b.id AND c.source = 'BOOKING'))
     LIMIT 100
  LOOP
    ex := public.rental_exception_open('VEHICLE_LOST_AFTER_BOOKING','booking', r.id, r.booking_reference,
            r.correlation_id, jsonb_build_object('previous_unit_id', r.unit_id));
    res := public.rental_reallocate_booking(r.id);
    lost := lost + 1;
    IF coalesce((res ->> 'ok')::boolean, false) THEN
      PERFORM public.rental_exception_close((ex ->> 'exception_id')::uuid, 'AUTO_RESOLVED',
              'Booking moved to another vehicle of the same class.');
      reallocated := reallocated + 1;
    ELSE escalated := escalated + 1; END IF;
  END LOOP;

  -- 5. Vehicle not returned by the agreed date.
  FOR r IN
    SELECT id, booking_reference, correlation_id, end_date FROM public.rental_bookings
     WHERE status = 'PICKED_UP' AND end_date < current_date LIMIT 100
  LOOP
    ex := public.rental_exception_open('RETURN_OVERDUE','booking', r.id, r.booking_reference, r.correlation_id,
            jsonb_build_object('agreed_end_date', r.end_date, 'late_charge_policy','POLICY_REQUIRED'));
    overdue := overdue + 1; escalated := escalated + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true, 'swept_at', now(),
    'quotes_expired', expired, 'settlements_replayed', replayed,
    'payment_shortfalls', shortfall, 'duplicate_payments', duplicates,
    'bookings_reallocated', reallocated, 'vehicles_lost', lost,
    'returns_overdue', overdue, 'escalated_to_humans', escalated);
END; $$;
REVOKE ALL ON FUNCTION public.rental_exception_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_exception_sweep() TO service_role;