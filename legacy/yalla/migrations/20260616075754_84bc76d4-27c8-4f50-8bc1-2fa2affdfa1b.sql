
-- PART 1: DRIVERS
CREATE TABLE IF NOT EXISTS public.drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_code TEXT UNIQUE NOT NULL DEFAULT ('DRV-' || upper(substring(replace(gen_random_uuid()::text,'-',''),1,10))),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  driver_type driver_type NOT NULL DEFAULT 'individual',
  first_name TEXT NOT NULL,
  middle_name TEXT,
  last_name TEXT NOT NULL,
  gender TEXT,
  date_of_birth DATE,
  nationality TEXT DEFAULT 'KE',
  national_id TEXT,
  passport_number TEXT,
  kra_pin TEXT,
  phone_number TEXT,
  email TEXT,
  physical_address TEXT,
  county TEXT,
  city TEXT,
  country TEXT DEFAULT 'KE',
  status driver_status NOT NULL DEFAULT 'draft',
  application_status TEXT DEFAULT 'started',
  verification_status doc_verification_status NOT NULL DEFAULT 'not_submitted',
  risk_score NUMERIC(5,2) DEFAULT 0,
  driver_rating NUMERIC(3,2) DEFAULT 0,
  activation_date TIMESTAMPTZ,
  suspension_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  updated_by UUID
);
CREATE INDEX IF NOT EXISTS idx_drivers_national_id ON public.drivers(national_id);
CREATE INDEX IF NOT EXISTS idx_drivers_phone ON public.drivers(phone_number);
CREATE INDEX IF NOT EXISTS idx_drivers_email ON public.drivers(email);
CREATE INDEX IF NOT EXISTS idx_drivers_status ON public.drivers(status);
CREATE INDEX IF NOT EXISTS idx_drivers_verification ON public.drivers(verification_status);
CREATE INDEX IF NOT EXISTS idx_drivers_status_verification ON public.drivers(status, verification_status);
CREATE INDEX IF NOT EXISTS idx_drivers_country_city ON public.drivers(country, city);
CREATE INDEX IF NOT EXISTS idx_drivers_created_status ON public.drivers(created_at, status);
GRANT SELECT, INSERT, UPDATE ON public.drivers TO authenticated;
GRANT ALL ON public.drivers TO service_role;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY drivers_read ON public.drivers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin','fleet_owner']::app_role[]));
CREATE POLICY drivers_update ON public.drivers FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));
CREATE POLICY drivers_insert ON public.drivers FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));
CREATE TRIGGER trg_drivers_updated BEFORE UPDATE ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- PART 2: KYC DOCUMENT TYPES
CREATE TABLE IF NOT EXISTS public.kyc_document_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_name TEXT NOT NULL,
  document_code TEXT UNIQUE NOT NULL,
  description TEXT,
  country TEXT DEFAULT 'KE',
  driver_type driver_type,
  applies_to TEXT NOT NULL DEFAULT 'driver',
  required BOOLEAN NOT NULL DEFAULT true,
  expiry_required BOOLEAN NOT NULL DEFAULT false,
  verification_required BOOLEAN NOT NULL DEFAULT true,
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kyc_doc_types_active ON public.kyc_document_types(is_active, applies_to, display_order);
GRANT SELECT ON public.kyc_document_types TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.kyc_document_types TO authenticated;
GRANT ALL ON public.kyc_document_types TO service_role;
ALTER TABLE public.kyc_document_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY kyc_doc_types_read ON public.kyc_document_types FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY kyc_doc_types_admin ON public.kyc_document_types FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));
CREATE TRIGGER trg_kyc_doc_types_updated BEFORE UPDATE ON public.kyc_document_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.kyc_document_types (document_name, document_code, applies_to, required, expiry_required, display_order) VALUES
  ('National ID','NATIONAL_ID','driver',true,false,1),
  ('Driving Licence','DRIVING_LICENCE','driver',true,true,2),
  ('Certificate of Good Conduct','GOOD_CONDUCT','driver',true,true,3),
  ('NTSA PSV Badge','PSV_BADGE','driver',true,true,4),
  ('Passport','PASSPORT','driver',false,true,5),
  ('Driver Photograph','DRIVER_PHOTO','driver',true,false,6),
  ('KRA PIN Certificate','KRA_PIN','driver',true,false,7),
  ('Medical Certificate','MEDICAL_CERT','driver',false,true,8),
  ('Vehicle Logbook','VEHICLE_LOGBOOK','vehicle',true,false,1),
  ('Insurance Certificate','INSURANCE','vehicle',true,true,2),
  ('Road Service Licence','ROAD_SERVICE','vehicle',true,true,3),
  ('Vehicle Inspection Report','INSPECTION_REPORT','vehicle',true,true,4),
  ('Tax Compliance Certificate','TAX_COMPLIANCE','vehicle',false,true,5),
  ('NTSA Compliance Certificate','NTSA_COMPLIANCE','vehicle',true,true,6),
  ('PSV Licence','PSV_LICENCE','vehicle',true,true,7),
  ('Vehicle Photos','VEHICLE_PHOTOS','vehicle',true,false,8)
