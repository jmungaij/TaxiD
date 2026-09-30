
-- ENUMS
DO $$ BEGIN CREATE TYPE public.dispatch_status AS ENUM ('PENDING','MATCHING','OFFERED','ACCEPTED','REJECTED','EXPIRED','ASSIGNED','CANCELLED','COMPLETED','FAILED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.dispatch_candidate_status AS ENUM ('SCORED','OFFERED','ACCEPTED','REJECTED','TIMEOUT','SKIPPED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.fraud_case_status AS ENUM ('OPEN','INVESTIGATING','ESCALATED','CONFIRMED','DISMISSED','RESOLVED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.security_severity AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.health_status AS ENUM ('HEALTHY','DEGRADED','DOWN','UNKNOWN'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PHASE 1: REGISTRY
CREATE TABLE IF NOT EXISTS public.system_modules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE NOT NULL, name text NOT NULL, category text, description text, owner_team text, status text NOT NULL DEFAULT 'ACTIVE', version text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.system_modules TO authenticated; GRANT ALL ON public.system_modules TO service_role;
ALTER TABLE public.system_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "modules readable" ON public.system_modules FOR SELECT TO authenticated USING (true);
CREATE POLICY "modules admin write" ON public.system_modules FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.service_registry (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), service_code text UNIQUE NOT NULL, service_type text NOT NULL, module_id uuid REFERENCES public.system_modules(id) ON DELETE SET NULL, endpoint text, health_status public.health_status NOT NULL DEFAULT 'UNKNOWN', last_health_check_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.service_registry TO authenticated; GRANT ALL ON public.service_registry TO service_role;
ALTER TABLE public.service_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "services readable" ON public.service_registry FOR SELECT TO authenticated USING (true);
CREATE POLICY "services admin write" ON public.service_registry FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.feature_registry (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), feature_key text UNIQUE NOT NULL, module_id uuid REFERENCES public.system_modules(id) ON DELETE SET NULL, enabled boolean NOT NULL DEFAULT false, rollout_percentage int NOT NULL DEFAULT 0 CHECK (rollout_percentage BETWEEN 0 AND 100), targeting jsonb NOT NULL DEFAULT '{}'::jsonb, description text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.feature_registry TO authenticated; GRANT ALL ON public.feature_registry TO service_role;
ALTER TABLE public.feature_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "features readable" ON public.feature_registry FOR SELECT TO authenticated USING (true);
CREATE POLICY "features admin write" ON public.feature_registry FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.dependency_registry (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), module_id uuid NOT NULL REFERENCES public.system_modules(id) ON DELETE CASCADE, depends_on_module_id uuid NOT NULL REFERENCES public.system_modules(id) ON DELETE CASCADE, dependency_type text NOT NULL DEFAULT 'HARD', notes text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (module_id, depends_on_module_id));
GRANT SELECT ON public.dependency_registry TO authenticated; GRANT ALL ON public.dependency_registry TO service_role;
ALTER TABLE public.dependency_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deps readable" ON public.dependency_registry FOR SELECT TO authenticated USING (true);
CREATE POLICY "deps admin write" ON public.dependency_registry FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

-- PHASE 2: DISPATCH
CREATE TABLE IF NOT EXISTS public.dispatch_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rider_id uuid, corporate_id uuid REFERENCES public.corporate_accounts(id) ON DELETE SET NULL, pickup_lat double precision NOT NULL, pickup_lng double precision NOT NULL, pickup_address text, dropoff_lat double precision, dropoff_lng double precision, dropoff_address text, vehicle_category text, requested_at timestamptz NOT NULL DEFAULT now(), scheduled_for timestamptz, status public.dispatch_status NOT NULL DEFAULT 'PENDING', surge_multiplier numeric(5,2) NOT NULL DEFAULT 1.0, estimated_fare_cents bigint, currency text NOT NULL DEFAULT 'KES', assigned_driver_id uuid, assigned_at timestamptz, completed_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_disp_req_status ON public.dispatch_requests(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_disp_req_rider ON public.dispatch_requests(rider_id);
CREATE INDEX IF NOT EXISTS idx_disp_req_driver ON public.dispatch_requests(assigned_driver_id);
GRANT SELECT, INSERT, UPDATE ON public.dispatch_requests TO authenticated; GRANT ALL ON public.dispatch_requests TO service_role;
ALTER TABLE public.dispatch_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rider sees own dispatch" ON public.dispatch_requests FOR SELECT TO authenticated USING (rider_id = auth.uid() OR assigned_driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));
CREATE POLICY "rider creates dispatch" ON public.dispatch_requests FOR INSERT TO authenticated WITH CHECK (rider_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));
CREATE POLICY "ops updates dispatch" ON public.dispatch_requests FOR UPDATE TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.dispatch_candidates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES public.dispatch_requests(id) ON DELETE CASCADE, driver_id uuid NOT NULL, rank int NOT NULL, distance_m int, eta_seconds int, score numeric(8,4), status public.dispatch_candidate_status NOT NULL DEFAULT 'SCORED', offered_at timestamptz, responded_at timestamptz, reason text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_disp_cand_req ON public.dispatch_candidates(request_id, rank);
CREATE INDEX IF NOT EXISTS idx_disp_cand_driver ON public.dispatch_candidates(driver_id, status);
GRANT SELECT, INSERT, UPDATE ON public.dispatch_candidates TO authenticated; GRANT ALL ON public.dispatch_candidates TO service_role;
ALTER TABLE public.dispatch_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "driver sees own offers" ON public.dispatch_candidates FOR SELECT TO authenticated USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));
CREATE POLICY "driver responds to offer" ON public.dispatch_candidates FOR UPDATE TO authenticated USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[])) WITH CHECK (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));
CREATE POLICY "ops creates candidate" ON public.dispatch_candidates FOR INSERT TO authenticated WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.dispatch_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid NOT NULL REFERENCES public.dispatch_requests(id) ON DELETE CASCADE, driver_id uuid NOT NULL, vehicle_id uuid, assigned_at timestamptz NOT NULL DEFAULT now(), accepted_at timestamptz, arrived_at timestamptz, started_at timestamptz, completed_at timestamptz, cancelled_at timestamptz, cancel_reason text, trip_distance_m int, trip_duration_s int);
CREATE INDEX IF NOT EXISTS idx_disp_assign_driver ON public.dispatch_assignments(driver_id, assigned_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.dispatch_assignments TO authenticated; GRANT ALL ON public.dispatch_assignments TO service_role;
ALTER TABLE public.dispatch_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assign visible" ON public.dispatch_assignments FOR SELECT TO authenticated USING (driver_id = auth.uid() OR EXISTS (SELECT 1 FROM public.dispatch_requests r WHERE r.id = request_id AND r.rider_id = auth.uid()) OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));
CREATE POLICY "ops mut assign" ON public.dispatch_assignments FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]) OR driver_id = auth.uid()) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]) OR driver_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.dispatch_scores (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), candidate_id uuid NOT NULL REFERENCES public.dispatch_candidates(id) ON DELETE CASCADE, factor text NOT NULL, weight numeric(6,3) NOT NULL, value numeric(10,3) NOT NULL, contribution numeric(10,3) NOT NULL, rule_version text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_disp_scores_cand ON public.dispatch_scores(candidate_id);
GRANT SELECT, INSERT ON public.dispatch_scores TO authenticated; GRANT ALL ON public.dispatch_scores TO service_role;
ALTER TABLE public.dispatch_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scores admin" ON public.dispatch_scores FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));
CREATE POLICY "scores insert" ON public.dispatch_scores FOR INSERT TO authenticated WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.dispatch_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), request_id uuid REFERENCES public.dispatch_requests(id) ON DELETE CASCADE, candidate_id uuid REFERENCES public.dispatch_candidates(id) ON DELETE SET NULL, event_type text NOT NULL, actor_id uuid, payload jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_disp_events_req ON public.dispatch_events(request_id, created_at);
GRANT SELECT, INSERT ON public.dispatch_events TO authenticated; GRANT ALL ON public.dispatch_events TO service_role;
ALTER TABLE public.dispatch_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "disp events read" ON public.dispatch_events FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));
CREATE POLICY "disp events insert" ON public.dispatch_events FOR INSERT TO authenticated WITH CHECK (actor_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.dispatch_rejections (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), candidate_id uuid NOT NULL REFERENCES public.dispatch_candidates(id) ON DELETE CASCADE, driver_id uuid NOT NULL, reason_code text NOT NULL, reason_text text, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT ON public.dispatch_rejections TO authenticated; GRANT ALL ON public.dispatch_rejections TO service_role;
ALTER TABLE public.dispatch_rejections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rej read" ON public.dispatch_rejections FOR SELECT TO authenticated USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));
CREATE POLICY "rej insert" ON public.dispatch_rejections FOR INSERT TO authenticated WITH CHECK (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.dispatch_performance_metrics (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), metric_date date NOT NULL, region_code text, total_requests int NOT NULL DEFAULT 0, matched_requests int NOT NULL DEFAULT 0, failed_requests int NOT NULL DEFAULT 0, avg_match_seconds numeric(8,2), avg_eta_seconds numeric(8,2), acceptance_rate numeric(5,4), cancellation_rate numeric(5,4), surge_avg numeric(5,2), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (metric_date, region_code));
GRANT SELECT, INSERT, UPDATE ON public.dispatch_performance_metrics TO authenticated; GRANT ALL ON public.dispatch_performance_metrics TO service_role;
ALTER TABLE public.dispatch_performance_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "disp perf admin" ON public.dispatch_performance_metrics FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.dispatch_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rule_code text UNIQUE NOT NULL, name text NOT NULL, description text, active boolean NOT NULL DEFAULT true, current_version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.dispatch_rules TO authenticated; GRANT ALL ON public.dispatch_rules TO service_role;
ALTER TABLE public.dispatch_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rules read" ON public.dispatch_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "rules admin" ON public.dispatch_rules FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.dispatch_rule_versions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rule_id uuid NOT NULL REFERENCES public.dispatch_rules(id) ON DELETE CASCADE, version int NOT NULL, config jsonb NOT NULL, ab_test_group text, weight_percentage int NOT NULL DEFAULT 100 CHECK (weight_percentage BETWEEN 0 AND 100), created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (rule_id, version));
GRANT SELECT ON public.dispatch_rule_versions TO authenticated; GRANT ALL ON public.dispatch_rule_versions TO service_role;
ALTER TABLE public.dispatch_rule_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rulever read" ON public.dispatch_rule_versions FOR SELECT TO authenticated USING (true);
CREATE POLICY "rulever admin" ON public.dispatch_rule_versions FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

-- PHASE 3: LOCATION
CREATE TABLE IF NOT EXISTS public.driver_locations (driver_id uuid PRIMARY KEY, lat double precision NOT NULL, lng double precision NOT NULL, heading numeric(5,2), speed_kph numeric(5,2), accuracy_m numeric(6,2), is_online boolean NOT NULL DEFAULT false, is_available boolean NOT NULL DEFAULT false, vehicle_id uuid, battery_pct int, updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_driver_loc_avail ON public.driver_locations(is_available, is_online);
GRANT SELECT, INSERT, UPDATE ON public.driver_locations TO authenticated; GRANT ALL ON public.driver_locations TO service_role;
ALTER TABLE public.driver_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "driver upserts own loc" ON public.driver_locations FOR ALL TO authenticated USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[])) WITH CHECK (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.rider_locations (rider_id uuid PRIMARY KEY, lat double precision NOT NULL, lng double precision NOT NULL, accuracy_m numeric(6,2), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON public.rider_locations TO authenticated; GRANT ALL ON public.rider_locations TO service_role;
ALTER TABLE public.rider_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rider own loc" ON public.rider_locations FOR ALL TO authenticated USING (rider_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[])) WITH CHECK (rider_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.tracking_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject_type text NOT NULL CHECK (subject_type IN ('DRIVER','RIDER','TRIP','VEHICLE')), subject_id uuid NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), ended_at timestamptz, point_count int NOT NULL DEFAULT 0, metadata jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE INDEX IF NOT EXISTS idx_track_sess_subj ON public.tracking_sessions(subject_type, subject_id, started_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.tracking_sessions TO authenticated; GRANT ALL ON public.tracking_sessions TO service_role;
ALTER TABLE public.tracking_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "track sess read" ON public.tracking_sessions FOR SELECT TO authenticated USING (subject_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));
CREATE POLICY "track sess write" ON public.tracking_sessions FOR ALL TO authenticated USING (subject_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[])) WITH CHECK (subject_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.location_streams (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid REFERENCES public.tracking_sessions(id) ON DELETE CASCADE, subject_id uuid NOT NULL, lat double precision NOT NULL, lng double precision NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), speed_kph numeric(5,2), heading numeric(5,2));
CREATE INDEX IF NOT EXISTS idx_locstream_sess ON public.location_streams(session_id, recorded_at);
GRANT SELECT, INSERT ON public.location_streams TO authenticated; GRANT ALL ON public.location_streams TO service_role;
ALTER TABLE public.location_streams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "locstream owner" ON public.location_streams FOR ALL TO authenticated USING (subject_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[])) WITH CHECK (subject_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.location_history (id uuid NOT NULL DEFAULT gen_random_uuid(), subject_id uuid NOT NULL, subject_type text NOT NULL, lat double precision NOT NULL, lng double precision NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), trip_id uuid, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, PRIMARY KEY (id, recorded_at)) PARTITION BY RANGE (recorded_at);
CREATE INDEX IF NOT EXISTS idx_lochist_subj ON public.location_history(subject_id, recorded_at DESC);
GRANT SELECT, INSERT ON public.location_history TO authenticated; GRANT ALL ON public.location_history TO service_role;
ALTER TABLE public.location_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lochist owner" ON public.location_history FOR ALL TO authenticated USING (subject_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[])) WITH CHECK (subject_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));
DO $$ DECLARE _m date := date_trunc('month', now())::date; _i int; _start date; _end date; _name text; BEGIN FOR _i IN 0..2 LOOP _start := (_m + (_i || ' month')::interval)::date; _end := (_m + ((_i+1) || ' month')::interval)::date; _name := format('location_history_%s', to_char(_start,'YYYYMM')); EXECUTE format('CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.location_history FOR VALUES FROM (%L) TO (%L)', _name, _start, _end); END LOOP; END $$;

