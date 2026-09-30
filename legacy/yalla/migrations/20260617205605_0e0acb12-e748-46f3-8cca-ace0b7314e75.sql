
-- =========================================================================
-- PHASE 4: INTERNATIONAL GOVERNANCE + REGULATORY SEED
-- =========================================================================

-- 1. REGULATORY CAPS (hard limits per country)
CREATE TABLE public.regulatory_caps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code TEXT NOT NULL,
  regulator TEXT NOT NULL,
  framework_ref TEXT,
  commission_pct_max NUMERIC(5,2),
  driver_share_pct_min NUMERIC(5,2),
  minimum_fare_local NUMERIC(10,2),
  currency TEXT,
  surge_multiplier_max NUMERIC(4,2),
  max_vehicle_age_years INTEGER,
  vat_pct NUMERIC(5,2),
  digital_service_tax_pct NUMERIC(5,2),
  effective_from DATE,
  effective_until DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  source_url TEXT,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(country_code, framework_ref)
);
GRANT SELECT ON public.regulatory_caps TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.regulatory_caps TO authenticated;
GRANT ALL ON public.regulatory_caps TO service_role;
ALTER TABLE public.regulatory_caps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reg caps readable" ON public.regulatory_caps FOR SELECT USING (true);
CREATE POLICY "reg caps admin manage" ON public.regulatory_caps FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 2. COMPLIANCE COUNTRY RULES (driver/vehicle eligibility)
CREATE TABLE public.compliance_country_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  rule_value JSONB NOT NULL,
  applies_to TEXT NOT NULL,
  is_blocking BOOLEAN NOT NULL DEFAULT true,
  source_ref TEXT,
  effective_from DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(country_code, rule_key, applies_to)
);
GRANT SELECT ON public.compliance_country_rules TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.compliance_country_rules TO authenticated;
GRANT ALL ON public.compliance_country_rules TO service_role;
ALTER TABLE public.compliance_country_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "compliance rules readable" ON public.compliance_country_rules FOR SELECT USING (true);
CREATE POLICY "compliance rules admin manage" ON public.compliance_country_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 3. COUNTRY PRICING FLOORS (per city / ride type)
CREATE TABLE public.country_pricing_floors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code TEXT NOT NULL,
  city TEXT,
  ride_type TEXT NOT NULL,
  currency TEXT NOT NULL,
  minimum_fare NUMERIC(10,2) NOT NULL,
  minimum_per_km NUMERIC(10,2),
  minimum_per_minute NUMERIC(10,2),
  source_ref TEXT,
  effective_from DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.country_pricing_floors TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.country_pricing_floors TO authenticated;
GRANT ALL ON public.country_pricing_floors TO service_role;
ALTER TABLE public.country_pricing_floors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pricing floors readable" ON public.country_pricing_floors FOR SELECT USING (true);
CREATE POLICY "pricing floors admin manage" ON public.country_pricing_floors FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 4. COUNTRY LAUNCH STATUS
CREATE TABLE public.country_launch_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code TEXT NOT NULL UNIQUE,
  country_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  launch_date DATE,
  primary_city TEXT,
  active_cities TEXT[],
  services_enabled TEXT[],
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.country_launch_status TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.country_launch_status TO authenticated;
GRANT ALL ON public.country_launch_status TO service_role;
ALTER TABLE public.country_launch_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "launch status readable" ON public.country_launch_status FOR SELECT USING (true);
CREATE POLICY "launch status admin manage" ON public.country_launch_status FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 5. COUNTRY GOVERNANCE CONTACTS
CREATE TABLE public.country_governance_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code TEXT NOT NULL,
  regulator TEXT NOT NULL,
  contact_name TEXT,
  contact_role TEXT,
  email TEXT,
  phone TEXT,
  response_sla_hours INTEGER,
  escalation_path TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.country_governance_contacts TO authenticated;
GRANT ALL ON public.country_governance_contacts TO service_role;
ALTER TABLE public.country_governance_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gov contacts admin" ON public.country_governance_contacts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 6. INCIDENT NOC (network operations center)
CREATE TABLE public.incident_nocs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_code TEXT NOT NULL UNIQUE,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  title TEXT NOT NULL,
  summary TEXT,
  affected_services TEXT[],
  affected_countries TEXT[],
  blast_radius_pct NUMERIC(5,2),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  mitigated_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  incident_commander UUID,
  comms_lead UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.incident_nocs TO authenticated;
GRANT ALL ON public.incident_nocs TO service_role;
ALTER TABLE public.incident_nocs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "noc incidents admin" ON public.incident_nocs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_incident_nocs_status ON public.incident_nocs(status, severity);

