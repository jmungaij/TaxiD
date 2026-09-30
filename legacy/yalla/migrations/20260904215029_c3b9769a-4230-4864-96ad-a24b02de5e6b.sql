CREATE OR REPLACE FUNCTION public.partner_application_submit(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org text := btrim(coalesce(p->>'organisation_name',''));
  v_name text := btrim(coalesce(p->>'contact_name',''));
  v_email text := lower(btrim(coalesce(p->>'contact_email','')));
  v_phone text := btrim(regexp_replace(coalesce(p->>'contact_phone',''), '\s+', ' ', 'g'));
  v_country text := coalesce(nullif(btrim(coalesce(p->>'country','')),''),'KE');
  v_type text := upper(btrim(coalesce(p->>'partner_type','')));
  v_model text := upper(btrim(coalesce(p->>'commercial_model','')));
  v_id uuid; v_ref text;
BEGIN
  IF length(v_org) < 2 OR length(v_org) > 200 THEN
    RETURN jsonb_build_object('error', true, 'code','VALIDATION_ERROR','field','organisation_name');
  END IF;
  IF length(v_name) < 2 OR length(v_name) > 150 THEN
    RETURN jsonb_build_object('error', true, 'code','VALIDATION_ERROR','field','contact_name');
  END IF;
  IF length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$' THEN
    RETURN jsonb_build_object('error', true, 'code','VALIDATION_ERROR','field','contact_email');
  END IF;
  IF length(v_phone) < 7 OR length(v_phone) > 30 THEN
    RETURN jsonb_build_object('error', true, 'code','VALIDATION_ERROR','field','contact_phone');
  END IF;
  IF length(v_country) < 2 OR length(v_country) > 100 THEN
    RETURN jsonb_build_object('error', true, 'code','VALIDATION_ERROR','field','country');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                  WHERE t.typname = 'partner_type' AND e.enumlabel = v_type) THEN
    RETURN jsonb_build_object('error', true, 'code','VALIDATION_ERROR','field','partner_type');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                  WHERE t.typname = 'partner_commercial_model' AND e.enumlabel = v_model) THEN
    RETURN jsonb_build_object('error', true, 'code','VALIDATION_ERROR','field','commercial_model');
  END IF;

  INSERT INTO public.partner_applications (
    organisation_name, partner_type, commercial_model, category,
    contact_name, contact_email, contact_phone, country, city, website,
    monthly_volume_estimate, requirements,
    intent_bring, network_category, maturity_level, lifecycle_stage, ab_variant, session_id,
    status, submitted_by)
  VALUES (
    v_org, v_type::partner_type, v_model::partner_commercial_model,
    left(nullif(btrim(coalesce(p->>'category','')),''), 120),
    v_name, v_email, v_phone, v_country,
    left(nullif(btrim(coalesce(p->>'city','')),''), 120),
    left(nullif(btrim(coalesce(p->>'website','')),''), 500),
    CASE WHEN (p->>'monthly_volume_estimate') ~ '^[0-9]{1,8}$'
         THEN least((p->>'monthly_volume_estimate')::integer, 10000000) END,
    left(nullif(btrim(coalesce(p->>'requirements','')),''), 5000),
    left(nullif(btrim(coalesce(p->>'intent_bring','')),''), 2000),
    left(nullif(btrim(coalesce(p->>'network_category','')),''), 120),
    left(nullif(btrim(coalesce(p->>'maturity_level','')),''), 60),
    left(nullif(btrim(coalesce(p->>'lifecycle_stage','')),''), 60),
    left(nullif(btrim(coalesce(p->>'ab_variant','')),''), 60),
    left(nullif(btrim(coalesce(p->>'session_id','')),''), 128),
    'submitted', auth.uid())
  RETURNING id, reference INTO v_id, v_ref;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'reference', v_ref);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'partner_application_submit failed: % %', SQLSTATE, SQLERRM;
  RETURN jsonb_build_object('error', true, 'code','SUBMISSION_FAILED');
END
$fn$;

REVOKE ALL ON FUNCTION public.partner_application_submit(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_application_submit(jsonb) TO anon, authenticated, service_role;