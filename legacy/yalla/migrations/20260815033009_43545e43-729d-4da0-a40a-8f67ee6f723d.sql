-- =====================================================================
-- ASSET PRICING 360 — governed, asset-specific pricing domain.
-- Additive only. Existing asset_pricing_* tables are untouched.
-- =====================================================================

-- ---------- 1. Engines ------------------------------------------------
CREATE TABLE public.ap360_engines (
  code              text PRIMARY KEY,
  label             text NOT NULL,
  summary           text NOT NULL,
  -- Parameter keys this engine accepts. The editor renders only these.
  parameter_keys    text[] NOT NULL,
  required_keys     text[] NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ap360_engines TO authenticated;
GRANT ALL ON public.ap360_engines TO service_role;
ALTER TABLE public.ap360_engines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read ap360 engines" ON public.ap360_engines
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));

-- ---------- 2. Taxonomy ----------------------------------------------
CREATE TABLE public.ap360_families (
  code              text PRIMARY KEY,
  label             text NOT NULL,
  sort_order        integer NOT NULL DEFAULT 100,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ap360_families TO authenticated;
GRANT ALL ON public.ap360_families TO service_role;
ALTER TABLE public.ap360_families ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read ap360 families" ON public.ap360_families
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "admin write ap360 families" ON public.ap360_families
  FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE TABLE public.ap360_categories (
  code              text PRIMARY KEY,
  family_code       text NOT NULL REFERENCES public.ap360_families(code) ON DELETE RESTRICT,
  label             text NOT NULL,
  engine_code       text NOT NULL REFERENCES public.ap360_engines(code) ON DELETE RESTRICT,
  -- Configurable market reference band (guidance, never immutable law).
  reference_low     numeric(14,2),
  reference_high    numeric(14,2),
  reference_unit    text,
  capacity          integer,
  sort_order        integer NOT NULL DEFAULT 100,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ap360_categories_band CHECK (
    reference_low IS NULL OR reference_high IS NULL OR reference_high >= reference_low)
);
CREATE INDEX idx_ap360_categories_family ON public.ap360_categories(family_code, sort_order);
GRANT SELECT ON public.ap360_categories TO authenticated;
GRANT ALL ON public.ap360_categories TO service_role;
ALTER TABLE public.ap360_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read ap360 categories" ON public.ap360_categories
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "admin write ap360 categories" ON public.ap360_categories
  FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- ---------- 3. Profiles + immutable versions --------------------------
CREATE TABLE public.ap360_profiles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code     text NOT NULL REFERENCES public.ap360_categories(code) ON DELETE RESTRICT,
  code              text NOT NULL UNIQUE,
  label             text NOT NULL,
  currency          text NOT NULL DEFAULT 'KES',
  geography         text NOT NULL DEFAULT 'KE',
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ap360_profiles_unique_scope UNIQUE (category_code, geography)
);
GRANT SELECT, INSERT, UPDATE ON public.ap360_profiles TO authenticated;
GRANT ALL ON public.ap360_profiles TO service_role;
ALTER TABLE public.ap360_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read ap360 profiles" ON public.ap360_profiles
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "admin write ap360 profiles" ON public.ap360_profiles
  FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE TABLE public.ap360_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id        uuid NOT NULL REFERENCES public.ap360_profiles(id) ON DELETE CASCADE,
  version           integer NOT NULL,
  status            text NOT NULL DEFAULT 'draft',
  engine_code       text NOT NULL REFERENCES public.ap360_engines(code),
  -- Engine-specific governed parameters, validated against the engine schema.
  params            jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Governance envelope
  commission_pct    numeric(6,3) NOT NULL DEFAULT 0,
  max_discount_pct  numeric(6,3) NOT NULL DEFAULT 0,
  demand_ceiling    numeric(6,3) NOT NULL DEFAULT 1.20,
  override_tolerance_pct numeric(6,3) NOT NULL DEFAULT 10,
  target_margin_pct numeric(6,3) NOT NULL DEFAULT 15,
  fuel_policy       text NOT NULL DEFAULT 'excluded',
  tax_rule_code     text,
  effective_from    timestamptz NOT NULL DEFAULT now(),
  effective_to      timestamptz,
  reason            text NOT NULL DEFAULT '',
  source            text NOT NULL DEFAULT 'admin_ui',
  created_by        uuid,
  approved_by       uuid,
  approved_at       timestamptz,
  published_by      uuid,
  published_at      timestamptz,
  superseded_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ap360_versions_unique UNIQUE (profile_id, version),
  CONSTRAINT ap360_versions_status CHECK (status IN
    ('draft','validating','submitted','approved','published','scheduled','active','superseded','archived','rejected')),
  CONSTRAINT ap360_versions_fuel CHECK (fuel_policy IN
    ('included','excluded','surcharge','indexed','operator_supplied')),
  CONSTRAINT ap360_versions_commission CHECK (commission_pct >= 0 AND commission_pct <= 30),
  CONSTRAINT ap360_versions_discount CHECK (max_discount_pct >= 0 AND max_discount_pct <= 30),
  CONSTRAINT ap360_versions_ceiling CHECK (demand_ceiling >= 1 AND demand_ceiling <= 3),
  CONSTRAINT ap360_versions_tolerance CHECK (override_tolerance_pct >= 0 AND override_tolerance_pct <= 100),
  CONSTRAINT ap360_versions_margin CHECK (target_margin_pct >= 0 AND target_margin_pct <= 100),
  CONSTRAINT ap360_versions_window CHECK (effective_to IS NULL OR effective_to > effective_from)
);
CREATE INDEX idx_ap360_versions_profile ON public.ap360_versions(profile_id, version DESC);
CREATE INDEX idx_ap360_versions_live ON public.ap360_versions(profile_id, status, effective_from DESC);
GRANT SELECT, INSERT, UPDATE ON public.ap360_versions TO authenticated;
GRANT ALL ON public.ap360_versions TO service_role;
ALTER TABLE public.ap360_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read ap360 versions" ON public.ap360_versions
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "admin insert ap360 versions" ON public.ap360_versions
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());
CREATE POLICY "admin update ap360 versions" ON public.ap360_versions
  FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- Published/superseded/archived versions are immutable except for lifecycle columns.
