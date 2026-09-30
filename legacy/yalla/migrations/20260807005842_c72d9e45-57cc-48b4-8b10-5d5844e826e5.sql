-- Acknowledge a mismatch alert with notes (included in exports).
CREATE OR REPLACE FUNCTION public.charter_wallet_acknowledge_alert(
  _alert_id uuid, _notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE a public.charter_wallet_finance_alerts;
BEGIN
  IF NOT public.has_recon_permission(auth.uid(), 'recon.alerts.manage') THEN
    RAISE EXCEPTION 'forbidden: recon.alerts.manage permission required';
  END IF;
  UPDATE public.charter_wallet_finance_alerts
     SET acknowledged_at = now(), acknowledged_by = auth.uid(),
         acknowledgement_notes = nullif(btrim(coalesce(_notes, '')), '')
   WHERE id = _alert_id
  RETURNING * INTO a;
  IF a IS NULL THEN RAISE EXCEPTION 'alert_not_found'; END IF;
  RETURN jsonb_build_object('alert_id', a.id, 'acknowledged_at', a.acknowledged_at);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.charter_wallet_acknowledge_alert(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.charter_wallet_acknowledge_alert(uuid, text) TO authenticated;

-- Queue an immediate retry for a failing alert (respects max attempts).
CREATE OR REPLACE FUNCTION public.charter_wallet_retry_alert(_alert_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE a public.charter_wallet_finance_alerts;
BEGIN
  IF NOT public.has_recon_permission(auth.uid(), 'recon.alerts.manage') THEN
    RAISE EXCEPTION 'forbidden: recon.alerts.manage permission required';
  END IF;
  UPDATE public.charter_wallet_finance_alerts
     SET status = 'failed', next_attempt_at = now(),
         max_attempts = greatest(coalesce(max_attempts, 5), coalesce(attempts, 0) + 1)
   WHERE id = _alert_id AND status IN ('failed', 'exhausted')
  RETURNING * INTO a;
  IF a IS NULL THEN RAISE EXCEPTION 'alert_not_retryable'; END IF;
  RETURN jsonb_build_object('alert_id', a.id, 'attempts', a.attempts, 'max_attempts', a.max_attempts);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.charter_wallet_retry_alert(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.charter_wallet_retry_alert(uuid) TO authenticated;

-- Drill-down reads for approved finance/compliance roles.
DROP POLICY IF EXISTS "Owners read their wallet ledger" ON public.charter_wallet_ledger;
CREATE POLICY "Owners read their wallet ledger" ON public.charter_wallet_ledger
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.charter_corporate_wallets w
             WHERE w.id = charter_wallet_ledger.wallet_id AND w.owner_id = auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_recon_permission(auth.uid(), 'recon.export')
  );

DROP POLICY IF EXISTS "Owners read their funding requests" ON public.charter_wallet_funding_requests;
CREATE POLICY "Owners read their funding requests" ON public.charter_wallet_funding_requests
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR actor_id = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
    OR public.has_recon_permission(auth.uid(), 'recon.export')
  );