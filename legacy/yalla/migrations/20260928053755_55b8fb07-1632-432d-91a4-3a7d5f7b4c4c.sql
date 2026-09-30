CREATE OR REPLACE FUNCTION public.client_portal_dashboard()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_base jsonb; v_email text; v_inv jsonb; v_prof jsonb; v_bk jsonb;
BEGIN
  v_base := public.client_portal_my_inbox();
  IF NOT (v_base->>'ok')::boolean THEN RETURN v_base; END IF;
  v_email := v_base->>'email';
  SELECT coalesce(jsonb_agg(i ORDER BY i->>'issued_at' DESC NULLS LAST), '[]'::jsonb) INTO v_inv FROM (
    SELECT jsonb_build_object('number', coalesce(invoice_number, kra_invoice_number), 'status', status, 'currency', currency,
      'total', total_cents / 100.0, 'paid', NULL, 'issued_at', issued_at, 'kind', 'tax') i
      FROM public.etims_invoices WHERE customer_user_id = v_uid OR lower(customer_email) = v_email
    UNION ALL SELECT jsonb_build_object('number', invoice_number, 'status', status, 'currency', currency,
      'total', total, 'paid', paid_total, 'issued_at', issued_at, 'kind', 'freight')
      FROM public.freight_invoices WHERE customer_user_id = v_uid
  ) s;
  -- Enrich bookings: amounts, payment status, balance and finance@ payment emails
  SELECT coalesce(jsonb_agg(
    CASE WHEN cb.reference IS NULL THEN b ELSE b || jsonb_build_object(
      'amount', cb.amount, 'currency', cb.currency, 'payment_status', cb.payment_status, 'paid_at', cb.paid_at,
      'balance', CASE WHEN lower(coalesce(cb.payment_status,'')) IN ('paid','completed','settled') THEN 0 ELSE cb.amount END,
      'finance_emails', (SELECT count(*) FROM public.comms_messages m JOIN public.comms_accounts ac ON ac.id = m.account_id
          WHERE lower(ac.mailbox_address) = 'finance@yalla.africa'
            AND position(cb.reference in coalesce(m.subject,'')||' '||coalesce(m.body_preview,'')) > 0))
    END ORDER BY b->>'created_at' DESC), '[]'::jsonb)
    INTO v_bk
    FROM jsonb_array_elements(coalesce(v_base->'bookings','[]'::jsonb)) b
    LEFT JOIN public.charter_bookings cb ON cb.reference = b->>'ref' AND cb.user_id = v_uid;
  SELECT jsonb_build_object('full_name', p.full_name, 'phone', p.phone,
     'company_name', cp.company_name, 'preferred_contact', coalesce(cp.preferred_contact,'email'),
     'email_updates', coalesce(cp.email_updates,true), 'sms_updates', coalesce(cp.sms_updates,false),
     'marketing_updates', coalesce(cp.marketing_updates,false))
    INTO v_prof FROM (SELECT v_uid u) x
    LEFT JOIN public.profiles p ON p.user_id = x.u
    LEFT JOIN public.client_portal_preferences cp ON cp.user_id = x.u;
  RETURN v_base || jsonb_build_object('invoices', v_inv, 'profile', v_prof, 'bookings', v_bk);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_client_booking_links()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_out jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (coalesce(public.has_role(auth.uid(),'admin'),false) OR coalesce(public.has_role(auth.uid(),'super_admin'),false)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_PERMITTED'); END IF;
  WITH b AS (
    SELECT rider_user_id uid, booking_number ref, 'ride' kind, status::text status, created_at, NULL::numeric amount, NULL::text currency, NULL::text payment_status, NULL::timestamptz paid_at
      FROM public.trip_bookings WHERE booking_number IS NOT NULL AND rider_user_id IS NOT NULL
    UNION ALL SELECT user_id, reference, 'charter', status, created_at, amount, currency, payment_status, paid_at
      FROM public.charter_bookings WHERE reference IS NOT NULL AND user_id IS NOT NULL
  ), c AS (
    SELECT b.uid, u.email, p.full_name,
      jsonb_agg(jsonb_build_object('ref', b.ref, 'kind', b.kind, 'status', b.status, 'created_at', b.created_at,
        'amount', b.amount, 'currency', b.currency, 'payment_status', b.payment_status, 'paid_at', b.paid_at,
        'finance_emails', (SELECT count(*) FROM public.comms_messages m JOIN public.comms_accounts ac ON ac.id = m.account_id
           WHERE lower(ac.mailbox_address) = 'finance@yalla.africa'
             AND position(b.ref in coalesce(m.subject,'')||' '||coalesce(m.body_preview,'')) > 0),
        'threads', (SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('thread_id', t.id, 'subject', t.subject, 'mailbox', ac.mailbox_address, 'last_at', t.last_activity_at)), '[]'::jsonb)
           FROM public.comms_messages m JOIN public.comms_threads t ON t.id = m.thread_id JOIN public.comms_accounts ac ON ac.id = m.account_id
           WHERE position(b.ref in coalesce(m.subject,'')||' '||coalesce(m.body_preview,'')) > 0)
      ) ORDER BY b.created_at DESC) bookings, max(b.created_at) last_at,
      sum(b.amount) total_amount,
      sum(CASE WHEN lower(coalesce(b.payment_status,'')) IN ('paid','completed','settled') THEN b.amount ELSE 0 END) paid_amount
    FROM b JOIN auth.users u ON u.id = b.uid LEFT JOIN public.profiles p ON p.user_id = b.uid
    GROUP BY b.uid, u.email, p.full_name
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', uid, 'email', email, 'name', full_name, 'bookings', bookings,
      'total_amount', total_amount, 'paid_amount', paid_amount) ORDER BY last_at DESC), '[]'::jsonb)
    INTO v_out FROM (SELECT * FROM c ORDER BY last_at DESC LIMIT 300) s;
  RETURN jsonb_build_object('ok', true, 'clients', v_out);
END $function$;