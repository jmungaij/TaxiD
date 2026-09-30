-- 1. Fixed search_path on the append-only trigger guard
CREATE OR REPLACE FUNCTION public._partner_application_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'PARTNER_APPLICATION_EVENTS_APPEND_ONLY';
END;
$$;

-- 2. Explicit service-context detection for internship programme authority
CREATE OR REPLACE FUNCTION public.intern_programme_authority(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_user IS NOT NULL THEN
      public.has_any_role(
        p_user,
        ARRAY['admin','super_admin','director','general_manager','operations_admin']::app_role[]
      )
    ELSE
      -- No authenticated subject: authority only in an explicit service context,
      -- never for anon/authenticated PostgREST sessions.
      coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '') = 'service_role'
      OR coalesce(
           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
           ''
         ) = 'service_role'
      OR current_user IN ('postgres','supabase_admin','supabase_migration_admin','supabase_storage_admin')
  END;
$$;

-- 3. Database-level throttle for the public partner application intake
CREATE OR REPLACE FUNCTION public.partner_application_intake_within_limit(_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    SELECT count(*) FROM public.partner_applications
     WHERE lower(btrim(contact_email)) = lower(btrim(coalesce(_email,'')))
       AND created_at > now() - interval '1 hour'
  ) < 3
  AND (
    SELECT count(*) FROM public.partner_applications
     WHERE created_at > now() - interval '1 hour'
  ) < 60;
$$;

REVOKE ALL ON FUNCTION public.partner_application_intake_within_limit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_application_intake_within_limit(text) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS partner_applications_insert ON public.partner_applications;
CREATE POLICY partner_applications_insert ON public.partner_applications
FOR INSERT TO anon, authenticated
WITH CHECK (
  ((submitted_by IS NULL) OR (submitted_by = auth.uid()))
  AND status = 'submitted'
  AND review_notes IS NULL
  AND reviewed_by IS NULL
  AND reviewed_at IS NULL
  AND partner_id IS NULL
  AND length(btrim(organisation_name)) BETWEEN 2 AND 200
  AND length(btrim(contact_name)) BETWEEN 2 AND 150
  AND btrim(contact_email) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$'
  AND length(btrim(contact_email)) <= 254
  AND length(btrim(contact_phone)) BETWEEN 7 AND 30
  AND length(btrim(country)) BETWEEN 2 AND 100
  AND (city IS NULL OR length(city) <= 120)
  AND (website IS NULL OR length(website) <= 500)
  AND (category IS NULL OR length(category) <= 120)
  AND (requirements IS NULL OR length(requirements) <= 5000)
  AND (intent_bring IS NULL OR length(intent_bring) <= 2000)
  AND (network_category IS NULL OR length(network_category) <= 120)
  AND (maturity_level IS NULL OR length(maturity_level) <= 60)
  AND (lifecycle_stage IS NULL OR length(lifecycle_stage) <= 60)
  AND (ab_variant IS NULL OR length(ab_variant) <= 60)
  AND (session_id IS NULL OR length(session_id) <= 128)
  AND (monthly_volume_estimate IS NULL OR (monthly_volume_estimate >= 0 AND monthly_volume_estimate <= 10000000))
  AND public.partner_application_intake_within_limit(contact_email)
);

-- 4. Explicit, parent-aligned RLS on the realtime-published tracking partitions
DO $$
DECLARE
  r record;
  v_read text;
BEGIN
  FOR r IN
    SELECT c.relname AS child, parent.relname AS parent
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_class parent ON parent.oid = i.inhparent
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND parent.relname IN ('package_tracking','delivery_route_segments','delivery_eta_predictions')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'deny direct partition access', r.child);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.child || '_app_read', r.child);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.child || '_no_app_writes', r.child);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.child || '_no_anon', r.child);

    IF r.parent = 'delivery_route_segments' THEN
      v_read := 'public.has_any_role(auth.uid(), ARRAY[''admin'',''super_admin'',''operations_admin'']::app_role[])'
             || ' OR EXISTS (SELECT 1 FROM public.packages p WHERE p.id::text = job_id::text'
             || ' AND (p.sender_id = auth.uid() OR p.assigned_driver_id = auth.uid()))';
    ELSE
      v_read := 'EXISTS (SELECT 1 FROM public.packages p WHERE p.id = package_id'
             || ' AND (p.sender_id = auth.uid() OR p.assigned_driver_id = auth.uid()'
             || ' OR public.has_any_role(auth.uid(), ARRAY[''admin'',''super_admin'',''operations_admin'']::app_role[])))';
    END IF;

    -- read, scoped exactly like the parent table
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (%s)',
      r.child || '_app_read', r.child, v_read);

    -- app roles may never write partitions directly
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO anon, authenticated WITH CHECK (false)',
      r.child || '_no_app_insert', r.child);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO anon, authenticated USING (false)',
      r.child || '_no_app_update', r.child);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO anon, authenticated USING (false)',
      r.child || '_no_app_delete', r.child);
    -- unauthenticated sessions get nothing
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR SELECT TO anon USING (false)',
      r.child || '_no_anon_read', r.child);

    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', r.child);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', r.child);
  END LOOP;
END $$;

-- 5. Throttle the publicly writable recruitment upload path
CREATE OR REPLACE FUNCTION public.rec_public_upload_within_limit(_slug text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    SELECT count(*) FROM storage.objects o
     WHERE o.bucket_id = 'recruitment-applications'
       AND (storage.foldername(o.name))[1] = 'public-applications'
       AND (storage.foldername(o.name))[2] = _slug
       AND o.created_at > now() - interval '1 hour'
  ) < 150;
$$;

REVOKE ALL ON FUNCTION public.rec_public_upload_within_limit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_public_upload_within_limit(text) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "public applicants upload recruitment docs" ON storage.objects;
CREATE POLICY "public applicants upload recruitment docs" ON storage.objects
FOR INSERT TO anon, authenticated
WITH CHECK (
  bucket_id = 'recruitment-applications'
  AND (storage.foldername(name))[1] = 'public-applications'
  AND array_length(storage.foldername(name), 1) = 2
  AND public.rec_public_slug_is_open((storage.foldername(name))[2])
  AND public.rec_public_upload_within_limit((storage.foldername(name))[2])
  AND lower(regexp_replace(name, '^.*\.', '')) = ANY (ARRAY['pdf','doc','docx','png','jpg','jpeg','webp','heic','heif','txt'])
);