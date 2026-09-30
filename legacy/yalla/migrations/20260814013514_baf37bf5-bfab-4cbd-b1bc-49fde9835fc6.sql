-- =====================================================================
-- Governed asset pricing bands (Engine B → Postgres)
-- =====================================================================

CREATE TABLE public.asset_pricing_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL DEFAULT 'YALLA-ASSET-BANDS',
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','under_review','approved','published','superseded','archived')),
  currency text NOT NULL DEFAULT 'KES',
  effective_from timestamptz NOT NULL DEFAULT now(),
  note text NOT NULL DEFAULT '',
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  published_by uuid,
  published_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);

GRANT SELECT, INSERT, UPDATE ON public.asset_pricing_versions TO authenticated;
GRANT ALL ON public.asset_pricing_versions TO service_role;
ALTER TABLE public.asset_pricing_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read asset pricing versions" ON public.asset_pricing_versions
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "admin insert asset pricing versions" ON public.asset_pricing_versions
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());
CREATE POLICY "admin update asset pricing versions" ON public.asset_pricing_versions
  FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE TRIGGER trg_asset_pricing_versions_touch
  BEFORE UPDATE ON public.asset_pricing_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- One band per vehicle per version. `category_code` / `service_code` bind the
-- band to the published rate-card vocabulary so a band can never price a
-- service the rate card does not recognise.
CREATE TABLE public.asset_pricing_bands (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  version_id uuid NOT NULL REFERENCES public.asset_pricing_versions(id) ON DELETE CASCADE,
  asset_class text NOT NULL,
  vehicle_key text NOT NULL,
  label text NOT NULL,
  fleet_group text NOT NULL DEFAULT 'van',
  seats integer NOT NULL DEFAULT 1 CHECK (seats > 0),
  basis text NOT NULL DEFAULT 'day_plus_mileage'
    CHECK (basis IN ('block_hour','day','day_plus_mileage','voyage_day')),
  category_code text REFERENCES public.commercial_vehicle_categories(code) ON DELETE SET NULL,
  service_code text NOT NULL DEFAULT 'day_trip',
  base_kes numeric(14,2) NOT NULL CHECK (base_kes > 0),
  min_kes numeric(14,2) NOT NULL CHECK (min_kes > 0),
  max_kes numeric(14,2) NOT NULL CHECK (max_kes > 0),
  per_km_kes numeric(12,2) NOT NULL DEFAULT 0 CHECK (per_km_kes >= 0),
  extra_hour_kes numeric(12,2) NOT NULL DEFAULT 0 CHECK (extra_hour_kes >= 0),
  included_km_per_day integer NOT NULL DEFAULT 0 CHECK (included_km_per_day >= 0),
  corporate_discount_pct numeric(6,3) NOT NULL DEFAULT 0 CHECK (corporate_discount_pct BETWEEN 0 AND 50),
  weekend_multiplier numeric(6,3) NOT NULL DEFAULT 1 CHECK (weekend_multiplier BETWEEN 0.5 AND 3),
  holiday_multiplier numeric(6,3) NOT NULL DEFAULT 1 CHECK (holiday_multiplier BETWEEN 0.5 AND 3),
  peak_multiplier numeric(6,3) NOT NULL DEFAULT 1 CHECK (peak_multiplier BETWEEN 0.5 AND 3),
  max_demand_multiplier numeric(6,3) NOT NULL DEFAULT 1 CHECK (max_demand_multiplier BETWEEN 0.5 AND 3),
  platform_fee_pct numeric(6,3) NOT NULL DEFAULT 0 CHECK (platform_fee_pct BETWEEN 0 AND 40),
  vat_pct numeric(6,3) NOT NULL DEFAULT 0 CHECK (vat_pct BETWEEN 0 AND 30),
  operator_override_tolerance_pct numeric(6,3) NOT NULL DEFAULT 25 CHECK (operator_override_tolerance_pct BETWEEN 0 AND 100),
  active boolean NOT NULL DEFAULT true,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, vehicle_key),
  CONSTRAINT asset_pricing_bands_band_order CHECK (max_kes >= min_kes),
  CONSTRAINT asset_pricing_bands_base_in_band CHECK (base_kes BETWEEN min_kes AND max_kes)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_pricing_bands TO authenticated;
