REVOKE ALL ON FUNCTION public._pipeline_lead_value_sync() FROM PUBLIC, anon, authenticated;

-- 1. Finance revenue review register ------------------------------------------
CREATE TABLE IF NOT EXISTS public.revenue_event_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revenue_event_id uuid NOT NULL REFERENCES public.contract_revenue_events(id) ON DELETE RESTRICT,
  contract_id uuid NOT NULL REFERENCES public.commercial_contract_instances(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('APPROVED','ADJUSTED','REJECTED')),
  original_amount numeric(14,2) NOT NULL,
  adjusted_amount numeric(14,2),
  delta_amount numeric(14,2),
  correction_event_id uuid REFERENCES public.contract_revenue_events(id),
  reason text NOT NULL,
  reviewer_id uuid,
  reviewer_staff_id uuid REFERENCES public.staff_members(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_revenue_event_reviews_event ON public.revenue_event_reviews(revenue_event_id);

GRANT SELECT ON public.revenue_event_reviews TO authenticated;
GRANT ALL ON public.revenue_event_reviews TO service_role;
ALTER TABLE public.revenue_event_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "revenue reviews readable by finance" ON public.revenue_event_reviews;
CREATE POLICY "revenue reviews readable by finance" ON public.revenue_event_reviews
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
         OR public.has_staff_permission('staff.finance.read')
         OR public.has_staff_permission('staff.commercial.read')
         OR public.has_staff_permission('staff.commercial.manage'));

CREATE OR REPLACE FUNCTION public._revenue_review_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'revenue_event_reviews is append-only';
END $$;
REVOKE ALL ON FUNCTION public._revenue_review_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_revenue_review_append_only ON public.revenue_event_reviews;
CREATE TRIGGER trg_revenue_review_append_only
  BEFORE UPDATE OR DELETE ON public.revenue_event_reviews
  FOR EACH ROW EXECUTE FUNCTION public._revenue_review_append_only();

-- 2. Finance guard -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._revenue_finance_authorised()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
      OR public.has_staff_permission('staff.finance.manage')
      OR public.has_staff_permission('staff.finance.read');
$$;
REVOKE ALL ON FUNCTION public._revenue_finance_authorised() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._revenue_finance_authorised() TO authenticated, service_role;

-- 3. Reconciliation queue ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revenue_reconciliation_queue()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ok boolean;
BEGIN
  v_ok := public._revenue_finance_authorised()
       OR public.has_staff_permission('staff.commercial.manage')
       OR public.has_staff_permission('staff.commercial.read');
  IF NOT v_ok THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED'); END IF;

  RETURN (
    WITH ev AS (
      SELECT r.*, c.contract_number, c.customer_legal_name, c.status AS contract_status,
             c.value_amount AS contract_value, c.is_test,
             a.name AS account_name, sm.full_name AS owner_name,
             lr.decision AS review_decision, lr.reason AS review_reason,
             lr.created_at AS reviewed_at, lr.adjusted_amount, lr.delta_amount,
             rsm.full_name AS reviewer_name
        FROM public.contract_revenue_events r
        JOIN public.commercial_contract_instances c ON c.id = r.contract_id
        LEFT JOIN public.crm_accounts a ON a.id = r.account_id
        LEFT JOIN public.staff_members sm ON sm.id = r.staff_member_id
        LEFT JOIN LATERAL (
          SELECT * FROM public.revenue_event_reviews x
           WHERE x.revenue_event_id = r.id ORDER BY x.created_at DESC LIMIT 1
        ) lr ON true
        LEFT JOIN public.staff_members rsm ON rsm.id = lr.reviewer_staff_id
       WHERE NOT c.is_test
    )
    SELECT jsonb_build_object(
      'ok', true,
      'can_decide', public._revenue_finance_authorised(),
      'totals', jsonb_build_object(
        'events', (SELECT count(*) FROM ev),
        'unreviewed', (SELECT count(*) FROM ev WHERE review_decision IS NULL),
        'unreviewed_kes', (SELECT coalesce(sum(amount),0) FROM ev WHERE review_decision IS NULL),
        'approved_kes', (SELECT coalesce(sum(amount),0) FROM ev WHERE review_decision = 'APPROVED'),
        'adjusted_kes', (SELECT coalesce(sum(delta_amount),0) FROM ev WHERE review_decision = 'ADJUSTED'),
        'rejected_kes', (SELECT coalesce(sum(amount),0) FROM ev WHERE review_decision = 'REJECTED'),
        'net_kes', (SELECT coalesce(sum(amount),0) FROM ev)
      ),
      'periods', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                    'revenue_period', p.revenue_period, 'events', p.n, 'amount_kes', p.amount,
                    'unreviewed', p.unreviewed) ORDER BY p.revenue_period DESC), '[]'::jsonb)
                  FROM (SELECT revenue_period, count(*) n, sum(amount) amount,
                               count(*) FILTER (WHERE review_decision IS NULL) unreviewed
                          FROM ev GROUP BY revenue_period) p),
      'events', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'id', e.id, 'contract_id', e.contract_id, 'contract_number', e.contract_number,
                   'customer', coalesce(e.account_name, e.customer_legal_name),
                   'owner_name', e.owner_name, 'event_type', e.event_type,
                   'amount', e.amount, 'currency', e.currency, 'revenue_period', e.revenue_period,
                   'execution_date', e.execution_date, 'created_at', e.created_at,
                   'contract_value', e.contract_value, 'contract_status', e.contract_status,
                   'variance', CASE WHEN e.contract_value IS NULL OR e.event_type <> 'CONTRACT_EXECUTED'
                                    THEN NULL ELSE round(e.amount - e.contract_value, 2) END,
                   'review_decision', e.review_decision, 'review_reason', e.review_reason,
                   'reviewed_at', e.reviewed_at, 'reviewer_name', e.reviewer_name,
                   'adjusted_amount', e.adjusted_amount, 'delta_amount', e.delta_amount)
                   ORDER BY e.created_at DESC), '[]'::jsonb) FROM ev e)
    )
  );
