-- =========================================================
-- PHASE 1: Rider Trust + Safety + Loyalty
-- =========================================================

-- ---------- TRUST ENGINE ----------

CREATE TABLE public.rider_risk_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL UNIQUE,
  risk_tier text NOT NULL DEFAULT 'low',
  risk_score numeric NOT NULL DEFAULT 0,
  flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_assessed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rider_risk_profiles TO authenticated;
GRANT ALL ON public.rider_risk_profiles TO service_role;
ALTER TABLE public.rider_risk_profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.rider_behavior_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  cancellations int NOT NULL DEFAULT 0,
  no_shows int NOT NULL DEFAULT 0,
  complaints int NOT NULL DEFAULT 0,
  trips_completed int NOT NULL DEFAULT 0,
  score numeric NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rider_behavior_scores_rider ON public.rider_behavior_scores(rider_id, computed_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rider_behavior_scores TO authenticated;
GRANT ALL ON public.rider_behavior_scores TO service_role;
ALTER TABLE public.rider_behavior_scores ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.rider_fraud_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL,
  signal_type text NOT NULL,
  severity text NOT NULL DEFAULT 'low',
  source text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  trip_id uuid,
  device_id uuid,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rider_fraud_signals_rider ON public.rider_fraud_signals(rider_id, detected_at DESC);
CREATE INDEX idx_rider_fraud_signals_type ON public.rider_fraud_signals(signal_type, severity);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rider_fraud_signals TO authenticated;
GRANT ALL ON public.rider_fraud_signals TO service_role;
ALTER TABLE public.rider_fraud_signals ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.rider_device_fingerprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL,
  fingerprint_hash text NOT NULL,
  device_type text,
  os text,
  os_version text,
  app_version text,
  ip_address inet,
  user_agent text,
  trust_level text NOT NULL DEFAULT 'unverified',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  is_blocked boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rider_id, fingerprint_hash)
);
CREATE INDEX idx_rider_device_fp_rider ON public.rider_device_fingerprints(rider_id);
CREATE INDEX idx_rider_device_fp_hash ON public.rider_device_fingerprints(fingerprint_hash);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rider_device_fingerprints TO authenticated;
GRANT ALL ON public.rider_device_fingerprints TO service_role;
ALTER TABLE public.rider_device_fingerprints ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.rider_trust_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL UNIQUE,
  composite_score numeric NOT NULL DEFAULT 50,
  behavior_component numeric NOT NULL DEFAULT 0,
  fraud_component numeric NOT NULL DEFAULT 0,
  device_component numeric NOT NULL DEFAULT 0,
  loyalty_component numeric NOT NULL DEFAULT 0,
  tier text NOT NULL DEFAULT 'standard',
  model_version text,
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rider_trust_scores TO authenticated;
GRANT ALL ON public.rider_trust_scores TO service_role;
ALTER TABLE public.rider_trust_scores ENABLE ROW LEVEL SECURITY;

-- ---------- LOYALTY ENGINE ----------

CREATE TABLE public.rider_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  rank int NOT NULL,
  min_points int NOT NULL DEFAULT 0,
  perks jsonb NOT NULL DEFAULT '[]'::jsonb,
  multiplier numeric NOT NULL DEFAULT 1.0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rider_tiers TO anon, authenticated;
GRANT ALL ON public.rider_tiers TO service_role;
ALTER TABLE public.rider_tiers ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.rider_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL,
  entry_type text NOT NULL,
  points int NOT NULL,
  reason text,
  reference_type text,
  reference_id uuid,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rider_points_rider ON public.rider_points(rider_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rider_points TO authenticated;
GRANT ALL ON public.rider_points TO service_role;
ALTER TABLE public.rider_points ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.rider_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  icon text,
  criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rider_badges TO anon, authenticated;
GRANT ALL ON public.rider_badges TO service_role;
ALTER TABLE public.rider_badges ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.rider_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL,
  tier_id uuid NOT NULL REFERENCES public.rider_tiers(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  lifetime_points int NOT NULL DEFAULT 0,
  current_points int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  badges jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rider_memberships_rider ON public.rider_memberships(rider_id) WHERE is_active;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rider_memberships TO authenticated;
GRANT ALL ON public.rider_memberships TO service_role;
ALTER TABLE public.rider_memberships ENABLE ROW LEVEL SECURITY;

-- ---------- SAFETY ENGINE ----------

CREATE TABLE public.rider_sos_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL,
  trip_id uuid,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  latitude numeric,
  longitude numeric,
  status text NOT NULL DEFAULT 'open',
  channel text NOT NULL DEFAULT 'in_app',
  responder_id uuid,
  responded_at timestamptz,
  resolution_notes text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rider_sos_rider ON public.rider_sos_alerts(rider_id, triggered_at DESC);
CREATE INDEX idx_rider_sos_open ON public.rider_sos_alerts(status) WHERE status = 'open';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rider_sos_alerts TO authenticated;
GRANT ALL ON public.rider_sos_alerts TO service_role;
ALTER TABLE public.rider_sos_alerts ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.rider_safety_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL,
  trip_id uuid,
  driver_id uuid,
  incident_type text NOT NULL,
  severity text NOT NULL DEFAULT 'low',
  description text,
  reported_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open',
  assigned_to uuid,
  resolution text,
  resolved_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rider_safety_incidents_rider ON public.rider_safety_incidents(rider_id, reported_at DESC);
CREATE INDEX idx_rider_safety_incidents_status ON public.rider_safety_incidents(status, severity);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rider_safety_incidents TO authenticated;
GRANT ALL ON public.rider_safety_incidents TO service_role;
ALTER TABLE public.rider_safety_incidents ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- updated_at triggers
-- =========================================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'rider_risk_profiles','rider_device_fingerprints','rider_trust_scores',
    'rider_tiers','rider_badges','rider_memberships',
    'rider_sos_alerts','rider_safety_incidents'
  ]) LOOP
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', t, t);
  END LOOP;
