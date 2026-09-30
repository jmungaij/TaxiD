CREATE OR REPLACE FUNCTION public.contract_amend(_contract uuid, _patch jsonb, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.commercial_contract_instances;
  before_state jsonb;
  v_no int;
  v_recognised numeric;
  v_delta numeric;
  v_event uuid;
  v_type text;
  v_fields text[] := '{}'::text[];
  v_period text;
  v_amend uuid;
  v_work uuid;
BEGIN
  IF coalesce(btrim(_reason), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;

  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = _contract FOR UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_NOT_FOUND'); END IF;
  IF NOT public._contract_may_activate(c) THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED'); END IF;
  IF c.activated_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_ACTIVATED',
      'detail', 'Amendments apply to activated contracts. Edit the execution details instead.');
  END IF;

  before_state := to_jsonb(c);

  IF (_patch ? 'value_amount') AND (_patch->>'value_amount') IS NOT NULL
     AND (_patch->>'value_amount')::numeric IS DISTINCT FROM c.value_amount THEN
    v_fields := array_append(v_fields, 'value_amount');
  END IF;
  IF (_patch ? 'term_start') AND (_patch->>'term_start')::date IS DISTINCT FROM c.term_start THEN v_fields := array_append(v_fields, 'term_start'); END IF;
  IF (_patch ? 'term_end') AND (_patch->>'term_end')::date IS DISTINCT FROM c.term_end THEN v_fields := array_append(v_fields, 'term_end'); END IF;
  IF (_patch ? 'payment_terms') AND (_patch->>'payment_terms') IS DISTINCT FROM c.payment_terms THEN v_fields := array_append(v_fields, 'payment_terms'); END IF;
  IF (_patch ? 'renewal_terms') AND (_patch->>'renewal_terms') IS DISTINCT FROM c.renewal_terms THEN v_fields := array_append(v_fields, 'renewal_terms'); END IF;
  IF (_patch ? 'billing_frequency') AND (_patch->>'billing_frequency') IS DISTINCT FROM c.billing_frequency THEN v_fields := array_append(v_fields, 'billing_frequency'); END IF;
  IF (_patch ? 'value_type') AND (_patch->>'value_type') IS DISTINCT FROM c.value_type THEN v_fields := array_append(v_fields, 'value_type'); END IF;
  IF (_patch ? 'revenue_period') AND (_patch->>'revenue_period') IS DISTINCT FROM c.revenue_period THEN v_fields := array_append(v_fields, 'revenue_period'); END IF;

  IF array_length(v_fields, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_CHANGE',
      'detail', 'Nothing in this amendment differs from the recorded contract.');
  END IF;

  v_type := CASE
    WHEN v_fields = ARRAY['value_amount'::text] THEN 'value'
    WHEN v_fields <@ ARRAY['term_start'::text,'term_end'] THEN 'term_dates'
    WHEN v_fields <@ ARRAY['payment_terms'::text,'renewal_terms','billing_frequency','value_type','revenue_period'] THEN 'commercial_terms'
    ELSE 'mixed' END;

  SELECT coalesce(max(amendment_no), 0) + 1 INTO v_no FROM public.contract_amendments WHERE contract_id = _contract;

  UPDATE public.commercial_contract_instances SET
    value_amount      = coalesce((_patch->>'value_amount')::numeric, value_amount),
    value_type        = coalesce(_patch->>'value_type', value_type),
    revenue_period    = coalesce(_patch->>'revenue_period', revenue_period),
    billing_frequency = coalesce(_patch->>'billing_frequency', billing_frequency),
    payment_terms     = coalesce(_patch->>'payment_terms', payment_terms),
    renewal_terms     = coalesce(_patch->>'renewal_terms', renewal_terms),
    term_start        = coalesce((_patch->>'term_start')::date, term_start),
    term_end          = coalesce((_patch->>'term_end')::date, term_end),
    variance_reason   = coalesce(_patch->>'variance_reason', variance_reason),
    updated_at        = now()
  WHERE id = _contract;

  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = _contract;

  SELECT coalesce(sum(amount), 0) INTO v_recognised FROM public.contract_revenue_events WHERE contract_id = _contract;
  v_delta := coalesce(c.value_amount, 0) - v_recognised;
  v_period := coalesce(_patch->>'revenue_period', c.revenue_period, to_char(now(), 'YYYY-MM'));

  IF v_delta <> 0 THEN
    INSERT INTO public.contract_revenue_events
      (contract_id, account_id, opportunity_id, lead_id, staff_member_id, event_type, activation_version,
       amount, currency, value_type, execution_date, revenue_period, revenue_treatment, source, reason, created_by)
    VALUES (c.id, c.account_id, c.opportunity_id, c.lead_id, c.owner_staff_id, 'CONTRACT_AMENDED', v_no,
            v_delta, c.currency, c.value_type,
            coalesce((_patch->>'effective_date')::date, c.execution_date, current_date), v_period,
            c.revenue_treatment, 'contract_amendment', _reason, auth.uid())
    ON CONFLICT (contract_id, event_type, activation_version) DO NOTHING
    RETURNING id INTO v_event;
  END IF;

  INSERT INTO public.contract_amendments
    (contract_id, amendment_no, amendment_type, reason, effective_date, value_before, value_after, value_delta,
     currency, revenue_period, revenue_event_id, before_state, after_state, changed_fields, actor_id, actor_staff_id)
  VALUES (_contract, v_no, v_type, _reason, (_patch->>'effective_date')::date,
          (before_state->>'value_amount')::numeric, c.value_amount, v_delta, c.currency, v_period, v_event,
          before_state, to_jsonb(c), v_fields, auth.uid(), public._my_staff_member_id())
  RETURNING id INTO v_amend;

  INSERT INTO public.contract_events
    (contract_id, event_type, from_status, to_status, before_state, after_state, reason, actor_id, actor_staff_id)
  VALUES (_contract, 'CONTRACT_AMENDED', before_state->>'status', c.status, before_state,
          jsonb_build_object('amendment_id', v_amend, 'amendment_no', v_no, 'changed_fields', to_jsonb(v_fields),
                             'value_delta', v_delta, 'revenue_event_id', v_event),
          _reason, auth.uid(), public._my_staff_member_id());

  IF c.owner_staff_id IS NOT NULL AND v_delta <> 0 THEN
    v_work := public._sales_work_ensure(
      c.owner_staff_id, 'contract_amendment_billing',
      'Update billing for amended contract — ' || coalesce(c.customer_legal_name, 'customer'),
      'Amendment ' || v_no || ' on ' || coalesce(c.contract_number, 'contract') || ' changed the value by '
        || c.currency || ' ' || to_char(v_delta, 'FM999999999990.00') || '. Align invoicing and the customer record.',
      'commercial_contract_instances', c.id, c.contract_number, 'high', 2880);
  END IF;

  RETURN jsonb_build_object('ok', true, 'contract_id', _contract, 'amendment_id', v_amend, 'amendment_no', v_no,
    'amendment_type', v_type, 'changed_fields', to_jsonb(v_fields), 'value_before', (before_state->>'value_amount')::numeric,
    'value_after', c.value_amount, 'value_delta', v_delta, 'currency', c.currency, 'revenue_period', v_period,
    'revenue_event_id', v_event, 'recognised_total', coalesce(c.value_amount, v_recognised), 'work_item_id', v_work);
END $$;