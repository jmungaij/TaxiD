-- Mentor / supervisor relationship helpers (staff-assignment derived, not role derived)
CREATE OR REPLACE FUNCTION public.intern_is_mentor(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.intern_profiles p
    JOIN public.staff_members m ON m.id = p.mentor_staff_id
    WHERE m.user_id = p_user
  );
$$;

CREATE OR REPLACE FUNCTION public.intern_is_supervisor(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.intern_profiles p
    JOIN public.staff_members s ON s.id = p.supervisor_staff_id
    WHERE s.user_id = p_user
  );
$$;

-- Authoritative cockpit entitlements. The UI may only offer what this returns.
CREATE OR REPLACE FUNCTION public.intern_cockpit_access()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_super boolean;
  v_exec boolean;
  v_manager boolean;
  v_recruiter boolean;
  v_mentor boolean;
  v_supervisor boolean;
  v_label text;
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('authenticated', false, 'role_label', 'Not signed in', 'panels', '[]'::jsonb);
  END IF;

  v_super      := public.has_any_role(v_user, ARRAY['super_admin','admin']::app_role[]);
  v_exec       := public.has_any_role(v_user, ARRAY['director','general_manager']::app_role[]);
  v_manager    := public.has_any_role(v_user, ARRAY['operations_admin']::app_role[]);
  v_recruiter  := public.has_any_role(v_user, ARRAY['compliance_admin']::app_role[]);
  v_mentor     := public.intern_is_mentor(v_user);
  v_supervisor := public.intern_is_supervisor(v_user);

  v_label := CASE
    WHEN v_super THEN 'Super Admin'
    WHEN v_exec THEN 'Executive'
    WHEN v_manager THEN 'Manager'
    WHEN v_recruiter THEN 'Recruiter / HR'
    WHEN v_supervisor THEN 'Supervisor'
    WHEN v_mentor THEN 'Mentor'
    ELSE 'No programme access'
  END;

  RETURN jsonb_build_object(
    'authenticated', true,
    'role_label', v_label,
    'is_super_admin', v_super,
    'is_executive', v_exec,
    'is_manager', v_manager,
    'is_recruiter', v_recruiter,
    'is_supervisor', v_supervisor,
    'is_mentor', v_mentor,
    -- panel visibility
    'view_kpis',          v_super OR v_exec OR v_manager OR v_recruiter OR v_supervisor OR v_mentor,
    'view_activity',      v_super OR v_exec OR v_manager OR v_supervisor,
    'view_work_queue',    v_super OR v_exec OR v_manager OR v_supervisor OR v_mentor,
    'view_evidence',      v_super OR v_manager OR v_supervisor OR v_mentor,
    'view_learning',      v_super OR v_exec OR v_manager OR v_supervisor OR v_mentor,
    'view_performance',   v_super OR v_exec OR v_manager OR v_supervisor,
    'view_commercial',    v_super OR v_exec OR v_manager,
    'view_talent',        v_super OR v_exec OR v_manager OR v_recruiter,
    'view_integrity',     v_super OR v_exec OR v_manager,
    'view_calendar',      v_super OR v_exec OR v_manager OR v_recruiter OR v_supervisor OR v_mentor,
    'view_cohort_health', v_super OR v_exec OR v_manager OR v_recruiter,
    -- action authority
    'assign_work',        v_super OR v_manager OR v_supervisor,
    'review_evidence',    v_super OR v_manager OR v_supervisor OR v_mentor,
    'schedule_checkin',   v_super OR v_manager OR v_supervisor OR v_mentor,
    'classify_talent',    v_super OR v_exec OR v_manager,
    'recompute_scores',   v_super OR v_manager
  );
END;
$$;

REVOKE ALL ON FUNCTION public.intern_cockpit_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.intern_cockpit_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.intern_cockpit_access() TO service_role;
GRANT EXECUTE ON FUNCTION public.intern_is_mentor(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.intern_is_supervisor(uuid) TO authenticated, service_role;

-- Append-only cockpit audit entry. Never trusts a client-supplied actor.
CREATE OR REPLACE FUNCTION public.intern_audit_action(
  p_action text,
  p_entity text,
  p_intern uuid DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_detail jsonb DEFAULT '{}'::jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_user uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required to record a cockpit action';
  END IF;

  IF p_action IS NULL OR btrim(p_action) = '' OR p_entity IS NULL OR btrim(p_entity) = '' THEN
    RAISE EXCEPTION 'action and entity are required';
  END IF;

  IF p_intern IS NOT NULL THEN
    IF NOT public.intern_can_view(p_intern) THEN
      RAISE EXCEPTION 'Not authorised to record actions against this intern';
    END IF;
  ELSIF NOT (
    public.intern_programme_authority(v_user)
    OR public.intern_is_mentor(v_user)
    OR public.intern_is_supervisor(v_user)
  ) THEN
    RAISE EXCEPTION 'Not authorised to record programme actions';
  END IF;

  INSERT INTO public.intern_audit_log (intern_id, actor_id, action, entity, entity_id, after_state)
  VALUES (p_intern, v_user, upper(btrim(p_action)), btrim(p_entity), p_entity_id, COALESCE(p_detail, '{}'::jsonb))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.intern_audit_action(text, text, uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.intern_audit_action(text, text, uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.intern_audit_action(text, text, uuid, uuid, jsonb) TO service_role;