-- ============ client-submitted service requests ============
CREATE TABLE IF NOT EXISTS public.sales_lead_service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.sales_leads(id) ON DELETE CASCADE,
  request_ref text NOT NULL UNIQUE,
  service_type text NOT NULL CHECK (service_type IN ('DELIVERY','STAFF_TRANSPORT','AIRPORT_TRANSFER','CHARTER','OTHER')),
  pickup_location text NOT NULL,
  dropoff_location text NOT NULL,
  requested_date date,
  requested_time text,
  goods_description text,
  weight_kg numeric(12,2),
  vehicle_preference text,
  passengers integer,
  notes text,
  submitted_by_name text,
  contact_phone text,
  status text NOT NULL DEFAULT 'SUBMITTED'
    CHECK (status IN ('SUBMITTED','RECEIVED','IN_REVIEW','QUOTED','SCHEDULED','COMPLETED','DECLINED','CANCELLED')),
  status_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sales_lead_service_requests TO authenticated;
GRANT ALL ON public.sales_lead_service_requests TO service_role;
ALTER TABLE public.sales_lead_service_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY sales_lead_service_requests_read ON public.sales_lead_service_requests
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sales_leads l
    WHERE l.id = sales_lead_service_requests.lead_id
      AND (l.sales_staff_id = public._my_staff_member_id()
           OR public.has_staff_permission('staff.crm.read'))
  ));

CREATE INDEX IF NOT EXISTS sales_lead_service_requests_lead_idx
  ON public.sales_lead_service_requests(lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sales_lead_service_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.sales_lead_service_requests(id) ON DELETE CASCADE,
  action text NOT NULL,
  status_from text,
  status_to text,
  note text,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sales_lead_service_request_events TO authenticated;
GRANT ALL ON public.sales_lead_service_request_events TO service_role;
ALTER TABLE public.sales_lead_service_request_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY sales_lead_service_request_events_read ON public.sales_lead_service_request_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sales_lead_service_requests r
    JOIN public.sales_leads l ON l.id = r.lead_id
    WHERE r.id = sales_lead_service_request_events.request_id
      AND (l.sales_staff_id = public._my_staff_member_id()
           OR public.has_staff_permission('staff.crm.read'))
  ));

CREATE OR REPLACE FUNCTION public._sales_lead_request_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'sales_lead_service_request_events is append-only'; END $$;

DROP TRIGGER IF EXISTS trg_sales_lead_request_events_append_only ON public.sales_lead_service_request_events;
CREATE TRIGGER trg_sales_lead_request_events_append_only
  BEFORE UPDATE OR DELETE ON public.sales_lead_service_request_events
  FOR EACH ROW EXECUTE FUNCTION public._sales_lead_request_events_append_only();

CREATE OR REPLACE FUNCTION public._sales_lead_request_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_sales_lead_request_touch ON public.sales_lead_service_requests;
CREATE TRIGGER trg_sales_lead_request_touch
  BEFORE UPDATE ON public.sales_lead_service_requests
  FOR EACH ROW EXECUTE FUNCTION public._sales_lead_request_touch();

