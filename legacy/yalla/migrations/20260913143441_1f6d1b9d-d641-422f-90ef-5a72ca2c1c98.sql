-- =====================================================================
-- RENTAL ORCHESTRATION — PHASE 4
-- Vehicle readiness audit, handover records, damage, amendments.
-- =====================================================================

-- ------------------------------------------ 1. VEHICLE READINESS AUDIT
CREATE TABLE public.rental_unit_readiness_checks (
  check_code text PRIMARY KEY,
  label      text NOT NULL,
  mandatory  boolean NOT NULL DEFAULT true,
  note       text
);
GRANT SELECT ON public.rental_unit_readiness_checks TO authenticated;
GRANT ALL ON public.rental_unit_readiness_checks TO service_role;
ALTER TABLE public.rental_unit_readiness_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read rental readiness checks" ON public.rental_unit_readiness_checks
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_staff_permission('staff.commercial.write')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

INSERT INTO public.rental_unit_readiness_checks (check_code, label, mandatory, note) VALUES
 ('IDENTITY','Plate, make, model and year recorded', true, 'Data quality — no placeholder values.'),
 ('CLASS_MAPPING','Mapped to a published rate-card class and band', true, 'Without this the vehicle can never be quoted.'),
 ('CAPABILITY','Marked for self-drive and/or chauffeur', true, NULL),
 ('SEATS','Seat count recorded', true, NULL),
 ('BRANCH','Home branch / pickup location recorded', true, NULL),
 ('INSPECTION','Roadworthiness inspection recorded and in date', true, 'Requires an external document — cannot be asserted from code.'),
 ('INSURANCE','Valid insurance recorded and in date', true, 'Requires an external document.'),
 ('LICENSING','Statutory licensing in date', true, 'Requires an external document.'),
 ('MAINTENANCE','No open maintenance defect', true, NULL),
 ('CLEARED_FOR_LETTING','Authorised person cleared the vehicle for letting', true, 'Human authority — never automatic.');

CREATE TABLE public.rental_unit_readiness_evidence (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id      uuid NOT NULL REFERENCES public.rental_fleet_units(id) ON DELETE CASCADE,
  check_code   text NOT NULL REFERENCES public.rental_unit_readiness_checks(check_code),
  verdict      text NOT NULL CHECK (verdict IN ('PASS','FAIL','BLOCKED','NOT_TESTED','REQUIRES_EXTERNAL_ACTION')),
  evidence     text NOT NULL,
  document_ref text,
  valid_until  date,
  recorded_by  uuid,
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, check_code)
);
GRANT SELECT, INSERT, UPDATE ON public.rental_unit_readiness_evidence TO authenticated;
GRANT ALL ON public.rental_unit_readiness_evidence TO service_role;
ALTER TABLE public.rental_unit_readiness_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read rental readiness evidence" ON public.rental_unit_readiness_evidence
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_staff_permission('staff.commercial.write')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "Staff record rental readiness evidence" ON public.rental_unit_readiness_evidence
  FOR ALL TO authenticated
  USING (public.has_staff_permission('staff.commercial.write'))
  WITH CHECK (public.has_staff_permission('staff.commercial.write'));

-- Deterministic readiness projection: derived checks are computed from the data,
-- external checks stay NOT_TESTED / REQUIRES_EXTERNAL_ACTION until evidence exists.
CREATE OR REPLACE VIEW public.v_rental_unit_readiness
WITH (security_invoker = true) AS
WITH derived AS (
  SELECT u.id AS unit_id, u.plate, u.status,
         (u.plate IS NOT NULL AND u.make IS NOT NULL AND u.model IS NOT NULL AND u.year IS NOT NULL) AS identity_ok,
         (u.asset_class IS NOT NULL AND u.band_label IS NOT NULL) AS class_ok,
         (u.self_drive OR u.chauffeur) AS capability_ok,
         (u.seats IS NOT NULL AND u.seats > 0) AS seats_ok,
         (coalesce(btrim(u.home_branch),'') <> '') AS branch_ok
    FROM public.rental_fleet_units u
)
SELECT d.unit_id, d.plate, d.status,
       d.identity_ok, d.class_ok, d.capability_ok, d.seats_ok, d.branch_ok,
       (SELECT count(*) FROM public.rental_unit_readiness_evidence e
         WHERE e.unit_id = d.unit_id AND e.verdict = 'PASS'
           AND (e.valid_until IS NULL OR e.valid_until >= current_date)) AS evidence_passes,
       (SELECT count(*) FROM public.rental_unit_readiness_checks c WHERE c.mandatory) AS mandatory_checks,
       (SELECT coalesce(array_agg(c.check_code ORDER BY c.check_code), '{}')
          FROM public.rental_unit_readiness_checks c
         WHERE c.mandatory
           AND NOT EXISTS (
             SELECT 1 FROM public.rental_unit_readiness_evidence e
              WHERE e.unit_id = d.unit_id AND e.check_code = c.check_code AND e.verdict = 'PASS'
                AND (e.valid_until IS NULL OR e.valid_until >= current_date))
           AND c.check_code NOT IN ('IDENTITY','CLASS_MAPPING','CAPABILITY','SEATS','BRANCH')
       ) AS outstanding_external_checks,
       (d.identity_ok AND d.class_ok AND d.capability_ok AND d.seats_ok AND d.branch_ok
        AND NOT EXISTS (
          SELECT 1 FROM public.rental_unit_readiness_checks c
           WHERE c.mandatory AND c.check_code NOT IN ('IDENTITY','CLASS_MAPPING','CAPABILITY','SEATS','BRANCH')
             AND NOT EXISTS (
               SELECT 1 FROM public.rental_unit_readiness_evidence e
                WHERE e.unit_id = d.unit_id AND e.check_code = c.check_code AND e.verdict = 'PASS'
                  AND (e.valid_until IS NULL OR e.valid_until >= current_date)))
       ) AS may_be_activated
  FROM derived d;
