DO $e$ BEGIN CREATE TYPE public.wallet_lifecycle_status AS ENUM ('ACTIVE','CLOSED'); EXCEPTION WHEN duplicate_object THEN NULL; END $e$;
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS lifecycle_status public.wallet_lifecycle_status NOT NULL DEFAULT 'ACTIVE';
DO $c$ BEGIN IF to_regclass('public.carrier_profiles') IS NOT NULL THEN ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS carrier_id uuid REFERENCES public.carrier_profiles(id) ON DELETE SET NULL; ELSE ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS carrier_id uuid; END IF; END $c$;
DO $do0$ BEGIN EXECUTE $w0q$CREATE OR REPLACE FUNCTION public.commercial_qualifying_revenue(
  _staff uuid, _from timestamptz, _to timestamptz, _include_test boolean DEFAULT false)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_basis text; v_total numeric := 0;
BEGIN
  SELECT coalesce(revenue_basis,'RECOGNISED') INTO v_basis FROM public.sales_engine_settings LIMIT 1;

  IF v_basis = 'CLOSED_WON' THEN
    SELECT coalesce(sum(estimated_value_kes),0) INTO v_total FROM public.sales_leads
     WHERE sales_staff_id = _staff AND stage='CLOSED_WON'
       AND (_include_test OR NOT is_test) AND closed_at >= _from AND closed_at < _to;
  ELSIF v_basis = 'COLLECTED' THEN
    SELECT coalesce(sum(coalesce(collected_value_kes, recognised_value_kes, 0)),0) INTO v_total
      FROM public.commercial_lifecycle
     WHERE staff_member_id = _staff AND (_include_test OR NOT is_test)
       AND collected_at >= _from AND collected_at < _to;
  ELSE
    SELECT coalesce(sum(coalesce(recognised_value_kes, opportunity_value_kes, 0)),0) INTO v_total
      FROM public.commercial_lifecycle
     WHERE staff_member_id = _staff AND (_include_test OR NOT is_test)
       AND recognised_at >= _from AND recognised_at < _to;
  END IF;
  RETURN v_total;
