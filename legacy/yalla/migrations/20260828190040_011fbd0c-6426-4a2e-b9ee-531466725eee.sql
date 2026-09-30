-- Fix 1: enum-safe availability comparison in the board snapshot.
CREATE OR REPLACE FUNCTION public.ct_board_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; v_util numeric; v_stale numeric;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.control_tower.read') THEN
    RETURN public.ct_denied('staff.logistics.control_tower.read','ct_board_snapshot');
  END IF;
  v_util := public.ct_setting_num('capacity_utilisation_pct', 95);
  v_stale := public.ct_setting_num('driver_stale_minutes', 45);

  WITH pol AS (SELECT * FROM public.ct_policy_for(NULL)),
  pk AS (
    SELECT p.id, p.status, p.module, p.assigned_driver_id, p.created_at, p.delivered_at,
           coalesce(j.sla_deadline, p.created_at + make_interval(mins => (SELECT target_minutes FROM pol))) AS deadline
      FROM public.packages p
      LEFT JOIN public.delivery_dispatch_jobs j ON j.package_id = p.id
     WHERE p.status NOT IN ('delivered','cancelled','returned')
  ),
  sla AS (
    SELECT public.ct_sla_state(deadline, NULL, created_at,
             (SELECT warn_pct FROM pol), (SELECT crit_pct FROM pol), (SELECT grace_min FROM pol)) AS s
      FROM pk
  )
  SELECT jsonb_build_object(
    'ok', true,
    'measured_at', now(),
    'policy_scope', (SELECT policy_scope FROM pol),
    'counters', jsonb_build_object(
      'active_packages',      (SELECT count(*) FROM pk),
      'active_orders',        (SELECT count(DISTINCT order_id) FROM public.packages WHERE status NOT IN ('delivered','cancelled','returned')),
      'active_dispatch_jobs', (SELECT count(*) FROM public.delivery_dispatch_jobs WHERE lower(status) NOT IN ('completed','cancelled','failed')),
      'active_routes',        (SELECT count(*) FROM public.logistics_routes WHERE upper(status) NOT IN ('COMPLETED','CANCELLED','CLOSED')),
      'active_stops',         (SELECT count(*) FROM public.logistics_route_stops WHERE upper(status) NOT IN ('COMPLETED','FAILED','CANCELLED','SKIPPED')),
      'active_manifests',     (SELECT count(*) FROM public.logistics_manifests WHERE upper(status) NOT IN ('RECONCILED','CLOSED','CANCELLED')),
      'active_drivers',       (SELECT count(*) FROM public.driver_locations WHERE is_online AND updated_at > now() - make_interval(mins => v_stale::int)),
      'active_vehicles',      (SELECT count(DISTINCT vehicle_id) FROM public.driver_locations WHERE is_online AND vehicle_id IS NOT NULL AND updated_at > now() - make_interval(mins => v_stale::int)),
      'hub_operations_24h',   (SELECT count(*) FROM public.logistics_wh_operations WHERE occurred_at > now() - interval '24 hours'),
      'open_exceptions',      (SELECT count(*) FROM public.logistics_exceptions WHERE upper(status) NOT IN ('RESOLVED','CLOSED','CANCELLED')),
      'failed_deliveries_24h',(SELECT count(*) FROM public.logistics_delivery_attempts WHERE lower(outcome) <> 'delivered' AND occurred_at > now() - interval '24 hours'),
      'pod_pending',          (SELECT count(*) FROM public.packages p WHERE p.status = 'delivered'
                                 AND NOT EXISTS (SELECT 1 FROM public.logistics_pod_records r WHERE r.package_id = p.id AND r.superseded_by_pod_id IS NULL)),
      'open_returns',         (SELECT count(*) FROM public.package_returns WHERE coalesce(resolution_state,'open') NOT IN ('RESOLVED','resolved','CLOSED','closed')),
      'open_deviations',      (SELECT count(*) FROM public.logistics_route_deviations WHERE upper(coalesce(status,'OPEN')) NOT IN ('RESOLVED','CLOSED')),
      'sla_at_risk',          (SELECT count(*) FROM sla WHERE s IN ('AMBER','RED')),
      'sla_breached',         (SELECT count(*) FROM sla WHERE s = 'BREACHED'),
      'capacity_constrained', (SELECT count(*) FROM public.carrier_capacity_slots
                                WHERE effective_until >= now()
                                  AND (upper(coalesce(availability_status::text,'')) IN ('OVERBOOKED','CONSTRAINED')
                                    OR (offered_kg > 0 AND 100.0*(coalesce(reserved_kg,0)+coalesce(committed_kg,0))/offered_kg >= v_util))),
      'warehouse_backlog',    (SELECT count(*) FROM public.logistics_pick_lists WHERE upper(coalesce(status,'OPEN')) NOT IN ('COMPLETED','CANCELLED')),
      'recon_exceptions',     (SELECT count(*) FROM public.freight_recon_exceptions WHERE upper(coalesce(state::text,'OPEN')) NOT IN ('RESOLVED','CLOSED')),
      'open_alerts',          (SELECT count(*) FROM public.control_tower_alerts WHERE status NOT IN ('RESOLVED','CLOSED')),
      'offline_conflicts',    (SELECT count(*) FROM public.logistics_offline_commands WHERE state::text = 'CONFLICT')
    )) INTO v;
  RETURN v;
