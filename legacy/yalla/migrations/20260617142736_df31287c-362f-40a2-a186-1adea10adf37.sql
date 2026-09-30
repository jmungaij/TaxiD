
-- Drop legacy non-partitioned event tables from Phase 2 (no production data yet)
DROP TABLE IF EXISTS public.event_snapshots CASCADE;
DROP TABLE IF EXISTS public.event_store CASCADE;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- ============================================================
-- EVENT PLATFORM
-- ============================================================
CREATE TABLE IF NOT EXISTS public.event_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name text NOT NULL UNIQUE,
  event_category text NOT NULL,
  source_service text NOT NULL,
  schema_version int NOT NULL DEFAULT 1,
  retention_days int NOT NULL DEFAULT 3650,
  description text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tenant_id uuid, region_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_registry_name ON public.event_registry(event_name);
CREATE INDEX IF NOT EXISTS idx_event_registry_category ON public.event_registry(event_category);
GRANT SELECT ON public.event_registry TO authenticated;
GRANT ALL ON public.event_registry TO service_role;
ALTER TABLE public.event_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "registry read admins" ON public.event_registry;
CREATE POLICY "registry read admins" ON public.event_registry FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'compliance_admin'));
DROP POLICY IF EXISTS "registry write super_admin" ON public.event_registry;
CREATE POLICY "registry write super_admin" ON public.event_registry FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'super_admin')) WITH CHECK (public.has_role(auth.uid(),'super_admin'));
DROP TRIGGER IF EXISTS trg_event_registry_updated ON public.event_registry;
CREATE TRIGGER trg_event_registry_updated BEFORE UPDATE ON public.event_registry FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.event_store (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  aggregate_id uuid,
  aggregate_type text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  tenant_id uuid, region_id uuid,
  schema_version int NOT NULL DEFAULT 1,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE public.event_store_default PARTITION OF public.event_store DEFAULT;

CREATE INDEX idx_event_store_type ON public.event_store(event_type);
CREATE INDEX idx_event_store_aggregate ON public.event_store(aggregate_type, aggregate_id);
CREATE INDEX idx_event_store_occurred ON public.event_store(occurred_at DESC);
CREATE INDEX idx_event_store_tenant ON public.event_store(tenant_id, occurred_at DESC);
GRANT SELECT, INSERT ON public.event_store TO authenticated;
GRANT ALL ON public.event_store TO service_role;
ALTER TABLE public.event_store ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_store read admins" ON public.event_store FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'compliance_admin') OR public.has_role(auth.uid(),'operations_admin'));
CREATE POLICY "event_store insert auth" ON public.event_store FOR INSERT TO authenticated
  WITH CHECK (actor_id IS NULL OR actor_id = auth.uid());

CREATE OR REPLACE FUNCTION public.ensure_event_store_partition(p_month date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  start_d date := date_trunc('month', p_month)::date;
  end_d   date := (date_trunc('month', p_month) + interval '1 month')::date;
  pname   text := 'event_store_' || to_char(start_d,'YYYYMM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.event_store FOR VALUES FROM (%L) TO (%L)',
    pname, start_d, end_d);
END $$;
SELECT public.ensure_event_store_partition(now()::date);
SELECT public.ensure_event_store_partition((now() + interval '1 month')::date);

CREATE TABLE public.event_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  version int NOT NULL DEFAULT 1,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot_at timestamptz NOT NULL DEFAULT now(),
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aggregate_type, aggregate_id, version)
);
GRANT SELECT, INSERT ON public.event_snapshots TO authenticated;
GRANT ALL ON public.event_snapshots TO service_role;
ALTER TABLE public.event_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "snapshots read admins" ON public.event_snapshots FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'operations_admin'));

