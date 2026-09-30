-- 1. AMENDMENT REGISTER (append-only)
CREATE TABLE IF NOT EXISTS public.contract_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.commercial_contract_instances(id) ON DELETE CASCADE,
  amendment_no int NOT NULL,
  amendment_type text NOT NULL CHECK (amendment_type IN ('value','term_dates','commercial_terms','scope','mixed')),
  reason text NOT NULL,
  effective_date date,
  value_before numeric,
  value_after numeric,
  value_delta numeric,
  currency text NOT NULL DEFAULT 'KES',
  revenue_period text,
  revenue_event_id uuid REFERENCES public.contract_revenue_events(id),
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  changed_fields text[] NOT NULL DEFAULT '{}'::text[],
  actor_id uuid,
  actor_staff_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, amendment_no)
);

GRANT SELECT ON public.contract_amendments TO authenticated;
GRANT ALL ON public.contract_amendments TO service_role;
ALTER TABLE public.contract_amendments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contract readers see amendments" ON public.contract_amendments
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.commercial_contract_instances c
                  WHERE c.id = contract_amendments.contract_id AND public._contract_may_read(c)));

CREATE OR REPLACE FUNCTION public._contract_amendment_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'contract_amendments is append-only';
END $$;

DROP TRIGGER IF EXISTS contract_amendments_append_only ON public.contract_amendments;
CREATE TRIGGER contract_amendments_append_only
  BEFORE UPDATE OR DELETE ON public.contract_amendments
  FOR EACH ROW EXECUTE FUNCTION public._contract_amendment_immutable();

CREATE INDEX IF NOT EXISTS contract_amendments_contract_idx ON public.contract_amendments(contract_id, amendment_no DESC);

