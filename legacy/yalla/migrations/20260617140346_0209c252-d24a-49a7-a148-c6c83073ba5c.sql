
-- =========================================================
-- Phase 2: Executive Command Center + Audit + Operations
-- =========================================================

-- Helper: updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- ---------------------------------------------------------
-- 1. ADMIN AUDIT LOG (hash-chained)
-- ---------------------------------------------------------
CREATE TABLE public.admin_audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email     text,
  action          text NOT NULL,
  resource_type   text,
  resource_id     text,
  old_value       jsonb,
  new_value       jsonb,
  reason          text,
  ip              text,
  user_agent      text,
  country         text,
  prev_hash       text,
  hash            text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_log_actor_idx   ON public.admin_audit_log(actor_id, created_at DESC);
CREATE INDEX admin_audit_log_action_idx  ON public.admin_audit_log(action, created_at DESC);
CREATE INDEX admin_audit_log_created_idx ON public.admin_audit_log(created_at DESC);
GRANT SELECT, INSERT ON public.admin_audit_log TO authenticated;
GRANT ALL ON public.admin_audit_log TO service_role;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read audit log" ON public.admin_audit_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'compliance_admin'));
CREATE POLICY "Auth users insert their audit rows" ON public.admin_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid() OR actor_id IS NULL);

-- ---------------------------------------------------------
-- 2. ACCESS DENIALS (route + command palette)
-- ---------------------------------------------------------
CREATE TABLE public.access_denials (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email       text,
  user_roles       text[] NOT NULL DEFAULT '{}',
  surface          text NOT NULL,            -- 'route' | 'command_palette' | 'api'
  requested_path   text,
  requested_command text,
  reason           text NOT NULL,            -- 'not_authenticated' | 'forbidden_for_role' | etc.
  required_roles   text[] DEFAULT '{}',
  ip               text,
  user_agent       text,
  risk_score       integer DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX access_denials_user_idx     ON public.access_denials(user_id, created_at DESC);
CREATE INDEX access_denials_path_idx     ON public.access_denials(requested_path);
CREATE INDEX access_denials_created_idx  ON public.access_denials(created_at DESC);
GRANT INSERT ON public.access_denials TO anon, authenticated;
GRANT SELECT ON public.access_denials TO authenticated;
GRANT ALL ON public.access_denials TO service_role;
ALTER TABLE public.access_denials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read denials" ON public.access_denials
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Anyone insert denial" ON public.access_denials
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- ---------------------------------------------------------
-- 3. EXECUTIVE METRICS (live cockpit)
-- ---------------------------------------------------------
CREATE TABLE public.executive_metrics (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key    text NOT NULL,
  label         text NOT NULL,
  value_numeric numeric,
  value_text    text,
  unit          text,
  trend_pct     numeric,
  category      text NOT NULL DEFAULT 'revenue',  -- revenue|operations|risk|satisfaction|system
  region        text,
  tenant_id     uuid,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  measured_at   timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (metric_key, region, tenant_id)
);
CREATE INDEX executive_metrics_cat_idx ON public.executive_metrics(category);
GRANT SELECT ON public.executive_metrics TO authenticated;
GRANT ALL ON public.executive_metrics TO service_role;
ALTER TABLE public.executive_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read exec metrics" ON public.executive_metrics
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'finance_admin'));
CREATE TRIGGER executive_metrics_updated_at BEFORE UPDATE ON public.executive_metrics
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.executive_alerts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  severity     text NOT NULL DEFAULT 'info', -- info|warning|critical
  category     text NOT NULL,                -- risk|compliance|fraud|sos|system
  title        text NOT NULL,
  body         text,
  resource_url text,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX executive_alerts_created_idx ON public.executive_alerts(created_at DESC);
CREATE INDEX executive_alerts_sev_idx     ON public.executive_alerts(severity, acknowledged_at);
GRANT SELECT, UPDATE ON public.executive_alerts TO authenticated;
GRANT ALL ON public.executive_alerts TO service_role;
ALTER TABLE public.executive_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read alerts" ON public.executive_alerts
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins ack alerts" ON public.executive_alerts
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE TABLE public.executive_forecasts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_key  text NOT NULL,
  horizon       text NOT NULL,                -- day|week|month|quarter|year
  value_numeric numeric,
  confidence    numeric,
  model_name    text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX executive_forecasts_key_idx ON public.executive_forecasts(forecast_key, generated_at DESC);
GRANT SELECT ON public.executive_forecasts TO authenticated;
GRANT ALL ON public.executive_forecasts TO service_role;
ALTER TABLE public.executive_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read forecasts" ON public.executive_forecasts
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'finance_admin'));

