-- ============================================================ 1. SALES MANAGEMENT
UPDATE public.staff_members
   SET position_id = 'ad01c730-f57f-4495-b674-2a53cbb80b0a', updated_at = now()
 WHERE id = '7a98630c-882a-4fd4-a07e-585efb9ce452';

UPDATE public.staff_members sm
   SET manager_staff_id = '7a98630c-882a-4fd4-a07e-585efb9ce452', updated_at = now()
 WHERE sm.position_id = 'b22a79d3-4c2d-40b5-a2d9-dcde5aa0a054'
   AND sm.id <> '7a98630c-882a-4fd4-a07e-585efb9ce452'
   AND coalesce(sm.manager_staff_id::text,'') <> '7a98630c-882a-4fd4-a07e-585efb9ce452';

INSERT INTO public.sales_targets (scope, staff_member_id, period, amount_kes, currency, effective_from, is_active, notes)
SELECT 'STAFF', '7a98630c-882a-4fd4-a07e-585efb9ce452', 'MONTH', 12000000, 'KES',
       date_trunc('month', now())::date, true,
       'Sales Manager - Mobility Services: whole-desk roll-up of four corporate sales specialists at KSh 3,000,000 each.'
 WHERE NOT EXISTS (
   SELECT 1 FROM public.sales_targets t
    WHERE t.scope = 'STAFF' AND t.staff_member_id = '7a98630c-882a-4fd4-a07e-585efb9ce452'
      AND t.period = 'MONTH' AND t.is_active
 );

INSERT INTO public.staff_role_permissions (role, permission_key)
VALUES ('general_manager', 'staff.crm.manage'), ('general_manager', 'staff.commercial.read')
ON CONFLICT DO NOTHING;

