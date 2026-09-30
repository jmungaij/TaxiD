
CREATE TABLE IF NOT EXISTS public.comms_unified_readers (
  staff_id uuid PRIMARY KEY REFERENCES public.staff_members(id) ON DELETE CASCADE,
  reason text NOT NULL,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.comms_unified_readers TO authenticated;
GRANT ALL ON public.comms_unified_readers TO service_role;
ALTER TABLE public.comms_unified_readers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS comms_unified_readers_self ON public.comms_unified_readers;
CREATE POLICY comms_unified_readers_self ON public.comms_unified_readers
  FOR SELECT TO authenticated
  USING (staff_id = public.comms_my_staff_id());

CREATE OR REPLACE FUNCTION public.comms_is_unified_reader()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.comms_unified_readers r
    WHERE r.staff_id = public.comms_my_staff_id()
  );
$$;

REVOKE ALL ON FUNCTION public.comms_is_unified_reader() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comms_is_unified_reader() TO authenticated, service_role;

INSERT INTO public.comms_unified_readers (staff_id, reason)
SELECT s.id, 'Named unified-inbox reader (owner decision 2026-09-17)'
FROM public.staff_members s
WHERE s.user_id IS NOT NULL
  AND lower(s.work_email) IN ('charles.gateru@yalla.africa', 'jmungai@yalla.africa', 'admin@yalla.africa')
ON CONFLICT (staff_id) DO NOTHING;

UPDATE public.comms_accounts
SET is_privileged = true
WHERE mailbox_address IN (
  'sales@yalla.africa','support@yalla.africa','operations@yalla.africa',
  'finance@yalla.africa','hr@yalla.africa','management@yalla.africa','notify@yalla.africa'
);

CREATE OR REPLACE FUNCTION public.comms_can_read_account(_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN (SELECT ac.is_privileged FROM public.comms_accounts ac WHERE ac.id = _account_id)
      THEN public.comms_is_unified_reader()
    ELSE EXISTS (
      SELECT 1
      FROM public.comms_account_grants g
      WHERE g.account_id = _account_id
        AND (
          (g.staff_id IS NOT NULL AND g.staff_id = public.comms_my_staff_id())
          OR (g.role_key IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.user_roles ur
                WHERE ur.user_id = auth.uid() AND ur.role::text = g.role_key))
        )
    )
  END;
$$;

DELETE FROM public.comms_account_grants g
USING public.staff_members s
WHERE g.staff_id = s.id
  AND lower(s.work_email) = 'cnyambura@yalla.africa';

CREATE OR REPLACE FUNCTION public.comms_ensure_my_mailbox()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _staff public.staff_members; _account_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _staff FROM public.staff_members WHERE user_id = auth.uid() LIMIT 1;
  IF _staff.id IS NULL THEN RAISE EXCEPTION 'COMMS_NO_STAFF_RECORD'; END IF;
  IF _staff.work_email IS NULL OR _staff.work_email = '' THEN
    RAISE EXCEPTION 'COMMS_NO_WORK_EMAIL';
  END IF;

  SELECT id INTO _account_id FROM public.comms_accounts
  WHERE lower(mailbox_address) = lower(_staff.work_email);

  IF _account_id IS NULL THEN
    INSERT INTO public.comms_accounts (
      mailbox_address, display_name, provider, department, status, sync_enabled, is_privileged
    ) VALUES (
      lower(_staff.work_email), _staff.full_name, 'imap', NULL, 'not_connected', false, false
    ) RETURNING id INTO _account_id;
  END IF;

  INSERT INTO public.comms_account_grants (account_id, staff_id, permission)
  SELECT _account_id, _staff.id, v.p::comms_grant_permission
  FROM (VALUES ('read'), ('reply')) v(p)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.comms_account_grants g
    WHERE g.account_id = _account_id AND g.staff_id = _staff.id
      AND g.permission = v.p::comms_grant_permission
  );

  RETURN jsonb_build_object(
    'account_id', _account_id,
    'mailbox_address', lower(_staff.work_email),
    'display_name', _staff.full_name
  );
END; $$;

REVOKE ALL ON FUNCTION public.comms_ensure_my_mailbox() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comms_ensure_my_mailbox() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.comms_can_send_from(_account_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.comms_account_grants g
    WHERE g.account_id = _account_id
      AND g.staff_id = public.comms_my_staff_id()
      AND g.permission = 'reply'::comms_grant_permission
  ) OR (
    coalesce((SELECT ac.is_privileged FROM public.comms_accounts ac WHERE ac.id = _account_id), false)
    AND public.comms_is_unified_reader()
  );
$$;

REVOKE ALL ON FUNCTION public.comms_can_send_from(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comms_can_send_from(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.comms_record_outbound(
  _account_id uuid,
  _sender_staff_id uuid,
  _from_address text,
  _to_addresses text[],
  _cc_addresses text[],
  _subject text,
  _body text,
  _provider_message_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _thread_id uuid; _name text;
BEGIN
  SELECT full_name INTO _name FROM public.staff_members WHERE id = _sender_staff_id;

  INSERT INTO public.comms_threads (
    account_id, subject, counterparty_name, counterparty_email, category, status,
    priority, owner_staff_id, message_count, inbound_count, outbound_count,
    first_activity_at, last_activity_at, last_direction
  ) VALUES (
    _account_id, coalesce(nullif(_subject,''), '(no subject)'), NULL, _to_addresses[1],
    'external', 'replied', 'normal', _sender_staff_id, 1, 0, 1, now(), now(), 'outbound'
  ) RETURNING id INTO _thread_id;

  INSERT INTO public.comms_messages (
    thread_id, account_id, direction, provider_message_id, source,
    from_address, from_name, to_addresses, cc_addresses, subject,
    body_preview, delivery_status, occurred_at
  ) VALUES (
    _thread_id, _account_id, 'outbound', _provider_message_id, 'workspace_compose',
    _from_address, _name, coalesce(_to_addresses,'{}'), coalesce(_cc_addresses,'{}'),
    _subject, left(_body, 4000), 'sent', now()
  );

  RETURN _thread_id;
END; $$;

REVOKE ALL ON FUNCTION public.comms_record_outbound(uuid,uuid,text,text[],text[],text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comms_record_outbound(uuid,uuid,text,text[],text[],text,text,text) TO service_role;