-- 2. AMENDMENT + AUTOMATIC REVENUE RECALCULATION
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
    v_fields := v_fields || 'value_amount';
  END IF;
  IF (_patch ? 'term_start') AND (_patch->>'term_start')::date IS DISTINCT FROM c.term_start THEN v_fields := v_fields || 'term_start'; END IF;
  IF (_patch ? 'term_end') AND (_patch->>'term_end')::date IS DISTINCT FROM c.term_end THEN v_fields := v_fields || 'term_end'; END IF;
  IF (_patch ? 'payment_terms') AND (_patch->>'payment_terms') IS DISTINCT FROM c.payment_terms THEN v_fields := v_fields || 'payment_terms'; END IF;
  IF (_patch ? 'renewal_terms') AND (_patch->>'renewal_terms') IS DISTINCT FROM c.renewal_terms THEN v_fields := v_fields || 'renewal_terms'; END IF;
  IF (_patch ? 'billing_frequency') AND (_patch->>'billing_frequency') IS DISTINCT FROM c.billing_frequency THEN v_fields := v_fields || 'billing_frequency'; END IF;
  IF (_patch ? 'value_type') AND (_patch->>'value_type') IS DISTINCT FROM c.value_type THEN v_fields := v_fields || 'value_type'; END IF;
  IF (_patch ? 'revenue_period') AND (_patch->>'revenue_period') IS DISTINCT FROM c.revenue_period THEN v_fields := v_fields || 'revenue_period'; END IF;

  IF array_length(v_fields, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_CHANGE',
      'detail', 'Nothing in this amendment differs from the recorded contract.');
  END IF;

  v_type := CASE
    WHEN v_fields = ARRAY['value_amount'] THEN 'value'
    WHEN v_fields <@ ARRAY['term_start','term_end'] THEN 'term_dates'
    WHEN v_fields <@ ARRAY['payment_terms','renewal_terms','billing_frequency','value_type','revenue_period'] THEN 'commercial_terms'
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

  -- automatic revenue recalculation: post only the difference, never the whole value again
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
          jsonb_build_object('amendment_id', v_amend, 'amendment_no', v_no, 'changed_fields', v_fields,
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

GRANT EXECUTE ON FUNCTION public.contract_amend(uuid, jsonb, text) TO authenticated;

-- 3. CREATE A CONTRACT
CREATE OR REPLACE FUNCTION public.contract_create(_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_staff uuid;
  v_template uuid;
  v_account uuid;
  v_name text;
  v_id uuid;
  v_number text;
BEGIN
  v_staff := public._my_staff_member_id();
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
          OR public.has_staff_permission('staff.commercial.manage') OR v_staff IS NOT NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  END IF;

  v_account := (_patch->>'account_id')::uuid;
  IF v_account IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'ACCOUNT_REQUIRED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_accounts WHERE id = v_account) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACCOUNT_NOT_FOUND');
  END IF;

  SELECT coalesce(_patch->>'customer_legal_name', a.legal_name, a.name) INTO v_name
    FROM public.crm_accounts a WHERE a.id = v_account;
  IF coalesce(btrim(v_name), '') = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'CUSTOMER_NAME_REQUIRED'); END IF;

  v_template := (_patch->>'template_id')::uuid;
  IF v_template IS NULL THEN
    SELECT id INTO v_template FROM public.commercial_contract_templates
     WHERE status = 'approved' ORDER BY updated_at DESC LIMIT 1;
  END IF;
  IF v_template IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NO_APPROVED_TEMPLATE'); END IF;

  v_number := public._contract_number();

  INSERT INTO public.commercial_contract_instances
    (template_id, account_id, opportunity_id, lead_id, owner_staff_id, customer_legal_name, contract_number,
     title, contract_type, status, currency, value_type, value_amount, revenue_period, term_start, term_end,
     payment_terms, is_test)
  VALUES (v_template, v_account, (_patch->>'opportunity_id')::uuid, (_patch->>'lead_id')::uuid,
          coalesce((_patch->>'owner_staff_id')::uuid, v_staff), v_name, v_number,
          coalesce(_patch->>'title', 'Mobility Service Contract — ' || v_name),
          coalesce(_patch->>'contract_type', 'mobility_services'), 'draft',
          coalesce(upper(_patch->>'currency'), 'KES'), coalesce(_patch->>'value_type', 'one_time'),
          (_patch->>'value_amount')::numeric, _patch->>'revenue_period',
          (_patch->>'term_start')::date, (_patch->>'term_end')::date, _patch->>'payment_terms',
          coalesce((_patch->>'is_test')::boolean, false))
  RETURNING id INTO v_id;

  INSERT INTO public.contract_events
    (contract_id, event_type, from_status, to_status, after_state, reason, actor_id, actor_staff_id)
  VALUES (v_id, 'CONTRACT_CREATED', NULL, 'draft',
          jsonb_build_object('contract_number', v_number, 'account_id', v_account),
          _patch->>'reason', auth.uid(), v_staff);

  RETURN jsonb_build_object('ok', true, 'contract_id', v_id, 'contract_number', v_number, 'status', 'draft');
END $$;

GRANT EXECUTE ON FUNCTION public.contract_create(jsonb) TO authenticated;

