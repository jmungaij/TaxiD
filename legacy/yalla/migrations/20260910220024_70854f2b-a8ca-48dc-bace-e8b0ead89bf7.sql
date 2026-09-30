ALTER TABLE public.sales_leads
  ADD COLUMN IF NOT EXISTS first_outreach_at timestamptz;

UPDATE public.sales_leads l
   SET first_outreach_at = m.first_at
  FROM (
    SELECT lead_id, min(created_at) AS first_at
      FROM public.sales_lead_messages
     WHERE direction = 'OUTBOUND'
     GROUP BY lead_id
  ) m
 WHERE m.lead_id = l.id AND l.first_outreach_at IS NULL;

UPDATE public.sales_leads
   SET first_outreach_at = last_outreach_at
 WHERE first_outreach_at IS NULL AND last_outreach_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public._sales_lead_message_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.direction = 'OUTBOUND' THEN
    UPDATE public.sales_leads
       SET last_outreach_at = NEW.created_at,
           first_outreach_at = COALESCE(first_outreach_at, NEW.created_at),
           contact_state = CASE
             WHEN contact_state IN ('REPLIED','NOT_INTERESTED') THEN contact_state
             ELSE 'CONTACTED' END,
           updated_at = now()
     WHERE id = NEW.lead_id;
  ELSE
    UPDATE public.sales_leads
       SET last_reply_at = NEW.created_at,
           first_reply_at = COALESCE(first_reply_at, NEW.created_at),
           contact_state = CASE
             WHEN NEW.intent = 'NOT_INTERESTED' THEN 'NOT_INTERESTED'
             ELSE 'REPLIED' END,
           updated_at = now()
     WHERE id = NEW.lead_id;
  END IF;
  RETURN NEW;
END $$;