CREATE TABLE IF NOT EXISTS public.event_consumers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_name text NOT NULL,
  channel text NOT NULL,
  last_event_id uuid,
  last_event_at timestamptz,
  lag_ms int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consumer_name, channel)
);
CREATE INDEX IF NOT EXISTS idx_event_consumers_channel ON public.event_consumers(channel);
GRANT SELECT, INSERT, UPDATE ON public.event_consumers TO authenticated;
GRANT ALL ON public.event_consumers TO service_role;
ALTER TABLE public.event_consumers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "consumers read admins" ON public.event_consumers;
CREATE POLICY "consumers read admins" ON public.event_consumers FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'operations_admin'));
DROP POLICY IF EXISTS "consumers write super_admin" ON public.event_consumers;
CREATE POLICY "consumers write super_admin" ON public.event_consumers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'super_admin')) WITH CHECK (public.has_role(auth.uid(),'super_admin'));
DROP TRIGGER IF EXISTS trg_event_consumers_updated ON public.event_consumers;
CREATE TRIGGER trg_event_consumers_updated BEFORE UPDATE ON public.event_consumers FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.event_processing_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_id uuid REFERENCES public.event_consumers(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  events_processed bigint NOT NULL DEFAULT 0,
  events_dropped bigint NOT NULL DEFAULT 0,
  events_retried bigint NOT NULL DEFAULT 0,
  avg_lag_ms int NOT NULL DEFAULT 0,
  max_lag_ms int NOT NULL DEFAULT 0,
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_metrics_window ON public.event_processing_metrics(window_start DESC);
GRANT SELECT, INSERT ON public.event_processing_metrics TO authenticated;
GRANT ALL ON public.event_processing_metrics TO service_role;
ALTER TABLE public.event_processing_metrics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "metrics read admins" ON public.event_processing_metrics;
CREATE POLICY "metrics read admins" ON public.event_processing_metrics FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'operations_admin'));

-- ============================================================
-- CAPABILITY ABAC
-- ============================================================
CREATE TABLE IF NOT EXISTS public.capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  category text NOT NULL,
  risk_level text NOT NULL DEFAULT 'low',
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.capabilities TO authenticated;
GRANT ALL ON public.capabilities TO service_role;
ALTER TABLE public.capabilities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "capabilities read auth" ON public.capabilities;
CREATE POLICY "capabilities read auth" ON public.capabilities FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "capabilities write super_admin" ON public.capabilities;
CREATE POLICY "capabilities write super_admin" ON public.capabilities FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'super_admin')) WITH CHECK (public.has_role(auth.uid(),'super_admin'));
DROP TRIGGER IF EXISTS trg_capabilities_updated ON public.capabilities;
CREATE TRIGGER trg_capabilities_updated BEFORE UPDATE ON public.capabilities FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.role_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role app_role NOT NULL,
  capability_id uuid NOT NULL REFERENCES public.capabilities(id) ON DELETE CASCADE,
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role, capability_id)
);
CREATE INDEX IF NOT EXISTS idx_role_cap_role ON public.role_capabilities(role);
GRANT SELECT ON public.role_capabilities TO authenticated;
GRANT ALL ON public.role_capabilities TO service_role;
ALTER TABLE public.role_capabilities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rolecaps read auth" ON public.role_capabilities;
CREATE POLICY "rolecaps read auth" ON public.role_capabilities FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "rolecaps write super_admin" ON public.role_capabilities;
CREATE POLICY "rolecaps write super_admin" ON public.role_capabilities FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'super_admin')) WITH CHECK (public.has_role(auth.uid(),'super_admin'));

CREATE TABLE IF NOT EXISTS public.user_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  capability_id uuid NOT NULL REFERENCES public.capabilities(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text,
  expires_at timestamptz,
  revoked_at timestamptz,
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_cap_user ON public.user_capabilities(user_id);
GRANT SELECT ON public.user_capabilities TO authenticated;
GRANT ALL ON public.user_capabilities TO service_role;
ALTER TABLE public.user_capabilities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "usercaps read self_or_admin" ON public.user_capabilities;
CREATE POLICY "usercaps read self_or_admin" ON public.user_capabilities FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
DROP POLICY IF EXISTS "usercaps write super_admin" ON public.user_capabilities;
CREATE POLICY "usercaps write super_admin" ON public.user_capabilities FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'super_admin')) WITH CHECK (public.has_role(auth.uid(),'super_admin'));

