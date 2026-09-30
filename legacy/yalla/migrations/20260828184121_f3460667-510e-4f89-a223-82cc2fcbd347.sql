-- ============================================================
-- PHASE 9 — CONTROL TOWER + REAL-TIME OPERATIONAL INTELLIGENCE
-- Consumes the authoritative logistics spine. No parallel authorities.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.ct_alert_status AS ENUM
    ('CREATED','ACKNOWLEDGED','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------
-- 1. OWNER CONFIGURATION — SLA policies
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.control_tower_sla_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_kind text NOT NULL CHECK (scope_kind IN ('global','service','customer','contract')),
  scope_value text,
  label text NOT NULL,
  target_minutes integer NOT NULL CHECK (target_minutes > 0),
  warning_threshold_pct numeric NOT NULL DEFAULT 70 CHECK (warning_threshold_pct BETWEEN 1 AND 100),
  critical_threshold_pct numeric NOT NULL DEFAULT 90 CHECK (critical_threshold_pct BETWEEN 1 AND 100),
  breach_grace_minutes integer NOT NULL DEFAULT 0 CHECK (breach_grace_minutes >= 0),
  stop_overdue_minutes integer NOT NULL DEFAULT 30 CHECK (stop_overdue_minutes > 0),
  active boolean NOT NULL DEFAULT true,
  notes text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ct_sla_scope_value_required
    CHECK (scope_kind = 'global' OR scope_value IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS ct_sla_policy_scope_uniq
  ON public.control_tower_sla_policies (scope_kind, coalesce(scope_value,'*'));

GRANT SELECT ON public.control_tower_sla_policies TO authenticated;
GRANT ALL ON public.control_tower_sla_policies TO service_role;
ALTER TABLE public.control_tower_sla_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY ct_sla_read ON public.control_tower_sla_policies FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.control_tower.read'));

-- ---------------------------------------------------------------
-- 2. OWNER CONFIGURATION — alert rules
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.control_tower_alert_rules (
  rule_key text PRIMARY KEY,
  condition_kind text NOT NULL,
  label text NOT NULL,
  description text,
  severity text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  enabled boolean NOT NULL DEFAULT true,
  threshold_numeric numeric,
  window_minutes integer NOT NULL DEFAULT 60 CHECK (window_minutes > 0),
  owner_role text NOT NULL DEFAULT 'operations_admin',
  escalate_after_minutes integer,
  channels text[] NOT NULL DEFAULT ARRAY['control_tower']::text[],
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.control_tower_alert_rules TO authenticated;
GRANT ALL ON public.control_tower_alert_rules TO service_role;
ALTER TABLE public.control_tower_alert_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY ct_rules_read ON public.control_tower_alert_rules FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.control_tower.read'));

-- ---------------------------------------------------------------
-- 3. ALERTS + lifecycle history
-- ---------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.ct_alert_seq;

CREATE TABLE IF NOT EXISTS public.control_tower_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_number text NOT NULL UNIQUE DEFAULT 'CT-' || to_char(now(),'YYYYMM') || '-' || lpad(nextval('public.ct_alert_seq')::text, 6, '0'),
  rule_key text NOT NULL REFERENCES public.control_tower_alert_rules(rule_key),
  condition_kind text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  status public.ct_alert_status NOT NULL DEFAULT 'CREATED',
  entity_type text NOT NULL,
  entity_id uuid,
  entity_ref text,
  tenant_id uuid,
  reason text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_value numeric,
  threshold numeric,
  source_event_id uuid,
  correlation_id text NOT NULL DEFAULT gen_random_uuid()::text,
  dedupe_key text NOT NULL UNIQUE,
  owner_user_id uuid,
  occurrence_count integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  resolved_at timestamptz,
  resolved_by uuid,
  resolution text,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ct_alerts_open_idx ON public.control_tower_alerts (status, severity, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS ct_alerts_entity_idx ON public.control_tower_alerts (entity_type, entity_id);

GRANT SELECT ON public.control_tower_alerts TO authenticated;
GRANT ALL ON public.control_tower_alerts TO service_role;
ALTER TABLE public.control_tower_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY ct_alerts_read ON public.control_tower_alerts FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.control_tower.read'));

CREATE TABLE IF NOT EXISTS public.control_tower_alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid NOT NULL REFERENCES public.control_tower_alerts(id) ON DELETE CASCADE,
  action text NOT NULL,
  from_status public.ct_alert_status,
  to_status public.ct_alert_status,
  actor_id uuid,
  notes text,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ct_alert_events_alert_idx ON public.control_tower_alert_events (alert_id, created_at DESC);
GRANT SELECT ON public.control_tower_alert_events TO authenticated;
GRANT ALL ON public.control_tower_alert_events TO service_role;
ALTER TABLE public.control_tower_alert_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY ct_alert_events_read ON public.control_tower_alert_events FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.control_tower.read'));

CREATE OR REPLACE FUNCTION public._ct_alert_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'control_tower_alert_events is append-only';
END; $$;
DROP TRIGGER IF EXISTS ct_alert_events_immutable ON public.control_tower_alert_events;
CREATE TRIGGER ct_alert_events_immutable
  BEFORE UPDATE OR DELETE ON public.control_tower_alert_events
  FOR EACH ROW EXECUTE FUNCTION public._ct_alert_events_append_only();

-- ---------------------------------------------------------------
-- 4. OBSERVABILITY — operator command log
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.control_tower_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id text NOT NULL,
  correlation_id text NOT NULL,
  operation text NOT NULL,
  entity_type text,
  entity_id uuid,
  tenant_id uuid,
  actor_id uuid,
  permission_required text,
  outcome text NOT NULL CHECK (outcome IN ('APPLIED','REJECTED','FAILED')),
  error_code text,
  error_message text,
  latency_ms integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ct_commands_recent_idx ON public.control_tower_commands (created_at DESC);
GRANT SELECT ON public.control_tower_commands TO authenticated;
GRANT ALL ON public.control_tower_commands TO service_role;
ALTER TABLE public.control_tower_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY ct_commands_read ON public.control_tower_commands FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.control_tower.read'));

-- ---------------------------------------------------------------
-- 5. OWNER CONFIGURATION — settings
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.control_tower_settings (
  setting_key text PRIMARY KEY,
  label text NOT NULL,
  category text NOT NULL DEFAULT 'operations',
  value jsonb NOT NULL,
  state text NOT NULL DEFAULT 'SET' CHECK (state IN ('SET','OWNER_CONFIGURATION_REQUIRED')),
  guidance text,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.control_tower_settings TO authenticated;
GRANT ALL ON public.control_tower_settings TO service_role;
ALTER TABLE public.control_tower_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ct_settings_read ON public.control_tower_settings FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.control_tower.read'));

CREATE OR REPLACE FUNCTION public._ct_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS ct_sla_touch ON public.control_tower_sla_policies;
CREATE TRIGGER ct_sla_touch BEFORE UPDATE ON public.control_tower_sla_policies
  FOR EACH ROW EXECUTE FUNCTION public._ct_touch();
DROP TRIGGER IF EXISTS ct_rules_touch ON public.control_tower_alert_rules;
CREATE TRIGGER ct_rules_touch BEFORE UPDATE ON public.control_tower_alert_rules
  FOR EACH ROW EXECUTE FUNCTION public._ct_touch();
DROP TRIGGER IF EXISTS ct_alerts_touch ON public.control_tower_alerts;
CREATE TRIGGER ct_alerts_touch BEFORE UPDATE ON public.control_tower_alerts
  FOR EACH ROW EXECUTE FUNCTION public._ct_touch();
DROP TRIGGER IF EXISTS ct_settings_touch ON public.control_tower_settings;
CREATE TRIGGER ct_settings_touch BEFORE UPDATE ON public.control_tower_settings
  FOR EACH ROW EXECUTE FUNCTION public._ct_touch();

-- ---------------------------------------------------------------
-- 6. PERMISSIONS (no wildcard staff access)
-- ---------------------------------------------------------------
INSERT INTO public.staff_permissions (key, domain, action, description) VALUES
 ('staff.logistics.control_tower.read','logistics','control_tower.read','View the real-time logistics Control Tower and drill into operational records.'),
 ('staff.logistics.control_tower.manage','logistics','control_tower.manage','Execute Control Tower operator commands and manage alerts and thresholds.'),
 ('staff.logistics.finance.read','logistics','finance.read','View logistics financial exposure: charges, invoices, settlements and reconciliation.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.staff_role_permissions (role, permission_key)
SELECT r::public.app_role, k
FROM (VALUES
  ('staff.logistics.control_tower.read',  ARRAY['admin','operations_admin','dispatch_manager','director','general_manager','compliance_admin','finance_admin']),
  ('staff.logistics.control_tower.manage',ARRAY['admin','operations_admin','dispatch_manager']),
  ('staff.logistics.finance.read',        ARRAY['admin','finance_admin','director','general_manager'])
) AS t(k, roles), unnest(t.roles) AS r
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------
-- 7. SEED CONFIGURATION
-- ---------------------------------------------------------------
INSERT INTO public.control_tower_sla_policies (scope_kind, scope_value, label, target_minutes, warning_threshold_pct, critical_threshold_pct, breach_grace_minutes, stop_overdue_minutes, notes)
VALUES ('global', NULL, 'Platform default delivery SLA', 1440, 70, 90, 30, 30,
        'Owner-configurable default. Service, customer and contract policies override it.')
ON CONFLICT DO NOTHING;

INSERT INTO public.control_tower_alert_rules (rule_key, condition_kind, label, description, severity, threshold_numeric, window_minutes, owner_role)
VALUES
 ('sla_approaching_breach','SLA_APPROACHING_BREACH','SLA approaching breach','Active package has crossed the critical SLA threshold.','warning',NULL,60,'dispatch_manager'),
 ('sla_breached','SLA_BREACHED','SLA breached','Active package passed its SLA deadline plus grace.','critical',NULL,60,'operations_admin'),
 ('stop_overdue','STOP_OVERDUE','Stop overdue','Route stop is past its planned arrival window.','warning',NULL,60,'dispatch_manager'),
 ('failed_delivery_repeated','FAILED_DELIVERY_REPEATED','Repeated failed delivery','Package failed delivery more than once.','critical',2,1440,'operations_admin'),
 ('pod_missing','POD_MISSING','Proof of delivery missing','Package marked delivered without a POD record.','warning',60,1440,'operations_admin'),
 ('return_required','RETURN_REQUIRED','Return awaiting action','Authorised return has not been received or dispositioned.','warning',NULL,1440,'operations_admin'),
 ('route_deviation','ROUTE_DEVIATION','Route deviation open','Unresolved route deviation detected.','warning',NULL,240,'dispatch_manager'),
 ('capacity_exceeded','CAPACITY_EXCEEDED','Carrier capacity exceeded','Carrier slot is overbooked or fully constrained.','critical',95,1440,'operations_admin'),
 ('hub_congestion','HUB_CONGESTION','Hub congestion','Hub utilisation above the configured congestion threshold.','warning',85,1440,'operations_admin'),
 ('warehouse_backlog','WAREHOUSE_BACKLOG','Warehouse backlog','Open pick lists above the configured backlog threshold.','warning',25,1440,'operations_admin'),
 ('reconciliation_discrepancy','RECONCILIATION_DISCREPANCY','Reconciliation discrepancy','Open freight reconciliation exception.','critical',NULL,1440,'finance_admin'),
 ('settlement_exception','SETTLEMENT_EXCEPTION','Settlement exception','Carrier settlement variance requires review.','critical',NULL,1440,'finance_admin'),
 ('offline_sync_conflict','OFFLINE_SYNC_CONFLICT','Offline sync conflict','Field command in conflict awaiting resolution.','warning',NULL,1440,'operations_admin'),
 ('driver_unavailable','DRIVER_UNAVAILABLE','Assigned driver offline','Driver assigned to active work has not reported location recently.','warning',45,1440,'dispatch_manager')
ON CONFLICT (rule_key) DO NOTHING;

INSERT INTO public.control_tower_settings (setting_key, label, category, value, state, guidance) VALUES
 ('board_default_lens','Default operations lens','dashboard','"packages"','SET','Lens opened when the Control Tower loads.'),
 ('board_page_size','Board page size','dashboard','50','SET','Rows fetched per drill-down page.'),
 ('realtime_enabled','Event-driven updates','dashboard','true','SET','When enabled the board refreshes on canonical logistics events.'),
 ('fallback_refresh_seconds','Fallback refresh interval','dashboard','60','SET','Safety-net refresh used only if the event stream is unavailable.'),
 ('hub_congestion_pct','Hub congestion threshold (%)','capacity','85','SET','Utilisation above which a hub is reported congested.'),
 ('warehouse_backlog_units','Warehouse backlog threshold','capacity','25','SET','Open pick lists above which a warehouse backlog alert fires.'),
 ('capacity_utilisation_pct','Capacity constraint threshold (%)','capacity','95','SET','Carrier slot utilisation above which capacity is constrained.'),
 ('driver_stale_minutes','Driver telemetry staleness (minutes)','operations','45','SET','Minutes without telemetry before an assigned driver is treated as unavailable.'),
 ('operating_hours','Operating hours','operations','{"start":"06:00","end":"21:00","timezone":"Africa/Nairobi"}','SET','Used for overdue and escalation calculations.'),
 ('escalation_channels','Escalation channels','notifications','["control_tower"]','OWNER_CONFIGURATION_REQUIRED','Add email or SMS recipients to escalate Control Tower alerts outside the console.')
ON CONFLICT (setting_key) DO NOTHING;

-- ---------------------------------------------------------------
-- 8. DERIVATION HELPERS
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ct_setting_num(_key text, _fallback numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT (value #>> '{}')::numeric FROM public.control_tower_settings WHERE setting_key = _key), _fallback);
$$;

CREATE OR REPLACE FUNCTION public.ct_policy_for(_service text)
RETURNS TABLE(target_minutes integer, warn_pct numeric, crit_pct numeric, grace_min integer, stop_overdue_min integer, policy_scope text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT target_minutes, warning_threshold_pct, critical_threshold_pct, breach_grace_minutes,
         stop_overdue_minutes, scope_kind || coalesce(':' || scope_value, '')
    FROM public.control_tower_sla_policies
   WHERE active AND (scope_kind = 'global' OR (scope_kind = 'service' AND scope_value = _service))
   ORDER BY CASE scope_kind WHEN 'service' THEN 1 ELSE 2 END
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.ct_sla_state(_deadline timestamptz, _completed timestamptz, _started timestamptz,
                                               _warn numeric, _crit numeric, _grace integer)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _deadline IS NULL THEN 'UNKNOWN'
    WHEN _completed IS NOT NULL THEN CASE WHEN _completed <= _deadline THEN 'MET' ELSE 'BREACHED' END
    WHEN now() > _deadline + make_interval(mins => coalesce(_grace,0)) THEN 'BREACHED'
    WHEN now() > _deadline THEN 'RED'
    WHEN _started IS NULL OR _deadline <= _started THEN 'GREEN'
    WHEN 100.0 * extract(epoch FROM (now() - _started)) / nullif(extract(epoch FROM (_deadline - _started)),0) >= coalesce(_crit,90) THEN 'RED'
    WHEN 100.0 * extract(epoch FROM (now() - _started)) / nullif(extract(epoch FROM (_deadline - _started)),0) >= coalesce(_warn,70) THEN 'AMBER'
    ELSE 'GREEN' END;
$$;

CREATE OR REPLACE FUNCTION public.ct_operational_state(_sla text, _has_exception boolean, _pod_pending boolean,
                                                       _return_open boolean, _assigned uuid, _capacity_constrained boolean,
                                                       _compliance_blocked boolean)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN coalesce(_compliance_blocked,false) THEN 'COMPLIANCE_BLOCKED'
    WHEN coalesce(_has_exception,false) THEN 'EXCEPTION'
    WHEN coalesce(_return_open,false) THEN 'RETURN_REQUIRED'
    WHEN coalesce(_pod_pending,false) THEN 'POD_PENDING'
    WHEN _sla = 'BREACHED' THEN 'DELAYED'
    WHEN _sla = 'RED' THEN 'AT_RISK'
    WHEN coalesce(_capacity_constrained,false) THEN 'CAPACITY_CONSTRAINED'
    WHEN _sla = 'AMBER' THEN 'AT_RISK'
    WHEN _assigned IS NULL THEN 'AWAITING_ACTION'
    ELSE 'ON_TRACK' END;
$$;

CREATE OR REPLACE FUNCTION public.ct_denied(_perm text, _op text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'ok', false, 'code','AUTHORIZATION_DENIED', 'category','authorization',
    'retryable', false, 'severity','error', 'operation', _op,
    'reason', 'Missing permission ' || _perm,
    'message','You do not have permission to use this Control Tower capability.',
    'correlation_id', gen_random_uuid()::text, 'request_id', gen_random_uuid()::text,
    'timestamp', now());
$$;

-- ---------------------------------------------------------------
-- 9. OPERATIONS BOARD SNAPSHOT
-- ---------------------------------------------------------------
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
           j.sla_deadline AS job_deadline,
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
                                  AND (upper(coalesce(availability_status,'')) IN ('OVERBOOKED','CONSTRAINED')
                                    OR (offered_kg > 0 AND 100.0*(coalesce(reserved_kg,0)+coalesce(committed_kg,0))/offered_kg >= v_util))),
      'warehouse_backlog',    (SELECT count(*) FROM public.logistics_pick_lists WHERE upper(coalesce(status,'OPEN')) NOT IN ('COMPLETED','CANCELLED')),
      'recon_exceptions',     (SELECT count(*) FROM public.freight_recon_exceptions WHERE upper(coalesce(state,'OPEN')) NOT IN ('RESOLVED','CLOSED')),
      'open_alerts',          (SELECT count(*) FROM public.control_tower_alerts WHERE status NOT IN ('RESOLVED','CLOSED')),
      'offline_conflicts',    (SELECT count(*) FROM public.logistics_offline_commands WHERE state::text = 'CONFLICT')
    )) INTO v;
  RETURN v;
END; $$;

-- ---------------------------------------------------------------
-- 10. DRILL-DOWN ROWS
-- ---------------------------------------------------------------
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
       WHERE (p.status NOT IN ('cancelled') )
         AND (_module IS NULL OR p.module = _module)
         AND (v_q IS NULL OR p.tracking_number ILIKE '%'||v_q||'%' OR p.recipient_name ILIKE '%'||v_q||'%')
    ), scored AS (
      SELECT b.*, public.ct_sla_state(b.deadline, b.delivered_at, b.created_at, v_w, v_c, v_g) AS sla_state
        FROM base b
    ), final AS (
      SELECT s.*, public.ct_operational_state(s.sla_state, s.has_exception, s.pod_pending, s.return_open, s.assigned_driver_id, false, false) AS op_state
        FROM scored s
    )
    SELECT count(*) INTO v_total FROM final WHERE (_state IS NULL OR op_state = _state);
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.deadline NULLS LAST), '[]'::jsonb) INTO v_rows
      FROM (SELECT id, tracking_number AS reference, status, module, assigned_driver_id, created_at, delivered_at,
                   deadline, sla_state, op_state, dropoff_address AS location, recipient_name AS party,
                   round(extract(epoch FROM (deadline - now()))/60)::int AS minutes_remaining
              FROM final WHERE (_state IS NULL OR op_state = _state)
             ORDER BY CASE op_state WHEN 'EXCEPTION' THEN 1 WHEN 'DELAYED' THEN 2 WHEN 'AT_RISK' THEN 3 ELSE 4 END, deadline NULLS LAST
             LIMIT v_lim OFFSET v_off) x;

  ELSIF _lens = 'exceptions' THEN
    SELECT count(*) INTO v_total FROM public.logistics_exceptions e
      WHERE upper(e.status) NOT IN ('RESOLVED','CLOSED','CANCELLED')
        AND (v_q IS NULL OR e.exception_number ILIKE '%'||v_q||'%');
    SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) INTO v_rows FROM (
      SELECT e.id, e.exception_number AS reference, e.kind AS status, e.severity, e.owner_role, e.reason_code,
             e.narrative, e.package_id, e.order_id, e.attempt_id, e.sla_due_at AS deadline, e.created_at,
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

-- ---------------------------------------------------------------
-- 11. LIVE MAP
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ct_live_map(_city text DEFAULT NULL, _hub uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stale numeric;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.control_tower.read') THEN
    RETURN public.ct_denied('staff.logistics.control_tower.read','ct_live_map');
  END IF;
  v_stale := public.ct_setting_num('driver_stale_minutes', 45);
  RETURN jsonb_build_object(
    'ok', true, 'measured_at', now(),
    'drivers', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'driver_id', d.driver_id, 'vehicle_id', d.vehicle_id, 'lat', d.lat, 'lng', d.lng,
        'speed_kph', d.speed_kph, 'available', d.is_available, 'updated_at', d.updated_at)), '[]'::jsonb)
      FROM public.driver_locations d
      WHERE d.is_online AND d.updated_at > now() - make_interval(mins => v_stale::int) LIMIT 500),
    'hubs', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', h.id, 'code', h.code, 'name', h.name, 'city', h.city, 'lat', h.lat, 'lng', h.lng,
        'status', h.status, 'max_capacity', h.max_capacity, 'current_capacity', h.current_capacity)), '[]'::jsonb)
      FROM public.logistics_hubs h WHERE h.active AND (_city IS NULL OR h.city = _city) AND (_hub IS NULL OR h.id = _hub)),
    'stops', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'route_id', s.route_id, 'sequence', s.sequence, 'status', s.status,
        'lat', s.lat, 'lng', s.lng, 'eta', coalesce(s.eta, s.planned_arrival), 'type', s.stop_type)), '[]'::jsonb)
      FROM public.logistics_route_stops s
      WHERE upper(s.status) NOT IN ('COMPLETED','FAILED','CANCELLED','SKIPPED')
        AND s.lat IS NOT NULL AND (_hub IS NULL OR s.hub_id = _hub) LIMIT 500),
    'exceptions', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'reference', e.exception_number, 'severity', e.severity, 'kind', e.kind,
        'lat', p.dropoff_lat, 'lng', p.dropoff_lng, 'package_id', e.package_id)), '[]'::jsonb)
      FROM public.logistics_exceptions e JOIN public.packages p ON p.id = e.package_id
      WHERE upper(e.status) NOT IN ('RESOLVED','CLOSED','CANCELLED') AND p.dropoff_lat IS NOT NULL LIMIT 300),
    'deviations', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'route_id', d.route_id, 'kind', d.kind, 'severity', d.severity,
        'distance_m', d.distance_m, 'detected_at', d.detected_at)), '[]'::jsonb)
      FROM public.logistics_route_deviations d
      WHERE upper(coalesce(d.status,'OPEN')) NOT IN ('RESOLVED','CLOSED') LIMIT 200));
