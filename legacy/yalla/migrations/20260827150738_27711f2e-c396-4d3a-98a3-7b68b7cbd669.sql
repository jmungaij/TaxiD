-- 1) Database-enforced booking idempotency: one order per idempotency key.
CREATE UNIQUE INDEX IF NOT EXISTS delivery_orders_idempotency_key_uidx
  ON public.delivery_orders ((metadata->>'idempotency_key'))
  WHERE metadata->>'idempotency_key' IS NOT NULL;

-- 2) Verified payment settlement. The authoritative payment ledger
--    (public.mpesa_transactions, written only by the verified Daraja callback)
--    decides whether an order is paid. Idempotent by construction.
CREATE OR REPLACE FUNCTION public.logistics_settle_order_payment(
  p_order_number text,
  p_checkout_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order   public.delivery_orders;
  v_txn     public.mpesa_transactions;
  v_paid    numeric;
BEGIN
  SELECT * INTO v_order FROM public.delivery_orders
   WHERE order_number = p_order_number FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('settled', false, 'reason_code', 'ORDER_NOT_FOUND');
  END IF;

  IF v_order.payment_status = 'paid' THEN
    RETURN jsonb_build_object('settled', true, 'reason_code', 'ALREADY_SETTLED',
                              'order_number', v_order.order_number);
  END IF;

  SELECT * INTO v_txn
    FROM public.mpesa_transactions
   WHERE status = 'SUCCESS'
     AND deleted_at IS NULL
     AND (
       (p_checkout_request_id IS NOT NULL AND checkout_request_id = p_checkout_request_id)
       OR account_reference = p_order_number
       OR transaction_reference = p_order_number
     )
   ORDER BY updated_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('settled', false, 'reason_code', 'NO_VERIFIED_PAYMENT');
  END IF;

  -- The payer must be the customer who booked the shipment.
  IF v_order.customer_id IS NOT NULL AND v_txn.user_id <> v_order.customer_id THEN
    RETURN jsonb_build_object('settled', false, 'reason_code', 'PAYER_MISMATCH');
  END IF;

  v_paid := v_txn.amount_cents::numeric / 100.0;
  IF v_order.total_amount IS NOT NULL AND v_paid + 0.5 < v_order.total_amount THEN
    RETURN jsonb_build_object('settled', false, 'reason_code', 'AMOUNT_SHORTFALL',
                              'paid_kes', v_paid, 'due_kes', v_order.total_amount);
  END IF;

  UPDATE public.delivery_orders
     SET payment_status = 'paid',
         status = CASE WHEN status IN ('draft','pending','confirmed') THEN 'confirmed' ELSE status END,
         metadata = metadata || jsonb_build_object(
           'payment', jsonb_build_object(
             'provider', v_txn.payment_provider,
             'receipt', v_txn.mpesa_receipt,
             'checkout_request_id', v_txn.checkout_request_id,
             'amount_kes', v_paid,
             'settled_at', now()
           )
         ),
         updated_at = now()
   WHERE id = v_order.id;

  INSERT INTO public.package_events (package_id, event_type, notes, metadata)
  SELECT p.id, 'payment_confirmed',
         'Payment confirmed by the payment provider.',
         jsonb_build_object('receipt', v_txn.mpesa_receipt, 'order_number', v_order.order_number)
    FROM public.packages p
   WHERE p.order_id = v_order.id;

  -- Release dispatch for courier assignment now that funds are confirmed.
  UPDATE public.delivery_dispatch_jobs
     SET status = 'queued', updated_at = now()
   WHERE order_id = v_order.id AND status IN ('on_hold','awaiting_payment');

  RETURN jsonb_build_object(
    'settled', true,
    'reason_code', 'SETTLED',
    'order_number', v_order.order_number,
    'receipt', v_txn.mpesa_receipt,
    'amount_kes', v_paid
  );
END;
$$;

REVOKE ALL ON FUNCTION public.logistics_settle_order_payment(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.logistics_settle_order_payment(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.logistics_settle_order_payment(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.logistics_settle_order_payment(text, text) TO service_role;