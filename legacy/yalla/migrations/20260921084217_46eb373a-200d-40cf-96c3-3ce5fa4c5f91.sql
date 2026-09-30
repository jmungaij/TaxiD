-- 1. Baseline permissions every employee holds ------------------------------
CREATE TABLE IF NOT EXISTS public.staff_baseline_permissions (
  permission_key text PRIMARY KEY REFERENCES public.staff_permissions(key),
  active boolean NOT NULL DEFAULT true,
  reason text NOT NULL,
  approved_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.staff_baseline_permissions TO authenticated;
GRANT ALL ON public.staff_baseline_permissions TO service_role;
ALTER TABLE public.staff_baseline_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read baseline permissions"
  ON public.staff_baseline_permissions FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR EXISTS (
    SELECT 1 FROM public.staff_members sm
     WHERE sm.user_id = auth.uid() AND sm.employment_status IN ('active','onboarding')));

CREATE POLICY "admins manage baseline permissions"
  ON public.staff_baseline_permissions FOR ALL TO authenticated
  USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE TRIGGER staff_baseline_permissions_touch
  BEFORE UPDATE ON public.staff_baseline_permissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Authority helper: role grants, or a baseline grant held by every employee.
CREATE OR REPLACE FUNCTION public.has_staff_permission(_perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    coalesce(auth.role()::text, '') = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.staff_role_permissions srp ON srp.role = ur.role
      WHERE ur.user_id = auth.uid() AND srp.permission_key = _perm
    )
    OR EXISTS (
      SELECT 1
      FROM public.staff_baseline_permissions b
      JOIN public.staff_members sm
        ON sm.user_id = auth.uid()
       AND sm.employment_status IN ('active','onboarding')
      WHERE b.permission_key = _perm AND b.active
    ),
    false
  );
$function$;

