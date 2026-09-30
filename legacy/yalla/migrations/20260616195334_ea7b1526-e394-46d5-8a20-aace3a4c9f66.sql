
-- Phase 6: Identity Assurance, ATO, GPS Integrity, Phishing

DO $$ BEGIN CREATE TYPE public.ato_alert_status AS ENUM ('detected','locked','step_up_required','cleared','confirmed_takeover');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.gps_integrity_signal AS ENUM (
  'mock_location','impossible_speed','teleport_jump','accel_gps_mismatch',
  'frozen_coords','altitude_anomaly','indoor_high_accuracy','known_spoofer_app','emulator'
);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.phishing_report_status AS ENUM ('new','triaging','confirmed','false_positive','taken_down');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.device_fingerprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint_hash TEXT NOT NULL UNIQUE,
  user_id UUID,
  platform TEXT, os TEXT, os_version TEXT, app_version TEXT,
  user_agent TEXT, screen TEXT, timezone TEXT, language TEXT,
  ip_address INET, country TEXT, city TEXT,
  is_emulator BOOLEAN DEFAULT false,
  is_rooted BOOLEAN DEFAULT false,
  is_jailbroken BOOLEAN DEFAULT false,
  has_mock_location BOOLEAN DEFAULT false,
  risk_score NUMERIC(5,2) DEFAULT 0,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_fingerprints TO authenticated;
GRANT ALL ON public.device_fingerprints TO service_role;
ALTER TABLE public.device_fingerprints ENABLE ROW LEVEL SECURITY;
CREATE POLICY "df_user_read_own" ON public.device_fingerprints FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "df_admin_all" ON public.device_fingerprints FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_df_user ON public.device_fingerprints(user_id);
CREATE INDEX idx_df_risk ON public.device_fingerprints(risk_score DESC);

CREATE TABLE public.trusted_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  fingerprint_id UUID NOT NULL REFERENCES public.device_fingerprints(id) ON DELETE CASCADE,
  label TEXT,
  trusted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, fingerprint_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trusted_devices TO authenticated;
GRANT ALL ON public.trusted_devices TO service_role;
ALTER TABLE public.trusted_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "td_user_own" ON public.trusted_devices FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'))
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_td_user ON public.trusted_devices(user_id) WHERE revoked_at IS NULL;

CREATE TABLE public.authentication_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID,
  event_type TEXT NOT NULL,
  method TEXT,
  ip_address INET, country TEXT, city TEXT, user_agent TEXT,
  fingerprint_hash TEXT,
  success BOOLEAN NOT NULL DEFAULT true,
  failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.authentication_events TO authenticated;
GRANT ALL ON public.authentication_events TO service_role;
ALTER TABLE public.authentication_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ae_user_own" ON public.authentication_events FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ae_admin_write" ON public.authentication_events FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_ae_user ON public.authentication_events(user_id, occurred_at DESC);

CREATE TABLE public.login_risk_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_event_id UUID REFERENCES public.authentication_events(id) ON DELETE SET NULL,
  user_id UUID,
  fingerprint_hash TEXT,
  score NUMERIC(5,2) NOT NULL,
  band TEXT NOT NULL,
  factors JSONB NOT NULL DEFAULT '{}'::JSONB,
  decision TEXT NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.login_risk_scores TO authenticated;
GRANT ALL ON public.login_risk_scores TO service_role;
ALTER TABLE public.login_risk_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lrs_user_own" ON public.login_risk_scores FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "lrs_admin_all" ON public.login_risk_scores FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_lrs_user ON public.login_risk_scores(user_id, computed_at DESC);

CREATE TABLE public.account_takeover_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  trigger_event_id UUID REFERENCES public.authentication_events(id) ON DELETE SET NULL,
  status public.ato_alert_status NOT NULL DEFAULT 'detected',
  severity public.security_severity NOT NULL DEFAULT 'HIGH',
  signals JSONB NOT NULL DEFAULT '[]'::JSONB,
  countermeasures JSONB NOT NULL DEFAULT '[]'::JSONB,
  notified_user BOOLEAN NOT NULL DEFAULT false,
  acknowledged_by_user_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.account_takeover_alerts TO authenticated;
GRANT ALL ON public.account_takeover_alerts TO service_role;
ALTER TABLE public.account_takeover_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ato_user_own_read" ON public.account_takeover_alerts FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "ato_admin_all" ON public.account_takeover_alerts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_ato_unresolved ON public.account_takeover_alerts(created_at DESC) WHERE resolved_at IS NULL;

CREATE TABLE public.location_integrity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID, driver_id UUID, trip_id UUID,
  fingerprint_hash TEXT,
  signal public.gps_integrity_signal NOT NULL,
  severity public.security_severity NOT NULL DEFAULT 'HIGH',
  detected_speed_kph NUMERIC(7,2),
  reported_lat NUMERIC(10,7), reported_lng NUMERIC(10,7),
  prior_lat NUMERIC(10,7), prior_lng NUMERIC(10,7),
  delta_meters NUMERIC(10,2), delta_seconds NUMERIC(10,2),
  evidence JSONB NOT NULL DEFAULT '{}'::JSONB,
  countermeasure TEXT,
  countermeasure_applied_at TIMESTAMPTZ,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.location_integrity_events TO authenticated;
GRANT ALL ON public.location_integrity_events TO service_role;
ALTER TABLE public.location_integrity_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lie_admin_all" ON public.location_integrity_events FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_lie_driver ON public.location_integrity_events(driver_id, detected_at DESC);
CREATE INDEX idx_lie_trip ON public.location_integrity_events(trip_id);

CREATE TABLE public.phishing_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_number TEXT NOT NULL UNIQUE DEFAULT ('PR-' || to_char(now(),'YYYYMMDD') || '-' || substr(gen_random_uuid()::text,1,8)),
  reported_by UUID,
  reporter_email TEXT,
  channel TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  artifact_value TEXT NOT NULL,
  artifact_screenshot_ref TEXT,
  description TEXT,
  status public.phishing_report_status NOT NULL DEFAULT 'new',
  severity public.security_severity NOT NULL DEFAULT 'MEDIUM',
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  triaged_at TIMESTAMPTZ,
  resolution_notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.phishing_reports TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.phishing_reports TO authenticated;
GRANT ALL ON public.phishing_reports TO service_role;
ALTER TABLE public.phishing_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pr_anon_insert" ON public.phishing_reports FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "pr_user_insert" ON public.phishing_reports FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "pr_admin_read" ON public.phishing_reports FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR reported_by = auth.uid());
CREATE POLICY "pr_admin_update" ON public.phishing_reports FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_pr_status ON public.phishing_reports(status, created_at DESC);

CREATE TABLE public.phishing_takedowns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID REFERENCES public.phishing_reports(id) ON DELETE CASCADE,
  target_artifact TEXT NOT NULL,
  target_type TEXT NOT NULL,
  registrar_or_provider TEXT,
  submitted_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  taken_down_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.phishing_takedowns TO authenticated;
GRANT ALL ON public.phishing_takedowns TO service_role;
ALTER TABLE public.phishing_takedowns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pt_admin_all" ON public.phishing_takedowns FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_df_updated BEFORE UPDATE ON public.device_fingerprints
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_ato_updated BEFORE UPDATE ON public.account_takeover_alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_pr_updated BEFORE UPDATE ON public.phishing_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_pt_updated BEFORE UPDATE ON public.phishing_takedowns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.account_takeover_alerts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.location_integrity_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.phishing_reports;
