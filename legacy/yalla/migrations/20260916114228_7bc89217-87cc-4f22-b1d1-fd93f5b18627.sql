-- Public-safe projection of the published rate card: customer-facing rates only.
CREATE OR REPLACE VIEW public.v_public_asset_rate_card
WITH (security_invoker = off) AS
SELECT
  v.version,
  v.effective_from,
  b.asset_class,
  b.vehicle_key,
  b.label,
  b.fleet_group,
  b.seats,
  b.basis,
  b.category_code,
  b.service_code,
  b.base_kes,
  b.min_kes,
  b.max_kes,
  b.per_km_kes,
  b.extra_hour_kes,
  b.included_km_per_day,
  b.vat_pct
FROM public.asset_pricing_bands b
JOIN public.asset_pricing_versions v ON v.id = b.version_id
WHERE b.active AND v.status = 'published';

GRANT SELECT ON public.v_public_asset_rate_card TO anon, authenticated;

-- The underlying table stops being publicly readable.
DROP POLICY IF EXISTS "public read published asset pricing bands" ON public.asset_pricing_bands;
REVOKE SELECT ON public.asset_pricing_bands FROM anon;

COMMENT ON VIEW public.v_public_asset_rate_card IS
  'Customer-facing published rate card. Internal fee, discount, override-tolerance and demand-multiplier columns are deliberately excluded and remain staff-only on asset_pricing_bands.';