END; $$;

-- Fix 2: enum-safe availability state in the capacity snapshot.
CREATE OR REPLACE FUNCTION public.ct_capacity_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_util numeric;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.control_tower.read') THEN
    RETURN public.ct_denied('staff.logistics.control_tower.read','ct_capacity_snapshot');
  END IF;
  v_util := public.ct_setting_num('capacity_utilisation_pct', 95);
  RETURN jsonb_build_object('ok', true, 'measured_at', now(), 'threshold_pct', v_util,
    'carrier_slots', (SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM (
      SELECT s.id, s.slot_reference, c.legal_entity_name AS carrier, s.corridor, s.vehicle_type,
             s.offered_kg, s.reserved_kg, s.committed_kg, s.consumed_kg,
             greatest(coalesce(s.offered_kg,0) - coalesce(s.reserved_kg,0) - coalesce(s.committed_kg,0), 0) AS remaining_kg,
             CASE WHEN coalesce(s.offered_kg,0) = 0 THEN NULL
                  ELSE round(100.0*(coalesce(s.reserved_kg,0)+coalesce(s.committed_kg,0))/s.offered_kg, 1) END AS utilisation_pct,
             CASE WHEN coalesce(s.reserved_kg,0)+coalesce(s.committed_kg,0) > coalesce(s.offered_kg,0) THEN 'OVERBOOKED'
                  WHEN coalesce(s.offered_kg,0) > 0 AND 100.0*(coalesce(s.reserved_kg,0)+coalesce(s.committed_kg,0))/s.offered_kg >= v_util THEN 'CONSTRAINED'
                  ELSE coalesce(s.availability_status::text,'AVAILABLE') END AS state,
             s.effective_from, s.effective_until
        FROM public.carrier_capacity_slots s
        LEFT JOIN public.carrier_profiles c ON c.id = s.carrier_id
       WHERE s.effective_until >= now()
       ORDER BY 11 DESC NULLS LAST LIMIT 100) x),
    'hubs', (SELECT coalesce(jsonb_agg(to_jsonb(h)),'[]'::jsonb) FROM (
      SELECT id, code, name, city, capacity_unit, max_capacity, current_capacity,
             CASE WHEN coalesce(max_capacity,0) > 0 THEN round(100.0*coalesce(current_capacity,0)/max_capacity,1) END AS utilisation_pct
        FROM public.logistics_hubs WHERE active ORDER BY 8 DESC NULLS LAST LIMIT 50) h),
    'reservations', (SELECT jsonb_build_object(
        'active', count(*) FILTER (WHERE upper(state::text) IN ('RESERVED','CONFIRMED')),
        'expiring_24h', count(*) FILTER (WHERE expires_at BETWEEN now() AND now() + interval '24 hours'))
      FROM public.capacity_reservations));
END; $$;

