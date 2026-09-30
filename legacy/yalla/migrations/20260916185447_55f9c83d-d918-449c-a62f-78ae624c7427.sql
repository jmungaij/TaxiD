CREATE TABLE IF NOT EXISTS public.client_portal_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  recipient_email text,
  recipient_name text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  opens integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_staff_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_portal_grants_account_idx ON public.client_portal_grants(account_id);

GRANT SELECT, INSERT, UPDATE ON public.client_portal_grants TO authenticated;
GRANT ALL ON public.client_portal_grants TO service_role;

ALTER TABLE public.client_portal_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_portal_grants_read ON public.client_portal_grants;
CREATE POLICY client_portal_grants_read ON public.client_portal_grants
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.crm.read'));

DROP POLICY IF EXISTS client_portal_grants_write ON public.client_portal_grants;
CREATE POLICY client_portal_grants_write ON public.client_portal_grants
  FOR UPDATE TO authenticated
  USING (public.has_staff_permission('staff.crm.manage'))
  WITH CHECK (public.has_staff_permission('staff.crm.manage'));

CREATE OR REPLACE FUNCTION public._client_portal_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_client_portal_grants_touch ON public.client_portal_grants;
CREATE TRIGGER trg_client_portal_grants_touch BEFORE UPDATE ON public.client_portal_grants
  FOR EACH ROW EXECUTE FUNCTION public._client_portal_touch();

-- Issue a link ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_portal_grant_create(
  _account uuid, _email text DEFAULT NULL, _name text DEFAULT NULL, _days integer DEFAULT 60
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_token text; v_id uuid; v_name text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTHENTICATION_REQUIRED'); END IF;
  IF public.has_staff_permission('staff.crm.manage') IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  END IF;
  SELECT name INTO v_name FROM public.crm_accounts WHERE id = _account;
  IF v_name IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'ACCOUNT_NOT_FOUND'); END IF;

  v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');

  INSERT INTO public.client_portal_grants
    (account_id, token_hash, recipient_email, recipient_name, expires_at, created_by, created_staff_id)
  VALUES (_account, encode(sha256(convert_to(v_token,'utf8')),'hex'),
          nullif(trim(coalesce(_email,'')),''), nullif(trim(coalesce(_name,'')),''),
          now() + make_interval(days => greatest(1, least(coalesce(_days,60), 180))),
          auth.uid(), public._my_staff_member_id())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'grant_id', v_id, 'account', v_name,
                            'token', v_token, 'path', '/my/yalla/' || v_token);
END $$;

REVOKE ALL ON FUNCTION public.client_portal_grant_create(uuid, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_portal_grant_create(uuid, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_grant_create(uuid, text, text, integer) TO service_role;

-- Withdraw a link ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_portal_grant_revoke(_grant uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.has_staff_permission('staff.crm.manage') IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  END IF;
  UPDATE public.client_portal_grants SET revoked_at = coalesce(revoked_at, now()) WHERE id = _grant;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'LINK_NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION public.client_portal_grant_revoke(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_portal_grant_revoke(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_grant_revoke(uuid) TO service_role;

-- Open the portal ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.client_portal_open(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g public.client_portal_grants; a public.crm_accounts;
        v_quotes jsonb; v_contracts jsonb; v_rides jsonb;
BEGIN
  IF coalesce(length(trim(coalesce(_token,''))),0) < 32 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LINK');
  END IF;
  SELECT * INTO g FROM public.client_portal_grants
   WHERE token_hash = encode(sha256(convert_to(trim(_token),'utf8')),'hex');
  IF g.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LINK'); END IF;
  IF g.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'LINK_REVOKED'); END IF;
  IF g.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'error', 'LINK_EXPIRED'); END IF;

  SELECT * INTO a FROM public.crm_accounts WHERE id = g.account_id;
  IF a.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'ACCOUNT_NOT_FOUND'); END IF;

  UPDATE public.client_portal_grants
     SET first_opened_at = coalesce(first_opened_at, now()), last_opened_at = now(), opens = opens + 1
   WHERE id = g.id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'quote_number', q.quote_number, 'total_amount', q.total_amount, 'currency', q.currency,
           'status', q.status, 'valid_until', q.valid_until, 'created_at', q.created_at
         ) ORDER BY q.created_at DESC), '[]'::jsonb)
    INTO v_quotes
    FROM public.commercial_quotations q
   WHERE q.account_id = a.id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'contract_number', c.contract_number, 'title', c.title, 'status', c.status,
           'value_amount', c.value_amount, 'currency', c.currency, 'value_type', c.value_type,
           'term_start', c.term_start, 'term_end', c.term_end, 'signature_date', c.signature_date,
           'payment_terms', c.payment_terms, 'created_at', c.created_at
         ) ORDER BY c.created_at DESC), '[]'::jsonb)
    INTO v_contracts
    FROM public.commercial_contract_instances c
   WHERE c.account_id = a.id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'booking_number', b.booking_number, 'pickup', b.pickup_address, 'dropoff', b.dropoff_address,
           'scheduled_for', b.scheduled_for, 'status', b.status, 'total_fare', b.total_fare,
           'currency', b.currency, 'payment_status', b.payment_status, 'created_at', b.created_at
         ) ORDER BY b.created_at DESC), '[]'::jsonb)
    INTO v_rides
    FROM public.corporate_ride_approvals ra
    JOIN public.trip_bookings b ON b.id = ra.booking_id
   WHERE a.corporate_id IS NOT NULL AND ra.corporate_id = a.corporate_id;

  RETURN jsonb_build_object(
    'ok', true,
    'account', jsonb_build_object('name', a.name, 'account_ref', a.account_ref, 'city', a.city, 'country', a.country),
    'recipient_name', g.recipient_name,
    'recipient_email', g.recipient_email,
    'expires_at', g.expires_at,
    'quotes', v_quotes,
    'contracts', v_contracts,
    'rides', v_rides
  );
END $$;

REVOKE ALL ON FUNCTION public.client_portal_open(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_portal_open(text) TO anon;
GRANT EXECUTE ON FUNCTION public.client_portal_open(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_portal_open(text) TO service_role;