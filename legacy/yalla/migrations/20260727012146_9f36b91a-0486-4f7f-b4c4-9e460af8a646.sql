CREATE TABLE public.refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id uuid REFERENCES public.payment_disputes(id) ON DELETE SET NULL,
  transaction_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'MPESA',
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'KES',
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_APPROVAL'
    CHECK (status IN ('PENDING_APPROVAL','APPROVED','REJECTED','EXECUTING','EXECUTED','FAILED','CANCELLED')),
  requested_by uuid NOT NULL,
  approved_by uuid,
  approval_note text,
  rejected_reason text,
  execution_ref text,
  failure_reason text,
  idempotency_key text UNIQUE,
  executed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_refund_requests_status_created ON public.refund_requests (status, created_at DESC);
CREATE INDEX idx_refund_requests_txn ON public.refund_requests (transaction_id);
CREATE INDEX idx_refund_requests_dispute ON public.refund_requests (dispute_id);

CREATE TABLE public.refund_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_request_id uuid NOT NULL REFERENCES public.refund_requests(id) ON DELETE CASCADE,
  actor_user_id uuid,
  action text NOT NULL,
  from_status text,
  to_status text,
  note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_refund_request_events_request ON public.refund_request_events (refund_request_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.refund_requests TO authenticated;
GRANT ALL ON public.refund_requests TO service_role;
GRANT SELECT, INSERT ON public.refund_request_events TO authenticated;
GRANT ALL ON public.refund_request_events TO service_role;

ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_request_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY refund_requests_finance_read ON public.refund_requests
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'finance_admin'::app_role,'super_admin'::app_role]));

CREATE POLICY refund_requests_finance_create ON public.refund_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'finance_admin'::app_role,'super_admin'::app_role])
  );

CREATE POLICY refund_requests_finance_update ON public.refund_requests
  FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'finance_admin'::app_role,'super_admin'::app_role]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'finance_admin'::app_role,'super_admin'::app_role]));

CREATE POLICY refund_request_events_finance_read ON public.refund_request_events
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'finance_admin'::app_role,'super_admin'::app_role]));

CREATE POLICY refund_request_events_finance_create ON public.refund_request_events
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin'::app_role,'finance_admin'::app_role,'super_admin'::app_role]));

CREATE OR REPLACE FUNCTION public.enforce_refund_maker_checker()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.approved_by IS NOT NULL AND NEW.approved_by = NEW.requested_by THEN
    RAISE EXCEPTION 'maker_checker_violation: approver must differ from requester';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_refund_requests_maker_checker
BEFORE INSERT OR UPDATE ON public.refund_requests
FOR EACH ROW EXECUTE FUNCTION public.enforce_refund_maker_checker();