-- ============================================================ execution layer
CREATE OR REPLACE FUNCTION public.freight_route_instance_execute(
  _instance_id uuid,
  _event text,                      -- PICKUP | DEPART | IN_TRANSIT | ARRIVE | DELIVER | COMPLETE
  _reason text DEFAULT NULL,
  _idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst public.freight_route_instances;
  v_from text; v_to text;
  v_legs integer := 0;
  v_close jsonb;
BEGIN
  IF NOT (public.has_staff_permission('staff.logistics.manage')
          OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;

  SELECT * INTO v_inst FROM public.freight_route_instances WHERE id = _instance_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'INSTANCE_NOT_FOUND'); END IF;
  v_from := v_inst.status;

  v_to := CASE upper(_event)
    WHEN 'PICKUP'     THEN 'DISPATCHED'
    WHEN 'DEPART'     THEN 'DEPARTED'
    WHEN 'IN_TRANSIT' THEN 'IN_TRANSIT'
    WHEN 'ARRIVE'     THEN 'ARRIVED'
    WHEN 'DELIVER'    THEN 'ARRIVED'
    WHEN 'COMPLETE'   THEN 'COMPLETED'
    ELSE NULL END;
  IF v_to IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code', 'UNKNOWN_EVENT', 'detail', _event);
  END IF;

  -- Capacity and a locked manifest must exist before a truck can move.
  IF upper(_event) IN ('PICKUP','DEPART') AND v_inst.vehicle_id IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code', 'NO_ASSIGNED_CAPACITY',
      'detail', 'No truck and driver are assigned to this departure.');
  END IF;
  IF upper(_event) = 'DEPART' AND v_inst.manifest_locked_at IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code', 'MANIFEST_NOT_LOCKED',
      'detail', 'The manifest must be locked before departure.');
  END IF;
  IF upper(_event) = 'COMPLETE' AND v_inst.actual_arrival IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code', 'NOT_ARRIVED',
      'detail', 'A departure cannot be completed before it has arrived.');
  END IF;

  -- Idempotent event stream: the same key never produces a second effect.
  IF NULLIF(_idempotency_key,'') IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.freight_route_events
        WHERE route_instance_id = _instance_id
          AND metadata->>'idempotency_key' = _idempotency_key) THEN
    RETURN jsonb_build_object('error', false, 'code', 'DUPLICATE', 'replay', true,
      'status', v_inst.status);
  END IF;

  UPDATE public.freight_route_instances SET
    status = v_to,
    actual_departure = CASE WHEN upper(_event) = 'DEPART' THEN COALESCE(actual_departure, now()) ELSE actual_departure END,
    actual_arrival   = CASE WHEN upper(_event) IN ('ARRIVE','DELIVER') THEN COALESCE(actual_arrival, now()) ELSE actual_arrival END,
    completed_at     = CASE WHEN upper(_event) = 'COMPLETE' THEN COALESCE(completed_at, now()) ELSE completed_at END,
    updated_at = now()
  WHERE id = _instance_id RETURNING * INTO v_inst;

  -- Keep the connected shipment legs in step with the physical movement.
  WITH touched AS (
    UPDATE public.logistics_order_legs l SET
      status = CASE upper(_event)
        WHEN 'PICKUP' THEN 'AT_PICKUP'
        WHEN 'DEPART' THEN 'DEPARTED'
        WHEN 'IN_TRANSIT' THEN 'IN_TRANSIT'
        WHEN 'ARRIVE' THEN 'ARRIVED'
        WHEN 'DELIVER' THEN 'ARRIVED'
        WHEN 'COMPLETE' THEN 'COMPLETED'
        ELSE l.status END,
      vehicle_id = COALESCE(v_inst.vehicle_id, l.vehicle_id),
      driver_id = COALESCE(v_inst.driver_id, l.driver_id),
      actual_departure = CASE WHEN upper(_event) = 'DEPART' THEN COALESCE(l.actual_departure, now()) ELSE l.actual_departure END,
      actual_arrival = CASE WHEN upper(_event) IN ('ARRIVE','DELIVER','COMPLETE') THEN COALESCE(l.actual_arrival, now()) ELSE l.actual_arrival END,
      updated_at = now()
     WHERE l.id IN (
       SELECT DISTINCT ll.id
         FROM public.freight_route_allocations a
         JOIN public.logistics_order_legs ll ON ll.order_id = a.order_id
        WHERE a.route_instance_id = _instance_id AND a.status NOT IN ('RELEASED','CANCELLED'))
    RETURNING 1)
  SELECT count(*) INTO v_legs FROM touched;

  INSERT INTO public.freight_route_events (
    route_instance_id, route_id, event_type, previous_status, new_status, actor_id, actor_role, reason, metadata)
  VALUES (_instance_id, v_inst.route_id, 'EXECUTION_' || upper(_event), v_from, v_to, auth.uid(),
          'operations', _reason,
          jsonb_build_object('legs_synced', v_legs, 'vehicle_id', v_inst.vehicle_id,
                             'driver_id', v_inst.driver_id,
                             'idempotency_key', NULLIF(_idempotency_key,'')));

  IF upper(_event) = 'COMPLETE' THEN
    v_close := public.freight_route_revenue_close(_instance_id);
  END IF;

  RETURN jsonb_build_object('error', false, 'code', 'EXECUTED', 'event', upper(_event),
    'instance_code', v_inst.instance_code, 'from_status', v_from, 'status', v_inst.status,
    'legs_synced', v_legs, 'financial_closure', v_close);
