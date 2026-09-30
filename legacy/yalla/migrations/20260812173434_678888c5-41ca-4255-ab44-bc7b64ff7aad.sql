-- Link platform admins to canonical staff records so the Personal Operating System
-- can resolve their identity, and give admins a safe self-service link path.

INSERT INTO public.staff_members (org_id, user_id, staff_no, full_name, work_email, employment_status, employment_type, start_date, location, provenance)
SELECT o.id, u.id,
       'YM-ADM-' || upper(substr(replace(u.id::text,'-',''),1,6)),
       coalesce(u.raw_user_meta_data->>'full_name', split_part(u.email,'@',1)),
       u.email, 'active', 'permanent', current_date, 'Nairobi', 'LIVE'
FROM auth.users u
CROSS JOIN (SELECT id FROM public.org_entities ORDER BY created_at LIMIT 1) o
WHERE EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role::text IN ('admin','super_admin'))
  AND NOT EXISTS (SELECT 1 FROM public.staff_members s WHERE s.user_id = u.id);

CREATE OR REPLACE FUNCTION public.staff_link_self()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_staff uuid;
  v_org uuid;
  v_email text;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'super_admin')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT id INTO v_staff FROM public.staff_members WHERE user_id = v_uid LIMIT 1;
  IF v_staff IS NOT NULL THEN
    RETURN v_staff;
  END IF;

  SELECT id INTO v_org FROM public.org_entities ORDER BY created_at LIMIT 1;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'no_org_entity';
  END IF;

  SELECT email, coalesce(raw_user_meta_data->>'full_name', split_part(email,'@',1))
    INTO v_email, v_name FROM auth.users WHERE id = v_uid;

  INSERT INTO public.staff_members (org_id, user_id, staff_no, full_name, work_email, employment_status, employment_type, start_date, provenance)
  VALUES (v_org, v_uid, 'YM-ADM-' || upper(substr(replace(v_uid::text,'-',''),1,6)), v_name, v_email, 'active', 'permanent', current_date, 'LIVE')
  RETURNING id INTO v_staff;

  RETURN v_staff;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_link_self() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_link_self() TO authenticated;