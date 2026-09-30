CREATE OR REPLACE FUNCTION public.provider_admin_finance_console()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT public.capacity_can_approve(v_uid) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;

  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'delivered_gross_cents', (SELECT coalesce(sum(amount_cents),0) FROM public.provider_bookings
                                 WHERE status = 'DELIVERED' AND is_test = false),
      'operator_payout_cents', (SELECT coalesce(sum(round(amount_cents * 0.85)),0) FROM public.provider_bookings
                                 WHERE status = 'DELIVERED' AND is_test = false),
      'commission_cents', (SELECT coalesce(sum(amount_cents - round(amount_cents * 0.85)),0)
                             FROM public.provider_bookings WHERE status = 'DELIVERED' AND is_test = false),
      'pipeline_gross_cents', (SELECT coalesce(sum(amount_cents),0) FROM public.provider_bookings
                                 WHERE status IN ('REQUESTED','CONFIRMED') AND is_test = false),
      'documents_pending', (SELECT count(*) FROM public.provider_documents WHERE status = 'SUBMITTED'),
      'documents_verified', (SELECT count(*) FROM public.provider_documents WHERE status = 'VERIFIED'),
      'corporate_requests_pending', (SELECT count(*) FROM public.corporate_ride_approvals WHERE status = 'PENDING'),
      'corporate_invoices_open', (SELECT count(*) FROM public.corporate_invoices
                                   WHERE status NOT IN ('PAID','VOIDED')),
      'corporate_invoiced_cents', (SELECT coalesce(sum(total_cents),0) FROM public.corporate_invoices
                                    WHERE status <> 'VOIDED'),
      'corporate_paid_cents', (SELECT coalesce(sum(paid_cents),0) FROM public.corporate_invoices
                                WHERE status <> 'VOIDED'),
      'corporate_outstanding_cents', (SELECT coalesce(sum(balance_cents),0) FROM public.corporate_invoices
                                       WHERE status NOT IN ('PAID','VOIDED'))
    ),
    'operators', (
      SELECT coalesce(jsonb_agg(x ORDER BY (x->>'delivered_gross_cents')::bigint DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'provider_user_id', b.provider_user_id,
          'provider_name', max(c.provider_name),
          'provider_kind', max(c.provider_kind),
          'currency', coalesce(max(b.currency), 'KES'),
          'bookings', count(*),
          'delivered', count(*) FILTER (WHERE b.status = 'DELIVERED'),
          'upcoming', count(*) FILTER (WHERE b.status IN ('REQUESTED','CONFIRMED')),
          'delivered_gross_cents', coalesce(sum(b.amount_cents) FILTER (WHERE b.status = 'DELIVERED'), 0),
          'payout_cents', coalesce(sum(round(b.amount_cents * 0.85)) FILTER (WHERE b.status = 'DELIVERED'), 0),
          'commission_cents', coalesce(sum(b.amount_cents - round(b.amount_cents * 0.85))
                                        FILTER (WHERE b.status = 'DELIVERED'), 0),
          'pipeline_gross_cents', coalesce(sum(b.amount_cents) FILTER (WHERE b.status IN ('REQUESTED','CONFIRMED')), 0),
          'invoiced_cents', coalesce(sum(b.amount_cents) FILTER (WHERE b.invoice_id IS NOT NULL), 0),
          'listings_live', (SELECT count(*) FROM public.provider_capacity p
                             WHERE p.provider_user_id = b.provider_user_id AND p.status = 'PUBLISHED'),
          'documents_pending', (SELECT count(*) FROM public.provider_documents d
                                 WHERE d.provider_user_id = b.provider_user_id AND d.status = 'SUBMITTED'),
          'last_service_at', max(b.service_from)
        ) AS x
        FROM public.provider_bookings b
        LEFT JOIN public.provider_capacity c ON c.id = b.capacity_id
        WHERE b.is_test = false
        GROUP BY b.provider_user_id
      ) s
    ),
    'corporate_requests', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id,
        'organisation', coalesce(ca.trading_name, ca.legal_name),
        'employee_name', (SELECT btrim(coalesce(e.first_name,'') || ' ' || coalesce(e.last_name,''))
                            FROM public.corporate_employees e WHERE e.id = r.employee_id),
        'pickup', r.pickup_address,
        'dropoff', r.dropoff_address,
        'estimated_fare_cents', r.estimated_fare_cents,
        'status', r.status,
        'cost_center_code', r.cost_center_code,
        'scheduled_for', r.scheduled_for,
        'decided_at', r.decided_at,
        'booking_id', r.booking_id,
        'booking_status', (SELECT tb.status FROM public.trip_bookings tb WHERE tb.id = r.booking_id),
        'created_at', r.created_at
      ) ORDER BY r.created_at DESC), '[]'::jsonb)
      FROM public.corporate_ride_approvals r
      LEFT JOIN public.corporate_accounts ca ON ca.id = r.corporate_id
    ),
    'corporate_invoices', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id,
        'invoice_number', i.invoice_number,
        'organisation', coalesce(ca.trading_name, ca.legal_name),
        'status', i.status,
        'currency', i.currency,
        'total_cents', i.total_cents,
        'paid_cents', i.paid_cents,
        'balance_cents', i.balance_cents,
        'lines', (SELECT count(*) FROM public.corporate_invoice_items it WHERE it.invoice_id = i.id),
        'issued_at', i.issued_at,
        'due_at', i.due_at,
        'paid_at', i.paid_at,
        'created_at', i.created_at
      ) ORDER BY i.created_at DESC), '[]'::jsonb)
      FROM public.corporate_invoices i
      LEFT JOIN public.corporate_accounts ca ON ca.id = i.corporate_id
    )
  ) INTO v_out;

  RETURN v_out;
END;
$$;

REVOKE ALL ON FUNCTION public.provider_admin_finance_console() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provider_admin_finance_console() TO authenticated;