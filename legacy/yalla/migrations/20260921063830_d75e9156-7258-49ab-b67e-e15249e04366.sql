-- ============================================================
-- A. DAILY MONEY FLOW FOR THE MANAGER DESK (any day, any month)
-- ============================================================
CREATE OR REPLACE FUNCTION public.sales_manager_daily_flow(p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := public._my_staff_member_id();
  v_today date := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  v_to date := coalesce((p->>'to')::date, v_today);
  v_from date := coalesce((p->>'from')::date, v_to - 13);
  v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_me IS NULL AND NOT public.has_staff_permission('staff.crm.manage') THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  IF NOT public.has_staff_permission('staff.crm.manage')
     AND NOT EXISTS (SELECT 1 FROM public.staff_members WHERE manager_staff_id = v_me) THEN
    RAISE EXCEPTION 'NOT_A_SALES_MANAGER';
  END IF;
  IF v_from > v_to THEN RAISE EXCEPTION 'RANGE_INVALID'; END IF;
  IF v_to - v_from > 92 THEN RAISE EXCEPTION 'RANGE_TOO_WIDE'; END IF;

  WITH team AS (
    SELECT sm.id, sm.full_name, op.title AS position_title
      FROM public.staff_members sm
      LEFT JOIN public.org_positions op ON op.id = sm.position_id
     WHERE sm.employment_status IN ('active','onboarding')
       AND (sm.manager_staff_id = v_me OR (public.has_staff_permission('staff.crm.manage')
            AND op.code IN ('YML-SAL-CSS-001','SLS-MOB','SLS-SUP','SLS-PRT','SLS-LEAD')))
  ), days AS (
    SELECT d::date AS day FROM generate_series(v_from, v_to, interval '1 day') d
  ), grid AS (
    SELECT t.id AS staff_id, t.full_name, t.position_title, d.day
      FROM team t CROSS JOIN days d
  ), flow AS (
    SELECT g.staff_id, g.full_name, g.position_title, g.day,
      coalesce((SELECT sum(l.won_revenue_kes) FROM public.sales_leads l
                 WHERE l.sales_staff_id = g.staff_id AND NOT coalesce(l.is_test,false)
                   AND l.stage = 'CLOSED_WON'
                   AND (l.closed_at AT TIME ZONE 'Africa/Nairobi')::date = g.day), 0)::numeric AS won_kes,
      coalesce((SELECT sum(r.amount_cents) FROM public.payment_receipts r
                 JOIN public.tax_invoices i ON i.id = r.invoice_id
                 WHERE i.owner_staff_id = g.staff_id AND coalesce(r.status,'recorded') <> 'void'
                   AND NOT coalesce(r.is_test,false) AND r.received_on = g.day), 0)::numeric AS collected_cents,
      coalesce((SELECT sum(e.value_kes) FROM public.commercial_service_executions e
                 WHERE e.owner_staff_id = g.staff_id AND e.status = 'COMPLETED'
                   AND (coalesce(e.completed_at, e.scheduled_at) AT TIME ZONE 'Africa/Nairobi')::date = g.day), 0)::numeric AS service_value_kes,
      coalesce((SELECT count(*) FROM public.commercial_service_executions e
                 WHERE e.owner_staff_id = g.staff_id AND e.status = 'COMPLETED'
                   AND (coalesce(e.completed_at, e.scheduled_at) AT TIME ZONE 'Africa/Nairobi')::date = g.day), 0) AS services_completed,
      coalesce((SELECT sum(v.declared_value_kes) FROM public.commercial_account_service_volumes v
                 WHERE v.staff_member_id = g.staff_id AND v.service_date = g.day), 0)::numeric AS declared_value_kes,
      coalesce((SELECT sum(v.airport_transfers + v.staff_transport_trips + v.parcel_deliveries)
                  FROM public.commercial_account_service_volumes v
                 WHERE v.staff_member_id = g.staff_id AND v.service_date = g.day), 0) AS declared_units,
      (SELECT k.revenue_kes FROM public.sales_kpi_closes k
         WHERE k.staff_member_id = g.staff_id AND k.grain = 'DAY' AND k.period_start = g.day
         ORDER BY k.closed_at DESC LIMIT 1) AS closed_revenue_kes,
      EXISTS (SELECT 1 FROM public.sales_kpi_closes k
               WHERE k.staff_member_id = g.staff_id AND k.grain = 'DAY' AND k.period_start = g.day) AS day_closed,
      (public.sales_target_for(g.staff_id, date_trunc('month', g.day)::date)->>'target_kes')::numeric AS month_target_kes
      FROM grid g
  ), enriched AS (
    SELECT f.*,
      (f.won_kes + f.collected_cents / 100.0) AS recognised_kes,
      CASE WHEN f.month_target_kes IS NULL THEN NULL
           ELSE round(f.month_target_kes
                / greatest(extract(day from (date_trunc('month', f.day) + interval '1 month - 1 day'))::numeric, 1), 2)
      END AS daily_target_kes
      FROM flow f
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'from', v_from,
    'to', v_to,
    'today', v_today,
    'days', (
      SELECT coalesce(jsonb_agg(x ORDER BY x->>'day' DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'day', e.day,
          'recognised_kes', sum(e.recognised_kes),
          'won_kes', sum(e.won_kes),
          'collected_cents', sum(e.collected_cents),
          'service_value_kes', sum(e.service_value_kes),
          'services_completed', sum(e.services_completed),
          'declared_value_kes', sum(e.declared_value_kes),
          'declared_units', sum(e.declared_units),
          'closed_revenue_kes', sum(coalesce(e.closed_revenue_kes,0)),
          'closes', count(*) FILTER (WHERE e.day_closed),
          'people_expected', count(*),
          'daily_target_kes', sum(coalesce(e.daily_target_kes,0)),
          'gap_kes', sum(coalesce(e.daily_target_kes,0)) - sum(e.recognised_kes)
        ) AS x
          FROM enriched e GROUP BY e.day
      ) s
    ),
    'people', (
      SELECT coalesce(jsonb_agg(y ORDER BY y->>'full_name'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'staff_id', e.staff_id,
          'full_name', max(e.full_name),
          'position', max(e.position_title),
          'month_target_kes', max(e.month_target_kes),
          'recognised_range_kes', sum(e.recognised_kes),
          'declared_value_range_kes', sum(e.declared_value_kes),
          'service_value_range_kes', sum(e.service_value_kes),
          'closes_in_range', count(*) FILTER (WHERE e.day_closed),
          'days_in_range', count(*),
          'days', (
            SELECT coalesce(jsonb_agg(jsonb_build_object(
              'day', d.day,
              'recognised_kes', d.recognised_kes,
              'won_kes', d.won_kes,
              'collected_cents', d.collected_cents,
              'service_value_kes', d.service_value_kes,
              'services_completed', d.services_completed,
              'declared_value_kes', d.declared_value_kes,
              'declared_units', d.declared_units,
              'closed_revenue_kes', d.closed_revenue_kes,
              'day_closed', d.day_closed,
              'daily_target_kes', d.daily_target_kes,
              'gap_kes', CASE WHEN d.daily_target_kes IS NULL THEN NULL ELSE d.daily_target_kes - d.recognised_kes END
            ) ORDER BY d.day DESC), '[]'::jsonb)
              FROM enriched d WHERE d.staff_id = e.staff_id
          )
        ) AS y
          FROM enriched e GROUP BY e.staff_id
      ) s2
    )
  ) INTO v;

  RETURN v;
END;
$function$;

REVOKE ALL ON FUNCTION public.sales_manager_daily_flow(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_manager_daily_flow(jsonb) TO authenticated, service_role;

-- ============================================================
-- B. PROVIDER ESCALATION PATH
-- ============================================================
CREATE TABLE IF NOT EXISTS public.provider_escalation_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  category text NOT NULL,
  label text NOT NULL,
  responsible_team text NOT NULL,
  response_minutes integer NOT NULL DEFAULT 60,
  blocks_booking boolean NOT NULL DEFAULT false,
  guidance text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.provider_escalation_routes TO authenticated;
GRANT ALL ON public.provider_escalation_routes TO service_role;
ALTER TABLE public.provider_escalation_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY provider_escalation_routes_read ON public.provider_escalation_routes
  FOR SELECT TO authenticated USING (public.is_staff_member());
CREATE POLICY provider_escalation_routes_manage ON public.provider_escalation_routes
  FOR ALL TO authenticated
  USING (public.has_staff_permission('staff.logistics.manage') OR public.has_staff_permission('staff.crm.manage'))
  WITH CHECK (public.has_staff_permission('staff.logistics.manage') OR public.has_staff_permission('staff.crm.manage'));

CREATE TABLE IF NOT EXISTS public.provider_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escalation_ref text NOT NULL UNIQUE,
  route_id uuid NOT NULL REFERENCES public.provider_escalation_routes(id) ON DELETE RESTRICT,
  account_id uuid,
  signal_id uuid REFERENCES public.commercial_signals(id) ON DELETE SET NULL,
  execution_id uuid REFERENCES public.commercial_service_executions(id) ON DELETE SET NULL,
  provider_label text,
  summary text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'raised',
  raised_by uuid,
  raised_by_staff_id uuid,
  assigned_team text NOT NULL,
  due_at timestamptz NOT NULL,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text,
  blocks_booking boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_escalations_status_chk CHECK (status IN ('raised','acknowledged','resolved','withdrawn'))
);

CREATE INDEX IF NOT EXISTS provider_escalations_open_idx
  ON public.provider_escalations (account_id) WHERE status IN ('raised','acknowledged');
CREATE INDEX IF NOT EXISTS provider_escalations_due_idx ON public.provider_escalations (due_at);

GRANT SELECT, INSERT, UPDATE ON public.provider_escalations TO authenticated;
GRANT ALL ON public.provider_escalations TO service_role;
ALTER TABLE public.provider_escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY provider_escalations_read ON public.provider_escalations
  FOR SELECT TO authenticated
  USING (public.is_commercial_staff()
         OR public.has_staff_permission('staff.logistics.read')
         OR public.has_staff_permission('staff.logistics.manage'));
CREATE POLICY provider_escalations_write ON public.provider_escalations
  FOR ALL TO authenticated
  USING (public.is_commercial_staff() OR public.has_staff_permission('staff.logistics.manage'))
  WITH CHECK (public.is_commercial_staff() OR public.has_staff_permission('staff.logistics.manage'));

CREATE TRIGGER provider_escalation_routes_touch BEFORE UPDATE ON public.provider_escalation_routes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER provider_escalations_touch BEFORE UPDATE ON public.provider_escalations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.provider_escalation_routes (code, category, label, responsible_team, response_minutes, blocks_booking, guidance)
VALUES
  ('DRIVER_CONDUCT','DRIVER','Driver conduct or professionalism','Fleet operations',120,false,'Fleet operations reviews the driver record and responds to the account owner.'),
  ('VEHICLE_CONDITION','VEHICLE','Vehicle condition or documents','Fleet operations',120,true,'Vehicle is held from new bookings until fleet operations clears it.'),
  ('LATE_ARRIVAL','SERVICE','Repeated late arrival','Dispatch',60,false,'Dispatch reviews assignment and confirms recovery for the next trip.'),
  ('SERVICE_FAILURE','SERVICE','Trip did not happen','Dispatch',30,true,'No further booking for this account until dispatch confirms cover.'),
  ('SAFETY_INCIDENT','SAFETY','Safety incident','Safety and compliance',30,true,'Bookings blocked until safety and compliance signs off.'),
  ('BILLING_DISPUTE','BILLING','Billing or rate dispute','Finance',240,false,'Finance reconciles the invoice with the account owner.'),
  ('CAPACITY_SHORTFALL','CAPACITY','No vehicle available','Capacity planning',60,false,'Capacity planning confirms an alternative before the next commitment.')
ON CONFLICT (code) DO NOTHING;

-- Raise an escalation (optionally from an existing account service signal).
CREATE OR REPLACE FUNCTION public.provider_escalation_raise(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_staff uuid := public._my_staff_member_id();
  v_route public.provider_escalation_routes;
  v_id uuid;
  v_ref text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT (public.is_commercial_staff() OR public.has_staff_permission('staff.logistics.manage')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  SELECT * INTO v_route FROM public.provider_escalation_routes
   WHERE code = upper(coalesce(p->>'route_code','')) AND is_active;
  IF v_route.id IS NULL THEN RAISE EXCEPTION 'ROUTE_NOT_FOUND'; END IF;
  IF coalesce(btrim(p->>'summary'),'') = '' THEN RAISE EXCEPTION 'SUMMARY_REQUIRED'; END IF;
  IF (p->>'account_id') IS NULL THEN RAISE EXCEPTION 'ACCOUNT_REQUIRED'; END IF;

  v_ref := 'ESC-' || to_char(now() AT TIME ZONE 'Africa/Nairobi','YYMMDD') || '-'
           || upper(substr(md5(gen_random_uuid()::text),1,5));

  INSERT INTO public.provider_escalations (
    escalation_ref, route_id, account_id, signal_id, execution_id, provider_label,
    summary, severity, raised_by, raised_by_staff_id, assigned_team, due_at, blocks_booking
  ) VALUES (
    v_ref, v_route.id, (p->>'account_id')::uuid,
    nullif(p->>'signal_id','')::uuid, nullif(p->>'execution_id','')::uuid,
    nullif(btrim(coalesce(p->>'provider_label','')),''),
    btrim(p->>'summary'), coalesce(nullif(p->>'severity',''),'medium'),
    auth.uid(), v_staff, v_route.responsible_team,
    now() + make_interval(mins => v_route.response_minutes),
    v_route.blocks_booking
  ) RETURNING id INTO v_id;

  IF (p->>'signal_id') IS NOT NULL THEN
    UPDATE public.commercial_signals
       SET status = 'acknowledged', status_note = 'Escalated to ' || v_route.responsible_team || ' (' || v_ref || ')',
           status_by = auth.uid(), status_at = now()
     WHERE id = (p->>'signal_id')::uuid AND status = 'open';
  END IF;

  RETURN jsonb_build_object('escalation_id', v_id, 'escalation_ref', v_ref,
    'assigned_team', v_route.responsible_team, 'due_at', now() + make_interval(mins => v_route.response_minutes),
    'blocks_booking', v_route.blocks_booking);
END;
$function$;

-- Acknowledge / resolve / withdraw.
CREATE OR REPLACE FUNCTION public.provider_escalation_advance(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status text := lower(coalesce(p->>'status',''));
  v_row public.provider_escalations;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT (public.is_commercial_staff() OR public.has_staff_permission('staff.logistics.manage')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  IF v_status NOT IN ('acknowledged','resolved','withdrawn') THEN RAISE EXCEPTION 'STATUS_INVALID'; END IF;

  SELECT * INTO v_row FROM public.provider_escalations WHERE id = (p->>'escalation_id')::uuid;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'ESCALATION_NOT_FOUND'; END IF;
  IF v_row.status IN ('resolved','withdrawn') THEN RAISE EXCEPTION 'ALREADY_CLOSED'; END IF;
  IF v_status IN ('resolved','withdrawn') AND coalesce(btrim(p->>'note'),'') = '' THEN
    RAISE EXCEPTION 'NOTE_REQUIRED';
  END IF;

  UPDATE public.provider_escalations
     SET status = v_status,
         acknowledged_at = CASE WHEN v_status = 'acknowledged' THEN now() ELSE acknowledged_at END,
         acknowledged_by = CASE WHEN v_status = 'acknowledged' THEN auth.uid() ELSE acknowledged_by END,
         resolved_at = CASE WHEN v_status IN ('resolved','withdrawn') THEN now() ELSE resolved_at END,
         resolved_by = CASE WHEN v_status IN ('resolved','withdrawn') THEN auth.uid() ELSE resolved_by END,
         resolution_note = coalesce(nullif(btrim(p->>'note'),''), resolution_note)
   WHERE id = v_row.id;

  RETURN jsonb_build_object('escalation_id', v_row.id, 'status', v_status);
END;
$function$;

-- Board + booking check.
CREATE OR REPLACE FUNCTION public.provider_escalation_board(p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT (public.is_commercial_staff() OR public.has_staff_permission('staff.logistics.read')
          OR public.has_staff_permission('staff.logistics.manage')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'routes', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'code', r.code, 'label', r.label, 'category', r.category,
        'responsible_team', r.responsible_team, 'response_minutes', r.response_minutes,
        'blocks_booking', r.blocks_booking, 'guidance', r.guidance) ORDER BY r.category, r.label), '[]'::jsonb)
      FROM public.provider_escalation_routes r WHERE r.is_active),
    'escalations', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'escalation_id', e.id, 'escalation_ref', e.escalation_ref,
        'account_id', e.account_id,
        'customer_label', (SELECT a.name FROM public.commercial_accounts a WHERE a.id = e.account_id),
        'route_code', r.code, 'route_label', r.label, 'assigned_team', e.assigned_team,
        'summary', e.summary, 'severity', e.severity, 'status', e.status,
        'provider_label', e.provider_label,
        'due_at', e.due_at, 'overdue', (e.status IN ('raised','acknowledged') AND e.due_at < now()),
        'blocks_booking', e.blocks_booking,
        'raised_by', (SELECT sm.full_name FROM public.staff_members sm WHERE sm.id = e.raised_by_staff_id),
        'created_at', e.created_at, 'acknowledged_at', e.acknowledged_at,
        'resolved_at', e.resolved_at, 'resolution_note', e.resolution_note)
        ORDER BY (e.status IN ('raised','acknowledged')) DESC, e.due_at), '[]'::jsonb)
      FROM public.provider_escalations e JOIN public.provider_escalation_routes r ON r.id = e.route_id
      WHERE (coalesce((p->>'include_closed')::boolean, false) OR e.status IN ('raised','acknowledged'))
        AND (p->>'account_id' IS NULL OR e.account_id = (p->>'account_id')::uuid)),
    'open_count', (SELECT count(*) FROM public.provider_escalations WHERE status IN ('raised','acknowledged')),
    'overdue_count', (SELECT count(*) FROM public.provider_escalations
                       WHERE status IN ('raised','acknowledged') AND due_at < now()),
    'blocking_count', (SELECT count(*) FROM public.provider_escalations
                        WHERE status IN ('raised','acknowledged') AND blocks_booking)
  ) INTO v;
  RETURN v;
