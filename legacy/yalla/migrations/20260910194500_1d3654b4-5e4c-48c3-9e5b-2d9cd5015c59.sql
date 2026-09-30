ALTER TABLE public.provider_earnings ALTER COLUMN booking_id DROP NOT NULL;

ALTER TABLE public.provider_earnings
  ADD COLUMN IF NOT EXISTS trip_booking_id uuid REFERENCES public.trip_bookings(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS provider_earnings_trip_booking_key
  ON public.provider_earnings (trip_booking_id) WHERE trip_booking_id IS NOT NULL;

ALTER TABLE public.provider_earnings
  DROP CONSTRAINT IF EXISTS provider_earnings_one_source;
ALTER TABLE public.provider_earnings
  ADD CONSTRAINT provider_earnings_one_source
  CHECK (num_nonnulls(booking_id, trip_booking_id) = 1);

CREATE OR REPLACE FUNCTION public.provider_settlement_run()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_set public.provider_settlement_settings;
  r record;
  v_accrued integer := 0;
  v_trip integer := 0;
  v_held integer := 0;
  v_credited integer := 0;
BEGIN
  SELECT * INTO v_set FROM public.provider_settlement_settings WHERE id;

  WITH ins AS (
    INSERT INTO public.provider_earnings
      (provider_user_id, booking_id, booking_reference, gross_cents, commission_bps,
       commission_cents, net_cents, currency, state)
    SELECT b.provider_user_id, b.id, b.booking_reference, b.amount_cents, v_set.commission_bps,
           round(b.amount_cents::numeric * v_set.commission_bps / 10000),
           b.amount_cents - round(b.amount_cents::numeric * v_set.commission_bps / 10000),
           coalesce(b.currency,'KES'), 'ACCRUED'
      FROM public.provider_bookings b
     WHERE b.status IN ('CONFIRMED','DELIVERED')
       AND b.is_test = false
       AND b.amount_cents > 0
    ON CONFLICT (booking_id) DO NOTHING
    RETURNING 1)
  SELECT count(*) INTO v_accrued FROM ins;

  -- Driver trips earn on exactly the same terms. The driver must be linked to
  -- their own login, otherwise there is no wallet to credit.
  WITH ins2 AS (
    INSERT INTO public.provider_earnings
      (provider_user_id, trip_booking_id, booking_reference, gross_cents, commission_bps,
       commission_cents, net_cents, currency, state)
    SELECT d.user_id, b.id, coalesce(b.booking_number, b.id::text),
           round(coalesce(b.total_fare,0) * 100)::bigint, v_set.commission_bps,
           round(round(coalesce(b.total_fare,0) * 100)::numeric * v_set.commission_bps / 10000),
           round(coalesce(b.total_fare,0) * 100)::bigint
             - round(round(coalesce(b.total_fare,0) * 100)::numeric * v_set.commission_bps / 10000),
           coalesce(b.currency,'KES'), 'ACCRUED'
      FROM public.trip_bookings b
      JOIN public.drivers d ON d.id = b.driver_id
     WHERE d.user_id IS NOT NULL
       AND b.cancelled_at IS NULL
       AND coalesce(b.total_fare,0) > 0
       AND b.status IN ('assigned','scheduled','pending','in_progress','started','arrived','completed')
       AND NOT EXISTS (SELECT 1 FROM public.provider_earnings e WHERE e.trip_booking_id = b.id)
    RETURNING 1)
  SELECT count(*) INTO v_trip FROM ins2;
  v_accrued := v_accrued + v_trip;

  UPDATE public.provider_earnings SET state = 'ACCRUED' WHERE state = 'PAYABLE';

  -- (b) Client paid in full -> the WHOLE amount is locked in the Yalla wallet,
  --     and the operator's 85% shows as held (not withdrawable).
  FOR r IN
    SELECT e.id, e.provider_user_id, e.gross_cents, e.net_cents, e.booking_reference
      FROM public.provider_earnings e
     WHERE e.state = 'ACCRUED'
       AND (
         (e.booking_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.provider_bookings b
              JOIN public.tax_invoices i ON i.id = b.invoice_id
             WHERE b.id = e.booking_id
               AND i.status = 'paid'
               AND i.paid_cents >= i.total_cents))
         OR
         (e.trip_booking_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.trip_bookings tb
             WHERE tb.id = e.trip_booking_id
               AND lower(coalesce(tb.payment_status,'')) IN ('paid','completed','succeeded')))
       )
  LOOP
    PERFORM public._provider_wallet_post(
      r.provider_user_id, 'HOLD', r.net_cents, 0, r.net_cents, 0, 'earning:' || r.id::text,
      jsonb_build_object('booking_reference', r.booking_reference,
                         'reason', 'client paid in full; held in the Yalla Mobility wallet until fulfilment'));

    PERFORM public._platform_wallet_post(
      'CLIENT_PAYMENT', r.gross_cents, r.gross_cents, r.gross_cents, 0, 0,
      'earning:' || r.id::text, 'provider_earning', r.id, r.provider_user_id,
      jsonb_build_object('booking_reference', r.booking_reference,
                         'operator_share_cents', r.net_cents,
                         'reason', 'client funds in custody; only fulfilment releases them'));

    UPDATE public.provider_earnings
       SET state = 'HELD',
           customer_paid_at = coalesce(customer_paid_at, now()),
           held_at = coalesce(held_at, now())
     WHERE id = r.id;
    v_held := v_held + 1;
  END LOOP;

  -- (c) Fulfilled -> release 85% into the operator wallet, recognise Yalla's 15%.
  FOR r IN
    SELECT e.id, e.provider_user_id, e.gross_cents, e.net_cents, e.commission_cents,
           e.commission_bps, e.currency, e.booking_reference, e.booking_id, e.trip_booking_id
      FROM public.provider_earnings e
     WHERE e.state = 'HELD'
       AND (
         (e.booking_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.provider_bookings b
             WHERE b.id = e.booking_id AND b.status = 'DELIVERED'))
         OR
         (e.trip_booking_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.trip_bookings tb
             WHERE tb.id = e.trip_booking_id AND tb.status = 'completed'))
       )
  LOOP
    PERFORM public._provider_wallet_post(
      r.provider_user_id, 'RELEASE', r.net_cents, r.net_cents, -r.net_cents, 0,
      'earning:' || r.id::text,
      jsonb_build_object('booking_reference', r.booking_reference,
                         'reason', 'trip fulfilled; funds available for withdrawal'));

    PERFORM public._platform_wallet_post(
      'FULFILMENT_RELEASE', r.gross_cents, 0, -r.gross_cents, r.net_cents, r.commission_cents,
      'earning:' || r.id::text, 'provider_earning', r.id, r.provider_user_id,
      jsonb_build_object('booking_reference', r.booking_reference,
                         'operator_share_cents', r.net_cents,
                         'commission_cents', r.commission_cents,
                         'commission_bps', r.commission_bps,
                         'paybill', v_set.platform_paybill));

    INSERT INTO public.provider_platform_postings
      (posting_type, provider_user_id, amount_cents, currency, paybill, rate_bps,
       source_kind, source_id, reference, detail)
    VALUES ('COMMISSION', r.provider_user_id, r.commission_cents, r.currency,
            v_set.platform_paybill, r.commission_bps, 'provider_earning', r.id,
            'commission:' || r.id::text,
            jsonb_build_object('booking_reference', r.booking_reference,
                              'booking_id', r.booking_id,
                              'trip_booking_id', r.trip_booking_id))
    ON CONFLICT (reference) DO NOTHING;

    UPDATE public.provider_earnings
       SET state = 'CREDITED',
           fulfilled_at = coalesce(fulfilled_at, now()),
           credited_at = coalesce(credited_at, now())
     WHERE id = r.id;
    v_credited := v_credited + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'accrued', v_accrued, 'trip_accrued', v_trip,
    'held', v_held, 'credited', v_credited, 'made_payable', v_credited);
END $function$;