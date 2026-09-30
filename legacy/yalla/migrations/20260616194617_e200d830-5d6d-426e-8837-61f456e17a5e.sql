
-- =====================================================================
-- PHASE 4: TRUST & SAFETY PLATFORM
-- =====================================================================

-- Enums
DO $$ BEGIN
  CREATE TYPE public.trust_case_severity AS ENUM ('low','medium','high','critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.trust_case_status AS ENUM ('open','in_review','investigating','escalated','resolved','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.trust_case_category AS ENUM (
    'safety','fraud','harassment','package_tamper','identity','payment','policy','other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.trust_subject_type AS ENUM ('rider','driver','corporate','courier','vehicle','package','trip','device','ip');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.trust_resolution_outcome AS ENUM (
    'no_action','warning','refund','partial_refund','account_suspended','account_banned',
    'driver_deactivated','escalated_external','law_enforcement','dismissed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.custody_event_type AS ENUM (
    'pickup','handover','warehouse_in','warehouse_out','transit','delivery_attempt','delivered','returned'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- 1. trust_cases
-- ---------------------------------------------------------------------
CREATE TABLE public.trust_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_number TEXT NOT NULL UNIQUE DEFAULT ('TC-' || to_char(now(),'YYYYMMDD') || '-' || substr(gen_random_uuid()::text,1,8)),
  category public.trust_case_category NOT NULL,
  severity public.trust_case_severity NOT NULL DEFAULT 'medium',
  status public.trust_case_status NOT NULL DEFAULT 'open',
  subject_type public.trust_subject_type NOT NULL,
  subject_id UUID,
  title TEXT NOT NULL,
  summary TEXT,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  sla_due_at TIMESTAMPTZ,
  opened_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trust_cases TO authenticated;
GRANT ALL ON public.trust_cases TO service_role;
ALTER TABLE public.trust_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trust_cases_admin_all" ON public.trust_cases FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_trust_cases_status ON public.trust_cases(status);
CREATE INDEX idx_trust_cases_severity ON public.trust_cases(severity);
CREATE INDEX idx_trust_cases_subject ON public.trust_cases(subject_type, subject_id);
CREATE INDEX idx_trust_cases_assigned ON public.trust_cases(assigned_to);
CREATE INDEX idx_trust_cases_sla_due ON public.trust_cases(sla_due_at) WHERE status NOT IN ('resolved','closed');

-- ---------------------------------------------------------------------
-- 2. trust_incidents
-- ---------------------------------------------------------------------
CREATE TABLE public.trust_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES public.trust_cases(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  source_ref UUID,
  category public.trust_case_category NOT NULL,
  severity public.trust_case_severity NOT NULL DEFAULT 'medium',
  subject_type public.trust_subject_type NOT NULL,
  subject_id UUID,
  reported_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  description TEXT,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  routed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trust_incidents TO authenticated;
GRANT ALL ON public.trust_incidents TO service_role;
ALTER TABLE public.trust_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trust_incidents_admin_all" ON public.trust_incidents FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_trust_incidents_case ON public.trust_incidents(case_id);
CREATE INDEX idx_trust_incidents_subject ON public.trust_incidents(subject_type, subject_id);
CREATE INDEX idx_trust_incidents_occurred ON public.trust_incidents(occurred_at DESC);

-- ---------------------------------------------------------------------
-- 3. trust_escalations
-- ---------------------------------------------------------------------
CREATE TABLE public.trust_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.trust_cases(id) ON DELETE CASCADE,
  from_user UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  to_team TEXT NOT NULL,
  to_user UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  level INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trust_escalations TO authenticated;
GRANT ALL ON public.trust_escalations TO service_role;
ALTER TABLE public.trust_escalations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trust_escalations_admin_all" ON public.trust_escalations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_trust_escalations_case ON public.trust_escalations(case_id);

-- ---------------------------------------------------------------------
-- 4. trust_investigations
-- ---------------------------------------------------------------------
CREATE TABLE public.trust_investigations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL REFERENCES public.trust_cases(id) ON DELETE CASCADE,
  investigator UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open',
  findings TEXT,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trust_investigations TO authenticated;
GRANT ALL ON public.trust_investigations TO service_role;
ALTER TABLE public.trust_investigations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trust_investigations_admin_all" ON public.trust_investigations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_trust_investigations_case ON public.trust_investigations(case_id);

-- ---------------------------------------------------------------------
-- 5. trust_resolutions
-- ---------------------------------------------------------------------
CREATE TABLE public.trust_resolutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID NOT NULL UNIQUE REFERENCES public.trust_cases(id) ON DELETE CASCADE,
  outcome public.trust_resolution_outcome NOT NULL,
  notes TEXT,
  refund_amount NUMERIC(14,2),
  refund_currency TEXT DEFAULT 'KES',
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trust_resolutions TO authenticated;
GRANT ALL ON public.trust_resolutions TO service_role;
ALTER TABLE public.trust_resolutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trust_resolutions_admin_all" ON public.trust_resolutions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ---------------------------------------------------------------------
-- 6. trust_watchlists
-- ---------------------------------------------------------------------
CREATE TABLE public.trust_watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type public.trust_subject_type NOT NULL,
  subject_id UUID,
  subject_value TEXT,
  risk_level public.trust_case_severity NOT NULL DEFAULT 'medium',
  reason TEXT NOT NULL,
  added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trust_watchlists TO authenticated;
GRANT ALL ON public.trust_watchlists TO service_role;
ALTER TABLE public.trust_watchlists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trust_watchlists_admin_all" ON public.trust_watchlists FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_trust_watchlists_subject ON public.trust_watchlists(subject_type, subject_id) WHERE active = true;
CREATE INDEX idx_trust_watchlists_value ON public.trust_watchlists(subject_value) WHERE active = true;

-- ---------------------------------------------------------------------
-- 7. package_chain_of_custody
-- ---------------------------------------------------------------------
CREATE TABLE public.package_chain_of_custody (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL,
  event_type public.custody_event_type NOT NULL,
  actor_type public.trust_subject_type,
  actor_id UUID,
  actor_label TEXT,
  location_lat NUMERIC(10,7),
  location_lng NUMERIC(10,7),
  location_label TEXT,
  signature_ref TEXT,
  photo_ref TEXT,
  seal_id TEXT,
  seal_intact BOOLEAN,
  notes TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.package_chain_of_custody TO authenticated;
GRANT ALL ON public.package_chain_of_custody TO service_role;
ALTER TABLE public.package_chain_of_custody ENABLE ROW LEVEL SECURITY;
CREATE POLICY "package_custody_admin_all" ON public.package_chain_of_custody FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_custody_package ON public.package_chain_of_custody(package_id, occurred_at DESC);

-- ---------------------------------------------------------------------
-- 8. package_tamper_alerts
-- ---------------------------------------------------------------------
CREATE TABLE public.package_tamper_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL,
  custody_event_id UUID REFERENCES public.package_chain_of_custody(id) ON DELETE SET NULL,
  trust_case_id UUID REFERENCES public.trust_cases(id) ON DELETE SET NULL,
  alert_type TEXT NOT NULL,
  severity public.trust_case_severity NOT NULL DEFAULT 'high',
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  detector TEXT NOT NULL DEFAULT 'system',
  acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.package_tamper_alerts TO authenticated;
GRANT ALL ON public.package_tamper_alerts TO service_role;
ALTER TABLE public.package_tamper_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "package_tamper_admin_all" ON public.package_tamper_alerts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_tamper_package ON public.package_tamper_alerts(package_id, detected_at DESC);
CREATE INDEX idx_tamper_unack ON public.package_tamper_alerts(detected_at DESC) WHERE acknowledged_at IS NULL;

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_trust_cases_updated BEFORE UPDATE ON public.trust_cases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_trust_investigations_updated BEFORE UPDATE ON public.trust_investigations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_trust_watchlists_updated BEFORE UPDATE ON public.trust_watchlists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.trust_cases;
ALTER PUBLICATION supabase_realtime ADD TABLE public.trust_incidents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.package_tamper_alerts;
