-- =====================================================================
-- DI-00 INFRASTRUCTURE CONTROL PLANE
-- Extends the existing readiness architecture (logistics_infra_targets,
-- logistics_readiness_evidence, has_staff_permission, staff_permissions).
-- No second readiness engine, no second audit system, no credentials stored.
-- =====================================================================

DO $$ BEGIN
  CREATE TYPE public.infra_environment_type AS ENUM ('DEVELOPMENT','TEST','STAGING','RESTORE','PRODUCTION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.infra_check_result AS ENUM ('PASS','FAIL','BLOCKED','UNKNOWN','NOT_CONFIGURED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.infra_di00_state AS ENUM (
    'DESIGN','CONFIGURATION_REQUIRED','CONFIGURED','PROVISIONING','PROVISIONED','CONNECTED',
    'IDENTITY_VERIFIED','SCHEMA_READY','SECURITY_READY','BACKUP_READY','RESTORE_READY',
    'CERTIFICATION_READY','CERTIFICATION_IN_PROGRESS','CERTIFIED','CLEARED',
    'CONFIGURATION_FAILED','PROVISIONING_FAILED','CONNECTION_FAILED','IDENTITY_FAILED',
    'SCHEMA_FAILED','SECURITY_FAILED','BACKUP_FAILED','RESTORE_FAILED','CERTIFICATION_FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.infra_job_state AS ENUM ('REQUESTED','RUNNING','SUCCEEDED','FAILED','BLOCKED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------
-- 1. ENVIRONMENT REGISTRY
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.infra_environments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_key text NOT NULL UNIQUE,
  environment_name text NOT NULL,
  environment_type public.infra_environment_type NOT NULL,
  database_engine text NOT NULL DEFAULT 'postgresql',
  database_version text,
  provider text,
  provider_project_ref text,
  host_ref text,
  region text,
  deployment_reference text,
  database_reference text,
  credential_secret_name text,
  schema_version text,
  migration_version text,
  environment_fingerprint text,
  production_flag boolean NOT NULL DEFAULT false,
  synthetic_data_flag boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'REGISTERED',
  di00_state public.infra_di00_state NOT NULL DEFAULT 'CONFIGURATION_REQUIRED',
  di00_state_reason text,
  verification_status public.infra_check_result NOT NULL DEFAULT 'NOT_CONFIGURED',
  last_verified_at timestamptz,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT infra_env_no_production_certification CHECK (
    NOT (production_flag AND environment_type IN ('STAGING','RESTORE'))),
  CONSTRAINT infra_env_credential_is_a_name CHECK (
    credential_secret_name IS NULL OR credential_secret_name !~ '(?i)(postgres(ql)?://|password=)')
);

GRANT SELECT ON public.infra_environments TO authenticated;
GRANT ALL ON public.infra_environments TO service_role;
ALTER TABLE public.infra_environments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "infra staff read environments" ON public.infra_environments
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.infrastructure.read'));

CREATE UNIQUE INDEX IF NOT EXISTS infra_env_single_staging
  ON public.infra_environments (environment_type) WHERE environment_type IN ('STAGING','RESTORE');

-- ---------------------------------------------------------------
-- 2. HEALTH RUNS + CHECKS (append-only)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.infra_health_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id uuid NOT NULL REFERENCES public.infra_environments(id) ON DELETE CASCADE,
  correlation_id text NOT NULL DEFAULT gen_random_uuid()::text,
  request_id text NOT NULL DEFAULT gen_random_uuid()::text,
  actor_id uuid,
  system_actor text,
  state public.infra_job_state NOT NULL DEFAULT 'REQUESTED',
  overall_result public.infra_check_result NOT NULL DEFAULT 'UNKNOWN',
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  error_code text,
  error_message text,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.infra_health_runs TO authenticated;
GRANT ALL ON public.infra_health_runs TO service_role;
ALTER TABLE public.infra_health_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "infra staff read health runs" ON public.infra_health_runs
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.infrastructure.read'));

CREATE TABLE IF NOT EXISTS public.infra_health_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.infra_health_runs(id) ON DELETE CASCADE,
  environment_id uuid NOT NULL REFERENCES public.infra_environments(id) ON DELETE CASCADE,
  check_key text NOT NULL,
  result public.infra_check_result NOT NULL,
  observed text,
  expected text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS infra_health_checks_run ON public.infra_health_checks(run_id);
CREATE INDEX IF NOT EXISTS infra_health_checks_env ON public.infra_health_checks(environment_id, check_key, created_at DESC);
GRANT SELECT ON public.infra_health_checks TO authenticated;
GRANT ALL ON public.infra_health_checks TO service_role;
ALTER TABLE public.infra_health_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "infra staff read health checks" ON public.infra_health_checks
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.infrastructure.read'));

-- ---------------------------------------------------------------
-- 3. BACKUPS / RESTORES
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.infra_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_reference text NOT NULL UNIQUE DEFAULT ('BKP-' || to_char(now(),'YYYYMMDD') || '-' || substr(gen_random_uuid()::text,1,8)),
  source_environment_id uuid NOT NULL REFERENCES public.infra_environments(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  correlation_id text NOT NULL DEFAULT gen_random_uuid()::text,
  request_id text NOT NULL DEFAULT gen_random_uuid()::text,
  requested_by uuid,
  state public.infra_job_state NOT NULL DEFAULT 'REQUESTED',
  backup_type text NOT NULL DEFAULT 'LOGICAL_SYNTHETIC',
  database_identity text,
  schema_version text,
  object_count integer,
  row_count integer,
  size_bytes bigint,
  checksum_sha256 text,
  storage_path text,
  provider_reference text,
  integrity_result public.infra_check_result NOT NULL DEFAULT 'UNKNOWN',
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_ms integer,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_environment_id, idempotency_key)
);
GRANT SELECT ON public.infra_backups TO authenticated;
GRANT ALL ON public.infra_backups TO service_role;
ALTER TABLE public.infra_backups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "infra staff read backups" ON public.infra_backups
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.infrastructure.read'));

