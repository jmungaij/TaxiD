-- Restore the full invariant body (the previous migration replaced it with a
-- call to a differently-shaped helper), keeping the new permission gate.
CREATE OR REPLACE FUNCTION public.charter_wallet_reconcile_range(
  _from timestamptz, _to timestamptz, _triggered_by text DEFAULT 'console',
  _retry_of uuid DEFAULT NULL, _note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  attempt_id uuid;
  run_id uuid;
  w_scanned integer := 0;
  r_scanned integer := 0;
  n_findings integer := 0;
  n_critical integer := 0;
  attempt_no integer := 1;
  rec record;
BEGIN
  IF NOT public.has_recon_permission(auth.uid(), 'recon.rerun') THEN
    RAISE EXCEPTION 'forbidden: recon.rerun permission required';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _to <= _from THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  IF _retry_of IS NOT NULL THEN
    SELECT attempt + 1 INTO attempt_no FROM public.charter_wallet_reconciliation_attempts WHERE id = _retry_of;
    attempt_no := coalesce(attempt_no, 1);
  END IF;

  INSERT INTO public.charter_wallet_reconciliation_attempts (
    requested_from, requested_to, status, attempt, retry_of, note, requested_by, started_at
  ) VALUES (_from, _to, 'running', attempt_no, _retry_of, _note, auth.uid(), now())
  RETURNING id INTO attempt_id;

  INSERT INTO public.charter_wallet_reconciliation_runs (window_start, window_end, triggered_by)
  VALUES (_from, _to, _triggered_by)
  RETURNING id INTO run_id;

  -- a. wallet balance must equal signed ledger sum (all-time invariant)
  FOR rec IN
    SELECT w.id, w.balance_kes,
           COALESCE(SUM(CASE WHEN l.direction = 'credit' THEN l.amount_kes ELSE -l.amount_kes END), 0) AS ledger_sum
      FROM public.charter_corporate_wallets w
      LEFT JOIN public.charter_wallet_ledger l ON l.wallet_id = w.id
     GROUP BY w.id, w.balance_kes
  LOOP
    w_scanned := w_scanned + 1;
    IF rec.balance_kes <> rec.ledger_sum THEN
      INSERT INTO public.charter_wallet_reconciliation_findings
        (run_id, severity, kind, wallet_id, expected_kes, actual_kes, detail)
      VALUES (run_id, 'critical', 'balance_ledger_drift', rec.id, rec.ledger_sum, rec.balance_kes,
              'Wallet balance does not equal the append-only ledger sum.');
      n_findings := n_findings + 1; n_critical := n_critical + 1;
    END IF;
  END LOOP;

  -- b. paid fundings in range must own a matching ledger entry, and a receipt
  FOR rec IN
    SELECT f.id, f.wallet_id, f.amount_kes, f.ledger_entry_id, f.mpesa_receipt
      FROM public.charter_wallet_funding_requests f
     WHERE f.status = 'paid' AND f.created_at >= _from AND f.created_at < _to
  LOOP
    r_scanned := r_scanned + 1;
    IF rec.ledger_entry_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.charter_wallet_ledger l
                       WHERE l.id = rec.ledger_entry_id AND l.amount_kes = rec.amount_kes) THEN
      INSERT INTO public.charter_wallet_reconciliation_findings
        (run_id, severity, kind, wallet_id, funding_request_id, expected_kes, detail)
      VALUES (run_id, 'critical', 'paid_without_ledger_entry', rec.wallet_id, rec.id, rec.amount_kes,
              'Funding request is paid but has no matching ledger entry.');
      n_findings := n_findings + 1; n_critical := n_critical + 1;
    END IF;
    IF rec.mpesa_receipt IS NULL THEN
      INSERT INTO public.charter_wallet_reconciliation_findings
        (run_id, severity, kind, wallet_id, funding_request_id, expected_kes, detail)
      VALUES (run_id, 'critical', 'paid_without_receipt', rec.wallet_id, rec.id, rec.amount_kes,
              'Funding request is paid but carries no M-Pesa receipt.');
      n_findings := n_findings + 1; n_critical := n_critical + 1;
    END IF;
  END LOOP;

  -- c. stale pending requests inside the range
  FOR rec IN
    SELECT f.id, f.wallet_id, f.amount_kes, f.status
      FROM public.charter_wallet_funding_requests f
     WHERE f.status IN ('draft','stk_requested','awaiting_callback')
       AND f.expires_at < now()
       AND f.created_at >= _from AND f.created_at < _to
  LOOP
    INSERT INTO public.charter_wallet_reconciliation_findings
      (run_id, severity, kind, wallet_id, funding_request_id, expected_kes, detail)
    VALUES (run_id, 'major', 'stale_pending_funding', rec.wallet_id, rec.id, rec.amount_kes,
            'Funding request is past its expiry window and still pending: ' || rec.status);
    n_findings := n_findings + 1;
  END LOOP;

  UPDATE public.charter_wallet_reconciliation_runs
     SET wallets_scanned = w_scanned, requests_scanned = r_scanned,
         findings = n_findings, critical = n_critical, balanced = (n_critical = 0)
   WHERE id = run_id;

  UPDATE public.charter_wallet_reconciliation_attempts
     SET status = 'succeeded', run_id = charter_wallet_reconcile_range.run_id,
         findings = n_findings, critical = n_critical, finished_at = now()
   WHERE id = attempt_id;

  RETURN jsonb_build_object(
    'attempt_id', attempt_id, 'run_id', run_id, 'attempt', attempt_no,
    'wallets_scanned', w_scanned, 'requests_scanned', r_scanned,
    'findings', n_findings, 'critical', n_critical, 'balanced', n_critical = 0
  );
