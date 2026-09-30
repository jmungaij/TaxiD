CREATE OR REPLACE FUNCTION public.carrier_application_submit(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_name text := btrim(coalesce(p->>'legal_entity_name',''));
  v_contact text := btrim(coalesce(p->>'contact_name',''));
  v_email text := lower(btrim(coalesce(p->>'contact_email','')));
  v_phone text := btrim(coalesce(p->>'contact_phone',''));
  v_ref text;
  v_token text;
  v_id uuid;
  v_existing public.carrier_applications;
BEGIN
  IF length(v_name) < 3 OR length(v_name) > 200 THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_LEGAL_ENTITY_NAME');
  END IF;
  IF length(v_contact) < 3 OR length(v_contact) > 120 THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_CONTACT_NAME');
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' OR length(v_email) > 200 THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_CONTACT_EMAIL');
  END IF;
  IF v_phone !~ '^[0-9+ ()-]{9,20}$' THEN
    RETURN jsonb_build_object('error', true, 'code', 'INVALID_CONTACT_PHONE');
  END IF;
  IF length(coalesce(p->>'notes','')) > 4000 THEN
    RETURN jsonb_build_object('error', true, 'code', 'NOTES_TOO_LONG');
  END IF;

  SELECT * INTO v_existing FROM public.carrier_applications
   WHERE lower(legal_entity_name) = lower(v_name)
     AND contact_email = v_email
     AND status IN ('SUBMITTED','UNDER_REVIEW','INFO_REQUESTED')
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true,
      'application_reference', v_existing.application_reference,
      'claim_token', v_existing.claim_token,
      'status', v_existing.status);
  END IF;

  v_ref := 'FOA-' || to_char(now(), 'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 6));
  v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');

  INSERT INTO public.carrier_applications (
    application_reference, legal_entity_name, trading_name, registration_number,
    tax_identifier, country, county, town, contact_name, contact_position,
    contact_email, contact_phone, fleet_size, vehicle_types, service_categories,
    corridors, notes, applicant_user_id, claim_token
  ) VALUES (
    v_ref, v_name, nullif(btrim(coalesce(p->>'trading_name','')),''),
    nullif(btrim(coalesce(p->>'registration_number','')),''),
    nullif(btrim(coalesce(p->>'tax_identifier','')),''),
    coalesce(nullif(btrim(coalesce(p->>'country','')),''), 'KE'),
    nullif(btrim(coalesce(p->>'county','')),''),
    nullif(btrim(coalesce(p->>'town','')),''),
    v_contact, nullif(btrim(coalesce(p->>'contact_position','')),''),
    v_email, v_phone,
    nullif(p->>'fleet_size','')::int,
    coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(p->'vehicle_types','[]'::jsonb)) t(x)), '{}'),
    coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(p->'service_categories','[]'::jsonb)) t(x)), '{}'),
    coalesce((SELECT array_agg(x) FROM jsonb_array_elements_text(coalesce(p->'corridors','[]'::jsonb)) t(x)), '{}'),
    nullif(btrim(coalesce(p->>'notes','')),''),
    auth.uid(), v_token
  ) RETURNING id INTO v_id;

  INSERT INTO public.carrier_application_events (application_id, action, status_to, actor_user_id)
  VALUES (v_id, 'SUBMITTED', 'SUBMITTED', auth.uid());

  RETURN jsonb_build_object('ok', true, 'application_reference', v_ref,
    'claim_token', v_token, 'status', 'SUBMITTED');
END; $function$;