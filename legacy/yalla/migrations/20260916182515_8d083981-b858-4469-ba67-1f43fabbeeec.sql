-- 1. Signed-in users get customer-facing columns only; internal margin fields
--    are no longer readable directly by the authenticated role at all.
REVOKE SELECT ON public.asset_pricing_bands FROM authenticated;
GRANT SELECT (
  id, version_id, asset_class, vehicle_key, label, fleet_group, seats, basis,
  category_code, service_code, base_kes, min_kes, max_kes, per_km_kes,
  extra_hour_kes, included_km_per_day, vat_pct, active
) ON public.asset_pricing_bands TO authenticated;

-- 2. Pricing team reads full governed bands through a capability-checked service.
CREATE OR REPLACE FUNCTION public.asset_pricing_bands_internal(p_version_id uuid)
 RETURNS SETOF public.asset_pricing_bands
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_staff_permission('staff.pricing.read') THEN
    RAISE EXCEPTION 'not authorised';
  END IF;

  RETURN QUERY
  SELECT * FROM public.asset_pricing_bands b
   WHERE b.version_id = p_version_id
   ORDER BY b.seats, b.vehicle_key;
END;
$function$;

REVOKE ALL ON FUNCTION public.asset_pricing_bands_internal(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asset_pricing_bands_internal(uuid) TO authenticated, service_role;

-- 3. The shared active-configuration service no longer hands internal figures
--    to callers outside the pricing team, whatever surface calls it.
CREATE OR REPLACE FUNCTION public.asset_pricing_active_config()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_internal boolean := public.has_staff_permission('staff.pricing.read');
  v public.asset_pricing_versions;
  v_bands jsonb;
  v_fees jsonb;
  v_internal_keys text[] := ARRAY[
    'corporate_discount_pct','weekend_multiplier','holiday_multiplier',
    'peak_multiplier','max_demand_multiplier','platform_fee_pct',
    'operator_override_tolerance_pct','note','created_by','updated_by'];
BEGIN
  SELECT * INTO v FROM public.asset_pricing_versions
   WHERE status = 'published' AND effective_from <= now()
   ORDER BY effective_from DESC, version DESC
   LIMIT 1;

  SELECT COALESCE(jsonb_agg(row_json ORDER BY seats, vehicle_key), '[]'::jsonb)
    INTO v_bands
  FROM (
    SELECT b.seats, b.vehicle_key,
           CASE WHEN v_internal THEN to_jsonb(b)
                ELSE to_jsonb(b) - v_internal_keys END AS row_json
      FROM public.asset_pricing_bands b
     WHERE b.version_id = v.id AND b.active
  ) s;

  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.asset_class, f.fee_key), '[]'::jsonb)
    INTO v_fees
  FROM public.asset_pricing_fee_components f
   WHERE f.version_id = v.id AND f.active
     AND v_internal;

  RETURN jsonb_build_object(
    'version_id', v.id,
    'version', v.version,
    'code', v.code,
    'status', v.status,
    'currency', COALESCE(v.currency, 'KES'),
    'effective_from', v.effective_from,
    'note', CASE WHEN v_internal THEN v.note ELSE NULL END,
    'internal_visible', v_internal,
    'bands', COALESCE(v_bands, '[]'::jsonb),
    'fees', COALESCE(v_fees, '[]'::jsonb)
  );
END;
$function$;