CREATE TABLE IF NOT EXISTS public.infra_restores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restore_reference text NOT NULL UNIQUE DEFAULT ('RST-' || to_char(now(),'YYYYMMDD') || '-' || substr(gen_random_uuid()::text,1,8)),
  backup_id uuid NOT NULL REFERENCES public.infra_backups(id) ON DELETE RESTRICT,
  target_environment_id uuid NOT NULL REFERENCES public.infra_environments(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  correlation_id text NOT NULL DEFAULT gen_random_uuid()::text,
  request_id text NOT NULL DEFAULT gen_random_uuid()::text,
  requested_by uuid,
  state public.infra_job_state NOT NULL DEFAULT 'REQUESTED',
  target_identity text,
  restored_object_count integer,
  restored_row_count integer,
  verification_result public.infra_check_result NOT NULL DEFAULT 'UNKNOWN',
  verification_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_environment_id, idempotency_key)
);
GRANT SELECT ON public.infra_restores TO authenticated;
GRANT ALL ON public.infra_restores TO service_role;
ALTER TABLE public.infra_restores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "infra staff read restores" ON public.infra_restores
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.infrastructure.read'));

-- ---------------------------------------------------------------
-- 4. EXTERNAL INFRASTRUCTURE ACTION QUEUE
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.infra_provider_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_key text NOT NULL UNIQUE,
  environment_key text,
  category text NOT NULL,
  provider text,
  resource text NOT NULL,
  required_action text NOT NULL,
  required_permission text,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  required_output text NOT NULL,
  register_where text NOT NULL,
  owner_role text NOT NULL DEFAULT 'platform_owner',
  expected_evidence text NOT NULL,
  dependent_controls text[] NOT NULL DEFAULT '{}',
  state public.infra_job_state NOT NULL DEFAULT 'REQUESTED',
  submitted_result jsonb,
  validation_result public.infra_check_result NOT NULL DEFAULT 'UNKNOWN',
  validation_detail text,
  resolved_at timestamptz,
  resolved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.infra_provider_actions TO authenticated;
GRANT ALL ON public.infra_provider_actions TO service_role;
ALTER TABLE public.infra_provider_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "infra staff read actions" ON public.infra_provider_actions
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.infrastructure.read'));

-- ---------------------------------------------------------------
-- 5. SYNTHETIC FIXTURE SETS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.infra_fixture_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment_id uuid NOT NULL REFERENCES public.infra_environments(id) ON DELETE CASCADE,
  fixture_set_key text NOT NULL,
  scenario text NOT NULL,
  synthetic boolean NOT NULL DEFAULT true,
  deterministic_seed text NOT NULL,
  entity_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  production_identifier_scan public.infra_check_result NOT NULL DEFAULT 'UNKNOWN',
  loaded_at timestamptz,
  state public.infra_job_state NOT NULL DEFAULT 'REQUESTED',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment_id, fixture_set_key),
  CONSTRAINT infra_fixtures_are_synthetic CHECK (synthetic)
);
GRANT SELECT ON public.infra_fixture_sets TO authenticated;
GRANT ALL ON public.infra_fixture_sets TO service_role;
ALTER TABLE public.infra_fixture_sets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "infra staff read fixtures" ON public.infra_fixture_sets
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.infrastructure.read'));

