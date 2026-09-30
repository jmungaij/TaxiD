
CREATE TABLE public.sales_kpi_closes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grain text NOT NULL CHECK (grain IN ('DAY','WEEK','MONTH','QUARTER','YEAR')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  staff_member_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  target_kes numeric NOT NULL DEFAULT 0,
  revenue_kes numeric NOT NULL DEFAULT 0,
  attainment_pct numeric,
  figures jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'AUTOMATED_FREEZE',
  closed_at timestamptz NOT NULL DEFAULT now(),
  closed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (grain, period_start, staff_member_id)
);

CREATE INDEX idx_sales_kpi_closes_lookup ON public.sales_kpi_closes (staff_member_id, grain, period_start DESC);

GRANT SELECT ON public.sales_kpi_closes TO authenticated;
GRANT ALL ON public.sales_kpi_closes TO service_role;

ALTER TABLE public.sales_kpi_closes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kpi closes readable by owner or desk leadership"
ON public.sales_kpi_closes FOR SELECT TO authenticated
USING (
  staff_member_id = public._my_staff_member_id()
  OR public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'super_admin')
  OR public.has_staff_permission('staff.crm.manage')
);

CREATE POLICY "kpi closes written by administrators"
ON public.sales_kpi_closes FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE TRIGGER trg_sales_kpi_closes_touch
BEFORE UPDATE ON public.sales_kpi_closes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Can the caller read the whole desk?
CREATE OR REPLACE FUNCTION public._sales_desk_leader()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT coalesce(
    public.has_role(auth.uid(),'admin')
    OR public.has_role(auth.uid(),'super_admin')
    OR public.has_staff_permission('staff.crm.manage'), false);
$$;

-- Target for any period, derived from the monthly target register by working days.
CREATE OR REPLACE FUNCTION public._sales_kpi_target(_staff uuid, _start date, _end_exclusive date)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_total numeric := 0; m date; m_start date; m_end date;
        v_monthly numeric; v_bd_month int; v_bd_overlap int;
        v_from date; v_to date;
BEGIN
  IF _staff IS NULL OR _end_exclusive <= _start THEN RETURN 0; END IF;
  m := date_trunc('month', _start)::date;
  WHILE m < _end_exclusive LOOP
    m_start := m;
    m_end := (m + interval '1 month')::date;
    v_monthly := coalesce(((public.sales_target_for(_staff, m_start))->>'target_kes')::numeric, 0);
    v_bd_month := public._sales_business_days(m_start, m_end);
    v_from := greatest(m_start, _start);
    v_to := least(m_end, _end_exclusive);
    v_bd_overlap := public._sales_business_days(v_from, v_to);
    IF v_bd_month > 0 THEN
      v_total := v_total + v_monthly * v_bd_overlap::numeric / v_bd_month::numeric;
    END IF;
    m := m_end;
  END LOOP;
  RETURN round(v_total, 2);
END $$;

-- Freeze one grain for every eligible specialist. period_end is inclusive.
CREATE OR REPLACE FUNCTION public._sales_kpi_freeze(_grain text, _start date, _end_exclusive date)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE s record; f jsonb; t numeric; n int := 0;
BEGIN
  FOR s IN SELECT sm.id FROM public.staff_members sm
             JOIN public.org_positions op ON op.id = sm.position_id
            WHERE sm.employment_status IN ('active','onboarding')
              AND op.code = ANY (public._sales_eligible_codes())
  LOOP
    f := public._sales_person_figures(s.id, _start::timestamptz, _end_exclusive::timestamptz, false);
    t := public._sales_kpi_target(s.id, _start, _end_exclusive);
    INSERT INTO public.sales_kpi_closes
      (grain, period_start, period_end, staff_member_id, target_kes, revenue_kes,
       attainment_pct, figures, source, closed_by)
    VALUES (_grain, _start, _end_exclusive - 1, s.id, coalesce(t,0),
       coalesce((f->>'revenue_won_kes')::numeric, 0),
       CASE WHEN coalesce(t,0) > 0
            THEN round(coalesce((f->>'revenue_won_kes')::numeric,0) * 100 / t, 2) END,
       f || jsonb_build_object('target_kes', coalesce(t,0)),
       'AUTOMATED_FREEZE', auth.uid())
    ON CONFLICT (grain, period_start, staff_member_id) DO UPDATE
      SET period_end = EXCLUDED.period_end,
          target_kes = EXCLUDED.target_kes,
          revenue_kes = EXCLUDED.revenue_kes,
          attainment_pct = EXCLUDED.attainment_pct,
          figures = EXCLUDED.figures,
          closed_at = now(),
          updated_at = now();
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- The 7 PM Kenya freeze: day always, week on Saturday, month at month end,
-- then the quarter and year totals cascade from the same engine.
CREATE OR REPLACE FUNCTION public.sales_kpi_close_tick()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Africa/Nairobi')::date;
        v_done jsonb := '{}'::jsonb;
        v_month_start date; v_q_start date; v_y_start date;
        v_is_month_end boolean;