-- 7. INCIDENT RUNBOOKS
CREATE TABLE public.incident_runbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  runbook_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  trigger_conditions JSONB,
  steps JSONB NOT NULL,
  owner TEXT,
  last_validated_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.incident_runbooks TO authenticated;
GRANT ALL ON public.incident_runbooks TO service_role;
ALTER TABLE public.incident_runbooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "runbooks admin" ON public.incident_runbooks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 8. INCIDENT POSTMORTEMS
CREATE TABLE public.incident_postmortems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID NOT NULL REFERENCES public.incident_nocs(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  root_cause TEXT,
  contributing_factors TEXT[],
  customer_impact TEXT,
  what_went_well TEXT,
  what_went_poorly TEXT,
  action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  authored_by UUID,
  reviewed_by UUID,
  published_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.incident_postmortems TO authenticated;
GRANT ALL ON public.incident_postmortems TO service_role;
ALTER TABLE public.incident_postmortems ENABLE ROW LEVEL SECURITY;
CREATE POLICY "postmortems admin" ON public.incident_postmortems FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- updated_at triggers
CREATE TRIGGER trg_regulatory_caps_updated BEFORE UPDATE ON public.regulatory_caps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_compliance_rules_updated BEFORE UPDATE ON public.compliance_country_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_pricing_floors_updated BEFORE UPDATE ON public.country_pricing_floors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_launch_status_updated BEFORE UPDATE ON public.country_launch_status
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_gov_contacts_updated BEFORE UPDATE ON public.country_governance_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_incident_nocs_updated BEFORE UPDATE ON public.incident_nocs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_runbooks_updated BEFORE UPDATE ON public.incident_runbooks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_postmortems_updated BEFORE UPDATE ON public.incident_postmortems
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================================
-- KENYA SEED DATA (from docs/research/ntsa-kenya-tnc-rules.md)
-- =========================================================================

-- Regulatory caps for Kenya (NTSA LN120/2022)
INSERT INTO public.regulatory_caps
  (country_code, regulator, framework_ref, commission_pct_max, driver_share_pct_min,
   minimum_fare_local, currency, surge_multiplier_max, max_vehicle_age_years,
   vat_pct, digital_service_tax_pct, effective_from, source_url, notes)
VALUES
  ('KE', 'NTSA', 'NTSA-LN120-2022', 18.00, 82.00, 220.00, 'KES', 3.00, 8, 16.00, 1.50,
   '2022-06-20',
   'https://new.kenyalaw.org/akn/ke/act/ln/2022/120',
   'Legal Notice 120 of 2022. 18% commission cap, 82% driver share, KES 220 floor (Uber Aug-2024).');

-- Compliance rules for Kenya (driver + vehicle)
INSERT INTO public.compliance_country_rules
  (country_code, rule_key, rule_value, applies_to, is_blocking, source_ref) VALUES
  ('KE', 'driver_min_age',           '{"value":24,"unit":"years"}'::jsonb,             'driver',  true, 'NTSA-LN120-2022'),
  ('KE', 'driver_min_experience',    '{"value":4,"unit":"years"}'::jsonb,              'driver',  true, 'NTSA-LN120-2022'),
  ('KE', 'driver_psv_badge',         '{"required":true,"validity_months":12}'::jsonb,  'driver',  true, 'NTSA-LN120-2022'),
  ('KE', 'driver_good_conduct',      '{"required":true,"max_age_months":6}'::jsonb,    'driver',  true, 'DCI Kenya'),
  ('KE', 'driver_medical_cert',      '{"required":true,"validity_months":12}'::jsonb,  'driver',  true, 'NTSA medical'),
  ('KE', 'driver_kra_pin',           '{"required":true}'::jsonb,                       'driver',  true, 'KRA'),
  ('KE', 'vehicle_psv_licence',      '{"required":true,"validity_months":12}'::jsonb,  'vehicle', true, 'NTSA-LN120-2022'),
  ('KE', 'vehicle_inspection',       '{"required":true,"validity_months":12}'::jsonb,  'vehicle', true, 'NTSA inspection'),
  ('KE', 'vehicle_insurance',        '{"required":true,"type":"comprehensive_psv"}'::jsonb, 'vehicle', true, 'IRA Kenya'),
  ('KE', 'vehicle_max_age',          '{"value":8,"unit":"years"}'::jsonb,              'vehicle', true, 'NTSA PSV class'),
  ('KE', 'boda_helmet',              '{"required":true,"covers":["rider","pillion"]}'::jsonb, 'boda', true, 'NTA Act + County Boda 2023'),
  ('KE', 'boda_pillion_limit',       '{"max_pillion":1}'::jsonb,                        'boda', true,    'NTA Act + County Boda 2023'),
  ('KE', 'fare_disclosure_pretrip',  '{"required":true}'::jsonb,                        'tnc',  true,    'NTSA-LN120-2022'),
  ('KE', 'sos_button_inapp',         '{"required":true}'::jsonb,                        'tnc',  true,    'NTSA-LN120-2022'),
  ('KE', 'trip_share_inapp',         '{"required":true}'::jsonb,                        'tnc',  true,    'NTSA-LN120-2022'),
  ('KE', 'data_residency',           '{"required":true,"jurisdiction":"KE"}'::jsonb,    'tnc',  true,    'Data Protection Act 2019');

-- Pricing floors for Kenya
INSERT INTO public.country_pricing_floors
  (country_code, city, ride_type, currency, minimum_fare, minimum_per_km, minimum_per_minute, source_ref)
VALUES
  ('KE', 'Nairobi',  'economy', 'KES', 220.00, 30.00, 3.00, 'Uber KE Aug-2024 floor'),
  ('KE', 'Nairobi',  'comfort', 'KES', 300.00, 45.00, 4.00, 'Market observed 2024'),
  ('KE', 'Nairobi',  'xl',      'KES', 450.00, 65.00, 5.00, 'Market observed 2024'),
  ('KE', 'Nairobi',  'boda',    'KES', 150.00, 18.00, 2.00, 'Boda class — county fee schedule'),
  ('KE', 'Mombasa',  'economy', 'KES', 200.00, 28.00, 3.00, 'Market observed 2024'),
  ('KE', 'Kisumu',   'economy', 'KES', 180.00, 26.00, 3.00, 'Market observed 2024');

-- Launch status (East Africa expansion plan)
INSERT INTO public.country_launch_status
  (country_code, country_name, status, launch_date, primary_city, active_cities, services_enabled, notes)
VALUES
  ('KE', 'Kenya',    'live',    '2026-01-01', 'Nairobi', ARRAY['Nairobi','Mombasa','Kisumu','Nakuru','Eldoret'],
   ARRAY['ride_hailing','boda','delivery','corporate'], 'Primary market.'),
  ('UG', 'Uganda',   'planned', NULL, 'Kampala', ARRAY['Kampala'],
   ARRAY['ride_hailing','boda'], 'Awaiting UCC + URA registration.'),
  ('TZ', 'Tanzania', 'planned', NULL, 'Dar es Salaam', ARRAY['Dar es Salaam','Arusha'],
   ARRAY['ride_hailing'], 'LATRA licensing in progress.'),
  ('RW', 'Rwanda',   'planned', NULL, 'Kigali', ARRAY['Kigali'],
   ARRAY['ride_hailing','delivery'], 'RURA approval pending.'),
  ('ET', 'Ethiopia', 'planned', NULL, 'Addis Ababa', ARRAY['Addis Ababa'],
   ARRAY['ride_hailing'], 'Federal Transport Authority engagement.');

-- Governance contact (placeholder for NTSA — primary)
INSERT INTO public.country_governance_contacts
  (country_code, regulator, contact_role, email, phone, response_sla_hours, escalation_path, is_primary)
VALUES
  ('KE', 'NTSA', 'Director General Office', 'info@ntsa.go.ke', '+254 709 932 300', 72,
   'NTSA DG → CS Roads & Transport → TLAB appeal', true);

-- Baseline runbooks
INSERT INTO public.incident_runbooks (runbook_key, title, category, steps, owner) VALUES
  ('dispatch_outage',     'Dispatch engine outage',           'dispatch',
    '[{"step":1,"action":"Verify dispatch-engine edge function health"},{"step":2,"action":"Failover to fallback nearest-driver lookup"},{"step":3,"action":"Page on-call engineer"}]'::jsonb,
    'platform-oncall'),
  ('mpesa_callback_lag',  'M-Pesa callback latency / failures','payments',
    '[{"step":1,"action":"Check mpesa-callback edge function logs"},{"step":2,"action":"Verify Daraja API status"},{"step":3,"action":"Switch to manual reconciliation mode"}]'::jsonb,
    'payments-oncall'),
  ('surge_runaway',       'Runaway surge multiplier',          'marketplace',
    '[{"step":1,"action":"Clamp marketplace_surge_multipliers to 1.50"},{"step":2,"action":"Disable auto-surge cron"},{"step":3,"action":"Investigate demand snapshot anomalies"}]'::jsonb,
    'marketplace-oncall'),
  ('mass_driver_logout',  'Mass driver app logout / auth fail','identity',
    '[{"step":1,"action":"Check Supabase auth status"},{"step":2,"action":"Inspect recent JWT rotation events"},{"step":3,"action":"Broadcast in-app banner to drivers"}]'::jsonb,
    'identity-oncall');
