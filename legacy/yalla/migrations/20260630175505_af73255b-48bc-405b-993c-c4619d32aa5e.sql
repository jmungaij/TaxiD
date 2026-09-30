
-- =========================================================================
-- Slice 1: Payments core foundation (retry — cast status to text)
-- =========================================================================

DO $$ BEGIN
  CREATE TYPE public.payment_state AS ENUM (
    'INITIATED','ACCEPTED','PROCESSING','CALLBACK_RECEIVED',
    'COMPLETED','FAILED','CANCELLED','TIMED_OUT','REVERSED',
    'RECONCILING','RECONCILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  wallet_id uuid NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'KES',
  phone text NOT NULL,
  provider text NOT NULL DEFAULT 'MPESA',
  idempotency_key text NOT NULL,
  account_reference text NOT NULL,
  merchant_request_id text,
  checkout_request_id text,
  state public.payment_state NOT NULL DEFAULT 'INITIATED',
  wallet_posted boolean NOT NULL DEFAULT false,
  mpesa_receipt_number text,
  initiated_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  completed_at timestamptz,
  failure_reason text,
  ip_address inet,
  user_agent text,
  request_id text,
  correlation_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pa_idempotency ON public.payment_attempts(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pa_merchant    ON public.payment_attempts(merchant_request_id) WHERE merchant_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pa_checkout    ON public.payment_attempts(checkout_request_id) WHERE checkout_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pa_receipt     ON public.payment_attempts(mpesa_receipt_number) WHERE mpesa_receipt_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_pa_user_state ON public.payment_attempts(user_id, state);
CREATE INDEX IF NOT EXISTS ix_pa_state_initiated ON public.payment_attempts(state, initiated_at);

GRANT SELECT ON public.payment_attempts TO authenticated;
GRANT ALL ON public.payment_attempts TO service_role;
ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owners read own attempts" ON public.payment_attempts;
CREATE POLICY "owners read own attempts" ON public.payment_attempts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "finance reads all attempts" ON public.payment_attempts;
CREATE POLICY "finance reads all attempts" ON public.payment_attempts
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'super_admin') OR
    public.has_role(auth.uid(),'finance_admin')
  );

CREATE OR REPLACE FUNCTION public._touch_payment_attempts_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_pa_updated_at ON public.payment_attempts;
CREATE TRIGGER trg_pa_updated_at BEFORE UPDATE ON public.payment_attempts
FOR EACH ROW EXECUTE FUNCTION public._touch_payment_attempts_updated_at();

CREATE TABLE IF NOT EXISTS public.mpesa_callback_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_attempt_id uuid REFERENCES public.payment_attempts(id) ON DELETE SET NULL,
  checkout_request_id text,
  merchant_request_id text,
  payload jsonb NOT NULL,
  headers jsonb,
  ip_address inet,
  verified boolean NOT NULL DEFAULT false,
  verification_notes text,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_mcl_checkout ON public.mpesa_callback_logs(checkout_request_id);
CREATE INDEX IF NOT EXISTS ix_mcl_received ON public.mpesa_callback_logs(received_at DESC);
GRANT SELECT ON public.mpesa_callback_logs TO authenticated;
GRANT ALL ON public.mpesa_callback_logs TO service_role;
ALTER TABLE public.mpesa_callback_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "finance reads callback logs" ON public.mpesa_callback_logs;
CREATE POLICY "finance reads callback logs" ON public.mpesa_callback_logs
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'super_admin') OR
    public.has_role(auth.uid(),'finance_admin')
  );

CREATE TABLE IF NOT EXISTS public.payment_audit_logs_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_attempt_id uuid REFERENCES public.payment_attempts(id) ON DELETE SET NULL,
  actor text NOT NULL,
  actor_user_id uuid,
  action text NOT NULL,
  request_id text,
  correlation_id text,
  jwt_claims jsonb,
  ip_address inet,
  headers jsonb,
  before_state public.payment_state,
  after_state public.payment_state,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_pal2_attempt ON public.payment_audit_logs_v2(payment_attempt_id);
