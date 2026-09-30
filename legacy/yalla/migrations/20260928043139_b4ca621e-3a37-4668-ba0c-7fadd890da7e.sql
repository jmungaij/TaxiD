CREATE OR REPLACE FUNCTION public._client_inbox(_emails text[], _account_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_out jsonb; v_corp uuid; v_users uuid[];
BEGIN
  IF _emails IS NULL OR cardinality(_emails) = 0 THEN RETURN '[]'::jsonb; END IF;
  SELECT corporate_id INTO v_corp FROM public.crm_accounts WHERE id = _account_id;
  SELECT array_agg(id) INTO v_users FROM auth.users WHERE lower(email) = ANY(_emails);
  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'sent_at') DESC), '[]'::jsonb) INTO v_out FROM (
    SELECT jsonb_build_object(
      'id', m.id, 'thread_id', m.thread_id, 'direction', m.direction,
      'subject', coalesce(m.subject, '(no subject)'), 'from_name', m.from_name,
      'from_address', CASE WHEN m.direction='outbound' THEN ac.mailbox_address ELSE NULL END,
      'preview', left(m.body_preview, 400), 'sent_at', m.occurred_at,
      'booking_refs', (SELECT coalesce(jsonb_agg(DISTINCT r), '[]'::jsonb) FROM (
          SELECT b.booking_number r FROM public.corporate_ride_approvals ra JOIN public.trip_bookings b ON b.id = ra.booking_id
            WHERE v_corp IS NOT NULL AND ra.corporate_id = v_corp AND b.booking_number IS NOT NULL
          UNION SELECT b.booking_number FROM public.trip_bookings b WHERE b.rider_user_id = ANY(v_users) AND b.booking_number IS NOT NULL
          UNION SELECT c.reference FROM public.charter_bookings c WHERE c.user_id = ANY(v_users) AND c.reference IS NOT NULL
        ) bb WHERE position(r in coalesce(m.subject,'')||' '||coalesce(m.body_preview,'')) > 0),
      'enquiry_refs', (SELECT coalesce(jsonb_agg(DISTINCT r), '[]'::jsonb) FROM (
          SELECT l.lead_ref r FROM public.sales_leads l WHERE l.account_id = _account_id AND l.lead_ref IS NOT NULL
            AND position(l.lead_ref in coalesce(m.subject,'')||' '||coalesce(m.body_preview,'')) > 0
          UNION SELECT q.quote_number FROM public.commercial_quotations q WHERE q.account_id = _account_id
            AND position(q.quote_number in coalesce(m.subject,'')||' '||coalesce(m.body_preview,'')) > 0
          UNION SELECT t.lead_ref FROM public.comms_email_tasks et JOIN public.sales_leads t ON t.id = et.sales_lead_id
            WHERE et.message_id = m.id AND t.account_id = _account_id) rr)
    ) x
    FROM public.comms_messages m
    JOIN public.comms_accounts ac ON ac.id = m.account_id
    WHERE (NOT ac.is_privileged OR lower(ac.mailbox_address) IN ('sales@yalla.africa','notify@yalla.africa')) AND (
      (m.direction = 'outbound' AND EXISTS (SELECT 1 FROM unnest(coalesce(m.to_addresses,'{}') || coalesce(m.cc_addresses,'{}')) t
          WHERE lower(trim(t)) = ANY(_emails) OR lower(substring(t from '<([^>]+)>')) = ANY(_emails)))
      OR (m.direction = 'inbound' AND lower(trim(coalesce(m.from_address,''))) = ANY(_emails)))
    ORDER BY m.occurred_at DESC LIMIT 200
  ) s;
  RETURN v_out;
END $f$;
REVOKE ALL ON FUNCTION public._client_inbox(text[], uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.client_portal_inbox(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE g public.client_portal_grants; a public.crm_accounts; v_emails text[];
BEGIN
  IF coalesce(length(trim(coalesce(_token,''))),0) < 32 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LINK'); END IF;
  SELECT * INTO g FROM public.client_portal_grants
   WHERE token_hash = encode(sha256(convert_to(trim(_token),'utf8')),'hex');
  IF g.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LINK'); END IF;
  IF g.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'LINK_REVOKED'); END IF;
  IF g.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'error', 'LINK_EXPIRED'); END IF;
  SELECT * INTO a FROM public.crm_accounts WHERE id = g.account_id;
  IF a.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'ACCOUNT_NOT_FOUND'); END IF;
  SELECT array_agg(DISTINCT lower(e)) INTO v_emails FROM (
    SELECT g.recipient_email e
    UNION SELECT c.email FROM public.crm_contacts c WHERE c.account_id = a.id AND c.is_active
    UNION SELECT l.contact_email FROM public.sales_leads l WHERE l.account_id = a.id
  ) s WHERE e IS NOT NULL AND e LIKE '%@%';
  RETURN jsonb_build_object('ok', true, 'emails', public._client_inbox(v_emails, a.id));
END $f$;

-- Signed-in client: only mail to/from their own verified address.
CREATE OR REPLACE FUNCTION public.client_portal_my_inbox()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_uid uuid := auth.uid(); v_email text; v_confirmed timestamptz; v_acc uuid; v_name text; v_bookings jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'SIGN_IN_REQUIRED'); END IF;
  SELECT lower(email), email_confirmed_at INTO v_email, v_confirmed FROM auth.users WHERE id = v_uid;
  IF v_email IS NULL OR v_confirmed IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'EMAIL_NOT_VERIFIED'); END IF;
  SELECT a.id, a.name INTO v_acc, v_name FROM public.crm_accounts a
   WHERE EXISTS (SELECT 1 FROM public.crm_contacts c WHERE c.account_id = a.id AND c.is_active AND lower(c.email) = v_email)
      OR EXISTS (SELECT 1 FROM public.sales_leads l WHERE l.account_id = a.id AND lower(l.contact_email) = v_email)
   LIMIT 1;
  SELECT coalesce(jsonb_agg(b ORDER BY b->>'created_at' DESC), '[]'::jsonb) INTO v_bookings FROM (
    SELECT jsonb_build_object('ref', booking_number, 'status', status, 'created_at', created_at, 'kind', 'ride')
      b FROM public.trip_bookings WHERE rider_user_id = v_uid AND booking_number IS NOT NULL
    UNION ALL SELECT jsonb_build_object('ref', reference, 'status', status, 'created_at', created_at, 'kind', 'charter')
      FROM public.charter_bookings WHERE user_id = v_uid
  ) s;
  RETURN jsonb_build_object('ok', true, 'email', v_email, 'organisation', v_name,
    'bookings', v_bookings, 'emails', public._client_inbox(ARRAY[v_email], v_acc));
END $f$;
REVOKE ALL ON FUNCTION public.client_portal_my_inbox() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_my_inbox() TO authenticated;