-- ============ Quote-level approval ============
CREATE OR REPLACE FUNCTION public.commercial_quotation_decide(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := nullif(p->>'quotation_id','')::uuid;
  v_status text := lower(coalesce(p->>'status',''));
  v_note text := nullif(p->>'note','');
  v_q public.commercial_quotations;
  v_owner_user uuid;
  v_decided integer := 0;
BEGIN
  IF v_status NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'invalid_input: status must be approved or rejected';
  END IF;
  SELECT * INTO v_q FROM public.commercial_quotations WHERE id = v_id;
  IF v_q.id IS NULL THEN RAISE EXCEPTION 'unknown_quotation'; END IF;

  IF NOT (public.is_platform_admin() OR public.has_staff_permission('staff.crm.manage')) THEN
    RAISE EXCEPTION 'not_authorised: pricing approval authority required';
  END IF;

  SELECT user_id INTO v_owner_user FROM public.staff_members WHERE id = v_q.owner_staff_id;
  IF v_owner_user IS NOT NULL AND v_owner_user = auth.uid() AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'segregation_of_duties: a specialist cannot approve their own quotation';
  END IF;

  UPDATE public.pricing_negotiations
     SET approval_status = v_status, decided_by = auth.uid(), decided_at = now(),
         decision_note = v_note,
         final_amount = CASE WHEN v_status = 'approved' THEN proposed_amount ELSE NULL END
   WHERE quotation_id = v_id AND approval_status = 'pending';
  GET DIAGNOSTICS v_decided = ROW_COUNT;

  UPDATE public.commercial_quotations
     SET approval_status = v_status,
         status = CASE WHEN v_status = 'approved' THEN 'approved' ELSE 'declined' END,
         updated_at = now()
   WHERE id = v_id;

  INSERT INTO public.pricing_audit_events (actor_id, action, entity, entity_id, previous_value, new_value, reason)
  VALUES (auth.uid(), 'quotation.' || v_status, 'commercial_quotations', v_id,
          jsonb_build_object('approval_status', v_q.approval_status, 'status', v_q.status),
          jsonb_build_object('approval_status', v_status, 'lines_decided', v_decided),
          coalesce(v_note,''));

  RETURN jsonb_build_object('ok', true, 'quotation_id', v_id, 'quote_number', v_q.quote_number,
                            'approval_status', v_status, 'lines_decided', v_decided);
END;
$function$;

REVOKE ALL ON FUNCTION public.commercial_quotation_decide(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commercial_quotation_decide(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commercial_quotation_decide(jsonb) TO service_role;

-- ============ Pricing & Revenue intelligence ============
CREATE OR REPLACE FUNCTION public.pricing_revenue_intelligence(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_from date := coalesce(p_from, current_date - 90);
  v_to date := coalesce(p_to, current_date);
  v_cost_ok boolean;
  v_card public.commercial_rate_cards;
  v_out jsonb;
BEGIN
  IF NOT (public.is_platform_admin() OR public.is_commercial_staff()
          OR public.has_staff_permission('staff.commercial.read')) THEN
    RAISE EXCEPTION 'not_authorised: commercial staff only';
  END IF;

  v_cost_ok := public.is_platform_admin()
    OR public.has_staff_permission('staff.finance.read')
    OR public.has_staff_permission('staff.pricing.manage');

  SELECT * INTO v_card FROM public.commercial_rate_cards
   WHERE status = 'approved' AND retired_at IS NULL
   ORDER BY coalesce(effective_from,'1900-01-01') DESC LIMIT 1;

  v_out := jsonb_build_object(
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'cost_visible', v_cost_ok,
    'rate_card', (
      SELECT jsonb_build_object(
        'code', v_card.code, 'version', v_card.version, 'status', v_card.status,
        'effective_from', v_card.effective_from,
        'lines', count(*), 'lanes', count(DISTINCT l.scope_label),
        'categories', count(DISTINCT l.category_code),
        'services', count(DISTINCT l.service_code),
        'last_changed', max(coalesce(l.updated_at, l.created_at)))
        FROM public.commercial_rate_lines l WHERE l.rate_card_id = v_card.id),
    'engines', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'code', e.code, 'name', e.name, 'quote_kind', e.quote_kind,
        'default_basis', e.default_basis, 'spot_allowed', e.allows_spot_price,
        'hold_required', e.requires_resource_hold) ORDER BY e.code), '[]'::jsonb)
        FROM public.pricing_service_engines e WHERE e.status = 'active'),
    'performance', (
      SELECT coalesce(jsonb_agg(x ORDER BY x->>'scope_label'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'service_code', n.service_code, 'scope_label', n.scope_label,
          'category_code', n.category_code, 'quotes', count(*),
          'recommended_avg', round(avg(n.recommended_amount), 2),
          'sold_avg', round(avg(n.proposed_amount), 2),
          'variance_avg_percent', round(avg(n.variance_percent), 2),
          'spot_lines', count(*) FILTER (WHERE n.price_source = 'SPOT'),
          'discount_lines', count(*) FILTER (WHERE n.variance_percent < 0),
          'premium_lines', count(*) FILTER (WHERE n.variance_percent > 0),
          'margin_avg_percent', CASE WHEN v_cost_ok THEN round(avg(n.margin_percent), 2) END) AS x
          FROM public.pricing_negotiations n
         WHERE n.created_at::date BETWEEN v_from AND v_to
         GROUP BY n.service_code, n.scope_label, n.category_code) s),
    'market_position', (
      SELECT coalesce(jsonb_agg(x ORDER BY x->>'scope_label'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'service_code', o.service_code, 'scope_label', o.scope_label,
          'category_code', o.category_code,
          'competitor_avg', round(avg(o.amount), 2),
          'observations', count(*),
          'latest_observation', max(o.observed_on),
          'our_avg', (SELECT round(avg(n.proposed_amount), 2) FROM public.pricing_negotiations n
                       WHERE n.service_code = o.service_code AND n.category_code = o.category_code
                         AND n.scope_label = o.scope_label
                         AND n.created_at::date BETWEEN v_from AND v_to)) AS x
          FROM public.pricing_competitor_observations o
         WHERE o.observed_on >= v_from - 180
         GROUP BY o.service_code, o.scope_label, o.category_code) m),
    'win_loss', (
      SELECT jsonb_build_object(
        'won', count(*) FILTER (WHERE q.status = 'accepted'),
        'lost', count(*) FILTER (WHERE q.status = 'declined'),
        'expired', count(*) FILTER (WHERE q.status = 'expired'),
        'open', count(*) FILTER (WHERE q.status IN ('draft','submitted','approved','shared')),
        'won_value', coalesce(sum(q.total_amount) FILTER (WHERE q.status = 'accepted'), 0),
        'lost_value', coalesce(sum(q.total_amount) FILTER (WHERE q.status = 'declined'), 0),
        'won_avg_variance_percent', (
          SELECT round(avg(l.variance_percent), 2) FROM public.commercial_quotation_lines l
            JOIN public.commercial_quotations qq ON qq.id = l.quotation_id
           WHERE qq.status = 'accepted' AND qq.created_at::date BETWEEN v_from AND v_to),
        'lost_avg_variance_percent', (
          SELECT round(avg(l.variance_percent), 2) FROM public.commercial_quotation_lines l
            JOIN public.commercial_quotations qq ON qq.id = l.quotation_id
           WHERE qq.status = 'declined' AND qq.created_at::date BETWEEN v_from AND v_to))
        FROM public.commercial_quotations q
       WHERE q.created_at::date BETWEEN v_from AND v_to),
    'data_quality', jsonb_build_object(
      'lanes_without_cost', (
        SELECT count(*) FROM public.commercial_rate_lines l
         WHERE l.rate_card_id = v_card.id
           AND NOT EXISTS (SELECT 1 FROM public.pricing_cost_baselines b
                            WHERE b.service_code = l.service_code
                              AND b.category_code = l.category_code
                              AND (b.scope_label = '' OR b.scope_label = l.scope_label))),
      'lanes_without_market_data', (
        SELECT count(*) FROM public.commercial_rate_lines l
         WHERE l.rate_card_id = v_card.id
           AND NOT EXISTS (SELECT 1 FROM public.pricing_competitor_observations o
                            WHERE o.service_code = l.service_code
                              AND o.category_code = l.category_code
                              AND (o.scope_label = '' OR o.scope_label = l.scope_label))),
      'spot_priced_lines', (
        SELECT count(*) FROM public.pricing_negotiations n
         WHERE n.price_source = 'SPOT' AND n.created_at::date BETWEEN v_from AND v_to),
      'cost_baselines', (SELECT count(*) FROM public.pricing_cost_baselines),
      'competitor_observations', (SELECT count(*) FROM public.pricing_competitor_observations)));

  RETURN v_out;
END;
$function$;

REVOKE ALL ON FUNCTION public.pricing_revenue_intelligence(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pricing_revenue_intelligence(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pricing_revenue_intelligence(date, date) TO service_role;