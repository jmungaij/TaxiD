CREATE OR REPLACE FUNCTION public.sales_access_overview()
RETURNS TABLE(staff_id uuid, user_id uuid, full_name text, work_email text, employment_status text,
  owned_leads bigint, open_leads bigint, role_read boolean, role_manage boolean,
  grant_read boolean, grant_manage boolean, roles text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT coalesce(public.has_any_role(auth.uid(), ARRAY['admin','super_admin','general_manager']::app_role[]), false) THEN
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
  IF NOT coalesce(public.has_any_role(auth.uid(), ARRAY['admin','super_admin','general_manager']::app_role[]), false) THEN
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

DROP POLICY IF EXISTS spg_admin_read ON public.staff_permission_grants;
CREATE POLICY spg_admin_read ON public.staff_permission_grants FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','general_manager']::app_role[]) OR user_id = auth.uid());