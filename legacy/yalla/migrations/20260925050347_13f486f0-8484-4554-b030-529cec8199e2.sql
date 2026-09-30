-- Yalla native calendar: blocks, leave, prep, internal time per staff member
CREATE TABLE public.staff_calendar_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'block' CHECK (kind IN ('block','leave','prep','follow_up','internal','travel')),
  title text NOT NULL DEFAULT 'Busy' CHECK (length(title) <= 160),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX scb_staff_time ON public.staff_calendar_blocks(staff_id, starts_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_calendar_blocks TO authenticated;
GRANT ALL ON public.staff_calendar_blocks TO service_role;
ALTER TABLE public.staff_calendar_blocks ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.meetings_is_manager() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.has_any_role(auth.uid(), ARRAY['admin','super_admin','general_manager']::app_role[]), false)
      OR coalesce(EXISTS (SELECT 1 FROM public.staff_members s WHERE s.user_id = auth.uid() AND s.full_name ILIKE 'Charles Gateru%'), false)
$$;
CREATE OR REPLACE FUNCTION public.meetings_owns_staff(_staff uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(EXISTS (SELECT 1 FROM public.staff_members s WHERE s.id = _staff AND s.user_id = auth.uid()), false)
$$;
REVOKE EXECUTE ON FUNCTION public.meetings_is_manager() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.meetings_owns_staff(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.meetings_is_manager() TO authenticated;
GRANT EXECUTE ON FUNCTION public.meetings_owns_staff(uuid) TO authenticated;

CREATE POLICY scb_rw ON public.staff_calendar_blocks FOR ALL TO authenticated
  USING (public.meetings_owns_staff(staff_id) OR public.meetings_is_manager())
  WITH CHECK (public.meetings_owns_staff(staff_id) OR public.meetings_is_manager());

-- Calendar connection register (native / shared free-busy / google / microsoft)
CREATE TABLE public.staff_calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('shared_freebusy','google','microsoft')),
  status text NOT NULL DEFAULT 'not_connected' CHECK (status IN ('not_connected','pending','verified','error')),
  account_email text,
  last_checked_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, provider)
);
GRANT SELECT, INSERT, UPDATE ON public.staff_calendar_connections TO authenticated;
GRANT ALL ON public.staff_calendar_connections TO service_role;
ALTER TABLE public.staff_calendar_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY scc_read ON public.staff_calendar_connections FOR SELECT TO authenticated
  USING (public.meetings_owns_staff(staff_id) OR public.meetings_is_manager());
CREATE POLICY scc_write ON public.staff_calendar_connections FOR INSERT TO authenticated
  WITH CHECK (public.meetings_owns_staff(staff_id) AND status IN ('not_connected','pending'));
CREATE POLICY scc_update ON public.staff_calendar_connections FOR UPDATE TO authenticated
  USING (public.meetings_owns_staff(staff_id)) WITH CHECK (public.meetings_owns_staff(staff_id) AND status IN ('not_connected','pending'));

-- Capacity + explainable routing
ALTER TABLE public.meeting_type_hosts ADD COLUMN IF NOT EXISTS max_per_day integer NOT NULL DEFAULT 6 CHECK (max_per_day BETWEEN 1 AND 20);
ALTER TABLE public.public_meeting_bookings ADD COLUMN IF NOT EXISTS routing_explanation jsonb;

-- Operations health for managers
CREATE OR REPLACE FUNCTION public.meeting_ops_health() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r jsonb;
BEGIN
  IF NOT public.meetings_is_manager() THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  SELECT jsonb_build_object(
    'failed_bookings', coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'client',client_name,'starts_at',starts_at,'reason',failure_reason,'created_at',created_at) ORDER BY created_at DESC)
       FROM (SELECT * FROM public_meeting_bookings WHERE status='failed' AND created_at > now()-interval '30 days' LIMIT 50) f), '[]'),
    'no_outcome', coalesce((SELECT jsonb_agg(jsonb_build_object('id',b.id,'client',coalesce(b.company,b.client_name),'starts_at',b.starts_at,'host',h.public_name) ORDER BY b.starts_at)
       FROM public_meeting_bookings b LEFT JOIN LATERAL (SELECT public_name FROM meeting_type_hosts WHERE staff_id=b.host_staff_id LIMIT 1) h ON true
       WHERE b.status='confirmed' AND b.outcome IS NULL AND b.starts_at + (b.duration_minutes||' minutes')::interval < now()), '[]'),
    'no_meet_link', coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'client',client_name,'starts_at',starts_at))
       FROM public_meeting_bookings WHERE status='confirmed' AND join_url IS NULL AND starts_at > now()), '[]'),
    'hosts', coalesce((SELECT jsonb_agg(x ORDER BY x->>'name') FROM (
       SELECT DISTINCT ON (h.staff_id) jsonb_build_object('staff_id',h.staff_id,'name',h.public_name,'calendar_status',h.calendar_status,'checked_at',h.calendar_checked_at,'max_per_day',h.max_per_day,
         'google',(SELECT status FROM staff_calendar_connections c WHERE c.staff_id=h.staff_id AND provider='google'),
         'microsoft',(SELECT status FROM staff_calendar_connections c WHERE c.staff_id=h.staff_id AND provider='microsoft'),
         'upcoming',(SELECT count(*) FROM public_meeting_bookings b WHERE b.host_staff_id=h.staff_id AND b.status='confirmed' AND b.starts_at>now())) x
       FROM meeting_type_hosts h WHERE h.active) s), '[]')
  ) INTO r;
  RETURN r;
END $$;
REVOKE EXECUTE ON FUNCTION public.meeting_ops_health() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.meeting_ops_health() TO authenticated;