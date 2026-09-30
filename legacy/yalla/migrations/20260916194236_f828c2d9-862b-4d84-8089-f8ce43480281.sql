
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

  -- s = period start, e = revenue window end (exclusive, today+1),
  -- pe = full period end (exclusive) used for the target.
  FOR g IN
    SELECT * FROM (VALUES
      ('DAY',     v_today,                                     v_today + 1, v_today + 1),
      ('WEEK',    date_trunc('week', v_today::timestamp)::date, v_today + 1,
                  (date_trunc('week', v_today::timestamp) + interval '1 week')::date),
      ('MONTH',   date_trunc('month', v_today)::date,           v_today + 1,
                  (date_trunc('month', v_today) + interval '1 month')::date),
      ('QUARTER', date_trunc('quarter', v_today)::date,         v_today + 1,
                  (date_trunc('quarter', v_today) + interval '3 months')::date),
      ('YEAR',    date_trunc('year', v_today)::date,            v_today + 1,
                  (date_trunc('year', v_today) + interval '1 year')::date)
    ) AS x(grain, s, e, pe)
  LOOP
    f := public._sales_person_figures(v_staff, g.s::timestamptz, g.e::timestamptz, false);
    t := public._sales_kpi_target(v_staff, g.s, g.pe);
    r := coalesce((f->>'revenue_won_kes')::numeric, 0);
    v_out := v_out || jsonb_build_object(
      'grain', g.grain,
      'period_start', g.s,
      'period_end', g.pe - 1,
      'target_kes', CASE WHEN coalesce(t,0) > 0 THEN t END,
      'revenue_kes', r,
      'attainment_pct', CASE WHEN coalesce(t,0) > 0 THEN round(r * 100 / t, 1) END,
      'remaining_kes', CASE WHEN coalesce(t,0) > 0 THEN greatest(t - r, 0) END,
      'pace_target_kes', public._sales_kpi_target(v_staff, g.s, g.e),
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

CREATE OR REPLACE FUNCTION public.sales_management_dashboard()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_today date := (now() AT TIME ZONE 'Africa/Nairobi')::date;
        v_m date; v_q date; v_y date; v_me date; v_qe date; v_ye date;
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
  v_me := (v_m + interval '1 month')::date;
  v_qe := (v_q + interval '3 months')::date;
  v_ye := (v_y + interval '1 year')::date;

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
    t  := public._sales_kpi_target(s.id, v_m, v_me);
    tq := public._sales_kpi_target(s.id, v_q, v_qe);
    ty := public._sales_kpi_target(s.id, v_y, v_ye);

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
