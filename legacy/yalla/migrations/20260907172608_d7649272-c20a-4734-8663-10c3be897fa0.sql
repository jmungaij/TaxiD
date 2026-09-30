-- ============ 1. TARGET REGISTER =========================================
CREATE TABLE IF NOT EXISTS public.sales_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL CHECK (scope IN ('GLOBAL','UNIT','POSITION','STAFF')),
  staff_member_id uuid REFERENCES public.staff_members(id) ON DELETE CASCADE,
  position_code text,
  unit_id uuid REFERENCES public.org_units(id) ON DELETE CASCADE,
  period text NOT NULL DEFAULT 'MONTH' CHECK (period IN ('MONTH','QUARTER','YEAR')),
  amount_kes numeric(14,2) NOT NULL CHECK (amount_kes >= 0),
  currency text NOT NULL DEFAULT 'KES',
  effective_from date NOT NULL DEFAULT date_trunc('month', now())::date,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  is_override boolean NOT NULL DEFAULT false,
  notes text,
  set_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_targets_scope_key CHECK (
    (scope = 'GLOBAL'   AND staff_member_id IS NULL AND position_code IS NULL AND unit_id IS NULL) OR
    (scope = 'UNIT'     AND unit_id IS NOT NULL     AND staff_member_id IS NULL) OR
    (scope = 'POSITION' AND position_code IS NOT NULL AND staff_member_id IS NULL) OR
    (scope = 'STAFF'    AND staff_member_id IS NOT NULL)
  )
);
GRANT SELECT ON public.sales_targets TO authenticated;
GRANT ALL ON public.sales_targets TO service_role;
ALTER TABLE public.sales_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "targets readable by staff" ON public.sales_targets
  FOR SELECT TO authenticated USING (public._my_staff_member_id() IS NOT NULL);

CREATE INDEX IF NOT EXISTS sales_targets_lookup_idx
  ON public.sales_targets (scope, is_active, effective_from DESC);

CREATE TABLE IF NOT EXISTS public.sales_target_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_id uuid REFERENCES public.sales_targets(id) ON DELETE SET NULL,
  action text NOT NULL,
  scope text,
  staff_member_id uuid,
  before_value jsonb,
  after_value jsonb,
  actor_user_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sales_target_events TO authenticated;
GRANT ALL ON public.sales_target_events TO service_role;
ALTER TABLE public.sales_target_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "target audit readable by admins" ON public.sales_target_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE OR REPLACE FUNCTION public._sales_target_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'TARGET_AUDIT_IMMUTABLE'; END $$;
DROP TRIGGER IF EXISTS trg_sales_target_events_immutable ON public.sales_target_events;
CREATE TRIGGER trg_sales_target_events_immutable
  BEFORE UPDATE OR DELETE ON public.sales_target_events
  FOR EACH ROW EXECUTE FUNCTION public._sales_target_events_append_only();

CREATE OR REPLACE FUNCTION public._sales_targets_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_sales_targets_touch ON public.sales_targets;
CREATE TRIGGER trg_sales_targets_touch BEFORE UPDATE ON public.sales_targets
  FOR EACH ROW EXECUTE FUNCTION public._sales_targets_touch();

-- Canonical company default: KSh 3,000,000 per specialist per month.
INSERT INTO public.sales_targets (scope, period, amount_kes, currency, effective_from, notes)
SELECT 'GLOBAL','MONTH',3000000,'KES','2026-01-01',
       'Canonical monthly sales target per eligible sales specialist'
WHERE NOT EXISTS (SELECT 1 FROM public.sales_targets WHERE scope='GLOBAL');

-- ============ 2. LEAD LIFECYCLE TIMESTAMPS + TEST MARKER =================
ALTER TABLE public.sales_leads
  ADD COLUMN IF NOT EXISTS qualified_at timestamptz,
  ADD COLUMN IF NOT EXISTS proposal_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public._sales_lead_stage_stamps()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.stage IN ('QUALIFIED','OPPORTUNITY','QUOTED','ACCEPTED','BOOKED','FULFILLED','CLOSED_WON')
     AND NEW.qualified_at IS NULL THEN NEW.qualified_at := now(); END IF;
  IF NEW.stage IN ('QUOTED','ACCEPTED','BOOKED','FULFILLED','CLOSED_WON')
     AND NEW.proposal_sent_at IS NULL THEN NEW.proposal_sent_at := now(); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sales_lead_stage_stamps ON public.sales_leads;
