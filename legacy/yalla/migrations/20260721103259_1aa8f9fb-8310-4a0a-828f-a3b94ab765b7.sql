
CREATE TABLE IF NOT EXISTS public.driver_withdrawal_certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id uuid NOT NULL,
  driver_user_id uuid,
  correlation_id text,
  passed boolean NOT NULL,
  score int NOT NULL,
  chain jsonb NOT NULL DEFAULT '{}'::jsonb,
  reconciliation jsonb NOT NULL DEFAULT '{}'::jsonb,
  failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.driver_withdrawal_certifications TO authenticated;
GRANT ALL ON public.driver_withdrawal_certifications TO service_role;

ALTER TABLE public.driver_withdrawal_certifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view withdrawal certifications"
ON public.driver_withdrawal_certifications
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_dwc_payout ON public.driver_withdrawal_certifications(payout_id);
CREATE INDEX IF NOT EXISTS idx_dwc_created ON public.driver_withdrawal_certifications(created_at DESC);

CREATE OR REPLACE FUNCTION public.certify_driver_withdrawal(_payout_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payout       record;
  v_wallet       record;
  v_journal      record;
  v_attempt      record;
  v_mpesa        record;
  v_debits       bigint := 0;
  v_credits      bigint := 0;
  v_failures     jsonb  := '[]'::jsonb;
  v_chain        jsonb  := '{}'::jsonb;
  v_recon        jsonb  := '{}'::jsonb;
  v_score        int    := 100;
  v_passed       boolean;
  v_corr         text;
BEGIN
  SELECT * INTO v_payout FROM public.driver_payouts WHERE id = _payout_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('passed', false, 'error', 'payout_not_found');
  END IF;

  v_corr := v_payout.metadata->>'correlation_id';
  v_chain := jsonb_build_object(
    'payout', jsonb_build_object('id', v_payout.id, 'status', v_payout.status, 'amount_cents', v_payout.amount_cents)
  );

  -- Wallet stage
  SELECT * INTO v_wallet FROM public.wallets
   WHERE user_id = v_payout.driver_id AND wallet_type = 'driver' LIMIT 1;
  IF NOT FOUND THEN
    v_failures := v_failures || jsonb_build_object('stage','wallet','reason','wallet_missing');
    v_score := v_score - 25;
  ELSE
    v_chain := v_chain || jsonb_build_object('wallet',
      jsonb_build_object('id', v_wallet.id, 'balance_cents', v_wallet.balance_cents));
  END IF;

  -- Journal stage
  IF v_payout.journal_id IS NOT NULL THEN
    SELECT COALESCE(SUM(CASE WHEN direction='debit'  THEN amount_cents ELSE 0 END),0),
           COALESCE(SUM(CASE WHEN direction='credit' THEN amount_cents ELSE 0 END),0)
      INTO v_debits, v_credits
      FROM public.journal_lines WHERE journal_id = v_payout.journal_id;
    v_chain := v_chain || jsonb_build_object('journal',
      jsonb_build_object('id', v_payout.journal_id, 'debits', v_debits, 'credits', v_credits));
    IF v_debits <> v_credits THEN
      v_failures := v_failures || jsonb_build_object('stage','journal','reason','unbalanced',
        'debits', v_debits, 'credits', v_credits);
      v_score := v_score - 30;
    END IF;
  ELSIF upper(v_payout.status::text) IN ('SUCCESS','SETTLED','PAID') THEN
    v_failures := v_failures || jsonb_build_object('stage','journal','reason','missing_journal_for_settled_payout');
    v_score := v_score - 20;
  END IF;

  -- Payment attempt (best-effort by correlation_id)
  IF v_corr IS NOT NULL THEN
    SELECT * INTO v_attempt FROM public.payment_attempts
     WHERE correlation_id = v_corr ORDER BY created_at DESC LIMIT 1;
    IF FOUND THEN
      v_chain := v_chain || jsonb_build_object('payment_attempt',
        jsonb_build_object('id', v_attempt.id, 'state', v_attempt.state, 'amount_cents', v_attempt.amount_cents));
      IF v_attempt.amount_cents <> v_payout.amount_cents THEN
        v_failures := v_failures || jsonb_build_object('stage','payment_attempt','reason','amount_mismatch',
          'attempt', v_attempt.amount_cents, 'payout', v_payout.amount_cents);
        v_score := v_score - 15;
      END IF;
    END IF;
  END IF;

  -- M-Pesa stage
  IF v_payout.provider_txn_id IS NOT NULL THEN
    SELECT * INTO v_mpesa FROM public.mpesa_transactions
     WHERE mpesa_receipt = v_payout.provider_txn_id LIMIT 1;
    IF FOUND THEN
      v_chain := v_chain || jsonb_build_object('mpesa',
        jsonb_build_object('receipt', v_mpesa.mpesa_receipt, 'status', v_mpesa.status, 'amount_cents', v_mpesa.amount_cents));
      IF v_mpesa.amount_cents <> v_payout.amount_cents THEN
        v_failures := v_failures || jsonb_build_object('stage','mpesa','reason','amount_mismatch');
        v_score := v_score - 15;
      END IF;
    END IF;
  END IF;

  v_recon := jsonb_build_object(
    'journal_balanced', v_debits = v_credits,
    'chain_stages_present', (v_chain ? 'wallet') AND (v_chain ? 'journal' OR upper(v_payout.status::text) IN ('PENDING','QUEUED','PROCESSING')),
    'checked_at', now()
  );

  v_passed := jsonb_array_length(v_failures) = 0;

  INSERT INTO public.driver_withdrawal_certifications
    (payout_id, driver_user_id, correlation_id, passed, score, chain, reconciliation, failures)
  VALUES
    (v_payout.id, v_payout.driver_id, v_corr, v_passed, GREATEST(v_score,0), v_chain, v_recon, v_failures);

  RETURN jsonb_build_object(
    'passed', v_passed, 'score', GREATEST(v_score,0),
    'chain', v_chain, 'reconciliation', v_recon, 'failures', v_failures,
    'correlation_id', v_corr
  );
END;
$$;

REVOKE ALL ON FUNCTION public.certify_driver_withdrawal(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.certify_driver_withdrawal(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.driver_withdrawal_certification_scoreboard()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total',      COUNT(*),
    'passed',     COUNT(*) FILTER (WHERE passed),
    'failed',     COUNT(*) FILTER (WHERE NOT passed),
    'pass_rate',  CASE WHEN COUNT(*)=0 THEN 100 ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE passed) / COUNT(*), 2) END,
    'avg_score',  COALESCE(ROUND(AVG(score)::numeric, 2), 100),
    'window',     '7d',
    'as_of',      now()
  )
  FROM public.driver_withdrawal_certifications
  WHERE created_at > now() - interval '7 days';
$$;

GRANT EXECUTE ON FUNCTION public.driver_withdrawal_certification_scoreboard() TO authenticated, service_role;
