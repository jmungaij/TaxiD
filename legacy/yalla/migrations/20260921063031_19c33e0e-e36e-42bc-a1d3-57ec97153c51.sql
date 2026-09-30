-- Licence records for drivers on the fleet register.
-- driver_documents.driver_id references auth.users, so it can only hold papers
-- for drivers who have an app account. Fleet-register drivers (corporate/
-- chauffeur drivers without an app login) get their licence here, keyed to the
-- driver record itself.
-- Rollback: drop table public.fleet_driver_licences and restore the previous
-- bodies of fleet_driver_upsert / fleet_register_read / sales_activation_fleet /
-- sales_activation_assignment_upsert.

CREATE TABLE IF NOT EXISTS public.fleet_driver_licences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  licence_number text NOT NULL,
  expiry_date date,
  issue_date date,
  file_url text,
  file_name text,
  status text NOT NULL DEFAULT 'PENDING',
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.fleet_driver_licences TO authenticated;
GRANT ALL ON public.fleet_driver_licences TO service_role;
ALTER TABLE public.fleet_driver_licences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fleet_driver_licences_read" ON public.fleet_driver_licences;
CREATE POLICY "fleet_driver_licences_read" ON public.fleet_driver_licences FOR SELECT TO authenticated
USING (
  public.has_staff_permission('staff.logistics.read')
  OR public.has_staff_permission('staff.logistics.manage')
  OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
);

DROP TRIGGER IF EXISTS fleet_driver_licences_touch ON public.fleet_driver_licences;
CREATE TRIGGER fleet_driver_licences_touch BEFORE UPDATE ON public.fleet_driver_licences
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS fleet_driver_licences_driver_idx ON public.fleet_driver_licences(driver_id);