-- ============================================================ 2. INVOICES <-> ACCOUNTS & CONTRACTS
ALTER TABLE public.tax_invoices
  ADD COLUMN IF NOT EXISTS account_id uuid REFERENCES public.crm_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contract_id uuid REFERENCES public.commercial_contract_instances(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tax_invoices_account_idx ON public.tax_invoices(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS tax_invoices_one_live_per_contract
  ON public.tax_invoices(contract_id) WHERE contract_id IS NOT NULL AND status <> 'cancelled';

COMMENT ON COLUMN public.tax_invoices.contract_id IS
  'The signed contract this invoice bills. One live invoice per contract; a cancelled invoice frees the contract.';

CREATE OR REPLACE FUNCTION public.sales_invoice_from_contract(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_staff uuid := public._my_staff_member_id();
  c public.commercial_contract_instances;
  v_existing public.tax_invoices;
  v_id uuid; v_total bigint; v_sub bigint; v_vat bigint; v_customer text; v_acc uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = (p->>'contract_id')::uuid;
  IF c.id IS NULL THEN RAISE EXCEPTION 'CONTRACT_NOT_FOUND'; END IF;
  IF NOT public._invoice_can_write(coalesce(c.owner_staff_id, v_staff)) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF c.execution_date IS NULL AND c.signature_date IS NULL THEN RAISE EXCEPTION 'CONTRACT_NOT_SIGNED'; END IF;
  IF coalesce(c.value_amount, 0) <= 0 THEN RAISE EXCEPTION 'CONTRACT_VALUE_REQUIRED'; END IF;

  SELECT * INTO v_existing FROM public.tax_invoices
   WHERE contract_id = c.id AND status <> 'cancelled' LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('invoice_id', v_existing.id, 'invoice_no', v_existing.invoice_no, 'already_existed', true);
  END IF;

  v_acc := c.account_id;
  v_customer := coalesce(c.customer_legal_name, (SELECT a.name FROM public.crm_accounts a WHERE a.id = v_acc), c.title);
  v_sub := round(c.value_amount * 100)::bigint;
  v_vat := round(v_sub * 0.16)::bigint;
  v_total := v_sub + v_vat;

  INSERT INTO public.tax_invoices (
    status, customer_company, currency, vat_rate, vat_inclusive, payment_terms,
    contract_reference, subtotal_cents, vat_cents, total_cents, paid_cents,
    owner_staff_id, created_by, account_id, contract_id, notes
  ) VALUES (
    'draft', coalesce(v_customer, 'Unnamed customer'), coalesce(c.currency, 'KES'), 16, false,
    coalesce(c.payment_terms, '30 days'), c.contract_number, v_sub, v_vat, v_total, 0,
    coalesce(c.owner_staff_id, v_staff), auth.uid(), v_acc, c.id,
    'Raised from signed contract ' || coalesce(c.contract_number, c.id::text) || '.'
  ) RETURNING id INTO v_id;

  INSERT INTO public.tax_invoice_lines (invoice_id, line_no, description, qty, unit_rate_cents, amount_cents)
  VALUES (v_id, 1,
          coalesce(c.title, 'Corporate mobility services') ||
          CASE WHEN c.contract_number IS NOT NULL THEN ' (' || c.contract_number || ')' ELSE '' END,
          1, v_sub, v_sub);

  RETURN jsonb_build_object('invoice_id', v_id, 'already_existed', false, 'total_cents', v_total);
END $fn$;

REVOKE ALL ON FUNCTION public.sales_invoice_from_contract(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_invoice_from_contract(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sales_billing_board(p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $fn$
DECLARE
  v_staff uuid := coalesce(nullif(p->>'staff','')::uuid, public._my_staff_member_id());
  v_month_start date := date_trunc('month', now())::date;
  v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_staff IS NULL THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  IF v_staff <> coalesce(public._my_staff_member_id(), '00000000-0000-0000-0000-000000000000'::uuid)
     AND NOT public.has_staff_permission('staff.crm.manage') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  SELECT jsonb_build_object(
    'staff_id', v_staff,
    'generated_at', now(),
    'month_start', v_month_start,
    'invoiced_month_cents', coalesce((SELECT sum(i.total_cents) FROM public.tax_invoices i
        WHERE i.owner_staff_id = v_staff AND i.status <> 'cancelled' AND i.issued_at >= v_month_start), 0),
    'collected_month_cents', coalesce((SELECT sum(r.amount_cents) FROM public.payment_receipts r
        JOIN public.tax_invoices i ON i.id = r.invoice_id
        WHERE i.owner_staff_id = v_staff AND coalesce(r.status,'recorded') <> 'void'
          AND r.received_on >= v_month_start), 0),
    'collected_today_cents', coalesce((SELECT sum(r.amount_cents) FROM public.payment_receipts r
        JOIN public.tax_invoices i ON i.id = r.invoice_id
        WHERE i.owner_staff_id = v_staff AND coalesce(r.status,'recorded') <> 'void'
          AND r.received_on = current_date), 0),
    'outstanding_cents', coalesce((SELECT sum(i.total_cents - i.paid_cents) FROM public.tax_invoices i
        WHERE i.owner_staff_id = v_staff AND i.status IN ('issued','sent','part_paid')), 0),
    'overdue_cents', coalesce((SELECT sum(i.total_cents - i.paid_cents) FROM public.tax_invoices i
        WHERE i.owner_staff_id = v_staff AND i.status IN ('issued','sent','part_paid')
          AND i.due_date IS NOT NULL AND i.due_date < current_date), 0),
    'invoices', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'invoice_id', i.id, 'invoice_no', i.invoice_no, 'status', i.status,
        'customer', i.customer_company, 'account_id', i.account_id, 'contract_id', i.contract_id,
        'contract_reference', i.contract_reference, 'currency', i.currency,
        'total_cents', i.total_cents, 'paid_cents', i.paid_cents,
        'balance_cents', i.total_cents - i.paid_cents,
        'issue_date', i.issue_date, 'due_date', i.due_date,
        'overdue', (i.due_date IS NOT NULL AND i.due_date < current_date AND i.total_cents > i.paid_cents
                    AND i.status IN ('issued','sent','part_paid'))
      ) ORDER BY i.created_at DESC)
      FROM public.tax_invoices i WHERE i.owner_staff_id = v_staff AND i.status <> 'cancelled'), '[]'::jsonb),
    'contracts_awaiting_invoice', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'contract_id', c.id, 'contract_number', c.contract_number,
        'customer', coalesce(c.customer_legal_name, c.title),
        'account_id', c.account_id, 'value_amount', c.value_amount, 'currency', c.currency,
        'signed_on', coalesce(c.execution_date, c.signature_date)
      ) ORDER BY coalesce(c.execution_date, c.signature_date) DESC)
      FROM public.commercial_contract_instances c
      WHERE c.owner_staff_id = v_staff
        AND (c.execution_date IS NOT NULL OR c.signature_date IS NOT NULL)
        AND coalesce(c.value_amount,0) > 0
        AND NOT EXISTS (SELECT 1 FROM public.tax_invoices i WHERE i.contract_id = c.id AND i.status <> 'cancelled')
    ), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $fn$;