ON CONFLICT (document_code) DO NOTHING;

-- PART 3: Augment existing driver_documents
ALTER TABLE public.driver_documents
  ADD COLUMN IF NOT EXISTS document_type_id UUID REFERENCES public.kyc_document_types(id),
  ADD COLUMN IF NOT EXISTS document_number TEXT,
  ADD COLUMN IF NOT EXISTS file_size BIGINT,
  ADD COLUMN IF NOT EXISTS file_hash TEXT,
  ADD COLUMN IF NOT EXISTS issue_date DATE,
  ADD COLUMN IF NOT EXISTS expiry_date DATE,
  ADD COLUMN IF NOT EXISTS verification_notes TEXT,
  ADD COLUMN IF NOT EXISTS verified_by UUID,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ocr_data JSONB;
CREATE INDEX IF NOT EXISTS idx_driver_documents_type ON public.driver_documents(document_type_id);
CREATE INDEX IF NOT EXISTS idx_driver_documents_expiry ON public.driver_documents(expiry_date);

-- PART 4: VERIFICATION QUEUE
CREATE TABLE IF NOT EXISTS public.document_verification_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_document_id UUID REFERENCES public.driver_documents(id) ON DELETE CASCADE,
  vehicle_document_id UUID,
  review_status TEXT NOT NULL DEFAULT 'pending',
  assigned_admin UUID,
  priority INT NOT NULL DEFAULT 3,
  review_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dvq_status_priority ON public.document_verification_queue(review_status, priority);
GRANT SELECT, INSERT, UPDATE ON public.document_verification_queue TO authenticated;
GRANT ALL ON public.document_verification_queue TO service_role;
ALTER TABLE public.document_verification_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY dvq_admin ON public.document_verification_queue FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));
CREATE TRIGGER trg_dvq_updated BEFORE UPDATE ON public.document_verification_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- PART 5: EXPIRY MONITOR
CREATE TABLE IF NOT EXISTS public.document_expiry_monitor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_document_id UUID REFERENCES public.driver_documents(id) ON DELETE CASCADE,
  vehicle_document_id UUID,
  days_to_expiry INT NOT NULL,
  channel TEXT NOT NULL,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'sent'
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dem_driver ON public.document_expiry_monitor(driver_document_id, days_to_expiry, channel) WHERE driver_document_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_dem_vehicle ON public.document_expiry_monitor(vehicle_document_id, days_to_expiry, channel) WHERE vehicle_document_id IS NOT NULL;
GRANT SELECT, INSERT ON public.document_expiry_monitor TO authenticated;
GRANT ALL ON public.document_expiry_monitor TO service_role;
ALTER TABLE public.document_expiry_monitor ENABLE ROW LEVEL SECURITY;
CREATE POLICY dem_admin ON public.document_expiry_monitor FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- PART 6: DRIVER PHOTOS
CREATE TABLE IF NOT EXISTS public.driver_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID REFERENCES public.drivers(id) ON DELETE CASCADE,
  photo_type TEXT NOT NULL,
  storage_url TEXT NOT NULL,
  face_match_score NUMERIC(5,2),
  verification_status doc_verification_status NOT NULL DEFAULT 'pending',
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_driver_photos_driver ON public.driver_photos(driver_id);
GRANT SELECT, INSERT, UPDATE ON public.driver_photos TO authenticated;
GRANT ALL ON public.driver_photos TO service_role;
ALTER TABLE public.driver_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY driver_photos_self ON public.driver_photos FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id AND d.user_id = auth.uid())
    OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id AND d.user_id = auth.uid())
    OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  );

-- PART 7: DRIVER COMPLIANCE
CREATE TABLE IF NOT EXISTS public.driver_compliance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID UNIQUE REFERENCES public.drivers(id) ON DELETE CASCADE,
  compliance_score NUMERIC(5,2) DEFAULT 0,
  license_valid BOOLEAN DEFAULT false,
  badge_valid BOOLEAN DEFAULT false,
  background_check_valid BOOLEAN DEFAULT false,
  insurance_valid BOOLEAN DEFAULT false,
  inspection_valid BOOLEAN DEFAULT false,
  overall_status TEXT DEFAULT 'non_compliant',
  next_review_date DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.driver_compliance TO authenticated;