END; $$;

-- ---------------------------------------------------------------
-- 12. DOMAIN INTELLIGENCE SNAPSHOTS
-- ---------------------------------------------------------------
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
                  ELSE coalesce(s.availability_status,'AVAILABLE') END AS state,
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
      'pack',       (SELECT count(*) FROM public.logistics_pack_units WHERE upper(coalesce(status,'OPEN')) NOT IN ('DISPATCHED','CLOSED','COMPLETED')),
      'returns',    (SELECT count(*) FROM public.logistics_return_receipts WHERE received_at > now() - interval '7 days'),
      'staged',     (SELECT count(*) FROM public.logistics_hub_package_stage WHERE upper(coalesce(stage,'')) NOT IN ('DEPARTED','DELIVERED'))),
    'operations_24h', (SELECT coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) FROM (
      SELECT operation_type, count(*) AS events, max(occurred_at) AS last_at
        FROM public.logistics_wh_operations WHERE occurred_at > now() - interval '24 hours'
       GROUP BY operation_type ORDER BY 2 DESC) o),
    'dock_activity_24h', (SELECT count(*) FROM public.logistics_gate_events WHERE occurred_at > now() - interval '24 hours'));
END; $$;

CREATE OR REPLACE FUNCTION public.ct_carrier_snapshot(_limit integer DEFAULT 10)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.control_tower.read') THEN
    RETURN public.ct_denied('staff.logistics.control_tower.read','ct_carrier_snapshot');
  END IF;
  RETURN jsonb_build_object('ok', true, 'measured_at', now(),
    'carriers', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'carrier_id', c.id, 'name', c.legal_entity_name, 'code', c.carrier_code,
        'operating_status', c.operating_status, 'contract_status', c.contract_status,
        'active_bookings', (SELECT count(*) FROM public.freight_bookings b WHERE b.carrier_id = c.id AND upper(b.state::text) NOT IN ('COMPLETED','CANCELLED','FAILED')),
        'open_exceptions', (SELECT count(*) FROM public.freight_recon_exceptions x WHERE x.carrier_id = c.id AND upper(coalesce(x.state::text,'OPEN')) NOT IN ('RESOLVED','CLOSED')),
        'scorecard', public.carrier_scorecard(c.id))), '[]'::jsonb)
      FROM (SELECT * FROM public.carrier_profiles ORDER BY created_at DESC LIMIT least(greatest(coalesce(_limit,10),1),25)) c));
