CREATE TABLE IF NOT EXISTS public.infra_orchestration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_reference text NOT NULL UNIQUE,
  trigger_source text NOT NULL CHECK (trigger_source IN ('CREDENTIAL_SAVED','MANUAL','RESUME','AUTO_RETRY','SCHEDULED')),
  environment_scope text[] NOT NULL DEFAULT ARRAY[]::text[],
  idempotency_key text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'RUNNING'
    CHECK (state IN ('RUNNING','SUCCEEDED','PARTIAL','FAILED','BLOCKED','CANCELLED')),
  resumed_from_step text,
  blocked_step text,
  blocked_reason text,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by uuid,
  correlation_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer
);

GRANT SELECT ON public.infra_orchestration_runs TO authenticated;
GRANT ALL ON public.infra_orchestration_runs TO service_role;
ALTER TABLE public.infra_orchestration_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "infra staff read orchestration runs" ON public.infra_orchestration_runs;
CREATE POLICY "infra staff read orchestration runs" ON public.infra_orchestration_runs
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.infrastructure.read'));

CREATE INDEX IF NOT EXISTS infra_orch_runs_started ON public.infra_orchestration_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS public.infra_orchestration_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.infra_orchestration_runs(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  environment_key text,
  sequence_no integer NOT NULL DEFAULT 0,
  attempt integer NOT NULL DEFAULT 1,
  state text NOT NULL CHECK (state IN ('STARTED','SUCCEEDED','FAILED','SKIPPED','ROLLED_BACK','BLOCKED','RETRYING')),
  idempotency_key text,
  reused_evidence boolean NOT NULL DEFAULT false,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_message text,
  rollback_action text,
  rollback_result text,
  duration_ms integer,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.infra_orchestration_steps TO authenticated;
GRANT ALL ON public.infra_orchestration_steps TO service_role;
ALTER TABLE public.infra_orchestration_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "infra staff read orchestration steps" ON public.infra_orchestration_steps;
CREATE POLICY "infra staff read orchestration steps" ON public.infra_orchestration_steps
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.infrastructure.read'));

CREATE INDEX IF NOT EXISTS infra_orch_steps_run ON public.infra_orchestration_steps (run_id, recorded_at);

CREATE OR REPLACE FUNCTION public._infra_orch_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'infra_orchestration_steps is append-only';
END $$;

DROP TRIGGER IF EXISTS trg_infra_orch_append_only ON public.infra_orchestration_steps;
CREATE TRIGGER trg_infra_orch_append_only
  BEFORE UPDATE OR DELETE ON public.infra_orchestration_steps
  FOR EACH ROW EXECUTE FUNCTION public._infra_orch_append_only();

CREATE TABLE IF NOT EXISTS public.infra_orchestration_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.infra_orchestration_runs(id) ON DELETE CASCADE,
  severity text NOT NULL CHECK (severity IN ('INFO','WARNING','CRITICAL')),
  title text NOT NULL,
  body text NOT NULL,
  environment_key text,
  step_key text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid
);

GRANT SELECT ON public.infra_orchestration_notifications TO authenticated;
GRANT ALL ON public.infra_orchestration_notifications TO service_role;
ALTER TABLE public.infra_orchestration_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "infra staff read orchestration alerts" ON public.infra_orchestration_notifications;
CREATE POLICY "infra staff read orchestration alerts" ON public.infra_orchestration_notifications
  FOR SELECT TO authenticated USING (public.has_staff_permission('staff.infrastructure.read'));

CREATE INDEX IF NOT EXISTS infra_orch_alerts_created ON public.infra_orchestration_notifications (created_at DESC);

CREATE OR REPLACE FUNCTION public.di00_orch_start(
  _trigger text,
  _scope text[],
  _idempotency_key text,
  _correlation_id uuid DEFAULT NULL,
  _requested_by uuid DEFAULT NULL,
  _resumed_from_step text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_run public.infra_orchestration_runs; v_ref text;
BEGIN
  SELECT * INTO v_run FROM public.infra_orchestration_runs WHERE idempotency_key = _idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'idempotent_replay', true, 'run', to_jsonb(v_run));
  END IF;

  v_ref := 'DI00-ORCH-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 6));

  INSERT INTO public.infra_orchestration_runs (
    run_reference, trigger_source, environment_scope, idempotency_key,
    correlation_id, requested_by, resumed_from_step
  ) VALUES (
    v_ref, _trigger, coalesce(_scope, ARRAY[]::text[]), _idempotency_key,
    _correlation_id, _requested_by, _resumed_from_step
  ) RETURNING * INTO v_run;

  INSERT INTO public.infra_orchestration_notifications (run_id, severity, title, body, detail)
  VALUES (v_run.id, 'INFO', 'DI-00 orchestration started',
          format('Run %s started (%s) for %s.', v_ref, _trigger,
                 coalesce(nullif(array_to_string(coalesce(_scope, ARRAY[]::text[]), ', '), ''), 'no scope')),
          jsonb_build_object('resumed_from_step', _resumed_from_step));

  RETURN jsonb_build_object('ok', true, 'idempotent_replay', false, 'run', to_jsonb(v_run));
END $$;

