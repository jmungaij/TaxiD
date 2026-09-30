CREATE TABLE public.meeting_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id uuid NOT NULL REFERENCES public.rec_interviews(id) ON DELETE CASCADE,
  calendar_uid text NOT NULL,
  sequence integer NOT NULL DEFAULT 0,
  method text NOT NULL DEFAULT 'REQUEST',
  scheduled_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL,
  mode text NOT NULL,
  meeting_link text,
  location text,
  organiser_email text NOT NULL,
  recipient_email text NOT NULL,
  cc_emails text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'sent',
  provider_message_id text,
  failure_reason text,
  sent_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meeting_invitations_method_chk CHECK (method IN ('REQUEST','CANCEL')),
  CONSTRAINT meeting_invitations_status_chk CHECK (status IN ('sent','failed'))
);

CREATE INDEX meeting_invitations_interview_idx ON public.meeting_invitations (interview_id, sequence DESC);

GRANT SELECT ON public.meeting_invitations TO authenticated;
GRANT ALL ON public.meeting_invitations TO service_role;

ALTER TABLE public.meeting_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY meeting_invitations_read ON public.meeting_invitations
  FOR SELECT TO authenticated
  USING (
    public.has_staff_permission('staff.recruitment.read')
    OR public.has_staff_permission('staff.recruitment.manage')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  );

-- Authoritative invitation payload. Never trusts the caller for any detail.
CREATE OR REPLACE FUNCTION public.rec_interview_invitation_payload(p_interview_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT (
    public.has_staff_permission('staff.recruitment.read')
    OR public.has_staff_permission('staff.recruitment.manage')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'super_admin')
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  SELECT jsonb_build_object(
    'interview_id', iv.id,
    'status', iv.status,
    'stage', iv.interview_stage,
    'interview_type', iv.interview_type,
    'mode', iv.mode,
    'scheduled_at', iv.scheduled_at,
    'duration_minutes', COALESCE(iv.duration_minutes, 45),
    'timezone', COALESCE(iv.timezone, 'Africa/Nairobi'),
    'location', iv.location,
    'meeting_link', iv.meeting_link,
    'instructions', iv.instructions,
    'reschedule_count', COALESCE(iv.reschedule_count, 0),
    'vacancy_title', vac.title,
    'candidate_name', cand.full_name,
    'candidate_email', cand.email,
    'panel', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'name', sm.full_name,
               'email', sm.work_email,
               'panel_role', p.panel_role) ORDER BY p.panel_role)
      FROM public.rec_interview_panel p
      JOIN public.staff_members sm ON sm.id = p.staff_id
      WHERE p.interview_id = iv.id AND sm.work_email IS NOT NULL
    ), '[]'::jsonb),
    'next_sequence', COALESCE((
      SELECT max(mi.sequence) + 1 FROM public.meeting_invitations mi WHERE mi.interview_id = iv.id
    ), 0),
    'calendar_uid', COALESCE((
      SELECT mi.calendar_uid FROM public.meeting_invitations mi
      WHERE mi.interview_id = iv.id ORDER BY mi.sequence LIMIT 1
    ), 'interview-' || iv.id::text || '@yalla.africa')
  )
  INTO v
  FROM public.rec_interviews iv
  LEFT JOIN public.rec_applications app ON app.id = iv.application_id
  LEFT JOIN public.rec_candidates cand ON cand.id = app.candidate_id
  LEFT JOIN public.rec_vacancies vac ON vac.id = iv.vacancy_id
  WHERE iv.id = p_interview_id;

  IF v IS NULL THEN
    RAISE EXCEPTION 'INTERVIEW_NOT_FOUND';
  END IF;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.rec_interview_invitation_payload(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rec_interview_invitation_payload(uuid) TO authenticated, service_role;

-- Append-only outcome record, written by the sender only.
CREATE OR REPLACE FUNCTION public.rec_interview_invitation_record(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.meeting_invitations (
    interview_id, calendar_uid, sequence, method, scheduled_at, duration_minutes,
    mode, meeting_link, location, organiser_email, recipient_email, cc_emails,
    status, provider_message_id, failure_reason, sent_by
  ) VALUES (
    (p->>'interview_id')::uuid,
    p->>'calendar_uid',
    COALESCE((p->>'sequence')::int, 0),
    COALESCE(p->>'method', 'REQUEST'),
    (p->>'scheduled_at')::timestamptz,
    COALESCE((p->>'duration_minutes')::int, 45),
    COALESCE(p->>'mode', 'virtual'),
    p->>'meeting_link',
    p->>'location',
    p->>'organiser_email',
    p->>'recipient_email',
    COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(COALESCE(p->'cc_emails','[]'::jsonb)) x), '{}'),
    COALESCE(p->>'status', 'sent'),
    p->>'provider_message_id',
    p->>'failure_reason',
    NULLIF(p->>'sent_by','')::uuid
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rec_interview_invitation_record(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rec_interview_invitation_record(jsonb) TO service_role;