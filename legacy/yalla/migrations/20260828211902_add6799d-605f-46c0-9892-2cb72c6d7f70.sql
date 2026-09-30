-- =====================================================================
-- DI-00 OPERATING FUNCTIONS
-- =====================================================================

CREATE OR REPLACE FUNCTION public.infra_denied(_perm text, _fn text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT jsonb_build_object('ok', false, 'code','AUTHORIZATION_DENIED','category','authorization',
    'retryable', false, 'message','You do not hold the permission required for this infrastructure operation.',
    'reason', _perm, 'operation', _fn);
$$;

CREATE OR REPLACE FUNCTION public.infra_log(_op text, _env text, _status text, _detail jsonb DEFAULT '{}'::jsonb,
                                            _error text DEFAULT NULL, _corr text DEFAULT NULL, _req text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_corr text := coalesce(_corr, gen_random_uuid()::text);
BEGIN
  INSERT INTO public.infra_operations_log(operation, environment_key, actor_id, system_actor, correlation_id,
                                          request_id, status, error_code, detail)
  VALUES (_op, _env, auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system' END, v_corr,
          coalesce(_req, gen_random_uuid()::text), _status, _error, _detail);
  RETURN v_corr;
END; $$;

-- ---------------------------------------------------------------
-- OVERVIEW
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.di00_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_staff_permission('staff.infrastructure.read') THEN
    RETURN public.infra_denied('staff.infrastructure.read','di00_overview');
  END IF;
  RETURN jsonb_build_object(
    'ok', true, 'measured_at', now(),
    'can_configure', public.has_staff_permission('staff.infrastructure.configure'),
    'can_provision', public.has_staff_permission('staff.infrastructure.provision'),
    'can_backup',    public.has_staff_permission('staff.infrastructure.backup'),
    'can_restore',   public.has_staff_permission('staff.infrastructure.restore'),
    'can_certify',   public.has_staff_permission('staff.infrastructure.certify'),
    'environments', (SELECT coalesce(jsonb_agg(to_jsonb(e) - 'created_by' - 'updated_by' ORDER BY e.environment_type), '[]'::jsonb)
                       FROM public.infra_environments e),
    'health', (SELECT coalesce(jsonb_agg(h), '[]'::jsonb) FROM (
        SELECT r.id, r.environment_id, r.state, r.overall_result, r.correlation_id, r.request_id,
               r.started_at, r.finished_at, r.duration_ms, r.error_code, r.error_message,
               (SELECT coalesce(jsonb_agg(jsonb_build_object('check_key', c.check_key, 'result', c.result,
                        'observed', c.observed, 'expected', c.expected, 'detail', c.detail) ORDER BY c.check_key), '[]'::jsonb)
                  FROM public.infra_health_checks c WHERE c.run_id = r.id) AS checks
          FROM public.infra_health_runs r
         WHERE r.id IN (SELECT DISTINCT ON (environment_id) id FROM public.infra_health_runs
                         ORDER BY environment_id, started_at DESC)) h),
    'backups', (SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.started_at DESC), '[]'::jsonb)
                  FROM (SELECT * FROM public.infra_backups ORDER BY started_at DESC LIMIT 20) b),
    'restores', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.started_at DESC), '[]'::jsonb)
                  FROM (SELECT * FROM public.infra_restores ORDER BY started_at DESC LIMIT 20) x),
    'fixtures', (SELECT coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) FROM public.infra_fixture_sets f),
    'actions', (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.created_at), '[]'::jsonb)
                  FROM public.infra_provider_actions a),
    'certifications', (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.executed_at DESC), '[]'::jsonb)
                  FROM (SELECT * FROM public.infra_certifications ORDER BY executed_at DESC LIMIT 10) c),
    'operations', (SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.created_at DESC), '[]'::jsonb)
                  FROM (SELECT * FROM public.infra_operations_log ORDER BY created_at DESC LIMIT 40) o),
    'readiness_targets', (SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) FROM public.logistics_infra_targets t));
END; $$;

