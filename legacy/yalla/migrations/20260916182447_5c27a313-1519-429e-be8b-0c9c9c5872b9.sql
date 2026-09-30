-- Dedicated, centrally revocable security-records capability.
INSERT INTO public.staff_permissions (key, domain, action, description) VALUES
  ('staff.security.read', 'security', 'read',
   'View security and audit registers: access refusals, admin audit log, authentication and sign-in events, device fingerprints'),
  ('staff.security.manage', 'security', 'manage',
   'Maintain security registers and device/authentication records')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.staff_role_permissions (role, permission_key) VALUES
  ('admin', 'staff.security.read'),
  ('admin', 'staff.security.manage'),
  ('compliance_admin', 'staff.security.read'),
  ('super_admin', 'staff.security.read'),
  ('super_admin', 'staff.security.manage')
ON CONFLICT (role, permission_key) DO NOTHING;

-- access_denials
DROP POLICY IF EXISTS "Admins read denials" ON public.access_denials;
CREATE POLICY "Security staff read denials"
  ON public.access_denials FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.security.read'));

-- admin_audit_log
DROP POLICY IF EXISTS "Admins read audit log" ON public.admin_audit_log;
CREATE POLICY "Security staff read audit log"
  ON public.admin_audit_log FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.security.read'));

-- admin_login_events (self read stays)
DROP POLICY IF EXISTS "login_events admins read" ON public.admin_login_events;
CREATE POLICY "login_events security staff read"
  ON public.admin_login_events FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.security.read'));

-- authentication_events: reads governed by the capability, writes separated.
DROP POLICY IF EXISTS "ae_user_own" ON public.authentication_events;
DROP POLICY IF EXISTS "ae_admin_write" ON public.authentication_events;
CREATE POLICY "ae_read_own_or_security_staff"
  ON public.authentication_events FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_staff_permission('staff.security.read'));
CREATE POLICY "ae_security_staff_insert"
  ON public.authentication_events FOR INSERT TO authenticated
  WITH CHECK (public.has_staff_permission('staff.security.manage'));
CREATE POLICY "ae_security_staff_update"
  ON public.authentication_events FOR UPDATE TO authenticated
  USING (public.has_staff_permission('staff.security.manage'))
  WITH CHECK (public.has_staff_permission('staff.security.manage'));
CREATE POLICY "ae_security_staff_delete"
  ON public.authentication_events FOR DELETE TO authenticated
  USING (public.has_staff_permission('staff.security.manage'));

-- device_fingerprints: same split.
DROP POLICY IF EXISTS "df_user_read_own_nonscoring" ON public.device_fingerprints;
DROP POLICY IF EXISTS "df_admin_all" ON public.device_fingerprints;
CREATE POLICY "df_read_own_or_security_staff"
  ON public.device_fingerprints FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_staff_permission('staff.security.read'));
CREATE POLICY "df_security_staff_insert"
  ON public.device_fingerprints FOR INSERT TO authenticated
  WITH CHECK (public.has_staff_permission('staff.security.manage'));
CREATE POLICY "df_security_staff_update"
  ON public.device_fingerprints FOR UPDATE TO authenticated
  USING (public.has_staff_permission('staff.security.manage'))
  WITH CHECK (public.has_staff_permission('staff.security.manage'));
CREATE POLICY "df_security_staff_delete"
  ON public.device_fingerprints FOR DELETE TO authenticated
  USING (public.has_staff_permission('staff.security.manage'));