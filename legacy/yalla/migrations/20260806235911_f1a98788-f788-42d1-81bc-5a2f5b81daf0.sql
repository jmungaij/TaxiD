-- ── 1. Scoped funding limits ────────────────────────────────────────────
ALTER TABLE public.charter_wallet_funding_limits
  ADD COLUMN IF NOT EXISTS actor_id uuid,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS label text;

DROP INDEX IF EXISTS public.charter_wallet_funding_limits_scope;
CREATE UNIQUE INDEX charter_wallet_funding_limits_scope
  ON public.charter_wallet_funding_limits (wallet_id, actor_id, department) NULLS NOT DISTINCT;

GRANT SELECT ON public.charter_wallet_funding_limits TO authenticated;
GRANT ALL ON public.charter_wallet_funding_limits TO service_role;

DROP POLICY IF EXISTS "Admins manage funding limits" ON public.charter_wallet_funding_limits;
CREATE POLICY "Admins manage funding limits" ON public.charter_wallet_funding_limits
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ── 2. Request lifecycle columns ────────────────────────────────────────
ALTER TABLE public.charter_wallet_funding_requests
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS stk_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_stk_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversal_reason text,
  ADD COLUMN IF NOT EXISTS reversal_evidence jsonb,
  ADD COLUMN IF NOT EXISTS reversed_by uuid,
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz;

-- ── 3. Most-specific limit resolution + per-scope aggregation ───────────
CREATE OR REPLACE FUNCTION public.charter_wallet_funding_enforce_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lim public.charter_wallet_funding_limits;
  day_total numeric;
  month_total numeric;
BEGIN
  SELECT * INTO lim FROM public.charter_wallet_funding_limits
   WHERE wallet_id = NEW.wallet_id
   ORDER BY (actor_id IS NOT NULL AND actor_id = NEW.actor_id) DESC,
            (department IS NOT NULL AND department = NEW.department) DESC,
            (actor_id IS NULL AND department IS NULL) DESC
   LIMIT 1;

  IF lim IS NULL OR (lim.actor_id IS NOT NULL AND lim.actor_id <> NEW.actor_id)
     OR (lim.department IS NOT NULL AND lim.department IS DISTINCT FROM NEW.department) THEN
    SELECT * INTO lim FROM public.charter_wallet_funding_limits
     WHERE wallet_id IS NULL
     ORDER BY (actor_id IS NOT NULL AND actor_id = NEW.actor_id) DESC,
              (department IS NOT NULL AND department = NEW.department) DESC,
              (actor_id IS NULL AND department IS NULL) DESC
     LIMIT 1;
  END IF;

  IF lim IS NULL THEN
    RAISE EXCEPTION 'funding_limits_unconfigured';
  END IF;

  IF NEW.amount_kes > lim.per_txn_max_kes THEN
    RAISE EXCEPTION 'funding_limit_exceeded: per-transaction maximum is KES %', lim.per_txn_max_kes;
  END IF;

  SELECT COALESCE(SUM(amount_kes), 0) INTO day_total
    FROM public.charter_wallet_funding_requests
   WHERE wallet_id = NEW.wallet_id AND status IN ('paid','awaiting_callback','stk_requested')
     AND (lim.actor_id IS NULL OR actor_id = NEW.actor_id)
     AND (lim.department IS NULL OR department IS NOT DISTINCT FROM NEW.department)
     AND created_at >= date_trunc('day', now());
  IF day_total + NEW.amount_kes > lim.daily_max_kes THEN
    RAISE EXCEPTION 'funding_limit_exceeded: daily maximum is KES %', lim.daily_max_kes;
  END IF;

  SELECT COALESCE(SUM(amount_kes), 0) INTO month_total
    FROM public.charter_wallet_funding_requests
   WHERE wallet_id = NEW.wallet_id AND status IN ('paid','awaiting_callback','stk_requested')
     AND (lim.actor_id IS NULL OR actor_id = NEW.actor_id)
     AND (lim.department IS NULL OR department IS NOT DISTINCT FROM NEW.department)
     AND created_at >= date_trunc('month', now());
  IF month_total + NEW.amount_kes > lim.monthly_max_kes THEN
    RAISE EXCEPTION 'funding_limit_exceeded: monthly maximum is KES %', lim.monthly_max_kes;
  END IF;

  NEW.requires_approval := NEW.amount_kes > lim.approval_threshold_kes;
  RETURN NEW;
