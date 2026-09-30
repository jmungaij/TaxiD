-- 1. internal freeze of one month -----------------------------------------
CREATE OR REPLACE FUNCTION public._sales_period_freeze(_start date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_start date := date_trunc('month', _start)::date;
        v_end date; v_n int := 0; s record; f jsonb; t numeric;
BEGIN
  v_end := (v_start + interval '1 month')::date;
  FOR s IN SELECT sm.id FROM public.staff_members sm
             JOIN public.org_positions op ON op.id = sm.position_id
            WHERE sm.employment_status IN ('active','onboarding')
              AND op.code = ANY (public._sales_eligible_codes())
  LOOP
    f := public._sales_person_figures(s.id, v_start::timestamptz, v_end::timestamptz, false);
    t := ((public.sales_target_for(s.id, v_start))->>'target_kes')::numeric;
    INSERT INTO public.sales_period_closures
      (period_start, period_end, staff_member_id, target_kes, revenue_kes, attainment_pct,
       won_count, decided_count, open_pipeline_kes, snapshot, closed_by)
    VALUES (v_start, v_end - 1, s.id, coalesce(t,0), (f->>'revenue_won_kes')::numeric,
       CASE WHEN coalesce(t,0) > 0 THEN round((f->>'revenue_won_kes')::numeric * 100 / t, 2) END,
       (f->>'won_count')::int, (f->>'decided_count')::int, (f->>'open_pipeline_kes')::numeric,
       f || jsonb_build_object('target_kes', coalesce(t,0)), auth.uid())
    ON CONFLICT (period_start, staff_member_id) DO NOTHING;
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('period_start', v_start, 'period_end', v_end - 1, 'people', v_n);
END $$;

REVOKE ALL ON FUNCTION public._sales_period_freeze(date) FROM PUBLIC, anon, authenticated;

-- 2. administrator close (explicit) ---------------------------------------
CREATE OR REPLACE FUNCTION public.sales_period_close(p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_start date := coalesce((p->>'period_start')::date,
                                 date_trunc('month', now() - interval '1 month')::date);
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_TO_CLOSE_PERIOD';
  END IF;
  IF date_trunc('month', v_start)::date >= date_trunc('month', current_date)::date THEN
    RAISE EXCEPTION 'PERIOD_NOT_FINISHED';
  END IF;
  RETURN public._sales_period_freeze(v_start);
END $$;

REVOKE ALL ON FUNCTION public.sales_period_close(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_period_close(jsonb) TO authenticated;

-- 3. automatic freeze of every finished month ------------------------------
CREATE OR REPLACE FUNCTION public.sales_period_autoclose()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_last date := (date_trunc('month', current_date) - interval '1 month')::date;
        v_m date; v_first date; v_months int := 0; v_rows int := 0;
BEGIN
  IF public._my_staff_member_id() IS NULL THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  SELECT date_trunc('month', min(created_at))::date INTO v_first FROM public.sales_leads;
  IF v_first IS NULL THEN RETURN jsonb_build_object('frozen_months', 0, 'rows', 0, 'through', v_last); END IF;
  IF v_first < (v_last - interval '23 months')::date THEN v_first := (v_last - interval '23 months')::date; END IF;
  v_m := v_first;
  WHILE v_m <= v_last LOOP
    IF NOT EXISTS (SELECT 1 FROM public.sales_period_closures WHERE period_start = v_m) THEN
      v_rows := v_rows + coalesce((public._sales_period_freeze(v_m)->>'people')::int, 0);
      v_months := v_months + 1;
    END IF;
    v_m := (v_m + interval '1 month')::date;
  END LOOP;
  RETURN jsonb_build_object('frozen_months', v_months, 'rows', v_rows, 'through', v_last);
END $$;

REVOKE ALL ON FUNCTION public.sales_period_autoclose() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_period_autoclose() TO authenticated;

-- 4. period-aware target resolution ---------------------------------------
CREATE OR REPLACE FUNCTION public.sales_target_for(_staff uuid, _period_start date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_start date := coalesce(_period_start, date_trunc('month', now())::date);
  v_pos text; v_unit uuid; r record; v_monthly numeric;
BEGIN
  SELECT p.code, s.unit_id INTO v_pos, v_unit
    FROM public.staff_members s
    LEFT JOIN public.org_positions p ON p.id = s.position_id
   WHERE s.id = _staff;

  SELECT t.*, CASE t.scope WHEN 'STAFF' THEN 4 WHEN 'POSITION' THEN 3 WHEN 'UNIT' THEN 2 ELSE 1 END AS rank
    INTO r
    FROM public.sales_targets t
   WHERE t.is_active
     AND t.effective_from <= v_start
     AND (t.effective_to IS NULL OR t.effective_to >= v_start)
     AND (
       t.scope = 'GLOBAL'
       OR (t.scope = 'STAFF' AND t.staff_member_id = _staff)
       OR (t.scope = 'POSITION' AND t.position_code = v_pos)
       OR (t.scope = 'UNIT' AND t.unit_id = v_unit)
     )
   ORDER BY rank DESC, t.effective_from DESC, t.created_at DESC
   LIMIT 1;

  IF r.id IS NULL THEN
    RETURN jsonb_build_object('target_kes', 0, 'currency','KES','source','NONE','target_id',NULL,'period','MONTH');
  END IF;

  v_monthly := CASE r.period WHEN 'QUARTER' THEN r.amount_kes / 3
                             WHEN 'YEAR' THEN r.amount_kes / 12
                             ELSE r.amount_kes END;

  RETURN jsonb_build_object(
    'target_kes', round(v_monthly, 2), 'period_amount_kes', r.amount_kes,
    'currency', r.currency, 'source', r.scope,
    'target_id', r.id, 'is_override', r.is_override,
    'effective_from', r.effective_from, 'period', r.period
  );
END $$;

REVOKE ALL ON FUNCTION public.sales_target_for(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_target_for(uuid, date) TO authenticated;

-- 5. target settings: period + currency, history preserved ----------------
CREATE OR REPLACE FUNCTION public.sales_target_set(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_scope text := upper(coalesce(p->>'scope','STAFF'));
  v_period text := upper(coalesce(p->>'period','MONTH'));
  v_currency text := upper(coalesce(nullif(p->>'currency',''),'KES'));
  v_from date := coalesce((p->>'effective_from')::date, date_trunc('month', now())::date);
  v_amount numeric := (p->>'amount_kes')::numeric;
  v_staff uuid := nullif(p->>'staff_member_id','')::uuid;
  v_unit uuid := nullif(p->>'unit_id','')::uuid;
  v_pos text := nullif(p->>'position_code','');
  v_prev record; v_id uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_TO_SET_TARGET';
  END IF;
  IF v_scope = 'COMPANY' THEN v_scope := 'GLOBAL'; END IF;
  IF v_amount IS NULL OR v_amount < 0 THEN RAISE EXCEPTION 'INVALID_TARGET_AMOUNT'; END IF;
  IF v_period NOT IN ('MONTH','QUARTER','YEAR') THEN RAISE EXCEPTION 'INVALID_TARGET_PERIOD'; END IF;
  IF v_currency !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'INVALID_CURRENCY'; END IF;
  IF EXISTS (SELECT 1 FROM public.sales_period_closures WHERE period_start >= date_trunc('month', v_from)::date) THEN
    -- a frozen month keeps its own figures; a new quota only affects periods from here on
    NULL;
  END IF;

  SELECT * INTO v_prev FROM public.sales_targets
   WHERE is_active AND scope = v_scope
     AND coalesce(staff_member_id::text,'') = coalesce(v_staff::text,'')
     AND coalesce(unit_id::text,'') = coalesce(v_unit::text,'')
     AND coalesce(position_code,'') = coalesce(v_pos,'')
   ORDER BY effective_from DESC LIMIT 1;

  IF v_prev.id IS NOT NULL THEN
    UPDATE public.sales_targets
       SET effective_to = v_from - 1, is_active = (v_from - 1) >= effective_from
     WHERE id = v_prev.id;
  END IF;

  INSERT INTO public.sales_targets
    (scope, staff_member_id, position_code, unit_id, period, amount_kes,
     currency, effective_from, is_override, notes, set_by)
  VALUES (v_scope, v_staff, v_pos, v_unit, v_period, v_amount,
          v_currency, v_from, coalesce((p->>'is_override')::boolean,false),
          p->>'notes', auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.sales_target_events
    (target_id, action, scope, staff_member_id, before_value, after_value, actor_user_id, note)
  VALUES (v_id, CASE WHEN v_prev.id IS NULL THEN 'TARGET_CREATED' ELSE 'TARGET_CHANGED' END,
          v_scope, v_staff,
          CASE WHEN v_prev.id IS NULL THEN NULL
               ELSE jsonb_build_object('amount_kes', v_prev.amount_kes, 'period', v_prev.period,
                                       'currency', v_prev.currency, 'effective_from', v_prev.effective_from) END,
          jsonb_build_object('amount_kes', v_amount, 'period', v_period,
                             'currency', v_currency, 'effective_from', v_from),
          auth.uid(), p->>'notes');

  RETURN jsonb_build_object('target_id', v_id, 'amount_kes', v_amount, 'period', v_period,
                            'currency', v_currency, 'effective_from', v_from);
END $$;

REVOKE ALL ON FUNCTION public.sales_target_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_target_set(jsonb) TO authenticated;

-- 6. dashboard: frozen history + single-person drill-down -------------------
DROP FUNCTION IF EXISTS public.commercial_target_dashboard(text, text, date, date, boolean);

CREATE OR REPLACE FUNCTION public.commercial_target_dashboard(
  _scope text DEFAULT 'mine', _period text DEFAULT 'month',
  _from date DEFAULT NULL, _to date DEFAULT NULL,
  _include_test boolean DEFAULT false, _staff uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid; v_scope text := lower(coalesce(_scope,'mine'));
  v_period text := lower(coalesce(_period,'month'));
  v_manages boolean := false; v_ids uuid[];
  v_start timestamptz; v_end timestamptz; v_prev_start timestamptz;
  v_month_start date; v_months numeric; v_whole_months int; v_days_in_month int;
  v_target numeric := 0; v_revenue numeric := 0; v_prev_revenue numeric := 0;
  v_days_total int; v_days_elapsed int; v_days_left int;
  v_bd_total int; v_bd_elapsed int; v_bd_left int; v_bd_only boolean;
  v_expected numeric; v_projected numeric; v_status text; v_status_reason text;
  v_open numeric := 0; v_weighted numeric := 0; v_remaining numeric;
  v_people jsonb := '[]'::jsonb; v_row jsonb; v_id uuid;
  v_agg jsonb; v_won int := 0; v_lost int := 0; v_opens int := 0;
  v_deal numeric := 0; v_ltc numeric := 0; v_ltc_n int := 0; v_deal_n int := 0;
  v_closing int := 0; v_awaiting int := 0; v_stale int := 0;
  v_pt numeric; v_stale_days int; v_warn numeric;
  v_sla_open int := 0; v_sla_warn int := 0; v_sla_breach int := 0; v_sla_esc int := 0;
  p_open int; p_warn int; p_breach int; p_esc int;
  v_reasons jsonb; v_basis text; v_elapsed_ratio numeric;
  v_is_month boolean; v_finished boolean; v_frozen boolean := false;
  v_frozen_at timestamptz; v_person_name text;
  c record; v_adj numeric;
BEGIN
  v_me := public._my_staff_member_id();
  IF v_me IS NULL THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  SELECT business_days_only, stale_followup_days, warn_ratio
    INTO v_bd_only, v_stale_days, v_warn FROM public.sales_engine_settings WHERE id;

  IF v_period = 'custom' AND _from IS NOT NULL THEN
    v_start := _from::timestamptz; v_end := (coalesce(_to, current_date) + 1)::timestamptz;
  ELSIF v_period = 'today' THEN
    v_start := date_trunc('day', now()); v_end := v_start + interval '1 day';
  ELSIF v_period = 'week' THEN
    v_start := date_trunc('week', now()); v_end := v_start + interval '1 week';
  ELSIF v_period = 'quarter' THEN
    v_start := date_trunc('quarter', now()); v_end := v_start + interval '3 months';
  ELSIF v_period = 'year' THEN
    v_start := date_trunc('year', now()); v_end := v_start + interval '1 year';
  ELSE
    v_period := 'month'; v_start := date_trunc('month', now()); v_end := v_start + interval '1 month';
  END IF;
  v_prev_start := v_start - (v_end - v_start);
  v_month_start := v_start::date;

  v_is_month := (v_start = date_trunc('month', v_start) AND v_end = v_start + interval '1 month');
  v_finished := v_end::date <= current_date;

  v_whole_months := (EXTRACT(year FROM v_end)::int * 12 + EXTRACT(month FROM v_end)::int)
                  - (EXTRACT(year FROM v_start)::int * 12 + EXTRACT(month FROM v_start)::int);
  v_days_in_month := EXTRACT(day FROM (date_trunc('month', v_start) + interval '1 month' - interval '1 day'))::int;
  IF v_whole_months >= 1 AND v_start = date_trunc('month', v_start) THEN
    v_months := v_whole_months;
    v_basis := CASE WHEN v_whole_months = 1 THEN 'Monthly quota'
                    ELSE v_whole_months || ' monthly quotas for this period' END;
  ELSE
    v_months := round((v_end::date - v_start::date)::numeric / v_days_in_month, 6);
    v_basis := 'Part-month reference from the monthly quota';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.staff_members WHERE manager_staff_id = v_me) INTO v_manages;

  IF v_scope = 'person' AND _staff IS NOT NULL THEN
    IF _staff <> v_me
       AND NOT public.has_role(auth.uid(),'admin')
       AND NOT public.has_role(auth.uid(),'super_admin')
       AND NOT EXISTS (
         WITH RECURSIVE line AS (
           SELECT id, 1 AS depth FROM public.staff_members WHERE manager_staff_id = v_me
           UNION ALL
           SELECT c2.id, l.depth+1 FROM public.staff_members c2 JOIN line l ON c2.manager_staff_id = l.id WHERE l.depth < 8
         ) SELECT 1 FROM line WHERE id = _staff)
    THEN RAISE EXCEPTION 'NOT_IN_YOUR_REPORTING_LINE'; END IF;
    v_ids := ARRAY[_staff];
    SELECT coalesce(preferred_name, full_name) INTO v_person_name FROM public.staff_members WHERE id = _staff;
  ELSIF v_scope = 'team' AND v_manages THEN
    WITH RECURSIVE line AS (
      SELECT id, 1 AS depth FROM public.staff_members WHERE manager_staff_id = v_me
      UNION ALL
      SELECT c3.id, l.depth+1 FROM public.staff_members c3 JOIN line l ON c3.manager_staff_id = l.id WHERE l.depth < 8
    )
    SELECT array_agg(DISTINCT id) INTO v_ids FROM (SELECT id FROM line UNION SELECT v_me) x;
  ELSE
    v_scope := 'mine'; v_ids := ARRAY[v_me];
  END IF;

  v_days_total := GREATEST((v_end::date - v_start::date), 1);
  v_days_elapsed := LEAST(GREATEST((current_date - v_start::date) + 1, 0), v_days_total);
  v_days_left := GREATEST(v_days_total - v_days_elapsed, 0);
  v_bd_total := GREATEST(public._sales_business_days(v_start::date, v_end::date), 1);
  v_bd_elapsed := LEAST(public._sales_business_days(v_start::date, LEAST(current_date + 1, v_end::date)), v_bd_total);
  v_bd_left := GREATEST(v_bd_total - v_bd_elapsed, 0);

  FOREACH v_id IN ARRAY v_ids LOOP
    v_agg := public._sales_person_figures(v_id, v_start, v_end, _include_test);
    v_pt := ((public.sales_target_for(v_id, v_month_start))->>'target_kes')::numeric * v_months;

    IF v_is_month AND v_finished AND NOT _include_test THEN
      SELECT * INTO c FROM public.sales_period_closures
       WHERE period_start = v_month_start AND staff_member_id = v_id;
      IF c.id IS NOT NULL THEN
        SELECT coalesce(sum(amount_kes),0) INTO v_adj
          FROM public.sales_period_adjustments WHERE closure_id = c.id;
        v_agg := c.snapshot || jsonb_build_object('revenue_won_kes', c.revenue_kes + v_adj);
        v_pt := c.target_kes;
        v_frozen := true;
        v_frozen_at := GREATEST(coalesce(v_frozen_at, c.closed_at), c.closed_at);
      END IF;
    END IF;

    v_target := v_target + coalesce(v_pt,0);
    v_revenue := v_revenue + coalesce((v_agg->>'revenue_won_kes')::numeric,0);
    v_won := v_won + coalesce((v_agg->>'won_count')::int,0);
    v_lost := v_lost + coalesce((v_agg->>'lost_count')::int,0);
    v_opens := v_opens + coalesce((v_agg->>'open_count')::int,0);
    v_open := v_open + coalesce((v_agg->>'open_pipeline_kes')::numeric,0);
    v_weighted := v_weighted + coalesce((v_agg->>'weighted_pipeline_kes')::numeric,0);
    v_closing := v_closing + coalesce((v_agg->>'closing_soon_count')::int,0);
    v_awaiting := v_awaiting + coalesce((v_agg->>'awaiting_customer_count')::int,0);
    v_stale := v_stale + coalesce((v_agg->>'stale_count')::int,0);
    IF v_agg->>'avg_deal_value_kes' IS NOT NULL THEN
      v_deal := v_deal + (v_agg->>'avg_deal_value_kes')::numeric; v_deal_n := v_deal_n + 1; END IF;
    IF v_agg->>'lead_to_close_days' IS NOT NULL THEN
      v_ltc := v_ltc + (v_agg->>'lead_to_close_days')::numeric; v_ltc_n := v_ltc_n + 1; END IF;

    SELECT count(*), count(*) FILTER (WHERE escalation_level = 1),
           count(*) FILTER (WHERE breached_at IS NOT NULL),
           count(*) FILTER (WHERE escalation_level >= 3)
      INTO p_open, p_warn, p_breach, p_esc
      FROM public.sales_sla_clocks
     WHERE staff_member_id = v_id AND completed_at IS NULL AND (_include_test OR NOT is_test);
    v_sla_open := v_sla_open + p_open; v_sla_warn := v_sla_warn + p_warn;
    v_sla_breach := v_sla_breach + p_breach; v_sla_esc := v_sla_esc + p_esc;

    v_reasons := '[]'::jsonb;
    IF coalesce(v_pt,0) > 0 THEN
      IF coalesce((v_agg->>'revenue_won_kes')::numeric,0) < coalesce(v_pt,0) * v_days_elapsed / v_days_total * 0.8
         AND v_days_elapsed::numeric / v_days_total >= 0.2 THEN
        v_reasons := v_reasons || jsonb_build_array('Behind the required pace');
      END IF;
      IF coalesce((v_agg->>'open_pipeline_kes')::numeric,0) <
         GREATEST(coalesce(v_pt,0) - coalesce((v_agg->>'revenue_won_kes')::numeric,0), 0) * 2 THEN
        v_reasons := v_reasons || jsonb_build_array('Pipeline coverage below 2x the remaining target');
      END IF;
    END IF;
    IF p_breach > 0 THEN v_reasons := v_reasons || jsonb_build_array(p_breach || ' service level breach(es)'); END IF;
    IF coalesce((v_agg->>'stale_count')::int,0) > 0 THEN
      v_reasons := v_reasons || jsonb_build_array((v_agg->>'stale_count') || ' overdue follow-up(s)'); END IF;

    SELECT jsonb_build_object(
      'staff_id', v_id,
      'name', coalesce(s.preferred_name, s.full_name),
      'position', p.title,
      'target_kes', round(coalesce(v_pt,0),0),
      'revenue_won_kes', coalesce((v_agg->>'revenue_won_kes')::numeric,0),
      'attainment_pct', CASE WHEN coalesce(v_pt,0) > 0
        THEN round((coalesce((v_agg->>'revenue_won_kes')::numeric,0) * 100) / v_pt, 1) END,
      'remaining_kes', round(GREATEST(coalesce(v_pt,0) - coalesce((v_agg->>'revenue_won_kes')::numeric,0), 0),0),
      'open_pipeline_kes', coalesce((v_agg->>'open_pipeline_kes')::numeric,0),
      'weighted_pipeline_kes', coalesce((v_agg->>'weighted_pipeline_kes')::numeric,0),
      'coverage_x', CASE WHEN GREATEST(coalesce(v_pt,0) - coalesce((v_agg->>'revenue_won_kes')::numeric,0), 0) > 0
        THEN round(coalesce((v_agg->>'open_pipeline_kes')::numeric,0)
             / GREATEST(coalesce(v_pt,0) - coalesce((v_agg->>'revenue_won_kes')::numeric,0), 1), 2) END,
      'win_rate_pct', v_agg->'win_rate_pct',
      'won_count', coalesce((v_agg->>'won_count')::int,0),
      'decided_count', coalesce((v_agg->>'decided_count')::int,0),
      'lead_to_close_days', v_agg->'lead_to_close_days',
      'sales_cycle_days', v_agg->'sales_cycle_days',
      'awaiting_customer_count', coalesce((v_agg->>'awaiting_customer_count')::int,0),
      'stale_count', coalesce((v_agg->>'stale_count')::int,0),
      'sla_open', p_open, 'sla_approaching', p_warn,
      'sla_breaches', p_breach, 'sla_escalated', p_esc,
      'intervention_reasons', v_reasons,
      'needs_intervention', jsonb_array_length(v_reasons) > 0,
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
  v_expected := CASE WHEN v_bd_only AND v_bd_total > 0 THEN v_target * v_bd_elapsed / v_bd_total
                     WHEN v_days_total > 0 THEN v_target * v_days_elapsed / v_days_total END;
  v_projected := CASE WHEN v_bd_only AND v_bd_elapsed > 0 THEN v_revenue * v_bd_total / v_bd_elapsed
                      WHEN v_days_elapsed > 0 THEN v_revenue * v_days_total / v_days_elapsed ELSE 0 END;
  v_elapsed_ratio := CASE WHEN v_days_total > 0 THEN v_days_elapsed::numeric / v_days_total ELSE 1 END;

  IF v_target = 0 THEN
    v_status := 'NO_TARGET'; v_status_reason := 'No sales quota is assigned for this period.';
  ELSIF v_revenue >= v_target THEN
    v_status := 'EXCEEDING_TARGET';
    v_status_reason := 'Revenue won has reached the target; surplus is counted above it.';
  ELSIF v_frozen THEN
    v_status := CASE WHEN v_revenue >= v_target * 0.8 THEN 'AT_RISK' ELSE 'BEHIND' END;
    v_status_reason := 'This period is closed; the final figures are fixed and cannot change.';
  ELSIF v_revenue >= coalesce(v_expected,0) THEN
    v_status := 'ON_PACE';
    v_status_reason := 'Revenue won is at or above what the elapsed selling days require.';
  ELSIF v_elapsed_ratio < 0.2 THEN
    v_status := 'ON_PACE';
    v_status_reason := 'Too early in the period to judge pace; the required daily rate is shown instead.';
  ELSIF v_projected >= v_target * 0.8 THEN
    v_status := 'AT_RISK';
    v_status_reason := 'At the current rate the projection lands within 20% of target — recoverable but at risk.';
  ELSE
    v_status := 'BEHIND';
    v_status_reason := 'At the current rate the projection falls more than 20% short of target.';
  END IF;

  RETURN jsonb_build_object(
    'scope', v_scope, 'can_view_team', v_manages, 'people', coalesce(array_length(v_ids,1),1),
    'person_staff_id', CASE WHEN v_scope = 'person' THEN _staff END,
    'person_name', v_person_name,
    'period', v_period, 'period_start', v_start, 'period_end', v_end,
    'include_test', _include_test,
    'frozen', v_frozen, 'frozen_at', v_frozen_at,
    'target_kes', v_target, 'target_basis', v_basis,
    'revenue_won_kes', v_revenue,
    'previous_revenue_kes', v_prev_revenue,
    'revenue_delta_pct', CASE WHEN v_prev_revenue > 0
      THEN round((v_revenue - v_prev_revenue) * 100 / v_prev_revenue, 1) END,
    'attainment_pct', CASE WHEN v_target > 0 THEN round(v_revenue * 100 / v_target, 1) END,
    'remaining_kes', v_remaining,
    'surplus_kes', GREATEST(v_revenue - v_target, 0),
    'status', v_status, 'status_reason', v_status_reason,
    'pacing', jsonb_build_object(
      'days_total', v_days_total, 'days_elapsed', v_days_elapsed, 'days_remaining', v_days_left,
      'business_days_only', v_bd_only,
      'selling_days_total', v_bd_total, 'selling_days_elapsed', v_bd_elapsed, 'selling_days_remaining', v_bd_left,
      'expected_to_date_kes', round(coalesce(v_expected,0),0),
      'pace_pct', CASE WHEN coalesce(v_expected,0) > 0 THEN round(v_revenue * 100 / v_expected, 1) END,
      'required_daily_pace_kes', CASE WHEN v_days_left > 0 THEN round(v_remaining / v_days_left, 0) ELSE v_remaining END,
      'required_selling_day_pace_kes', CASE WHEN v_bd_left > 0 THEN round(v_remaining / v_bd_left, 0) ELSE v_remaining END,
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
    'sla', jsonb_build_object(
      'open', v_sla_open, 'approaching', v_sla_warn, 'breached', v_sla_breach, 'escalated', v_sla_esc
    ),
    'actions', jsonb_build_object(
      'target_gap_kes', v_remaining, 'closing_soon_count', v_closing,
      'awaiting_customer_count', v_awaiting, 'overdue_followups_count', v_stale,
      'sla_breach_count', v_sla_breach,
      'forecast_revenue_kes', round(v_revenue + v_weighted, 0),
      'coverage_x', CASE WHEN v_remaining > 0 THEN round(v_open / v_remaining, 2) END
    ),
    'roster', v_people
  );
END $$;

REVOKE ALL ON FUNCTION public.commercial_target_dashboard(text, text, date, date, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_target_dashboard(text, text, date, date, boolean, uuid) TO authenticated;

-- 7. governance overview: periods, currencies, frozen months --------------
CREATE OR REPLACE FUNCTION public.sales_governance_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin boolean;
BEGIN
  v_admin := public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin');
  IF NOT v_admin THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;

  RETURN jsonb_build_object(
    'settings', (SELECT to_jsonb(s) FROM public.sales_engine_settings s WHERE s.id),
    'targets', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'scope', t.scope, 'period', t.period, 'amount_kes', t.amount_kes,
        'currency', t.currency,
        'position_code', t.position_code, 'staff_member_id', t.staff_member_id,
        'staff_name', coalesce(sm.preferred_name, sm.full_name),
        'effective_from', t.effective_from, 'effective_to', t.effective_to,
        'is_active', t.is_active, 'is_override', t.is_override, 'notes', t.notes
      ) ORDER BY t.is_active DESC, t.effective_from DESC), '[]'::jsonb)
      FROM public.sales_targets t LEFT JOIN public.staff_members sm ON sm.id = t.staff_member_id),
    'policies', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', pl.id, 'process', pl.process, 'label', pl.label, 'minutes', pl.minutes,
        'warn_ratio', pl.warn_ratio, 'pause_on_customer', pl.pause_on_customer,
        'is_active', pl.is_active, 'effective_from', pl.effective_from
      ) ORDER BY pl.process), '[]'::jsonb) FROM public.sales_sla_policies pl),
    'closures', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'period_start', c.period_start, 'period_end', c.period_end,
        'staff_member_id', c.staff_member_id,
        'staff_name', coalesce(sm.preferred_name, sm.full_name),
        'target_kes', c.target_kes, 'revenue_kes', c.revenue_kes,
        'adjustment_kes', (SELECT coalesce(sum(a.amount_kes),0) FROM public.sales_period_adjustments a WHERE a.closure_id = c.id),
        'attainment_pct', c.attainment_pct, 'won_count', c.won_count,
        'closed_at', c.closed_at
      ) ORDER BY c.period_start DESC, c.revenue_kes DESC), '[]'::jsonb)
      FROM public.sales_period_closures c LEFT JOIN public.staff_members sm ON sm.id = c.staff_member_id),
    'roster', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'staff_id', sm.id, 'name', coalesce(sm.preferred_name, sm.full_name),
        'position_code', op.code, 'position', op.title,
        'target_kes', ((public.sales_target_for(sm.id, date_trunc('month', now())::date))->>'target_kes')::numeric,
        'target_period', (public.sales_target_for(sm.id, date_trunc('month', now())::date))->>'period',
        'currency', (public.sales_target_for(sm.id, date_trunc('month', now())::date))->>'currency'
      ) ORDER BY coalesce(sm.preferred_name, sm.full_name)), '[]'::jsonb)
      FROM public.staff_members sm JOIN public.org_positions op ON op.id = sm.position_id
      WHERE sm.employment_status IN ('active','onboarding')
        AND op.code = ANY (public._sales_eligible_codes())),
    'positions', (SELECT coalesce(jsonb_agg(jsonb_build_object('code', op.code, 'title', op.title)
        ORDER BY op.code), '[]'::jsonb) FROM public.org_positions op),
    'audit', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'action', e.action, 'scope', e.scope, 'staff_member_id', e.staff_member_id,
        'before_value', e.before_value, 'after_value', e.after_value,
        'note', e.note, 'created_at', e.created_at) ORDER BY e.created_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM public.sales_target_events ORDER BY created_at DESC LIMIT 50) e)
  );
END $$;

REVOKE ALL ON FUNCTION public.sales_governance_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_governance_overview() TO authenticated;