
-- ============================================================
-- Phase 1: Driver Income Intelligence pricing foundation
-- ============================================================

-- 1) ride_categories ------------------------------------------------
CREATE TABLE public.ride_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  tier text NOT NULL CHECK (tier IN ('basic','standard','plus','executive','tour','shuttle','coaster','bus')),
  seats integer NOT NULL CHECK (seats > 0),
  vehicle_class text NOT NULL,
  image_url text,
  base_description text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ride_categories TO anon, authenticated;
GRANT ALL ON public.ride_categories TO service_role;
ALTER TABLE public.ride_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ride_categories public read"
  ON public.ride_categories FOR SELECT
  USING (true);
CREATE POLICY "ride_categories admin write"
  ON public.ride_categories FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2) pricing_models -------------------------------------------------
CREATE TABLE public.pricing_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_slug text NOT NULL REFERENCES public.ride_categories(slug) ON DELETE CASCADE,
  currency text NOT NULL DEFAULT 'KES',
  base_fare numeric(10,2) NOT NULL,
  per_km numeric(10,2) NOT NULL,
  per_min numeric(10,2) NOT NULL,
  minimum_fare numeric(10,2) NOT NULL,
  booking_fee numeric(10,2) NOT NULL DEFAULT 0,
  cancellation_fee numeric(10,2) NOT NULL DEFAULT 0,
  commission_pct numeric(5,2) NOT NULL DEFAULT 18.00 CHECK (commission_pct BETWEEN 0 AND 50),
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pricing_models_cat_active ON public.pricing_models (category_slug, is_active, effective_from DESC);
GRANT SELECT ON public.pricing_models TO anon, authenticated;
GRANT ALL ON public.pricing_models TO service_role;
ALTER TABLE public.pricing_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pricing_models public read"
  ON public.pricing_models FOR SELECT USING (true);
CREATE POLICY "pricing_models admin write"
  ON public.pricing_models FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3) city_pricing_rules --------------------------------------------
CREATE TABLE public.city_pricing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_slug text NOT NULL REFERENCES public.ride_categories(slug) ON DELETE CASCADE,
  city text NOT NULL,
  country_code text NOT NULL DEFAULT 'KE',
  -- pricing overrides (NULL means inherit pricing_models)
  base_fare_override numeric(10,2),
  per_km_override numeric(10,2),
  per_min_override numeric(10,2),
  minimum_fare_override numeric(10,2),
  -- driver cost assumptions
  fuel_cost_per_km numeric(10,2) NOT NULL,
  maintenance_per_km numeric(10,2) NOT NULL,
  insurance_monthly numeric(10,2) NOT NULL,
  avg_trips_per_hour numeric(5,2) NOT NULL DEFAULT 2.0,
  avg_km_per_trip numeric(5,2) NOT NULL DEFAULT 7.0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_slug, city)
);
CREATE INDEX idx_city_pricing_city_cat ON public.city_pricing_rules (city, category_slug, is_active);
GRANT SELECT ON public.city_pricing_rules TO anon, authenticated;
GRANT ALL ON public.city_pricing_rules TO service_role;
ALTER TABLE public.city_pricing_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "city_pricing public read"
  ON public.city_pricing_rules FOR SELECT USING (true);
CREATE POLICY "city_pricing admin write"
  ON public.city_pricing_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4) surge_rules ----------------------------------------------------
CREATE TABLE public.surge_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city text NOT NULL,
  category_slug text NOT NULL REFERENCES public.ride_categories(slug) ON DELETE CASCADE,
  hour_of_week integer NOT NULL CHECK (hour_of_week BETWEEN 0 AND 167),
  multiplier numeric(4,2) NOT NULL DEFAULT 1.00 CHECK (multiplier BETWEEN 0.5 AND 5.0),
  reason text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city, category_slug, hour_of_week)
);
CREATE INDEX idx_surge_city_hour ON public.surge_rules (city, hour_of_week, is_active);
GRANT SELECT ON public.surge_rules TO anon, authenticated;
GRANT ALL ON public.surge_rules TO service_role;
ALTER TABLE public.surge_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "surge_rules public read"
  ON public.surge_rules FOR SELECT USING (true);
CREATE POLICY "surge_rules admin write"
  ON public.surge_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5) incentive_programs --------------------------------------------
CREATE TABLE public.incentive_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  category_slug text REFERENCES public.ride_categories(slug) ON DELETE SET NULL,
  city text,
  trigger_type text NOT NULL CHECK (trigger_type IN ('trips_count','hours_online','peak_window','streak','rating')),
  threshold numeric(10,2) NOT NULL,
  reward_kes numeric(10,2) NOT NULL,
  window_start timestamptz,
  window_end timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_incentive_active ON public.incentive_programs (is_active, city, category_slug);
