
-- ============================================================================
-- T4: Payment → Revenue → Tax → Invoice chain
-- ============================================================================

-- 1. Generate next invoice number (simple sequence per year)
CREATE SEQUENCE IF NOT EXISTS public.etims_invoice_seq;

CREATE OR REPLACE FUNCTION public.next_etims_invoice_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _n bigint;
BEGIN
  _n := nextval('public.etims_invoice_seq');
  RETURN 'YR-' || to_char(now(),'YYYY') || '-' || lpad(_n::text, 8, '0');
END $$;

-- 2. Core: create eTIMS invoice from a RECOGNIZED revenue_event
CREATE OR REPLACE FUNCTION public.etims_invoice_from_revenue(
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
END $$;

REVOKE ALL ON FUNCTION public.etims_invoice_from_revenue(uuid,text,text,uuid,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.etims_invoice_from_revenue(uuid,text,text,uuid,text,text,text,text,uuid) TO service_role;

-- 3. Wrapper: from an M-Pesa SUCCESS txn → recognize revenue → invoice
CREATE OR REPLACE FUNCTION public.recognize_revenue_from_payment(
  _txn_id uuid,
  _scheme_code text DEFAULT 'VAT_KE',
  _description text DEFAULT 'Ride service',
  _customer_name text DEFAULT NULL,
  _customer_kra_pin text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _txn record;
  _rev_id uuid := gen_random_uuid();
  _invoice_id uuid;
  _name text;
BEGIN
  SELECT * INTO _txn FROM public.mpesa_transactions WHERE id = _txn_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'M-Pesa txn % not found', _txn_id; END IF;
  IF _txn.status <> 'SUCCESS' THEN
    RAISE EXCEPTION 'Cannot recognize revenue for txn % with status %', _txn_id, _txn.status;
  END IF;
  IF EXISTS (SELECT 1 FROM public.revenue_events WHERE source_ref = _txn_id::text) THEN
    RAISE EXCEPTION 'Revenue already recognized for txn %', _txn_id;
  END IF;

  INSERT INTO public.revenue_events (id, event_type, source_ref, rider_id,
    gross_amount_cents, currency, status, recognized_at, metadata)
  VALUES (_rev_id, 'RIDE_COMPLETED', _txn_id::text, _txn.user_id,
    _txn.amount_cents, _txn.currency, 'RECOGNIZED', now(),
    jsonb_build_object('mpesa_receipt', _txn.mpesa_receipt, 'description', _description));

  SELECT COALESCE(_customer_name, full_name, 'Customer') INTO _name
    FROM public.profiles WHERE user_id = _txn.user_id;

  _invoice_id := public.etims_invoice_from_revenue(
    _rev_id, _scheme_code, _description, _txn.user_id,
    COALESCE(_customer_name, _name, 'Customer'),
    _customer_kra_pin, NULL, _txn.phone, _txn_id);

  PERFORM public.emit_payment_event(_txn_id, 'PAYMENT_SETTLED'::payment_event_type,
    jsonb_build_object('revenue_event_id', _rev_id, 'invoice_id', _invoice_id));

  RETURN _invoice_id;
END $$;

REVOKE ALL ON FUNCTION public.recognize_revenue_from_payment(uuid,text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recognize_revenue_from_payment(uuid,text,text,text,text) TO service_role;

-- 4. Auto-chain inside post_mpesa_settlement when metadata flag is set
CREATE OR REPLACE FUNCTION public.post_mpesa_settlement(_txn_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _txn record;
  _clearing uuid;
  _wallet_acc uuid;
  _journal uuid := gen_random_uuid();
  _flag boolean;
  _scheme text;
  _desc text;
BEGIN
  SELECT * INTO _txn FROM public.mpesa_transactions WHERE id = _txn_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction % not found', _txn_id; END IF;
  IF _txn.status <> 'SUCCESS' THEN RAISE EXCEPTION 'Cannot settle status=%', _txn.status; END IF;
  IF _txn.wallet_id IS NULL THEN RAISE EXCEPTION 'Transaction % has no wallet', _txn_id; END IF;
  IF EXISTS (SELECT 1 FROM public.journal_lines WHERE transaction_id = _txn_id) THEN
    RAISE EXCEPTION 'Transaction % already settled', _txn_id;
  END IF;

  SELECT id INTO _clearing FROM public.ledger_accounts WHERE code = 'MPESA_CLEARING';
  _wallet_acc := public.get_or_create_wallet_account(_txn.wallet_id);

  INSERT INTO public.journals (id, source, reference, description, created_by)
  VALUES (_journal, 'MPESA_SETTLEMENT', _txn.mpesa_receipt,
          'M-Pesa settlement '||COALESCE(_txn.mpesa_receipt,_txn_id::text), auth.uid());

  INSERT INTO public.journal_lines (journal_id, account_id, direction, amount_cents, currency, transaction_id, memo, posted_by) VALUES
    (_journal, _clearing,   'DEBIT',  _txn.amount_cents, _txn.currency, _txn_id, 'DR M-Pesa clearing', auth.uid()),
    (_journal, _wallet_acc, 'CREDIT', _txn.amount_cents, _txn.currency, _txn_id, 'CR wallet',          auth.uid());

  PERFORM public.posting_engine_post(_journal);
  PERFORM public.emit_payment_event(_txn_id, 'PAYMENT_SETTLED'::payment_event_type,
    jsonb_build_object('journal_id', _journal, 'amount_cents', _txn.amount_cents));

  -- Auto-chain revenue recognition when flagged in metadata
  _flag := COALESCE((_txn.metadata->>'recognize_revenue')::boolean, false);
  IF _flag THEN
    _scheme := COALESCE(_txn.metadata->>'tax_scheme_code', 'VAT_KE');
    _desc   := COALESCE(_txn.metadata->>'description', 'Ride service');
    PERFORM public.recognize_revenue_from_payment(
      _txn_id, _scheme, _desc,
      _txn.metadata->>'customer_name',
      _txn.metadata->>'customer_kra_pin');
  END IF;

  RETURN _journal;
END $$;