END;
$$;

-- ── 4. STK resend cooldown ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.charter_wallet_register_stk_attempt(_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.charter_wallet_funding_requests;
BEGIN
  SELECT * INTO r FROM public.charter_wallet_funding_requests
   WHERE id = _request_id FOR UPDATE;
  IF r IS NULL THEN RAISE EXCEPTION 'funding_request_not_found'; END IF;
  IF r.status NOT IN ('draft','stk_requested','awaiting_callback') THEN
    RAISE EXCEPTION 'funding_request_terminal: %', r.status;
  END IF;
  IF r.last_stk_at IS NOT NULL AND r.last_stk_at > now() - interval '60 seconds' THEN
    RAISE EXCEPTION 'stk_cooldown_active: wait % seconds',
      ceil(extract(epoch from (r.last_stk_at + interval '60 seconds' - now())));
  END IF;
  IF r.stk_attempts >= 3 THEN
    RAISE EXCEPTION 'stk_attempt_limit_reached';
  END IF;
  UPDATE public.charter_wallet_funding_requests
     SET stk_attempts = r.stk_attempts + 1, last_stk_at = now()
   WHERE id = _request_id;
  RETURN jsonb_build_object('attempt', r.stk_attempts + 1, 'remaining', 3 - (r.stk_attempts + 1));
END;
$$;

-- ── 5. Finance action audit trail ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.charter_wallet_finance_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funding_request_id uuid REFERENCES public.charter_wallet_funding_requests(id) ON DELETE SET NULL,
  wallet_id uuid REFERENCES public.charter_corporate_wallets(id) ON DELETE CASCADE,
  action text NOT NULL,
  amount_kes numeric,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ledger_entry_id uuid,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.charter_wallet_finance_actions TO authenticated;
GRANT ALL ON public.charter_wallet_finance_actions TO service_role;
ALTER TABLE public.charter_wallet_finance_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Finance reads wallet actions" ON public.charter_wallet_finance_actions;
CREATE POLICY "Finance reads wallet actions" ON public.charter_wallet_finance_actions
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.charter_corporate_wallets w
                WHERE w.id = charter_wallet_finance_actions.wallet_id AND w.owner_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.charter_wallet_finance_actions_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'charter_wallet_finance_actions is append-only'; END;
$$;
DROP TRIGGER IF EXISTS charter_wallet_finance_actions_no_update ON public.charter_wallet_finance_actions;
CREATE TRIGGER charter_wallet_finance_actions_no_update BEFORE UPDATE OR DELETE
  ON public.charter_wallet_finance_actions FOR EACH ROW
  EXECUTE FUNCTION public.charter_wallet_finance_actions_append_only();

-- ── 6. Reversal / refund (compensating ledger entry, never a rewrite) ───
CREATE OR REPLACE FUNCTION public.charter_wallet_reverse_funding(
  _request_id uuid,
  _kind text,
  _reason text,
  _evidence jsonb DEFAULT '{}'::jsonb
)
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
  IF NOT (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden: finance role required';
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

-- ── 7. Daily reconciliation ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.charter_wallet_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  wallets_scanned integer NOT NULL DEFAULT 0,
  requests_scanned integer NOT NULL DEFAULT 0,
  findings integer NOT NULL DEFAULT 0,
  critical integer NOT NULL DEFAULT 0,
  balanced boolean NOT NULL DEFAULT true,
  triggered_by text NOT NULL DEFAULT 'cron',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.charter_wallet_reconciliation_runs TO authenticated;
GRANT ALL ON public.charter_wallet_reconciliation_runs TO service_role;
ALTER TABLE public.charter_wallet_reconciliation_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Finance reads reconciliation runs" ON public.charter_wallet_reconciliation_runs;
CREATE POLICY "Finance reads reconciliation runs" ON public.charter_wallet_reconciliation_runs
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE TABLE IF NOT EXISTS public.charter_wallet_reconciliation_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.charter_wallet_reconciliation_runs(id) ON DELETE CASCADE,
  severity text NOT NULL,
  kind text NOT NULL,
  wallet_id uuid,
  funding_request_id uuid,
  expected_kes numeric,
  actual_kes numeric,
  detail text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.charter_wallet_reconciliation_findings TO authenticated;
GRANT ALL ON public.charter_wallet_reconciliation_findings TO service_role;
ALTER TABLE public.charter_wallet_reconciliation_findings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Finance reads reconciliation findings" ON public.charter_wallet_reconciliation_findings;
CREATE POLICY "Finance reads reconciliation findings" ON public.charter_wallet_reconciliation_findings
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

CREATE INDEX IF NOT EXISTS charter_wallet_recon_findings_run ON public.charter_wallet_reconciliation_findings (run_id, severity);

CREATE OR REPLACE FUNCTION public.charter_wallet_daily_reconciliation(
  _window interval DEFAULT '24 hours'::interval,
  _triggered_by text DEFAULT 'cron'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  run_id uuid;
  w_scanned integer := 0;
  r_scanned integer := 0;
  n_findings integer := 0;
  n_critical integer := 0;
  rec record;
BEGIN
  INSERT INTO public.charter_wallet_reconciliation_runs (window_start, window_end, triggered_by)
  VALUES (now() - _window, now(), _triggered_by)
  RETURNING id INTO run_id;

  -- a. wallet balance must equal signed ledger sum
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

  -- b. every paid funding request must own exactly one ledger entry
  FOR rec IN
    SELECT f.id, f.wallet_id, f.amount_kes, f.ledger_entry_id, f.reference
      FROM public.charter_wallet_funding_requests f
     WHERE f.status = 'paid' AND f.created_at >= now() - _window
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
  END LOOP;

  -- c. stale pending requests past expiry
  FOR rec IN
    SELECT f.id, f.wallet_id, f.amount_kes, f.status
      FROM public.charter_wallet_funding_requests f
     WHERE f.status IN ('draft','stk_requested','awaiting_callback')
       AND f.expires_at < now()
  LOOP
    INSERT INTO public.charter_wallet_reconciliation_findings
      (run_id, severity, kind, wallet_id, funding_request_id, expected_kes, detail)
    VALUES (run_id, 'major', 'stale_pending_funding', rec.wallet_id, rec.id, rec.amount_kes,
            'Funding request is past its expiry window and still pending: ' || rec.status);
    n_findings := n_findings + 1;
  END LOOP;

  -- d. paid M-Pesa receipts with no funding request (unmatched money)
  FOR rec IN
    SELECT f.id, f.wallet_id, f.amount_kes
      FROM public.charter_wallet_funding_requests f
     WHERE f.status = 'paid' AND f.mpesa_receipt IS NULL
       AND f.created_at >= now() - _window
  LOOP
    INSERT INTO public.charter_wallet_reconciliation_findings
      (run_id, severity, kind, wallet_id, funding_request_id, expected_kes, detail)
    VALUES (run_id, 'critical', 'paid_without_receipt', rec.wallet_id, rec.id, rec.amount_kes,
            'Funding request is paid but carries no M-Pesa receipt.');
    n_findings := n_findings + 1; n_critical := n_critical + 1;
  END LOOP;

  UPDATE public.charter_wallet_reconciliation_runs
     SET wallets_scanned = w_scanned, requests_scanned = r_scanned,
         findings = n_findings, critical = n_critical, balanced = (n_critical = 0)
   WHERE id = run_id;

  RETURN jsonb_build_object(
    'run_id', run_id, 'wallets_scanned', w_scanned, 'requests_scanned', r_scanned,
    'findings', n_findings, 'critical', n_critical, 'balanced', n_critical = 0
  );
END;
$$;