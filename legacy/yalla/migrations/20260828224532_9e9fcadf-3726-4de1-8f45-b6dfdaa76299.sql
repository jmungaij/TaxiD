CREATE OR REPLACE FUNCTION public.st_execution_complete(
  _execution_id uuid, _result text, _assertions jsonb DEFAULT '[]'::jsonb,
  _evidence jsonb DEFAULT '{}'::jsonb, _first_failure jsonb DEFAULT NULL,
  _environment_fingerprint text DEFAULT NULL, _schema_version text DEFAULT NULL,
  _duration_ms integer DEFAULT NULL, _retryable boolean DEFAULT false,
  _error_code text DEFAULT NULL, _error_message text DEFAULT NULL,
  _expires_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_row public.st_control_executions; v_hash text;
BEGIN
  v_hash := encode(extensions.digest(
    coalesce(_evidence,'{}'::jsonb)::text || coalesce(_assertions,'[]'::jsonb)::text, 'sha256'), 'hex');

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

REVOKE ALL ON FUNCTION public.st_execution_complete(uuid, text, jsonb, jsonb, jsonb, text, text, integer, boolean, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.st_execution_complete(uuid, text, jsonb, jsonb, jsonb, text, text, integer, boolean, text, text, timestamptz) TO service_role;