-- 4. STATUS MOVEMENT + CUSTOMER ACCEPTANCE
CREATE OR REPLACE FUNCTION public.contract_status_set(_contract uuid, _status text, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.commercial_contract_instances; before_state jsonb;
BEGIN
  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = _contract FOR UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_NOT_FOUND'); END IF;
  IF NOT public._contract_may_activate(c) THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED'); END IF;
  IF c.activated_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_IS_ACTIVATED'); END IF;
  IF _status NOT IN ('draft','internal_review','approved','sent_to_customer','customer_review',
                     'under_negotiation','customer_accepted','signature_pending','partially_signed',
                     'executed','declined') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STATUS_NOT_ALLOWED');
  END IF;

  before_state := to_jsonb(c);
  UPDATE public.commercial_contract_instances SET status = _status, updated_at = now() WHERE id = _contract;

  INSERT INTO public.contract_events
    (contract_id, event_type, from_status, to_status, before_state, after_state, reason, actor_id, actor_staff_id)
  VALUES (_contract, 'STATUS_CHANGED', c.status, _status, before_state,
          jsonb_build_object('status', _status), _reason, auth.uid(), public._my_staff_member_id());

  RETURN jsonb_build_object('ok', true, 'contract_id', _contract, 'status', _status);
END $$;

GRANT EXECUTE ON FUNCTION public.contract_status_set(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.contract_acceptance_record(
  _contract uuid, _accepted_on date, _accepted_by text, _channel text,
  _reference text DEFAULT NULL, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.commercial_contract_instances; before_state jsonb; v_doc jsonb;
BEGIN
  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = _contract FOR UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_NOT_FOUND'); END IF;
  IF NOT public._contract_may_activate(c) THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED'); END IF;
  IF coalesce(btrim(_accepted_by), '') = '' OR _accepted_on IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACCEPTANCE_EVIDENCE_REQUIRED',
      'detail', 'Record who accepted on the customer side and the date they accepted.');
  END IF;
  IF coalesce(btrim(_reference), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACCEPTANCE_REFERENCE_REQUIRED',
      'detail', 'Reference the acceptance evidence — the email, letter or signed page it came on.');
  END IF;

  before_state := to_jsonb(c);

  UPDATE public.commercial_contract_instances SET
    customer_signatory = coalesce(customer_signatory, _accepted_by),
    status = CASE WHEN status IN ('contracted','active','completed','terminated','executed') THEN status
                  ELSE 'customer_accepted' END,
    updated_at = now()
  WHERE id = _contract;

  v_doc := public.contract_document_attach(_contract, 'acceptance_evidence', NULL, NULL,
             coalesce(_channel, 'recorded') || ': ' || _reference,
             coalesce(_notes, 'Accepted by ' || _accepted_by || ' on ' || _accepted_on::text));

  INSERT INTO public.contract_events
    (contract_id, event_type, from_status, to_status, before_state, after_state, reason, actor_id, actor_staff_id)
  VALUES (_contract, 'CUSTOMER_ACCEPTED', c.status, 'customer_accepted', before_state,
          jsonb_build_object('accepted_by', _accepted_by, 'accepted_on', _accepted_on,
                             'channel', _channel, 'reference', _reference, 'document', v_doc),
          _notes, auth.uid(), public._my_staff_member_id());

  RETURN jsonb_build_object('ok', true, 'contract_id', _contract, 'status', 'customer_accepted', 'document', v_doc);
END $$;

GRANT EXECUTE ON FUNCTION public.contract_acceptance_record(uuid, date, text, text, text, text) TO authenticated;

-- 5. SIGNED CONTRACT -> OWNED WORK QUEUE TASK WITH A DEADLINE
CREATE OR REPLACE FUNCTION public._contract_signed_work()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_test THEN RETURN NEW; END IF;
  IF NEW.owner_staff_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  IF NEW.status IN ('customer_accepted','executed','signature_pending','partially_signed') THEN
    PERFORM public._sales_work_ensure(
      NEW.owner_staff_id, 'contract_activation',
      CASE WHEN NEW.status = 'executed' THEN 'Activate signed contract — ' ELSE 'Close out signature — ' END
        || coalesce(NEW.customer_legal_name, 'customer'),
      'Contract ' || coalesce(NEW.contract_number, '(unnumbered)') || ' is ' || NEW.status
        || '. Complete value, signatories and the signed copy, then activate it so the revenue is recorded.',
      'commercial_contract_instances', NEW.id, NEW.contract_number,
      CASE WHEN NEW.status = 'executed' THEN 'high' ELSE 'medium' END, 2880);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS contract_signed_work ON public.commercial_contract_instances;
CREATE TRIGGER contract_signed_work
  AFTER UPDATE OF status ON public.commercial_contract_instances
  FOR EACH ROW EXECUTE FUNCTION public._contract_signed_work();

-- 6. MANAGER CONTRACTS DASHBOARD
CREATE OR REPLACE FUNCTION public.contract_manager_dashboard()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ok boolean;
BEGIN
  v_ok := public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
    OR public.has_staff_permission('staff.commercial.read') OR public.has_staff_permission('staff.commercial.manage')
    OR public.has_staff_permission('staff.finance.read');
  IF NOT v_ok THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED'); END IF;

  RETURN jsonb_build_object('ok', true,
    'month', to_char(now(), 'YYYY-MM'),
    'contracts', (
      SELECT coalesce(jsonb_agg(x ORDER BY x->>'sort_key' DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'contract_id', c.id, 'contract_number', c.contract_number, 'title', c.title,
          'customer', c.customer_legal_name, 'account_id', c.account_id, 'status', c.status,
          'value_amount', c.value_amount, 'currency', c.currency, 'value_type', c.value_type,
          'revenue_period', c.revenue_period, 'execution_date', c.execution_date,
          'term_start', c.term_start, 'term_end', c.term_end,
          'activated_at', c.activated_at, 'updated_at', c.updated_at,
          'owner_staff_id', c.owner_staff_id,
          'owner_name', s.full_name, 'owner_code', s.employee_code,
          'recognised_revenue', (SELECT coalesce(sum(r.amount),0) FROM public.contract_revenue_events r WHERE r.contract_id = c.id),
          'amendments', (SELECT count(*) FROM public.contract_amendments a WHERE a.contract_id = c.id),
          'has_executed_document', EXISTS (SELECT 1 FROM public.contract_documents d
                                            WHERE d.contract_id = c.id AND d.document_type='executed' AND d.status='current'),
          'has_acceptance', EXISTS (SELECT 1 FROM public.contract_documents d
                                      WHERE d.contract_id = c.id AND d.document_type IN ('acceptance_evidence','executed') AND d.status='current'),
          'open_tasks', (SELECT count(*) FROM public.staff_work_items w
                          WHERE w.source_table='commercial_contract_instances' AND w.source_id = c.id
                            AND w.status NOT IN ('done','cancelled')),
          'next_task_due', (SELECT min(w.sla_due_at) FROM public.staff_work_items w
                             WHERE w.source_table='commercial_contract_instances' AND w.source_id = c.id
                               AND w.status NOT IN ('done','cancelled')),
          'next_action', CASE
            WHEN c.activated_at IS NOT NULL THEN 'Delivering — no contract action outstanding'
            WHEN c.status IN ('draft','internal_review') THEN 'Finish the draft and send it for internal approval'
            WHEN c.status = 'approved' THEN 'Send the contract to the customer'
            WHEN c.status IN ('sent_to_customer','customer_review','signature_pending','partially_signed') THEN 'Chase the customer for signature'
            WHEN c.status = 'under_negotiation' THEN 'Close the open negotiation points'
            WHEN c.status = 'customer_accepted' THEN 'Collect the signed copy, then activate'
            WHEN c.status = 'executed' THEN 'Activate to record the revenue'
            WHEN c.status = 'declined' THEN 'Record the loss reason on the opportunity'
            ELSE 'Review with the owner' END,
          'sort_key', coalesce(c.value_amount, 0)::text
        ) AS x
        FROM public.commercial_contract_instances c
        LEFT JOIN public.staff_members s ON s.id = c.owner_staff_id
        WHERE NOT c.is_test
      ) t),
    'by_owner', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'owner_staff_id', o.owner_staff_id, 'owner_name', coalesce(o.full_name, 'Unassigned'),
        'contracts', o.n, 'open_value', o.open_value, 'recognised_revenue', o.revenue,
        'awaiting_signature', o.awaiting) ORDER BY o.revenue DESC), '[]'::jsonb)
      FROM (
        SELECT c.owner_staff_id, s.full_name, count(*) n,
               coalesce(sum(CASE WHEN c.activated_at IS NULL THEN c.value_amount ELSE 0 END),0) open_value,
               coalesce(sum((SELECT coalesce(sum(r.amount),0) FROM public.contract_revenue_events r WHERE r.contract_id=c.id)),0) revenue,
               count(*) FILTER (WHERE c.status IN ('sent_to_customer','customer_review','signature_pending','partially_signed')) awaiting
          FROM public.commercial_contract_instances c
          LEFT JOIN public.staff_members s ON s.id = c.owner_staff_id
         WHERE NOT c.is_test
         GROUP BY c.owner_staff_id, s.full_name
      ) o),
    'amendment_activity', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'amendment_id', a.id, 'contract_id', a.contract_id, 'contract_number', c.contract_number,
        'customer', c.customer_legal_name, 'amendment_no', a.amendment_no, 'amendment_type', a.amendment_type,
        'value_before', a.value_before, 'value_after', a.value_after, 'value_delta', a.value_delta,
        'currency', a.currency, 'reason', a.reason, 'created_at', a.created_at,
        'changed_fields', to_jsonb(a.changed_fields)) ORDER BY a.created_at DESC), '[]'::jsonb)
      FROM public.contract_amendments a
      JOIN public.commercial_contract_instances c ON c.id = a.contract_id
     WHERE NOT c.is_test AND a.created_at > now() - interval '120 days'),
    'centre', public.contract_control_centre());