END; $$;

CREATE OR REPLACE FUNCTION public.ct_finance_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.has_staff_permission('staff.logistics.finance.read')
       OR public.has_staff_permission('staff.logistics.control_tower.manage')) THEN
    RETURN public.ct_denied('staff.logistics.finance.read','ct_finance_snapshot');
  END IF;
  RETURN jsonb_build_object('ok', true, 'measured_at', now(),
    'charges', (SELECT jsonb_build_object('open', count(*) FILTER (WHERE upper(status::text) NOT IN ('INVOICED','SETTLED','VOID')),
                                          'amount', coalesce(sum(amount) FILTER (WHERE voided_at IS NULL),0))
                  FROM public.freight_charges WHERE created_at > now() - interval '90 days'),
    'invoices', (SELECT jsonb_build_object('issued', count(*) FILTER (WHERE upper(status::text)='ISSUED'),
                                           'outstanding', coalesce(sum(total - coalesce(paid_total,0)) FILTER (WHERE upper(status::text)='ISSUED'),0),
                                           'overdue', count(*) FILTER (WHERE upper(status::text)='ISSUED' AND due_at < now()))
                  FROM public.freight_invoices),
    'settlements', (SELECT jsonb_build_object('pending', count(*) FILTER (WHERE upper(status::text) NOT IN ('PAID','REVERSED')),
                                              'variance', coalesce(sum(abs(coalesce(variance_amount,0))),0))
                  FROM public.freight_carrier_settlements),
    'reconciliation', (SELECT jsonb_build_object('open_exceptions', count(*) FILTER (WHERE upper(coalesce(state::text,'OPEN')) NOT IN ('RESOLVED','CLOSED')),
                                                 'variance', coalesce(sum(abs(coalesce(variance_amount,0))) FILTER (WHERE upper(coalesce(state::text,'OPEN')) NOT IN ('RESOLVED','CLOSED')),0))
                  FROM public.freight_recon_exceptions),
    'payments', (SELECT jsonb_build_object('allocated', count(*) FILTER (WHERE upper(coalesce(state::text,''))='ALLOCATED'),
                                           'unmatched', count(*) FILTER (WHERE unmatched_reason IS NOT NULL))
                  FROM public.freight_payment_allocations));
