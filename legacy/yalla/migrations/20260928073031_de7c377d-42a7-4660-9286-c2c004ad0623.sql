ALTER TABLE public.fin_payment_reports DROP CONSTRAINT IF EXISTS fin_payment_reports_source_check;
ALTER TABLE public.fin_payment_reports ADD CONSTRAINT fin_payment_reports_source_check CHECK (source = ANY (ARRAY['client','team','email','mpesa','wallet']));
ALTER TABLE public.fin_payment_reports DROP CONSTRAINT IF EXISTS fin_payment_reports_method_check;
ALTER TABLE public.fin_payment_reports ADD CONSTRAINT fin_payment_reports_method_check CHECK (method = ANY (ARRAY['mpesa','bank','cash','card','other','wallet']));

CREATE OR REPLACE FUNCTION public.fin_pay_booking_from_wallet(_booking_ref text, _amount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_bk public.charter_bookings; v_w public.wallets; v_paid numeric; v_due numeric; v_cents bigint; v_id uuid; v_email text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'error','AUTH_REQUIRED'); END IF;
  SELECT * INTO v_bk FROM public.charter_bookings WHERE reference = upper(trim(_booking_ref)) FOR UPDATE;
  IF NOT FOUND OR v_bk.user_id IS DISTINCT FROM v_uid THEN RETURN jsonb_build_object('ok',false,'error','BOOKING_NOT_FOUND'); END IF;
  IF lower(coalesce(v_bk.payment_status,'')) IN ('paid','settled','completed') THEN RETURN jsonb_build_object('ok',false,'error','ALREADY_PAID'); END IF;
  SELECT coalesce(sum(amount),0) INTO v_paid FROM public.fin_payment_reports WHERE charter_booking_id = v_bk.id AND status='verified';
  v_due := coalesce(v_bk.amount,0) - v_paid;
  IF _amount IS NULL OR _amount < 1 OR round(_amount,2) > v_due THEN RETURN jsonb_build_object('ok',false,'error','INVALID_AMOUNT','due',v_due); END IF;
  v_cents := round(_amount*100)::bigint;
  SELECT * INTO v_w FROM public.wallets WHERE user_id = v_uid AND wallet_type='personal' AND lifecycle_status='ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NO_WALLET'); END IF;
  IF v_w.balance_cents < v_cents THEN RETURN jsonb_build_object('ok',false,'error','INSUFFICIENT_FUNDS','balance',v_w.balance_cents/100.0); END IF;
  UPDATE public.wallets SET balance_cents = balance_cents - v_cents WHERE id = v_w.id;
  INSERT INTO public.wallet_transactions(wallet_id,user_id,direction,amount_cents,kind,status,reference,metadata)
    VALUES (v_w.id, v_uid, 'debit', v_cents, 'trip_charge', 'completed', v_bk.reference, jsonb_build_object('source','wallet_booking_payment','charter_booking_id',v_bk.id));
  INSERT INTO public.fin_payment_reports(booking_ref,charter_booking_id,amount,currency,paid_on,method,payment_reference,note,source,status,reported_by,verified_at,decision_note)
    VALUES (v_bk.reference, v_bk.id, round(_amount,2), coalesce(v_bk.currency,'KES'), (now() AT TIME ZONE 'Africa/Nairobi')::date, 'wallet', 'WALLET-'||left(v_w.id::text,8), 'Paid from Yalla wallet', 'wallet', 'verified', v_uid, now(), 'Wallet debit recorded by the system')
    RETURNING id INTO v_id;
  PERFORM public._fin_apply_verified(v_bk.id);
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  PERFORM public._fin_post_finance_record(v_email, 'Payment received — '||v_bk.reference,
    'We received KES '||to_char(round(_amount,2),'FM999,999,990.00')||' from your Yalla wallet for booking '||v_bk.reference||'. Remaining balance: KES '||to_char(greatest(v_due-round(_amount,2),0),'FM999,999,990.00')||'.',
    jsonb_build_object('kind','wallet_payment','booking_ref',v_bk.reference,'report_id',v_id));
  RETURN jsonb_build_object('ok',true,'id',v_id,'remaining',greatest(v_due-round(_amount,2),0),'wallet_balance',(v_w.balance_cents-v_cents)/100.0);
END $$;
REVOKE ALL ON FUNCTION public.fin_pay_booking_from_wallet(text,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_pay_booking_from_wallet(text,numeric) TO authenticated;