GRANT SELECT ON public.v_rental_unit_readiness TO authenticated;

-- A vehicle may only be set AVAILABLE when its readiness audit is complete.
CREATE OR REPLACE FUNCTION public._rental_unit_activation_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ok boolean;
BEGIN
  IF NEW.status = 'AVAILABLE' AND OLD.status IS DISTINCT FROM 'AVAILABLE' THEN
    SELECT may_be_activated INTO ok FROM public.v_rental_unit_readiness WHERE unit_id = NEW.id;
    IF ok IS NOT true THEN
      RAISE EXCEPTION 'RENTAL_UNIT_READINESS_INCOMPLETE — record the outstanding readiness evidence before letting this vehicle';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public._rental_unit_activation_gate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._rental_unit_activation_gate() TO service_role;
CREATE TRIGGER trg_rental_unit_activation_gate
  BEFORE UPDATE OF status ON public.rental_fleet_units
  FOR EACH ROW EXECUTE FUNCTION public._rental_unit_activation_gate();

-- ------------------------------------------------ 2. HANDOVER RECORDS
CREATE TABLE public.rental_handovers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     uuid NOT NULL REFERENCES public.rental_bookings(id) ON DELETE RESTRICT,
  unit_id        uuid REFERENCES public.rental_fleet_units(id) ON DELETE SET NULL,
  direction      text NOT NULL CHECK (direction IN ('PICKUP','RETURN')),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  location       text NOT NULL,
  odometer_km    integer NOT NULL CHECK (odometer_km >= 0),
  fuel_level     text NOT NULL CHECK (fuel_level IN ('EMPTY','QUARTER','HALF','THREE_QUARTER','FULL')),
  condition_note text NOT NULL,
  damage_found   boolean NOT NULL DEFAULT false,
  documents      jsonb NOT NULL DEFAULT '[]'::jsonb,
  photos         jsonb NOT NULL DEFAULT '[]'::jsonb,
  customer_name  text NOT NULL,
  staff_id       uuid,
  correlation_id uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, direction)
);
COMMENT ON TABLE public.rental_handovers IS
  'Operational handover record. Immutable once written — a correction is a new inspection record, not an edit.';
GRANT SELECT, INSERT ON public.rental_handovers TO authenticated;
GRANT ALL ON public.rental_handovers TO service_role;
ALTER TABLE public.rental_handovers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read rental handovers" ON public.rental_handovers
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_staff_permission('staff.commercial.write')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "Customers read their own handovers" ON public.rental_handovers
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rental_bookings b
                  WHERE b.id = rental_handovers.booking_id
                    AND (b.rider_user_id = auth.uid()
                         OR lower(b.contact_email) = lower(coalesce(auth.jwt() ->> 'email','')))));

CREATE OR REPLACE FUNCTION public._rental_handover_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'RENTAL_HANDOVERS_ARE_IMMUTABLE'; END; $$;
REVOKE ALL ON FUNCTION public._rental_handover_immutable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._rental_handover_immutable() TO service_role;
CREATE TRIGGER trg_rental_handover_immutable
  BEFORE UPDATE OR DELETE ON public.rental_handovers
  FOR EACH ROW EXECUTE FUNCTION public._rental_handover_immutable();

