-- =====================================================================
-- DI-00 : OWNER CREDENTIAL VAULT + AUTOMATIC INDEPENDENCE INVARIANTS
-- =====================================================================

-- 1. Encrypted credential store. The ciphertext is produced in the
--    orchestrator with AES-GCM under DI00_CREDENTIAL_KEY; the database never
--    holds a plaintext DSN and no client role may read this table at all.
CREATE TABLE IF NOT EXISTS public.infra_environment_credentials (
  environment_key text PRIMARY KEY,
  secret_name text NOT NULL,
  dsn_ciphertext text NOT NULL,
  dsn_iv text NOT NULL,
  dsn_sha256 text NOT NULL,
  host_ref text,
  database_ref text,
  key_version integer NOT NULL DEFAULT 1,
  configured_by uuid,
  configured_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT infra_cred_environment_key CHECK (environment_key IN ('logistics-staging','logistics-restore')),
  CONSTRAINT infra_cred_ciphertext_not_plaintext CHECK (dsn_ciphertext !~ '(?i)(postgres(ql)?://|password=)')
);

-- service_role only: no anon, no authenticated. Staff read presence through
-- the status function below, never the row.
GRANT ALL ON public.infra_environment_credentials TO service_role;
ALTER TABLE public.infra_environment_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "infra credentials service only" ON public.infra_environment_credentials
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public._infra_cred_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_infra_cred_touch ON public.infra_environment_credentials;
CREATE TRIGGER trg_infra_cred_touch BEFORE UPDATE ON public.infra_environment_credentials
  FOR EACH ROW EXECUTE FUNCTION public._infra_cred_touch();

-- 2. Independence assertions: the automatic invariant proof that STAGING and
--    RESTORE are two distinct, non-production databases. Append-only.
CREATE TABLE IF NOT EXISTS public.infra_independence_assertions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  result text NOT NULL CHECK (result IN ('PASS','FAIL','BLOCKED','UNKNOWN','NOT_CONFIGURED')),
  staging_identity_sha256 text,
  restore_identity_sha256 text,
  invariants jsonb NOT NULL DEFAULT '[]'::jsonb,
  failed_invariants text[] NOT NULL DEFAULT ARRAY[]::text[],
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid,
  request_id uuid,
  asserted_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.infra_independence_assertions TO authenticated;
GRANT ALL ON public.infra_independence_assertions TO service_role;
ALTER TABLE public.infra_independence_assertions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "infra staff read independence" ON public.infra_independence_assertions
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.infrastructure.read'));

CREATE INDEX IF NOT EXISTS infra_independence_asserted_at
  ON public.infra_independence_assertions (asserted_at DESC);

CREATE OR REPLACE FUNCTION public._infra_independence_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'infra_independence_assertions is append-only';
END $$;

DROP TRIGGER IF EXISTS trg_infra_independence_append_only ON public.infra_independence_assertions;
CREATE TRIGGER trg_infra_independence_append_only
  BEFORE UPDATE OR DELETE ON public.infra_independence_assertions
  FOR EACH ROW EXECUTE FUNCTION public._infra_independence_append_only();

-- 3. Credential presence status for the admin surface. Never returns a DSN.
CREATE OR REPLACE FUNCTION public.di00_credential_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows jsonb;
BEGIN
  IF NOT public.has_staff_permission('staff.infrastructure.read') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORIZATION_DENIED',
      'message', 'Infrastructure read permission is required.');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'environment_key', c.environment_key,
           'secret_name', c.secret_name,
           'dsn_sha256_prefix', left(c.dsn_sha256, 12),
           'host_ref', c.host_ref,
           'database_ref', c.database_ref,
           'key_version', c.key_version,
           'configured_at', c.configured_at,
           'rotated_at', c.rotated_at
         ) ORDER BY c.environment_key), '[]'::jsonb)
    INTO v_rows
    FROM public.infra_environment_credentials c;

  RETURN jsonb_build_object(
    'ok', true,
    'credentials', v_rows,
    'independence', (
      SELECT coalesce(to_jsonb(a), 'null'::jsonb)
        FROM public.infra_independence_assertions a
       ORDER BY a.asserted_at DESC LIMIT 1
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.di00_credential_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.di00_credential_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.di00_credential_status() TO service_role;