-- ---------------------------------------------------------------
-- 6. CERTIFICATIONS (immutable)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.infra_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_reference text NOT NULL UNIQUE DEFAULT ('DI00-' || to_char(now(),'YYYYMMDD') || '-' || substr(gen_random_uuid()::text,1,8)),
  control_id text NOT NULL DEFAULT 'DI-00',
  outcome public.infra_check_result NOT NULL,
  di00_state public.infra_di00_state NOT NULL,
  staging_environment_id uuid REFERENCES public.infra_environments(id),
  restore_environment_id uuid REFERENCES public.infra_environments(id),
  backup_id uuid REFERENCES public.infra_backups(id),
  restore_id uuid REFERENCES public.infra_restores(id),
  criteria jsonb NOT NULL,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  correlation_id text NOT NULL DEFAULT gen_random_uuid()::text,
  request_id text NOT NULL DEFAULT gen_random_uuid()::text,
  executed_by uuid,
  executed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.infra_certifications TO authenticated;
GRANT ALL ON public.infra_certifications TO service_role;
ALTER TABLE public.infra_certifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "infra staff read certifications" ON public.infra_certifications
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.infrastructure.read'));

CREATE OR REPLACE FUNCTION public._infra_certifications_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'DI-00 certification records are immutable'; END; $$;
DROP TRIGGER IF EXISTS infra_certifications_immutable ON public.infra_certifications;
CREATE TRIGGER infra_certifications_immutable BEFORE UPDATE OR DELETE ON public.infra_certifications
  FOR EACH ROW EXECUTE FUNCTION public._infra_certifications_immutable();

-- ---------------------------------------------------------------
-- 7. OPERATIONS LOG (append-only observability)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.infra_operations_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation text NOT NULL,
  environment_key text,
  actor_id uuid,
  system_actor text,
  correlation_id text NOT NULL DEFAULT gen_random_uuid()::text,
  request_id text NOT NULL DEFAULT gen_random_uuid()::text,
  status text NOT NULL,
  error_code text,
  duration_ms integer,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS infra_ops_log_recent ON public.infra_operations_log(created_at DESC);
GRANT SELECT ON public.infra_operations_log TO authenticated;
GRANT ALL ON public.infra_operations_log TO service_role;
ALTER TABLE public.infra_operations_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "infra staff read ops log" ON public.infra_operations_log
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.infrastructure.read'));

CREATE OR REPLACE FUNCTION public._infra_ops_log_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'infra_operations_log is append-only'; END; $$;
DROP TRIGGER IF EXISTS infra_ops_log_append_only ON public.infra_operations_log;
CREATE TRIGGER infra_ops_log_append_only BEFORE UPDATE OR DELETE ON public.infra_operations_log
  FOR EACH ROW EXECUTE FUNCTION public._infra_ops_log_append_only();

-- ---------------------------------------------------------------
-- 8. PERMISSIONS
-- ---------------------------------------------------------------
INSERT INTO public.staff_permissions (key, domain, action, description) VALUES
  ('staff.infrastructure.read','infrastructure','read','View DI-00 environments, health, backups, restores and certifications'),
  ('staff.infrastructure.configure','infrastructure','configure','Register and configure non-production environment references'),
  ('staff.infrastructure.provision','infrastructure','provision','Request provisioning and schema deployment on non-production environments'),
  ('staff.infrastructure.backup','infrastructure','backup','Execute staging backups'),
  ('staff.infrastructure.restore','infrastructure','restore','Execute restores into the isolated restore target'),
  ('staff.infrastructure.certify','infrastructure','certify','Execute DI-00 certification')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.staff_role_permissions (role, permission_key)
SELECT 'admin'::public.app_role, p.key
FROM (VALUES
  ('staff.infrastructure.read'),('staff.infrastructure.configure'),('staff.infrastructure.provision'),
  ('staff.infrastructure.backup'),('staff.infrastructure.restore'),('staff.infrastructure.certify')) p(key)
ON CONFLICT DO NOTHING;

INSERT INTO public.staff_role_permissions (role, permission_key)
VALUES ('operations_admin'::public.app_role,'staff.infrastructure.read'),
       ('director'::public.app_role,'staff.infrastructure.read')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------
-- 9. TOUCH TRIGGERS
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._infra_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS infra_env_touch ON public.infra_environments;
CREATE TRIGGER infra_env_touch BEFORE UPDATE ON public.infra_environments
  FOR EACH ROW EXECUTE FUNCTION public._infra_touch();
DROP TRIGGER IF EXISTS infra_actions_touch ON public.infra_provider_actions;
CREATE TRIGGER infra_actions_touch BEFORE UPDATE ON public.infra_provider_actions
  FOR EACH ROW EXECUTE FUNCTION public._infra_touch();
