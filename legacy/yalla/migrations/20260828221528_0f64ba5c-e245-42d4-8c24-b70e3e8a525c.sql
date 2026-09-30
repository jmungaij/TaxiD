-- =====================================================================
-- ST CERTIFICATION EXECUTION LAYER
-- Extends the DI-00 control plane (infra_environments, infra_health_*,
-- infra_backups, infra_restores, infra_fixture_sets, infra_operations_log).
-- No second readiness engine, no second evidence vault, no override surface.
-- =====================================================================

DO $$ BEGIN
  CREATE TYPE public.st_result AS ENUM (
    'PASS','FAIL','BLOCKED','NOT_TESTED','DEPENDENCY_NOT_READY',
    'OWNER_ACTION_REQUIRED','PROVIDER_CONFIGURATION_REQUIRED',
    'EXTERNAL_EXECUTION_REQUIRED','LEGAL_APPROVAL_REQUIRED',
    'PRODUCTION_TARGET_REFUSED','EVIDENCE_EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.st_exec_state AS ENUM ('REQUESTED','RUNNING','COMPLETED','FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------
-- 1. CERTIFICATION RUNS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.st_certification_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key text NOT NULL UNIQUE,
  trigger_source text NOT NULL DEFAULT 'MANUAL',
  requested_by uuid,
  actor text NOT NULL DEFAULT 'st-orchestrator',
  state public.st_exec_state NOT NULL DEFAULT 'REQUESTED',
  correlation_id text NOT NULL DEFAULT gen_random_uuid()::text,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.st_certification_runs TO authenticated;
GRANT ALL ON public.st_certification_runs TO service_role;
ALTER TABLE public.st_certification_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS st_runs_staff_read ON public.st_certification_runs;
CREATE POLICY st_runs_staff_read ON public.st_certification_runs
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.infrastructure.read'));

-- ---------------------------------------------------------------
-- 2. CONTROL EXECUTIONS (immutable evidence)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.st_control_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.st_certification_runs(id) ON DELETE SET NULL,
  control_id text NOT NULL,
  environment_key text,
  environment_id uuid REFERENCES public.infra_environments(id) ON DELETE SET NULL,
  environment_fingerprint text,
  schema_version text,
  state public.st_exec_state NOT NULL DEFAULT 'REQUESTED',
  result public.st_result NOT NULL DEFAULT 'NOT_TESTED',
  assertions jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_failure jsonb,
  error_code text,
  error_message text,
  retryable boolean NOT NULL DEFAULT false,
  attempt integer NOT NULL DEFAULT 1,
  idempotency_key text NOT NULL UNIQUE,
  correlation_id text NOT NULL DEFAULT gen_random_uuid()::text,
  request_id text NOT NULL DEFAULT gen_random_uuid()::text,
  actor text NOT NULL DEFAULT 'di00-orchestrator',
  evidence_sha256 text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  expires_at timestamptz,
  invalidated_at timestamptz,
  invalidated_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS st_exec_control_idx ON public.st_control_executions (control_id, started_at DESC);
CREATE INDEX IF NOT EXISTS st_exec_run_idx ON public.st_control_executions (run_id);

GRANT SELECT ON public.st_control_executions TO authenticated;
GRANT ALL ON public.st_control_executions TO service_role;
ALTER TABLE public.st_control_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS st_exec_staff_read ON public.st_control_executions;
CREATE POLICY st_exec_staff_read ON public.st_control_executions
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.infrastructure.read'));

-- Immutable once finished: only invalidation metadata may change.
CREATE OR REPLACE FUNCTION public._st_exec_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.finished_at IS NOT NULL THEN
    IF NEW.result IS DISTINCT FROM OLD.result
       OR NEW.assertions IS DISTINCT FROM OLD.assertions
       OR NEW.evidence IS DISTINCT FROM OLD.evidence
       OR NEW.control_id IS DISTINCT FROM OLD.control_id
       OR NEW.environment_fingerprint IS DISTINCT FROM OLD.environment_fingerprint
       OR NEW.evidence_sha256 IS DISTINCT FROM OLD.evidence_sha256
       OR NEW.finished_at IS DISTINCT FROM OLD.finished_at THEN
      RAISE EXCEPTION 'ST evidence is immutable after completion (control %)', OLD.control_id;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS st_exec_immutable ON public.st_control_executions;
CREATE TRIGGER st_exec_immutable BEFORE UPDATE ON public.st_control_executions
  FOR EACH ROW EXECUTE FUNCTION public._st_exec_immutable();

CREATE OR REPLACE FUNCTION public._st_exec_no_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'ST evidence cannot be deleted'; END; $$;

DROP TRIGGER IF EXISTS st_exec_no_delete ON public.st_control_executions;
CREATE TRIGGER st_exec_no_delete BEFORE DELETE ON public.st_control_executions
  FOR EACH ROW EXECUTE FUNCTION public._st_exec_no_delete();

-- ---------------------------------------------------------------
-- 3. RUN LIFECYCLE (staff-initiated)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.st_run_start(_trigger_source text DEFAULT 'MANUAL', _correlation_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.st_certification_runs;
BEGIN
  IF NOT public.has_staff_permission('staff.infrastructure.certify') THEN
    RETURN public.infra_denied('staff.infrastructure.certify','st_run_start');
  END IF;

  INSERT INTO public.st_certification_runs(run_key, trigger_source, requested_by, state, correlation_id)
  VALUES ('STRUN-' || to_char(now(),'YYYYMMDDHH24MISS') || '-' || substr(gen_random_uuid()::text,1,6),
          coalesce(_trigger_source,'MANUAL'), auth.uid(), 'RUNNING',
          coalesce(_correlation_id, gen_random_uuid()::text))
  RETURNING * INTO v_row;

  PERFORM public.infra_log('ST_RUN_STARTED', NULL, 'APPLIED',
    jsonb_build_object('run_id', v_row.id, 'run_key', v_row.run_key), NULL, v_row.correlation_id, NULL);

  RETURN jsonb_build_object('ok', true, 'run', to_jsonb(v_row));
END; $$;

CREATE OR REPLACE FUNCTION public.st_run_complete(_run_id uuid, _state text, _summary jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.st_certification_runs;
BEGIN
  UPDATE public.st_certification_runs SET
    state = coalesce(_state,'COMPLETED')::public.st_exec_state,
    summary = coalesce(_summary,'{}'::jsonb),
    finished_at = now(),
    duration_ms = greatest(0, (extract(epoch FROM (now() - started_at)) * 1000)::int),
    updated_at = now()
  WHERE id = _run_id RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','RUN_NOT_FOUND'); END IF;

  PERFORM public.infra_log('ST_RUN_COMPLETED', NULL, 'APPLIED',
    jsonb_build_object('run_id', _run_id, 'state', v_row.state), NULL, v_row.correlation_id, NULL);
  RETURN jsonb_build_object('ok', true, 'run', to_jsonb(v_row));
END; $$;

-- ---------------------------------------------------------------
-- 4. EXECUTION WRITE PATH (orchestrator / service_role only)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.st_execution_start(
  _run_id uuid, _control_id text, _environment_key text, _idempotency_key text,
  _correlation_id text DEFAULT NULL, _request_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_env public.infra_environments; v_row public.st_control_executions;
BEGIN
  SELECT * INTO v_env FROM public.infra_environments WHERE environment_key = _environment_key;

  SELECT * INTO v_row FROM public.st_control_executions WHERE idempotency_key = _idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'idempotent_replay', true, 'execution', to_jsonb(v_row));
  END IF;

  INSERT INTO public.st_control_executions(
    run_id, control_id, environment_key, environment_id, environment_fingerprint,
    state, result, idempotency_key, correlation_id, request_id, attempt)
  VALUES (_run_id, _control_id, _environment_key, v_env.id, v_env.environment_fingerprint,
          'RUNNING', 'NOT_TESTED', _idempotency_key,
          coalesce(_correlation_id, gen_random_uuid()::text),
          coalesce(_request_id, gen_random_uuid()::text),
          1 + (SELECT count(*) FROM public.st_control_executions WHERE control_id = _control_id)::int)
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'execution', to_jsonb(v_row));
END; $$;

CREATE OR REPLACE FUNCTION public.st_execution_complete(
  _execution_id uuid, _result text, _assertions jsonb DEFAULT '[]'::jsonb,
  _evidence jsonb DEFAULT '{}'::jsonb, _first_failure jsonb DEFAULT NULL,
  _environment_fingerprint text DEFAULT NULL, _schema_version text DEFAULT NULL,
  _duration_ms integer DEFAULT NULL, _retryable boolean DEFAULT false,
  _error_code text DEFAULT NULL, _error_message text DEFAULT NULL,
  _expires_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.st_control_executions; v_hash text;
BEGIN
  v_hash := encode(digest(coalesce(_evidence,'{}'::jsonb)::text || coalesce(_assertions,'[]'::jsonb)::text, 'sha256'), 'hex');

  UPDATE public.st_control_executions SET
    state = CASE WHEN _result IN ('PASS','FAIL') THEN 'COMPLETED' ELSE 'FAILED' END::public.st_exec_state,
    result = _result::public.st_result,
    assertions = coalesce(_assertions,'[]'::jsonb),
    evidence = coalesce(_evidence,'{}'::jsonb),
    first_failure = _first_failure,
    environment_fingerprint = coalesce(_environment_fingerprint, environment_fingerprint),
    schema_version = coalesce(_schema_version, schema_version),
    duration_ms = _duration_ms,
    retryable = coalesce(_retryable, false),
    error_code = _error_code,
    error_message = _error_message,
    evidence_sha256 = v_hash,
    expires_at = coalesce(_expires_at, now() + interval '90 days'),
    finished_at = now()
  WHERE id = _execution_id AND finished_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code','EXECUTION_NOT_OPEN',
      'message','The execution does not exist or is already sealed.');
  END IF;

  PERFORM public.infra_log('ST_CONTROL_' || v_row.result::text, v_row.environment_key,
    CASE WHEN v_row.result = 'PASS' THEN 'APPLIED' ELSE 'FAILED' END,
    jsonb_build_object('control_id', v_row.control_id, 'execution_id', v_row.id,
                       'evidence_sha256', v_hash),
    _error_code, v_row.correlation_id, v_row.request_id);

  RETURN jsonb_build_object('ok', true, 'execution', to_jsonb(v_row));
END; $$;

-- Environment change / expiry: invalidate affected evidence only.
CREATE OR REPLACE FUNCTION public.st_evidence_invalidate(_reason text, _environment_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  UPDATE public.st_control_executions SET invalidated_at = now(), invalidated_reason = _reason
  WHERE invalidated_at IS NULL AND finished_at IS NOT NULL
    AND (_environment_key IS NULL OR environment_key = _environment_key);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM public.infra_log('ST_EVIDENCE_INVALIDATED', _environment_key, 'APPLIED',
    jsonb_build_object('count', v_count, 'reason', _reason), NULL, NULL, NULL);
  RETURN jsonb_build_object('ok', true, 'invalidated', v_count);
END; $$;

-- ---------------------------------------------------------------
-- 5. AUTHORITATIVE OVERVIEW
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.st_overview()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stg public.infra_environments; v_rst public.infra_environments;
  v_gate jsonb; v_latest jsonb; v_runs jsonb;
BEGIN
  IF NOT public.has_staff_permission('staff.infrastructure.read') THEN
    RETURN public.infra_denied('staff.infrastructure.read','st_overview');
  END IF;

  SELECT * INTO v_stg FROM public.infra_environments WHERE environment_type = 'STAGING' LIMIT 1;
  SELECT * INTO v_rst FROM public.infra_environments WHERE environment_type = 'RESTORE' LIMIT 1;

  v_gate := jsonb_build_object(
    'staging_registered', v_stg.id IS NOT NULL,
    'restore_registered', v_rst.id IS NOT NULL,
    'staging_key', v_stg.environment_key,
    'restore_key', v_rst.environment_key,
    'staging_verification', coalesce(v_stg.verification_status::text,'NOT_CONFIGURED'),
    'restore_verification', coalesce(v_rst.verification_status::text,'NOT_CONFIGURED'),
    'staging_fingerprint', v_stg.environment_fingerprint,
    'restore_fingerprint', v_rst.environment_fingerprint,
    'staging_schema_version', v_stg.schema_version,
    'restore_schema_version', v_rst.schema_version,
    'staging_production_flag', coalesce(v_stg.production_flag,false),
    'restore_production_flag', coalesce(v_rst.production_flag,false),
    'targets_independent', (v_stg.environment_fingerprint IS NOT NULL
                            AND v_rst.environment_fingerprint IS NOT NULL
                            AND v_stg.environment_fingerprint <> v_rst.environment_fingerprint),
    'synthetic_fixtures_loaded', EXISTS (SELECT 1 FROM public.infra_fixture_sets f
        WHERE v_stg.id IS NOT NULL AND f.environment_id = v_stg.id
          AND f.state = 'SUCCEEDED' AND f.production_identifier_scan = 'PASS'),
    'verified_backup', EXISTS (SELECT 1 FROM public.infra_backups b
        WHERE b.state = 'SUCCEEDED' AND b.integrity_result = 'PASS'),
    'verified_restore', EXISTS (SELECT 1 FROM public.infra_restores r
        WHERE r.state = 'SUCCEEDED' AND r.verification_result = 'PASS'),
    'di00_certified', EXISTS (SELECT 1 FROM public.infra_certifications c
        WHERE c.outcome = 'PASS')
  );

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.control_id), '[]'::jsonb) INTO v_latest
  FROM (
    SELECT DISTINCT ON (e.control_id)
           e.id, e.control_id, e.run_id, e.environment_key, e.environment_fingerprint,
           e.schema_version, e.state, e.result, e.assertions, e.evidence, e.first_failure,
           e.error_code, e.error_message, e.retryable, e.attempt, e.correlation_id, e.request_id,
           e.evidence_sha256, e.started_at, e.finished_at, e.duration_ms, e.expires_at,
           e.invalidated_at, e.invalidated_reason,
           (e.expires_at IS NOT NULL AND e.expires_at < now()) AS expired
      FROM public.st_control_executions e
     WHERE e.finished_at IS NOT NULL
     ORDER BY e.control_id, e.finished_at DESC
  ) x;

  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.started_at DESC), '[]'::jsonb) INTO v_runs
  FROM (SELECT * FROM public.st_certification_runs ORDER BY started_at DESC LIMIT 20) r;

  RETURN jsonb_build_object(
    'ok', true,
    'can_certify', public.has_staff_permission('staff.infrastructure.certify'),
    'gate', v_gate,
    'executions', v_latest,
    'runs', v_runs,
    'generated_at', now());
END; $$;

-- ---------------------------------------------------------------
-- 6. EXECUTE GRANTS — deny by default
-- ---------------------------------------------------------------
REVOKE ALL ON FUNCTION public.st_run_start(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.st_run_complete(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.st_execution_start(uuid, text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.st_execution_complete(uuid, text, jsonb, jsonb, jsonb, text, text, integer, boolean, text, text, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.st_evidence_invalidate(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.st_overview() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.st_run_start(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.st_overview() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.st_run_complete(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.st_execution_start(uuid, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.st_execution_complete(uuid, text, jsonb, jsonb, jsonb, text, text, integer, boolean, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.st_evidence_invalidate(text, text) TO service_role;