CREATE OR REPLACE FUNCTION public.client_portal_inbox(_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE g public.client_portal_grants; a public.crm_accounts; v_emails text[]; v_out jsonb;
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
  IF v_emails IS NULL THEN RETURN jsonb_build_object('ok', true, 'emails', '[]'::jsonb); END IF;

  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'sent_at') DESC), '[]'::jsonb) INTO v_out FROM (
    SELECT jsonb_build_object(
      'id', m.id, 'thread_id', m.thread_id, 'direction', m.direction,
      'subject', coalesce(m.subject, '(no subject)'), 'from_name', m.from_name,
      'preview', left(m.body_preview, 400), 'sent_at', m.occurred_at,
      'booking_refs', (SELECT coalesce(jsonb_agg(DISTINCT b.booking_number), '[]'::jsonb)
          FROM public.corporate_ride_approvals ra JOIN public.trip_bookings b ON b.id = ra.booking_id
          WHERE a.corporate_id IS NOT NULL AND ra.corporate_id = a.corporate_id
            AND b.booking_number IS NOT NULL AND position(b.booking_number in coalesce(m.subject,'')||' '||coalesce(m.body_preview,'')) > 0),
      'enquiry_refs', (SELECT coalesce(jsonb_agg(DISTINCT r), '[]'::jsonb) FROM (
          SELECT l.lead_ref r FROM public.sales_leads l WHERE l.account_id = a.id AND l.lead_ref IS NOT NULL
            AND position(l.lead_ref in coalesce(m.subject,'')||' '||coalesce(m.body_preview,'')) > 0
          UNION SELECT q.quote_number FROM public.commercial_quotations q WHERE q.account_id = a.id
            AND position(q.quote_number in coalesce(m.subject,'')||' '||coalesce(m.body_preview,'')) > 0
          UNION SELECT t.lead_ref FROM public.comms_email_tasks et JOIN public.sales_leads t ON t.id = et.sales_lead_id
            WHERE et.message_id = m.id AND t.account_id = a.id) rr)
    ) x
    FROM public.comms_messages m
    JOIN public.comms_accounts ac ON ac.id = m.account_id
    WHERE (NOT ac.is_privileged OR lower(ac.mailbox_address) IN ('sales@yalla.africa','notify@yalla.africa')) AND (
      (m.direction = 'outbound' AND EXISTS (SELECT 1 FROM unnest(m.to_addresses || m.cc_addresses) t
          WHERE lower(trim(t)) = ANY(v_emails) OR lower(substring(t from '<([^>]+)>')) = ANY(v_emails)))
      OR (m.direction = 'inbound' AND lower(trim(coalesce(m.from_address,''))) = ANY(v_emails)))
    ORDER BY m.occurred_at DESC LIMIT 200
  ) s;
  RETURN jsonb_build_object('ok', true, 'emails', v_out);
END $function$