REVOKE ALL ON FUNCTION public.sales_billing_board(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_billing_board(jsonb) TO authenticated, service_role;

-- ============================================================ 3. SERVICE EXECUTION FEED
CREATE TABLE IF NOT EXISTS public.commercial_service_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_ref text NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  contract_id uuid REFERENCES public.commercial_contract_instances(id) ON DELETE SET NULL,
  owner_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  service_type text NOT NULL CHECK (service_type IN ('AIRPORT_TRANSFER','STAFF_TRANSPORT','PARCEL_DELIVERY','CHARTER')),
  passenger_or_recipient text,
  origin text,
  destination text,
  scheduled_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'SCHEDULED'
    CHECK (status IN ('SCHEDULED','DISPATCHED','IN_PROGRESS','COMPLETED','DELAYED','FAILED','CANCELLED')),
  driver_label text,
  vehicle_label text,
  value_kes numeric(14,2) CHECK (value_kes IS NULL OR value_kes >= 0),
  exception_reason text,
  external_reference text,
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.commercial_service_executions TO authenticated;
GRANT ALL ON public.commercial_service_executions TO service_role;
ALTER TABLE public.commercial_service_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Linked staff read service executions" ON public.commercial_service_executions
  FOR SELECT TO authenticated USING (public.is_linked_commercial_staff());
CREATE POLICY "Linked staff record service executions" ON public.commercial_service_executions
  FOR INSERT TO authenticated WITH CHECK (public.is_linked_commercial_staff());
CREATE POLICY "Linked staff update service executions" ON public.commercial_service_executions
  FOR UPDATE TO authenticated USING (public.is_linked_commercial_staff()) WITH CHECK (public.is_linked_commercial_staff());
CREATE POLICY "Service role manages service executions" ON public.commercial_service_executions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS cse_account_date_idx ON public.commercial_service_executions(account_id, scheduled_at DESC);
CREATE INDEX IF NOT EXISTS cse_status_idx ON public.commercial_service_executions(status);

CREATE TABLE IF NOT EXISTS public.commercial_service_execution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES public.commercial_service_executions(id) ON DELETE CASCADE,
  status text NOT NULL,
  note text,
  actor uuid,
  at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.commercial_service_execution_events TO authenticated;
GRANT ALL ON public.commercial_service_execution_events TO service_role;
ALTER TABLE public.commercial_service_execution_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Linked staff read service execution events" ON public.commercial_service_execution_events
  FOR SELECT TO authenticated USING (public.is_linked_commercial_staff());
CREATE POLICY "Service role manages service execution events" ON public.commercial_service_execution_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public._cse_event_append_only()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN RAISE EXCEPTION 'SERVICE_EXECUTION_HISTORY_IS_APPEND_ONLY'; END $fn$;

DROP TRIGGER IF EXISTS cse_events_append_only ON public.commercial_service_execution_events;
CREATE TRIGGER cse_events_append_only BEFORE UPDATE OR DELETE ON public.commercial_service_execution_events
  FOR EACH ROW EXECUTE FUNCTION public._cse_event_append_only();

-- history + automatic service exception into the signal register
CREATE OR REPLACE FUNCTION public._cse_after_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_label text; v_owner uuid; v_key text; v_sev text; v_urg text;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.commercial_service_execution_events (execution_id, status, note, actor)
    VALUES (NEW.id, NEW.status, NEW.exception_reason, auth.uid());
  END IF;

  SELECT a.name, sm.user_id INTO v_label, v_owner
    FROM public.crm_accounts a
    LEFT JOIN public.staff_members sm ON sm.id = coalesce(NEW.owner_staff_id, a.owner_staff_id)
   WHERE a.id = NEW.account_id;

  v_key := 'service_execution:' || NEW.id::text;

  IF NEW.status IN ('DELAYED','FAILED','CANCELLED') THEN
    v_sev := CASE NEW.status WHEN 'FAILED' THEN 'critical' WHEN 'CANCELLED' THEN 'high' ELSE 'medium' END;
    v_urg := CASE NEW.status WHEN 'DELAYED' THEN 'today' ELSE 'now' END;
    INSERT INTO public.commercial_signals (
      signal_key, signal_type, source, entity_type, entity_id, account_id, customer_label,
      severity, urgency, commercial_impact_cents, customer_impact, headline, evidence,
      recommended_action, owner_user_id, status
    ) VALUES (
      v_key, 'service_exception', 'operations.service_execution', 'account', NEW.account_id, NEW.account_id,
      v_label, v_sev, v_urg,
      CASE WHEN NEW.value_kes IS NULL THEN NULL ELSE round(NEW.value_kes * 100)::bigint END,
      CASE NEW.status
        WHEN 'FAILED' THEN 'The customer did not receive the service that was booked.'
        WHEN 'CANCELLED' THEN 'A booked service was cancelled.'
        ELSE 'A booked service is running late.' END,
      coalesce(v_label,'Customer') || ': ' ||
        replace(initcap(replace(NEW.service_type,'_',' ')), 'Parcel Delivery','parcel delivery') || ' ' ||
        lower(NEW.status) || ' (' || NEW.execution_ref || ')',
      jsonb_build_array(
        jsonb_build_object('label','Service', 'value', replace(initcap(replace(NEW.service_type,'_',' ')),'_',' ')),
        jsonb_build_object('label','Reference', 'value', NEW.execution_ref),
        jsonb_build_object('label','Scheduled', 'value', to_char(NEW.scheduled_at, 'DD Mon YYYY HH24:MI')),
        jsonb_build_object('label','Status', 'value', NEW.status),
        jsonb_build_object('label','Reason recorded by operations',
                           'value', coalesce(NEW.exception_reason, 'None recorded')),
        jsonb_build_object('label','Route',
                           'value', coalesce(NEW.origin,'Not stated') || ' to ' || coalesce(NEW.destination,'Not stated'))
      ),
      'Call the customer, explain what happened and agree the recovery before they chase us.',
      v_owner, 'open'
    )
    ON CONFLICT (signal_key) DO UPDATE
      SET severity = EXCLUDED.severity, urgency = EXCLUDED.urgency, headline = EXCLUDED.headline,
          evidence = EXCLUDED.evidence, customer_impact = EXCLUDED.customer_impact,
          commercial_impact_cents = EXCLUDED.commercial_impact_cents,
          owner_user_id = coalesce(EXCLUDED.owner_user_id, public.commercial_signals.owner_user_id),
          status = CASE WHEN public.commercial_signals.status IN ('actioned','dismissed') THEN 'open'
                        ELSE public.commercial_signals.status END,
          updated_at = now();
  ELSIF NEW.status = 'COMPLETED' THEN
    UPDATE public.commercial_signals
       SET status = 'expired', status_note = 'The service completed, so the issue closed itself.', updated_at = now()
     WHERE signal_key = v_key AND status IN ('open','acknowledged');
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS cse_after_write ON public.commercial_service_executions;
CREATE TRIGGER cse_after_write AFTER INSERT OR UPDATE ON public.commercial_service_executions
  FOR EACH ROW EXECUTE FUNCTION public._cse_after_write();

DROP TRIGGER IF EXISTS cse_touch ON public.commercial_service_executions;
CREATE TRIGGER cse_touch BEFORE UPDATE ON public.commercial_service_executions
  FOR EACH ROW EXECUTE FUNCTION public._account_volume_touch();

REVOKE ALL ON FUNCTION public._cse_after_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._cse_event_append_only() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sales_service_execution_record(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_staff uuid := public._my_staff_member_id();
  v_id uuid := nullif(p->>'execution_id','')::uuid;
  v_ref text; v_status text := coalesce(nullif(p->>'status',''), 'SCHEDULED');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.is_linked_commercial_staff() THEN RAISE EXCEPTION 'NOT_COMMERCIAL_STAFF'; END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.commercial_service_executions SET
      status = v_status,
      exception_reason = coalesce(nullif(p->>'exception_reason',''), exception_reason),
      driver_label = coalesce(nullif(p->>'driver_label',''), driver_label),
      vehicle_label = coalesce(nullif(p->>'vehicle_label',''), vehicle_label),
      value_kes = coalesce(nullif(p->>'value_kes','')::numeric, value_kes),
      started_at = CASE WHEN v_status IN ('IN_PROGRESS','DISPATCHED') THEN coalesce(started_at, now()) ELSE started_at END,
      completed_at = CASE WHEN v_status = 'COMPLETED' THEN coalesce(completed_at, now()) ELSE completed_at END
    WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'EXECUTION_NOT_FOUND'; END IF;
    RETURN jsonb_build_object('execution_id', v_id, 'status', v_status);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.crm_accounts WHERE id = (p->>'account_id')::uuid) THEN
    RAISE EXCEPTION 'ACCOUNT_NOT_FOUND';
  END IF;
  IF coalesce(p->>'service_type','') = '' THEN RAISE EXCEPTION 'SERVICE_TYPE_REQUIRED'; END IF;
  IF coalesce(p->>'scheduled_at','') = '' THEN RAISE EXCEPTION 'SCHEDULED_TIME_REQUIRED'; END IF;

  v_ref := 'SVC-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 5));

  INSERT INTO public.commercial_service_executions (
    execution_ref, account_id, contract_id, owner_staff_id, service_type, passenger_or_recipient,
    origin, destination, scheduled_at, status, driver_label, vehicle_label, value_kes,
    exception_reason, external_reference, recorded_by
  ) VALUES (
    v_ref, (p->>'account_id')::uuid, nullif(p->>'contract_id','')::uuid,
    coalesce(nullif(p->>'owner_staff_id','')::uuid, v_staff), p->>'service_type',
    nullif(p->>'passenger_or_recipient',''), nullif(p->>'origin',''), nullif(p->>'destination',''),
    (p->>'scheduled_at')::timestamptz, v_status, nullif(p->>'driver_label',''), nullif(p->>'vehicle_label',''),
    nullif(p->>'value_kes','')::numeric, nullif(p->>'exception_reason',''), nullif(p->>'external_reference',''),
    auth.uid()
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('execution_id', v_id, 'execution_ref', v_ref, 'status', v_status);
END $fn$;

REVOKE ALL ON FUNCTION public.sales_service_execution_record(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_service_execution_record(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sales_service_feed(p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $fn$
DECLARE
  v_staff uuid := coalesce(nullif(p->>'staff','')::uuid, public._my_staff_member_id());
  v_month_start date := date_trunc('month', now())::date;
  v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.is_linked_commercial_staff() THEN RAISE EXCEPTION 'NOT_COMMERCIAL_STAFF'; END IF;
  IF v_staff IS NULL THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  IF v_staff <> coalesce(public._my_staff_member_id(), '00000000-0000-0000-0000-000000000000'::uuid)
     AND NOT public.has_staff_permission('staff.crm.manage') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  WITH mine AS (
    SELECT e.* FROM public.commercial_service_executions e
    JOIN public.crm_accounts a ON a.id = e.account_id
    WHERE coalesce(e.owner_staff_id, a.owner_staff_id) = v_staff
  )
  SELECT jsonb_build_object(
    'staff_id', v_staff,
    'generated_at', now(),
    'today', jsonb_build_object(
      'total', (SELECT count(*) FROM mine WHERE scheduled_at::date = current_date),
      'completed', (SELECT count(*) FROM mine WHERE scheduled_at::date = current_date AND status = 'COMPLETED'),
      'in_flight', (SELECT count(*) FROM mine WHERE scheduled_at::date = current_date AND status IN ('SCHEDULED','DISPATCHED','IN_PROGRESS')),
      'exceptions', (SELECT count(*) FROM mine WHERE scheduled_at::date = current_date AND status IN ('DELAYED','FAILED','CANCELLED')),
      'airport_transfers', (SELECT count(*) FROM mine WHERE scheduled_at::date = current_date AND service_type = 'AIRPORT_TRANSFER' AND status = 'COMPLETED'),
      'staff_transport', (SELECT count(*) FROM mine WHERE scheduled_at::date = current_date AND service_type = 'STAFF_TRANSPORT' AND status = 'COMPLETED'),
      'parcels', (SELECT count(*) FROM mine WHERE scheduled_at::date = current_date AND service_type = 'PARCEL_DELIVERY' AND status = 'COMPLETED'),
      'value_kes', coalesce((SELECT sum(value_kes) FROM mine WHERE scheduled_at::date = current_date AND status = 'COMPLETED'), 0)
    ),
    'month', jsonb_build_object(
      'completed', (SELECT count(*) FROM mine WHERE scheduled_at::date >= v_month_start AND status = 'COMPLETED'),
      'exceptions', (SELECT count(*) FROM mine WHERE scheduled_at::date >= v_month_start AND status IN ('DELAYED','FAILED','CANCELLED')),
      'value_kes', coalesce((SELECT sum(value_kes) FROM mine WHERE scheduled_at::date >= v_month_start AND status = 'COMPLETED'), 0)
    ),
    'by_account', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'account_name') FROM (
        SELECT jsonb_build_object(
          'account_id', m.account_id,
          'account_name', (SELECT a.name FROM public.crm_accounts a WHERE a.id = m.account_id),
          'completed_month', count(*) FILTER (WHERE m.scheduled_at::date >= v_month_start AND m.status = 'COMPLETED'),
          'exceptions_month', count(*) FILTER (WHERE m.scheduled_at::date >= v_month_start AND m.status IN ('DELAYED','FAILED','CANCELLED')),
          'value_month_kes', coalesce(sum(m.value_kes) FILTER (WHERE m.scheduled_at::date >= v_month_start AND m.status = 'COMPLETED'), 0)
        ) x FROM mine m GROUP BY m.account_id
      ) s
    ), '[]'::jsonb),
    'feed', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'execution_id', m.id, 'execution_ref', m.execution_ref, 'account_id', m.account_id,
        'account_name', (SELECT a.name FROM public.crm_accounts a WHERE a.id = m.account_id),
        'service_type', m.service_type, 'status', m.status, 'scheduled_at', m.scheduled_at,
        'started_at', m.started_at, 'completed_at', m.completed_at,
        'passenger_or_recipient', m.passenger_or_recipient, 'origin', m.origin, 'destination', m.destination,
        'driver_label', m.driver_label, 'vehicle_label', m.vehicle_label, 'value_kes', m.value_kes,
        'exception_reason', m.exception_reason
      ) ORDER BY m.scheduled_at DESC)
      FROM (SELECT * FROM mine ORDER BY scheduled_at DESC LIMIT 80) m
    ), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $fn$;