CREATE TABLE IF NOT EXISTS public.trip_location_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), trip_id uuid NOT NULL, event_type text NOT NULL, lat double precision, lng double precision, occurred_at timestamptz NOT NULL DEFAULT now(), payload jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE INDEX IF NOT EXISTS idx_trip_loc_ev ON public.trip_location_events(trip_id, occurred_at);
GRANT SELECT, INSERT ON public.trip_location_events TO authenticated; GRANT ALL ON public.trip_location_events TO service_role;
ALTER TABLE public.trip_location_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trip loc admin r" ON public.trip_location_events FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));
CREATE POLICY "trip loc admin w" ON public.trip_location_events FOR INSERT TO authenticated WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));

-- PHASE 5: FRAUD
CREATE TABLE IF NOT EXISTS public.fraud_rules (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rule_code text UNIQUE NOT NULL, name text NOT NULL, description text, signal_type text NOT NULL, weight numeric(5,2) NOT NULL DEFAULT 1.0, severity public.security_severity NOT NULL DEFAULT 'MEDIUM', active boolean NOT NULL DEFAULT true, config jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.fraud_rules TO authenticated; GRANT ALL ON public.fraud_rules TO service_role;
ALTER TABLE public.fraud_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fraud rules read" ON public.fraud_rules FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));
CREATE POLICY "fraud rules admin" ON public.fraud_rules FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.fraud_cases (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject_type text NOT NULL, subject_id uuid NOT NULL, status public.fraud_case_status NOT NULL DEFAULT 'OPEN', severity public.security_severity NOT NULL DEFAULT 'MEDIUM', score numeric(6,2), summary text, assigned_to uuid, opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz, resolution text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_fraud_cases_status ON public.fraud_cases(status, severity);
GRANT SELECT, INSERT, UPDATE ON public.fraud_cases TO authenticated; GRANT ALL ON public.fraud_cases TO service_role;
ALTER TABLE public.fraud_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fraud cases admin" ON public.fraud_cases FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.fraud_alerts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid REFERENCES public.fraud_cases(id) ON DELETE CASCADE, rule_id uuid REFERENCES public.fraud_rules(id) ON DELETE SET NULL, subject_type text NOT NULL, subject_id uuid NOT NULL, severity public.security_severity NOT NULL DEFAULT 'MEDIUM', message text NOT NULL, signal jsonb NOT NULL DEFAULT '{}'::jsonb, acknowledged boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON public.fraud_alerts TO authenticated; GRANT ALL ON public.fraud_alerts TO service_role;
ALTER TABLE public.fraud_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fraud alerts admin" ON public.fraud_alerts FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.fraud_investigations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL REFERENCES public.fraud_cases(id) ON DELETE CASCADE, investigator_id uuid, notes text, findings jsonb NOT NULL DEFAULT '{}'::jsonb, evidence_urls text[] NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'OPEN', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON public.fraud_investigations TO authenticated; GRANT ALL ON public.fraud_investigations TO service_role;
ALTER TABLE public.fraud_investigations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fraud inv admin" ON public.fraud_investigations FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- PHASE 6: DOCUMENT INTEL EXT
CREATE TABLE IF NOT EXISTS public.document_metadata (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL, document_table text NOT NULL, field_name text NOT NULL, field_value text, confidence numeric(5,4), source text NOT NULL DEFAULT 'OCR', created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_docmeta_doc ON public.document_metadata(document_table, document_id);
GRANT SELECT, INSERT ON public.document_metadata TO authenticated; GRANT ALL ON public.document_metadata TO service_role;
ALTER TABLE public.document_metadata ENABLE ROW LEVEL SECURITY;
CREATE POLICY "docmeta admin r" ON public.document_metadata FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));
CREATE POLICY "docmeta admin w" ON public.document_metadata FOR INSERT TO authenticated WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.document_anomalies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL, document_table text NOT NULL, anomaly_type text NOT NULL, severity public.security_severity NOT NULL DEFAULT 'MEDIUM', details jsonb NOT NULL DEFAULT '{}'::jsonb, resolved boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON public.document_anomalies TO authenticated; GRANT ALL ON public.document_anomalies TO service_role;
ALTER TABLE public.document_anomalies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "docanom admin" ON public.document_anomalies FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- PHASE 7
CREATE TABLE IF NOT EXISTS public.compliance_escalations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), alert_id uuid, driver_id uuid, level int NOT NULL DEFAULT 1, escalated_to uuid, reason text, status text NOT NULL DEFAULT 'OPEN', due_at timestamptz, resolved_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON public.compliance_escalations TO authenticated; GRANT ALL ON public.compliance_escalations TO service_role;
ALTER TABLE public.compliance_escalations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "compesc admin" ON public.compliance_escalations FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- PHASE 8: FLEET ENT
CREATE TABLE IF NOT EXISTS public.fleet_regions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fleet_company_id uuid REFERENCES public.fleet_companies(id) ON DELETE CASCADE, country_code text, region_name text NOT NULL, region_code text, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fleet_regions TO authenticated; GRANT ALL ON public.fleet_regions TO service_role;
ALTER TABLE public.fleet_regions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fleet regions admin" ON public.fleet_regions FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','fleet_owner']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','fleet_owner']::app_role[]));

