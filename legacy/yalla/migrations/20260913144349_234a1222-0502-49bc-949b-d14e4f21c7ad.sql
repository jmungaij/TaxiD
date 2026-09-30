-- Event-driven recovery: when a verified M-Pesa payment lands for a rental
-- quotation, settle it immediately instead of waiting for a sweep.
CREATE OR REPLACE FUNCTION public._rental_settle_on_verified_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ref text := upper(coalesce(NEW.account_reference,''));
BEGIN
  IF NEW.status <> 'SUCCESS' OR NEW.deleted_at IS NOT NULL THEN RETURN NEW; END IF;
  IF ref = '' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'SUCCESS' THEN RETURN NEW; END IF;

  IF EXISTS (SELECT 1 FROM public.rental_quote_requests q
              WHERE q.reference = ref AND q.payment_status <> 'paid') THEN
    -- Idempotent: a repeat callback replays without double-posting.
    PERFORM public.rental_quote_settle_payment(ref, NEW.checkout_request_id);
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public._rental_settle_on_verified_payment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._rental_settle_on_verified_payment() TO service_role;

DROP TRIGGER IF EXISTS trg_rental_settle_on_verified_payment ON public.mpesa_transactions;
CREATE TRIGGER trg_rental_settle_on_verified_payment
  AFTER INSERT OR UPDATE OF status ON public.mpesa_transactions
  FOR EACH ROW EXECUTE FUNCTION public._rental_settle_on_verified_payment();