GRANT ALL ON public.asset_pricing_bands TO service_role;
ALTER TABLE public.asset_pricing_bands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read asset pricing bands" ON public.asset_pricing_bands
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "admin write asset pricing bands" ON public.asset_pricing_bands
  FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE INDEX idx_asset_pricing_bands_version ON public.asset_pricing_bands(version_id, asset_class);

CREATE TRIGGER trg_asset_pricing_bands_touch
  BEFORE UPDATE ON public.asset_pricing_bands
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Third-party charge catalogue per asset class (parking, tolls, marina, …).
CREATE TABLE public.asset_pricing_fee_components (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  version_id uuid NOT NULL REFERENCES public.asset_pricing_versions(id) ON DELETE CASCADE,
  asset_class text NOT NULL,
  fee_key text NOT NULL,
  label text NOT NULL,
  unit text NOT NULL CHECK (unit IN ('per_trip','per_day','per_night','per_km','per_movement','per_passenger','per_hour')),
  amount_kes numeric(12,2) NOT NULL CHECK (amount_kes >= 0),
  optional boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, asset_class, fee_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_pricing_fee_components TO authenticated;
GRANT ALL ON public.asset_pricing_fee_components TO service_role;
ALTER TABLE public.asset_pricing_fee_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read asset fee components" ON public.asset_pricing_fee_components
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "admin write asset fee components" ON public.asset_pricing_fee_components
  FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE TRIGGER trg_asset_pricing_fee_components_touch
  BEFORE UPDATE ON public.asset_pricing_fee_components
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================================
-- Read model: the configuration in force
-- =====================================================================

CREATE OR REPLACE FUNCTION public.asset_pricing_active_config()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH v AS (
    SELECT * FROM public.asset_pricing_versions
    WHERE status = 'published' AND effective_from <= now()
    ORDER BY effective_from DESC, version DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'version_id', (SELECT id FROM v),
    'version', (SELECT version FROM v),
    'code', (SELECT code FROM v),
    'status', (SELECT status FROM v),
    'currency', COALESCE((SELECT currency FROM v), 'KES'),
    'effective_from', (SELECT effective_from FROM v),
    'note', (SELECT note FROM v),
    'bands', COALESCE((
      SELECT jsonb_agg(to_jsonb(b) ORDER BY b.seats, b.vehicle_key)
      FROM public.asset_pricing_bands b
      WHERE b.version_id = (SELECT id FROM v) AND b.active
    ), '[]'::jsonb),
    'fees', COALESCE((
      SELECT jsonb_agg(to_jsonb(f) ORDER BY f.asset_class, f.fee_key)
      FROM public.asset_pricing_fee_components f
      WHERE f.version_id = (SELECT id FROM v) AND f.active
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.asset_pricing_active_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.asset_pricing_active_config() TO authenticated, service_role, anon;

-- =====================================================================
-- Authoritative server-side asset calculation
-- =====================================================================

CREATE OR REPLACE FUNCTION public.asset_pricing_calculate(p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version   public.asset_pricing_versions;
  v_band      public.asset_pricing_bands;
  v_days      numeric := GREATEST(1, COALESCE((p_input->>'days')::numeric, 1));
  v_nights    numeric := GREATEST(0, COALESCE((p_input->>'nights')::numeric, 0));
  v_km        numeric := GREATEST(0, COALESCE((p_input->>'distance_km')::numeric, 0));
  v_pax       numeric := GREATEST(0, COALESCE((p_input->>'passengers')::numeric, 0));
  v_hours     numeric := GREATEST(0, COALESCE((p_input->>'extra_hours')::numeric, 0));
  v_day_type  text    := COALESCE(p_input->>'day_type', 'standard');
  v_override  numeric := NULLIF(p_input->>'base_override_kes', '')::numeric;
  v_fee_keys  text[]  := COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_input->'fee_keys')), '{}'::text[]);
  v_corporate boolean := COALESCE((p_input->>'corporate')::boolean, false);
  v_lines     jsonb   := '[]'::jsonb;
  v_base      numeric;
  v_clamped   boolean := false;
  v_mult      numeric := 1;
  v_billable_km numeric;
  v_distance  numeric := 0;
  v_hourly    numeric := 0;
  v_fees      numeric := 0;
  v_subtotal  numeric;
  v_discount  numeric := 0;
  v_fee_amt   numeric;
  v_platform  numeric;
  v_vat       numeric;
  v_total     numeric;
  r           record;
BEGIN
  SELECT * INTO v_version FROM public.asset_pricing_versions
  WHERE status = 'published' AND effective_from <= now()
  ORDER BY effective_from DESC, version DESC LIMIT 1;

  IF v_version.id IS NULL THEN
    RETURN jsonb_build_object('status','NO_PUBLISHED_VERSION');
  END IF;

  SELECT * INTO v_band FROM public.asset_pricing_bands
  WHERE version_id = v_version.id AND active
    AND vehicle_key = COALESCE(p_input->>'vehicle_key', '')
  LIMIT 1;

  IF v_band.id IS NULL THEN
    RETURN jsonb_build_object('status','NO_BAND', 'requested', p_input);
  END IF;

  -- Base rate: operator overrides are clamped to the governed band.
  v_base := COALESCE(v_override, v_band.base_kes);
  IF v_base < v_band.min_kes THEN v_base := v_band.min_kes; v_clamped := true; END IF;
  IF v_base > v_band.max_kes THEN v_base := v_band.max_kes; v_clamped := true; END IF;

  v_mult := CASE v_day_type
    WHEN 'weekend' THEN v_band.weekend_multiplier
    WHEN 'holiday' THEN v_band.holiday_multiplier
    WHEN 'peak'    THEN v_band.peak_multiplier
    ELSE 1 END;

  v_lines := v_lines || jsonb_build_object(
    'kind','base','code','base_rate','label','Base ' || v_band.label || ' rate',
    'amount', ROUND(v_base * v_days * v_mult, 2),
    'reason', v_days || ' × governed day rate' ||
      CASE WHEN v_mult <> 1 THEN ' × ' || v_mult || ' (' || v_day_type || ')' ELSE '' END ||
      CASE WHEN v_clamped THEN ' (clamped to band)' ELSE '' END);

  v_billable_km := GREATEST(0, v_km - (v_band.included_km_per_day * v_days));
  v_distance := ROUND(v_billable_km * v_band.per_km_kes, 2);
  IF v_distance > 0 THEN
    v_lines := v_lines || jsonb_build_object('kind','distance','code','distance','label','Distance',
      'amount', v_distance, 'reason', v_billable_km || ' km beyond ' ||
      (v_band.included_km_per_day * v_days) || ' included km');
  END IF;

  v_hourly := ROUND(v_hours * v_band.extra_hour_kes, 2);
  IF v_hourly > 0 THEN
    v_lines := v_lines || jsonb_build_object('kind','extra_hours','code','extra_hours','label','Extra hours',
      'amount', v_hourly, 'reason', v_hours || ' × governed hourly rate');
  END IF;

  FOR r IN
    SELECT * FROM public.asset_pricing_fee_components
    WHERE version_id = v_version.id AND active AND asset_class = v_band.asset_class
      AND (NOT optional OR fee_key = ANY(v_fee_keys))
    ORDER BY fee_key
  LOOP
    v_fee_amt := ROUND(r.amount_kes * CASE r.unit
      WHEN 'per_day' THEN v_days
      WHEN 'per_night' THEN v_nights
      WHEN 'per_km' THEN v_km
      WHEN 'per_passenger' THEN v_pax
      WHEN 'per_hour' THEN v_hours
      WHEN 'per_movement' THEN 2
      ELSE 1 END, 2);
    IF v_fee_amt > 0 THEN
      v_fees := v_fees + v_fee_amt;
      v_lines := v_lines || jsonb_build_object('kind','fee','code', r.fee_key, 'label', r.label,
        'amount', v_fee_amt, 'reason', r.unit);
    END IF;
  END LOOP;

  v_subtotal := ROUND(v_base * v_days * v_mult, 2) + v_distance + v_hourly + v_fees;

  IF v_corporate AND v_band.corporate_discount_pct > 0 THEN
    v_discount := ROUND(v_subtotal * v_band.corporate_discount_pct / 100, 2);
    v_lines := v_lines || jsonb_build_object('kind','discount','code','corporate_framework',
      'label','Corporate framework discount', 'amount', -v_discount,
      'reason', v_band.corporate_discount_pct || '% of operator cost');
  END IF;

  v_platform := ROUND((v_subtotal - v_discount) * v_band.platform_fee_pct / 100, 2);
  IF v_platform > 0 THEN
    v_lines := v_lines || jsonb_build_object('kind','commission','code','platform_commission',
      'label','Platform commission', 'amount', v_platform,
      'reason', v_band.platform_fee_pct || '% marketplace commission');
  END IF;

  v_vat := ROUND((v_subtotal - v_discount + v_platform) * v_band.vat_pct / 100, 2);
  IF v_vat > 0 THEN
    v_lines := v_lines || jsonb_build_object('kind','tax','code','vat','label','VAT',
      'amount', v_vat, 'reason', v_band.vat_pct || '% VAT');
  END IF;

  v_total := v_subtotal - v_discount + v_platform + v_vat;

  RETURN jsonb_build_object(
    'status','OK',
    'currency', v_version.currency,
    'version', v_version.version,
    'version_id', v_version.id,
    'vehicle_key', v_band.vehicle_key,
    'asset_class', v_band.asset_class,
    'category_code', v_band.category_code,
    'service_code', v_band.service_code,
    'base', ROUND(v_base * v_days * v_mult, 2),
    'base_clamped', v_clamped,
    'distance_total', v_distance,
    'extra_hours_total', v_hourly,
    'fees_total', v_fees,
    'operator_cost', v_subtotal,
    'discount_total', v_discount,
    'commission_total', v_platform,
    'tax_total', v_vat,
    'total', v_total,
    'per_seat', CASE WHEN v_band.seats > 0 THEN ROUND(v_total / v_band.seats, 2) ELSE NULL END,
    'lines', v_lines,
    'calculated_at', now(),
    'requested', p_input
  );
END;
$$;

REVOKE ALL ON FUNCTION public.asset_pricing_calculate(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.asset_pricing_calculate(jsonb) TO authenticated, service_role, anon;

-- =====================================================================
-- Version lifecycle (draft → under_review → approved → published)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.asset_pricing_create_draft(p_note text DEFAULT '')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source uuid;
  v_id uuid;
  v_next integer;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only platform administrators may draft pricing versions';
  END IF;

  SELECT id INTO v_source FROM public.asset_pricing_versions
  WHERE status = 'published' ORDER BY version DESC LIMIT 1;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next FROM public.asset_pricing_versions;

  INSERT INTO public.asset_pricing_versions(version, status, note, created_by)
  VALUES (v_next, 'draft', COALESCE(p_note, ''), auth.uid())
  RETURNING id INTO v_id;

  IF v_source IS NOT NULL THEN
    INSERT INTO public.asset_pricing_bands(
      version_id, asset_class, vehicle_key, label, fleet_group, seats, basis,
      category_code, service_code, base_kes, min_kes, max_kes, per_km_kes, extra_hour_kes,
      included_km_per_day, corporate_discount_pct, weekend_multiplier, holiday_multiplier,
      peak_multiplier, max_demand_multiplier, platform_fee_pct, vat_pct,
      operator_override_tolerance_pct, active, note)
    SELECT v_id, asset_class, vehicle_key, label, fleet_group, seats, basis,
      category_code, service_code, base_kes, min_kes, max_kes, per_km_kes, extra_hour_kes,
      included_km_per_day, corporate_discount_pct, weekend_multiplier, holiday_multiplier,
      peak_multiplier, max_demand_multiplier, platform_fee_pct, vat_pct,
      operator_override_tolerance_pct, active, note
    FROM public.asset_pricing_bands WHERE version_id = v_source;

    INSERT INTO public.asset_pricing_fee_components(
      version_id, asset_class, fee_key, label, unit, amount_kes, optional, active)
    SELECT v_id, asset_class, fee_key, label, unit, amount_kes, optional, active
    FROM public.asset_pricing_fee_components WHERE version_id = v_source;
  END IF;

  INSERT INTO public.pricing_audit_events(actor_id, action, entity, entity_id, reason, new_value)
  VALUES (auth.uid(), 'asset_bands_draft_created', 'asset_pricing_versions', v_id,
          COALESCE(p_note, ''), jsonb_build_object('version', v_next, 'cloned_from', v_source));

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.asset_pricing_create_draft(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.asset_pricing_create_draft(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.asset_pricing_set_status(
  p_version_id uuid, p_status text, p_reason text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v public.asset_pricing_versions;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only platform administrators may govern pricing versions';
  END IF;

  SELECT * INTO v FROM public.asset_pricing_versions WHERE id = p_version_id;
  IF v.id IS NULL THEN RAISE EXCEPTION 'Pricing version not found'; END IF;

  IF p_status NOT IN ('under_review','approved','published','archived') THEN
    RAISE EXCEPTION 'Unsupported pricing status %', p_status;
  END IF;

  IF p_status = 'published' THEN
    IF v.status <> 'approved' THEN
      RAISE EXCEPTION 'A pricing version must be approved before it can be published';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.asset_pricing_bands WHERE version_id = v.id AND active) THEN
      RAISE EXCEPTION 'A pricing version cannot be published without any active bands';
    END IF;
    UPDATE public.asset_pricing_versions
      SET status = 'superseded', superseded_at = now()
      WHERE status = 'published' AND id <> v.id;
    UPDATE public.asset_pricing_versions
      SET status = 'published', published_by = auth.uid(), published_at = now(),
          effective_from = GREATEST(effective_from, now())
      WHERE id = v.id;
  ELSIF p_status = 'approved' THEN
    IF v.created_by IS NOT NULL AND v.created_by = auth.uid() THEN
      RAISE EXCEPTION 'Separation of duties: a pricing version cannot be approved by its author';
    END IF;
    UPDATE public.asset_pricing_versions
      SET status = 'approved', approved_by = auth.uid(), approved_at = now()
      WHERE id = v.id;
  ELSE
    UPDATE public.asset_pricing_versions SET status = p_status WHERE id = v.id;
  END IF;

  INSERT INTO public.pricing_audit_events(actor_id, action, entity, entity_id, reason,
    previous_value, new_value)
  VALUES (auth.uid(), 'asset_bands_' || p_status, 'asset_pricing_versions', v.id,
    COALESCE(p_reason, ''), jsonb_build_object('status', v.status),
    jsonb_build_object('status', p_status));

  SELECT * INTO v FROM public.asset_pricing_versions WHERE id = p_version_id;
  RETURN to_jsonb(v);
END;
$$;

REVOKE ALL ON FUNCTION public.asset_pricing_set_status(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.asset_pricing_set_status(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.asset_pricing_save_band(p_band jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version_id uuid := (p_band->>'version_id')::uuid;
  v_status text;
  v_id uuid;
  v_prev jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only platform administrators may edit pricing bands';
  END IF;

  SELECT status INTO v_status FROM public.asset_pricing_versions WHERE id = v_version_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Pricing version not found'; END IF;
  IF v_status NOT IN ('draft','under_review') THEN
    RAISE EXCEPTION 'Only draft or under-review versions can be edited (this version is %)', v_status;
  END IF;

  SELECT to_jsonb(b) INTO v_prev FROM public.asset_pricing_bands b
  WHERE b.version_id = v_version_id AND b.vehicle_key = p_band->>'vehicle_key';

  INSERT INTO public.asset_pricing_bands(
    version_id, asset_class, vehicle_key, label, fleet_group, seats, basis,
    category_code, service_code, base_kes, min_kes, max_kes, per_km_kes, extra_hour_kes,
    included_km_per_day, corporate_discount_pct, weekend_multiplier, holiday_multiplier,
    peak_multiplier, max_demand_multiplier, platform_fee_pct, vat_pct,
    operator_override_tolerance_pct, active, note)
  VALUES (
    v_version_id,
    p_band->>'asset_class',
    p_band->>'vehicle_key',
    p_band->>'label',
    COALESCE(p_band->>'fleet_group', 'van'),
    COALESCE((p_band->>'seats')::integer, 1),
    COALESCE(p_band->>'basis', 'day_plus_mileage'),
    NULLIF(p_band->>'category_code', ''),
    COALESCE(NULLIF(p_band->>'service_code', ''), 'day_trip'),
    (p_band->>'base_kes')::numeric,
    (p_band->>'min_kes')::numeric,
    (p_band->>'max_kes')::numeric,
    COALESCE((p_band->>'per_km_kes')::numeric, 0),
    COALESCE((p_band->>'extra_hour_kes')::numeric, 0),
    COALESCE((p_band->>'included_km_per_day')::integer, 0),
    COALESCE((p_band->>'corporate_discount_pct')::numeric, 0),
    COALESCE((p_band->>'weekend_multiplier')::numeric, 1),
    COALESCE((p_band->>'holiday_multiplier')::numeric, 1),
    COALESCE((p_band->>'peak_multiplier')::numeric, 1),
    COALESCE((p_band->>'max_demand_multiplier')::numeric, 1),
    COALESCE((p_band->>'platform_fee_pct')::numeric, 0),
    COALESCE((p_band->>'vat_pct')::numeric, 0),
    COALESCE((p_band->>'operator_override_tolerance_pct')::numeric, 25),
    COALESCE((p_band->>'active')::boolean, true),
    COALESCE(p_band->>'note', ''))
  ON CONFLICT (version_id, vehicle_key) DO UPDATE SET
    asset_class = EXCLUDED.asset_class,
    label = EXCLUDED.label,
    fleet_group = EXCLUDED.fleet_group,
    seats = EXCLUDED.seats,
    basis = EXCLUDED.basis,
    category_code = EXCLUDED.category_code,
    service_code = EXCLUDED.service_code,
    base_kes = EXCLUDED.base_kes,
    min_kes = EXCLUDED.min_kes,
    max_kes = EXCLUDED.max_kes,
    per_km_kes = EXCLUDED.per_km_kes,
    extra_hour_kes = EXCLUDED.extra_hour_kes,
    included_km_per_day = EXCLUDED.included_km_per_day,
    corporate_discount_pct = EXCLUDED.corporate_discount_pct,
    weekend_multiplier = EXCLUDED.weekend_multiplier,
    holiday_multiplier = EXCLUDED.holiday_multiplier,
    peak_multiplier = EXCLUDED.peak_multiplier,
    max_demand_multiplier = EXCLUDED.max_demand_multiplier,
    platform_fee_pct = EXCLUDED.platform_fee_pct,
    vat_pct = EXCLUDED.vat_pct,
    operator_override_tolerance_pct = EXCLUDED.operator_override_tolerance_pct,
    active = EXCLUDED.active,
    note = EXCLUDED.note
  RETURNING id INTO v_id;

  INSERT INTO public.pricing_audit_events(actor_id, action, entity, entity_id, reason,
    previous_value, new_value)
  VALUES (auth.uid(), CASE WHEN v_prev IS NULL THEN 'asset_band_created' ELSE 'asset_band_updated' END,
    'asset_pricing_bands', v_id, COALESCE(p_band->>'reason', ''), v_prev, p_band);

  RETURN (SELECT to_jsonb(b) FROM public.asset_pricing_bands b WHERE b.id = v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.asset_pricing_save_band(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.asset_pricing_save_band(jsonb) TO authenticated, service_role;

-- =====================================================================
-- Booking breakdown from the frozen quote snapshot (no client arithmetic)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.pricing360_booking_breakdown(p_quote_ref text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.pricing_quote_snapshots;
  v_result jsonb;
  v_components jsonb;
  v_sum_kind jsonb;
BEGIN
  IF NOT public.is_staff_portal_member(auth.uid()) THEN
    RAISE EXCEPTION 'Staff portal membership is required to read pricing breakdowns';
  END IF;

  SELECT * INTO s FROM public.pricing_quote_snapshots
  WHERE quote_ref = p_quote_ref
  ORDER BY calculated_at DESC LIMIT 1;

  IF s.id IS NULL THEN
    RETURN jsonb_build_object('status','NO_SNAPSHOT','quote_ref', p_quote_ref);
  END IF;

  v_result := s.result;
  v_components := COALESCE(v_result->'components', '[]'::jsonb);

  SELECT jsonb_object_agg(kind, amount) INTO v_sum_kind
  FROM (
    SELECT c->>'kind' AS kind, SUM((c->>'amount')::numeric) AS amount
    FROM jsonb_array_elements(v_components) c
    GROUP BY 1
  ) g;

  RETURN jsonb_build_object(
    'status','OK',
    'snapshot_id', s.id,
    'quote_ref', s.quote_ref,
    'currency', s.currency,
    'total', s.total,
    'rate_card_version', s.rate_card_version,
    'rule_set_version', s.rule_set_version,
    'calculated_at', s.calculated_at,
    'base', COALESCE((v_result->>'base')::numeric, 0),
    'surcharge_total', COALESCE((v_sum_kind->>'surcharge')::numeric, 0),
    'commission_total', COALESCE((v_sum_kind->>'fee')::numeric, 0),
    'discount_total', COALESCE((v_sum_kind->>'discount')::numeric, 0),
    'tax_total', COALESCE((v_sum_kind->>'tax')::numeric, 0),
    'components', v_components,
    'inputs', s.inputs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pricing360_booking_breakdown(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pricing360_booking_breakdown(text) TO authenticated, service_role;