-- Make the public rate card view respect the querying user's RLS instead of
-- the view owner's (Supabase linter 0010 security_definer_view).
ALTER VIEW public.v_public_asset_rate_card SET (security_invoker = on);

-- Anonymous visitors may read only published, active band rows...
DROP POLICY IF EXISTS "public read published asset pricing bands" ON public.asset_pricing_bands;
CREATE POLICY "public read published asset pricing bands"
ON public.asset_pricing_bands
FOR SELECT
TO anon, authenticated
USING (
  active
  AND EXISTS (
    SELECT 1 FROM public.asset_pricing_versions v
    WHERE v.id = asset_pricing_bands.version_id
      AND v.status = 'published'
  )
);

-- ...and only the customer-facing columns. Internal commercial figures
-- (platform fee, corporate discount, multipliers, operator tolerance, notes)
-- stay pricing-team only via column-level privileges.
REVOKE SELECT ON public.asset_pricing_bands FROM anon;
GRANT SELECT (
  id, version_id, asset_class, vehicle_key, label, fleet_group, seats,
  basis, category_code, service_code, base_kes, min_kes, max_kes,
  per_km_kes, extra_hour_kes, included_km_per_day, vat_pct, active
) ON public.asset_pricing_bands TO anon;
GRANT SELECT ON public.asset_pricing_bands TO authenticated;
GRANT ALL ON public.asset_pricing_bands TO service_role;
GRANT SELECT ON public.v_public_asset_rate_card TO anon, authenticated;