END; $$;

CREATE OR REPLACE FUNCTION public.ct_offline_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.control_tower.read') THEN
    RETURN public.ct_denied('staff.logistics.control_tower.read','ct_offline_snapshot');
  END IF;
  RETURN jsonb_build_object('ok', true, 'measured_at', now(),
    'devices', (SELECT jsonb_build_object(
        'total', count(*), 'active', count(*) FILTER (WHERE state::text = 'ACTIVE'),
        'suspended', count(*) FILTER (WHERE state::text = 'SUSPENDED'),
        'stale', count(*) FILTER (WHERE last_seen_at < now() - interval '24 hours'),
        'max_clock_skew_ms', max(abs(coalesce(last_clock_skew_ms,0))))
      FROM public.logistics_devices),
    'queue', (SELECT jsonb_build_object(
        'queued', count(*) FILTER (WHERE state::text IN ('RECEIVED','RETRY')),
        'failed', count(*) FILTER (WHERE state::text = 'FAILED'),
        'conflicts', count(*) FILTER (WHERE state::text = 'CONFLICT'),
        'applied_24h', count(*) FILTER (WHERE state::text = 'APPLIED' AND server_applied_at > now() - interval '24 hours'),
        'oldest_pending_at', min(server_received_at) FILTER (WHERE state::text IN ('RECEIVED','RETRY','CONFLICT')))
      FROM public.logistics_offline_commands));
END; $$;

-- ---------------------------------------------------------------
-- 13. GLOBAL OPERATIONAL SEARCH
-- ---------------------------------------------------------------
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
      (SELECT 'package'::text AS kind, p.id, p.tracking_number AS reference, p.status, p.created_at
        FROM public.packages p WHERE p.tracking_number ILIKE '%'||v_q||'%' LIMIT v_lim)
      UNION ALL
      (SELECT 'route', r.id, r.route_number, r.status, r.created_at FROM public.logistics_routes r
        WHERE r.route_number ILIKE '%'||v_q||'%' LIMIT v_lim)
      UNION ALL
      (SELECT 'manifest', m.id, m.manifest_number, m.status, m.created_at FROM public.logistics_manifests m
        WHERE m.manifest_number ILIKE '%'||v_q||'%' LIMIT v_lim)
      UNION ALL
      (SELECT 'exception', e.id, e.exception_number, e.status, e.created_at FROM public.logistics_exceptions e
        WHERE e.exception_number ILIKE '%'||v_q||'%' LIMIT v_lim)
      UNION ALL
      (SELECT 'return', rr.id, rr.return_number, coalesce(rr.movement_status, rr.status), rr.created_at FROM public.package_returns rr
        WHERE rr.return_number ILIKE '%'||v_q||'%' LIMIT v_lim)
      UNION ALL
      (SELECT 'hub', h.id, h.code || ' — ' || h.name, h.status, h.created_at FROM public.logistics_hubs h
        WHERE h.code ILIKE '%'||v_q||'%' OR h.name ILIKE '%'||v_q||'%' LIMIT v_lim)
      UNION ALL
      (SELECT 'vehicle', v.id, coalesce(v.number_plate, v.vehicle_code), v.vehicle_status, v.created_at FROM public.vehicles v
        WHERE v.number_plate ILIKE '%'||v_q||'%' OR v.vehicle_code ILIKE '%'||v_q||'%' LIMIT v_lim)
      UNION ALL
      (SELECT 'carrier', c.id, coalesce(c.carrier_code,'') || ' — ' || c.legal_entity_name, c.operating_status::text, c.created_at
        FROM public.carrier_profiles c
        WHERE c.legal_entity_name ILIKE '%'||v_q||'%' OR c.carrier_code ILIKE '%'||v_q||'%' LIMIT v_lim)
      UNION ALL
      (SELECT 'alert', a.id, a.alert_number, a.status::text, a.created_at FROM public.control_tower_alerts a
        WHERE a.alert_number ILIKE '%'||v_q||'%' LIMIT v_lim)
    ) r));
