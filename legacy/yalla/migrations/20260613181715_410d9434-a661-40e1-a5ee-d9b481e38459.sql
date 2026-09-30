
CREATE TYPE public.cost_center_status AS ENUM ('ACTIVE','FROZEN','ARCHIVED');
CREATE TYPE public.budget_status AS ENUM ('DRAFT','ACTIVE','LOCKED','CLOSED','OVERSPENT');
CREATE TYPE public.budget_reservation_status AS ENUM ('RESERVED','CONSUMED','RELEASED','EXPIRED');
CREATE TYPE public.approval_request_status AS ENUM ('PENDING','IN_REVIEW','APPROVED','REJECTED','CANCELLED','EXPIRED','ESCALATED');
CREATE TYPE public.approval_decision_type AS ENUM ('APPROVED','REJECTED','DELEGATED','ABSTAINED');

-- Helper: caller is a corporate-side role (corporate_admin) or platform finance/admin
-- (Per-corporate scoping by user isn't possible without a membership table; we gate by role.)
CREATE OR REPLACE FUNCTION public.is_corp_or_finance(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(_uid, ARRAY['admin','finance_admin','super_admin','corporate_admin']::app_role[])
$$;

-- ============================================================
-- COST CENTERS
-- ============================================================
CREATE TABLE public.cost_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  parent_id uuid REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  owner_user_id uuid REFERENCES auth.users(id),
  status public.cost_center_status NOT NULL DEFAULT 'ACTIVE',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (corporate_id, code)
);
CREATE INDEX idx_cost_centers_parent ON public.cost_centers(parent_id);
GRANT SELECT, INSERT, UPDATE ON public.cost_centers TO authenticated;
GRANT ALL ON public.cost_centers TO service_role;
ALTER TABLE public.cost_centers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "corp_finance read cost_centers" ON public.cost_centers FOR SELECT TO authenticated
  USING (public.is_corp_or_finance(auth.uid()));
CREATE POLICY "corp_finance insert cost_centers" ON public.cost_centers FOR INSERT TO authenticated
  WITH CHECK (public.is_corp_or_finance(auth.uid()));
CREATE POLICY "corp_finance update cost_centers" ON public.cost_centers FOR UPDATE TO authenticated
  USING (public.is_corp_or_finance(auth.uid()));

-- ============================================================
-- BUDGETS
-- ============================================================
CREATE TABLE public.budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  cost_center_id uuid REFERENCES public.cost_centers(id) ON DELETE SET NULL,
  name text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  total_cents bigint NOT NULL CHECK (total_cents >= 0),
  reserved_cents bigint NOT NULL DEFAULT 0,
  consumed_cents bigint NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'KES',
  status public.budget_status NOT NULL DEFAULT 'DRAFT',
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start)
);
CREATE INDEX idx_budgets_corp_period ON public.budgets(corporate_id, period_start, period_end);
CREATE INDEX idx_budgets_cost_center ON public.budgets(cost_center_id);
GRANT SELECT, INSERT, UPDATE ON public.budgets TO authenticated;
GRANT ALL ON public.budgets TO service_role;
ALTER TABLE public.budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "corp_finance read budgets" ON public.budgets FOR SELECT TO authenticated
  USING (public.is_corp_or_finance(auth.uid()));
CREATE POLICY "corp_finance insert budgets" ON public.budgets FOR INSERT TO authenticated
  WITH CHECK (public.is_corp_or_finance(auth.uid()));
CREATE POLICY "corp_finance update budgets" ON public.budgets FOR UPDATE TO authenticated
  USING (public.is_corp_or_finance(auth.uid()));

-- ============================================================
-- BUDGET RESERVATIONS / CONSUMPTION / FORECASTS
-- ============================================================
CREATE TABLE public.budget_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'KES',
  status public.budget_reservation_status NOT NULL DEFAULT 'RESERVED',
  reference text,
  approval_request_id uuid,
  reserved_by uuid,
  expires_at timestamptz,
  released_at timestamptz,
  consumed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_budget_res_budget ON public.budget_reservations(budget_id, status);
