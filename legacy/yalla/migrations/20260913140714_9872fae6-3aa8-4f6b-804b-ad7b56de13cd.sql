-- =====================================================================
-- RENTAL ORCHESTRATION — PHASE 1
-- Domain authority map, enforced state machines, idempotency register,
-- authoritative correlated event stream.
-- =====================================================================

-- ------------------------------------------------ 1. DOMAIN AUTHORITY
CREATE TABLE public.rental_domain_authority (
  domain              text PRIMARY KEY,
  authoritative_store text NOT NULL,
  owns                text NOT NULL,
  may_not_write       text NOT NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.rental_domain_authority IS
  'Single written record of which subsystem is authoritative for each rental domain. No module may write another domain''s state except through the owning routine.';

GRANT SELECT ON public.rental_domain_authority TO authenticated;
GRANT ALL ON public.rental_domain_authority TO service_role;
ALTER TABLE public.rental_domain_authority ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read rental domain authority" ON public.rental_domain_authority
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_staff_permission('staff.commercial.write')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE TRIGGER trg_rental_authority_touch BEFORE UPDATE ON public.rental_domain_authority
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.rental_domain_authority (domain, authoritative_store, owns, may_not_write, notes) VALUES
 ('inventory',   'rental_fleet_units + rental_unit_commitments', 'Vehicle existence, listing status, commitments, availability', 'booking status, price, money', 'Availability is only ever computed by rental_fleet_availability.'),
 ('pricing',     'asset_pricing_versions + asset_pricing_bands', 'Published rate card, band eligibility, price arithmetic', 'inventory, booking state, ledger', 'Prices are computed server-side and snapshotted on the quote.'),
 ('quote',       'rental_quote_requests', 'Quote terms, snapshot, validity, quote state', 'inventory allocation, ledger', 'Immutable priced snapshot; never re-priced after issue.'),
 ('payment',     'mpesa_transactions', 'Verified provider payment facts', 'booking state, ledger balances', 'The provider record is the only proof of payment.'),
 ('booking',     'rental_bookings', 'Booking state, dates, allocated unit reference', 'price, payment facts, ledger', 'State changes only through the booking routines.'),
 ('fulfilment',  'rental_bookings + rental_booking_events', 'Pickup, return, operational evidence', 'price, payment, inventory listing status', 'Handover records are immutable once written.'),
 ('ledger',      'rental ledger (phase 3)', 'Charges, payments, refunds, payable, commission', 'booking state, inventory', 'Money is never inferred from a boolean flag.'),
 ('audit',       'rental_domain_events', 'Immutable correlated event history', 'everything else', 'Append-only, versioned, idempotently consumed.'),
 ('policy',      'rental policy engine (phase 5)', 'Eligibility, duration, deposit, corporate approval rules', 'price arithmetic, inventory', 'Cancellation, refund and deposit rules are POLICY_REQUIRED until decided by the owner.'),
 ('orchestration','ops_event_outbox + ops-orchestrator', 'What must happen next, retries, escalation', 'domain state directly', 'Invokes the owning domain routine; never writes domain rows itself.');

-- --------------------------------------------- 2. STATE MACHINE TABLES
CREATE TABLE public.rental_state_transitions (
  entity      text NOT NULL,
  from_state  text NOT NULL,
  to_state    text NOT NULL,
  note        text,
  PRIMARY KEY (entity, from_state, to_state)
);
COMMENT ON TABLE public.rental_state_transitions IS
  'Legal state transitions for the rental entities. Enforced by triggers — an illegal transition is impossible from any application path.';

GRANT SELECT ON public.rental_state_transitions TO authenticated;
GRANT ALL ON public.rental_state_transitions TO service_role;
ALTER TABLE public.rental_state_transitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read rental transitions" ON public.rental_state_transitions
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_staff_permission('staff.commercial.write')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

INSERT INTO public.rental_state_transitions (entity, from_state, to_state, note) VALUES
 -- QUOTE
 ('QUOTE','QUOTED','AWAITING_PAYMENT','Customer accepted the quotation'),
 ('QUOTE','QUOTED','PAID','Payment verified directly against the quotation'),
 ('QUOTE','QUOTED','EXPIRED','Validity elapsed'),
 ('QUOTE','QUOTED','CANCELLED','Withdrawn before payment'),
 ('QUOTE','AWAITING_PAYMENT','PAID','Verified provider payment'),
 ('QUOTE','AWAITING_PAYMENT','EXPIRED','Validity elapsed unpaid'),
 ('QUOTE','AWAITING_PAYMENT','CANCELLED','Withdrawn before payment'),
 ('QUOTE','PAID','CONFIRMED','Vehicle allocated, booking created'),
 ('QUOTE','PAID','CANCELLED','Cancelled after payment — refund path required'),
 ('QUOTE','CONFIRMED','CANCELLED','Cancelled after confirmation — refund path required'),
 -- BOOKING
 ('BOOKING','AWAITING_ALLOCATION','CONFIRMED','Vehicle allocated'),
 ('BOOKING','AWAITING_ALLOCATION','CANCELLED','No vehicle could be allocated'),
 ('BOOKING','CONFIRMED','AWAITING_ALLOCATION','Allocated vehicle became unavailable'),
 ('BOOKING','CONFIRMED','PICKED_UP','Handover confirmed'),
 ('BOOKING','CONFIRMED','CANCELLED','Cancelled before pickup'),
 ('BOOKING','PICKED_UP','RETURNED','Vehicle returned'),
 -- VEHICLE
 ('VEHICLE','AVAILABLE','UNDER_SERVICE','Withdrawn from letting'),
 ('VEHICLE','AVAILABLE','RETIRED','Removed from the fleet'),
 ('VEHICLE','UNDER_SERVICE','AVAILABLE','Returned to letting'),
 ('VEHICLE','UNDER_SERVICE','RETIRED','Removed from the fleet');

CREATE OR REPLACE FUNCTION public._rental_enforce_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ent text := TG_ARGV[0];
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rental_state_transitions t
     WHERE t.entity = ent AND t.from_state = OLD.status AND t.to_state = NEW.status
  ) THEN
    RAISE EXCEPTION 'ILLEGAL_TRANSITION_% : % -> %', ent, OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_rental_quote_transition
  BEFORE UPDATE OF status ON public.rental_quote_requests
  FOR EACH ROW EXECUTE FUNCTION public._rental_enforce_transition('QUOTE');