CREATE TABLE IF NOT EXISTS public.fleet_performance (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fleet_company_id uuid NOT NULL REFERENCES public.fleet_companies(id) ON DELETE CASCADE, metric_date date NOT NULL, active_vehicles int NOT NULL DEFAULT 0, active_drivers int NOT NULL DEFAULT 0, total_trips int NOT NULL DEFAULT 0, total_revenue_cents bigint NOT NULL DEFAULT 0, utilization_pct numeric(5,2), avg_rating numeric(3,2), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (fleet_company_id, metric_date));
GRANT SELECT, INSERT, UPDATE ON public.fleet_performance TO authenticated; GRANT ALL ON public.fleet_performance TO service_role;
ALTER TABLE public.fleet_performance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fleet perf read" ON public.fleet_performance FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','fleet_owner']::app_role[]));
CREATE POLICY "fleet perf write" ON public.fleet_performance FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.fleet_compliance (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fleet_company_id uuid NOT NULL REFERENCES public.fleet_companies(id) ON DELETE CASCADE, compliance_score numeric(5,2), expired_documents int NOT NULL DEFAULT 0, open_incidents int NOT NULL DEFAULT 0, last_audit_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON public.fleet_compliance TO authenticated; GRANT ALL ON public.fleet_compliance TO service_role;
ALTER TABLE public.fleet_compliance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fleet comp read" ON public.fleet_compliance FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin','fleet_owner']::app_role[]));
CREATE POLICY "fleet comp write" ON public.fleet_compliance FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.fleet_revenue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fleet_company_id uuid NOT NULL REFERENCES public.fleet_companies(id) ON DELETE CASCADE, period_start date NOT NULL, period_end date NOT NULL, gross_revenue_cents bigint NOT NULL DEFAULT 0, commission_cents bigint NOT NULL DEFAULT 0, net_payout_cents bigint NOT NULL DEFAULT 0, currency text NOT NULL DEFAULT 'KES', created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON public.fleet_revenue TO authenticated; GRANT ALL ON public.fleet_revenue TO service_role;
ALTER TABLE public.fleet_revenue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fleet rev read" ON public.fleet_revenue FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin','fleet_owner']::app_role[]));
CREATE POLICY "fleet rev write" ON public.fleet_revenue FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]));

