-- 1. Fixed search path on the append-only guard.
CREATE OR REPLACE FUNCTION public._provider_booking_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'provider booking events are append-only';
END;
$$;

-- 2. city_pricing_rules — internal cost inputs restricted to pricing/finance staff.
DROP POLICY IF EXISTS "city_pricing authenticated read" ON public.city_pricing_rules;

CREATE POLICY "city_pricing staff read"
  ON public.city_pricing_rules
  FOR SELECT
  TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin','pricing_manager','operations_admin','director','general_manager']::app_role[])
    OR public.has_staff_permission('staff.commercial.read')
  );

-- 3. pricing_models — remove anonymous read of the whole table; publish a
--    narrow read-only feed for the public driver earnings simulator instead.
DROP POLICY IF EXISTS "pricing_models public read" ON public.pricing_models;

CREATE POLICY "pricing_models staff read"
  ON public.pricing_models
  FOR SELECT
  TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin','pricing_manager','operations_admin','director','general_manager']::app_role[])
    OR public.has_staff_permission('staff.commercial.read')
  );

CREATE OR REPLACE FUNCTION public.pricing_models_public()
RETURNS TABLE (
  category_slug text, currency text,
  base_fare numeric, per_km numeric, per_min numeric,
  minimum_fare numeric, booking_fee numeric, commission_pct numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT category_slug, currency, base_fare, per_km, per_min,
         minimum_fare, booking_fee, commission_pct
  FROM public.pricing_models
  WHERE is_active = true
    AND (effective_from IS NULL OR effective_from <= now())
    AND (effective_to IS NULL OR effective_to > now())
$$;

REVOKE ALL ON FUNCTION public.pricing_models_public() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pricing_models_public() TO anon, authenticated;

-- 4. regulatory_caps — compliance register limited to admins and legal staff.
DROP POLICY IF EXISTS "reg caps readable" ON public.regulatory_caps;

CREATE POLICY "reg caps staff read"
  ON public.regulatory_caps
  FOR SELECT
  TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin','compliance_admin','director','general_manager']::app_role[])
    OR public.has_staff_permission('staff.legal.read')
    OR public.has_staff_permission('staff.commercial.read')
  );
