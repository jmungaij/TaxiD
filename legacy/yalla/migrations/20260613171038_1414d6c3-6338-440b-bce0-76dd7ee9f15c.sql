-- T7: Refunds, voids & credit notes

-- 1) Extend enums
DO $$ BEGIN
  ALTER TYPE public.revenue_event_status ADD VALUE IF NOT EXISTS 'REVERSED';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.mpesa_status ADD VALUE IF NOT EXISTS 'REFUND_PENDING';
EXCEPTION WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE public.payment_event_type ADD VALUE IF NOT EXISTS 'PAYMENT_REFUND_INITIATED';
EXCEPTION WHEN others THEN NULL; END $$;

-- 2) Update mpesa status transition trigger to include refund flow
CREATE OR REPLACE FUNCTION public.enforce_mpesa_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  allowed boolean := false;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;

  IF (OLD.status, NEW.status) IN (
       ('PENDING'::mpesa_status,         'PROCESSING'::mpesa_status),
       ('PENDING'::mpesa_status,         'CANCELLED'::mpesa_status),
       ('PENDING'::mpesa_status,         'FAILED'::mpesa_status),
       ('PROCESSING'::mpesa_status,      'SUCCESS'::mpesa_status),
       ('PROCESSING'::mpesa_status,      'FAILED'::mpesa_status),
       ('PROCESSING'::mpesa_status,      'CANCELLED'::mpesa_status),
       ('SUCCESS'::mpesa_status,         'REVERSED'::mpesa_status),
       ('SUCCESS'::mpesa_status,         'REFUND_PENDING'::mpesa_status),
       ('REFUND_PENDING'::mpesa_status,  'REVERSED'::mpesa_status),
       ('REFUND_PENDING'::mpesa_status,  'SUCCESS'::mpesa_status)
     ) THEN
    allowed := true;
  END IF;

  IF NOT allowed THEN
    RAISE EXCEPTION 'Illegal payment status transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $function$;

-- 3) etims_invoice_void
CREATE OR REPLACE FUNCTION public.etims_invoice_void(_invoice_id uuid, _reason text)
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
END $function$;