GRANT ALL ON public.driver_compliance TO service_role;
ALTER TABLE public.driver_compliance ENABLE ROW LEVEL SECURITY;
CREATE POLICY dc_self ON public.driver_compliance FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id AND d.user_id = auth.uid())
    OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin','fleet_owner']::app_role[])
  );
CREATE POLICY dc_admin_write ON public.driver_compliance FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));
CREATE TRIGGER trg_dc_updated BEFORE UPDATE ON public.driver_compliance
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- PART 8: VEHICLES
CREATE TABLE IF NOT EXISTS public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_code TEXT UNIQUE NOT NULL DEFAULT ('VEH-' || upper(substring(replace(gen_random_uuid()::text,'-',''),1,10))),
  owner_id UUID,
  vehicle_type TEXT NOT NULL,
  vehicle_category TEXT,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year INT,
  color TEXT,
  fuel_type TEXT,
  transmission TEXT,
  engine_capacity NUMERIC(6,2),
  number_plate TEXT UNIQUE NOT NULL,
  vin_number TEXT UNIQUE,
  chassis_number TEXT,
  seating_capacity INT,
  vehicle_status vehicle_status_t NOT NULL DEFAULT 'draft',
  registration_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vehicles_type_status ON public.vehicles(vehicle_type, vehicle_status);
CREATE INDEX IF NOT EXISTS idx_vehicles_owner_status ON public.vehicles(owner_id, vehicle_status);
GRANT SELECT, INSERT, UPDATE ON public.vehicles TO authenticated;
GRANT ALL ON public.vehicles TO service_role;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_read ON public.vehicles FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin','fleet_owner']::app_role[]));
CREATE POLICY vehicles_write ON public.vehicles FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (owner_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));
CREATE TRIGGER trg_vehicles_updated BEFORE UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- PART 9: VEHICLE DOCUMENTS
CREATE TABLE IF NOT EXISTS public.vehicle_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  document_type_id UUID REFERENCES public.kyc_document_types(id),
  document_number TEXT,
  file_url TEXT,
  file_name TEXT,
  file_size BIGINT,
  file_hash TEXT,
  issue_date DATE,
  expiry_date DATE,
  verification_status doc_verification_status NOT NULL DEFAULT 'pending',
  verified_by UUID,
  verified_at TIMESTAMPTZ,
  rejection_reason TEXT,
  ocr_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vd_vehicle ON public.vehicle_documents(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vd_status ON public.vehicle_documents(verification_status);
CREATE INDEX IF NOT EXISTS idx_vd_expiry ON public.vehicle_documents(expiry_date);
GRANT SELECT, INSERT, UPDATE ON public.vehicle_documents TO authenticated;
GRANT ALL ON public.vehicle_documents TO service_role;
ALTER TABLE public.vehicle_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY vd_read ON public.vehicle_documents FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_id AND v.owner_id = auth.uid())
    OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin','fleet_owner']::app_role[])
  );
CREATE POLICY vd_write ON public.vehicle_documents FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_id AND v.owner_id = auth.uid())
    OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_id AND v.owner_id = auth.uid())
    OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  );
CREATE TRIGGER trg_vd_updated BEFORE UPDATE ON public.vehicle_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- PART 10: VEHICLE INSPECTIONS
CREATE TABLE IF NOT EXISTS public.vehicle_inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  inspection_date DATE NOT NULL,
  inspector_name TEXT,
  inspection_center TEXT,
  brakes_status TEXT,
  tires_status TEXT,
  lights_status TEXT,
  engine_status TEXT,
  interior_status TEXT,
  cleanliness_score INT,
  result inspection_result NOT NULL DEFAULT 'pending',
  next_inspection_date DATE,
  report_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vi_vehicle ON public.vehicle_inspections(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vi_next ON public.vehicle_inspections(next_inspection_date);
GRANT SELECT, INSERT, UPDATE ON public.vehicle_inspections TO authenticated;
GRANT ALL ON public.vehicle_inspections TO service_role;
ALTER TABLE public.vehicle_inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY vi_read ON public.vehicle_inspections FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_id AND v.owner_id = auth.uid())
    OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin','fleet_owner']::app_role[])
  );
CREATE POLICY vi_write ON public.vehicle_inspections FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- PART 11: ASSIGNMENTS
CREATE TABLE IF NOT EXISTS public.driver_vehicle_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  assignment_type TEXT NOT NULL DEFAULT 'primary',
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  status assignment_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dva_driver ON public.driver_vehicle_assignments(driver_id);
CREATE INDEX IF NOT EXISTS idx_dva_vehicle ON public.driver_vehicle_assignments(vehicle_id);
GRANT SELECT, INSERT, UPDATE ON public.driver_vehicle_assignments TO authenticated;
GRANT ALL ON public.driver_vehicle_assignments TO service_role;
ALTER TABLE public.driver_vehicle_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY dva_read ON public.driver_vehicle_assignments FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id AND d.user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.vehicles v WHERE v.id = vehicle_id AND v.owner_id = auth.uid())
    OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin','fleet_owner']::app_role[])
  );