CREATE TABLE IF NOT EXISTS public.policy_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_key text NOT NULL,
  policy_type text NOT NULL,
  capability_id uuid NOT NULL REFERENCES public.capabilities(id) ON DELETE CASCADE,
  required boolean NOT NULL DEFAULT true,
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_key, capability_id)
);
CREATE INDEX IF NOT EXISTS idx_policy_cap_key ON public.policy_capabilities(policy_key);
GRANT SELECT ON public.policy_capabilities TO authenticated;
GRANT ALL ON public.policy_capabilities TO service_role;
ALTER TABLE public.policy_capabilities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "policycaps read auth" ON public.policy_capabilities;
CREATE POLICY "policycaps read auth" ON public.policy_capabilities FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "policycaps write super_admin" ON public.policy_capabilities;
CREATE POLICY "policycaps write super_admin" ON public.policy_capabilities FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'super_admin')) WITH CHECK (public.has_role(auth.uid(),'super_admin'));

CREATE TABLE IF NOT EXISTS public.resource_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope_type text NOT NULL,
  scope_value text NOT NULL,
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, scope_type, scope_value)
);
CREATE INDEX IF NOT EXISTS idx_resource_scopes_user ON public.resource_scopes(user_id);
GRANT SELECT ON public.resource_scopes TO authenticated;
GRANT ALL ON public.resource_scopes TO service_role;
ALTER TABLE public.resource_scopes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scopes read self_or_admin" ON public.resource_scopes;
CREATE POLICY "scopes read self_or_admin" ON public.resource_scopes FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
DROP POLICY IF EXISTS "scopes write super_admin" ON public.resource_scopes;
CREATE POLICY "scopes write super_admin" ON public.resource_scopes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'super_admin')) WITH CHECK (public.has_role(auth.uid(),'super_admin'));

CREATE TABLE IF NOT EXISTS public.authorization_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resource_type text NOT NULL,
  resource_key text NOT NULL,
  decision text NOT NULL,
  required_capabilities text[] NOT NULL DEFAULT '{}',
  user_capabilities text[] NOT NULL DEFAULT '{}',
  risk_score int NOT NULL DEFAULT 0,
  factors jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text, device_id text, country text,
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_authz_decisions_user ON public.authorization_decisions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_authz_decisions_resource ON public.authorization_decisions(resource_type, resource_key);
GRANT SELECT, INSERT ON public.authorization_decisions TO authenticated;
GRANT ALL ON public.authorization_decisions TO service_role;
ALTER TABLE public.authorization_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authz read admins" ON public.authorization_decisions;
CREATE POLICY "authz read admins" ON public.authorization_decisions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'compliance_admin'));
DROP POLICY IF EXISTS "authz insert auth" ON public.authorization_decisions;
CREATE POLICY "authz insert auth" ON public.authorization_decisions FOR INSERT TO authenticated WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.command_access_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  command text NOT NULL,
  requested_center text,
  allowed boolean NOT NULL,
  denial_reason text,
  risk_score int NOT NULL DEFAULT 0,
  ip text, device_id text, country text,
  latency_ms int,
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cmd_logs_user ON public.command_access_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cmd_logs_command ON public.command_access_logs(command);
GRANT SELECT, INSERT ON public.command_access_logs TO authenticated;
GRANT ALL ON public.command_access_logs TO service_role;
ALTER TABLE public.command_access_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cmdlogs read admins" ON public.command_access_logs;
CREATE POLICY "cmdlogs read admins" ON public.command_access_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'compliance_admin'));
DROP POLICY IF EXISTS "cmdlogs insert auth" ON public.command_access_logs;
CREATE POLICY "cmdlogs insert auth" ON public.command_access_logs FOR INSERT TO authenticated WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.command_denials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  command text NOT NULL,
  requested_module text,
  reason text NOT NULL,
  risk_score int NOT NULL DEFAULT 0,
  country text, ip text, device_id text,
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cmd_denials_user ON public.command_denials(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cmd_denials_command ON public.command_denials(command);
GRANT SELECT, INSERT ON public.command_denials TO authenticated;
GRANT ALL ON public.command_denials TO service_role;
ALTER TABLE public.command_denials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cmddenials read admins" ON public.command_denials;
CREATE POLICY "cmddenials read admins" ON public.command_denials FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'compliance_admin'));
DROP POLICY IF EXISTS "cmddenials insert auth" ON public.command_denials;
CREATE POLICY "cmddenials insert auth" ON public.command_denials FOR INSERT TO authenticated WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.has_capability(_user_id uuid, _capability_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_capabilities uc
    JOIN public.capabilities c ON c.id = uc.capability_id
    WHERE uc.user_id = _user_id AND c.key = _capability_key
      AND uc.revoked_at IS NULL
      AND (uc.expires_at IS NULL OR uc.expires_at > now())
  ) OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.role_capabilities rc ON rc.role = ur.role
    JOIN public.capabilities c ON c.id = rc.capability_id
    WHERE ur.user_id = _user_id AND c.key = _capability_key
  );