-- 4) etims_issue_credit_note
CREATE OR REPLACE FUNCTION public.etims_issue_credit_note(
  _original_invoice_id uuid,
  _reason text,
  _amount_cents bigint DEFAULT NULL  -- NULL = full credit
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _orig record;
  _orig_item record;
  _cn_id uuid := gen_random_uuid();
  _journal_id uuid := gen_random_uuid();
  _ar_account uuid;
  _rev_account uuid;
  _vat_account uuid;
  _gross bigint;
  _net bigint;
  _tax bigint;
  _ratio numeric;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only finance roles may issue credit notes';
  END IF;

  SELECT * INTO _orig FROM public.etims_invoices WHERE id = _original_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original invoice % not found', _original_invoice_id; END IF;
  IF _orig.invoice_type NOT IN ('STANDARD') THEN
    RAISE EXCEPTION 'Can only credit STANDARD invoices (got %)', _orig.invoice_type;
  END IF;
  IF _orig.status IN ('VOIDED') THEN
    RAISE EXCEPTION 'Invoice % is voided; nothing to credit', _original_invoice_id;
  END IF;

  _gross := COALESCE(_amount_cents, _orig.total_cents);
  IF _gross <= 0 OR _gross > _orig.total_cents THEN
    RAISE EXCEPTION 'Credit amount % invalid (original total %)', _gross, _orig.total_cents;
  END IF;
  _ratio := _gross::numeric / _orig.total_cents::numeric;
  _net := round(_orig.subtotal_cents * _ratio);
  _tax := _gross - _net;

  -- Pull first line of the original for description/scheme
  SELECT * INTO _orig_item FROM public.etims_invoice_items
    WHERE invoice_id = _original_invoice_id ORDER BY line_number LIMIT 1;

  SELECT id INTO _ar_account  FROM public.ledger_accounts WHERE coa_code = '1210' LIMIT 1;
  SELECT id INTO _rev_account FROM public.ledger_accounts WHERE coa_code = '4100' LIMIT 1;
  SELECT id INTO _vat_account FROM public.ledger_accounts WHERE coa_code = '2210' LIMIT 1;

  -- Create the credit-note invoice (negative-effect via type, positive amounts)
  INSERT INTO public.etims_invoices (
    id, invoice_number, invoice_type, status,
    revenue_event_id, transaction_id, references_invoice_id,
    customer_user_id, customer_name, customer_kra_pin, customer_email, customer_phone,
    subtotal_cents, tax_total_cents, total_cents, currency, issued_at, metadata
  ) VALUES (
    _cn_id, public.next_etims_invoice_number(), 'CREDIT_NOTE', 'PENDING',
    _orig.revenue_event_id, _orig.transaction_id, _original_invoice_id,
    _orig.customer_user_id, _orig.customer_name, _orig.customer_kra_pin,
    _orig.customer_email, _orig.customer_phone,
    _net, _tax, _gross, _orig.currency, now(),
    jsonb_build_object('reason', _reason,
                       'original_invoice_id', _original_invoice_id,
                       'original_invoice_number', _orig.invoice_number,
                       'is_partial', (_gross < _orig.total_cents),
                       'issued_by', auth.uid())
  );

  INSERT INTO public.etims_invoice_items (
    invoice_id, line_number, description, quantity, unit_price_cents, discount_cents,
    tax_scheme_code, tax_rate_bps, taxable_cents, tax_cents, total_cents
  ) VALUES (
    _cn_id, 1,
    'Credit note for '||_orig.invoice_number||': '||COALESCE(_reason,''),
    1, _net, 0,
    COALESCE(_orig_item.tax_scheme_code,'VAT_KE'),
    COALESCE(_orig_item.tax_rate_bps, 1600),
    _net, _tax, _gross
  );

  -- Reversing journal: DR Revenue / DR VAT / CR Receivable
  INSERT INTO public.journals (id, source, reference, description, reverses_journal_id, created_by)
  VALUES (_journal_id, 'ETIMS_CREDIT_NOTE', _orig.invoice_number,
          'Credit note '||_orig.invoice_number||': '||COALESCE(_reason,''),
          _orig.journal_id, auth.uid());

  INSERT INTO public.journal_lines
    (journal_id, account_id, direction, amount_cents, currency, transaction_id, memo, posted_by) VALUES
    (_journal_id, _rev_account, 'DEBIT',  _net,   _orig.currency, _orig.transaction_id, 'DR Revenue (credit '||_orig.invoice_number||')', auth.uid()),
    (_journal_id, _vat_account, 'DEBIT',  _tax,   _orig.currency, _orig.transaction_id, 'DR VAT Payable', auth.uid()),
    (_journal_id, _ar_account,  'CREDIT', _gross, _orig.currency, _orig.transaction_id, 'CR Receivable',  auth.uid());

  PERFORM public.posting_engine_post(_journal_id);

  UPDATE public.etims_invoices SET journal_id = _journal_id WHERE id = _cn_id;

  -- If full credit, mark original refunded; else leave as-is (partial)
  IF _gross = _orig.total_cents THEN
    UPDATE public.etims_invoices
       SET status = 'REFUNDED',
           metadata = COALESCE(metadata,'{}'::jsonb) ||
                      jsonb_build_object('refunded_by_credit_note', _cn_id,
                                         'refunded_at', now())
     WHERE id = _original_invoice_id;
    IF _orig.revenue_event_id IS NOT NULL THEN
      UPDATE public.revenue_events
         SET status = 'REVERSED',
             metadata = COALESCE(metadata,'{}'::jsonb) ||
                        jsonb_build_object('reversed_by_credit_note', _cn_id,
                                           'reversed_at', now())
       WHERE id = _orig.revenue_event_id;
    END IF;
  END IF;

  INSERT INTO public.etims_sync_events (invoice_id, event_type, request_payload)
    VALUES (_cn_id, 'INVOICE_CREATED',
            jsonb_build_object('credit_note', true,
                               'original_invoice_id', _original_invoice_id,
                               'reason', _reason,
                               'journal_id', _journal_id));

  RETURN _cn_id;
END $function$;

-- 5) refund_mpesa_payment — orchestrator
CREATE OR REPLACE FUNCTION public.refund_mpesa_payment(
  _txn_id uuid,
  _reason text,
  _amount_cents bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _txn record;
  _refund_amount bigint;
  _settlement_reversal uuid;
  _credit_note_id uuid;
  _invoice_id uuid;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Only finance roles may refund payments';
  END IF;

  SELECT * INTO _txn FROM public.mpesa_transactions WHERE id = _txn_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction % not found', _txn_id; END IF;
  IF _txn.status NOT IN ('SUCCESS') THEN
    RAISE EXCEPTION 'Cannot refund txn status=%', _txn.status;
  END IF;

  _refund_amount := COALESCE(_amount_cents, _txn.amount_cents);
  IF _refund_amount <= 0 OR _refund_amount > _txn.amount_cents THEN
    RAISE EXCEPTION 'Refund amount % invalid (txn total %)', _refund_amount, _txn.amount_cents;
  END IF;

  -- 1. Reverse settlement journal (only for full refund — partial leaves wallet alone)
  IF _refund_amount = _txn.amount_cents THEN
    _settlement_reversal := public.reverse_payment_journal(_txn_id, _reason);
  END IF;

  -- 2. Issue credit note against eTIMS invoice if one exists for this txn
  SELECT id INTO _invoice_id FROM public.etims_invoices
   WHERE transaction_id = _txn_id
     AND invoice_type = 'STANDARD'
     AND status NOT IN ('VOIDED','REFUNDED')
   ORDER BY created_at DESC LIMIT 1;

  IF _invoice_id IS NOT NULL THEN
    _credit_note_id := public.etims_issue_credit_note(_invoice_id, _reason, _refund_amount);
  END IF;

  -- 3. Move payment to REFUND_PENDING; mpesa-reverse edge fn will flip to REVERSED on Safaricom ack
  IF _refund_amount = _txn.amount_cents THEN
    UPDATE public.mpesa_transactions
       SET status = 'REFUND_PENDING',
           admin_notes = COALESCE(admin_notes||E'\n','')||
                         'REFUND_INITIATED ('||_refund_amount||' cents): '||COALESCE(_reason,'')
     WHERE id = _txn_id;
  END IF;

  PERFORM public.emit_payment_event(_txn_id, 'PAYMENT_REFUND_INITIATED'::payment_event_type,
    jsonb_build_object('reason', _reason,
                       'refund_amount_cents', _refund_amount,
                       'settlement_reversal_journal', _settlement_reversal,
                       'credit_note_id', _credit_note_id,
                       'original_invoice_id', _invoice_id,
                       'is_partial', (_refund_amount < _txn.amount_cents)));

  RETURN jsonb_build_object(
    'txn_id', _txn_id,
    'refund_amount_cents', _refund_amount,
    'is_partial', (_refund_amount < _txn.amount_cents),
    'settlement_reversal_journal', _settlement_reversal,
    'credit_note_id', _credit_note_id,
    'original_invoice_id', _invoice_id,
    'status', 'REFUND_PENDING'
  );
END $function$;