END; $$;

-- ---------------------------------------------------------------
-- 14. ALERT ENGINE
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ct_alert_raise(_rule_key text, _entity_type text, _entity_id uuid, _entity_ref text,
                                                 _reason text, _detail jsonb DEFAULT '{}'::jsonb,
                                                 _observed numeric DEFAULT NULL, _cycle text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rule public.control_tower_alert_rules; v_id uuid; v_key text;
BEGIN
  SELECT * INTO v_rule FROM public.control_tower_alert_rules WHERE rule_key = _rule_key AND enabled;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_key := _rule_key || ':' || coalesce(_entity_id::text, coalesce(_entity_ref,'-')) || ':'
           || coalesce(_cycle, to_char(now() AT TIME ZONE 'Africa/Nairobi','YYYYMMDD'));

  INSERT INTO public.control_tower_alerts (rule_key, condition_kind, severity, entity_type, entity_id, entity_ref,
                                           reason, detail, observed_value, threshold, dedupe_key)
  VALUES (v_rule.rule_key, v_rule.condition_kind, v_rule.severity, _entity_type, _entity_id, _entity_ref,
          _reason, coalesce(_detail,'{}'::jsonb), _observed, v_rule.threshold_numeric, v_key)
  ON CONFLICT (dedupe_key) DO UPDATE
    SET last_seen_at = now(), occurrence_count = public.control_tower_alerts.occurrence_count + 1,
        observed_value = coalesce(EXCLUDED.observed_value, public.control_tower_alerts.observed_value)
  RETURNING id INTO v_id;

  IF NOT EXISTS (SELECT 1 FROM public.control_tower_alert_events WHERE alert_id = v_id AND action = 'RAISED') THEN
    INSERT INTO public.control_tower_alert_events (alert_id, action, to_status, notes)
    VALUES (v_id, 'RAISED', 'CREATED', _reason);
  END IF;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.ct_alert_scan()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_raised int := 0; r record; v_t int; v_w numeric; v_c numeric; v_g int; v_so int;
        v_util numeric; v_backlog numeric; v_congestion numeric; v_stale numeric;
BEGIN
  IF NOT (public.has_staff_permission('staff.logistics.control_tower.read')) THEN
    RETURN public.ct_denied('staff.logistics.control_tower.read','ct_alert_scan');
  END IF;
  SELECT target_minutes, warn_pct, crit_pct, grace_min, stop_overdue_min INTO v_t, v_w, v_c, v_g, v_so
    FROM public.ct_policy_for(NULL);
  v_util := public.ct_setting_num('capacity_utilisation_pct', 95);
  v_backlog := public.ct_setting_num('warehouse_backlog_units', 25);
  v_congestion := public.ct_setting_num('hub_congestion_pct', 85);
  v_stale := public.ct_setting_num('driver_stale_minutes', 45);

  -- SLA risk / breach on active packages
  FOR r IN
    SELECT p.id, p.tracking_number,
           coalesce(j.sla_deadline, p.created_at + make_interval(mins => v_t)) AS deadline, p.created_at
      FROM public.packages p LEFT JOIN public.delivery_dispatch_jobs j ON j.package_id = p.id
     WHERE p.status NOT IN ('delivered','cancelled','returned') LIMIT 2000
  LOOP
    IF public.ct_sla_state(r.deadline, NULL, r.created_at, v_w, v_c, v_g) = 'BREACHED' THEN
      PERFORM public.ct_alert_raise('sla_breached','package', r.id, r.tracking_number,
        'SLA deadline passed for ' || r.tracking_number,
        jsonb_build_object('deadline', r.deadline), NULL);
      v_raised := v_raised + 1;
    ELSIF public.ct_sla_state(r.deadline, NULL, r.created_at, v_w, v_c, v_g) = 'RED' THEN
      PERFORM public.ct_alert_raise('sla_approaching_breach','package', r.id, r.tracking_number,
        'SLA critical threshold crossed for ' || r.tracking_number,
        jsonb_build_object('deadline', r.deadline), NULL);
      v_raised := v_raised + 1;
    END IF;
  END LOOP;

  -- Overdue stops
  FOR r IN SELECT s.id, s.sequence, s.route_id, ro.route_number, coalesce(s.planned_arrival, s.service_window_end) AS due
             FROM public.logistics_route_stops s JOIN public.logistics_routes ro ON ro.id = s.route_id
            WHERE s.actual_arrival IS NULL
              AND upper(s.status) NOT IN ('COMPLETED','FAILED','CANCELLED','SKIPPED')
              AND coalesce(s.planned_arrival, s.service_window_end) < now() - make_interval(mins => v_so)
            LIMIT 500
  LOOP
    PERFORM public.ct_alert_raise('stop_overdue','route_stop', r.id, r.route_number || ' #' || r.sequence,
      'Stop overdue by more than ' || v_so || ' minutes', jsonb_build_object('due', r.due, 'route_id', r.route_id));
    v_raised := v_raised + 1;
  END LOOP;

  -- Repeated failed deliveries
  FOR r IN SELECT a.package_id, count(*) AS fails, max(p.tracking_number) AS ref
             FROM public.logistics_delivery_attempts a JOIN public.packages p ON p.id = a.package_id
            WHERE lower(a.outcome) <> 'delivered' AND a.occurred_at > now() - interval '7 days'
            GROUP BY a.package_id HAVING count(*) >= coalesce((SELECT threshold_numeric FROM public.control_tower_alert_rules WHERE rule_key='failed_delivery_repeated'),2)
            LIMIT 300
  LOOP
    PERFORM public.ct_alert_raise('failed_delivery_repeated','package', r.package_id, r.ref,
      r.fails || ' failed delivery attempts in 7 days', jsonb_build_object('attempts', r.fails), r.fails);
    v_raised := v_raised + 1;
  END LOOP;

  -- POD missing after delivery
  FOR r IN SELECT p.id, p.tracking_number, p.delivered_at FROM public.packages p
            WHERE p.status='delivered' AND p.delivered_at < now() - make_interval(mins => coalesce((SELECT threshold_numeric FROM public.control_tower_alert_rules WHERE rule_key='pod_missing'),60)::int)
              AND NOT EXISTS (SELECT 1 FROM public.logistics_pod_records x WHERE x.package_id = p.id AND x.superseded_by_pod_id IS NULL)
            LIMIT 500
  LOOP
    PERFORM public.ct_alert_raise('pod_missing','package', r.id, r.tracking_number,
      'Delivered without proof of delivery', jsonb_build_object('delivered_at', r.delivered_at));
    v_raised := v_raised + 1;
  END LOOP;

  -- Returns awaiting action
  FOR r IN SELECT rr.id, rr.return_number FROM public.package_returns rr
            WHERE coalesce(rr.resolution_state,'open') NOT IN ('RESOLVED','resolved','CLOSED','closed')
              AND rr.created_at < now() - interval '24 hours' LIMIT 300
  LOOP
    PERFORM public.ct_alert_raise('return_required','package_return', r.id, r.return_number,
      'Return open for more than 24 hours');
    v_raised := v_raised + 1;
  END LOOP;

  -- Open route deviations
  FOR r IN SELECT d.id, d.route_id, d.kind FROM public.logistics_route_deviations d
            WHERE upper(coalesce(d.status,'OPEN')) NOT IN ('RESOLVED','CLOSED') LIMIT 300
  LOOP
    PERFORM public.ct_alert_raise('route_deviation','route', r.route_id, r.id::text,
      'Unresolved route deviation: ' || coalesce(r.kind,'deviation'));
    v_raised := v_raised + 1;
  END LOOP;

  -- Carrier capacity exceeded
  FOR r IN SELECT s.id, s.slot_reference,
                  CASE WHEN coalesce(s.offered_kg,0) > 0
                       THEN 100.0*(coalesce(s.reserved_kg,0)+coalesce(s.committed_kg,0))/s.offered_kg END AS util
             FROM public.carrier_capacity_slots s WHERE s.effective_until >= now() LIMIT 500
  LOOP
    IF r.util IS NOT NULL AND r.util >= v_util THEN
      PERFORM public.ct_alert_raise('capacity_exceeded','carrier_capacity_slot', r.id, r.slot_reference,
        'Capacity utilisation at ' || round(r.util,1) || '%', jsonb_build_object('utilisation_pct', round(r.util,1)), r.util);
      v_raised := v_raised + 1;
    END IF;
  END LOOP;

  -- Hub congestion
  FOR r IN SELECT h.id, h.code, 100.0*coalesce(h.current_capacity,0)/nullif(h.max_capacity,0) AS util
             FROM public.logistics_hubs h WHERE h.active AND coalesce(h.max_capacity,0) > 0
  LOOP
    IF r.util >= v_congestion THEN
      PERFORM public.ct_alert_raise('hub_congestion','hub', r.id, r.code,
        'Hub utilisation at ' || round(r.util,1) || '%', jsonb_build_object('utilisation_pct', round(r.util,1)), r.util);
      v_raised := v_raised + 1;
    END IF;
  END LOOP;

  -- Warehouse backlog
  FOR r IN SELECT pl.hub_id, count(*) AS open_lists, max(h.code) AS code
             FROM public.logistics_pick_lists pl LEFT JOIN public.logistics_hubs h ON h.id = pl.hub_id
            WHERE upper(coalesce(pl.status,'OPEN')) NOT IN ('COMPLETED','CANCELLED')
            GROUP BY pl.hub_id HAVING count(*) >= v_backlog
  LOOP
    PERFORM public.ct_alert_raise('warehouse_backlog','hub', r.hub_id, r.code,
      r.open_lists || ' open pick lists', jsonb_build_object('open_pick_lists', r.open_lists), r.open_lists);
    v_raised := v_raised + 1;
  END LOOP;

  -- Reconciliation + settlement
  FOR r IN SELECT x.id, x.reason_code, x.variance_amount FROM public.freight_recon_exceptions x
            WHERE upper(coalesce(x.state::text,'OPEN')) NOT IN ('RESOLVED','CLOSED') LIMIT 300
  LOOP
    PERFORM public.ct_alert_raise('reconciliation_discrepancy','freight_recon_exception', r.id, r.reason_code,
      'Reconciliation variance ' || coalesce(r.variance_amount,0), jsonb_build_object('variance', r.variance_amount), r.variance_amount);
    v_raised := v_raised + 1;
  END LOOP;

  FOR r IN SELECT s.id, s.settlement_number, s.variance_amount FROM public.freight_carrier_settlements s
            WHERE coalesce(abs(s.variance_amount),0) > 0 AND upper(s.status::text) NOT IN ('PAID','REVERSED') LIMIT 200
  LOOP
    PERFORM public.ct_alert_raise('settlement_exception','freight_settlement', r.id, r.settlement_number,
      'Settlement variance ' || r.variance_amount, jsonb_build_object('variance', r.variance_amount), r.variance_amount);
    v_raised := v_raised + 1;
  END LOOP;

  -- Offline conflicts
  FOR r IN SELECT c.id, c.command_id, c.conflict_reason FROM public.logistics_offline_commands c
            WHERE c.state::text = 'CONFLICT' AND c.resolution IS NULL LIMIT 300
  LOOP
    PERFORM public.ct_alert_raise('offline_sync_conflict','offline_command', r.id, r.command_id,
      'Field command in conflict: ' || coalesce(r.conflict_reason,'unspecified'));
    v_raised := v_raised + 1;
  END LOOP;

  -- Assigned driver telemetry stale
  FOR r IN SELECT ro.id, ro.route_number, ro.driver_user_id FROM public.logistics_routes ro
            WHERE upper(ro.status) IN ('DISPATCHED','IN_PROGRESS','ACTIVE') AND ro.driver_user_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM public.driver_locations d WHERE d.driver_id = ro.driver_user_id
                                AND d.updated_at > now() - make_interval(mins => v_stale::int))
            LIMIT 200
  LOOP
    PERFORM public.ct_alert_raise('driver_unavailable','route', r.id, r.route_number,
      'No driver telemetry within ' || v_stale || ' minutes', jsonb_build_object('driver_id', r.driver_user_id));
    v_raised := v_raised + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'scanned_at', now(), 'conditions_raised', v_raised,
    'open_alerts', (SELECT count(*) FROM public.control_tower_alerts WHERE status NOT IN ('RESOLVED','CLOSED')));
