CREATE OR REPLACE FUNCTION public._provider_withdrawal_invoice_gate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_require boolean;
  v_approved bigint;
  v_withdrawn bigint;
  v_open bigint;
  v_cover bigint;
  v_want bigint := coalesce(NEW.gross_cents, NEW.amount_cents);
BEGIN
  SELECT require_invoice_approval INTO v_require FROM public.provider_settlement_settings WHERE id;
  IF NOT coalesce(v_require, false) THEN RETURN NEW; END IF;

  SELECT coalesce(sum(net_cents), 0) INTO v_approved
    FROM public.provider_invoices
   WHERE provider_user_id = NEW.provider_user_id AND state = 'APPROVED';

  SELECT coalesce(lifetime_withdrawn_cents, 0) INTO v_withdrawn
    FROM public.provider_wallets WHERE provider_user_id = NEW.provider_user_id;

  SELECT coalesce(sum(coalesce(gross_cents, amount_cents)), 0) INTO v_open
    FROM public.provider_payout_requests
   WHERE provider_user_id = NEW.provider_user_id
     AND id <> NEW.id
     AND state IN ('PENDING_SCREENING','ON_HOLD','PENDING_APPROVAL','APPROVED','PROCESSING');

  v_cover := v_approved - coalesce(v_withdrawn, 0) - v_open;

  IF v_cover < v_want THEN
    RAISE EXCEPTION 'INVOICE_APPROVAL_REQUIRED'
      USING DETAIL = format('approved cover %s, requested %s', v_cover, v_want);
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public._provider_withdrawal_invoice_gate() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_provider_withdrawal_invoice_gate ON public.provider_payout_requests;
CREATE TRIGGER trg_provider_withdrawal_invoice_gate
BEFORE INSERT ON public.provider_payout_requests
FOR EACH ROW EXECUTE FUNCTION public._provider_withdrawal_invoice_gate();