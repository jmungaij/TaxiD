CREATE OR REPLACE FUNCTION public.org_meeting_create(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _id uuid;
  _email text := lower(coalesce(p ->> 'organiser_email', ''));
  _attendees jsonb := coalesce(p -> 'attendees', '[]'::jsonb);
  _a jsonb;
  _is_staff boolean;
BEGIN
  -- Authority: an administrator, a role-bearing staff member, or any employee
  -- with a linked staff record. Returns strict true/false so a NULL can never
  -- fall through the guard.
  SELECT coalesce(
    public.is_staff_member()
    OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
    OR EXISTS (
      SELECT 1 FROM public.staff_members sm WHERE sm.user_id = auth.uid()
    ), false) INTO _is_staff;

  IF NOT _is_staff THEN
    RAISE EXCEPTION 'NOT_AUTHORISED: only staff may schedule meetings';
  END IF;

  IF _email = '' THEN
    RAISE EXCEPTION 'ORGANISER_EMAIL_REQUIRED';
  END IF;

  IF jsonb_array_length(_attendees) = 0 THEN
    RAISE EXCEPTION 'ATTENDEE_REQUIRED: a meeting needs at least one attendee';
  END IF;

  FOR _a IN SELECT * FROM jsonb_array_elements(_attendees) LOOP
    IF coalesce(_a ->> 'email', '') !~* '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' THEN
      RAISE EXCEPTION 'ATTENDEE_EMAIL_INVALID: %', coalesce(_a ->> 'email', '(blank)');
    END IF;
  END LOOP;

  INSERT INTO public.org_meetings (
    title, purpose, meeting_kind, platform, account_id, interview_id,
    starts_at, duration_minutes, timezone,
    organiser_user_id, organiser_email, attendees, join_url, created_by
  ) VALUES (
    nullif(btrim(coalesce(p ->> 'title', '')), ''),
    nullif(btrim(coalesce(p ->> 'purpose', '')), ''),
    coalesce(p ->> 'meeting_kind', 'internal'),
    coalesce(p ->> 'platform', 'google_meet'),
    nullif(p ->> 'account_id', '')::uuid,
    nullif(p ->> 'interview_id', '')::uuid,
    (p ->> 'starts_at')::timestamptz,
    coalesce((p ->> 'duration_minutes')::int, 30),
    coalesce(nullif(p ->> 'timezone', ''), 'Africa/Nairobi'),
    auth.uid(),
    _email,
    _attendees,
    nullif(btrim(coalesce(p ->> 'join_url', '')), ''),
    auth.uid()
  ) RETURNING id INTO _id;

  RETURN _id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.org_meeting_create(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_meeting_create(jsonb) TO authenticated, service_role;