END $$;

-- ====================================================== revenue closure layer
CREATE OR REPLACE FUNCTION public.freight_route_revenue_close(_instance_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inst public.freight_route_instances;
  a RECORD;
  v_quote public.freight_quotations;
  v_res jsonb;
  v_created integer := 0; v_dupes integer := 0; v_skipped integer := 0;
  v_total numeric := 0;
  v_charges jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_inst FROM public.freight_route_instances WHERE id = _instance_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'INSTANCE_NOT_FOUND'); END IF;

  FOR a IN
    SELECT * FROM public.freight_route_allocations
     WHERE route_instance_id = _instance_id AND status NOT IN ('RELEASED','CANCELLED')
  LOOP
    -- The price comes ONLY from the customer's own accepted quotation snapshot.
    SELECT * INTO v_quote FROM public.freight_quotations
     WHERE (a.quote_id IS NOT NULL AND id = a.quote_id) OR (a.quote_id IS NULL AND order_id = a.order_id)
     ORDER BY accepted_at DESC NULLS LAST LIMIT 1;

    IF v_quote.id IS NULL OR COALESCE(v_quote.total_amount,0) <= 0 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    v_res := public.freight_charge_create(jsonb_build_object(
      'party', 'CUSTOMER',
      'customer_user_id', a.customer_id,
      'order_id', a.order_id,
      'quote_id', v_quote.id,
      'charge_code', 'FREIGHT_LINE_HAUL',
      'basis', 'PER_LOAD',
      'quantity', 1,
      'unit_rate', v_quote.total_amount - COALESCE(v_quote.tax_amount,0),
      'tax_amount', COALESCE(v_quote.tax_amount,0),
      'currency', COALESCE(v_quote.currency,'KES'),
      'reason_code', 'ROUTE_INSTANCE_COMPLETED',
      'commercial_snapshot', jsonb_build_object(
        'quote_number', v_quote.quote_number, 'snapshot_hash', v_quote.snapshot_hash,
        'rate_plan_id', v_quote.rate_plan_id, 'rate_plan_version', v_quote.rate_plan_version,
        'pricing_version', v_quote.pricing_version),
      'operational_evidence', jsonb_build_object(
        'route_instance_id', _instance_id, 'instance_code', v_inst.instance_code,
        'allocation_code', a.allocation_code,
        'allocated_weight_kg', a.allocated_weight_kg,
        'actual_departure', v_inst.actual_departure, 'actual_arrival', v_inst.actual_arrival,
        'vehicle_id', v_inst.vehicle_id, 'driver_id', v_inst.driver_id),
      'idempotency_key', 'route-revenue:' || a.id::text));

    IF COALESCE((v_res->>'duplicate')::boolean, false) THEN v_dupes := v_dupes + 1;
    ELSE v_created := v_created + 1; END IF;
    v_total := v_total + COALESCE((v_res->>'amount')::numeric, 0);
    v_charges := v_charges || jsonb_build_array(jsonb_build_object(
      'allocation_code', a.allocation_code, 'charge_number', v_res->>'charge_number',
      'amount', v_res->>'amount', 'duplicate', COALESCE((v_res->>'duplicate')::boolean,false)));
  END LOOP;

  RETURN jsonb_build_object('error', false,
    'code', CASE WHEN v_skipped > 0 THEN 'PARTIAL_CLOSURE' ELSE 'REVENUE_CLOSED' END,
    'charges_created', v_created, 'charges_replayed', v_dupes,
    'allocations_without_price', v_skipped,
    'revenue_total', v_total, 'charges', v_charges);
