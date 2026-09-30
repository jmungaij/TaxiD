-- 1. Ownership: the real commercial book belongs to Candice Nyambura Irungu.
DO $$
DECLARE v_staff uuid; v_user uuid; v_acct uuid; v_opp uuid;
BEGIN
  SELECT id, user_id INTO v_staff, v_user FROM public.staff_members WHERE lower(work_email) = 'cnyambura@yalla.africa';
  IF v_staff IS NULL THEN RAISE EXCEPTION 'Owner staff record not found'; END IF;

  UPDATE public.crm_accounts SET owner_staff_id = v_staff, updated_at = now()
   WHERE account_ref IN ('ACC-DECAGON-001','ACC-395A406129');

  UPDATE public.commercial_opportunities SET owner_user_id = v_user, updated_at = now()
   WHERE owner_user_id IS DISTINCT FROM v_user;

  UPDATE public.commercial_quotations SET owner_staff_id = v_staff, updated_at = now();
  UPDATE public.commercial_contract_instances SET owner_staff_id = v_staff, updated_at = now();
  UPDATE public.crm_opportunity_links SET owner_staff_id = v_staff, updated_at = now();

  SELECT id INTO v_acct FROM public.crm_accounts WHERE account_ref = 'ACC-DECAGON-001';
  FOR v_opp IN SELECT id FROM public.commercial_opportunities LOOP
    IF NOT EXISTS (SELECT 1 FROM public.crm_opportunity_links WHERE opportunity_id = v_opp) THEN
      INSERT INTO public.crm_opportunity_links (opportunity_id, account_id, owner_staff_id, created_by)
      VALUES (v_opp, v_acct, v_staff, v_user);
    END IF;
  END LOOP;
END $$;

-- 2. Email → CRM interaction, recorded once per email.
ALTER TABLE public.crm_interactions
  ADD COLUMN IF NOT EXISTS email_message_id uuid REFERENCES public.comms_messages(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS crm_interactions_email_message_id_key
  ON public.crm_interactions(email_message_id) WHERE email_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.crm_log_email_interaction(p_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

  RETURN jsonb_build_object('interaction_id', v_id, 'created', true, 'matched', v_account IS NOT NULL);
END $$;

REVOKE ALL ON FUNCTION public.crm_log_email_interaction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_log_email_interaction(uuid) TO authenticated;