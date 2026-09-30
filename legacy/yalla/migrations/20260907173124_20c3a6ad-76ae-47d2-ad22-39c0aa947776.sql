CREATE OR REPLACE FUNCTION public.commercial_target_dashboard(
  _scope text DEFAULT 'mine',
  _period text DEFAULT 'month',
  _from date DEFAULT NULL,
  _to date DEFAULT NULL,
  _include_test boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid; v_scope text := lower(coalesce(_scope,'mine'));
  v_period text := lower(coalesce(_period,'month'));
  v_manages boolean := false; v_ids uuid[];
  v_start timestamptz; v_end timestamptz; v_prev_start timestamptz;
  v_month_start date; v_months numeric; v_whole_months int; v_days_in_month int;
  v_target numeric := 0; v_revenue numeric := 0; v_prev_revenue numeric := 0;
  v_days_total int; v_days_elapsed int; v_days_left int;
  v_expected numeric; v_projected numeric; v_status text;
  v_open numeric := 0; v_weighted numeric := 0; v_remaining numeric;
  v_people jsonb := '[]'::jsonb; v_row jsonb; v_id uuid;
  v_agg jsonb; v_won int := 0; v_lost int := 0; v_opens int := 0;
  v_deal numeric := 0; v_ltc numeric := 0; v_ltc_n int := 0; v_deal_n int := 0;
  v_closing int := 0; v_awaiting int := 0; v_stale int := 0;
  v_pt numeric;
BEGIN
  v_me := public._my_staff_member_id();
  IF v_me IS NULL THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;

  IF v_period = 'custom' AND _from IS NOT NULL THEN
    v_start := _from::timestamptz;
    v_end := (coalesce(_to, current_date) + 1)::timestamptz;
  ELSIF v_period = 'today' THEN
    v_start := date_trunc('day', now()); v_end := v_start + interval '1 day';
  ELSIF v_period = 'week' THEN
    v_start := date_trunc('week', now()); v_end := v_start + interval '1 week';
  ELSIF v_period = 'quarter' THEN
    v_start := date_trunc('quarter', now()); v_end := v_start + interval '3 months';
  ELSIF v_period = 'year' THEN
    v_start := date_trunc('year', now()); v_end := v_start + interval '1 year';
  ELSE
    v_period := 'month';
    v_start := date_trunc('month', now()); v_end := v_start + interval '1 month';
  END IF;
  v_prev_start := v_start - (v_end - v_start);
  v_month_start := v_start::date;

  -- How many monthly targets the window carries: whole calendar months where the
  -- window spans them, otherwise a fraction of the month it sits inside.
  v_whole_months := (EXTRACT(year FROM v_end)::int * 12 + EXTRACT(month FROM v_end)::int)
                  - (EXTRACT(year FROM v_start)::int * 12 + EXTRACT(month FROM v_start)::int);
  v_days_in_month := EXTRACT(day FROM (date_trunc('month', v_start) + interval '1 month' - interval '1 day'))::int;
  IF v_whole_months >= 1 AND v_start = date_trunc('month', v_start) THEN
    v_months := v_whole_months;
  ELSE
    v_months := round((v_end::date - v_start::date)::numeric / v_days_in_month, 6);
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.staff_members WHERE manager_staff_id = v_me) INTO v_manages;
  IF v_scope = 'team' AND v_manages THEN
    WITH RECURSIVE line AS (
      SELECT id, 1 AS depth FROM public.staff_members WHERE manager_staff_id = v_me
      UNION ALL
      SELECT c.id, l.depth+1 FROM public.staff_members c JOIN line l ON c.manager_staff_id = l.id WHERE l.depth < 8
    )
    SELECT array_agg(DISTINCT id) INTO v_ids FROM (SELECT id FROM line UNION SELECT v_me) x;
  ELSE
    v_scope := 'mine'; v_ids := ARRAY[v_me];
  END IF;

  v_days_total := GREATEST((v_end::date - v_start::date), 1);
  v_days_elapsed := LEAST(GREATEST((current_date - v_start::date) + 1, 0), v_days_total);
  v_days_left := GREATEST(v_days_total - v_days_elapsed, 0);

  FOREACH v_id IN ARRAY v_ids LOOP
    v_agg := public._sales_person_figures(v_id, v_start, v_end, _include_test);
    v_pt := ((public.sales_target_for(v_id, v_month_start))->>'target_kes')::numeric * v_months;
    v_target := v_target + coalesce(v_pt,0);
    v_revenue := v_revenue + (v_agg->>'revenue_won_kes')::numeric;
    v_won := v_won + (v_agg->>'won_count')::int;
    v_lost := v_lost + (v_agg->>'lost_count')::int;
    v_opens := v_opens + (v_agg->>'open_count')::int;
    v_open := v_open + (v_agg->>'open_pipeline_kes')::numeric;
    v_weighted := v_weighted + (v_agg->>'weighted_pipeline_kes')::numeric;
    v_closing := v_closing + (v_agg->>'closing_soon_count')::int;
    v_awaiting := v_awaiting + (v_agg->>'awaiting_customer_count')::int;
    v_stale := v_stale + (v_agg->>'stale_count')::int;
    IF v_agg->>'avg_deal_value_kes' IS NOT NULL THEN
      v_deal := v_deal + (v_agg->>'avg_deal_value_kes')::numeric; v_deal_n := v_deal_n + 1; END IF;
    IF v_agg->>'lead_to_close_days' IS NOT NULL THEN
      v_ltc := v_ltc + (v_agg->>'lead_to_close_days')::numeric; v_ltc_n := v_ltc_n + 1; END IF;

    SELECT jsonb_build_object(
      'staff_id', v_id,
      'name', coalesce(s.preferred_name, s.full_name),
      'position', p.title,
      'target_kes', round(coalesce(v_pt,0),0),
      'revenue_won_kes', (v_agg->>'revenue_won_kes')::numeric,
      'attainment_pct', CASE WHEN coalesce(v_pt,0) > 0
        THEN round(((v_agg->>'revenue_won_kes')::numeric * 100) / v_pt, 1) END,
      'remaining_kes', round(GREATEST(coalesce(v_pt,0) - (v_agg->>'revenue_won_kes')::numeric, 0),0),
      'open_pipeline_kes', (v_agg->>'open_pipeline_kes')::numeric,
      'weighted_pipeline_kes', (v_agg->>'weighted_pipeline_kes')::numeric,
      'coverage_x', CASE WHEN GREATEST(coalesce(v_pt,0) - (v_agg->>'revenue_won_kes')::numeric, 0) > 0
        THEN round((v_agg->>'open_pipeline_kes')::numeric
             / GREATEST(coalesce(v_pt,0) - (v_agg->>'revenue_won_kes')::numeric, 1), 2) END,
      'win_rate_pct', v_agg->'win_rate_pct',
      'won_count', (v_agg->>'won_count')::int,
      'decided_count', (v_agg->>'decided_count')::int,
      'lead_to_close_days', v_agg->'lead_to_close_days',
      'sales_cycle_days', v_agg->'sales_cycle_days',
      'awaiting_customer_count', (v_agg->>'awaiting_customer_count')::int,
      'stale_count', (v_agg->>'stale_count')::int,
      'is_me', v_id = v_me
    ) INTO v_row
    FROM public.staff_members s LEFT JOIN public.org_positions p ON p.id = s.position_id
    WHERE s.id = v_id;
    v_people := v_people || coalesce(v_row, jsonb_build_object('staff_id', v_id));
  END LOOP;

  SELECT coalesce(sum((public._sales_person_figures(x, v_prev_start, v_start, _include_test)->>'revenue_won_kes')::numeric),0)
    INTO v_prev_revenue FROM unnest(v_ids) AS x;

  v_target := round(v_target, 0);
  v_remaining := GREATEST(v_target - v_revenue, 0);
  v_expected := CASE WHEN v_days_total > 0 THEN v_target * v_days_elapsed / v_days_total END;
  v_projected := CASE WHEN v_days_elapsed > 0 THEN v_revenue * v_days_total / v_days_elapsed ELSE 0 END;

  v_status := CASE
    WHEN v_target = 0 THEN 'NO_TARGET'
    WHEN v_revenue >= v_target THEN 'EXCEEDING_TARGET'
    WHEN v_projected >= v_target THEN 'ON_PACE'
    WHEN v_projected >= v_target * 0.8 THEN 'AT_RISK'
    ELSE 'BEHIND' END;

  RETURN jsonb_build_object(
    'scope', v_scope, 'can_view_team', v_manages, 'people', coalesce(array_length(v_ids,1),1),
    'period', v_period, 'period_start', v_start, 'period_end', v_end,
    'include_test', _include_test,
    'target_kes', v_target,
    'revenue_won_kes', v_revenue,
    'previous_revenue_kes', v_prev_revenue,
    'revenue_delta_pct', CASE WHEN v_prev_revenue > 0
      THEN round((v_revenue - v_prev_revenue) * 100 / v_prev_revenue, 1) END,
    'attainment_pct', CASE WHEN v_target > 0 THEN round(v_revenue * 100 / v_target, 1) END,
    'remaining_kes', v_remaining,
    'surplus_kes', GREATEST(v_revenue - v_target, 0),
    'status', v_status,
    'pacing', jsonb_build_object(
      'days_total', v_days_total, 'days_elapsed', v_days_elapsed, 'days_remaining', v_days_left,
      'expected_to_date_kes', round(coalesce(v_expected,0),0),
      'pace_pct', CASE WHEN coalesce(v_expected,0) > 0 THEN round(v_revenue * 100 / v_expected, 1) END,
      'required_daily_pace_kes', CASE WHEN v_days_left > 0 THEN round(v_remaining / v_days_left, 0) ELSE v_remaining END,
      'projected_revenue_kes', round(coalesce(v_projected,0),0),
      'projected_attainment_pct', CASE WHEN v_target > 0 THEN round(coalesce(v_projected,0) * 100 / v_target, 1) END
    ),
    'pipeline', jsonb_build_object(
      'open_count', v_opens,
      'open_pipeline_kes', v_open,
      'weighted_pipeline_kes', v_weighted,
      'coverage_x', CASE WHEN v_remaining > 0 THEN round(v_open / v_remaining, 2) END,
      'weighted_coverage_x', CASE WHEN v_remaining > 0 THEN round(v_weighted / v_remaining, 2) END,
      'forecast_revenue_kes', round(v_revenue + v_weighted, 0)
    ),
    'quality', jsonb_build_object(
      'won_count', v_won, 'lost_count', v_lost, 'decided_count', v_won + v_lost,
      'win_rate_pct', CASE WHEN (v_won+v_lost) > 0 THEN round(v_won::numeric*100/(v_won+v_lost),1) END,
      'avg_deal_value_kes', CASE WHEN v_deal_n > 0 THEN round(v_deal/v_deal_n,0) END,
      'lead_to_close_days', CASE WHEN v_ltc_n > 0 THEN round(v_ltc/v_ltc_n,1) END
    ),
    'actions', jsonb_build_object(
      'target_gap_kes', v_remaining, 'closing_soon_count', v_closing,
      'awaiting_customer_count', v_awaiting, 'overdue_followups_count', v_stale,
      'coverage_x', CASE WHEN v_remaining > 0 THEN round(v_open / v_remaining, 2) END
    ),
    'roster', v_people
  );
END $$;
REVOKE ALL ON FUNCTION public.commercial_target_dashboard(text, text, date, date, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.commercial_target_dashboard(text, text, date, date, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.commercial_target_dashboard(text, text, date, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commercial_target_dashboard(text, text, date, date, boolean) TO service_role;