END $$;$w0q$; INSERT INTO public._restore_log VALUES('commercial_qualifying_revenue',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('commercial_qualifying_revenue',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do0$;
DO $do1$ BEGIN EXECUTE $w1q$CREATE OR REPLACE FUNCTION public._sales_person_figures(
  _staff uuid, _from timestamptz, _to timestamptz, _include_test boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public' AS $function$
DECLARE
  v_won int := 0; v_lost int := 0; v_open int := 0;
  v_revenue numeric := 0; v_open_value numeric := 0; v_weighted numeric := 0;
  v_avg_deal numeric; v_lead_to_close numeric; v_qual numeric; v_cycle numeric; v_prop numeric;
  v_closing_soon int := 0; v_awaiting int := 0; v_stale int := 0;
  v_qualifying numeric := 0; v_basis text; v_contracted numeric := 0; v_invoiced numeric := 0;
BEGIN
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

  SELECT count(*), coalesce(sum(estimated_value_kes),0),
         coalesce(sum(coalesce(estimated_value_kes,0) * public._sales_stage_probability(stage)),0),
         count(*) FILTER (WHERE stage IN ('ACCEPTED','BOOKED','FULFILLED')),
         count(*) FILTER (WHERE coalesce(information_request,'') <> ''),
         count(*) FILTER (WHERE updated_at < now() - interval '7 days')
    INTO v_open, v_open_value, v_weighted, v_closing_soon, v_awaiting, v_stale
    FROM public.sales_leads
   WHERE sales_staff_id = _staff AND (_include_test OR NOT is_test)
     AND stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED');

  -- Won is not revenue: qualifying revenue comes from the commercial lifecycle,
  -- anchored on the date the recognition state was reached.
  SELECT coalesce(revenue_basis,'RECOGNISED') INTO v_basis FROM public.sales_engine_settings LIMIT 1;
  v_qualifying := public.commercial_qualifying_revenue(_staff, _from, _to, _include_test);

  SELECT coalesce(sum(contracted_value_kes),0), coalesce(sum(invoiced_value_kes),0)
    INTO v_contracted, v_invoiced
    FROM public.commercial_lifecycle
   WHERE staff_member_id = _staff AND (_include_test OR NOT is_test)
     AND current_state NOT IN ('LOST','CANCELLED');

  RETURN jsonb_build_object(
    'staff_id', _staff,
    'revenue_basis', coalesce(v_basis,'RECOGNISED'),
    'revenue_won_kes', CASE WHEN coalesce(v_basis,'RECOGNISED')='CLOSED_WON' THEN v_revenue ELSE v_qualifying END,
    'qualifying_revenue_kes', v_qualifying,
    'commercially_won_kes', v_revenue,
    'contracted_value_kes', v_contracted,
    'invoiced_not_recognised_kes', greatest(v_invoiced - v_qualifying, 0),
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
END $function$;$w1q$; INSERT INTO public._restore_log VALUES('_sales_person_figures',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('_sales_person_figures',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do1$;
DO $do2$ BEGIN EXECUTE $w2q$CREATE OR REPLACE FUNCTION public._my_staff_member_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.staff_members WHERE user_id = auth.uid() LIMIT 1
$$;$w2q$; INSERT INTO public._restore_log VALUES('_my_staff_member_id',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('_my_staff_member_id',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do2$;
DO $do3$ BEGIN EXECUTE $w3q$CREATE OR REPLACE FUNCTION public._sales_work_ensure(
  _staff uuid, _kind text, _title text, _description text,
  _source_table text, _source_id uuid, _entity_ref text,
  _priority text, _sla_minutes int)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF _staff IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM public.staff_work_items
   WHERE source_table = _source_table AND source_id = _source_id
     AND work_kind = _kind AND staff_id = _staff
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.staff_work_items
       SET title = _title, description = _description, entity_ref = coalesce(_entity_ref, entity_ref),
           priority = coalesce(_priority, priority),
           status = CASE WHEN status IN ('done','cancelled') THEN 'open' ELSE status END,
           lifecycle_state = CASE WHEN lifecycle_state IN ('resolved','closed') THEN 'assigned' ELSE lifecycle_state END,
           closed_at = NULL, resolution = NULL,
           sla_minutes = coalesce(_sla_minutes, sla_minutes),
           sla_due_at = CASE WHEN _sla_minutes IS NOT NULL THEN now() + make_interval(mins => _sla_minutes) ELSE sla_due_at END,
           updated_at = now()
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.staff_work_items
    (staff_id, work_kind, title, description, source_table, source_id, entity_type, entity_id,
     entity_ref, priority, status, lifecycle_state, ops_queue, sla_started_at, sla_minutes,
     sla_due_at, next_action_due)
  VALUES (_staff, _kind, _title, _description, _source_table, _source_id, 'sales_lead', _source_id,
     _entity_ref, coalesce(_priority,'medium'), 'open', 'assigned', 'commercial', now(), _sla_minutes,
     CASE WHEN _sla_minutes IS NOT NULL THEN now() + make_interval(mins => _sla_minutes) END,
     CASE WHEN _sla_minutes IS NOT NULL THEN (now() + make_interval(mins => _sla_minutes))::date END)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;$w3q$; INSERT INTO public._restore_log VALUES('_sales_work_ensure',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('_sales_work_ensure',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do3$;
DO $do4$ BEGIN EXECUTE $w4q$CREATE OR REPLACE FUNCTION public.sales_target_for(_staff uuid, _period_start date DEFAULT NULL)
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
END $$;$w4q$; INSERT INTO public._restore_log VALUES('sales_target_for',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('sales_target_for',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do4$;
DO $do5$ BEGIN EXECUTE $w5q$CREATE OR REPLACE FUNCTION public._sales_day_movements(_staff uuid, _from timestamptz, _to timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH ev AS (
    SELECT l.lead_ref, l.organisation_name, e.action, e.stage_from, e.stage_to, e.note, e.created_at AS at
      FROM public.sales_lead_events e
      JOIN public.sales_leads l ON l.id = e.lead_id
     WHERE l.sales_staff_id = _staff AND NOT l.is_test
       AND e.created_at >= _from AND e.created_at < _to
    UNION ALL
    -- Records entered directly, with no history row written.
    SELECT l.lead_ref, l.organisation_name, 'CREATED', NULL, NULL, l.notes, l.created_at
      FROM public.sales_leads l
     WHERE l.sales_staff_id = _staff AND NOT l.is_test
       AND l.created_at >= _from AND l.created_at < _to
       AND NOT EXISTS (SELECT 1 FROM public.sales_lead_events e
                        WHERE e.lead_id = l.id AND e.action = 'CREATED'
                          AND e.created_at >= _from AND e.created_at < _to)
    UNION ALL
    SELECT l.lead_ref, l.organisation_name, 'QUALIFIED', NULL, 'QUALIFIED', NULL, l.qualified_at
      FROM public.sales_leads l
     WHERE l.sales_staff_id = _staff AND NOT l.is_test
       AND l.qualified_at >= _from AND l.qualified_at < _to
    UNION ALL
    SELECT l.lead_ref, l.organisation_name, 'PROPOSAL_SENT', NULL, 'QUOTED', NULL, l.proposal_sent_at
      FROM public.sales_leads l
     WHERE l.sales_staff_id = _staff AND NOT l.is_test
       AND l.proposal_sent_at >= _from AND l.proposal_sent_at < _to
    UNION ALL
    SELECT l.lead_ref, l.organisation_name, 'CLOSED', NULL, l.stage, l.lost_reason, l.closed_at
      FROM public.sales_leads l
     WHERE l.sales_staff_id = _staff AND NOT l.is_test
       AND l.closed_at >= _from AND l.closed_at < _to
  )
  SELECT jsonb_build_object(
    'leads_created', count(*) FILTER (WHERE action = 'CREATED'),
    'stages_advanced', count(*) FILTER (WHERE stage_to IS NOT NULL AND stage_from IS DISTINCT FROM stage_to),
    'information_requests', count(*) FILTER (WHERE action = 'INFORMATION_REQUESTED'),
    'notes_recorded', count(*) FILTER (WHERE action NOT IN ('CREATED','INFORMATION_REQUESTED') AND stage_to IS NULL),
    'movements', coalesce(jsonb_agg(jsonb_build_object(
        'lead_ref', lead_ref, 'organisation', organisation_name, 'action', action,
        'stage_from', stage_from, 'stage_to', stage_to, 'note', note, 'at', at
      ) ORDER BY at) FILTER (WHERE at IS NOT NULL), '[]'::jsonb)
  )
  FROM ev;
$function$;$w5q$; INSERT INTO public._restore_log VALUES('_sales_day_movements',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('_sales_day_movements',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do5$;
DO $do6$ BEGIN EXECUTE $w6q$CREATE OR REPLACE FUNCTION public._sales_stage_probability(_stage text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _stage
    WHEN 'NEW' THEN 0.05 WHEN 'QUALIFIED' THEN 0.15 WHEN 'OPPORTUNITY' THEN 0.30
    WHEN 'QUOTED' THEN 0.50 WHEN 'ACCEPTED' THEN 0.80 WHEN 'BOOKED' THEN 0.90
    WHEN 'FULFILLED' THEN 0.95 ELSE 0 END::numeric
$$;$w6q$; INSERT INTO public._restore_log VALUES('_sales_stage_probability',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('_sales_stage_probability',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do6$;
DO $do7$ BEGIN EXECUTE $w7q$CREATE OR REPLACE FUNCTION public._sales_day_contracts(
  _staff uuid,
  _day_start timestamptz,
  _day_end timestamptz,
  _month_start date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_month_end date := (_month_start + interval '1 month')::date;
  v_signed_today int := 0;
  v_activated_today int := 0;
  v_rev_today numeric := 0;
  v_rev_month numeric := 0;
  v_awaiting_signature int := 0;
  v_awaiting_activation int := 0;
  v_activated_month int := 0;
  v_pending_value numeric := 0;
  v_list jsonb := '[]'::jsonb;
  v_waiting jsonb := '[]'::jsonb;
BEGIN
  SELECT
    count(*) FILTER (WHERE c.signature_date = (_day_start AT TIME ZONE 'Africa/Nairobi')::date),
    count(*) FILTER (WHERE c.activated_at >= _day_start AND c.activated_at < _day_end),
    count(*) FILTER (WHERE c.activated_at >= _month_start::timestamptz AND c.activated_at < v_month_end::timestamptz),
    count(*) FILTER (WHERE c.activated_at IS NULL AND c.status = ANY (ARRAY[
      'shared','sent_to_customer','customer_review','under_negotiation','signature_pending','partially_signed'])),
    count(*) FILTER (WHERE c.activated_at IS NULL AND c.status = ANY (ARRAY[
      'customer_accepted','executed','contracted'])),
    coalesce(sum(c.value_amount) FILTER (WHERE c.activated_at IS NULL AND c.status = ANY (ARRAY[
      'customer_accepted','executed','contracted'])), 0)
    INTO v_signed_today, v_activated_today, v_activated_month,
         v_awaiting_signature, v_awaiting_activation, v_pending_value
    FROM public.commercial_contract_instances c
   WHERE c.owner_staff_id = _staff AND NOT c.is_test;

  SELECT
    coalesce(sum(e.amount) FILTER (WHERE e.created_at >= _day_start AND e.created_at < _day_end), 0),
    coalesce(sum(e.amount) FILTER (WHERE e.execution_date >= _month_start AND e.execution_date < v_month_end), 0)
    INTO v_rev_today, v_rev_month
    FROM public.contract_revenue_events e
    JOIN public.commercial_contract_instances c ON c.id = e.contract_id
   WHERE NOT c.is_test
     AND (e.staff_member_id = _staff OR c.owner_staff_id = _staff);

  -- contracts activated this month, newest first
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'activated_at' DESC), '[]'::jsonb)
    INTO v_list
    FROM (
      SELECT jsonb_build_object(
               'contract_id', c.id,
               'contract_number', c.contract_number,
               'organisation', coalesce(a.name, a.legal_name, c.customer_legal_name),
               'status', c.status,
               'value_kes', c.value_amount,
               'currency', c.currency,
               'activated_at', c.activated_at,
               'revenue_recorded_kes', (
                 SELECT coalesce(sum(e.amount), 0) FROM public.contract_revenue_events e
                  WHERE e.contract_id = c.id)
             ) AS x
        FROM public.commercial_contract_instances c
        LEFT JOIN public.crm_accounts a ON a.id = c.account_id
       WHERE c.owner_staff_id = _staff AND NOT c.is_test
         AND c.activated_at >= _month_start::timestamptz
         AND c.activated_at < v_month_end::timestamptz
       ORDER BY c.activated_at DESC
       LIMIT 10
    ) s;

  -- what the contract book is waiting on
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb)
    INTO v_waiting
    FROM (
      SELECT jsonb_build_object(
               'contract_id', c.id,
               'contract_number', c.contract_number,
               'organisation', coalesce(a.name, a.legal_name, c.customer_legal_name),
               'status', c.status,
               'value_kes', c.value_amount,
               'waiting_on', CASE
                 WHEN c.status = ANY (ARRAY['customer_accepted','executed','contracted'])
                   THEN 'Signed — waiting for activation'
                 ELSE 'Waiting for the signed copy' END
             ) AS x
        FROM public.commercial_contract_instances c
        LEFT JOIN public.crm_accounts a ON a.id = c.account_id
       WHERE c.owner_staff_id = _staff AND NOT c.is_test
         AND c.activated_at IS NULL
         AND c.status = ANY (ARRAY['shared','sent_to_customer','customer_review','under_negotiation',
                                   'signature_pending','partially_signed','customer_accepted',
                                   'executed','contracted'])
       ORDER BY c.value_amount DESC NULLS LAST, c.updated_at DESC
       LIMIT 10
    ) s;

  RETURN jsonb_build_object(
    'signed_today', v_signed_today,
    'activated_today', v_activated_today,
    'activated_this_month', v_activated_month,
    'revenue_recorded_today_kes', v_rev_today,
    'revenue_recorded_month_kes', v_rev_month,
    'awaiting_signature', v_awaiting_signature,
    'awaiting_activation', v_awaiting_activation,
    'awaiting_activation_value_kes', v_pending_value,
    'activated', v_list,
    'waiting', v_waiting
  );
END $function$;$w7q$; INSERT INTO public._restore_log VALUES('_sales_day_contracts',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('_sales_day_contracts',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do7$;
DO $do8$ BEGIN EXECUTE $w8q$CREATE OR REPLACE FUNCTION public.sales_day_close(_staff uuid DEFAULT NULL, _materialise boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid; v_target uuid; v_allowed boolean := false;
  v_name text; v_pos text;
  v_day_start timestamptz; v_day_end timestamptz;
  v_month_start date;
  v_today jsonb;
  v_won_today numeric := 0; v_won_today_n int := 0;
  v_clocks_done int := 0;
  v_figures jsonb; v_target_row jsonb;
  v_target_kes numeric; v_attain numeric;
  v_sla jsonb; v_open int := 0; v_appr int := 0; v_breach int := 0; v_esc int := 0;
  v_actions jsonb; v_created_tasks int := 0; r record;
  v_contracts jsonb;
BEGIN
  v_me := public._my_staff_member_id();
  IF v_me IS NULL THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  v_target := coalesce(_staff, v_me);

  IF v_target = v_me THEN
    v_allowed := true;
  ELSIF public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin') THEN
    v_allowed := true;
  ELSE
    WITH RECURSIVE line AS (
      SELECT id, 1 d FROM public.staff_members WHERE manager_staff_id = v_me
      UNION ALL SELECT c.id, l.d+1 FROM public.staff_members c JOIN line l ON c.manager_staff_id = l.id WHERE l.d < 8)
    SELECT EXISTS (SELECT 1 FROM line WHERE id = v_target) INTO v_allowed;
  END IF;
  IF NOT v_allowed THEN RAISE EXCEPTION 'NOT_IN_YOUR_REPORTING_LINE'; END IF;

  SELECT coalesce(sm.preferred_name, sm.full_name), p.title
    INTO v_name, v_pos
    FROM public.staff_members sm
    LEFT JOIN public.org_positions p ON p.id = sm.position_id
   WHERE sm.id = v_target;

  v_day_start := (date_trunc('day', now() AT TIME ZONE 'Africa/Nairobi')) AT TIME ZONE 'Africa/Nairobi';
  v_day_end   := v_day_start + interval '1 day';
  v_month_start := date_trunc('month', now() AT TIME ZONE 'Africa/Nairobi')::date;

  v_today := public._sales_day_movements(v_target, v_day_start, v_day_end);

  SELECT count(*), coalesce(sum(estimated_value_kes),0)
    INTO v_won_today_n, v_won_today
    FROM public.sales_leads
   WHERE sales_staff_id = v_target AND NOT is_test AND stage = 'CLOSED_WON'
     AND closed_at >= v_day_start AND closed_at < v_day_end;

  SELECT count(*) INTO v_clocks_done
    FROM public.sales_sla_clocks
   WHERE staff_member_id = v_target AND NOT is_test
     AND completed_at >= v_day_start AND completed_at < v_day_end;

  v_figures := public._sales_person_figures(v_target, v_month_start::timestamptz,
                 (v_month_start + interval '1 month')::timestamptz, false);
  v_target_row := public.sales_target_for(v_target, v_month_start);
  v_target_kes := nullif((v_target_row->>'target_kes')::numeric, 0);
  IF v_target_kes IS NOT NULL THEN
    v_attain := round((v_figures->>'revenue_won_kes')::numeric * 100 / v_target_kes, 1);
  END IF;

  v_contracts := public._sales_day_contracts(v_target, v_day_start, v_day_end, v_month_start);

  SELECT count(*),
         count(*) FILTER (WHERE c.breached_at IS NULL AND c.due_at <= now() + make_interval(mins => greatest(1, round(c.sla_minutes * 0.25)::int))),
         count(*) FILTER (WHERE c.breached_at IS NOT NULL),
         count(*) FILTER (WHERE c.escalation_level > 0)
    INTO v_open, v_appr, v_breach, v_esc
    FROM public.sales_sla_clocks c
   WHERE c.staff_member_id = v_target AND NOT c.is_test AND c.completed_at IS NULL;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'process', c.process, 'entity_ref', c.entity_ref, 'organisation', l.organisation_name,
           'due_at', c.due_at, 'breached', c.breached_at IS NOT NULL,
           'escalation_level', c.escalation_level,
           'minutes_remaining', round(EXTRACT(epoch FROM (c.due_at - now()))/60)::int
         ) ORDER BY c.due_at), '[]'::jsonb)
    INTO v_sla
    FROM public.sales_sla_clocks c
    LEFT JOIN public.sales_leads l ON l.id = c.entity_id AND c.entity_type = 'sales_lead'
   WHERE c.staff_member_id = v_target AND NOT c.is_test AND c.completed_at IS NULL;

  WITH open_leads AS (
    SELECT l.*,
           coalesce(l.estimated_value_kes,0) * public._sales_stage_probability(l.stage) AS weighted,
           (SELECT min(c.due_at) FROM public.sales_sla_clocks c
             WHERE c.entity_id = l.id AND c.entity_type='sales_lead' AND c.completed_at IS NULL) AS due_at,
           (SELECT bool_or(c.breached_at IS NOT NULL) FROM public.sales_sla_clocks c
             WHERE c.entity_id = l.id AND c.entity_type='sales_lead' AND c.completed_at IS NULL) AS breached,
           EXTRACT(day FROM now() - l.updated_at)::int AS idle_days
      FROM public.sales_leads l
     WHERE l.sales_staff_id = v_target AND NOT l.is_test
       AND l.stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')
  ), ranked AS (
    SELECT o.*,
      CASE
        WHEN o.breached THEN 'Response time already breached — clear it first'
        WHEN o.due_at IS NOT NULL AND o.due_at <= now() + interval '4 hours' THEN 'Response due within four hours'
        WHEN coalesce(o.information_request,'') <> '' THEN 'Waiting on information you asked the customer for'
        WHEN o.stage IN ('QUOTED','ACCEPTED') AND o.weighted > 0 THEN 'Closest to a decision and carries value'
        WHEN o.idle_days >= 7 THEN 'No movement for ' || o.idle_days || ' days'
        WHEN o.stage = 'NEW' THEN 'New enquiry not yet qualified'
        ELSE 'Open in your pipeline'
      END AS why,
      (CASE WHEN o.breached THEN 1000 ELSE 0 END
       + CASE WHEN o.due_at IS NOT NULL AND o.due_at <= now() + interval '4 hours' THEN 600 ELSE 0 END
       + CASE WHEN o.stage IN ('QUOTED','ACCEPTED') THEN 250 ELSE 0 END
       + CASE WHEN o.stage = 'QUALIFIED' THEN 120 ELSE 0 END
       + least(300, coalesce(o.weighted,0)/10000)
       + least(120, o.idle_days * 8)
       + CASE WHEN coalesce(o.information_request,'') <> '' THEN 80 ELSE 0 END) AS score
      FROM open_leads o
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'lead_id', id, 'lead_ref', lead_ref, 'organisation', organisation_name,
           'stage', stage, 'value_kes', estimated_value_kes,
           'weighted_kes', round(weighted,0), 'why', why, 'due_at', due_at,
           'breached', coalesce(breached,false), 'idle_days', idle_days,
           'score', round(score)) ORDER BY rn), '[]'::jsonb)
    INTO v_actions
    FROM (
      SELECT *, row_number() OVER (
               ORDER BY score DESC,
                        due_at ASC NULLS LAST,
                        coalesce(weighted,0) DESC,
                        created_at ASC) AS rn
        FROM ranked
    ) t
   WHERE rn <= 10;

  IF _materialise THEN
    FOR r IN SELECT * FROM jsonb_array_elements(v_actions) WITH ORDINALITY AS x(a, n) WHERE x.n <= 3
    LOOP
      PERFORM public._sales_work_ensure(
        v_target, 'sales_next_best_action',
        'Next best action: ' || coalesce(r.a->>'organisation','a customer'),
        (r.a->>'why') || ' — ' || coalesce(r.a->>'lead_ref',''),
        'sales_leads', (r.a->>'lead_id')::uuid, r.a->>'lead_ref',
        CASE WHEN (r.a->>'breached')::boolean THEN 'high' ELSE 'medium' END,
        NULL);
      v_created_tasks := v_created_tasks + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'staff_id', v_target, 'staff_name', v_name, 'position', v_pos,
    'date', (now() AT TIME ZONE 'Africa/Nairobi')::date,
    'today', v_today || jsonb_build_object(
      'clocks_completed', v_clocks_done,
      'won_count', v_won_today_n, 'revenue_won_kes', v_won_today,
      'contracts_signed', (v_contracts->>'signed_today')::int,
      'contracts_activated', (v_contracts->>'activated_today')::int,
      'contract_revenue_kes', (v_contracts->>'revenue_recorded_today_kes')::numeric),
    'month', jsonb_build_object(
      'period_start', v_month_start,
      'target_kes', v_target_kes, 'target_source', v_target_row->>'source',
      'currency', v_target_row->>'currency',
      'attainment_pct', v_attain,
      'remaining_kes', CASE WHEN v_target_kes IS NOT NULL
        THEN greatest(0, v_target_kes - (v_figures->>'revenue_won_kes')::numeric) END,
      'figures', v_figures),
    'contracts', v_contracts,
    'sla', jsonb_build_object('open', v_open, 'approaching', v_appr, 'breached', v_breach,
                              'escalated', v_esc, 'clocks', v_sla),
    'next_actions', v_actions,
    'tasks_placed', v_created_tasks
  );
END $function$;$w8q$; INSERT INTO public._restore_log VALUES('sales_day_close',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('sales_day_close',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do8$;
DO $do9$ BEGIN EXECUTE $w9q$CREATE OR REPLACE FUNCTION public.work_dispositions_outstanding(_business_date date DEFAULT NULL)
RETURNS TABLE (work_item_id uuid, title text, work_kind text, priority_band text, effort_minutes integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT w.id, w.title, w.work_kind, w.priority_band, w.effort_minutes
    FROM public.staff_work_items w
    JOIN public.staff_members m ON m.id = w.staff_id
   WHERE m.user_id = auth.uid()
     AND w.status NOT IN ('done','cancelled')
     AND NOT EXISTS (
       SELECT 1 FROM public.work_disposition_events d
        WHERE d.work_item_id = w.id
          AND d.business_date = coalesce(_business_date, (now() AT TIME ZONE 'Africa/Nairobi')::date))
   ORDER BY w.priority_band, w.sla_due_at NULLS LAST;
$$;$w9q$; INSERT INTO public._restore_log VALUES('work_dispositions_outstanding',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('work_dispositions_outstanding',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do9$;
DO $do10$ BEGIN EXECUTE $w10q$CREATE OR REPLACE FUNCTION public.manages_staff_record(_staff_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH RECURSIVE me AS (
    SELECT id FROM public.staff_members WHERE user_id = auth.uid()
  ), line AS (
    SELECT s.id, s.manager_staff_id, 1 AS depth
      FROM public.staff_members s
     WHERE s.manager_staff_id IN (SELECT id FROM me)
    UNION ALL
    SELECT c.id, c.manager_staff_id, l.depth + 1
      FROM public.staff_members c
      JOIN line l ON c.manager_staff_id = l.id
     WHERE l.depth < 8
  )
  SELECT EXISTS (SELECT 1 FROM line WHERE id = _staff_id);
$function$;$w10q$; INSERT INTO public._restore_log VALUES('manages_staff_record',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('manages_staff_record',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do10$;
DO $do11$ BEGIN EXECUTE $w11q$CREATE OR REPLACE FUNCTION public.recon_permission_roles(_perm text)
RETURNS app_role[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _perm
    -- read/export discrepancy evidence
    WHEN 'recon.export'        THEN ARRAY['finance_admin','compliance_admin','admin','super_admin']::app_role[]
    -- trigger / queue reconciliation reruns
    WHEN 'recon.rerun'         THEN ARRAY['finance_admin','admin','super_admin']::app_role[]
    -- acknowledge / resolve findings with notes
    WHEN 'recon.resolve'       THEN ARRAY['finance_admin','compliance_admin','admin','super_admin']::app_role[]
    -- confirm the compensating (reversal/refund) ledger entry — money movement
    WHEN 'recon.reverse'       THEN ARRAY['finance_admin','admin','super_admin']::app_role[]
    -- mismatch alert routing + webhook configuration
    WHEN 'recon.alerts.manage' THEN ARRAY['finance_admin','admin','super_admin']::app_role[]
    -- scheduled-job (pg_cron) monitoring dashboard
    WHEN 'ops.cron.monitor'    THEN ARRAY['finance_admin','operations_admin','admin','super_admin']::app_role[]
    ELSE ARRAY[]::app_role[]
  END
$$;$w11q$; INSERT INTO public._restore_log VALUES('recon_permission_roles',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('recon_permission_roles',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do11$;
DO $do12$ BEGIN EXECUTE $w12q$CREATE OR REPLACE FUNCTION public.has_recon_permission(_user_id uuid, _perm text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role = ANY (public.recon_permission_roles(_perm))
  )
$$;$w12q$; INSERT INTO public._restore_log VALUES('has_recon_permission',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('has_recon_permission',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do12$;
DO $do13$ BEGIN EXECUTE $w13q$CREATE VIEW public.v_ops_work_sla
WITH (security_invoker = true) AS
SELECT
  w.id,
  w.title,
  w.ops_queue,
  w.work_kind,
  w.service_line,
  w.entity_type,
  w.entity_id,
  w.entity_ref,
  w.lifecycle_state,
  w.priority,
  w.needs_approval,
  w.escalation_level,
  w.staff_id,
  w.required_action,
  w.source_event_id,
  w.created_at,
  w.sla_started_at,
  w.sla_minutes,
  w.sla_due_at,
  w.sla_breached_at,
  w.completed_at,
  w.closed_at,
  w.resolution,
  CASE
    WHEN w.closed_at IS NOT NULL OR w.completed_at IS NOT NULL THEN 'met'
    WHEN w.sla_due_at IS NULL THEN 'unknown'
    WHEN now() > w.sla_due_at THEN 'breached'
    WHEN now() > w.sla_due_at - ((coalesce(w.sla_minutes, 60) * interval '1 minute') * 0.25) THEN 'at_risk'
    ELSE 'on_track'
  END AS sla_status,
  CASE
    WHEN w.sla_due_at IS NULL THEN NULL
    ELSE floor(EXTRACT(epoch FROM (w.sla_due_at - now())) / 60)::integer
  END AS remaining_minutes,
  w.approval_state,
  w.approval_requested_by,
  w.approval_requested_at,
  w.approval_reason,
  w.approval_decided_by,
  w.approval_decided_at,
  w.approval_decision_note,
  w.writeback_outcome,
  w.writeback_applied_at
FROM public.staff_work_items w;

$w13q$; INSERT INTO public._restore_log VALUES('v_ops_work_sla',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('v_ops_work_sla',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do13$;
DO $do14$ BEGIN EXECUTE $w14q$CREATE OR REPLACE VIEW public.v_sales_lead_reminders
WITH (security_invoker = on) AS
WITH cfg AS (
  SELECT
    coalesce(max(reminder_days_to_meeting), 5) AS d_meeting,
    coalesce(max(reminder_days_meeting_to_quote), 3) AS d_quote,
    coalesce(max(reminder_days_quote_to_contract), 5) AS d_contract,
    coalesce(max(reminder_days_contract_to_signed), 7) AS d_signed
  FROM public.sales_engine_settings
), base AS (
  SELECT
    l.id AS lead_id, l.lead_ref, l.organisation_name, l.contact_name,
    l.sales_staff_id, l.stage, l.waiting_on, l.awaiting_item, l.awaiting_due_date,
    CASE
      WHEN l.waiting_on = 'CLIENT' AND l.awaiting_due_date IS NOT NULL
           AND l.awaiting_due_date < current_date THEN 'CLIENT_OVERDUE'
      WHEN l.contract_shared_at IS NOT NULL AND l.contract_signed_at IS NULL
           AND l.contract_shared_at < now() - make_interval(days => c.d_signed) THEN 'NOT_SIGNED'
      WHEN l.quote_shared_at IS NOT NULL AND l.contract_shared_at IS NULL
           AND l.quote_shared_at < now() - make_interval(days => c.d_contract) THEN 'NO_CONTRACT'
      WHEN l.meeting_held_at IS NOT NULL AND l.quote_shared_at IS NULL
           AND l.meeting_held_at < now() - make_interval(days => c.d_quote) THEN 'NO_QUOTE'
      WHEN l.meeting_held_at IS NULL
           AND l.created_at < now() - make_interval(days => c.d_meeting) THEN 'NO_MEETING'
      ELSE NULL
    END AS reminder_kind,
    GREATEST(0, (current_date - COALESCE(
      CASE
        WHEN l.waiting_on = 'CLIENT' AND l.awaiting_due_date < current_date THEN l.awaiting_due_date
        WHEN l.contract_shared_at IS NOT NULL AND l.contract_signed_at IS NULL
          THEN (l.contract_shared_at + make_interval(days => c.d_signed))::date
        WHEN l.quote_shared_at IS NOT NULL AND l.contract_shared_at IS NULL
          THEN (l.quote_shared_at + make_interval(days => c.d_contract))::date
        WHEN l.meeting_held_at IS NOT NULL AND l.quote_shared_at IS NULL
          THEN (l.meeting_held_at + make_interval(days => c.d_quote))::date
        ELSE (l.created_at + make_interval(days => c.d_meeting))::date
      END, current_date)))::integer AS days_overdue
  FROM public.sales_leads l CROSS JOIN cfg c
  WHERE coalesce(l.is_test, false) = false
    AND l.stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')
)
SELECT b.lead_id, b.lead_ref, b.organisation_name, b.contact_name, b.sales_staff_id,
       coalesce(s.full_name,'Unassigned') AS staff_name,
       b.stage, b.reminder_kind, b.days_overdue,
       b.waiting_on, b.awaiting_item, b.awaiting_due_date,
       r.snoozed_until, r.dismissed_at
  FROM base b
  LEFT JOIN public.staff_members s ON s.id = b.sales_staff_id
  LEFT JOIN public.sales_lead_reminder_state r
         ON r.lead_id = b.lead_id AND r.reminder_kind = b.reminder_kind
 WHERE b.reminder_kind IS NOT NULL
   AND r.dismissed_at IS NULL
   AND (r.snoozed_until IS NULL OR r.snoozed_until <= current_date);

$w14q$; INSERT INTO public._restore_log VALUES('v_sales_lead_reminders',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('v_sales_lead_reminders',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do14$;
DO $v$ BEGIN IF to_regclass('public.v_ops_work_sla') IS NOT NULL THEN ALTER VIEW public.v_ops_work_sla SET (security_invoker = true); GRANT SELECT ON public.v_ops_work_sla TO authenticated; END IF; IF to_regclass('public.v_sales_lead_reminders') IS NOT NULL THEN ALTER VIEW public.v_sales_lead_reminders SET (security_invoker = true); GRANT SELECT ON public.v_sales_lead_reminders TO authenticated; END IF; END $v$;
DO $g$ DECLARE r record; BEGIN FOR r IN SELECT p.oid::regprocedure sig, p.proname FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname = ANY(ARRAY['commercial_qualifying_revenue','_sales_person_figures','_my_staff_member_id','_sales_work_ensure','sales_target_for','_sales_day_movements','_sales_stage_probability','_sales_day_contracts','sales_day_close','work_dispositions_outstanding','manages_staff_record','recon_permission_roles','has_recon_permission']) LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig); EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig); IF r.proname ~ '^_' OR r.proname IN ('recon_permission_roles','sales_target_for','commercial_qualifying_revenue') THEN EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig); ELSE EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig); END IF; END LOOP; END $g$;
