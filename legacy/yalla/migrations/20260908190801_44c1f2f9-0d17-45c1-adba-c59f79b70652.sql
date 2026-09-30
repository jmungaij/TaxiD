CREATE OR REPLACE FUNCTION public._invoice_revenue_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_inv public.tax_invoices; v_state text; v_amount numeric; v_res jsonb; v_paid bigint;
BEGIN
  SELECT * INTO v_inv FROM public.tax_invoices WHERE id = NEW.invoice_id;
  IF v_inv.id IS NULL OR v_inv.lead_id IS NULL THEN RETURN NEW; END IF;

  BEGIN
    PERFORM public.commercial_lifecycle_evidence_add(
      v_inv.lead_id, 'payment', NEW.receipt_no, NEW.id, 'payment_receipts',
      'Payment received ' || NEW.received_on::text);

    SELECT current_state INTO v_state FROM public.commercial_lifecycle WHERE lead_id = v_inv.lead_id;
    v_amount := round((v_inv.total_cents::numeric) / 100.0, 2);

    IF v_state = 'INVOICED' THEN
      v_res := public.commercial_lifecycle_advance(v_inv.lead_id, 'RECOGNISED', v_amount,
                 'Payment ' || NEW.receipt_no || ' received', false);
      IF COALESCE((v_res->>'ok')::boolean, false) THEN v_state := 'RECOGNISED'; END IF;
    END IF;

    -- Money actually received, read from the receipts themselves so the figure is
    -- never a stale snapshot of the invoice row.
    SELECT COALESCE(SUM(amount_cents), 0) INTO v_paid
      FROM public.payment_receipts
      WHERE invoice_id = v_inv.id AND status <> 'void';

    IF v_state = 'RECOGNISED' AND v_paid >= v_inv.total_cents THEN
      PERFORM public.commercial_lifecycle_advance(v_inv.lead_id, 'COLLECTED', v_amount,
                 'Invoice ' || v_inv.invoice_no || ' settled in full', false);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO public.tax_invoice_events(invoice_id, event, note, actor_user_id)
    VALUES (v_inv.id, 'revenue_sync_deferred', SQLERRM, auth.uid());
  END;
  RETURN NEW;
END $function$;