CREATE OR REPLACE FUNCTION public._sales_person_figures(
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
END $function$;
REVOKE ALL ON FUNCTION public._sales_person_figures(uuid, timestamptz, timestamptz, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._sales_person_figures(uuid, timestamptz, timestamptz, boolean) TO authenticated;