-- 1) admin_login_events: remove client-writable INSERT policy; route through a
--    server-side function that derives identity, risk score and decision.
DROP POLICY IF EXISTS "login_events self insert" ON public.admin_login_events;

CREATE OR REPLACE FUNCTION public.record_login_event(
  _email text,
  _event_type text,
  _reason text DEFAULT NULL,
  _device_id text DEFAULT NULL,
  _browser text DEFAULT NULL,
  _operating_system text DEFAULT NULL,
  _surface text DEFAULT NULL,
  _user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event text;
  v_risk int;
  v_decision text;
BEGIN
  IF _event_type NOT IN ('login_success','login_failure','mfa_failure','device_mismatch') THEN
    RAISE EXCEPTION 'invalid event_type';
  END IF;
  v_event := _event_type;
  v_risk := CASE WHEN v_event = 'login_success' THEN 0 ELSE 40 END;
  v_decision := CASE WHEN v_event = 'login_success' THEN 'allow' ELSE 'deny' END;

  INSERT INTO public.admin_login_events (
    user_id, email, event_type, reason, risk_score, decision,
    device_id, browser, operating_system, metadata
  ) VALUES (
    auth.uid(),
    left(coalesce(_email, ''), 320),
    v_event,
    left(_reason, 500),
    v_risk,
    v_decision,
    left(_device_id, 128),
    left(_browser, 128),
    left(_operating_system, 128),
    jsonb_build_object('surface', left(_surface, 64), 'user_agent', left(_user_agent, 512))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_login_event(text,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_login_event(text,text,text,text,text,text,text,text) TO anon, authenticated, service_role;

-- 2) Pricing / ops reference tables: stop exposing raw internal cost structure
--    publicly. Public surfaces read sanitized views instead.
DROP POLICY IF EXISTS "city_pricing public read" ON public.city_pricing_rules;
CREATE POLICY "city_pricing authenticated read"
  ON public.city_pricing_rules FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "surge_rules public read" ON public.surge_rules;
CREATE POLICY "surge_rules authenticated read"
  ON public.surge_rules FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "pricing floors readable" ON public.country_pricing_floors;
CREATE POLICY "pricing floors admin read"
  ON public.country_pricing_floors FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'finance_admin'));

DROP POLICY IF EXISTS "pricing rules readable" ON public.marketplace_pricing_rules;
CREATE POLICY "pricing rules admin read"
  ON public.marketplace_pricing_rules FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'finance_admin'));

DROP POLICY IF EXISTS "compliance rules readable" ON public.compliance_country_rules;
CREATE POLICY "compliance rules admin read"
  ON public.compliance_country_rules FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'compliance_admin'));

-- Sanitized public projections (fare + driver-facing operating assumptions only).
CREATE OR REPLACE VIEW public.city_pricing_public AS
  SELECT category_slug, city, country_code,
         base_fare_override, per_km_override, per_min_override, minimum_fare_override,
         fuel_cost_per_km, maintenance_per_km, insurance_monthly,
         avg_trips_per_hour, avg_km_per_trip
  FROM public.city_pricing_rules
  WHERE is_active = true;

CREATE OR REPLACE VIEW public.surge_rules_public AS
  SELECT city, category_slug, hour_of_week, multiplier
  FROM public.surge_rules
  WHERE is_active = true;

GRANT SELECT ON public.city_pricing_public TO anon, authenticated;
GRANT SELECT ON public.surge_rules_public TO anon, authenticated;