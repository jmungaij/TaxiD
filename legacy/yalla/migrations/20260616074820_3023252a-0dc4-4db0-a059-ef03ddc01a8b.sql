
-- ============================================================
-- DRIVER PLATFORM — schema + RLS + grants + seed
-- ============================================================

-- ---------- driver_earnings_models ----------
CREATE TABLE public.driver_earnings_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city TEXT NOT NULL,
  vehicle_type TEXT NOT NULL,
  hourly_average_cents BIGINT NOT NULL CHECK (hourly_average_cents >= 0),
  surge_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.00 CHECK (surge_multiplier >= 0),
  incentive_per_week_cents BIGINT NOT NULL DEFAULT 0 CHECK (incentive_per_week_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'KES',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (city, vehicle_type)
);
GRANT SELECT ON public.driver_earnings_models TO anon, authenticated;
GRANT ALL ON public.driver_earnings_models TO service_role;
ALTER TABLE public.driver_earnings_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Earnings models are public" ON public.driver_earnings_models FOR SELECT USING (is_active = true);
CREATE POLICY "Admins manage earnings models" ON public.driver_earnings_models FOR ALL
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE INDEX idx_driver_earnings_city ON public.driver_earnings_models (city);
CREATE INDEX idx_driver_earnings_vehicle ON public.driver_earnings_models (vehicle_type);
CREATE TRIGGER trg_driver_earnings_updated BEFORE UPDATE ON public.driver_earnings_models
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- driver_success_stories ----------
CREATE TABLE public.driver_success_stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_name TEXT NOT NULL,
  city TEXT NOT NULL,
  vehicle_type TEXT,
  headline TEXT NOT NULL,
  body TEXT NOT NULL,
  monthly_earnings_cents BIGINT,
  trips_completed INT,
  rating NUMERIC(3,2),
  years_on_platform NUMERIC(4,1),
  avatar_url TEXT,
  is_published BOOLEAN NOT NULL DEFAULT true,
  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.driver_success_stories TO anon, authenticated;
GRANT ALL ON public.driver_success_stories TO service_role;
ALTER TABLE public.driver_success_stories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Stories public" ON public.driver_success_stories FOR SELECT USING (is_published = true);
CREATE POLICY "Admins manage stories" ON public.driver_success_stories FOR ALL
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE INDEX idx_driver_stories_published_at ON public.driver_success_stories (published_at DESC);
CREATE INDEX idx_driver_stories_city ON public.driver_success_stories (city);
CREATE INDEX idx_driver_stories_rating ON public.driver_success_stories (rating DESC);
CREATE TRIGGER trg_driver_stories_updated BEFORE UPDATE ON public.driver_success_stories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- driver_courses ----------
CREATE TABLE public.driver_courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 30,
  is_certification BOOLEAN NOT NULL DEFAULT false,
  is_required BOOLEAN NOT NULL DEFAULT false,
  is_published BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.driver_courses TO anon, authenticated;