-- Single source of licence truth for a driver record.
CREATE OR REPLACE FUNCTION public.fleet_driver_licence(_driver_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT to_jsonb(x) FROM (
    SELECT l.licence_number AS number, l.expiry_date AS expiry, l.status, l.file_url
      FROM public.fleet_driver_licences l WHERE l.driver_id = _driver_id
    UNION ALL
    SELECT dd.document_number, dd.expiry_date, dd.status, dd.file_url
      FROM public.driver_documents dd
      JOIN public.drivers d ON d.user_id = dd.driver_id
     WHERE d.id = _driver_id AND dd.doc_type IN ('DRIVING_LICENSE','DRIVING_LICENCE')
    ORDER BY expiry DESC NULLS LAST
    LIMIT 1
  ) x;
$function$;

REVOKE ALL ON FUNCTION public.fleet_driver_licence(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fleet_driver_licence(uuid) TO authenticated, service_role;

-- Driver upsert now files the licence against the driver record.
CREATE OR REPLACE FUNCTION public.fleet_driver_upsert(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := nullif(p->>'driver_id','')::uuid;
  v_first text := nullif(trim(p->>'first_name'),'');
  v_last text := nullif(trim(p->>'last_name'),'');
  v_lic_no text := nullif(trim(p->>'licence_number'),'');
  v_lic_exp date := nullif(p->>'licence_expiry','')::date;
  v_lic_file text := nullif(p->>'licence_file_url','');
  v_photo text := nullif(p->>'photo_url','');
  v_type text := coalesce(nullif(p->>'driver_type',''), 'individual');
  v_status text := coalesce(nullif(p->>'status',''), 'pending');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT (
    public.has_staff_permission('staff.logistics.manage')
    OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  ) THEN RAISE EXCEPTION 'NOT_FLEET_MANAGER'; END IF;

  IF v_id IS NULL AND (v_first IS NULL OR v_last IS NULL) THEN RAISE EXCEPTION 'DRIVER_NAME_REQUIRED'; END IF;
  IF v_status NOT IN ('draft','pending','active','suspended','deactivated','blacklisted') THEN
    RAISE EXCEPTION 'UNKNOWN_DRIVER_STATUS'; END IF;
  IF v_type NOT IN ('individual','fleet_driver','corporate_driver') THEN RAISE EXCEPTION 'UNKNOWN_DRIVER_TYPE'; END IF;
  IF v_lic_exp IS NOT NULL AND v_lic_no IS NULL THEN RAISE EXCEPTION 'LICENCE_NUMBER_REQUIRED'; END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.drivers (first_name, last_name, phone_number, national_id, kra_pin,
                                driver_type, status, created_by, updated_by)
    VALUES (v_first, v_last, nullif(trim(p->>'phone_number'),''), nullif(trim(p->>'national_id'),''),
            nullif(trim(p->>'kra_pin'),''), v_type::driver_type, v_status::driver_status, auth.uid(), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.drivers SET
      first_name = coalesce(v_first, first_name),
      last_name = coalesce(v_last, last_name),
      phone_number = coalesce(nullif(trim(p->>'phone_number'),''), phone_number),
      national_id = coalesce(nullif(trim(p->>'national_id'),''), national_id),
      kra_pin = coalesce(nullif(trim(p->>'kra_pin'),''), kra_pin),
      driver_type = v_type::driver_type,
      status = v_status::driver_status,
      updated_by = auth.uid(),
      updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'DRIVER_NOT_ON_REGISTER'; END IF;
  END IF;

  IF v_photo IS NOT NULL THEN
    INSERT INTO public.driver_photos (driver_id, photo_type, storage_url)
    VALUES (v_id, 'PROFILE', v_photo);
  END IF;

  IF v_lic_no IS NOT NULL THEN
    DELETE FROM public.fleet_driver_licences WHERE driver_id = v_id;
    INSERT INTO public.fleet_driver_licences (driver_id, licence_number, expiry_date, file_url, file_name, recorded_by)
    VALUES (v_id, v_lic_no, v_lic_exp, v_lic_file, nullif(p->>'licence_file_name',''), auth.uid());
  END IF;

  RETURN jsonb_build_object('driver_id', v_id);
END $function$;

REVOKE ALL ON FUNCTION public.fleet_driver_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fleet_driver_upsert(jsonb) TO authenticated, service_role;

-- Reads use the single licence source.
CREATE OR REPLACE FUNCTION public.sales_activation_fleet(p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT (
    public.is_linked_commercial_staff()
    OR public.has_staff_permission('staff.logistics.read')
    OR public.has_staff_permission('staff.logistics.manage')
    OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  ) THEN RAISE EXCEPTION 'NOT_COMMERCIAL_STAFF'; END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'drivers', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'label')
      FROM (
        SELECT jsonb_build_object(
          'driver_id', d.id,
          'label', nullif(trim(concat_ws(' ', d.first_name, d.last_name)), ''),
          'driver_code', d.driver_code,
          'status', d.status::text,
          'driver_type', d.driver_type::text,
          'phone_number', d.phone_number,
          'photo_url', (SELECT ph.storage_url FROM public.driver_photos ph
                         WHERE ph.driver_id = d.id ORDER BY ph.uploaded_at DESC NULLS LAST LIMIT 1),
          'licence_number', lic->>'number',
          'licence_expiry', lic->>'expiry',
          'licence_status', lic->>'status',
          'licence_file_url', lic->>'file_url'
        ) AS x
        FROM public.drivers d
        LEFT JOIN LATERAL (SELECT public.fleet_driver_licence(d.id) AS lic) l ON TRUE
        WHERE d.status::text IN ('active','pending')
      ) s
    ), '[]'::jsonb),
    'vehicles', coalesce((
      SELECT jsonb_agg(y ORDER BY y->>'label')
      FROM (
        SELECT jsonb_build_object(
          'vehicle_id', vh.id,
          'label', coalesce(vh.number_plate, vh.vehicle_code),
          'vehicle_code', vh.vehicle_code,
          'vehicle_type', vh.vehicle_type,
          'vehicle_category', vh.vehicle_category,
          'description', nullif(trim(concat_ws(' ', vh.make, vh.model, vh.year::text)), ''),
          'seating_capacity', vh.seating_capacity,
          'status', vh.vehicle_status::text,
          'insurance_expiry', (
            SELECT vd.expiry_date FROM public.vehicle_documents vd
              JOIN public.kyc_document_types kt ON kt.id = vd.document_type_id
             WHERE vd.vehicle_id = vh.id AND kt.document_code = 'INSURANCE'
             ORDER BY vd.expiry_date DESC NULLS LAST LIMIT 1),
          'inspection_expiry', (
            SELECT vd.expiry_date FROM public.vehicle_documents vd
              JOIN public.kyc_document_types kt ON kt.id = vd.document_type_id
             WHERE vd.vehicle_id = vh.id AND kt.document_code = 'INSPECTION_REPORT'
             ORDER BY vd.expiry_date DESC NULLS LAST LIMIT 1)
        ) AS y
        FROM public.vehicles vh
        WHERE vh.vehicle_status::text IN ('active','pending','draft')
      ) t
    ), '[]'::jsonb)
  ) INTO v;

  RETURN v;
END $function$;

CREATE OR REPLACE FUNCTION public.fleet_register_read(p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v jsonb; v_may_write boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  v_may_write := public.has_staff_permission('staff.logistics.manage')
    OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]);
  IF NOT (
    v_may_write OR public.has_staff_permission('staff.logistics.read') OR public.is_linked_commercial_staff()
  ) THEN RAISE EXCEPTION 'NOT_FLEET_STAFF'; END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'may_write', v_may_write,
    'drivers', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'label')
      FROM (
        SELECT jsonb_build_object(
          'driver_id', d.id,
          'label', nullif(trim(concat_ws(' ', d.first_name, d.last_name)), ''),
          'first_name', d.first_name,
          'last_name', d.last_name,
          'driver_code', d.driver_code,
          'status', d.status::text,
          'driver_type', d.driver_type::text,
          'phone_number', d.phone_number,
          'national_id', d.national_id,
          'photo_url', (SELECT ph.storage_url FROM public.driver_photos ph
                         WHERE ph.driver_id = d.id ORDER BY ph.uploaded_at DESC NULLS LAST LIMIT 1),
          'licence_number', lic->>'number',
          'licence_expiry', lic->>'expiry',
          'licence_status', lic->>'status',
          'licence_file_url', lic->>'file_url',
          'assignments', (SELECT count(*) FROM public.commercial_activation_assignments a WHERE a.driver_id = d.id)
        ) AS x
        FROM public.drivers d
        LEFT JOIN LATERAL (SELECT public.fleet_driver_licence(d.id) AS lic) l ON TRUE
      ) s
    ), '[]'::jsonb),
    'vehicles', coalesce((
      SELECT jsonb_agg(y ORDER BY y->>'label')
      FROM (
        SELECT jsonb_build_object(
          'vehicle_id', vh.id,
          'label', coalesce(vh.number_plate, vh.vehicle_code),
          'number_plate', vh.number_plate,
          'vehicle_code', vh.vehicle_code,
          'vehicle_type', vh.vehicle_type,
          'vehicle_category', vh.vehicle_category,
          'make', vh.make,
          'model', vh.model,
          'year', vh.year,
          'seating_capacity', vh.seating_capacity,
          'status', vh.vehicle_status::text,
          'documents', coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'code', kt.document_code, 'name', kt.document_name,
              'number', vd.document_number, 'expiry', vd.expiry_date, 'file_url', vd.file_url))
            FROM public.vehicle_documents vd
            JOIN public.kyc_document_types kt ON kt.id = vd.document_type_id
           WHERE vd.vehicle_id = vh.id), '[]'::jsonb),
          'assignments', (SELECT count(*) FROM public.commercial_activation_assignments a WHERE a.vehicle_id = vh.id)
        ) AS y
        FROM public.vehicles vh
      ) t
    ), '[]'::jsonb),
    'vehicle_document_types', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', kt.id, 'code', kt.document_code, 'name', kt.document_name,
                                          'expiry_required', kt.expiry_required) ORDER BY kt.display_order)
      FROM public.kyc_document_types kt WHERE kt.applies_to = 'vehicle' AND kt.is_active), '[]'::jsonb)
  ) INTO v;

  RETURN v;
