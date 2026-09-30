
-- 1. Findings table
CREATE TABLE IF NOT EXISTS public.data_quality_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID,
  finding_kind TEXT NOT NULL,
  subject_table TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  root_cause_category TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS data_quality_findings_kind_idx ON public.data_quality_findings(finding_kind, detected_at DESC);
CREATE INDEX IF NOT EXISTS data_quality_findings_run_idx ON public.data_quality_findings(run_id);

GRANT SELECT ON public.data_quality_findings TO authenticated;
GRANT ALL ON public.data_quality_findings TO service_role;

ALTER TABLE public.data_quality_findings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read data quality findings" ON public.data_quality_findings;
CREATE POLICY "Admins read data quality findings"
  ON public.data_quality_findings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Service role manages data quality findings" ON public.data_quality_findings;
CREATE POLICY "Service role manages data quality findings"
  ON public.data_quality_findings FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- 2. Wallet mismatch classifier (read-only)
CREATE OR REPLACE FUNCTION public.classify_wallet_mismatches(_run_id UUID DEFAULT NULL)
RETURNS TABLE(category TEXT, count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  DELETE FROM public.data_quality_findings
    WHERE finding_kind = 'wallet_mismatch' AND (_run_id IS NULL OR run_id = _run_id);

  INSERT INTO public.data_quality_findings(run_id, finding_kind, subject_table, subject_id, root_cause_category, evidence)
  SELECT
    _run_id,
    'wallet_mismatch',
    'wallets',
    w.id::text,
    CASE
      WHEN t.txn_count = 0 THEN 'missing_txn'
      WHEN ABS(w.balance_cents - COALESCE(t.net_cents, 0)) <= 5 THEN 'rounding'
      WHEN w.updated_at < now() - interval '24 hours' THEN 'stale_projection'
      ELSE 'unknown'
    END,
    jsonb_build_object(
      'balance_cents', w.balance_cents,
      'expected_cents', COALESCE(t.net_cents, 0),
      'delta_cents', w.balance_cents - COALESCE(t.net_cents, 0),
      'txn_count', COALESCE(t.txn_count, 0),
      'updated_at', w.updated_at
    )
  FROM public.wallets w
  LEFT JOIN (
    SELECT wallet_id,
           SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END)::BIGINT AS net_cents,
           COUNT(*)::BIGINT AS txn_count
    FROM public.wallet_transactions
    WHERE status = 'completed'
    GROUP BY wallet_id
  ) t ON t.wallet_id = w.id
  WHERE w.balance_cents <> COALESCE(t.net_cents, 0);

  RETURN QUERY
    SELECT root_cause_category::text, COUNT(*)::bigint
    FROM public.data_quality_findings
    WHERE finding_kind = 'wallet_mismatch' AND (_run_id IS NULL OR run_id = _run_id)
    GROUP BY root_cause_category
    ORDER BY 2 DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.classify_wallet_mismatches(UUID) TO authenticated, service_role;

-- 3. Orphan driver classifier (read-only)
CREATE OR REPLACE FUNCTION public.classify_orphan_drivers(_run_id UUID DEFAULT NULL)
RETURNS TABLE(category TEXT, count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  DELETE FROM public.data_quality_findings
    WHERE finding_kind = 'orphan_driver' AND (_run_id IS NULL OR run_id = _run_id);

  INSERT INTO public.data_quality_findings(run_id, finding_kind, subject_table, subject_id, root_cause_category, evidence)
  SELECT
    _run_id,
    'orphan_driver',
    'drivers',
    d.id::text,
    CASE
      WHEN d.user_id IS NULL THEN 'pre_migration'
      WHEN d.status IN ('deactivated','deleted','archived') THEN 'soft_deleted'
      ELSE 'corrupt_fk'
    END,
    jsonb_build_object(
      'user_id', d.user_id,
      'status', d.status,
      'created_at', d.created_at
    )
  FROM public.drivers d
  LEFT JOIN auth.users u ON u.id = d.user_id
  WHERE d.user_id IS NULL OR u.id IS NULL;

  RETURN QUERY
    SELECT root_cause_category::text, COUNT(*)::bigint
    FROM public.data_quality_findings
    WHERE finding_kind = 'orphan_driver' AND (_run_id IS NULL OR run_id = _run_id)
    GROUP BY root_cause_category
    ORDER BY 2 DESC;
END $$;

GRANT EXECUTE ON FUNCTION public.classify_orphan_drivers(UUID) TO authenticated, service_role;
