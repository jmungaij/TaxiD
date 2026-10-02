CREATE TABLE public.safety_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE DEFAULT ('SOS-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  reporter_user_id uuid NOT NULL,
  reporter_role text NOT NULL DEFAULT 'rider' CHECK (reporter_role IN ('rider','driver')),
  trip_booking_id uuid REFERENCES public.trip_bookings(id) ON DELETE SET NULL,
  booking_number text, rider_user_id uuid, driver_id uuid, driver_name text, driver_phone text,
  vehicle_id uuid, vehicle_plate text, vehicle_desc text, trip_status text,
  pickup_address text, dropoff_address text,
  incident_type text NOT NULL DEFAULT 'immediate_danger' CHECK (incident_type IN ('immediate_danger','accident','harassment','unsafe_driving','medical','other')),
  severity text NOT NULL DEFAULT 'critical' CHECK (severity IN ('critical','high','standard')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','responding','escalated','resolved','cancelled_safe')),
  activation_source text NOT NULL DEFAULT 'app',
  idempotency_key text, app_version text, user_agent text,
  message text CHECK (message IS NULL OR char_length(message) <= 2000),
  lat numeric, lng numeric, accuracy_m numeric, location_at timestamptz,
  escalation_level int NOT NULL DEFAULT 0,
  assigned_operator uuid, acknowledged_at timestamptz, response_started_at timestamptz, resolved_at timestamptz,
  ack_due_at timestamptz NOT NULL DEFAULT now() + interval '2 minutes',
  resolution_type text, resolution_notes text, follow_up_required boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX safety_incidents_idem ON public.safety_incidents(reporter_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX safety_incidents_status ON public.safety_incidents(status, created_at DESC);
GRANT SELECT ON public.safety_incidents TO authenticated;
GRANT ALL ON public.safety_incidents TO service_role;
ALTER TABLE public.safety_incidents ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.safety_incident_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.safety_incidents(id) ON DELETE CASCADE,
  actor_user_id uuid, actor_kind text NOT NULL DEFAULT 'system',
  event_type text NOT NULL, note text, data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.safety_incident_events(incident_id, created_at);
GRANT SELECT ON public.safety_incident_events TO authenticated;
GRANT ALL ON public.safety_incident_events TO service_role;
ALTER TABLE public.safety_incident_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.safety_location_pings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.safety_incidents(id) ON DELETE CASCADE,
  lat numeric NOT NULL, lng numeric NOT NULL, accuracy_m numeric, speed numeric, heading numeric,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.safety_location_pings(incident_id, recorded_at DESC);
GRANT SELECT ON public.safety_location_pings TO authenticated;
GRANT ALL ON public.safety_location_pings TO service_role;
ALTER TABLE public.safety_location_pings ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.safety_contact_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.safety_incidents(id) ON DELETE CASCADE,
  contact_id uuid, contact_name text, contact_phone text, channel text NOT NULL DEFAULT 'sms',
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','failed','called_by_operator')),
  status_detail text, updated_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.safety_contact_notifications TO authenticated;
GRANT ALL ON public.safety_contact_notifications TO service_role;
ALTER TABLE public.safety_contact_notifications ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.safety_is_operator() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()
    AND role IN ('admin','super_admin','support','operations_admin','compliance_admin','dispatch_manager'))
$$;
CREATE OR REPLACE FUNCTION public.safety_is_operator() RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$ SELECT private.safety_is_operator() $$;
GRANT USAGE ON SCHEMA private TO authenticated;
GRANT EXECUTE ON FUNCTION private.safety_is_operator() TO authenticated;

CREATE POLICY "Own or operator incidents" ON public.safety_incidents FOR SELECT TO authenticated
  USING (reporter_user_id = auth.uid() OR public.safety_is_operator());
CREATE POLICY "Own or operator events" ON public.safety_incident_events FOR SELECT TO authenticated
  USING (public.safety_is_operator() OR EXISTS (SELECT 1 FROM public.safety_incidents i WHERE i.id = incident_id AND i.reporter_user_id = auth.uid()));
CREATE POLICY "Own or operator pings" ON public.safety_location_pings FOR SELECT TO authenticated
  USING (public.safety_is_operator() OR EXISTS (SELECT 1 FROM public.safety_incidents i WHERE i.id = incident_id AND i.reporter_user_id = auth.uid()));
CREATE POLICY "Own or operator notifications" ON public.safety_contact_notifications FOR SELECT TO authenticated
  USING (public.safety_is_operator() OR EXISTS (SELECT 1 FROM public.safety_incidents i WHERE i.id = incident_id AND i.reporter_user_id = auth.uid()));

-- Open (or reuse) an incident
CREATE OR REPLACE FUNCTION private.safety_sos_open(_booking_id uuid, _incident_type text, _lat numeric, _lng numeric, _accuracy numeric,
  _message text, _source text, _idempotency_key text, _app_version text, _reporter_role text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_inc public.safety_incidents; v_b record; v_sev text; v_due interval; v_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not signed in'; END IF;
  IF _message IS NOT NULL AND char_length(_message) > 2000 THEN RAISE EXCEPTION 'Message too long'; END IF;
  IF _incident_type NOT IN ('immediate_danger','accident','harassment','unsafe_driving','medical','other') THEN RAISE EXCEPTION 'Invalid incident type'; END IF;
  v_role := CASE WHEN _reporter_role = 'driver' THEN 'driver' ELSE 'rider' END;
  -- Idempotency: same key, or any open incident by this user in the last 30 minutes
  SELECT * INTO v_inc FROM public.safety_incidents WHERE reporter_user_id = v_uid
    AND ((_idempotency_key IS NOT NULL AND idempotency_key = _idempotency_key)
      OR (status IN ('open','acknowledged','responding','escalated') AND created_at > now() - interval '30 minutes'))
    ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    IF _lat IS NOT NULL AND _lng IS NOT NULL THEN
      INSERT INTO public.safety_location_pings(incident_id, lat, lng, accuracy_m) VALUES (v_inc.id, _lat, _lng, _accuracy);
      UPDATE public.safety_incidents SET lat=_lat, lng=_lng, accuracy_m=_accuracy, location_at=now(), updated_at=now() WHERE id=v_inc.id;
    END IF;
    INSERT INTO public.safety_incident_events(incident_id, actor_user_id, actor_kind, event_type, note)
      VALUES (v_inc.id, v_uid, v_role, 'sos_repeat', 'SOS pressed again; existing incident reused');
    RETURN jsonb_build_object('incident_id', v_inc.id, 'reference', v_inc.reference, 'deduplicated', true);
  END IF;
  IF _booking_id IS NOT NULL THEN
    SELECT b.id, b.booking_number, b.rider_user_id, b.status, b.pickup_address, b.dropoff_address, b.driver_id, b.vehicle_id,
           d.user_id AS d_user, trim(coalesce(d.first_name,'')||' '||coalesce(d.last_name,'')) AS d_name, d.phone AS d_phone,
           v.plate_number, trim(coalesce(v.color,'')||' '||coalesce(v.make,'')||' '||coalesce(v.model,'')) AS v_desc
      INTO v_b FROM public.trip_bookings b LEFT JOIN public.drivers d ON d.id=b.driver_id LEFT JOIN public.vehicles v ON v.id=b.vehicle_id
      WHERE b.id=_booking_id;
    IF NOT FOUND OR (v_b.rider_user_id IS DISTINCT FROM v_uid AND v_b.d_user IS DISTINCT FROM v_uid) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    IF v_b.d_user = v_uid THEN v_role := 'driver'; END IF;
  END IF;
  v_sev := CASE WHEN _incident_type IN ('immediate_danger','accident','medical') THEN 'critical'
                WHEN _incident_type IN ('harassment','unsafe_driving') THEN 'high' ELSE 'standard' END;
  v_due := CASE v_sev WHEN 'critical' THEN interval '2 minutes' WHEN 'high' THEN interval '5 minutes' ELSE interval '15 minutes' END;
  INSERT INTO public.safety_incidents(reporter_user_id, reporter_role, trip_booking_id, booking_number, rider_user_id, driver_id, driver_name, driver_phone,
    vehicle_id, vehicle_plate, vehicle_desc, trip_status, pickup_address, dropoff_address, incident_type, severity, activation_source,
    idempotency_key, app_version, message, lat, lng, accuracy_m, location_at, ack_due_at)
  VALUES (v_uid, v_role, v_b.id, v_b.booking_number, v_b.rider_user_id, v_b.driver_id, nullif(v_b.d_name,''), v_b.d_phone,
    v_b.vehicle_id, v_b.plate_number, nullif(v_b.v_desc,''), v_b.status, v_b.pickup_address, v_b.dropoff_address, _incident_type, v_sev,
    left(coalesce(_source,'app'),60), left(_idempotency_key,120), left(_app_version,40), _message, _lat, _lng, _accuracy,
    CASE WHEN _lat IS NOT NULL THEN now() END, now() + v_due)
  RETURNING * INTO v_inc;
  IF _lat IS NOT NULL AND _lng IS NOT NULL THEN
    INSERT INTO public.safety_location_pings(incident_id, lat, lng, accuracy_m) VALUES (v_inc.id, _lat, _lng, _accuracy);
  END IF;
  INSERT INTO public.safety_incident_events(incident_id, actor_user_id, actor_kind, event_type, note, data)
    VALUES (v_inc.id, v_uid, v_role, 'incident_opened', 'SOS raised: ' || _incident_type,
      jsonb_build_object('severity', v_sev, 'has_location', _lat IS NOT NULL, 'source', _source));
  INSERT INTO public.safety_contact_notifications(incident_id, contact_id, contact_name, contact_phone, status, status_detail)
    SELECT v_inc.id, c.id, c.name, c.phone_number, 'queued', 'Awaiting operator call — automatic SMS not connected'
    FROM public.emergency_contacts c WHERE c.user_id = v_uid ORDER BY c.is_primary DESC LIMIT 3;
  -- keep legacy alert feed populated
  INSERT INTO public.safety_alerts(user_id, trip_booking_id, alert_type, lat, lng, message, status)
    VALUES (v_uid, v_b.id, 'sos', _lat, _lng, coalesce(_message, _incident_type), 'active');
  RETURN jsonb_build_object('incident_id', v_inc.id, 'reference', v_inc.reference, 'deduplicated', false, 'severity', v_sev, 'ack_due_at', v_inc.ack_due_at);
END $$;

CREATE OR REPLACE FUNCTION private.safety_sos_ping(_incident_id uuid, _lat numeric, _lng numeric, _accuracy numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.safety_incidents WHERE id=_incident_id AND reporter_user_id=auth.uid()
     AND status NOT IN ('resolved','cancelled_safe')) THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF EXISTS (SELECT 1 FROM public.safety_location_pings WHERE incident_id=_incident_id AND recorded_at > now() - interval '5 seconds') THEN RETURN; END IF;
  INSERT INTO public.safety_location_pings(incident_id, lat, lng, accuracy_m) VALUES (_incident_id, _lat, _lng, _accuracy);
  UPDATE public.safety_incidents SET lat=_lat, lng=_lng, accuracy_m=_accuracy, location_at=now(), updated_at=now() WHERE id=_incident_id;
END $$;

CREATE OR REPLACE FUNCTION private.safety_sos_mark_safe(_incident_id uuid, _note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.safety_incidents SET status='cancelled_safe', updated_at=now(), follow_up_required=true
   WHERE id=_incident_id AND reporter_user_id=auth.uid() AND status NOT IN ('resolved','cancelled_safe');
  IF NOT FOUND THEN RAISE EXCEPTION 'Unauthorized or already closed'; END IF;
  INSERT INTO public.safety_incident_events(incident_id, actor_user_id, actor_kind, event_type, note)
    VALUES (_incident_id, auth.uid(), 'reporter', 'marked_safe', left(coalesce(_note,'Reporter confirmed they are safe'),500));
END $$;

CREATE OR REPLACE FUNCTION private.safety_incident_action(_incident_id uuid, _action text, _note text, _resolution_type text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.safety_incidents;
BEGIN
  IF NOT private.safety_is_operator() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v FROM public.safety_incidents WHERE id=_incident_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Incident not found'; END IF;
  IF _note IS NOT NULL AND char_length(_note) > 2000 THEN RAISE EXCEPTION 'Note too long'; END IF;
  IF _action = 'acknowledge' THEN
    UPDATE public.safety_incidents SET status=CASE WHEN status='open' THEN 'acknowledged' ELSE status END,
      acknowledged_at=coalesce(acknowledged_at, now()), assigned_operator=coalesce(assigned_operator, auth.uid()), updated_at=now() WHERE id=_incident_id;
  ELSIF _action = 'respond' THEN
    UPDATE public.safety_incidents SET status='responding', response_started_at=coalesce(response_started_at, now()),
      acknowledged_at=coalesce(acknowledged_at, now()), assigned_operator=coalesce(assigned_operator, auth.uid()), updated_at=now() WHERE id=_incident_id;
  ELSIF _action = 'escalate' THEN
    UPDATE public.safety_incidents SET status='escalated', escalation_level=escalation_level+1, updated_at=now() WHERE id=_incident_id;
  ELSIF _action = 'contacts_called' THEN
    UPDATE public.safety_contact_notifications SET status='called_by_operator', status_detail=left(coalesce(_note,'Operator called contact'),300), updated_at=now()
      WHERE incident_id=_incident_id;
  ELSIF _action = 'resolve' THEN
    IF coalesce(_resolution_type,'') = '' THEN RAISE EXCEPTION 'Resolution type required'; END IF;
    UPDATE public.safety_incidents SET status='resolved', resolved_at=now(), resolution_type=left(_resolution_type,60),
      resolution_notes=_note, acknowledged_at=coalesce(acknowledged_at, now()), updated_at=now() WHERE id=_incident_id;
  ELSIF _action = 'note' THEN NULL;
  ELSE RAISE EXCEPTION 'Unknown action';
  END IF;
  INSERT INTO public.safety_incident_events(incident_id, actor_user_id, actor_kind, event_type, note, data)
    VALUES (_incident_id, auth.uid(), 'operator', _action, _note, jsonb_build_object('resolution_type', _resolution_type));
END $$;

REVOKE ALL ON FUNCTION private.safety_sos_open(uuid,text,numeric,numeric,numeric,text,text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.safety_sos_ping(uuid,numeric,numeric,numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.safety_sos_mark_safe(uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.safety_incident_action(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.safety_sos_open(uuid,text,numeric,numeric,numeric,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.safety_sos_ping(uuid,numeric,numeric,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION private.safety_sos_mark_safe(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.safety_incident_action(uuid,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.safety_sos_open(_booking_id uuid, _incident_type text, _lat numeric, _lng numeric, _accuracy numeric,
  _message text, _source text, _idempotency_key text, _app_version text, _reporter_role text)
RETURNS jsonb LANGUAGE sql SET search_path = public AS $$ SELECT private.safety_sos_open($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) $$;
CREATE OR REPLACE FUNCTION public.safety_sos_ping(_incident_id uuid, _lat numeric, _lng numeric, _accuracy numeric)
RETURNS void LANGUAGE sql SET search_path = public AS $$ SELECT private.safety_sos_ping($1,$2,$3,$4) $$;
CREATE OR REPLACE FUNCTION public.safety_sos_mark_safe(_incident_id uuid, _note text)
RETURNS void LANGUAGE sql SET search_path = public AS $$ SELECT private.safety_sos_mark_safe($1,$2) $$;
CREATE OR REPLACE FUNCTION public.safety_incident_action(_incident_id uuid, _action text, _note text, _resolution_type text)
RETURNS void LANGUAGE sql SET search_path = public AS $$ SELECT private.safety_incident_action($1,$2,$3,$4) $$;
REVOKE ALL ON FUNCTION public.safety_sos_open(uuid,text,numeric,numeric,numeric,text,text,text,text,text), public.safety_sos_ping(uuid,numeric,numeric,numeric),
  public.safety_sos_mark_safe(uuid,text), public.safety_incident_action(uuid,text,text,text), public.safety_is_operator() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.safety_sos_open(uuid,text,numeric,numeric,numeric,text,text,text,text,text), public.safety_sos_ping(uuid,numeric,numeric,numeric),
  public.safety_sos_mark_safe(uuid,text), public.safety_incident_action(uuid,text,text,text), public.safety_is_operator() TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.safety_incidents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.safety_incident_events;