-- =====================================================================
-- Provider supply chain: driver approval -> capacity -> booking -> revenue
-- =====================================================================

ALTER TABLE public.provider_capacity
  ADD COLUMN IF NOT EXISTS source_application_id uuid,
  ADD COLUMN IF NOT EXISTS source_driver_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS provider_capacity_source_application_uk
  ON public.provider_capacity (source_application_id)
  WHERE source_application_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 1. Approved driver application seeds a DRAFT marketplace listing
--    built ONLY from details the applicant actually supplied.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provider_capacity_seed_from_application(_application_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  a public.driver_applications;
  v_family text;
  v_id uuid;
  v_cats text;
  v_title text;
BEGIN
  SELECT * INTO a FROM public.driver_applications WHERE id = _application_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'UNKNOWN_APPLICATION'); END IF;
  IF a.status <> 'APPROVED' THEN
    RETURN jsonb_build_object('error', true, 'code', 'APPLICATION_NOT_APPROVED');
  END IF;
  IF a.applicant_user_id IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code', 'APPLICATION_NOT_CLAIMED');
  END IF;

  SELECT id INTO v_id FROM public.provider_capacity WHERE source_application_id = _application_id;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', v_id, 'already_seeded', true);
  END IF;

  IF coalesce(nullif(btrim(coalesce(a.vehicle_make_model,'')),''),
              nullif(btrim(coalesce(a.vehicle_registration,'')),'')) IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code', 'VEHICLE_DETAILS_REQUIRED');
  END IF;

  v_cats := lower(coalesce(array_to_string(a.service_categories, ','), ''));
  v_family := CASE
    WHEN v_cats LIKE '%freight%' OR v_cats LIKE '%logistic%' OR v_cats LIKE '%deliver%'
      OR v_cats LIKE '%courier%' OR v_cats LIKE '%parcel%' THEN 'logistics'
    WHEN v_cats LIKE '%charter%' THEN 'charter'
    WHEN v_cats LIKE '%rental%' OR v_cats LIKE '%lease%' OR v_cats LIKE '%leasing%' THEN 'rental'
    ELSE 'ride'
  END;

  v_title := coalesce(nullif(btrim(coalesce(a.vehicle_make_model,'')),''),
                      'Driver vehicle ' || coalesce(a.vehicle_registration, a.application_reference));

  INSERT INTO public.provider_capacity (
    provider_user_id, provider_name, provider_kind, family, title,
    vehicle_type, spec, units, base_city, rate_amount, rate_basis, currency,
    registration_ref, notes, status, source_application_id, source_driver_id
  ) VALUES (
    a.applicant_user_id,
    btrim(a.first_name || ' ' || coalesce(a.last_name,'')),
    'DRIVER', v_family, v_title,
    coalesce(nullif(btrim(coalesce(a.vehicle_make_model,'')),''), 'To be confirmed'),
    nullif(btrim(coalesce(a.vehicle_registration,'')),''),
    1,
    coalesce(nullif(a.preferred_city,''), nullif(a.town,''), 'To be confirmed'),
    NULL, 'on_request', 'KES',
    nullif(btrim(coalesce(a.vehicle_registration,'')),''),
    'Created automatically from approved driver application ' || a.application_reference
      || '. Confirm the vehicle type, base city and your rate, then submit for approval.',
    'DRAFT', a.id, a.driver_id
  ) RETURNING id INTO v_id;

  INSERT INTO public.provider_capacity_events (capacity_id, action, status_to, reason, actor_user_id)
  VALUES (v_id, 'SEEDED_FROM_DRIVER_APPLICATION', 'DRAFT',
          'Driver application ' || a.application_reference || ' approved', auth.uid());

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'family', v_family);
END; $$;

