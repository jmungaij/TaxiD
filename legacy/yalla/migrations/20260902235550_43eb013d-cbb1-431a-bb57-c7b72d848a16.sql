CREATE OR REPLACE FUNCTION public.freight_route_revenue_close(_instance_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
      'charge_code', 'FREIGHT_LINE_HAUL',
      'basis', 'PER_LOAD',
      'quantity', 1,
      'unit_rate', v_quote.total_amount - COALESCE(v_quote.tax_amount,0),
      'tax_amount', COALESCE(v_quote.tax_amount,0),
      'currency', COALESCE(v_quote.currency,'KES'),
      'reason_code', 'ROUTE_INSTANCE_COMPLETED',
      'commercial_snapshot', jsonb_build_object(
        'quotation_id', v_quote.id,
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
END $function$;

REVOKE ALL ON FUNCTION public.freight_route_revenue_close(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.freight_route_revenue_close(uuid) TO service_role;