CREATE POLICY dva_write ON public.driver_vehicle_assignments FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin','fleet_owner']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin','fleet_owner']::app_role[]));

-- PART 12: FLEETS
CREATE TABLE IF NOT EXISTS public.fleets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_code TEXT UNIQUE NOT NULL DEFAULT ('FLT-' || upper(substring(replace(gen_random_uuid()::text,'-',''),1,8))),
  name TEXT NOT NULL,
  owner_user_id UUID,
  country TEXT DEFAULT 'KE',
  city TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.fleets TO authenticated;
GRANT ALL ON public.fleets TO service_role;
ALTER TABLE public.fleets ENABLE ROW LEVEL SECURITY;
CREATE POLICY fleets_owner ON public.fleets FOR ALL TO authenticated
  USING (owner_user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (owner_user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));
CREATE TRIGGER trg_fleets_updated BEFORE UPDATE ON public.fleets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.fleet_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_id UUID NOT NULL REFERENCES public.fleets(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(fleet_id, vehicle_id)
);
GRANT SELECT, INSERT, DELETE ON public.fleet_vehicles TO authenticated;
GRANT ALL ON public.fleet_vehicles TO service_role;
ALTER TABLE public.fleet_vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY fv_owner ON public.fleet_vehicles FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.fleets f WHERE f.id = fleet_id AND f.owner_user_id = auth.uid())
    OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.fleets f WHERE f.id = fleet_id AND f.owner_user_id = auth.uid())
    OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  );

CREATE TABLE IF NOT EXISTS public.fleet_drivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fleet_id UUID NOT NULL REFERENCES public.fleets(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(fleet_id, driver_id)
);
GRANT SELECT, INSERT, DELETE ON public.fleet_drivers TO authenticated;
GRANT ALL ON public.fleet_drivers TO service_role;
ALTER TABLE public.fleet_drivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY fd_owner ON public.fleet_drivers FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.fleets f WHERE f.id = fleet_id AND f.owner_user_id = auth.uid())
    OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.fleets f WHERE f.id = fleet_id AND f.owner_user_id = auth.uid())
    OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  );

-- PART 13: AUDIT & SECURITY
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID,
  actor_role TEXT,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  action TEXT NOT NULL,
  before_data JSONB,
  after_data JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON public.audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON public.audit_logs(actor_user_id, created_at);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON public.audit_logs FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));
CREATE POLICY audit_insert ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (actor_user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.security_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  event_type TEXT NOT NULL,
  severity incident_severity NOT NULL DEFAULT 'low',
  details JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sec_events_user ON public.security_events(user_id, created_at);
GRANT SELECT, INSERT ON public.security_events TO authenticated;
GRANT ALL ON public.security_events TO service_role;
ALTER TABLE public.security_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY sec_read ON public.security_events FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));
CREATE POLICY sec_insert ON public.security_events FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE TABLE IF NOT EXISTS public.file_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  bucket TEXT NOT NULL,
  object_path TEXT NOT NULL,
  action TEXT NOT NULL,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.file_access_logs TO authenticated;
GRANT ALL ON public.file_access_logs TO service_role;
ALTER TABLE public.file_access_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY fal_read ON public.file_access_logs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));
CREATE POLICY fal_insert ON public.file_access_logs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.verification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_document_id UUID,
  vehicle_document_id UUID,
  actor_user_id UUID,
  from_status doc_verification_status,
  to_status doc_verification_status,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.verification_logs TO authenticated;
GRANT ALL ON public.verification_logs TO service_role;
ALTER TABLE public.verification_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY vlog_admin ON public.verification_logs FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.driver_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID REFERENCES public.drivers(id) ON DELETE SET NULL,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  incident_type TEXT NOT NULL,
  severity incident_severity NOT NULL DEFAULT 'low',
  description TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reported_by UUID,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  resolved_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_di_driver ON public.driver_incidents(driver_id);
CREATE INDEX IF NOT EXISTS idx_di_severity ON public.driver_incidents(severity, status);
GRANT SELECT, INSERT, UPDATE ON public.driver_incidents TO authenticated;
GRANT ALL ON public.driver_incidents TO service_role;
ALTER TABLE public.driver_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY di_self ON public.driver_incidents FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_id AND d.user_id = auth.uid())
    OR reported_by = auth.uid()
    OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  );
CREATE POLICY di_insert ON public.driver_incidents FOR INSERT TO authenticated
  WITH CHECK (reported_by = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));
CREATE POLICY di_admin_update ON public.driver_incidents FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));
