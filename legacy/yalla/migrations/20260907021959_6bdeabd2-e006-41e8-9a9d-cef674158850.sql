CREATE OR REPLACE FUNCTION public.crm_log_email_interaction(p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m record; v_staff uuid; v_account uuid; v_contact uuid; v_existing uuid; v_domain text; v_id uuid;
BEGIN
  SELECT id INTO v_staff FROM public.staff_members WHERE user_id = auth.uid();
  IF v_staff IS NULL THEN RAISE EXCEPTION 'Only staff members can record CRM interactions'; END IF;

  SELECT * INTO m FROM public.comms_messages WHERE id = p_message_id;
  IF m.id IS NULL THEN RAISE EXCEPTION 'This email does not exist'; END IF;
  IF NOT public.comms_can_read_thread(m.thread_id) THEN
    RAISE EXCEPTION 'This email is not released to your account';
  END IF;

  SELECT id INTO v_existing FROM public.crm_interactions WHERE email_message_id = p_message_id;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('interaction_id', v_existing, 'created', false, 'matched', true);
  END IF;

  v_domain := lower(split_part(coalesce(m.from_address,''), '@', 2));

  SELECT c.id, c.account_id INTO v_contact, v_account
    FROM public.crm_contacts c
   WHERE lower(c.email) = lower(coalesce(m.from_address,''))
   LIMIT 1;

  IF v_account IS NULL AND v_domain <> '' AND v_domain <> 'yalla.africa' THEN
    SELECT a.id INTO v_account FROM public.crm_accounts a
     WHERE lower(coalesce(a.website,'')) LIKE '%' || v_domain || '%'
     LIMIT 1;
    IF v_account IS NULL THEN
      SELECT c.account_id INTO v_account FROM public.crm_contacts c
       WHERE lower(coalesce(c.email,'')) LIKE '%@' || v_domain LIMIT 1;
    END IF;
  END IF;

  IF v_account IS NULL THEN
    RETURN jsonb_build_object('interaction_id', NULL, 'created', false, 'matched', false);
  END IF;

  INSERT INTO public.crm_interactions (
    account_id, contact_id, staff_id, interaction_type, direction, subject, summary,
    occurred_at, provenance, created_by, email_message_id
  ) VALUES (
    v_account, v_contact, v_staff, 'email',
    CASE WHEN m.direction::text = 'outbound' THEN 'outbound' ELSE 'inbound' END,
    coalesce(nullif(m.subject,''), '(no subject)'),
    left(coalesce(nullif(m.body_preview,''), 'Email from ' || coalesce(m.from_address,'unknown sender')), 4000),
    m.occurred_at, 'EMAIL_INGEST', auth.uid(), p_message_id
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('interaction_id', v_id, 'created', true, 'matched', true);
END $function$;