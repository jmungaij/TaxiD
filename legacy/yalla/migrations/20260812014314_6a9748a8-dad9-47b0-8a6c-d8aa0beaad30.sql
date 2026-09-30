-- Sequential quote numbers
CREATE SEQUENCE IF NOT EXISTS public.commercial_quote_number_seq;

CREATE OR REPLACE FUNCTION public.commercial_next_quote_number()
RETURNS text LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT 'YM-Q-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.commercial_quote_number_seq')::text, 6, '0');
$$;

-- Build a quotation entirely from published rate lines.
-- p_lines: [{"service_code":"day_trip","scope_label":"Naivasha","category_code":"van","quantity":2}]
CREATE OR REPLACE FUNCTION public.commercial_create_quotation(
  p_account_id uuid,
  p_lines jsonb,
  p_opportunity_id uuid DEFAULT NULL,
  p_contract_instance_id uuid DEFAULT NULL,
  p_rate_card_code text DEFAULT 'corporate_charter_rate_card',
  p_valid_until date DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_card public.commercial_rate_cards;
  v_quote_id uuid;
  v_number text;
  v_staff uuid;
  v_line jsonb;
  v_rl public.commercial_rate_lines;
  v_qty numeric;
  v_total numeric := 0;
  v_unpriced jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.is_platform_admin() OR public.is_commercial_staff()) THEN
    RAISE EXCEPTION 'not_authorised: commercial staff only';
  END IF;
  IF p_account_id IS NULL OR p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'invalid_input: account and at least one line are required';
  END IF;

  SELECT * INTO v_card FROM public.commercial_rate_cards
   WHERE code = p_rate_card_code AND retired_at IS NULL
   ORDER BY created_at DESC LIMIT 1;
  IF v_card.id IS NULL THEN
    RAISE EXCEPTION 'rate_card_missing: %', p_rate_card_code;
  END IF;

  SELECT id INTO v_staff FROM public.staff_members WHERE user_id = auth.uid() LIMIT 1;
  v_number := public.commercial_next_quote_number();

  INSERT INTO public.commercial_quotations (
    quote_number, account_id, opportunity_id, contract_instance_id,
    rate_card_id, rate_card_version, owner_staff_id, currency,
    total_amount, status, approval_status, valid_until, notes
  ) VALUES (
    v_number, p_account_id, p_opportunity_id, p_contract_instance_id,
    v_card.id, v_card.version, v_staff, v_card.currency,
    0, 'draft', 'not_required', p_valid_until, p_notes
  ) RETURNING id INTO v_quote_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_qty := coalesce((v_line->>'quantity')::numeric, 1);
    IF v_qty <= 0 THEN v_qty := 1; END IF;

    SELECT * INTO v_rl FROM public.commercial_rate_lines
     WHERE rate_card_id = v_card.id
       AND service_code = v_line->>'service_code'
       AND category_code = v_line->>'category_code'
       AND scope_label = coalesce(v_line->>'scope_label', scope_label)
       AND (v_line->>'pricing_basis' IS NULL OR pricing_basis = v_line->>'pricing_basis')
     ORDER BY pricing_basis LIMIT 1;

    IF v_rl.id IS NULL THEN
      v_unpriced := v_unpriced || jsonb_build_array(v_line);
      CONTINUE;
    END IF;

    INSERT INTO public.commercial_quotation_lines (
      quotation_id, rate_line_id, service_code, scope_label, category_code,
      pricing_basis, unit_amount, quantity, line_total, included_distance_km, conditions
    ) VALUES (
      v_quote_id, v_rl.id, v_rl.service_code, v_rl.scope_label, v_rl.category_code,
      v_rl.pricing_basis, v_rl.amount, v_qty, round(v_rl.amount * v_qty, 2),
      v_rl.included_distance_km, v_rl.conditions
    );
    v_total := v_total + round(v_rl.amount * v_qty, 2);
  END LOOP;

  UPDATE public.commercial_quotations
     SET total_amount = v_total,
         approval_status = CASE
           WHEN jsonb_array_length(v_unpriced) > 0 THEN 'required'
           WHEN v_card.status <> 'approved' THEN 'required'
           ELSE 'not_required' END
   WHERE id = v_quote_id;

  PERFORM public.ops_enqueue_event(
    v_quote_id::text, 'commercial.quotation.created', 'staff_portal',
    'quotation', v_quote_id, v_number, 'corporate_charter',
    jsonb_build_object('amountKes', v_total, 'needsApproval', jsonb_array_length(v_unpriced) > 0),
    jsonb_build_object('accountId', p_account_id, 'rateCardVersion', v_card.version,
                       'unpricedRequests', v_unpriced)
  );

  RETURN jsonb_build_object(
    'quotation_id', v_quote_id,
    'quote_number', v_number,
    'total_amount', v_total,
    'currency', v_card.currency,
    'rate_card_version', v_card.version,
    'rate_card_status', v_card.status,
    'unpriced', v_unpriced
  );
END $$;