GRANT ALL ON public.driver_courses TO service_role;
ALTER TABLE public.driver_courses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Courses public" ON public.driver_courses FOR SELECT USING (is_published = true);
CREATE POLICY "Admins manage courses" ON public.driver_courses FOR ALL
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE INDEX idx_driver_courses_category ON public.driver_courses (category);
CREATE INDEX idx_driver_courses_sort ON public.driver_courses (sort_order);
CREATE TRIGGER trg_driver_courses_updated BEFORE UPDATE ON public.driver_courses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- driver_training_records ----------
CREATE TABLE public.driver_training_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.driver_courses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('NOT_STARTED','IN_PROGRESS','COMPLETED','FAILED')),
  progress_pct INT NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  score INT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (driver_id, course_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_training_records TO authenticated;
GRANT ALL ON public.driver_training_records TO service_role;
ALTER TABLE public.driver_training_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Driver reads own training" ON public.driver_training_records FOR SELECT
  USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE POLICY "Driver writes own training" ON public.driver_training_records FOR INSERT
  WITH CHECK (driver_id = auth.uid());
CREATE POLICY "Driver updates own training" ON public.driver_training_records FOR UPDATE
  USING (driver_id = auth.uid()) WITH CHECK (driver_id = auth.uid());
CREATE INDEX idx_driver_training_driver ON public.driver_training_records (driver_id);
CREATE INDEX idx_driver_training_status ON public.driver_training_records (status);
CREATE TRIGGER trg_driver_training_updated BEFORE UPDATE ON public.driver_training_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- driver_certifications ----------
CREATE TABLE public.driver_certifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  course_id UUID REFERENCES public.driver_courses(id) ON DELETE SET NULL,
  certificate_code TEXT NOT NULL UNIQUE,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_certifications TO authenticated;
GRANT ALL ON public.driver_certifications TO service_role;
ALTER TABLE public.driver_certifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Driver reads own certs" ON public.driver_certifications FOR SELECT
  USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE POLICY "Admins manage certs" ON public.driver_certifications FOR ALL
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE INDEX idx_driver_certs_driver ON public.driver_certifications (driver_id);
CREATE TRIGGER trg_driver_certs_updated BEFORE UPDATE ON public.driver_certifications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- driver_onboarding_drafts ----------
CREATE TABLE public.driver_onboarding_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  current_stage INT NOT NULL DEFAULT 1 CHECK (current_stage BETWEEN 1 AND 7),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','APPROVED','REJECTED')),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewer_id UUID REFERENCES auth.users(id),
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_onboarding_drafts TO authenticated;
GRANT ALL ON public.driver_onboarding_drafts TO service_role;
ALTER TABLE public.driver_onboarding_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Driver manages own draft" ON public.driver_onboarding_drafts FOR ALL
  USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
  WITH CHECK (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE INDEX idx_driver_drafts_status ON public.driver_onboarding_drafts (status);
CREATE TRIGGER trg_driver_drafts_updated BEFORE UPDATE ON public.driver_onboarding_drafts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- driver_documents ----------
CREATE TABLE public.driver_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL CHECK (doc_type IN (
    'NATIONAL_ID','PASSPORT','SELFIE','DRIVING_LICENSE','PSV_LICENSE',
    'VEHICLE_LOGBOOK','VEHICLE_INSPECTION','VEHICLE_INSURANCE',
    'GOOD_CONDUCT','KRA_PIN','OTHER'
  )),
  file_url TEXT NOT NULL,
  file_name TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','EXPIRED')),
  rejection_reason TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_documents TO authenticated;
GRANT ALL ON public.driver_documents TO service_role;
ALTER TABLE public.driver_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Driver reads own docs" ON public.driver_documents FOR SELECT
  USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE POLICY "Driver inserts own docs" ON public.driver_documents FOR INSERT
  WITH CHECK (driver_id = auth.uid());
CREATE POLICY "Driver updates own pending docs" ON public.driver_documents FOR UPDATE
  USING (driver_id = auth.uid() AND status = 'PENDING') WITH CHECK (driver_id = auth.uid());
CREATE POLICY "Admins manage docs" ON public.driver_documents FOR ALL
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE INDEX idx_driver_docs_driver ON public.driver_documents (driver_id);
CREATE INDEX idx_driver_docs_status ON public.driver_documents (status);
CREATE INDEX idx_driver_docs_driver_type ON public.driver_documents (driver_id, doc_type);
CREATE TRIGGER trg_driver_docs_updated BEFORE UPDATE ON public.driver_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- driver_verifications ----------
CREATE TABLE public.driver_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  check_type TEXT NOT NULL CHECK (check_type IN (
    'IDENTITY','LICENSE','VEHICLE','BACKGROUND','BIOMETRIC','FRAUD'
  )),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PASSED','FAILED','MANUAL_REVIEW')),
  provider TEXT,
  provider_reference TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  performed_by UUID REFERENCES auth.users(id),
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.driver_verifications TO authenticated;
GRANT ALL ON public.driver_verifications TO service_role;
ALTER TABLE public.driver_verifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Driver reads own verifications" ON public.driver_verifications FOR SELECT
  USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE POLICY "Admins manage verifications" ON public.driver_verifications FOR ALL
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE INDEX idx_driver_verif_driver ON public.driver_verifications (driver_id);
CREATE INDEX idx_driver_verif_status ON public.driver_verifications (status);
CREATE TRIGGER trg_driver_verif_updated BEFORE UPDATE ON public.driver_verifications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- safety_events ----------
CREATE TABLE public.safety_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  rider_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('SOS','INCIDENT','HARSH_DRIVING','ROUTE_DEVIATION','PANIC','MEDICAL','THEFT','ACCIDENT')),
  severity TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED','CLOSED')),
  location_lat NUMERIC(10,7),
  location_lng NUMERIC(10,7),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.safety_events TO authenticated;
GRANT ALL ON public.safety_events TO service_role;
ALTER TABLE public.safety_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own safety events" ON public.safety_events FOR SELECT
  USING (driver_id = auth.uid() OR rider_id = auth.uid()
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE POLICY "Users insert own safety events" ON public.safety_events FOR INSERT
  WITH CHECK (driver_id = auth.uid() OR rider_id = auth.uid());
CREATE POLICY "Admins manage safety" ON public.safety_events FOR UPDATE
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE INDEX idx_safety_driver ON public.safety_events (driver_id);
CREATE INDEX idx_safety_status ON public.safety_events (status);
CREATE INDEX idx_safety_created ON public.safety_events (created_at DESC);
CREATE TRIGGER trg_safety_updated BEFORE UPDATE ON public.safety_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------- driver_analytics_events ----------
CREATE TABLE public.driver_analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id TEXT,
  event_name TEXT NOT NULL,
  page_route TEXT,
  funnel_stage TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT INSERT ON public.driver_analytics_events TO anon, authenticated;
GRANT SELECT ON public.driver_analytics_events TO authenticated;
GRANT ALL ON public.driver_analytics_events TO service_role;
ALTER TABLE public.driver_analytics_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can log analytics" ON public.driver_analytics_events FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins read analytics" ON public.driver_analytics_events FOR SELECT
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE INDEX idx_driver_analytics_created ON public.driver_analytics_events (created_at DESC);
CREATE INDEX idx_driver_analytics_event ON public.driver_analytics_events (event_name);
CREATE INDEX idx_driver_analytics_user ON public.driver_analytics_events (user_id);

-- ============================================================
-- SEED DATA
-- ============================================================

INSERT INTO public.driver_earnings_models (city, vehicle_type, hourly_average_cents, surge_multiplier, incentive_per_week_cents) VALUES
  ('Nairobi',  'Economy',   45000,  1.30, 350000),
  ('Nairobi',  'Comfort',   62000,  1.30, 450000),
  ('Nairobi',  'XL',        78000,  1.25, 500000),
  ('Nairobi',  'Boda',      28000,  1.20, 200000),
  ('Mombasa',  'Economy',   38000,  1.20, 280000),
  ('Mombasa',  'Comfort',   55000,  1.20, 380000),
  ('Mombasa',  'Boda',      24000,  1.15, 180000),
  ('Kisumu',   'Economy',   34000,  1.15, 240000),
  ('Kisumu',   'Boda',      22000,  1.15, 160000),
  ('Nakuru',   'Economy',   32000,  1.15, 220000),
  ('Eldoret',  'Economy',   30000,  1.10, 200000),
  ('Thika',    'Economy',   30000,  1.10, 200000);

INSERT INTO public.driver_success_stories (driver_name, city, vehicle_type, headline, body, monthly_earnings_cents, trips_completed, rating, years_on_platform) VALUES
  ('James Mwangi',  'Nairobi', 'Comfort', 'From two-shift driver to fleet of four',
   'Started driving full-time on Yalla in 2023. Within 18 months James used corporate ride bonuses and instant settlement to lease a second car. Today he runs four vehicles under his Yalla fleet account.',
   18500000, 4820, 4.92, 2.5),
  ('Aisha Hassan',  'Mombasa', 'Economy', 'Funding her degree, one trip at a time',
   'Aisha drives weekday mornings and evenings between classes. The earnings calculator and tax tools help her plan around her university fees and the KRA TOT scheme.',
   9200000, 2140, 4.88, 1.8),
  ('Peter Otieno',  'Kisumu',  'Boda',    'Top boda earner in Western',
   'Peter consistently ranks in the top 1% of boda drivers on the platform. He credits the safety SOS and instant M-Pesa payouts for making boda work sustainable and secure.',
   6800000, 6310, 4.95, 3.2);

INSERT INTO public.driver_courses (slug, title, category, description, duration_minutes, is_certification, is_required, sort_order) VALUES
  ('customer-service',     'Five-Star Customer Service',  'Service', 'Greeting, communication, conflict de-escalation and accessibility basics.',                30, true,  true,  10),
  ('road-safety',          'Road Safety Fundamentals',    'Safety',  'Defensive driving, fatigue management, NTSA rules and incident response.',                 45, true,  true,  20),
  ('defensive-driving',    'Advanced Defensive Driving',  'Safety',  'Hazard perception, adverse weather, night driving and high-risk zones.',                  60, true,  false, 30),
  ('route-optimization',   'Smart Routing & Heat Maps',   'Operations','Reading demand heat maps, positioning, surge windows and shift planning.',               25, false, false, 40),
  ('platform-operations',  'Platform Operations',         'Operations','Account, app usage, ratings, cancellation policy, fare disputes.',                      20, true,  true,  50),
  ('financial-literacy',   'Driver Financial Literacy',   'Business','Budgeting, tax (TOT, PAYE, Income Tax), savings, fuel costs and insurance.',              40, true,  false, 60);