CREATE OR REPLACE FUNCTION public.di00_orch_step(
  _run_id uuid,
  _step_key text,
  _state text,
  _environment_key text DEFAULT NULL,
  _sequence_no integer DEFAULT 0,
  _attempt integer DEFAULT 1,
  _idempotency_key text DEFAULT NULL,
  _reused boolean DEFAULT false,
  _detail jsonb DEFAULT '{}'::jsonb,
  _error_code text DEFAULT NULL,
  _error_message text DEFAULT NULL,
  _rollback_action text DEFAULT NULL,
  _rollback_result text DEFAULT NULL,
  _duration_ms integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.infra_orchestration_steps; v_ref text;
BEGIN
  SELECT run_reference INTO v_ref FROM public.infra_orchestration_runs WHERE id = _run_id;
  IF v_ref IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RUN_NOT_FOUND');
  END IF;

  INSERT INTO public.infra_orchestration_steps (
    run_id, step_key, environment_key, sequence_no, attempt, state, idempotency_key,
    reused_evidence, detail, error_code, error_message, rollback_action, rollback_result, duration_ms
  ) VALUES (
    _run_id, _step_key, _environment_key, coalesce(_sequence_no, 0), coalesce(_attempt, 1), _state,
    _idempotency_key, coalesce(_reused, false), coalesce(_detail, '{}'::jsonb),
    _error_code, _error_message, _rollback_action, _rollback_result, _duration_ms
  ) RETURNING * INTO v_row;

  IF _state IN ('FAILED','BLOCKED','ROLLED_BACK') THEN
    INSERT INTO public.infra_orchestration_notifications (
      run_id, severity, title, body, environment_key, step_key, detail
    ) VALUES (
      _run_id,
      CASE WHEN _state = 'BLOCKED' THEN 'WARNING' ELSE 'CRITICAL' END,
      format('DI-00 step %s %s', _step_key, lower(_state)),
      format('Run %s: step %s on %s reported %s%s.', v_ref, _step_key,
             coalesce(_environment_key, 'control plane'), _state,
             CASE WHEN _error_message IS NULL THEN '' ELSE ' - ' || _error_message END),
      _environment_key, _step_key,
      jsonb_build_object('error_code', _error_code, 'attempt', _attempt,
                         'rollback_action', _rollback_action, 'rollback_result', _rollback_result)
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'step', to_jsonb(v_row));
END $$;

CREATE OR REPLACE FUNCTION public.di00_orch_finish(
  _run_id uuid,
  _state text,
  _summary jsonb DEFAULT '{}'::jsonb,
  _blocked_step text DEFAULT NULL,
  _blocked_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_run public.infra_orchestration_runs;
BEGIN
  UPDATE public.infra_orchestration_runs
     SET state = _state,
         summary = coalesce(_summary, '{}'::jsonb),
         blocked_step = _blocked_step,
         blocked_reason = _blocked_reason,
         finished_at = now(),
         duration_ms = GREATEST(0, (EXTRACT(EPOCH FROM (now() - started_at)) * 1000)::integer)
   WHERE id = _run_id
  RETURNING * INTO v_run;

  IF v_run.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RUN_NOT_FOUND');
  END IF;

  INSERT INTO public.infra_orchestration_notifications (
    run_id, severity, title, body, step_key, detail
  ) VALUES (
    _run_id,
    CASE WHEN _state = 'SUCCEEDED' THEN 'INFO' WHEN _state IN ('FAILED','CANCELLED') THEN 'CRITICAL' ELSE 'WARNING' END,
    format('DI-00 orchestration %s', lower(_state)),
    format('Run %s finished with %s%s.', v_run.run_reference, _state,
           CASE WHEN _blocked_reason IS NULL THEN '' ELSE ' - blocked at ' || coalesce(_blocked_step,'?') || ': ' || _blocked_reason END),
    _blocked_step,
    coalesce(_summary, '{}'::jsonb)
  );

  RETURN jsonb_build_object('ok', true, 'run', to_jsonb(v_run));
END $$;

REVOKE ALL ON FUNCTION public.di00_orch_start(text, text[], text, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.di00_orch_step(uuid, text, text, text, integer, integer, text, boolean, jsonb, text, text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.di00_orch_finish(uuid, text, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.di00_orch_start(text, text[], text, uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.di00_orch_step(uuid, text, text, text, integer, integer, text, boolean, jsonb, text, text, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.di00_orch_finish(uuid, text, jsonb, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.di00_orchestration_log(_limit integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_runs jsonb; v_alerts jsonb;
BEGIN
  IF NOT public.has_staff_permission('staff.infrastructure.read') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORIZATION_DENIED',
      'message', 'Infrastructure read permission is required.');
  END IF;

  SELECT coalesce(jsonb_agg(q.r ORDER BY q.started_at DESC), '[]'::jsonb) INTO v_runs
    FROM (
      SELECT to_jsonb(x) || jsonb_build_object('steps', (
               SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.recorded_at), '[]'::jsonb)
                 FROM public.infra_orchestration_steps s WHERE s.run_id = x.id
             )) AS r, x.started_at
        FROM (
          SELECT * FROM public.infra_orchestration_runs
           ORDER BY started_at DESC LIMIT greatest(1, least(coalesce(_limit, 10), 50))
        ) x
    ) q;

  SELECT coalesce(jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC), '[]'::jsonb) INTO v_alerts
    FROM (
      SELECT * FROM public.infra_orchestration_notifications
       ORDER BY created_at DESC LIMIT 50
    ) n;

  RETURN jsonb_build_object('ok', true, 'runs', v_runs, 'notifications', v_alerts);
END $$;

CREATE OR REPLACE FUNCTION public.di00_orchestration_ack(_notification_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_staff_permission('staff.infrastructure.configure') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORIZATION_DENIED',
      'message', 'Infrastructure configure permission is required.');
  END IF;

  UPDATE public.infra_orchestration_notifications
     SET acknowledged_at = now(), acknowledged_by = auth.uid()
   WHERE id = _notification_id AND acknowledged_at IS NULL;

  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.di00_orchestration_log(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.di00_orchestration_ack(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.di00_orchestration_log(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.di00_orchestration_log(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.di00_orchestration_ack(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.di00_orchestration_ack(uuid) TO service_role;