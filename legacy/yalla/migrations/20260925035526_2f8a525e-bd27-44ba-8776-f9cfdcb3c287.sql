CREATE OR REPLACE FUNCTION public._meeting_manager() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.has_any_role(auth.uid(), ARRAY['admin','super_admin','general_manager']::app_role[]), false) = true
$$;
REVOKE EXECUTE ON FUNCTION public._meeting_manager() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._meeting_manager() TO authenticated;

CREATE OR REPLACE FUNCTION public._meeting_is_host(_staff uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM staff_members WHERE id = _staff AND user_id = auth.uid())
$$;
REVOKE EXECUTE ON FUNCTION public._meeting_is_host(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._meeting_is_host(uuid) TO authenticated;

CREATE TABLE public.meeting_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  department text,
  duration_minutes int NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 15 AND 180),
  buffer_minutes int NOT NULL DEFAULT 10 CHECK (buffer_minutes BETWEEN 0 AND 60),
  min_notice_hours int NOT NULL DEFAULT 2 CHECK (min_notice_hours BETWEEN 0 AND 168),
  max_advance_days int NOT NULL DEFAULT 30 CHECK (max_advance_days BETWEEN 1 AND 180),
  requires_meet boolean NOT NULL DEFAULT true,
  is_public boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 100,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.meeting_types TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_types TO authenticated;
GRANT ALL ON public.meeting_types TO service_role;
ALTER TABLE public.meeting_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public reads active public types" ON public.meeting_types FOR SELECT TO anon, authenticated USING (active AND is_public);
CREATE POLICY "managers manage types" ON public.meeting_types FOR ALL TO authenticated USING (public._meeting_manager()) WITH CHECK (public._meeting_manager());

CREATE TABLE public.meeting_type_hosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_type_id uuid NOT NULL REFERENCES public.meeting_types(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  public_name text NOT NULL,
  public_role text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_type_id, staff_id)
);
GRANT SELECT ON public.meeting_type_hosts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_type_hosts TO authenticated;
GRANT ALL ON public.meeting_type_hosts TO service_role;
ALTER TABLE public.meeting_type_hosts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public reads active hosts" ON public.meeting_type_hosts FOR SELECT TO anon, authenticated USING (active);
CREATE POLICY "managers manage hosts" ON public.meeting_type_hosts FOR ALL TO authenticated USING (public._meeting_manager()) WITH CHECK (public._meeting_manager());

CREATE TABLE public.meeting_host_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('weekly','leave')),
  weekday int CHECK (weekday BETWEEN 0 AND 6),
  start_minute int CHECK (start_minute BETWEEN 0 AND 1440),
  end_minute int CHECK (end_minute BETWEEN 0 AND 1440),
  leave_from timestamptz, leave_to timestamptz, note text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind='weekly' AND weekday IS NOT NULL AND start_minute < end_minute) OR (kind='leave' AND leave_from < leave_to))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_host_availability TO authenticated;
GRANT ALL ON public.meeting_host_availability TO service_role;
ALTER TABLE public.meeting_host_availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own or manager availability" ON public.meeting_host_availability FOR ALL TO authenticated
  USING (public._meeting_is_host(staff_id) OR public._meeting_manager()) WITH CHECK (public._meeting_is_host(staff_id) OR public._meeting_manager());

ALTER TABLE public.public_meeting_bookings
  ADD COLUMN meeting_type_id uuid REFERENCES public.meeting_types(id),
  ADD COLUMN host_staff_id uuid REFERENCES public.staff_members(id),
  ADD COLUMN manage_token_hash text,
  ADD COLUMN lead_id uuid REFERENCES public.sales_leads(id),
  ADD COLUMN channel text NOT NULL DEFAULT 'client',
  ADD COLUMN booked_by uuid,
  ADD COLUMN outcome text CHECK (outcome IN ('held','no_show','follow_up','deal')),
  ADD COLUMN outcome_notes text,
  ADD COLUMN reminder_24h_at timestamptz,
  ADD COLUMN reminder_1h_at timestamptz,
  ADD COLUMN cancelled_reason text,
  ADD COLUMN rescheduled_from timestamptz;
CREATE UNIQUE INDEX pmb_manage_token ON public.public_meeting_bookings(manage_token_hash) WHERE manage_token_hash IS NOT NULL;
DROP INDEX IF EXISTS public.pmb_one_live_slot;
CREATE UNIQUE INDEX pmb_one_live_slot ON public.public_meeting_bookings (coalesce(host_staff_id,'00000000-0000-0000-0000-000000000000'::uuid), starts_at) WHERE status IN ('pending','confirmed');

