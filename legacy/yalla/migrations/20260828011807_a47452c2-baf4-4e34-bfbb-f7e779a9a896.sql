-- ============================================================================
-- Logistics dispatch operations: authoritative order activity model,
-- server-side batch orchestration, scheduling and onboarding message setting.
-- ============================================================================

/* ------------------------- 1. activity reference model -------------------- */
CREATE TABLE public.logistics_order_activities (
  code text PRIMARY KEY,
  label text NOT NULL,
  description text,
  sequence integer NOT NULL,
  terminal boolean NOT NULL DEFAULT false,
  exception_state boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.logistics_order_activities TO authenticated;
GRANT ALL ON public.logistics_order_activities TO service_role;
ALTER TABLE public.logistics_order_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activities_staff_read" ON public.logistics_order_activities
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read')
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));

CREATE POLICY "activities_admin_write" ON public.logistics_order_activities
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE public.logistics_order_activity_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_code text NOT NULL REFERENCES public.logistics_order_activities(code) ON DELETE CASCADE,
  to_code text NOT NULL REFERENCES public.logistics_order_activities(code) ON DELETE CASCADE,
  actor_roles text[] NOT NULL DEFAULT ARRAY['admin','super_admin','operations_admin']::text[],
  required_permission text NOT NULL DEFAULT 'staff.logistics.manage',
  requires_reason boolean NOT NULL DEFAULT false,
  warning text,
  event_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_code, to_code)
);

GRANT SELECT ON public.logistics_order_activity_transitions TO authenticated;
GRANT ALL ON public.logistics_order_activity_transitions TO service_role;
ALTER TABLE public.logistics_order_activity_transitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_transitions_staff_read" ON public.logistics_order_activity_transitions
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read')
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));

CREATE POLICY "activity_transitions_admin_write" ON public.logistics_order_activity_transitions
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

/* --------------------------- 2. batch operations -------------------------- */
CREATE TABLE public.logistics_batch_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation text NOT NULL,
  target_activity text,
  idempotency_key text NOT NULL,
  correlation_id text NOT NULL,
  actor_id uuid,
  target_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  reason text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);

GRANT SELECT ON public.logistics_batch_operations TO authenticated;
GRANT ALL ON public.logistics_batch_operations TO service_role;
ALTER TABLE public.logistics_batch_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "batch_ops_staff_read" ON public.logistics_batch_operations
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read')
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));

CREATE TABLE public.logistics_batch_operation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.logistics_batch_operations(id) ON DELETE CASCADE,
  order_id uuid NOT NULL,
  order_number text,
  from_activity text,
  to_activity text,
  status text NOT NULL DEFAULT 'pending',
  error_code text,
  error_detail text,
  attempts integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, order_id)
);

CREATE INDEX idx_batch_items_batch ON public.logistics_batch_operation_items(batch_id);
CREATE INDEX idx_batch_items_order ON public.logistics_batch_operation_items(order_id);

GRANT SELECT ON public.logistics_batch_operation_items TO authenticated;
GRANT ALL ON public.logistics_batch_operation_items TO service_role;
ALTER TABLE public.logistics_batch_operation_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "batch_items_staff_read" ON public.logistics_batch_operation_items
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read')
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));

CREATE TRIGGER trg_batch_ops_touch BEFORE UPDATE ON public.logistics_batch_operations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_batch_items_touch BEFORE UPDATE ON public.logistics_batch_operation_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

/* ---------------------- 3. authorisation helper --------------------------- */
CREATE OR REPLACE FUNCTION public.logistics_ops_actor_authorised(_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND (public.has_staff_permission(_permission)
          OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));
$$;

