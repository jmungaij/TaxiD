-- =====================================================================
-- RENTAL FLEET, AVAILABILITY AND BOOKINGS
-- =====================================================================

CREATE TABLE public.rental_fleet_units (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id    uuid UNIQUE REFERENCES public.vehicles(id) ON DELETE SET NULL,
  plate         text NOT NULL UNIQUE,
  make          text NOT NULL,
  model         text NOT NULL,
  year          integer,
  seats         integer,
  transmission  text,
  home_branch   text,
  asset_class   text,
  band_label    text,
  self_drive    boolean NOT NULL DEFAULT false,
  chauffeur     boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'UNDER_SERVICE'
                  CHECK (status IN ('AVAILABLE','UNDER_SERVICE','RETIRED')),
  provenance    text NOT NULL DEFAULT 'MANUAL',
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.rental_fleet_units IS
  'Real rental stock. A unit is bookable only when status = AVAILABLE and both asset_class and band_label are set (mapped to the published rate card).';

CREATE INDEX idx_rental_units_class ON public.rental_fleet_units (asset_class, band_label, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rental_fleet_units TO authenticated;
GRANT ALL ON public.rental_fleet_units TO service_role;
ALTER TABLE public.rental_fleet_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commercial staff read rental fleet" ON public.rental_fleet_units
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read') OR public.has_staff_permission('staff.commercial.write'));
CREATE POLICY "Commercial staff manage rental fleet" ON public.rental_fleet_units
  FOR ALL TO authenticated
  USING (public.has_staff_permission('staff.commercial.write'))
  WITH CHECK (public.has_staff_permission('staff.commercial.write'));

-- ---------------------------------------------------------------- bookings
CREATE TABLE public.rental_bookings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_reference  text NOT NULL UNIQUE,
  quote_id           uuid NOT NULL UNIQUE REFERENCES public.rental_quote_requests(id) ON DELETE RESTRICT,
  unit_id            uuid REFERENCES public.rental_fleet_units(id) ON DELETE SET NULL,
  category           text NOT NULL,
  asset_class        text NOT NULL,
  band_label         text NOT NULL,
  start_date         date NOT NULL,
  end_date           date NOT NULL,
  pickup_location    text NOT NULL,
  contact_name       text NOT NULL,
  contact_email      text NOT NULL,
  contact_phone      text NOT NULL,
  company_name       text,
  rider_user_id      uuid,
  total_kes          numeric(14,2) NOT NULL,
  amount_paid_kes    numeric(14,2) NOT NULL DEFAULT 0,
  currency           text NOT NULL DEFAULT 'KES',
  mpesa_receipt      text,
  status             text NOT NULL DEFAULT 'CONFIRMED'
                       CHECK (status IN ('CONFIRMED','AWAITING_ALLOCATION','PICKED_UP','RETURNED','CANCELLED')),
  picked_up_at       timestamptz,
  returned_at        timestamptz,
  change_request     text CHECK (change_request IN ('RESCHEDULE','CANCELLATION')),
  change_requested_at timestamptz,
  requested_start_date date,
  requested_end_date   date,
  change_reason      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX idx_rental_bookings_owner ON public.rental_bookings (rider_user_id, lower(contact_email));

GRANT SELECT, INSERT, UPDATE ON public.rental_bookings TO authenticated;
GRANT ALL ON public.rental_bookings TO service_role;
ALTER TABLE public.rental_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commercial staff read rental bookings" ON public.rental_bookings
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read') OR public.has_staff_permission('staff.commercial.write'));
CREATE POLICY "Commercial staff update rental bookings" ON public.rental_bookings
  FOR UPDATE TO authenticated
  USING (public.has_staff_permission('staff.commercial.write'))
  WITH CHECK (public.has_staff_permission('staff.commercial.write'));
CREATE POLICY "Customers read their own rental bookings" ON public.rental_bookings
  FOR SELECT TO authenticated
  USING (
    rider_user_id = auth.uid()
    OR lower(contact_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- ---------------------------------------------------------- commitments
CREATE TABLE public.rental_unit_commitments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id     uuid NOT NULL REFERENCES public.rental_fleet_units(id) ON DELETE CASCADE,
  booking_id  uuid REFERENCES public.rental_bookings(id) ON DELETE CASCADE,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  source      text NOT NULL DEFAULT 'BOOKING' CHECK (source IN ('BOOKING','BLOCK','SERVICE')),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);
CREATE INDEX idx_rental_commitments_unit ON public.rental_unit_commitments (unit_id, start_date, end_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rental_unit_commitments TO authenticated;
GRANT ALL ON public.rental_unit_commitments TO service_role;
ALTER TABLE public.rental_unit_commitments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commercial staff read rental commitments" ON public.rental_unit_commitments
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read') OR public.has_staff_permission('staff.commercial.write'));
CREATE POLICY "Commercial staff manage rental commitments" ON public.rental_unit_commitments
  FOR ALL TO authenticated
  USING (public.has_staff_permission('staff.commercial.write'))
  WITH CHECK (public.has_staff_permission('staff.commercial.write'));

-- No two commitments may overlap on the same vehicle. Enforced in the database
-- so no application path can double-allocate a vehicle.
CREATE OR REPLACE FUNCTION public._rental_commitment_no_overlap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.rental_unit_commitments c
     WHERE c.unit_id = NEW.unit_id
       AND c.id <> NEW.id
       AND c.start_date <= NEW.end_date
       AND c.end_date   >= NEW.start_date
  ) THEN
    RAISE EXCEPTION 'RENTAL_UNIT_ALREADY_COMMITTED';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_rental_commitment_no_overlap
  BEFORE INSERT OR UPDATE ON public.rental_unit_commitments
  FOR EACH ROW EXECUTE FUNCTION public._rental_commitment_no_overlap();

-- --------------------------------------------------------------- events
CREATE TABLE public.rental_booking_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES public.rental_bookings(id) ON DELETE CASCADE,
  event_type  text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id    uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rental_booking_events_booking ON public.rental_booking_events (booking_id, created_at DESC);

GRANT SELECT ON public.rental_booking_events TO authenticated;
GRANT ALL ON public.rental_booking_events TO service_role;
ALTER TABLE public.rental_booking_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commercial staff read rental booking events" ON public.rental_booking_events
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read') OR public.has_staff_permission('staff.commercial.write'));

CREATE OR REPLACE FUNCTION public._rental_events_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'RENTAL_BOOKING_EVENTS_ARE_APPEND_ONLY';
END; $$;
CREATE TRIGGER trg_rental_events_append_only
  BEFORE UPDATE OR DELETE ON public.rental_booking_events
  FOR EACH ROW EXECUTE FUNCTION public._rental_events_append_only();

-- ---------------------------------------------------------- touch triggers
CREATE TRIGGER trg_rental_units_touch BEFORE UPDATE ON public.rental_fleet_units
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_rental_bookings_touch BEFORE UPDATE ON public.rental_bookings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================================
-- AVAILABILITY (server side only)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.rental_unit_is_free(
  _unit_id uuid, _start date, _end date, _exclude_booking uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.rental_unit_commitments c
     WHERE c.unit_id = _unit_id
       AND (_exclude_booking IS NULL OR c.booking_id IS DISTINCT FROM _exclude_booking)
       AND c.start_date <= _end
       AND c.end_date   >= _start
  );
$$;
REVOKE ALL ON FUNCTION public.rental_unit_is_free(uuid, date, date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_unit_is_free(uuid, date, date, uuid) TO service_role;

-- Public: how many vehicles of each rate-card class are genuinely free for the
-- requested window. Never exposes plates, vehicle identity or customer data.
CREATE OR REPLACE FUNCTION public.rental_fleet_availability(
  _category text, _start_date date, _rental_days integer
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cat text := upper(coalesce(_category, ''));
  d   integer := greatest(1, least(coalesce(_rental_days, 1), 365));
  s   date;
  e   date;
  rows jsonb;
BEGIN
  IF cat NOT IN ('SELF_DRIVE','CHAUFFEUR') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'UNKNOWN_CATEGORY');
  END IF;
  s := coalesce(_start_date, current_date);
  IF s < current_date THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'START_DATE_IN_THE_PAST');
  END IF;
  e := s + (d - 1);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'asset_class', t.asset_class,
           'band_label',  t.band_label,
           'seats',       t.seats,
           'units_free',  t.units_free
         ) ORDER BY t.asset_class, t.band_label), '[]'::jsonb)
    INTO rows
    FROM (
      SELECT u.asset_class, u.band_label, min(u.seats) AS seats, count(*) AS units_free
        FROM public.rental_fleet_units u
       WHERE u.status = 'AVAILABLE'
         AND u.asset_class IS NOT NULL
         AND u.band_label IS NOT NULL
         AND ((cat = 'SELF_DRIVE' AND u.self_drive) OR (cat = 'CHAUFFEUR' AND u.chauffeur))
         AND NOT EXISTS (
           SELECT 1 FROM public.rental_unit_commitments c
            WHERE c.unit_id = u.id AND c.start_date <= e AND c.end_date >= s
         )
       GROUP BY u.asset_class, u.band_label
    ) t;

  RETURN jsonb_build_object(
    'ok', true, 'category', cat, 'start_date', s, 'end_date', e,
    'rental_days', d, 'classes', rows,
    'any_available', jsonb_array_length(rows) > 0
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.rental_fleet_availability(text, date, integer) TO anon, authenticated, service_role;

-- =====================================================================
-- ALLOCATION ON VERIFIED PAYMENT
-- =====================================================================

CREATE OR REPLACE FUNCTION public._rental_booking_reference() RETURNS text
LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT 'RB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
$$;

CREATE OR REPLACE FUNCTION public.rental_allocate_for_quote(_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  q public.rental_quote_requests;
  unit_id uuid;
  b public.rental_bookings;
  ref text;
BEGIN
  SELECT * INTO q FROM public.rental_quote_requests WHERE id = _quote_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason_code', 'QUOTE_NOT_FOUND'); END IF;

  SELECT * INTO b FROM public.rental_bookings WHERE quote_id = q.id;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'reason_code', 'ALREADY_BOOKED',
      'booking_reference', b.booking_reference, 'status', b.status);
  END IF;

  -- Serialise allocation so two payments cannot claim the same vehicle.
  PERFORM pg_advisory_xact_lock(hashtext('rental_allocation'));

  SELECT u.id INTO unit_id
    FROM public.rental_fleet_units u
   WHERE u.status = 'AVAILABLE'
     AND u.asset_class = q.asset_class
     AND u.band_label = q.band_label
     AND ((q.category = 'SELF_DRIVE' AND u.self_drive) OR (q.category = 'CHAUFFEUR' AND u.chauffeur))
     AND NOT EXISTS (
       SELECT 1 FROM public.rental_unit_commitments c
        WHERE c.unit_id = u.id AND c.start_date <= q.end_date AND c.end_date >= q.start_date
     )
   ORDER BY u.created_at
   LIMIT 1;

  ref := public._rental_booking_reference();

  INSERT INTO public.rental_bookings (
    booking_reference, quote_id, unit_id, category, asset_class, band_label,
    start_date, end_date, pickup_location, contact_name, contact_email,
    contact_phone, company_name, rider_user_id, total_kes, amount_paid_kes,
    currency, mpesa_receipt, status
  ) VALUES (
    ref, q.id, unit_id, q.category, q.asset_class, q.band_label,
    q.start_date, q.end_date, q.pickup_location, q.contact_name, q.contact_email,
    q.contact_phone, q.company_name, q.requested_by, q.total_kes, q.amount_paid_kes,
    q.currency, q.mpesa_receipt,
    CASE WHEN unit_id IS NULL THEN 'AWAITING_ALLOCATION' ELSE 'CONFIRMED' END
  ) RETURNING * INTO b;

  IF unit_id IS NOT NULL THEN
    INSERT INTO public.rental_unit_commitments (unit_id, booking_id, start_date, end_date, source)
    VALUES (unit_id, b.id, b.start_date, b.end_date, 'BOOKING');
  END IF;

  INSERT INTO public.rental_booking_events (booking_id, event_type, detail)
  VALUES (b.id, CASE WHEN unit_id IS NULL THEN 'BOOKING_AWAITING_ALLOCATION' ELSE 'BOOKING_CONFIRMED' END,
          jsonb_build_object('quote_reference', q.reference, 'unit_id', unit_id));

  RETURN jsonb_build_object('ok', true, 'reason_code',
    CASE WHEN unit_id IS NULL THEN 'AWAITING_ALLOCATION' ELSE 'ALLOCATED' END,
    'booking_reference', b.booking_reference, 'status', b.status, 'unit_id', unit_id);
END; $$;
REVOKE ALL ON FUNCTION public.rental_allocate_for_quote(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_allocate_for_quote(uuid) TO service_role;

-- Settlement now allocates a vehicle in the SAME transaction as the payment
-- confirmation, so a paid quotation can never exist without a booking record.
CREATE OR REPLACE FUNCTION public.rental_quote_settle_payment(
  _reference text, _checkout_request_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.rental_quote_requests; t public.mpesa_transactions;
        paid_kes numeric(14,2); alloc jsonb;
BEGIN
  SELECT * INTO q FROM public.rental_quote_requests
   WHERE reference = upper(coalesce(_reference,'')) FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('settled', false, 'reason_code', 'QUOTE_NOT_FOUND');
  END IF;

  IF q.payment_status = 'paid' THEN
    alloc := public.rental_allocate_for_quote(q.id);
    RETURN jsonb_build_object('settled', true, 'reason_code', 'ALREADY_SETTLED',
      'reference', q.reference, 'booking_reference', alloc ->> 'booking_reference',
      'booking_status', alloc ->> 'status');
  END IF;

  SELECT * INTO t FROM public.mpesa_transactions
   WHERE status = 'SUCCESS'
     AND deleted_at IS NULL
     AND upper(coalesce(account_reference,'')) = q.reference
     AND (_checkout_request_id IS NULL OR checkout_request_id = _checkout_request_id)
   ORDER BY created_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('settled', false, 'reason_code', 'NO_VERIFIED_PAYMENT', 'reference', q.reference);
  END IF;

  paid_kes := round(t.amount_cents::numeric / 100, 2);
  IF paid_kes < q.total_kes THEN
    INSERT INTO public.rental_quote_events (quote_id, event_type, detail)
    VALUES (q.id, 'PAYMENT_SHORTFALL', jsonb_build_object('amount_paid_kes', paid_kes, 'total_kes', q.total_kes));
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

  alloc := public.rental_allocate_for_quote(q.id);

  RETURN jsonb_build_object('settled', true, 'reason_code', 'SETTLED', 'reference', q.reference,
    'amount_paid_kes', paid_kes, 'mpesa_receipt', t.mpesa_receipt,
    'booking_reference', alloc ->> 'booking_reference', 'booking_status', alloc ->> 'status');
END; $$;
REVOKE ALL ON FUNCTION public.rental_quote_settle_payment(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_quote_settle_payment(text, text) TO service_role;

-- =====================================================================
-- CUSTOMER SURFACES
-- =====================================================================

-- Signed-in customer: their quotations and bookings.
CREATE OR REPLACE FUNCTION public.rental_my_rentals()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
        quotes jsonb; bookings jsonb;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'AUTHENTICATION_REQUIRED');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'reference', q.reference, 'token', q.token, 'category', q.category,
           'band_label', q.band_label, 'start_date', q.start_date, 'end_date', q.end_date,
           'rental_days', q.rental_days, 'pickup_location', q.pickup_location,
           'total_kes', q.total_kes, 'currency', q.currency, 'status', q.status,
           'payment_status', q.payment_status, 'expires_at', q.expires_at,
           'expired', q.expires_at < now() AND q.payment_status <> 'paid',
           'created_at', q.created_at
         ) ORDER BY q.created_at DESC), '[]'::jsonb)
    INTO quotes
    FROM public.rental_quote_requests q
   WHERE (q.requested_by = uid OR (mail <> '' AND lower(q.contact_email) = mail))
     AND q.payment_status <> 'paid';

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'booking_reference', b.booking_reference, 'category', b.category,
           'band_label', b.band_label, 'asset_class', b.asset_class,
           'start_date', b.start_date, 'end_date', b.end_date,
           'pickup_location', b.pickup_location, 'total_kes', b.total_kes,
           'amount_paid_kes', b.amount_paid_kes, 'currency', b.currency,
           'mpesa_receipt', b.mpesa_receipt, 'status', b.status,
           'picked_up_at', b.picked_up_at, 'returned_at', b.returned_at,
           'change_request', b.change_request, 'change_requested_at', b.change_requested_at,
           'requested_start_date', b.requested_start_date, 'requested_end_date', b.requested_end_date,
           'vehicle', CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object(
              'make', u.make, 'model', u.model, 'year', u.year,
              'transmission', u.transmission, 'seats', u.seats) END,
           'quote_token', q.token, 'created_at', b.created_at
         ) ORDER BY b.start_date DESC), '[]'::jsonb)
    INTO bookings
    FROM public.rental_bookings b
    LEFT JOIN public.rental_fleet_units u ON u.id = b.unit_id
    LEFT JOIN public.rental_quote_requests q ON q.id = b.quote_id
   WHERE b.rider_user_id = uid OR (mail <> '' AND lower(b.contact_email) = mail);

  RETURN jsonb_build_object('ok', true, 'quotes', quotes, 'bookings', bookings);