GRANT SELECT ON public.incentive_programs TO anon, authenticated;
GRANT ALL ON public.incentive_programs TO service_role;
ALTER TABLE public.incentive_programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "incentive_programs public read"
  ON public.incentive_programs FOR SELECT USING (true);
CREATE POLICY "incentive_programs admin write"
  ON public.incentive_programs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- updated_at triggers ----------------------------------------------
CREATE TRIGGER trg_ride_categories_updated BEFORE UPDATE ON public.ride_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_pricing_models_updated BEFORE UPDATE ON public.pricing_models
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_city_pricing_updated BEFORE UPDATE ON public.city_pricing_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_surge_rules_updated BEFORE UPDATE ON public.surge_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_incentive_updated BEFORE UPDATE ON public.incentive_programs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- Seed data — 8 Yalla vehicle categories
-- ============================================================
INSERT INTO public.ride_categories (slug, name, tier, seats, vehicle_class, image_url, base_description, sort_order) VALUES
  ('yalla-basic',         'Yalla Basic',         'basic',     4,  'Hatchback',          '/src/assets/vehicles/yalla-basic.jpg',         'Affordable everyday rides for city trips.',                     10),
  ('yalla-standard',      'Yalla Standard',      'standard',  4,  'Sedan',              '/src/assets/vehicles/yalla-standard.jpg',      'Reliable saloon rides — the everyday Yalla workhorse.',         20),
  ('yalla-plus',          'Yalla Plus',          'plus',      4,  'Premium Sedan',      '/src/assets/vehicles/yalla-plus.jpg',          'Newer, larger sedans with a quieter cabin.',                    30),
  ('yalla-executive',     'Yalla Executive',     'executive', 6,  'Executive SUV',      '/src/assets/vehicles/yalla-executive.jpg',     'Premium SUV for business and airport trips.',                   40),
  ('yalla-tour-cruiser',  'Yalla Tour Cruiser',  'tour',      7,  '4x4 Tour SUV',       '/src/assets/vehicles/yalla-tour-cruiser.jpg',  'Land Cruiser-class 4x4 for safaris and upcountry tours.',       50),
  ('yalla-shuttle',       'Yalla Shuttle',       'shuttle',   14, 'Passenger Van',      '/src/assets/vehicles/yalla-shuttle.jpg',       '14-seater shuttle for staff transport and group bookings.',     60),
  ('yalla-coaster',       'Yalla Coaster',       'coaster',   33, 'Mid-size Coach',     '/src/assets/vehicles/yalla-coaster.jpg',       '33-seater coaster for corporate events and intercity hops.',    70),
  ('yalla-bus',           'Yalla Bus',           'bus',       60, 'Tour Coach',         '/src/assets/vehicles/yalla-bus.jpg',           '60-seater luxury coach for long-haul and tour groups.',         80);

-- Base pricing models (KES). Nairobi-anchored; NTSA min fare KES 220 for basic.
INSERT INTO public.pricing_models (category_slug, base_fare, per_km, per_min, minimum_fare, booking_fee, commission_pct) VALUES
  ('yalla-basic',         100, 35,  4,  220, 30, 18.0),
  ('yalla-standard',      120, 45,  5,  280, 30, 18.0),
  ('yalla-plus',          180, 60,  6,  400, 40, 20.0),
  ('yalla-executive',     350, 110, 9,  900, 50, 22.0),
  ('yalla-tour-cruiser',  500, 160, 12, 1500, 50, 22.0),
  ('yalla-shuttle',       400, 90,  8,  1200, 50, 15.0),
  ('yalla-coaster',       800, 140, 12, 3000, 80, 15.0),
  ('yalla-bus',           1500, 220, 18, 6000, 100, 12.0);

-- City overrides + cost assumptions for Kenyan cities
-- Nairobi (baseline), Mombasa (95%), Kisumu/Nakuru/Eldoret (88%)
DO $$
DECLARE
  cat record;
  city_data record;
  city_mult numeric;
  fuel_per_km numeric;
  maint_per_km numeric;
  ins_monthly numeric;
  trips_hr numeric;
  km_trip numeric;