END; $$;

CREATE OR REPLACE FUNCTION public.ct_alerts_list(_status text DEFAULT NULL, _severity text DEFAULT NULL,
                                                 _limit integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lim int := least(greatest(coalesce(_limit,50),1),200); v_off int := greatest(coalesce(_offset,0),0);
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.control_tower.read') THEN
    RETURN public.ct_denied('staff.logistics.control_tower.read','ct_alerts_list');
  END IF;
  RETURN jsonb_build_object('ok', true, 'measured_at', now(),
    'total', (SELECT count(*) FROM public.control_tower_alerts a
               WHERE (_status IS NULL OR a.status::text = _status)
                 AND (_severity IS NULL OR a.severity = _severity)),
    'rows', (SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) FROM (
       SELECT a.id, a.alert_number, a.rule_key, a.condition_kind, a.severity, a.status::text AS status,
              a.entity_type, a.entity_id, a.entity_ref, a.reason, a.detail, a.observed_value, a.threshold,
              a.correlation_id, a.owner_user_id, a.occurrence_count, a.first_seen_at, a.last_seen_at,
              a.acknowledged_at, a.resolved_at, a.resolution,
              (SELECT coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'to_status', e.to_status,
                        'actor_id', e.actor_id, 'notes', e.notes, 'at', e.created_at) ORDER BY e.created_at), '[]'::jsonb)
                 FROM public.control_tower_alert_events e WHERE e.alert_id = a.id) AS history
         FROM public.control_tower_alerts a
        WHERE (_status IS NULL OR a.status::text = _status)
          AND (_severity IS NULL OR a.severity = _severity)
        ORDER BY CASE a.severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, a.last_seen_at DESC
        LIMIT v_lim OFFSET v_off) x));
END; $$;

