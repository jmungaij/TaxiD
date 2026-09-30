
-- ============ Collections actions ============
CREATE TABLE public.invoice_collection_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.tax_invoices(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (action_type IN ('call','email','visit','reminder','promise_to_pay','escalation','legal','write_off_request')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  due_on date NOT NULL DEFAULT current_date,
  note text,
  outcome text,
  promised_amount_cents bigint CHECK (promised_amount_cents IS NULL OR promised_amount_cents >= 0),
  promised_on date,
  owner_staff_id uuid REFERENCES public.staff_members(id),
  created_by uuid,
  closed_by uuid,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ica_invoice ON public.invoice_collection_actions(invoice_id, status);
CREATE INDEX idx_ica_due ON public.invoice_collection_actions(due_on) WHERE status = 'open';

GRANT SELECT, INSERT, UPDATE ON public.invoice_collection_actions TO authenticated;
GRANT ALL ON public.invoice_collection_actions TO service_role;
ALTER TABLE public.invoice_collection_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "collections read own or wide" ON public.invoice_collection_actions
FOR SELECT TO authenticated
USING (
  public.is_platform_admin()
  OR public.has_staff_permission('staff.commercial.read')
  OR EXISTS (SELECT 1 FROM public.tax_invoices i
              WHERE i.id = invoice_id AND i.owner_staff_id = public._my_staff_member_id())
);
CREATE POLICY "collections write own or wide" ON public.invoice_collection_actions
FOR INSERT TO authenticated
WITH CHECK (
  public.is_platform_admin()
  OR public.has_staff_permission('staff.commercial.write')
  OR EXISTS (SELECT 1 FROM public.tax_invoices i
              WHERE i.id = invoice_id AND i.owner_staff_id = public._my_staff_member_id())
);
CREATE POLICY "collections update own or wide" ON public.invoice_collection_actions
FOR UPDATE TO authenticated
USING (
  public.is_platform_admin()
  OR public.has_staff_permission('staff.commercial.write')
  OR EXISTS (SELECT 1 FROM public.tax_invoices i
              WHERE i.id = invoice_id AND i.owner_staff_id = public._my_staff_member_id())
);

CREATE TRIGGER trg_ica_touch BEFORE UPDATE ON public.invoice_collection_actions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ Register ============
CREATE OR REPLACE FUNCTION public.collections_register()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb; v_staff uuid := public._my_staff_member_id(); v_wide boolean;
BEGIN
  v_wide := public.has_staff_permission('staff.commercial.read') OR public.is_platform_admin();
  IF NOT v_wide AND v_staff IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'scope', CASE WHEN v_wide THEN 'all' ELSE 'mine' END,
    'can_act', v_wide OR v_staff IS NOT NULL,
    'totals', (
      SELECT jsonb_build_object(
        'outstanding_cents', COALESCE(sum(b.balance),0),
        'overdue_cents', COALESCE(sum(b.balance) FILTER (WHERE b.days_overdue > 0),0),
        'invoice_count', count(*),
        'overdue_count', count(*) FILTER (WHERE b.days_overdue > 0),
        'bucket_current_cents', COALESCE(sum(b.balance) FILTER (WHERE b.days_overdue <= 0),0),
        'bucket_1_30_cents', COALESCE(sum(b.balance) FILTER (WHERE b.days_overdue BETWEEN 1 AND 30),0),
        'bucket_31_60_cents', COALESCE(sum(b.balance) FILTER (WHERE b.days_overdue BETWEEN 31 AND 60),0),
        'bucket_61_90_cents', COALESCE(sum(b.balance) FILTER (WHERE b.days_overdue BETWEEN 61 AND 90),0),
        'bucket_90_plus_cents', COALESCE(sum(b.balance) FILTER (WHERE b.days_overdue > 90),0)
      )
      FROM (
        SELECT (i.total_cents - i.paid_cents) AS balance,
               COALESCE(current_date - i.due_date, 0) AS days_overdue
        FROM public.tax_invoices i
        WHERE (v_wide OR i.owner_staff_id = v_staff)
          AND i.status IN ('issued','sent','part_paid')
          AND i.total_cents > i.paid_cents
      ) b
    ),
    'invoices', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id,
        'invoice_no', i.invoice_no,
        'status', i.status,
        'customer_company', i.customer_company,
        'customer_email', i.customer_email,
        'currency', i.currency,
        'total_cents', i.total_cents,
        'paid_cents', i.paid_cents,
        'balance_cents', i.total_cents - i.paid_cents,
        'issue_date', i.issue_date,
        'due_date', i.due_date,
        'days_overdue', GREATEST(COALESCE(current_date - i.due_date, 0), 0),
        'ageing_band', CASE
          WHEN COALESCE(current_date - i.due_date, 0) <= 0 THEN 'current'
          WHEN current_date - i.due_date <= 30 THEN '1_30'
          WHEN current_date - i.due_date <= 60 THEN '31_60'
          WHEN current_date - i.due_date <= 90 THEN '61_90'
          ELSE '90_plus' END,
        'owner_staff_id', i.owner_staff_id,
        'owner_name', sm.full_name,
        'is_test', i.is_test,
        'lead_id', i.lead_id,
        'lifecycle_state', (SELECT lc.current_state FROM public.commercial_lifecycle lc WHERE lc.lead_id = i.lead_id),
        'next_action', (
          SELECT jsonb_build_object('id', a.id, 'action_type', a.action_type, 'due_on', a.due_on,
                                    'note', a.note, 'promised_amount_cents', a.promised_amount_cents,
                                    'promised_on', a.promised_on)
          FROM public.invoice_collection_actions a
          WHERE a.invoice_id = i.id AND a.status = 'open'
          ORDER BY a.due_on ASC LIMIT 1),
        'last_action', (
          SELECT jsonb_build_object('action_type', a.action_type, 'outcome', a.outcome,
                                    'closed_at', a.closed_at, 'note', a.note)
          FROM public.invoice_collection_actions a
          WHERE a.invoice_id = i.id AND a.status = 'done'
          ORDER BY a.closed_at DESC NULLS LAST LIMIT 1),
        'open_action_count', (SELECT count(*) FROM public.invoice_collection_actions a
                               WHERE a.invoice_id = i.id AND a.status = 'open'),
        'actions', COALESCE((
          SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC)
          FROM public.invoice_collection_actions a WHERE a.invoice_id = i.id), '[]'::jsonb),
        'receipts', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('receipt_no', r.receipt_no, 'amount_cents', r.amount_cents,
                                              'received_on', r.received_on, 'method', r.method, 'status', r.status)
                 ORDER BY r.received_on DESC)
          FROM public.payment_receipts r WHERE r.invoice_id = i.id AND r.status <> 'void'), '[]'::jsonb)
      ) ORDER BY (i.total_cents - i.paid_cents) DESC)
      FROM public.tax_invoices i
      LEFT JOIN public.staff_members sm ON sm.id = i.owner_staff_id
      WHERE (v_wide OR i.owner_staff_id = v_staff)
        AND i.status IN ('issued','sent','part_paid','paid')
    ), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.collections_register() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collections_register() TO authenticated, service_role;