CREATE INDEX IF NOT EXISTS ix_pal2_created ON public.payment_audit_logs_v2(created_at DESC);
GRANT SELECT, INSERT ON public.payment_audit_logs_v2 TO authenticated;
GRANT SELECT, INSERT ON public.payment_audit_logs_v2 TO service_role;
ALTER TABLE public.payment_audit_logs_v2 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "finance reads audit" ON public.payment_audit_logs_v2;
CREATE POLICY "finance reads audit" ON public.payment_audit_logs_v2
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'super_admin') OR
    public.has_role(auth.uid(),'finance_admin')
  );
DROP POLICY IF EXISTS "owners read own audit" ON public.payment_audit_logs_v2;
CREATE POLICY "owners read own audit" ON public.payment_audit_logs_v2
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.payment_attempts pa
            WHERE pa.id = payment_audit_logs_v2.payment_attempt_id
              AND pa.user_id = auth.uid())
  );
CREATE OR REPLACE FUNCTION public._block_payment_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'payment_audit_logs_v2 is append-only'; END $$;
DROP TRIGGER IF EXISTS trg_block_pal2_upd ON public.payment_audit_logs_v2;
CREATE TRIGGER trg_block_pal2_upd BEFORE UPDATE OR DELETE ON public.payment_audit_logs_v2
FOR EACH ROW EXECUTE FUNCTION public._block_payment_audit_mutation();

CREATE TABLE IF NOT EXISTS public.payment_circuit_breakers (
  service text PRIMARY KEY,
  state text NOT NULL DEFAULT 'CLOSED' CHECK (state IN ('CLOSED','OPEN','HALF_OPEN')),
  failure_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  opened_at timestamptz,
  reopens_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payment_circuit_breakers TO authenticated;
GRANT ALL ON public.payment_circuit_breakers TO service_role;
ALTER TABLE public.payment_circuit_breakers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "finance reads breakers" ON public.payment_circuit_breakers;
CREATE POLICY "finance reads breakers" ON public.payment_circuit_breakers
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'super_admin') OR
    public.has_role(auth.uid(),'finance_admin')
  );
INSERT INTO public.payment_circuit_breakers(service) VALUES ('mpesa_stkpush') ON CONFLICT DO NOTHING;
INSERT INTO public.payment_circuit_breakers(service) VALUES ('mpesa_query')   ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.payment_dead_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  payment_attempt_id uuid REFERENCES public.payment_attempts(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  last_error text,
  attempts integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','REPLAYING','RESOLVED','BLOCKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_pdl_status ON public.payment_dead_letters(status, created_at);
GRANT SELECT ON public.payment_dead_letters TO authenticated;
GRANT ALL ON public.payment_dead_letters TO service_role;
ALTER TABLE public.payment_dead_letters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "finance reads dlq" ON public.payment_dead_letters;
CREATE POLICY "finance reads dlq" ON public.payment_dead_letters
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'admin') OR
    public.has_role(auth.uid(),'super_admin') OR
    public.has_role(auth.uid(),'finance_admin')
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_mt_receipt  ON public.mpesa_transactions(mpesa_receipt)        WHERE mpesa_receipt IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mt_checkout ON public.mpesa_transactions(checkout_request_id)  WHERE checkout_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mt_merchant ON public.mpesa_transactions(merchant_request_id)  WHERE merchant_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mik_key     ON public.mpesa_idempotency_keys(idempotency_key);

CREATE OR REPLACE FUNCTION public.create_payment_attempt(
  p_user_id uuid, p_wallet_id uuid, p_amount_cents bigint, p_phone text,
  p_idempotency_key text, p_account_reference text,
  p_request_id text DEFAULT NULL, p_correlation_id text DEFAULT NULL,
  p_ip inet DEFAULT NULL, p_user_agent text DEFAULT NULL
) RETURNS public.payment_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row public.payment_attempts;
BEGIN
  INSERT INTO public.payment_attempts(
    user_id, wallet_id, amount_cents, phone, idempotency_key,
    account_reference, request_id, correlation_id, ip_address, user_agent, state
  ) VALUES (
    p_user_id, p_wallet_id, p_amount_cents, p_phone, p_idempotency_key,
    p_account_reference, p_request_id, p_correlation_id, p_ip, p_user_agent, 'INITIATED'
  )
  ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = now()
  RETURNING * INTO v_row;

  INSERT INTO public.payment_audit_logs_v2(
    payment_attempt_id, actor, actor_user_id, action,
    request_id, correlation_id, ip_address,
    before_state, after_state, payload
  ) VALUES (
    v_row.id, 'user', p_user_id, 'INITIATED',
    p_request_id, p_correlation_id, p_ip, NULL, 'INITIATED',
    jsonb_build_object('amount_cents', p_amount_cents, 'phone', p_phone)
  );
  RETURN v_row;