CREATE TRIGGER trg_sales_lead_stage_stamps
  BEFORE INSERT OR UPDATE OF stage ON public.sales_leads
  FOR EACH ROW EXECUTE FUNCTION public._sales_lead_stage_stamps();

-- ============ 3. TARGET RESOLUTION =======================================
CREATE OR REPLACE FUNCTION public.sales_target_for(_staff uuid, _period_start date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_start date := coalesce(_period_start, date_trunc('month', now())::date);
  v_pos text; v_unit uuid; r record;
BEGIN
  SELECT p.code, s.unit_id INTO v_pos, v_unit
    FROM public.staff_members s
    LEFT JOIN public.org_positions p ON p.id = s.position_id
   WHERE s.id = _staff;

  SELECT t.*, CASE t.scope WHEN 'STAFF' THEN 4 WHEN 'POSITION' THEN 3 WHEN 'UNIT' THEN 2 ELSE 1 END AS rank
    INTO r
    FROM public.sales_targets t
   WHERE t.is_active
     AND t.period = 'MONTH'
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
    RETURN jsonb_build_object('target_kes', 0, 'currency','KES','source','NONE','target_id',NULL);
  END IF;

  RETURN jsonb_build_object(
    'target_kes', r.amount_kes, 'currency', r.currency, 'source', r.scope,
    'target_id', r.id, 'is_override', r.is_override,
    'effective_from', r.effective_from, 'period', r.period
  );
END $$;
REVOKE ALL ON FUNCTION public.sales_target_for(uuid, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sales_target_for(uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.sales_target_for(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.sales_target_set(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_scope text := upper(coalesce(p->>'scope','STAFF'));
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
  IF v_amount IS NULL OR v_amount < 0 THEN RAISE EXCEPTION 'INVALID_TARGET_AMOUNT'; END IF;

  SELECT * INTO v_prev FROM public.sales_targets
   WHERE is_active AND scope = v_scope AND period='MONTH'
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
  VALUES (v_scope, v_staff, v_pos, v_unit, 'MONTH', v_amount,
          coalesce(p->>'currency','KES'), v_from, coalesce((p->>'is_override')::boolean,false),
          p->>'notes', auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.sales_target_events
    (target_id, action, scope, staff_member_id, before_value, after_value, actor_user_id, note)
  VALUES (v_id, CASE WHEN v_prev.id IS NULL THEN 'TARGET_CREATED' ELSE 'TARGET_CHANGED' END,
          v_scope, v_staff,
          CASE WHEN v_prev.id IS NULL THEN NULL
               ELSE jsonb_build_object('amount_kes', v_prev.amount_kes, 'effective_from', v_prev.effective_from) END,
          jsonb_build_object('amount_kes', v_amount, 'effective_from', v_from),
          auth.uid(), p->>'notes');

  RETURN jsonb_build_object('target_id', v_id, 'amount_kes', v_amount, 'effective_from', v_from);
END $$;
REVOKE ALL ON FUNCTION public.sales_target_set(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sales_target_set(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.sales_target_set(jsonb) TO authenticated;

-- ============ 4. PER-PERSON COMMERCIAL FIGURES ===========================
-- Stage weighting for weighted pipeline (probability by pipeline stage).
CREATE OR REPLACE FUNCTION public._sales_stage_probability(_stage text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _stage
    WHEN 'NEW' THEN 0.05 WHEN 'QUALIFIED' THEN 0.15 WHEN 'OPPORTUNITY' THEN 0.30
    WHEN 'QUOTED' THEN 0.50 WHEN 'ACCEPTED' THEN 0.80 WHEN 'BOOKED' THEN 0.90
    WHEN 'FULFILLED' THEN 0.95 ELSE 0 END::numeric
$$;
REVOKE ALL ON FUNCTION public._sales_stage_probability(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._sales_stage_probability(text) TO authenticated;

CREATE OR REPLACE FUNCTION public._sales_person_figures(
  _staff uuid, _from timestamptz, _to timestamptz, _include_test boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_won int := 0; v_lost int := 0; v_open int := 0;
  v_revenue numeric := 0; v_open_value numeric := 0; v_weighted numeric := 0;
  v_avg_deal numeric; v_lead_to_close numeric; v_qual numeric; v_cycle numeric; v_prop numeric;
  v_closing_soon int := 0; v_awaiting int := 0; v_stale int := 0;
BEGIN
  -- Revenue Won: qualifying closed-won leads owned by this person whose close
  -- date falls inside the period. Open, quoted, lost and cancelled never count.
  SELECT
    count(*) FILTER (WHERE stage='CLOSED_WON'),
    coalesce(sum(estimated_value_kes) FILTER (WHERE stage='CLOSED_WON'),0),
    avg(estimated_value_kes) FILTER (WHERE stage='CLOSED_WON' AND estimated_value_kes IS NOT NULL),
    avg(EXTRACT(epoch FROM (closed_at - created_at))/86400.0) FILTER (WHERE stage='CLOSED_WON'),
    avg(EXTRACT(epoch FROM (qualified_at - created_at))/86400.0) FILTER (WHERE stage='CLOSED_WON' AND qualified_at IS NOT NULL),
    avg(EXTRACT(epoch FROM (closed_at - qualified_at))/86400.0) FILTER (WHERE stage='CLOSED_WON' AND qualified_at IS NOT NULL),
    avg(EXTRACT(epoch FROM (closed_at - proposal_sent_at))/86400.0) FILTER (WHERE stage='CLOSED_WON' AND proposal_sent_at IS NOT NULL)
  INTO v_won, v_revenue, v_avg_deal, v_lead_to_close, v_qual, v_cycle, v_prop
  FROM public.sales_leads
  WHERE sales_staff_id = _staff AND (_include_test OR NOT is_test)
    AND closed_at >= _from AND closed_at < _to;

  SELECT count(*) INTO v_lost FROM public.sales_leads
   WHERE sales_staff_id = _staff AND (_include_test OR NOT is_test)
     AND stage IN ('CLOSED_LOST','DISQUALIFIED') AND closed_at >= _from AND closed_at < _to;

  -- Pipeline is a position, not a period: everything still open right now.
  SELECT count(*), coalesce(sum(estimated_value_kes),0),
         coalesce(sum(coalesce(estimated_value_kes,0) * public._sales_stage_probability(stage)),0),
         count(*) FILTER (WHERE stage IN ('ACCEPTED','BOOKED','FULFILLED')),
         count(*) FILTER (WHERE coalesce(information_request,'') <> ''),
         count(*) FILTER (WHERE updated_at < now() - interval '7 days')
    INTO v_open, v_open_value, v_weighted, v_closing_soon, v_awaiting, v_stale
    FROM public.sales_leads
   WHERE sales_staff_id = _staff AND (_include_test OR NOT is_test)
     AND stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED');

  RETURN jsonb_build_object(
    'staff_id', _staff,
    'revenue_won_kes', v_revenue,
    'won_count', v_won,
    'lost_count', v_lost,
    'decided_count', v_won + v_lost,
    'open_count', v_open,
    'open_pipeline_kes', v_open_value,
    'weighted_pipeline_kes', round(v_weighted,0),
    'win_rate_pct', CASE WHEN (v_won+v_lost)>0 THEN round(v_won::numeric*100/(v_won+v_lost),1) END,
    'avg_deal_value_kes', CASE WHEN v_avg_deal IS NOT NULL THEN round(v_avg_deal,0) END,
    'lead_to_close_days', CASE WHEN v_lead_to_close IS NOT NULL THEN round(v_lead_to_close,1) END,
    'qualification_days', CASE WHEN v_qual IS NOT NULL THEN round(v_qual,1) END,
    'sales_cycle_days', CASE WHEN v_cycle IS NOT NULL THEN round(v_cycle,1) END,
    'proposal_to_close_days', CASE WHEN v_prop IS NOT NULL THEN round(v_prop,1) END,
    'closing_soon_count', v_closing_soon,
    'awaiting_customer_count', v_awaiting,
    'stale_count', v_stale
  );
END $$;
REVOKE ALL ON FUNCTION public._sales_person_figures(uuid, timestamptz, timestamptz, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._sales_person_figures(uuid, timestamptz, timestamptz, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public._sales_person_figures(uuid, timestamptz, timestamptz, boolean) TO authenticated;

-- ============ 5. TARGET DASHBOARD ========================================
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
  v_month_start date; v_months numeric;
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

  -- Period window (time intelligence). Default: current month.
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
  -- Number of monthly targets the window spans (target effective in-period).
  v_months := greatest(round(EXTRACT(epoch FROM (v_end - v_start))/2629746.0, 4), 0.0001);

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
      'target_kes', coalesce(v_pt,0),
      'revenue_won_kes', (v_agg->>'revenue_won_kes')::numeric,
      'attainment_pct', CASE WHEN coalesce(v_pt,0) > 0
        THEN round(((v_agg->>'revenue_won_kes')::numeric * 100) / v_pt, 1) END,
      'remaining_kes', GREATEST(coalesce(v_pt,0) - (v_agg->>'revenue_won_kes')::numeric, 0),
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