GRANT SELECT ON public.budget_reservations TO authenticated;
GRANT ALL ON public.budget_reservations TO service_role;
ALTER TABLE public.budget_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "corp_finance read reservations" ON public.budget_reservations FOR SELECT TO authenticated
  USING (public.is_corp_or_finance(auth.uid()));

CREATE TABLE public.budget_consumption (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  reservation_id uuid REFERENCES public.budget_reservations(id),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'KES',
  journal_id uuid REFERENCES public.journals(id),
  corporate_invoice_id uuid REFERENCES public.corporate_invoices(id),
  consumed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_budget_consumption_budget ON public.budget_consumption(budget_id);
GRANT SELECT ON public.budget_consumption TO authenticated;
GRANT ALL ON public.budget_consumption TO service_role;
ALTER TABLE public.budget_consumption ENABLE ROW LEVEL SECURITY;
CREATE POLICY "corp_finance read consumption" ON public.budget_consumption FOR SELECT TO authenticated
  USING (public.is_corp_or_finance(auth.uid()));

CREATE TABLE public.budget_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
  as_of date NOT NULL,
  projected_cents bigint NOT NULL,
  basis jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.budget_forecasts TO authenticated;
GRANT ALL ON public.budget_forecasts TO service_role;
ALTER TABLE public.budget_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "corp_finance read forecasts" ON public.budget_forecasts FOR SELECT TO authenticated
  USING (public.is_corp_or_finance(auth.uid()));

CREATE TRIGGER trg_bres_no_delete BEFORE DELETE ON public.budget_reservations
  FOR EACH ROW EXECUTE FUNCTION public.deny_tax_mutation();
CREATE TRIGGER trg_bcon_no_delete BEFORE DELETE ON public.budget_consumption
  FOR EACH ROW EXECUTE FUNCTION public.deny_tax_mutation();

-- ============================================================
-- APPROVAL WORKFLOWS / ROUTES
-- ============================================================
CREATE TABLE public.approval_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  trigger_predicate jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  sla_minutes int NOT NULL DEFAULT 1440,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.approval_workflows TO authenticated;
GRANT ALL ON public.approval_workflows TO service_role;
ALTER TABLE public.approval_workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "corp_finance read workflows" ON public.approval_workflows FOR SELECT TO authenticated
  USING (public.is_corp_or_finance(auth.uid()));
CREATE POLICY "corp_finance insert workflows" ON public.approval_workflows FOR INSERT TO authenticated
  WITH CHECK (public.is_corp_or_finance(auth.uid()));
CREATE POLICY "corp_finance update workflows" ON public.approval_workflows FOR UPDATE TO authenticated
  USING (public.is_corp_or_finance(auth.uid()));

CREATE TABLE public.approval_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.approval_workflows(id) ON DELETE CASCADE,
  step_no int NOT NULL,
  approver_user_id uuid,
  approver_role app_role,
  required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, step_no)
);
GRANT SELECT, INSERT, UPDATE ON public.approval_routes TO authenticated;
GRANT ALL ON public.approval_routes TO service_role;
ALTER TABLE public.approval_routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "corp_finance read routes" ON public.approval_routes FOR SELECT TO authenticated
  USING (public.is_corp_or_finance(auth.uid()));
CREATE POLICY "corp_finance write routes" ON public.approval_routes FOR ALL TO authenticated
  USING (public.is_corp_or_finance(auth.uid()))
  WITH CHECK (public.is_corp_or_finance(auth.uid()));