REVOKE ALL ON FUNCTION public.sales_service_feed(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_service_feed(jsonb) TO authenticated, service_role;

-- ============================================================ 4. ACTIVATION ASSIGNMENTS
CREATE TABLE IF NOT EXISTS public.commercial_activation_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.commercial_contract_instances(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.crm_accounts(id) ON DELETE SET NULL,
  assignment_role text NOT NULL CHECK (assignment_role IN ('ACCOUNT_MANAGER','COORDINATOR','SUPERVISOR','DRIVER','VEHICLE')),
  staff_member_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  person_label text,
  vehicle_label text,
  start_date date,
  end_date date,
  status text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','ACTIVE','COMPLETED','CANCELLED')),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.commercial_activation_assignments TO authenticated;
GRANT ALL ON public.commercial_activation_assignments TO service_role;
ALTER TABLE public.commercial_activation_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Linked staff read activation assignments" ON public.commercial_activation_assignments
  FOR SELECT TO authenticated USING (public.is_linked_commercial_staff());
CREATE POLICY "Linked staff record activation assignments" ON public.commercial_activation_assignments
  FOR INSERT TO authenticated WITH CHECK (public.is_linked_commercial_staff());
CREATE POLICY "Linked staff update activation assignments" ON public.commercial_activation_assignments
  FOR UPDATE TO authenticated USING (public.is_linked_commercial_staff()) WITH CHECK (public.is_linked_commercial_staff());
CREATE POLICY "Service role manages activation assignments" ON public.commercial_activation_assignments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS caa_touch ON public.commercial_activation_assignments;
CREATE TRIGGER caa_touch BEFORE UPDATE ON public.commercial_activation_assignments
  FOR EACH ROW EXECUTE FUNCTION public._account_volume_touch();

CREATE OR REPLACE FUNCTION public.sales_activation_assignment_upsert(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_id uuid := nullif(p->>'assignment_id','')::uuid; c public.commercial_contract_instances;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.is_linked_commercial_staff() THEN RAISE EXCEPTION 'NOT_COMMERCIAL_STAFF'; END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.commercial_activation_assignments SET
      assignment_role = coalesce(nullif(p->>'assignment_role',''), assignment_role),
      staff_member_id = coalesce(nullif(p->>'staff_member_id','')::uuid, staff_member_id),
      person_label = coalesce(nullif(p->>'person_label',''), person_label),
      vehicle_label = coalesce(nullif(p->>'vehicle_label',''), vehicle_label),
      start_date = coalesce(nullif(p->>'start_date','')::date, start_date),
      end_date = coalesce(nullif(p->>'end_date','')::date, end_date),
      status = coalesce(nullif(p->>'status',''), status),
      notes = coalesce(nullif(p->>'notes',''), notes)
    WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;
    RETURN jsonb_build_object('assignment_id', v_id);
  END IF;

  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = (p->>'contract_id')::uuid;
  IF c.id IS NULL THEN RAISE EXCEPTION 'CONTRACT_NOT_FOUND'; END IF;
  IF coalesce(p->>'assignment_role','') = '' THEN RAISE EXCEPTION 'ROLE_REQUIRED'; END IF;
  IF coalesce(nullif(p->>'person_label',''), p->>'staff_member_id', p->>'vehicle_label') IS NULL THEN
    RAISE EXCEPTION 'WHO_OR_WHAT_IS_ASSIGNED_REQUIRED';
  END IF;

  INSERT INTO public.commercial_activation_assignments (
    contract_id, account_id, assignment_role, staff_member_id, person_label, vehicle_label,
    start_date, end_date, status, notes, created_by
  ) VALUES (
    c.id, c.account_id, p->>'assignment_role', nullif(p->>'staff_member_id','')::uuid,
    nullif(p->>'person_label',''), nullif(p->>'vehicle_label',''),
    nullif(p->>'start_date','')::date, nullif(p->>'end_date','')::date,
    coalesce(nullif(p->>'status',''),'PLANNED'), nullif(p->>'notes',''), auth.uid()
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('assignment_id', v_id);
END $fn$;

REVOKE ALL ON FUNCTION public.sales_activation_assignment_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_activation_assignment_upsert(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sales_activation_board(p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $fn$
DECLARE
  v_staff uuid := coalesce(nullif(p->>'staff','')::uuid, public._my_staff_member_id());
  v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.is_linked_commercial_staff() THEN RAISE EXCEPTION 'NOT_COMMERCIAL_STAFF'; END IF;
  IF v_staff IS NULL THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  IF v_staff <> coalesce(public._my_staff_member_id(), '00000000-0000-0000-0000-000000000000'::uuid)
     AND NOT public.has_staff_permission('staff.crm.manage') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  SELECT jsonb_build_object(
    'staff_id', v_staff,
    'generated_at', now(),
    'contracts', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'contract_id', c.id, 'contract_number', c.contract_number,
        'customer', coalesce(c.customer_legal_name, c.title), 'account_id', c.account_id,
        'status', c.status, 'value_amount', c.value_amount, 'currency', c.currency,
        'activated_at', c.activated_at, 'term_start', c.term_start, 'term_end', c.term_end,
        'assignments', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'assignment_id', x.id, 'assignment_role', x.assignment_role,
            'person', coalesce(x.person_label, (SELECT sm.full_name FROM public.staff_members sm WHERE sm.id = x.staff_member_id)),
            'staff_member_id', x.staff_member_id, 'vehicle_label', x.vehicle_label,
            'start_date', x.start_date, 'end_date', x.end_date, 'status', x.status, 'notes', x.notes
          ) ORDER BY x.assignment_role, x.created_at)
          FROM public.commercial_activation_assignments x WHERE x.contract_id = c.id), '[]'::jsonb),
        'services_delivered', (SELECT count(*) FROM public.commercial_service_executions e
           WHERE (e.contract_id = c.id OR (e.contract_id IS NULL AND e.account_id = c.account_id))
             AND e.status = 'COMPLETED'),
        'services_failed', (SELECT count(*) FROM public.commercial_service_executions e
           WHERE (e.contract_id = c.id OR (e.contract_id IS NULL AND e.account_id = c.account_id))
             AND e.status IN ('FAILED','CANCELLED','DELAYED')),
        'invoice', (SELECT jsonb_build_object('invoice_id', i.id, 'invoice_no', i.invoice_no, 'status', i.status,
                             'total_cents', i.total_cents, 'paid_cents', i.paid_cents)
                      FROM public.tax_invoices i WHERE i.contract_id = c.id AND i.status <> 'cancelled' LIMIT 1)
      ) ORDER BY coalesce(c.activated_at, c.updated_at) DESC)
      FROM public.commercial_contract_instances c WHERE c.owner_staff_id = v_staff
    ), '[]'::jsonb),
    'colleagues', coalesce((
      SELECT jsonb_agg(jsonb_build_object('staff_id', sm.id, 'full_name', sm.full_name) ORDER BY sm.full_name)
      FROM public.staff_members sm WHERE sm.employment_status IN ('active','onboarding')
        AND (sm.manager_staff_id = v_staff OR sm.id = v_staff
             OR sm.manager_staff_id = (SELECT manager_staff_id FROM public.staff_members WHERE id = v_staff))
    ), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $fn$;

REVOKE ALL ON FUNCTION public.sales_activation_board(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_activation_board(jsonb) TO authenticated, service_role;

-- ============================================================ 5. SALES MANAGER DESK
CREATE OR REPLACE FUNCTION public.sales_manager_desk(p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $fn$
DECLARE
  v_me uuid := public._my_staff_member_id();
  v_month_start date := date_trunc('month', now())::date;
  v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_me IS NULL AND NOT public.has_staff_permission('staff.crm.manage') THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  IF NOT public.has_staff_permission('staff.crm.manage')
     AND NOT EXISTS (SELECT 1 FROM public.staff_members WHERE manager_staff_id = v_me) THEN
    RAISE EXCEPTION 'NOT_A_SALES_MANAGER';
  END IF;

  WITH team AS (
    SELECT sm.id, sm.full_name, op.title AS position_title
      FROM public.staff_members sm
      LEFT JOIN public.org_positions op ON op.id = sm.position_id
     WHERE sm.employment_status IN ('active','onboarding')
       AND (sm.manager_staff_id = v_me OR (public.has_staff_permission('staff.crm.manage')
            AND op.code IN ('YML-SAL-CSS-001','SLS-MOB','SLS-SUP','SLS-PRT','SLS-LEAD')))
  )
  SELECT jsonb_build_object(
    'manager_staff_id', v_me,
    'generated_at', now(),
    'month_start', v_month_start,
    'team_target_kes', coalesce((SELECT sum(public.sales_target_for(t.id, v_month_start)) FROM team t), 0),
    'people', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'staff_id', t.id, 'full_name', t.full_name, 'position', t.position_title,
        'target_kes', public.sales_target_for(t.id, v_month_start),
        'leads_total', (SELECT count(*) FROM public.sales_leads l WHERE l.sales_staff_id = t.id AND NOT coalesce(l.is_test,false)),
        'leads_open', (SELECT count(*) FROM public.sales_leads l WHERE l.sales_staff_id = t.id
                         AND NOT coalesce(l.is_test,false) AND l.stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')),
        'leads_untouched', (SELECT count(*) FROM public.sales_leads l WHERE l.sales_staff_id = t.id
                         AND NOT coalesce(l.is_test,false) AND l.stage = 'NEW'),
        'open_pipeline_kes', coalesce((SELECT sum(l.estimated_value_kes) FROM public.sales_leads l
                         WHERE l.sales_staff_id = t.id AND NOT coalesce(l.is_test,false)
                           AND l.stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')), 0),
        'won_month_kes', coalesce((SELECT sum(l.won_revenue_kes) FROM public.sales_leads l
                         WHERE l.sales_staff_id = t.id AND NOT coalesce(l.is_test,false)
                           AND l.stage = 'CLOSED_WON' AND l.closed_at >= v_month_start), 0),
        'invoiced_month_cents', coalesce((SELECT sum(i.total_cents) FROM public.tax_invoices i
                         WHERE i.owner_staff_id = t.id AND i.status <> 'cancelled' AND i.issued_at >= v_month_start), 0),
        'collected_month_cents', coalesce((SELECT sum(r.amount_cents) FROM public.payment_receipts r
                         JOIN public.tax_invoices i ON i.id = r.invoice_id
                         WHERE i.owner_staff_id = t.id AND coalesce(r.status,'recorded') <> 'void'
                           AND r.received_on >= v_month_start), 0),
        'outstanding_cents', coalesce((SELECT sum(i.total_cents - i.paid_cents) FROM public.tax_invoices i
                         WHERE i.owner_staff_id = t.id AND i.status IN ('issued','sent','part_paid')), 0),
        'service_exceptions_open', (SELECT count(*) FROM public.commercial_signals s
                         JOIN public.staff_members sm2 ON sm2.id = t.id
                         WHERE s.signal_type = 'service_exception' AND s.status IN ('open','acknowledged')
                           AND s.owner_user_id = sm2.user_id),
        'last_activity_at', (SELECT max(l.updated_at) FROM public.sales_leads l WHERE l.sales_staff_id = t.id)
      ) ORDER BY t.full_name) FROM team t
    ), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $fn$;

REVOKE ALL ON FUNCTION public.sales_manager_desk(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_manager_desk(jsonb) TO authenticated, service_role;

COMMENT ON TABLE public.commercial_service_executions IS
  'Service execution feed: one row per trip, transfer or parcel against a customer account, with its live status. Delays, failures and cancellations raise a service exception automatically.';
COMMENT ON TABLE public.commercial_activation_assignments IS
  'Who and what is assigned to a contract during activation - staff, coordinators, drivers and vehicles, with their dates.';