
-- Phase 5: Fraud & Financial Crime Platform

DO $$ BEGIN CREATE TYPE public.risk_event_severity AS ENUM ('low','medium','high','critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.fraud_review_status AS ENUM ('open','reviewing','confirmed','dismissed','escalated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.risk_entity_type AS ENUM ('rider','driver','corporate','courier','device','ip','vehicle','payment_method');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.financial_risk_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type public.risk_entity_type NOT NULL,
  entity_id UUID,
  event_type TEXT NOT NULL,
  severity public.risk_event_severity NOT NULL DEFAULT 'medium',
  amount NUMERIC(14,2),
  currency TEXT DEFAULT 'KES',
  source TEXT NOT NULL,
  source_ref UUID,
  signal_data JSONB NOT NULL DEFAULT '{}'::JSONB,
  score NUMERIC(5,2),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_risk_events TO authenticated;
GRANT ALL ON public.financial_risk_events TO service_role;
ALTER TABLE public.financial_risk_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fre_admin_all" ON public.financial_risk_events FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_fre_entity ON public.financial_risk_events(entity_type, entity_id);
CREATE INDEX idx_fre_detected ON public.financial_risk_events(detected_at DESC);

CREATE TABLE public.payment_fraud_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_number TEXT NOT NULL UNIQUE DEFAULT ('PF-' || to_char(now(),'YYYYMMDD') || '-' || substr(gen_random_uuid()::text,1,8)),
  payment_ref UUID,
  payment_source TEXT,
  entity_type public.risk_entity_type NOT NULL,
  entity_id UUID,
  amount NUMERIC(14,2),
  currency TEXT DEFAULT 'KES',
  status public.fraud_review_status NOT NULL DEFAULT 'open',
  severity public.risk_event_severity NOT NULL DEFAULT 'medium',
  signals JSONB NOT NULL DEFAULT '[]'::JSONB,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_fraud_cases TO authenticated;
GRANT ALL ON public.payment_fraud_cases TO service_role;
ALTER TABLE public.payment_fraud_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pfc_admin_all" ON public.payment_fraud_cases FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_pfc_status ON public.payment_fraud_cases(status);
CREATE INDEX idx_pfc_entity ON public.payment_fraud_cases(entity_type, entity_id);

CREATE TABLE public.wallet_abuse_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_number TEXT NOT NULL UNIQUE DEFAULT ('WA-' || to_char(now(),'YYYYMMDD') || '-' || substr(gen_random_uuid()::text,1,8)),
  wallet_ref UUID,
  entity_type public.risk_entity_type NOT NULL,
  entity_id UUID,
  abuse_type TEXT NOT NULL,
  status public.fraud_review_status NOT NULL DEFAULT 'open',
  severity public.risk_event_severity NOT NULL DEFAULT 'medium',
  velocity_window TEXT,
  velocity_count INT,
  total_amount NUMERIC(14,2),
  signals JSONB NOT NULL DEFAULT '[]'::JSONB,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wallet_abuse_cases TO authenticated;
GRANT ALL ON public.wallet_abuse_cases TO service_role;
ALTER TABLE public.wallet_abuse_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wac_admin_all" ON public.wallet_abuse_cases FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_wac_status ON public.wallet_abuse_cases(status);

CREATE TABLE public.suspicious_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_ref UUID,
  source TEXT NOT NULL,
  entity_type public.risk_entity_type NOT NULL,
  entity_id UUID,
  amount NUMERIC(14,2),
  currency TEXT DEFAULT 'KES',
  reason TEXT NOT NULL,
  score NUMERIC(5,2),
  severity public.risk_event_severity NOT NULL DEFAULT 'medium',
  reviewed BOOLEAN NOT NULL DEFAULT false,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  outcome TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suspicious_transactions TO authenticated;
GRANT ALL ON public.suspicious_transactions TO service_role;
ALTER TABLE public.suspicious_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sus_tx_admin_all" ON public.suspicious_transactions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_sus_tx_unreviewed ON public.suspicious_transactions(created_at DESC) WHERE reviewed = false;

CREATE TABLE public.risk_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type public.risk_entity_type NOT NULL,
  entity_id UUID NOT NULL,
  score NUMERIC(5,2) NOT NULL,
  band TEXT NOT NULL,
  model_name TEXT,
  model_version TEXT,
  factors JSONB NOT NULL DEFAULT '{}'::JSONB,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.risk_scores TO authenticated;
GRANT ALL ON public.risk_scores TO service_role;
ALTER TABLE public.risk_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rs_admin_all" ON public.risk_scores FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_rs_entity ON public.risk_scores(entity_type, entity_id, computed_at DESC);

CREATE TABLE public.risk_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  description TEXT,
  weights JSONB NOT NULL DEFAULT '{}'::JSONB,
  thresholds JSONB NOT NULL DEFAULT '{}'::JSONB,
  active BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(name, version)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.risk_models TO authenticated;
GRANT ALL ON public.risk_models TO service_role;
ALTER TABLE public.risk_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rm_admin_all" ON public.risk_models FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.risk_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID REFERENCES public.risk_models(id) ON DELETE SET NULL,
  event_ref UUID,
  entity_type public.risk_entity_type NOT NULL,
  entity_id UUID,
  predicted_score NUMERIC(5,2) NOT NULL,
  band TEXT NOT NULL,
  feature_contributions JSONB NOT NULL DEFAULT '{}'::JSONB,
  predicted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.risk_predictions TO authenticated;
GRANT ALL ON public.risk_predictions TO service_role;
ALTER TABLE public.risk_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rp_admin_all" ON public.risk_predictions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_rp_entity ON public.risk_predictions(entity_type, entity_id, predicted_at DESC);

CREATE TRIGGER trg_pfc_updated BEFORE UPDATE ON public.payment_fraud_cases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_wac_updated BEFORE UPDATE ON public.wallet_abuse_cases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_rm_updated BEFORE UPDATE ON public.risk_models
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.financial_risk_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payment_fraud_cases;
ALTER PUBLICATION supabase_realtime ADD TABLE public.suspicious_transactions;

INSERT INTO public.risk_models (name, version, description, weights, thresholds, active)
VALUES (
  'baseline-v1', '1.0.0',
  'Heuristic baseline scorer: velocity, amount, geo, device trust, chargeback history',
  '{"velocity":0.30,"amount":0.20,"geo":0.15,"device_trust":0.20,"chargeback_history":0.15}'::JSONB,
  '{"low":30,"medium":60,"high":80,"critical":90}'::JSONB,
  true
)
ON CONFLICT (name, version) DO NOTHING;