-- ============ client portal: submit a request (token scoped) ============
CREATE OR REPLACE FUNCTION public.sales_lead_request_submit(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _l public.sales_leads; _id uuid; _ref text; _type text := upper(COALESCE(p->>'service_type','DELIVERY'));
        _pick text := btrim(COALESCE(p->>'pickup_location','')); _drop text := btrim(COALESCE(p->>'dropoff_location',''));
        _open integer;
BEGIN
  SELECT * INTO _l FROM public.sales_leads
   WHERE contact_token IS NOT NULL AND contact_token = p->>'token';
  IF _l.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_LINK'); END IF;

  IF _type NOT IN ('DELIVERY','STAFF_TRANSPORT','AIRPORT_TRANSFER','CHARTER','OTHER') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'SERVICE_TYPE_REQUIRED');
  END IF;
  IF length(_pick) < 3 OR length(_drop) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ROUTE_REQUIRED');
  END IF;

  SELECT count(*) INTO _open FROM public.sales_lead_service_requests
   WHERE lead_id = _l.id AND created_at > now() - interval '1 hour';
  IF _open >= 10 THEN RETURN jsonb_build_object('ok', false, 'reason', 'TOO_MANY_REQUESTS'); END IF;

  _ref := 'REQ-' || to_char(now() AT TIME ZONE 'Africa/Nairobi', 'YYYYMM') || '-' ||
          upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 8));

  INSERT INTO public.sales_lead_service_requests(
    lead_id, request_ref, service_type, pickup_location, dropoff_location, requested_date,
    requested_time, goods_description, weight_kg, vehicle_preference, passengers, notes,
    submitted_by_name, contact_phone)
  VALUES (_l.id, _ref, _type, left(_pick, 300), left(_drop, 300),
          NULLIF(p->>'requested_date','')::date,
          left(NULLIF(btrim(COALESCE(p->>'requested_time','')),''), 40),
          left(NULLIF(btrim(COALESCE(p->>'goods_description','')),''), 2000),
          NULLIF(p->>'weight_kg','')::numeric,
          left(NULLIF(btrim(COALESCE(p->>'vehicle_preference','')),''), 120),
          NULLIF(p->>'passengers','')::integer,
          left(NULLIF(btrim(COALESCE(p->>'notes','')),''), 2000),
          left(NULLIF(btrim(COALESCE(p->>'submitted_by_name','')),''), 160),
          left(NULLIF(btrim(COALESCE(p->>'contact_phone','')),''), 40))
  RETURNING id INTO _id;

  INSERT INTO public.sales_lead_service_request_events(request_id, action, status_to, note)
  VALUES (_id, 'SUBMITTED_BY_CLIENT', 'SUBMITTED', left(_pick || ' to ' || _drop, 300));

  INSERT INTO public.sales_lead_events(lead_id, action, note, detail)
  VALUES (_l.id, 'CLIENT_REQUEST_SUBMITTED', _ref,
          jsonb_build_object('request_id', _id, 'service_type', _type));

  RETURN jsonb_build_object('ok', true, 'request_ref', _ref);
