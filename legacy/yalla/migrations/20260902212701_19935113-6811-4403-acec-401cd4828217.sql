-- Allow the audited freight_quotation_accept transaction to create the
-- consignment and legs for a customer's own quote, without loosening the
-- staff-permission requirement for direct external calls.
DO $mig$
DECLARE
  s_cc text;
  s_pl text;
  old_guard text := 'IF NOT public.has_staff_permission(''staff.logistics.manage'') THEN';
  new_guard text := 'IF NOT (public.has_staff_permission(''staff.logistics.manage'') OR current_setting(''yalla.freight_internal'', true) = ''on'') THEN';
BEGIN
  SELECT prosrc INTO s_cc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'freight_consignment_create';
  SELECT prosrc INTO s_pl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'freight_plan_legs';

  IF position(old_guard IN s_cc) = 0 OR position(old_guard IN s_pl) = 0 THEN
    RAISE EXCEPTION 'guard text not found — refusing to rewrite freight functions';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.freight_consignment_create(_order_id uuid, _profile jsonb, _items jsonb DEFAULT ''[]''::jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS %L',
    replace(s_cc, old_guard, new_guard));

  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.freight_plan_legs(_order_id uuid, _legs jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS %L',
    replace(s_pl, old_guard, new_guard));
END $mig$;

REVOKE ALL ON FUNCTION public.freight_consignment_create(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freight_consignment_create(uuid, jsonb, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.freight_plan_legs(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freight_plan_legs(uuid, jsonb) TO authenticated, service_role;

-- Re-declare acceptance with the scoped internal marker.
CREATE OR REPLACE FUNCTION public.freight_quotation_accept(
  _quote_id uuid,
  _pickup_window_start timestamptz DEFAULT NULL,
  _pickup_window_end timestamptz DEFAULT NULL,
  _idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  q public.freight_quotations;
  v_order_id uuid;
  v_order_number text;
  v_cargo jsonb;
  v_consignment jsonb;
  v_legs jsonb;
  v_staff boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;

  SELECT * INTO q FROM public.freight_quotations WHERE id = _quote_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', true, 'code', 'NOT_FOUND');
  END IF;

  v_staff := public.has_staff_permission('staff.logistics.manage');
  IF NOT v_staff AND q.customer_id IS DISTINCT FROM auth.uid() THEN
    RETURN jsonb_build_object('error', true, 'code', 'AUTHORIZATION_ERROR');
  END IF;

  IF q.status = 'CONVERTED' AND q.order_id IS NOT NULL THEN
    SELECT order_number INTO v_order_number FROM public.delivery_orders WHERE id = q.order_id;
    RETURN jsonb_build_object('error', false, 'code', 'DUPLICATE', 'replay', true,
      'order_id', q.order_id, 'order_number', v_order_number, 'quote_id', q.id);
  END IF;

  IF q.status <> 'ISSUED' THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_TRANSITION', 'status', q.status);
  END IF;

  IF q.valid_until <= now() THEN
    UPDATE public.freight_quotations SET status = 'EXPIRED' WHERE id = q.id;
    RETURN jsonb_build_object('error', true, 'code', 'QUOTE_EXPIRED', 'valid_until', q.valid_until);
  END IF;

  v_cargo := COALESCE(q.cargo, '{}'::jsonb);
  v_order_number := 'ORD-FRT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  INSERT INTO public.delivery_orders (
    order_number, module, customer_id, pickup_address, pickup_lat, pickup_lng,
    pickup_contact_name, pickup_contact_phone, pickup_window_start, pickup_window_end,
    status, total_amount, currency, payment_status, notes, metadata
  ) VALUES (
    v_order_number, 'freight', q.customer_id,
    q.origin_label,
    NULLIF(q.inputs->>'origin_lat','')::numeric,
    NULLIF(q.inputs->>'origin_lng','')::numeric,
    NULLIF(v_cargo->>'shipper_name',''), NULLIF(v_cargo->>'shipper_phone',''),
    _pickup_window_start, _pickup_window_end,
    'confirmed', q.total_amount, q.currency, 'pending',
    NULLIF(v_cargo->>'notes',''),
    jsonb_build_object(
      'offering_code', q.offering_code,
      'quote_id', q.id,
      'quote_number', q.quote_number,
      'rate_plan_id', q.rate_plan_id,
      'rate_plan_version', q.rate_plan_version,
      'pricing_version', q.pricing_version,
      'pricing_snapshot_hash', q.snapshot_hash,
      'pricing_lines', q.lines,
      'destination_label', q.destination_label,
      'distance_km', q.distance_km,
      'distance_basis', q.distance_basis,
      'vehicle_class', q.vehicle_class,
      'idempotency_key', NULLIF(_idempotency_key, '')
    )
  )
  RETURNING id INTO v_order_id;

  -- Scoped, transaction-local internal marker: the authorization decision was
  -- already made above against the quote owner / staff permission.
  PERFORM set_config('yalla.freight_internal', 'on', true);

  v_consignment := public.freight_consignment_create(
    v_order_id,
    v_cargo || jsonb_build_object('service_level', COALESCE(v_cargo->>'service_level', 'STANDARD')),
    COALESCE(q.items, '[]'::jsonb)
  );
  IF (v_consignment->>'error')::boolean THEN
    RAISE EXCEPTION 'CONSIGNMENT_FAILED: %', v_consignment::text;
  END IF;

  IF jsonb_array_length(COALESCE(q.planned_legs, '[]'::jsonb)) > 0 THEN
    v_legs := public.freight_plan_legs(v_order_id, q.planned_legs);
    IF (v_legs->>'error')::boolean THEN
      RAISE EXCEPTION 'LEG_PLAN_FAILED: %', v_legs::text;
    END IF;
  ELSE
    v_legs := jsonb_build_object('legs', 0);
  END IF;

  PERFORM set_config('yalla.freight_internal', 'off', true);

  UPDATE public.freight_quotations
  SET status = 'CONVERTED', accepted_at = now(), accepted_by = auth.uid(), order_id = v_order_id
  WHERE id = q.id;

  RETURN jsonb_build_object(
    'error', false, 'code', 'CONVERTED',
    'quote_id', q.id, 'order_id', v_order_id, 'order_number', v_order_number,
    'consignment_id', v_consignment->>'consignment_id',
    'consignment_number', v_consignment->>'consignment_number',
    'chargeable_weight_kg', v_consignment->>'chargeable_weight_kg',
    'items', (v_consignment->>'items')::integer,
    'legs', COALESCE((v_legs->>'legs')::integer, 0),
    'total_amount', q.total_amount, 'currency', q.currency
  );
END;
$$;

REVOKE ALL ON FUNCTION public.freight_quotation_accept(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freight_quotation_accept(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;