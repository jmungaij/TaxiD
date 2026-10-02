ALTER TYPE public.txn_kind ADD VALUE IF NOT EXISTS 'tip';
ALTER TYPE public.txn_kind ADD VALUE IF NOT EXISTS 'ride_earning';
ALTER TYPE public.journal_source ADD VALUE IF NOT EXISTS 'DRIVER_TIP';

ALTER TABLE public.trip_tips
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'CREDITED',
  ADD COLUMN IF NOT EXISTS driver_user_id uuid,
  ADD COLUMN IF NOT EXISTS rider_wallet_txn_id uuid,
  ADD COLUMN IF NOT EXISTS driver_wallet_txn_id uuid,
  ADD COLUMN IF NOT EXISTS journal_id uuid,
  ADD COLUMN IF NOT EXISTS driver_balance_after_cents bigint,
  ADD COLUMN IF NOT EXISTS credited_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_source text;

CREATE OR REPLACE FUNCTION private.trip_tip_driver(_booking_id uuid, _amount numeric)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE b trip_bookings%ROWTYPE; w wallets%ROWTYPE; c bigint; v_duser uuid; v_dw uuid;
  v_rtx uuid; v_dtx uuid; v_j uuid := gen_random_uuid(); v_liab uuid; v_pay uuid; v_after bigint; v_tip uuid;
BEGIN
  SELECT * INTO b FROM trip_bookings WHERE id=_booking_id AND rider_user_id=auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NOT_FOUND'); END IF;
  IF b.status <> 'completed' OR b.driver_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','TRIP_NOT_COMPLETED'); END IF;
  IF EXISTS (SELECT 1 FROM trip_tips WHERE trip_booking_id=_booking_id) THEN RETURN jsonb_build_object('ok',false,'error','ALREADY_TIPPED'); END IF;
  IF _amount IS NULL OR _amount < 10 OR _amount > 5000 THEN RETURN jsonb_build_object('ok',false,'error','INVALID_AMOUNT'); END IF;
  SELECT user_id INTO v_duser FROM drivers WHERE id=b.driver_id;
  IF v_duser IS NULL THEN RETURN jsonb_build_object('ok',false,'error','DRIVER_HAS_NO_ACCOUNT'); END IF;
  c := round(_amount*100)::bigint;
  SELECT * INTO w FROM wallets WHERE user_id=auth.uid() AND wallet_type='personal' AND lifecycle_status='ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NO_WALLET'); END IF;
  IF w.balance_cents < c THEN RETURN jsonb_build_object('ok',false,'error','INSUFFICIENT_FUNDS','balance',w.balance_cents/100.0); END IF;

  -- 1. debit rider wallet (funded only by verified M-Pesa top-ups)
  UPDATE wallets SET balance_cents = balance_cents - c WHERE id=w.id;
  INSERT INTO wallet_transactions(wallet_id,user_id,direction,amount_cents,kind,status,reference,metadata)
    VALUES (w.id, auth.uid(), 'debit', c, 'tip', 'completed', 'TIP-'||b.booking_number,
            jsonb_build_object('source','driver_tip','trip_booking_id',b.id)) RETURNING id INTO v_rtx;

  -- 2. credit the existing driver wallet (the balance the payout engine pays from)
  SELECT id INTO v_dw FROM wallets WHERE user_id=v_duser AND wallet_type='driver' FOR UPDATE;
  IF v_dw IS NULL THEN
    INSERT INTO wallets(user_id, wallet_type, balance_cents, currency) VALUES (v_duser,'driver',0,'KES') RETURNING id INTO v_dw;
  END IF;
  UPDATE wallets SET balance_cents = balance_cents + c, updated_at=now() WHERE id=v_dw RETURNING balance_cents INTO v_after;
  INSERT INTO wallet_transactions(wallet_id,user_id,direction,amount_cents,kind,status,reference,metadata)
    VALUES (v_dw, v_duser, 'credit', c, 'tip', 'completed', 'TIP-'||b.booking_number,
            jsonb_build_object('source','driver_tip','trip_booking_id',b.id)) RETURNING id INTO v_dtx;

  -- 3. ledger: DR customer wallet liability / CR driver payable
  SELECT id INTO v_liab FROM ledger_accounts WHERE coa_code='2120' LIMIT 1;
  IF v_liab IS NULL THEN INSERT INTO ledger_accounts(code,name,kind,currency,coa_code)
    VALUES ('CUSTOMER_WALLET','Customer Wallet Liability','LIABILITY','KES','2120') RETURNING id INTO v_liab; END IF;
  SELECT id INTO v_pay FROM ledger_accounts WHERE coa_code='2110' LIMIT 1;
  IF v_pay IS NULL THEN INSERT INTO ledger_accounts(code,name,kind,currency,coa_code)
    VALUES ('DRIVER_PAYABLE','Driver Payables','LIABILITY','KES','2110') RETURNING id INTO v_pay; END IF;
  INSERT INTO journals(id, source, reference, description, created_by)
    VALUES (v_j, 'DRIVER_TIP', 'TIP-'||b.booking_number, 'Rider tip to driver', auth.uid());
  INSERT INTO journal_lines(journal_id, account_id, direction, amount_cents, currency, memo, posted_by) VALUES
    (v_j, v_liab, 'DEBIT', c, 'KES', 'DR Customer wallet (tip)', auth.uid()),
    (v_j, v_pay, 'CREDIT', c, 'KES', 'CR Driver payable (tip)', auth.uid());
  PERFORM public.posting_engine_post(v_j);

  INSERT INTO trip_tips(trip_booking_id, rider_user_id, driver_id, amount, state, driver_user_id,
    rider_wallet_txn_id, driver_wallet_txn_id, journal_id, driver_balance_after_cents, credited_at, payment_source)
  VALUES (b.id, auth.uid(), b.driver_id, round(_amount,2), 'CREDITED', v_duser, v_rtx, v_dtx, v_j, v_after, now(), 'wallet')
  RETURNING id INTO v_tip;
  RETURN jsonb_build_object('ok',true,'tip_id',v_tip,'wallet_balance',(w.balance_cents-c)/100.0);
