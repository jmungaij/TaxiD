-- ============================================================================
-- Logistics delivery attempt engine + exception control centre
-- ============================================================================

/* ------------------------------ 1. attempts ------------------------------- */
CREATE TABLE public.logistics_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  order_id uuid,
  attempt_number integer NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('delivered','failed','refused','rescheduled','returned')),
  reason_code text,
  narrative text,
  driver_id uuid,
  actor_id uuid,
  location_lat numeric,
  location_lng numeric,
  recipient_name text,
  pod_id uuid,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key),
  UNIQUE (package_id, attempt_number)
);

CREATE INDEX idx_delivery_attempts_pkg ON public.logistics_delivery_attempts(package_id, attempt_number);
CREATE INDEX idx_delivery_attempts_order ON public.logistics_delivery_attempts(order_id);
CREATE INDEX idx_delivery_attempts_driver ON public.logistics_delivery_attempts(driver_id);

GRANT SELECT ON public.logistics_delivery_attempts TO authenticated;
GRANT ALL ON public.logistics_delivery_attempts TO service_role;
ALTER TABLE public.logistics_delivery_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attempts_staff_read" ON public.logistics_delivery_attempts
  FOR SELECT TO authenticated
  USING (public.logistics_ops_actor_authorised('staff.logistics.read') OR driver_id = auth.uid());

CREATE OR REPLACE FUNCTION public._logistics_attempts_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'logistics_delivery_attempts is append-only';
END;
$$;

CREATE TRIGGER trg_attempts_append_only
  BEFORE UPDATE OR DELETE ON public.logistics_delivery_attempts
  FOR EACH ROW EXECUTE FUNCTION public._logistics_attempts_append_only();

/* ----------------------------- 2. exceptions ------------------------------ */
CREATE SEQUENCE IF NOT EXISTS public.logistics_exception_seq;

CREATE TABLE public.logistics_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_number text NOT NULL UNIQUE
    DEFAULT 'LEX-' || to_char(now(), 'YYYYMM') || '-' || lpad(nextval('public.logistics_exception_seq')::text, 6, '0'),
  order_id uuid,
  package_id uuid REFERENCES public.packages(id) ON DELETE SET NULL,
  attempt_id uuid REFERENCES public.logistics_delivery_attempts(id) ON DELETE SET NULL,
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  owner_role text NOT NULL DEFAULT 'operations_admin',
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','investigating','waiting_customer','waiting_partner','resolved','cancelled')),
  reason_code text,
  narrative text,
  sla_due_at timestamptz,
  opened_by uuid,
  resolution text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_logistics_exceptions_status ON public.logistics_exceptions(status, severity);
CREATE INDEX idx_logistics_exceptions_pkg ON public.logistics_exceptions(package_id);
CREATE INDEX idx_logistics_exceptions_order ON public.logistics_exceptions(order_id);
CREATE INDEX idx_logistics_exceptions_sla ON public.logistics_exceptions(sla_due_at) WHERE status <> 'resolved';

GRANT SELECT ON public.logistics_exceptions TO authenticated;
GRANT ALL ON public.logistics_exceptions TO service_role;
ALTER TABLE public.logistics_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "logistics_exceptions_staff_read" ON public.logistics_exceptions
  FOR SELECT TO authenticated
  USING (public.logistics_ops_actor_authorised('staff.logistics.read'));

