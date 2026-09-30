CREATE OR REPLACE FUNCTION public.partner_application_to_fleet_owner(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := (p->>'application_id')::uuid;
  a public.partner_applications;
  v_ref text;
  v_app uuid;
BEGIN
  IF NOT public.has_staff_permission('staff.partners.manage') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  SELECT * INTO a FROM public.partner_applications WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','UNKNOWN_APPLICATION'); END IF;

  IF a.carrier_application_id IS NOT NULL THEN
    SELECT application_reference INTO v_ref FROM public.carrier_applications WHERE id = a.carrier_application_id;
    RETURN jsonb_build_object('ok', true, 'already_converted', true,
      'carrier_application_id', a.carrier_application_id, 'application_reference', v_ref);
  END IF;

  IF coalesce(a.review_status,'') <> 'QUALIFIED' THEN
    RETURN jsonb_build_object('error', true, 'code','NOT_QUALIFIED',
      'status', coalesce(a.review_status, a.status));
  END IF;

  IF a.contact_email IS NULL OR a.contact_phone IS NULL OR a.organisation_name IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code','INCOMPLETE_APPLICANT_CONTRACT');
  END IF;

  v_ref := 'FOA-' || to_char(now(),'YYYYMM') || '-' ||
           upper(substr(md5(v_id::text || clock_timestamp()::text), 1, 6));

  INSERT INTO public.carrier_applications (
    application_reference, status, legal_entity_name, trading_name,
    country, town, contact_name, contact_email, contact_phone,
    applicant_user_id, claim_token, notes
  ) VALUES (
    v_ref, 'SUBMITTED', a.organisation_name, nullif(a.organisation_name,''),
    coalesce(a.country,'KE'), a.city, a.contact_name, a.contact_email, a.contact_phone,
    a.submitted_by,
    replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''),
    'Converted from partner application ' || a.reference
  ) RETURNING id INTO v_app;

  UPDATE public.partner_applications SET
    carrier_application_id = v_app,
    converted_at = now(),
    converted_by = auth.uid(),
    review_status = 'ONBOARDING'
  WHERE id = v_id;

  INSERT INTO public.partner_application_events
    (application_id, action, status_from, status_to, note, actor_user_id, detail)
  VALUES (v_id, 'CONVERT_TO_FLEET_OWNER', 'QUALIFIED', 'ONBOARDING',
    'Fleet Owner application ' || v_ref, auth.uid(),
    jsonb_build_object('carrier_application_id', v_app, 'application_reference', v_ref));

  INSERT INTO public.carrier_application_events
    (application_id, action, status_from, status_to, note, actor_user_id)
  VALUES (v_app, 'CREATED_FROM_PARTNER_APPLICATION', NULL, 'SUBMITTED',
    'Partner application ' || a.reference, auth.uid());

  RETURN jsonb_build_object('ok', true, 'carrier_application_id', v_app,
    'application_reference', v_ref);
END; $$;

REVOKE ALL ON FUNCTION public.partner_application_to_fleet_owner(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_application_to_fleet_owner(jsonb) TO authenticated, service_role;