END; $$;
REVOKE ALL ON FUNCTION public.rental_my_rentals() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rental_my_rentals() TO authenticated, service_role;

-- Customer requests a change. Allowed with the private quotation token (guest
-- bookings) or while signed in with the email the booking was made under.
CREATE OR REPLACE FUNCTION public.rental_booking_request_change(
  _booking_reference text, _action text, _token text DEFAULT NULL,
  _new_start date DEFAULT NULL, _new_end date DEFAULT NULL, _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.rental_bookings; q public.rental_quote_requests;
        act text := upper(coalesce(_action, '')); authorised boolean := false;
        uid uuid := auth.uid(); mail text := lower(coalesce(auth.jwt() ->> 'email', ''));
        free_units integer;
BEGIN
  IF act NOT IN ('RESCHEDULE','CANCELLATION') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'UNKNOWN_ACTION');
  END IF;

  SELECT * INTO b FROM public.rental_bookings
   WHERE booking_reference = upper(coalesce(_booking_reference,'')) FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'BOOKING_NOT_FOUND');
  END IF;

  SELECT * INTO q FROM public.rental_quote_requests WHERE id = b.quote_id;
  IF _token IS NOT NULL AND length(_token) >= 20 AND q.token = _token THEN
    authorised := true;
  ELSIF uid IS NOT NULL AND (b.rider_user_id = uid OR (mail <> '' AND lower(b.contact_email) = mail)) THEN
    authorised := true;
  END IF;
  IF authorised IS NOT true THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'NOT_AUTHORISED_FOR_BOOKING');
  END IF;

  IF b.status IN ('RETURNED','CANCELLED') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'BOOKING_CLOSED');
  END IF;
  IF b.change_request IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'CHANGE_ALREADY_REQUESTED');
  END IF;

  IF act = 'RESCHEDULE' THEN
    IF _new_start IS NULL OR _new_end IS NULL OR _new_end < _new_start THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'NEW_DATES_REQUIRED');
    END IF;
    IF _new_start < current_date THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'START_DATE_IN_THE_PAST');
    END IF;
    IF (_new_end - _new_start) <> (b.end_date - b.start_date) THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'RENTAL_LENGTH_MUST_MATCH');
    END IF;
    SELECT count(*) INTO free_units
      FROM public.rental_fleet_units u
     WHERE u.status = 'AVAILABLE' AND u.asset_class = b.asset_class AND u.band_label = b.band_label
       AND ((b.category = 'SELF_DRIVE' AND u.self_drive) OR (b.category = 'CHAUFFEUR' AND u.chauffeur))
       AND NOT EXISTS (
         SELECT 1 FROM public.rental_unit_commitments c
          WHERE c.unit_id = u.id AND c.booking_id IS DISTINCT FROM b.id
            AND c.start_date <= _new_end AND c.end_date >= _new_start
       );
    IF coalesce(free_units, 0) < 1 THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'NO_VEHICLE_FREE_ON_THOSE_DATES');
    END IF;
  ELSE
    IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'CANCELLATION_REASON_REQUIRED');
    END IF;
  END IF;

  UPDATE public.rental_bookings
     SET change_request = act, change_requested_at = now(),
         requested_start_date = CASE WHEN act = 'RESCHEDULE' THEN _new_start ELSE NULL END,
         requested_end_date   = CASE WHEN act = 'RESCHEDULE' THEN _new_end ELSE NULL END,
         change_reason = left(btrim(coalesce(_reason, '')), 1000)
   WHERE id = b.id;

  INSERT INTO public.rental_booking_events (booking_id, event_type, detail, actor_id)
  VALUES (b.id, 'CUSTOMER_' || act || '_REQUESTED',
          jsonb_build_object('new_start', _new_start, 'new_end', _new_end,
                             'reason', left(btrim(coalesce(_reason, '')), 1000)), uid);

  RETURN jsonb_build_object('ok', true, 'reason_code', 'CHANGE_REQUESTED', 'action', act);
