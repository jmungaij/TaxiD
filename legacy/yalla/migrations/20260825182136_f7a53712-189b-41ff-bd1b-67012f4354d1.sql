-- 1) marketplace_surge_multipliers: remove public read, restrict to staff
DROP POLICY "surge readable by all" ON public.marketplace_surge_multipliers;
REVOKE SELECT ON public.marketplace_surge_multipliers FROM anon;

CREATE POLICY "surge multipliers staff read"
ON public.marketplace_surge_multipliers
FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','pricing_manager','operations_admin','dispatch_manager']::app_role[]));

-- 2) surge_rules: remove broad authenticated read, restrict to staff
DROP POLICY "surge_rules authenticated read" ON public.surge_rules;

CREATE POLICY "surge_rules staff read"
ON public.surge_rules
FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','pricing_manager','operations_admin','dispatch_manager']::app_role[]));

-- 3) Expose only the resolved effective multiplier (peak-hour average) for the
--    driver earnings simulator — the full rule set stays staff-only.
CREATE OR REPLACE FUNCTION public.active_surge_multiplier(p_city text, p_category_slug text)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(AVG(sr.multiplier), 1.0)::numeric
  FROM public.surge_rules sr
  WHERE sr.city = p_city
    AND sr.category_slug = p_category_slug
    AND MOD(sr.hour_of_week, 24) BETWEEN 7 AND 21;
$$;

REVOKE ALL ON FUNCTION public.active_surge_multiplier(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.active_surge_multiplier(text, text) TO anon, authenticated;