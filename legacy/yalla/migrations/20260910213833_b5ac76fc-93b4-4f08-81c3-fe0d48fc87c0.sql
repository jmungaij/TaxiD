
-- ============ columns on sales_leads ============
ALTER TABLE public.sales_leads
  ADD COLUMN IF NOT EXISTS contact_state text NOT NULL DEFAULT 'NOT_CONTACTED',
  ADD COLUMN IF NOT EXISTS last_outreach_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_reply_at timestamptz,
  ADD COLUMN IF NOT EXISTS contact_token text;

DO $$ BEGIN
  ALTER TABLE public.sales_leads
    ADD CONSTRAINT sales_leads_contact_state_chk
    CHECK (contact_state IN ('NOT_CONTACTED','CONTACTED','REPLIED','NOT_INTERESTED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS sales_leads_contact_token_key
  ON public.sales_leads(contact_token) WHERE contact_token IS NOT NULL;

-- ============ messages ============
CREATE TABLE IF NOT EXISTS public.sales_lead_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.sales_leads(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('OUTBOUND','INBOUND')),
  channel text NOT NULL CHECK (channel IN ('EMAIL','PHONE','WHATSAPP','MEETING','CONTACT_LINK','OTHER')),
  subject text,
  body text NOT NULL,
  recipient_email text,
  contact_link text,
  sender_name text,
  actor_user_id uuid,
  actor_staff_member_id uuid,
  intent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.sales_lead_messages TO authenticated;
GRANT ALL ON public.sales_lead_messages TO service_role;
ALTER TABLE public.sales_lead_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY sales_lead_messages_read ON public.sales_lead_messages
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sales_leads l
    WHERE l.id = sales_lead_messages.lead_id
      AND (l.sales_staff_id = public._my_staff_member_id()
           OR public.has_staff_permission('staff.crm.read'))
  ));

CREATE INDEX IF NOT EXISTS sales_lead_messages_lead_idx
  ON public.sales_lead_messages(lead_id, created_at DESC);

-- ============ follow-ups ============
CREATE TABLE IF NOT EXISTS public.sales_lead_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.sales_leads(id) ON DELETE CASCADE,
  sales_staff_id uuid,
  logged_note text NOT NULL,
  contact_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Africa/Nairobi')::date,
  next_action text NOT NULL,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DONE','CANCELLED')),
  outcome text,
  closed_at timestamptz,
  closed_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.sales_lead_followups TO authenticated;
GRANT ALL ON public.sales_lead_followups TO service_role;
ALTER TABLE public.sales_lead_followups ENABLE ROW LEVEL SECURITY;

CREATE POLICY sales_lead_followups_read ON public.sales_lead_followups
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sales_leads l
    WHERE l.id = sales_lead_followups.lead_id
      AND (l.sales_staff_id = public._my_staff_member_id()
           OR public.has_staff_permission('staff.crm.read'))
  ));

CREATE INDEX IF NOT EXISTS sales_lead_followups_open_idx
  ON public.sales_lead_followups(status, due_date);

CREATE OR REPLACE FUNCTION public._sales_lead_followup_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_sales_lead_followup_touch ON public.sales_lead_followups;
CREATE TRIGGER trg_sales_lead_followup_touch
  BEFORE UPDATE ON public.sales_lead_followups
  FOR EACH ROW EXECUTE FUNCTION public._sales_lead_followup_touch();

-- ============ message log drives contact state ============
CREATE OR REPLACE FUNCTION public._sales_lead_message_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.direction = 'OUTBOUND' THEN
    UPDATE public.sales_leads
       SET last_outreach_at = NEW.created_at,
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

DROP TRIGGER IF EXISTS trg_sales_lead_message_sync ON public.sales_lead_messages;
CREATE TRIGGER trg_sales_lead_message_sync
  AFTER INSERT ON public.sales_lead_messages
  FOR EACH ROW EXECUTE FUNCTION public._sales_lead_message_sync();

CREATE OR REPLACE FUNCTION public._sales_lead_messages_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'sales_lead_messages is append-only'; END $$;

DROP TRIGGER IF EXISTS trg_sales_lead_messages_append_only ON public.sales_lead_messages;
CREATE TRIGGER trg_sales_lead_messages_append_only
  BEFORE UPDATE OR DELETE ON public.sales_lead_messages
  FOR EACH ROW EXECUTE FUNCTION public._sales_lead_messages_append_only();