-- ============================================================
-- APPROVAL REQUESTS / DECISIONS / ESCALATIONS / DELEGATIONS / LINKS
-- ============================================================
CREATE TABLE public.approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES public.approval_workflows(id),
  cost_center_id uuid REFERENCES public.cost_centers(id),
  budget_id uuid REFERENCES public.budgets(id),
  reservation_id uuid REFERENCES public.budget_reservations(id),
  requested_by uuid NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'KES',
  current_step int NOT NULL DEFAULT 1,
  status public.approval_request_status NOT NULL DEFAULT 'PENDING',
  reference text,
  justification text,
  due_at timestamptz,
  resolved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_appr_req_corp ON public.approval_requests(corporate_id, status);
CREATE INDEX idx_appr_req_workflow ON public.approval_requests(workflow_id);
GRANT SELECT, INSERT ON public.approval_requests TO authenticated;
GRANT ALL ON public.approval_requests TO service_role;
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read approval requests" ON public.approval_requests FOR SELECT TO authenticated
  USING (requested_by = auth.uid() OR public.is_corp_or_finance(auth.uid()));
CREATE POLICY "create approval req for self" ON public.approval_requests FOR INSERT TO authenticated
  WITH CHECK (requested_by = auth.uid());

CREATE TABLE public.approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.approval_requests(id) ON DELETE CASCADE,
  step_no int NOT NULL,
  decided_by uuid NOT NULL,
  decision public.approval_decision_type NOT NULL,
  comment text,
  delegated_to uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_appr_dec_req ON public.approval_decisions(request_id, step_no);
GRANT SELECT ON public.approval_decisions TO authenticated;
GRANT ALL ON public.approval_decisions TO service_role;
ALTER TABLE public.approval_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read decisions" ON public.approval_decisions FOR SELECT TO authenticated
  USING (decided_by = auth.uid() OR public.is_corp_or_finance(auth.uid())
    OR EXISTS (SELECT 1 FROM public.approval_requests r WHERE r.id = request_id AND r.requested_by = auth.uid()));

CREATE TRIGGER trg_appr_dec_no_delete BEFORE DELETE ON public.approval_decisions
  FOR EACH ROW EXECUTE FUNCTION public.deny_tax_mutation();

CREATE TABLE public.approval_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.approval_requests(id) ON DELETE CASCADE,
  escalated_from_step int NOT NULL,
  escalated_to_user_id uuid,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.approval_escalations TO authenticated;
GRANT ALL ON public.approval_escalations TO service_role;
ALTER TABLE public.approval_escalations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read escalations" ON public.approval_escalations FOR SELECT TO authenticated
  USING (public.is_corp_or_finance(auth.uid())
    OR EXISTS (SELECT 1 FROM public.approval_requests r WHERE r.id = request_id AND r.requested_by = auth.uid()));

CREATE TABLE public.approval_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delegator_user_id uuid NOT NULL,
  delegate_user_id uuid NOT NULL,
  corporate_id uuid REFERENCES public.corporate_accounts(id),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.approval_delegations TO authenticated;
GRANT ALL ON public.approval_delegations TO service_role;
ALTER TABLE public.approval_delegations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users see own delegations" ON public.approval_delegations FOR SELECT TO authenticated
  USING (delegator_user_id = auth.uid() OR delegate_user_id = auth.uid()
    OR public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));
CREATE POLICY "users create own delegations" ON public.approval_delegations FOR INSERT TO authenticated
  WITH CHECK (delegator_user_id = auth.uid());
CREATE POLICY "users update own delegations" ON public.approval_delegations FOR UPDATE TO authenticated
  USING (delegator_user_id = auth.uid());

CREATE TABLE public.approval_payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.approval_requests(id) ON DELETE CASCADE,
  revenue_event_id uuid REFERENCES public.revenue_events(id),
  corporate_invoice_id uuid REFERENCES public.corporate_invoices(id),
  journal_id uuid REFERENCES public.journals(id),
  consumption_id uuid REFERENCES public.budget_consumption(id),
  linked_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.approval_payment_links TO authenticated;