-- ---------------------------------------------------------------
-- CONFIGURE ENVIRONMENT
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.di00_environment_upsert(
  _environment_key text, _environment_name text, _environment_type text,
  _provider text DEFAULT NULL, _provider_project_ref text DEFAULT NULL, _host_ref text DEFAULT NULL,
  _region text DEFAULT NULL, _deployment_reference text DEFAULT NULL, _database_reference text DEFAULT NULL,
  _credential_secret_name text DEFAULT NULL, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_type public.infra_environment_type; v_state public.infra_di00_state;
BEGIN
  IF NOT public.has_staff_permission('staff.infrastructure.configure') THEN
    RETURN public.infra_denied('staff.infrastructure.configure','di00_environment_upsert');
  END IF;
  IF upper(coalesce(_environment_type,'')) NOT IN ('STAGING','RESTORE') THEN
    RETURN jsonb_build_object('ok', false, 'code','INVALID_ENVIRONMENT_TYPE','retryable', false,
      'message','DI-00 may only register STAGING and RESTORE environments.', 'reason', _environment_type);
  END IF;
  IF _credential_secret_name IS NOT NULL AND _credential_secret_name ~ '(?i)(postgres(ql)?://|password=)' THEN
    RETURN jsonb_build_object('ok', false, 'code','CREDENTIAL_IN_CLEARTEXT','retryable', false,
      'message','Supply the NAME of the server-side secret, never the connection string itself.');
  END IF;
  v_type := upper(_environment_type)::public.infra_environment_type;
  v_state := CASE WHEN _credential_secret_name IS NULL THEN 'CONFIGURATION_REQUIRED'::public.infra_di00_state
                  ELSE 'CONFIGURED'::public.infra_di00_state END;

  INSERT INTO public.infra_environments AS e (environment_key, environment_name, environment_type, provider,
      provider_project_ref, host_ref, region, deployment_reference, database_reference, credential_secret_name,
      notes, status, di00_state, created_by, updated_by)
  VALUES (_environment_key, _environment_name, v_type, _provider, _provider_project_ref, _host_ref, _region,
      _deployment_reference, _database_reference, _credential_secret_name, _notes, 'REGISTERED', v_state,
      auth.uid(), auth.uid())
  ON CONFLICT (environment_key) DO UPDATE SET
      environment_name = EXCLUDED.environment_name,
      environment_type = EXCLUDED.environment_type,
      provider = EXCLUDED.provider,
      provider_project_ref = EXCLUDED.provider_project_ref,
      host_ref = EXCLUDED.host_ref,
      region = EXCLUDED.region,
      deployment_reference = EXCLUDED.deployment_reference,
      database_reference = EXCLUDED.database_reference,
      credential_secret_name = EXCLUDED.credential_secret_name,
      notes = EXCLUDED.notes,
      updated_by = auth.uid(),
      -- reconfiguration invalidates any previous verification
      di00_state = CASE WHEN e.credential_secret_name IS DISTINCT FROM EXCLUDED.credential_secret_name
                          OR e.database_reference IS DISTINCT FROM EXCLUDED.database_reference
                        THEN EXCLUDED.di00_state ELSE e.di00_state END,
      verification_status = CASE WHEN e.credential_secret_name IS DISTINCT FROM EXCLUDED.credential_secret_name
                                   OR e.database_reference IS DISTINCT FROM EXCLUDED.database_reference
                                 THEN 'UNKNOWN'::public.infra_check_result ELSE e.verification_status END
  RETURNING e.id INTO v_id;

  PERFORM public.infra_log('ENVIRONMENT_CONFIGURED', _environment_key, 'APPLIED',
    jsonb_build_object('type', v_type, 'credential_secret_name', _credential_secret_name));
  RETURN jsonb_build_object('ok', true, 'environment_id', v_id, 'di00_state', v_state);
END; $$;

-- ---------------------------------------------------------------
-- ORCHESTRATOR WRITE PATH (service_role only)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.di00_record_health(
  _environment_key text, _checks jsonb, _facts jsonb DEFAULT '{}'::jsonb,
  _correlation_id text DEFAULT NULL, _request_id text DEFAULT NULL,
  _error_code text DEFAULT NULL, _error_message text DEFAULT NULL, _duration_ms integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_env public.infra_environments; v_run uuid; v_overall public.infra_check_result; v_state public.infra_di00_state;
BEGIN
  SELECT * INTO v_env FROM public.infra_environments WHERE environment_key = _environment_key;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code','ENVIRONMENT_NOT_REGISTERED','message','Unknown environment.');
  END IF;

  INSERT INTO public.infra_health_runs(environment_id, correlation_id, request_id, system_actor, state,
                                       finished_at, duration_ms, error_code, error_message, summary)
  VALUES (v_env.id, coalesce(_correlation_id, gen_random_uuid()::text), coalesce(_request_id, gen_random_uuid()::text),
          'di00-orchestrator', CASE WHEN _error_code IS NULL THEN 'SUCCEEDED' ELSE 'FAILED' END::public.infra_job_state,
          now(), _duration_ms, _error_code, _error_message, coalesce(_facts,'{}'::jsonb))
  RETURNING id INTO v_run;

  INSERT INTO public.infra_health_checks(run_id, environment_id, check_key, result, observed, expected, detail)
  SELECT v_run, v_env.id, c->>'check_key', (c->>'result')::public.infra_check_result,
         c->>'observed', c->>'expected', coalesce(c->'detail','{}'::jsonb)
    FROM jsonb_array_elements(coalesce(_checks,'[]'::jsonb)) c;

  SELECT CASE
           WHEN count(*) FILTER (WHERE result = 'FAIL') > 0 THEN 'FAIL'
           WHEN count(*) FILTER (WHERE result = 'NOT_CONFIGURED') > 0 THEN 'NOT_CONFIGURED'
           WHEN count(*) FILTER (WHERE result = 'BLOCKED') > 0 THEN 'BLOCKED'
           WHEN count(*) FILTER (WHERE result = 'UNKNOWN') > 0 THEN 'UNKNOWN'
           WHEN count(*) = 0 THEN 'UNKNOWN'
           ELSE 'PASS' END::public.infra_check_result
    INTO v_overall FROM public.infra_health_checks WHERE run_id = v_run;

  UPDATE public.infra_health_runs SET overall_result = v_overall WHERE id = v_run;

  -- Authoritative facts observed on the real database. Never invented here.
  v_state := CASE
    WHEN _error_code IS NOT NULL THEN 'CONNECTION_FAILED'
    WHEN v_overall = 'FAIL' THEN 'IDENTITY_FAILED'
    WHEN v_overall = 'PASS' THEN 'SCHEMA_READY'
    WHEN EXISTS (SELECT 1 FROM public.infra_health_checks WHERE run_id = v_run
                   AND check_key = 'ENVIRONMENT_IDENTITY' AND result = 'PASS') THEN 'IDENTITY_VERIFIED'
    WHEN EXISTS (SELECT 1 FROM public.infra_health_checks WHERE run_id = v_run
                   AND check_key = 'DATABASE_REACHABLE' AND result = 'PASS') THEN 'CONNECTED'
    ELSE v_env.di00_state END::public.infra_di00_state;

  UPDATE public.infra_environments SET
    database_version       = coalesce(_facts->>'database_version', database_version),
    schema_version         = coalesce(_facts->>'schema_version', schema_version),
    migration_version      = coalesce(_facts->>'migration_version', migration_version),
    environment_fingerprint= coalesce(_facts->>'environment_fingerprint', environment_fingerprint),
    production_flag        = coalesce((_facts->>'production_flag')::boolean, production_flag),
    synthetic_data_flag    = coalesce((_facts->>'synthetic_data_flag')::boolean, synthetic_data_flag),
    verification_status    = v_overall,
    last_verified_at       = now(),
    di00_state             = v_state,
    di00_state_reason      = coalesce(_error_message, 'Derived from health run ' || v_run::text)
  WHERE id = v_env.id;

  PERFORM public.infra_log('HEALTH_RUN', _environment_key,
    CASE WHEN _error_code IS NULL THEN 'APPLIED' ELSE 'FAILED' END,
    jsonb_build_object('run_id', v_run, 'overall', v_overall), _error_code, _correlation_id, _request_id);

  RETURN jsonb_build_object('ok', true, 'run_id', v_run, 'overall_result', v_overall, 'di00_state', v_state);
END; $$;

-- ---------------------------------------------------------------
-- BACKUP
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.di00_backup_request(_environment_key text, _idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_env public.infra_environments; v_row public.infra_backups;
BEGIN
  IF NOT public.has_staff_permission('staff.infrastructure.backup') THEN
    RETURN public.infra_denied('staff.infrastructure.backup','di00_backup_request');
  END IF;
  SELECT * INTO v_env FROM public.infra_environments WHERE environment_key = _environment_key;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','ENVIRONMENT_NOT_REGISTERED',
    'message','Register the staging environment before requesting a backup.'); END IF;
  IF v_env.environment_type <> 'STAGING' THEN RETURN jsonb_build_object('ok', false, 'code','INVALID_BACKUP_SOURCE',
    'message','DI-00 backups are taken from the isolated staging environment only.'); END IF;
  IF v_env.production_flag THEN RETURN jsonb_build_object('ok', false, 'code','PRODUCTION_TARGET_REFUSED',
    'message','The registered source reports a production identity. Backup refused.'); END IF;
  IF v_env.verification_status <> 'PASS' THEN RETURN jsonb_build_object('ok', false, 'code','ENVIRONMENT_IDENTITY_UNVERIFIED',
    'message','Run a successful health and identity verification before backing up.'); END IF;

  SELECT * INTO v_row FROM public.infra_backups
   WHERE source_environment_id = v_env.id AND idempotency_key = _idempotency_key;
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'idempotent_replay', true, 'backup', to_jsonb(v_row)); END IF;

  INSERT INTO public.infra_backups(source_environment_id, idempotency_key, requested_by, database_identity, schema_version)
  VALUES (v_env.id, _idempotency_key, auth.uid(), v_env.environment_fingerprint, v_env.schema_version)
  RETURNING * INTO v_row;
  PERFORM public.infra_log('BACKUP_REQUESTED', _environment_key, 'APPLIED', jsonb_build_object('backup_id', v_row.id));
  RETURN jsonb_build_object('ok', true, 'backup', to_jsonb(v_row));
END; $$;

CREATE OR REPLACE FUNCTION public.di00_backup_complete(
  _backup_id uuid, _state text, _object_count integer DEFAULT NULL, _row_count integer DEFAULT NULL,
  _size_bytes bigint DEFAULT NULL, _checksum text DEFAULT NULL, _storage_path text DEFAULT NULL,
  _integrity text DEFAULT 'UNKNOWN', _error_code text DEFAULT NULL, _error_message text DEFAULT NULL,
  _detail jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.infra_backups;
BEGIN
  UPDATE public.infra_backups SET
    state = _state::public.infra_job_state, object_count = _object_count, row_count = _row_count,
    size_bytes = _size_bytes, checksum_sha256 = _checksum, storage_path = _storage_path,
    integrity_result = _integrity::public.infra_check_result, error_code = _error_code,
    error_message = _error_message, detail = coalesce(_detail,'{}'::jsonb), completed_at = now(),
    duration_ms = (extract(epoch FROM (now() - started_at)) * 1000)::int
  WHERE id = _backup_id RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','BACKUP_NOT_FOUND'); END IF;

  IF v_row.state = 'SUCCEEDED' AND v_row.integrity_result = 'PASS' THEN
    UPDATE public.infra_environments SET di00_state = 'BACKUP_READY' WHERE id = v_row.source_environment_id;
  ELSIF v_row.state = 'FAILED' THEN
    UPDATE public.infra_environments SET di00_state = 'BACKUP_FAILED' WHERE id = v_row.source_environment_id;
  END IF;
  PERFORM public.infra_log('BACKUP_COMPLETED', NULL, _state, jsonb_build_object('backup_id', _backup_id), _error_code);
  RETURN jsonb_build_object('ok', true, 'backup', to_jsonb(v_row));
END; $$;

-- ---------------------------------------------------------------
-- RESTORE
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.di00_restore_request(_backup_reference text, _target_environment_key text, _idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_backup public.infra_backups; v_target public.infra_environments; v_source public.infra_environments; v_row public.infra_restores;
BEGIN
  IF NOT public.has_staff_permission('staff.infrastructure.restore') THEN
    RETURN public.infra_denied('staff.infrastructure.restore','di00_restore_request');
  END IF;
  SELECT * INTO v_backup FROM public.infra_backups WHERE backup_reference = _backup_reference;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','BACKUP_NOT_FOUND','message','Unknown backup reference.'); END IF;
  IF v_backup.state <> 'SUCCEEDED' OR v_backup.integrity_result <> 'PASS' THEN
    RETURN jsonb_build_object('ok', false, 'code','BACKUP_NOT_VERIFIED',
      'message','Only a completed, integrity-verified backup may be restored.'); END IF;

  SELECT * INTO v_target FROM public.infra_environments WHERE environment_key = _target_environment_key;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','RESTORE_DATABASE_NOT_CONFIGURED',
    'message','Register the restore target before requesting a restore.'); END IF;
  IF v_target.environment_type <> 'RESTORE' THEN RETURN jsonb_build_object('ok', false, 'code','INVALID_RESTORE_TARGET',
    'message','The DI-00 restore path targets the dedicated RESTORE environment only.'); END IF;
  IF v_target.production_flag THEN RETURN jsonb_build_object('ok', false, 'code','PRODUCTION_TARGET_REFUSED',
    'message','The registered restore target reports a production identity. Restore refused.'); END IF;
  IF v_target.verification_status <> 'PASS' THEN RETURN jsonb_build_object('ok', false, 'code','ENVIRONMENT_IDENTITY_UNVERIFIED',
    'message','Verify the restore target identity before restoring into it.'); END IF;

  SELECT * INTO v_source FROM public.infra_environments WHERE id = v_backup.source_environment_id;
  IF v_source.id = v_target.id OR (v_source.environment_fingerprint IS NOT NULL
      AND v_source.environment_fingerprint = v_target.environment_fingerprint) THEN
    RETURN jsonb_build_object('ok', false, 'code','RESTORE_TARGET_NOT_INDEPENDENT',
      'message','The restore target shares its database identity with staging. Restore refused.'); END IF;

  SELECT * INTO v_row FROM public.infra_restores
   WHERE target_environment_id = v_target.id AND idempotency_key = _idempotency_key;
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'idempotent_replay', true, 'restore', to_jsonb(v_row)); END IF;

  INSERT INTO public.infra_restores(backup_id, target_environment_id, idempotency_key, requested_by, target_identity)
  VALUES (v_backup.id, v_target.id, _idempotency_key, auth.uid(), v_target.environment_fingerprint)
  RETURNING * INTO v_row;
  PERFORM public.infra_log('RESTORE_REQUESTED', _target_environment_key, 'APPLIED', jsonb_build_object('restore_id', v_row.id));
  RETURN jsonb_build_object('ok', true, 'restore', to_jsonb(v_row));
END; $$;

CREATE OR REPLACE FUNCTION public.di00_restore_complete(
  _restore_id uuid, _state text, _object_count integer DEFAULT NULL, _row_count integer DEFAULT NULL,
  _verification text DEFAULT 'UNKNOWN', _verification_detail jsonb DEFAULT '{}'::jsonb,
  _error_code text DEFAULT NULL, _error_message text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.infra_restores;
BEGIN
  UPDATE public.infra_restores SET
    state = _state::public.infra_job_state, restored_object_count = _object_count, restored_row_count = _row_count,
    verification_result = _verification::public.infra_check_result,
    verification_detail = coalesce(_verification_detail,'{}'::jsonb),
    error_code = _error_code, error_message = _error_message, completed_at = now(),
    duration_ms = (extract(epoch FROM (now() - started_at)) * 1000)::int
  WHERE id = _restore_id RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','RESTORE_NOT_FOUND'); END IF;

  IF v_row.state = 'SUCCEEDED' AND v_row.verification_result = 'PASS' THEN
    UPDATE public.infra_environments SET di00_state = 'RESTORE_READY' WHERE id = v_row.target_environment_id;
  ELSIF v_row.state = 'FAILED' THEN
    UPDATE public.infra_environments SET di00_state = 'RESTORE_FAILED' WHERE id = v_row.target_environment_id;
  END IF;
  PERFORM public.infra_log('RESTORE_COMPLETED', NULL, _state, jsonb_build_object('restore_id', _restore_id), _error_code);
  RETURN jsonb_build_object('ok', true, 'restore', to_jsonb(v_row));
END; $$;

-- ---------------------------------------------------------------
-- SYNTHETIC FIXTURES
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.di00_fixture_request(_environment_key text, _scenario text, _seed text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_env public.infra_environments; v_row public.infra_fixture_sets; v_key text;
BEGIN
  IF NOT public.has_staff_permission('staff.infrastructure.provision') THEN
    RETURN public.infra_denied('staff.infrastructure.provision','di00_fixture_request');
  END IF;
  SELECT * INTO v_env FROM public.infra_environments WHERE environment_key = _environment_key;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','ENVIRONMENT_NOT_REGISTERED'); END IF;
  IF v_env.production_flag THEN RETURN jsonb_build_object('ok', false, 'code','PRODUCTION_TARGET_REFUSED'); END IF;
  v_key := _scenario || ':' || _seed;
  SELECT * INTO v_row FROM public.infra_fixture_sets WHERE environment_id = v_env.id AND fixture_set_key = v_key;
  IF FOUND THEN RETURN jsonb_build_object('ok', true, 'idempotent_replay', true, 'fixture_set', to_jsonb(v_row)); END IF;
  INSERT INTO public.infra_fixture_sets(environment_id, fixture_set_key, scenario, deterministic_seed)
  VALUES (v_env.id, v_key, _scenario, _seed) RETURNING * INTO v_row;
  PERFORM public.infra_log('FIXTURES_REQUESTED', _environment_key, 'APPLIED', jsonb_build_object('scenario', _scenario));
  RETURN jsonb_build_object('ok', true, 'fixture_set', to_jsonb(v_row));
END; $$;

CREATE OR REPLACE FUNCTION public.di00_fixture_complete(
  _fixture_id uuid, _state text, _entity_counts jsonb DEFAULT '{}'::jsonb,
  _production_scan text DEFAULT 'UNKNOWN', _error_message text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.infra_fixture_sets;
BEGIN
  UPDATE public.infra_fixture_sets SET state = _state::public.infra_job_state,
    entity_counts = coalesce(_entity_counts,'{}'::jsonb),
    production_identifier_scan = _production_scan::public.infra_check_result,
    loaded_at = CASE WHEN _state = 'SUCCEEDED' THEN now() ELSE loaded_at END,
    error_message = _error_message
  WHERE id = _fixture_id RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','FIXTURE_SET_NOT_FOUND'); END IF;
  IF v_row.state = 'SUCCEEDED' AND v_row.production_identifier_scan = 'PASS' THEN
    UPDATE public.infra_environments SET synthetic_data_flag = true WHERE id = v_row.environment_id;
  END IF;
  PERFORM public.infra_log('FIXTURES_LOADED', NULL, _state, jsonb_build_object('fixture_id', _fixture_id));
  RETURN jsonb_build_object('ok', true, 'fixture_set', to_jsonb(v_row));
END; $$;

-- ---------------------------------------------------------------
-- EXTERNAL INFRASTRUCTURE ACTIONS
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.di00_action_resolve(_action_key text, _result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.infra_provider_actions;
BEGIN
  IF NOT public.has_staff_permission('staff.infrastructure.configure') THEN
    RETURN public.infra_denied('staff.infrastructure.configure','di00_action_resolve');
  END IF;
  IF _result IS NULL OR jsonb_typeof(_result) <> 'object' OR _result = '{}'::jsonb THEN
    RETURN jsonb_build_object('ok', false, 'code','EVIDENCE_REQUIRED',
      'message','Supply the authoritative resource reference produced by the provider. "Done" is not evidence.');
  END IF;
  UPDATE public.infra_provider_actions SET submitted_result = _result, state = 'RUNNING',
    validation_result = 'UNKNOWN', validation_detail = 'Awaiting orchestrator validation.',
    resolved_by = auth.uid()
  WHERE action_key = _action_key RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','ACTION_NOT_FOUND'); END IF;
  PERFORM public.infra_log('EXTERNAL_ACTION_RESULT_SUBMITTED', v_row.environment_key, 'APPLIED',
    jsonb_build_object('action_key', _action_key));
  RETURN jsonb_build_object('ok', true, 'action', to_jsonb(v_row));
END; $$;

CREATE OR REPLACE FUNCTION public.di00_action_validate(_action_key text, _result text, _detail text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.infra_provider_actions;
BEGIN
  UPDATE public.infra_provider_actions SET validation_result = _result::public.infra_check_result,
    validation_detail = _detail,
    state = CASE WHEN _result = 'PASS' THEN 'SUCCEEDED' ELSE 'BLOCKED' END::public.infra_job_state,
    resolved_at = CASE WHEN _result = 'PASS' THEN now() END
  WHERE action_key = _action_key RETURNING * INTO v_row;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','ACTION_NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok', true, 'action', to_jsonb(v_row));
END; $$;

-- ---------------------------------------------------------------
-- DI-00 CERTIFICATION RUNNER
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.di00_certify()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_stg public.infra_environments; v_rst public.infra_environments;
  v_backup public.infra_backups; v_restore public.infra_restores;
  v_criteria jsonb := '[]'::jsonb; v_blockers jsonb := '[]'::jsonb;
  v_outcome public.infra_check_result; v_state public.infra_di00_state; v_cert public.infra_certifications;

  PROCEDURE_placeholder boolean;
BEGIN
  IF NOT public.has_staff_permission('staff.infrastructure.certify') THEN
    RETURN public.infra_denied('staff.infrastructure.certify','di00_certify');
  END IF;

  SELECT * INTO v_stg FROM public.infra_environments WHERE environment_type = 'STAGING';
  SELECT * INTO v_rst FROM public.infra_environments WHERE environment_type = 'RESTORE';
  SELECT * INTO v_backup FROM public.infra_backups b
    WHERE b.state = 'SUCCEEDED' AND b.integrity_result = 'PASS'
      AND (v_stg.id IS NULL OR b.source_environment_id = v_stg.id)
    ORDER BY b.completed_at DESC LIMIT 1;
  SELECT * INTO v_restore FROM public.infra_restores r
    WHERE r.state = 'SUCCEEDED' AND r.verification_result = 'PASS'
      AND (v_backup.id IS NULL OR r.backup_id = v_backup.id)
    ORDER BY r.completed_at DESC LIMIT 1;

  -- Criterion helper: each entry is (key, result, detail)
  v_criteria := jsonb_build_array(
    jsonb_build_object('criterion','STAGING_REGISTERED',
      'result', CASE WHEN v_stg.id IS NULL THEN 'NOT_CONFIGURED' ELSE 'PASS' END,
      'detail', coalesce(v_stg.environment_key,'no staging environment registered')),
    jsonb_build_object('criterion','RESTORE_REGISTERED',
      'result', CASE WHEN v_rst.id IS NULL THEN 'NOT_CONFIGURED' ELSE 'PASS' END,
      'detail', coalesce(v_rst.environment_key,'no restore environment registered')),
    jsonb_build_object('criterion','TARGETS_INDEPENDENT',
      'result', CASE WHEN v_stg.id IS NULL OR v_rst.id IS NULL THEN 'UNKNOWN'
                     WHEN v_stg.environment_fingerprint IS NULL OR v_rst.environment_fingerprint IS NULL THEN 'UNKNOWN'
                     WHEN v_stg.environment_fingerprint = v_rst.environment_fingerprint THEN 'FAIL'
                     ELSE 'PASS' END,
      'detail','distinct database fingerprints required'),
    jsonb_build_object('criterion','NEITHER_IS_PRODUCTION',
      'result', CASE WHEN v_stg.id IS NULL OR v_rst.id IS NULL THEN 'UNKNOWN'
                     WHEN v_stg.production_flag OR v_rst.production_flag THEN 'FAIL'
                     WHEN v_stg.verification_status = 'PASS' AND v_rst.verification_status = 'PASS' THEN 'PASS'
                     ELSE 'UNKNOWN' END,
      'detail','production isolation proven by observed database identity'),
    jsonb_build_object('criterion','STAGING_HEALTH',
      'result', coalesce(v_stg.verification_status::text,'NOT_CONFIGURED'),
      'detail', coalesce(v_stg.di00_state_reason,'no health run recorded')),
    jsonb_build_object('criterion','RESTORE_HEALTH',
      'result', coalesce(v_rst.verification_status::text,'NOT_CONFIGURED'),
      'detail', coalesce(v_rst.di00_state_reason,'no health run recorded')),
    jsonb_build_object('criterion','SYNTHETIC_DATA_ISOLATION',
      'result', CASE WHEN v_stg.id IS NULL THEN 'NOT_CONFIGURED'
                     WHEN EXISTS (SELECT 1 FROM public.infra_fixture_sets f
                                   WHERE f.environment_id = v_stg.id AND f.state = 'SUCCEEDED'
                                     AND f.production_identifier_scan = 'PASS') THEN 'PASS'
                     ELSE 'UNKNOWN' END,
      'detail','synthetic fixture set loaded and scanned for production identifiers'),
    jsonb_build_object('criterion','BACKUP_EXECUTED',
      'result', CASE WHEN v_backup.id IS NULL THEN 'UNKNOWN' ELSE 'PASS' END,
      'detail', coalesce(v_backup.backup_reference,'no integrity-verified backup recorded')),
    jsonb_build_object('criterion','RESTORE_EXECUTED',
      'result', CASE WHEN v_restore.id IS NULL THEN 'UNKNOWN' ELSE 'PASS' END,
      'detail', coalesce(v_restore.restore_reference,'no verified restore recorded'))
  );

  SELECT CASE WHEN count(*) FILTER (WHERE c->>'result' = 'FAIL') > 0 THEN 'FAIL'
              WHEN count(*) FILTER (WHERE c->>'result' <> 'PASS') > 0 THEN 'BLOCKED'
              ELSE 'PASS' END::public.infra_check_result
    INTO v_outcome FROM jsonb_array_elements(v_criteria) c;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'blocker_id', c->>'criterion',
           'category', CASE WHEN c->>'result' = 'FAIL' THEN 'GENUINE_FAILURE' ELSE 'EXTERNAL_INFRASTRUCTURE_REQUIRED' END,
           'why', c->>'detail',
           'result', c->>'result')), '[]'::jsonb)
    INTO v_blockers FROM jsonb_array_elements(v_criteria) c WHERE c->>'result' <> 'PASS';

  v_state := CASE WHEN v_outcome = 'PASS' THEN 'CLEARED'
                  WHEN v_outcome = 'FAIL' THEN 'CERTIFICATION_FAILED'
                  ELSE 'CERTIFICATION_READY' END::public.infra_di00_state;

  INSERT INTO public.infra_certifications(outcome, di00_state, staging_environment_id, restore_environment_id,
                                          backup_id, restore_id, criteria, blockers, executed_by)
  VALUES (v_outcome, v_state, v_stg.id, v_rst.id, v_backup.id, v_restore.id, v_criteria, v_blockers, auth.uid())
  RETURNING * INTO v_cert;

  -- Only a genuine PASS propagates into the existing readiness register.
  IF v_outcome = 'PASS' THEN
    INSERT INTO public.logistics_infra_targets(target_role, label, endpoint_ref, synthetic_fixtures_loaded,
                                               isolation_verified, verified_by, verified_at, notes)
    VALUES ('staging', v_stg.environment_name, v_stg.environment_key, true, true, auth.uid(), now(),
            'Verified by DI-00 certification ' || v_cert.certification_reference)
    ON CONFLICT (target_role) DO UPDATE SET label = EXCLUDED.label, endpoint_ref = EXCLUDED.endpoint_ref,
      synthetic_fixtures_loaded = true, isolation_verified = true, verified_by = auth.uid(),
      verified_at = now(), notes = EXCLUDED.notes;
    INSERT INTO public.logistics_infra_targets(target_role, label, endpoint_ref, synthetic_fixtures_loaded,
                                               isolation_verified, verified_by, verified_at, notes)
    VALUES ('restore', v_rst.environment_name, v_rst.environment_key, true, true, auth.uid(), now(),
            'Verified by DI-00 certification ' || v_cert.certification_reference)
    ON CONFLICT (target_role) DO UPDATE SET label = EXCLUDED.label, endpoint_ref = EXCLUDED.endpoint_ref,
      synthetic_fixtures_loaded = true, isolation_verified = true, verified_by = auth.uid(),
      verified_at = now(), notes = EXCLUDED.notes;

    INSERT INTO public.logistics_readiness_evidence(control_id, remediation_class, workflow_state, owner_role,
      evidence_ref, comments, declaration, payload, submitted_by, submitted_at)
    VALUES ('DI-00','EXTERNAL_INFRASTRUCTURE_REQUIRED','EVIDENCE_SUBMITTED','platform_owner',
      v_cert.certification_reference, 'Automatically filed by the DI-00 certification runner.', true,
      jsonb_build_object('criteria', v_criteria, 'certification_id', v_cert.id), auth.uid(), now());

    UPDATE public.infra_environments SET di00_state = 'CLEARED' WHERE id IN (v_stg.id, v_rst.id);
  END IF;

  PERFORM public.infra_log('DI00_CERTIFICATION', NULL, v_outcome::text,
    jsonb_build_object('certification', v_cert.certification_reference, 'blockers', v_blockers));

  RETURN jsonb_build_object('ok', true, 'certification', to_jsonb(v_cert));
END; $$;

-- ---------------------------------------------------------------
-- EXECUTE GRANTS — deny-by-default
-- ---------------------------------------------------------------
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname='public' AND (p.proname LIKE 'di00\_%' OR p.proname LIKE 'infra\_%')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f.sig);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.di00_record_health(text,jsonb,jsonb,text,text,text,text,integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.di00_backup_complete(uuid,text,integer,integer,bigint,text,text,text,text,text,jsonb) FROM authenticated;
REVOKE ALL ON FUNCTION public.di00_restore_complete(uuid,text,integer,integer,text,jsonb,text,text) FROM authenticated;
REVOKE ALL ON FUNCTION public.di00_fixture_complete(uuid,text,jsonb,text,text) FROM authenticated;
REVOKE ALL ON FUNCTION public.di00_action_validate(text,text,text) FROM authenticated;
REVOKE ALL ON FUNCTION public.infra_log(text,text,text,jsonb,text,text,text) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.di00_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.di00_environment_upsert(text,text,text,text,text,text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.di00_backup_request(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.di00_restore_request(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.di00_fixture_request(text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.di00_action_resolve(text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.di00_certify() TO authenticated;

-- ---------------------------------------------------------------
-- SEED: the two required environments + external action queue
-- ---------------------------------------------------------------
INSERT INTO public.infra_environments (environment_key, environment_name, environment_type, provider,
  credential_secret_name, status, di00_state, di00_state_reason, notes)
VALUES
 ('logistics-staging','Logistics Staging PostgreSQL','STAGING', NULL, NULL, 'REGISTERED',
  'CONFIGURATION_REQUIRED','No connection credential secret configured.',
  'DI-00 certification execution environment. Must never be production.'),
 ('logistics-restore','Logistics Restore PostgreSQL','RESTORE', NULL, NULL, 'REGISTERED',
  'CONFIGURATION_REQUIRED','No connection credential secret configured.',
  'DI-00 recovery-proof target. Must be a database distinct from staging and from production.')
ON CONFLICT (environment_key) DO NOTHING;

INSERT INTO public.infra_provider_actions (action_key, environment_key, category, resource, required_action,
  required_permission, configuration, required_output, register_where, owner_role, expected_evidence, dependent_controls)
VALUES
 ('PROVISION_STAGING_POSTGRES','logistics-staging','EXTERNAL_INFRASTRUCTURE_ACTION_REQUIRED',
  'PostgreSQL 15+ database instance (non-production)',
  'Create an isolated PostgreSQL database for logistics staging, then store its connection string as the server-side secret LOGISTICS_STAGING_DATABASE_URL.',
  'Infrastructure provider: create database instance',
  jsonb_build_object('engine','postgresql','minimum_version','15','ssl','required','purpose','DI-00 certification execution','must_not_be','production'),
  'Connection string stored as secret LOGISTICS_STAGING_DATABASE_URL, plus provider/project/region/database reference.',
  'Admin → Production Command Center → Infrastructure → DI-00 → Staging configuration',
  'platform_owner',
  'A successful health run recording database version, fingerprint and non-production identity.',
  ARRAY['DI-00']),
 ('PROVISION_RESTORE_POSTGRES','logistics-restore','EXTERNAL_INFRASTRUCTURE_ACTION_REQUIRED',
  'PostgreSQL 15+ database instance (non-production, separate from staging)',
  'Create a second, independent PostgreSQL database for restore proof, then store its connection string as the server-side secret LOGISTICS_RESTORE_DATABASE_URL.',
  'Infrastructure provider: create database instance',
  jsonb_build_object('engine','postgresql','minimum_version','15','ssl','required','purpose','DI-00 restore proof','must_differ_from','logistics-staging'),
  'Connection string stored as secret LOGISTICS_RESTORE_DATABASE_URL, plus provider/project/region/database reference.',
  'Admin → Production Command Center → Infrastructure → DI-00 → Restore configuration',
  'platform_owner',
  'A successful health run proving a database identity distinct from staging and from production.',
  ARRAY['DI-00'])
ON CONFLICT (action_key) DO NOTHING;
