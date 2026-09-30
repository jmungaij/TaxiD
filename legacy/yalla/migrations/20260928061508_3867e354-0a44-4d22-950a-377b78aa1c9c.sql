CREATE OR REPLACE FUNCTION public._fin_apply_verified(_booking uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_amount numeric; v_paid numeric; v_status text;
BEGIN
  SELECT amount, payment_status INTO v_amount, v_status FROM public.charter_bookings WHERE id = _booking;
  IF NOT FOUND OR v_amount IS NULL THEN RETURN; END IF;
  IF lower(coalesce(v_status,'')) IN ('paid','settled','completed') THEN RETURN; END IF;
  SELECT coalesce(sum(amount),0) INTO v_paid FROM public.fin_payment_reports WHERE charter_booking_id = _booking AND status = 'verified';
  IF v_paid >= v_amount THEN
    UPDATE public.charter_bookings SET payment_status = 'paid', paid_at = coalesce(paid_at, now()) WHERE id = _booking;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._fin_apply_verified(uuid) FROM PUBLIC, anon, authenticated;