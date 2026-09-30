CREATE OR REPLACE FUNCTION public.reverse_payment_journal(_txn_id uuid, _reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _journal uuid := gen_random_uuid();
  _orig uuid;
  _e record;
  _case text;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]), false) THEN
    RAISE EXCEPTION 'Only finance roles may reverse payments';
  END IF;

  -- Fraud hold is authoritative: no role and no flag can lift it here.
  SELECT case_number INTO _case FROM public.payment_fraud_cases
   WHERE payment_ref = _txn_id::text AND status IN ('open','investigating') LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'FRAUD_HOLD: fraud case % is open; resolve it before reversing', _case;
  END IF;

  SELECT DISTINCT journal_id INTO _orig FROM public.journal_lines WHERE transaction_id = _txn_id LIMIT 1;

  INSERT INTO public.journals (id, source, description, reverses_journal_id, created_by)
  VALUES (_journal, 'MPESA_REVERSAL', 'REVERSAL: '||COALESCE(_reason,''), _orig, auth.uid());

  FOR _e IN SELECT * FROM public.journal_lines WHERE transaction_id = _txn_id AND journal_id = _orig LOOP
    INSERT INTO public.journal_lines (journal_id, account_id, direction, amount_cents, currency, transaction_id, memo, posted_by)
    VALUES (_journal, _e.account_id,
            CASE WHEN _e.direction='DEBIT' THEN 'CREDIT'::ledger_direction ELSE 'DEBIT'::ledger_direction END,
            _e.amount_cents, _e.currency, _txn_id,
            'REVERSAL: '||COALESCE(_reason,''), auth.uid());
  END LOOP;

  PERFORM public.posting_engine_post(_journal);
  IF _orig IS NOT NULL THEN
    UPDATE public.journals SET status='REVERSED' WHERE id=_orig;
  END IF;
  UPDATE public.mpesa_transactions SET status='REVERSED' WHERE id=_txn_id;
  PERFORM public.emit_payment_event(_txn_id, 'PAYMENT_REVERSED'::payment_event_type,
    jsonb_build_object('reason',_reason,'journal_id',_journal));
  RETURN _journal;
END $function$;