$$;

-- ============================================================
-- FORENSIC AUDIT
-- ============================================================
ALTER TABLE public.access_denials
  ADD COLUMN IF NOT EXISTS attempted_resource text,
  ADD COLUMN IF NOT EXISTS resource_type text,
  ADD COLUMN IF NOT EXISTS requested_role text,
  ADD COLUMN IF NOT EXISTS actual_role text,
  ADD COLUMN IF NOT EXISTS country text,
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS prev_hash text,
  ADD COLUMN IF NOT EXISTS event_hash text,
  ADD COLUMN IF NOT EXISTS tenant_id uuid,
  ADD COLUMN IF NOT EXISTS region_id uuid,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.audit_hash_chain (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream text NOT NULL UNIQUE,
  head_hash text, head_id uuid, head_at timestamptz,
  count bigint NOT NULL DEFAULT 0,
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_hash_chain TO authenticated;
GRANT ALL ON public.audit_hash_chain TO service_role;
ALTER TABLE public.audit_hash_chain ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chain read admins" ON public.audit_hash_chain;
CREATE POLICY "chain read admins" ON public.audit_hash_chain FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'compliance_admin'));

CREATE TABLE IF NOT EXISTS public.audit_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stream text NOT NULL,
  range_start timestamptz NOT NULL,
  range_end timestamptz NOT NULL,
  status text NOT NULL,
  rows_checked bigint NOT NULL DEFAULT 0,
  first_broken_id uuid,
  broken_at timestamptz,
  verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_verifications TO authenticated;
GRANT ALL ON public.audit_verifications TO service_role;
ALTER TABLE public.audit_verifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "verif read admins" ON public.audit_verifications;
CREATE POLICY "verif read admins" ON public.audit_verifications FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'compliance_admin'));
DROP POLICY IF EXISTS "verif insert admins" ON public.audit_verifications;
CREATE POLICY "verif insert admins" ON public.audit_verifications FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'compliance_admin'));

CREATE TABLE IF NOT EXISTS public.admin_login_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text NOT NULL,
  event_type text NOT NULL,
  ip text, country text, device_id text, browser text, operating_system text,
  risk_score int NOT NULL DEFAULT 0,
  decision text NOT NULL DEFAULT 'allow',
  reason text,
  prev_hash text, event_hash text,
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_login_events_user ON public.admin_login_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_login_events_email ON public.admin_login_events(lower(email));
CREATE INDEX IF NOT EXISTS idx_admin_login_events_type ON public.admin_login_events(event_type, created_at DESC);
GRANT SELECT, INSERT ON public.admin_login_events TO authenticated;
GRANT ALL ON public.admin_login_events TO service_role;
ALTER TABLE public.admin_login_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "login_events admins read" ON public.admin_login_events;
CREATE POLICY "login_events admins read" ON public.admin_login_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'compliance_admin'));
DROP POLICY IF EXISTS "login_events self read" ON public.admin_login_events;
CREATE POLICY "login_events self read" ON public.admin_login_events FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "login_events insert auth" ON public.admin_login_events;
CREATE POLICY "login_events insert auth" ON public.admin_login_events FOR INSERT TO authenticated WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.permission_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  subject_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  capability_key text NOT NULL,
  action text NOT NULL,
  old_state jsonb, new_state jsonb,
  approval_ref text, reason text,
  risk_score int NOT NULL DEFAULT 0,
  prev_hash text, event_hash text,
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.permission_change_log TO authenticated;
GRANT ALL ON public.permission_change_log TO service_role;
ALTER TABLE public.permission_change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "permlog read admins" ON public.permission_change_log;
CREATE POLICY "permlog read admins" ON public.permission_change_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'compliance_admin'));
DROP POLICY IF EXISTS "permlog insert admins" ON public.permission_change_log;
CREATE POLICY "permlog insert admins" ON public.permission_change_log FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE TABLE IF NOT EXISTS public.role_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  subject_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  old_role app_role, new_role app_role,
  action text NOT NULL,
  approval_ref text, reason text,
  risk_score int NOT NULL DEFAULT 0,
  prev_hash text, event_hash text,
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.role_change_log TO authenticated;
GRANT ALL ON public.role_change_log TO service_role;
ALTER TABLE public.role_change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rolelog read admins" ON public.role_change_log;
CREATE POLICY "rolelog read admins" ON public.role_change_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'compliance_admin'));
DROP POLICY IF EXISTS "rolelog insert admins" ON public.role_change_log;
CREATE POLICY "rolelog insert admins" ON public.role_change_log FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE TABLE IF NOT EXISTS public.policy_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  policy_key text NOT NULL,
  policy_type text NOT NULL,
  action text NOT NULL,
  old_state jsonb, new_state jsonb,
  approval_ref text, reason text,
  risk_score int NOT NULL DEFAULT 0,
  prev_hash text, event_hash text,
  tenant_id uuid, region_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.policy_change_log TO authenticated;
