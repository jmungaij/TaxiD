
-- access_denials: replace permissive INSERT with self-scoped rule
DROP POLICY IF EXISTS "Anyone insert denial" ON public.access_denials;
CREATE POLICY "Self or anonymous insert denial"
  ON public.access_denials
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    user_id IS NULL
    OR user_id = auth.uid()
  );

-- admin_login_events: client may only log its own event (or anonymous attempt)
DROP POLICY IF EXISTS "login_events insert auth" ON public.admin_login_events;
CREATE POLICY "login_events self insert"
  ON public.admin_login_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    user_id IS NULL
    OR user_id = auth.uid()
  );

-- admin_login_attempts: server-only writes (edge functions use service_role)
DROP POLICY IF EXISTS "system inserts attempts" ON public.admin_login_attempts;

-- command_access_logs: server-only writes
DROP POLICY IF EXISTS "cmdlogs insert auth" ON public.command_access_logs;

-- command_denials: server-only writes
DROP POLICY IF EXISTS "cmddenials insert auth" ON public.command_denials;