-- ============ Book / close an action ============
CREATE OR REPLACE FUNCTION public.collection_action_save(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid; v_staff uuid := public._my_staff_member_id(); v_inv public.tax_invoices; v_wide boolean;
BEGIN
  v_wide := public.has_staff_permission('staff.commercial.write') OR public.is_platform_admin();
  SELECT * INTO v_inv FROM public.tax_invoices WHERE id = (p->>'invoice_id')::uuid;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND'; END IF;
  IF NOT v_wide AND (v_staff IS NULL OR v_inv.owner_staff_id IS DISTINCT FROM v_staff) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  IF COALESCE(btrim(p->>'action_type'),'') = '' THEN RAISE EXCEPTION 'ACTION_TYPE_REQUIRED'; END IF;

  INSERT INTO public.invoice_collection_actions(
    invoice_id, action_type, due_on, note, promised_amount_cents, promised_on, owner_staff_id, created_by)
  VALUES (v_inv.id, p->>'action_type',
          COALESCE((p->>'due_on')::date, current_date),
          NULLIF(btrim(COALESCE(p->>'note','')),''),
          NULLIF(p->>'promised_amount_cents','')::bigint,
          NULLIF(p->>'promised_on','')::date,
          COALESCE(v_staff, v_inv.owner_staff_id), auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.tax_invoice_events(invoice_id, event, note, actor_user_id)
  VALUES (v_inv.id, 'collection_action_booked',
          (p->>'action_type') || ' due ' || COALESCE(p->>'due_on', current_date::text), auth.uid());
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.collection_action_save(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collection_action_save(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.collection_action_close(_id uuid, _outcome text, _note text DEFAULT NULL, _cancel boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_a public.invoice_collection_actions; v_staff uuid := public._my_staff_member_id(); v_wide boolean; v_owner uuid;
BEGIN
  v_wide := public.has_staff_permission('staff.commercial.write') OR public.is_platform_admin();
  SELECT * INTO v_a FROM public.invoice_collection_actions WHERE id = _id FOR UPDATE;
  IF v_a.id IS NULL THEN RAISE EXCEPTION 'ACTION_NOT_FOUND'; END IF;
  SELECT owner_staff_id INTO v_owner FROM public.tax_invoices WHERE id = v_a.invoice_id;
  IF NOT v_wide AND (v_staff IS NULL OR v_owner IS DISTINCT FROM v_staff) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF v_a.status <> 'open' THEN RAISE EXCEPTION 'ACTION_ALREADY_CLOSED'; END IF;
  IF NOT _cancel AND COALESCE(btrim(_outcome),'') = '' THEN RAISE EXCEPTION 'OUTCOME_REQUIRED'; END IF;

  UPDATE public.invoice_collection_actions
     SET status = CASE WHEN _cancel THEN 'cancelled' ELSE 'done' END,
         outcome = NULLIF(btrim(COALESCE(_outcome,'')),''),
         note = COALESCE(NULLIF(btrim(COALESCE(_note,'')),''), note),
         closed_by = auth.uid(), closed_at = now()
   WHERE id = _id;

  INSERT INTO public.tax_invoice_events(invoice_id, event, note, actor_user_id)
  VALUES (v_a.invoice_id, CASE WHEN _cancel THEN 'collection_action_cancelled' ELSE 'collection_action_completed' END,
          COALESCE(_outcome, _note), auth.uid());
  RETURN _id;
END $$;

REVOKE ALL ON FUNCTION public.collection_action_close(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collection_action_close(uuid, text, text, boolean) TO authenticated, service_role;

-- ============ Weekly payment schedule digest (owner-grouped) ============
CREATE OR REPLACE FUNCTION public.payment_schedule_digest()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  IF NOT (public.is_platform_admin()
          OR public.has_staff_permission('staff.commercial.read')
          OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'week_of', date_trunc('week', current_date)::date,
    'outstanding_cents', COALESCE((SELECT sum(total_cents - paid_cents) FROM public.tax_invoices
       WHERE status IN ('issued','sent','part_paid') AND total_cents > paid_cents AND NOT COALESCE(is_test,false)), 0),
    'owners', COALESCE((
      SELECT jsonb_agg(o ORDER BY (o->>'outstanding_cents')::bigint DESC) FROM (
        SELECT jsonb_build_object(
          'owner_staff_id', i.owner_staff_id,
          'owner_name', COALESCE(sm.full_name, 'Unassigned'),
          'owner_email', sm.work_email,
          'outstanding_cents', sum(i.total_cents - i.paid_cents),
          'invoices', jsonb_agg(jsonb_build_object(
            'invoice_no', i.invoice_no,
            'customer_company', i.customer_company,
            'currency', i.currency,
            'balance_cents', i.total_cents - i.paid_cents,
            'due_date', i.due_date,
            'days_overdue', GREATEST(COALESCE(current_date - i.due_date, 0), 0),
            'next_action', (SELECT a.action_type || ' on ' || a.due_on::text
                              FROM public.invoice_collection_actions a
                             WHERE a.invoice_id = i.id AND a.status = 'open'
                             ORDER BY a.due_on LIMIT 1)
          ) ORDER BY i.due_date NULLS LAST)
        ) AS o
        FROM public.tax_invoices i
        LEFT JOIN public.staff_members sm ON sm.id = i.owner_staff_id
        WHERE i.status IN ('issued','sent','part_paid')
          AND i.total_cents > i.paid_cents
          AND NOT COALESCE(i.is_test, false)
        GROUP BY i.owner_staff_id, sm.full_name, sm.work_email
      ) s
    ), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public.payment_schedule_digest() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_schedule_digest() TO authenticated, service_role;

-- ============ Revenue recognition on payment ============
CREATE OR REPLACE FUNCTION public._invoice_revenue_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
DECLARE v_inv public.tax_invoices; v_state text; v_amount numeric; v_res jsonb;
BEGIN
  SELECT * INTO v_inv FROM public.tax_invoices WHERE id = NEW.invoice_id;
  IF v_inv.id IS NULL OR v_inv.lead_id IS NULL THEN RETURN NEW; END IF;

  BEGIN
    PERFORM public.commercial_lifecycle_evidence_add(
      v_inv.lead_id, 'payment', NEW.receipt_no, NEW.id, 'payment_receipts',
      'Payment received ' || NEW.received_on::text);

    SELECT current_state INTO v_state FROM public.commercial_lifecycle WHERE lead_id = v_inv.lead_id;
    v_amount := round((v_inv.total_cents::numeric) / 100.0, 2);

    IF v_state = 'INVOICED' THEN
      v_res := public.commercial_lifecycle_advance(v_inv.lead_id, 'RECOGNISED', v_amount,
                 'Payment ' || NEW.receipt_no || ' received', false);
      IF COALESCE((v_res->>'ok')::boolean, false) THEN v_state := 'RECOGNISED'; END IF;
    END IF;

    IF v_state = 'RECOGNISED' AND v_inv.paid_cents >= v_inv.total_cents THEN
      PERFORM public.commercial_lifecycle_advance(v_inv.lead_id, 'COLLECTED', v_amount,
                 'Invoice ' || v_inv.invoice_no || ' settled in full', false);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.tax_invoice_events(invoice_id, event, note, actor_user_id)
    VALUES (v_inv.id, 'revenue_sync_deferred', SQLERRM, auth.uid());
  END;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_receipt_revenue_sync
AFTER INSERT ON public.payment_receipts
FOR EACH ROW EXECUTE FUNCTION public._invoice_revenue_sync();
