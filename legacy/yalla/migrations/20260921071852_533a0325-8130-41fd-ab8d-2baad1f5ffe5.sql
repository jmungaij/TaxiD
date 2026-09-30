-- Anonymous upload perimeter: volume anomaly detection and alerting.
-- Rollback: drop the triggers, the three functions, the two tables.

CREATE TABLE IF NOT EXISTS public.public_upload_scope_ceilings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  counter_table text NOT NULL CHECK (counter_table IN ('rec_public_upload_counters','public_intake_counters')),
  scope_pattern text NOT NULL,
  ceiling integer NOT NULL CHECK (ceiling > 0),
  guard_function text NOT NULL,
  purpose text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (counter_table, scope_pattern)
);

GRANT SELECT ON public.public_upload_scope_ceilings TO authenticated;
GRANT ALL ON public.public_upload_scope_ceilings TO service_role;
ALTER TABLE public.public_upload_scope_ceilings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "upload ceilings admin read" ON public.public_upload_scope_ceilings;
CREATE POLICY "upload ceilings admin read"
  ON public.public_upload_scope_ceilings FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role]));

CREATE TABLE IF NOT EXISTS public.public_upload_volume_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  counter_table text NOT NULL,
  scope text NOT NULL,
  window_start timestamptz NOT NULL,
  ceiling integer NOT NULL,
  hits integer NOT NULL,
  utilisation numeric NOT NULL,
  severity text NOT NULL CHECK (severity IN ('WARNING','CRITICAL')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  UNIQUE (counter_table, scope, window_start)
);

GRANT SELECT, UPDATE ON public.public_upload_volume_alerts TO authenticated;
GRANT ALL ON public.public_upload_volume_alerts TO service_role;
ALTER TABLE public.public_upload_volume_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "upload volume alerts admin read" ON public.public_upload_volume_alerts;
CREATE POLICY "upload volume alerts admin read"
  ON public.public_upload_volume_alerts FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role]));

DROP POLICY IF EXISTS "upload volume alerts admin ack" ON public.public_upload_volume_alerts;
CREATE POLICY "upload volume alerts admin ack"
  ON public.public_upload_volume_alerts FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role]));

CREATE INDEX IF NOT EXISTS public_upload_volume_alerts_open_idx
  ON public.public_upload_volume_alerts (created_at DESC) WHERE acknowledged_at IS NULL;

INSERT INTO public.public_upload_scope_ceilings (counter_table, scope_pattern, ceiling, guard_function, purpose) VALUES
  ('rec_public_upload_counters','ip:%:minute',        8,  'rec_public_upload_reserve','per-client upload burst'),
  ('rec_public_upload_counters','ip:%:hour',          30, 'rec_public_upload_reserve','per-client hourly uploads'),
  ('rec_public_upload_counters','slug:%:minute',      15, 'rec_public_upload_reserve','per-vacancy upload burst'),
  ('rec_public_upload_counters','slug:%:hour',        60, 'rec_public_upload_reserve','per-vacancy hourly uploads'),
  ('rec_public_upload_counters','global:minute',      60, 'rec_public_upload_reserve','platform upload burst'),
  ('rec_public_upload_counters','global:hour',        300,'rec_public_upload_reserve','platform hourly uploads'),
  ('rec_public_upload_counters','sess:%:minute',      4,  'rec_public_upload_session_allow','per-session upload burst'),
  ('rec_public_upload_counters','session:ip:%:hour',  6,  'rec_public_upload_session_open','sessions opened per client'),
  ('rec_public_upload_counters','session:global:hour',200,'rec_public_upload_session_open','sessions opened platform wide'),
  ('rec_public_upload_counters','session:%:hour',     30, 'rec_public_upload_session_open','sessions opened per vacancy'),
  ('rec_public_upload_counters','portal:ip:%:minute', 8,  'contract_portal_upload_allowed','portal inbox burst per client'),
  ('rec_public_upload_counters','portal:ip:%:hour',   30, 'contract_portal_upload_allowed','portal inbox hourly per client'),
  ('rec_public_upload_counters','portal:global:minute',40,'contract_portal_upload_allowed','portal inbox platform burst'),
  ('rec_public_upload_counters','portal:global:hour', 200,'contract_portal_upload_allowed','portal inbox platform hourly'),
  ('public_intake_counters','partner:fp:%:hour',      3,  'partner_application_intake_within_limit','partner intake per client hourly'),
  ('public_intake_counters','partner:fp:%:day',       8,  'partner_application_intake_within_limit','partner intake per client daily'),
  ('public_intake_counters','partner:global:hour',    60, 'partner_application_intake_within_limit','partner intake platform hourly')
ON CONFLICT (counter_table, scope_pattern) DO UPDATE
  SET ceiling = EXCLUDED.ceiling,
      guard_function = EXCLUDED.guard_function,
      purpose = EXCLUDED.purpose,
      updated_at = now();

