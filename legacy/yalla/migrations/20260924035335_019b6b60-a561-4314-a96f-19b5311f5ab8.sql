CREATE TABLE public.public_meeting_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name text NOT NULL,
  client_email text NOT NULL,
  company text,
  phone text,
  topic text NOT NULL,
  starts_at timestamptz NOT NULL,
  duration_minutes int NOT NULL DEFAULT 30,
  join_url text,
  external_event_id text,
  status text NOT NULL DEFAULT 'pending',
  failure_reason text,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.public_meeting_bookings TO authenticated;
GRANT ALL ON public.public_meeting_bookings TO service_role;
ALTER TABLE public.public_meeting_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY pmb_admin_read ON public.public_meeting_bookings FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.crm.read'));
CREATE INDEX pmb_email_idx ON public.public_meeting_bookings(lower(client_email), created_at DESC);
CREATE INDEX pmb_start_idx ON public.public_meeting_bookings(starts_at);

CREATE TABLE public.staff_permission_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  permission_key text NOT NULL CHECK (permission_key IN ('staff.crm.read','staff.crm.manage')),
  reason text,
  granted_by uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid,
  revoked_at timestamptz,
  revoke_reason text
);
GRANT SELECT ON public.staff_permission_grants TO authenticated;
GRANT ALL ON public.staff_permission_grants TO service_role;
ALTER TABLE public.staff_permission_grants ENABLE ROW LEVEL SECURITY;
CREATE POLICY spg_admin_read ON public.staff_permission_grants FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]) OR user_id = auth.uid());
CREATE UNIQUE INDEX spg_one_active ON public.staff_permission_grants(user_id, permission_key) WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION public.has_staff_permission(_perm text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    coalesce(auth.role()::text, '') = 'service_role'
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.staff_role_permissions srp ON srp.role = ur.role
      WHERE ur.user_id = auth.uid() AND srp.permission_key = _perm
    )
    OR EXISTS (
      SELECT 1 FROM public.staff_baseline_permissions b
      JOIN public.staff_members sm ON sm.user_id = auth.uid() AND sm.employment_status IN ('active','onboarding')
      WHERE b.permission_key = _perm AND b.active
    )
    OR EXISTS (
      SELECT 1 FROM public.staff_permission_grants g
      JOIN public.staff_members sm ON sm.user_id = g.user_id AND sm.employment_status IN ('active','onboarding')
      WHERE g.user_id = auth.uid() AND g.permission_key = _perm AND g.revoked_at IS NULL
        AND (_perm = g.permission_key OR (_perm = 'staff.crm.read' AND g.permission_key = 'staff.crm.manage'))
    )
    OR (_perm = 'staff.crm.read' AND EXISTS (
      SELECT 1 FROM public.staff_permission_grants g
      JOIN public.staff_members sm ON sm.user_id = g.user_id AND sm.employment_status IN ('active','onboarding')
      WHERE g.user_id = auth.uid() AND g.permission_key = 'staff.crm.manage' AND g.revoked_at IS NULL
    )),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.sales_access_overview()
RETURNS TABLE(staff_id uuid, user_id uuid, full_name text, work_email text, employment_status text,
  owned_leads bigint, open_leads bigint, role_read boolean, role_manage boolean,
  grant_read boolean, grant_manage boolean, roles text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT coalesce(public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]), false) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  RETURN QUERY
  SELECT sm.id, sm.user_id, sm.full_name, sm.work_email, sm.employment_status::text,
    (SELECT count(*) FROM sales_leads l WHERE l.sales_staff_id = sm.id),
    (SELECT count(*) FROM sales_leads l WHERE l.sales_staff_id = sm.id AND l.closed_at IS NULL),
    EXISTS (SELECT 1 FROM user_roles ur JOIN staff_role_permissions p ON p.role = ur.role WHERE ur.user_id = sm.user_id AND p.permission_key = 'staff.crm.read')
      OR EXISTS (SELECT 1 FROM staff_baseline_permissions b WHERE b.permission_key = 'staff.crm.read' AND b.active),
    EXISTS (SELECT 1 FROM user_roles ur JOIN staff_role_permissions p ON p.role = ur.role WHERE ur.user_id = sm.user_id AND p.permission_key = 'staff.crm.manage')
      OR EXISTS (SELECT 1 FROM staff_baseline_permissions b WHERE b.permission_key = 'staff.crm.manage' AND b.active),
    EXISTS (SELECT 1 FROM staff_permission_grants g WHERE g.user_id = sm.user_id AND g.permission_key = 'staff.crm.read' AND g.revoked_at IS NULL),
    EXISTS (SELECT 1 FROM staff_permission_grants g WHERE g.user_id = sm.user_id AND g.permission_key = 'staff.crm.manage' AND g.revoked_at IS NULL),
    coalesce((SELECT array_agg(ur.role::text ORDER BY ur.role::text) FROM user_roles ur WHERE ur.user_id = sm.user_id), '{}')
  FROM staff_members sm
  WHERE sm.user_id IS NOT NULL
  ORDER BY sm.full_name;
END $$;

CREATE OR REPLACE FUNCTION public.sales_access_set(p_user_id uuid, p_permission text, p_grant boolean, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT coalesce(public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]), false) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  IF p_permission NOT IN ('staff.crm.read','staff.crm.manage') THEN RAISE EXCEPTION 'PERMISSION_NOT_GRANTABLE'; END IF;
  IF p_user_id = auth.uid() THEN RAISE EXCEPTION 'CANNOT_CHANGE_OWN_ACCESS'; END IF;
  IF coalesce(length(btrim(p_reason)), 0) < 5 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM staff_members WHERE user_id = p_user_id) THEN RAISE EXCEPTION 'NOT_STAFF'; END IF;
  IF p_grant THEN
    INSERT INTO staff_permission_grants(user_id, permission_key, reason, granted_by)
    VALUES (p_user_id, p_permission, btrim(p_reason), auth.uid())
    ON CONFLICT (user_id, permission_key) WHERE revoked_at IS NULL DO NOTHING;
  ELSE
    UPDATE staff_permission_grants SET revoked_at = now(), revoked_by = auth.uid(), revoke_reason = btrim(p_reason)
    WHERE user_id = p_user_id AND permission_key = p_permission AND revoked_at IS NULL;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.sales_access_overview() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sales_access_set(uuid, text, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_access_overview() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_access_set(uuid, text, boolean, text) TO authenticated;