BEGIN
  FOR cat IN SELECT slug, tier, seats FROM public.ride_categories LOOP
    -- Per-category cost baseline
    fuel_per_km := CASE cat.tier
      WHEN 'basic' THEN 9 WHEN 'standard' THEN 11 WHEN 'plus' THEN 13
      WHEN 'executive' THEN 18 WHEN 'tour' THEN 22
      WHEN 'shuttle' THEN 20 WHEN 'coaster' THEN 32 WHEN 'bus' THEN 55
    END;
    maint_per_km := CASE cat.tier
      WHEN 'basic' THEN 4 WHEN 'standard' THEN 5 WHEN 'plus' THEN 6
      WHEN 'executive' THEN 9 WHEN 'tour' THEN 12
      WHEN 'shuttle' THEN 10 WHEN 'coaster' THEN 16 WHEN 'bus' THEN 24
    END;
    ins_monthly := CASE cat.tier
      WHEN 'basic' THEN 4500 WHEN 'standard' THEN 5500 WHEN 'plus' THEN 7500
      WHEN 'executive' THEN 12000 WHEN 'tour' THEN 14000
      WHEN 'shuttle' THEN 11000 WHEN 'coaster' THEN 18000 WHEN 'bus' THEN 28000
    END;

    FOR city_data IN
      SELECT * FROM (VALUES
        ('Nairobi', 1.00, 2.4, 7.0),
        ('Mombasa', 0.95, 2.0, 6.0),
        ('Kisumu',  0.88, 1.8, 5.5),
        ('Nakuru',  0.88, 1.8, 5.5),
        ('Eldoret', 0.88, 1.7, 6.0)
      ) AS t(city, mult, trips_hr, km_trip)
    LOOP
      INSERT INTO public.city_pricing_rules (
        category_slug, city,
        base_fare_override, per_km_override, per_min_override, minimum_fare_override,
        fuel_cost_per_km, maintenance_per_km, insurance_monthly,
        avg_trips_per_hour, avg_km_per_trip
      )
      SELECT cat.slug, city_data.city,
        ROUND(pm.base_fare * city_data.mult, 0),
        ROUND(pm.per_km * city_data.mult, 0),
        ROUND(pm.per_min * city_data.mult, 0),
        ROUND(pm.minimum_fare * city_data.mult, 0),
        fuel_per_km, maint_per_km, ins_monthly,
        city_data.trips_hr, city_data.km_trip
      FROM public.pricing_models pm WHERE pm.category_slug = cat.slug;
    END LOOP;
  END LOOP;
END $$;

-- Sample surge rules: Nairobi peak hours for standard/plus/basic
-- Mon-Fri 7-9am (hours 7-8, 31-32, 55-56, 79-80, 103-104) & 5-8pm
DO $$
DECLARE
  h integer;
  day integer;
  peak_hours integer[] := ARRAY[7,8,17,18,19];
BEGIN
  FOR day IN 0..4 LOOP -- Mon-Fri
    FOREACH h IN ARRAY peak_hours LOOP
      INSERT INTO public.surge_rules (city, category_slug, hour_of_week, multiplier, reason)
      VALUES
        ('Nairobi', 'yalla-basic',    day*24+h, 1.40, 'Weekday rush hour'),
        ('Nairobi', 'yalla-standard', day*24+h, 1.40, 'Weekday rush hour'),
        ('Nairobi', 'yalla-plus',     day*24+h, 1.30, 'Weekday rush hour'),
        ('Nairobi', 'yalla-executive',day*24+h, 1.25, 'Weekday rush hour')
      ON CONFLICT (city, category_slug, hour_of_week) DO NOTHING;
    END LOOP;
  END LOOP;
  -- Friday/Saturday late nights
  FOR h IN 22..23 LOOP
    INSERT INTO public.surge_rules (city, category_slug, hour_of_week, multiplier, reason) VALUES
      ('Nairobi', 'yalla-basic',    4*24+h, 1.60, 'Friday nightlife'),
      ('Nairobi', 'yalla-standard', 4*24+h, 1.60, 'Friday nightlife'),
      ('Nairobi', 'yalla-basic',    5*24+h, 1.70, 'Saturday nightlife'),
      ('Nairobi', 'yalla-standard', 5*24+h, 1.70, 'Saturday nightlife')
    ON CONFLICT (city, category_slug, hour_of_week) DO NOTHING;
  END LOOP;
END $$;

-- Sample incentive programs
INSERT INTO public.incentive_programs (name, description, category_slug, city, trigger_type, threshold, reward_kes, is_active) VALUES
  ('Daily 20 Trips Bonus',     'Complete 20 trips in a day',                  NULL,             'Nairobi', 'trips_count',  20,  800,  true),
  ('Weekly 100 Trips Quest',   'Complete 100 trips in a week',                NULL,             'Nairobi', 'trips_count', 100, 5000,  true),
  ('Peak Hour Hero',           'Drive 4 hours during weekday evening peak',   'yalla-standard', 'Nairobi', 'peak_window',   4, 1200,  true),
  ('Executive Streak',         '10-trip streak with 4.9+ rating',             'yalla-executive', NULL,     'streak',       10, 2500,  true),
  ('Mombasa Coast Quest',      'Complete 50 trips in Mombasa this week',      NULL,             'Mombasa', 'trips_count',  50, 3000,  true);