CREATE OR REPLACE FUNCTION public.public_upload_scope_ceiling(_counter_table text, _scope text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT c.ceiling
    FROM public.public_upload_scope_ceilings c
   WHERE c.counter_table = _counter_table
     AND _scope LIKE c.scope_pattern
   ORDER BY (length(c.scope_pattern) - length(replace(c.scope_pattern, '%', ''))) ASC,
            length(c.scope_pattern) DESC
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.public_upload_scope_ceiling(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_upload_scope_ceiling(text,text) TO authenticated, service_role;

-- Evaluate one counter bucket and raise / escalate its alert. Shared by the
-- counter triggers (event-driven, no polling) and the manual review sweep.
CREATE OR REPLACE FUNCTION public.public_upload_volume_evaluate(
  _counter_table text, _scope text, _window_start timestamptz, _hits integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ceiling integer;
  v_severity text;
  v_changed boolean := false;
BEGIN
  v_ceiling := public.public_upload_scope_ceiling(_counter_table, _scope);

  IF v_ceiling IS NULL THEN
    -- An unreviewed scope means a guard started writing a bucket nobody
    -- approved: that is itself an anomaly and must be visible.
    INSERT INTO public.public_upload_volume_alerts
      (counter_table, scope, window_start, ceiling, hits, utilisation, severity)
    VALUES (_counter_table, _scope, _window_start, 1, _hits, 999, 'CRITICAL')
    ON CONFLICT (counter_table, scope, window_start) DO UPDATE
      SET hits = GREATEST(public.public_upload_volume_alerts.hits, EXCLUDED.hits),
          updated_at = now()
    WHERE public.public_upload_volume_alerts.hits < EXCLUDED.hits;
    IF FOUND THEN
      INSERT INTO public.security_alerts (alert_type, severity, message, payload)
      VALUES ('anonymous_upload_scope_unreviewed', 'HIGH'::security_severity,
        format('Anonymous intake counter "%s" wrote unreviewed scope "%s" (%s hits)',
               _counter_table, _scope, _hits),
        jsonb_build_object('counter_table', _counter_table, 'scope', _scope,
                           'window_start', _window_start, 'hits', _hits));
      v_changed := true;
    END IF;
    RETURN v_changed;
  END IF;

  IF _hits::numeric / v_ceiling < 0.8 THEN
    RETURN false;
  END IF;

  v_severity := CASE WHEN _hits >= v_ceiling THEN 'CRITICAL' ELSE 'WARNING' END;

  INSERT INTO public.public_upload_volume_alerts
    (counter_table, scope, window_start, ceiling, hits, utilisation, severity)
  VALUES (_counter_table, _scope, _window_start, v_ceiling, _hits,
          round(_hits::numeric / v_ceiling, 3), v_severity)
  ON CONFLICT (counter_table, scope, window_start) DO UPDATE
    SET hits = GREATEST(public.public_upload_volume_alerts.hits, EXCLUDED.hits),
        utilisation = GREATEST(public.public_upload_volume_alerts.utilisation, EXCLUDED.utilisation),
        severity = CASE WHEN EXCLUDED.severity = 'CRITICAL' THEN 'CRITICAL'
                        ELSE public.public_upload_volume_alerts.severity END,
        updated_at = now()
  WHERE public.public_upload_volume_alerts.hits < EXCLUDED.hits
     OR (public.public_upload_volume_alerts.severity <> 'CRITICAL' AND EXCLUDED.severity = 'CRITICAL');

  IF FOUND THEN
    INSERT INTO public.security_alerts (alert_type, severity, message, payload)
    VALUES ('anonymous_upload_volume',
      CASE WHEN v_severity = 'CRITICAL' THEN 'HIGH'::security_severity ELSE 'MEDIUM'::security_severity END,
      format('Anonymous intake scope "%s" reached %s of %s allowed in window %s',
             _scope, _hits, v_ceiling, _window_start),
      jsonb_build_object('counter_table', _counter_table, 'scope', _scope,
                         'window_start', _window_start, 'hits', _hits, 'ceiling', v_ceiling));
    v_changed := true;
  END IF;

  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.public_upload_volume_evaluate(text,text,timestamptz,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_upload_volume_evaluate(text,text,timestamptz,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_public_upload_volume_watch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.public_upload_volume_evaluate(TG_TABLE_NAME, NEW.scope, NEW.window_start, NEW.hits);
  RETURN NULL;
EXCEPTION WHEN others THEN
  -- Monitoring must never break a legitimate applicant's upload.
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_public_upload_volume_watch() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tg_public_upload_volume_watch() TO service_role;

DROP TRIGGER IF EXISTS rec_public_upload_counters_volume_watch ON public.rec_public_upload_counters;
CREATE TRIGGER rec_public_upload_counters_volume_watch
  AFTER INSERT OR UPDATE OF hits ON public.rec_public_upload_counters
  FOR EACH ROW EXECUTE FUNCTION public.tg_public_upload_volume_watch();

DROP TRIGGER IF EXISTS public_intake_counters_volume_watch ON public.public_intake_counters;
CREATE TRIGGER public_intake_counters_volume_watch
  AFTER INSERT OR UPDATE OF hits ON public.public_intake_counters
  FOR EACH ROW EXECUTE FUNCTION public.tg_public_upload_volume_watch();

-- Manual / on-demand backstop over recent buckets (no schedule).
CREATE OR REPLACE FUNCTION public.public_upload_volume_sweep()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_raised integer := 0;
  r record;
BEGIN
  FOR r IN
    SELECT 'rec_public_upload_counters'::text AS t, scope, window_start, hits
      FROM public.rec_public_upload_counters
     WHERE window_start > now() - interval '48 hours'
    UNION ALL
    SELECT 'public_intake_counters', scope, window_start, hits
      FROM public.public_intake_counters
     WHERE window_start > now() - interval '48 hours'
  LOOP
    IF public.public_upload_volume_evaluate(r.t, r.scope, r.window_start, r.hits) THEN
      v_raised := v_raised + 1;
    END IF;
  END LOOP;
  RETURN v_raised;
END;
$$;

REVOKE ALL ON FUNCTION public.public_upload_volume_sweep() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_upload_volume_sweep() TO service_role;

COMMENT ON FUNCTION public.public_upload_volume_sweep() IS
  'Anonymous upload perimeter monitoring backstop: re-evaluates intake counter buckets from the last 48 hours. Normal detection is trigger-driven. service_role only.';
