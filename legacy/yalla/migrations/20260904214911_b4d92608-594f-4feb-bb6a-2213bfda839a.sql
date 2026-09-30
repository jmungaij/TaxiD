-- ============================================================
-- A. Fleet owner (carrier) attribution for logistics legs
-- ============================================================
CREATE OR REPLACE FUNCTION public._carrier_owns_leg(_carrier_id uuid, _leg_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _carrier_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.logistics_order_legs l
      LEFT JOIN public.logistics_fleet_capacity f ON f.vehicle_id = l.vehicle_id
      LEFT JOIN public.drivers d ON d.id = l.driver_id
     WHERE l.id = _leg_id
       AND (f.carrier_id = _carrier_id OR d.carrier_id = _carrier_id)
  );
$$;

REVOKE ALL ON FUNCTION public._carrier_owns_leg(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._carrier_owns_leg(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public._carrier_owns_leg(uuid, uuid) TO authenticated, service_role;

-- Relationship-based read access: authenticated carrier member -> its carrier ->
-- its attributed legs. Existing predicates (staff / driver / customer) untouched.
DROP POLICY IF EXISTS legs_carrier_member_read ON public.logistics_order_legs;
CREATE POLICY legs_carrier_member_read
ON public.logistics_order_legs
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.logistics_fleet_capacity f
     WHERE f.vehicle_id = logistics_order_legs.vehicle_id
       AND f.carrier_id IS NOT NULL
       AND public._carrier_is_member(f.carrier_id)
  )
  OR EXISTS (
    SELECT 1 FROM public.drivers d
     WHERE d.id = logistics_order_legs.driver_id
       AND d.carrier_id IS NOT NULL
       AND public._carrier_is_member(d.carrier_id)
  )
);

-- ============================================================
-- B. POD submission must independently prove leg ownership
-- ============================================================
CREATE OR REPLACE FUNCTION public.carrier_pod_submit(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_carrier uuid := (p->>'carrier_id')::uuid;
  v_leg uuid := (p->>'leg_id')::uuid;
  v_key text := coalesce(p->>'idempotency_key','');
  v_leg_row public.logistics_order_legs;
  v_existing public.carrier_pod_submissions;
  v_evidence jsonb := coalesce(p->'evidence','[]'::jsonb);
  v_ref text; v_id uuid; v_hash text; v_dispatch uuid;
BEGIN
  IF NOT public._carrier_is_member(v_carrier) THEN
    RETURN jsonb_build_object('error', true, 'code','NOT_AUTHORISED');
  END IF;
  IF v_key = '' THEN
    RETURN jsonb_build_object('error', true, 'code','IDEMPOTENCY_KEY_REQUIRED');
  END IF;

  SELECT * INTO v_existing FROM public.carrier_pod_submissions WHERE idempotency_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'submission_id', v_existing.id,
      'reference', v_existing.submission_reference, 'state', v_existing.state);
  END IF;

  SELECT * INTO v_leg_row FROM public.logistics_order_legs WHERE id = v_leg;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','LEG_NOT_FOUND'); END IF;

  -- Ownership is established by the database, never by the client-supplied carrier_id.
  IF NOT public._carrier_owns_leg(v_carrier, v_leg) THEN
    RETURN jsonb_build_object('error', true, 'code','LEG_NOT_ATTRIBUTED_TO_CARRIER');
  END IF;

  IF v_leg_row.status <> 'COMPLETED' THEN
    RETURN jsonb_build_object('error', true, 'code','LEG_NOT_COMPLETED', 'status', v_leg_row.status);
  END IF;
  IF coalesce(btrim(p->>'recipient_name'),'') = '' THEN
    RETURN jsonb_build_object('error', true, 'code','VALIDATION_ERROR','field','recipient_name');
  END IF;
  IF (p->>'delivered_at') IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code','VALIDATION_ERROR','field','delivered_at');
  END IF;
  IF jsonb_array_length(v_evidence) < 1 THEN
    RETURN jsonb_build_object('error', true, 'code','EVIDENCE_REQUIRED');
  END IF;
  IF EXISTS (SELECT 1 FROM public.carrier_pod_submissions
              WHERE leg_id = v_leg AND state IN ('SUBMITTED','APPROVED')) THEN
    RETURN jsonb_build_object('error', true, 'code','POD_ALREADY_PENDING_OR_APPROVED');
  END IF;

  SELECT id INTO v_dispatch FROM public.logistics_dispatch_requests
   WHERE leg_id = v_leg ORDER BY created_at DESC LIMIT 1;

  v_hash := encode(sha256(convert_to(
    coalesce(v_carrier::text,'') || '|' || v_leg::text || '|' ||
    (p->>'delivered_at') || '|' || btrim(p->>'recipient_name') || '|' || v_evidence::text, 'utf8')), 'hex');

  v_ref := 'CPOD-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(v_key || v_leg::text), 1, 6));

  INSERT INTO public.carrier_pod_submissions (
    submission_reference, carrier_id, leg_id, order_id, dispatch_request_id,
    recipient_name, recipient_relationship, recipient_id_reference, recipient_phone,
    delivered_at, captured_lat, captured_lng, notes, evidence, integrity_hash,
    submitted_by, idempotency_key)
  VALUES (v_ref, v_carrier, v_leg, v_leg_row.order_id, v_dispatch,
    btrim(p->>'recipient_name'), p->>'recipient_relationship', p->>'recipient_id_reference',
    p->>'recipient_phone', (p->>'delivered_at')::timestamptz,
    (p->>'captured_lat')::numeric, (p->>'captured_lng')::numeric, p->>'notes',
    v_evidence, v_hash, auth.uid(), v_key)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'submission_id', v_id, 'reference', v_ref,
    'state','SUBMITTED', 'integrity_hash', v_hash);
END
$fn$;

REVOKE ALL ON FUNCTION public.carrier_pod_submit(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.carrier_pod_submit(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.carrier_pod_submit(jsonb) TO authenticated, service_role;

-- ============================================================
-- C. Canonical public partner application ingestion
-- ============================================================
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
  v_country text := btrim(coalesce(nullif(btrim(coalesce(p->>'country','')),''),'KE'));
  v_id uuid; v_ref text;

  FUNCTION_BODY_MARKER boolean := true;
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
  IF (p->>'partner_type') IS NULL OR (p->>'commercial_model') IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code','VALIDATION_ERROR','field','partner_type');
  END IF;

  INSERT INTO public.partner_applications (
    organisation_name, partner_type, commercial_model, category,
    contact_name, contact_email, contact_phone, country, city, website,
    monthly_volume_estimate, requirements,
    intent_bring, network_category, maturity_level, lifecycle_stage, ab_variant, session_id,
    status, submitted_by)
  VALUES (
    v_org,
    (p->>'partner_type')::partner_type,
    (p->>'commercial_model')::partner_commercial_model,
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
END
$fn$;

REVOKE ALL ON FUNCTION public.partner_application_submit(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_application_submit(jsonb) TO anon, authenticated, service_role;