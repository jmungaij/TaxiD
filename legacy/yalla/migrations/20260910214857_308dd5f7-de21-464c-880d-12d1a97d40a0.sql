-- Inbound reply automatically raises a follow-up for the owning specialist.
CREATE OR REPLACE FUNCTION public._sales_lead_reply_raises_followup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _lead public.sales_leads;
  _action text;
  _days int := 1;
  _today date := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  _id uuid;
BEGIN
  IF NEW.direction <> 'INBOUND' THEN RETURN NEW; END IF;

  SELECT * INTO _lead FROM public.sales_leads WHERE id = NEW.lead_id;
  IF _lead.id IS NULL THEN RETURN NEW; END IF;

  -- Don't stack automatic items: one open auto follow-up per lead at a time.
  IF EXISTS (
    SELECT 1 FROM public.sales_lead_followups f
     WHERE f.lead_id = NEW.lead_id AND f.status = 'OPEN' AND f.created_by IS NULL
  ) THEN
    RETURN NEW;
  END IF;

  _action := CASE COALESCE(NEW.intent, 'REPLIED')
    WHEN 'INTERESTED' THEN 'Call the contact and agree a requirements meeting'
    WHEN 'INFORMATION' THEN 'Send the information the contact asked for'
    WHEN 'NOT_INTERESTED' THEN 'Acknowledge, record the reason and agree a review date'
    ELSE 'Answer the question raised in the reply'
  END;
  IF COALESCE(NEW.intent,'REPLIED') = 'NOT_INTERESTED' THEN _days := 2; END IF;

  INSERT INTO public.sales_lead_followups(
    lead_id, sales_staff_id, logged_note, contact_date, next_action, due_date, created_by)
  VALUES (
    NEW.lead_id, _lead.sales_staff_id,
    'Lead replied: ' || left(btrim(NEW.body), 500),
    _today, _action, _today + _days, NULL)
  RETURNING id INTO _id;

  INSERT INTO public.sales_lead_events(lead_id, action, note, detail)
  VALUES (NEW.lead_id, 'FOLLOWUP_AUTO_RAISED', _action,
          jsonb_build_object('followup_id', _id, 'message_id', NEW.id,
                             'intent', COALESCE(NEW.intent,'REPLIED'), 'source', 'REPLY'));

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sales_lead_reply_followup ON public.sales_lead_messages;
CREATE TRIGGER trg_sales_lead_reply_followup
AFTER INSERT ON public.sales_lead_messages
FOR EACH ROW EXECUTE FUNCTION public._sales_lead_reply_raises_followup();

-- Lead-facing view: their own conversation and status. Internal notes stay internal.
CREATE OR REPLACE FUNCTION public.sales_lead_contact_view(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _l public.sales_leads; _thread jsonb;
BEGIN
  SELECT * INTO _l FROM public.sales_leads
   WHERE contact_token IS NOT NULL AND contact_token = p->>'token';
  IF _l.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_LINK'); END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at), '[]'::jsonb) INTO _thread
  FROM (
    SELECT m.created_at,
           m.direction,
           m.subject,
           left(m.body, 4000) AS body,
           CASE WHEN m.direction = 'OUTBOUND' THEN 'Yalla Mobility' ELSE COALESCE(m.sender_name, 'You') END AS author
      FROM public.sales_lead_messages m
     WHERE m.lead_id = _l.id
       AND m.channel <> 'INTERNAL_NOTE'
     ORDER BY m.created_at
  ) t;

  RETURN jsonb_build_object('ok', true,
    'lead_ref', _l.lead_ref,
    'organisation_name', _l.organisation_name,
    'contact_name', _l.contact_name,
    'service_interest', _l.service_interest,
    'contact_state', _l.contact_state,
    'last_contacted_at', _l.last_contacted_at,
    'last_reply_at', _l.last_reply_at,
    'information_request', _l.information_request,
    'thread', _thread);
END $$;

REVOKE ALL ON FUNCTION public.sales_lead_contact_view(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_lead_contact_view(jsonb) TO anon, authenticated, service_role;