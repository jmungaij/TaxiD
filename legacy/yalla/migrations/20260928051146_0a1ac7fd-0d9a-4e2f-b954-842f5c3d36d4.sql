DROP FUNCTION IF EXISTS public.client_portal_reply(uuid, text);
CREATE OR REPLACE FUNCTION public.client_portal_reply(_message_id uuid, _body text, _rfc_message_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_uid uuid := auth.uid(); v_email text; v_name text; m public.comms_messages; ac public.comms_accounts;
  v_key text; v_to text; v_new uuid; v_recent int; v_mid text; v_subject text;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'SIGN_IN_REQUIRED'); END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = v_uid AND email_confirmed_at IS NOT NULL;
  IF v_email IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'EMAIL_NOT_VERIFIED'); END IF;
  IF length(trim(coalesce(_body,''))) < 2 OR length(_body) > 5000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_BODY'); END IF;
  SELECT * INTO m FROM public.comms_messages WHERE id = _message_id;
  IF m.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  SELECT * INTO ac FROM public.comms_accounts WHERE id = m.account_id;
  IF ac.is_privileged AND lower(ac.mailbox_address) NOT IN ('sales@yalla.africa','notify@yalla.africa') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF NOT ((m.direction = 'outbound' AND EXISTS (SELECT 1 FROM unnest(coalesce(m.to_addresses,'{}')||coalesce(m.cc_addresses,'{}')) t
            WHERE lower(trim(t)) = v_email OR lower(substring(t from '<([^>]+)>')) = v_email))
       OR (m.direction = 'inbound' AND lower(m.from_address) = v_email)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  SELECT count(*) INTO v_recent FROM public.comms_messages
   WHERE source = 'client_portal' AND lower(from_address) = v_email AND occurred_at > now() - interval '1 hour';
  IF v_recent >= 20 THEN RETURN jsonb_build_object('ok', false, 'error', 'RATE_LIMITED'); END IF;
  v_to := CASE WHEN lower(ac.mailbox_address) = 'notify@yalla.africa' THEN 'sales@yalla.africa' ELSE ac.mailbox_address END;
  SELECT external_thread_key INTO v_key FROM public.comms_threads WHERE id = m.thread_id;
  IF v_to <> ac.mailbox_address THEN v_key := NULL; END IF;
  SELECT full_name INTO v_name FROM public.profiles WHERE user_id = v_uid;
  v_mid := CASE WHEN _rfc_message_id ~ '^<portal-[0-9a-f-]{36}@yalla\.africa>$' THEN _rfc_message_id
                ELSE '<portal-' || gen_random_uuid() || '@yalla.africa>' END;
  v_subject := CASE WHEN m.subject ILIKE 're:%' THEN m.subject ELSE 'Re: ' || coalesce(m.subject,'') END;
  v_new := public.comms_message_ingest(
    v_to, 'inbound', now(), v_email, coalesce(v_name, v_email), ARRAY[v_to], '{}',
    v_subject, trim(_body), NULL, v_mid, v_key,
    'client_portal', gen_random_uuid()::text, 'external', NULL,
    jsonb_build_object('in_reply_to_message', m.id, 'via', 'client_portal'));
  RETURN jsonb_build_object('ok', true, 'id', v_new, 'to', v_to, 'subject', v_subject,
    'from_email', v_email, 'from_name', coalesce(v_name, v_email), 'message_id', v_mid,
    'in_reply_to', m.provider_message_id);
END $f$;
REVOKE ALL ON FUNCTION public.client_portal_reply(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_reply(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_client_booking_links()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_out jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (coalesce(public.has_role(auth.uid(),'admin'),false) OR coalesce(public.has_role(auth.uid(),'super_admin'),false)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_PERMITTED'); END IF;
  WITH b AS (
    SELECT rider_user_id uid, booking_number ref, 'ride' kind, status::text status, created_at FROM public.trip_bookings WHERE booking_number IS NOT NULL AND rider_user_id IS NOT NULL
    UNION ALL SELECT user_id, reference, 'charter', status::text, created_at FROM public.charter_bookings WHERE reference IS NOT NULL AND user_id IS NOT NULL
  ), c AS (
    SELECT b.uid, u.email, p.full_name,
      jsonb_agg(jsonb_build_object('ref', b.ref, 'kind', b.kind, 'status', b.status, 'created_at', b.created_at,
        'threads', (SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('thread_id', t.id, 'subject', t.subject, 'mailbox', ac.mailbox_address, 'last_at', t.last_activity_at)), '[]'::jsonb)
           FROM public.comms_messages m JOIN public.comms_threads t ON t.id = m.thread_id JOIN public.comms_accounts ac ON ac.id = m.account_id
           WHERE position(b.ref in coalesce(m.subject,'')||' '||coalesce(m.body_preview,'')) > 0)
      ) ORDER BY b.created_at DESC) bookings, max(b.created_at) last_at
    FROM b JOIN auth.users u ON u.id = b.uid LEFT JOIN public.profiles p ON p.user_id = b.uid
    GROUP BY b.uid, u.email, p.full_name
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', uid, 'email', email, 'name', full_name, 'bookings', bookings) ORDER BY last_at DESC), '[]'::jsonb)
    INTO v_out FROM (SELECT * FROM c ORDER BY last_at DESC LIMIT 300) s;
  RETURN jsonb_build_object('ok', true, 'clients', v_out);
END $f$;
REVOKE ALL ON FUNCTION public.admin_client_booking_links() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_client_booking_links() TO authenticated;

CREATE OR REPLACE FUNCTION public.team_inbox()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_out jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'SIGN_IN_REQUIRED'); END IF;
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'last_at' DESC), '[]'::jsonb) INTO v_out FROM (
    SELECT jsonb_build_object('thread_id', t.id, 'subject', coalesce(t.subject,'(no subject)'),
      'sender_name', t.counterparty_name, 'sender_email', lower(t.counterparty_email),
      'mailbox', ac.mailbox_address, 'messages', t.message_count, 'status', t.status,
      'last_direction', t.last_direction, 'last_at', t.last_activity_at,
      'tags', (SELECT coalesce(jsonb_agg(DISTINCT r[1]), '[]'::jsonb) FROM public.comms_messages m,
               regexp_matches(coalesce(m.subject,'')||' '||coalesce(m.body_preview,''),
                 '(CH-[A-Z0-9]{10,14}|JX-B-[0-9a-f]{8}-[0-9]{13}|LEAD-[0-9]{6}-[A-Z0-9]+|YB-[0-9]{4}-[0-9]{4})', 'g') r
               WHERE m.thread_id = t.id)) x
    FROM public.comms_threads t JOIN public.comms_accounts ac ON ac.id = t.account_id
    WHERE coalesce(public.comms_can_read_account(ac.id), false)
    ORDER BY t.last_activity_at DESC LIMIT 500) s;
  RETURN jsonb_build_object('ok', true, 'threads', v_out);
END $f$;
REVOKE ALL ON FUNCTION public.team_inbox() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_inbox() TO authenticated;