END;
$$;

-- Reversal confirmation gated on the money-movement permission.
CREATE OR REPLACE FUNCTION public.charter_wallet_reverse_funding(
  _request_id uuid, _kind text, _reason text, _evidence jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.charter_wallet_funding_requests;
  w public.charter_corporate_wallets;
  prev text;
  new_balance numeric;
  entry_id uuid;
  action_id uuid;
BEGIN
  IF NOT public.has_recon_permission(auth.uid(), 'recon.reverse') THEN
    RAISE EXCEPTION 'forbidden: recon.reverse permission required';
  END IF;
  IF _kind NOT IN ('reversed','refunded') THEN
    RAISE EXCEPTION 'invalid_kind: %', _kind;
  END IF;
  IF coalesce(btrim(_reason), '') = '' THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  SELECT * INTO r FROM public.charter_wallet_funding_requests WHERE id = _request_id FOR UPDATE;
  IF r IS NULL THEN RAISE EXCEPTION 'funding_request_not_found'; END IF;
  IF r.status <> 'paid' THEN RAISE EXCEPTION 'only_paid_funding_can_be_reversed: %', r.status; END IF;

  SELECT * INTO w FROM public.charter_corporate_wallets WHERE id = r.wallet_id FOR UPDATE;
  IF w.balance_kes < r.amount_kes THEN
    RAISE EXCEPTION 'insufficient_balance_for_reversal: available KES %', w.balance_kes;
  END IF;

  new_balance := w.balance_kes - r.amount_kes;
  SELECT entry_hash INTO prev FROM public.charter_wallet_ledger
   WHERE wallet_id = w.id ORDER BY created_at DESC LIMIT 1;

  INSERT INTO public.charter_wallet_ledger (
    wallet_id, direction, amount_kes, balance_after, reference,
    approver_name, approver_title, cost_center, prev_hash, entry_hash, actor_id
  ) VALUES (
    w.id, 'debit', r.amount_kes, new_balance, r.reference || ':' || _kind,
    r.approver_name, r.approver_title, r.cost_center, prev,
    encode(digest(coalesce(prev,'') || w.id::text || r.amount_kes::text || new_balance::text || _kind || now()::text, 'sha256'), 'hex'),
    auth.uid()
  ) RETURNING id INTO entry_id;

  UPDATE public.charter_corporate_wallets SET balance_kes = new_balance, updated_at = now() WHERE id = w.id;

  UPDATE public.charter_wallet_funding_requests
     SET status = _kind, reversal_reason = _reason, reversal_evidence = _evidence,
         reversed_by = auth.uid(), reversed_at = now()
   WHERE id = r.id;

  INSERT INTO public.charter_wallet_finance_actions (
    funding_request_id, wallet_id, action, amount_kes, reason, evidence, ledger_entry_id, actor_id
  ) VALUES (r.id, w.id, _kind, r.amount_kes, _reason, coalesce(_evidence, '{}'::jsonb), entry_id, auth.uid())
  RETURNING id INTO action_id;

  RETURN jsonb_build_object(
    'status', _kind, 'wallet_id', w.id, 'balance_kes', new_balance,
    'ledger_entry_id', entry_id, 'action_id', action_id
  );
END;
$$;

-- Read access for approved finance/compliance roles (was admin-only).
DROP POLICY IF EXISTS "Finance reads reconciliation runs" ON public.charter_wallet_reconciliation_runs;
CREATE POLICY "Finance reads reconciliation runs" ON public.charter_wallet_reconciliation_runs
  FOR SELECT TO authenticated USING (public.has_recon_permission(auth.uid(), 'recon.export'));

DROP POLICY IF EXISTS "Finance reads reconciliation findings" ON public.charter_wallet_reconciliation_findings;
CREATE POLICY "Finance reads reconciliation findings" ON public.charter_wallet_reconciliation_findings
  FOR SELECT TO authenticated USING (public.has_recon_permission(auth.uid(), 'recon.export'));

DROP POLICY IF EXISTS "Finance reads reconciliation attempts" ON public.charter_wallet_reconciliation_attempts;
CREATE POLICY "Finance reads reconciliation attempts" ON public.charter_wallet_reconciliation_attempts
  FOR SELECT TO authenticated USING (public.has_recon_permission(auth.uid(), 'recon.export'));

DROP POLICY IF EXISTS "Finance reads wallet finance alerts" ON public.charter_wallet_finance_alerts;
CREATE POLICY "Finance reads wallet finance alerts" ON public.charter_wallet_finance_alerts
  FOR SELECT TO authenticated USING (public.has_recon_permission(auth.uid(), 'recon.export'));

DROP POLICY IF EXISTS "Finance reads alert settings" ON public.charter_wallet_finance_alert_settings;
CREATE POLICY "Finance reads alert settings" ON public.charter_wallet_finance_alert_settings
  FOR SELECT TO authenticated USING (public.has_recon_permission(auth.uid(), 'recon.alerts.manage'));

DROP POLICY IF EXISTS "Finance updates alert settings" ON public.charter_wallet_finance_alert_settings;
CREATE POLICY "Finance updates alert settings" ON public.charter_wallet_finance_alert_settings
  FOR UPDATE TO authenticated
  USING (public.has_recon_permission(auth.uid(), 'recon.alerts.manage'))
  WITH CHECK (public.has_recon_permission(auth.uid(), 'recon.alerts.manage'));