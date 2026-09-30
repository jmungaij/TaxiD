CREATE TABLE IF NOT EXISTS public._restore_log(fn text primary key, ok boolean, err text, at timestamptz default now());
GRANT ALL ON public._restore_log TO service_role;
GRANT SELECT ON public._restore_log TO authenticated;
ALTER TABLE public._restore_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read restore log" ON public._restore_log;
CREATE POLICY "admins read restore log" ON public._restore_log FOR SELECT TO authenticated USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::public.app_role[]));
DO $do0$ BEGIN EXECUTE $w0q$CREATE OR REPLACE FUNCTION public.is_corporate_member(_user_id uuid, _corporate_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.corporate_employees
    WHERE user_id = _user_id AND corporate_id = _corporate_id AND status = 'active'
  );
$$;$w0q$; INSERT INTO public._restore_log VALUES('is_corporate_member',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('is_corporate_member',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do0$;
DO $do1$ BEGIN EXECUTE $w1q$CREATE OR REPLACE FUNCTION public.is_corporate_manager_or_admin(_user_id uuid, _corporate_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.corporate_employees
    WHERE user_id = _user_id
      AND corporate_id = _corporate_id
      AND status = 'active'
      AND role IN ('corporate_admin','corporate_manager')
  );
$$;$w1q$; INSERT INTO public._restore_log VALUES('is_corporate_manager_or_admin',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('is_corporate_manager_or_admin',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do1$;
DO $do2$ BEGIN EXECUTE $w2q$CREATE OR REPLACE FUNCTION public.driver_payout_create(
  _driver_id uuid,
  _amount_cents bigint,
  _method_id uuid,
  _batch_id uuid DEFAULT NULL,
  _memo text DEFAULT 'Driver payout'
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _payout_id uuid := gen_random_uuid();
  _journal_id uuid := gen_random_uuid();
  _payable uuid;
  _bank uuid;
  _method record;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only finance roles may create payouts';
  END IF;
  IF _amount_cents <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;

  SELECT * INTO _method FROM public.driver_payout_methods WHERE id = _method_id AND driver_id = _driver_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payout method not found for driver'; END IF;

  -- 2110 Driver Payables / 1110 Bank Clearing (create if missing)
  SELECT id INTO _payable FROM public.ledger_accounts WHERE coa_code = '2110' LIMIT 1;
  IF _payable IS NULL THEN
    INSERT INTO public.ledger_accounts (code, name, kind, currency, coa_code)
    VALUES ('DRIVER_PAYABLE','Driver Payables','LIABILITY','KES','2110') RETURNING id INTO _payable;
  END IF;
  SELECT id INTO _bank FROM public.ledger_accounts WHERE coa_code = '1110' LIMIT 1;
  IF _bank IS NULL THEN
    INSERT INTO public.ledger_accounts (code, name, kind, currency, coa_code)
    VALUES ('BANK_CLEARING','Bank/Payout Clearing','ASSET','KES','1110') RETURNING id INTO _bank;
  END IF;

  INSERT INTO public.driver_payouts
    (id, driver_id, method_id, batch_id, amount_cents, currency, status,
     requested_by, approved_by, approved_at, metadata)
  VALUES
    (_payout_id, _driver_id, _method_id, _batch_id, _amount_cents, 'KES', 'QUEUED',
     auth.uid(), auth.uid(), now(),
     jsonb_build_object('memo', _memo));

  INSERT INTO public.journals (id, source, reference, description, created_by)
  VALUES (_journal_id, 'DRIVER_PAYOUT', _payout_id::text, _memo, auth.uid());

  INSERT INTO public.journal_lines
    (journal_id, account_id, direction, amount_cents, currency, memo, posted_by) VALUES
    (_journal_id, _payable, 'DEBIT',  _amount_cents, 'KES', 'DR Driver payable (payout '||_payout_id||')', auth.uid()),
    (_journal_id, _bank,    'CREDIT', _amount_cents, 'KES', 'CR Bank clearing',                            auth.uid());

  PERFORM public.posting_engine_post(_journal_id);

  UPDATE public.driver_payouts SET journal_id = _journal_id WHERE id = _payout_id;

  IF _batch_id IS NOT NULL THEN
    UPDATE public.driver_payout_batches
       SET total_count = total_count + 1,
           total_amount_cents = total_amount_cents + _amount_cents
     WHERE id = _batch_id;
  END IF;

  RETURN _payout_id;
END $$;$w2q$; INSERT INTO public._restore_log VALUES('driver_payout_create',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('driver_payout_create',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do2$;
DO $do3$ BEGIN EXECUTE $w3q$CREATE OR REPLACE FUNCTION public.next_driver_payout_batch_number()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _n bigint;
BEGIN
  _n := nextval('public.driver_payout_batch_seq');
  RETURN 'DPB-' || to_char(now(),'YYYYMMDD') || '-' || lpad(_n::text, 5, '0');
END $$;$w3q$; INSERT INTO public._restore_log VALUES('next_driver_payout_batch_number',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('next_driver_payout_batch_number',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do3$;
DO $do4$ BEGIN EXECUTE $w4q$CREATE OR REPLACE FUNCTION public.tax_engine_calculate(
  _scheme_code text,
  _source_kind text,
  _source_id uuid,
  _amount_cents bigint,
  _currency text DEFAULT 'KES',
  _subject_user_id uuid DEFAULT NULL,
  _on_date date DEFAULT CURRENT_DATE,
  _inputs jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  _scheme record;
  _rate record;
  _tax_cents bigint;
  _total_cents bigint;
  _calc_id uuid := gen_random_uuid();
  _exempt boolean := false;
BEGIN
  SELECT * INTO _scheme FROM public.tax_schemes WHERE code = _scheme_code AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tax scheme % not found or inactive', _scheme_code; END IF;

  -- Check active exemption
  IF _subject_user_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.tax_exemptions
      WHERE scheme_id = _scheme.id
        AND subject_kind = 'user'
        AND subject_id = _subject_user_id
        AND active = true
        AND effective_from <= _on_date
        AND (effective_to IS NULL OR effective_to >= _on_date)
    ) INTO _exempt;
  END IF;

  IF _exempt OR _scheme.kind IN ('EXEMPT','ZERO_RATED') THEN
    INSERT INTO public.tax_calculations
      (id, scheme_id, rate_id, source_kind, source_id, subject_user_id,
       amount_cents, tax_cents, total_cents, currency, inputs, rate_snapshot, calculated_by)
    SELECT _calc_id, _scheme.id, tr.id, _source_kind, _source_id, _subject_user_id,
           _amount_cents, 0, _amount_cents, _currency, _inputs,
           jsonb_build_object('exempt', true, 'reason', _scheme.kind), auth.uid()
    FROM public.tax_rates tr
    WHERE tr.scheme_id = _scheme.id
    ORDER BY tr.effective_from DESC LIMIT 1;
    RETURN _calc_id;
  END IF;

  -- Pick the rate effective on _on_date
  SELECT * INTO _rate FROM public.tax_rates
   WHERE scheme_id = _scheme.id
     AND jurisdiction = _scheme.jurisdiction
     AND effective_from <= _on_date
     AND (effective_to IS NULL OR effective_to >= _on_date)
   ORDER BY effective_from DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No tax rate for scheme % on %', _scheme_code, _on_date;
  END IF;

  -- VAT / DST / Corporate: tax = base * rate
  -- Withholding: tax = base * rate, total = base - tax (subtracted from payout)
  _tax_cents := (_amount_cents * _rate.rate_bps) / 10000;
  IF _scheme.kind = 'WITHHOLDING' THEN
    _total_cents := _amount_cents - _tax_cents;
  ELSE
    _total_cents := _amount_cents + _tax_cents;
  END IF;

  INSERT INTO public.tax_calculations
    (id, scheme_id, rate_id, source_kind, source_id, subject_user_id,
     amount_cents, tax_cents, total_cents, currency, inputs, rate_snapshot, calculated_by)
  VALUES
    (_calc_id, _scheme.id, _rate.id, _source_kind, _source_id, _subject_user_id,
     _amount_cents, _tax_cents, _total_cents, _currency, _inputs,
     to_jsonb(_rate), auth.uid());

  -- Audit
  INSERT INTO public.tax_audit_logs (entity_kind, entity_id, event_type, new_value, actor_id, actor_type)
  VALUES ('tax_calculations', _calc_id, 'CALCULATION',
          jsonb_build_object('scheme', _scheme_code, 'amount_cents', _amount_cents, 'tax_cents', _tax_cents),
          auth.uid(),
          CASE WHEN auth.uid() IS NULL THEN 'service' ELSE 'user' END);

  RETURN _calc_id;
END $$;$w4q$; INSERT INTO public._restore_log VALUES('tax_engine_calculate',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('tax_engine_calculate',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do4$;
DO $do5$ BEGIN EXECUTE $w5q$CREATE OR REPLACE FUNCTION public.etims_invoice_from_revenue(
  _revenue_event_id uuid,
  _scheme_code text DEFAULT 'VAT_KE',
  _description text DEFAULT 'Ride service',
  _customer_user_id uuid DEFAULT NULL,
  _customer_name text DEFAULT NULL,
  _customer_kra_pin text DEFAULT NULL,
  _customer_email text DEFAULT NULL,
  _customer_phone text DEFAULT NULL,
  _mpesa_txn_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rev record;
  _calc record;
  _scheme record;
  _rate record;
  _invoice_id uuid := gen_random_uuid();
  _journal_id uuid := gen_random_uuid();
  _ar_account uuid;
  _rev_account uuid;
  _vat_account uuid;
  _net_cents bigint;
  _tax_cents bigint;
  _gross_cents bigint;
BEGIN
  -- Gate: revenue event must exist and be RECOGNIZED
  SELECT * INTO _rev FROM public.revenue_events WHERE id = _revenue_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Revenue event % not found', _revenue_event_id; END IF;
  IF _rev.status <> 'RECOGNIZED' THEN
    RAISE EXCEPTION 'Revenue event % is not RECOGNIZED (status=%)', _revenue_event_id, _rev.status;
  END IF;
  IF _rev.journal_id IS NOT NULL THEN
    RAISE EXCEPTION 'Revenue event % already has journal %', _revenue_event_id, _rev.journal_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.etims_invoices WHERE revenue_event_id = _revenue_event_id) THEN
    RAISE EXCEPTION 'Revenue event % already has an eTIMS invoice', _revenue_event_id;
  END IF;

  -- Lookup scheme + effective rate
  SELECT * INTO _scheme FROM public.tax_schemes WHERE code = _scheme_code AND active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tax scheme % not found', _scheme_code; END IF;
  SELECT * INTO _rate FROM public.tax_rates
    WHERE scheme_id = _scheme.id
      AND effective_from <= CURRENT_DATE
      AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
    ORDER BY effective_from DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'No effective tax rate for %', _scheme_code; END IF;

  -- Gross-to-net for VAT-inclusive pricing (Kenya: prices include 16% VAT)
  _gross_cents := _rev.gross_amount_cents;
  _net_cents   := (_gross_cents * 10000) / (10000 + _rate.rate_bps);
  _tax_cents   := _gross_cents - _net_cents;

  -- Resolve postable accounts
  SELECT id INTO _ar_account  FROM public.ledger_accounts WHERE coa_code = '1210' LIMIT 1;
  IF _ar_account IS NULL THEN
    INSERT INTO public.ledger_accounts (code, name, kind, currency, coa_code)
      VALUES ('AR_CORP','Corporate Receivables','RECEIVABLE',_rev.currency,'1210') RETURNING id INTO _ar_account;
  END IF;
  SELECT id INTO _rev_account FROM public.ledger_accounts WHERE coa_code = '4100' LIMIT 1;
  IF _rev_account IS NULL THEN
    INSERT INTO public.ledger_accounts (code, name, kind, currency, coa_code)
      VALUES ('REV_RIDE','Ride Revenue','REVENUE',_rev.currency,'4100') RETURNING id INTO _rev_account;
  END IF;
  SELECT id INTO _vat_account FROM public.ledger_accounts WHERE coa_code = '2210' LIMIT 1;
  IF _vat_account IS NULL THEN
    INSERT INTO public.ledger_accounts (code, name, kind, currency, coa_code)
      VALUES ('VAT_PAYABLE','VAT Payable','LIABILITY',_rev.currency,'2210') RETURNING id INTO _vat_account;
  END IF;

  -- Tax calculation audit row
  PERFORM public.tax_engine_calculate(
    _scheme_code, 'revenue_event', _revenue_event_id, _net_cents, _rev.currency,
    _customer_user_id, CURRENT_DATE,
    jsonb_build_object('gross_cents', _gross_cents, 'description', _description)
  );

  -- Create the invoice
  INSERT INTO public.etims_invoices (
    id, invoice_number, invoice_type, status, revenue_event_id, transaction_id,
    customer_user_id, customer_name, customer_kra_pin, customer_email, customer_phone,
    subtotal_cents, tax_total_cents, total_cents, currency, issued_at
  ) VALUES (
    _invoice_id, public.next_etims_invoice_number(), 'STANDARD', 'PENDING',
    _revenue_event_id, _mpesa_txn_id,
    _customer_user_id,
    COALESCE(_customer_name, 'Customer'),
    _customer_kra_pin, _customer_email, _customer_phone,
    _net_cents, _tax_cents, _gross_cents, _rev.currency, now()
  );

  INSERT INTO public.etims_invoice_items (
    invoice_id, line_number, description, quantity, unit_price_cents, discount_cents,
    tax_scheme_code, tax_rate_bps, taxable_cents, tax_cents, total_cents
  ) VALUES (
    _invoice_id, 1, _description, 1, _net_cents, 0,
    _scheme_code, _rate.rate_bps, _net_cents, _tax_cents, _gross_cents
  );

  -- Post the revenue journal: DR Receivable / CR Revenue / CR VAT Payable
  INSERT INTO public.journals (id, source, reference, description, created_by)
    VALUES (_journal_id, 'REVENUE_RECOGNITION', _revenue_event_id::text,
            'Revenue recognition: '||_description, auth.uid());

  INSERT INTO public.journal_lines (journal_id, account_id, direction, amount_cents, currency, transaction_id, memo, posted_by) VALUES
    (_journal_id, _ar_account,  'DEBIT',  _gross_cents, _rev.currency, _mpesa_txn_id, 'DR Receivable (invoice '||_invoice_id||')', auth.uid()),
    (_journal_id, _rev_account, 'CREDIT', _net_cents,   _rev.currency, _mpesa_txn_id, 'CR Revenue', auth.uid()),
    (_journal_id, _vat_account, 'CREDIT', _tax_cents,   _rev.currency, _mpesa_txn_id, 'CR VAT Payable', auth.uid());

  PERFORM public.posting_engine_post(_journal_id);

  -- Link invoice + revenue_event to journal
  UPDATE public.etims_invoices SET journal_id = _journal_id WHERE id = _invoice_id;
  UPDATE public.revenue_events SET journal_id = _journal_id WHERE id = _revenue_event_id;

  INSERT INTO public.etims_sync_events (invoice_id, event_type, request_payload)
    VALUES (_invoice_id, 'INVOICE_CREATED',
            jsonb_build_object('revenue_event_id', _revenue_event_id, 'journal_id', _journal_id,
                               'net_cents', _net_cents, 'tax_cents', _tax_cents));

  RETURN _invoice_id;
END $$;$w5q$; INSERT INTO public._restore_log VALUES('etims_invoice_from_revenue',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('etims_invoice_from_revenue',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do5$;
DO $do6$ BEGIN EXECUTE $w6q$CREATE OR REPLACE FUNCTION public.next_etims_invoice_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n bigint;
BEGIN
  _n := nextval('public.etims_invoice_seq');
  RETURN 'YR-' || to_char(now(),'YYYY') || '-' || lpad(_n::text, 8, '0');
END $$;$w6q$; INSERT INTO public._restore_log VALUES('next_etims_invoice_number',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('next_etims_invoice_number',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do6$;
DO $do7$ BEGIN EXECUTE $w7q$CREATE OR REPLACE FUNCTION public.posting_engine_post(_journal_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _j record;
  _bad int;
  _line_count int;
BEGIN
  SELECT * INTO _j FROM public.journals WHERE id = _journal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Journal % not found', _journal_id; END IF;
  IF _j.status <> 'DRAFT' THEN RAISE EXCEPTION 'Journal % is not DRAFT (status=%)', _journal_id, _j.status; END IF;

  SELECT count(*) INTO _line_count FROM public.journal_lines WHERE journal_id = _journal_id;
  IF _line_count < 2 THEN
    INSERT INTO public.posting_errors (journal_id, error_code, error_message)
      VALUES (_journal_id, 'INSUFFICIENT_LINES', 'Journal must contain at least 2 lines');
    RAISE EXCEPTION 'Journal % must contain at least 2 lines', _journal_id;
  END IF;

  SELECT count(*) INTO _bad
  FROM public.journal_lines e
  JOIN public.ledger_accounts a ON a.id = e.account_id
  LEFT JOIN public.chart_of_accounts c ON c.code = a.coa_code
  WHERE e.journal_id = _journal_id
    AND (
      a.active IS DISTINCT FROM true
      OR a.coa_code IS NULL
      OR c.is_postable = false
      OR c.active = false
    );
  IF _bad > 0 THEN
    INSERT INTO public.posting_errors (journal_id, error_code, error_message)
      VALUES (_journal_id, 'INVALID_ACCOUNT', format('%s invalid/non-postable accounts', _bad));
    RAISE EXCEPTION 'Journal % references invalid/non-postable accounts', _journal_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT currency,
             sum(CASE WHEN direction='DEBIT'  THEN amount_cents ELSE 0 END) dr,
             sum(CASE WHEN direction='CREDIT' THEN amount_cents ELSE 0 END) cr
      FROM public.journal_lines WHERE journal_id = _journal_id GROUP BY currency
    ) g WHERE dr <> cr
  ) THEN
    INSERT INTO public.posting_errors (journal_id, error_code, error_message)
      VALUES (_journal_id, 'UNBALANCED', 'Debits do not equal credits per currency');
    RAISE EXCEPTION 'Journal % is unbalanced', _journal_id;
  END IF;

  UPDATE public.journals
     SET status='POSTED', posted_at=now(), posted_by=auth.uid()
   WHERE id = _journal_id;

  INSERT INTO public.posting_events (journal_id, event_type, payload, actor_id)
    VALUES (_journal_id, 'POSTED', jsonb_build_object('lines', _line_count), auth.uid());

  RETURN _journal_id;
END $function$;$w7q$; INSERT INTO public._restore_log VALUES('posting_engine_post',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('posting_engine_post',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do7$;
DO $do8$ BEGIN EXECUTE $w8q$CREATE OR REPLACE FUNCTION public.etims_invoice_void(_invoice_id uuid, _reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _inv record;
  _rev_journal uuid := gen_random_uuid();
  _orig_journal uuid;
  _e record;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only finance roles may void eTIMS invoices';
  END IF;

  SELECT * INTO _inv FROM public.etims_invoices WHERE id = _invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice % not found', _invoice_id; END IF;
  IF _inv.status IN ('VOIDED','REFUNDED') THEN
    RAISE EXCEPTION 'Invoice % already %', _invoice_id, _inv.status;
  END IF;
  IF _inv.invoice_type = 'CREDIT_NOTE' THEN
    RAISE EXCEPTION 'Cannot void a credit note; issue a debit note instead';
  END IF;

  _orig_journal := _inv.journal_id;

  -- Reverse the original journal
  IF _orig_journal IS NOT NULL THEN
    INSERT INTO public.journals (id, source, reference, description, reverses_journal_id, created_by)
    VALUES (_rev_journal, 'ETIMS_VOID', _inv.invoice_number,
            'VOID '||_inv.invoice_number||': '||COALESCE(_reason,''), _orig_journal, auth.uid());

    FOR _e IN SELECT * FROM public.journal_lines WHERE journal_id = _orig_journal LOOP
      INSERT INTO public.journal_lines
        (journal_id, account_id, direction, amount_cents, currency, transaction_id, memo, posted_by)
      VALUES (_rev_journal, _e.account_id,
              CASE WHEN _e.direction='DEBIT' THEN 'CREDIT'::ledger_direction ELSE 'DEBIT'::ledger_direction END,
              _e.amount_cents, _e.currency, _e.transaction_id,
              'VOID '||_inv.invoice_number, auth.uid());
    END LOOP;

    PERFORM public.posting_engine_post(_rev_journal);
    UPDATE public.journals SET status='REVERSED' WHERE id=_orig_journal;
  END IF;

  UPDATE public.etims_invoices
     SET status = 'VOIDED',
         metadata = COALESCE(metadata,'{}'::jsonb) ||
                    jsonb_build_object('void_reason', _reason,
                                       'voided_at', now(),
                                       'voided_by', auth.uid(),
                                       'reversing_journal_id', _rev_journal)
   WHERE id = _invoice_id;

  IF _inv.revenue_event_id IS NOT NULL THEN
    UPDATE public.revenue_events
       SET status = 'REVERSED',
           metadata = COALESCE(metadata,'{}'::jsonb) ||
                      jsonb_build_object('reversed_by_void', _invoice_id,
                                         'reversed_at', now())
     WHERE id = _inv.revenue_event_id;
  END IF;

  INSERT INTO public.etims_sync_events (invoice_id, event_type, request_payload)
    VALUES (_invoice_id, 'INVOICE_VOIDED',
            jsonb_build_object('reason', _reason,
                               'reversing_journal_id', _rev_journal,
                               'voided_by', auth.uid()));

  RETURN _rev_journal;
END $function$;$w8q$; INSERT INTO public._restore_log VALUES('etims_invoice_void',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('etims_invoice_void',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do8$;
DO $do9$ BEGIN EXECUTE $w9q$CREATE OR REPLACE FUNCTION public._fin_apply_verified(_booking uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_amount numeric; v_paid numeric; v_status text;
BEGIN
  SELECT amount, payment_status INTO v_amount, v_status FROM public.charter_bookings WHERE id = _booking;
  IF NOT FOUND OR v_amount IS NULL THEN RETURN; END IF;
  IF lower(coalesce(v_status,'')) IN ('paid','settled','completed') THEN RETURN; END IF;
  SELECT coalesce(sum(amount),0) INTO v_paid FROM public.fin_payment_reports WHERE charter_booking_id = _booking AND status = 'verified';
  IF v_paid >= v_amount THEN
    UPDATE public.charter_bookings SET payment_status = 'paid', paid_at = coalesce(paid_at, now()) WHERE id = _booking;
  END IF;
END $$;$w9q$; INSERT INTO public._restore_log VALUES('_fin_apply_verified',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('_fin_apply_verified',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do9$;
DO $do10$ BEGIN EXECUTE $w10q$CREATE OR REPLACE FUNCTION public.fin_record_mpesa(_booking_ref text, _amount numeric, _receipt text, _verified boolean, _payer text)
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
END $$;$w10q$; INSERT INTO public._restore_log VALUES('fin_record_mpesa',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('fin_record_mpesa',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do10$;
DO $do11$ BEGIN EXECUTE $w11q$CREATE OR REPLACE FUNCTION public.fin_ledger_post(
  _kind public.fin_ledger_entry_kind,
  _legs jsonb,
  _corporate_id uuid,
  _intent_id uuid,
  _reference text,
  _memo text,
  _correlation_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_group uuid := gen_random_uuid();
  v_debit bigint := 0;
  v_credit bigint := 0;
  v_leg jsonb;
BEGIN
  IF _legs IS NULL OR jsonb_array_length(_legs) < 2 THEN
    RAISE EXCEPTION 'a ledger entry needs at least two legs';
  END IF;
  FOR v_leg IN SELECT jsonb_array_elements(_legs) LOOP
    v_debit := v_debit + COALESCE((v_leg->>'debit_cents')::bigint, 0);
    v_credit := v_credit + COALESCE((v_leg->>'credit_cents')::bigint, 0);
  END LOOP;
  IF v_debit <> v_credit THEN
    RAISE EXCEPTION 'ledger entry is unbalanced: debits % credits %', v_debit, v_credit;
  END IF;

  INSERT INTO public.fin_ledger_entries
    (entry_group, kind, account_code, account_name, debit_cents, credit_cents,
     currency, corporate_id, intent_id, reference, memo, correlation_id, created_by)
  SELECT v_group, _kind, l->>'account_code', l->>'account_name',
         COALESCE((l->>'debit_cents')::bigint, 0), COALESCE((l->>'credit_cents')::bigint, 0),
         COALESCE(l->>'currency', 'KES'), _corporate_id, _intent_id, _reference, _memo, _correlation_id, auth.uid()
    FROM jsonb_array_elements(_legs) l;

  RETURN v_group;
END $$;$w11q$; INSERT INTO public._restore_log VALUES('fin_ledger_post',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('fin_ledger_post',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do11$;
DO $do12$ BEGIN EXECUTE $w12q$CREATE OR REPLACE FUNCTION public.comms_my_staff_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.staff_members WHERE user_id = auth.uid() LIMIT 1;
$$;$w12q$; INSERT INTO public._restore_log VALUES('comms_my_staff_id',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('comms_my_staff_id',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do12$;
DO $do13$ BEGIN EXECUTE $w13q$CREATE OR REPLACE FUNCTION public.comms_is_unified_reader()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.comms_unified_readers r
    WHERE r.staff_id = public.comms_my_staff_id()
  );
$$;$w13q$; INSERT INTO public._restore_log VALUES('comms_is_unified_reader',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('comms_is_unified_reader',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do13$;
DO $do14$ BEGIN EXECUTE $w14q$CREATE OR REPLACE FUNCTION public._fin_is_team() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    coalesce(public.has_role(auth.uid(),'admin'),false) OR coalesce(public.has_role(auth.uid(),'super_admin'),false)
    OR coalesce(public.has_role(auth.uid(),'finance_admin'),false) OR coalesce(public.comms_is_unified_reader(),false));
$$;$w14q$; INSERT INTO public._restore_log VALUES('_fin_is_team',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('_fin_is_team',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do14$;
DO $do15$ BEGIN EXECUTE $w15q$CREATE OR REPLACE FUNCTION public._fin_is_verifier() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    coalesce(public.has_role(auth.uid(),'admin'),false) OR coalesce(public.has_role(auth.uid(),'super_admin'),false)
    OR coalesce(public.has_role(auth.uid(),'finance_admin'),false));
$$;$w15q$; INSERT INTO public._restore_log VALUES('_fin_is_verifier',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('_fin_is_verifier',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do15$;
DO $do16$ BEGIN EXECUTE $w16q$CREATE OR REPLACE FUNCTION public.fin_dashboard(_from date, _to date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT COALESCE(public._fin_is_team(), false) THEN RETURN jsonb_build_object('ok',false,'error','NOT_PERMITTED'); END IF;
  SELECT jsonb_build_object('ok', true, 'can_verify', public._fin_is_verifier(), 'me', auth.uid(),
    'reports', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.paid_on DESC, r.created_at DESC) FROM public.fin_payment_reports r
        WHERE r.paid_on BETWEEN _from AND _to OR r.status = 'reported'), '[]'::jsonb),
    'emails', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'subject', m.subject, 'direction', m.direction, 'from', m.from_address,
        'to', m.to_addresses, 'at', m.occurred_at, 'source', m.source) ORDER BY m.occurred_at DESC)
        FROM public.comms_messages m JOIN public.comms_accounts ac ON ac.id = m.account_id
        WHERE lower(ac.mailbox_address) = 'finance@yalla.africa' AND (m.occurred_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN _from AND _to), '[]'::jsonb),
    'billed', (SELECT coalesce(sum(amount),0) FROM public.charter_bookings WHERE (created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN _from AND _to),
    'driver', (SELECT jsonb_build_object(
        'income', coalesce(sum(amount) FILTER (WHERE kind='income' AND verification_status='verified'),0),
        'expense', coalesce(sum(amount) FILTER (WHERE kind='expense' AND verification_status='verified'),0),
        'pending_income', coalesce(sum(amount) FILTER (WHERE kind='income' AND verification_status='pending'),0),
        'pending_expense', coalesce(sum(amount) FILTER (WHERE kind='expense' AND verification_status='pending'),0),
        'entries', count(*), 'pending', count(*) FILTER (WHERE verification_status='pending'))
        FROM public.driver_self_reports WHERE audience='driver' AND entry_date BETWEEN _from AND _to),
    'rider', (SELECT jsonb_build_object(
        'income', coalesce(sum(amount) FILTER (WHERE kind='income' AND verification_status='verified'),0),
        'expense', coalesce(sum(amount) FILTER (WHERE kind='expense' AND verification_status='verified'),0),
        'pending_income', coalesce(sum(amount) FILTER (WHERE kind='income' AND verification_status='pending'),0),
        'pending_expense', coalesce(sum(amount) FILTER (WHERE kind='expense' AND verification_status='pending'),0),
        'entries', count(*), 'pending', count(*) FILTER (WHERE verification_status='pending'))
        FROM public.driver_self_reports WHERE audience='rider' AND entry_date BETWEEN _from AND _to),
    'log_queue', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'user_id', s.user_id, 'audience', s.audience, 'kind', s.kind,
        'category', s.category, 'amount', s.amount, 'entry_date', s.entry_date, 'note', s.note,
        'name', coalesce(p.full_name, 'NOT STATED')) ORDER BY s.entry_date DESC)
        FROM public.driver_self_reports s LEFT JOIN public.profiles p ON p.user_id = s.user_id
        WHERE s.verification_status = 'pending'), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $$;$w16q$; INSERT INTO public._restore_log VALUES('fin_dashboard',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('fin_dashboard',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do16$;
DO $do17$ BEGIN EXECUTE $w17q$CREATE OR REPLACE FUNCTION public._fin_post_finance_record(_to text, _subject text, _body text, _meta jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_acc uuid; v_thread uuid;
BEGIN
  SELECT id INTO v_acc FROM public.comms_accounts WHERE lower(mailbox_address) = 'finance@yalla.africa' LIMIT 1;
  IF v_acc IS NULL OR _to IS NULL THEN RETURN; END IF;
  SELECT id INTO v_thread FROM public.comms_threads WHERE account_id = v_acc AND subject = _subject AND lower(counterparty_email) = lower(_to) LIMIT 1;
  IF v_thread IS NULL THEN
    INSERT INTO public.comms_threads(account_id, subject, counterparty_email, counterparty_name, message_count, outbound_count, last_direction)
      VALUES (v_acc, _subject, lower(_to), NULL, 0, 0, 'outbound') RETURNING id INTO v_thread;
  END IF;
  INSERT INTO public.comms_messages(thread_id, account_id, direction, source, from_address, from_name, to_addresses, subject, body_preview, delivery_status, metadata)
    VALUES (v_thread, v_acc, 'outbound', 'finance_ledger', 'finance@yalla.africa', 'Yalla Finance', ARRAY[lower(_to)], _subject, left(_body, 2000), 'recorded', _meta);
  UPDATE public.comms_threads SET message_count = message_count + 1, outbound_count = outbound_count + 1,
    last_activity_at = now(), last_direction = 'outbound' WHERE id = v_thread;
END $$;$w17q$; INSERT INTO public._restore_log VALUES('_fin_post_finance_record',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('_fin_post_finance_record',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do17$;
DO $do18$ BEGIN EXECUTE $w18q$CREATE OR REPLACE FUNCTION public.fin_pay_booking_from_wallet(_booking_ref text, _amount numeric)
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
END $function$;$w18q$; INSERT INTO public._restore_log VALUES('fin_pay_booking_from_wallet',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('fin_pay_booking_from_wallet',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do18$;
DO $do19$ BEGIN EXECUTE $w19q$CREATE OR REPLACE FUNCTION public.yp_audit(_action text, _entity text, _entity_id uuid, _after jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.audit_logs (actor_user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), _entity, _entity_id, _action, _after);
END $$;$w19q$; INSERT INTO public._restore_log VALUES('yp_audit',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('yp_audit',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do19$;
DO $do20$ BEGIN EXECUTE $w20q$CREATE OR REPLACE FUNCTION public.partner_ledger_post(
  _partner_id uuid, _kind public.partner_ledger_kind, _direction public.ledger_direction,
  _amount numeric, _memo text, _order_id uuid DEFAULT NULL, _settlement_id uuid DEFAULT NULL,
  _reference text DEFAULT NULL, _idempotency_key text DEFAULT NULL, _move_balance boolean DEFAULT true
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  w public.partner_wallets%ROWTYPE;
  new_balance numeric;
  entry_id uuid;
BEGIN
  IF _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT id INTO entry_id FROM public.partner_ledger_entries WHERE idempotency_key = _idempotency_key;
    IF entry_id IS NOT NULL THEN RETURN entry_id; END IF;
  END IF;

  SELECT * INTO w FROM public.partner_wallets WHERE partner_id = _partner_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.partner_wallets (partner_id) VALUES (_partner_id) RETURNING * INTO w;
  END IF;

  new_balance := w.balance;
  IF _move_balance THEN
    new_balance := w.balance + CASE WHEN _direction = 'CREDIT' THEN _amount ELSE -_amount END;
    IF new_balance + w.credit_limit < 0 THEN
      RAISE EXCEPTION 'insufficient_wallet_balance: available %, required %', w.balance + w.credit_limit, _amount;
    END IF;
    UPDATE public.partner_wallets SET balance = new_balance WHERE id = w.id;
  END IF;

  INSERT INTO public.partner_ledger_entries
    (partner_id, wallet_id, order_id, settlement_id, entry_kind, direction, amount, currency,
     balance_after, memo, reference, idempotency_key, created_by)
  VALUES (_partner_id, w.id, _order_id, _settlement_id, _kind, _direction, _amount, w.currency,
     new_balance, _memo, _reference, _idempotency_key, auth.uid())
  RETURNING id INTO entry_id;

  RETURN entry_id;
END $$;$w20q$; INSERT INTO public._restore_log VALUES('partner_ledger_post',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('partner_ledger_post',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do20$;
DO $do21$ BEGIN EXECUTE $w21q$CREATE OR REPLACE FUNCTION public.yp_is_finance()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin','director']::app_role[]);
$$;$w21q$; INSERT INTO public._restore_log VALUES('yp_is_finance',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('yp_is_finance',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do21$;
DO $do22$ BEGIN EXECUTE $w22q$CREATE OR REPLACE FUNCTION public.partner_wallet_topup(
  _partner_id uuid, _amount numeric, _reference text, _memo text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE eid uuid;
BEGIN
  IF NOT public.yp_is_finance() THEN RAISE EXCEPTION 'not_authorised: finance role required'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF COALESCE(btrim(_reference),'') = '' THEN RAISE EXCEPTION 'reference_required'; END IF;

  eid := public.partner_ledger_post(_partner_id, 'wallet_topup', 'CREDIT', _amount,
    COALESCE(_memo, 'Wallet top-up'), NULL, NULL, _reference, 'topup:' || _reference);
  PERFORM public.yp_audit('partner_wallet_topup', 'partner_wallets', _partner_id,
    jsonb_build_object('amount', _amount, 'reference', _reference));
  RETURN eid;
END $$;$w22q$; INSERT INTO public._restore_log VALUES('partner_wallet_topup',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('partner_wallet_topup',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do22$;
DO $do23$ BEGIN EXECUTE $w23q$CREATE OR REPLACE FUNCTION public.corporate_wallet_balance_cents(_corporate_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce((
    SELECT balance_after_cents
      FROM public.corporate_cash_ledger
     WHERE corporate_id = _corporate_id
     ORDER BY occurred_at DESC, created_at DESC
     LIMIT 1
  ), 0);
$$;$w23q$; INSERT INTO public._restore_log VALUES('corporate_wallet_balance_cents',true,null) ON CONFLICT (fn) DO UPDATE SET ok=true,err=null; EXCEPTION WHEN others THEN INSERT INTO public._restore_log VALUES('corporate_wallet_balance_cents',false,SQLERRM) ON CONFLICT (fn) DO UPDATE SET ok=false,err=excluded.err; END $do23$;
DO $g$ DECLARE r record; BEGIN FOR r IN SELECT p.oid::regprocedure sig, p.proname FROM pg_proc p JOIN public._restore_log l ON l.fn=p.proname AND l.ok WHERE p.pronamespace='public'::regnamespace LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig); EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig); IF r.proname ~ '^(_|yp_|posting_engine|partner_ledger_post|fin_ledger_post|tax_engine|comms_)' THEN EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.sig); ELSE EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig); END IF; END LOOP; END $g$;
