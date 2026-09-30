
CREATE TABLE IF NOT EXISTS public.payment_incident_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_key TEXT NOT NULL UNIQUE,
  root_cause TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warn',
  status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN | RESOLVED
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  member_count INT NOT NULL DEFAULT 0,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payment_incident_groups TO authenticated;
GRANT ALL ON public.payment_incident_groups TO service_role;
ALTER TABLE public.payment_incident_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "incident groups admin read" ON public.payment_incident_groups
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'finance_admin') OR public.has_role(auth.uid(),'super_admin')
  );
CREATE POLICY "incident groups service manage" ON public.payment_incident_groups
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);
CREATE INDEX IF NOT EXISTS idx_incident_groups_last_seen ON public.payment_incident_groups (last_seen_at DESC);

CREATE TABLE IF NOT EXISTS public.payment_incident_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.payment_incident_groups(id) ON DELETE CASCADE,
  alert_id UUID NOT NULL REFERENCES public.payment_alerts(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, alert_id)
);
GRANT SELECT ON public.payment_incident_group_members TO authenticated;
GRANT ALL ON public.payment_incident_group_members TO service_role;
ALTER TABLE public.payment_incident_group_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "incident group members admin read" ON public.payment_incident_group_members
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'finance_admin') OR public.has_role(auth.uid(),'super_admin')
  );
CREATE POLICY "incident group members service manage" ON public.payment_incident_group_members
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Cluster recent alerts into cause-chain groups by first two segments of alert_key
-- within a 30-minute window. Idempotent per group_key.
CREATE OR REPLACE FUNCTION public.payment_group_alerts(_window_minutes INT DEFAULT 120)
RETURNS TABLE (group_id UUID, group_key TEXT, member_count INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; gid UUID;
BEGIN
  FOR r IN
    SELECT
      COALESCE(split_part(a.alert_key,':',1),'unknown')
        ||':'||COALESCE(split_part(a.alert_key,':',2),'') AS gkey,
      MAX(a.severity) AS sev,
      MIN(a.fired_at) AS first_seen,
      MAX(a.fired_at) AS last_seen,
      COUNT(*)::INT AS cnt,
      ARRAY_AGG(a.id) AS ids
    FROM public.payment_alerts a
    WHERE a.fired_at >= now() - make_interval(mins => _window_minutes)
    GROUP BY 1
    HAVING COUNT(*) >= 1
  LOOP
    INSERT INTO public.payment_incident_groups (group_key, root_cause, severity, first_seen_at, last_seen_at, member_count, status)
    VALUES (r.gkey, r.gkey, r.sev, r.first_seen, r.last_seen, r.cnt, 'OPEN')
    ON CONFLICT (group_key) DO UPDATE
      SET last_seen_at = GREATEST(payment_incident_groups.last_seen_at, EXCLUDED.last_seen_at),
          member_count = EXCLUDED.member_count,
          severity     = EXCLUDED.severity,
          updated_at   = now(),
          status       = CASE WHEN EXCLUDED.last_seen_at > now() - interval '15 minutes' THEN 'OPEN' ELSE payment_incident_groups.status END
    RETURNING id INTO gid;

    INSERT INTO public.payment_incident_group_members (group_id, alert_id)
    SELECT gid, unnest(r.ids)
    ON CONFLICT DO NOTHING;

    group_id := gid; group_key := r.gkey; member_count := r.cnt; RETURN NEXT;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.payment_group_alerts(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_group_alerts(INT) TO authenticated, service_role;

-- Advisory-only signal: weighted forecast probability × direction. Bounded to
-- [-5, +5] confidence-point adjustment. Never used by evaluate(); orchestrator
-- may add this to computeConfidence as pure advisory context.
CREATE OR REPLACE FUNCTION public.payment_forecast_advisory_signal()
RETURNS TABLE (adjustment NUMERIC, sample_size INT, worst_component TEXT, worst_probability NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE agg NUMERIC := 0; n INT := 0; wc TEXT; wp NUMERIC := 0;
BEGIN
  SELECT
    COALESCE(SUM(
      CASE
        WHEN predicted_status = 'CRITICAL' THEN -1.0 * probability
        WHEN predicted_status = 'DEGRADED' THEN -0.5 * probability
        WHEN predicted_status = 'HEALTHY'  THEN  0.5 * probability
        ELSE 0
      END
    ), 0),
    COUNT(*)
  INTO agg, n
  FROM public.payment_reliability_forecasts
  WHERE computed_at >= now() - interval '2 hours';

  SELECT component, probability INTO wc, wp
  FROM public.payment_reliability_forecasts
  WHERE computed_at >= now() - interval '2 hours' AND predicted_status IN ('CRITICAL','DEGRADED')
  ORDER BY probability DESC NULLS LAST LIMIT 1;

  adjustment := GREATEST(-5, LEAST(5, ROUND(agg * 2, 2)));
  sample_size := n;
  worst_component := wc;
  worst_probability := wp;
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public.payment_forecast_advisory_signal() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_forecast_advisory_signal() TO authenticated, service_role;
