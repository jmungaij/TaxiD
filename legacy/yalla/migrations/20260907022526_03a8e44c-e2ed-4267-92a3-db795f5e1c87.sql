CREATE TABLE IF NOT EXISTS public.commercial_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('proposal','contract','service_order')),
  entity_id uuid NOT NULL,
  entity_ref text,
  account_id uuid,
  title text NOT NULL,
  amount_cents bigint,
  currency text NOT NULL DEFAULT 'KES',
  justification text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','withdrawn')),
  requested_by uuid,
  requested_staff_id uuid,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS commercial_approvals_open_key
  ON public.commercial_approvals (entity_type, entity_id)
  WHERE status = 'pending';

GRANT SELECT ON public.commercial_approvals TO authenticated;
GRANT ALL ON public.commercial_approvals TO service_role;
ALTER TABLE public.commercial_approvals ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.commercial_can_approve(_user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
     WHERE ur.user_id = _user_id
       AND ur.role::text IN ('admin','super_admin','director','general_manager',
                             'finance_admin','operations_admin','operations_manager')
  )
$$;
REVOKE ALL ON FUNCTION public.commercial_can_approve(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commercial_can_approve(uuid) TO authenticated;

CREATE POLICY "Approvers and requesters read commercial approvals"
ON public.commercial_approvals FOR SELECT TO authenticated
USING (
  public.commercial_can_approve(auth.uid())
  OR requested_by = auth.uid()
  OR requested_staff_id IN (SELECT id FROM public.staff_members WHERE user_id = auth.uid())
);

CREATE OR REPLACE FUNCTION public.commercial_approvals_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS commercial_approvals_touch ON public.commercial_approvals;
CREATE TRIGGER commercial_approvals_touch BEFORE UPDATE ON public.commercial_approvals
FOR EACH ROW EXECUTE FUNCTION public.commercial_approvals_touch();

/* ----------------------------- request approval ---------------------------- */
CREATE OR REPLACE FUNCTION public.commercial_request_approval(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff uuid; v_type text; v_entity uuid; v_id uuid;
  v_title text; v_account uuid; v_ref text; v_amount bigint; v_currency text := 'KES';
  q record; c record; s record;
BEGIN
  SELECT id INTO v_staff FROM public.staff_members WHERE user_id = auth.uid();
  IF v_staff IS NULL THEN RAISE EXCEPTION 'Only staff members can request an approval'; END IF;

  v_type := lower(coalesce(p->>'entity_type',''));
  v_entity := nullif(p->>'entity_id','')::uuid;
  IF v_type NOT IN ('proposal','contract','service_order') THEN
    RAISE EXCEPTION 'Unknown approval type';
  END IF;
  IF v_entity IS NULL THEN RAISE EXCEPTION 'The record to approve is required'; END IF;

  IF v_type = 'proposal' THEN
    SELECT * INTO q FROM public.commercial_quotations WHERE id = v_entity;
    IF q.id IS NULL THEN RAISE EXCEPTION 'That proposal does not exist'; END IF;
    v_title := 'Proposal ' || q.quote_number;
    v_account := q.account_id;
    v_ref := q.quote_number;
    v_amount := round(coalesce(q.total_amount,0) * 100);
    v_currency := coalesce(q.currency,'KES');
    UPDATE public.commercial_quotations
       SET approval_status = 'pending', status = CASE WHEN status = 'draft' THEN 'in_review' ELSE status END
     WHERE id = v_entity;
  ELSIF v_type = 'contract' THEN
    SELECT * INTO c FROM public.commercial_contract_instances WHERE id = v_entity;
    IF c.id IS NULL THEN RAISE EXCEPTION 'That contract does not exist'; END IF;
    v_title := 'Contract for ' || c.customer_legal_name;
    v_account := c.account_id;
    v_ref := c.customer_legal_name;
  ELSE
    SELECT * INTO s FROM public.commercial_schedules WHERE id = v_entity;
    IF s.id IS NULL THEN RAISE EXCEPTION 'That service order does not exist'; END IF;
    SELECT account_id INTO v_account FROM public.commercial_contract_instances WHERE id = s.contract_instance_id;
    v_title := 'Service order ' || s.title;
    v_ref := s.title;
    UPDATE public.commercial_schedules SET approval_status = 'pending' WHERE id = v_entity;
  END IF;

  INSERT INTO public.commercial_approvals (
    entity_type, entity_id, entity_ref, account_id, title, amount_cents, currency,
    justification, requested_by, requested_staff_id
  ) VALUES (
    v_type, v_entity, v_ref, v_account, v_title, v_amount, v_currency,
    nullif(p->>'justification',''), auth.uid(), v_staff
  )
  ON CONFLICT (entity_type, entity_id) WHERE status = 'pending'
  DO UPDATE SET justification = coalesce(EXCLUDED.justification, public.commercial_approvals.justification),
                updated_at = now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('approval_id', v_id, 'status', 'pending');
END $$;
REVOKE ALL ON FUNCTION public.commercial_request_approval(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commercial_request_approval(jsonb) TO authenticated;

/* ------------------------------ decide approval ---------------------------- */
CREATE OR REPLACE FUNCTION public.commercial_decide_approval(p_id uuid, p_decision text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; v_decision text;
BEGIN
  IF NOT public.commercial_can_approve(auth.uid()) THEN
    RAISE EXCEPTION 'Only a manager can approve or decline commercial records';
  END IF;
  v_decision := lower(coalesce(p_decision,''));
  IF v_decision NOT IN ('approved','declined') THEN RAISE EXCEPTION 'The decision must be approved or declined'; END IF;

  SELECT * INTO a FROM public.commercial_approvals WHERE id = p_id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'That approval does not exist'; END IF;
  IF a.status <> 'pending' THEN RAISE EXCEPTION 'That approval was already decided'; END IF;

  UPDATE public.commercial_approvals
     SET status = v_decision, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(p_note,'')
   WHERE id = p_id;

  IF a.entity_type = 'proposal' THEN
    UPDATE public.commercial_quotations
       SET approval_status = CASE WHEN v_decision = 'approved' THEN 'approved' ELSE 'rejected' END,
           status = CASE WHEN v_decision = 'approved' THEN 'approved' ELSE 'draft' END
     WHERE id = a.entity_id;
  ELSIF a.entity_type = 'contract' THEN
    UPDATE public.commercial_contract_instances
       SET status = CASE WHEN v_decision = 'approved' THEN 'active' ELSE 'draft' END
     WHERE id = a.entity_id;
  ELSE
    UPDATE public.commercial_schedules
       SET approval_status = CASE WHEN v_decision = 'approved' THEN 'approved' ELSE 'rejected' END,
           approved_by = CASE WHEN v_decision = 'approved' THEN auth.uid() ELSE NULL END,
           approved_at = CASE WHEN v_decision = 'approved' THEN now() ELSE NULL END
     WHERE id = a.entity_id;
  END IF;

  RETURN jsonb_build_object('approval_id', p_id, 'status', v_decision, 'entity_type', a.entity_type, 'entity_id', a.entity_id);
END $$;
REVOKE ALL ON FUNCTION public.commercial_decide_approval(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commercial_decide_approval(uuid, text, text) TO authenticated;

/* ------------------------- contract → service handoff ---------------------- */
CREATE OR REPLACE FUNCTION public.commercial_service_handoff(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff uuid; c record; v_card uuid; v_id uuid; v_exc uuid; v_gaps text[] := '{}';
  v_services text[]; v_locations text[]; v_vehicles text[]; v_card_status text;
BEGIN
  SELECT id INTO v_staff FROM public.staff_members WHERE user_id = auth.uid();
  IF v_staff IS NULL THEN RAISE EXCEPTION 'Only staff members can hand a contract over to delivery'; END IF;

  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = nullif(p->>'contract_instance_id','')::uuid;
  IF c.id IS NULL THEN RAISE EXCEPTION 'That contract does not exist'; END IF;
  IF lower(c.status) NOT IN ('active','signed','executed') THEN
    RAISE EXCEPTION 'This contract is % — only an active contract can be handed over to delivery', c.status;
  END IF;

  v_card := coalesce(nullif(p->>'rate_card_id','')::uuid, c.rate_card_id);
  IF v_card IS NULL THEN RAISE EXCEPTION 'A rate card is required so the service is priced'; END IF;
  SELECT status INTO v_card_status FROM public.commercial_rate_cards WHERE id = v_card;

  v_services := coalesce(
    (SELECT array_agg(value) FROM jsonb_array_elements_text(coalesce(p->'services','[]'::jsonb)) AS t(value)),
    c.selected_services);
  v_locations := coalesce(
    (SELECT array_agg(value) FROM jsonb_array_elements_text(coalesce(p->'locations','[]'::jsonb)) AS t(value)), '{}');
  v_vehicles := coalesce(
    (SELECT array_agg(value) FROM jsonb_array_elements_text(coalesce(p->'vehicle_categories','[]'::jsonb)) AS t(value)), '{}');

  INSERT INTO public.commercial_schedules (
    contract_instance_id, rate_card_id, title, services, locations, vehicle_categories,
    validity, commercial_terms, special_conditions
  ) VALUES (
    c.id, v_card, coalesce(nullif(p->>'title',''), 'Service order for ' || c.customer_legal_name),
    coalesce(v_services,'{}'), coalesce(v_locations,'{}'), coalesce(v_vehicles,'{}'),
    nullif(p->>'validity',''), nullif(p->>'commercial_terms',''), nullif(p->>'special_conditions','')
  ) RETURNING id INTO v_id;

  PERFORM public.commercial_request_approval(jsonb_build_object(
    'entity_type','service_order','entity_id', v_id,
    'justification','Raised from the contract handoff'));

  IF coalesce(array_length(v_services,1),0) = 0 THEN v_gaps := v_gaps || 'no service is named'; END IF;
  IF coalesce(array_length(v_locations,1),0) = 0 THEN v_gaps := v_gaps || 'no delivery location is recorded'; END IF;
  IF coalesce(array_length(v_vehicles,1),0) = 0 THEN v_gaps := v_gaps || 'no vehicle category is recorded'; END IF;
  IF c.effective_date IS NULL THEN v_gaps := v_gaps || 'the contract has no effective date'; END IF;
  IF lower(coalesce(v_card_status,'')) NOT IN ('approved','published','active') THEN
    v_gaps := v_gaps || 'the rate card is not approved';
  END IF;

  IF array_length(v_gaps,1) > 0 THEN
    INSERT INTO public.commercial_exceptions (
      stage, kind, severity, owner_team, owner_user_id, customer_impact, operational_impact,
      root_cause, recommended_action, sla_hours, evidence
    ) VALUES (
      'service_handoff', 'service_order_not_ready', 'high', 'commercial', auth.uid(),
      'delayed', 'high',
      'Service order ' || v_id || ' was handed over with gaps: ' || array_to_string(v_gaps, '; '),
      'Complete the missing delivery details on the service order, then obtain approval.',
      24,
      jsonb_build_object('service_order_id', v_id, 'contract_instance_id', c.id,
                         'account_id', c.account_id, 'gaps', to_jsonb(v_gaps))
    ) RETURNING id INTO v_exc;
  END IF;

  RETURN jsonb_build_object('service_order_id', v_id, 'exception_id', v_exc, 'gaps', to_jsonb(v_gaps));
END $$;
REVOKE ALL ON FUNCTION public.commercial_service_handoff(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commercial_service_handoff(jsonb) TO authenticated;