END $$;
GRANT EXECUTE ON FUNCTION public.create_payment_attempt(uuid,uuid,bigint,text,text,text,text,text,inet,text) TO service_role;

CREATE OR REPLACE FUNCTION public.transition_payment_state(
  p_attempt_id uuid, p_to public.payment_state, p_actor text,
  p_payload jsonb DEFAULT '{}'::jsonb, p_failure_reason text DEFAULT NULL,
  p_merchant_request_id text DEFAULT NULL, p_checkout_request_id text DEFAULT NULL,
  p_receipt text DEFAULT NULL
) RETURNS public.payment_attempts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row public.payment_attempts; v_from public.payment_state; v_ok boolean := false;
BEGIN
  SELECT * INTO v_row FROM public.payment_attempts WHERE id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found'; END IF;
  v_from := v_row.state;
  v_ok := CASE v_from
    WHEN 'INITIATED' THEN p_to IN ('ACCEPTED','FAILED','CANCELLED','TIMED_OUT')
    WHEN 'ACCEPTED'  THEN p_to IN ('PROCESSING','CALLBACK_RECEIVED','COMPLETED','FAILED','CANCELLED','TIMED_OUT')
    WHEN 'PROCESSING' THEN p_to IN ('CALLBACK_RECEIVED','COMPLETED','FAILED','TIMED_OUT')
    WHEN 'CALLBACK_RECEIVED' THEN p_to IN ('COMPLETED','FAILED','CANCELLED')
    WHEN 'COMPLETED' THEN p_to IN ('REVERSED','RECONCILING','RECONCILED')
    WHEN 'RECONCILING' THEN p_to IN ('RECONCILED','FAILED')
    ELSE false
  END;
  IF NOT v_ok THEN RAISE EXCEPTION 'illegal_transition % -> %', v_from, p_to; END IF;

  UPDATE public.payment_attempts SET
    state = p_to,
    merchant_request_id = COALESCE(p_merchant_request_id, merchant_request_id),
    checkout_request_id = COALESCE(p_checkout_request_id, checkout_request_id),
    mpesa_receipt_number = COALESCE(p_receipt, mpesa_receipt_number),
    failure_reason = COALESCE(p_failure_reason, failure_reason),
    accepted_at = CASE WHEN p_to='ACCEPTED' AND accepted_at IS NULL THEN now() ELSE accepted_at END,
    completed_at = CASE WHEN p_to IN ('COMPLETED','FAILED','CANCELLED','TIMED_OUT','REVERSED') AND completed_at IS NULL THEN now() ELSE completed_at END,
    updated_at = now()
  WHERE id = p_attempt_id RETURNING * INTO v_row;

  INSERT INTO public.payment_audit_logs_v2(
    payment_attempt_id, actor, action, before_state, after_state, payload, request_id, correlation_id
  ) VALUES (
    p_attempt_id, p_actor, 'STATE_TRANSITION', v_from, p_to, p_payload, v_row.request_id, v_row.correlation_id
  );
  RETURN v_row;