END $function$;

-- Tip progress: paid out only once successful payouts after the credit cover the driver's balance at that moment (first-in, first-out).
CREATE OR REPLACE FUNCTION private.trip_tip_status(_booking_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t trip_tips%ROWTYPE; v_paid bigint; v_pend int; v_last timestamptz; v_ok_j boolean;
BEGIN
  SELECT * INTO t FROM trip_tips WHERE trip_booking_id=_booking_id
    AND (rider_user_id=auth.uid() OR driver_user_id=auth.uid() OR public._driver_finance_staff());
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NOT_FOUND'); END IF;
  SELECT EXISTS(SELECT 1 FROM journals WHERE id=t.journal_id) INTO v_ok_j;
  IF t.driver_wallet_txn_id IS NULL THEN
    RETURN jsonb_build_object('ok',true,'amount',t.amount,'created_at',t.created_at,'stage','RECORDED_LEGACY');
  END IF;
  SELECT coalesce(sum(amount_cents),0), max(paid_at) INTO v_paid, v_last FROM driver_payouts
    WHERE driver_id=t.driver_user_id AND status='SUCCESS' AND coalesce(paid_at,updated_at) >= t.credited_at;
  SELECT count(*) INTO v_pend FROM driver_payouts
    WHERE driver_id=t.driver_user_id AND status IN ('PENDING','QUEUED','PROCESSING') AND created_at >= t.credited_at;
  RETURN jsonb_build_object('ok',true,'amount',t.amount,'created_at',t.created_at,'credited_at',t.credited_at,
    'ledger_posted',v_ok_j,
    'stage', CASE WHEN v_paid >= t.driver_balance_after_cents THEN 'PAID_OUT'
                  WHEN v_pend > 0 THEN 'PAYOUT_IN_PROGRESS' ELSE 'AVAILABLE_TO_DRIVER' END,
    'paid_out_at', CASE WHEN v_paid >= t.driver_balance_after_cents THEN v_last END);
END $function$;

CREATE OR REPLACE FUNCTION private.tip_reconciliation()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public._driver_finance_staff() THEN RAISE EXCEPTION 'NOT_AUTHORISED' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object(
    'tips', (SELECT count(*) FROM trip_tips),
    'total_kes', (SELECT coalesce(sum(amount),0) FROM trip_tips),
    'exceptions', coalesce((SELECT jsonb_agg(jsonb_build_object('tip_id',t.id,'amount',t.amount,'created_at',t.created_at,
        'issue', CASE WHEN t.driver_wallet_txn_id IS NULL THEN 'NOT_CREDITED_TO_DRIVER'
                      WHEN j.id IS NULL THEN 'LEDGER_ENTRY_MISSING'
                      WHEN dt.amount_cents <> round(t.amount*100) THEN 'AMOUNT_MISMATCH' END))
      FROM trip_tips t LEFT JOIN journals j ON j.id=t.journal_id
      LEFT JOIN wallet_transactions dt ON dt.id=t.driver_wallet_txn_id
      WHERE t.driver_wallet_txn_id IS NULL OR j.id IS NULL OR dt.amount_cents <> round(t.amount*100)), '[]'::jsonb));
END $function$;

REVOKE ALL ON FUNCTION private.trip_tip_status(uuid), private.tip_reconciliation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.trip_tip_status(uuid), private.tip_reconciliation() TO authenticated;

CREATE OR REPLACE FUNCTION public.trip_tip_status(_booking_id uuid) RETURNS jsonb
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.trip_tip_status(_booking_id) $$;
CREATE OR REPLACE FUNCTION public.tip_reconciliation() RETURNS jsonb
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.tip_reconciliation() $$;
REVOKE ALL ON FUNCTION public.trip_tip_status(uuid), public.tip_reconciliation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_tip_status(uuid), public.tip_reconciliation() TO authenticated;