END $function$;

-- Assignment licence check reads the same single source.
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
  v_driver uuid := nullif(p->>'driver_id','')::uuid;
  v_vehicle uuid := nullif(p->>'vehicle_id','')::uuid;
  v_person text := nullif(p->>'person_label','');
  v_vlabel text := nullif(p->>'vehicle_label','');
  v_lic_exp date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT public.is_linked_commercial_staff() THEN RAISE EXCEPTION 'NOT_COMMERCIAL_STAFF'; END IF;

  IF v_driver IS NOT NULL THEN
    SELECT coalesce(nullif(trim(concat_ws(' ', d.first_name, d.last_name)), ''), d.driver_code)
      INTO v_person FROM public.drivers d WHERE d.id = v_driver;
    IF v_person IS NULL THEN RAISE EXCEPTION 'DRIVER_NOT_ON_REGISTER'; END IF;
    v_lic_exp := (public.fleet_driver_licence(v_driver)->>'expiry')::date;
    IF v_lic_exp IS NOT NULL AND v_lic_exp < coalesce(v_start, current_date) THEN
      RAISE EXCEPTION 'DRIVER_LICENCE_EXPIRED';
    END IF;
  END IF;

  IF v_vehicle IS NOT NULL THEN
    SELECT coalesce(vh.number_plate, vh.vehicle_code) INTO v_vlabel
      FROM public.vehicles vh WHERE vh.id = v_vehicle;
    IF v_vlabel IS NULL THEN RAISE EXCEPTION 'VEHICLE_NOT_ON_REGISTER'; END IF;
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT ci.* INTO c FROM public.commercial_contract_instances ci
      JOIN public.commercial_activation_assignments a ON a.contract_id = ci.id
     WHERE a.id = v_id;
    IF c.id IS NULL THEN RAISE EXCEPTION 'ASSIGNMENT_NOT_FOUND'; END IF;
  ELSE
    SELECT * INTO c FROM public.commercial_contract_instances WHERE id = (p->>'contract_id')::uuid;
    IF c.id IS NULL THEN RAISE EXCEPTION 'CONTRACT_NOT_FOUND'; END IF;
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

  IF v_id IS NOT NULL THEN
    UPDATE public.commercial_activation_assignments SET
      assignment_role = coalesce(nullif(p->>'assignment_role',''), assignment_role),
      staff_member_id = coalesce(nullif(p->>'staff_member_id','')::uuid, staff_member_id),
      driver_id = coalesce(v_driver, driver_id),
      vehicle_id = coalesce(v_vehicle, vehicle_id),
      person_label = coalesce(v_person, person_label),
      vehicle_label = coalesce(v_vlabel, vehicle_label),
      start_date = coalesce(v_start, start_date),
      end_date = coalesce(v_end, end_date),
      status = coalesce(nullif(p->>'status',''), status),
      notes = coalesce(nullif(p->>'notes',''), notes)
    WHERE id = v_id;
    RETURN jsonb_build_object('assignment_id', v_id);
  END IF;

  IF coalesce(p->>'assignment_role','') = '' THEN RAISE EXCEPTION 'ROLE_REQUIRED'; END IF;
  IF p->>'assignment_role' = 'DRIVER' AND v_driver IS NULL THEN RAISE EXCEPTION 'DRIVER_FROM_REGISTER_REQUIRED'; END IF;
  IF p->>'assignment_role' = 'VEHICLE' AND v_vehicle IS NULL THEN RAISE EXCEPTION 'VEHICLE_FROM_REGISTER_REQUIRED'; END IF;
  IF coalesce(v_person, p->>'staff_member_id', v_vlabel) IS NULL THEN
    RAISE EXCEPTION 'WHO_OR_WHAT_IS_ASSIGNED_REQUIRED';
  END IF;

  INSERT INTO public.commercial_activation_assignments (
    contract_id, account_id, assignment_role, staff_member_id, driver_id, vehicle_id,
    person_label, vehicle_label, start_date, end_date, status, notes, created_by
  ) VALUES (
    c.id, c.account_id, p->>'assignment_role', nullif(p->>'staff_member_id','')::uuid, v_driver, v_vehicle,
    v_person, v_vlabel, v_start, v_end,
    coalesce(nullif(p->>'status',''),'PLANNED'), nullif(p->>'notes',''), auth.uid()
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('assignment_id', v_id);
END $function$;