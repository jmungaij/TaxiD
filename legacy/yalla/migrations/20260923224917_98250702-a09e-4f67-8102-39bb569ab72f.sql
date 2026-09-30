CREATE TABLE public.payment_receiving_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  channel text NOT NULL,
  account_number text NOT NULL,
  country text NOT NULL DEFAULT 'KE',
  currency text NOT NULL DEFAULT 'KES',
  service text NOT NULL DEFAULT 'all',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  verification_status text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','verified')),
  config_version int NOT NULL DEFAULT 1,
  effective_from date NOT NULL DEFAULT current_date,
  effective_until date,
  approved_by uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payment_receiving_one_active ON public.payment_receiving_accounts (provider, channel, service) WHERE status = 'active';
GRANT SELECT ON public.payment_receiving_accounts TO authenticated;
GRANT ALL ON public.payment_receiving_accounts TO service_role;
ALTER TABLE public.payment_receiving_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins and finance read receiving accounts" ON public.payment_receiving_accounts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR COALESCE(public.has_staff_permission('staff.finance.read'), false));

INSERT INTO public.payment_receiving_accounts (provider, channel, account_number, status, verification_status, config_version, effective_from, note)
VALUES ('safaricom_mpesa','paybill','4148095','active','verified',1,'2026-01-01','Owner rule: all Yalla M-Pesa collections go to PayBill 4148095.');

ALTER TABLE public.payment_attempts ADD COLUMN IF NOT EXISTS receiving_account text;

CREATE TABLE public.mpesa_payment_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_attempt_id uuid NOT NULL REFERENCES public.payment_attempts(id),
  action text NOT NULL CHECK (action IN ('flagged','resolved')),
  reason text NOT NULL,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.mpesa_payment_flags TO authenticated;
GRANT ALL ON public.mpesa_payment_flags TO service_role;
ALTER TABLE public.mpesa_payment_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins and finance read payment flags" ON public.mpesa_payment_flags FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR COALESCE(public.has_staff_permission('staff.finance.read'), false));

CREATE OR REPLACE FUNCTION public._mpesa_payment_flags_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'mpesa_payment_flags is append-only'; END $$;
CREATE TRIGGER mpesa_payment_flags_append_only BEFORE UPDATE OR DELETE ON public.mpesa_payment_flags
  FOR EACH ROW EXECUTE FUNCTION public._mpesa_payment_flags_append_only();

CREATE OR REPLACE FUNCTION public._payments_may_review() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(public.has_role(auth.uid(), 'admin'), false) OR COALESCE(public.has_staff_permission('staff.finance.read'), false)
$$;

CREATE OR REPLACE FUNCTION public.payments_board(p_limit int DEFAULT 200) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_paybill text; v jsonb;
BEGIN
  IF NOT public._payments_may_review() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
  SELECT account_number INTO v_paybill FROM payment_receiving_accounts
   WHERE provider='safaricom_mpesa' AND channel='paybill' AND status='active' LIMIT 1;
  WITH a AS (
    SELECT p.*,
      (SELECT bool_or(c.verified) FROM mpesa_callback_logs c WHERE c.checkout_request_id = p.checkout_request_id) AS cb_verified,
      (SELECT count(*) FROM mpesa_callback_logs c WHERE c.checkout_request_id = p.checkout_request_id) AS cb_count,
      (SELECT max((i->>'Value')::numeric) FROM mpesa_callback_logs c,
          jsonb_array_elements(COALESCE(c.payload->'Body'->'stkCallback'->'CallbackMetadata'->'Item','[]'::jsonb)) i
        WHERE c.checkout_request_id = p.checkout_request_id AND i->>'Name'='Amount') AS cb_amount,
      (SELECT d.action FROM mpesa_payment_flags d WHERE d.payment_attempt_id = p.id ORDER BY d.created_at DESC LIMIT 1) AS dispute
    FROM payment_attempts p ORDER BY p.created_at DESC LIMIT LEAST(GREATEST(p_limit,1),1000)
  )
  SELECT jsonb_build_object('paybill', v_paybill, 'rows', COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'created_at', created_at, 'amount_kes', amount_cents/100.0, 'account_reference', account_reference,
    'phone_masked', CASE WHEN length(phone) >= 7 THEN left(phone,4) || repeat('*', length(phone)-7) || right(phone,3) ELSE '***' END,
    'provider_state', state, 'receipt', mpesa_receipt_number, 'wallet_posted', wallet_posted,
    'callbacks', cb_count, 'safaricom_verified', COALESCE(cb_verified,false),
    'callback_amount_kes', cb_amount, 'receiving_account', receiving_account, 'dispute', dispute,
    'checks', jsonb_build_object(
      'safaricom_confirmed', COALESCE(cb_verified,false),
      'amount_matches', cb_amount IS NOT NULL AND cb_amount*100 = amount_cents,
      'paybill_matches', receiving_account IS NOT NULL AND receiving_account = v_paybill,
      'receipt_present', mpesa_receipt_number IS NOT NULL,
      'credited_once', wallet_posted),
    'intent_state', CASE
      WHEN dispute = 'flagged' THEN 'DISPUTED'
      WHEN state::text IN ('CANCELLED') THEN 'CANCELLED'
      WHEN state::text IN ('FAILED') THEN 'FAILED'
      WHEN state::text = 'COMPLETED' AND COALESCE(cb_verified,false) AND wallet_posted
           AND (receiving_account IS NULL OR receiving_account = v_paybill) THEN
             CASE WHEN receiving_account IS NULL THEN 'POSTED_ACCOUNT_UNRECORDED' ELSE 'POSTED' END
      WHEN state::text = 'COMPLETED' AND COALESCE(cb_verified,false) THEN 'SAFARICOM_CONFIRMED'
      WHEN state::text IN ('COMPLETED','CALLBACK_RECEIVED') THEN 'REQUIRES_REVIEW'
      WHEN accepted_at IS NOT NULL THEN 'AWAITING_CUSTOMER'
      ELSE 'PENDING' END
  ) ORDER BY created_at DESC), '[]'::jsonb)) INTO v FROM a;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.payment_dispute_record(p_attempt_id uuid, p_action text, p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public._payments_may_review() THEN RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'; END IF;
  IF p_action NOT IN ('flagged','resolved') THEN RAISE EXCEPTION 'invalid action'; END IF;
  IF length(trim(COALESCE(p_reason,''))) < 5 THEN RAISE EXCEPTION 'a reason of at least 5 characters is required'; END IF;
  INSERT INTO mpesa_payment_flags (payment_attempt_id, action, reason, actor_id)
  VALUES (p_attempt_id, p_action, trim(p_reason), auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.payments_board(int), public.payment_dispute_record(uuid,text,text), public._payments_may_review(), public._mpesa_payment_flags_append_only() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payments_board(int), public.payment_dispute_record(uuid,text,text) TO authenticated;