-- PHASE 9: VEHICLE ASSET
CREATE TABLE IF NOT EXISTS public.vehicle_assets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL, asset_tag text UNIQUE, purchase_price_cents bigint, current_value_cents bigint, depreciation_pct_annual numeric(5,2), finance_partner text, loan_balance_cents bigint, status text NOT NULL DEFAULT 'OWNED', metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON public.vehicle_assets TO authenticated; GRANT ALL ON public.vehicle_assets TO service_role;
ALTER TABLE public.vehicle_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "veh asset admin" ON public.vehicle_assets FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','fleet_owner']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','fleet_owner']::app_role[]));

CREATE TABLE IF NOT EXISTS public.vehicle_ownership_history (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL, owner_type text NOT NULL, owner_id uuid, owner_name text, from_date date NOT NULL, to_date date, transfer_reason text, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON public.vehicle_ownership_history TO authenticated; GRANT ALL ON public.vehicle_ownership_history TO service_role;
ALTER TABLE public.vehicle_ownership_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "veh own hist admin" ON public.vehicle_ownership_history FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','fleet_owner']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','fleet_owner']::app_role[]));

-- PHASES 12/13: ANALYTICS + WAREHOUSE
CREATE TABLE IF NOT EXISTS public.analytics_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_name text NOT NULL, user_id uuid, subject_type text, subject_id uuid, properties jsonb NOT NULL DEFAULT '{}'::jsonb, occurred_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_anly_ev_name ON public.analytics_events(event_name, occurred_at DESC);
GRANT SELECT, INSERT ON public.analytics_events TO authenticated; GRANT ALL ON public.analytics_events TO service_role;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anly ev insert" ON public.analytics_events FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE POLICY "anly ev read" ON public.analytics_events FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.analytics_dimensions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dimension_key text UNIQUE NOT NULL, dimension_type text NOT NULL, description text, values jsonb NOT NULL DEFAULT '[]'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT ON public.analytics_dimensions TO authenticated; GRANT ALL ON public.analytics_dimensions TO service_role;
ALTER TABLE public.analytics_dimensions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anly dim read" ON public.analytics_dimensions FOR SELECT TO authenticated USING (true);
CREATE POLICY "anly dim admin" ON public.analytics_dimensions FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.analytics_facts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fact_table text NOT NULL, dim_key jsonb NOT NULL, metric_name text NOT NULL, metric_value numeric(20,4) NOT NULL, period_start timestamptz NOT NULL, period_end timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_anly_facts ON public.analytics_facts(fact_table, period_start);
GRANT SELECT, INSERT ON public.analytics_facts TO authenticated; GRANT ALL ON public.analytics_facts TO service_role;
ALTER TABLE public.analytics_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anly facts admin" ON public.analytics_facts FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.analytics_aggregates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), aggregate_key text NOT NULL, bucket_period text NOT NULL, bucket_start timestamptz NOT NULL, value numeric(20,4) NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (aggregate_key, bucket_period, bucket_start));
GRANT SELECT, INSERT, UPDATE ON public.analytics_aggregates TO authenticated; GRANT ALL ON public.analytics_aggregates TO service_role;
ALTER TABLE public.analytics_aggregates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anly agg admin" ON public.analytics_aggregates FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.dashboard_metrics (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dashboard_key text NOT NULL, metric_key text NOT NULL, display_label text NOT NULL, value numeric(20,4), unit text, trend numeric(8,4), metadata jsonb NOT NULL DEFAULT '{}'::jsonb, computed_at timestamptz NOT NULL DEFAULT now(), UNIQUE (dashboard_key, metric_key));
GRANT SELECT, INSERT, UPDATE ON public.dashboard_metrics TO authenticated; GRANT ALL ON public.dashboard_metrics TO service_role;
ALTER TABLE public.dashboard_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dashm read" ON public.dashboard_metrics FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','finance_admin']::app_role[]));
CREATE POLICY "dashm admin" ON public.dashboard_metrics FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.dashboard_snapshots (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dashboard_key text NOT NULL, snapshot jsonb NOT NULL, taken_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT ON public.dashboard_snapshots TO authenticated; GRANT ALL ON public.dashboard_snapshots TO service_role;
ALTER TABLE public.dashboard_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dashs admin" ON public.dashboard_snapshots FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.etl_jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_name text NOT NULL, status text NOT NULL DEFAULT 'PENDING', started_at timestamptz, finished_at timestamptz, rows_processed bigint, error text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON public.etl_jobs TO authenticated; GRANT ALL ON public.etl_jobs TO service_role;
ALTER TABLE public.etl_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "etl admin" ON public.etl_jobs FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.warehouse_exports (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), destination text NOT NULL, table_name text NOT NULL, exported_rows bigint, status text NOT NULL DEFAULT 'PENDING', file_url text, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, error text);
GRANT SELECT, INSERT, UPDATE ON public.warehouse_exports TO authenticated; GRANT ALL ON public.warehouse_exports TO service_role;
ALTER TABLE public.warehouse_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wh exports admin" ON public.warehouse_exports FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.analytics_snapshots (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), snapshot_key text NOT NULL, snapshot_date date NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (snapshot_key, snapshot_date));
GRANT SELECT, INSERT ON public.analytics_snapshots TO authenticated; GRANT ALL ON public.analytics_snapshots TO service_role;
ALTER TABLE public.analytics_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anly snap admin" ON public.analytics_snapshots FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.fact_trips (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), trip_id uuid NOT NULL, driver_id uuid, rider_id uuid, corporate_id uuid, country_code text, trip_date date NOT NULL, distance_km numeric(8,2), duration_s int, fare_cents bigint, commission_cents bigint, surge_multiplier numeric(5,2), payment_method text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_fact_trips_date ON public.fact_trips(trip_date);
GRANT SELECT, INSERT ON public.fact_trips TO authenticated; GRANT ALL ON public.fact_trips TO service_role;
ALTER TABLE public.fact_trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fact trips admin" ON public.fact_trips FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.fact_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_id uuid NOT NULL, trip_id uuid, rider_id uuid, driver_id uuid, amount_cents bigint NOT NULL, currency text NOT NULL DEFAULT 'KES', status text, payment_method text, paid_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT ON public.fact_payments TO authenticated; GRANT ALL ON public.fact_payments TO service_role;
ALTER TABLE public.fact_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fact pay admin" ON public.fact_payments FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.fact_drivers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), driver_id uuid NOT NULL, snapshot_date date NOT NULL, trips int NOT NULL DEFAULT 0, earnings_cents bigint NOT NULL DEFAULT 0, online_hours numeric(6,2), acceptance_rate numeric(5,4), cancellation_rate numeric(5,4), rating numeric(3,2), compliance_score numeric(5,2), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (driver_id, snapshot_date));
GRANT SELECT, INSERT, UPDATE ON public.fact_drivers TO authenticated; GRANT ALL ON public.fact_drivers TO service_role;
ALTER TABLE public.fact_drivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fact drv admin" ON public.fact_drivers FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.fact_compliance (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), snapshot_date date NOT NULL UNIQUE, total_drivers int NOT NULL DEFAULT 0, compliant_drivers int NOT NULL DEFAULT 0, expired_documents int NOT NULL DEFAULT 0, open_alerts int NOT NULL DEFAULT 0, open_incidents int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON public.fact_compliance TO authenticated; GRANT ALL ON public.fact_compliance TO service_role;
ALTER TABLE public.fact_compliance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fact comp admin" ON public.fact_compliance FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

