-- Authorization before existence: a caller with no pricing authority must be
-- refused before the function reveals whether a version exists, and the refusal
-- must be auditable.

CREATE OR REPLACE FUNCTION public.ap360_record_denial(p_action text, p_version_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.pricing_audit_events(actor_id, actor_email, action, entity, entity_id, new_value, reason)
  VALUES (
    auth.uid(),
    NULLIF(current_setting('request.jwt.claims', true)::jsonb->>'email', ''),
    CASE WHEN p_action IN ('approve','reject','publish') THEN p_action ELSE 'view' END,
    'ap360_version',
    p_version_id,
    jsonb_build_object('event', 'AUTHORIZATION_DENIED', 'blockedReason', p_reason, 'attempted_action', p_action,
                       '__route', '/dashboard/admin/pricing-360'),
    p_reason
  );
EXCEPTION WHEN OTHERS THEN
  -- Auditing must never mask the refusal itself.
  NULL;
END $function$;

REVOKE ALL ON FUNCTION public.ap360_record_denial(text, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ap360_transition_version(p_version_id uuid, p_action text, p_reason text DEFAULT ''::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ver public.ap360_versions; v_val jsonb; v_new text; v_approver boolean; v_denial text;
BEGIN
  IF p_action NOT IN ('submit','approve','reject','publish','archive') THEN
    RAISE EXCEPTION 'AP360: unknown action %', p_action;
  END IF;

  v_approver := public.has_any_role(auth.uid(), ARRAY['super_admin'::app_role,'finance_admin'::app_role]);

  -- Authority is settled first, so a refusal never leaks whether the version exists.
  IF p_action = 'submit' THEN
    IF NOT public.is_platform_admin() THEN v_denial := 'AP360: not authorised to submit pricing'; END IF;
  ELSIF p_action = 'approve' THEN
    IF NOT v_approver THEN v_denial := 'AP360: approval requires super admin or finance admin'; END IF;
  ELSIF p_action = 'reject' THEN
    IF NOT v_approver THEN v_denial := 'AP360: rejection requires super admin or finance admin'; END IF;
  ELSIF p_action = 'publish' THEN
    IF NOT v_approver THEN v_denial := 'AP360: publishing requires super admin or finance admin'; END IF;
  ELSIF p_action = 'archive' THEN
    IF NOT v_approver THEN v_denial := 'AP360: archiving requires super admin or finance admin'; END IF;
  END IF;

  IF v_denial IS NOT NULL THEN
    PERFORM public.ap360_record_denial(p_action, p_version_id, v_denial);
    RAISE EXCEPTION '%', v_denial;
  END IF;

  SELECT * INTO v_ver FROM public.ap360_versions WHERE id = p_version_id;
  IF v_ver.id IS NULL THEN RAISE EXCEPTION 'AP360: version not found'; END IF;

  IF p_action = 'submit' THEN
    IF v_ver.status NOT IN ('draft','validating','rejected') THEN
      RAISE EXCEPTION 'AP360: only a draft can be submitted (current status %)', v_ver.status; END IF;
    v_val := public.ap360_validate_version(p_version_id);
    IF NOT (v_val->>'valid')::boolean THEN
      RETURN jsonb_build_object('ok', false, 'validation', v_val); END IF;
    v_new := 'submitted';

  ELSIF p_action = 'approve' THEN
    IF v_ver.status <> 'submitted' THEN RAISE EXCEPTION 'AP360: only a submitted version can be approved'; END IF;
    UPDATE public.ap360_versions SET status = 'approved', approved_by = auth.uid(), approved_at = now(),
      reason = COALESCE(NULLIF(p_reason,''), reason) WHERE id = p_version_id;
    RETURN jsonb_build_object('ok', true, 'status','approved');

  ELSIF p_action = 'reject' THEN
    v_new := 'rejected';

  ELSIF p_action = 'publish' THEN
    IF v_ver.status <> 'approved' THEN RAISE EXCEPTION 'AP360: only an approved version can be published'; END IF;
    v_val := public.ap360_validate_version(p_version_id);
    IF NOT (v_val->>'valid')::boolean THEN
      RETURN jsonb_build_object('ok', false, 'validation', v_val); END IF;
    UPDATE public.ap360_versions SET status = 'superseded', superseded_at = now(), effective_to = now()
      WHERE profile_id = v_ver.profile_id AND status IN ('published','active') AND id <> p_version_id;
    UPDATE public.ap360_versions SET status = 'published', published_by = auth.uid(), published_at = now(),
      effective_from = GREATEST(effective_from, now()) WHERE id = p_version_id;
    RETURN jsonb_build_object('ok', true, 'status','published');

  ELSIF p_action = 'archive' THEN
    v_new := 'archived';
  END IF;

  UPDATE public.ap360_versions SET status = v_new, reason = COALESCE(NULLIF(p_reason,''), reason)
    WHERE id = p_version_id;
  RETURN jsonb_build_object('ok', true, 'status', v_new);
END $function$;

CREATE OR REPLACE FUNCTION public.ap360_rollback(p_version_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_src public.ap360_versions; v_next int; v_id uuid;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin'::app_role,'finance_admin'::app_role]) THEN
    PERFORM public.ap360_record_denial('rollback', p_version_id, 'AP360: rollback requires super admin or finance admin');
    RAISE EXCEPTION 'AP360: rollback requires super admin or finance admin';
  END IF;
  IF COALESCE(p_reason,'') = '' THEN RAISE EXCEPTION 'AP360: a rollback reason is required'; END IF;
  SELECT * INTO v_src FROM public.ap360_versions WHERE id = p_version_id;
  IF v_src.id IS NULL THEN RAISE EXCEPTION 'AP360: version not found'; END IF;

  SELECT COALESCE(MAX(version),0) + 1 INTO v_next FROM public.ap360_versions WHERE profile_id = v_src.profile_id;
  INSERT INTO public.ap360_versions(profile_id, version, status, engine_code, params, commission_pct,
    max_discount_pct, demand_ceiling, override_tolerance_pct, target_margin_pct, fuel_policy, tax_rule_code,
    reason, source, created_by, approved_by, approved_at)
  VALUES (v_src.profile_id, v_next, 'approved', v_src.engine_code, v_src.params, v_src.commission_pct,
    v_src.max_discount_pct, v_src.demand_ceiling, v_src.override_tolerance_pct, v_src.target_margin_pct,
    v_src.fuel_policy, v_src.tax_rule_code,
    'Rollback to v' || v_src.version || ': ' || p_reason, 'rollback', auth.uid(), auth.uid(), now())
  RETURNING id INTO v_id;

  INSERT INTO public.ap360_cost_inputs(version_id, cost_key, label, unit, amount, category, note)
  SELECT v_id, cost_key, label, unit, amount, category, note
  FROM public.ap360_cost_inputs WHERE version_id = v_src.id;

  RETURN public.ap360_transition_version(v_id, 'publish', 'Rollback to v' || v_src.version);
END $function$;