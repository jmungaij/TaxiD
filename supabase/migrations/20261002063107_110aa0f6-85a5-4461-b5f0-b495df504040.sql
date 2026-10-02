ALTER TABLE public.trip_messages
  ADD COLUMN IF NOT EXISTS client_msg_id uuid,
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS reported_at timestamptz,
  ADD COLUMN IF NOT EXISTS reported_by uuid,
  ADD COLUMN IF NOT EXISTS report_reason text;
CREATE UNIQUE INDEX IF NOT EXISTS trip_messages_client_msg_uq ON public.trip_messages(sender_user_id, client_msg_id) WHERE client_msg_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS trip_messages_booking_idx ON public.trip_messages(trip_booking_id, created_at);

CREATE OR REPLACE FUNCTION private.trip_message_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  NEW.body := btrim(NEW.body);
  IF NEW.body = '' OR length(NEW.body) > 200 THEN RAISE EXCEPTION 'MESSAGE_LENGTH' USING ERRCODE='22023'; END IF;
  IF NEW.kind NOT IN ('text','quick','ack','vehicle_mismatch','safety') THEN NEW.kind := 'text'; END IF;
  IF NEW.priority NOT IN ('normal','important','safety') THEN NEW.priority := 'normal'; END IF;
  IF NEW.kind IN ('safety','vehicle_mismatch') THEN NEW.priority := 'safety'; END IF;
  NEW.read_at := NULL; NEW.reported_at := NULL; NEW.reported_by := NULL; NEW.report_reason := NULL;
  IF NEW.body ~ '(\+?\d[\d\s\-]{8,}\d)' OR NEW.body ~* '(https?://|www\.)' THEN
    RAISE EXCEPTION 'CONTACT_DETAILS_BLOCKED' USING ERRCODE='22023';
  END IF;
  IF (SELECT count(*) FROM trip_messages WHERE sender_user_id=NEW.sender_user_id AND created_at > now()-interval '1 minute') >= 8 THEN
    RAISE EXCEPTION 'RATE_LIMITED' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trip_message_guard ON public.trip_messages;
CREATE TRIGGER trip_message_guard BEFORE INSERT ON public.trip_messages FOR EACH ROW EXECUTE FUNCTION private.trip_message_guard();

CREATE POLICY "Safety staff read reported messages" ON public.trip_messages FOR SELECT TO authenticated
  USING (reported_at IS NOT NULL AND public.safety_is_operator());

CREATE OR REPLACE FUNCTION private.trip_messages_mark_read(_booking_id uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r text := private.trip_party_role(_booking_id); n int;
BEGIN
  IF r IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORISED' USING ERRCODE='42501'; END IF;
  UPDATE trip_messages SET read_at=now() WHERE trip_booking_id=_booking_id AND sender_role<>r AND read_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n;
END $$;

CREATE OR REPLACE FUNCTION private.trip_message_report(_message_id uuid, _reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE m trip_messages%ROWTYPE; r text;
BEGIN
  SELECT * INTO m FROM trip_messages WHERE id=_message_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NOT_FOUND'); END IF;
  r := private.trip_party_role(m.trip_booking_id);
  IF r IS NULL OR m.sender_role = r THEN RAISE EXCEPTION 'NOT_AUTHORISED' USING ERRCODE='42501'; END IF;
  UPDATE trip_messages SET reported_at=coalesce(reported_at, now()), reported_by=auth.uid(),
    report_reason=left(coalesce(nullif(btrim(_reason),''),'unspecified'),200) WHERE id=_message_id;
  RETURN jsonb_build_object('ok',true);
END $$;

REVOKE ALL ON FUNCTION private.trip_messages_mark_read(uuid), private.trip_message_report(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.trip_messages_mark_read(uuid), private.trip_message_report(uuid,text) TO authenticated;
CREATE OR REPLACE FUNCTION public.trip_messages_mark_read(_booking_id uuid) RETURNS integer
 LANGUAGE sql SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.trip_messages_mark_read(_booking_id) $$;
CREATE OR REPLACE FUNCTION public.trip_message_report(_message_id uuid, _reason text) RETURNS jsonb
 LANGUAGE sql SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.trip_message_report(_message_id, _reason) $$;
REVOKE ALL ON FUNCTION public.trip_messages_mark_read(uuid), public.trip_message_report(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trip_messages_mark_read(uuid), public.trip_message_report(uuid,text) TO authenticated;