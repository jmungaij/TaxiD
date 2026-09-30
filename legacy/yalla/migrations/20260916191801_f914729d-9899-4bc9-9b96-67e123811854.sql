-- Narrow public exposure of the pricing version register to customer-facing columns only.
REVOKE SELECT ON public.asset_pricing_versions FROM anon, authenticated;
GRANT SELECT (id, version, code, status, currency, effective_from) ON public.asset_pricing_versions TO anon, authenticated;

-- Bands: keep only the customer-facing band columns readable publicly.
REVOKE SELECT ON public.asset_pricing_bands FROM anon, authenticated;
GRANT SELECT (
  id, version_id, active, asset_class, vehicle_key, label, fleet_group, seats,
  basis, category_code, service_code, base_kes, min_kes, max_kes, per_km_kes,
  extra_hour_kes, included_km_per_day, vat_pct
) ON public.asset_pricing_bands TO anon, authenticated;

-- Pricing team / service role keep full access.
GRANT SELECT ON public.asset_pricing_versions TO service_role;
GRANT SELECT ON public.asset_pricing_bands TO service_role;