-- FLEET REGISTER + ACTIVATION LINKAGE
-- Rollback: drop the three new functions, restore the previous bodies of
-- sales_activation_fleet / sales_activation_assignment_upsert from migration
-- history, drop the two added columns and the three storage policies.
-- Non-destructive: no data removed, no column dropped, no policy replaced.

ALTER TABLE public.commercial_activation_assignments
  ADD COLUMN IF NOT EXISTS driver_id uuid REFERENCES public.drivers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS caa_driver_idx ON public.commercial_activation_assignments(driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS caa_vehicle_idx ON public.commercial_activation_assignments(vehicle_id) WHERE vehicle_id IS NOT NULL;

-- ---------------------------------------------------------------- fleet read
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
          'photo_url', (
            SELECT ph.storage_url FROM public.driver_photos ph
             WHERE ph.driver_id = d.id ORDER BY ph.uploaded_at DESC NULLS LAST LIMIT 1),
          'licence_number', lic.document_number,
          'licence_expiry', lic.expiry_date,
          'licence_status', lic.status,
          'licence_file_url', lic.file_url
        ) AS x
        FROM public.drivers d
        LEFT JOIN LATERAL (
          SELECT dd.document_number, dd.expiry_date, dd.status, dd.file_url
            FROM public.driver_documents dd
           WHERE dd.driver_id = d.id
             AND dd.doc_type IN ('DRIVING_LICENSE','DRIVING_LICENCE')
           ORDER BY dd.created_at DESC LIMIT 1
        ) lic ON TRUE
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

-- ------------------------------------------------- assignment with real links
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

  -- Real records decide the label: nothing is typed in for a driver or vehicle.
  IF v_driver IS NOT NULL THEN
    SELECT nullif(trim(concat_ws(' ', d.first_name, d.last_name)), '') INTO v_person
      FROM public.drivers d WHERE d.id = v_driver;
    IF v_person IS NULL THEN
      SELECT d.driver_code INTO v_person FROM public.drivers d WHERE d.id = v_driver;
    END IF;
    IF v_person IS NULL THEN RAISE EXCEPTION 'DRIVER_NOT_ON_REGISTER'; END IF;
    SELECT dd.expiry_date INTO v_lic_exp FROM public.driver_documents dd
      WHERE dd.driver_id = v_driver AND dd.doc_type IN ('DRIVING_LICENSE','DRIVING_LICENCE')
      ORDER BY dd.created_at DESC LIMIT 1;
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

-- --------------------------------------------------------- fleet register read
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
          'licence_number', lic.document_number,
          'licence_expiry', lic.expiry_date,
          'licence_status', lic.status,
          'licence_file_url', lic.file_url,
          'assignments', (SELECT count(*) FROM public.commercial_activation_assignments a WHERE a.driver_id = d.id)
        ) AS x
        FROM public.drivers d
        LEFT JOIN LATERAL (
          SELECT dd.document_number, dd.expiry_date, dd.status, dd.file_url
            FROM public.driver_documents dd
           WHERE dd.driver_id = d.id AND dd.doc_type IN ('DRIVING_LICENSE','DRIVING_LICENCE')
           ORDER BY dd.created_at DESC LIMIT 1
        ) lic ON TRUE
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

-- ------------------------------------------------------------- driver upsert
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
    INSERT INTO public.driver_documents (
      driver_id, doc_type, document_type_id, document_number, expiry_date, file_url, file_name, status, doc_label)
    VALUES (
      v_id, 'DRIVING_LICENSE',
      (SELECT id FROM public.kyc_document_types WHERE document_code = 'DRIVING_LICENCE' LIMIT 1),
      v_lic_no, v_lic_exp, coalesce(v_lic_file, 'RECORDED_WITHOUT_FILE'),
      nullif(p->>'licence_file_name',''), 'PENDING', 'Driving Licence');
  END IF;

  RETURN jsonb_build_object('driver_id', v_id);
END $function$;

