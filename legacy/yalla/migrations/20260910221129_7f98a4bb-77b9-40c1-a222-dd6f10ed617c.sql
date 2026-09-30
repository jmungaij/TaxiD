CREATE OR REPLACE FUNCTION public.sales_lead_request_submit(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Reference built from gen_random_uuid(), which is core Postgres: pgcrypto's
  -- gen_random_bytes lives outside this function's pinned search_path.
  _ref := 'REQ-' || to_char(now() AT TIME ZONE 'Africa/Nairobi', 'YYYYMM') || '-' ||
          upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

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
END $function$;