-- 2. Cost and margin visibility is finance/pricing only ----------------------
CREATE OR REPLACE FUNCTION public.pricing_resolve(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_service text := p_input->>'service_code';
  v_scope text := coalesce(p_input->>'scope_label','');
  v_category text := p_input->>'category_code';
  v_basis text := nullif(p_input->>'pricing_basis','');
  v_qty numeric := greatest(coalesce((p_input->>'quantity')::numeric,1),1);
  v_account uuid := nullif(p_input->>'account_id','')::uuid;
  v_proposed numeric := nullif(p_input->>'proposed_amount','')::numeric;
  v_card public.commercial_rate_cards;
  v_line public.commercial_rate_lines;
  v_cust public.pricing_customer_rates;
  v_cost numeric;
  v_recommended numeric;
  v_applied numeric;
  v_source text;
  v_variance numeric := 0;
  v_variance_pct numeric := 0;
  v_guard jsonb;
  v_can_see_cost boolean;
  v_can_see_market boolean;
  v_market numeric;
  v_explain jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.is_platform_admin() OR public.is_commercial_staff()
          OR public.has_staff_permission('staff.commercial.read')) THEN
    RAISE EXCEPTION 'not_authorised: commercial staff only';
  END IF;
  IF v_service IS NULL OR v_category IS NULL THEN
    RAISE EXCEPTION 'invalid_input: service_code and category_code are required';
  END IF;

  SELECT * INTO v_card FROM public.commercial_rate_cards
   WHERE code = coalesce(p_input->>'rate_card_code','corporate_charter_rate_card')
     AND status = 'approved' AND retired_at IS NULL
   ORDER BY coalesce(effective_from,'1900-01-01') DESC, created_at DESC LIMIT 1;
  IF v_card.id IS NULL THEN
    RETURN jsonb_build_object('status','NO_PUBLISHED_RATE_CARD');
  END IF;

  SELECT * INTO v_line FROM public.commercial_rate_lines
   WHERE rate_card_id = v_card.id AND service_code = v_service
     AND category_code = v_category
     AND (v_basis IS NULL OR pricing_basis = v_basis)
     AND (v_scope = '' OR scope_label = v_scope)
   ORDER BY (scope_label = v_scope) DESC LIMIT 1;
  IF v_line.id IS NULL THEN
    RETURN jsonb_build_object('status','NO_VALID_RATE','rate_card_version',v_card.version);
  END IF;
  v_basis := v_line.pricing_basis;

  v_recommended := v_line.amount;
  v_applied := v_recommended;
  v_source := 'RECOMMENDED';
  v_explain := v_explain || jsonb_build_array(jsonb_build_object(
    'label','Recommended rate card rate','amount',v_recommended,
    'detail', v_card.name || ' ' || v_card.version));

  SELECT * INTO v_cust FROM public.pricing_customer_rates r
   WHERE r.status = 'active' AND r.account_id = v_account
     AND r.service_code = v_service AND r.category_code = v_category
     AND (r.scope_label = '' OR r.scope_label = v_scope)
     AND r.pricing_basis = v_basis
     AND (r.effective_from IS NULL OR r.effective_from <= current_date)
     AND (r.effective_to IS NULL OR r.effective_to >= current_date)
     AND v_qty >= r.min_quantity
   ORDER BY CASE r.rate_kind
              WHEN 'contract' THEN 1 WHEN 'customer' THEN 2 WHEN 'project' THEN 3
              WHEN 'promotional' THEN 4 WHEN 'seasonal' THEN 5 WHEN 'volume' THEN 6
              WHEN 'competitive' THEN 7 ELSE 8 END,
            r.min_quantity DESC
   LIMIT 1;

  IF v_cust.id IS NOT NULL THEN
    v_applied := v_cust.amount;
    v_source := upper(v_cust.rate_kind);
    v_explain := v_explain || jsonb_build_array(jsonb_build_object(
      'label', initcap(v_cust.rate_kind) || ' rate',
      'amount', v_cust.amount - v_recommended,
      'detail', coalesce(v_cust.reason,'Agreed customer pricing')));
  END IF;

  IF v_proposed IS NOT NULL THEN
    v_explain := v_explain || jsonb_build_array(jsonb_build_object(
      'label','Negotiated adjustment','amount', v_proposed - v_applied,
      'detail', coalesce(nullif(p_input->>'commercial_reason',''),'Commercial negotiation')));
    v_applied := v_proposed;
    v_source := 'NEGOTIATED';
  END IF;

  v_variance := v_applied - v_recommended;
  v_variance_pct := CASE WHEN v_recommended > 0
    THEN round(((v_applied - v_recommended) / v_recommended) * 100, 2) ELSE 0 END;
  v_guard := public.pricing_guardrail_for(v_variance_pct);

  -- Internal cost and margin: finance and pricing authority only. Read-only
  -- rate access (held by every employee) must never disclose cost.
  v_can_see_cost := public.is_platform_admin()
    OR public.has_staff_permission('staff.finance.read')
    OR public.has_staff_permission('staff.pricing.manage');
  v_can_see_market := v_can_see_cost
    OR public.has_staff_permission('staff.commercial.read')
    OR public.has_staff_permission('staff.pricing.read');

  SELECT coalesce(b.driver_cost,0) + coalesce(b.fuel_cost,0) + coalesce(b.tolls_parking,0)
       + coalesce(b.supplier_cost,0) + coalesce(b.operational_cost,0) + coalesce(b.platform_cost,0)
    INTO v_cost
    FROM public.pricing_cost_baselines b
   WHERE b.service_code = v_service AND b.category_code = v_category
     AND b.pricing_basis = v_basis
     AND (b.scope_label = '' OR b.scope_label = v_scope)
     AND (b.effective_from IS NULL OR b.effective_from <= current_date)
     AND (b.effective_to IS NULL OR b.effective_to >= current_date)
   ORDER BY (b.scope_label = v_scope) DESC, b.effective_from DESC NULLS LAST
   LIMIT 1;

  SELECT avg(o.amount) INTO v_market
    FROM public.pricing_competitor_observations o
   WHERE o.service_code = v_service AND o.category_code = v_category
     AND o.pricing_basis = v_basis
     AND (o.scope_label = '' OR o.scope_label = v_scope)
     AND o.observed_on >= current_date - interval '180 days';

  RETURN jsonb_build_object(
    'status','OK',
    'currency', v_line.currency,
    'recommended_price', v_recommended,
    'customer_rate_price', v_cust.amount,
    'applied_price', v_applied,
    'quantity', v_qty,
    'line_total', v_applied * v_qty,
    'variance_amount', v_variance,
    'variance_percent', v_variance_pct,
    'pricing_source', v_source,
    'rate_card_id', v_card.id,
    'rate_card_code', v_card.code,
    'rate_card_version', v_card.version,
    'rate_line_id', v_line.id,
    'pricing_basis', v_line.pricing_basis,
    'included_distance_km', v_line.included_distance_km,
    'distance_unit', v_line.distance_unit,
    'excess_distance_rate', v_line.excess_distance_rate,
    'included_hours', v_line.included_hours,
    'excess_hour_rate', v_line.excess_hour_rate,
    'waiting_rate_per_hour', v_line.waiting_rate_per_hour,
    'guardrail', v_guard,
    'approval_required', (v_guard->>'action') = 'approve',
    'estimated_cost', CASE WHEN v_can_see_cost THEN v_cost END,
    'margin_amount', CASE WHEN v_can_see_cost AND v_cost IS NOT NULL
                          THEN v_applied - v_cost END,
    'margin_percent', CASE WHEN v_can_see_cost AND v_cost IS NOT NULL AND v_applied > 0
                          THEN round(((v_applied - v_cost) / v_applied) * 100, 2) END,
    'market_reference', CASE WHEN v_can_see_market THEN round(v_market, 2) END,
    'explanation', v_explain);