GRANT ALL ON public.policy_change_log TO service_role;
ALTER TABLE public.policy_change_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "policylog read admins" ON public.policy_change_log;
CREATE POLICY "policylog read admins" ON public.policy_change_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'compliance_admin'));
DROP POLICY IF EXISTS "policylog insert admins" ON public.policy_change_log;
CREATE POLICY "policylog insert admins" ON public.policy_change_log FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- ============================================================
-- HASH-CHAIN TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION public.tg_hash_chain()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_stream text := TG_ARGV[0];
  v_prev text;
  v_payload text;
BEGIN
  SELECT head_hash INTO v_prev FROM public.audit_hash_chain WHERE stream = v_stream FOR UPDATE;
  IF v_prev IS NULL THEN v_prev := ''; END IF;
  NEW.prev_hash := v_prev;
  v_payload := v_prev || '|' || coalesce(NEW.id::text,'') || '|' || coalesce(to_jsonb(NEW)::text,'') || '|' || coalesce(NEW.created_at::text, now()::text);
  NEW.event_hash := encode(digest(v_payload,'sha256'),'hex');

  INSERT INTO public.audit_hash_chain(stream, head_hash, head_id, head_at, count)
    VALUES (v_stream, NEW.event_hash, NEW.id, coalesce(NEW.created_at, now()), 1)
  ON CONFLICT (stream) DO UPDATE
    SET head_hash = EXCLUDED.head_hash, head_id = EXCLUDED.head_id,
        head_at = EXCLUDED.head_at,
        count = public.audit_hash_chain.count + 1,
        updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_chain_audit_log ON public.admin_audit_log;
CREATE TRIGGER trg_chain_audit_log BEFORE INSERT ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_hash_chain('admin_audit_log');

DROP TRIGGER IF EXISTS trg_chain_access_denials ON public.access_denials;
CREATE TRIGGER trg_chain_access_denials BEFORE INSERT ON public.access_denials
  FOR EACH ROW EXECUTE FUNCTION public.tg_hash_chain('access_denials');

DROP TRIGGER IF EXISTS trg_chain_admin_login_events ON public.admin_login_events;
CREATE TRIGGER trg_chain_admin_login_events BEFORE INSERT ON public.admin_login_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_hash_chain('admin_login_events');

DROP TRIGGER IF EXISTS trg_chain_permission_log ON public.permission_change_log;
CREATE TRIGGER trg_chain_permission_log BEFORE INSERT ON public.permission_change_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_hash_chain('permission_change_log');

DROP TRIGGER IF EXISTS trg_chain_role_log ON public.role_change_log;
CREATE TRIGGER trg_chain_role_log BEFORE INSERT ON public.role_change_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_hash_chain('role_change_log');

DROP TRIGGER IF EXISTS trg_chain_policy_log ON public.policy_change_log;
CREATE TRIGGER trg_chain_policy_log BEFORE INSERT ON public.policy_change_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_hash_chain('policy_change_log');

