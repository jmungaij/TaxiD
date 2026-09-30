CREATE OR REPLACE FUNCTION public.fin_pay_booking_from_wallet(_booking_ref text, _amount numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_bk public.charter_bookings; v_w public.wallets; v_paid numeric; v_held numeric; v_due numeric; v_cents bigint; v_id uuid; v_email text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'error','AUTH_REQUIRED'); END IF;
  SELECT * INTO v_bk FROM public.charter_bookings WHERE reference = upper(trim(_booking_ref)) FOR UPDATE;
  IF NOT FOUND OR v_bk.user_id IS DISTINCT FROM v_uid THEN RETURN jsonb_build_object('ok',false,'error','BOOKING_NOT_FOUND'); END IF;
  IF lower(coalesce(v_bk.payment_status,'')) IN ('paid','settled','completed') THEN RETURN jsonb_build_object('ok',false,'error','ALREADY_PAID'); END IF;
  SELECT coalesce(sum(amount) FILTER (WHERE status='verified'),0), coalesce(sum(amount) FILTER (WHERE status='reported' AND method='wallet'),0)
    INTO v_paid, v_held FROM public.fin_payment_reports WHERE charter_booking_id = v_bk.id;
  v_due := coalesce(v_bk.amount,0) - v_paid - v_held;
  IF _amount IS NULL OR _amount < 1 OR round(_amount,2) > v_due THEN RETURN jsonb_build_object('ok',false,'error','INVALID_AMOUNT','due',v_due); END IF;
  v_cents := round(_amount*100)::bigint;
  SELECT * INTO v_w FROM public.wallets WHERE user_id = v_uid AND wallet_type='personal' AND lifecycle_status='ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NO_WALLET'); END IF;
  IF v_w.balance_cents < v_cents THEN RETURN jsonb_build_object('ok',false,'error','INSUFFICIENT_FUNDS','balance',v_w.balance_cents/100.0); END IF;
  UPDATE public.wallets SET balance_cents = balance_cents - v_cents WHERE id = v_w.id;
  INSERT INTO public.wallet_transactions(wallet_id,user_id,direction,amount_cents,kind,status,reference,metadata)
    VALUES (v_w.id, v_uid, 'debit', v_cents, 'trip_charge', 'completed', v_bk.reference, jsonb_build_object('source','wallet_booking_payment','charter_booking_id',v_bk.id,'held_for_finance_check',true));
  INSERT INTO public.fin_payment_reports(booking_ref,charter_booking_id,amount,currency,paid_on,method,payment_reference,note,source,status,reported_by)
    VALUES (v_bk.reference, v_bk.id, round(_amount,2), coalesce(v_bk.currency,'KES'), (now() AT TIME ZONE 'Africa/Nairobi')::date, 'wallet', 'WALLET-'||left(v_w.id::text,8), 'Paid from Yalla wallet — awaiting finance check', 'wallet', 'reported', v_uid)
    RETURNING id INTO v_id;
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  PERFORM public._fin_post_finance_record(v_email, 'Wallet payment received — '||v_bk.reference||' (awaiting check)',
    'We received KES '||to_char(round(_amount,2),'FM999,999,990.00')||' from your Yalla wallet for booking '||v_bk.reference||' on '||to_char(now() AT TIME ZONE 'Africa/Nairobi','DD Mon YYYY HH24:MI')||'. Finance will confirm it shortly; if it is rejected the money returns to your wallet.',
    jsonb_build_object('kind','wallet_payment','booking_ref',v_bk.reference,'report_id',v_id,'status','reported'));
  RETURN jsonb_build_object('ok',true,'id',v_id,'pending',true,'remaining',greatest(v_due-round(_amount,2),0),'wallet_balance',(v_w.balance_cents-v_cents)/100.0);
END $function$;

CREATE OR REPLACE FUNCTION public.fin_decide_payment(_id uuid, _verify boolean, _note text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); r public.fin_payment_reports; v_email text; v_w public.wallets; v_cents bigint;
BEGIN
  IF NOT coalesce(public._fin_is_verifier(), false) THEN RETURN jsonb_build_object('ok',false,'error','NOT_PERMITTED'); END IF;
  SELECT * INTO r FROM public.fin_payment_reports WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NOT_FOUND'); END IF;
  IF r.status <> 'reported' THEN RETURN jsonb_build_object('ok',false,'error','ALREADY_DECIDED'); END IF;
  IF r.reported_by = v_uid THEN RETURN jsonb_build_object('ok',false,'error','OWN_ENTRY'); END IF;
  IF NOT _verify AND length(trim(coalesce(_note,''))) < 3 THEN RETURN jsonb_build_object('ok',false,'error','NOTE_REQUIRED'); END IF;
  UPDATE public.fin_payment_reports SET status = CASE WHEN _verify THEN 'verified' ELSE 'rejected' END,
    verified_by = v_uid, verified_at = now(), decision_note = nullif(trim(_note),'') WHERE id = _id;
  IF NOT _verify AND r.method = 'wallet' AND r.reported_by IS NOT NULL THEN
    v_cents := round(r.amount*100)::bigint;
    SELECT * INTO v_w FROM public.wallets WHERE user_id = r.reported_by AND wallet_type='personal' FOR UPDATE;
    IF FOUND THEN
      UPDATE public.wallets SET balance_cents = balance_cents + v_cents WHERE id = v_w.id;
      INSERT INTO public.wallet_transactions(wallet_id,user_id,direction,amount_cents,kind,status,reference,metadata)
        VALUES (v_w.id, r.reported_by, 'credit', v_cents, 'refund', 'completed', r.booking_ref, jsonb_build_object('source','wallet_payment_rejected','payment_report_id',r.id));
    END IF;
  END IF;
  IF _verify AND r.charter_booking_id IS NOT NULL THEN
    PERFORM public._fin_apply_verified(r.charter_booking_id);
    SELECT u.email INTO v_email FROM public.charter_bookings cb JOIN auth.users u ON u.id = cb.user_id WHERE cb.id = r.charter_booking_id;
    PERFORM public._fin_post_finance_record(v_email, 'Payment verified — booking ' || r.booking_ref,
      format('We have verified your payment of %s %s for booking %s (paid %s, %s%s). Thank you.', r.currency, to_char(r.amount,'FM999,999,990.00'),
        r.booking_ref, r.paid_on, r.method, coalesce(', ref ' || r.payment_reference, '')),
      jsonb_build_object('payment_report_id', r.id, 'kind', 'payment_verified'));
  END IF;
  RETURN jsonb_build_object('ok',true);
END $function$;