-- PHASE 14: SECURITY
CREATE TABLE IF NOT EXISTS public.security_incidents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), incident_type text NOT NULL, severity public.security_severity NOT NULL DEFAULT 'MEDIUM', subject_user_id uuid, description text NOT NULL, detected_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, status text NOT NULL DEFAULT 'OPEN', metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON public.security_incidents TO authenticated; GRANT ALL ON public.security_incidents TO service_role;
ALTER TABLE public.security_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sec inc admin" ON public.security_incidents FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.security_alerts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), incident_id uuid REFERENCES public.security_incidents(id) ON DELETE SET NULL, alert_type text NOT NULL, severity public.security_severity NOT NULL DEFAULT 'MEDIUM', message text NOT NULL, acknowledged boolean NOT NULL DEFAULT false, payload jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON public.security_alerts TO authenticated; GRANT ALL ON public.security_alerts TO service_role;
ALTER TABLE public.security_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sec alerts admin" ON public.security_alerts FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.security_scores (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject_type text NOT NULL, subject_id uuid NOT NULL, score numeric(5,2) NOT NULL, factors jsonb NOT NULL DEFAULT '{}'::jsonb, computed_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_sec_scores_subj ON public.security_scores(subject_type, subject_id);
GRANT SELECT, INSERT ON public.security_scores TO authenticated; GRANT ALL ON public.security_scores TO service_role;
ALTER TABLE public.security_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sec scores admin" ON public.security_scores FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.security_audits (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), audit_type text NOT NULL, performed_by uuid, scope text, findings jsonb NOT NULL DEFAULT '[]'::jsonb, passed boolean, performed_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT ON public.security_audits TO authenticated; GRANT ALL ON public.security_audits TO service_role;
ALTER TABLE public.security_audits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sec audit admin" ON public.security_audits FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