CREATE OR REPLACE FUNCTION public.ct_alert_transition(_alert_id uuid, _action text, _notes text DEFAULT NULL,
                                                      _assignee uuid DEFAULT NULL, _resolution text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.control_tower_alerts; v_to public.ct_alert_status; v_act text := upper(coalesce(_action,''));
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.control_tower.manage') THEN
    RETURN public.ct_denied('staff.logistics.control_tower.manage','ct_alert_transition');
  END IF;
  SELECT * INTO v FROM public.control_tower_alerts WHERE id = _alert_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code','NOT_FOUND','category','not_found','retryable',false,
      'message','Alert not found.');
  END IF;

  v_to := CASE v_act
    WHEN 'ACKNOWLEDGE' THEN 'ACKNOWLEDGED'
    WHEN 'ASSIGN' THEN 'ASSIGNED'
    WHEN 'START' THEN 'IN_PROGRESS'
    WHEN 'RESOLVE' THEN 'RESOLVED'
    WHEN 'CLOSE' THEN 'CLOSED'
    WHEN 'REOPEN' THEN 'CREATED'
    ELSE NULL END;
  IF v_to IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code','INVALID_ACTION','category','validation','retryable',false,
      'message','Unsupported alert action.', 'reason', _action);
  END IF;

  IF v_act = 'RESOLVE' AND coalesce(trim(_resolution),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'code','RESOLUTION_REQUIRED','category','validation','retryable',false,
      'message','A resolution note is required to resolve an alert.');
  END IF;
  IF v_act = 'ASSIGN' AND _assignee IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code','ASSIGNEE_REQUIRED','category','validation','retryable',false,
      'message','Select who owns this alert.');
  END IF;
  IF v.status = 'CLOSED' AND v_act <> 'REOPEN' THEN
    RETURN jsonb_build_object('ok', false, 'code','INVALID_STATE','category','conflict','retryable',false,
      'message','This alert is closed.', 'reason', 'status=CLOSED');
  END IF;

  UPDATE public.control_tower_alerts SET
    status = v_to,
    owner_user_id = coalesce(_assignee, owner_user_id),
    acknowledged_at = CASE WHEN v_act='ACKNOWLEDGE' THEN now() ELSE acknowledged_at END,
    acknowledged_by = CASE WHEN v_act='ACKNOWLEDGE' THEN auth.uid() ELSE acknowledged_by END,
    resolved_at = CASE WHEN v_act='RESOLVE' THEN now() WHEN v_act='REOPEN' THEN NULL ELSE resolved_at END,
    resolved_by = CASE WHEN v_act='RESOLVE' THEN auth.uid() WHEN v_act='REOPEN' THEN NULL ELSE resolved_by END,
    resolution  = CASE WHEN v_act='RESOLVE' THEN _resolution WHEN v_act='REOPEN' THEN NULL ELSE resolution END,
    closed_at   = CASE WHEN v_act='CLOSE' THEN now() WHEN v_act='REOPEN' THEN NULL ELSE closed_at END
  WHERE id = _alert_id;

  INSERT INTO public.control_tower_alert_events (alert_id, action, from_status, to_status, actor_id, notes, correlation_id)
  VALUES (_alert_id, v_act, v.status, v_to, auth.uid(), coalesce(_notes, _resolution), v.correlation_id);

  RETURN jsonb_build_object('ok', true, 'alert_id', _alert_id, 'status', v_to::text,
                            'correlation_id', v.correlation_id, 'at', now());
END; $$;

-- ---------------------------------------------------------------
-- 15. OPERATOR COMMAND LAYER
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ct_command_execute(_operation text, _entity_type text, _entity_id uuid,
                                                     _payload jsonb DEFAULT '{}'::jsonb,
                                                     _request_id text DEFAULT NULL, _correlation_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_op text := upper(coalesce(_operation,'')); v_perm text := 'staff.logistics.control_tower.manage';
        v_req text := coalesce(_request_id, gen_random_uuid()::text);
        v_corr text := coalesce(_correlation_id, gen_random_uuid()::text);
        v_started timestamptz := clock_timestamp(); v_result jsonb; v_ok boolean; v_payload jsonb := coalesce(_payload,'{}'::jsonb);
        v_env jsonb;
BEGIN
  IF NOT public.has_staff_permission(v_perm) THEN
    INSERT INTO public.control_tower_commands (request_id, correlation_id, operation, entity_type, entity_id,
      actor_id, permission_required, outcome, error_code, error_message, latency_ms, payload)
    VALUES (v_req, v_corr, v_op, _entity_type, _entity_id, auth.uid(), v_perm, 'REJECTED',
            'AUTHORIZATION_DENIED','Missing permission '||v_perm, 0, v_payload);
    RETURN public.ct_denied(v_perm, v_op) || jsonb_build_object('request_id', v_req, 'correlation_id', v_corr);
  END IF;

  BEGIN
    CASE v_op
      WHEN 'ASSIGN_DRIVER', 'REASSIGN_DRIVER', 'ASSIGN_VEHICLE', 'REASSIGN_VEHICLE' THEN
        v_result := public.logistics_route_assign(_entity_id,
                      nullif(v_payload->>'driver_user_id','')::uuid,
                      nullif(v_payload->>'vehicle_id','')::uuid,
                      coalesce(v_payload->>'reason', v_op),
                      coalesce((v_payload->>'force')::boolean, false));
      WHEN 'REORDER_STOPS' THEN
        v_result := public.logistics_route_reorder_stops(_entity_id,
                      ARRAY(SELECT jsonb_array_elements_text(v_payload->'stop_ids'))::uuid[],
                      coalesce(v_payload->>'reason','Control Tower reorder'));
      WHEN 'RECALCULATE_ROUTE', 'REROUTE' THEN
        v_result := public.logistics_route_optimize(_entity_id, v_payload->>'provider_key', v_payload);
      WHEN 'HOLD_DISPATCH' THEN
        v_result := public.logistics_route_transition(_entity_id, coalesce(v_payload->>'to_status','ON_HOLD'),
                      coalesce(v_payload->>'reason','Held from Control Tower'));
      WHEN 'RELEASE_DISPATCH' THEN
        v_result := public.logistics_route_transition(_entity_id, coalesce(v_payload->>'to_status','DISPATCHED'),
                      coalesce(v_payload->>'reason','Released from Control Tower'));
      WHEN 'ESCALATE_EXCEPTION' THEN
        v_result := public.logistics_exception_transition(_entity_id, coalesce(v_payload->>'to_status','ESCALATED'),
                      v_payload->>'note', NULL, coalesce(v_payload->>'severity','critical'));
      WHEN 'RESOLVE_EXCEPTION' THEN
        v_result := public.logistics_exception_transition(_entity_id, 'RESOLVED', v_payload->>'note',
                      v_payload->>'resolution', NULL);
      WHEN 'ASSIGN_EXCEPTION' THEN
        v_result := public.logistics_exception_transition(_entity_id, coalesce(v_payload->>'to_status','IN_PROGRESS'),
                      v_payload->>'note', NULL, NULL);
      WHEN 'CREATE_RETURN' THEN
        v_result := public.logistics_return_authorize(_entity_id, coalesce(v_payload->>'reason','Control Tower return'),
                      v_payload->>'reason_code', nullif(v_payload->>'destination_hub_id','')::uuid,
                      v_payload->>'service_level', v_payload->>'instructions',
                      coalesce((v_payload->>'merchant_approval_required')::boolean, false));
      WHEN 'REATTEMPT_DELIVERY' THEN
        v_result := public.logistics_record_delivery_attempt(_entity_id, 'rescheduled',
                      coalesce(v_payload->>'idempotency_key', v_req), coalesce(v_payload->>'reason_code','ops_reattempt'),
                      coalesce(v_payload->>'narrative','Re-attempt scheduled from Control Tower'),
                      NULL, NULL, NULL, jsonb_build_object('source','control_tower'));
      WHEN 'RESOLVE_DEVIATION' THEN
        v_result := public.logistics_route_resolve_deviation(_entity_id, coalesce(v_payload->>'status','RESOLVED'),
                      v_payload->>'note');
      WHEN 'STOP_TRANSITION' THEN
        v_result := public.logistics_stop_transition(_entity_id, v_payload->>'to_status',
                      coalesce(v_payload->>'reason','Control Tower'), NULL, NULL);
      ELSE
        v_result := jsonb_build_object('ok', false, 'code','UNSUPPORTED_COMMAND','category','validation',
                      'retryable', false, 'message','That command is not available from the Control Tower.',
                      'reason', v_op);
    END CASE;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.control_tower_commands (request_id, correlation_id, operation, entity_type, entity_id,
      actor_id, permission_required, outcome, error_code, error_message, latency_ms, payload)
    VALUES (v_req, v_corr, v_op, _entity_type, _entity_id, auth.uid(), v_perm, 'FAILED', SQLSTATE,
            'Command could not be completed.', (extract(epoch FROM clock_timestamp()-v_started)*1000)::int, v_payload);
    RETURN jsonb_build_object('ok', false, 'code','COMMAND_FAILED','category','system','retryable', true,
      'severity','error','message','The command could not be completed. Operations has been notified.',
      'reason','execution_error','operation', v_op, 'request_id', v_req, 'correlation_id', v_corr, 'timestamp', now());
  END;

  v_ok := coalesce((v_result->>'ok')::boolean, true);

  INSERT INTO public.control_tower_commands (request_id, correlation_id, operation, entity_type, entity_id,
    actor_id, permission_required, outcome, error_code, error_message, latency_ms, payload, result)
  VALUES (v_req, v_corr, v_op, _entity_type, _entity_id, auth.uid(), v_perm,
          CASE WHEN v_ok THEN 'APPLIED' ELSE 'REJECTED' END,
          v_result->>'code', v_result->>'message',
          (extract(epoch FROM clock_timestamp()-v_started)*1000)::int, v_payload, coalesce(v_result,'{}'::jsonb));

  IF v_ok THEN
    PERFORM public.logistics_event_emit_internal(
      'logistics.control_tower.command_executed', coalesce(_entity_type,'control_tower'), _entity_id,
      jsonb_build_object('operation', v_op, 'result', v_result), NULL, v_corr, NULL, 'staff', auth.uid(),
      NULL, false, jsonb_build_object('request_id', v_req), 'ct:'||v_req);
  END IF;

  RETURN coalesce(v_result,'{}'::jsonb) || jsonb_build_object('request_id', v_req, 'correlation_id', v_corr,
                                                              'operation', v_op, 'timestamp', now());
END; $$;

-- ---------------------------------------------------------------
-- 16. CONFIGURATION WRITE SURFACE
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ct_setting_set(_key text, _value jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.control_tower.manage') THEN
    RETURN public.ct_denied('staff.logistics.control_tower.manage','ct_setting_set');
  END IF;
  UPDATE public.control_tower_settings
     SET value = _value, state = 'SET', updated_by = auth.uid()
   WHERE setting_key = _key;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code','NOT_FOUND','category','validation','retryable',false,
      'message','Unknown Control Tower setting.', 'reason', _key);
  END IF;
  RETURN jsonb_build_object('ok', true, 'setting_key', _key, 'value', _value);
END; $$;

CREATE OR REPLACE FUNCTION public.ct_sla_policy_upsert(_scope_kind text, _scope_value text, _label text,
  _target_minutes integer, _warn numeric, _crit numeric, _grace integer, _stop_overdue integer,
  _active boolean DEFAULT true, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.control_tower.manage') THEN
    RETURN public.ct_denied('staff.logistics.control_tower.manage','ct_sla_policy_upsert');
  END IF;
  IF _scope_kind NOT IN ('global','service','customer','contract') THEN
    RETURN jsonb_build_object('ok', false, 'code','INVALID_SCOPE','category','validation','retryable',false,
      'message','Scope must be global, service, customer or contract.');
  END IF;
  IF coalesce(_target_minutes,0) <= 0 OR coalesce(_warn,0) <= 0 OR coalesce(_crit,0) <= 0 OR _crit < _warn THEN
    RETURN jsonb_build_object('ok', false, 'code','INVALID_THRESHOLDS','category','validation','retryable',false,
      'message','Target must be positive and the critical threshold must not be below the warning threshold.');
  END IF;

  INSERT INTO public.control_tower_sla_policies (scope_kind, scope_value, label, target_minutes,
    warning_threshold_pct, critical_threshold_pct, breach_grace_minutes, stop_overdue_minutes, active, notes, updated_by)
  VALUES (_scope_kind, _scope_value, _label, _target_minutes, _warn, _crit, coalesce(_grace,0),
          coalesce(_stop_overdue,30), coalesce(_active,true), _notes, auth.uid())
  ON CONFLICT (scope_kind, coalesce(scope_value,'*')) DO UPDATE
    SET label = EXCLUDED.label, target_minutes = EXCLUDED.target_minutes,
        warning_threshold_pct = EXCLUDED.warning_threshold_pct,
        critical_threshold_pct = EXCLUDED.critical_threshold_pct,
        breach_grace_minutes = EXCLUDED.breach_grace_minutes,
        stop_overdue_minutes = EXCLUDED.stop_overdue_minutes,
        active = EXCLUDED.active, notes = EXCLUDED.notes, updated_by = auth.uid()
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'policy_id', v_id);
END; $$;

CREATE OR REPLACE FUNCTION public.ct_alert_rule_set(_rule_key text, _enabled boolean, _severity text DEFAULT NULL,
  _threshold numeric DEFAULT NULL, _window_minutes integer DEFAULT NULL, _owner_role text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.control_tower.manage') THEN
    RETURN public.ct_denied('staff.logistics.control_tower.manage','ct_alert_rule_set');
  END IF;
  UPDATE public.control_tower_alert_rules
     SET enabled = coalesce(_enabled, enabled),
         severity = coalesce(_severity, severity),
         threshold_numeric = coalesce(_threshold, threshold_numeric),
         window_minutes = coalesce(_window_minutes, window_minutes),
         owner_role = coalesce(_owner_role, owner_role),
         updated_by = auth.uid()
   WHERE rule_key = _rule_key;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code','NOT_FOUND','category','validation','retryable',false,
      'message','Unknown alert rule.', 'reason', _rule_key);
  END IF;
  RETURN jsonb_build_object('ok', true, 'rule_key', _rule_key);
END; $$;

CREATE OR REPLACE FUNCTION public.ct_config_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.control_tower.read') THEN
    RETURN public.ct_denied('staff.logistics.control_tower.read','ct_config_overview');
  END IF;
  RETURN jsonb_build_object('ok', true,
    'settings', (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.category, s.setting_key),'[]'::jsonb)
                   FROM public.control_tower_settings s),
    'sla_policies', (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.scope_kind, p.scope_value),'[]'::jsonb)
                   FROM public.control_tower_sla_policies p),
    'alert_rules', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.rule_key),'[]'::jsonb)
                   FROM public.control_tower_alert_rules r),
    'recent_commands', (SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM (
                   SELECT id, request_id, correlation_id, operation, entity_type, entity_id, outcome,
                          error_code, latency_ms, created_at
                     FROM public.control_tower_commands ORDER BY created_at DESC LIMIT 50) c));
