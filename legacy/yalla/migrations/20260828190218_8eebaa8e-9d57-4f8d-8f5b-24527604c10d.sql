CREATE OR REPLACE FUNCTION public.ct_warehouse_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.control_tower.read') THEN
    RETURN public.ct_denied('staff.logistics.control_tower.read','ct_warehouse_snapshot');
  END IF;
  RETURN jsonb_build_object('ok', true, 'measured_at', now(),
    'backlogs', jsonb_build_object(
      'receiving',  (SELECT count(*) FROM public.logistics_receiving_sessions WHERE upper(coalesce(status,'OPEN')) NOT IN ('RECONCILED','CLOSED','COMPLETED')),
      'pick',       (SELECT count(*) FROM public.logistics_pick_lists WHERE upper(coalesce(status,'OPEN')) NOT IN ('COMPLETED','CANCELLED')),
      -- pack units carry no lifecycle column: an unpacked unit is the backlog.
      'pack',       (SELECT count(*) FROM public.logistics_pack_units WHERE packed_at IS NULL),
      'returns',    (SELECT count(*) FROM public.logistics_return_receipts WHERE received_at > now() - interval '7 days'),
      'staged',     (SELECT count(*) FROM public.logistics_hub_package_stage WHERE upper(coalesce(stage,'')) NOT IN ('DEPARTED','DELIVERED'))),
    'operations_24h', (SELECT coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) FROM (
      SELECT operation_type, count(*) AS events, max(occurred_at) AS last_at
        FROM public.logistics_wh_operations WHERE occurred_at > now() - interval '24 hours'
       GROUP BY operation_type ORDER BY 2 DESC) o),
    'dock_activity_24h', (SELECT count(*) FROM public.logistics_gate_events WHERE occurred_at > now() - interval '24 hours'));
END; $$;

DO $$
DECLARE s text := (SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                    WHERE n.nspname='public' AND p.proname='ct_warehouse_snapshot');
BEGIN
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', s);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', s);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', s);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', s);
END $$;