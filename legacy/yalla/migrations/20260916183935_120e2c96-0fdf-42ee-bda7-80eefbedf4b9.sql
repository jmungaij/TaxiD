-- Fare and payment integrity on trip_bookings.
-- Column-level privileges are the enforcement point: SECURITY DEFINER routines
-- (trip_confirm_booking, decide_corporate_ride_request, capture/link payment
-- functions, etc.) run as the table owner and are unaffected, while direct
-- PostgREST writes from anon/authenticated are limited to non-financial columns.

REVOKE INSERT, UPDATE ON public.trip_bookings FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.trip_bookings FROM authenticated;

GRANT INSERT (
  rider_user_id, trip_request_id, trip_quote_id, ride_type_id,
  pickup_address, pickup_lat, pickup_lng,
  dropoff_address, dropoff_lat, dropoff_lng,
  passenger_count, intent, payment_method, scheduled_for
) ON public.trip_bookings TO authenticated;

GRANT UPDATE (
  status, scheduled_for, cancellation_reason, cancelled_by, cancelled_at, updated_at
) ON public.trip_bookings TO authenticated;

GRANT ALL ON public.trip_bookings TO service_role;