END; $$;

-- ---------------------------------------------------------------
-- 17. EXECUTE GRANTS — deny by default, authenticated only
-- ---------------------------------------------------------------
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'ct_board_snapshot()', 'ct_board_rows(text,integer,integer,text,text,text)',
    'ct_live_map(text,uuid)', 'ct_capacity_snapshot()', 'ct_warehouse_snapshot()',
    'ct_carrier_snapshot(integer)', 'ct_finance_snapshot()', 'ct_offline_snapshot()',
    'ct_search(text,integer)', 'ct_alerts_list(text,text,integer,integer)',
    'ct_alert_scan()', 'ct_alert_transition(uuid,text,text,uuid,text)',
    'ct_command_execute(text,text,uuid,jsonb,text,text)', 'ct_setting_set(text,jsonb)',
    'ct_sla_policy_upsert(text,text,text,integer,numeric,numeric,integer,integer,boolean,text)',
    'ct_alert_rule_set(text,boolean,text,numeric,integer,text)', 'ct_config_overview()',
    'ct_policy_for(text)', 'ct_setting_num(text,numeric)',
    'ct_sla_state(timestamptz,timestamptz,timestamptz,numeric,numeric,integer)',
    'ct_operational_state(text,boolean,boolean,boolean,uuid,boolean,boolean)',
    'ct_denied(text,text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  -- Internal raiser: never client-callable.
  EXECUTE 'REVOKE ALL ON FUNCTION public.ct_alert_raise(text,text,uuid,text,text,jsonb,numeric,text) FROM PUBLIC';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.ct_alert_raise(text,text,uuid,text,text,jsonb,numeric,text) TO service_role';
END $$;

-- Realtime: the Control Tower subscribes to alert and event changes.
ALTER TABLE public.control_tower_alerts REPLICA IDENTITY FULL;
DO $$ BEGIN
  EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.control_tower_alerts';
EXCEPTION WHEN duplicate_object THEN NULL; WHEN undefined_object THEN NULL; END $$;