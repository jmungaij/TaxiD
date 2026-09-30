CREATE OR REPLACE FUNCTION public.staff_claim_self()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_verified timestamptz;
  v_staff uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT id INTO v_staff FROM public.staff_members WHERE user_id = v_uid LIMIT 1;
  IF v_staff IS NOT NULL THEN
    RETURN v_staff;
  END IF;

  SELECT lower(email), email_confirmed_at
    INTO v_email, v_verified
    FROM auth.users WHERE id = v_uid;

  IF v_email IS NULL OR v_verified IS NULL THEN
    RAISE EXCEPTION 'email_not_verified';
  END IF;

  SELECT id INTO v_staff
    FROM public.staff_members
   WHERE user_id IS NULL
     AND employment_status = 'active'
     AND (lower(work_email) = v_email OR lower(personal_email) = v_email)
   ORDER BY created_at
   LIMIT 1;

  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'no_matching_staff_record';
  END IF;

  UPDATE public.staff_members
     SET user_id = v_uid, updated_at = now()
   WHERE id = v_staff AND user_id IS NULL;

  INSERT INTO public.admin_audit_log (actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (v_uid, 'staff_profile_self_claim', 'staff_members', v_staff,
          jsonb_build_object('matched_email', v_email));

  RETURN v_staff;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_claim_self() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_claim_self() TO authenticated;