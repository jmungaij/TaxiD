CREATE OR REPLACE FUNCTION public.logistics_api_route(_partner_id uuid, _environment public.partner_api_environment, _route_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.is_service_context() THEN RAISE EXCEPTION 'service_context_required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.logistics_stop_packages sp
      JOIN public.logistics_route_stops s ON s.id = sp.stop_id
      JOIN public.packages p ON p.id = sp.package_id
     WHERE s.route_id = _route_id
       AND public.logistics_api_can_see_order(_partner_id, _environment, p.order_id)) THEN
    RETURN NULL;
  END IF;
  SELECT jsonb_build_object(
    'id', r.id, 'route_number', r.route_number, 'status', r.status,
    'planned_start', r.planned_start, 'planned_end', r.planned_end,
    'stop_count', (SELECT count(*) FROM public.logistics_route_stops s WHERE s.route_id = r.id),
    'my_stops', coalesce((SELECT jsonb_agg(DISTINCT jsonb_build_object(
        'stop_id', s.id, 'sequence', s.sequence, 'status', s.status,
        'planned_arrival', s.planned_arrival, 'eta', s.eta))
      FROM public.logistics_route_stops s
      JOIN public.logistics_stop_packages sp ON sp.stop_id = s.id
      JOIN public.packages p ON p.id = sp.package_id
     WHERE s.route_id = r.id AND public.logistics_api_can_see_order(_partner_id, _environment, p.order_id)), '[]'::jsonb))
  INTO v FROM public.logistics_routes r WHERE r.id = _route_id;
  RETURN v;
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_api_package(_partner_id uuid, _environment public.partner_api_environment, _package_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; v_order uuid;
BEGIN
  IF NOT public.is_service_context() THEN RAISE EXCEPTION 'service_context_required' USING ERRCODE='42501'; END IF;
  SELECT order_id INTO v_order FROM public.packages WHERE id = _package_id;
  IF v_order IS NULL OR NOT public.logistics_api_can_see_order(_partner_id, _environment, v_order) THEN RETURN NULL; END IF;
  SELECT jsonb_build_object(
    'id', p.id, 'order_id', p.order_id, 'tracking_number', p.tracking_number, 'status', p.status,
    'service', p.module, 'weight_kg', p.weight_kg, 'declared_value', p.declared_value, 'currency', p.currency,
    'picked_up_at', p.picked_up_at, 'delivered_at', p.delivered_at, 'created_at', p.created_at,
    'events', coalesce((SELECT jsonb_agg(jsonb_build_object('event_type', e.event_type, 'occurred_at', e.occurred_at)
        ORDER BY e.occurred_at) FROM public.package_events e WHERE e.package_id = p.id), '[]'::jsonb))
  INTO v FROM public.packages p WHERE p.id = _package_id;
  RETURN v;
END; $$;

REVOKE ALL ON FUNCTION public.logistics_api_route(uuid,public.partner_api_environment,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.logistics_api_package(uuid,public.partner_api_environment,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.logistics_api_route(uuid,public.partner_api_environment,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.logistics_api_package(uuid,public.partner_api_environment,uuid) TO service_role;