-- Pickup / return as an operational transaction that also moves booking state.
CREATE OR REPLACE FUNCTION public.rental_record_handover(
  _booking_reference text, _direction text, _location text, _odometer_km integer,
  _fuel_level text, _condition_note text, _customer_name text,
  _damage_found boolean DEFAULT false, _documents jsonb DEFAULT '[]'::jsonb,
  _photos jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.rental_bookings; dir text := upper(coalesce(_direction,'')); h public.rental_handovers;
BEGIN
  IF NOT public.has_staff_permission('staff.commercial.write') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'NOT_AUTHORISED');
  END IF;
  IF dir NOT IN ('PICKUP','RETURN') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'UNKNOWN_DIRECTION');
  END IF;
  IF coalesce(btrim(_location),'') = '' OR _odometer_km IS NULL
     OR coalesce(btrim(_condition_note),'') = '' OR coalesce(btrim(_customer_name),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'HANDOVER_EVIDENCE_INCOMPLETE');
  END IF;

  SELECT * INTO b FROM public.rental_bookings
   WHERE booking_reference = upper(coalesce(_booking_reference,'')) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason_code', 'BOOKING_NOT_FOUND'); END IF;

  IF dir = 'PICKUP' AND b.status <> 'CONFIRMED' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'BOOKING_NOT_READY_FOR_PICKUP', 'status', b.status);
  END IF;
  IF dir = 'RETURN' AND b.status <> 'PICKED_UP' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'BOOKING_NOT_OUT_ON_RENTAL', 'status', b.status);
  END IF;

  INSERT INTO public.rental_handovers (
    booking_id, unit_id, direction, location, odometer_km, fuel_level, condition_note,
    damage_found, documents, photos, customer_name, staff_id, correlation_id)
  VALUES (b.id, b.unit_id, dir, _location, _odometer_km, upper(_fuel_level), _condition_note,
          coalesce(_damage_found,false), coalesce(_documents,'[]'::jsonb), coalesce(_photos,'[]'::jsonb),
          _customer_name, auth.uid(), b.correlation_id)
  ON CONFLICT (booking_id, direction) DO NOTHING
  RETURNING * INTO h;

  IF h.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'reason_code', 'HANDOVER_ALREADY_RECORDED');
  END IF;

  IF dir = 'PICKUP' THEN
    UPDATE public.rental_bookings SET status = 'PICKED_UP', picked_up_at = h.occurred_at WHERE id = b.id;
  ELSE
    UPDATE public.rental_bookings SET status = 'RETURNED', returned_at = h.occurred_at WHERE id = b.id;
    DELETE FROM public.rental_unit_commitments WHERE booking_id = b.id AND source = 'BOOKING';
  END IF;

  INSERT INTO public.rental_booking_events (booking_id, event_type, detail, actor_id)
  VALUES (b.id, CASE WHEN dir='PICKUP' THEN 'PICKUP_CONFIRMED' ELSE 'VEHICLE_RETURNED' END,
          jsonb_build_object('handover_id', h.id, 'odometer_km', _odometer_km,
                             'fuel_level', upper(_fuel_level), 'damage_found', coalesce(_damage_found,false)),
          auth.uid());

  PERFORM public.rental_emit_event(
    CASE WHEN dir='PICKUP' THEN 'PickupConfirmed' ELSE 'VehicleReturned' END,
    'booking', b.id, b.booking_reference, b.correlation_id,
    jsonb_build_object('handover_id', h.id, 'damage_found', coalesce(_damage_found,false)),
    NULL, auth.uid(), dir);

  IF coalesce(_damage_found,false) THEN
    PERFORM public.rental_exception_open('DAMAGE_DISPUTE','booking', b.id, b.booking_reference, b.correlation_id,
      jsonb_build_object('handover_id', h.id, 'condition_note', _condition_note,
                         'deposit_policy','POLICY_REQUIRED'));
  END IF;

  RETURN jsonb_build_object('ok', true, 'handover_id', h.id, 'direction', dir,
    'booking_reference', b.booking_reference,
    'booking_status', CASE WHEN dir='PICKUP' THEN 'PICKED_UP' ELSE 'RETURNED' END);
END; $$;
REVOKE ALL ON FUNCTION public.rental_record_handover(text,text,text,integer,text,text,text,boolean,jsonb,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rental_record_handover(text,text,text,integer,text,text,text,boolean,jsonb,jsonb) TO authenticated, service_role;

-- ---------------------------------------------------- 3. AMENDMENTS
CREATE TABLE public.rental_amendments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id         uuid NOT NULL REFERENCES public.rental_bookings(id) ON DELETE RESTRICT,
  amendment_type     text NOT NULL CHECK (amendment_type IN ('RESCHEDULE','CANCELLATION')),
  original_start     date NOT NULL,
  original_end       date NOT NULL,
  original_total_kes numeric(14,2) NOT NULL,
  requested_start    date,
  requested_end      date,
  reason             text,
  requested_by       uuid,
  requested_channel  text NOT NULL DEFAULT 'CUSTOMER',
  state              text NOT NULL DEFAULT 'REQUESTED'
                       CHECK (state IN ('REQUESTED','APPROVED','DECLINED','POLICY_REQUIRED')),
  decided_by         uuid,
  decided_at         timestamptz,
  decision_note      text,
  price_difference_kes numeric(14,2),
  refund_id          uuid REFERENCES public.rental_refunds(id) ON DELETE SET NULL,
  correlation_id     uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.rental_amendments IS
  'Reschedules and cancellations are amendments: the original terms are preserved, the requested change and the decision are recorded separately.';
GRANT SELECT ON public.rental_amendments TO authenticated;
GRANT ALL ON public.rental_amendments TO service_role;
ALTER TABLE public.rental_amendments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read rental amendments" ON public.rental_amendments
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_staff_permission('staff.commercial.write')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "Customers read their own amendments" ON public.rental_amendments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rental_bookings b
                  WHERE b.id = rental_amendments.booking_id
                    AND (b.rider_user_id = auth.uid()
                         OR lower(b.contact_email) = lower(coalesce(auth.jwt() ->> 'email','')))));
CREATE TRIGGER trg_rental_amendments_touch BEFORE UPDATE ON public.rental_amendments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();