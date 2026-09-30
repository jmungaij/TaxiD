CREATE OR REPLACE FUNCTION public.sales_activation_fleet(p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.is_linked_commercial_staff() THEN RAISE EXCEPTION 'NOT_COMMERCIAL_STAFF'; END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'drivers', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'driver_id', d.id,
        'label', trim(concat_ws(' ', d.first_name, d.last_name)),
        'driver_code', d.driver_code,
        'status', d.status
      ) ORDER BY d.first_name, d.last_name)
      FROM public.drivers d
      WHERE d.status::text IN ('active','ACTIVE','approved','APPROVED')
    ), '[]'::jsonb),
    'vehicles', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'vehicle_id', vh.id,
        'label', coalesce(vh.number_plate, vh.vehicle_code),
        'description', trim(concat_ws(' ', vh.make, vh.model)),
        'seating_capacity', vh.seating_capacity,
        'status', vh.vehicle_status
      ) ORDER BY vh.number_plate NULLS LAST, vh.vehicle_code)
      FROM public.vehicles vh
    ), '[]'::jsonb)
  ) INTO v;

  RETURN v;
END $fn$;

REVOKE EXECUTE ON FUNCTION public.sales_activation_fleet(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_activation_fleet(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sales_activation_assignment_upsert(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := nullif(p->>'assignment_id','')::uuid;
  c public.commercial_contract_instances;
  v_start date := nullif(p->>'start_date','')::date;
  v_end date := nullif(p->>'end_date','')::date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.is_linked_commercial_staff() THEN RAISE EXCEPTION 'NOT_COMMERCIAL_STAFF'; END IF;

  IF v_id IS NOT NULL THEN
    SELECT ci.* INTO c FROM public.commercial_contract_instances ci
      JOIN public.commercial_activation_assignments a ON a.contract_id = ci.id
     WHERE a.id = v_id;
    IF c.id IS NULL THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;

    IF v_start IS NOT NULL AND c.term_start IS NOT NULL AND v_start < c.term_start::date THEN
      RAISE EXCEPTION 'DATES_OUTSIDE_CONTRACT_TERM';
    END IF;
    IF v_end IS NOT NULL AND c.term_end IS NOT NULL AND v_end > c.term_end::date THEN
      RAISE EXCEPTION 'DATES_OUTSIDE_CONTRACT_TERM';
    END IF;
    IF v_start IS NOT NULL AND v_end IS NOT NULL AND v_end < v_start THEN
      RAISE EXCEPTION 'END_BEFORE_START';
    END IF;

    UPDATE public.commercial_activation_assignments SET
      assignment_role = coalesce(nullif(p->>'assignment_role',''), assignment_role),
      staff_member_id = coalesce(nullif(p->>'staff_member_id','')::uuid, staff_member_id),
      person_label = coalesce(nullif(p->>'person_label',''), person_label),
      vehicle_label = coalesce(nullif(p->>'vehicle_label',''), vehicle_label),
      start_date = coalesce(v_start, start_date),
      end_date = coalesce(v_end, end_date),
      status = coalesce(nullif(p->>'status',''), status),
      notes = coalesce(nullif(p->>'notes',''), notes)
    WHERE id = v_id;
    RETURN jsonb_build_object('assignment_id', v_id);
  END IF;

  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = (p->>'contract_id')::uuid;
  IF c.id IS NULL THEN RAISE EXCEPTION 'CONTRACT_NOT_FOUND'; END IF;
  IF coalesce(p->>'assignment_role','') = '' THEN RAISE EXCEPTION 'ROLE_REQUIRED'; END IF;
  IF coalesce(nullif(p->>'person_label',''), p->>'staff_member_id', p->>'vehicle_label') IS NULL THEN
    RAISE EXCEPTION 'WHO_OR_WHAT_IS_ASSIGNED_REQUIRED';
  END IF;
  IF v_start IS NOT NULL AND c.term_start IS NOT NULL AND v_start < c.term_start::date THEN
    RAISE EXCEPTION 'DATES_OUTSIDE_CONTRACT_TERM';
  END IF;
  IF v_end IS NOT NULL AND c.term_end IS NOT NULL AND v_end > c.term_end::date THEN
    RAISE EXCEPTION 'DATES_OUTSIDE_CONTRACT_TERM';
  END IF;
  IF v_start IS NOT NULL AND v_end IS NOT NULL AND v_end < v_start THEN
    RAISE EXCEPTION 'END_BEFORE_START';
  END IF;

  INSERT INTO public.commercial_activation_assignments (
    contract_id, account_id, assignment_role, staff_member_id, person_label, vehicle_label,
    start_date, end_date, status, notes, created_by
  ) VALUES (
    c.id, c.account_id, p->>'assignment_role', nullif(p->>'staff_member_id','')::uuid,
    nullif(p->>'person_label',''), nullif(p->>'vehicle_label',''),
    v_start, v_end,
    coalesce(nullif(p->>'status',''),'PLANNED'), nullif(p->>'notes',''), auth.uid()
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('assignment_id', v_id);
END $function$;