REVOKE ALL ON FUNCTION public.commercial_create_quotation(uuid,jsonb,uuid,uuid,text,date,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commercial_create_quotation(uuid,jsonb,uuid,uuid,text,date,text) TO authenticated, service_role;

-- Formal request for pricing the rate card does not cover
CREATE OR REPLACE FUNCTION public.commercial_request_pricing(
  p_service_code text,
  p_requirement text,
  p_account_id uuid DEFAULT NULL,
  p_opportunity_id uuid DEFAULT NULL,
  p_scope_label text DEFAULT NULL,
  p_category_code text DEFAULT NULL,
  p_rate_card_code text DEFAULT 'corporate_charter_rate_card'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_staff uuid; v_card uuid;
BEGIN
  IF NOT public.is_staff_portal_member(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorised: staff portal members only';
  END IF;
  IF coalesce(trim(p_requirement),'') = '' THEN
    RAISE EXCEPTION 'invalid_input: requirement is required';
  END IF;

  SELECT id INTO v_staff FROM public.staff_members WHERE user_id = auth.uid() LIMIT 1;
  SELECT id INTO v_card FROM public.commercial_rate_cards
   WHERE code = p_rate_card_code AND retired_at IS NULL ORDER BY created_at DESC LIMIT 1;

  INSERT INTO public.commercial_pricing_requests (
    account_id, opportunity_id, rate_card_id, requested_by_staff_id,
    service_code, scope_label, category_code, requirement, status
  ) VALUES (
    p_account_id, p_opportunity_id, v_card, v_staff,
    p_service_code, p_scope_label, p_category_code, trim(p_requirement), 'pending'
  ) RETURNING id INTO v_id;

  PERFORM public.ops_enqueue_event(
    v_id::text, 'commercial.pricing.requested', 'staff_portal',
    'pricing_request', v_id, p_service_code, 'corporate_charter',
    jsonb_build_object('slaSensitive', true),
    jsonb_build_object('accountId', p_account_id, 'scope', p_scope_label, 'category', p_category_code)
  );
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.commercial_request_pricing(text,text,uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commercial_request_pricing(text,text,uuid,uuid,text,text,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.commercial_decide_pricing_request(
  p_request_id uuid,
  p_status text,
  p_decision_note text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not_authorised: platform admins only';
  END IF;
  IF p_status NOT IN ('approved','declined','superseded') THEN
    RAISE EXCEPTION 'invalid_input: unsupported status %', p_status;
  END IF;
  IF coalesce(trim(p_decision_note),'') = '' THEN
    RAISE EXCEPTION 'invalid_input: a decision note is required';
  END IF;

  UPDATE public.commercial_pricing_requests
     SET status = p_status, decided_by = auth.uid(), decided_at = now(),
         decision_note = trim(p_decision_note)
   WHERE id = p_request_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: pending pricing request % not found', p_request_id;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.commercial_decide_pricing_request(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commercial_decide_pricing_request(uuid,text,text) TO authenticated, service_role;

-- Full commercial pack for one account (contract + schedule + quotes)
CREATE OR REPLACE FUNCTION public.commercial_account_pack(p_account_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'contracts', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ci.id, 'template', t.name, 'template_version', t.version,
        'status', ci.status, 'effective_date', ci.effective_date,
        'contract_term', ci.contract_term, 'selected_services', ci.selected_services,
        'customer_legal_name', ci.customer_legal_name, 'document_id', ci.document_id,
        'rate_card_version', rc.version, 'rate_card_status', rc.status,
        'schedules', coalesce((
          SELECT jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'services', s.services,
                 'locations', s.locations, 'vehicle_categories', s.vehicle_categories,
                 'commercial_terms', s.commercial_terms, 'validity', s.validity,
                 'special_conditions', s.special_conditions, 'approval_status', s.approval_status))
          FROM public.commercial_schedules s WHERE s.contract_instance_id = ci.id), '[]'::jsonb)
      ) ORDER BY ci.created_at)
      FROM public.commercial_contract_instances ci
      JOIN public.commercial_contract_templates t ON t.id = ci.template_id
      LEFT JOIN public.commercial_rate_cards rc ON rc.id = ci.rate_card_id
      WHERE ci.account_id = p_account_id), '[]'::jsonb),
    'quotations', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', q.id, 'quote_number', q.quote_number,
             'total_amount', q.total_amount, 'currency', q.currency, 'status', q.status,
             'approval_status', q.approval_status, 'rate_card_version', q.rate_card_version,
             'valid_until', q.valid_until, 'created_at', q.created_at) ORDER BY q.created_at DESC)
      FROM public.commercial_quotations q WHERE q.account_id = p_account_id), '[]'::jsonb),
    'pricing_requests', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', pr.id, 'service_code', pr.service_code,
             'scope_label', pr.scope_label, 'category_code', pr.category_code,
             'requirement', pr.requirement, 'status', pr.status,
             'decision_note', pr.decision_note) ORDER BY pr.created_at DESC)
      FROM public.commercial_pricing_requests pr WHERE pr.account_id = p_account_id), '[]'::jsonb)
  )
  WHERE public.is_staff_portal_member(auth.uid());
$$;

REVOKE ALL ON FUNCTION public.commercial_account_pack(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commercial_account_pack(uuid) TO authenticated, service_role;