REVOKE ALL ON FUNCTION public.provider_capacity_seed_from_application(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_capacity_seed_from_application(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._driver_approval_seeds_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'APPROVED' AND coalesce(OLD.status,'') <> 'APPROVED' THEN
    PERFORM public.provider_capacity_seed_from_application(NEW.id);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS driver_approval_seeds_capacity ON public.driver_applications;
CREATE TRIGGER driver_approval_seeds_capacity
AFTER UPDATE OF status ON public.driver_applications
FOR EACH ROW EXECUTE FUNCTION public._driver_approval_seeds_capacity();

-- ---------------------------------------------------------------------
-- 2. Provider bookings
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provider_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_reference text NOT NULL UNIQUE,
  capacity_id uuid NOT NULL REFERENCES public.provider_capacity(id),
  enquiry_id uuid REFERENCES public.capacity_enquiries(id),
  provider_user_id uuid NOT NULL,
  customer_user_id uuid,
  customer_company text,
  customer_contact_name text,
  customer_email text,
  customer_phone text,
  service_from date,
  service_to date,
  qty numeric NOT NULL DEFAULT 1,
  unit_rate_cents bigint NOT NULL DEFAULT 0,
  amount_cents bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'KES',
  status text NOT NULL DEFAULT 'REQUESTED',
  notes text,
  lead_id uuid,
  proforma_id uuid,
  proforma_reference text,
  invoice_id uuid,
  invoice_reference text,
  is_test boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.provider_booking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.provider_bookings(id) ON DELETE CASCADE,
  action text NOT NULL,
  status_from text,
  status_to text,
  note text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.provider_bookings TO authenticated;
GRANT ALL ON public.provider_bookings TO service_role;
GRANT SELECT ON public.provider_booking_events TO authenticated;
GRANT ALL ON public.provider_booking_events TO service_role;

ALTER TABLE public.provider_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_booking_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS provider_bookings_read ON public.provider_bookings;
CREATE POLICY provider_bookings_read ON public.provider_bookings
FOR SELECT TO authenticated
USING (
  provider_user_id = auth.uid()
  OR customer_user_id = auth.uid()
  OR public.capacity_can_approve(auth.uid())
);

DROP POLICY IF EXISTS provider_booking_events_read ON public.provider_booking_events;
CREATE POLICY provider_booking_events_read ON public.provider_booking_events
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.provider_bookings b
   WHERE b.id = booking_id
     AND (b.provider_user_id = auth.uid() OR b.customer_user_id = auth.uid()
          OR public.capacity_can_approve(auth.uid()))
));

CREATE OR REPLACE FUNCTION public._provider_booking_events_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'BOOKING_HISTORY_IS_APPEND_ONLY';
END; $$;

DROP TRIGGER IF EXISTS provider_booking_events_append_only ON public.provider_booking_events;
CREATE TRIGGER provider_booking_events_append_only
BEFORE UPDATE OR DELETE ON public.provider_booking_events
FOR EACH ROW EXECUTE FUNCTION public._provider_booking_events_append_only();

DROP TRIGGER IF EXISTS provider_bookings_touch ON public.provider_bookings;
CREATE TRIGGER provider_bookings_touch
BEFORE UPDATE ON public.provider_bookings
FOR EACH ROW EXECUTE FUNCTION public._provider_capacity_touch();

-- ---------------------------------------------------------------------
-- 3. Booking lifecycle RPCs
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._provider_booking_reference()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_year text := to_char(now(), 'YYYY'); v_seq int;
BEGIN
  SELECT count(*) + 1 INTO v_seq FROM public.provider_bookings
   WHERE booking_reference LIKE 'YAL-BKG-' || v_year || '-%';
  RETURN 'YAL-BKG-' || v_year || '-' || lpad(v_seq::text, 6, '0');
END; $$;