END;
$function$;

CREATE OR REPLACE FUNCTION public.provider_escalation_booking_check(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_account uuid := nullif(p->>'account_id','')::uuid; v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_account IS NULL THEN RAISE EXCEPTION 'ACCOUNT_REQUIRED'; END IF;
  SELECT jsonb_build_object(
    'account_id', v_account,
    'blocked', EXISTS (SELECT 1 FROM public.provider_escalations e
                        WHERE e.account_id = v_account AND e.blocks_booking
                          AND e.status IN ('raised','acknowledged')),
    'blockers', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'escalation_ref', e.escalation_ref, 'assigned_team', e.assigned_team,
        'summary', e.summary, 'due_at', e.due_at) ORDER BY e.due_at), '[]'::jsonb)
      FROM public.provider_escalations e
      WHERE e.account_id = v_account AND e.blocks_booking AND e.status IN ('raised','acknowledged'))
  ) INTO v;
  RETURN v;
END;
$function$;

REVOKE ALL ON FUNCTION public.provider_escalation_raise(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.provider_escalation_advance(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.provider_escalation_board(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.provider_escalation_booking_check(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_escalation_raise(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.provider_escalation_advance(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.provider_escalation_board(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.provider_escalation_booking_check(jsonb) TO authenticated, service_role;