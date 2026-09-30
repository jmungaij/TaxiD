CREATE OR REPLACE FUNCTION public.freight_hub_lifecycle(
  _hub_id uuid, _new_status text, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hub public.logistics_hubs;
  v_prev text;
  v_allowed text[];
  v_action text;
BEGIN
  IF NOT public.logistics_hub_authorised('manage') THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;
  SELECT * INTO v_hub FROM public.logistics_hubs WHERE id = _hub_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'HUB_NOT_FOUND'); END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 8 THEN
    RETURN jsonb_build_object('error', true, 'code', 'REASON_REQUIRED');
  END IF;

  v_prev := upper(v_hub.status);
  IF v_prev = 'INACTIVE' THEN v_prev := 'RETIRED'; END IF;
  IF v_prev = 'PENDING' THEN v_prev := 'PENDING_ACTIVATION'; END IF;

  v_allowed := CASE v_prev
    WHEN 'DRAFT' THEN ARRAY['PENDING_ACTIVATION','RETIRED']
    WHEN 'PENDING_ACTIVATION' THEN ARRAY['ACTIVE','DRAFT','RETIRED']
    WHEN 'ACTIVE' THEN ARRAY['SUSPENDED','RETIRED']
    WHEN 'SUSPENDED' THEN ARRAY['ACTIVE','RETIRED']
    WHEN 'RETIRED' THEN ARRAY['PENDING_ACTIVATION']
    ELSE ARRAY[]::text[] END;

  IF NOT (_new_status = ANY (v_allowed)) THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_TRANSITION',
      'from', v_prev, 'to', _new_status, 'allowed', to_jsonb(v_allowed));
  END IF;

  IF _new_status = 'ACTIVE' THEN
    IF v_hub.lat IS NULL OR v_hub.lng IS NULL THEN
      RETURN jsonb_build_object('error', true, 'code', 'GEOCODE_REQUIRED');
    END IF;
    IF COALESCE(v_hub.max_capacity, 0) <= 0 THEN
      RETURN jsonb_build_object('error', true, 'code', 'CAPACITY_REQUIRED');
    END IF;
    IF v_hub.operating_hours IS NULL OR v_hub.operating_hours = '{}'::jsonb THEN
      RETURN jsonb_build_object('error', true, 'code', 'OPERATING_HOURS_REQUIRED');
    END IF;
    IF COALESCE(v_hub.dock_count, 0) <= 0 THEN
      RETURN jsonb_build_object('error', true, 'code', 'DOCK_CONFIGURATION_REQUIRED');
    END IF;
  END IF;

  IF _new_status IN ('SUSPENDED','RETIRED') THEN
    IF EXISTS (SELECT 1 FROM public.freight_handling_units
                WHERE current_hub_id = _hub_id
                  AND status IN ('RECEIVED','SORTED','STAGED','LOADED')) THEN
      RETURN jsonb_build_object('error', true, 'code', 'CARGO_ON_SITE',
        'detail', 'Cargo is physically on site; clear or transfer it before changing hub status.');
    END IF;
  END IF;

  UPDATE public.logistics_hubs SET
    status = _new_status,
    active = (_new_status = 'ACTIVE'),
    activated_at = CASE WHEN _new_status = 'ACTIVE' THEN now() ELSE activated_at END,
    activated_by = CASE WHEN _new_status = 'ACTIVE' THEN auth.uid() ELSE activated_by END,
    activation_reason = _reason,
    updated_at = now()
  WHERE id = _hub_id;

  v_action := CASE
    WHEN _new_status = 'ACTIVE' THEN 'activated'
    WHEN _new_status IN ('SUSPENDED','RETIRED') THEN 'deactivated'
    ELSE 'status_changed' END;

  PERFORM public._logistics_hub_audit(_hub_id, v_action,
    jsonb_build_object('status', v_prev),
    jsonb_build_object('status', _new_status, 'reason', _reason,
                       'actor', auth.uid(), 'at', now()));

  RETURN jsonb_build_object('error', false, 'code', 'STATUS_CHANGED',
    'hub_id', _hub_id, 'previous_status', v_prev, 'new_status', _new_status,
    'audit_action', v_action,
    'activation_actor', auth.uid(), 'activation_timestamp', now(), 'reason', _reason);
END $$;