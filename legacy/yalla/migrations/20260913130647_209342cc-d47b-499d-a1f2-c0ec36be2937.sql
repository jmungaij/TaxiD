CREATE OR REPLACE FUNCTION public.rental_quote_open(_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.rental_quote_requests; expired boolean; booking jsonb := NULL;
BEGIN
  IF _token IS NULL OR length(_token) < 20 THEN
    RETURN jsonb_build_object('found', false, 'reason_code', 'INVALID_TOKEN');
  END IF;

  SELECT * INTO q FROM public.rental_quote_requests WHERE token = _token;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false, 'reason_code', 'QUOTE_NOT_FOUND');
  END IF;

  expired := q.expires_at < now() AND q.payment_status <> 'paid';

  SELECT jsonb_build_object(
           'booking_reference', b.booking_reference,
           'status', b.status,
           'start_date', b.start_date,
           'end_date', b.end_date,
           'picked_up_at', b.picked_up_at,
           'returned_at', b.returned_at,
           'change_request', b.change_request,
           'requested_start_date', b.requested_start_date,
           'requested_end_date', b.requested_end_date,
           'vehicle', CASE WHEN u.id IS NULL THEN NULL ELSE jsonb_build_object(
              'make', u.make, 'model', u.model, 'year', u.year,
              'transmission', u.transmission, 'seats', u.seats) END
         )
    INTO booking
    FROM public.rental_bookings b
    LEFT JOIN public.rental_fleet_units u ON u.id = b.unit_id
   WHERE b.quote_id = q.id;

  RETURN jsonb_build_object(
    'found', true,
    'reference', q.reference,
    'category', q.category,
    'asset_class', q.asset_class,
    'band_label', q.band_label,
    'seats', q.seats,
    'pricing_version', q.pricing_version,
    'pricing_snapshot', q.pricing_snapshot,
    'start_date', q.start_date,
    'end_date', q.end_date,
    'rental_days', q.rental_days,
    'extra_hours', q.extra_hours,
    'expected_km', q.expected_km,
    'pickup_location', q.pickup_location,
    'notes', q.notes,
    'contact_name', q.contact_name,
    'contact_email', q.contact_email,
    'contact_phone', q.contact_phone,
    'company_name', q.company_name,
    'base_kes', q.base_kes,
    'extra_hours_kes', q.extra_hours_kes,
    'excess_km_kes', q.excess_km_kes,
    'discount_kes', q.discount_kes,
    'vat_kes', q.vat_kes,
    'total_kes', q.total_kes,
    'currency', q.currency,
    'status', CASE WHEN expired THEN 'EXPIRED' ELSE q.status END,
    'payment_status', q.payment_status,
    'amount_paid_kes', q.amount_paid_kes,
    'mpesa_receipt', q.mpesa_receipt,
    'paid_at', q.paid_at,
    'expires_at', q.expires_at,
    'expired', expired,
    'booking', booking,
    'created_at', q.created_at
  );
END;
$$;
