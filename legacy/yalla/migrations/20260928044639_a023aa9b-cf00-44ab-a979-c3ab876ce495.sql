CREATE TABLE public.client_portal_preferences (
  user_id uuid PRIMARY KEY,
  company_name text,
  preferred_contact text NOT NULL DEFAULT 'email' CHECK (preferred_contact IN ('email','phone','whatsapp')),
  email_updates boolean NOT NULL DEFAULT true,
  sms_updates boolean NOT NULL DEFAULT false,
  marketing_updates boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.client_portal_preferences TO authenticated;
GRANT ALL ON public.client_portal_preferences TO service_role;
ALTER TABLE public.client_portal_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clients manage own portal preferences" ON public.client_portal_preferences
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Profile + preferences update for the signed-in client.
CREATE OR REPLACE FUNCTION public.client_portal_update_profile(_full_name text, _phone text, _company text,
  _preferred_contact text, _email_updates boolean, _sms_updates boolean, _marketing_updates boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'SIGN_IN_REQUIRED'); END IF;
  IF length(coalesce(_full_name,'')) > 120 OR length(coalesce(_company,'')) > 160 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'TOO_LONG'); END IF;
  IF nullif(trim(coalesce(_phone,'')),'') IS NOT NULL AND trim(_phone) !~ '^\+?[0-9 ]{9,16}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PHONE'); END IF;
  IF coalesce(_preferred_contact,'email') NOT IN ('email','phone','whatsapp') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PREFERENCE'); END IF;
  UPDATE public.profiles SET full_name = nullif(trim(_full_name),''), phone = nullif(trim(_phone),''), updated_at = now()
   WHERE user_id = v_uid;
  IF NOT FOUND THEN
    INSERT INTO public.profiles(user_id, full_name, phone) VALUES (v_uid, nullif(trim(_full_name),''), nullif(trim(_phone),''));
  END IF;
  INSERT INTO public.client_portal_preferences(user_id, company_name, preferred_contact, email_updates, sms_updates, marketing_updates)
  VALUES (v_uid, nullif(trim(_company),''), coalesce(_preferred_contact,'email'), coalesce(_email_updates,true), coalesce(_sms_updates,false), coalesce(_marketing_updates,false))
  ON CONFLICT (user_id) DO UPDATE SET company_name = EXCLUDED.company_name, preferred_contact = EXCLUDED.preferred_contact,
    email_updates = EXCLUDED.email_updates, sms_updates = EXCLUDED.sms_updates, marketing_updates = EXCLUDED.marketing_updates, updated_at = now();
  RETURN jsonb_build_object('ok', true);
END $f$;
REVOKE ALL ON FUNCTION public.client_portal_update_profile(text,text,text,text,boolean,boolean,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_update_profile(text,text,text,text,boolean,boolean,boolean) TO authenticated;

-- Client reply: only to a conversation already addressed to this client's own verified address.
CREATE OR REPLACE FUNCTION public.client_portal_reply(_message_id uuid, _body text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_uid uuid := auth.uid(); v_email text; v_name text; m public.comms_messages; ac public.comms_accounts;
  v_key text; v_to text; v_new uuid; v_recent int;
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
  -- notify@ is a no-reply sender: replies to system emails go to sales@.
  v_to := CASE WHEN lower(ac.mailbox_address) = 'notify@yalla.africa' THEN 'sales@yalla.africa' ELSE ac.mailbox_address END;
  SELECT external_thread_key INTO v_key FROM public.comms_threads WHERE id = m.thread_id;
  IF v_to <> ac.mailbox_address THEN v_key := NULL; END IF;
  SELECT full_name INTO v_name FROM public.profiles WHERE user_id = v_uid;
  v_new := public.comms_message_ingest(
    v_to, 'inbound', now(), v_email, coalesce(v_name, v_email), ARRAY[v_to], '{}',
    CASE WHEN m.subject ILIKE 're:%' THEN m.subject ELSE 'Re: ' || coalesce(m.subject,'') END,
    trim(_body), NULL, '<portal-' || gen_random_uuid() || '@yalla.africa>', v_key,
    'client_portal', gen_random_uuid()::text, 'external', NULL,
    jsonb_build_object('in_reply_to_message', m.id, 'via', 'client_portal'));
  RETURN jsonb_build_object('ok', true, 'id', v_new, 'to', v_to);
END $f$;
REVOKE ALL ON FUNCTION public.client_portal_reply(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_reply(uuid, text) TO authenticated;

-- Dashboard: profile, preferences, bookings, invoices, inbox for the signed-in client.
CREATE OR REPLACE FUNCTION public.client_portal_dashboard()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_uid uuid := auth.uid(); v_base jsonb; v_email text; v_inv jsonb; v_prof jsonb;
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
  SELECT jsonb_build_object('full_name', p.full_name, 'phone', p.phone,
     'company_name', cp.company_name, 'preferred_contact', coalesce(cp.preferred_contact,'email'),
     'email_updates', coalesce(cp.email_updates,true), 'sms_updates', coalesce(cp.sms_updates,false),
     'marketing_updates', coalesce(cp.marketing_updates,false))
    INTO v_prof FROM (SELECT v_uid u) x
    LEFT JOIN public.profiles p ON p.user_id = x.u
    LEFT JOIN public.client_portal_preferences cp ON cp.user_id = x.u;
  RETURN v_base || jsonb_build_object('invoices', v_inv, 'profile', v_prof);
END $f$;
REVOKE ALL ON FUNCTION public.client_portal_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.client_portal_dashboard() TO authenticated;