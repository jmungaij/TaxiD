
-- ============ Communication Command Centre ============
CREATE TYPE public.comms_provider AS ENUM ('microsoft_graph','gmail_api','imap','platform');
CREATE TYPE public.comms_direction AS ENUM ('inbound','outbound');
CREATE TYPE public.comms_thread_status AS ENUM ('unread','pending','replied','escalated','closed');
CREATE TYPE public.comms_category AS ENUM ('internal','external','enquiry','notification');
CREATE TYPE public.comms_grant_permission AS ENUM ('read','assign','reply','export');

-- ---------- accounts ----------
CREATE TABLE public.comms_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mailbox_address text NOT NULL UNIQUE,
  display_name text NOT NULL,
  provider public.comms_provider NOT NULL DEFAULT 'platform',
  department text,
  business_entity text,
  status text NOT NULL DEFAULT 'not_connected',
  credential_secret_ref text,
  sync_enabled boolean NOT NULL DEFAULT false,
  sync_cursor text,
  last_sync_at timestamptz,
  last_sync_status text,
  last_sync_error text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comms_accounts_status_chk CHECK (status IN ('not_connected','connecting','connected','error','disabled'))
);
GRANT SELECT ON public.comms_accounts TO authenticated;
GRANT ALL ON public.comms_accounts TO service_role;
ALTER TABLE public.comms_accounts ENABLE ROW LEVEL SECURITY;

-- ---------- grants ----------
CREATE TABLE public.comms_account_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.comms_accounts(id) ON DELETE CASCADE,
  role_key text,
  staff_id uuid REFERENCES public.staff_members(id) ON DELETE CASCADE,
  permission public.comms_grant_permission NOT NULL DEFAULT 'read',
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comms_grant_subject_chk CHECK ((role_key IS NOT NULL) <> (staff_id IS NOT NULL))
);
CREATE UNIQUE INDEX comms_grant_role_uk ON public.comms_account_grants(account_id, role_key, permission) WHERE role_key IS NOT NULL;
CREATE UNIQUE INDEX comms_grant_staff_uk ON public.comms_account_grants(account_id, staff_id, permission) WHERE staff_id IS NOT NULL;
GRANT SELECT ON public.comms_account_grants TO authenticated;
GRANT ALL ON public.comms_account_grants TO service_role;
ALTER TABLE public.comms_account_grants ENABLE ROW LEVEL SECURITY;

-- ---------- threads ----------
CREATE TABLE public.comms_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.comms_accounts(id) ON DELETE CASCADE,
  external_thread_key text,
  subject text NOT NULL DEFAULT '(no subject)',
  counterparty_name text,
  counterparty_email text,
  category public.comms_category NOT NULL DEFAULT 'external',
  status public.comms_thread_status NOT NULL DEFAULT 'unread',
  priority text NOT NULL DEFAULT 'normal',
  owner_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  message_count integer NOT NULL DEFAULT 0,
  inbound_count integer NOT NULL DEFAULT 0,
  outbound_count integer NOT NULL DEFAULT 0,
  first_activity_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  last_direction public.comms_direction,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX comms_threads_external_uk ON public.comms_threads(account_id, external_thread_key) WHERE external_thread_key IS NOT NULL;
CREATE INDEX comms_threads_activity_idx ON public.comms_threads(last_activity_at DESC);
CREATE INDEX comms_threads_owner_idx ON public.comms_threads(owner_staff_id);
GRANT SELECT ON public.comms_threads TO authenticated;
GRANT ALL ON public.comms_threads TO service_role;
ALTER TABLE public.comms_threads ENABLE ROW LEVEL SECURITY;