END; $$;
GRANT EXECUTE ON FUNCTION public.rental_booking_request_change(text, text, text, date, date, text)
  TO anon, authenticated, service_role;

-- =====================================================================
-- STAFF LIFECYCLE ACTIONS
-- =====================================================================
CREATE OR REPLACE FUNCTION public.rental_booking_staff_action(
  _booking_reference text, _action text, _note text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.rental_bookings; act text := upper(coalesce(_action,''));
        uid uuid := auth.uid(); new_unit uuid;
BEGIN
  IF public.has_staff_permission('staff.commercial.write') IS NOT true THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'NOT_AUTHORISED');
  END IF;

  SELECT * INTO b FROM public.rental_bookings
   WHERE booking_reference = upper(coalesce(_booking_reference,'')) FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'BOOKING_NOT_FOUND');
  END IF;

  IF act = 'CONFIRM_PICKUP' THEN
    IF b.status <> 'CONFIRMED' THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'ONLY_A_CONFIRMED_BOOKING_CAN_BE_COLLECTED');
    END IF;
    IF b.unit_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'ALLOCATE_A_VEHICLE_FIRST');
    END IF;
    UPDATE public.rental_bookings SET status = 'PICKED_UP', picked_up_at = now() WHERE id = b.id;

  ELSIF act = 'CONFIRM_RETURN' THEN
    IF b.status <> 'PICKED_UP' THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'ONLY_A_COLLECTED_BOOKING_CAN_BE_RETURNED');
    END IF;
    UPDATE public.rental_bookings SET status = 'RETURNED', returned_at = now() WHERE id = b.id;
    UPDATE public.rental_unit_commitments SET end_date = least(end_date, current_date)
     WHERE booking_id = b.id;

  ELSIF act = 'APPROVE_RESCHEDULE' THEN
    IF b.change_request <> 'RESCHEDULE' THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'NO_RESCHEDULE_REQUESTED');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('rental_allocation'));
    SELECT u.id INTO new_unit
      FROM public.rental_fleet_units u
     WHERE u.status = 'AVAILABLE' AND u.asset_class = b.asset_class AND u.band_label = b.band_label
       AND ((b.category = 'SELF_DRIVE' AND u.self_drive) OR (b.category = 'CHAUFFEUR' AND u.chauffeur))
       AND NOT EXISTS (
         SELECT 1 FROM public.rental_unit_commitments c
          WHERE c.unit_id = u.id AND c.booking_id IS DISTINCT FROM b.id
            AND c.start_date <= b.requested_end_date AND c.end_date >= b.requested_start_date
       )
     ORDER BY (u.id = b.unit_id) DESC, u.created_at
     LIMIT 1;
    IF new_unit IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'NO_VEHICLE_FREE_ON_THOSE_DATES');
    END IF;
    DELETE FROM public.rental_unit_commitments WHERE booking_id = b.id;
    INSERT INTO public.rental_unit_commitments (unit_id, booking_id, start_date, end_date, source)
    VALUES (new_unit, b.id, b.requested_start_date, b.requested_end_date, 'BOOKING');
    UPDATE public.rental_bookings
       SET start_date = b.requested_start_date, end_date = b.requested_end_date,
           unit_id = new_unit, change_request = NULL, change_requested_at = NULL,
           requested_start_date = NULL, requested_end_date = NULL
     WHERE id = b.id;

  ELSIF act = 'APPROVE_CANCELLATION' THEN
    IF b.change_request <> 'CANCELLATION' THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'NO_CANCELLATION_REQUESTED');
    END IF;
    DELETE FROM public.rental_unit_commitments WHERE booking_id = b.id;
    UPDATE public.rental_bookings
       SET status = 'CANCELLED', change_request = NULL, change_requested_at = NULL
     WHERE id = b.id;

  ELSIF act = 'DECLINE_CHANGE' THEN
    IF b.change_request IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason_code', 'NO_CHANGE_REQUESTED');
    END IF;
    UPDATE public.rental_bookings
       SET change_request = NULL, change_requested_at = NULL,
           requested_start_date = NULL, requested_end_date = NULL
     WHERE id = b.id;

  ELSE
    RETURN jsonb_build_object('ok', false, 'reason_code', 'UNKNOWN_ACTION');
  END IF;

  INSERT INTO public.rental_booking_events (booking_id, event_type, detail, actor_id)
  VALUES (b.id, 'STAFF_' || act, jsonb_build_object('note', left(btrim(coalesce(_note,'')), 1000)), uid);

  RETURN jsonb_build_object('ok', true, 'reason_code', act);
END; $$;
REVOKE ALL ON FUNCTION public.rental_booking_staff_action(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rental_booking_staff_action(text, text, text) TO authenticated, service_role;

-- =====================================================================
-- IMPORT THE EXISTING VEHICLE RECORDS AS FLEET UNITS
-- Imported UNDER_SERVICE and unmapped: nothing becomes quotable until the
-- commercial team confirms each vehicle's real rate-card class.
-- =====================================================================
INSERT INTO public.rental_fleet_units
  (vehicle_id, plate, make, model, year, seats, transmission, status, provenance, notes)
SELECT v.id, v.number_plate, btrim(v.make), btrim(v.model), v.year,
       v.seating_capacity, v.transmission, 'UNDER_SERVICE', 'IMPORTED_FROM_VEHICLES',
       'Imported from the vehicle register. Confirm the rate-card class and set to Available before it can be quoted.'
  FROM public.vehicles v
 WHERE v.vehicle_type = 'car'
   AND v.number_plate IS NOT NULL
ON CONFLICT (plate) DO NOTHING;