GRANT ALL ON public.approval_payment_links TO service_role;
ALTER TABLE public.approval_payment_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read payment links" ON public.approval_payment_links FOR SELECT TO authenticated
  USING (public.is_corp_or_finance(auth.uid())
    OR EXISTS (SELECT 1 FROM public.approval_requests r WHERE r.id = request_id AND r.requested_by = auth.uid()));

-- updated_at triggers
CREATE TRIGGER trg_cc_uat BEFORE UPDATE ON public.cost_centers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_bud_uat BEFORE UPDATE ON public.budgets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_bres_uat BEFORE UPDATE ON public.budget_reservations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_aw_uat BEFORE UPDATE ON public.approval_workflows FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_areq_uat BEFORE UPDATE ON public.approval_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- FUNCTIONS
-- ============================================================
CREATE OR REPLACE FUNCTION public.budget_reserve(
  _budget_id uuid, _amount_cents bigint, _reference text DEFAULT NULL, _expires_at timestamptz DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _b record; _remaining bigint; _id uuid := gen_random_uuid();
BEGIN
  IF NOT public.is_corp_or_finance(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT * INTO _b FROM public.budgets WHERE id = _budget_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Budget % not found', _budget_id; END IF;
  IF _b.status NOT IN ('ACTIVE','DRAFT') THEN RAISE EXCEPTION 'Budget % is %', _budget_id, _b.status; END IF;
  IF _amount_cents <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  _remaining := _b.total_cents - _b.reserved_cents - _b.consumed_cents;
  IF _amount_cents > _remaining THEN
    RAISE EXCEPTION 'Budget overspend: requested % > remaining %', _amount_cents, _remaining;
  END IF;
  INSERT INTO public.budget_reservations (id, budget_id, amount_cents, currency, reference, reserved_by, expires_at)
  VALUES (_id, _budget_id, _amount_cents, _b.currency, _reference, auth.uid(), _expires_at);
  UPDATE public.budgets SET reserved_cents = reserved_cents + _amount_cents WHERE id = _budget_id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.budget_consume(
  _reservation_id uuid, _journal_id uuid DEFAULT NULL, _corp_invoice_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r record; _cid uuid := gen_random_uuid();
BEGIN
  IF NOT public.is_corp_or_finance(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT * INTO _r FROM public.budget_reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation % not found', _reservation_id; END IF;
  IF _r.status <> 'RESERVED' THEN RAISE EXCEPTION 'Reservation % is %', _reservation_id, _r.status; END IF;
  INSERT INTO public.budget_consumption (id, budget_id, reservation_id, amount_cents, currency, journal_id, corporate_invoice_id)
  VALUES (_cid, _r.budget_id, _reservation_id, _r.amount_cents, _r.currency, _journal_id, _corp_invoice_id);
  UPDATE public.budget_reservations SET status='CONSUMED', consumed_at = now() WHERE id = _reservation_id;
  UPDATE public.budgets
     SET reserved_cents = reserved_cents - _r.amount_cents,
         consumed_cents = consumed_cents + _r.amount_cents,
         status = CASE WHEN consumed_cents + _r.amount_cents > total_cents THEN 'OVERSPENT'::public.budget_status ELSE status END
   WHERE id = _r.budget_id;
  RETURN _cid;
END $$;

CREATE OR REPLACE FUNCTION public.budget_release(_reservation_id uuid, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r record;
BEGIN
  IF NOT public.is_corp_or_finance(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  SELECT * INTO _r FROM public.budget_reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reservation % not found', _reservation_id; END IF;
  IF _r.status <> 'RESERVED' THEN RAISE EXCEPTION 'Reservation % is %', _reservation_id, _r.status; END IF;
  UPDATE public.budget_reservations
     SET status='RELEASED', released_at = now(),
         metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('release_reason', _reason)
   WHERE id = _reservation_id;
  UPDATE public.budgets SET reserved_cents = reserved_cents - _r.amount_cents WHERE id = _r.budget_id;
END $$;

CREATE OR REPLACE FUNCTION public.approval_request_create(
  _workflow_id uuid, _amount_cents bigint, _reference text DEFAULT NULL,
  _cost_center_id uuid DEFAULT NULL, _budget_id uuid DEFAULT NULL,
  _justification text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _w record; _req_id uuid := gen_random_uuid(); _res_id uuid; _due timestamptz;
BEGIN
  SELECT * INTO _w FROM public.approval_workflows WHERE id = _workflow_id AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workflow % not found/active', _workflow_id; END IF;
  IF _amount_cents <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
  _due := now() + (_w.sla_minutes || ' minutes')::interval;
  IF _budget_id IS NOT NULL THEN
    _res_id := public.budget_reserve(_budget_id, _amount_cents, _reference, _due);
  END IF;
  INSERT INTO public.approval_requests
    (id, corporate_id, workflow_id, cost_center_id, budget_id, reservation_id,
     requested_by, amount_cents, reference, justification, due_at)
  VALUES
    (_req_id, _w.corporate_id, _workflow_id, _cost_center_id, _budget_id, _res_id,
     auth.uid(), _amount_cents, _reference, _justification, _due);
  IF _res_id IS NOT NULL THEN
    UPDATE public.budget_reservations SET approval_request_id = _req_id WHERE id = _res_id;
  END IF;
  RETURN _req_id;
END $$;

CREATE OR REPLACE FUNCTION public.approval_decide(
  _request_id uuid, _decision public.approval_decision_type, _comment text DEFAULT NULL,
  _delegate_to uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _req record; _route record; _max_step int; _dec_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO _req FROM public.approval_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request % not found', _request_id; END IF;
  IF _req.status NOT IN ('PENDING','IN_REVIEW') THEN
    RAISE EXCEPTION 'Request % already %', _request_id, _req.status;
  END IF;
  SELECT * INTO _route FROM public.approval_routes
   WHERE workflow_id = _req.workflow_id AND step_no = _req.current_step;
  IF NOT FOUND THEN RAISE EXCEPTION 'No route step % for workflow', _req.current_step; END IF;

  IF _route.approver_user_id IS NOT NULL AND _route.approver_user_id <> auth.uid() THEN
    IF NOT EXISTS (SELECT 1 FROM public.approval_delegations d
                    WHERE d.delegator_user_id = _route.approver_user_id
                      AND d.delegate_user_id = auth.uid() AND d.active = true
                      AND now() BETWEEN d.starts_at AND COALESCE(d.ends_at,'infinity'::timestamptz))
    THEN RAISE EXCEPTION 'Not authorized to decide step %', _req.current_step; END IF;
  ELSIF _route.approver_role IS NOT NULL
        AND NOT public.has_role(auth.uid(), _route.approver_role) THEN
    RAISE EXCEPTION 'Role % required for step %', _route.approver_role, _req.current_step;
  END IF;

  INSERT INTO public.approval_decisions (id, request_id, step_no, decided_by, decision, comment, delegated_to)
  VALUES (_dec_id, _request_id, _req.current_step, auth.uid(), _decision, _comment, _delegate_to);

  IF _decision = 'REJECTED' THEN
    IF _req.reservation_id IS NOT NULL THEN
      PERFORM public.budget_release(_req.reservation_id, 'approval_rejected');
    END IF;
    UPDATE public.approval_requests SET status='REJECTED', resolved_at = now() WHERE id = _request_id;
  ELSIF _decision = 'APPROVED' THEN
    SELECT max(step_no) INTO _max_step FROM public.approval_routes WHERE workflow_id = _req.workflow_id;
    IF _req.current_step >= _max_step THEN
      UPDATE public.approval_requests SET status='APPROVED', resolved_at = now() WHERE id = _request_id;
    ELSE
      UPDATE public.approval_requests SET current_step = current_step + 1, status='IN_REVIEW' WHERE id = _request_id;
    END IF;
  END IF;
  RETURN _dec_id;
END $$;
