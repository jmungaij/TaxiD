CREATE OR REPLACE FUNCTION public.sales_lead_update_details(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  l public.sales_leads;
  v_org text; v_name text; v_email text; v_phone text; v_service text; v_notes text;
  v_value numeric;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  l := public._sales_lead_authorise((p->>'lead_id')::uuid);

  v_org     := nullif(trim(coalesce(p->>'organisation_name','')),'');
  v_name    := nullif(trim(coalesce(p->>'contact_name','')),'');
  v_email   := lower(nullif(trim(coalesce(p->>'contact_email','')),''));
  v_phone   := nullif(trim(coalesce(p->>'contact_phone','')),'');
  v_service := nullif(trim(coalesce(p->>'service_interest','')),'');
  v_notes   := nullif(trim(coalesce(p->>'notes','')),'');
  v_value   := nullif(trim(coalesce(p->>'estimated_value_kes','')),'')::numeric;

  -- An organisation name is the lead's identity: it may be corrected, never emptied.
  IF (p ? 'organisation_name') AND v_org IS NULL THEN
    RAISE EXCEPTION 'ORGANISATION_NAME_REQUIRED';
  END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'EMAIL_NOT_VALID';
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^[0-9+][0-9 ()+-]{6,19}$' THEN
    RAISE EXCEPTION 'PHONE_NOT_VALID';
  END IF;
  IF v_value IS NOT NULL AND v_value < 0 THEN
    RAISE EXCEPTION 'VALUE_NOT_VALID';
  END IF;

  -- Only supplied keys are touched, so a partial edit never blanks a field
  -- the specialist did not open.
  UPDATE public.sales_leads
     SET organisation_name  = CASE WHEN p ? 'organisation_name'  THEN v_org     ELSE organisation_name END,
         contact_name       = CASE WHEN p ? 'contact_name'       THEN v_name    ELSE contact_name END,
         contact_email      = CASE WHEN p ? 'contact_email'      THEN v_email   ELSE contact_email END,
         contact_phone      = CASE WHEN p ? 'contact_phone'      THEN v_phone   ELSE contact_phone END,
         service_interest   = CASE WHEN p ? 'service_interest'   THEN v_service ELSE service_interest END,
         notes              = CASE WHEN p ? 'notes'              THEN v_notes   ELSE notes END,
         estimated_value_kes= CASE WHEN p ? 'estimated_value_kes' THEN v_value  ELSE estimated_value_kes END,
         updated_at = now()
   WHERE id = l.id;

  v_changes := jsonb_strip_nulls(jsonb_build_object(
    'organisation_name', CASE WHEN (p ? 'organisation_name')  AND v_org     IS DISTINCT FROM l.organisation_name   THEN v_org     END,
    'contact_name',      CASE WHEN (p ? 'contact_name')       AND v_name    IS DISTINCT FROM l.contact_name        THEN v_name    END,
    'contact_email',     CASE WHEN (p ? 'contact_email')      AND v_email   IS DISTINCT FROM l.contact_email       THEN v_email   END,
    'contact_phone',     CASE WHEN (p ? 'contact_phone')      AND v_phone   IS DISTINCT FROM l.contact_phone       THEN v_phone   END,
    'service_interest',  CASE WHEN (p ? 'service_interest')   AND v_service IS DISTINCT FROM l.service_interest    THEN v_service END,
    'estimated_value_kes', CASE WHEN (p ? 'estimated_value_kes') AND v_value IS DISTINCT FROM l.estimated_value_kes THEN v_value  END,
    'notes',             CASE WHEN (p ? 'notes')              AND v_notes   IS DISTINCT FROM l.notes               THEN v_notes   END
  ));

  IF v_changes <> '{}'::jsonb THEN
    INSERT INTO public.sales_lead_events (lead_id, action, note, actor_user_id, detail)
    VALUES (l.id, 'DETAILS_UPDATED',
            nullif(trim(coalesce(p->>'reason','')),''),
            auth.uid(),
            jsonb_build_object('changed', v_changes));
  END IF;

  RETURN jsonb_build_object('lead_id', l.id, 'changed', v_changes);
END $function$;

REVOKE ALL ON FUNCTION public.sales_lead_update_details(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_lead_update_details(jsonb) TO authenticated;