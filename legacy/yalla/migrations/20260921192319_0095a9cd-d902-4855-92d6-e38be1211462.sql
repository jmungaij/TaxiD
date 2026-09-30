CREATE OR REPLACE FUNCTION public.commission_generate_event(
  p_source_type text, p_source_id text, p_revenue_cents bigint, p_period_month date,
  p_lead_context text DEFAULT NULL::text, p_product_scope text DEFAULT NULL::text,
  p_booking_ref text DEFAULT NULL::text, p_currency text DEFAULT 'KES'::text,
  p_owner_position_code text DEFAULT NULL::text, p_owner_staff_id uuid DEFAULT NULL::uuid,
  p_attribution_role text DEFAULT 'primary'::text, p_share_pct numeric DEFAULT 100,
  p_idempotency_key text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_plan public.sales_commission_plans%ROWTYPE;
  v_owner text;
  v_month date := date_trunc('month', p_period_month)::date;
  v_target bigint;
  v_target_source text := 'commission_target_register';
  v_month_rev bigint;
  v_perf boolean := false;
  v_base bigint; v_perf_amt bigint := 0; v_total bigint;
  v_id uuid; v_no text;
BEGIN
  -- Authority: commercial/finance leadership, holders of the commercial or CRM
  -- management permissions, or an authorised platform action inside the same
  -- transaction (quotation acceptance already enforces its own authority).
  IF NOT (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin','operations_admin','director','general_manager']::public.app_role[])
          OR public.has_staff_permission('staff.commercial.manage')
          OR public.has_staff_permission('staff.crm.manage')
          OR coalesce(current_setting('yalla.commission_system_action', true),'') = 'on') THEN
    RAISE EXCEPTION 'Not authorised to generate commission events.';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_id FROM public.sales_commission_events WHERE idempotency_key = p_idempotency_key;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  SELECT * INTO v_plan FROM public.sales_commission_plans
   WHERE status='active' AND effective_from <= v_month AND (effective_to IS NULL OR effective_to >= v_month)
   ORDER BY effective_from DESC LIMIT 1;
  IF v_plan.id IS NULL THEN RAISE EXCEPTION 'No active commission plan covers %.', v_month; END IF;

  v_owner := NULLIF(btrim(COALESCE(p_owner_position_code,'')),'');

  -- The owning specialist's own position is the truth when we know who owns the deal.
  IF v_owner IS NULL AND p_owner_staff_id IS NOT NULL THEN
    SELECT op.code INTO v_owner
      FROM public.staff_members s
      JOIN public.org_positions op ON op.id = s.position_id
     WHERE s.id = p_owner_staff_id;
  END IF;

  IF v_owner IS NULL THEN
    SELECT primary_position_code INTO v_owner FROM public.sales_lead_routing_rules
     WHERE active
       AND (lead_context = COALESCE(p_lead_context, lead_context))
       AND (product_scope = COALESCE(p_product_scope, product_scope))
     ORDER BY (lead_context = p_lead_context AND product_scope = p_product_scope) DESC, sort_order
     LIMIT 1;
  END IF;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'No sales lead routing rule resolves an owner for this revenue.'; END IF;
  IF v_owner ILIKE '%intern%' OR v_owner LIKE 'TSI-%' THEN
    RAISE EXCEPTION 'Commission attribution to internship positions is prohibited.';
  END IF;

  SELECT target_revenue_cents INTO v_target FROM public.sales_commission_targets
   WHERE position_code = v_owner AND period_month = v_month AND status = 'active';

  -- Fall back to the single canonical sales target register rather than leaving
  -- the performance element permanently unreachable.
  IF v_target IS NULL AND p_owner_staff_id IS NOT NULL THEN
    SELECT nullif(round((public.sales_target_for(p_owner_staff_id, v_month)->>'target_kes')::numeric * 100), 0)::bigint
      INTO v_target;
    IF v_target IS NOT NULL THEN v_target_source := 'sales_targets_register'; END IF;
  END IF;
  IF v_target IS NULL THEN v_target_source := 'none'; END IF;

  SELECT COALESCE(SUM(qualified_revenue_cents),0) + p_revenue_cents INTO v_month_rev
    FROM public.sales_commission_events
   WHERE owner_position_code = v_owner AND period_month = v_month AND status <> 'rejected';
  v_perf := v_target IS NOT NULL AND v_month_rev >= v_target;

  v_base := round(p_revenue_cents * v_plan.base_rate_bp / 10000.0 * p_share_pct / 100.0);
  IF v_perf THEN v_perf_amt := round(p_revenue_cents * v_plan.performance_rate_bp / 10000.0 * p_share_pct / 100.0); END IF;
  v_total := v_base + v_perf_amt;

  INSERT INTO public.sales_commission_events (
    event_no, source_type, source_id, booking_ref, lead_context, product_scope,
    qualified_revenue_cents, currency, period_month, plan_id, owner_position_code, owner_staff_id,
    attribution_role, share_pct, base_rate_bp, base_commission_cents, performance_rate_bp,
    performance_eligible, performance_commission_cents, total_commission_cents,
    revenue_qualification, kpi_outcome, idempotency_key, created_by
  ) VALUES (
    'COM-' || to_char(v_month,'YYYYMM') || '-' || upper(substr(gen_random_uuid()::text,1,6)),
    p_source_type, p_source_id, p_booking_ref, p_lead_context, p_product_scope,
    p_revenue_cents, p_currency, v_month, v_plan.id, v_owner, p_owner_staff_id,
    p_attribution_role, p_share_pct, v_plan.base_rate_bp, v_base, v_plan.performance_rate_bp,
    v_perf, v_perf_amt, v_total,
    jsonb_build_object('source_type', p_source_type, 'source_id', p_source_id, 'booking_ref', p_booking_ref,
      'rule', 'Qualified gross revenue as asserted by authorised commercial staff; upstream verification required'),
    jsonb_build_object('period_month', v_month, 'target_revenue_cents', v_target,
      'target_source', v_target_source,
      'month_revenue_cents', v_month_rev,
      'attainment_pct', CASE WHEN v_target IS NOT NULL AND v_target > 0 THEN round(v_month_rev * 100.0 / v_target, 2) END,
      'performance_eligible', v_perf),
    p_idempotency_key, auth.uid()
  ) RETURNING id, event_no INTO v_id, v_no;

  INSERT INTO public.sales_commission_event_audit (event_id, action, actor_id, after_state, reason)
  VALUES (v_id, 'GENERATED', auth.uid(),
    jsonb_build_object('event_no', v_no, 'owner_position_code', v_owner, 'qualified_revenue_cents', p_revenue_cents,
      'base_commission_cents', v_base, 'performance_eligible', v_perf, 'total_commission_cents', v_total),
    'Commission event generated from qualified revenue.');
  RETURN v_id;
END; $function$;

REVOKE ALL ON FUNCTION public.commission_generate_event(text,text,bigint,date,text,text,text,text,text,uuid,text,numeric,text) FROM anon;