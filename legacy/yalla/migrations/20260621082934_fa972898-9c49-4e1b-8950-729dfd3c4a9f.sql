
CREATE TABLE IF NOT EXISTS public.driver_achievement_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier text NOT NULL UNIQUE,
  sort_order int NOT NULL,
  min_trips int NOT NULL DEFAULT 0,
  min_rating numeric(3,2) NOT NULL DEFAULT 0,
  min_acceptance_rate numeric(4,3) NOT NULL DEFAULT 0,
  max_cancellation_rate numeric(4,3) NOT NULL DEFAULT 1,
  commission_discount_pct numeric(4,3) NOT NULL DEFAULT 0,
  weekly_bonus_kes numeric(10,2) NOT NULL DEFAULT 0,
  perks jsonb NOT NULL DEFAULT '[]'::jsonb,
  badge_color text NOT NULL DEFAULT '#6b7280',
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.driver_achievement_tiers TO anon, authenticated;
GRANT ALL ON public.driver_achievement_tiers TO service_role;

ALTER TABLE public.driver_achievement_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tiers public read" ON public.driver_achievement_tiers FOR SELECT USING (true);
CREATE POLICY "tiers admin write" ON public.driver_achievement_tiers FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role)) WITH CHECK (has_role(auth.uid(),'admin'::app_role));

INSERT INTO public.driver_achievement_tiers (tier, sort_order, min_trips, min_rating, min_acceptance_rate, max_cancellation_rate, commission_discount_pct, weekly_bonus_kes, perks, badge_color, description) VALUES
('Bronze',   1, 0,    4.50, 0.70, 0.15, 0.000, 0,    '["Standard support","Weekly tips digest"]'::jsonb, '#cd7f32', 'Starting tier for new drivers.'),
('Silver',   2, 200,  4.65, 0.80, 0.10, 0.010, 500,  '["Priority support queue","Fuel discount partners"]'::jsonb, '#9ca3af', 'Consistent driver with strong ratings.'),
('Gold',     3, 800,  4.75, 0.85, 0.08, 0.020, 1500, '["+1% earnings","Surge boost on weekends","Free vehicle inspection"]'::jsonb, '#f59e0b', 'Top quartile driver with loyal riders.'),
('Platinum', 4, 2500, 4.85, 0.90, 0.05, 0.035, 4000, '["+3.5% earnings","Airport queue priority","Health insurance support"]'::jsonb, '#06b6d4', 'Elite tier with priority dispatching.'),
('Diamond',  5, 6000, 4.90, 0.93, 0.03, 0.050, 9000, '["+5% earnings","Concierge support","SACCO loan eligibility","Annual driver award invite"]'::jsonb, '#3b82f6', 'Top 1% of drivers in Africa.')
ON CONFLICT (tier) DO NOTHING;

CREATE OR REPLACE FUNCTION public.driver_leaderboard_public(_city text DEFAULT NULL, _limit int DEFAULT 10)
RETURNS TABLE (
  rank bigint,
  initials text,
  city text,
  trips int,
  rating numeric,
  weekly_gross_kes numeric,
  tier text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH agg AS (
    SELECT d.id,
           COALESCE(d.city, 'Nairobi') AS city,
           upper(coalesce(left(d.first_name,1),'Y') || coalesce(left(d.last_name,1),'A')) AS initials,
           SUM(m.trips_count)::int AS trips,
           ROUND(AVG(NULLIF(m.rating_avg,0))::numeric, 2) AS rating,
           ROUND((SUM(m.gross_cents)::numeric / 100.0), 0) AS weekly_gross_kes
    FROM public.driver_daily_metrics m
    JOIN public.drivers d ON d.id = m.driver_id
    WHERE m.metric_date >= (current_date - interval '7 days')
      AND (_city IS NULL OR d.city = _city)
    GROUP BY d.id, d.city, d.first_name, d.last_name
  )
  SELECT row_number() OVER (ORDER BY weekly_gross_kes DESC NULLS LAST) AS rank,
         initials, city, trips, rating, weekly_gross_kes,
         CASE
           WHEN trips >= 6000 AND rating >= 4.90 THEN 'Diamond'
           WHEN trips >= 2500 AND rating >= 4.85 THEN 'Platinum'
           WHEN trips >= 800  AND rating >= 4.75 THEN 'Gold'
           WHEN trips >= 200  AND rating >= 4.65 THEN 'Silver'
           ELSE 'Bronze'
         END AS tier
  FROM agg
  ORDER BY weekly_gross_kes DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(_limit, 50));
$$;

REVOKE ALL ON FUNCTION public.driver_leaderboard_public(text,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_leaderboard_public(text,int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS set_tiers_updated_at ON public.driver_achievement_tiers;
CREATE TRIGGER set_tiers_updated_at BEFORE UPDATE ON public.driver_achievement_tiers
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
