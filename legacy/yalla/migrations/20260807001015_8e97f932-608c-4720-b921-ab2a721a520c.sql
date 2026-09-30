-- ── 1. Finance alert settings ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.charter_wallet_finance_alert_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  email_recipients text[] NOT NULL DEFAULT '{}',
  webhook_url text,
  min_severity text NOT NULL DEFAULT 'major',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.charter_wallet_finance_alert_settings TO authenticated;
GRANT ALL ON public.charter_wallet_finance_alert_settings TO service_role;
ALTER TABLE public.charter_wallet_finance_alert_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Finance manages wallet alert settings" ON public.charter_wallet_finance_alert_settings;
CREATE POLICY "Finance manages wallet alert settings" ON public.charter_wallet_finance_alert_settings
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

INSERT INTO public.charter_wallet_finance_alert_settings (singleton)
SELECT true WHERE NOT EXISTS (SELECT 1 FROM public.charter_wallet_finance_alert_settings);

-- ── 2. Alert outbox (one row per finding, deduped) ──────────────────────
CREATE TABLE IF NOT EXISTS public.charter_wallet_finance_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL UNIQUE REFERENCES public.charter_wallet_reconciliation_findings(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.charter_wallet_reconciliation_runs(id) ON DELETE CASCADE,
  severity text NOT NULL,
  kind text NOT NULL,
  detail text NOT NULL,
  wallet_id uuid,
  funding_request_id uuid,
  expected_kes numeric,
  actual_kes numeric,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  email_sent_to text[] NOT NULL DEFAULT '{}',
  webhook_status integer,
  last_error text,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.charter_wallet_finance_alerts TO authenticated;
GRANT ALL ON public.charter_wallet_finance_alerts TO service_role;
ALTER TABLE public.charter_wallet_finance_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Finance reads wallet alerts" ON public.charter_wallet_finance_alerts;
CREATE POLICY "Finance reads wallet alerts" ON public.charter_wallet_finance_alerts
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));
CREATE INDEX IF NOT EXISTS charter_wallet_finance_alerts_pending
  ON public.charter_wallet_finance_alerts (created_at) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.charter_wallet_queue_finance_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.charter_wallet_finance_alert_settings;
  rank_new integer;
  rank_min integer;
BEGIN
  SELECT * INTO s FROM public.charter_wallet_finance_alert_settings ORDER BY created_at LIMIT 1;
  IF s IS NULL OR NOT s.enabled THEN RETURN NEW; END IF;

  rank_new := CASE NEW.severity WHEN 'critical' THEN 3 WHEN 'major' THEN 2 ELSE 1 END;
  rank_min := CASE s.min_severity WHEN 'critical' THEN 3 WHEN 'major' THEN 2 ELSE 1 END;
  IF rank_new < rank_min THEN RETURN NEW; END IF;

  INSERT INTO public.charter_wallet_finance_alerts (
    finding_id, run_id, severity, kind, detail, wallet_id,
    funding_request_id, expected_kes, actual_kes
  ) VALUES (
    NEW.id, NEW.run_id, NEW.severity, NEW.kind, NEW.detail, NEW.wallet_id,
    NEW.funding_request_id, NEW.expected_kes, NEW.actual_kes
  ) ON CONFLICT (finding_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS charter_wallet_findings_alert ON public.charter_wallet_reconciliation_findings;
CREATE TRIGGER charter_wallet_findings_alert AFTER INSERT
  ON public.charter_wallet_reconciliation_findings FOR EACH ROW
  EXECUTE FUNCTION public.charter_wallet_queue_finance_alert();

-- ── 3. Reconciliation attempts (queue + audit) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.charter_wallet_reconciliation_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_from timestamptz NOT NULL,
  requested_to timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempt integer NOT NULL DEFAULT 1,
  retry_of uuid REFERENCES public.charter_wallet_reconciliation_attempts(id) ON DELETE SET NULL,
  run_id uuid REFERENCES public.charter_wallet_reconciliation_runs(id) ON DELETE SET NULL,
  findings integer NOT NULL DEFAULT 0,
  critical integer NOT NULL DEFAULT 0,
  error text,
  note text,
  requested_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
GRANT SELECT ON public.charter_wallet_reconciliation_attempts TO authenticated;
GRANT ALL ON public.charter_wallet_reconciliation_attempts TO service_role;
ALTER TABLE public.charter_wallet_reconciliation_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Finance reads reconciliation attempts" ON public.charter_wallet_reconciliation_attempts;
CREATE POLICY "Finance reads reconciliation attempts" ON public.charter_wallet_reconciliation_attempts
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role));

-- ── 4. Range reconciliation, recorded as an attempt ─────────────────────
CREATE OR REPLACE FUNCTION public.charter_wallet_reconcile_range(
  _from timestamptz,
  _to timestamptz,
  _triggered_by text DEFAULT 'console',
  _retry_of uuid DEFAULT NULL,
  _note text DEFAULT NULL
)
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
  IF NOT (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden: finance role required';
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

-- ── 5. Queue an attempt without running it (retry queue) ────────────────
CREATE OR REPLACE FUNCTION public.charter_wallet_queue_reconciliation(
  _from timestamptz,
  _to timestamptz,
  _retry_of uuid DEFAULT NULL,
  _note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  attempt_id uuid;
  attempt_no integer := 1;
BEGIN
  IF NOT (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'forbidden: finance role required';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _to <= _from THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;
  IF _retry_of IS NOT NULL THEN
    SELECT coalesce(attempt, 0) + 1 INTO attempt_no
      FROM public.charter_wallet_reconciliation_attempts WHERE id = _retry_of;
    attempt_no := coalesce(attempt_no, 1);
  END IF;

  INSERT INTO public.charter_wallet_reconciliation_attempts (
    requested_from, requested_to, status, attempt, retry_of, note, requested_by
  ) VALUES (_from, _to, 'queued', attempt_no, _retry_of, _note, auth.uid())
  RETURNING id INTO attempt_id;

  RETURN attempt_id;
END;
$$;