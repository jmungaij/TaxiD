
-- Stage 2b: events/outbox + realtime + alerts for dispatch surge approvals.

-- 1. Trigger: every audit insert emits an event to the outbox.
CREATE OR REPLACE FUNCTION public.emit_dispatch_approval_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type text;
BEGIN
  v_event_type := 'dispatch.surge.' || lower(NEW.action);
  INSERT INTO public.event_outbox (
    aggregate, aggregate_id, event_type, payload, dedupe_key, status, attempts, next_attempt_at, created_at
  ) VALUES (
    'dispatch_surge_zone',
    NEW.zone_id,
    v_event_type,
    jsonb_build_object(
      'zone_id', NEW.zone_id,
      'action', NEW.action,
      'previous_state', NEW.previous_state,
      'new_state', NEW.new_state,
      'actor_user_id', NEW.actor_user_id,
      'actor_email', NEW.actor_email,
      'actor_role', NEW.actor_role,
      'reason', NEW.reason,
      'note', NEW.note,
      'request_id', NEW.request_id,
      'correlation_id', NEW.correlation_id,
      'metadata', NEW.metadata,
      'created_at', NEW.created_at
    ),
    'dispatch_approval_audit:' || NEW.id::text,
    'pending',
    0,
    now(),
    now()
  )
  ON CONFLICT (dedupe_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dispatch_approval_audit_outbox ON public.dispatch_approval_audit;
CREATE TRIGGER trg_dispatch_approval_audit_outbox
AFTER INSERT ON public.dispatch_approval_audit
FOR EACH ROW EXECUTE FUNCTION public.emit_dispatch_approval_event();

-- 2. Alerts helper for denial codes with correlation ID.
CREATE OR REPLACE FUNCTION public.emit_dispatch_approval_alert(
  p_code text,
  p_zone_id uuid,
  p_actor uuid,
  p_severity text,
  p_message text,
  p_request_id text,
  p_correlation_id text,
  p_context jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.alerts_events (
    rule_name, stream, metric_key, severity, message, triggered_by, context, is_test, channels_dispatched
  ) VALUES (
    'dispatch_approval_' || lower(p_code),
    'dispatch.surge.approval',
    p_code,
    p_severity,
    p_message,
    p_actor,
    p_context
      || jsonb_build_object(
        'code', p_code,
        'zone_id', p_zone_id,
        'actor_user_id', p_actor,
        'request_id', p_request_id,
        'correlation_id', p_correlation_id
      ),
    false,
    '[]'::jsonb
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_dispatch_approval_alert(text,uuid,uuid,text,text,text,text,jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.emit_dispatch_approval_alert(text,uuid,uuid,text,text,text,text,jsonb) TO service_role;

-- 3. Enable realtime for zones + alerts (idempotent).
DO $$
BEGIN
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.dispatch_surge_zones';
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts_events';
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    EXECUTE 'ALTER TABLE public.dispatch_surge_zones REPLICA IDENTITY FULL';
  EXCEPTION WHEN others THEN NULL; END;
END $$;