-- Fix 3: the shipments lens must read its count and its rows from the same
-- filtered CTE chain (a WITH clause only binds to one statement).
CREATE OR REPLACE FUNCTION public.ct_board_rows(_lens text, _limit integer DEFAULT 50, _offset integer DEFAULT 0,
                                                _state text DEFAULT NULL, _module text DEFAULT NULL, _search text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows jsonb; v_total bigint; v_lim int := least(greatest(coalesce(_limit,50),1),200); v_off int := greatest(coalesce(_offset,0),0);
        v_t int; v_w numeric; v_c numeric; v_g int; v_so int; v_q text := nullif(trim(coalesce(_search,'')),'');
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.control_tower.read') THEN
    RETURN public.ct_denied('staff.logistics.control_tower.read','ct_board_rows');
  END IF;
  SELECT target_minutes, warn_pct, crit_pct, grace_min, stop_overdue_min
    INTO v_t, v_w, v_c, v_g, v_so FROM public.ct_policy_for(_module);

  IF _lens = 'packages' THEN
    WITH base AS (
      SELECT p.id, p.tracking_number, p.status, p.module, p.assigned_driver_id, p.created_at, p.delivered_at,
             p.dropoff_address, p.recipient_name,
             coalesce(j.sla_deadline, p.created_at + make_interval(mins => v_t)) AS deadline,
             EXISTS (SELECT 1 FROM public.logistics_exceptions e WHERE e.package_id = p.id AND upper(e.status) NOT IN ('RESOLVED','CLOSED','CANCELLED')) AS has_exception,
             (p.status = 'delivered' AND NOT EXISTS (SELECT 1 FROM public.logistics_pod_records r WHERE r.package_id = p.id AND r.superseded_by_pod_id IS NULL)) AS pod_pending,
             EXISTS (SELECT 1 FROM public.package_returns rr WHERE rr.package_id = p.id AND coalesce(rr.resolution_state,'open') NOT IN ('RESOLVED','resolved','CLOSED','closed')) AS return_open
        FROM public.packages p
        LEFT JOIN public.delivery_dispatch_jobs j ON j.package_id = p.id
       WHERE p.status <> 'cancelled'
         AND (_module IS NULL OR p.module = _module)
         AND (v_q IS NULL OR p.tracking_number ILIKE '%'||v_q||'%' OR p.recipient_name ILIKE '%'||v_q||'%')
    ), scored AS (
      SELECT b.*, public.ct_sla_state(b.deadline, b.delivered_at, b.created_at, v_w, v_c, v_g) AS sla_state FROM base b
    ), final AS (
      SELECT s.*, public.ct_operational_state(s.sla_state, s.has_exception, s.pod_pending, s.return_open,
               s.assigned_driver_id, false, false) AS op_state FROM scored s
    ), filtered AS (
      SELECT * FROM final WHERE (_state IS NULL OR op_state = _state)
    )
    SELECT (SELECT count(*) FROM filtered),
           (SELECT coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) FROM (
              SELECT id, tracking_number AS reference, status, module, assigned_driver_id, created_at, delivered_at,
                     deadline, sla_state, op_state, dropoff_address AS location, recipient_name AS party,
                     round(extract(epoch FROM (deadline - now()))/60)::int AS minutes_remaining
                FROM filtered
               ORDER BY CASE op_state WHEN 'EXCEPTION' THEN 1 WHEN 'DELAYED' THEN 2 WHEN 'AT_RISK' THEN 3 ELSE 4 END,
                        deadline NULLS LAST
               LIMIT v_lim OFFSET v_off) x)
      INTO v_total, v_rows;

  ELSIF _lens = 'exceptions' THEN
    SELECT count(*) INTO v_total FROM public.logistics_exceptions e
      WHERE upper(e.status) NOT IN ('RESOLVED','CLOSED','CANCELLED')
        AND (v_q IS NULL OR e.exception_number ILIKE '%'||v_q||'%');
    SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_rows FROM (
      SELECT e.id, e.exception_number AS reference, e.kind AS status, e.severity, e.owner_role, e.reason_code,
             e.narrative, e.package_id, e.order_id, e.sla_due_at AS deadline, e.created_at,
             public.ct_sla_state(e.sla_due_at, e.resolved_at, e.created_at, v_w, v_c, v_g) AS sla_state,
             'EXCEPTION'::text AS op_state, p.tracking_number AS party
        FROM public.logistics_exceptions e
        LEFT JOIN public.packages p ON p.id = e.package_id
       WHERE upper(e.status) NOT IN ('RESOLVED','CLOSED','CANCELLED')
         AND (v_q IS NULL OR e.exception_number ILIKE '%'||v_q||'%')
       ORDER BY CASE lower(e.severity) WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END, e.sla_due_at NULLS LAST
       LIMIT v_lim OFFSET v_off) x;

  ELSIF _lens = 'routes' THEN
    SELECT count(*) INTO v_total FROM public.logistics_routes r WHERE upper(r.status) NOT IN ('COMPLETED','CANCELLED','CLOSED');
    SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_rows FROM (
      SELECT r.id, r.route_number AS reference, r.status, r.route_type AS module, r.driver_user_id AS assigned_driver_id,
             r.vehicle_id, r.planned_start AS created_at, r.planned_end AS deadline, r.actual_end AS delivered_at,
             public.ct_sla_state(r.planned_end, r.actual_end, r.planned_start, v_w, v_c, v_g) AS sla_state,
             public.ct_operational_state(public.ct_sla_state(r.planned_end, r.actual_end, r.planned_start, v_w, v_c, v_g),
               EXISTS (SELECT 1 FROM public.logistics_route_deviations d WHERE d.route_id = r.id AND upper(coalesce(d.status,'OPEN')) NOT IN ('RESOLVED','CLOSED')),
               false, false, r.driver_user_id, false, false) AS op_state,
             (SELECT count(*) FROM public.logistics_route_stops s WHERE s.route_id = r.id) AS stop_count
        FROM public.logistics_routes r
       WHERE upper(r.status) NOT IN ('COMPLETED','CANCELLED','CLOSED')
       ORDER BY r.planned_start NULLS LAST
       LIMIT v_lim OFFSET v_off) x;

  ELSIF _lens = 'stops' THEN
    SELECT count(*) INTO v_total FROM public.logistics_route_stops s WHERE upper(s.status) NOT IN ('COMPLETED','FAILED','CANCELLED','SKIPPED');
    SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_rows FROM (
      SELECT s.id, r.route_number || ' #' || s.sequence AS reference, s.status, s.stop_type AS module,
             s.address AS location, coalesce(s.eta, s.planned_arrival) AS deadline, s.created_at, s.actual_arrival AS delivered_at,
             public.ct_sla_state(coalesce(s.service_window_end, s.planned_arrival), s.actual_arrival, s.created_at, v_w, v_c, v_g) AS sla_state,
             CASE WHEN s.actual_arrival IS NULL AND coalesce(s.planned_arrival, s.service_window_end) < now() - make_interval(mins => v_so)
                  THEN 'DELAYED' ELSE 'ON_TRACK' END AS op_state,
             s.route_id
        FROM public.logistics_route_stops s
        JOIN public.logistics_routes r ON r.id = s.route_id
       WHERE upper(s.status) NOT IN ('COMPLETED','FAILED','CANCELLED','SKIPPED')
       ORDER BY coalesce(s.planned_arrival, s.eta) NULLS LAST
       LIMIT v_lim OFFSET v_off) x;

  ELSIF _lens = 'pod_pending' THEN
    SELECT count(*) INTO v_total FROM public.packages p WHERE p.status='delivered'
      AND NOT EXISTS (SELECT 1 FROM public.logistics_pod_records r WHERE r.package_id=p.id AND r.superseded_by_pod_id IS NULL);
    SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_rows FROM (
      SELECT p.id, p.tracking_number AS reference, p.status, p.module, p.assigned_driver_id, p.delivered_at,
             p.created_at, p.delivered_at AS deadline, 'UNKNOWN'::text AS sla_state, 'POD_PENDING'::text AS op_state,
             p.dropoff_address AS location, p.recipient_name AS party
        FROM public.packages p
       WHERE p.status='delivered'
         AND NOT EXISTS (SELECT 1 FROM public.logistics_pod_records r WHERE r.package_id=p.id AND r.superseded_by_pod_id IS NULL)
       ORDER BY p.delivered_at DESC NULLS LAST LIMIT v_lim OFFSET v_off) x;

  ELSIF _lens = 'returns' THEN
    SELECT count(*) INTO v_total FROM public.package_returns WHERE coalesce(resolution_state,'open') NOT IN ('RESOLVED','resolved','CLOSED','closed');
    SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_rows FROM (
      SELECT rr.id, rr.return_number AS reference, coalesce(rr.movement_status, rr.status) AS status, rr.reason_code,
             rr.package_id, rr.created_at, NULL::timestamptz AS deadline, 'UNKNOWN'::text AS sla_state,
             'RETURN_REQUIRED'::text AS op_state, p.tracking_number AS party, rr.disposition
        FROM public.package_returns rr
        LEFT JOIN public.packages p ON p.id = rr.package_id
       WHERE coalesce(rr.resolution_state,'open') NOT IN ('RESOLVED','resolved','CLOSED','closed')
       ORDER BY rr.created_at DESC LIMIT v_lim OFFSET v_off) x;

  ELSIF _lens = 'dispatch' THEN
    SELECT count(*) INTO v_total FROM public.delivery_dispatch_jobs WHERE lower(status) NOT IN ('completed','cancelled');
    SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_rows FROM (
      SELECT j.id, coalesce(p.tracking_number, j.id::text) AS reference, j.status, j.module, j.assigned_driver_id,
             j.created_at, j.sla_deadline AS deadline, j.attempts,
             public.ct_sla_state(j.sla_deadline, NULL, j.created_at, v_w, v_c, v_g) AS sla_state,
             public.ct_operational_state(public.ct_sla_state(j.sla_deadline, NULL, j.created_at, v_w, v_c, v_g),
               false,false,false, j.assigned_driver_id, false, false) AS op_state,
             j.package_id
        FROM public.delivery_dispatch_jobs j
        LEFT JOIN public.packages p ON p.id = j.package_id
       WHERE lower(j.status) NOT IN ('completed','cancelled')
       ORDER BY j.sla_deadline NULLS LAST LIMIT v_lim OFFSET v_off) x;

  ELSE
    RETURN jsonb_build_object('ok', false, 'code','UNKNOWN_LENS','category','validation','retryable',false,
      'message','Unknown Control Tower lens.', 'reason', coalesce(_lens,'(null)'));
  END IF;

  RETURN jsonb_build_object('ok', true, 'lens', _lens, 'total', v_total, 'limit', v_lim, 'offset', v_off,
                            'measured_at', now(), 'rows', v_rows);
END; $$;

DO $$
DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure::text AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname IN ('ct_board_snapshot','ct_board_rows','ct_capacity_snapshot')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END $$;