-- PHASE 15: MULTI-COUNTRY
CREATE TABLE IF NOT EXISTS public.languages (code text PRIMARY KEY, name text NOT NULL, native_name text, rtl boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true);
GRANT SELECT ON public.languages TO anon, authenticated; GRANT ALL ON public.languages TO service_role;
ALTER TABLE public.languages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lang read" ON public.languages FOR SELECT USING (true);
CREATE POLICY "lang admin" ON public.languages FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
INSERT INTO public.languages(code,name,native_name) VALUES ('en','English','English'),('sw','Swahili','Kiswahili'),('fr','French','Français'),('ar','Arabic','العربية') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.tax_frameworks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), country_code text NOT NULL, framework_code text NOT NULL, framework_name text NOT NULL, vat_rate_bps int, withholding_rate_bps int, authority_name text, active boolean NOT NULL DEFAULT true, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (country_code, framework_code));
GRANT SELECT ON public.tax_frameworks TO authenticated; GRANT ALL ON public.tax_frameworks TO service_role;
ALTER TABLE public.tax_frameworks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "taxfw read" ON public.tax_frameworks FOR SELECT TO authenticated USING (true);
CREATE POLICY "taxfw admin" ON public.tax_frameworks FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]));

-- PHASE 16: DRIVER FINANCE
CREATE TABLE IF NOT EXISTS public.driver_benefits (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), driver_id uuid NOT NULL, benefit_type text NOT NULL, provider text, status text NOT NULL DEFAULT 'ACTIVE', start_date date, end_date date, amount_cents bigint, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON public.driver_benefits TO authenticated; GRANT ALL ON public.driver_benefits TO service_role;
ALTER TABLE public.driver_benefits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drv benefits own" ON public.driver_benefits FOR SELECT TO authenticated USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]));
CREATE POLICY "drv benefits admin write" ON public.driver_benefits FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.driver_financial_scores (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), driver_id uuid NOT NULL, credit_score numeric(5,2), savings_score numeric(5,2), income_stability numeric(5,2), loan_repayment numeric(5,2), overall numeric(5,2), computed_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_drv_finscore ON public.driver_financial_scores(driver_id, computed_at DESC);
GRANT SELECT, INSERT ON public.driver_financial_scores TO authenticated; GRANT ALL ON public.driver_financial_scores TO service_role;
ALTER TABLE public.driver_financial_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drv finscore own" ON public.driver_financial_scores FOR SELECT TO authenticated USING (driver_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]));
CREATE POLICY "drv finscore admin" ON public.driver_financial_scores FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]));