-- ---------- messages ----------
CREATE TABLE public.comms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.comms_threads(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.comms_accounts(id) ON DELETE CASCADE,
  direction public.comms_direction NOT NULL,
  provider_message_id text,
  source text NOT NULL DEFAULT 'provider',
  source_id text,
  from_address text,
  from_name text,
  to_addresses text[] NOT NULL DEFAULT '{}',
  cc_addresses text[] NOT NULL DEFAULT '{}',
  subject text,
  body_preview text,
  body_html text,
  has_attachments boolean NOT NULL DEFAULT false,
  delivery_status text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX comms_messages_source_uk ON public.comms_messages(source, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX comms_messages_thread_idx ON public.comms_messages(thread_id, occurred_at);
GRANT SELECT ON public.comms_messages TO authenticated;
GRANT ALL ON public.comms_messages TO service_role;
ALTER TABLE public.comms_messages ENABLE ROW LEVEL SECURITY;

-- ---------- access audit ----------
CREATE TABLE public.comms_access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  actor_email text,
  action text NOT NULL,
  account_id uuid,
  thread_id uuid,
  message_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comms_access_events_created_idx ON public.comms_access_events(created_at DESC);
GRANT SELECT ON public.comms_access_events TO authenticated;
GRANT ALL ON public.comms_access_events TO service_role;
ALTER TABLE public.comms_access_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._comms_audit_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'comms_access_events is append-only'; END; $$;
CREATE TRIGGER comms_access_events_immutable
  BEFORE UPDATE OR DELETE ON public.comms_access_events
  FOR EACH ROW EXECUTE FUNCTION public._comms_audit_append_only();

-- ---------- sync runs ----------
CREATE TABLE public.comms_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.comms_accounts(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',
  direction text,
  messages_ingested integer NOT NULL DEFAULT 0,
  error_message text,
  triggered_by uuid
);
CREATE INDEX comms_sync_runs_account_idx ON public.comms_sync_runs(account_id, started_at DESC);
GRANT SELECT ON public.comms_sync_runs TO authenticated;
GRANT ALL ON public.comms_sync_runs TO service_role;
ALTER TABLE public.comms_sync_runs ENABLE ROW LEVEL SECURITY;

-- ---------- authorization helpers ----------
CREATE OR REPLACE FUNCTION public.comms_my_staff_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.staff_members WHERE user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.comms_is_administrator()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role::text IN ('admin','super_admin')
  );
$$;

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

CREATE OR REPLACE FUNCTION public.comms_can_read_thread(_thread_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH t AS (SELECT account_id, owner_staff_id FROM public.comms_threads WHERE id = _thread_id)
  SELECT EXISTS (
    SELECT 1 FROM t WHERE public.comms_can_read_account(t.account_id)
  ) OR EXISTS (
    SELECT 1 FROM t WHERE t.owner_staff_id IS NOT NULL AND t.owner_staff_id = public.comms_my_staff_id()
  ) OR EXISTS (
    SELECT 1
    FROM public.comms_messages m
    JOIN public.staff_members s ON s.user_id = auth.uid()
    WHERE m.thread_id = _thread_id
      AND s.work_email IS NOT NULL
      AND (lower(s.work_email) = lower(coalesce(m.from_address,''))
           OR lower(s.work_email) = ANY (SELECT lower(x) FROM unnest(m.to_addresses || m.cc_addresses) x))
  );
$$;

REVOKE ALL ON FUNCTION public.comms_my_staff_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comms_is_administrator() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comms_can_read_account(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comms_can_read_thread(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comms_my_staff_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.comms_is_administrator() TO authenticated;
GRANT EXECUTE ON FUNCTION public.comms_can_read_account(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.comms_can_read_thread(uuid) TO authenticated;

-- ---------- policies ----------
CREATE POLICY comms_accounts_read ON public.comms_accounts
  FOR SELECT TO authenticated USING (public.comms_can_read_account(id));

CREATE POLICY comms_grants_read ON public.comms_account_grants
  FOR SELECT TO authenticated USING (public.comms_is_administrator());

CREATE POLICY comms_threads_read ON public.comms_threads
  FOR SELECT TO authenticated USING (public.comms_can_read_thread(id));

CREATE POLICY comms_messages_read ON public.comms_messages
  FOR SELECT TO authenticated USING (public.comms_can_read_thread(thread_id));

CREATE POLICY comms_audit_read ON public.comms_access_events
  FOR SELECT TO authenticated USING (public.comms_is_administrator());

CREATE POLICY comms_sync_runs_read ON public.comms_sync_runs
  FOR SELECT TO authenticated USING (public.comms_can_read_account(account_id));

-- ---------- updated_at ----------
CREATE OR REPLACE FUNCTION public._comms_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER comms_accounts_touch BEFORE UPDATE ON public.comms_accounts FOR EACH ROW EXECUTE FUNCTION public._comms_touch();
CREATE TRIGGER comms_grants_touch BEFORE UPDATE ON public.comms_account_grants FOR EACH ROW EXECUTE FUNCTION public._comms_touch();
CREATE TRIGGER comms_threads_touch BEFORE UPDATE ON public.comms_threads FOR EACH ROW EXECUTE FUNCTION public._comms_touch();

-- ---------- audit writer ----------
CREATE OR REPLACE FUNCTION public.comms_log_access(_action text, _thread_id uuid DEFAULT NULL, _message_id uuid DEFAULT NULL, _account_id uuid DEFAULT NULL, _metadata jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF _thread_id IS NOT NULL AND NOT public.comms_can_read_thread(_thread_id) THEN
    RAISE EXCEPTION 'COMMS_NOT_AUTHORISED';
  END IF;
  INSERT INTO public.comms_access_events(actor_user_id, actor_email, action, account_id, thread_id, message_id, metadata)
  VALUES (auth.uid(), (SELECT email FROM auth.users WHERE id = auth.uid()), _action, _account_id, _thread_id, _message_id, coalesce(_metadata,'{}'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.comms_log_access(text,uuid,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comms_log_access(text,uuid,uuid,uuid,jsonb) TO authenticated;

-- ---------- management overview ----------
CREATE OR REPLACE FUNCTION public.comms_overview(_scope text DEFAULT 'management')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _staff uuid; _admin boolean; _threads jsonb; _accounts jsonb; _tiles jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  _staff := public.comms_my_staff_id();
  _admin := public.comms_is_administrator();

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
      WHERE CASE WHEN _scope = 'mine'
                 THEN th.owner_staff_id = _staff
                 ELSE public.comms_can_read_account(th.account_id)
            END
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
    'staff_id', _staff, 'accounts', _accounts, 'threads', _threads, 'tiles', _tiles
  );
END; $$;
REVOKE ALL ON FUNCTION public.comms_overview(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comms_overview(text) TO authenticated;

-- ---------- conversation open (audited) ----------
CREATE OR REPLACE FUNCTION public.comms_thread_detail(_thread_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _thread jsonb; _messages jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.comms_can_read_thread(_thread_id) THEN RAISE EXCEPTION 'COMMS_NOT_AUTHORISED'; END IF;

  SELECT to_jsonb(x) INTO _thread FROM (
    SELECT th.id, th.subject, th.counterparty_name, th.counterparty_email, th.category::text AS category,
           th.status::text AS status, th.priority, th.last_activity_at,
           ac.mailbox_address, ac.display_name AS account_name, sm.full_name AS owner_name
    FROM public.comms_threads th
    JOIN public.comms_accounts ac ON ac.id = th.account_id
    LEFT JOIN public.staff_members sm ON sm.id = th.owner_staff_id
    WHERE th.id = _thread_id
  ) x;

  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.occurred_at), '[]'::jsonb) INTO _messages FROM (
    SELECT id, direction::text AS direction, from_address, from_name, to_addresses, cc_addresses,
           subject, body_preview, body_html, delivery_status, has_attachments, occurred_at, source
    FROM public.comms_messages WHERE thread_id = _thread_id ORDER BY occurred_at
  ) m;

  PERFORM public.comms_log_access('thread_opened', _thread_id, NULL, NULL, '{}'::jsonb);
  RETURN jsonb_build_object('thread', _thread, 'messages', _messages);
END; $$;
REVOKE ALL ON FUNCTION public.comms_thread_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comms_thread_detail(uuid) TO authenticated;

-- ---------- thread actions ----------
CREATE OR REPLACE FUNCTION public.comms_thread_update(_thread_id uuid, _status text DEFAULT NULL, _owner_staff_id uuid DEFAULT NULL, _priority text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF NOT public.comms_can_read_thread(_thread_id) THEN RAISE EXCEPTION 'COMMS_NOT_AUTHORISED'; END IF;
  UPDATE public.comms_threads
     SET status = coalesce(_status::public.comms_thread_status, status),
         owner_staff_id = coalesce(_owner_staff_id, owner_staff_id),
         priority = coalesce(_priority, priority)
   WHERE id = _thread_id;
  PERFORM public.comms_log_access('thread_updated', _thread_id, NULL, NULL,
    jsonb_build_object('status', _status, 'owner_staff_id', _owner_staff_id, 'priority', _priority));
  RETURN jsonb_build_object('ok', true);
END; $$;
REVOKE ALL ON FUNCTION public.comms_thread_update(uuid,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comms_thread_update(uuid,text,uuid,text) TO authenticated;

-- ---------- account administration ----------
CREATE OR REPLACE FUNCTION public.comms_account_upsert(_mailbox_address text, _display_name text, _provider text, _department text DEFAULT NULL, _sync_enabled boolean DEFAULT false, _credential_secret_ref text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF NOT public.comms_is_administrator() THEN RAISE EXCEPTION 'COMMS_ADMIN_REQUIRED'; END IF;
  INSERT INTO public.comms_accounts(mailbox_address, display_name, provider, department, sync_enabled, credential_secret_ref, created_by)
  VALUES (lower(_mailbox_address), _display_name, _provider::public.comms_provider, _department, _sync_enabled, _credential_secret_ref, auth.uid())
  ON CONFLICT (mailbox_address) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        provider = EXCLUDED.provider,
        department = EXCLUDED.department,
        sync_enabled = EXCLUDED.sync_enabled,
        credential_secret_ref = coalesce(EXCLUDED.credential_secret_ref, public.comms_accounts.credential_secret_ref)
  RETURNING id INTO _id;
  PERFORM public.comms_log_access('account_upserted', NULL, NULL, _id, jsonb_build_object('mailbox', lower(_mailbox_address)));
  RETURN _id;
END; $$;
REVOKE ALL ON FUNCTION public.comms_account_upsert(text,text,text,text,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comms_account_upsert(text,text,text,text,boolean,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.comms_grant_set(_account_id uuid, _role_key text DEFAULT NULL, _staff_id uuid DEFAULT NULL, _permission text DEFAULT 'read')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF NOT public.comms_is_administrator() THEN RAISE EXCEPTION 'COMMS_ADMIN_REQUIRED'; END IF;
  INSERT INTO public.comms_account_grants(account_id, role_key, staff_id, permission, granted_by)
  VALUES (_account_id, _role_key, _staff_id, _permission::public.comms_grant_permission, auth.uid())
  ON CONFLICT DO NOTHING
  RETURNING id INTO _id;
  PERFORM public.comms_log_access('grant_set', NULL, NULL, _account_id,
    jsonb_build_object('role_key', _role_key, 'staff_id', _staff_id, 'permission', _permission));
  RETURN _id;
END; $$;
REVOKE ALL ON FUNCTION public.comms_grant_set(uuid,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comms_grant_set(uuid,text,uuid,text) TO authenticated;

-- ---------- ingestion (service side) ----------
CREATE OR REPLACE FUNCTION public.comms_message_ingest(
  _mailbox_address text, _direction text, _occurred_at timestamptz,
  _from_address text, _from_name text, _to_addresses text[], _cc_addresses text[],
  _subject text, _body_preview text, _body_html text DEFAULT NULL,
  _provider_message_id text DEFAULT NULL, _external_thread_key text DEFAULT NULL,
  _source text DEFAULT 'provider', _source_id text DEFAULT NULL,
  _category text DEFAULT 'external', _delivery_status text DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _account uuid; _thread uuid; _msg uuid; _key text; _counter_email text; _dir public.comms_direction;
BEGIN
  _dir := _direction::public.comms_direction;
  SELECT id INTO _account FROM public.comms_accounts WHERE mailbox_address = lower(_mailbox_address);
  IF _account IS NULL THEN
    INSERT INTO public.comms_accounts(mailbox_address, display_name, provider, status)
    VALUES (lower(_mailbox_address), lower(_mailbox_address), 'platform', 'connected')
    RETURNING id INTO _account;
  END IF;

  IF _source_id IS NOT NULL THEN
    SELECT id INTO _msg FROM public.comms_messages WHERE source = _source AND source_id = _source_id;
    IF _msg IS NOT NULL THEN RETURN _msg; END IF;
  END IF;

  _counter_email := CASE WHEN _dir = 'inbound' THEN lower(coalesce(_from_address,''))
                         ELSE lower(coalesce(_to_addresses[1],'')) END;
  _key := coalesce(_external_thread_key,
                   md5(lower(coalesce(_subject,'(no subject)')) || '|' || _counter_email));

  SELECT id INTO _thread FROM public.comms_threads WHERE account_id = _account AND external_thread_key = _key;
  IF _thread IS NULL THEN
    INSERT INTO public.comms_threads(account_id, external_thread_key, subject, counterparty_name, counterparty_email,
                                     category, status, first_activity_at, last_activity_at, last_direction)
    VALUES (_account, _key, coalesce(nullif(_subject,''),'(no subject)'),
            _from_name, nullif(_counter_email,''), _category::public.comms_category,
            CASE WHEN _dir = 'inbound' THEN 'unread'::public.comms_thread_status ELSE 'replied'::public.comms_thread_status END,
            _occurred_at, _occurred_at, _dir)
    RETURNING id INTO _thread;
  END IF;

  INSERT INTO public.comms_messages(thread_id, account_id, direction, provider_message_id, source, source_id,
                                    from_address, from_name, to_addresses, cc_addresses, subject, body_preview,
                                    body_html, delivery_status, occurred_at, metadata)
  VALUES (_thread, _account, _dir, _provider_message_id, _source, _source_id,
          _from_address, _from_name, coalesce(_to_addresses,'{}'), coalesce(_cc_addresses,'{}'),
          _subject, left(coalesce(_body_preview,''), 4000), _body_html, _delivery_status, _occurred_at,
          coalesce(_metadata,'{}'::jsonb))
  RETURNING id INTO _msg;

  UPDATE public.comms_threads
     SET message_count = message_count + 1,
         inbound_count = inbound_count + CASE WHEN _dir = 'inbound' THEN 1 ELSE 0 END,
         outbound_count = outbound_count + CASE WHEN _dir = 'outbound' THEN 1 ELSE 0 END,
         last_activity_at = greatest(last_activity_at, _occurred_at),
         last_direction = _dir,
         status = CASE WHEN _dir = 'inbound' AND status IN ('replied','closed') THEN 'unread'::public.comms_thread_status ELSE status END
   WHERE id = _thread;

  RETURN _msg;
END; $$;
REVOKE ALL ON FUNCTION public.comms_message_ingest(text,text,timestamptz,text,text,text[],text[],text,text,text,text,text,text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comms_message_ingest(text,text,timestamptz,text,text,text[],text[],text,text,text,text,text,text,text,text,text,jsonb) TO service_role;

-- ---------- platform history import ----------
CREATE OR REPLACE FUNCTION public.comms_import_platform_history(_days integer DEFAULT 90)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _sent integer := 0; _enq integer := 0; r record;
BEGIN
  IF NOT public.comms_is_administrator() THEN RAISE EXCEPTION 'COMMS_ADMIN_REQUIRED'; END IF;

  FOR r IN
    SELECT DISTINCT ON (l.message_id) l.*
    FROM public.email_send_log l
    WHERE l.created_at >= now() - make_interval(days => _days)
      AND l.recipient_email IS NOT NULL
    ORDER BY l.message_id, l.created_at DESC
  LOOP
    PERFORM public.comms_message_ingest(
      coalesce(nullif(r.route,''), 'notify@yalla.africa'), 'outbound', r.created_at,
      coalesce(nullif(r.route,''), 'notify@yalla.africa'), 'Yalla Mobility',
      ARRAY[r.recipient_email], '{}',
      coalesce(r.subject, r.template_name, 'Platform notification'),
      coalesce(r.event_key, r.template_name), NULL,
      r.provider_message_id, NULL, 'email_send_log', coalesce(r.message_id, r.id::text),
      'notification', r.status, jsonb_build_object('template', r.template_name, 'category', r.category)
    );
    _sent := _sent + 1;
  END LOOP;

  FOR r IN
    SELECT * FROM public.contact_submissions
    WHERE created_at >= now() - make_interval(days => _days) AND coalesce(is_spam,false) = false
  LOOP
    PERFORM public.comms_message_ingest(
      coalesce(nullif(r.routed_inbox,''), 'support@yalla.africa'), 'inbound', r.created_at,
      r.email, r.name, ARRAY[coalesce(nullif(r.routed_inbox,''), 'support@yalla.africa')], '{}',
      coalesce(nullif(r.subject,''), 'Website enquiry'), r.message, NULL,
      NULL, NULL, 'contact_submission', r.id::text, 'enquiry', r.status,
      jsonb_build_object('company', r.company, 'phone', r.phone, 'source_page', r.source_page)
    );
    _enq := _enq + 1;
  END LOOP;

  PERFORM public.comms_log_access('platform_history_imported', NULL, NULL, NULL,
    jsonb_build_object('sent', _sent, 'enquiries', _enq, 'days', _days));
  RETURN jsonb_build_object('sent', _sent, 'enquiries', _enq);
END; $$;
REVOKE ALL ON FUNCTION public.comms_import_platform_history(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.comms_import_platform_history(integer) TO authenticated;
