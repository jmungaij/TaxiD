CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles public.app_role[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = ANY(_roles))
$$;
REVOKE EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_any_role(uuid, public.app_role[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  full_name text CHECK (full_name IS NULL OR char_length(full_name) <= 200),
  phone text CHECK (phone IS NULL OR phone ~ '^\+?[0-9 ]{7,20}$'),
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own profile read" ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_any_role(auth.uid(), ARRAY['admin','support','super_admin']::public.app_role[]));
CREATE POLICY "Own profile insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Own profile update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.support_threads
  ADD COLUMN IF NOT EXISTS rider_user_id uuid,
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS rider_last_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS staff_last_read_at timestamptz;
ALTER TABLE public.support_threads
  ADD CONSTRAINT support_threads_status_chk CHECK (status IN ('open','resolved','closed')),
  ADD CONSTRAINT support_threads_subject_chk CHECK (char_length(btrim(subject)) BETWEEN 1 AND 200),
  ADD CONSTRAINT support_threads_category_chk CHECK (char_length(btrim(category)) BETWEEN 1 AND 60),
  ADD CONSTRAINT support_threads_email_chk CHECK (rider_email = lower(btrim(rider_email)) AND rider_email LIKE '%_@_%');

CREATE OR REPLACE FUNCTION public.normalise_support_thread()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.rider_email = lower(btrim(NEW.rider_email)); RETURN NEW; END; $$;
CREATE TRIGGER trg_support_threads_normalise BEFORE INSERT OR UPDATE ON public.support_threads
  FOR EACH ROW EXECUTE FUNCTION public.normalise_support_thread();
CREATE TRIGGER trg_support_threads_updated BEFORE UPDATE ON public.support_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS support_threads_rider_user_idx ON public.support_threads (rider_user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS support_threads_status_idx ON public.support_threads (status, updated_at DESC);

DROP POLICY IF EXISTS "Riders view own threads" ON public.support_threads;
CREATE POLICY "Riders view own threads" ON public.support_threads FOR SELECT TO authenticated
  USING (rider_user_id = auth.uid() OR rider_email = lower(auth.jwt() ->> 'email'));
CREATE POLICY "Riders mark own threads read" ON public.support_threads FOR UPDATE TO authenticated
  USING (rider_user_id = auth.uid() OR rider_email = lower(auth.jwt() ->> 'email'))
  WITH CHECK (rider_user_id = auth.uid() OR rider_email = lower(auth.jwt() ->> 'email'));

CREATE OR REPLACE FUNCTION public.guard_rider_thread_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_any_role(auth.uid(), ARRAY['admin','support','super_admin']::public.app_role[]) THEN
    IF (NEW.subject, NEW.category, NEW.status, NEW.rider_email, NEW.rider_user_id, NEW.created_by, NEW.staff_last_read_at)
       IS DISTINCT FROM (OLD.subject, OLD.category, OLD.status, OLD.rider_email, OLD.rider_user_id, OLD.created_by, OLD.staff_last_read_at) THEN
      RAISE EXCEPTION 'Riders can only update their read status';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.guard_rider_thread_update() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_support_threads_guard BEFORE UPDATE ON public.support_threads
  FOR EACH ROW EXECUTE FUNCTION public.guard_rider_thread_update();

ALTER TABLE public.support_messages
  ADD CONSTRAINT support_messages_role_chk CHECK (sender_role IN ('rider','staff')),
  ADD CONSTRAINT support_messages_body_chk CHECK (char_length(btrim(body)) BETWEEN 1 AND 5000);

CREATE OR REPLACE FUNCTION public.touch_support_thread()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.support_threads SET updated_at = now(), last_message_at = NEW.created_at WHERE id = NEW.thread_id;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.touch_support_thread() FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Riders view own messages" ON public.support_messages;
CREATE POLICY "Riders view own messages" ON public.support_messages FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.support_threads t WHERE t.id = thread_id
    AND (t.rider_user_id = auth.uid() OR t.rider_email = lower(auth.jwt() ->> 'email'))));
DROP POLICY IF EXISTS "Riders reply on own open threads" ON public.support_messages;
CREATE POLICY "Riders reply on own open threads" ON public.support_messages FOR INSERT TO authenticated
  WITH CHECK (sender_role = 'rider' AND sender_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.support_threads t WHERE t.id = thread_id AND t.status = 'open'
    AND (t.rider_user_id = auth.uid() OR t.rider_email = lower(auth.jwt() ->> 'email'))));

CREATE INDEX IF NOT EXISTS user_roles_role_idx ON public.user_roles (role);