BEGIN
  v_done := jsonb_set(v_done, '{DAY}',
    to_jsonb(public._sales_kpi_freeze('DAY', v_today, v_today + 1)));

  IF EXTRACT(isodow FROM v_today) = 6 THEN
    v_done := jsonb_set(v_done, '{WEEK}',
      to_jsonb(public._sales_kpi_freeze('WEEK',
        date_trunc('week', v_today::timestamp)::date, v_today + 1)));
  END IF;

  v_month_start := date_trunc('month', v_today)::date;
  v_is_month_end := v_today = ((v_month_start + interval '1 month')::date - 1)
                    OR EXTRACT(day FROM v_today) = 30;

  IF v_is_month_end THEN
    v_done := jsonb_set(v_done, '{MONTH}',
      to_jsonb(public._sales_kpi_freeze('MONTH', v_month_start, v_today + 1)));

    v_q_start := date_trunc('quarter', v_today)::date;
    v_y_start := date_trunc('year', v_today)::date;
    v_done := jsonb_set(v_done, '{QUARTER}',
      to_jsonb(public._sales_kpi_freeze('QUARTER', v_q_start, v_today + 1)));
    v_done := jsonb_set(v_done, '{YEAR}',
      to_jsonb(public._sales_kpi_freeze('YEAR', v_y_start, v_today + 1)));
  END IF;

  RETURN jsonb_build_object('date', v_today, 'closed', v_done);
END $$;