-- PHASE 18: OBSERVABILITY
CREATE TABLE IF NOT EXISTS public.system_health_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), service_code text NOT NULL, status public.health_status NOT NULL, latency_ms int, error_rate numeric(6,4), message text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, recorded_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_sysh_svc ON public.system_health_events(service_code, recorded_at DESC);
GRANT SELECT, INSERT ON public.system_health_events TO authenticated; GRANT ALL ON public.system_health_events TO service_role;
ALTER TABLE public.system_health_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sysh read" ON public.system_health_events FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE POLICY "sysh insert" ON public.system_health_events FOR INSERT TO authenticated WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.service_health_metrics (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), service_code text NOT NULL, window_start timestamptz NOT NULL, window_end timestamptz NOT NULL, uptime_pct numeric(5,2), p50_ms int, p95_ms int, p99_ms int, error_count int, request_count int, created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE ON public.service_health_metrics TO authenticated; GRANT ALL ON public.service_health_metrics TO service_role;
ALTER TABLE public.service_health_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "svc hm admin" ON public.service_health_metrics FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.performance_metrics (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), metric_name text NOT NULL, metric_value numeric(20,4) NOT NULL, unit text, tags jsonb NOT NULL DEFAULT '{}'::jsonb, recorded_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_perfm_name ON public.performance_metrics(metric_name, recorded_at DESC);
GRANT SELECT, INSERT ON public.performance_metrics TO authenticated; GRANT ALL ON public.performance_metrics TO service_role;
ALTER TABLE public.performance_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "perfm read" ON public.performance_metrics FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE POLICY "perfm insert" ON public.performance_metrics FOR INSERT TO authenticated WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.availability_metrics (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), service_code text NOT NULL, metric_date date NOT NULL, uptime_seconds bigint NOT NULL DEFAULT 0, downtime_seconds bigint NOT NULL DEFAULT 0, incidents int NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (service_code, metric_date));
GRANT SELECT, INSERT, UPDATE ON public.availability_metrics TO authenticated; GRANT ALL ON public.availability_metrics TO service_role;
ALTER TABLE public.availability_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "avail admin" ON public.availability_metrics FOR ALL TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE IF NOT EXISTS public.error_tracking (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), service_code text, error_type text NOT NULL, message text NOT NULL, stack text, user_id uuid, context jsonb NOT NULL DEFAULT '{}'::jsonb, occurred_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS idx_errtrk_svc ON public.error_tracking(service_code, occurred_at DESC);
GRANT SELECT, INSERT ON public.error_tracking TO authenticated; GRANT ALL ON public.error_tracking TO service_role;
ALTER TABLE public.error_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY "errtrk insert" ON public.error_tracking FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE POLICY "errtrk read" ON public.error_tracking FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

