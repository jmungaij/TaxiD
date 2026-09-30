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
    'last_outreach_at', _l.last_outreach_at,
    'last_reply_at', _l.last_reply_at,
    'information_request', _l.information_request,
    'thread', _thread);
END $$;

REVOKE ALL ON FUNCTION public.sales_lead_contact_view(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_lead_contact_view(jsonb) TO anon, authenticated, service_role;