CREATE OR REPLACE FUNCTION public._pmb_no_overlap() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE k uuid := coalesce(NEW.host_staff_id,'00000000-0000-0000-0000-000000000000'::uuid);
BEGIN
  IF NEW.status NOT IN ('pending','confirmed') THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('pmb:'||k::text));
  IF EXISTS (SELECT 1 FROM public_meeting_bookings b
     WHERE b.id <> NEW.id AND b.status IN ('pending','confirmed')
       AND coalesce(b.host_staff_id,'00000000-0000-0000-0000-000000000000'::uuid) = k
       AND b.starts_at < NEW.starts_at + make_interval(mins => NEW.duration_minutes)
       AND b.starts_at + make_interval(mins => b.duration_minutes) > NEW.starts_at) THEN
    RAISE EXCEPTION 'SLOT_TAKEN' USING ERRCODE = '23P01';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public._pmb_no_overlap() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER pmb_no_overlap BEFORE INSERT OR UPDATE OF starts_at, status, host_staff_id, duration_minutes ON public.public_meeting_bookings
  FOR EACH ROW EXECUTE FUNCTION public._pmb_no_overlap();

CREATE TABLE public.meeting_booking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.public_meeting_bookings(id) ON DELETE CASCADE,
  event text NOT NULL,
  from_status text, to_status text,
  actor_user_id uuid, actor_label text NOT NULL DEFAULT 'system',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.meeting_booking_events TO authenticated;
GRANT ALL ON public.meeting_booking_events TO service_role;
ALTER TABLE public.meeting_booking_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read booking history" ON public.meeting_booking_events FOR SELECT TO authenticated
  USING (public._meeting_manager() OR EXISTS (SELECT 1 FROM public_meeting_bookings b WHERE b.id = booking_id AND public._meeting_is_host(b.host_staff_id)));
CREATE OR REPLACE FUNCTION public._mbe_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'meeting_booking_events is append-only'; END $$;
REVOKE EXECUTE ON FUNCTION public._mbe_append_only() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER mbe_append_only BEFORE UPDATE OR DELETE ON public.meeting_booking_events FOR EACH ROW EXECUTE FUNCTION public._mbe_append_only();

CREATE OR REPLACE FUNCTION public._pmb_log() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO meeting_booking_events(booking_id,event,to_status,actor_user_id,actor_label,detail)
    VALUES (NEW.id,'created',NEW.status,NEW.booked_by,CASE WHEN NEW.channel='staff' THEN 'staff' ELSE 'client' END, jsonb_build_object('starts_at',NEW.starts_at,'channel',NEW.channel));
  ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.outcome IS DISTINCT FROM OLD.outcome THEN
    INSERT INTO meeting_booking_events(booking_id,event,from_status,to_status,actor_user_id,actor_label,detail)
    VALUES (NEW.id, CASE WHEN NEW.outcome IS DISTINCT FROM OLD.outcome THEN 'outcome' WHEN NEW.starts_at IS DISTINCT FROM OLD.starts_at THEN 'rescheduled' ELSE 'status' END,
      OLD.status, NEW.status, auth.uid(), CASE WHEN auth.uid() IS NULL THEN 'system/client' ELSE 'staff' END,
      jsonb_build_object('from_start',OLD.starts_at,'to_start',NEW.starts_at,'outcome',NEW.outcome,'reason',NEW.cancelled_reason));
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public._pmb_log() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER pmb_log AFTER INSERT OR UPDATE ON public.public_meeting_bookings FOR EACH ROW EXECUTE FUNCTION public._pmb_log();

CREATE OR REPLACE FUNCTION public._meeting_touch() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER mt_touch BEFORE UPDATE ON public.meeting_types FOR EACH ROW EXECUTE FUNCTION public._meeting_touch();
CREATE TRIGGER mth_touch BEFORE UPDATE ON public.meeting_type_hosts FOR EACH ROW EXECUTE FUNCTION public._meeting_touch();
CREATE TRIGGER mha_touch BEFORE UPDATE ON public.meeting_host_availability FOR EACH ROW EXECUTE FUNCTION public._meeting_touch();

GRANT SELECT, UPDATE ON public.public_meeting_bookings TO authenticated;
CREATE POLICY "hosts and managers read bookings" ON public.public_meeting_bookings FOR SELECT TO authenticated
  USING (public._meeting_manager() OR public._meeting_is_host(host_staff_id));
CREATE POLICY "hosts and managers record outcome" ON public.public_meeting_bookings FOR UPDATE TO authenticated
  USING (public._meeting_manager() OR public._meeting_is_host(host_staff_id))
  WITH CHECK (public._meeting_manager() OR public._meeting_is_host(host_staff_id));