END $$;
REVOKE ALL ON FUNCTION public.revenue_reconciliation_queue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revenue_reconciliation_queue() TO authenticated, service_role;

-- 4. Decision -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.revenue_event_review(_event uuid, _decision text, _reason text,
                                                       _adjusted_amount numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE e public.contract_revenue_events; v_delta numeric; v_corr uuid; v_ver integer; v_type text; v_staff uuid;
BEGIN
  IF NOT public._revenue_finance_authorised() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  END IF;
  IF coalesce(btrim(_reason),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'REASON_REQUIRED');
  END IF;
  IF upper(_decision) NOT IN ('APPROVED','ADJUSTED','REJECTED') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNKNOWN_DECISION');
  END IF;

  SELECT * INTO e FROM public.contract_revenue_events WHERE id = _event;
  IF e.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'EVENT_NOT_FOUND'); END IF;
  IF EXISTS (SELECT 1 FROM public.revenue_event_reviews WHERE revenue_event_id = _event) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_REVIEWED');
  END IF;

  v_staff := public._my_staff_member_id();

  IF upper(_decision) = 'ADJUSTED' THEN
    IF _adjusted_amount IS NULL OR _adjusted_amount < 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ADJUSTED_AMOUNT_REQUIRED');
    END IF;
    v_delta := round(_adjusted_amount - e.amount, 2);
    v_type := 'REVENUE_ADJUSTED';
  ELSIF upper(_decision) = 'REJECTED' THEN
    v_delta := -e.amount;
    v_type := 'REVENUE_REVERSED';
  END IF;

  IF v_type IS NOT NULL AND v_delta <> 0 THEN
    SELECT coalesce(max(activation_version),0) + 1 INTO v_ver
      FROM public.contract_revenue_events WHERE contract_id = e.contract_id AND event_type = v_type;
    INSERT INTO public.contract_revenue_events
      (contract_id, account_id, opportunity_id, lead_id, staff_member_id, event_type, activation_version,
       amount, currency, value_type, execution_date, revenue_period, revenue_treatment, source, reason, created_by)
    VALUES (e.contract_id, e.account_id, e.opportunity_id, e.lead_id, e.staff_member_id, v_type, v_ver,
            v_delta, e.currency, e.value_type, e.execution_date, e.revenue_period, e.revenue_treatment,
            'finance_review', _reason, auth.uid())
    RETURNING id INTO v_corr;
  END IF;

  INSERT INTO public.revenue_event_reviews
    (revenue_event_id, contract_id, decision, original_amount, adjusted_amount, delta_amount,
     correction_event_id, reason, reviewer_id, reviewer_staff_id)
  VALUES (e.id, e.contract_id, upper(_decision), e.amount,
          CASE WHEN upper(_decision) = 'ADJUSTED' THEN _adjusted_amount
               WHEN upper(_decision) = 'REJECTED' THEN 0 ELSE e.amount END,
          v_delta, v_corr, _reason, auth.uid(), v_staff);

  INSERT INTO public.contract_events
    (contract_id, event_type, from_status, to_status, before_state, after_state, reason, actor_id, actor_staff_id)
  VALUES (e.contract_id, 'REVENUE_' || upper(_decision), NULL, NULL,
          jsonb_build_object('revenue_event_id', e.id, 'amount', e.amount),
          jsonb_build_object('adjusted_amount', _adjusted_amount, 'delta', v_delta, 'correction_event_id', v_corr),
          _reason, auth.uid(), v_staff);

  RETURN jsonb_build_object('ok', true, 'revenue_event_id', e.id, 'decision', upper(_decision),
                            'delta', v_delta, 'correction_event_id', v_corr);
