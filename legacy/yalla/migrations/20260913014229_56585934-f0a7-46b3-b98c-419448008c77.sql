-- Public projection of the PUBLISHED rental rate card.
GRANT SELECT (id, version, status, effective_from) ON public.asset_pricing_versions TO anon, authenticated;
GRANT SELECT (
  id, version_id, asset_class, vehicle_key, label, fleet_group, seats, basis,
  base_kes, min_kes, max_kes, per_km_kes, extra_hour_kes, included_km_per_day,
  corporate_discount_pct, weekend_multiplier, holiday_multiplier, peak_multiplier,
  max_demand_multiplier, platform_fee_pct, vat_pct, active
) ON public.asset_pricing_bands TO anon, authenticated;

DROP POLICY IF EXISTS "public read published asset pricing versions" ON public.asset_pricing_versions;
CREATE POLICY "public read published asset pricing versions"
  ON public.asset_pricing_versions FOR SELECT TO anon, authenticated
  USING (status = 'published');

DROP POLICY IF EXISTS "public read published asset pricing bands" ON public.asset_pricing_bands;
CREATE POLICY "public read published asset pricing bands"
  ON public.asset_pricing_bands FOR SELECT TO anon, authenticated
  USING (
    active
    AND EXISTS (
      SELECT 1 FROM public.asset_pricing_versions v
      WHERE v.id = asset_pricing_bands.version_id AND v.status = 'published'
    )
  );

-- Public projection of the live serviceability record: publishable offerings only,
-- publishable columns only. Capacity, compliance status, legal references,
-- activation authority and internal notes remain staff-only.
GRANT SELECT (
  offering_code, lifecycle, self_service_booking, enquiry_enabled,
  partner_eligibility_required, service_areas, operating_hours, pod_required,
  returns_policy, claims_policy, restricted_goods_policy,
  effective_from, expires_at, last_verified_at, updated_at
) ON public.logistics_service_config TO anon, authenticated;

DROP POLICY IF EXISTS "public read publishable logistics offerings" ON public.logistics_service_config;
CREATE POLICY "public read publishable logistics offerings"
  ON public.logistics_service_config FOR SELECT TO anon, authenticated
  USING (lifecycle IN ('BOOKABLE', 'ENQUIRY_ONLY'));