END $$;

-- ============================================================= margin view
CREATE OR REPLACE VIEW public.v_freight_route_financials
WITH (security_invoker = true) AS
SELECT
  i.id                                AS route_instance_id,
  i.instance_code,
  r.route_code,
  r.route_name,
  i.service_date,
  i.status,
  i.vehicle_class,
  i.planned_capacity_kg,
  i.reserved_capacity_kg,
  CASE WHEN i.planned_capacity_kg > 0
       THEN round(100 * i.reserved_capacity_kg / i.planned_capacity_kg, 1) END AS utilisation_pct,
  i.allocation_count,
  COALESCE(rev.charged, 0)            AS revenue_charged,
  COALESCE(rev.invoiced, 0)           AS revenue_invoiced,
  COALESCE(rev.paid, 0)               AS revenue_paid,
  COALESCE(cost.cost_amount, 0)       AS cost_charged,
  COALESCE(rev.charged, 0) - COALESCE(cost.cost_amount, 0) AS margin_amount,
  CASE WHEN COALESCE(rev.charged,0) > 0
       THEN round(100 * (COALESCE(rev.charged,0) - COALESCE(cost.cost_amount,0)) / rev.charged, 1) END AS margin_pct,
  (SELECT count(*) FROM public.freight_route_exceptions e
    WHERE e.route_instance_id = i.id AND e.status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')) AS open_exceptions
FROM public.freight_route_instances i
JOIN public.freight_repeat_routes r ON r.id = i.route_id
LEFT JOIN LATERAL (
  SELECT sum(c.amount + c.tax_amount) AS charged,
         sum(COALESCE(l.amount,0) + COALESCE(l.tax_amount,0)) AS invoiced,
         sum(COALESCE(p.paid,0)) AS paid
    FROM public.freight_charges c
    LEFT JOIN public.freight_invoice_lines l ON l.charge_id = c.id
    LEFT JOIN LATERAL (
      SELECT sum(pa.amount) AS paid FROM public.freight_payment_allocations pa
       WHERE pa.invoice_id = l.invoice_id AND pa.reversed_at IS NULL
         AND pa.state IN ('ALLOCATED','PARTIAL','OVERPAYMENT')) p ON true
   WHERE c.party = 'CUSTOMER' AND c.status <> 'VOID'
     AND c.operational_evidence->>'route_instance_id' = i.id::text) rev ON true
LEFT JOIN LATERAL (
  SELECT sum(c2.amount + c2.tax_amount) AS cost_amount
    FROM public.freight_charges c2
   WHERE c2.party = 'CARRIER' AND c2.status <> 'VOID'
     AND c2.operational_evidence->>'route_instance_id' = i.id::text) cost ON true;

GRANT SELECT ON public.v_freight_route_financials TO authenticated;
GRANT SELECT ON public.v_freight_route_financials TO service_role;

-- ================================================ sell-side reconciliation
CREATE OR REPLACE FUNCTION public.freight_route_revenue_recon(
  _from timestamptz, _to timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  actor uuid := public._freight_fin_guard('staff.finance.audit.run');
  run_id uuid; n integer := 0; e integer := 0; crit integer := 0;
  r RECORD; rc text; sev public.freight_finding_severity; variance numeric;
BEGIN
  IF _to <= _from THEN RAISE EXCEPTION 'invalid window'; END IF;
  INSERT INTO public.freight_recon_runs (window_start, window_end, triggered_by)
  VALUES (_from, _to, actor) RETURNING id INTO run_id;

  FOR r IN
    SELECT a.id alloc_id, a.allocation_code, a.order_id, a.customer_id,
           a.allocated_weight_kg, i.instance_code, i.status inst_status,
           COALESCE(q.total_amount, 0) AS expected,
           COALESCE((SELECT sum(c.amount + c.tax_amount) FROM public.freight_charges c
                      WHERE c.order_id = a.order_id AND c.party = 'CUSTOMER' AND c.status <> 'VOID'
                        AND c.operational_evidence->>'route_instance_id' = i.id::text), 0) AS charged,
           COALESCE((SELECT sum(l.amount + l.tax_amount) FROM public.freight_invoice_lines l
                      JOIN public.freight_charges c2 ON c2.id = l.charge_id
                     WHERE c2.order_id = a.order_id AND c2.party = 'CUSTOMER'
                       AND c2.operational_evidence->>'route_instance_id' = i.id::text), 0) AS invoiced,
           COALESCE((SELECT sum(pa.amount) FROM public.freight_payment_allocations pa
                      JOIN public.freight_invoice_lines l2 ON l2.invoice_id = pa.invoice_id
                      JOIN public.freight_charges c3 ON c3.id = l2.charge_id
                     WHERE pa.reversed_at IS NULL AND pa.state IN ('ALLOCATED','PARTIAL','OVERPAYMENT')
                       AND c3.order_id = a.order_id AND c3.party = 'CUSTOMER'
                       AND c3.operational_evidence->>'route_instance_id' = i.id::text), 0) AS paid
      FROM public.freight_route_allocations a
      JOIN public.freight_route_instances i ON i.id = a.route_instance_id
      LEFT JOIN public.freight_quotations q
             ON q.id = a.quote_id OR (a.quote_id IS NULL AND q.order_id = a.order_id)
     WHERE a.status NOT IN ('RELEASED','CANCELLED')
       AND a.created_at >= _from AND a.created_at < _to
  LOOP
    n := n + 1;
    rc := NULL; sev := 'MINOR'; variance := r.charged - r.expected;

    IF r.inst_status = 'COMPLETED' AND r.charged = 0 THEN
      rc := 'EXECUTED_NOT_CHARGED'; sev := 'CRITICAL';
    ELSIF r.charged > 0 AND abs(variance) > 0.01 THEN
      rc := 'EXPECTED_VS_CHARGED_VARIANCE'; sev := 'MAJOR';
    ELSIF r.charged > 0 AND r.invoiced = 0 THEN
      rc := 'CHARGED_NOT_INVOICED'; sev := 'MAJOR';
    ELSIF r.invoiced > 0 AND r.paid = 0 THEN
      rc := 'INVOICED_NOT_PAID'; sev := 'MINOR';
    ELSIF r.paid - r.invoiced > 0.01 THEN
      rc := 'PAID_EXCEEDS_INVOICED'; sev := 'MAJOR';
    END IF;

    IF rc IS NOT NULL THEN
      e := e + 1;
      IF sev = 'CRITICAL' THEN crit := crit + 1; END IF;
      INSERT INTO public.freight_recon_exceptions (
        run_id, order_id, reason_code, severity, expected_amount, charged_amount,
        invoiced_amount, paid_amount, variance_amount, detail, evidence)
      VALUES (run_id, r.order_id, rc, sev, r.expected, r.charged, r.invoiced, r.paid, variance,
        format('Route allocation %s on departure %s: %s.', r.allocation_code, r.instance_code, rc),
        jsonb_build_object('allocation_id', r.alloc_id, 'allocation_code', r.allocation_code,
                           'instance_code', r.instance_code, 'instance_status', r.inst_status,
                           'allocated_weight_kg', r.allocated_weight_kg, 'source', 'ROUTE_REVENUE'));
    END IF;
  END LOOP;

  UPDATE public.freight_recon_runs SET bookings_examined = n, exceptions_found = e,
         critical_count = crit, completed_at = now() WHERE id = run_id;

  RETURN jsonb_build_object('ok', true, 'run_id', run_id, 'allocations_examined', n,
    'exceptions_found', e, 'critical', crit);
END $$;

REVOKE ALL ON FUNCTION public.freight_route_revenue_close(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.freight_route_revenue_close(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.freight_route_instance_execute(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freight_route_instance_execute(uuid, text, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.freight_route_revenue_recon(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freight_route_revenue_recon(timestamptz, timestamptz) TO authenticated, service_role;