END $$;

GRANT EXECUTE ON FUNCTION public.contract_manager_dashboard() TO authenticated;

-- 7. MY BOOK now carries amendments and the contract's own event history
CREATE OR REPLACE FUNCTION public.contract_my_book()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_staff uuid; v_rows jsonb;
BEGIN
  v_staff := public._my_staff_member_id();
  IF v_staff IS NULL AND NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_STAFF_IDENTITY');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'contract_id', c.id, 'contract_number', c.contract_number, 'title', c.title,
      'customer', c.customer_legal_name, 'status', c.status,
      'value_amount', c.value_amount, 'currency', c.currency, 'value_type', c.value_type,
      'revenue_period', c.revenue_period, 'execution_date', c.execution_date,
      'term_start', c.term_start, 'term_end', c.term_end,
      'payment_terms', c.payment_terms, 'renewal_terms', c.renewal_terms, 'billing_frequency', c.billing_frequency,
      'account_id', c.account_id, 'opportunity_id', c.opportunity_id, 'lead_id', c.lead_id,
      'customer_signatory', c.customer_signatory, 'company_signatory', c.company_signatory,
      'signature_date', c.signature_date, 'variance_reason', c.variance_reason,
      'activated_at', c.activated_at, 'is_test', c.is_test,
      'documents', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                       'document_type', d.document_type, 'version', d.version, 'file_name', d.file_name,
                       'reference', d.external_reference, 'uploaded_at', d.uploaded_at) ORDER BY d.uploaded_at DESC), '[]'::jsonb)
                     FROM public.contract_documents d WHERE d.contract_id = c.id AND d.status = 'current'),
      'revenue', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                       'amount', r.amount, 'currency', r.currency, 'revenue_period', r.revenue_period,
                       'event_type', r.event_type, 'created_at', r.created_at) ORDER BY r.created_at), '[]'::jsonb)
                     FROM public.contract_revenue_events r WHERE r.contract_id = c.id),
      'amendments', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                       'amendment_id', a.id, 'amendment_no', a.amendment_no, 'amendment_type', a.amendment_type,
                       'reason', a.reason, 'effective_date', a.effective_date, 'value_before', a.value_before,
                       'value_after', a.value_after, 'value_delta', a.value_delta, 'currency', a.currency,
                       'revenue_period', a.revenue_period, 'changed_fields', to_jsonb(a.changed_fields),
                       'created_at', a.created_at) ORDER BY a.amendment_no DESC), '[]'::jsonb)
                     FROM public.contract_amendments a WHERE a.contract_id = c.id),
      'timeline', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                       'event_type', e.event_type, 'from_status', e.from_status, 'to_status', e.to_status,
                       'reason', e.reason, 'created_at', e.created_at) ORDER BY e.created_at DESC), '[]'::jsonb)
                     FROM public.contract_events e WHERE e.contract_id = c.id),
      'tasks', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                       'work_item_id', w.id, 'title', w.title, 'status', w.status, 'priority', w.priority,
                       'due_at', w.sla_due_at) ORDER BY w.sla_due_at NULLS LAST), '[]'::jsonb)
                     FROM public.staff_work_items w
                    WHERE w.source_table = 'commercial_contract_instances' AND w.source_id = c.id
                      AND w.status NOT IN ('done','cancelled'))
    ) ORDER BY c.updated_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM public.commercial_contract_instances c
   WHERE public._contract_may_read(c)
     AND (v_staff IS NULL OR c.owner_staff_id = v_staff
          OR public.has_staff_permission('staff.commercial.manage')
          OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

  RETURN jsonb_build_object('ok', true, 'items', v_rows);
END $$;