REVOKE ALL ON FUNCTION public.logistics_ops_actor_authorised(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_ops_actor_authorised(text) TO authenticated, service_role;

/* ------------------------- 4. batch lifecycle RPCs ------------------------ */
CREATE OR REPLACE FUNCTION public.logistics_batch_begin(
  _operation text,
  _target_activity text,
  _order_ids uuid[],
  _idempotency_key text,
  _correlation_id text,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch public.logistics_batch_operations;
  v_count integer;
BEGIN
  IF NOT public.logistics_ops_actor_authorised('staff.logistics.manage') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORIZATION_ERROR',
      'message', 'You are not permitted to run bulk logistics operations.');
  END IF;

  IF _order_ids IS NULL OR array_length(_order_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'No orders were selected.');
  END IF;
  IF array_length(_order_ids, 1) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'A batch may contain at most 500 orders.');
  END IF;
  IF coalesce(trim(_idempotency_key), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'An idempotency key is required.');
  END IF;

  -- Double submission returns the original batch: no second set of updates.
  SELECT * INTO v_batch FROM public.logistics_batch_operations WHERE idempotency_key = _idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'code', 'DUPLICATE', 'replayed', true,
      'batch_id', v_batch.id, 'correlation_id', v_batch.correlation_id);
  END IF;

  INSERT INTO public.logistics_batch_operations(
    operation, target_activity, idempotency_key, correlation_id, actor_id, target_count, reason)
  VALUES (_operation, _target_activity, _idempotency_key,
          coalesce(nullif(trim(_correlation_id), ''), gen_random_uuid()::text),
          auth.uid(), array_length(_order_ids, 1), nullif(trim(_reason), ''))
  RETURNING * INTO v_batch;

  INSERT INTO public.logistics_batch_operation_items(batch_id, order_id, order_number, from_activity, to_activity)
  SELECT v_batch.id, o.id, o.order_number, o.status, _target_activity
  FROM unnest(_order_ids) AS ids(order_id)
  LEFT JOIN public.delivery_orders o ON o.id = ids.order_id;

  -- Orders that do not exist are recorded as failures immediately, never dropped.
  UPDATE public.logistics_batch_operation_items i
     SET status = 'failed', error_code = 'NOT_FOUND', error_detail = 'Order not found', completed_at = now()
   WHERE i.batch_id = v_batch.id
     AND NOT EXISTS (SELECT 1 FROM public.delivery_orders o WHERE o.id = i.order_id);

  SELECT count(*) INTO v_count FROM public.logistics_batch_operation_items WHERE batch_id = v_batch.id;

  INSERT INTO public.audit_logs(action, table_name, record_id, user_id, new_values)
  VALUES ('logistics.batch.started', 'logistics_batch_operations', v_batch.id::text, auth.uid(),
          jsonb_build_object('operation', _operation, 'target_activity', _target_activity,
                             'target_count', v_count, 'correlation_id', v_batch.correlation_id));

  RETURN jsonb_build_object('ok', true, 'code', 'ACCEPTED', 'replayed', false,
    'batch_id', v_batch.id, 'correlation_id', v_batch.correlation_id, 'target_count', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.logistics_batch_begin(text, text, uuid[], text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_batch_begin(text, text, uuid[], text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.logistics_batch_complete(_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_success integer;
  v_failure integer;
  v_pending integer;
BEGIN
  IF NOT public.logistics_ops_actor_authorised('staff.logistics.manage') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORIZATION_ERROR');
  END IF;

  SELECT count(*) FILTER (WHERE status = 'succeeded'),
         count(*) FILTER (WHERE status = 'failed'),
         count(*) FILTER (WHERE status = 'pending')
    INTO v_success, v_failure, v_pending
  FROM public.logistics_batch_operation_items WHERE batch_id = _batch_id;

  UPDATE public.logistics_batch_operations
     SET success_count = v_success,
         failure_count = v_failure,
         status = CASE WHEN v_pending > 0 THEN 'running'
                       WHEN v_failure = 0 THEN 'completed'
                       WHEN v_success = 0 THEN 'failed'
                       ELSE 'completed_with_failures' END,
         completed_at = CASE WHEN v_pending > 0 THEN NULL ELSE now() END
   WHERE id = _batch_id;

  INSERT INTO public.audit_logs(action, table_name, record_id, user_id, new_values)
  VALUES ('logistics.batch.completed', 'logistics_batch_operations', _batch_id::text, auth.uid(),
          jsonb_build_object('success_count', v_success, 'failure_count', v_failure, 'pending', v_pending));

  RETURN jsonb_build_object('ok', true, 'success_count', v_success, 'failure_count', v_failure, 'pending', v_pending);
END;
$$;

REVOKE ALL ON FUNCTION public.logistics_batch_complete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_batch_complete(uuid) TO authenticated, service_role;

/* ------------------- 5. authoritative activity transition ----------------- */
CREATE OR REPLACE FUNCTION public.logistics_order_set_activity(
  _order_id uuid,
  _target_activity text,
  _reason text DEFAULT NULL,
  _correlation_id text DEFAULT NULL,
  _batch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.delivery_orders;
  v_transition public.logistics_order_activity_transitions;
  v_item public.logistics_batch_operation_items;
  v_code text;
  v_message text;
BEGIN
  IF NOT public.logistics_ops_actor_authorised('staff.logistics.manage') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORIZATION_ERROR',
      'message', 'You are not permitted to change order activity.');
  END IF;

  IF _batch_id IS NOT NULL THEN
    SELECT * INTO v_item FROM public.logistics_batch_operation_items
     WHERE batch_id = _batch_id AND order_id = _order_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'This order is not part of the batch.');
    END IF;
    -- Idempotency: a completed item is never executed twice.
    IF v_item.status = 'succeeded' THEN
      RETURN jsonb_build_object('ok', true, 'code', 'DUPLICATE', 'replayed', true,
        'order_id', _order_id, 'to_activity', v_item.to_activity);
    END IF;
  END IF;

  SELECT * INTO v_order FROM public.delivery_orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    v_code := 'NOT_FOUND'; v_message := 'Order not found.';
  ELSIF NOT EXISTS (SELECT 1 FROM public.logistics_order_activities WHERE code = _target_activity) THEN
    v_code := 'VALIDATION_ERROR'; v_message := 'Unknown target activity.';
  ELSIF v_order.status = _target_activity THEN
    v_code := 'ALREADY_IN_TARGET_STATE'; v_message := 'The order is already in this activity.';
  ELSE
    SELECT * INTO v_transition FROM public.logistics_order_activity_transitions
     WHERE from_code = v_order.status AND to_code = _target_activity;
    IF NOT FOUND THEN
      v_code := 'INVALID_TRANSITION';
      v_message := format('%s cannot move to %s.', v_order.status, _target_activity);
    ELSIF NOT public.logistics_ops_actor_authorised(v_transition.required_permission) THEN
      v_code := 'AUTHORIZATION_ERROR'; v_message := 'This transition requires a higher permission.';
    ELSIF v_transition.requires_reason AND coalesce(trim(_reason), '') = '' THEN
      v_code := 'VALIDATION_ERROR'; v_message := 'A reason is required for this transition.';
    END IF;
  END IF;

  IF v_code IS NOT NULL THEN
    IF _batch_id IS NOT NULL THEN
      UPDATE public.logistics_batch_operation_items
         SET status = 'failed', error_code = v_code, error_detail = v_message,
             attempts = attempts + 1, from_activity = v_order.status, completed_at = now()
       WHERE batch_id = _batch_id AND order_id = _order_id;
    END IF;
    RETURN jsonb_build_object('ok', false, 'code', v_code, 'message', v_message, 'order_id', _order_id);
  END IF;

  UPDATE public.delivery_orders
     SET status = _target_activity,
         notes = CASE WHEN coalesce(trim(_reason), '') = '' THEN notes ELSE _reason END,
         metadata = metadata
           || jsonb_build_object('last_activity_change', jsonb_build_object(
                'from', v_order.status, 'to', _target_activity, 'at', now(),
                'actor', auth.uid(), 'correlation_id', _correlation_id, 'batch_id', _batch_id))
   WHERE id = _order_id;

  INSERT INTO public.audit_logs(action, table_name, record_id, user_id, old_values, new_values)
  VALUES ('logistics.order.activity_changed', 'delivery_orders', _order_id::text, auth.uid(),
          jsonb_build_object('status', v_order.status),
          jsonb_build_object('status', _target_activity, 'reason', nullif(trim(_reason), ''),
                             'event', v_transition.event_name, 'correlation_id', _correlation_id,
                             'batch_id', _batch_id));

  IF _batch_id IS NOT NULL THEN
    UPDATE public.logistics_batch_operation_items
       SET status = 'succeeded', error_code = NULL, error_detail = NULL,
           attempts = attempts + 1, from_activity = v_order.status, completed_at = now()
     WHERE batch_id = _batch_id AND order_id = _order_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'code', 'UPDATED', 'order_id', _order_id,
    'order_number', v_order.order_number, 'from_activity', v_order.status,
    'to_activity', _target_activity, 'event', v_transition.event_name);
END;
$$;

REVOKE ALL ON FUNCTION public.logistics_order_set_activity(uuid, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_order_set_activity(uuid, text, text, text, uuid) TO authenticated, service_role;

/* --------------------------- 6. rescheduling ----------------------------- */
CREATE OR REPLACE FUNCTION public.logistics_order_reschedule(
  _order_id uuid,
  _pickup_window_start timestamptz,
  _pickup_window_end timestamptz,
  _correlation_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.delivery_orders;
BEGIN
  IF NOT public.logistics_ops_actor_authorised('staff.logistics.manage') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORIZATION_ERROR',
      'message', 'You are not permitted to reschedule orders.');
  END IF;

  SELECT * INTO v_order FROM public.delivery_orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'message', 'Order not found.');
  END IF;
  IF _pickup_window_start IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'A pickup start time is required.');
  END IF;
  IF _pickup_window_end IS NOT NULL AND _pickup_window_end <= _pickup_window_start THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'The pickup window must end after it starts.');
  END IF;
  IF v_order.status IN ('delivered', 'cancelled', 'closed', 'returned') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT',
      'message', format('A %s order cannot be rescheduled.', v_order.status));
  END IF;

  UPDATE public.delivery_orders
     SET pickup_window_start = _pickup_window_start,
         pickup_window_end = coalesce(_pickup_window_end, _pickup_window_start + interval '1 hour')
   WHERE id = _order_id;

  INSERT INTO public.audit_logs(action, table_name, record_id, user_id, old_values, new_values)
  VALUES ('logistics.order.rescheduled', 'delivery_orders', _order_id::text, auth.uid(),
          jsonb_build_object('pickup_window_start', v_order.pickup_window_start,
                             'pickup_window_end', v_order.pickup_window_end),
          jsonb_build_object('pickup_window_start', _pickup_window_start,
                             'pickup_window_end', coalesce(_pickup_window_end, _pickup_window_start + interval '1 hour'),
                             'correlation_id', _correlation_id));

  RETURN jsonb_build_object('ok', true, 'code', 'RESCHEDULED', 'order_id', _order_id,
    'pickup_window_start', _pickup_window_start,
    'pickup_window_end', coalesce(_pickup_window_end, _pickup_window_start + interval '1 hour'));
