-- ============================================================
-- YALLA RIDE: ENTERPRISE DRIVER OPERATIONS PLATFORM
-- 12-Phase upgrade: lifecycle, risk, OCR, multi-country,
-- vehicle compliance, monitoring, fleet hierarchy, assets,
-- financial ecosystem, event sourcing, analytics, digital twin.
-- All new — extends existing schema, does not rebuild.
-- ============================================================

-- ---------- ENUMS ----------
DO $$ BEGIN
  CREATE TYPE public.lifecycle_stage AS ENUM (
    'APPLICANT','SCREENING','KYC','TRAINING','VEHICLE_ASSIGNMENT',
    'ACTIVATION','ACTIVE','PERFORMANCE_REVIEW','REWARDED',
    'WARNED','RESTRICTED','SUSPENDED','REACTIVATED','RETIRED','REJECTED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.risk_severity AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ocr_status AS ENUM ('PENDING','PROCESSING','SUCCEEDED','FAILED','REVIEW');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.compliance_action_type AS ENUM ('WARN','RESTRICT','SUSPEND','DEACTIVATE','REINSTATE','NOTIFY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.compliance_alert_status AS ENUM ('OPEN','ACK','RESOLVED','DISMISSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.fleet_entity_type AS ENUM ('HOLDING','COMPANY','BRANCH');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.loan_status AS ENUM ('REQUESTED','APPROVED','DISBURSED','REPAYING','COMPLETED','DEFAULTED','REJECTED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.insurance_status AS ENUM ('ACTIVE','EXPIRED','CANCELLED','PENDING','CLAIM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- PHASE 1: LIFECYCLE ----------
CREATE TABLE IF NOT EXISTS public.driver_lifecycle_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  sort_order int NOT NULL,
  description text,
  is_terminal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.driver_lifecycle_stages TO anon, authenticated;
GRANT ALL ON public.driver_lifecycle_stages TO service_role;
ALTER TABLE public.driver_lifecycle_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lifecycle_stages_read" ON public.driver_lifecycle_stages FOR SELECT USING (true);
CREATE POLICY "lifecycle_stages_admin" ON public.driver_lifecycle_stages FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.driver_lifecycle_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  from_stage public.lifecycle_stage,
  to_stage public.lifecycle_stage NOT NULL,
  reason text,
  actor_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dlh_driver ON public.driver_lifecycle_history(driver_id, created_at DESC);
GRANT SELECT, INSERT ON public.driver_lifecycle_history TO authenticated;
GRANT ALL ON public.driver_lifecycle_history TO service_role;
ALTER TABLE public.driver_lifecycle_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dlh_driver_read_own" ON public.driver_lifecycle_history FOR SELECT TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));
CREATE POLICY "dlh_admin_insert" ON public.driver_lifecycle_history FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.driver_lifecycle_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  action public.compliance_action_type NOT NULL,
  reason text,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  actor_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dla_driver ON public.driver_lifecycle_actions(driver_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.driver_lifecycle_actions TO authenticated;
GRANT ALL ON public.driver_lifecycle_actions TO service_role;
ALTER TABLE public.driver_lifecycle_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dla_read" ON public.driver_lifecycle_actions FOR SELECT TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));
CREATE POLICY "dla_admin_write" ON public.driver_lifecycle_actions FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- ---------- PHASE 2: RISK INTELLIGENCE ----------
CREATE TABLE IF NOT EXISTS public.driver_risk_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid UNIQUE NOT NULL,
  compliance_score numeric(5,2) DEFAULT 100,
  safety_score numeric(5,2) DEFAULT 100,
  fraud_score numeric(5,2) DEFAULT 0,
  financial_score numeric(5,2) DEFAULT 100,
  operational_score numeric(5,2) DEFAULT 100,
  overall_risk public.risk_severity NOT NULL DEFAULT 'LOW',
  last_evaluated_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.driver_risk_profiles TO authenticated;
GRANT ALL ON public.driver_risk_profiles TO service_role;
ALTER TABLE public.driver_risk_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drp_read" ON public.driver_risk_profiles FOR SELECT TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.driver_risk_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  rule_code text NOT NULL,
  severity public.risk_severity NOT NULL,
  score_delta numeric(5,2) NOT NULL DEFAULT 0,
  dimension text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dre_driver ON public.driver_risk_events(driver_id, created_at DESC);
GRANT SELECT ON public.driver_risk_events TO authenticated;
GRANT ALL ON public.driver_risk_events TO service_role;
ALTER TABLE public.driver_risk_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dre_read" ON public.driver_risk_events FOR SELECT TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.driver_risk_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  dimension text NOT NULL,
  severity public.risk_severity NOT NULL,
  score_delta numeric(5,2) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  config jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.driver_risk_rules TO authenticated;
GRANT ALL ON public.driver_risk_rules TO service_role;
ALTER TABLE public.driver_risk_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drr_read" ON public.driver_risk_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "drr_admin" ON public.driver_risk_rules FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- ---------- PHASE 3: OCR INTELLIGENCE ----------
CREATE TABLE IF NOT EXISTS public.ocr_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid,
  driver_id uuid,
  vehicle_id uuid,
  document_type text,
  storage_bucket text,
  storage_path text,
  status public.ocr_status NOT NULL DEFAULT 'PENDING',
  provider text NOT NULL DEFAULT 'lovable-ai',
  model text,
  raw_text text,
  extracted jsonb DEFAULT '{}'::jsonb,
  confidence numeric(5,2),
  error_message text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ocr_driver ON public.ocr_extractions(driver_id);
CREATE INDEX IF NOT EXISTS idx_ocr_doc ON public.ocr_extractions(document_id);
GRANT SELECT, INSERT ON public.ocr_extractions TO authenticated;
GRANT ALL ON public.ocr_extractions TO service_role;
ALTER TABLE public.ocr_extractions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ocr_read" ON public.ocr_extractions FOR SELECT TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));
CREATE POLICY "ocr_owner_insert" ON public.ocr_extractions FOR INSERT TO authenticated
  WITH CHECK (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
              OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.ocr_validation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  extraction_id uuid NOT NULL REFERENCES public.ocr_extractions(id) ON DELETE CASCADE,
  field text NOT NULL,
  expected text,
  actual text,
  passed boolean NOT NULL,
  severity public.risk_severity NOT NULL DEFAULT 'LOW',
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ovr_extraction ON public.ocr_validation_results(extraction_id);
GRANT SELECT ON public.ocr_validation_results TO authenticated;
GRANT ALL ON public.ocr_validation_results TO service_role;
ALTER TABLE public.ocr_validation_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ovr_read" ON public.ocr_validation_results FOR SELECT TO authenticated
  USING (extraction_id IN (
    SELECT id FROM public.ocr_extractions
    WHERE driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  ) OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- ---------- PHASE 4: MULTI-COUNTRY ----------
CREATE TABLE IF NOT EXISTS public.countries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iso2 text UNIQUE NOT NULL,
  iso3 text UNIQUE NOT NULL,
  name text NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  phone_code text,
  timezone text DEFAULT 'Africa/Nairobi',
  is_active boolean NOT NULL DEFAULT true,
  launched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.countries TO anon, authenticated;
GRANT ALL ON public.countries TO service_role;
ALTER TABLE public.countries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "countries_read" ON public.countries FOR SELECT USING (true);
CREATE POLICY "countries_admin" ON public.countries FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id uuid NOT NULL REFERENCES public.countries(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  parent_id uuid REFERENCES public.regions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(country_id, code)
);
GRANT SELECT ON public.regions TO anon, authenticated;
GRANT ALL ON public.regions TO service_role;
ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "regions_read" ON public.regions FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.regulatory_frameworks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id uuid NOT NULL REFERENCES public.countries(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  authority text,
  version text,
  effective_from date,
  effective_to date,
  config jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(country_id, code, version)
);
GRANT SELECT ON public.regulatory_frameworks TO authenticated;
GRANT ALL ON public.regulatory_frameworks TO service_role;
ALTER TABLE public.regulatory_frameworks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "regf_read" ON public.regulatory_frameworks FOR SELECT TO authenticated USING (true);
CREATE POLICY "regf_admin" ON public.regulatory_frameworks FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.country_document_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id uuid NOT NULL REFERENCES public.countries(id) ON DELETE CASCADE,
  document_type_id uuid REFERENCES public.kyc_document_types(id) ON DELETE CASCADE,
  required boolean NOT NULL DEFAULT true,
  applies_to text NOT NULL DEFAULT 'DRIVER',
  framework_id uuid REFERENCES public.regulatory_frameworks(id) ON DELETE SET NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(country_id, document_type_id, applies_to)
);
GRANT SELECT ON public.country_document_requirements TO authenticated;
GRANT ALL ON public.country_document_requirements TO service_role;
ALTER TABLE public.country_document_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cdr_read" ON public.country_document_requirements FOR SELECT TO authenticated USING (true);
CREATE POLICY "cdr_admin" ON public.country_document_requirements FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- ---------- PHASE 5: VEHICLE COMPLIANCE ----------
CREATE TABLE IF NOT EXISTS public.vehicle_compliance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid UNIQUE NOT NULL,
  compliance_score numeric(5,2) DEFAULT 100,
  inspection_score numeric(5,2) DEFAULT 100,
  insurance_score numeric(5,2) DEFAULT 100,
  roadworthiness_score numeric(5,2) DEFAULT 100,
  overall_risk public.risk_severity NOT NULL DEFAULT 'LOW',
  last_evaluated_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.vehicle_compliance TO authenticated;
GRANT ALL ON public.vehicle_compliance TO service_role;
ALTER TABLE public.vehicle_compliance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vc_read" ON public.vehicle_compliance FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin','fleet_owner']::app_role[]));

CREATE TABLE IF NOT EXISTS public.vehicle_compliance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  rule_code text NOT NULL,
  severity public.risk_severity NOT NULL,
  dimension text NOT NULL,
  score_delta numeric(5,2) NOT NULL DEFAULT 0,
  details jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vce_vehicle ON public.vehicle_compliance_events(vehicle_id, created_at DESC);
GRANT SELECT ON public.vehicle_compliance_events TO authenticated;
GRANT ALL ON public.vehicle_compliance_events TO service_role;
ALTER TABLE public.vehicle_compliance_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vce_read" ON public.vehicle_compliance_events FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin','fleet_owner']::app_role[]));

-- ---------- PHASE 6: AUTOMATED COMPLIANCE MONITORING ----------
CREATE TABLE IF NOT EXISTS public.compliance_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_code text NOT NULL,
  scope text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  scanned_count int DEFAULT 0,
  alert_count int DEFAULT 0,
  action_count int DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.compliance_jobs TO authenticated;
GRANT ALL ON public.compliance_jobs TO service_role;
ALTER TABLE public.compliance_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cj_admin_read" ON public.compliance_jobs FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.compliance_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid REFERENCES public.compliance_jobs(id) ON DELETE SET NULL,
  driver_id uuid,
  vehicle_id uuid,
  alert_code text NOT NULL,
  severity public.risk_severity NOT NULL,
  status public.compliance_alert_status NOT NULL DEFAULT 'OPEN',
  title text NOT NULL,
  details jsonb DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ca_driver ON public.compliance_alerts(driver_id, status);
CREATE INDEX IF NOT EXISTS idx_ca_vehicle ON public.compliance_alerts(vehicle_id, status);
GRANT SELECT, UPDATE ON public.compliance_alerts TO authenticated;
GRANT ALL ON public.compliance_alerts TO service_role;
ALTER TABLE public.compliance_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ca_read" ON public.compliance_alerts FOR SELECT TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin','fleet_owner']::app_role[]));
CREATE POLICY "ca_admin_update" ON public.compliance_alerts FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.compliance_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id uuid REFERENCES public.compliance_alerts(id) ON DELETE SET NULL,
  driver_id uuid,
  vehicle_id uuid,
  action public.compliance_action_type NOT NULL,
  reason text,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  actor_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.compliance_actions TO authenticated;
GRANT ALL ON public.compliance_actions TO service_role;
ALTER TABLE public.compliance_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cact_read" ON public.compliance_actions FOR SELECT TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin','fleet_owner']::app_role[]));

-- ---------- PHASE 7: FLEET HIERARCHY ----------
CREATE TABLE IF NOT EXISTS public.fleet_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES public.fleet_companies(id) ON DELETE SET NULL,
  entity_type public.fleet_entity_type NOT NULL DEFAULT 'COMPANY',
  legal_name text NOT NULL,
  trading_name text,
  registration_number text,
  tax_id text,
  country_id uuid REFERENCES public.countries(id) ON DELETE SET NULL,
  owner_user_id uuid,
  status text NOT NULL DEFAULT 'ACTIVE',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fc_parent ON public.fleet_companies(parent_id);
GRANT SELECT, INSERT, UPDATE ON public.fleet_companies TO authenticated;
GRANT ALL ON public.fleet_companies TO service_role;
ALTER TABLE public.fleet_companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fc_read" ON public.fleet_companies FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));
CREATE POLICY "fc_owner_write" ON public.fleet_companies FOR ALL TO authenticated
  USING (owner_user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
  WITH CHECK (owner_user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.fleet_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.fleet_companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  region_id uuid REFERENCES public.regions(id) ON DELETE SET NULL,
  address text,
  phone text,
  status text NOT NULL DEFAULT 'ACTIVE',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.fleet_branches TO authenticated;
GRANT ALL ON public.fleet_branches TO service_role;
ALTER TABLE public.fleet_branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fb_read" ON public.fleet_branches FOR SELECT TO authenticated
  USING (company_id IN (SELECT id FROM public.fleet_companies WHERE owner_user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.fleet_managers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.fleet_companies(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES public.fleet_branches(id) ON DELETE SET NULL,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'MANAGER',
  permissions jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_managers TO authenticated;
GRANT ALL ON public.fleet_managers TO service_role;
ALTER TABLE public.fleet_managers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fm_read" ON public.fleet_managers FOR SELECT TO authenticated
  USING (user_id = auth.uid()
         OR company_id IN (SELECT id FROM public.fleet_companies WHERE owner_user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

-- ---------- PHASE 8: VEHICLE ASSET MANAGEMENT ----------
CREATE TABLE IF NOT EXISTS public.vehicle_maintenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  category text NOT NULL,
  description text,
  performed_at timestamptz NOT NULL DEFAULT now(),
  next_due_at timestamptz,
  odometer_km int,
  cost_cents bigint DEFAULT 0,
  currency text DEFAULT 'KES',
  vendor text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vm_vehicle ON public.vehicle_maintenance(vehicle_id, performed_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.vehicle_maintenance TO authenticated;
GRANT ALL ON public.vehicle_maintenance TO service_role;
ALTER TABLE public.vehicle_maintenance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vm_read" ON public.vehicle_maintenance FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin','fleet_owner']::app_role[]));

CREATE TABLE IF NOT EXISTS public.vehicle_service_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  service_type text NOT NULL,
  performed_at timestamptz NOT NULL DEFAULT now(),
  odometer_km int,
  notes text,
  cost_cents bigint DEFAULT 0,
  attachments jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.vehicle_service_records TO authenticated;
GRANT ALL ON public.vehicle_service_records TO service_role;
ALTER TABLE public.vehicle_service_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vsr_read" ON public.vehicle_service_records FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin','fleet_owner']::app_role[]));

CREATE TABLE IF NOT EXISTS public.vehicle_accidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  driver_id uuid,
  occurred_at timestamptz NOT NULL,
  severity public.risk_severity NOT NULL DEFAULT 'LOW',
  location text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  description text,
  police_report_no text,
  insurance_claim_no text,
  estimated_cost_cents bigint,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.vehicle_accidents TO authenticated;
GRANT ALL ON public.vehicle_accidents TO service_role;
ALTER TABLE public.vehicle_accidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "va_read" ON public.vehicle_accidents FOR SELECT TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin','fleet_owner']::app_role[]));

CREATE TABLE IF NOT EXISTS public.vehicle_repairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  accident_id uuid REFERENCES public.vehicle_accidents(id) ON DELETE SET NULL,
  description text NOT NULL,
  vendor text,
  started_at timestamptz,
  completed_at timestamptz,
  cost_cents bigint DEFAULT 0,
  status text NOT NULL DEFAULT 'OPEN',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.vehicle_repairs TO authenticated;
GRANT ALL ON public.vehicle_repairs TO service_role;
ALTER TABLE public.vehicle_repairs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vr_read" ON public.vehicle_repairs FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin','fleet_owner']::app_role[]));

CREATE TABLE IF NOT EXISTS public.vehicle_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL,
  cost_type text NOT NULL,
  amount_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  incurred_at timestamptz NOT NULL DEFAULT now(),
  reference_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vcost_vehicle ON public.vehicle_costs(vehicle_id, incurred_at DESC);
GRANT SELECT, INSERT ON public.vehicle_costs TO authenticated;
GRANT ALL ON public.vehicle_costs TO service_role;
ALTER TABLE public.vehicle_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vcost_read" ON public.vehicle_costs FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin','fleet_owner']::app_role[]));

-- ---------- PHASE 9: DRIVER FINANCIAL ECOSYSTEM ----------
CREATE TABLE IF NOT EXISTS public.driver_savings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  balance_cents bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'KES',
  goal_cents bigint,
  goal_label text,
  interest_rate_bps int DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.driver_savings TO authenticated;
GRANT ALL ON public.driver_savings TO service_role;
ALTER TABLE public.driver_savings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ds_own" ON public.driver_savings FOR SELECT TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.driver_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  principal_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  interest_rate_bps int NOT NULL DEFAULT 0,
  term_months int NOT NULL,
  outstanding_cents bigint NOT NULL,
  status public.loan_status NOT NULL DEFAULT 'REQUESTED',
  purpose text,
  disbursed_at timestamptz,
  due_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dl_driver ON public.driver_loans(driver_id, status);
GRANT SELECT, INSERT ON public.driver_loans TO authenticated;
GRANT ALL ON public.driver_loans TO service_role;
ALTER TABLE public.driver_loans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dl_own" ON public.driver_loans FOR SELECT TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.driver_insurance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  product text NOT NULL,
  provider text,
  policy_number text,
  status public.insurance_status NOT NULL DEFAULT 'PENDING',
  premium_cents bigint,
  coverage_cents bigint,
  starts_at date,
  ends_at date,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.driver_insurance TO authenticated;
GRANT ALL ON public.driver_insurance TO service_role;
ALTER TABLE public.driver_insurance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "di_own" ON public.driver_insurance FOR SELECT TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.driver_tax_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  gross_cents bigint NOT NULL DEFAULT 0,
  taxable_cents bigint NOT NULL DEFAULT 0,
  tax_cents bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'KES',
  status text NOT NULL DEFAULT 'DRAFT',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dtr_driver_period ON public.driver_tax_reports(driver_id, period_start);
GRANT SELECT ON public.driver_tax_reports TO authenticated;
GRANT ALL ON public.driver_tax_reports TO service_role;
ALTER TABLE public.driver_tax_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dtr_own" ON public.driver_tax_reports FOR SELECT TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]));

-- ---------- PHASE 10: EVENT SOURCING ----------
CREATE TABLE IF NOT EXISTS public.event_streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(aggregate_type, aggregate_id)
);
GRANT SELECT ON public.event_streams TO authenticated;
GRANT ALL ON public.event_streams TO service_role;
ALTER TABLE public.event_streams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "es_admin" ON public.event_streams FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.event_store (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream_id uuid REFERENCES public.event_streams(id) ON DELETE CASCADE,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  version bigint NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  actor_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(aggregate_type, aggregate_id, version)
);
CREATE INDEX IF NOT EXISTS idx_evt_stream ON public.event_store(stream_id, version);
CREATE INDEX IF NOT EXISTS idx_evt_agg ON public.event_store(aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS idx_evt_type ON public.event_store(event_type, occurred_at DESC);
GRANT SELECT ON public.event_store TO authenticated;
GRANT ALL ON public.event_store TO service_role;
ALTER TABLE public.event_store ENABLE ROW LEVEL SECURITY;
CREATE POLICY "evt_admin" ON public.event_store FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- Prevent UPDATE/DELETE on the event store (append-only)
CREATE OR REPLACE FUNCTION public.deny_event_store_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN RAISE EXCEPTION 'event_store is append-only'; END $$;
DROP TRIGGER IF EXISTS trg_evt_no_update ON public.event_store;
CREATE TRIGGER trg_evt_no_update BEFORE UPDATE OR DELETE ON public.event_store
  FOR EACH ROW EXECUTE FUNCTION public.deny_event_store_mutation();

CREATE TABLE IF NOT EXISTS public.event_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  version bigint NOT NULL,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(aggregate_type, aggregate_id, version)
);
GRANT SELECT ON public.event_snapshots TO authenticated;
GRANT ALL ON public.event_snapshots TO service_role;
ALTER TABLE public.event_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "esn_admin" ON public.event_snapshots FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- append_event() — primary entry point for event sourcing
CREATE OR REPLACE FUNCTION public.append_event(
  _aggregate_type text,
  _aggregate_id uuid,
  _event_type text,
  _payload jsonb DEFAULT '{}'::jsonb,
  _metadata jsonb DEFAULT '{}'::jsonb,
  _actor_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _stream_id uuid; _next_version bigint; _event_id uuid;
BEGIN
  INSERT INTO public.event_streams (aggregate_type, aggregate_id, version)
  VALUES (_aggregate_type, _aggregate_id, 1)
  ON CONFLICT (aggregate_type, aggregate_id) DO UPDATE
    SET version = event_streams.version + 1, updated_at = now()
  RETURNING id, version INTO _stream_id, _next_version;

  INSERT INTO public.event_store (stream_id, aggregate_type, aggregate_id, version,
                                  event_type, payload, metadata, actor_id)
  VALUES (_stream_id, _aggregate_type, _aggregate_id, _next_version,
          _event_type, _payload, _metadata, COALESCE(_actor_id, auth.uid()))
  RETURNING id INTO _event_id;

  RETURN _event_id;
END $$;

-- ---------- PHASE 11: ANALYTICS AGGREGATES ----------
CREATE TABLE IF NOT EXISTS public.driver_daily_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL,
  metric_date date NOT NULL,
  trips_count int DEFAULT 0,
  gross_cents bigint DEFAULT 0,
  net_cents bigint DEFAULT 0,
  online_minutes int DEFAULT 0,
  acceptance_rate numeric(5,2),
  cancellation_rate numeric(5,2),
  rating_avg numeric(3,2),
  incidents_count int DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(driver_id, metric_date)
);
CREATE INDEX IF NOT EXISTS idx_ddm_date ON public.driver_daily_metrics(metric_date DESC);
GRANT SELECT ON public.driver_daily_metrics TO authenticated;
GRANT ALL ON public.driver_daily_metrics TO service_role;
ALTER TABLE public.driver_daily_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ddm_read" ON public.driver_daily_metrics FOR SELECT TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin','fleet_owner']::app_role[]));

CREATE TABLE IF NOT EXISTS public.fleet_daily_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.fleet_companies(id) ON DELETE CASCADE,
  metric_date date NOT NULL,
  active_drivers int DEFAULT 0,
  active_vehicles int DEFAULT 0,
  trips_count int DEFAULT 0,
  gross_cents bigint DEFAULT 0,
  incidents_count int DEFAULT 0,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_id, metric_date)
);
GRANT SELECT ON public.fleet_daily_metrics TO authenticated;
GRANT ALL ON public.fleet_daily_metrics TO service_role;
ALTER TABLE public.fleet_daily_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fdm_read" ON public.fleet_daily_metrics FOR SELECT TO authenticated
  USING (company_id IN (SELECT id FROM public.fleet_companies WHERE owner_user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

-- ---------- PHASE 12: DIGITAL TWIN ----------
CREATE TABLE IF NOT EXISTS public.driver_profiles_extended (
  driver_id uuid PRIMARY KEY,
  current_stage public.lifecycle_stage NOT NULL DEFAULT 'APPLICANT',
  country_id uuid REFERENCES public.countries(id) ON DELETE SET NULL,
  region_id uuid REFERENCES public.regions(id) ON DELETE SET NULL,
  fleet_company_id uuid REFERENCES public.fleet_companies(id) ON DELETE SET NULL,
  fleet_branch_id uuid REFERENCES public.fleet_branches(id) ON DELETE SET NULL,
  primary_vehicle_id uuid,
  preferred_language text DEFAULT 'en',
  preferences jsonb DEFAULT '{}'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.driver_profiles_extended TO authenticated;
GRANT ALL ON public.driver_profiles_extended TO service_role;
ALTER TABLE public.driver_profiles_extended ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dpe_read" ON public.driver_profiles_extended FOR SELECT TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin','fleet_owner']::app_role[]));

CREATE TABLE IF NOT EXISTS public.driver_scores (
  driver_id uuid PRIMARY KEY,
  overall numeric(5,2) DEFAULT 100,
  compliance numeric(5,2) DEFAULT 100,
  safety numeric(5,2) DEFAULT 100,
  fraud numeric(5,2) DEFAULT 0,
  financial numeric(5,2) DEFAULT 100,
  performance numeric(5,2) DEFAULT 100,
  training numeric(5,2) DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.driver_scores TO authenticated;
GRANT ALL ON public.driver_scores TO service_role;
ALTER TABLE public.driver_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dscore_read" ON public.driver_scores FOR SELECT TO authenticated
  USING (driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin','fleet_owner']::app_role[]));

CREATE TABLE IF NOT EXISTS public.driver_reputation (
  driver_id uuid PRIMARY KEY,
  rating numeric(3,2) DEFAULT 5.00,
  trips_total int DEFAULT 0,
  reviews_count int DEFAULT 0,
  badges jsonb DEFAULT '[]'::jsonb,
  achievements jsonb DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.driver_reputation TO anon, authenticated;
GRANT ALL ON public.driver_reputation TO service_role;
ALTER TABLE public.driver_reputation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drep_read" ON public.driver_reputation FOR SELECT USING (true);

-- Digital Twin VIEW — single unified profile
CREATE OR REPLACE VIEW public.driver_digital_twin AS
SELECT
  d.id AS driver_id,
  d.user_id,
  dpe.current_stage,
  dpe.country_id,
  dpe.fleet_company_id,
  dpe.fleet_branch_id,
  dpe.primary_vehicle_id,
  drp.compliance_score,
  drp.safety_score,
  drp.fraud_score,
  drp.financial_score,
  drp.operational_score,
  drp.overall_risk,
  ds.overall AS overall_score,
  ds.training AS training_score,
  drep.rating,
  drep.trips_total,
  drep.badges,
  drep.achievements,
  (SELECT count(*) FROM public.compliance_alerts ca
    WHERE ca.driver_id = d.id AND ca.status = 'OPEN') AS open_alerts,
  (SELECT count(*) FROM public.driver_documents dd
    WHERE dd.driver_id = d.id AND dd.expires_at < now()) AS expired_docs,
  dpe.updated_at AS twin_updated_at
FROM public.drivers d
LEFT JOIN public.driver_profiles_extended dpe ON dpe.driver_id = d.id
LEFT JOIN public.driver_risk_profiles drp ON drp.driver_id = d.id
LEFT JOIN public.driver_scores ds ON ds.driver_id = d.id
LEFT JOIN public.driver_reputation drep ON drep.driver_id = d.id;

GRANT SELECT ON public.driver_digital_twin TO authenticated;

-- ---------- updated_at triggers ----------
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'driver_risk_profiles','ocr_extractions','fleet_companies',
    'driver_savings','driver_loans','driver_insurance',
    'driver_profiles_extended','vehicle_compliance'
  ]) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated ON public.%s', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON public.%s
                    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t, t);
  END LOOP;
END $$;

-- ---------- SEED ----------
INSERT INTO public.countries (iso2, iso3, name, currency, phone_code, timezone, is_active, launched_at) VALUES
  ('KE','KEN','Kenya','KES','+254','Africa/Nairobi',true, now()),
  ('UG','UGA','Uganda','UGX','+256','Africa/Kampala',false,null),
  ('TZ','TZA','Tanzania','TZS','+255','Africa/Dar_es_Salaam',false,null),
  ('RW','RWA','Rwanda','RWF','+250','Africa/Kigali',false,null),
  ('NG','NGA','Nigeria','NGN','+234','Africa/Lagos',false,null),
  ('GH','GHA','Ghana','GHS','+233','Africa/Accra',false,null),
  ('ZA','ZAF','South Africa','ZAR','+27','Africa/Johannesburg',false,null)
ON CONFLICT (iso2) DO NOTHING;

INSERT INTO public.driver_lifecycle_stages (code, name, sort_order, is_terminal) VALUES
  ('APPLICANT','Applicant',10,false),
  ('SCREENING','Screening',20,false),
  ('KYC','KYC Verification',30,false),
  ('TRAINING','Training',40,false),
  ('VEHICLE_ASSIGNMENT','Vehicle Assignment',50,false),
  ('ACTIVATION','Activation',60,false),
  ('ACTIVE','Active',70,false),
  ('PERFORMANCE_REVIEW','Performance Review',80,false),
  ('REWARDED','Rewarded',85,false),
  ('WARNED','Warned',90,false),
  ('RESTRICTED','Restricted',100,false),
  ('SUSPENDED','Suspended',110,false),
  ('REACTIVATED','Reactivated',120,false),
  ('RETIRED','Retired',200,true),
  ('REJECTED','Rejected',210,true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.driver_risk_rules (code, name, dimension, severity, score_delta, config) VALUES
  ('DOC_EXPIRED','Document expired','compliance','HIGH',-20,'{}'::jsonb),
  ('DOC_EXPIRING_SOON','Document expiring within 14 days','compliance','MEDIUM',-5,'{"days":14}'::jsonb),
  ('SAFETY_INCIDENT','Safety incident reported','safety','HIGH',-15,'{}'::jsonb),
  ('SOS_TRIGGERED','SOS event triggered','safety','CRITICAL',-25,'{}'::jsonb),
  ('FRAUD_DUPLICATE_DOC','Duplicate document detected','fraud','CRITICAL',30,'{}'::jsonb),
  ('LOW_RATING','Average rating below 4.5','operational','MEDIUM',-10,'{"threshold":4.5}'::jsonb),
  ('HIGH_CANCELLATION','Cancellation rate above 15%','operational','MEDIUM',-8,'{"threshold":0.15}'::jsonb),
  ('LOAN_DEFAULT','Loan repayment defaulted','financial','HIGH',-20,'{}'::jsonb)
ON CONFLICT (code) DO NOTHING;