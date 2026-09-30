CREATE OR REPLACE FUNCTION public._ride_payment_confirm_from_mpesa()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ref text;
  v_intent_id uuid;
  v_result jsonb;
BEGIN
  IF NEW.mpesa_receipt IS NULL THEN RETURN NEW; END IF;
  IF NEW.status::text NOT IN ('success','completed','SUCCESS','COMPLETED') THEN RETURN NEW; END IF;

  v_ref := upper(trim(COALESCE(NEW.account_reference, NEW.transaction_reference, '')));
  IF v_ref = '' THEN RETURN NEW; END IF;

  SELECT id INTO v_intent_id FROM public.ride_payment_intents
   WHERE reference = v_ref AND state = 'AWAITING_PAYMENT';
  IF v_intent_id IS NULL THEN RETURN NEW; END IF;

  v_result := public.corp_payment_confirm_mpesa(v_ref, NEW.mpesa_receipt);

  IF COALESCE((v_result->>'ok')::boolean, false) IS NOT TRUE THEN
    RAISE WARNING 'ride payment not confirmed for % : %', v_ref, v_result;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ride_payment_confirm_mpesa ON public.mpesa_transactions;
CREATE TRIGGER trg_ride_payment_confirm_mpesa
  AFTER INSERT OR UPDATE OF status, mpesa_receipt ON public.mpesa_transactions
  FOR EACH ROW EXECUTE FUNCTION public._ride_payment_confirm_from_mpesa();