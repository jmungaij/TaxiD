CREATE OR REPLACE FUNCTION public.freight_route_revenue_recon(_from timestamp with time zone, _to timestamp with time zone)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
           a.allocated_weight_kg, i.instance_code, i.status inst_status, i.id inst_id,
           COALESCE(q.total_amount, 0) AS expected,
           COALESCE((SELECT sum(c.amount + c.tax_amount) FROM public.freight_charges c
                      WHERE c.order_id = a.order_id AND c.party = 'CUSTOMER' AND c.status <> 'VOID'
                        AND c.operational_evidence->>'route_instance_id' = i.id::text), 0) AS charged,
           COALESCE((SELECT sum(l.amount + l.tax_amount) FROM public.freight_invoice_lines l
                      JOIN public.freight_charges c2 ON c2.id = l.charge_id
                     WHERE c2.order_id = a.order_id AND c2.party = 'CUSTOMER' AND c2.status <> 'VOID'
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

  UPDATE public.freight_recon_runs SET transactions_scanned = n, exceptions = e,
         critical = crit, balanced = (e = 0) WHERE id = run_id;

  RETURN jsonb_build_object('ok', true, 'run_id', run_id, 'allocations_examined', n,
    'exceptions_found', e, 'critical', crit, 'balanced', (e = 0));
END $function$;

REVOKE ALL ON FUNCTION public.freight_route_revenue_recon(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freight_route_revenue_recon(timestamptz, timestamptz) TO authenticated, service_role;