END $$;
REVOKE ALL ON FUNCTION public.sales_lead_request_submit(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_lead_request_submit(jsonb) TO anon, authenticated, service_role;

-- ============ staff: move a request's status ============
CREATE OR REPLACE FUNCTION public.sales_lead_request_status(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _r public.sales_lead_service_requests; _to text := upper(COALESCE(p->>'status','')); _from text;
BEGIN
  SELECT * INTO _r FROM public.sales_lead_service_requests WHERE id = (p->>'request_id')::uuid;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF NOT public._sales_lead_writable(_r.lead_id) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF _to NOT IN ('RECEIVED','IN_REVIEW','QUOTED','SCHEDULED','COMPLETED','DECLINED','CANCELLED') THEN
    RAISE EXCEPTION 'STATUS_NOT_ALLOWED';
  END IF;

  _from := _r.status;
  UPDATE public.sales_lead_service_requests
     SET status = _to,
         status_note = COALESCE(left(btrim(p->>'status_note'), 1000), status_note)
   WHERE id = _r.id;

  INSERT INTO public.sales_lead_service_request_events(request_id, action, status_from, status_to, note, actor_user_id)
  VALUES (_r.id, 'STATUS_CHANGED', _from, _to, left(btrim(p->>'status_note'), 300), auth.uid());

  RETURN jsonb_build_object('ok', true, 'request_ref', _r.request_ref, 'status', _to);
END $$;
REVOKE ALL ON FUNCTION public.sales_lead_request_status(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_lead_request_status(jsonb) TO authenticated, service_role;

-- ============ client portal view: thread + own requests ============
CREATE OR REPLACE FUNCTION public.sales_lead_contact_view(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _l public.sales_leads; _thread jsonb; _requests jsonb;
BEGIN
  SELECT * INTO _l FROM public.sales_leads
   WHERE contact_token IS NOT NULL AND contact_token = p->>'token';
  IF _l.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_LINK'); END IF;

  SELECT COALESCE(jsonb_agg(t ORDER BY t.created_at), '[]'::jsonb) INTO _thread
  FROM (
    SELECT m.created_at,
           m.direction,
           m.subject,
           left(m.body, 4000) AS body,
           CASE WHEN m.direction = 'OUTBOUND' THEN 'Yalla Mobility' ELSE COALESCE(m.sender_name, 'You') END AS author
      FROM public.sales_lead_messages m
     WHERE m.lead_id = _l.id
       AND m.channel <> 'INTERNAL_NOTE'
     ORDER BY m.created_at
  ) t;

  SELECT COALESCE(jsonb_agg(r ORDER BY r.created_at DESC), '[]'::jsonb) INTO _requests
  FROM (
    SELECT sr.request_ref, sr.service_type, sr.pickup_location, sr.dropoff_location,
           sr.requested_date, sr.requested_time, sr.goods_description, sr.weight_kg,
           sr.vehicle_preference, sr.passengers, sr.notes, sr.status, sr.status_note,
           sr.created_at, sr.updated_at
      FROM public.sales_lead_service_requests sr
     WHERE sr.lead_id = _l.id
  ) r;

  RETURN jsonb_build_object('ok', true,
    'lead_ref', _l.lead_ref,
    'organisation_name', _l.organisation_name,
    'contact_name', _l.contact_name,
    'service_interest', _l.service_interest,
    'contact_state', _l.contact_state,
    'last_outreach_at', _l.last_outreach_at,
    'last_reply_at', _l.last_reply_at,
    'information_request', _l.information_request,
    'thread', _thread,
    'requests', _requests);
END $$;

REVOKE ALL ON FUNCTION public.sales_lead_contact_view(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_lead_contact_view(jsonb) TO anon, authenticated, service_role;

-- ============ desk KPIs with response time ============
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
      'avg_days_to_first_reply', round(
        (avg(EXTRACT(EPOCH FROM (l.first_reply_at - l.first_outreach_at)) / 86400.0)
         FILTER (WHERE l.first_reply_at IS NOT NULL AND l.first_outreach_at IS NOT NULL))::numeric, 1),
      'avg_hours_to_first_reply', round(
        (avg(EXTRACT(EPOCH FROM (l.first_reply_at - l.first_outreach_at)) / 3600.0)
         FILTER (WHERE l.first_reply_at IS NOT NULL AND l.first_outreach_at IS NOT NULL))::numeric, 1),
      'median_hours_to_first_reply', round(
        (percentile_cont(0.5) WITHIN GROUP (
           ORDER BY CASE WHEN l.first_reply_at IS NOT NULL AND l.first_outreach_at IS NOT NULL
                    THEN EXTRACT(EPOCH FROM (l.first_reply_at - l.first_outreach_at)) / 3600.0 END))::numeric, 1),
      'replies_measured', count(*) FILTER (WHERE l.first_reply_at IS NOT NULL AND l.first_outreach_at IS NOT NULL),
      'awaiting_over_72h', count(*) FILTER (
        WHERE l.contact_state = 'CONTACTED' AND l.first_outreach_at IS NOT NULL
          AND l.first_outreach_at < now() - interval '72 hours'),
      'longest_wait_hours', round(
        (max(EXTRACT(EPOCH FROM (now() - l.first_outreach_at)) / 3600.0)
         FILTER (WHERE l.contact_state = 'CONTACTED' AND l.first_outreach_at IS NOT NULL))::numeric, 1),
      'followups_open', (SELECT count(*) FROM public.sales_lead_followups f
         JOIN public.sales_leads fl ON fl.id = f.lead_id
         WHERE f.status = 'OPEN' AND fl.sales_staff_id IS NOT DISTINCT FROM l.sales_staff_id),
      'followups_overdue', (SELECT count(*) FROM public.sales_lead_followups f
         JOIN public.sales_leads fl ON fl.id = f.lead_id
         WHERE f.status = 'OPEN' AND fl.sales_staff_id IS NOT DISTINCT FROM l.sales_staff_id
           AND f.due_date < (now() AT TIME ZONE 'Africa/Nairobi')::date),
      'open_client_requests', (SELECT count(*) FROM public.sales_lead_service_requests sr
         JOIN public.sales_leads rl ON rl.id = sr.lead_id
         WHERE rl.sales_staff_id IS NOT DISTINCT FROM l.sales_staff_id
           AND sr.status IN ('SUBMITTED','RECEIVED','IN_REVIEW','QUOTED')),
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