END;
$$;

REVOKE ALL ON FUNCTION public.logistics_order_reschedule(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_order_reschedule(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;

/* ---------------------- 7. onboarding welcome message -------------------- */
ALTER TABLE public.platform_settings ADD COLUMN IF NOT EXISTS onboarding_welcome_message text;

CREATE OR REPLACE FUNCTION public.public_onboarding_message()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT onboarding_welcome_message
  FROM public.platform_settings
  ORDER BY created_at
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.public_onboarding_message() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_onboarding_message() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_onboarding_message(_message text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_old text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORIZATION_ERROR',
      'message', 'Only administrators may change the onboarding message.');
  END IF;
  IF length(coalesce(_message, '')) > 4000 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR',
      'message', 'The onboarding message may not exceed 4000 characters.');
  END IF;

  SELECT id, onboarding_welcome_message INTO v_id, v_old
  FROM public.platform_settings ORDER BY created_at LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.platform_settings(onboarding_welcome_message)
    VALUES (nullif(trim(_message), '')) RETURNING id INTO v_id;
  ELSE
    UPDATE public.platform_settings
       SET onboarding_welcome_message = nullif(trim(_message), '')
     WHERE id = v_id;
  END IF;

  INSERT INTO public.audit_logs(action, table_name, record_id, user_id, old_values, new_values)
  VALUES ('platform.onboarding_message_changed', 'platform_settings', v_id::text, auth.uid(),
          jsonb_build_object('length', length(coalesce(v_old, ''))),
          jsonb_build_object('length', length(coalesce(trim(_message), ''))));

  RETURN jsonb_build_object('ok', true, 'code', 'SAVED');
END;
$$;

REVOKE ALL ON FUNCTION public.set_onboarding_message(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_onboarding_message(text) TO authenticated, service_role;