CREATE OR REPLACE FUNCTION public.provider_booking_create(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_capacity uuid := NULLIF(p->>'capacity_id','')::uuid;
  v_enquiry uuid := NULLIF(p->>'enquiry_id','')::uuid;
  c public.provider_capacity;
  e public.capacity_enquiries;
  v_qty numeric := COALESCE(NULLIF(p->>'qty','')::numeric, 1);
  v_rate bigint := COALESCE(NULLIF(p->>'unit_rate_cents','')::bigint, 0);
  v_id uuid;
  v_ref text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;

  IF v_capacity IS NULL AND v_enquiry IS NOT NULL THEN
    SELECT capacity_id INTO v_capacity FROM public.capacity_enquiries WHERE id = v_enquiry;
  END IF;
  IF v_capacity IS NULL THEN RAISE EXCEPTION 'CAPACITY_REQUIRED'; END IF;

  SELECT * INTO c FROM public.provider_capacity WHERE id = v_capacity;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_NOT_AVAILABLE'; END IF;
  IF c.status <> 'PUBLISHED' THEN RAISE EXCEPTION 'CAPACITY_NOT_PUBLISHED'; END IF;
  IF c.provider_user_id <> v_uid AND NOT public.capacity_can_approve(v_uid) THEN
    RAISE EXCEPTION 'NOT_YOUR_CAPACITY';
  END IF;

  IF v_enquiry IS NOT NULL THEN
    SELECT * INTO e FROM public.capacity_enquiries WHERE id = v_enquiry;
    IF e.capacity_id <> v_capacity THEN RAISE EXCEPTION 'ENQUIRY_CAPACITY_MISMATCH'; END IF;
    IF EXISTS (SELECT 1 FROM public.provider_bookings WHERE enquiry_id = v_enquiry) THEN
      RAISE EXCEPTION 'BOOKING_ALREADY_RAISED_FOR_ENQUIRY';
    END IF;
  END IF;

  v_ref := public._provider_booking_reference();

  INSERT INTO public.provider_bookings (
    booking_reference, capacity_id, enquiry_id, provider_user_id, customer_user_id,
    customer_company, customer_contact_name, customer_email, customer_phone,
    service_from, service_to, qty, unit_rate_cents, amount_cents, currency,
    status, notes, is_test, created_by
  ) VALUES (
    v_ref, v_capacity, v_enquiry, c.provider_user_id,
    COALESCE(e.requester_user_id, NULLIF(p->>'customer_user_id','')::uuid),
    COALESCE(NULLIF(p->>'customer_company',''), e.organisation_name),
    COALESCE(NULLIF(p->>'customer_contact_name',''), e.contact_name),
    NULLIF(p->>'customer_email',''), NULLIF(p->>'customer_phone',''),
    COALESCE(NULLIF(p->>'service_from','')::date, e.service_date),
    NULLIF(p->>'service_to','')::date,
    v_qty, v_rate, ROUND(v_qty * v_rate)::bigint,
    COALESCE(NULLIF(p->>'currency',''), c.currency, 'KES'),
    'REQUESTED', COALESCE(NULLIF(p->>'notes',''), e.requirement),
    COALESCE((p->>'is_test')::boolean, false), v_uid
  ) RETURNING id INTO v_id;

  INSERT INTO public.provider_booking_events (booking_id, action, status_to, note, actor_user_id)
  VALUES (v_id, 'CREATED', 'REQUESTED', NULLIF(p->>'notes',''), v_uid);

  IF v_enquiry IS NOT NULL THEN
    UPDATE public.capacity_enquiries
       SET status = CASE WHEN status = 'NEW' THEN 'ACKNOWLEDGED' ELSE status END,
           acknowledged_at = COALESCE(acknowledged_at, now())
     WHERE id = v_enquiry;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'booking_reference', v_ref);
END; $$;