CREATE OR REPLACE FUNCTION public._ap360_version_immutability()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('published','superseded','archived') THEN
      RAISE EXCEPTION 'AP360: published pricing versions cannot be deleted (version %)', OLD.version;
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('published','superseded','archived') THEN
    IF NEW.params IS DISTINCT FROM OLD.params
       OR NEW.commission_pct IS DISTINCT FROM OLD.commission_pct
       OR NEW.max_discount_pct IS DISTINCT FROM OLD.max_discount_pct
       OR NEW.demand_ceiling IS DISTINCT FROM OLD.demand_ceiling
       OR NEW.engine_code IS DISTINCT FROM OLD.engine_code
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from THEN
      RAISE EXCEPTION 'AP360: version % is % and its pricing content is immutable', OLD.version, OLD.status;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ap360_versions_immutable
  BEFORE UPDATE OR DELETE ON public.ap360_versions
  FOR EACH ROW EXECUTE FUNCTION public._ap360_version_immutability();

-- Only one published/active version per profile at any instant.
CREATE UNIQUE INDEX uq_ap360_one_published
  ON public.ap360_versions(profile_id)
  WHERE status IN ('published','active');

-- ---------- 4. Cost inputs / economic floor ---------------------------
CREATE TABLE public.ap360_cost_inputs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id        uuid NOT NULL REFERENCES public.ap360_versions(id) ON DELETE CASCADE,
  cost_key          text NOT NULL,
  label             text NOT NULL,
  unit              text NOT NULL,
  amount            numeric(14,2) NOT NULL DEFAULT 0,
  category          text NOT NULL DEFAULT 'direct',
  note              text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ap360_cost_unique UNIQUE (version_id, cost_key),
  CONSTRAINT ap360_cost_amount CHECK (amount >= 0),
  CONSTRAINT ap360_cost_category CHECK (category IN ('direct','overhead','risk_reserve')),
  CONSTRAINT ap360_cost_unit CHECK (unit IN
    ('per_trip','per_day','per_hour','per_km','per_night','per_passenger','per_movement','per_block_hour','fixed'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ap360_cost_inputs TO authenticated;
GRANT ALL ON public.ap360_cost_inputs TO service_role;
ALTER TABLE public.ap360_cost_inputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read ap360 costs" ON public.ap360_cost_inputs
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "admin write ap360 costs" ON public.ap360_cost_inputs
  FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- ---------- 5. Market references --------------------------------------
CREATE TABLE public.ap360_market_references (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_code     text NOT NULL REFERENCES public.ap360_categories(code) ON DELETE CASCADE,
  source            text NOT NULL,
  source_url        text,
  market            text NOT NULL DEFAULT 'KE',
  geographic_area   text NOT NULL DEFAULT 'National',
  observed_price    numeric(14,2) NOT NULL,
  currency          text NOT NULL DEFAULT 'KES',
  pricing_unit      text NOT NULL,
  observed_date     date NOT NULL,
  valid_until       date,
  confidence        text NOT NULL DEFAULT 'medium',
  notes             text NOT NULL DEFAULT '',
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ap360_market_price CHECK (observed_price > 0),
  CONSTRAINT ap360_market_confidence CHECK (confidence IN ('low','medium','high','verified'))
);
CREATE INDEX idx_ap360_market_category ON public.ap360_market_references(category_code, observed_date DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ap360_market_references TO authenticated;
GRANT ALL ON public.ap360_market_references TO service_role;
ALTER TABLE public.ap360_market_references ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read ap360 market" ON public.ap360_market_references
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "admin write ap360 market" ON public.ap360_market_references
  FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- ---------- 6. Fuel index ---------------------------------------------
CREATE TABLE public.ap360_fuel_index (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country           text NOT NULL DEFAULT 'KE',
  region            text NOT NULL DEFAULT 'National',
  fuel_type         text NOT NULL,
  price             numeric(12,2) NOT NULL,
  currency          text NOT NULL DEFAULT 'KES',
  unit              text NOT NULL DEFAULT 'litre',
  effective_from    date NOT NULL,
  effective_to      date,
  source            text NOT NULL DEFAULT 'EPRA',
  captured_at       timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ap360_fuel_price CHECK (price > 0),
  CONSTRAINT ap360_fuel_type CHECK (fuel_type IN ('petrol','diesel','kerosene','jet_a1','avgas','marine_diesel')),
  CONSTRAINT ap360_fuel_window CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT ap360_fuel_unique UNIQUE (country, region, fuel_type, effective_from)
);
CREATE INDEX idx_ap360_fuel_lookup ON public.ap360_fuel_index(country, region, fuel_type, effective_from DESC);
GRANT SELECT, INSERT, UPDATE ON public.ap360_fuel_index TO authenticated;
GRANT ALL ON public.ap360_fuel_index TO service_role;
ALTER TABLE public.ap360_fuel_index ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read ap360 fuel" ON public.ap360_fuel_index
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "admin write ap360 fuel" ON public.ap360_fuel_index
  FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- ---------- 7. Tax rules (pricing-domain, rule driven) ----------------
CREATE TABLE public.ap360_tax_rules (
  code              text PRIMARY KEY,
  label             text NOT NULL,
  tax_type          text NOT NULL DEFAULT 'vat',
  rate_pct          numeric(6,3) NOT NULL,
  taxable_status    text NOT NULL DEFAULT 'standard',
  inclusive         boolean NOT NULL DEFAULT false,
  family_codes      text[] NOT NULL DEFAULT '{}',
  geography         text NOT NULL DEFAULT 'KE',
  authority         text NOT NULL DEFAULT 'KRA',
  source            text NOT NULL DEFAULT '',
  effective_from    date NOT NULL DEFAULT CURRENT_DATE,
  effective_to      date,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ap360_tax_rate CHECK (rate_pct >= 0 AND rate_pct <= 100),
  CONSTRAINT ap360_tax_status CHECK (taxable_status IN ('standard','zero_rated','exempt','out_of_scope'))
);
GRANT SELECT ON public.ap360_tax_rules TO authenticated;
GRANT ALL ON public.ap360_tax_rules TO service_role;
ALTER TABLE public.ap360_tax_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read ap360 tax" ON public.ap360_tax_rules
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "admin write ap360 tax" ON public.ap360_tax_rules
  FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

-- ---------- 8. Exceptions & overrides ---------------------------------
CREATE TABLE public.ap360_exceptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id        uuid REFERENCES public.ap360_versions(id) ON DELETE SET NULL,
  category_code     text REFERENCES public.ap360_categories(code) ON DELETE SET NULL,
  kind              text NOT NULL,
  status            text NOT NULL DEFAULT 'pending',
  requested_price   numeric(14,2),
  operator_floor    numeric(14,2),
  market_reference  numeric(14,2),
  variance_pct      numeric(8,3),
  reason            text NOT NULL,
  evidence          jsonb NOT NULL DEFAULT '{}'::jsonb,
  customer_impact   text NOT NULL DEFAULT '',
  operator_impact   text NOT NULL DEFAULT '',
  requested_by      uuid,
  decided_by        uuid,
  decided_at        timestamptz,
  decision_note     text,
  expires_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ap360_exception_kind CHECK (kind IN
    ('below_floor','override_tolerance','market_outlier','negative_margin','floor_above_ceiling')),
  CONSTRAINT ap360_exception_status CHECK (status IN ('pending','approved','rejected','expired'))
);
CREATE INDEX idx_ap360_exceptions_status ON public.ap360_exceptions(status, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.ap360_exceptions TO authenticated;
GRANT ALL ON public.ap360_exceptions TO service_role;
ALTER TABLE public.ap360_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read ap360 exceptions" ON public.ap360_exceptions
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "staff raise ap360 exceptions" ON public.ap360_exceptions
  FOR INSERT TO authenticated WITH CHECK (public.is_staff_portal_member(auth.uid()) AND requested_by = auth.uid());
CREATE POLICY "approver decide ap360 exceptions" ON public.ap360_exceptions
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin'::app_role,'finance_admin'::app_role]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['super_admin'::app_role,'finance_admin'::app_role]));

CREATE TABLE public.ap360_overrides (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id        uuid NOT NULL REFERENCES public.ap360_versions(id) ON DELETE CASCADE,
  exception_id      uuid REFERENCES public.ap360_exceptions(id) ON DELETE SET NULL,
  booking_ref       text,
  operator_id       uuid,
  original_price    numeric(14,2) NOT NULL,
  requested_price   numeric(14,2) NOT NULL,
  variance_pct      numeric(8,3) NOT NULL,
  reason            text NOT NULL,
  evidence          jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval_level    text NOT NULL DEFAULT 'operator',
  approved_by       uuid,
  approved_at       timestamptz,
  expires_at        timestamptz,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ap360_override_prices CHECK (original_price >= 0 AND requested_price >= 0),
  CONSTRAINT ap360_override_level CHECK (approval_level IN ('operator','manager','super_admin'))
);
CREATE INDEX idx_ap360_overrides_version ON public.ap360_overrides(version_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.ap360_overrides TO authenticated;
GRANT ALL ON public.ap360_overrides TO service_role;
ALTER TABLE public.ap360_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read ap360 overrides" ON public.ap360_overrides
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "staff log ap360 overrides" ON public.ap360_overrides
  FOR INSERT TO authenticated WITH CHECK (public.is_staff_portal_member(auth.uid()) AND created_by = auth.uid());

-- ---------- 9. Immutable quote snapshots ------------------------------
CREATE TABLE public.ap360_quote_snapshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_ref         text,
  profile_id        uuid REFERENCES public.ap360_profiles(id) ON DELETE SET NULL,
  version_id        uuid REFERENCES public.ap360_versions(id) ON DELETE SET NULL,
  category_code     text,
  engine_code       text,
  version_number    integer,
  inputs            jsonb NOT NULL,
  result            jsonb NOT NULL,
  currency          text NOT NULL DEFAULT 'KES',
  customer_price    numeric(14,2) NOT NULL,
  operator_net      numeric(14,2) NOT NULL,
  yalla_revenue     numeric(14,2) NOT NULL,
  operator_floor    numeric(14,2) NOT NULL,
  contribution_pct  numeric(8,3) NOT NULL,
  profitability_band text NOT NULL,
  exception_id      uuid REFERENCES public.ap360_exceptions(id) ON DELETE SET NULL,
  calculated_by     uuid,
  calculated_at     timestamptz NOT NULL DEFAULT now(),
  valid_until       timestamptz
);
CREATE INDEX idx_ap360_snapshots_ref ON public.ap360_quote_snapshots(quote_ref, calculated_at DESC);
CREATE INDEX idx_ap360_snapshots_version ON public.ap360_quote_snapshots(version_id, calculated_at DESC);
GRANT SELECT, INSERT ON public.ap360_quote_snapshots TO authenticated;
GRANT ALL ON public.ap360_quote_snapshots TO service_role;
ALTER TABLE public.ap360_quote_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read ap360 snapshots" ON public.ap360_quote_snapshots
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "staff write ap360 snapshots" ON public.ap360_quote_snapshots
  FOR INSERT TO authenticated WITH CHECK (public.is_staff_portal_member(auth.uid()));

CREATE OR REPLACE FUNCTION public._ap360_block_snapshot_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'AP360: quote snapshots are immutable — a historical quote can never be altered';
END $$;
CREATE TRIGGER trg_ap360_snapshots_immutable
  BEFORE UPDATE OR DELETE ON public.ap360_quote_snapshots
  FOR EACH ROW EXECUTE FUNCTION public._ap360_block_snapshot_mutation();

-- ---------- 10. touch triggers ---------------------------------------
CREATE TRIGGER trg_ap360_families_touch BEFORE UPDATE ON public.ap360_families
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_ap360_categories_touch BEFORE UPDATE ON public.ap360_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_ap360_profiles_touch BEFORE UPDATE ON public.ap360_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_ap360_costs_touch BEFORE UPDATE ON public.ap360_cost_inputs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_ap360_market_touch BEFORE UPDATE ON public.ap360_market_references
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_ap360_tax_touch BEFORE UPDATE ON public.ap360_tax_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_ap360_exceptions_touch BEFORE UPDATE ON public.ap360_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_ap360_engines_touch BEFORE UPDATE ON public.ap360_engines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- 11. Seed engines -----------------------------------------
INSERT INTO public.ap360_engines (code, label, summary, parameter_keys, required_keys) VALUES
('time_distance','Time + Distance',
 'Day/hour rate with included mileage and excess-km charging. Cars, vans, selected shuttles.',
 ARRAY['base_daily_rate','hourly_rate','included_km_per_day','excess_km_rate','minimum_rental_hours',
       'minimum_rental_days','driver_rate','security_deposit','delivery_fee','collection_fee','airport_fee',
       'weekend_multiplier','holiday_multiplier','peak_multiplier','corporate_discount_pct','long_term_discount_pct'],
 ARRAY['base_daily_rate','included_km_per_day','excess_km_rate']),
('trip_payload','Trip + Distance + Payload',
 'Loaded distance, empty return, payload and waiting. Trucks, freight, trailers.',
 ARRAY['base_trip_fee','cost_per_km','minimum_trip_charge','payload_capacity_t','empty_return_pct',
       'fuel_consumption_l_per_100km','loading_fee','unloading_fee','waiting_hourly','demurrage_daily',
       'tolls','permits','escort_fee','refrigeration_hourly','overnight_allowance','assistant_rate'],
 ARRAY['base_trip_fee','cost_per_km','minimum_trip_charge']),
('hours_mobilisation','Operating Hours + Day + Mobilisation',
 'Machine hour rate with minimum billable hours plus separately governed mobilisation. Heavy equipment.',
 ARRAY['operating_hour_rate','daily_rate','weekly_rate','monthly_rate','minimum_billable_hours',
       'operator_rate','fuel_consumption_l_per_hour','attachment_fee','mobilisation_fee','demobilisation_fee',
       'standby_hourly','overtime_hourly','transport_fee','permits','site_allowance'],
 ARRAY['operating_hour_rate','minimum_billable_hours','mobilisation_fee']),
('block_hour','Block Hours + Positioning + Route',
 'Block hour rate with positioning, landing and handling. Aircraft and helicopters.',
 ARRAY['block_hour_rate','minimum_billable_hours','positioning_hourly','positioning_fee','landing_fee',
       'airstrip_fee','handling_fee','overnight_fee','crew_fee','passenger_capacity','baggage_allowance_kg',
       'international_fee','permits','waiting_hourly'],
 ARRAY['block_hour_rate','minimum_billable_hours']),
('vessel_hours','Vessel + Cruising Hours + Passengers + Fuel',
 'Cruising hours, nautical miles, crew and marine fees. Boats and yachts.',
 ARRAY['private_hourly_rate','passenger_price','minimum_hours','vessel_capacity','captain_fee','crew_fee',
       'fuel_consumption_l_per_hour','marina_fee','berth_fee','landing_fee','catering_per_passenger',
       'water_sports_fee','fishing_equipment_fee','repositioning_fee','waiting_hourly'],
 ARRAY['private_hourly_rate','minimum_hours']),
('negotiated','Fixed / Negotiated / Project Quote',
 'No automatic customer price. Superyachts, specialised cranes, heavy-haul projects, special missions.',
 ARRAY['indicative_from','indicative_to','deposit_pct','quote_validity_days','minimum_engagement_days'],
 ARRAY['quote_validity_days']),
('contract','Contract Pricing',
 'Negotiated corporate and institutional rates: fixed routes, volume and commitment based.',
 ARRAY['contract_rate','rate_unit','volume_discount_pct','monthly_commitment','minimum_spend',
       'fixed_route_rate','billing_cycle','po_required'],
 ARRAY['contract_rate','rate_unit']);

-- ---------- 12. Seed the 11 families ----------------------------------
INSERT INTO public.ap360_families (code, label, sort_order) VALUES
('cars','Cars',10),('vans','Vans',20),('shuttle','Shuttle',30),('bus','Bus / Coach',40),
('trucks','Trucks',50),('trailer','Trailer / Hauler',60),('equipment','Equipment',70),
('boats','Boats',80),('yachts','Yachts',90),('helicopters','Helicopters',100),('aircraft','Aircraft',110);

-- ---------- 13. Seed every category with its engine and reference band -
INSERT INTO public.ap360_categories
  (code, family_code, label, engine_code, reference_low, reference_high, reference_unit, capacity, sort_order) VALUES
-- Cars — time + distance, KSh/day reference bands
('cars_economy','cars','Economy','time_distance',2500,4500,'per_day',4,10),
('cars_standard','cars','Standard','time_distance',4000,6500,'per_day',5,20),
('cars_premium','cars','Premium','time_distance',7500,15000,'per_day',5,30),
('cars_suv','cars','SUV','time_distance',7500,12000,'per_day',7,40),
('cars_safari_4x4','cars','4x4 Safari','time_distance',10000,18000,'per_day',7,50),
('cars_luxury','cars','Luxury','time_distance',18000,30000,'per_day',4,60),
-- Vans
('vans_7','vans','7-Seater','time_distance',7000,11000,'per_day',7,10),
('vans_8','vans','8-Seater','time_distance',8000,12000,'per_day',8,20),
('vans_14','vans','14-Seater','time_distance',10000,16000,'per_day',14,30),
('vans_16','vans','16-Seater','time_distance',12000,18000,'per_day',16,40),
('vans_safari','vans','Safari Van','time_distance',14000,22000,'per_day',7,50),
-- Shuttle
('shuttle_airport','shuttle','Airport','time_distance',3500,9000,'per_trip',14,10),
('shuttle_corporate','shuttle','Corporate','contract',8000,20000,'per_day',14,20),
('shuttle_staff','shuttle','Staff','contract',8000,25000,'per_day',29,30),
('shuttle_event','shuttle','Event','time_distance',12000,30000,'per_day',29,40),
-- Bus / Coach
('bus_coaster','bus','Coaster','time_distance',15000,25000,'per_day',29,10),
('bus_30','bus','30-Seater','time_distance',20000,32000,'per_day',30,20),
('bus_40','bus','40-Seater','time_distance',28000,45000,'per_day',40,30),
('bus_50','bus','50-Seater','time_distance',35000,60000,'per_day',50,40),
('bus_executive','bus','Executive Coach','time_distance',50000,95000,'per_day',45,50),
-- Trucks
('trucks_pickup','trucks','Pickup','trip_payload',6000,12000,'per_trip',NULL,10),
('trucks_canter','trucks','Canter','trip_payload',10000,20000,'per_trip',NULL,20),
('trucks_10t','trucks','10T','trip_payload',18000,35000,'per_trip',NULL,30),
('trucks_20t','trucks','20T','trip_payload',30000,60000,'per_trip',NULL,40),
('trucks_container','trucks','Container','trip_payload',40000,90000,'per_trip',NULL,50),
('trucks_flatbed','trucks','Flatbed','trip_payload',35000,80000,'per_trip',NULL,60),
('trucks_reefer','trucks','Refrigerated','trip_payload',45000,110000,'per_trip',NULL,70),
-- Trailer / hauler
('trailer_flatbed','trailer','Flatbed','trip_payload',45000,110000,'per_trip',NULL,10),
('trailer_lowboy','trailer','Lowboy','trip_payload',60000,180000,'per_trip',NULL,20),
('trailer_container','trailer','Container','trip_payload',50000,130000,'per_trip',NULL,30),
('trailer_heavy','trailer','Heavy Hauler','negotiated',NULL,NULL,'per_project',NULL,40),
-- Equipment — hourly reference bands
('equipment_excavator','equipment','Excavator','hours_mobilisation',5500,10000,'per_hour',NULL,10),
('equipment_dozer','equipment','Dozer','hours_mobilisation',6000,10000,'per_hour',NULL,20),
('equipment_grader','equipment','Grader','hours_mobilisation',5000,7000,'per_hour',NULL,30),
('equipment_roller','equipment','Roller','hours_mobilisation',3500,6000,'per_hour',NULL,40),
('equipment_loader','equipment','Loader','hours_mobilisation',4500,7500,'per_hour',NULL,50),
('equipment_crane','equipment','Crane','negotiated',NULL,NULL,'per_project',NULL,60),
('equipment_specialized','equipment','Specialized','negotiated',NULL,NULL,'per_project',NULL,70),
-- Boats
('boats_shared','boats','Shared','vessel_hours',1500,4000,'per_passenger',30,10),
('boats_private','boats','Private','vessel_hours',8000,25000,'per_hour',12,20),
('boats_fishing','boats','Fishing','vessel_hours',12000,35000,'per_hour',8,30),
('boats_speedboat','boats','Speedboat','vessel_hours',10000,30000,'per_hour',10,40),
-- Yachts
('yachts_standard','yachts','Standard','vessel_hours',15000,50000,'per_hour',12,10),
('yachts_premium','yachts','Premium','vessel_hours',35000,100000,'per_hour',20,20),
('yachts_luxury','yachts','Luxury','vessel_hours',100000,250000,'per_hour',30,30),
('yachts_superyacht','yachts','Superyacht','negotiated',NULL,NULL,'per_project',40,40),
-- Helicopters — block hour reference bands
('heli_light','helicopters','Light','block_hour',190000,260000,'per_block_hour',4,10),
('heli_utility','helicopters','Utility','block_hour',220000,320000,'per_block_hour',6,20),
('heli_executive','helicopters','Executive','block_hour',280000,450000,'per_block_hour',6,30),
('heli_special','helicopters','Special Mission','negotiated',NULL,NULL,'per_project',6,40),
-- Aircraft — block hour reference bands
('air_caravan','aircraft','Caravan','block_hour',180000,280000,'per_block_hour',12,10),
('air_kingair','aircraft','King Air','block_hour',300000,480000,'per_block_hour',9,20),
('air_twin_turboprop','aircraft','Twin Turboprop','block_hour',280000,450000,'per_block_hour',10,30),
('air_light_jet','aircraft','Light Jet','block_hour',550000,850000,'per_block_hour',7,40),
('air_midsize_jet','aircraft','Midsize Jet','block_hour',850000,1400000,'per_block_hour',9,50),
('air_heavy_jet','aircraft','Heavy Jet','negotiated',NULL,NULL,'per_project',14,60);

-- ---------- 14. Seed tax rules (rule driven, not blanket) -------------
INSERT INTO public.ap360_tax_rules
  (code, label, tax_type, rate_pct, taxable_status, inclusive, family_codes, geography, source, effective_from) VALUES
('KE_VAT_STANDARD','Kenya VAT — standard rate','vat',16,'standard',false,
 ARRAY['cars','vans','shuttle','bus','trucks','trailer','equipment','boats','yachts'],'KE',
 'VAT Act 2013 (Kenya), standard rate',DATE '2023-07-01'),
('KE_AIR_PASSENGER_EXEMPT','Kenya — domestic air passenger transport (VAT exempt)','vat',0,'exempt',false,
 ARRAY['aircraft','helicopters'],'KE',
 'VAT Act 2013 First Schedule — passenger air transport exemption',DATE '2023-07-01');