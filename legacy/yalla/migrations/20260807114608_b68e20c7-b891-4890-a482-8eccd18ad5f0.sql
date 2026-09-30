-- 1. Tax reporting functions: they self-gate on admin/finance roles internally.
GRANT EXECUTE ON FUNCTION public.tax_report_overview(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tax_report_vat_summary(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tax_report_sync_health(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tax_report_corporate_billing(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tax_report_invoices(date, date, text, integer, integer) TO authenticated;

-- 2. charter_quotes status: allow the canonical RFQ workflow tokens too.
ALTER TABLE public.charter_quotes DROP CONSTRAINT IF EXISTS charter_quotes_status_check;
ALTER TABLE public.charter_quotes ADD CONSTRAINT charter_quotes_status_check
  CHECK (status = ANY (ARRAY[
    'requested','priced','accepted','declined','expired','converted',
    'draft','submitted','under_review','approved','rejected','won','cancelled'
  ]::text[]));

-- 3. Immutable reconciliation action audit trail.
CREATE TABLE public.recon_action_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid,
  actor_email text,
  action text NOT NULL CHECK (action = ANY (ARRAY[
    'export','rerun','rerun_dry_run','reversal_confirm','acknowledge','resolve','alert_retry','alert_acknowledge'
  ]::text[])),
  permission text,
  target_type text,
  target_id text,
  dataset text,
  row_count integer,
  export_format text,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolution_notes text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome text NOT NULL DEFAULT 'success' CHECK (outcome = ANY (ARRAY['success','failed','denied']::text[]))
);

GRANT SELECT, INSERT ON public.recon_action_audit TO authenticated;
GRANT ALL ON public.recon_action_audit TO service_role;

ALTER TABLE public.recon_action_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recon_audit_read" ON public.recon_action_audit
  FOR SELECT TO authenticated
  USING (public.has_recon_permission(auth.uid(), 'recon.export')
      OR public.has_recon_permission(auth.uid(), 'recon.resolve')
      OR public.has_recon_permission(auth.uid(), 'recon.rerun')
      OR public.has_recon_permission(auth.uid(), 'recon.reverse'));

CREATE POLICY "recon_audit_append" ON public.recon_action_audit
  FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid());

CREATE INDEX idx_recon_action_audit_created ON public.recon_action_audit (created_at DESC);
CREATE INDEX idx_recon_action_audit_action ON public.recon_action_audit (action, created_at DESC);

CREATE OR REPLACE FUNCTION public.deny_recon_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'recon_action_audit is append-only';
END;
$$;

CREATE TRIGGER recon_action_audit_immutable
  BEFORE UPDATE OR DELETE ON public.recon_action_audit
  FOR EACH ROW EXECUTE FUNCTION public.deny_recon_audit_mutation();

-- 4. Dry-run reconciliation preview: same invariants, zero writes.
CREATE OR REPLACE FUNCTION public.charter_wallet_reconcile_dry_run(
  _from timestamptz,
  _to timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w_scanned integer := 0;
  r_scanned integer := 0;
  items jsonb := '[]'::jsonb;
  rec record;
BEGIN
  IF NOT public.has_recon_permission(auth.uid(), 'recon.rerun') THEN
    RAISE EXCEPTION 'forbidden: recon.rerun permission required';
  END IF;
  IF _from IS NULL OR _to IS NULL OR _to <= _from THEN
    RAISE EXCEPTION 'invalid_range';
  END IF;

  FOR rec IN
    SELECT w.id, w.balance_kes,
           COALESCE(SUM(CASE WHEN l.direction = 'credit' THEN l.amount_kes ELSE -l.amount_kes END), 0) AS ledger_sum
      FROM public.charter_corporate_wallets w
      LEFT JOIN public.charter_wallet_ledger l ON l.wallet_id = w.id
     GROUP BY w.id, w.balance_kes
  LOOP
    w_scanned := w_scanned + 1;
    IF rec.balance_kes <> rec.ledger_sum THEN
      items := items || jsonb_build_array(jsonb_build_object(
        'severity','critical','kind','balance_ledger_drift',
        'wallet_id', rec.id, 'funding_request_id', NULL,
        'expected_kes', rec.ledger_sum, 'actual_kes', rec.balance_kes,
        'detail','Wallet balance does not equal the append-only ledger sum.'));
    END IF;
  END LOOP;

  FOR rec IN
    SELECT f.id, f.wallet_id, f.amount_kes, f.ledger_entry_id, f.mpesa_receipt
      FROM public.charter_wallet_funding_requests f
     WHERE f.status = 'paid' AND f.created_at >= _from AND f.created_at < _to
  LOOP
    r_scanned := r_scanned + 1;
    IF rec.ledger_entry_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.charter_wallet_ledger l
                       WHERE l.id = rec.ledger_entry_id AND l.amount_kes = rec.amount_kes) THEN
      items := items || jsonb_build_array(jsonb_build_object(
        'severity','critical','kind','paid_without_ledger_entry',
        'wallet_id', rec.wallet_id, 'funding_request_id', rec.id,
        'expected_kes', rec.amount_kes, 'actual_kes', NULL,
        'detail','Funding request is paid but has no matching ledger entry.'));
    END IF;
    IF rec.mpesa_receipt IS NULL THEN
      items := items || jsonb_build_array(jsonb_build_object(
        'severity','critical','kind','paid_without_receipt',
        'wallet_id', rec.wallet_id, 'funding_request_id', rec.id,
        'expected_kes', rec.amount_kes, 'actual_kes', NULL,
        'detail','Funding request is paid but carries no M-Pesa receipt.'));
    END IF;
  END LOOP;

  FOR rec IN
    SELECT f.id, f.wallet_id, f.amount_kes, f.status
      FROM public.charter_wallet_funding_requests f
     WHERE f.status IN ('draft','stk_requested','awaiting_callback')
       AND f.expires_at < now()
       AND f.created_at >= _from AND f.created_at < _to
  LOOP
    items := items || jsonb_build_array(jsonb_build_object(
      'severity','major','kind','stale_pending_funding',
      'wallet_id', rec.wallet_id, 'funding_request_id', rec.id,
      'expected_kes', rec.amount_kes, 'actual_kes', NULL,
      'detail','Funding request is past its expiry window and still pending: ' || rec.status));
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', true,
    'window_start', _from,
    'window_end', _to,
    'wallets_scanned', w_scanned,
    'requests_scanned', r_scanned,
    'findings', jsonb_array_length(items),
    'critical', (SELECT count(*) FROM jsonb_array_elements(items) e WHERE e->>'severity' = 'critical'),
    'balanced', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(items) e WHERE e->>'severity' = 'critical'),
    'items', items
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.charter_wallet_reconcile_dry_run(timestamptz, timestamptz) TO authenticated;