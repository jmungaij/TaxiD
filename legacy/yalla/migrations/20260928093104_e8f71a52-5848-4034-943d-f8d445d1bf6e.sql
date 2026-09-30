DROP POLICY IF EXISTS air_settings_read ON public.air_pricing_settings;
CREATE POLICY air_settings_admin_read ON public.air_pricing_settings FOR SELECT TO authenticated USING (public.air_is_admin());
REVOKE SELECT ON public.air_pricing_settings FROM anon;
CREATE OR REPLACE FUNCTION public.air_pricing_public() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id',id,'fx_kes_per_usd',fx_kes_per_usd,'season_multipliers',season_multipliers,
    'weekend_multiplier',weekend_multiplier,'urgent_hours',urgent_hours,'urgent_multiplier',urgent_multiplier,
    'early_days',early_days,'early_multiplier',early_multiplier,'one_way_return_pct',one_way_return_pct,
    'taxi_hours',taxi_hours,'yalla_fee_pct',yalla_fee_pct)
  FROM public.air_pricing_settings WHERE id = 1
$$;
REVOKE ALL ON FUNCTION public.air_pricing_public() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.air_pricing_public() TO anon, authenticated, service_role;