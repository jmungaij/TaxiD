-- ─────────────────────────────────────────────────────────────
-- Corporate wallet funding: callback-only credit authority
-- ─────────────────────────────────────────────────────────────

CREATE TABLE public.charter_wallet_funding_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid REFERENCES public.charter_corporate_wallets(id) ON DELETE CASCADE,
  per_txn_max_kes numeric NOT NULL DEFAULT 250000,
  daily_max_kes numeric NOT NULL DEFAULT 1000000,
  monthly_max_kes numeric NOT NULL DEFAULT 10000000,
  approval_threshold_kes numeric NOT NULL DEFAULT 500000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX charter_wallet_funding_limits_scope
  ON public.charter_wallet_funding_limits (wallet_id) NULLS NOT DISTINCT;

GRANT SELECT ON public.charter_wallet_funding_limits TO authenticated;
GRANT ALL ON public.charter_wallet_funding_limits TO service_role;
ALTER TABLE public.charter_wallet_funding_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read funding limits" ON public.charter_wallet_funding_limits
  FOR SELECT TO authenticated USING (
    wallet_id IS NULL
    OR EXISTS (SELECT 1 FROM public.charter_corporate_wallets w WHERE w.id = wallet_id AND w.owner_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
  );
CREATE TRIGGER charter_wallet_funding_limits_touch BEFORE UPDATE
  ON public.charter_wallet_funding_limits FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.charter_wallet_funding_limits (wallet_id) VALUES (NULL);

CREATE TABLE public.charter_wallet_funding_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES public.charter_corporate_wallets(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  actor_id uuid,
  amount_kes numeric NOT NULL CHECK (amount_kes > 0),
  cost_center text NOT NULL,
  purpose text,
  approver_name text,
  approver_title text,
  reference text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  phone text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','stk_requested','awaiting_callback','paid','failed','cancelled','expired','reversed','refunded')),
  merchant_request_id text,
  checkout_request_id text,
  mpesa_receipt text,
  result_code integer,
  result_desc text,
  ledger_entry_id uuid,
  requires_approval boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX charter_wallet_funding_requests_wallet ON public.charter_wallet_funding_requests (wallet_id, created_at DESC);
CREATE UNIQUE INDEX charter_wallet_funding_requests_checkout
  ON public.charter_wallet_funding_requests (checkout_request_id) WHERE checkout_request_id IS NOT NULL;
CREATE UNIQUE INDEX charter_wallet_funding_requests_receipt
  ON public.charter_wallet_funding_requests (mpesa_receipt) WHERE mpesa_receipt IS NOT NULL;

GRANT SELECT ON public.charter_wallet_funding_requests TO authenticated;
GRANT ALL ON public.charter_wallet_funding_requests TO service_role;
ALTER TABLE public.charter_wallet_funding_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read their funding requests" ON public.charter_wallet_funding_requests
  FOR SELECT TO authenticated USING (
    owner_id = auth.uid() OR actor_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
  );
CREATE TRIGGER charter_wallet_funding_requests_touch BEFORE UPDATE
  ON public.charter_wallet_funding_requests FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Ledger immutability: append-only, no UPDATE / DELETE ever.
CREATE OR REPLACE FUNCTION public.charter_wallet_ledger_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'charter_wallet_ledger is append-only: % is not permitted. Post a compensating entry instead.', TG_OP;
END;
$$;
CREATE TRIGGER charter_wallet_ledger_no_update BEFORE UPDATE ON public.charter_wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION public.charter_wallet_ledger_append_only();
CREATE TRIGGER charter_wallet_ledger_no_delete BEFORE DELETE ON public.charter_wallet_ledger
  FOR EACH ROW EXECUTE FUNCTION public.charter_wallet_ledger_append_only();

-- Funding limit enforcement at insert time.
CREATE OR REPLACE FUNCTION public.charter_wallet_funding_enforce_limits()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  lim public.charter_wallet_funding_limits;
  day_total numeric;
  month_total numeric;
BEGIN
  SELECT * INTO lim FROM public.charter_wallet_funding_limits
   WHERE wallet_id = NEW.wallet_id;
  IF lim IS NULL THEN
    SELECT * INTO lim FROM public.charter_wallet_funding_limits WHERE wallet_id IS NULL;
  END IF;

  IF NEW.amount_kes > lim.per_txn_max_kes THEN
    RAISE EXCEPTION 'funding_limit_exceeded: per-transaction maximum is KES %', lim.per_txn_max_kes;
  END IF;

  SELECT COALESCE(SUM(amount_kes), 0) INTO day_total
    FROM public.charter_wallet_funding_requests
   WHERE wallet_id = NEW.wallet_id AND status IN ('paid','awaiting_callback','stk_requested')
     AND created_at >= date_trunc('day', now());
  IF day_total + NEW.amount_kes > lim.daily_max_kes THEN
    RAISE EXCEPTION 'funding_limit_exceeded: daily maximum is KES %', lim.daily_max_kes;
  END IF;

  SELECT COALESCE(SUM(amount_kes), 0) INTO month_total
    FROM public.charter_wallet_funding_requests
   WHERE wallet_id = NEW.wallet_id AND status IN ('paid','awaiting_callback','stk_requested')
     AND created_at >= date_trunc('month', now());
  IF month_total + NEW.amount_kes > lim.monthly_max_kes THEN
    RAISE EXCEPTION 'funding_limit_exceeded: monthly maximum is KES %', lim.monthly_max_kes;
  END IF;

  NEW.requires_approval := NEW.amount_kes > lim.approval_threshold_kes;
  RETURN NEW;
END;
$$;
CREATE TRIGGER charter_wallet_funding_limits_check BEFORE INSERT
  ON public.charter_wallet_funding_requests FOR EACH ROW
  EXECUTE FUNCTION public.charter_wallet_funding_enforce_limits();

-- Callback-gated credit: the ONLY path that may increase a corporate wallet.
CREATE OR REPLACE FUNCTION public.charter_wallet_apply_funding_callback(
  p_checkout_request_id text,
  p_merchant_request_id text,
  p_amount_kes numeric,
  p_receipt text,
  p_result_code integer,
  p_result_desc text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  fr public.charter_wallet_funding_requests;
  w public.charter_corporate_wallets;
  prev text;
  new_balance numeric;
  entry_id uuid;
  new_hash text;
BEGIN
  SELECT * INTO fr FROM public.charter_wallet_funding_requests
   WHERE checkout_request_id = p_checkout_request_id FOR UPDATE;
  IF fr IS NULL THEN
    RETURN jsonb_build_object('matched', false, 'reason', 'no_funding_request');
  END IF;

  -- Idempotency: a terminal request never changes a balance again.
  IF fr.status IN ('paid','reversed','refunded') THEN
    RETURN jsonb_build_object('matched', true, 'applied', false, 'reason', 'duplicate_ignored', 'status', fr.status, 'funding_request_id', fr.id);
  END IF;
  IF fr.status IN ('failed','cancelled','expired') AND p_result_code <> 0 THEN
    RETURN jsonb_build_object('matched', true, 'applied', false, 'reason', 'already_terminal', 'status', fr.status, 'funding_request_id', fr.id);
  END IF;

  IF p_result_code <> 0 THEN
    UPDATE public.charter_wallet_funding_requests
       SET status = CASE WHEN p_result_code = 1032 THEN 'cancelled'
                         WHEN p_result_code = 1037 THEN 'expired'
                         ELSE 'failed' END,
           result_code = p_result_code, result_desc = p_result_desc
     WHERE id = fr.id;
    RETURN jsonb_build_object('matched', true, 'applied', false, 'reason', 'non_success', 'result_code', p_result_code, 'funding_request_id', fr.id);
  END IF;

  IF p_merchant_request_id IS NOT NULL AND fr.merchant_request_id IS NOT NULL
     AND p_merchant_request_id <> fr.merchant_request_id THEN
    UPDATE public.charter_wallet_funding_requests
       SET status = 'failed', result_code = p_result_code,
           result_desc = 'merchant_request_id_mismatch'
     WHERE id = fr.id;
    RETURN jsonb_build_object('matched', true, 'applied', false, 'reason', 'merchant_request_id_mismatch', 'funding_request_id', fr.id);
  END IF;

  IF round(COALESCE(p_amount_kes, -1)) <> round(fr.amount_kes) THEN
    UPDATE public.charter_wallet_funding_requests
       SET status = 'failed', result_code = p_result_code, result_desc = 'amount_mismatch'
     WHERE id = fr.id;
    RETURN jsonb_build_object('matched', true, 'applied', false, 'reason', 'amount_mismatch',
      'expected', fr.amount_kes, 'received', p_amount_kes, 'funding_request_id', fr.id);
  END IF;

  IF p_receipt IS NULL OR length(p_receipt) = 0 THEN
    UPDATE public.charter_wallet_funding_requests
       SET status = 'failed', result_code = p_result_code, result_desc = 'missing_receipt'
     WHERE id = fr.id;
    RETURN jsonb_build_object('matched', true, 'applied', false, 'reason', 'missing_receipt', 'funding_request_id', fr.id);
  END IF;

  -- Receipt replay across a different request is rejected outright.
  IF EXISTS (SELECT 1 FROM public.charter_wallet_funding_requests
              WHERE mpesa_receipt = p_receipt AND id <> fr.id) THEN
    RETURN jsonb_build_object('matched', true, 'applied', false, 'reason', 'receipt_replay', 'funding_request_id', fr.id);
  END IF;

  -- Atomic: lock the wallet, append the ledger entry, move the balance.
  SELECT * INTO w FROM public.charter_corporate_wallets WHERE id = fr.wallet_id FOR UPDATE;
  IF w IS NULL THEN
    RETURN jsonb_build_object('matched', true, 'applied', false, 'reason', 'wallet_not_found');
  END IF;

  SELECT entry_hash INTO prev FROM public.charter_wallet_ledger
   WHERE wallet_id = w.id ORDER BY created_at DESC LIMIT 1;
  prev := COALESCE(prev, 'GENESIS');
  new_balance := COALESCE(w.balance_kes, 0) + round(fr.amount_kes);
  new_hash := encode(digest(prev || '|' || fr.id::text || '|credit|' || round(fr.amount_kes)::text
                    || '|' || new_balance::text || '|' || p_receipt, 'sha256'), 'hex');

  INSERT INTO public.charter_wallet_ledger (
    wallet_id, direction, amount_kes, balance_after, reference,
    approver_name, approver_title, cost_center, prev_hash, entry_hash, actor_id
  ) VALUES (
    w.id, 'credit', round(fr.amount_kes), new_balance,
    fr.reference || ' · ' || p_receipt,
    COALESCE(fr.approver_name, w.approver_name), COALESCE(fr.approver_title, w.approver_title),
    fr.cost_center, prev, new_hash, fr.actor_id
  ) RETURNING id INTO entry_id;

  UPDATE public.charter_corporate_wallets SET balance_kes = new_balance WHERE id = w.id;

  UPDATE public.charter_wallet_funding_requests
     SET status = 'paid', mpesa_receipt = p_receipt, result_code = 0,
         result_desc = COALESCE(p_result_desc, 'Success'),
         ledger_entry_id = entry_id, paid_at = now()
   WHERE id = fr.id;

  RETURN jsonb_build_object('matched', true, 'applied', true, 'funding_request_id', fr.id,
    'ledger_entry_id', entry_id, 'balance_kes', new_balance, 'receipt', p_receipt);
END;
$$;
REVOKE ALL ON FUNCTION public.charter_wallet_apply_funding_callback(text,text,numeric,text,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.charter_wallet_apply_funding_callback(text,text,numeric,text,integer,text) TO service_role;

-- Transactional debit (spending) — replaces read-modify-write in the API.
CREATE OR REPLACE FUNCTION public.charter_wallet_debit(
  p_wallet_id uuid, p_amount_kes numeric, p_reference text DEFAULT NULL,
  p_booking_id uuid DEFAULT NULL, p_cost_center text DEFAULT NULL,
  p_approver_name text DEFAULT NULL, p_approver_title text DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w public.charter_corporate_wallets;
  prev text; new_balance numeric; entry_id uuid; new_hash text; amt numeric;
BEGIN
  amt := round(p_amount_kes);
  IF amt IS NULL OR amt <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;
  SELECT * INTO w FROM public.charter_corporate_wallets WHERE id = p_wallet_id FOR UPDATE;
  IF w IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'wallet_not_found'); END IF;
  IF COALESCE(w.balance_kes, 0) < amt THEN
    RETURN jsonb_build_object('ok', false, 'error', 'insufficient_funds',
      'balance_kes', COALESCE(w.balance_kes, 0), 'shortfall_kes', amt - COALESCE(w.balance_kes, 0));
  END IF;

  SELECT entry_hash INTO prev FROM public.charter_wallet_ledger
   WHERE wallet_id = w.id ORDER BY created_at DESC LIMIT 1;
  prev := COALESCE(prev, 'GENESIS');
  new_balance := COALESCE(w.balance_kes, 0) - amt;
  new_hash := encode(digest(prev || '|debit|' || amt::text || '|' || new_balance::text
                    || '|' || COALESCE(p_reference, ''), 'sha256'), 'hex');

  INSERT INTO public.charter_wallet_ledger (
    wallet_id, direction, amount_kes, balance_after, reference, booking_id,
    approver_name, approver_title, cost_center, prev_hash, entry_hash, actor_id
  ) VALUES (
    w.id, 'debit', amt, new_balance, p_reference, p_booking_id,
    COALESCE(p_approver_name, w.approver_name), COALESCE(p_approver_title, w.approver_title),
    p_cost_center, prev, new_hash, p_actor_id
  ) RETURNING id INTO entry_id;

  UPDATE public.charter_corporate_wallets SET balance_kes = new_balance WHERE id = w.id;
  RETURN jsonb_build_object('ok', true, 'balance_kes', new_balance, 'entry_id', entry_id);
END;
$$;
REVOKE ALL ON FUNCTION public.charter_wallet_debit(uuid,numeric,text,uuid,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.charter_wallet_debit(uuid,numeric,text,uuid,text,text,text,uuid) TO service_role;

-- Expire stale, unconfirmed funding requests.
CREATE OR REPLACE FUNCTION public.charter_wallet_funding_expire_stale()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  WITH x AS (
    UPDATE public.charter_wallet_funding_requests
       SET status = 'expired', result_desc = COALESCE(result_desc, 'expired_without_callback')
     WHERE status IN ('draft','stk_requested','awaiting_callback')
       AND expires_at < now()
    RETURNING 1
  ) SELECT count(*) INTO n FROM x;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.charter_wallet_funding_expire_stale() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.charter_wallet_funding_expire_stale() TO service_role;

-- Reconciliation: wallet balance must equal the signed ledger sum.
CREATE OR REPLACE FUNCTION public.charter_wallet_reconcile()
RETURNS TABLE (
  wallet_id uuid, organization_name text, balance_kes numeric,
  ledger_balance_kes numeric, drift_kes numeric, entries bigint, paid_funding_kes numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id, w.organization_name, COALESCE(w.balance_kes, 0),
         COALESCE(l.ledger_balance, 0),
         COALESCE(w.balance_kes, 0) - COALESCE(l.ledger_balance, 0),
         COALESCE(l.entries, 0),
         COALESCE(f.paid_total, 0)
    FROM public.charter_corporate_wallets w
    LEFT JOIN (
      SELECT wallet_id,
             SUM(CASE WHEN direction = 'credit' THEN amount_kes ELSE -amount_kes END) AS ledger_balance,
             count(*) AS entries
        FROM public.charter_wallet_ledger GROUP BY wallet_id
    ) l ON l.wallet_id = w.id
    LEFT JOIN (
      SELECT wallet_id, SUM(amount_kes) AS paid_total
        FROM public.charter_wallet_funding_requests WHERE status = 'paid' GROUP BY wallet_id
    ) f ON f.wallet_id = w.id;
$$;
REVOKE ALL ON FUNCTION public.charter_wallet_reconcile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.charter_wallet_reconcile() TO authenticated, service_role;