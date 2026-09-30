
-- =========================================================================
-- PHASE 3: AI/ML PLATFORM
-- =========================================================================

-- 1. FEATURE DEFINITIONS
CREATE TABLE public.ml_feature_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_name TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL,
  dtype TEXT NOT NULL,
  description TEXT,
  owner TEXT,
  source_sql TEXT,
  freshness_minutes INTEGER NOT NULL DEFAULT 60,
  is_pii BOOLEAN NOT NULL DEFAULT false,
  tags TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ml_feature_definitions TO authenticated;
GRANT ALL ON public.ml_feature_definitions TO service_role;
ALTER TABLE public.ml_feature_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ml feature defs admin" ON public.ml_feature_definitions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 2. FEATURE VALUES (online store)
CREATE TABLE public.ml_feature_values (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_name TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  value_num NUMERIC,
  value_text TEXT,
  value_json JSONB,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  UNIQUE(feature_name, entity_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ml_feature_values TO authenticated;
GRANT ALL ON public.ml_feature_values TO service_role;
ALTER TABLE public.ml_feature_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ml feature values admin" ON public.ml_feature_values FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_ml_feature_values_entity ON public.ml_feature_values(entity_type, entity_id);

-- 3. MODEL REGISTRY
CREATE TABLE public.ml_model_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name TEXT NOT NULL,
  version TEXT NOT NULL,
  framework TEXT,
  use_case TEXT NOT NULL,
  artifact_uri TEXT,
  input_schema JSONB,
  output_schema JSONB,
  training_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'registered',
  registered_by UUID,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(model_name, version)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ml_model_registry TO authenticated;
GRANT ALL ON public.ml_model_registry TO service_role;
ALTER TABLE public.ml_model_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ml model registry admin" ON public.ml_model_registry FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 4. MODEL DEPLOYMENTS
CREATE TABLE public.ml_model_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES public.ml_model_registry(id) ON DELETE CASCADE,
  use_case TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'production',
  traffic_pct NUMERIC(5,2) NOT NULL DEFAULT 100.00,
  is_canary BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  rollout_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rolled_back_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ml_model_deployments TO authenticated;
GRANT ALL ON public.ml_model_deployments TO service_role;
ALTER TABLE public.ml_model_deployments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ml deployments admin" ON public.ml_model_deployments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_ml_deployments_active ON public.ml_model_deployments(use_case, environment) WHERE is_active;

-- 5. PREDICTIONS LOG
CREATE TABLE public.ml_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID REFERENCES public.ml_model_registry(id) ON DELETE SET NULL,
  use_case TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  input_hash TEXT,
  input_payload JSONB,
  output JSONB,
  confidence NUMERIC(5,4),
  latency_ms INTEGER,
  served_environment TEXT,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.ml_predictions TO authenticated;
GRANT ALL ON public.ml_predictions TO service_role;
ALTER TABLE public.ml_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ml predictions admin read" ON public.ml_predictions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "ml predictions admin insert" ON public.ml_predictions FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_ml_predictions_use_case ON public.ml_predictions(use_case, created_at DESC);

-- 6. PREDICTION FEEDBACK (ground truth)
CREATE TABLE public.ml_prediction_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id UUID REFERENCES public.ml_predictions(id) ON DELETE CASCADE,
  outcome JSONB NOT NULL,
  reward NUMERIC,
  is_correct BOOLEAN,
  source TEXT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT, INSERT ON public.ml_prediction_feedback TO authenticated;
GRANT ALL ON public.ml_prediction_feedback TO service_role;
ALTER TABLE public.ml_prediction_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ml feedback admin read" ON public.ml_prediction_feedback FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));
CREATE POLICY "ml feedback admin insert" ON public.ml_prediction_feedback FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 7. TRAINING RUNS
CREATE TABLE public.ml_training_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name TEXT NOT NULL,
  run_name TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  dataset_ref TEXT,
  hyperparameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  artifact_uri TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  triggered_by UUID,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.ml_training_runs TO authenticated;
GRANT ALL ON public.ml_training_runs TO service_role;
ALTER TABLE public.ml_training_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ml training runs admin" ON public.ml_training_runs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 8. DRIFT METRICS
CREATE TABLE public.ml_drift_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID REFERENCES public.ml_model_registry(id) ON DELETE CASCADE,
  feature_name TEXT,
  metric_type TEXT NOT NULL,
  metric_value NUMERIC NOT NULL,
  threshold NUMERIC,
  is_drift_detected BOOLEAN NOT NULL DEFAULT false,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  sample_size INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.ml_drift_metrics TO authenticated;
GRANT ALL ON public.ml_drift_metrics TO service_role;
ALTER TABLE public.ml_drift_metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ml drift admin" ON public.ml_drift_metrics FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_ml_drift_model ON public.ml_drift_metrics(model_id, window_end DESC);

-- 9. EXPERIMENTS
CREATE TABLE public.ml_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  hypothesis TEXT,
  use_case TEXT,
  variants JSONB NOT NULL,
  traffic_split JSONB NOT NULL,
  primary_metric TEXT NOT NULL,
  secondary_metrics TEXT[],
  status TEXT NOT NULL DEFAULT 'draft',
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  results JSONB,
  winner TEXT,
  owner UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ml_experiments TO authenticated;
GRANT ALL ON public.ml_experiments TO service_role;
ALTER TABLE public.ml_experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ml experiments admin" ON public.ml_experiments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- updated_at triggers
CREATE TRIGGER trg_ml_feature_defs_updated BEFORE UPDATE ON public.ml_feature_definitions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_ml_model_registry_updated BEFORE UPDATE ON public.ml_model_registry
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_ml_deployments_updated BEFORE UPDATE ON public.ml_model_deployments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_ml_experiments_updated BEFORE UPDATE ON public.ml_experiments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed model registry (placeholders so deployments can reference them)
INSERT INTO public.ml_model_registry (model_name, version, framework, use_case, status, notes) VALUES
  ('dispatch_eta',      '0.0.1', 'placeholder', 'dispatch_eta_prediction',   'registered', 'ETA per hex/ride-type — to be trained'),
  ('surge_predictor',   '0.0.1', 'placeholder', 'marketplace_surge',         'registered', 'Surge multiplier predictor from supply/demand'),
  ('fraud_risk',        '0.0.1', 'placeholder', 'rider_trust_fraud',         'registered', 'Rider/driver fraud risk classifier'),
  ('rider_churn',       '0.0.1', 'placeholder', 'rider_lifecycle',           'registered', '30-day rider churn probability'),
  ('demand_forecast',   '0.0.1', 'placeholder', 'marketplace_demand',        'registered', 'Hourly demand forecast per hex');
