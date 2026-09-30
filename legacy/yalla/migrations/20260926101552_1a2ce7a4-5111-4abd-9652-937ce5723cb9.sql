CREATE TABLE public.comms_email_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.comms_messages(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.comms_threads(id) ON DELETE CASCADE,
  mailbox_id uuid NOT NULL REFERENCES public.comms_accounts(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  due_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  meeting_url text CHECK (meeting_url IS NULL OR meeting_url ~* '^https://'),
  meeting_at timestamptz,
  opportunity_id uuid REFERENCES public.commercial_opportunities(id) ON DELETE SET NULL,
  sales_lead_id uuid REFERENCES public.sales_leads(id) ON DELETE SET NULL,
  crm_account_id uuid REFERENCES public.crm_accounts(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id)
);
CREATE INDEX comms_email_tasks_staff_idx ON public.comms_email_tasks(staff_id, status);
GRANT SELECT, INSERT, UPDATE ON public.comms_email_tasks TO authenticated;
GRANT ALL ON public.comms_email_tasks TO service_role;
ALTER TABLE public.comms_email_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY comms_email_tasks_read ON public.comms_email_tasks FOR SELECT TO authenticated
  USING (coalesce(public.comms_can_read_account(mailbox_id), false));
CREATE POLICY comms_email_tasks_insert ON public.comms_email_tasks FOR INSERT TO authenticated
  WITH CHECK (coalesce(public.comms_can_read_account(mailbox_id), false)
    AND EXISTS (SELECT 1 FROM public.comms_messages m WHERE m.id = message_id AND m.thread_id = comms_email_tasks.thread_id AND m.account_id = comms_email_tasks.mailbox_id));
CREATE POLICY comms_email_tasks_update ON public.comms_email_tasks FOR UPDATE TO authenticated
  USING (coalesce(public.comms_can_read_account(mailbox_id), false))
  WITH CHECK (coalesce(public.comms_can_read_account(mailbox_id), false));
CREATE TRIGGER comms_email_tasks_touch BEFORE UPDATE ON public.comms_email_tasks
  FOR EACH ROW EXECUTE FUNCTION public._client_portal_touch();

-- Client portal inbox: emails sent to this account's addresses, linked to bookings/enquiries
CREATE OR REPLACE FUNCTION public.client_portal_inbox(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
      'id', m.id, 'subject', coalesce(m.subject, '(no subject)'), 'from_name', m.from_name,
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
    WHERE m.direction = 'outbound' AND NOT ac.is_privileged
      AND EXISTS (SELECT 1 FROM unnest(m.to_addresses || m.cc_addresses) t WHERE lower(trim(t)) = ANY(v_emails)
                  OR lower(substring(t from '<([^>]+)>')) = ANY(v_emails))
    ORDER BY m.occurred_at DESC LIMIT 200
  ) s;
  RETURN jsonb_build_object('ok', true, 'emails', v_out);
END $$;
REVOKE ALL ON FUNCTION public.client_portal_inbox(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_portal_inbox(text) TO anon, authenticated, service_role;