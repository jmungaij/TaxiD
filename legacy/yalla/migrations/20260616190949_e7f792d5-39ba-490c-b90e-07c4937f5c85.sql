
-- ============================================================
-- Dispatch Intelligence: 9 tables
-- Domain: dispatch
-- ============================================================

-- 1. dispatch_supply_cells -----------------------------------
CREATE TABLE public.dispatch_supply_cells (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cell_key TEXT NOT NULL UNIQUE,
  center_lat DOUBLE PRECISION NOT NULL,
  center_lng DOUBLE PRECISION NOT NULL,
  resolution SMALLINT NOT NULL DEFAULT 7,
  online_drivers INTEGER NOT NULL DEFAULT 0,
  available_drivers INTEGER NOT NULL DEFAULT 0,
  demand_1m INTEGER NOT NULL DEFAULT 0,
  demand_5m INTEGER NOT NULL DEFAULT 0,
  demand_15m INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_supply_cells_updated ON public.dispatch_supply_cells (updated_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_supply_cells TO authenticated;
GRANT ALL ON public.dispatch_supply_cells TO service_role;
ALTER TABLE public.dispatch_supply_cells ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ops read supply cells" ON public.dispatch_supply_cells
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));
CREATE POLICY "ops write supply cells" ON public.dispatch_supply_cells
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

-- 2. dispatch_demand_signals ---------------------------------
CREATE TABLE public.dispatch_demand_signals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cell_key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  unfulfilled_count INTEGER NOT NULL DEFAULT 0,
  avg_eta_seconds INTEGER,
  surge_recommendation NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_demand_signals_cell_time ON public.dispatch_demand_signals (cell_key, window_end DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_demand_signals TO authenticated;
GRANT ALL ON public.dispatch_demand_signals TO service_role;
ALTER TABLE public.dispatch_demand_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ops read demand" ON public.dispatch_demand_signals
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));
CREATE POLICY "ops write demand" ON public.dispatch_demand_signals
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

-- 3. dispatch_surge_zones ------------------------------------
CREATE TABLE public.dispatch_surge_zones (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cell_key TEXT NOT NULL,
  multiplier NUMERIC(5,2) NOT NULL DEFAULT 1.0,
  reason TEXT,
  source TEXT NOT NULL DEFAULT 'auto',
  valid_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_surge_source CHECK (source IN ('auto','manual','scheduled')),
  CONSTRAINT chk_surge_multiplier CHECK (multiplier >= 1.0 AND multiplier <= 10.0)
);
CREATE INDEX idx_surge_active ON public.dispatch_surge_zones (cell_key, active, valid_from DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_surge_zones TO authenticated;
GRANT ALL ON public.dispatch_surge_zones TO service_role;
ALTER TABLE public.dispatch_surge_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ops read surge" ON public.dispatch_surge_zones
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));
CREATE POLICY "ops write surge" ON public.dispatch_surge_zones
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

-- 4. dispatch_eta_estimates ----------------------------------
CREATE TABLE public.dispatch_eta_estimates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID NOT NULL REFERENCES public.dispatch_requests(id) ON DELETE CASCADE,
  candidate_id UUID REFERENCES public.dispatch_candidates(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL,
  distance_m INTEGER NOT NULL,
  eta_seconds INTEGER NOT NULL,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  model_version TEXT NOT NULL DEFAULT 'haversine-v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_eta_request ON public.dispatch_eta_estimates (request_id);
CREATE INDEX idx_eta_driver ON public.dispatch_eta_estimates (driver_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_eta_estimates TO authenticated;
GRANT ALL ON public.dispatch_eta_estimates TO service_role;
ALTER TABLE public.dispatch_eta_estimates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ops read eta" ON public.dispatch_eta_estimates
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));
CREATE POLICY "driver reads own eta" ON public.dispatch_eta_estimates
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid());
CREATE POLICY "ops write eta" ON public.dispatch_eta_estimates
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