CREATE TRIGGER trg_logistics_exceptions_touch BEFORE UPDATE ON public.logistics_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.logistics_exception_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_id uuid NOT NULL REFERENCES public.logistics_exceptions(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  from_status text,
  to_status text,
  note text,
  actor_id uuid,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_logistics_exception_events_exc ON public.logistics_exception_events(exception_id, created_at);

GRANT SELECT ON public.logistics_exception_events TO authenticated;
GRANT ALL ON public.logistics_exception_events TO service_role;
ALTER TABLE public.logistics_exception_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "logistics_exception_events_staff_read" ON public.logistics_exception_events
  FOR SELECT TO authenticated
  USING (public.logistics_ops_actor_authorised('staff.logistics.read'));

CREATE OR REPLACE FUNCTION public._logistics_exception_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'logistics_exception_events is append-only';
END;
$$;

CREATE TRIGGER trg_logistics_exception_events_append_only
  BEFORE UPDATE OR DELETE ON public.logistics_exception_events
  FOR EACH ROW EXECUTE FUNCTION public._logistics_exception_events_append_only();

/* --------------------- 3. record a delivery attempt ----------------------- */
CREATE OR REPLACE FUNCTION public.logistics_record_delivery_attempt(
  _package_id uuid,
  _outcome text,
  _idempotency_key text,
  _reason_code text DEFAULT NULL,
  _narrative text DEFAULT NULL,
  _recipient_name text DEFAULT NULL,
  _location_lat numeric DEFAULT NULL,
  _location_lng numeric DEFAULT NULL,
  _evidence jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg public.packages;
  v_is_staff boolean;
  v_existing public.logistics_delivery_attempts;
  v_attempt public.logistics_delivery_attempts;
  v_number integer;
  v_exception_id uuid := NULL;
  v_severity text;
  v_sla interval;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORIZATION_ERROR', 'message', 'Authentication required');
  END IF;
  IF _outcome IS NULL OR _outcome NOT IN ('delivered','failed','refused','rescheduled','returned') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'Unknown attempt outcome');
  END IF;
  IF _idempotency_key IS NULL OR length(_idempotency_key) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'Idempotency key required');
  END IF;
  IF _outcome <> 'delivered' AND (_reason_code IS NULL OR length(_reason_code) = 0) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'A reason code is required for a non-delivered outcome');
  END IF;

  SELECT * INTO v_existing FROM public.logistics_delivery_attempts WHERE idempotency_key = _idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'attempt_id', v_existing.id,
                              'attempt_number', v_existing.attempt_number, 'outcome', v_existing.outcome);
  END IF;

  SELECT * INTO v_pkg FROM public.packages WHERE id = _package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Package not found');
  END IF;

  v_is_staff := public.logistics_ops_actor_authorised('staff.logistics.manage');
  IF NOT v_is_staff AND v_pkg.assigned_driver_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORIZATION_ERROR', 'message', 'Not permitted to record an attempt for this package');
  END IF;

  IF v_pkg.status IN ('delivered','cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION',
                              'message', 'Package is already in a terminal state');
  END IF;

  SELECT coalesce(max(attempt_number), 0) + 1 INTO v_number
    FROM public.logistics_delivery_attempts WHERE package_id = _package_id;

  INSERT INTO public.logistics_delivery_attempts (
    package_id, order_id, attempt_number, outcome, reason_code, narrative,
    driver_id, actor_id, location_lat, location_lng, recipient_name, evidence, idempotency_key
  ) VALUES (
    _package_id, v_pkg.order_id, v_number, _outcome, _reason_code, _narrative,
    v_pkg.assigned_driver_id, auth.uid(), _location_lat, _location_lng, _recipient_name,
    coalesce(_evidence, '{}'::jsonb), _idempotency_key
  ) RETURNING * INTO v_attempt;

  IF _outcome = 'delivered' THEN
    UPDATE public.packages SET status = 'delivered', delivered_at = now(), updated_at = now() WHERE id = _package_id;
  ELSIF _outcome = 'returned' THEN
    UPDATE public.packages SET status = 'returned', updated_at = now() WHERE id = _package_id;
  ELSE
    UPDATE public.packages SET status = 'delivery_failed', updated_at = now() WHERE id = _package_id;
  END IF;

  IF _outcome <> 'delivered' THEN
    v_severity := CASE
      WHEN _reason_code IN ('DAMAGED_PACKAGE','SECURITY_INCIDENT','RESTRICTED_GOODS') THEN 'critical'
      WHEN v_number >= 3 OR _reason_code IN ('COURIER_FAILURE','COMPLIANCE_FAILURE') THEN 'high'
      WHEN v_number = 2 THEN 'medium'
      ELSE 'low' END;
    v_sla := CASE v_severity
      WHEN 'critical' THEN interval '2 hours'
      WHEN 'high' THEN interval '6 hours'
      WHEN 'medium' THEN interval '24 hours'
      ELSE interval '48 hours' END;

    INSERT INTO public.logistics_exceptions (
      order_id, package_id, attempt_id, kind, severity, owner_role,
      reason_code, narrative, sla_due_at, opened_by
    ) VALUES (
      v_pkg.order_id, _package_id, v_attempt.id,
      CASE WHEN _outcome = 'returned' THEN 'return_initiated' ELSE 'delivery_failure' END,
      v_severity, 'operations_admin', _reason_code, _narrative, now() + v_sla, auth.uid()
    ) RETURNING id INTO v_exception_id;

    INSERT INTO public.logistics_exception_events (exception_id, event_name, to_status, note, actor_id)
    VALUES (v_exception_id, 'logistics.exception.opened', 'open',
            format('Attempt %s outcome %s (%s)', v_number, _outcome, coalesce(_reason_code, 'n/a')), auth.uid());
  END IF;

  INSERT INTO public.audit_logs (actor_user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), 'package', _package_id, 'logistics.delivery_attempt.recorded',
          jsonb_build_object('attempt_number', v_number, 'outcome', _outcome,
                             'reason_code', _reason_code, 'exception_id', v_exception_id));

  RETURN jsonb_build_object('ok', true, 'replayed', false, 'attempt_id', v_attempt.id,
                            'attempt_number', v_number, 'outcome', _outcome,
                            'exception_id', v_exception_id);
