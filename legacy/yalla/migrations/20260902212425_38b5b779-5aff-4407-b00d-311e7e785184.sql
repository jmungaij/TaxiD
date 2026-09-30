-- =====================================================================
-- Stage 2 — shipper-side freight quotation → booking conversion
-- =====================================================================

CREATE TABLE public.freight_quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number text NOT NULL UNIQUE,
  customer_id uuid,
  offering_code text NOT NULL DEFAULT 'FREIGHT_CARGO',
  status text NOT NULL DEFAULT 'ISSUED',
  -- commercial outcome
  currency text NOT NULL DEFAULT 'KES',
  base_amount numeric(14,2) NOT NULL,
  surcharges_amount numeric(14,2) NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL,
  lines jsonb NOT NULL,
  rate_plan_id text NOT NULL,
  rate_plan_version integer NOT NULL,
  rate_source text NOT NULL DEFAULT 'TARIFF',
  pricing_version text NOT NULL,
  snapshot_hash text NOT NULL,
  -- operational facts the quote was priced from
  inputs jsonb NOT NULL,
  origin_label text NOT NULL,
  destination_label text NOT NULL,
  distance_km numeric(10,2),
  distance_basis text,
  vehicle_class text,
  hub_transfers integer NOT NULL DEFAULT 0,
  cargo jsonb NOT NULL DEFAULT '{}',
  items jsonb NOT NULL DEFAULT '[]',
  planned_legs jsonb NOT NULL DEFAULT '[]',
  -- lifecycle
  valid_until timestamptz NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  accepted_by uuid,
  rejected_at timestamptz,
  rejection_reason text,
  order_id uuid REFERENCES public.delivery_orders(id) ON DELETE SET NULL,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT freight_quotations_status CHECK (status IN ('ISSUED','ACCEPTED','CONVERTED','REJECTED','EXPIRED')),
  CONSTRAINT freight_quotations_total_positive CHECK (total_amount > 0),
  CONSTRAINT freight_quotations_amounts_nonneg CHECK (base_amount >= 0 AND surcharges_amount >= 0 AND tax_amount >= 0)
);

GRANT SELECT ON public.freight_quotations TO authenticated;
GRANT ALL ON public.freight_quotations TO service_role;
ALTER TABLE public.freight_quotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY freight_quotations_read ON public.freight_quotations
FOR SELECT TO authenticated
USING (customer_id = auth.uid() OR public.has_staff_permission('staff.logistics.read'));

CREATE INDEX freight_quotations_customer_idx ON public.freight_quotations(customer_id, issued_at DESC);
CREATE INDEX freight_quotations_status_idx ON public.freight_quotations(status, valid_until);
CREATE TRIGGER freight_quotations_touch BEFORE UPDATE ON public.freight_quotations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------
-- Quote → booking → shipment conversion (single transaction)
-- ---------------------------------------------------------------------
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

  -- Idempotent replay: an already-converted quote returns its order.
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

  -- Freight consignment + handling units inherit the quoted facts (no re-entry).
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
    'legs', (v_legs->>'legs')::integer,
    'total_amount', q.total_amount, 'currency', q.currency
  );
END;
$$;

REVOKE ALL ON FUNCTION public.freight_quotation_accept(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.freight_quotation_accept(uuid, timestamptz, timestamptz, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.freight_quotations_expire_lapsed()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.freight_quotations
  SET status = 'EXPIRED'
  WHERE status = 'ISSUED' AND valid_until <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.freight_quotations_expire_lapsed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.freight_quotations_expire_lapsed() TO service_role;