END $$;
GRANT EXECUTE ON FUNCTION public.transition_payment_state(uuid,public.payment_state,text,jsonb,text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.credit_wallet_exactly_once(
  p_checkout_request_id text, p_receipt text, p_amount_cents bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_attempt public.payment_attempts; v_wtxn_id uuid; v_existing_receipt uuid;
BEGIN
  SELECT * INTO v_attempt FROM public.payment_attempts
  WHERE checkout_request_id = p_checkout_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'attempt_not_found_for_checkout %', p_checkout_request_id; END IF;

  IF v_attempt.wallet_posted THEN
    RETURN jsonb_build_object('ok', true, 'already_credited', true, 'attempt_id', v_attempt.id);
  END IF;

  SELECT id INTO v_existing_receipt FROM public.payment_attempts
  WHERE mpesa_receipt_number = p_receipt AND id <> v_attempt.id LIMIT 1;
  IF FOUND THEN RAISE EXCEPTION 'duplicate_receipt %', p_receipt; END IF;

  IF v_attempt.amount_cents <> p_amount_cents THEN
    RAISE EXCEPTION 'amount_mismatch expected=% got=%', v_attempt.amount_cents, p_amount_cents;
  END IF;

  PERFORM 1 FROM public.wallets WHERE id = v_attempt.wallet_id FOR UPDATE;
  PERFORM public.credit_wallet(_wallet_id := v_attempt.wallet_id, _amount_cents := p_amount_cents);

  INSERT INTO public.wallet_transactions(
    wallet_id, user_id, direction, amount_cents, kind, status, reference, mpesa_receipt, metadata
  ) VALUES (
    v_attempt.wallet_id, v_attempt.user_id, 'credit', p_amount_cents, 'topup', 'completed',
    v_attempt.account_reference, p_receipt,
    jsonb_build_object('checkout_request_id', p_checkout_request_id, 'payment_attempt_id', v_attempt.id)
  ) RETURNING id INTO v_wtxn_id;

  UPDATE public.payment_attempts SET
    wallet_posted = true, mpesa_receipt_number = p_receipt, updated_at = now()
  WHERE id = v_attempt.id;

  INSERT INTO public.payment_audit_logs_v2(
    payment_attempt_id, actor, action, payload, before_state, after_state
  ) VALUES (
    v_attempt.id, 'callback', 'CREDITED',
    jsonb_build_object('receipt', p_receipt, 'amount_cents', p_amount_cents, 'wallet_transaction_id', v_wtxn_id),
    v_attempt.state, v_attempt.state
  );

  RETURN jsonb_build_object(
    'ok', true, 'already_credited', false,
    'attempt_id', v_attempt.id, 'wallet_transaction_id', v_wtxn_id
  );
END $$;
GRANT EXECUTE ON FUNCTION public.credit_wallet_exactly_once(text,text,bigint) TO service_role;

-- Backfill legacy mpesa_transactions onto payment_attempts (status::text cast)
INSERT INTO public.payment_attempts(
  user_id, wallet_id, amount_cents, currency, phone,
  idempotency_key, account_reference, merchant_request_id, checkout_request_id,
  state, wallet_posted, mpesa_receipt_number,
  initiated_at, completed_at, failure_reason, metadata, created_at
)
SELECT
  mt.user_id, mt.wallet_id, mt.amount_cents, COALESCE(mt.currency,'KES'), mt.phone,
  'legacy:' || mt.id::text,
  COALESCE(mt.account_reference, mt.transaction_reference, 'LEGACY-' || mt.id::text),
  mt.merchant_request_id, mt.checkout_request_id,
  CASE upper(mt.status::text)
    WHEN 'SUCCESS'    THEN 'COMPLETED'::public.payment_state
    WHEN 'COMPLETED'  THEN 'COMPLETED'::public.payment_state
    WHEN 'FAILED'     THEN 'FAILED'::public.payment_state
    WHEN 'CANCELLED'  THEN 'CANCELLED'::public.payment_state
    WHEN 'PROCESSING' THEN 'PROCESSING'::public.payment_state
    WHEN 'PENDING'    THEN 'ACCEPTED'::public.payment_state
    ELSE 'INITIATED'::public.payment_state
  END,
  CASE WHEN upper(mt.status::text) IN ('SUCCESS','COMPLETED') THEN true ELSE false END,
  mt.mpesa_receipt,
  COALESCE(mt.created_at, now()),
  CASE WHEN upper(mt.status::text) IN ('SUCCESS','COMPLETED','FAILED','CANCELLED') THEN COALESCE(mt.updated_at, mt.created_at) ELSE NULL END,
  mt.result_desc,
  jsonb_build_object('backfilled_from_mpesa_transaction', mt.id),
  COALESCE(mt.created_at, now())
FROM public.mpesa_transactions mt
WHERE mt.user_id IS NOT NULL AND mt.wallet_id IS NOT NULL
  AND mt.amount_cents IS NOT NULL AND mt.amount_cents > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_attempts pa
    WHERE pa.idempotency_key = 'legacy:' || mt.id::text
  );