END;
$$;

REVOKE ALL ON FUNCTION public.logistics_record_delivery_attempt(uuid, text, text, text, text, text, numeric, numeric, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_record_delivery_attempt(uuid, text, text, text, text, text, numeric, numeric, jsonb) TO authenticated, service_role;

/* ---------------------- 4. exception state machine ------------------------ */
CREATE OR REPLACE FUNCTION public.logistics_exception_transition(
  _exception_id uuid,
  _to_status text,
  _note text DEFAULT NULL,
  _resolution text DEFAULT NULL,
  _severity text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exc public.logistics_exceptions;
BEGIN
  IF NOT public.logistics_ops_actor_authorised('staff.logistics.manage') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORIZATION_ERROR', 'message', 'Not permitted to manage logistics exceptions');
  END IF;
  IF _to_status NOT IN ('open','investigating','waiting_customer','waiting_partner','resolved','cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'Unknown exception status');
  END IF;

  SELECT * INTO v_exc FROM public.logistics_exceptions WHERE id = _exception_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Exception not found');
  END IF;
  IF v_exc.status IN ('resolved','cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_TRANSITION', 'message', 'Exception is already closed');
  END IF;
  IF v_exc.status = _to_status THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ALREADY_IN_TARGET_STATE', 'message', 'Exception is already in that status');
  END IF;
  IF _to_status = 'resolved' AND (_resolution IS NULL OR length(trim(_resolution)) < 3) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'A resolution note is required to resolve an exception');
  END IF;

  UPDATE public.logistics_exceptions
     SET status = _to_status,
         severity = coalesce(_severity, severity),
         resolution = CASE WHEN _to_status IN ('resolved','cancelled') THEN _resolution ELSE resolution END,
         resolved_by = CASE WHEN _to_status IN ('resolved','cancelled') THEN auth.uid() ELSE resolved_by END,
         resolved_at = CASE WHEN _to_status IN ('resolved','cancelled') THEN now() ELSE resolved_at END
   WHERE id = _exception_id;

  INSERT INTO public.logistics_exception_events (exception_id, event_name, from_status, to_status, note, actor_id)
  VALUES (_exception_id, 'logistics.exception.' || _to_status, v_exc.status, _to_status, coalesce(_note, _resolution), auth.uid());

  INSERT INTO public.audit_logs (actor_user_id, entity_type, entity_id, action, before_data, after_data)
  VALUES (auth.uid(), 'logistics_exception', _exception_id, 'logistics.exception.transition',
          jsonb_build_object('status', v_exc.status),
          jsonb_build_object('status', _to_status, 'resolution', _resolution));

  RETURN jsonb_build_object('ok', true, 'exception_id', _exception_id, 'status', _to_status);
END;
$$;

REVOKE ALL ON FUNCTION public.logistics_exception_transition(uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_exception_transition(uuid, text, text, text, text) TO authenticated, service_role;

/* --------------------- 5. per-order delivery summary ---------------------- */
CREATE OR REPLACE FUNCTION public.logistics_order_delivery_summary(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summary jsonb;
BEGIN
  IF NOT public.logistics_ops_actor_authorised('staff.logistics.read') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORIZATION_ERROR', 'message', 'Not permitted');
  END IF;

  SELECT jsonb_build_object(
           'ok', true,
           'order_id', _order_id,
           'total', count(*),
           'delivered', count(*) FILTER (WHERE status = 'delivered'),
           'failed', count(*) FILTER (WHERE status = 'delivery_failed'),
           'returned', count(*) FILTER (WHERE status = 'returned'),
           'cancelled', count(*) FILTER (WHERE status = 'cancelled'),
           'in_progress', count(*) FILTER (WHERE status NOT IN ('delivered','delivery_failed','returned','cancelled')),
           'packages', coalesce(jsonb_agg(jsonb_build_object(
             'id', id, 'tracking_number', tracking_number, 'status', status
           ) ORDER BY tracking_number), '[]'::jsonb)
         )
    INTO v_summary
    FROM public.packages
   WHERE order_id = _order_id;

  RETURN coalesce(v_summary, jsonb_build_object('ok', true, 'order_id', _order_id, 'total', 0, 'packages', '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.logistics_order_delivery_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_order_delivery_summary(uuid) TO authenticated, service_role;