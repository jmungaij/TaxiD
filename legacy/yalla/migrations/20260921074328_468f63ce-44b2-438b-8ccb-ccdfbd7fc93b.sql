CREATE TABLE IF NOT EXISTS public.org_meetings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  purpose TEXT,
  meeting_kind TEXT NOT NULL DEFAULT 'internal',
  platform TEXT NOT NULL DEFAULT 'google_meet',
  account_id UUID,
  interview_id UUID,
  starts_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 30,
  timezone TEXT NOT NULL DEFAULT 'Africa/Nairobi',
  organiser_user_id UUID,
  organiser_email TEXT NOT NULL,
  attendees JSONB NOT NULL DEFAULT '[]'::jsonb,
  join_url TEXT,
  conference_provider TEXT,
  external_event_id TEXT,
  external_calendar_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  invite_sent_at TIMESTAMPTZ,
  provider_message_id TEXT,
  failure_reason TEXT,
  calendar_uid TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  sequence INTEGER NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT org_meetings_kind_ck CHECK (meeting_kind IN ('interview','internal','client','partner','other')),
  CONSTRAINT org_meetings_platform_ck CHECK (platform IN ('google_meet','microsoft_teams','other_link','phone','in_person')),
  CONSTRAINT org_meetings_status_ck CHECK (status IN ('draft','scheduled','sent','failed','cancelled')),
  CONSTRAINT org_meetings_duration_ck CHECK (duration_minutes BETWEEN 10 AND 600)
);

GRANT SELECT ON public.org_meetings TO authenticated;
GRANT ALL ON public.org_meetings TO service_role;
ALTER TABLE public.org_meetings ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_org_meetings_starts_at ON public.org_meetings (starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_meetings_account ON public.org_meetings (account_id);

DROP POLICY IF EXISTS "Staff read own meetings" ON public.org_meetings;
CREATE POLICY "Staff read own meetings" ON public.org_meetings
  FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
    OR (
      public.is_staff_member()
      AND (
        created_by = auth.uid()
        OR organiser_user_id = auth.uid()
        OR lower(organiser_email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(attendees) a
           WHERE lower(a ->> 'email') = lower(coalesce((auth.jwt() ->> 'email'), ''))
        )
      )
    )
  );

-- Staff create meetings through this function only; the joining link, external
-- calendar id and dispatch outcome are written by the server, never the client.
CREATE OR REPLACE FUNCTION public.org_meeting_create(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _id uuid;
  _email text := lower(coalesce(p ->> 'organiser_email', ''));
  _attendees jsonb := coalesce(p -> 'attendees', '[]'::jsonb);
  _a jsonb;
BEGIN
  IF NOT (public.is_staff_member()
          OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])) THEN
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
$$;

REVOKE EXECUTE ON FUNCTION public.org_meeting_create(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_meeting_create(jsonb) TO authenticated, service_role;

-- Server-only: attaches the conference produced by the calendar provider.
CREATE OR REPLACE FUNCTION public.org_meeting_attach_conference(
  p_id uuid,
  p_join_url text,
  p_provider text,
  p_external_event_id text,
  p_external_calendar_id text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.org_meetings
     SET join_url = coalesce(p_join_url, join_url),
         conference_provider = coalesce(p_provider, conference_provider),
         external_event_id = coalesce(p_external_event_id, external_event_id),
         external_calendar_id = coalesce(p_external_calendar_id, external_calendar_id),
         status = CASE WHEN status = 'draft' THEN 'scheduled' ELSE status END,
         updated_at = now()
   WHERE id = p_id;
$$;

REVOKE EXECUTE ON FUNCTION public.org_meeting_attach_conference(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_meeting_attach_conference(uuid, text, text, text, text) TO service_role;

-- Server-only: records the invitation outcome. Never silently "sent".
CREATE OR REPLACE FUNCTION public.org_meeting_record_dispatch(
  p_id uuid,
  p_status text,
  p_message_id text,
  p_reason text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.org_meetings
     SET status = CASE WHEN p_status = 'sent' THEN 'sent' ELSE 'failed' END,
         invite_sent_at = CASE WHEN p_status = 'sent' THEN now() ELSE invite_sent_at END,
         provider_message_id = coalesce(p_message_id, provider_message_id),
         failure_reason = CASE WHEN p_status = 'sent' THEN NULL ELSE left(coalesce(p_reason, 'send failed'), 500) END,
         sequence = sequence + CASE WHEN p_status = 'sent' THEN 1 ELSE 0 END,
         updated_at = now()
   WHERE id = p_id;
$$;

REVOKE EXECUTE ON FUNCTION public.org_meeting_record_dispatch(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_meeting_record_dispatch(uuid, text, text, text) TO service_role;