CREATE OR REPLACE FUNCTION public.provider_booking_set_status(_booking_id uuid, _status text, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  b public.provider_bookings;
  v_to text := upper(coalesce(_status,''));
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT * INTO b FROM public.provider_bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_BOOKING'; END IF;
  IF b.provider_user_id <> v_uid AND NOT public.capacity_can_approve(v_uid) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_FOR_BOOKING';
  END IF;
  IF v_to NOT IN ('CONFIRMED','DELIVERED','CANCELLED') THEN RAISE EXCEPTION 'UNKNOWN_BOOKING_STATUS'; END IF;
  IF b.status = 'CANCELLED' THEN RAISE EXCEPTION 'BOOKING_ALREADY_CANCELLED'; END IF;
  IF v_to = 'CONFIRMED' AND b.status <> 'REQUESTED' THEN RAISE EXCEPTION 'ONLY_A_REQUESTED_BOOKING_CAN_BE_CONFIRMED'; END IF;
  IF v_to = 'DELIVERED' AND b.status <> 'CONFIRMED' THEN RAISE EXCEPTION 'ONLY_A_CONFIRMED_BOOKING_CAN_BE_DELIVERED'; END IF;
  IF v_to = 'CANCELLED' AND coalesce(btrim(_note),'') = '' THEN RAISE EXCEPTION 'CANCELLATION_REASON_REQUIRED'; END IF;

  UPDATE public.provider_bookings SET status = v_to WHERE id = _booking_id;
  INSERT INTO public.provider_booking_events (booking_id, action, status_from, status_to, note, actor_user_id)
  VALUES (_booking_id, v_to, b.status, v_to, NULLIF(btrim(coalesce(_note,'')),''), v_uid);

  RETURN jsonb_build_object('ok', true, 'status', v_to);
END; $$;

-- Delivered booking -> proforma invoice (staff only, uses the governed proforma engine)
CREATE OR REPLACE FUNCTION public.provider_booking_to_proforma(_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_uid uuid := auth.uid();
  b public.provider_bookings;
  c public.provider_capacity;
  v_res jsonb;
  v_pid uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF public._my_staff_member_id() IS NULL THEN RAISE EXCEPTION 'STAFF_RECORD_REQUIRED'; END IF;

  SELECT * INTO b FROM public.provider_bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_BOOKING'; END IF;
  IF b.proforma_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'proforma_id', b.proforma_id, 'already_raised', true);
  END IF;
  IF b.status NOT IN ('CONFIRMED','DELIVERED') THEN RAISE EXCEPTION 'BOOKING_NOT_BILLABLE'; END IF;
  IF b.amount_cents <= 0 THEN RAISE EXCEPTION 'AGREED_RATE_REQUIRED'; END IF;
  IF coalesce(btrim(coalesce(b.customer_company,'')),'') = '' THEN RAISE EXCEPTION 'CUSTOMER_COMPANY_REQUIRED'; END IF;

  SELECT * INTO c FROM public.provider_capacity WHERE id = b.capacity_id;

  v_res := public.proforma_save(jsonb_build_object(
    'customer_company', b.customer_company,
    'customer_contact_person', b.customer_contact_name,
    'customer_email', b.customer_email,
    'customer_phone', b.customer_phone,
    'customer_ref', b.booking_reference,
    'currency', b.currency,
    'service_from', b.service_from,
    'service_to', COALESCE(b.service_to, b.service_from),
    'lines', jsonb_build_array(jsonb_build_object(
      'description', c.title || ' — ' || c.provider_name || ' (' || c.base_city || ')',
      'service_date', b.service_from,
      'vehicle_category', c.vehicle_type,
      'qty', b.qty,
      'unit_rate_cents', b.unit_rate_cents
    ))
  ));

  v_pid := NULLIF(v_res->>'id','')::uuid;
  IF v_pid IS NULL THEN v_pid := NULLIF(v_res->'proforma'->>'id','')::uuid; END IF;

  UPDATE public.provider_bookings
     SET proforma_id = v_pid,
         proforma_reference = COALESCE(v_res->>'proforma_number', v_res->'proforma'->>'proforma_number')
   WHERE id = _booking_id;

  INSERT INTO public.provider_booking_events (booking_id, action, status_from, status_to, note, actor_user_id, detail)
  VALUES (_booking_id, 'PROFORMA_RAISED', b.status, b.status, NULL, v_uid,
          jsonb_build_object('proforma_id', v_pid));

  RETURN jsonb_build_object('ok', true, 'proforma_id', v_pid, 'proforma', v_res);
END; $$;

CREATE OR REPLACE FUNCTION public.provider_booking_link_invoice(_booking_id uuid, _invoice_id uuid, _invoice_reference text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); b public.provider_bookings;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF public._my_staff_member_id() IS NULL THEN RAISE EXCEPTION 'STAFF_RECORD_REQUIRED'; END IF;
  SELECT * INTO b FROM public.provider_bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_BOOKING'; END IF;
  IF _invoice_id IS NULL AND coalesce(btrim(coalesce(_invoice_reference,'')),'') = '' THEN
    RAISE EXCEPTION 'INVOICE_REFERENCE_REQUIRED';
  END IF;

  UPDATE public.provider_bookings
     SET invoice_id = COALESCE(_invoice_id, invoice_id),
         invoice_reference = COALESCE(NULLIF(btrim(coalesce(_invoice_reference,'')),''), invoice_reference)
   WHERE id = _booking_id;

  INSERT INTO public.provider_booking_events (booking_id, action, status_from, status_to, actor_user_id, detail)
  VALUES (_booking_id, 'INVOICE_LINKED', b.status, b.status, v_uid,
          jsonb_build_object('invoice_id', _invoice_id, 'invoice_reference', _invoice_reference));

  RETURN jsonb_build_object('ok', true);
END; $$;

REVOKE ALL ON FUNCTION public.provider_booking_create(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.provider_booking_set_status(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.provider_booking_to_proforma(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.provider_booking_link_invoice(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._provider_booking_reference() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_booking_create(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.provider_booking_set_status(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.provider_booking_to_proforma(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.provider_booking_link_invoice(uuid, uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._provider_booking_reference() TO service_role;

-- ---------------------------------------------------------------------
-- 4. Provider bookings for the operator portal
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provider_bookings_list()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id, 'booking_reference', b.booking_reference, 'capacity_id', b.capacity_id,
      'capacity_title', c.title, 'family', c.family, 'provider_name', c.provider_name,
      'customer_company', b.customer_company, 'customer_contact_name', b.customer_contact_name,
      'service_from', b.service_from, 'service_to', b.service_to,
      'qty', b.qty, 'unit_rate_cents', b.unit_rate_cents, 'amount_cents', b.amount_cents,
      'currency', b.currency, 'status', b.status, 'notes', b.notes,
      'proforma_id', b.proforma_id, 'proforma_reference', b.proforma_reference,
      'invoice_id', b.invoice_id, 'invoice_reference', b.invoice_reference,
      'created_at', b.created_at,
      'history', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'action', ev.action, 'status_to', ev.status_to, 'note', ev.note, 'created_at', ev.created_at
        ) ORDER BY ev.created_at DESC), '[]'::jsonb)
        FROM public.provider_booking_events ev WHERE ev.booking_id = b.id)
    ) ORDER BY b.created_at DESC), '[]'::jsonb)
    FROM public.provider_bookings b
    JOIN public.provider_capacity c ON c.id = b.capacity_id
    WHERE b.provider_user_id = v_uid OR b.customer_user_id = v_uid OR public.capacity_can_approve(v_uid)
  );
END; $$;

REVOKE ALL ON FUNCTION public.provider_bookings_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_bookings_list() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Staff governance console
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provider_governance_console()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT public.capacity_can_approve(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;

  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'applications_open', (SELECT count(*) FROM public.driver_applications
                             WHERE status NOT IN ('APPROVED','REJECTED','WITHDRAWN')),
      'applications_approved', (SELECT count(*) FROM public.driver_applications WHERE status = 'APPROVED'),
      'capacity_awaiting', (SELECT count(*) FROM public.provider_capacity WHERE status = 'PENDING_APPROVAL'),
      'capacity_live', (SELECT count(*) FROM public.provider_capacity WHERE status = 'PUBLISHED' AND is_test = false),
      'capacity_drafts', (SELECT count(*) FROM public.provider_capacity WHERE status IN ('DRAFT','SENT_BACK')),
      'units_live', (SELECT coalesce(sum(units),0) FROM public.provider_capacity
                      WHERE status = 'PUBLISHED' AND is_test = false),
      'enquiries_open', (SELECT count(*) FROM public.capacity_enquiries WHERE status <> 'CLOSED'),
      'bookings_open', (SELECT count(*) FROM public.provider_bookings WHERE status IN ('REQUESTED','CONFIRMED')),
      'bookings_billable_cents', (SELECT coalesce(sum(amount_cents),0) FROM public.provider_bookings
                                   WHERE status IN ('CONFIRMED','DELIVERED') AND is_test = false),
      'bookings_invoiced_cents', (SELECT coalesce(sum(amount_cents),0) FROM public.provider_bookings
                                   WHERE invoice_id IS NOT NULL AND is_test = false)
    ),
    'applications', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id, 'reference', a.application_reference, 'status', a.status,
        'name', btrim(a.first_name || ' ' || coalesce(a.last_name,'')),
        'city', coalesce(a.preferred_city, a.town), 'driver_type', a.driver_type,
        'vehicle', a.vehicle_make_model, 'registration', a.vehicle_registration,
        'claimed', a.applicant_user_id IS NOT NULL,
        'created_at', a.created_at, 'decided_at', a.decided_at,
        'seeded_capacity_id', (SELECT pc.id FROM public.provider_capacity pc
                                WHERE pc.source_application_id = a.id),
        'documents_outstanding', (SELECT count(*) FROM public.driver_application_documents d
                                   WHERE d.application_id = a.id AND d.is_mandatory AND d.state <> 'VERIFIED')
      ) ORDER BY a.created_at DESC), '[]'::jsonb) FROM public.driver_applications a
    ),
    'capacity', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'family', c.family, 'title', c.title, 'provider_name', c.provider_name,
        'provider_kind', c.provider_kind, 'vehicle_type', c.vehicle_type, 'seats', c.seats,
        'units', c.units, 'base_city', c.base_city, 'rate_amount', c.rate_amount,
        'rate_basis', c.rate_basis, 'currency', c.currency, 'status', c.status,
        'is_test', c.is_test, 'submitted_at', c.submitted_at, 'published_at', c.published_at,
        'source_application_id', c.source_application_id,
        'is_own', c.provider_user_id = v_uid,
        'enquiries', (SELECT count(*) FROM public.capacity_enquiries e WHERE e.capacity_id = c.id),
        'bookings', (SELECT count(*) FROM public.provider_bookings b WHERE b.capacity_id = c.id)
      ) ORDER BY c.created_at DESC), '[]'::jsonb) FROM public.provider_capacity c
    ),
    'bookings', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', b.id, 'booking_reference', b.booking_reference, 'capacity_title', c.title,
        'family', c.family, 'provider_name', c.provider_name,
        'customer_company', b.customer_company, 'service_from', b.service_from,
        'amount_cents', b.amount_cents, 'currency', b.currency, 'status', b.status,
        'proforma_id', b.proforma_id, 'proforma_reference', b.proforma_reference,
        'invoice_reference', b.invoice_reference, 'created_at', b.created_at
      ) ORDER BY b.created_at DESC), '[]'::jsonb)
      FROM public.provider_bookings b JOIN public.provider_capacity c ON c.id = b.capacity_id
    ),
    'enquiries', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'capacity_title', c.title, 'organisation_name', e.organisation_name,
        'contact_name', e.contact_name, 'service_date', e.service_date,
        'status', e.status, 'created_at', e.created_at,
        'booked', EXISTS (SELECT 1 FROM public.provider_bookings b WHERE b.enquiry_id = e.id)
      ) ORDER BY e.created_at DESC), '[]'::jsonb)
      FROM public.capacity_enquiries e JOIN public.provider_capacity c ON c.id = e.capacity_id
    )
  ) INTO v_out;

  RETURN v_out;
END; $$;

REVOKE ALL ON FUNCTION public.provider_governance_console() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_governance_console() TO authenticated, service_role;
