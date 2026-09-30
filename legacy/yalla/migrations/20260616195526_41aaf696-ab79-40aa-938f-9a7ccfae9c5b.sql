
DO $$ BEGIN CREATE TYPE public.tlp_marking AS ENUM ('WHITE','GREEN','AMBER','RED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.data_classification_level AS ENUM ('public','internal','confidential','restricted','regulated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.privacy_request_type AS ENUM ('access','rectification','erasure','portability','restrict','object','consent_withdraw');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.privacy_request_status AS ENUM ('received','verifying','processing','completed','rejected','partial');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE public.threat_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  indicator_type TEXT NOT NULL,
  indicator_value TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence INT NOT NULL DEFAULT 50,
  tlp public.tlp_marking NOT NULL DEFAULT 'AMBER',
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(indicator_type, indicator_value, source)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.threat_intelligence TO authenticated;
GRANT ALL ON public.threat_intelligence TO service_role;
ALTER TABLE public.threat_intelligence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ti_admin_all" ON public.threat_intelligence FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_ti_value ON public.threat_intelligence(indicator_value);

CREATE TABLE public.blocked_ips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address INET NOT NULL,
  reason TEXT NOT NULL,
  source TEXT,
  blocked_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  blocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blocked_ips TO authenticated;
GRANT ALL ON public.blocked_ips TO service_role;
ALTER TABLE public.blocked_ips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bi_admin_all" ON public.blocked_ips FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_bi_active ON public.blocked_ips(ip_address) WHERE active = true;

CREATE TABLE public.backup_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_name TEXT NOT NULL,
  target TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  size_bytes BIGINT,
  duration_seconds INT,
  destination TEXT,
  checksum TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backup_jobs TO authenticated;
GRANT ALL ON public.backup_jobs TO service_role;
ALTER TABLE public.backup_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bj_admin_all" ON public.backup_jobs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_bj_started ON public.backup_jobs(started_at DESC);

CREATE TABLE public.disaster_recovery_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_name TEXT NOT NULL,
  scenario TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  rto_target_minutes INT,
  rpo_target_minutes INT,
  rto_actual_minutes INT,
  rpo_actual_minutes INT,
  passed BOOLEAN,
  findings TEXT,
  conducted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.disaster_recovery_tests TO authenticated;
GRANT ALL ON public.disaster_recovery_tests TO service_role;
ALTER TABLE public.disaster_recovery_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "drt_admin_all" ON public.disaster_recovery_tests FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.failover_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name TEXT NOT NULL,
  from_region TEXT,
  to_region TEXT,
  triggered_by TEXT NOT NULL,
  initiator UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  duration_seconds INT,
  successful BOOLEAN,
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.failover_events TO authenticated;
GRANT ALL ON public.failover_events TO service_role;
ALTER TABLE public.failover_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fe_admin_all" ON public.failover_events FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.data_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  column_name TEXT,
  classification public.data_classification_level NOT NULL,
  pii BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(schema_name, table_name, column_name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_classifications TO authenticated;
GRANT ALL ON public.data_classifications TO service_role;
ALTER TABLE public.data_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dc_admin_all" ON public.data_classifications FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.retention_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset TEXT NOT NULL UNIQUE,
  retention_days INT NOT NULL,
  delete_strategy TEXT NOT NULL DEFAULT 'hard_delete',
  legal_hold BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.retention_policies TO authenticated;
GRANT ALL ON public.retention_policies TO service_role;
ALTER TABLE public.retention_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rp_admin_all_gov" ON public.retention_policies FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  purpose TEXT NOT NULL,
  granted BOOLEAN NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  withdrawn_at TIMESTAMPTZ,
  source TEXT,
  policy_version TEXT,
  ip_address INET,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consent_records TO authenticated;
GRANT ALL ON public.consent_records TO service_role;
ALTER TABLE public.consent_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cr_user_own_read" ON public.consent_records FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "cr_user_insert_own" ON public.consent_records FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "cr_admin_update" ON public.consent_records FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX idx_cr_user ON public.consent_records(user_id, purpose);

CREATE TABLE public.privacy_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number TEXT NOT NULL UNIQUE DEFAULT ('DSAR-' || to_char(now(),'YYYYMMDD') || '-' || substr(gen_random_uuid()::text,1,8)),
  user_id UUID,
  requester_email TEXT NOT NULL,
  request_type public.privacy_request_type NOT NULL,
  status public.privacy_request_status NOT NULL DEFAULT 'received',
  sla_due_at TIMESTAMPTZ,
  description TEXT,
  resolution_notes TEXT,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.privacy_requests TO authenticated;
GRANT INSERT ON public.privacy_requests TO anon;
GRANT ALL ON public.privacy_requests TO service_role;
ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pq_anon_insert" ON public.privacy_requests FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "pq_user_insert" ON public.privacy_requests FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "pq_user_read_own" ON public.privacy_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "pq_admin_update" ON public.privacy_requests FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_dc_updated BEFORE UPDATE ON public.data_classifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_rp_gov_updated BEFORE UPDATE ON public.retention_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_pq_updated BEFORE UPDATE ON public.privacy_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.privacy_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.blocked_ips;