-- 5. dispatch_acceptance_stats -------------------------------
CREATE TABLE public.dispatch_acceptance_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id UUID NOT NULL,
  window_size INTEGER NOT NULL DEFAULT 50,
  offers_received INTEGER NOT NULL DEFAULT 0,
  offers_accepted INTEGER NOT NULL DEFAULT 0,
  offers_rejected INTEGER NOT NULL DEFAULT 0,
  offers_expired INTEGER NOT NULL DEFAULT 0,
  acceptance_rate NUMERIC(5,4) NOT NULL DEFAULT 0,
  completion_rate NUMERIC(5,4) NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_acceptance_driver UNIQUE (driver_id, window_size)
);
CREATE INDEX idx_acceptance_driver ON public.dispatch_acceptance_stats (driver_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_acceptance_stats TO authenticated;
GRANT ALL ON public.dispatch_acceptance_stats TO service_role;
ALTER TABLE public.dispatch_acceptance_stats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ops read acceptance" ON public.dispatch_acceptance_stats
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));
CREATE POLICY "driver reads own acceptance" ON public.dispatch_acceptance_stats
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid());
CREATE POLICY "ops write acceptance" ON public.dispatch_acceptance_stats
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

-- 6. dispatch_offer_timeouts ---------------------------------
CREATE TABLE public.dispatch_offer_timeouts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  candidate_id UUID NOT NULL REFERENCES public.dispatch_candidates(id) ON DELETE CASCADE,
  request_id UUID NOT NULL REFERENCES public.dispatch_requests(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  outcome TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_timeout_outcome CHECK (outcome IS NULL OR outcome IN ('ACCEPTED','REJECTED','EXPIRED'))
);
CREATE INDEX idx_offer_timeouts_pending ON public.dispatch_offer_timeouts (expires_at) WHERE resolved_at IS NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_offer_timeouts TO authenticated;
GRANT ALL ON public.dispatch_offer_timeouts TO service_role;
ALTER TABLE public.dispatch_offer_timeouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ops read timeouts" ON public.dispatch_offer_timeouts
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));
CREATE POLICY "ops write timeouts" ON public.dispatch_offer_timeouts
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

-- 7. dispatch_engine_runs ------------------------------------
CREATE TABLE public.dispatch_engine_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  request_id UUID NOT NULL REFERENCES public.dispatch_requests(id) ON DELETE CASCADE,
  rule_version TEXT,
  candidates_considered INTEGER NOT NULL DEFAULT 0,
  candidates_offered INTEGER NOT NULL DEFAULT 0,
  winner_driver_id UUID,
  outcome TEXT NOT NULL,
  duration_ms INTEGER,
  notes JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  CONSTRAINT chk_engine_outcome CHECK (outcome IN ('ASSIGNED','NO_SUPPLY','EXPIRED','CANCELLED','ERROR'))
);
CREATE INDEX idx_engine_runs_request ON public.dispatch_engine_runs (request_id, started_at DESC);
CREATE INDEX idx_engine_runs_outcome ON public.dispatch_engine_runs (outcome, started_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_engine_runs TO authenticated;
GRANT ALL ON public.dispatch_engine_runs TO service_role;
ALTER TABLE public.dispatch_engine_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ops read engine runs" ON public.dispatch_engine_runs
  FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));
CREATE POLICY "ops write engine runs" ON public.dispatch_engine_runs
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

-- 8. dispatch_sim_scenarios ----------------------------------
CREATE TABLE public.dispatch_sim_scenarios (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  rule_version TEXT,
  driver_distribution JSONB NOT NULL DEFAULT '{}'::jsonb,
  rider_distribution JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_rate_per_min INTEGER NOT NULL DEFAULT 10,
  duration_minutes INTEGER NOT NULL DEFAULT 15,
  driver_acceptance_rate NUMERIC(4,3) NOT NULL DEFAULT 0.8,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_sim_scenarios TO authenticated;
GRANT ALL ON public.dispatch_sim_scenarios TO service_role;
ALTER TABLE public.dispatch_sim_scenarios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ops manage sim scenarios" ON public.dispatch_sim_scenarios
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

-- 9. dispatch_sim_results ------------------------------------
CREATE TABLE public.dispatch_sim_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  scenario_id UUID NOT NULL REFERENCES public.dispatch_sim_scenarios(id) ON DELETE CASCADE,
  rule_version TEXT,
  total_requests INTEGER NOT NULL DEFAULT 0,
  assigned INTEGER NOT NULL DEFAULT 0,
  expired INTEGER NOT NULL DEFAULT 0,
  no_supply INTEGER NOT NULL DEFAULT 0,
  avg_assign_ms INTEGER,
  avg_eta_seconds INTEGER,
  avg_score NUMERIC(8,4),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX idx_sim_results_scenario ON public.dispatch_sim_results (scenario_id, started_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_sim_results TO authenticated;
GRANT ALL ON public.dispatch_sim_results TO service_role;
ALTER TABLE public.dispatch_sim_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ops manage sim results" ON public.dispatch_sim_results
  FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));
