CREATE OR REPLACE FUNCTION public.contract_activate(_contract uuid, _reason text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  c public.commercial_contract_instances;
  gate jsonb;
  v_staff uuid;
  v_event uuid;
  v_existing uuid;
  v_work uuid;
  v_revenue_work uuid;
  v_lifecycle jsonb := NULL;
  v_period text;
BEGIN
  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = _contract FOR UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_NOT_FOUND'); END IF;
  IF NOT public._contract_may_activate(c) THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED'); END IF;

  SELECT id INTO v_existing FROM public.contract_revenue_events
   WHERE contract_id = c.id AND event_type = 'CONTRACT_EXECUTED' AND activation_version = c.activation_version;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_activated', true, 'revenue_event_id', v_existing,
                              'contract_id', c.id, 'status', c.status);
  END IF;

  gate := public.contract_activation_check(_contract);
  IF (gate->>'can_activate')::boolean IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACTIVATION_BLOCKED', 'gate', gate);
  END IF;

  v_staff := coalesce(c.owner_staff_id, public._my_staff_member_id());
  v_period := coalesce(c.revenue_period, to_char(c.execution_date, 'YYYY-MM'));

  INSERT INTO public.contract_revenue_events
    (contract_id, account_id, opportunity_id, lead_id, staff_member_id, event_type, activation_version,
     amount, currency, value_type, execution_date, revenue_period, revenue_treatment, reason, created_by)
  VALUES (c.id, c.account_id, c.opportunity_id, c.lead_id, v_staff, 'CONTRACT_EXECUTED', c.activation_version,
          c.value_amount, c.currency, c.value_type, c.execution_date, v_period, c.revenue_treatment,
          _reason, auth.uid())
  ON CONFLICT (contract_id, event_type, activation_version) DO NOTHING
  RETURNING id INTO v_event;

  IF v_event IS NULL THEN
    SELECT id INTO v_event FROM public.contract_revenue_events
     WHERE contract_id = c.id AND event_type = 'CONTRACT_EXECUTED' AND activation_version = c.activation_version;
    RETURN jsonb_build_object('ok', true, 'already_activated', true, 'revenue_event_id', v_event,
                              'contract_id', c.id, 'status', c.status);
  END IF;

  UPDATE public.commercial_contract_instances
     SET status = 'contracted', activated_at = now(), activated_by = auth.uid(),
         revenue_period = coalesce(revenue_period, v_period),
         effective_date = coalesce(effective_date, execution_date)
   WHERE id = c.id;

  IF c.opportunity_id IS NOT NULL THEN
    UPDATE public.commercial_opportunities
       SET stage = 'won', updated_at = now()
     WHERE id = c.opportunity_id AND stage NOT IN ('won','lost');
  END IF;

  UPDATE public.crm_accounts SET lifecycle_stage = 'won', updated_at = now()
   WHERE id = c.account_id AND lifecycle_stage NOT IN ('active','expansion','renewal','won');

  IF c.lead_id IS NOT NULL THEN
    BEGIN
      v_lifecycle := public.commercial_lifecycle_advance(c.lead_id, 'CONTRACTED', c.value_amount,
                       'Contract ' || c.contract_number || ' executed', false);
    EXCEPTION WHEN OTHERS THEN
      v_lifecycle := jsonb_build_object('ok', false, 'error', SQLERRM);
    END;
  END IF;

  IF v_staff IS NOT NULL THEN
    v_work := public._sales_work_ensure(
      v_staff, 'contract_onboarding',
      'Start onboarding — ' || coalesce(c.customer_legal_name, 'customer'),
      'Contract ' || c.contract_number || ' is contracted. Arrange kickoff, billing setup and the first booking.',
      'commercial_contract_instances', c.id, c.contract_number, 'high', 1440);

    -- first revenue action: raising the first invoice is the next commercial step
    v_revenue_work := public._sales_work_ensure(
      v_staff, 'contract_activation',
      'Raise the first invoice — ' || coalesce(c.customer_legal_name, 'customer'),
      'Contract ' || c.contract_number || ' is worth '
        || coalesce(c.currency,'KES') || ' ' || coalesce(to_char(c.value_amount,'FM999,999,999,990'),'value not recorded')
        || ' for ' || coalesce(v_period,'the recorded period')
        || '. Raise the first invoice and confirm the billing schedule with finance.',
      'commercial_contract_instances', c.id, c.contract_number, 'high', 2880);

    UPDATE public.staff_work_items
       SET next_action = 'Raise the first invoice for ' || c.contract_number
                         || ' and hand the revenue entry to finance for reconciliation.',
           next_action_due = (now() + interval '2 days')::date,
           value_score = coalesce(c.value_amount, value_score),
           updated_at = now()
     WHERE id = v_revenue_work;

    UPDATE public.staff_work_items
       SET value_score = coalesce(c.value_amount, value_score), updated_at = now()
     WHERE id = v_work;
  END IF;

  -- pipeline value refresh so priority, workload and tomorrow's plan follow the win
  IF c.lead_id IS NOT NULL THEN
    BEGIN
      PERFORM public.pipeline_work_apply(c.lead_id);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;

  INSERT INTO public.contract_events
    (contract_id, event_type, from_status, to_status, before_state, after_state, reason, actor_id, actor_staff_id)
  VALUES (c.id, 'CONTRACT_ACTIVATED', c.status, 'contracted', to_jsonb(c),
          jsonb_build_object('revenue_event_id', v_event, 'amount', c.value_amount, 'currency', c.currency,
                             'revenue_period', v_period, 'work_item_id', v_work,
                             'revenue_work_item_id', v_revenue_work, 'lifecycle', v_lifecycle),
          _reason, auth.uid(), public._my_staff_member_id());

  RETURN jsonb_build_object('ok', true, 'already_activated', false, 'contract_id', c.id,
    'contract_number', c.contract_number, 'status', 'contracted', 'revenue_event_id', v_event,
    'amount', c.value_amount, 'currency', c.currency, 'revenue_period', v_period,
    'opportunity_id', c.opportunity_id, 'account_id', c.account_id,
    'work_item_id', v_work, 'revenue_work_item_id', v_revenue_work, 'lifecycle', v_lifecycle);
END $function$;