-- REALTIME
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.dispatch_requests; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.dispatch_candidates; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.dispatch_assignments; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_locations; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.fraud_alerts; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.system_health_events; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- updated_at TRIGGERS
DO $$ DECLARE _t text; BEGIN FOREACH _t IN ARRAY ARRAY['system_modules','service_registry','feature_registry','dispatch_requests','dispatch_rules','fraud_rules','fraud_cases','fraud_investigations','fleet_compliance','vehicle_assets','driver_benefits'] LOOP EXECUTE format('DROP TRIGGER IF EXISTS trg_upd_%I ON public.%I', _t, _t); EXECUTE format('CREATE TRIGGER trg_upd_%I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()', _t, _t); END LOOP; END $$;

-- SEED
INSERT INTO public.system_modules(code,name,category,owner_team) VALUES
  ('DISPATCH','Dispatch Engine','OPERATIONS','platform'),
  ('LOCATION','Real-time Location','OPERATIONS','platform'),
  ('FRAUD','Fraud Platform','TRUST','trust-safety'),
  ('COMPLIANCE','Compliance Automation','TRUST','compliance'),
  ('FLEET','Fleet Management','BUSINESS','fleet'),
  ('ANALYTICS','Analytics Platform','DATA','data'),
  ('WAREHOUSE','Data Warehouse','DATA','data'),
  ('SECURITY','Security Hardening','TRUST','security'),
  ('OBSERVABILITY','Observability','PLATFORM','sre'),
  ('FINANCE_DRIVER','Driver Financial Ecosystem','FINANCE','fintech'),
  ('MULTI_COUNTRY','Multi-Country Platform','PLATFORM','expansion')
ON CONFLICT (code) DO NOTHING;
