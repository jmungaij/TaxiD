CREATE OR REPLACE FUNCTION public.ct_search(_q text, _limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_q text := nullif(trim(coalesce(_q,'')),''); v_lim int := least(greatest(coalesce(_limit,20),1),50);
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.control_tower.read') THEN
    RETURN public.ct_denied('staff.logistics.control_tower.read','ct_search');
  END IF;
  IF v_q IS NULL OR length(v_q) < 2 THEN
    RETURN jsonb_build_object('ok', true, 'results','[]'::jsonb, 'query', _q);
  END IF;
  RETURN jsonb_build_object('ok', true, 'query', v_q, 'results', (
    SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM (
      (SELECT 'package'::text AS kind, p.id, p.tracking_number::text AS reference, p.status::text AS status, p.created_at
         FROM public.packages p WHERE p.tracking_number ILIKE '%'||v_q||'%' LIMIT v_lim)
      UNION ALL
      (SELECT 'route', r.id, r.route_number::text, r.status::text, r.created_at FROM public.logistics_routes r
         WHERE r.route_number ILIKE '%'||v_q||'%' LIMIT v_lim)
      UNION ALL
      (SELECT 'manifest', m.id, m.manifest_number::text, m.status::text, m.created_at FROM public.logistics_manifests m
         WHERE m.manifest_number ILIKE '%'||v_q||'%' LIMIT v_lim)
      UNION ALL
      (SELECT 'exception', e.id, e.exception_number::text, e.status::text, e.created_at FROM public.logistics_exceptions e
         WHERE e.exception_number ILIKE '%'||v_q||'%' LIMIT v_lim)
      UNION ALL
      (SELECT 'return', rr.id, rr.return_number::text, coalesce(rr.movement_status, rr.status)::text, rr.created_at
         FROM public.package_returns rr WHERE rr.return_number ILIKE '%'||v_q||'%' LIMIT v_lim)
      UNION ALL
      (SELECT 'hub', h.id, (h.code || ' — ' || h.name)::text, h.status::text, h.created_at FROM public.logistics_hubs h
         WHERE h.code ILIKE '%'||v_q||'%' OR h.name ILIKE '%'||v_q||'%' LIMIT v_lim)
      UNION ALL
      (SELECT 'vehicle', v.id, coalesce(v.number_plate, v.vehicle_code)::text, v.vehicle_status::text, v.created_at
         FROM public.vehicles v WHERE v.number_plate ILIKE '%'||v_q||'%' OR v.vehicle_code ILIKE '%'||v_q||'%' LIMIT v_lim)
      UNION ALL
      (SELECT 'carrier', c.id, (coalesce(c.carrier_code,'') || ' — ' || c.legal_entity_name)::text,
              c.operating_status::text, c.created_at FROM public.carrier_profiles c
         WHERE c.legal_entity_name ILIKE '%'||v_q||'%' OR c.carrier_code ILIKE '%'||v_q||'%' LIMIT v_lim)
      UNION ALL
      (SELECT 'alert', a.id, a.alert_number::text, a.status::text, a.created_at FROM public.control_tower_alerts a
         WHERE a.alert_number ILIKE '%'||v_q||'%' LIMIT v_lim)
    ) r));
END; $$;

DO $$
DECLARE s text := (SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                    WHERE n.nspname='public' AND p.proname='ct_search');
BEGIN
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', s);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', s);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', s);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', s);
END $$;