-- ============ authorisation helper ============
CREATE OR REPLACE FUNCTION public._sales_lead_writable(_lead_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sales_leads l
    WHERE l.id = _lead_id
      AND (l.sales_staff_id = public._my_staff_member_id()
           OR public.has_staff_permission('staff.crm.manage'))
  )
$$;
REVOKE ALL ON FUNCTION public._sales_lead_writable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._sales_lead_writable(uuid) TO authenticated, service_role;

-- ============ contact token issue ============
CREATE OR REPLACE FUNCTION public.sales_lead_contact_link(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _lead_id uuid := (p->>'lead_id')::uuid; _tok text;
BEGIN
  IF NOT public._sales_lead_writable(_lead_id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  SELECT contact_token INTO _tok FROM public.sales_leads WHERE id = _lead_id;
  IF _tok IS NULL THEN
    _tok := encode(gen_random_bytes(24), 'hex');
    UPDATE public.sales_leads SET contact_token = _tok, updated_at = now() WHERE id = _lead_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'token', _tok);
END $$;
REVOKE ALL ON FUNCTION public.sales_lead_contact_link(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_lead_contact_link(jsonb) TO authenticated, service_role;

-- ============ log outreach ============
CREATE OR REPLACE FUNCTION public.sales_lead_outreach_log(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _lead public.sales_leads; _id uuid; _body text := p->>'body';
BEGIN
  SELECT * INTO _lead FROM public.sales_leads WHERE id = (p->>'lead_id')::uuid;
  IF _lead.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF NOT public._sales_lead_writable(_lead.id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF _body IS NULL OR length(btrim(_body)) < 10 THEN RAISE EXCEPTION 'MESSAGE_REQUIRED'; END IF;

  INSERT INTO public.sales_lead_messages(
    lead_id, direction, channel, subject, body, recipient_email, contact_link,
    actor_user_id, actor_staff_member_id, intent)
  VALUES (_lead.id, 'OUTBOUND', COALESCE(p->>'channel','EMAIL'), p->>'subject', _body,
          COALESCE(p->>'recipient_email', _lead.contact_email), p->>'contact_link',
          auth.uid(), public._my_staff_member_id(), p->>'intent')
  RETURNING id INTO _id;

  INSERT INTO public.sales_lead_events(lead_id, action, note, actor_user_id, detail)
  VALUES (_lead.id, 'OUTREACH_SENT', p->>'subject', auth.uid(),
          jsonb_build_object('message_id', _id, 'channel', COALESCE(p->>'channel','EMAIL')));

  RETURN jsonb_build_object('ok', true, 'message_id', _id);
END $$;
REVOKE ALL ON FUNCTION public.sales_lead_outreach_log(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_lead_outreach_log(jsonb) TO authenticated, service_role;

-- ============ log a reply received off-platform ============
CREATE OR REPLACE FUNCTION public.sales_lead_reply_log(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _lead public.sales_leads; _id uuid; _body text := p->>'body';
BEGIN
  SELECT * INTO _lead FROM public.sales_leads WHERE id = (p->>'lead_id')::uuid;
  IF _lead.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF NOT public._sales_lead_writable(_lead.id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF _body IS NULL OR length(btrim(_body)) < 3 THEN RAISE EXCEPTION 'MESSAGE_REQUIRED'; END IF;

  INSERT INTO public.sales_lead_messages(
    lead_id, direction, channel, body, sender_name, actor_user_id, actor_staff_member_id, intent)
  VALUES (_lead.id, 'INBOUND', COALESCE(p->>'channel','EMAIL'), _body,
          COALESCE(p->>'sender_name', _lead.contact_name),
          auth.uid(), public._my_staff_member_id(), p->>'intent')
  RETURNING id INTO _id;

  INSERT INTO public.sales_lead_events(lead_id, action, note, actor_user_id, detail)
  VALUES (_lead.id, 'REPLY_LOGGED', left(_body, 200), auth.uid(),
          jsonb_build_object('message_id', _id, 'logged_by_staff', true));

  RETURN jsonb_build_object('ok', true, 'message_id', _id);
END $$;
REVOKE ALL ON FUNCTION public.sales_lead_reply_log(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_lead_reply_log(jsonb) TO authenticated, service_role;

-- ============ follow-ups ============
CREATE OR REPLACE FUNCTION public.sales_lead_followup_upsert(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _lead public.sales_leads; _id uuid;
BEGIN
  SELECT * INTO _lead FROM public.sales_leads WHERE id = (p->>'lead_id')::uuid;
  IF _lead.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF NOT public._sales_lead_writable(_lead.id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF COALESCE(btrim(p->>'logged_note'),'') = '' THEN RAISE EXCEPTION 'NOTE_REQUIRED'; END IF;
  IF COALESCE(btrim(p->>'next_action'),'') = '' THEN RAISE EXCEPTION 'NEXT_ACTION_REQUIRED'; END IF;
  IF p->>'due_date' IS NULL THEN RAISE EXCEPTION 'DUE_DATE_REQUIRED'; END IF;

  INSERT INTO public.sales_lead_followups(
    lead_id, sales_staff_id, logged_note, contact_date, next_action, due_date, created_by)
  VALUES (_lead.id, _lead.sales_staff_id, p->>'logged_note',
          COALESCE((p->>'contact_date')::date, (now() AT TIME ZONE 'Africa/Nairobi')::date),
          p->>'next_action', (p->>'due_date')::date, auth.uid())
  RETURNING id INTO _id;

  INSERT INTO public.sales_lead_events(lead_id, action, note, actor_user_id, detail)
  VALUES (_lead.id, 'FOLLOWUP_LOGGED', p->>'next_action', auth.uid(),
          jsonb_build_object('followup_id', _id, 'due_date', p->>'due_date'));

  RETURN jsonb_build_object('ok', true, 'followup_id', _id);
END $$;
REVOKE ALL ON FUNCTION public.sales_lead_followup_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_lead_followup_upsert(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sales_lead_followup_close(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _f public.sales_lead_followups; _status text := COALESCE(p->>'status','DONE');
BEGIN
  SELECT * INTO _f FROM public.sales_lead_followups WHERE id = (p->>'followup_id')::uuid;
  IF _f.id IS NULL THEN RAISE EXCEPTION 'FOLLOWUP_NOT_FOUND'; END IF;
  IF NOT public._sales_lead_writable(_f.lead_id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF _f.status <> 'OPEN' THEN RAISE EXCEPTION 'ALREADY_CLOSED'; END IF;
  IF _status NOT IN ('DONE','CANCELLED') THEN RAISE EXCEPTION 'INVALID_STATUS'; END IF;
  IF COALESCE(btrim(p->>'outcome'),'') = '' THEN RAISE EXCEPTION 'OUTCOME_REQUIRED'; END IF;

  UPDATE public.sales_lead_followups
     SET status = _status, outcome = p->>'outcome', closed_at = now(), closed_by = auth.uid()
   WHERE id = _f.id;

  INSERT INTO public.sales_lead_events(lead_id, action, note, actor_user_id, detail)
  VALUES (_f.lead_id, 'FOLLOWUP_CLOSED', p->>'outcome', auth.uid(),
          jsonb_build_object('followup_id', _f.id, 'status', _status));

  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.sales_lead_followup_close(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_lead_followup_close(jsonb) TO authenticated, service_role;

-- ============ desk KPIs ============
CREATE OR REPLACE FUNCTION public.sales_lead_desk_kpis()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _me uuid := public._my_staff_member_id(); _all boolean := public.has_staff_permission('staff.crm.read'); _rows jsonb;
BEGIN
  IF _me IS NULL AND NOT _all THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;

  SELECT COALESCE(jsonb_agg(r ORDER BY r->>'staff_name'), '[]'::jsonb) INTO _rows FROM (
    SELECT jsonb_build_object(
      'sales_staff_id', l.sales_staff_id,
      'staff_name', COALESCE(sm.full_name, 'Unassigned desk'),
      'allocated', count(*),
      'not_contacted', count(*) FILTER (WHERE l.contact_state = 'NOT_CONTACTED'),
      'contacted', count(*) FILTER (WHERE l.contact_state <> 'NOT_CONTACTED'),
      'awaiting_reply', count(*) FILTER (WHERE l.contact_state = 'CONTACTED'),
      'replied', count(*) FILTER (WHERE l.contact_state = 'REPLIED'),
      'not_interested', count(*) FILTER (WHERE l.contact_state = 'NOT_INTERESTED'),
      'reply_rate', CASE WHEN count(*) FILTER (WHERE l.contact_state <> 'NOT_CONTACTED') > 0
        THEN round(100.0 * count(*) FILTER (WHERE l.first_reply_at IS NOT NULL)
             / count(*) FILTER (WHERE l.contact_state <> 'NOT_CONTACTED'), 1) END,
      'avg_days_to_first_reply', (
        SELECT round(avg(EXTRACT(EPOCH FROM (x.first_reply_at - x.last_outreach_at)) / 86400.0)::numeric, 1)
        FROM public.sales_leads x
        WHERE x.sales_staff_id IS NOT DISTINCT FROM l.sales_staff_id
          AND x.first_reply_at IS NOT NULL AND x.last_outreach_at IS NOT NULL),
      'followups_open', (SELECT count(*) FROM public.sales_lead_followups f
         JOIN public.sales_leads fl ON fl.id = f.lead_id
         WHERE f.status = 'OPEN' AND fl.sales_staff_id IS NOT DISTINCT FROM l.sales_staff_id),
      'followups_overdue', (SELECT count(*) FROM public.sales_lead_followups f
         JOIN public.sales_leads fl ON fl.id = f.lead_id
         WHERE f.status = 'OPEN' AND fl.sales_staff_id IS NOT DISTINCT FROM l.sales_staff_id
           AND f.due_date < (now() AT TIME ZONE 'Africa/Nairobi')::date),
      'no_email', count(*) FILTER (WHERE COALESCE(btrim(l.contact_email),'') = '')
    ) AS r
    FROM public.sales_leads l
    LEFT JOIN public.staff_members sm ON sm.id = l.sales_staff_id
    WHERE l.is_test = false AND (_all OR l.sales_staff_id = _me)
    GROUP BY l.sales_staff_id, sm.full_name
  ) q;

  RETURN jsonb_build_object('ok', true, 'scope', CASE WHEN _all THEN 'DESK' ELSE 'SELF' END, 'desks', _rows);
END $$;
REVOKE ALL ON FUNCTION public.sales_lead_desk_kpis() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_lead_desk_kpis() TO authenticated, service_role;

-- ============ public contact link (token scoped) ============
CREATE OR REPLACE FUNCTION public.sales_lead_contact_view(p jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _l public.sales_leads;
BEGIN
  SELECT * INTO _l FROM public.sales_leads
   WHERE contact_token IS NOT NULL AND contact_token = p->>'token';
  IF _l.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_LINK'); END IF;
  RETURN jsonb_build_object('ok', true,
    'lead_ref', _l.lead_ref,
    'organisation_name', _l.organisation_name,
    'contact_name', _l.contact_name,
    'service_interest', _l.service_interest,
    'contact_state', _l.contact_state,
    'last_reply_at', _l.last_reply_at,
    'information_request', _l.information_request);
END $$;
REVOKE ALL ON FUNCTION public.sales_lead_contact_view(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_lead_contact_view(jsonb) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sales_lead_contact_reply(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _l public.sales_leads; _id uuid; _body text := p->>'body'; _intent text := COALESCE(p->>'intent','REPLIED');
BEGIN
  SELECT * INTO _l FROM public.sales_leads
   WHERE contact_token IS NOT NULL AND contact_token = p->>'token';
  IF _l.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_LINK'); END IF;
  IF _body IS NULL OR length(btrim(_body)) < 3 THEN RETURN jsonb_build_object('ok', false, 'reason', 'MESSAGE_REQUIRED'); END IF;
  IF _intent NOT IN ('REPLIED','INTERESTED','NOT_INTERESTED','INFORMATION') THEN _intent := 'REPLIED'; END IF;

  INSERT INTO public.sales_lead_messages(lead_id, direction, channel, body, sender_name, intent)
  VALUES (_l.id, 'INBOUND', 'CONTACT_LINK', left(btrim(_body), 4000),
          COALESCE(NULLIF(btrim(p->>'sender_name'),''), _l.contact_name), _intent)
  RETURNING id INTO _id;

  INSERT INTO public.sales_lead_events(lead_id, action, note, detail)
  VALUES (_l.id, 'CONTACT_LINK_REPLY', left(btrim(_body), 200),
          jsonb_build_object('message_id', _id, 'intent', _intent));

  RETURN jsonb_build_object('ok', true, 'lead_ref', _l.lead_ref);
END $$;
REVOKE ALL ON FUNCTION public.sales_lead_contact_reply(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_lead_contact_reply(jsonb) TO anon, authenticated, service_role;