-- ============================================================
-- APPEND-ONLY ENFORCEMENT
-- ============================================================
REVOKE UPDATE, DELETE ON public.admin_audit_log FROM authenticated;
REVOKE UPDATE, DELETE ON public.access_denials FROM authenticated;
REVOKE UPDATE, DELETE ON public.admin_login_events FROM authenticated;
REVOKE UPDATE, DELETE ON public.permission_change_log FROM authenticated;
REVOKE UPDATE, DELETE ON public.role_change_log FROM authenticated;
REVOKE UPDATE, DELETE ON public.policy_change_log FROM authenticated;
REVOKE UPDATE, DELETE ON public.command_access_logs FROM authenticated;
REVOKE UPDATE, DELETE ON public.command_denials FROM authenticated;
REVOKE UPDATE, DELETE ON public.authorization_decisions FROM authenticated;
REVOKE UPDATE, DELETE ON public.event_store FROM authenticated;

-- ============================================================
-- REALTIME
-- ============================================================
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.event_store; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.authorization_decisions; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.command_denials; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_login_events; EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

-- ============================================================
-- SEED
-- ============================================================
INSERT INTO public.capabilities (key, name, category, risk_level, description) VALUES
  ('executive.view','View Executive Cockpit','executive','low','Read national executive metrics'),
  ('drivers.view','View Drivers','driver','low','Browse driver records'),
  ('drivers.suspend','Suspend Drivers','driver','high','Suspend or freeze driver accounts'),
  ('documents.review','Review Driver Documents','compliance','medium','Approve/reject driver KYC documents'),
  ('documents.escalate','Escalate Documents','compliance','high','Escalate documents to compliance/legal'),
  ('finance.view','View Finance','finance','medium','View financial dashboards'),
  ('finance.adjust','Adjust Finance','finance','critical','Override settlements / wallet'),
  ('fraud.investigate','Investigate Fraud','fraud','high','Open and work fraud cases'),
  ('audit.read','Read Audit Logs','governance','medium','View audit trail'),
  ('audit.verify','Verify Audit Chain','governance','high','Run hash-chain verification'),
  ('staff.manage','Manage Staff','identity','critical','Assign roles and capabilities to staff'),
  ('commandpalette.search','Use Command Palette','system','low','Issue CommandPalette queries')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_capabilities (role, capability_id)
SELECT 'super_admin'::app_role, c.id FROM public.capabilities c ON CONFLICT DO NOTHING;

INSERT INTO public.role_capabilities (role, capability_id)
SELECT r.role::app_role, c.id
FROM (VALUES
  ('admin','executive.view'),('admin','drivers.view'),('admin','drivers.suspend'),
  ('admin','documents.review'),('admin','finance.view'),('admin','audit.read'),
  ('admin','commandpalette.search'),
  ('compliance_admin','documents.review'),('compliance_admin','documents.escalate'),
  ('compliance_admin','audit.read'),('compliance_admin','commandpalette.search'),
  ('finance_admin','finance.view'),('finance_admin','finance.adjust'),
  ('finance_admin','audit.read'),('finance_admin','commandpalette.search'),
  ('operations_admin','executive.view'),('operations_admin','drivers.view'),
  ('operations_admin','commandpalette.search')
) AS r(role, cap)
JOIN public.capabilities c ON c.key = r.cap
ON CONFLICT DO NOTHING;

INSERT INTO public.event_registry (event_name, event_category, source_service, description) VALUES
  ('trip.requested','trip','dispatch','Rider requested a trip'),
  ('trip.assigned','trip','dispatch','Trip assigned to driver'),
  ('trip.completed','trip','dispatch','Trip completed'),
  ('driver.online','driver','driver-app','Driver came online'),
  ('driver.suspended','driver','admin','Driver suspended'),
  ('finance.settlement','finance','finance','Settlement posted'),
  ('finance.wallet_topup','finance','wallet','Wallet top-up'),
  ('compliance.document_review','compliance','compliance','Document reviewed'),
  ('fraud.signal','fraud','fraud-engine','Fraud signal raised'),
  ('security.login_anomaly','security','identity','Suspicious login'),
  ('sos.triggered','sos','rider-app','Rider triggered SOS'),
  ('system.health','system','platform','System health update')
ON CONFLICT (event_name) DO NOTHING;
