-- Available (positive) balance for an organisation, from the append-only cash ledger.
CREATE OR REPLACE FUNCTION public.corporate_wallet_balance_cents(_corporate_id uuid)
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
$$;

REVOKE ALL ON FUNCTION public.corporate_wallet_balance_cents(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corporate_wallet_balance_cents(uuid) TO authenticated;

-- Credit an organisation balance from a CONFIRMED M-Pesa collection.
CREATE OR REPLACE FUNCTION public.corporate_wallet_apply_mpesa(_checkout_request_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _txn public.mpesa_transactions;
  _corporate uuid;
  _balance bigint;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  IF _checkout_request_id IS NULL OR length(trim(_checkout_request_id)) = 0 THEN
    RAISE EXCEPTION 'payment reference required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _txn
    FROM public.mpesa_transactions
   WHERE checkout_request_id = _checkout_request_id
     AND deleted_at IS NULL
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF _txn.id IS NULL THEN
    RAISE EXCEPTION 'payment not found' USING ERRCODE = '02000';
  END IF;
  IF coalesce(_txn.result_code, -1) <> 0 THEN
    RAISE EXCEPTION 'payment is not confirmed yet' USING ERRCODE = '22023';
  END IF;
  IF coalesce(_txn.amount_cents, 0) <= 0 THEN
    RAISE EXCEPTION 'payment carries no amount' USING ERRCODE = '22023';
  END IF;

  -- The organisation comes from the verified payment record, or from the payer's
  -- own employment record. Never from caller-supplied input.
  _corporate := _txn.corporate_id;
  IF _corporate IS NULL THEN
    SELECT corporate_id INTO _corporate
      FROM public.corporate_employees
     WHERE user_id = coalesce(_txn.user_id, _caller)
     ORDER BY (status = 'active') DESC, created_at
     LIMIT 1;
  END IF;
  IF _corporate IS NULL THEN
    RAISE EXCEPTION 'payment is not linked to an organisation' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_corporate_manager_or_admin(_caller, _corporate) THEN
    RAISE EXCEPTION 'not authorised to fund this organisation' USING ERRCODE = '42501';
  END IF;

  -- Idempotent: one credit per confirmed payment.
  IF EXISTS (
    SELECT 1 FROM public.corporate_cash_ledger
     WHERE source_kind = 'mpesa' AND source_id = _txn.id
  ) THEN
    RETURN jsonb_build_object(
      'corporate_id', _corporate,
      'applied', false,
      'reason', 'already_applied',
      'balance_cents', public.corporate_wallet_balance_cents(_corporate)
    );
  END IF;

  _balance := public.corporate_wallet_balance_cents(_corporate);

  INSERT INTO public.corporate_cash_ledger (
    corporate_id, entry_type, amount_cents, balance_after_cents, currency,
    reference, description, source_kind, source_id, occurred_at, created_by, metadata
  ) VALUES (
    _corporate, 'top_up', _txn.amount_cents, _balance + _txn.amount_cents,
    coalesce(_txn.currency, 'KES'),
    coalesce(_txn.mpesa_receipt, _txn.checkout_request_id),
    'M-Pesa top-up', 'mpesa', _txn.id, coalesce(_txn.updated_at, now()), _caller,
    jsonb_build_object('checkout_request_id', _txn.checkout_request_id,
                       'receipt', _txn.mpesa_receipt,
                       'phone_last4', right(coalesce(_txn.phone, ''), 4))
  );

  INSERT INTO public.audit_logs (actor_user_id, actor_role, entity_type, entity_id, action, after_data)
  VALUES (_caller, 'corporate_admin', 'corporate_cash_ledger', _txn.id, 'corporate_wallet_topped_up',
          jsonb_build_object('corporate_id', _corporate, 'amount_cents', _txn.amount_cents));

  RETURN jsonb_build_object(
    'corporate_id', _corporate,
    'applied', true,
    'amount_cents', _txn.amount_cents,
    'receipt', _txn.mpesa_receipt,
    'balance_cents', _balance + _txn.amount_cents
  );
END;
$$;

REVOKE ALL ON FUNCTION public.corporate_wallet_apply_mpesa(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corporate_wallet_apply_mpesa(text) TO authenticated;

-- Settle an invoice from the available organisation balance.
CREATE OR REPLACE FUNCTION public.corporate_invoice_pay_from_balance(_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _inv public.corporate_invoices;
  _balance bigint;
  _apply bigint;
  _paid bigint;
  _outstanding bigint;
  _status corporate_invoice_status;
BEGIN
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _inv FROM public.corporate_invoices WHERE id = _invoice_id FOR UPDATE;
  IF _inv.id IS NULL THEN
    RAISE EXCEPTION 'invoice not found' USING ERRCODE = '02000';
  END IF;
  IF NOT public.is_corporate_manager_or_admin(_caller, _inv.corporate_id) THEN
    RAISE EXCEPTION 'not authorised to settle this invoice' USING ERRCODE = '42501';
  END IF;
  IF _inv.status IN ('VOIDED', 'PAID') THEN
    RAISE EXCEPTION 'invoice is already %', _inv.status USING ERRCODE = '22023';
  END IF;

  _outstanding := greatest(coalesce(_inv.total_cents, 0) - coalesce(_inv.paid_cents, 0), 0);
  IF _outstanding <= 0 THEN
    RAISE EXCEPTION 'invoice has nothing outstanding' USING ERRCODE = '22023';
  END IF;

  _balance := public.corporate_wallet_balance_cents(_inv.corporate_id);
  IF _balance <= 0 THEN
    RAISE EXCEPTION 'no funded balance available — top up first' USING ERRCODE = '22023';
  END IF;

  _apply := least(_balance, _outstanding);
  _paid := coalesce(_inv.paid_cents, 0) + _apply;
  _status := CASE WHEN _paid >= coalesce(_inv.total_cents, 0) THEN 'PAID'::corporate_invoice_status
                  ELSE 'PARTIALLY_PAID'::corporate_invoice_status END;

  UPDATE public.corporate_invoices
     SET paid_cents = _paid,
         balance_cents = greatest(coalesce(total_cents, 0) - _paid, 0),
         status = _status,
         paid_at = CASE WHEN _status = 'PAID' THEN now() ELSE paid_at END,
         updated_at = now()
   WHERE id = _invoice_id;

  INSERT INTO public.audit_logs (actor_user_id, actor_role, entity_type, entity_id, action, after_data)
  VALUES (_caller, 'corporate_admin', 'corporate_invoice', _invoice_id, 'corporate_invoice_settled_from_balance',
          jsonb_build_object('applied_cents', _apply, 'paid_cents', _paid, 'status', _status));

  RETURN jsonb_build_object(
    'invoice_id', _invoice_id,
    'applied_cents', _apply,
    'paid_cents', _paid,
    'outstanding_cents', greatest(coalesce(_inv.total_cents, 0) - _paid, 0),
    'status', _status,
    'balance_cents', public.corporate_wallet_balance_cents(_inv.corporate_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.corporate_invoice_pay_from_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corporate_invoice_pay_from_balance(uuid) TO authenticated;