END;
$function$;

-- 3. Commission generation: commercial owners may raise their own events,
--    which remain subject to the unchanged approval/decision path.
CREATE OR REPLACE FUNCTION public.commission_generate_event(
  p_source_type text, p_source_id text, p_revenue_cents bigint, p_period_month date,
  p_lead_context text DEFAULT NULL::text, p_product_scope text DEFAULT NULL::text,
  p_booking_ref text DEFAULT NULL::text, p_currency text DEFAULT 'KES'::text,
  p_owner_position_code text DEFAULT NULL::text, p_owner_staff_id uuid DEFAULT NULL::uuid,
  p_attribution_role text DEFAULT 'primary'::text, p_share_pct numeric DEFAULT 100,
  p_idempotency_key text DEFAULT NULL::text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_plan public.sales_commission_plans%ROWTYPE;
  v_owner text;
  v_month date := date_trunc('month', p_period_month)::date;
  v_target bigint;
  v_month_rev bigint;
  v_perf boolean := false;
  v_base bigint; v_perf_amt bigint := 0; v_total bigint;
  v_id uuid; v_no text;
BEGIN
  IF NOT (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin','operations_admin','director','general_manager']::public.app_role[])
          OR public.has_staff_permission('staff.commercial.manage')
          OR public.has_staff_permission('staff.crm.manage')) THEN
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

  v_owner := NULLIF(btrim(COALESCE(p_owner_position_code,'')),'') ;
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

-- 4. Accepting a quotation: booked service + invoice + commission -----------
CREATE OR REPLACE FUNCTION public.commercial_quotation_accept(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  q public.commercial_quotations;
  v_staff uuid := public._my_staff_member_id();
  v_from date := nullif(p->>'service_from','')::date;
  v_ref text := nullif(btrim(coalesce(p->>'customer_reference','')),'');
  v_make_bookings boolean := coalesce((p->>'create_bookings')::boolean, true);
  v_account_name text;
  v_invoice public.tax_invoices;
  v_invoice_id uuid;
  v_sub bigint; v_vat bigint;
  v_line record;
  v_line_no int := 0;
  v_bookings int := 0;
  v_commission uuid;
  v_start timestamptz;
  v_i int;
  v_created_invoice boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO q FROM public.commercial_quotations WHERE id = (p->>'quotation_id')::uuid;
  IF q.id IS NULL THEN RAISE EXCEPTION 'QUOTATION_NOT_FOUND'; END IF;
  IF NOT (public.is_platform_admin() OR public.is_commercial_staff()) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  IF q.status IN ('declined','expired','superseded') THEN
    RAISE EXCEPTION 'QUOTATION_NOT_OPEN: %', q.status;
  END IF;
  IF q.approval_status = 'pending' THEN
    RAISE EXCEPTION 'APPROVAL_PENDING: the negotiated price still needs approval';
  END IF;
  IF coalesce(q.total_amount,0) <= 0 THEN RAISE EXCEPTION 'QUOTATION_VALUE_REQUIRED'; END IF;
  IF v_from IS NULL THEN RAISE EXCEPTION 'SERVICE_FROM_REQUIRED'; END IF;

  SELECT a.name INTO v_account_name FROM public.crm_accounts a WHERE a.id = q.account_id;

  -- Invoice at the quoted price (the transaction price), once per quotation.
  SELECT * INTO v_invoice FROM public.tax_invoices
   WHERE quote_reference = q.quote_number AND status <> 'cancelled' LIMIT 1;
  IF v_invoice.id IS NULL THEN
    v_sub := round(q.total_amount * 100)::bigint;
    v_vat := round(v_sub * 0.16)::bigint;
    INSERT INTO public.tax_invoices (
      status, customer_company, currency, vat_rate, vat_inclusive, payment_terms,
      quote_reference, customer_ref, service_from, subtotal_cents, vat_cents, total_cents,
      paid_cents, owner_staff_id, created_by, account_id, contract_id, notes
    ) VALUES (
      'draft', coalesce(v_account_name, 'Unnamed customer'), coalesce(q.currency,'KES'), 16, false,
      '30 days', q.quote_number, v_ref, v_from, v_sub, v_vat, v_sub + v_vat,
      0, coalesce(q.owner_staff_id, v_staff), auth.uid(), q.account_id, q.contract_instance_id,
      'Raised from accepted quotation ' || q.quote_number || ' at the quoted price.'
    ) RETURNING id INTO v_invoice_id;
    v_created_invoice := true;

    FOR v_line IN
      SELECT * FROM public.commercial_quotation_lines WHERE quotation_id = q.id ORDER BY created_at
    LOOP
      v_line_no := v_line_no + 1;
      INSERT INTO public.tax_invoice_lines (
        invoice_id, line_no, description, service_date, vehicle_category, qty,
        unit_rate_cents, amount_cents
      ) VALUES (
        v_invoice_id, v_line_no,
        coalesce(v_line.scope_label,'') || ' · ' || v_line.service_code || ' (' || v_line.category_code || ')',
        v_from, v_line.category_code, v_line.quantity,
        round(v_line.unit_amount * 100)::bigint,
        round(v_line.line_total * 100)::bigint
      );
    END LOOP;
  ELSE
    v_invoice_id := v_invoice.id;
  END IF;

  -- Booked service records: one per quoted unit, idempotent per quotation line.
  IF v_make_bookings THEN
    FOR v_line IN
      SELECT * FROM public.commercial_quotation_lines WHERE quotation_id = q.id ORDER BY created_at
    LOOP
      FOR v_i IN 1..least(greatest(coalesce(v_line.quantity,1)::int,1), 60) LOOP
        v_start := (v_from + (v_i - 1)) + time '08:00' AT TIME ZONE 'Africa/Nairobi';
        INSERT INTO public.commercial_service_executions (
          execution_ref, account_id, contract_id, owner_staff_id, service_type,
          origin, destination, scheduled_at, status, value_kes, external_reference, recorded_by
        )
        SELECT
          'SVC-' || to_char(now(),'DDMMYY') || '-' || upper(substr(md5(v_line.id::text || v_i::text),1,5)),
          q.account_id, q.contract_instance_id, coalesce(q.owner_staff_id, v_staff),
          CASE WHEN v_line.service_code = 'airport_transfer' THEN 'AIRPORT_TRANSFER' ELSE 'CHARTER' END,
          NULL, v_line.scope_label, v_start, 'SCHEDULED', v_line.unit_amount,
          q.quote_number || '#' || v_line.id::text || '#' || v_i::text, auth.uid()
        WHERE NOT EXISTS (
          SELECT 1 FROM public.commercial_service_executions e
           WHERE e.external_reference = q.quote_number || '#' || v_line.id::text || '#' || v_i::text);
        v_bookings := v_bookings + 1;
      END LOOP;
    END LOOP;
  END IF;

  -- Commission on the accepted (quoted) value, idempotent per quotation.
  BEGIN
    v_commission := public.commission_generate_event(
      'commercial_quotation', q.id::text, round(q.total_amount * 100)::bigint,
      v_from, NULL, NULL, q.quote_number, coalesce(q.currency,'KES'),
      NULL, coalesce(q.owner_staff_id, v_staff), 'primary', 100,
      'quotation:' || q.id::text);
  EXCEPTION WHEN OTHERS THEN
    v_commission := NULL;
  END;

  UPDATE public.commercial_quotations
     SET status = 'accepted', updated_at = now(),
         notes = coalesce(notes,'') ||
                 CASE WHEN v_ref IS NOT NULL THEN E'\nCustomer reference: ' || v_ref ELSE '' END
   WHERE id = q.id;

  RETURN jsonb_build_object(
    'quotation_id', q.id,
    'quote_number', q.quote_number,
    'invoice_id', v_invoice_id,
    'invoice_created', v_created_invoice,
    'bookings_created', v_bookings,
    'commission_event_id', v_commission,
    'commission_note', CASE WHEN v_commission IS NULL
      THEN 'Commission not raised — no active plan or owner rule resolves this revenue.' END,
    'transaction_value', q.total_amount);
END; $function$;

REVOKE ALL ON FUNCTION public.commercial_quotation_accept(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commercial_quotation_accept(jsonb) TO authenticated, service_role;

-- 5. Cost baselines: finance and pricing managers maintain them -------------
DROP POLICY IF EXISTS "admin write cost baselines" ON public.pricing_cost_baselines;
CREATE POLICY "cost owners write cost baselines"
  ON public.pricing_cost_baselines FOR ALL TO authenticated
  USING (public.is_platform_admin() OR public.has_staff_permission('staff.pricing.manage'))
  WITH CHECK (public.is_platform_admin() OR public.has_staff_permission('staff.pricing.manage'));

DROP POLICY IF EXISTS "admin read cost baselines" ON public.pricing_cost_baselines;
CREATE POLICY "cost readers read cost baselines"
  ON public.pricing_cost_baselines FOR SELECT TO authenticated
  USING (public.is_platform_admin()
         OR public.has_staff_permission('staff.finance.read')
         OR public.has_staff_permission('staff.pricing.manage'));