END $$;
REVOKE ALL ON FUNCTION public.revenue_event_review(uuid, text, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revenue_event_review(uuid, text, text, numeric) TO authenticated, service_role;

-- 5. Manager exception feed ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.contract_control_exceptions()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_ok boolean;
BEGIN
  v_ok := public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')
       OR public.has_staff_permission('staff.commercial.read')
       OR public.has_staff_permission('staff.commercial.manage')
       OR public.has_staff_permission('staff.finance.read');
  IF NOT v_ok THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED'); END IF;

  RETURN (
    WITH c AS (
      SELECT ct.*, a.name AS account_name, sm.full_name AS owner_name,
             o.expected_value_cents, o.opportunity_ref
        FROM public.commercial_contract_instances ct
        LEFT JOIN public.crm_accounts a ON a.id = ct.account_id
        LEFT JOIN public.staff_members sm ON sm.id = ct.owner_staff_id
        LEFT JOIN public.commercial_opportunities o ON o.id = ct.opportunity_id
       WHERE NOT ct.is_test
    )
    SELECT jsonb_build_object(
      'ok', true,
      'pending_activation', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'contract_id', x.id, 'contract_number', x.contract_number,
          'customer', coalesce(x.account_name, x.customer_legal_name), 'owner_name', x.owner_name,
          'status', x.status, 'value_amount', x.value_amount, 'currency', x.currency,
          'execution_date', x.execution_date,
          'blockers', (SELECT count(*) FROM jsonb_array_elements(
                         coalesce(public.contract_activation_check(x.id)->'checks','[]'::jsonb)) k
                        WHERE (k->>'passed')::boolean IS NOT TRUE))
          ORDER BY x.value_amount DESC NULLS LAST), '[]'::jsonb)
        FROM c x WHERE x.status IN ('executed','customer_accepted','signature_pending','partially_signed')),
      'value_mismatch', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'contract_id', x.id, 'contract_number', x.contract_number,
          'customer', coalesce(x.account_name, x.customer_legal_name), 'owner_name', x.owner_name,
          'contract_value', x.value_amount, 'opportunity_value', x.expected_value_cents/100.0,
          'opportunity_ref', x.opportunity_ref,
          'variance', round(x.value_amount - x.expected_value_cents/100.0, 2),
          'variance_reason', x.variance_reason) ORDER BY abs(x.value_amount - x.expected_value_cents/100.0) DESC), '[]'::jsonb)
        FROM c x WHERE x.value_amount IS NOT NULL AND x.expected_value_cents IS NOT NULL
          AND x.expected_value_cents > 0
          AND abs(x.value_amount - x.expected_value_cents/100.0) > 0.1 * (x.expected_value_cents/100.0)),
      'revenue_pending_activation_kes', (SELECT coalesce(sum(x.value_amount),0) FROM c x
          WHERE x.status IN ('executed','customer_accepted')),
      'missing_value', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'contract_id', x.id, 'contract_number', x.contract_number,
          'customer', coalesce(x.account_name, x.customer_legal_name), 'owner_name', x.owner_name,
          'status', x.status)), '[]'::jsonb) FROM c x WHERE x.value_amount IS NULL),
      'missing_signed_copy', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'contract_id', x.id, 'contract_number', x.contract_number,
          'customer', coalesce(x.account_name, x.customer_legal_name), 'owner_name', x.owner_name,
          'status', x.status)), '[]'::jsonb) FROM c x
        WHERE x.status IN ('executed','contracted','active')
          AND NOT EXISTS (SELECT 1 FROM public.contract_documents d
                           WHERE d.contract_id = x.id AND d.document_type='executed' AND d.status='current')),
      'contracted_without_revenue', (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'contract_id', x.id, 'contract_number', x.contract_number,
          'customer', coalesce(x.account_name, x.customer_legal_name), 'owner_name', x.owner_name,
          'value_amount', x.value_amount)), '[]'::jsonb) FROM c x
        WHERE x.status IN ('contracted','active')
          AND NOT EXISTS (SELECT 1 FROM public.contract_revenue_events r WHERE r.contract_id = x.id)),
      'unreviewed_revenue', (SELECT count(*) FROM public.contract_revenue_events r
          JOIN public.commercial_contract_instances ct2 ON ct2.id = r.contract_id
         WHERE NOT ct2.is_test
           AND NOT EXISTS (SELECT 1 FROM public.revenue_event_reviews v WHERE v.revenue_event_id = r.id))
    )
  );
END $$;
REVOKE ALL ON FUNCTION public.contract_control_exceptions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_control_exceptions() TO authenticated, service_role;