-- ---------------------------------------------------------
-- 4. OPERATIONS / INTERVENTION TABLES
-- ---------------------------------------------------------
CREATE TABLE public.operations_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type   text NOT NULL,
  severity     text NOT NULL DEFAULT 'info',
  region       text,
  actor_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  subject_type text,
  subject_id   text,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX operations_events_type_idx ON public.operations_events(event_type, created_at DESC);
GRANT SELECT, INSERT ON public.operations_events TO authenticated;
GRANT ALL ON public.operations_events TO service_role;
ALTER TABLE public.operations_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage ops events" ON public.operations_events
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE TABLE public.ride_interventions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id         uuid,
  driver_id       uuid,
  rider_id        uuid,
  intervention    text NOT NULL,           -- reassign|cancel|escalate|suspend|reprice|route_correct
  reason          text,
  actor_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  outcome         text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ride_interventions_trip_idx ON public.ride_interventions(trip_id);
GRANT SELECT, INSERT, UPDATE ON public.ride_interventions TO authenticated;
GRANT ALL ON public.ride_interventions TO service_role;
ALTER TABLE public.ride_interventions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage ride interventions" ON public.ride_interventions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE TABLE public.delivery_interventions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id      uuid,
  driver_id       uuid,
  intervention    text NOT NULL,
  reason          text,
  actor_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  outcome         text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX delivery_interventions_pkg_idx ON public.delivery_interventions(package_id);
GRANT SELECT, INSERT, UPDATE ON public.delivery_interventions TO authenticated;
GRANT ALL ON public.delivery_interventions TO service_role;
ALTER TABLE public.delivery_interventions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage delivery interventions" ON public.delivery_interventions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- ---------------------------------------------------------
-- 5. DOCUMENT REVIEW ASSIGNMENTS
-- ---------------------------------------------------------
CREATE TABLE public.document_review_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id     uuid NOT NULL,
  reviewer_id  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  released_at  timestamptz,
  status       text NOT NULL DEFAULT 'active', -- active|released|reassigned
  notes        text
);
CREATE INDEX document_review_assignments_queue_idx ON public.document_review_assignments(queue_id);
CREATE INDEX document_review_assignments_reviewer_idx ON public.document_review_assignments(reviewer_id);
GRANT SELECT, INSERT, UPDATE ON public.document_review_assignments TO authenticated;
GRANT ALL ON public.document_review_assignments TO service_role;
ALTER TABLE public.document_review_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Compliance admins manage assignments" ON public.document_review_assignments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'compliance_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'compliance_admin'));

-- ---------------------------------------------------------
-- 6. REALTIME on cockpit tables
-- ---------------------------------------------------------
ALTER TABLE public.executive_metrics REPLICA IDENTITY FULL;
ALTER TABLE public.executive_alerts  REPLICA IDENTITY FULL;
ALTER TABLE public.operations_events REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'executive_metrics'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.executive_metrics';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'executive_alerts'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.executive_alerts';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'operations_events'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.operations_events';
  END IF;
END $$;

-- ---------------------------------------------------------
-- 7. Seed initial executive metrics so cockpit renders
-- ---------------------------------------------------------
INSERT INTO public.executive_metrics (metric_key, label, value_numeric, unit, trend_pct, category) VALUES
  ('revenue_today',         'Revenue Today',          0, 'KES', 0, 'revenue'),
  ('revenue_mtd',           'Revenue MTD',            0, 'KES', 0, 'revenue'),
  ('revenue_ytd',           'Revenue YTD',            0, 'KES', 0, 'revenue'),
  ('trips_today',           'Trips Today',            0, 'count', 0, 'operations'),
  ('trips_this_hour',       'Trips This Hour',        0, 'count', 0, 'operations'),
  ('deliveries_today',      'Deliveries Today',       0, 'count', 0, 'operations'),
  ('corporate_spend_today', 'Corporate Spend',        0, 'KES', 0, 'revenue'),
  ('driver_earnings_today', 'Driver Earnings',        0, 'KES', 0, 'revenue'),
  ('wallet_float',          'Wallet Float',           0, 'KES', 0, 'revenue'),
  ('pending_settlements',   'Pending Settlements',    0, 'KES', 0, 'revenue'),
  ('risk_alerts',           'Risk Alerts',            0, 'count', 0, 'risk'),
  ('compliance_alerts',     'Compliance Alerts',      0, 'count', 0, 'risk'),
  ('critical_incidents',    'Critical Incidents',     0, 'count', 0, 'risk'),
  ('fraud_cases',           'Fraud Cases',            0, 'count', 0, 'risk'),
  ('active_sos_events',     'Active SOS Events',      0, 'count', 0, 'risk'),
  ('customer_satisfaction', 'Customer Satisfaction',  0, '%',     0, 'satisfaction'),
  ('driver_satisfaction',   'Driver Satisfaction',    0, '%',     0, 'satisfaction'),
  ('system_health',         'System Health',          100, '%',   0, 'system')
ON CONFLICT (metric_key, region, tenant_id) DO NOTHING;
