
-- Phase 5: Achievement progress + leaderboard view + incentive forecasting

CREATE TABLE public.driver_achievement_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL,
  current_tier TEXT NOT NULL DEFAULT 'Bronze',
  points INTEGER NOT NULL DEFAULT 0,
  trips_30d INTEGER NOT NULL DEFAULT 0,
  rating_30d NUMERIC(3,2) NOT NULL DEFAULT 0,
  acceptance_30d NUMERIC(5,2) NOT NULL DEFAULT 0,
  cancellation_30d NUMERIC(5,2) NOT NULL DEFAULT 0,
  last_unlock_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (driver_id)
);

GRANT SELECT ON public.driver_achievement_progress TO authenticated;
GRANT ALL ON public.driver_achievement_progress TO service_role;

ALTER TABLE public.driver_achievement_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Drivers read own progress"
  ON public.driver_achievement_progress FOR SELECT TO authenticated
  USING (auth.uid() = driver_id OR public.has_role(auth.uid(),'admin'));

CREATE POLICY "Admins manage progress"
  ON public.driver_achievement_progress FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Recompute function (called by trigger on fact_trips insert)
CREATE OR REPLACE FUNCTION public.recompute_driver_achievement_progress(_driver_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trips INTEGER;
  v_rating NUMERIC(3,2);
  v_accept NUMERIC(5,2);
  v_cancel NUMERIC(5,2);
  v_tier TEXT;
BEGIN
  SELECT COALESCE(SUM(trips_count),0),
         COALESCE(AVG(NULLIF(rating_avg,0)),0),
         COALESCE(AVG(NULLIF(acceptance_rate,0)),0),
         COALESCE(AVG(NULLIF(cancellation_rate,0)),0)
    INTO v_trips, v_rating, v_accept, v_cancel
  FROM public.driver_daily_metrics
  WHERE driver_id = _driver_id
    AND metric_date >= current_date - INTERVAL '30 days';

  SELECT tier INTO v_tier
  FROM public.driver_achievement_tiers
  WHERE is_active = true
    AND v_trips >= COALESCE(min_trips,0)
    AND v_rating >= COALESCE(min_rating,0)
    AND v_accept >= COALESCE(min_acceptance_rate,0)
    AND v_cancel <= COALESCE(max_cancellation_rate,100)
  ORDER BY sort_order DESC
  LIMIT 1;

  v_tier := COALESCE(v_tier, 'Bronze');

  INSERT INTO public.driver_achievement_progress
    (driver_id, current_tier, points, trips_30d, rating_30d, acceptance_30d, cancellation_30d, updated_at)
  VALUES
    (_driver_id, v_tier, v_trips * 10, v_trips, v_rating, v_accept, v_cancel, now())
  ON CONFLICT (driver_id) DO UPDATE
    SET current_tier = EXCLUDED.current_tier,
        points = EXCLUDED.points,
        trips_30d = EXCLUDED.trips_30d,
        rating_30d = EXCLUDED.rating_30d,
        acceptance_30d = EXCLUDED.acceptance_30d,
        cancellation_30d = EXCLUDED.cancellation_30d,
        last_unlock_at = CASE
          WHEN public.driver_achievement_progress.current_tier <> EXCLUDED.current_tier THEN now()
          ELSE public.driver_achievement_progress.last_unlock_at
        END,
        updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_driver_achievement_progress(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_driver_achievement_progress(UUID) TO authenticated, service_role;

-- Trigger on fact_trips insert
CREATE OR REPLACE FUNCTION public.tg_fact_trips_recompute_achievement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.driver_id IS NOT NULL THEN
    PERFORM public.recompute_driver_achievement_progress(NEW.driver_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fact_trips_achievement ON public.fact_trips;
CREATE TRIGGER trg_fact_trips_achievement
  AFTER INSERT ON public.fact_trips
  FOR EACH ROW EXECUTE FUNCTION public.tg_fact_trips_recompute_achievement();

-- Incentive forecasting RPC: matches projected hours/trips to active programs
CREATE OR REPLACE FUNCTION public.driver_incentive_forecast(
  _driver_id UUID,
  _city TEXT DEFAULT NULL,
  _projected_trips INTEGER DEFAULT 0,
  _projected_hours NUMERIC DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  description TEXT,
  city TEXT,
  category_slug TEXT,
  trigger_type TEXT,
  threshold NUMERIC,
  reward_kes NUMERIC,
  current_progress NUMERIC,
  projected_progress NUMERIC,
  eligible BOOLEAN,
  window_end TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_trips INTEGER;
  v_current_hours NUMERIC;
BEGIN
  SELECT COALESCE(SUM(trips_count),0),
         COALESCE(SUM(online_minutes),0) / 60.0
    INTO v_current_trips, v_current_hours
  FROM public.driver_daily_metrics
  WHERE driver_id = _driver_id
    AND metric_date >= date_trunc('week', current_date)::date;

  RETURN QUERY
  SELECT
    p.id, p.name, p.description, p.city, p.category_slug,
    p.trigger_type, p.threshold, p.reward_kes,
    CASE p.trigger_type
      WHEN 'trips_count' THEN v_current_trips::NUMERIC
      WHEN 'hours_online' THEN v_current_hours
      ELSE 0
    END AS current_progress,
    CASE p.trigger_type
      WHEN 'trips_count' THEN (v_current_trips + _projected_trips)::NUMERIC
      WHEN 'hours_online' THEN v_current_hours + _projected_hours
      ELSE 0
    END AS projected_progress,
    CASE p.trigger_type
      WHEN 'trips_count' THEN (v_current_trips + _projected_trips) >= p.threshold
      WHEN 'hours_online' THEN (v_current_hours + _projected_hours) >= p.threshold
      ELSE false
    END AS eligible,
    p.window_end
  FROM public.incentive_programs p
  WHERE p.is_active = true
    AND (p.window_start IS NULL OR p.window_start <= now())
    AND (p.window_end IS NULL OR p.window_end >= now())
    AND (_city IS NULL OR p.city IS NULL OR p.city = _city)
  ORDER BY eligible DESC, p.reward_kes DESC
  LIMIT 20;
END;
$$;

REVOKE ALL ON FUNCTION public.driver_incentive_forecast(UUID, TEXT, INTEGER, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_incentive_forecast(UUID, TEXT, INTEGER, NUMERIC) TO authenticated, service_role;