REVOKE ALL ON FUNCTION public.sales_kpi_close_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sales_kpi_close_tick() TO service_role;
REVOKE ALL ON FUNCTION public._sales_kpi_freeze(text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sales_kpi_freeze(text, date, date) TO service_role;

-- Live cascade for one specialist: day → week → month → quarter → year.
CREATE OR REPLACE FUNCTION public.sales_kpi_cascade(_staff uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_me uuid := public._my_staff_member_id();
        v_staff uuid; v_today date := (now() AT TIME ZONE 'Africa/Nairobi')::date;
        v_out jsonb := '[]'::jsonb; g record; f jsonb; t numeric; r numeric;
        v_name text; v_pos text;
BEGIN
  IF v_me IS NULL AND NOT public._sales_desk_leader() THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  v_staff := coalesce(_staff, v_me);
  IF v_staff IS NULL THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  IF v_staff <> coalesce(v_me, v_staff) AND NOT public._sales_desk_leader() THEN
    RAISE EXCEPTION 'NOT_IN_YOUR_REPORTING_LINE';
  END IF;

  SELECT sm.full_name, op.code INTO v_name, v_pos
    FROM public.staff_members sm LEFT JOIN public.org_positions op ON op.id = sm.position_id
   WHERE sm.id = v_staff;

  FOR g IN
    SELECT * FROM (VALUES
      ('DAY',     v_today,                                          v_today + 1),
      ('WEEK',    date_trunc('week', v_today::timestamp)::date,      v_today + 1),
      ('MONTH',   date_trunc('month', v_today)::date,               v_today + 1),
      ('QUARTER', date_trunc('quarter', v_today)::date,             v_today + 1),
      ('YEAR',    date_trunc('year', v_today)::date,                v_today + 1)
    ) AS x(grain, s, e)
  LOOP
    f := public._sales_person_figures(v_staff, g.s::timestamptz, g.e::timestamptz, false);
    t := public._sales_kpi_target(v_staff, g.s, g.e);
    r := coalesce((f->>'revenue_won_kes')::numeric, 0);
    v_out := v_out || jsonb_build_object(
      'grain', g.grain,
      'period_start', g.s,
      'period_end', g.e - 1,
      'target_kes', CASE WHEN coalesce(t,0) > 0 THEN t END,
      'revenue_kes', r,
      'attainment_pct', CASE WHEN coalesce(t,0) > 0 THEN round(r * 100 / t, 1) END,
      'remaining_kes', CASE WHEN coalesce(t,0) > 0 THEN greatest(t - r, 0) END,
      'won_count', (f->>'won_count')::int,
      'open_count', (f->>'open_count')::int,
      'open_pipeline_kes', (f->>'open_pipeline_kes')::numeric,
      'weighted_pipeline_kes', (f->>'weighted_pipeline_kes')::numeric,
      'win_rate_pct', (f->>'win_rate_pct')::numeric,
      'last_close_at', (SELECT max(closed_at) FROM public.sales_kpi_closes c
                         WHERE c.staff_member_id = v_staff AND c.grain = g.grain)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'staff_id', v_staff, 'staff_name', v_name, 'position_code', v_pos,
    'as_of', v_today, 'revenue_basis', coalesce((SELECT revenue_basis FROM public.sales_engine_settings LIMIT 1),'RECOGNISED'),
    'grains', v_out);
END $$;

GRANT EXECUTE ON FUNCTION public.sales_kpi_cascade(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_kpi_cascade(uuid) TO service_role;

-- The management read of the desk.
CREATE OR REPLACE FUNCTION public.sales_management_dashboard()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Africa/Nairobi')::date;
        v_m date; v_q date; v_y date;
        s record; f jsonb; fq jsonb; fy jsonb; t numeric; tq numeric; ty numeric;
        v_people jsonb := '[]'::jsonb;
        v_rev numeric := 0; v_target numeric := 0; v_open numeric := 0; v_weighted numeric := 0;
        v_won int := 0; v_lost int := 0; v_openc int := 0;
        v_rev_q numeric := 0; v_target_q numeric := 0; v_rev_y numeric := 0; v_target_y numeric := 0;
BEGIN
  IF NOT public._sales_desk_leader() THEN RAISE EXCEPTION 'NOT_AUTHORISED_TO_VIEW_DESK'; END IF;
  v_m := date_trunc('month', v_today)::date;
  v_q := date_trunc('quarter', v_today)::date;
  v_y := date_trunc('year', v_today)::date;

  FOR s IN SELECT sm.id, sm.full_name, op.code AS position_code
             FROM public.staff_members sm
             JOIN public.org_positions op ON op.id = sm.position_id
            WHERE sm.employment_status IN ('active','onboarding')
              AND op.code = ANY (public._sales_eligible_codes())
            ORDER BY sm.full_name
  LOOP
    f  := public._sales_person_figures(s.id, v_m::timestamptz, (v_today + 1)::timestamptz, false);
    fq := public._sales_person_figures(s.id, v_q::timestamptz, (v_today + 1)::timestamptz, false);
    fy := public._sales_person_figures(s.id, v_y::timestamptz, (v_today + 1)::timestamptz, false);
    t  := public._sales_kpi_target(s.id, v_m, v_today + 1);
    tq := public._sales_kpi_target(s.id, v_q, v_today + 1);
    ty := public._sales_kpi_target(s.id, v_y, v_today + 1);

    v_rev := v_rev + coalesce((f->>'revenue_won_kes')::numeric,0);
    v_target := v_target + coalesce(t,0);
    v_open := v_open + coalesce((f->>'open_pipeline_kes')::numeric,0);
    v_weighted := v_weighted + coalesce((f->>'weighted_pipeline_kes')::numeric,0);
    v_won := v_won + coalesce((f->>'won_count')::int,0);
    v_lost := v_lost + coalesce((f->>'lost_count')::int,0);
    v_openc := v_openc + coalesce((f->>'open_count')::int,0);
    v_rev_q := v_rev_q + coalesce((fq->>'revenue_won_kes')::numeric,0);
    v_target_q := v_target_q + coalesce(tq,0);
    v_rev_y := v_rev_y + coalesce((fy->>'revenue_won_kes')::numeric,0);
    v_target_y := v_target_y + coalesce(ty,0);

    v_people := v_people || jsonb_build_object(
      'staff_member_id', s.id,
      'staff_name', s.full_name,
      'position_code', s.position_code,
      'target_kes', CASE WHEN coalesce(t,0) > 0 THEN t END,
      'revenue_kes', coalesce((f->>'revenue_won_kes')::numeric,0),
      'attainment_pct', CASE WHEN coalesce(t,0) > 0
        THEN round(coalesce((f->>'revenue_won_kes')::numeric,0) * 100 / t, 1) END,
      'won_count', (f->>'won_count')::int,
      'lost_count', (f->>'lost_count')::int,
      'win_rate_pct', (f->>'win_rate_pct')::numeric,
      'open_count', (f->>'open_count')::int,
      'open_pipeline_kes', (f->>'open_pipeline_kes')::numeric,
      'weighted_pipeline_kes', (f->>'weighted_pipeline_kes')::numeric,
      'stale_count', (f->>'stale_count')::int,
      'awaiting_customer_count', (f->>'awaiting_customer_count')::int,
      'quarter_revenue_kes', coalesce((fq->>'revenue_won_kes')::numeric,0),
      'quarter_target_kes', CASE WHEN coalesce(tq,0) > 0 THEN tq END,
      'year_revenue_kes', coalesce((fy->>'revenue_won_kes')::numeric,0),
      'year_target_kes', CASE WHEN coalesce(ty,0) > 0 THEN ty END,
      'last_close_at', (SELECT max(closed_at) FROM public.sales_kpi_closes c WHERE c.staff_member_id = s.id)
    );
  END LOOP;

  RETURN jsonb_build_object(
    'as_of', v_today,
    'revenue_basis', coalesce((SELECT revenue_basis FROM public.sales_engine_settings LIMIT 1),'RECOGNISED'),
    'month', jsonb_build_object(
      'period_start', v_m, 'revenue_kes', v_rev, 'target_kes', CASE WHEN v_target > 0 THEN v_target END,
      'attainment_pct', CASE WHEN v_target > 0 THEN round(v_rev * 100 / v_target, 1) END,
      'won_count', v_won, 'lost_count', v_lost, 'open_count', v_openc,
      'open_pipeline_kes', v_open, 'weighted_pipeline_kes', v_weighted,
      'win_rate_pct', CASE WHEN (v_won + v_lost) > 0 THEN round(v_won::numeric * 100 / (v_won + v_lost), 1) END),
    'quarter', jsonb_build_object('period_start', v_q, 'revenue_kes', v_rev_q,
      'target_kes', CASE WHEN v_target_q > 0 THEN v_target_q END,
      'attainment_pct', CASE WHEN v_target_q > 0 THEN round(v_rev_q * 100 / v_target_q, 1) END),
    'year', jsonb_build_object('period_start', v_y, 'revenue_kes', v_rev_y,
      'target_kes', CASE WHEN v_target_y > 0 THEN v_target_y END,
      'attainment_pct', CASE WHEN v_target_y > 0 THEN round(v_rev_y * 100 / v_target_y, 1) END),
    'people', v_people,
    'closes', (SELECT coalesce(jsonb_agg(x ORDER BY x->>'closed_at' DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object('grain', grain, 'period_start', period_start,
                                  'period_end', period_end, 'closed_at', closed_at,
                                  'people', count(*), 'revenue_kes', sum(revenue_kes)) AS x
          FROM public.sales_kpi_closes
         GROUP BY grain, period_start, period_end, closed_at
         ORDER BY closed_at DESC LIMIT 8) y)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.sales_management_dashboard() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_management_dashboard() TO service_role;
GRANT EXECUTE ON FUNCTION public._sales_desk_leader() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._sales_kpi_target(uuid, date, date) TO authenticated, service_role;
