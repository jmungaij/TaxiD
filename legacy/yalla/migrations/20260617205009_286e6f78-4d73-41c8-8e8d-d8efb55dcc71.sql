-- Phase 2: Marketplace + Surge + Hex-grid Dispatch
-- All tables in public schema with marketplace_ prefix (or dispatch_hex_ for dispatch-specific)

-- =========================================================================
-- 1. HEX GRID FOUNDATION
-- =========================================================================
CREATE TABLE public.marketplace_hex_cells (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  h3_index TEXT NOT NULL UNIQUE,
  resolution SMALLINT NOT NULL DEFAULT 8,
  country_code TEXT NOT NULL DEFAULT 'KE',
  region TEXT,
  city TEXT,
  center_lat NUMERIC(10,7) NOT NULL,
  center_lng NUMERIC(10,7) NOT NULL,
  polygon JSONB,
  area_km2 NUMERIC(10,4),
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_service_area BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.marketplace_hex_cells TO anon, authenticated;
GRANT ALL ON public.marketplace_hex_cells TO service_role;
ALTER TABLE public.marketplace_hex_cells ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hex cells readable by all" ON public.marketplace_hex_cells FOR SELECT USING (true);
CREATE POLICY "hex cells admin manage" ON public.marketplace_hex_cells FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_marketplace_hex_cells_h3 ON public.marketplace_hex_cells(h3_index);
CREATE INDEX idx_marketplace_hex_cells_city ON public.marketplace_hex_cells(country_code, city) WHERE is_active;

-- =========================================================================
-- 2. SUPPLY SNAPSHOTS (drivers per hex per time bucket)
-- =========================================================================
CREATE TABLE public.marketplace_supply_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hex_id UUID NOT NULL REFERENCES public.marketplace_hex_cells(id) ON DELETE CASCADE,
  bucket_at TIMESTAMPTZ NOT NULL,
  ride_type TEXT,
  available_drivers INTEGER NOT NULL DEFAULT 0,
  busy_drivers INTEGER NOT NULL DEFAULT 0,
  offline_drivers INTEGER NOT NULL DEFAULT 0,
  avg_eta_seconds INTEGER,
  utilization NUMERIC(5,4),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.marketplace_supply_snapshots TO authenticated;
GRANT ALL ON public.marketplace_supply_snapshots TO service_role;
ALTER TABLE public.marketplace_supply_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "supply snapshots admin read" ON public.marketplace_supply_snapshots FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "supply snapshots service insert" ON public.marketplace_supply_snapshots FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_marketplace_supply_bucket ON public.marketplace_supply_snapshots(hex_id, bucket_at DESC);

-- =========================================================================
-- 3. DEMAND SNAPSHOTS (requests/searches per hex per time bucket)
-- =========================================================================
CREATE TABLE public.marketplace_demand_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hex_id UUID NOT NULL REFERENCES public.marketplace_hex_cells(id) ON DELETE CASCADE,
  bucket_at TIMESTAMPTZ NOT NULL,
  ride_type TEXT,
  search_count INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  unfulfilled_count INTEGER NOT NULL DEFAULT 0,
  cancel_count INTEGER NOT NULL DEFAULT 0,
  avg_wait_seconds INTEGER,
  conversion_rate NUMERIC(5,4),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.marketplace_demand_snapshots TO authenticated;
GRANT ALL ON public.marketplace_demand_snapshots TO service_role;
ALTER TABLE public.marketplace_demand_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "demand snapshots admin read" ON public.marketplace_demand_snapshots FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "demand snapshots service insert" ON public.marketplace_demand_snapshots FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_marketplace_demand_bucket ON public.marketplace_demand_snapshots(hex_id, bucket_at DESC);

-- =========================================================================
-- 4. SURGE MULTIPLIERS (current active surge per hex/ride_type)
-- =========================================================================
CREATE TABLE public.marketplace_surge_multipliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hex_id UUID NOT NULL REFERENCES public.marketplace_hex_cells(id) ON DELETE CASCADE,
  ride_type TEXT,
  multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.00,
  reason TEXT,
  supply_demand_ratio NUMERIC(6,3),
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_until TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  source TEXT NOT NULL DEFAULT 'auto',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.marketplace_surge_multipliers TO anon, authenticated;
GRANT INSERT, UPDATE ON public.marketplace_surge_multipliers TO authenticated;
GRANT ALL ON public.marketplace_surge_multipliers TO service_role;
ALTER TABLE public.marketplace_surge_multipliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "surge readable by all" ON public.marketplace_surge_multipliers FOR SELECT USING (true);
CREATE POLICY "surge admin manage" ON public.marketplace_surge_multipliers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_marketplace_surge_active ON public.marketplace_surge_multipliers(hex_id, ride_type) WHERE is_active;

-- =========================================================================
-- 5. SURGE EVENTS (audit log of surge changes)
-- =========================================================================
CREATE TABLE public.marketplace_surge_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hex_id UUID NOT NULL REFERENCES public.marketplace_hex_cells(id) ON DELETE CASCADE,
  ride_type TEXT,
  previous_multiplier NUMERIC(4,2),
  new_multiplier NUMERIC(4,2) NOT NULL,
  trigger TEXT NOT NULL,
  supply_count INTEGER,
  demand_count INTEGER,
  ratio NUMERIC(6,3),
  actor_id UUID,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.marketplace_surge_events TO authenticated;
GRANT ALL ON public.marketplace_surge_events TO service_role;
ALTER TABLE public.marketplace_surge_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "surge events admin read" ON public.marketplace_surge_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "surge events admin insert" ON public.marketplace_surge_events FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_marketplace_surge_events_hex ON public.marketplace_surge_events(hex_id, created_at DESC);

-- =========================================================================
-- 6. PRICING RULES (base + dynamic pricing config)
-- =========================================================================
CREATE TABLE public.marketplace_pricing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  ride_type TEXT NOT NULL,
  country_code TEXT NOT NULL DEFAULT 'KE',
  city TEXT,
  currency TEXT NOT NULL DEFAULT 'KES',
  base_fare NUMERIC(10,2) NOT NULL,
  per_km NUMERIC(10,2) NOT NULL,
  per_minute NUMERIC(10,2) NOT NULL,
  minimum_fare NUMERIC(10,2) NOT NULL,
  booking_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  cancellation_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
  surge_enabled BOOLEAN NOT NULL DEFAULT true,
  max_surge_multiplier NUMERIC(4,2) NOT NULL DEFAULT 3.00,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_until TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.marketplace_pricing_rules TO anon, authenticated;
GRANT INSERT, UPDATE ON public.marketplace_pricing_rules TO authenticated;
GRANT ALL ON public.marketplace_pricing_rules TO service_role;
ALTER TABLE public.marketplace_pricing_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pricing rules readable" ON public.marketplace_pricing_rules FOR SELECT USING (true);
CREATE POLICY "pricing rules admin manage" ON public.marketplace_pricing_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_marketplace_pricing_active ON public.marketplace_pricing_rules(country_code, city, ride_type) WHERE is_active;

-- =========================================================================
-- 7. DISPATCH ZONES (operational service zones aggregating hexes)
-- =========================================================================
CREATE TABLE public.marketplace_dispatch_zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  zone_type TEXT NOT NULL DEFAULT 'standard',
  country_code TEXT NOT NULL DEFAULT 'KE',
  city TEXT,
  polygon JSONB,
  hex_ids UUID[],
  priority INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.marketplace_dispatch_zones TO anon, authenticated;
GRANT INSERT, UPDATE ON public.marketplace_dispatch_zones TO authenticated;
GRANT ALL ON public.marketplace_dispatch_zones TO service_role;
ALTER TABLE public.marketplace_dispatch_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "zones readable" ON public.marketplace_dispatch_zones FOR SELECT USING (true);
CREATE POLICY "zones admin manage" ON public.marketplace_dispatch_zones FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- =========================================================================
-- 8. HEX ASSIGNMENTS (link drivers to current hex for fast lookup)
-- =========================================================================
CREATE TABLE public.dispatch_hex_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL,
  hex_id UUID NOT NULL REFERENCES public.marketplace_hex_cells(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'available',
  vehicle_type TEXT,
  last_location_lat NUMERIC(10,7),
  last_location_lng NUMERIC(10,7),
  entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(driver_id)
);
GRANT SELECT ON public.dispatch_hex_assignments TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.dispatch_hex_assignments TO authenticated;
GRANT ALL ON public.dispatch_hex_assignments TO service_role;
ALTER TABLE public.dispatch_hex_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hex assignments self read" ON public.dispatch_hex_assignments FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "hex assignments self write" ON public.dispatch_hex_assignments FOR INSERT TO authenticated
  WITH CHECK (driver_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "hex assignments self update" ON public.dispatch_hex_assignments FOR UPDATE TO authenticated
  USING (driver_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_dispatch_hex_assignments_hex ON public.dispatch_hex_assignments(hex_id, status);

-- =========================================================================
-- 9. HEATMAP TILES (precomputed visualization layer)
-- =========================================================================
CREATE TABLE public.marketplace_heatmap_tiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hex_id UUID NOT NULL REFERENCES public.marketplace_hex_cells(id) ON DELETE CASCADE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  layer TEXT NOT NULL,
  intensity NUMERIC(6,3) NOT NULL DEFAULT 0,
  color_hint TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT ON public.marketplace_heatmap_tiles TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.marketplace_heatmap_tiles TO authenticated;
GRANT ALL ON public.marketplace_heatmap_tiles TO service_role;
ALTER TABLE public.marketplace_heatmap_tiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "heatmap readable" ON public.marketplace_heatmap_tiles FOR SELECT USING (true);
CREATE POLICY "heatmap admin write" ON public.marketplace_heatmap_tiles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_marketplace_heatmap_layer ON public.marketplace_heatmap_tiles(layer, computed_at DESC);

-- =========================================================================
-- 10. ETA CALIBRATION (predicted vs actual per hex)
-- =========================================================================
CREATE TABLE public.marketplace_eta_calibration (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hex_id UUID NOT NULL REFERENCES public.marketplace_hex_cells(id) ON DELETE CASCADE,
  ride_type TEXT,
  predicted_eta_seconds INTEGER NOT NULL,
  actual_eta_seconds INTEGER NOT NULL,
  error_seconds INTEGER NOT NULL,
  error_pct NUMERIC(6,3),
  sample_count INTEGER NOT NULL DEFAULT 1,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT, INSERT ON public.marketplace_eta_calibration TO authenticated;
GRANT ALL ON public.marketplace_eta_calibration TO service_role;
ALTER TABLE public.marketplace_eta_calibration ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eta calib admin read" ON public.marketplace_eta_calibration FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "eta calib admin insert" ON public.marketplace_eta_calibration FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_marketplace_eta_calib_hex ON public.marketplace_eta_calibration(hex_id, computed_at DESC);

-- =========================================================================
-- updated_at triggers
-- =========================================================================
CREATE TRIGGER trg_marketplace_hex_cells_updated BEFORE UPDATE ON public.marketplace_hex_cells
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_marketplace_surge_updated BEFORE UPDATE ON public.marketplace_surge_multipliers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_marketplace_pricing_updated BEFORE UPDATE ON public.marketplace_pricing_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_marketplace_zones_updated BEFORE UPDATE ON public.marketplace_dispatch_zones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- Seed default Nairobi pricing rules
-- =========================================================================
INSERT INTO public.marketplace_pricing_rules (name, ride_type, country_code, city, currency, base_fare, per_km, per_minute, minimum_fare, booking_fee)
VALUES
  ('Nairobi Economy', 'economy', 'KE', 'Nairobi', 'KES', 100, 35, 4, 200, 0),
  ('Nairobi Comfort', 'comfort', 'KE', 'Nairobi', 'KES', 150, 50, 5, 300, 0),
  ('Nairobi XL',     'xl',      'KE', 'Nairobi', 'KES', 200, 70, 6, 450, 0),
  ('Nairobi Boda',   'boda',    'KE', 'Nairobi', 'KES', 50,  20, 2, 100, 0);
