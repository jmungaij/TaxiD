-- =====================================================================
-- YALLA OPERATIONAL SPINE ACTIVATION — STAGE A: REAL EVENT PRODUCERS + SLA
-- =====================================================================

-- 1. OUTBOX -----------------------------------------------------------
CREATE TABLE public.ops_event_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_uid text NOT NULL,
  event_type text NOT NULL,
  source_portal text NOT NULL,
  service_line text,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  entity_ref text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  ops_event_id uuid,
  work_item_id uuid,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_event_outbox_dedupe_key_uniq UNIQUE (dedupe_key),
  CONSTRAINT ops_event_outbox_status_chk CHECK (status IN ('pending','processed','failed','skipped'))
);

CREATE INDEX ops_event_outbox_pending_idx ON public.ops_event_outbox (status, occurred_at) WHERE status = 'pending';
CREATE INDEX ops_event_outbox_entity_idx ON public.ops_event_outbox (entity_type, entity_id);

GRANT SELECT ON public.ops_event_outbox TO authenticated;
GRANT ALL ON public.ops_event_outbox TO service_role;
ALTER TABLE public.ops_event_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read the platform event outbox"
  ON public.ops_event_outbox FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE TRIGGER ops_event_outbox_touch
  BEFORE UPDATE ON public.ops_event_outbox
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. INTERNAL PRODUCER API -------------------------------------------
-- Only reachable from database triggers / internal jobs. Clients cannot forge
-- platform events: EXECUTE is revoked from anon + authenticated.
CREATE OR REPLACE FUNCTION public.ops_enqueue_event(
  _event_uid text,
  _event_type text,
  _source_portal text,
  _entity_type text,
  _entity_id uuid,
  _entity_ref text DEFAULT NULL,
  _service_line text DEFAULT NULL,
  _signals jsonb DEFAULT '{}'::jsonb,
  _payload jsonb DEFAULT '{}'::jsonb,
  _occurred_at timestamptz DEFAULT now()
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
  v_id uuid;
BEGIN
  IF _event_type IS NULL OR _entity_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- Must match dedupeKeyFor() in src/lib/orchestration/api.ts
  v_key := _event_type || ':' || _entity_type || ':' || _entity_id::text || ':' || _event_uid;

  INSERT INTO public.ops_event_outbox (
    event_uid, event_type, source_portal, service_line, entity_type, entity_id,
    entity_ref, occurred_at, signals, payload, dedupe_key
  ) VALUES (
    _event_uid, _event_type, _source_portal, _service_line, _entity_type, _entity_id,
    _entity_ref, coalesce(_occurred_at, now()), coalesce(_signals,'{}'::jsonb),
    coalesce(_payload,'{}'::jsonb), v_key
  )
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.ops_enqueue_event(text,text,text,text,uuid,text,text,jsonb,jsonb,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_enqueue_event(text,text,text,text,uuid,text,text,jsonb,jsonb,timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_enqueue_event(text,text,text,text,uuid,text,text,jsonb,jsonb,timestamptz) TO service_role;

-- 3. PRODUCER: RIDES / TRIP BOOKINGS ---------------------------------
CREATE OR REPLACE FUNCTION public.ops_produce_trip_booking_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sig jsonb;
  v_corp boolean;
BEGIN
  v_corp := coalesce(NEW.intent,'') IN ('corporate','business','employee_transport');
  v_sig := jsonb_build_object(
    'isCorporate', v_corp,
    'amountKes', coalesce(NEW.total_fare, 0),
    'customerWaiting', NEW.scheduled_for IS NULL OR NEW.scheduled_for <= now() + interval '60 minutes',
    'slaSensitive', v_corp
  );

  IF TG_OP = 'INSERT' THEN
    PERFORM public.ops_enqueue_event(
      'created', 'demand_captured', 'rider', 'booking', NEW.id, NEW.booking_number,
      'ride_hailing', v_sig, jsonb_build_object('status', NEW.status), coalesce(NEW.created_at, now()));
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'completed' THEN
      PERFORM public.ops_enqueue_event('completed','fulfilment_completed','rider','booking',NEW.id,NEW.booking_number,
        'ride_hailing', v_sig, jsonb_build_object('previous_state', OLD.status, 'new_state', NEW.status),
        coalesce(NEW.completed_at, now()));
    ELSIF NEW.status IN ('no_show','driver_no_show') THEN
      PERFORM public.ops_enqueue_event('no_show','driver_no_show','driver','booking',NEW.id,NEW.booking_number,
        'ride_hailing', v_sig, jsonb_build_object('previous_state', OLD.status, 'new_state', NEW.status), now());
    ELSIF NEW.status = 'cancelled' THEN
      IF coalesce(NEW.cancelled_by,'') IN ('driver','provider','operator') THEN
        PERFORM public.ops_enqueue_event('provider_cancelled','provider_cancelled','driver','booking',NEW.id,NEW.booking_number,
          'ride_hailing', v_sig,
          jsonb_build_object('previous_state', OLD.status, 'new_state', NEW.status,
                             'cancelled_by', NEW.cancelled_by, 'reason', NEW.cancellation_reason),
          coalesce(NEW.cancelled_at, now()));
      ELSIF coalesce(NEW.cancelled_by,'') = 'system' THEN
        PERFORM public.ops_enqueue_event('unmatched','demand_unmatched','system','booking',NEW.id,NEW.booking_number,
          'ride_hailing', v_sig,
          jsonb_build_object('previous_state', OLD.status, 'new_state', NEW.status, 'reason', NEW.cancellation_reason),
          coalesce(NEW.cancelled_at, now()));
      END IF;
    END IF;
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status AND NEW.payment_status IN ('failed','declined') THEN
    PERFORM public.ops_enqueue_event('payment_failed','payment_failed','system','booking',NEW.id,NEW.booking_number,
      'ride_hailing', v_sig,
      jsonb_build_object('previous_state', OLD.payment_status, 'new_state', NEW.payment_status,
                         'payment_reference', NEW.payment_reference), now());
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER ops_produce_trip_booking_events_aiu
  AFTER INSERT OR UPDATE ON public.trip_bookings
  FOR EACH ROW EXECUTE FUNCTION public.ops_produce_trip_booking_events();

-- 4. PRODUCER: DELIVERY / LOGISTICS ----------------------------------
CREATE OR REPLACE FUNCTION public.ops_produce_delivery_order_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_sig jsonb;
BEGIN
  v_sig := jsonb_build_object(
    'amountKes', coalesce(NEW.total_amount,0),
    'slaSensitive', NEW.sla_deadline IS NOT NULL,
    'customerWaiting', true);

  IF TG_OP = 'INSERT' THEN
    PERFORM public.ops_enqueue_event('created','demand_captured','delivery_logistics','delivery_order',NEW.id,NEW.order_number,
      coalesce(NEW.module,'delivery'), v_sig, jsonb_build_object('status',NEW.status), coalesce(NEW.created_at, now()));
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('delivered','completed') THEN
      PERFORM public.ops_enqueue_event('completed','fulfilment_completed','delivery_logistics','delivery_order',NEW.id,NEW.order_number,
        coalesce(NEW.module,'delivery'), v_sig,
        jsonb_build_object('previous_state',OLD.status,'new_state',NEW.status), now());
    ELSIF NEW.status IN ('pickup_failed','failed_pickup') THEN
      PERFORM public.ops_enqueue_event('pickup_failed','failed_pickup','delivery_logistics','delivery_order',NEW.id,NEW.order_number,
        coalesce(NEW.module,'delivery'), v_sig,
        jsonb_build_object('previous_state',OLD.status,'new_state',NEW.status), now());
    ELSIF NEW.status IN ('failed','delivery_failed','returned') THEN
      PERFORM public.ops_enqueue_event('delivery_failed','failed_delivery','delivery_logistics','delivery_order',NEW.id,NEW.order_number,
        coalesce(NEW.module,'delivery'), v_sig,
        jsonb_build_object('previous_state',OLD.status,'new_state',NEW.status), now());
    END IF;
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status AND NEW.payment_status IN ('failed','declined') THEN
    PERFORM public.ops_enqueue_event('payment_failed','payment_failed','system','delivery_order',NEW.id,NEW.order_number,
      coalesce(NEW.module,'delivery'), v_sig,
      jsonb_build_object('previous_state',OLD.payment_status,'new_state',NEW.payment_status), now());
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER ops_produce_delivery_order_events_aiu
  AFTER INSERT OR UPDATE ON public.delivery_orders
  FOR EACH ROW EXECUTE FUNCTION public.ops_produce_delivery_order_events();

-- 5. PRODUCER: CHARTER -----------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_produce_charter_booking_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_sig jsonb;
BEGIN
  v_sig := jsonb_build_object(
    'amountKes', coalesce(NEW.amount,0),
    'isCorporate', true,
    'slaSensitive', false);

  IF TG_OP = 'INSERT' THEN
    PERFORM public.ops_enqueue_event('created','demand_captured','charter','booking',NEW.id,NEW.reference,
      coalesce(NEW.category_slug,'charter'), v_sig, jsonb_build_object('status',NEW.status), coalesce(NEW.created_at, now()));
    IF coalesce(NEW.amount,0) >= 500000 THEN
      PERFORM public.ops_enqueue_event('high_value','high_value_demand','charter','booking',NEW.id,NEW.reference,
        coalesce(NEW.category_slug,'charter'), v_sig, jsonb_build_object('amount',NEW.amount), coalesce(NEW.created_at, now()));
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('completed','fulfilled') THEN
      PERFORM public.ops_enqueue_event('completed','fulfilment_completed','charter','booking',NEW.id,NEW.reference,
        coalesce(NEW.category_slug,'charter'), v_sig,
        jsonb_build_object('previous_state',OLD.status,'new_state',NEW.status), now());
    ELSIF NEW.status IN ('cancelled','provider_cancelled') THEN
      PERFORM public.ops_enqueue_event('provider_cancelled','provider_cancelled','charter','booking',NEW.id,NEW.reference,
        coalesce(NEW.category_slug,'charter'), v_sig,
        jsonb_build_object('previous_state',OLD.status,'new_state',NEW.status), now());
    END IF;
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status AND NEW.payment_status IN ('failed','declined') THEN
    PERFORM public.ops_enqueue_event('payment_failed','payment_failed','system','booking',NEW.id,NEW.reference,
      coalesce(NEW.category_slug,'charter'), v_sig,
      jsonb_build_object('previous_state',OLD.payment_status,'new_state',NEW.payment_status), now());
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER ops_produce_charter_booking_events_aiu
  AFTER INSERT OR UPDATE ON public.charter_bookings
  FOR EACH ROW EXECUTE FUNCTION public.ops_produce_charter_booking_events();

-- 6. PRODUCER: DISPATCH ----------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_produce_dispatch_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.cancelled_at IS NOT NULL AND OLD.cancelled_at IS NULL THEN
    PERFORM public.ops_enqueue_event('assignment_cancelled','provider_cancelled','driver','booking',
      coalesce(NEW.request_id, NEW.id), NULL, 'ride_hailing',
      jsonb_build_object('customerWaiting', true),
      jsonb_build_object('assignment_id', NEW.id, 'driver_id', NEW.driver_id, 'reason', NEW.cancel_reason),
      NEW.cancelled_at);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER ops_produce_dispatch_events_au
  AFTER UPDATE ON public.dispatch_assignments
  FOR EACH ROW EXECUTE FUNCTION public.ops_produce_dispatch_events();

-- 7. PRODUCER: COMPLIANCE DOCUMENTS ----------------------------------
CREATE OR REPLACE FUNCTION public.ops_produce_document_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_days integer;
BEGIN
  IF NEW.expiry_date IS NULL THEN RETURN NEW; END IF;
  v_days := NEW.expiry_date - current_date;

  IF NEW.status IS DISTINCT FROM coalesce(OLD.status,'') AND NEW.status IN ('rejected','expired') THEN
    PERFORM public.ops_enqueue_event('doc_' || NEW.status || '_' || NEW.expiry_date::text,
      'compliance_document_expired','system','document',NEW.id,NEW.doc_type,'compliance',
      jsonb_build_object('daysToExpiry', v_days),
      jsonb_build_object('corporate_id',NEW.corporate_id,'doc_type',NEW.doc_type,'new_state',NEW.status), now());
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER ops_produce_document_events_aiu
  AFTER INSERT OR UPDATE ON public.corporate_documents
  FOR EACH ROW EXECUTE FUNCTION public.ops_produce_document_events();

-- Daily expiry sweep: raises expiring (<=30d) and expired compliance documents.
CREATE OR REPLACE FUNCTION public.ops_sweep_document_expiry()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT id, doc_type, corporate_id, expiry_date, (expiry_date - current_date) AS days
    FROM public.corporate_documents
    WHERE expiry_date IS NOT NULL
      AND status IN ('approved','pending','under_review')
      AND expiry_date <= current_date + 30
  LOOP
    PERFORM public.ops_enqueue_event(
      'expiry_' || r.expiry_date::text,
      CASE WHEN r.days < 0 THEN 'compliance_document_expired' ELSE 'compliance_document_expiring' END,
      'system','document', r.id, r.doc_type, 'compliance',
      jsonb_build_object('daysToExpiry', r.days),
      jsonb_build_object('corporate_id', r.corporate_id, 'doc_type', r.doc_type, 'expiry_date', r.expiry_date),
      now());
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public.ops_sweep_document_expiry() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_sweep_document_expiry() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ops_sweep_document_expiry() TO service_role;

-- 8. SLA ENFORCEMENT WORKER ------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_sweep_slas()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_breached integer := 0;
  v_at_risk integer := 0;
BEGIN
  FOR r IN
    SELECT id, lifecycle_state, escalation_level, sla_due_at, sla_minutes, ops_queue,
           entity_type, entity_id, priority
    FROM public.staff_work_items
    WHERE ops_queue IS NOT NULL
      AND lifecycle_state NOT IN ('resolved','closed')
      AND sla_due_at IS NOT NULL
      AND sla_breached_at IS NULL
      AND sla_due_at < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.staff_work_items
       SET sla_breached_at = now(),
           escalation_level = coalesce(escalation_level,0) + 1,
           lifecycle_state = CASE WHEN lifecycle_state = 'escalated' THEN lifecycle_state ELSE 'escalated' END,
           status = 'blocked',
           updated_at = now()
     WHERE id = r.id;

    INSERT INTO public.ops_work_audit (
      work_item_id, actor_user_id, actor_role, action, state_before, state_after,
      reason, entity_type, entity_id, metadata
    ) VALUES (
      r.id, NULL, 'system', 'sla_breached_escalated', r.lifecycle_state, 'escalated',
      'SLA target passed without resolution — escalated automatically',
      r.entity_type, r.entity_id,
      jsonb_build_object('sla_due_at', r.sla_due_at, 'sla_minutes', r.sla_minutes,
                         'queue', r.ops_queue, 'escalation_level', coalesce(r.escalation_level,0) + 1)
    );
    v_breached := v_breached + 1;
  END LOOP;

  -- At-risk warning: 80% of the window consumed, recorded once.
  FOR r IN
    SELECT w.id, w.lifecycle_state, w.sla_due_at, w.sla_minutes, w.ops_queue, w.entity_type, w.entity_id
    FROM public.staff_work_items w
    WHERE w.ops_queue IS NOT NULL
      AND w.lifecycle_state NOT IN ('resolved','closed')
      AND w.sla_due_at IS NOT NULL
      AND w.sla_breached_at IS NULL
      AND now() >= w.sla_started_at + (w.sla_minutes * interval '1 minute') * 0.8
      AND NOT EXISTS (
        SELECT 1 FROM public.ops_work_audit a
        WHERE a.work_item_id = w.id AND a.action = 'sla_at_risk_warning')
  LOOP
    INSERT INTO public.ops_work_audit (
      work_item_id, actor_user_id, actor_role, action, state_before, state_after,
      reason, entity_type, entity_id, metadata
    ) VALUES (
      r.id, NULL, 'system', 'sla_at_risk_warning', r.lifecycle_state, r.lifecycle_state,
      'SLA window 80% consumed — intervention required before breach',
      r.entity_type, r.entity_id,
      jsonb_build_object('sla_due_at', r.sla_due_at, 'queue', r.ops_queue)
    );
    v_at_risk := v_at_risk + 1;
  END LOOP;

  RETURN jsonb_build_object('breached', v_breached, 'at_risk', v_at_risk, 'swept_at', now());
END $$;

REVOKE ALL ON FUNCTION public.ops_sweep_slas() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ops_sweep_slas() FROM anon;
GRANT EXECUTE ON FUNCTION public.ops_sweep_slas() TO service_role;

-- 9. SCHEDULES --------------------------------------------------------
SELECT cron.schedule(
  'ops-sla-sweeper-every-2m', '*/2 * * * *',
  $$SELECT public.ops_sweep_slas();$$
);

SELECT cron.schedule(
  'ops-document-expiry-daily', '30 6 * * *',
  $$SELECT public.ops_sweep_document_expiry();$$
);

SELECT cron.schedule(
  'ops-orchestrator-every-minute', '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://axwgyvhkuzalfqzribtz.supabase.co/functions/v1/ops-orchestrator',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object('trigger','cron')
  );
  $$
);
