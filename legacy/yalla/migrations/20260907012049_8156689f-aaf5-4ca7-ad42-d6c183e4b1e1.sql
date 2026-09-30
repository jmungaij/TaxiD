ALTER TABLE public.comms_accounts
  ADD COLUMN IF NOT EXISTS is_privileged boolean NOT NULL DEFAULT false;

UPDATE public.comms_accounts
   SET is_privileged = true
 WHERE mailbox_address IN (
   'management@yalla.africa','finance@yalla.africa','hr@yalla.africa','notify@yalla.africa',
   'contact-internal-notification','contact-confirmation','ops-readiness-test'
 );

-- Manager level and above: platform administration, board/GM oversight, department heads.
CREATE OR REPLACE FUNCTION public.comms_is_manager()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role::text IN (
        'admin','super_admin','director','general_manager',
        'finance_admin','compliance_admin','operations_admin','operations_manager'
      )
  );
$$;
REVOKE ALL ON FUNCTION public.comms_is_manager() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comms_is_manager() TO authenticated;

-- Account read: privileged mailboxes need an administrator or an explicit grant.
CREATE OR REPLACE FUNCTION public.comms_can_read_account(_account_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.comms_is_administrator()
     OR EXISTS (
       SELECT 1
       FROM public.comms_account_grants g
       WHERE g.account_id = _account_id
         AND (
           (g.staff_id IS NOT NULL AND g.staff_id = public.comms_my_staff_id())
           OR (g.role_key IS NOT NULL AND EXISTS (
                 SELECT 1 FROM public.user_roles ur
                 WHERE ur.user_id = auth.uid() AND ur.role::text = g.role_key))
         )
     );
$$;

-- Thread read: the ownership / participant fallbacks NEVER open a privileged mailbox.
CREATE OR REPLACE FUNCTION public.comms_can_read_thread(_thread_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH t AS (
    SELECT th.account_id, th.owner_staff_id, ac.is_privileged
    FROM public.comms_threads th
    JOIN public.comms_accounts ac ON ac.id = th.account_id
    WHERE th.id = _thread_id
  )
  SELECT EXISTS (
    SELECT 1 FROM t WHERE public.comms_can_read_account(t.account_id)
  ) OR EXISTS (
    SELECT 1 FROM t
    WHERE NOT t.is_privileged
      AND t.owner_staff_id IS NOT NULL
      AND t.owner_staff_id = public.comms_my_staff_id()
  ) OR EXISTS (
    SELECT 1
    FROM t
    JOIN public.comms_messages m ON m.thread_id = _thread_id
    JOIN public.staff_members s ON s.user_id = auth.uid()
    WHERE NOT t.is_privileged
      AND s.work_email IS NOT NULL
      AND (lower(s.work_email) = lower(coalesce(m.from_address,''))
           OR lower(s.work_email) = ANY (SELECT lower(x) FROM unnest(m.to_addresses || m.cc_addresses) x))
  );
$$;

-- Overview: the organisation-wide scope is manager level only; others fall back to their own mail.
CREATE OR REPLACE FUNCTION public.comms_overview(_scope text DEFAULT 'management')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _staff uuid; _admin boolean; _manager boolean; _threads jsonb; _accounts jsonb; _tiles jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  _staff := public.comms_my_staff_id();
  _admin := public.comms_is_administrator();
  _manager := public.comms_is_manager();

  IF _scope = 'management' AND NOT _manager THEN
    _scope := 'mine';
  END IF;

  SELECT coalesce(jsonb_agg(a ORDER BY a->>'display_name'), '[]'::jsonb) INTO _accounts
  FROM (
    SELECT to_jsonb(x) AS a FROM (
      SELECT ac.id, ac.mailbox_address, ac.display_name, ac.provider::text AS provider,
             ac.department, ac.status, ac.sync_enabled, ac.last_sync_at, ac.last_sync_status, ac.last_sync_error
      FROM public.comms_accounts ac
      WHERE public.comms_can_read_account(ac.id)
    ) x
  ) s;

  SELECT coalesce(jsonb_agg(t ORDER BY (t->>'last_activity_at') DESC), '[]'::jsonb) INTO _threads
  FROM (
    SELECT to_jsonb(y) AS t FROM (
      SELECT th.id, th.subject, th.counterparty_name, th.counterparty_email,
             th.category::text AS category, th.status::text AS status, th.priority,
             th.message_count, th.inbound_count, th.outbound_count,
             th.last_activity_at, th.last_direction::text AS last_direction,
             ac.mailbox_address, ac.display_name AS account_name,
             sm.full_name AS owner_name
      FROM public.comms_threads th
      JOIN public.comms_accounts ac ON ac.id = th.account_id
      LEFT JOIN public.staff_members sm ON sm.id = th.owner_staff_id
      WHERE public.comms_can_read_thread(th.id)
        AND (_scope <> 'mine' OR th.owner_staff_id = _staff OR public.comms_can_read_account(th.account_id))
      ORDER BY th.last_activity_at DESC
      LIMIT 300
    ) y
  ) s2;

  SELECT jsonb_build_object(
    'total', coalesce(jsonb_array_length(_threads),0),
    'unread', (SELECT count(*) FROM jsonb_array_elements(_threads) e WHERE e->>'status' = 'unread'),
    'pending', (SELECT count(*) FROM jsonb_array_elements(_threads) e WHERE e->>'status' = 'pending'),
    'escalated', (SELECT count(*) FROM jsonb_array_elements(_threads) e WHERE e->>'status' = 'escalated'),
    'inbound', (SELECT coalesce(sum((e->>'inbound_count')::int),0) FROM jsonb_array_elements(_threads) e),
    'outbound', (SELECT coalesce(sum((e->>'outbound_count')::int),0) FROM jsonb_array_elements(_threads) e)
  ) INTO _tiles;

  RETURN jsonb_build_object(
    'scope', _scope, 'generated_at', now(), 'is_administrator', _admin,
    'is_manager', _manager,
    'staff_id', _staff, 'accounts', _accounts, 'threads', _threads, 'tiles', _tiles
  );
END; $$;
REVOKE ALL ON FUNCTION public.comms_overview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comms_overview(text) TO authenticated;