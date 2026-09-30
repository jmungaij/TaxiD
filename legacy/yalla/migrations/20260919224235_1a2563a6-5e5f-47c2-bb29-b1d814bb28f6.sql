-- ============================================================================
-- 1. Operations bridge: real rides and parcel orders into the service feed
--    Matching is by the booker's verified email domain only. Nothing is guessed.
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS commercial_service_executions_external_ref_uk
  ON public.commercial_service_executions(external_reference)
  WHERE external_reference IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sales_operations_bridge_sync(p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_me uuid := public._my_staff_member_id();
  v_trips int := 0;
  v_parcels int := 0;
  v_unmatched int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_me IS NULL AND NOT public.has_staff_permission('staff.crm.manage') THEN
    RAISE EXCEPTION 'NOT_COMMERCIAL_STAFF';
  END IF;

  -- Rides: matched to the account that owns the rider's email domain.
  WITH src AS (
    SELECT t.id, t.booking_number, t.status, t.scheduled_for, t.created_at, t.started_at, t.completed_at,
           t.pickup_address, t.dropoff_address, t.total_fare, t.cancellation_reason, t.intent,
           a.id AS account_id, a.owner_staff_id
      FROM public.trip_bookings t
      JOIN auth.users u ON u.id = t.rider_user_id
      JOIN public.crm_accounts a
        ON a.email_domain IS NOT NULL
       AND lower(a.email_domain) = lower(split_part(u.email, '@', 2))
     WHERE NOT coalesce(a.is_test, false)
  ), up AS (
    INSERT INTO public.commercial_service_executions
      (account_id, owner_staff_id, service_type, passenger_or_recipient, origin, destination,
       scheduled_at, started_at, completed_at, status, value_kes, exception_reason, external_reference, recorded_by)
    SELECT s.account_id, s.owner_staff_id,
           CASE WHEN coalesce(s.pickup_address,'') || ' ' || coalesce(s.dropoff_address,'') ~* '(airport|jkia|wilson)'
                THEN 'AIRPORT_TRANSFER' ELSE 'STAFF_TRANSPORT' END,
           NULL, s.pickup_address, s.dropoff_address,
           coalesce(s.scheduled_for, s.created_at), s.started_at, s.completed_at,
           CASE s.status WHEN 'completed' THEN 'COMPLETED'
                         WHEN 'in_progress' THEN 'IN_PROGRESS'
                         WHEN 'cancelled' THEN 'CANCELLED'
                         ELSE 'SCHEDULED' END,
           s.total_fare,
           CASE WHEN s.status = 'cancelled'
                THEN coalesce(nullif(s.cancellation_reason,''), 'Ride cancelled in operations; no reason recorded')
                ELSE NULL END,
           'TRIP:' || s.id::text, auth.uid()
      FROM src s
    ON CONFLICT (external_reference) WHERE external_reference IS NOT NULL
    DO UPDATE SET status = excluded.status,
                  started_at = excluded.started_at,
                  completed_at = excluded.completed_at,
                  value_kes = excluded.value_kes,
                  exception_reason = excluded.exception_reason,
                  updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_trips FROM up;

  -- Parcel orders: matched the same way, through the ordering customer's email domain.
  WITH src AS (
    SELECT d.id, d.order_number, d.status::text AS status, d.pickup_window_start, d.created_at,
           d.pickup_address, d.pickup_contact_name, d.total_amount, d.sla_deadline,
           a.id AS account_id, a.owner_staff_id
      FROM public.delivery_orders d
      JOIN auth.users u ON u.id = d.customer_id
      JOIN public.crm_accounts a
        ON a.email_domain IS NOT NULL
       AND lower(a.email_domain) = lower(split_part(u.email, '@', 2))
     WHERE NOT coalesce(a.is_test, false)
  ), up AS (
    INSERT INTO public.commercial_service_executions
      (account_id, owner_staff_id, service_type, passenger_or_recipient, origin, destination,
       scheduled_at, completed_at, status, value_kes, exception_reason, external_reference, recorded_by)
    SELECT s.account_id, s.owner_staff_id, 'PARCEL_DELIVERY', s.pickup_contact_name, s.pickup_address, NULL,
           coalesce(s.pickup_window_start, s.created_at),
           CASE WHEN s.status IN ('delivered','closed') THEN s.created_at ELSE NULL END,
           CASE s.status WHEN 'delivered' THEN 'COMPLETED'
                         WHEN 'closed' THEN 'COMPLETED'
                         WHEN 'cancelled' THEN 'CANCELLED'
                         WHEN 'dispatched' THEN 'DISPATCHED'
                         WHEN 'in_transit' THEN 'IN_PROGRESS'
                         WHEN 'compliance_review' THEN 'DELAYED'
                         ELSE 'SCHEDULED' END,
           s.total_amount,
           CASE WHEN s.status = 'cancelled' THEN 'Parcel order cancelled in operations'
                WHEN s.status = 'compliance_review' THEN 'Held in compliance review; delivery not completed'
                ELSE NULL END,
           'DELIVERY:' || s.id::text, auth.uid()
      FROM src s
    ON CONFLICT (external_reference) WHERE external_reference IS NOT NULL
    DO UPDATE SET status = excluded.status,
                  completed_at = excluded.completed_at,
                  value_kes = excluded.value_kes,
                  exception_reason = excluded.exception_reason,
                  updated_at = now()
    RETURNING 1
  )
  SELECT count(*) INTO v_parcels FROM up;

  SELECT count(*) INTO v_unmatched FROM (
    SELECT t.id FROM public.trip_bookings t
      LEFT JOIN auth.users u ON u.id = t.rider_user_id
     WHERE NOT EXISTS (
       SELECT 1 FROM public.crm_accounts a
        WHERE a.email_domain IS NOT NULL
          AND lower(a.email_domain) = lower(split_part(coalesce(u.email,''), '@', 2)))
    UNION ALL
    SELECT d.id FROM public.delivery_orders d
      LEFT JOIN auth.users u ON u.id = d.customer_id
     WHERE NOT EXISTS (
       SELECT 1 FROM public.crm_accounts a
        WHERE a.email_domain IS NOT NULL
          AND lower(a.email_domain) = lower(split_part(coalesce(u.email,''), '@', 2)))
  ) q;

  RETURN jsonb_build_object(
    'synced_at', now(),
    'rides_recorded', v_trips,
    'parcels_recorded', v_parcels,
    'unmatched_operations', v_unmatched
  );
END $fn$;

REVOKE ALL ON FUNCTION public.sales_operations_bridge_sync(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_operations_bridge_sync(jsonb) TO authenticated, service_role;

-- Operational records that cannot be matched to a customer account, for review.
CREATE OR REPLACE FUNCTION public.sales_operations_bridge_review(p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_me uuid := public._my_staff_member_id();
  v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_me IS NULL AND NOT public.has_staff_permission('staff.crm.manage') THEN
    RAISE EXCEPTION 'NOT_COMMERCIAL_STAFF';
  END IF;

  SELECT jsonb_build_object('generated_at', now(), 'items', coalesce(jsonb_agg(x), '[]'::jsonb)) INTO v
  FROM (
    SELECT jsonb_build_object(
             'kind', 'RIDE', 'reference', t.booking_number, 'status', t.status,
             'when', coalesce(t.scheduled_for, t.created_at),
             'booked_by_domain', nullif(split_part(coalesce(u.email,''), '@', 2), ''),
             'reason', CASE WHEN u.email IS NULL THEN 'No booking email recorded'
                            ELSE 'No customer account carries this email domain' END) AS x
      FROM public.trip_bookings t
      LEFT JOIN auth.users u ON u.id = t.rider_user_id
     WHERE NOT EXISTS (SELECT 1 FROM public.crm_accounts a
                        WHERE a.email_domain IS NOT NULL
                          AND lower(a.email_domain) = lower(split_part(coalesce(u.email,''), '@', 2)))
     ORDER BY coalesce(t.scheduled_for, t.created_at) DESC
     LIMIT 40
  ) q;
  RETURN v;
END $fn$;

REVOKE ALL ON FUNCTION public.sales_operations_bridge_review(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_operations_bridge_review(jsonb) TO authenticated, service_role;

-- ============================================================================
-- 2. Contracts shared but not signed — pending revenue, never counted
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sales_contracts_awaiting_signature(p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_me uuid := public._my_staff_member_id();
  v_staff uuid := coalesce(nullif(p->>'staff','')::uuid, v_me);
  v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_staff IS NULL THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  IF v_staff <> v_me AND NOT public.has_staff_permission('staff.crm.manage') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  SELECT jsonb_build_object('generated_at', now(), 'contracts', coalesce(jsonb_agg(x ORDER BY ord), '[]'::jsonb)) INTO v
  FROM (
    SELECT c.created_at AS ord, jsonb_build_object(
             'contract_id', c.id,
             'contract_number', c.contract_number,
             'customer', c.customer_legal_name,
             'account_id', c.account_id,
             'status', c.status,
             'value_amount', c.value_amount,
             'currency', c.currency,
             'shared_on', l.contract_shared_at,
             'awaiting', coalesce(l.awaiting_item, 'Signed copy of the Mobility Service Contract'),
             'awaiting_since', coalesce(l.contract_shared_at, c.updated_at),
             'signature_recorded', (c.signature_date IS NOT NULL OR c.execution_date IS NOT NULL)
           ) AS x
      FROM public.commercial_contract_instances c
      LEFT JOIN public.sales_leads l ON l.id = c.lead_id
     WHERE c.owner_staff_id = v_staff
       AND NOT coalesce(c.is_test, false)
       AND c.signature_date IS NULL
       AND c.execution_date IS NULL
  ) q;
  RETURN v;
END $fn$;

REVOKE ALL ON FUNCTION public.sales_contracts_awaiting_signature(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_contracts_awaiting_signature(jsonb) TO authenticated, service_role;

-- ============================================================================
-- 3. Seed an activation assignment from the contract's own recorded facts
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sales_activation_seed(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_me uuid := public._my_staff_member_id();
  v_contract public.commercial_contract_instances;
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO v_contract FROM public.commercial_contract_instances WHERE id = (p->>'contract_id')::uuid;
  IF v_contract.id IS NULL THEN RAISE EXCEPTION 'CONTRACT_NOT_FOUND'; END IF;
  IF v_contract.owner_staff_id <> v_me AND NOT public.has_staff_permission('staff.crm.manage') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  IF v_contract.owner_staff_id IS NULL THEN RAISE EXCEPTION 'CONTRACT_HAS_NO_OWNER'; END IF;

  SELECT id INTO v_id FROM public.commercial_activation_assignments
   WHERE contract_id = v_contract.id AND assignment_role = 'ACCOUNT_MANAGER'
     AND staff_member_id = v_contract.owner_staff_id LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.commercial_activation_assignments
      (contract_id, account_id, assignment_role, staff_member_id, person_label, start_date, end_date, status, notes, created_by)
    SELECT v_contract.id, v_contract.account_id, 'ACCOUNT_MANAGER', v_contract.owner_staff_id, sm.full_name,
           coalesce(v_contract.term_start, v_contract.effective_date, v_contract.activated_at::date),
           v_contract.term_end, 'ACTIVE',
           'Placed from the contract record: owner and term dates as recorded on the contract.', auth.uid()
      FROM public.staff_members sm WHERE sm.id = v_contract.owner_staff_id
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('assignment_id', v_id, 'contract_id', v_contract.id);
END $fn$;

REVOKE ALL ON FUNCTION public.sales_activation_seed(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_activation_seed(jsonb) TO authenticated, service_role;

-- ============================================================================
-- 4. Manager desk: add each specialist's day, and the manager's own figures
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sales_manager_desk(p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := public._my_staff_member_id();
  v_month_start date := date_trunc('month', now())::date;
  v_today date := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_me IS NULL AND NOT public.has_staff_permission('staff.crm.manage') THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  IF NOT public.has_staff_permission('staff.crm.manage')
     AND NOT EXISTS (SELECT 1 FROM public.staff_members WHERE manager_staff_id = v_me) THEN
    RAISE EXCEPTION 'NOT_A_SALES_MANAGER';
  END IF;

  WITH team AS (
    SELECT sm.id, sm.full_name, sm.user_id, op.title AS position_title
      FROM public.staff_members sm
      LEFT JOIN public.org_positions op ON op.id = sm.position_id
     WHERE sm.employment_status IN ('active','onboarding')
       AND (sm.manager_staff_id = v_me OR (public.has_staff_permission('staff.crm.manage')
            AND op.code IN ('YML-SAL-CSS-001','SLS-MOB','SLS-SUP','SLS-PRT','SLS-LEAD')))
  )
  SELECT jsonb_build_object(
    'manager_staff_id', v_me,
    'generated_at', now(),
    'month_start', v_month_start,
    'today', v_today,
    'team_target_kes', coalesce((SELECT sum(public.sales_target_for(t.id, v_month_start)) FROM team t), 0),
    'my_kpis', jsonb_build_object(
      'staff_id', v_me,
      'full_name', (SELECT full_name FROM public.staff_members WHERE id = v_me),
      'own_target_kes', public.sales_target_for(v_me, v_month_start),
      'team_size', (SELECT count(*) FROM team),
      'team_leads_open', (SELECT count(*) FROM public.sales_leads l JOIN team t ON t.id = l.sales_staff_id
                            WHERE NOT coalesce(l.is_test,false)
                              AND l.stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')),
      'team_new_customers_today', (SELECT count(*) FROM public.sales_leads l JOIN team t ON t.id = l.sales_staff_id
                            WHERE NOT coalesce(l.is_test,false)
                              AND (l.created_at AT TIME ZONE 'Africa/Nairobi')::date = v_today),
      'team_outreach_today', (SELECT count(*) FROM public.sales_leads l JOIN team t ON t.id = l.sales_staff_id
                            WHERE NOT coalesce(l.is_test,false)
                              AND (l.last_outreach_at AT TIME ZONE 'Africa/Nairobi')::date = v_today),
      'team_won_month_kes', coalesce((SELECT sum(l.won_revenue_kes) FROM public.sales_leads l JOIN team t ON t.id = l.sales_staff_id
                            WHERE NOT coalesce(l.is_test,false) AND l.stage = 'CLOSED_WON' AND l.closed_at >= v_month_start), 0),
      'team_collected_month_cents', coalesce((SELECT sum(r.amount_cents) FROM public.payment_receipts r
                            JOIN public.tax_invoices i ON i.id = r.invoice_id
                            JOIN team t ON t.id = i.owner_staff_id
                            WHERE coalesce(r.status,'recorded') <> 'void' AND r.received_on >= v_month_start), 0),
      'team_outstanding_cents', coalesce((SELECT sum(i.total_cents - i.paid_cents) FROM public.tax_invoices i
                            JOIN team t ON t.id = i.owner_staff_id
                            WHERE i.status IN ('issued','sent','part_paid')), 0),
      'team_exceptions_open', (SELECT count(*) FROM public.commercial_signals s
                            WHERE s.signal_type = 'service_exception' AND s.status IN ('open','acknowledged')
                              AND (s.owner_user_id IN (SELECT user_id FROM team) OR s.owner_user_id IS NULL)),
      'team_services_completed_today', (SELECT count(*) FROM public.commercial_service_executions e
                            JOIN team t ON t.id = e.owner_staff_id
                            WHERE e.status = 'COMPLETED'
                              AND (coalesce(e.completed_at, e.scheduled_at) AT TIME ZONE 'Africa/Nairobi')::date = v_today),
      'team_contracts_awaiting_signature', (SELECT count(*) FROM public.commercial_contract_instances c
                            JOIN team t ON t.id = c.owner_staff_id
                            WHERE NOT coalesce(c.is_test,false) AND c.signature_date IS NULL AND c.execution_date IS NULL)
    ),
    'people', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'staff_id', t.id, 'full_name', t.full_name, 'position', t.position_title,
        'target_kes', public.sales_target_for(t.id, v_month_start),
        'leads_total', (SELECT count(*) FROM public.sales_leads l WHERE l.sales_staff_id = t.id AND NOT coalesce(l.is_test,false)),
        'leads_open', (SELECT count(*) FROM public.sales_leads l WHERE l.sales_staff_id = t.id
                         AND NOT coalesce(l.is_test,false) AND l.stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')),
        'leads_untouched', (SELECT count(*) FROM public.sales_leads l WHERE l.sales_staff_id = t.id
                         AND NOT coalesce(l.is_test,false) AND l.stage = 'NEW'),
        'open_pipeline_kes', coalesce((SELECT sum(l.estimated_value_kes) FROM public.sales_leads l
                         WHERE l.sales_staff_id = t.id AND NOT coalesce(l.is_test,false)
                           AND l.stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')), 0),
        'won_month_kes', coalesce((SELECT sum(l.won_revenue_kes) FROM public.sales_leads l
                         WHERE l.sales_staff_id = t.id AND NOT coalesce(l.is_test,false)
                           AND l.stage = 'CLOSED_WON' AND l.closed_at >= v_month_start), 0),
        'invoiced_month_cents', coalesce((SELECT sum(i.total_cents) FROM public.tax_invoices i
                         WHERE i.owner_staff_id = t.id AND i.status <> 'cancelled' AND i.issued_at >= v_month_start), 0),
        'collected_month_cents', coalesce((SELECT sum(r.amount_cents) FROM public.payment_receipts r
                         JOIN public.tax_invoices i ON i.id = r.invoice_id
                         WHERE i.owner_staff_id = t.id AND coalesce(r.status,'recorded') <> 'void'
                           AND r.received_on >= v_month_start), 0),
        'outstanding_cents', coalesce((SELECT sum(i.total_cents - i.paid_cents) FROM public.tax_invoices i
                         WHERE i.owner_staff_id = t.id AND i.status IN ('issued','sent','part_paid')), 0),
        'service_exceptions_open', (SELECT count(*) FROM public.commercial_signals s
                         WHERE s.signal_type = 'service_exception' AND s.status IN ('open','acknowledged')
                           AND s.owner_user_id = t.user_id),
        'contracts_awaiting_signature', (SELECT count(*) FROM public.commercial_contract_instances c
                         WHERE c.owner_staff_id = t.id AND NOT coalesce(c.is_test,false)
                           AND c.signature_date IS NULL AND c.execution_date IS NULL),
        'today', jsonb_build_object(
          'new_customers', (SELECT count(*) FROM public.sales_leads l WHERE l.sales_staff_id = t.id
                         AND NOT coalesce(l.is_test,false)
                         AND (l.created_at AT TIME ZONE 'Africa/Nairobi')::date = v_today),
          'outreach', (SELECT count(*) FROM public.sales_leads l WHERE l.sales_staff_id = t.id
                         AND (l.last_outreach_at AT TIME ZONE 'Africa/Nairobi')::date = v_today),
          'replies', (SELECT count(*) FROM public.sales_leads l WHERE l.sales_staff_id = t.id
                         AND (l.last_reply_at AT TIME ZONE 'Africa/Nairobi')::date = v_today),
          'won_kes', coalesce((SELECT sum(l.won_revenue_kes) FROM public.sales_leads l WHERE l.sales_staff_id = t.id
                         AND l.stage = 'CLOSED_WON'
                         AND (l.closed_at AT TIME ZONE 'Africa/Nairobi')::date = v_today), 0),
          'collected_cents', coalesce((SELECT sum(r.amount_cents) FROM public.payment_receipts r
                         JOIN public.tax_invoices i ON i.id = r.invoice_id
                         WHERE i.owner_staff_id = t.id AND coalesce(r.status,'recorded') <> 'void'
                           AND r.received_on = v_today), 0),
          'services_completed', (SELECT count(*) FROM public.commercial_service_executions e
                         WHERE e.owner_staff_id = t.id AND e.status = 'COMPLETED'
                           AND (coalesce(e.completed_at, e.scheduled_at) AT TIME ZONE 'Africa/Nairobi')::date = v_today),
          'service_issues', (SELECT count(*) FROM public.commercial_service_executions e
                         WHERE e.owner_staff_id = t.id AND e.status IN ('DELAYED','FAILED','CANCELLED')
                           AND (e.updated_at AT TIME ZONE 'Africa/Nairobi')::date = v_today)
        ),
        'last_activity_at', (SELECT max(l.updated_at) FROM public.sales_leads l WHERE l.sales_staff_id = t.id)
      ) ORDER BY t.full_name) FROM team t
    ), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $function$;