-- ------------------------------------------------------------ vehicle upsert
CREATE OR REPLACE FUNCTION public.fleet_vehicle_upsert(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid := nullif(p->>'vehicle_id','')::uuid;
  v_plate text := nullif(upper(trim(p->>'number_plate')),'');
  v_type text := nullif(trim(p->>'vehicle_type'),'');
  v_status text := coalesce(nullif(p->>'status',''), 'pending');
  v_doc_type uuid := nullif(p->>'document_type_id','')::uuid;
  v_doc_file text := nullif(p->>'document_file_url','');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF NOT (
    public.has_staff_permission('staff.logistics.manage')
    OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  ) THEN RAISE EXCEPTION 'NOT_FLEET_MANAGER'; END IF;

  IF v_status NOT IN ('draft','pending','active','inactive','suspended','retired') THEN
    RAISE EXCEPTION 'UNKNOWN_VEHICLE_STATUS'; END IF;

  IF v_id IS NULL THEN
    IF v_plate IS NULL THEN RAISE EXCEPTION 'NUMBER_PLATE_REQUIRED'; END IF;
    IF v_type IS NULL THEN RAISE EXCEPTION 'VEHICLE_TYPE_REQUIRED'; END IF;
    IF EXISTS (SELECT 1 FROM public.vehicles WHERE upper(number_plate) = v_plate) THEN
      RAISE EXCEPTION 'NUMBER_PLATE_ALREADY_ON_REGISTER'; END IF;
    INSERT INTO public.vehicles (number_plate, vehicle_type, vehicle_category, make, model, year, color,
                                 seating_capacity, vehicle_status, module)
    VALUES (v_plate, v_type, nullif(trim(p->>'vehicle_category'),''), nullif(trim(p->>'make'),''),
            nullif(trim(p->>'model'),''), nullif(p->>'year','')::int, nullif(trim(p->>'color'),''),
            nullif(p->>'seating_capacity','')::int, v_status::vehicle_status_t,
            coalesce(nullif(p->>'module',''),'rides'))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.vehicles SET
      number_plate = coalesce(v_plate, number_plate),
      vehicle_type = coalesce(v_type, vehicle_type),
      vehicle_category = coalesce(nullif(trim(p->>'vehicle_category'),''), vehicle_category),
      make = coalesce(nullif(trim(p->>'make'),''), make),
      model = coalesce(nullif(trim(p->>'model'),''), model),
      year = coalesce(nullif(p->>'year','')::int, year),
      color = coalesce(nullif(trim(p->>'color'),''), color),
      seating_capacity = coalesce(nullif(p->>'seating_capacity','')::int, seating_capacity),
      vehicle_status = v_status::vehicle_status_t,
      updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'VEHICLE_NOT_ON_REGISTER'; END IF;
  END IF;

  IF v_doc_type IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.kyc_document_types WHERE id = v_doc_type AND applies_to = 'vehicle') THEN
      RAISE EXCEPTION 'UNKNOWN_VEHICLE_DOCUMENT_TYPE'; END IF;
    INSERT INTO public.vehicle_documents (vehicle_id, document_type_id, document_number, issue_date, expiry_date,
                                          file_url, file_name)
    VALUES (v_id, v_doc_type, nullif(trim(p->>'document_number'),''), nullif(p->>'document_issue_date','')::date,
            nullif(p->>'document_expiry_date','')::date, coalesce(v_doc_file,'RECORDED_WITHOUT_FILE'),
            nullif(p->>'document_file_name',''));
  END IF;

  RETURN jsonb_build_object('vehicle_id', v_id);
END $function$;

REVOKE ALL ON FUNCTION public.fleet_register_read(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fleet_driver_upsert(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fleet_vehicle_upsert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fleet_register_read(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fleet_driver_upsert(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fleet_vehicle_upsert(jsonb) TO authenticated, service_role;

-- Fleet staff may file and read driver photos, driver papers and vehicle papers.
DROP POLICY IF EXISTS "driver-photos_fleet_staff" ON storage.objects;
CREATE POLICY "driver-photos_fleet_staff" ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'driver-photos' AND (public.has_staff_permission('staff.logistics.manage') OR public.has_staff_permission('staff.logistics.read') OR public.is_linked_commercial_staff()))
WITH CHECK (bucket_id = 'driver-photos' AND public.has_staff_permission('staff.logistics.manage'));

DROP POLICY IF EXISTS "driver-documents_fleet_staff" ON storage.objects;
CREATE POLICY "driver-documents_fleet_staff" ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'driver-documents' AND (public.has_staff_permission('staff.logistics.manage') OR public.has_staff_permission('staff.logistics.read')))
WITH CHECK (bucket_id = 'driver-documents' AND public.has_staff_permission('staff.logistics.manage'));

DROP POLICY IF EXISTS "vehicle-documents_fleet_staff" ON storage.objects;
CREATE POLICY "vehicle-documents_fleet_staff" ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'vehicle-documents' AND (public.has_staff_permission('staff.logistics.manage') OR public.has_staff_permission('staff.logistics.read')))
WITH CHECK (bucket_id = 'vehicle-documents' AND public.has_staff_permission('staff.logistics.manage'));