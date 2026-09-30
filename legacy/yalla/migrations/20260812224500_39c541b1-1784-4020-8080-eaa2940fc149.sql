-- Diagnostics for the signed-in caller only.
CREATE OR REPLACE FUNCTION public.staff_link_diagnostics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_verified boolean := false;
  v_linked_id uuid;
  v_linked_status text;
  v_match_count int := 0;
  v_match_status text;
  v_match_org uuid;
  v_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('reason', 'not_authenticated');
  END IF;

  SELECT lower(u.email), u.email_confirmed_at IS NOT NULL
    INTO v_email, v_verified
  FROM auth.users u WHERE u.id = v_uid;

  SELECT s.id, s.employment_status INTO v_linked_id, v_linked_status
  FROM public.staff_members s WHERE s.user_id = v_uid LIMIT 1;

  SELECT count(*) INTO v_match_count
  FROM public.staff_members s
  WHERE s.user_id IS NULL
    AND (lower(s.work_email) = v_email OR lower(s.personal_email) = v_email);

  IF v_match_count > 0 THEN
    SELECT s.employment_status, s.org_id INTO v_match_status, v_match_org
    FROM public.staff_members s
    WHERE s.user_id IS NULL
      AND (lower(s.work_email) = v_email OR lower(s.personal_email) = v_email)
    LIMIT 1;
  END IF;

  v_reason := CASE
    WHEN v_linked_id IS NOT NULL AND coalesce(v_linked_status, 'active') <> 'active' THEN 'record_inactive'
    WHEN v_linked_id IS NOT NULL THEN 'linked'
    WHEN NOT v_verified THEN 'email_unverified'
    WHEN v_match_count > 1 THEN 'ambiguous_email_match'
    WHEN v_match_count = 1 AND coalesce(v_match_status, 'active') <> 'active' THEN 'match_inactive'
    WHEN v_match_count = 1 THEN 'claimable'
    ELSE 'no_staff_record'
  END;

  RETURN jsonb_build_object(
    'reason', v_reason,
    'email', v_email,
    'email_verified', v_verified,
    'linked_staff_id', v_linked_id,
    'linked_status', v_linked_status,
    'unlinked_email_matches', v_match_count,
    'match_status', v_match_status,
    'match_org_id', v_match_org
  );
END;
$$;

REVOKE ALL ON FUNCTION public.staff_link_diagnostics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_link_diagnostics() TO authenticated;

-- Admin-only backfill: link unlinked staff records to accounts by verified email.
CREATE OR REPLACE FUNCTION public.staff_backfill_links(p_dry_run boolean DEFAULT true)
RETURNS TABLE (
  staff_id uuid,
  staff_no text,
  full_name text,
  email text,
  matched_user_id uuid,
  action text,
  detail text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_user_id uuid;
  v_matches int;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  FOR r IN
    SELECT s.id, s.staff_no, s.full_name, s.employment_status,
           lower(coalesce(s.work_email, s.personal_email)) AS em
    FROM public.staff_members s
    WHERE s.user_id IS NULL
    ORDER BY s.full_name
  LOOP
    IF r.em IS NULL THEN
      staff_id := r.id; staff_no := r.staff_no; full_name := r.full_name; email := NULL;
      matched_user_id := NULL; action := 'skipped'; detail := 'no email on staff record';
      RETURN NEXT; CONTINUE;
    END IF;

    SELECT count(*) INTO v_matches
    FROM auth.users u
    WHERE lower(u.email) = r.em AND u.email_confirmed_at IS NOT NULL;

    IF v_matches = 0 THEN
      staff_id := r.id; staff_no := r.staff_no; full_name := r.full_name; email := r.em;
      matched_user_id := NULL; action := 'skipped';
      detail := 'no user account with this verified email';
      RETURN NEXT; CONTINUE;
    ELSIF v_matches > 1 THEN
      staff_id := r.id; staff_no := r.staff_no; full_name := r.full_name; email := r.em;
      matched_user_id := NULL; action := 'skipped'; detail := 'ambiguous email match';
      RETURN NEXT; CONTINUE;
    END IF;

    SELECT u.id INTO v_user_id
    FROM auth.users u
    WHERE lower(u.email) = r.em AND u.email_confirmed_at IS NOT NULL LIMIT 1;

    IF EXISTS (SELECT 1 FROM public.staff_members s2 WHERE s2.user_id = v_user_id) THEN
      staff_id := r.id; staff_no := r.staff_no; full_name := r.full_name; email := r.em;
      matched_user_id := v_user_id; action := 'skipped';
      detail := 'account already linked to another staff record';
      RETURN NEXT; CONTINUE;
    END IF;

    IF p_dry_run THEN
      staff_id := r.id; staff_no := r.staff_no; full_name := r.full_name; email := r.em;
      matched_user_id := v_user_id; action := 'would_link'; detail := 'verified email match';
      RETURN NEXT;
    ELSE
      UPDATE public.staff_members
         SET user_id = v_user_id, updated_at = now()
       WHERE id = r.id;
      staff_id := r.id; staff_no := r.staff_no; full_name := r.full_name; email := r.em;
      matched_user_id := v_user_id; action := 'linked'; detail := 'verified email match';
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_backfill_links(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_backfill_links(boolean) TO authenticated;