CREATE TRIGGER trg_rental_booking_transition
  BEFORE UPDATE OF status ON public.rental_bookings
  FOR EACH ROW EXECUTE FUNCTION public._rental_enforce_transition('BOOKING');
CREATE TRIGGER trg_rental_unit_transition
  BEFORE UPDATE OF status ON public.rental_fleet_units
  FOR EACH ROW EXECUTE FUNCTION public._rental_enforce_transition('VEHICLE');

-- ------------------------------------------- 3. AUTHORITATIVE EVENT LOG
CREATE TABLE public.rental_domain_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_uid      text NOT NULL UNIQUE,
  event_type     text NOT NULL,
  event_version  integer NOT NULL DEFAULT 1,
  entity_type    text NOT NULL,
  entity_id      uuid,
  entity_ref     text,
  correlation_id uuid NOT NULL,
  causation_id   uuid,
  actor_id       uuid,
  payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at    timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.rental_domain_events IS
  'Authoritative, immutable, correlated rental event stream. event_uid makes consumption idempotent.';
CREATE INDEX idx_rental_domain_events_corr ON public.rental_domain_events (correlation_id, occurred_at);
CREATE INDEX idx_rental_domain_events_entity ON public.rental_domain_events (entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_rental_domain_events_type ON public.rental_domain_events (event_type, occurred_at DESC);

GRANT SELECT ON public.rental_domain_events TO authenticated;
GRANT ALL ON public.rental_domain_events TO service_role;
ALTER TABLE public.rental_domain_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read rental domain events" ON public.rental_domain_events
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_staff_permission('staff.commercial.write')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE OR REPLACE FUNCTION public._rental_domain_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'RENTAL_DOMAIN_EVENTS_ARE_APPEND_ONLY';
END; $$;
CREATE TRIGGER trg_rental_domain_events_append_only
  BEFORE UPDATE OR DELETE ON public.rental_domain_events
  FOR EACH ROW EXECUTE FUNCTION public._rental_domain_events_append_only();

-- Escalation map: which rental events become platform work.
CREATE TABLE public.rental_event_escalations (
  rental_event_type text PRIMARY KEY,
  ops_event_type    text NOT NULL,
  source_portal     text NOT NULL DEFAULT 'rental_leasing',
  service_line      text NOT NULL DEFAULT 'rental',
  ops_entity_type   text NOT NULL DEFAULT 'rental_agreement'
);
GRANT SELECT ON public.rental_event_escalations TO authenticated;
GRANT ALL ON public.rental_event_escalations TO service_role;
ALTER TABLE public.rental_event_escalations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read rental escalation map" ON public.rental_event_escalations
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

INSERT INTO public.rental_event_escalations (rental_event_type, ops_event_type) VALUES
 ('ReservationFailed',      'reservation_exception'),
 ('ReservationExpired',     'reservation_exception'),
 ('VehicleLostAfterBooking','reservation_exception'),
 ('PaymentFailed',          'payment_failed'),
 ('PaymentShortfall',       'payment_failed'),
 ('PaymentUnverified',      'payment_failed'),
 ('RefundRequested',        'refund_requested'),
 ('RefundStuck',            'reconciliation_exception'),
 ('ReconciliationBreak',    'reconciliation_exception'),
 ('ReturnException',        'return_exception'),
 ('DamageReported',         'damage_dispute'),
 ('CancellationRequested',  'approval_required'),
 ('RescheduleRequested',    'approval_required');

CREATE OR REPLACE FUNCTION public.rental_emit_event(
  _event_type text,
  _entity_type text,
  _entity_id uuid,
  _entity_ref text DEFAULT NULL,
  _correlation_id uuid DEFAULT NULL,
  _payload jsonb DEFAULT '{}'::jsonb,
  _causation_id uuid DEFAULT NULL,
  _actor_id uuid DEFAULT NULL,
  _dedupe_suffix text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE corr uuid := coalesce(_correlation_id, gen_random_uuid());
        uid text;
        ev public.rental_domain_events;
        esc public.rental_event_escalations;
BEGIN
  uid := 'rental:' || _event_type || ':' || coalesce(_entity_id::text, coalesce(_entity_ref,'-'))
         || ':' || coalesce(_dedupe_suffix, '');
  INSERT INTO public.rental_domain_events (
    event_uid, event_type, entity_type, entity_id, entity_ref,
    correlation_id, causation_id, actor_id, payload
  ) VALUES (uid, _event_type, _entity_type, _entity_id, _entity_ref, corr, _causation_id, _actor_id, coalesce(_payload,'{}'::jsonb))
  ON CONFLICT (event_uid) DO NOTHING
  RETURNING * INTO ev;

  IF ev.id IS NULL THEN
    SELECT * INTO ev FROM public.rental_domain_events WHERE event_uid = uid;
    RETURN ev.id;   -- already emitted: idempotent no-op
  END IF;

  SELECT * INTO esc FROM public.rental_event_escalations WHERE rental_event_type = _event_type;
  IF FOUND THEN
    PERFORM public.ops_enqueue_event(
      uid, esc.ops_event_type, esc.source_portal, esc.ops_entity_type,
      coalesce(_entity_id, ev.id), _entity_ref, esc.service_line,
      jsonb_build_object('rental_event_type', _event_type, 'correlation_id', corr),
      coalesce(_payload,'{}'::jsonb), ev.occurred_at
    );
  END IF;
  RETURN ev.id;
END; $$;
REVOKE ALL ON FUNCTION public.rental_emit_event(text,text,uuid,text,uuid,jsonb,uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_emit_event(text,text,uuid,text,uuid,jsonb,uuid,uuid,text) TO service_role;

-- ------------------------------------------- 4. IDEMPOTENCY REGISTER
CREATE TABLE public.rental_operations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation       text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash    text NOT NULL,
  correlation_id  uuid NOT NULL DEFAULT gen_random_uuid(),
  state           text NOT NULL DEFAULT 'IN_PROGRESS'
                    CHECK (state IN ('IN_PROGRESS','COMPLETED','FAILED')),
  result          jsonb,
  failure_reason  text,
  attempts        integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  UNIQUE (operation, idempotency_key)
);
COMMENT ON TABLE public.rental_operations IS
  'Idempotency register. Every retriable rental operation claims a key first and replays the stored result on repeat.';
CREATE INDEX idx_rental_operations_state ON public.rental_operations (state, created_at);

GRANT SELECT ON public.rental_operations TO authenticated;
GRANT ALL ON public.rental_operations TO service_role;
ALTER TABLE public.rental_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read rental operation register" ON public.rental_operations
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- Claim a key. Returns replay=true with the stored result when already done,
-- conflict=true when the same key arrives with a different request body.
CREATE OR REPLACE FUNCTION public.rental_operation_claim(
  _operation text, _idempotency_key text, _request_hash text,
  _correlation_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE row public.rental_operations;
BEGIN
  IF coalesce(_operation,'') = '' OR coalesce(_idempotency_key,'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'IDEMPOTENCY_KEY_REQUIRED');
  END IF;

  INSERT INTO public.rental_operations (operation, idempotency_key, request_hash, correlation_id)
  VALUES (_operation, _idempotency_key, coalesce(_request_hash,''), coalesce(_correlation_id, gen_random_uuid()))
  ON CONFLICT (operation, idempotency_key) DO NOTHING
  RETURNING * INTO row;

  IF row.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'replay', false, 'operation_id', row.id,
                              'correlation_id', row.correlation_id);
  END IF;

  SELECT * INTO row FROM public.rental_operations
   WHERE operation = _operation AND idempotency_key = _idempotency_key FOR UPDATE;

  IF row.request_hash <> coalesce(_request_hash,'') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST',
                              'operation_id', row.id, 'correlation_id', row.correlation_id);
  END IF;

  IF row.state = 'COMPLETED' THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'operation_id', row.id,
                              'correlation_id', row.correlation_id, 'result', row.result);
  END IF;

  UPDATE public.rental_operations
     SET attempts = attempts + 1, state = 'IN_PROGRESS', failure_reason = NULL
   WHERE id = row.id RETURNING * INTO row;

  RETURN jsonb_build_object('ok', true, 'replay', false, 'retry', true,
                            'operation_id', row.id, 'correlation_id', row.correlation_id);
END; $$;
REVOKE ALL ON FUNCTION public.rental_operation_claim(text,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_operation_claim(text,text,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.rental_operation_complete(
  _operation_id uuid, _result jsonb, _state text DEFAULT 'COMPLETED', _failure_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.rental_operations
     SET state = CASE WHEN upper(coalesce(_state,'COMPLETED')) = 'FAILED' THEN 'FAILED' ELSE 'COMPLETED' END,
         result = _result,
         failure_reason = _failure_reason,
         completed_at = now()
   WHERE id = _operation_id;
END; $$;
REVOKE ALL ON FUNCTION public.rental_operation_complete(uuid,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_operation_complete(uuid,jsonb,text,text) TO service_role;

-- --------------------------------------------- 5. CORRELATION IDS
ALTER TABLE public.rental_quote_requests ADD COLUMN IF NOT EXISTS correlation_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.rental_bookings       ADD COLUMN IF NOT EXISTS correlation_id uuid;
ALTER TABLE public.rental_bookings       ADD COLUMN IF NOT EXISTS provider_id uuid;

UPDATE public.rental_bookings b
   SET correlation_id = q.correlation_id
  FROM public.rental_quote_requests q
 WHERE q.id = b.quote_id AND b.correlation_id IS NULL;