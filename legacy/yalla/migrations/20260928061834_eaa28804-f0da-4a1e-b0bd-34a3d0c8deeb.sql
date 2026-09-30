CREATE OR REPLACE FUNCTION public.fin_record_mpesa(_booking_ref text, _amount numeric, _receipt text, _verified boolean, _payer text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bk public.charter_bookings; v_id uuid; v_email text;
BEGIN
  SELECT * INTO v_bk FROM public.charter_bookings WHERE reference = upper(trim(_booking_ref));
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','BOOKING_NOT_FOUND'); END IF;
  IF _amount IS NULL OR _amount <= 0 OR coalesce(_receipt,'') = '' THEN RETURN jsonb_build_object('ok',false,'error','INVALID'); END IF;
  INSERT INTO public.fin_payment_reports(booking_ref, charter_booking_id, amount, currency, paid_on, method, payment_reference, note, source, status, verified_at, decision_note)
    VALUES (v_bk.reference, v_bk.id, _amount, coalesce(v_bk.currency,'KES'), (now() AT TIME ZONE 'Africa/Nairobi')::date, 'mpesa', _receipt,
            left(coalesce('Payer ' || _payer, ''), 200), 'mpesa',
            CASE WHEN _verified THEN 'verified' ELSE 'reported' END,
            CASE WHEN _verified THEN now() END,
            CASE WHEN _verified THEN 'Confirmed by Safaricom STK query' ELSE 'PayBill notice — check against M-Pesa statement' END)
    ON CONFLICT DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok',true,'duplicate',true); END IF;
  IF _verified THEN PERFORM public._fin_apply_verified(v_bk.id); END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_bk.user_id;
  PERFORM public._fin_post_finance_record(v_email,
    CASE WHEN _verified THEN 'M-Pesa payment received — booking ' ELSE 'M-Pesa payment being checked — booking ' END || v_bk.reference,
    format('M-Pesa payment %s of %s %s for booking %s %s.', _receipt, coalesce(v_bk.currency,'KES'), to_char(_amount,'FM999,999,990.00'), v_bk.reference,
      CASE WHEN _verified THEN 'has been received' ELSE 'has been noted and is being checked by our finance team' END),
    jsonb_build_object('payment_report_id', v_id, 'kind', 'mpesa'));
  RETURN jsonb_build_object('ok',true,'id',v_id);
END $$;
REVOKE ALL ON FUNCTION public.fin_record_mpesa(text,numeric,text,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fin_record_mpesa(text,numeric,text,boolean,text) TO service_role;
GRANT EXECUTE ON FUNCTION public._fin_apply_verified(uuid) TO service_role;