END $$;

-- =========================================================
-- RLS POLICIES
-- =========================================================

-- rider_risk_profiles
CREATE POLICY "Riders view own risk profile" ON public.rider_risk_profiles
  FOR SELECT TO authenticated USING (rider_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins manage risk profiles" ON public.rider_risk_profiles
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- rider_behavior_scores
CREATE POLICY "Riders view own behavior" ON public.rider_behavior_scores
  FOR SELECT TO authenticated USING (rider_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins manage behavior" ON public.rider_behavior_scores
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- rider_fraud_signals
CREATE POLICY "Riders view own fraud signals" ON public.rider_fraud_signals
  FOR SELECT TO authenticated USING (rider_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins manage fraud signals" ON public.rider_fraud_signals
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- rider_device_fingerprints
CREATE POLICY "Riders view own devices" ON public.rider_device_fingerprints
  FOR SELECT TO authenticated USING (rider_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Riders insert own devices" ON public.rider_device_fingerprints
  FOR INSERT TO authenticated WITH CHECK (rider_id = auth.uid());
CREATE POLICY "Riders update own devices" ON public.rider_device_fingerprints
  FOR UPDATE TO authenticated USING (rider_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins delete devices" ON public.rider_device_fingerprints
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- rider_trust_scores
CREATE POLICY "Riders view own trust score" ON public.rider_trust_scores
  FOR SELECT TO authenticated USING (rider_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins manage trust scores" ON public.rider_trust_scores
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- rider_tiers (catalog)
CREATE POLICY "Anyone reads active tiers" ON public.rider_tiers
  FOR SELECT TO anon, authenticated USING (is_active OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins manage tiers" ON public.rider_tiers
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- rider_points
CREATE POLICY "Riders view own points" ON public.rider_points
  FOR SELECT TO authenticated USING (rider_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins manage points" ON public.rider_points
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- rider_badges (catalog)
CREATE POLICY "Anyone reads active badges" ON public.rider_badges
  FOR SELECT TO anon, authenticated USING (is_active OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins manage badges" ON public.rider_badges
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- rider_memberships
CREATE POLICY "Riders view own membership" ON public.rider_memberships
  FOR SELECT TO authenticated USING (rider_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins manage memberships" ON public.rider_memberships
  FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- rider_sos_alerts
CREATE POLICY "Riders view own SOS" ON public.rider_sos_alerts
  FOR SELECT TO authenticated USING (rider_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Riders create own SOS" ON public.rider_sos_alerts
  FOR INSERT TO authenticated WITH CHECK (rider_id = auth.uid());
CREATE POLICY "Admins manage SOS" ON public.rider_sos_alerts
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins delete SOS" ON public.rider_sos_alerts
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- rider_safety_incidents
CREATE POLICY "Riders view own incidents" ON public.rider_safety_incidents
  FOR SELECT TO authenticated USING (rider_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Riders create own incidents" ON public.rider_safety_incidents
  FOR INSERT TO authenticated WITH CHECK (rider_id = auth.uid());
CREATE POLICY "Admins manage incidents" ON public.rider_safety_incidents
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "Admins delete incidents" ON public.rider_safety_incidents
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- =========================================================
-- Seed tier + badge catalog
-- =========================================================
INSERT INTO public.rider_tiers (code,name,rank,min_points,multiplier,perks) VALUES
  ('bronze','Bronze',1,0,1.0,'["Standard support"]'::jsonb),
  ('silver','Silver',2,500,1.1,'["Priority support","5% off airport rides"]'::jsonb),
  ('gold','Gold',3,2500,1.25,'["Free cancellations","10% off","Premium support"]'::jsonb),
  ('platinum','Platinum',4,10000,1.5,'["Concierge","15% off","Dedicated agent","Free upgrades"]'::jsonb)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.rider_badges (code,name,description,icon,criteria) VALUES
  ('first_ride','First Ride','Completed your first ride','sparkles','{"trips":1}'::jsonb),
  ('frequent_flyer','Frequent Flyer','10+ airport trips','plane','{"airport_trips":10}'::jsonb),
  ('eco_warrior','Eco Warrior','25+ electric/hybrid trips','leaf','{"eco_trips":25}'::jsonb),
  ('night_owl','Night Owl','20+ rides between 10pm-5am','moon','{"night_trips":20}'::jsonb),
  ('top_rated','Top Rated','Maintained 4.9+ rider rating','star','{"rating":4.9}'::jsonb)
ON CONFLICT (code) DO NOTHING;