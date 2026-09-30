
-- Extend the existing immutable-fields trigger to honour a request-scoped
-- bypass flag set by public.sync_mpesa_transactions_projection only.
CREATE OR REPLACE FUNCTION public.enforce_mpesa_user_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Service role always bypasses.
  IF current_setting('role', true) IN ('service_role') THEN
    RETURN NEW;
  END IF;

  -- Projection sync bypass — set only by sync_mpesa_transactions_projection
  -- for the duration of that single call.
  IF current_setting('app.payment_projection_sync', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RETURN NEW;
  END IF;

  IF NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.mpesa_receipt IS DISTINCT FROM OLD.mpesa_receipt
     OR NEW.transaction_reference IS DISTINCT FROM OLD.transaction_reference
     OR NEW.provider_transaction_id IS DISTINCT FROM OLD.provider_transaction_id
     OR NEW.callback_reference IS DISTINCT FROM OLD.callback_reference
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.wallet_id IS DISTINCT FROM OLD.wallet_id
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
  THEN
    RAISE EXCEPTION 'Users may only update metadata fields on payment records';
  END IF;

  RETURN NEW;
END;
$$;

-- Set the bypass flag inside the sync function.
CREATE OR REPLACE FUNCTION public.sync_mpesa_transactions_projection(_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  a public.payment_attempts%ROWTYPE;
  cur_status  public.mpesa_status;
  target      public.mpesa_status;
  rows_updated int := 0;
  legal_final  boolean;
BEGIN
  PERFORM set_config('app.payment_projection_sync', 'on', true);

  SELECT * INTO a FROM public.payment_attempts WHERE id = _attempt_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason','attempt_not_found');
  END IF;
  IF a.checkout_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason','no_checkout_id');
  END IF;

  target := public._canonical_to_mpesa_status(a.state);

  SELECT status INTO cur_status
    FROM public.mpesa_transactions
    WHERE checkout_request_id = a.checkout_request_id
    ORDER BY created_at DESC LIMIT 1;

  IF cur_status IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason','no_mpesa_row', 'target', target);
  END IF;

  IF cur_status = target THEN
    UPDATE public.mpesa_transactions
       SET mpesa_receipt = COALESCE(mpesa_receipt, a.mpesa_receipt_number),
           provider_transaction_id = COALESCE(provider_transaction_id, a.mpesa_receipt_number),
           result_desc  = COALESCE(result_desc, a.failure_reason),
           updated_at   = now()
     WHERE checkout_request_id = a.checkout_request_id
       AND ( mpesa_receipt IS NULL AND a.mpesa_receipt_number IS NOT NULL );
    RETURN jsonb_build_object('ok', true, 'already_synced', true, 'status', target);
  END IF;

  IF cur_status = 'PENDING' AND target IN ('SUCCESS','FAILED','CANCELLED') THEN
    UPDATE public.mpesa_transactions
       SET status = 'PROCESSING'::public.mpesa_status,
           updated_at = now()
     WHERE checkout_request_id = a.checkout_request_id
       AND status = 'PENDING'::public.mpesa_status;
    cur_status := 'PROCESSING'::public.mpesa_status;
  END IF;

  legal_final := (cur_status, target) IN (
    ('PENDING'::public.mpesa_status,        'PROCESSING'::public.mpesa_status),
    ('PENDING'::public.mpesa_status,        'CANCELLED'::public.mpesa_status),
    ('PENDING'::public.mpesa_status,        'FAILED'::public.mpesa_status),
    ('PROCESSING'::public.mpesa_status,     'SUCCESS'::public.mpesa_status),
    ('PROCESSING'::public.mpesa_status,     'FAILED'::public.mpesa_status),
    ('PROCESSING'::public.mpesa_status,     'CANCELLED'::public.mpesa_status),
    ('SUCCESS'::public.mpesa_status,        'REVERSED'::public.mpesa_status),
    ('SUCCESS'::public.mpesa_status,        'REFUND_PENDING'::public.mpesa_status),
    ('REFUND_PENDING'::public.mpesa_status, 'REVERSED'::public.mpesa_status),
    ('REFUND_PENDING'::public.mpesa_status, 'SUCCESS'::public.mpesa_status)
  );

  IF NOT legal_final THEN
    RETURN jsonb_build_object(
      'ok', true, 'skipped', true, 'reason','illegal_transition_from_terminal',
      'from', cur_status, 'to', target
    );
  END IF;

  UPDATE public.mpesa_transactions
     SET status         = target,
         result_desc    = COALESCE(result_desc, a.failure_reason),
         mpesa_receipt  = COALESCE(mpesa_receipt, a.mpesa_receipt_number),
         provider_transaction_id = COALESCE(provider_transaction_id, a.mpesa_receipt_number),
         updated_at     = now()
   WHERE checkout_request_id = a.checkout_request_id
     AND status = cur_status;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true, 'before', cur_status, 'after', target, 'rows_updated', rows_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_mpesa_transactions_projection(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_mpesa_transactions_projection(uuid) TO service_role, authenticated;

-- Heal historical divergences again
DO $$
DECLARE r RECORD; BEGIN
  FOR r IN
    SELECT id FROM public.payment_attempts
     WHERE state IN ('COMPLETED','FAILED','CANCELLED','TIMED_OUT','REVERSED','RECONCILED')
       AND checkout_request_id IS NOT NULL
       AND created_at > now() - interval '30 days'
  LOOP
    PERFORM public.payment_replay_projection(r.id, 'backfill_d5.3_v4', NULL);
  END LOOP;
END $$;
