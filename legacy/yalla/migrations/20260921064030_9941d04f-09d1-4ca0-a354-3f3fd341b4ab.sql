-- Escalation board reads the customer account register.
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
        'customer_label', (SELECT coalesce(a.name, a.legal_name) FROM public.crm_accounts a WHERE a.id = e.account_id),
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

-- Escalations must point at a real customer account.
CREATE OR REPLACE FUNCTION public.provider_escalation_raise(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_staff uuid := public._my_staff_member_id();
  v_route public.provider_escalation_routes;
  v_account uuid := nullif(p->>'account_id','')::uuid;
  v_id uuid; v_ref text; v_due timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT (public.is_commercial_staff() OR public.has_staff_permission('staff.logistics.manage')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  SELECT * INTO v_route FROM public.provider_escalation_routes
   WHERE code = upper(coalesce(p->>'route_code','')) AND is_active;
  IF v_route.id IS NULL THEN RAISE EXCEPTION 'ROUTE_NOT_FOUND'; END IF;
  IF coalesce(btrim(p->>'summary'),'') = '' THEN RAISE EXCEPTION 'SUMMARY_REQUIRED'; END IF;
  IF v_account IS NULL THEN RAISE EXCEPTION 'ACCOUNT_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_accounts WHERE id = v_account) THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_FOUND';
  END IF;

  v_ref := 'ESC-' || to_char(now() AT TIME ZONE 'Africa/Nairobi','YYMMDD') || '-'
           || upper(substr(md5(gen_random_uuid()::text),1,5));
  v_due := now() + make_interval(mins => v_route.response_minutes);

  INSERT INTO public.provider_escalations (
    escalation_ref, route_id, account_id, signal_id, execution_id, provider_label,
    summary, severity, raised_by, raised_by_staff_id, assigned_team, due_at, blocks_booking
  ) VALUES (
    v_ref, v_route.id, v_account,
    nullif(p->>'signal_id','')::uuid, nullif(p->>'execution_id','')::uuid,
    nullif(btrim(coalesce(p->>'provider_label','')),''),
    btrim(p->>'summary'), coalesce(nullif(p->>'severity',''),'medium'),
    auth.uid(), v_staff, v_route.responsible_team, v_due, v_route.blocks_booking
  ) RETURNING id INTO v_id;

  IF nullif(p->>'signal_id','') IS NOT NULL THEN
    UPDATE public.commercial_signals
       SET status = 'acknowledged',
           status_note = 'Escalated to ' || v_route.responsible_team || ' (' || v_ref || ')',
           status_by = auth.uid(), status_at = now()
     WHERE id = (p->>'signal_id')::uuid AND status = 'open';
  END IF;

  RETURN jsonb_build_object('escalation_id', v_id, 'escalation_ref', v_ref,
    'assigned_team', v_route.responsible_team, 'due_at', v_due, 'blocks_booking', v_route.blocks_booking);
END;
$function$;

-- Booking gate: a new trip cannot be recorded while a blocking escalation is open.
CREATE OR REPLACE FUNCTION public.sales_service_execution_record(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_staff uuid := public._my_staff_member_id();
  v_id uuid := nullif(p->>'execution_id','')::uuid;
  v_ref text; v_status text := coalesce(nullif(p->>'status',''), 'SCHEDULED');
  v_account uuid := nullif(p->>'account_id','')::uuid;
  v_override text := nullif(btrim(coalesce(p->>'escalation_override_reason','')),'');
  v_blockers text;
  v_reason text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.is_linked_commercial_staff() THEN RAISE EXCEPTION 'NOT_COMMERCIAL_STAFF'; END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.commercial_service_executions SET
      status = v_status,
      exception_reason = coalesce(nullif(p->>'exception_reason',''), exception_reason),
      driver_label = coalesce(nullif(p->>'driver_label',''), driver_label),
      vehicle_label = coalesce(nullif(p->>'vehicle_label',''), vehicle_label),
      value_kes = coalesce(nullif(p->>'value_kes','')::numeric, value_kes),
      started_at = CASE WHEN v_status IN ('IN_PROGRESS','DISPATCHED') THEN coalesce(started_at, now()) ELSE started_at END,
      completed_at = CASE WHEN v_status = 'COMPLETED' THEN coalesce(completed_at, now()) ELSE completed_at END
    WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'EXECUTION_NOT_FOUND'; END IF;
    RETURN jsonb_build_object('execution_id', v_id, 'status', v_status);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.crm_accounts WHERE id = v_account) THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_FOUND';
  END IF;
  IF coalesce(p->>'service_type','') = '' THEN RAISE EXCEPTION 'SERVICE_TYPE_REQUIRED'; END IF;
  IF coalesce(p->>'scheduled_at','') = '' THEN RAISE EXCEPTION 'SCHEDULED_TIME_REQUIRED'; END IF;

  SELECT string_agg(e.escalation_ref || ' (' || e.assigned_team || ')', ', ' ORDER BY e.due_at)
    INTO v_blockers
    FROM public.provider_escalations e
   WHERE e.account_id = v_account AND e.blocks_booking AND e.status IN ('raised','acknowledged');

  IF v_blockers IS NOT NULL AND v_override IS NULL THEN
    RAISE EXCEPTION 'BOOKING_BLOCKED_BY_ESCALATION: %', v_blockers;
  END IF;

  v_reason := nullif(p->>'exception_reason','');
  IF v_blockers IS NOT NULL THEN
    v_reason := coalesce(v_reason || ' · ', '') || 'Booked over escalation ' || v_blockers || ': ' || v_override;
  END IF;

  v_ref := 'SVC-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 5));

  INSERT INTO public.commercial_service_executions (
    execution_ref, account_id, contract_id, owner_staff_id, service_type, passenger_or_recipient,
    origin, destination, scheduled_at, status, driver_label, vehicle_label, value_kes,
    exception_reason, external_reference, recorded_by
  ) VALUES (
    v_ref, v_account, nullif(p->>'contract_id','')::uuid,
    coalesce(nullif(p->>'owner_staff_id','')::uuid, v_staff), p->>'service_type',
    nullif(p->>'passenger_or_recipient',''), nullif(p->>'origin',''), nullif(p->>'destination',''),
    (p->>'scheduled_at')::timestamptz, v_status, nullif(p->>'driver_label',''), nullif(p->>'vehicle_label',''),
    nullif(p->>'value_kes','')::numeric, v_reason, nullif(p->>'external_reference',''),
    auth.uid()
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('execution_id', v_id, 'execution_ref', v_ref, 'status', v_status,
    'booked_over_escalation', v_blockers);
END $function$;