
-- Four-eyes columns
ALTER TABLE public.dispatch_surge_zones
  ADD COLUMN IF NOT EXISTS first_approver_id uuid,
  ADD COLUMN IF NOT EXISTS first_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_approval_notes text,
  ADD COLUMN IF NOT EXISTS requires_two_approvals boolean NOT NULL DEFAULT false;

-- Versioning table
CREATE TABLE IF NOT EXISTS public.dispatch_surge_zone_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL,
  version integer NOT NULL,
  approval_status public.surge_approval_status NOT NULL,
  multiplier numeric NOT NULL,
  priority integer NOT NULL,
  active boolean NOT NULL,
  first_approver_id uuid,
  approved_by uuid,
  rejected_by uuid,
  requested_by uuid,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_by uuid,
  change_reason text,
  request_id text,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(zone_id, version)
);

GRANT SELECT ON public.dispatch_surge_zone_versions TO authenticated;
GRANT ALL ON public.dispatch_surge_zone_versions TO service_role;
ALTER TABLE public.dispatch_surge_zone_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ops read zone versions" ON public.dispatch_surge_zone_versions;
CREATE POLICY "ops read zone versions"
  ON public.dispatch_surge_zone_versions
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY[
    'admin','super_admin','operations_admin','dispatch_manager','pricing_manager'
  ]::public.app_role[]));

DROP POLICY IF EXISTS "no update zone versions" ON public.dispatch_surge_zone_versions;
CREATE POLICY "no update zone versions"
  ON public.dispatch_surge_zone_versions FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "no delete zone versions" ON public.dispatch_surge_zone_versions;
CREATE POLICY "no delete zone versions"
  ON public.dispatch_surge_zone_versions FOR DELETE TO authenticated USING (false);

CREATE INDEX IF NOT EXISTS idx_zone_versions_zone
  ON public.dispatch_surge_zone_versions(zone_id, version DESC);

-- Rate limit bucket table
CREATE TABLE IF NOT EXISTS public.dispatch_approval_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  window_start timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor_user_id, window_start)
);

GRANT SELECT ON public.dispatch_approval_rate_limits TO authenticated;
GRANT ALL ON public.dispatch_approval_rate_limits TO service_role;
ALTER TABLE public.dispatch_approval_rate_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ops read approval rate limits" ON public.dispatch_approval_rate_limits;
CREATE POLICY "ops read approval rate limits"
  ON public.dispatch_approval_rate_limits FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY[
    'admin','super_admin','operations_admin'
  ]::public.app_role[]));

CREATE INDEX IF NOT EXISTS idx_approval_rate_limits_actor
  ON public.dispatch_approval_rate_limits(actor_user_id, window_start DESC);

-- Snapshot helper
CREATE OR REPLACE FUNCTION public._snapshot_surge_zone(
  p_zone public.dispatch_surge_zones,
  p_changed_by uuid,
  p_change_reason text,
  p_request_id text,
  p_correlation_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next integer;
BEGIN
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next
    FROM public.dispatch_surge_zone_versions
   WHERE zone_id = p_zone.id;
  INSERT INTO public.dispatch_surge_zone_versions(
    zone_id, version, approval_status, multiplier, priority, active,
    first_approver_id, approved_by, rejected_by, requested_by,
    snapshot, changed_by, change_reason, request_id, correlation_id)
  VALUES (p_zone.id, v_next, p_zone.approval_status, p_zone.multiplier,
          p_zone.priority, p_zone.active,
          p_zone.first_approver_id, p_zone.approved_by, p_zone.rejected_by,
          p_zone.requested_by, to_jsonb(p_zone),
          p_changed_by, p_change_reason, p_request_id, p_correlation_id);
END;
$$;

-- Rewrite approval RPC with four-eyes + rate limit + versioning.
CREATE OR REPLACE FUNCTION public.approve_dispatch_override(
  p_zone_id       uuid,
  p_actor         uuid,
  p_action        text,
  p_note          text DEFAULT NULL,
  p_actor_email   text DEFAULT NULL,
  p_actor_role    text DEFAULT NULL,
  p_ip            text DEFAULT NULL,
  p_user_agent    text DEFAULT NULL,
  p_request_id    text DEFAULT NULL,
  p_correlation_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zone        public.dispatch_surge_zones%ROWTYPE;
  v_prev_state  public.surge_approval_status;
  v_new_state   public.surge_approval_status;
  v_now         timestamptz := now();
  v_window      timestamptz := date_trunc('minute', now());
  v_attempts    integer;
  v_limit       constant integer := 30;
  v_needs_two   boolean;
BEGIN
  IF p_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  END IF;
  IF p_action NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_ACTION');
  END IF;

  -- Rate limit: upsert bucket for actor+minute
  INSERT INTO public.dispatch_approval_rate_limits(actor_user_id, window_start, attempt_count, updated_at)
  VALUES (p_actor, v_window, 1, v_now)
  ON CONFLICT (actor_user_id, window_start)
  DO UPDATE SET attempt_count = public.dispatch_approval_rate_limits.attempt_count + 1,
                updated_at = v_now
  RETURNING attempt_count INTO v_attempts;

  IF v_attempts > v_limit THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RATE_LIMITED',
      'retry_after_seconds', 60 - EXTRACT(SECOND FROM v_now)::int);
  END IF;

  IF NOT public.has_any_role(p_actor, ARRAY[
    'super_admin','operations_admin','dispatch_manager','pricing_manager'
  ]::public.app_role[]) THEN
    INSERT INTO public.dispatch_approval_audit(
      zone_id, actor_user_id, actor_email, actor_role, action,
      reason, note, ip_address, user_agent, request_id, correlation_id, metadata)
    VALUES (p_zone_id, p_actor, p_actor_email, p_actor_role, 'denied',
            'RBAC_DENIED', p_note, p_ip, p_user_agent, p_request_id, p_correlation_id,
            jsonb_build_object('requested_action', p_action));
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  SELECT * INTO v_zone FROM public.dispatch_surge_zones
   WHERE id = p_zone_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;

  v_prev_state := v_zone.approval_status;

  IF v_prev_state <> 'PENDING' THEN
    INSERT INTO public.dispatch_approval_audit(
      zone_id, actor_user_id, actor_email, actor_role, action,
      previous_state, new_state, reason, note, ip_address, user_agent,
      request_id, correlation_id)
    VALUES (v_zone.id, p_actor, p_actor_email, p_actor_role, 'conflict',
            v_prev_state, v_prev_state, 'NOT_PENDING', p_note, p_ip, p_user_agent,
            p_request_id, p_correlation_id);
    RETURN jsonb_build_object('ok', false, 'code', 'CONFLICT',
      'status', v_prev_state, 'zone_id', v_zone.id);
  END IF;

  IF v_zone.requested_by IS NOT NULL AND v_zone.requested_by = p_actor THEN
    INSERT INTO public.dispatch_approval_audit(
      zone_id, actor_user_id, actor_email, actor_role, action,
      previous_state, new_state, reason, note, ip_address, user_agent,
      request_id, correlation_id)
    VALUES (v_zone.id, p_actor, p_actor_email, p_actor_role, 'denied',
            v_prev_state, v_prev_state, 'SELF_APPROVAL_DENIED', p_note,
            p_ip, p_user_agent, p_request_id, p_correlation_id);
    RETURN jsonb_build_object('ok', false, 'code', 'SELF_APPROVAL_DENIED');
  END IF;

  IF v_zone.valid_to IS NOT NULL AND v_zone.valid_to < v_now THEN
    UPDATE public.dispatch_surge_zones
       SET approval_status = 'EXPIRED', active = false
     WHERE id = v_zone.id;
    SELECT * INTO v_zone FROM public.dispatch_surge_zones WHERE id = v_zone.id;
    PERFORM public._snapshot_surge_zone(v_zone, p_actor, 'EXPIRED', p_request_id, p_correlation_id);
    INSERT INTO public.dispatch_approval_audit(
      zone_id, actor_user_id, actor_email, actor_role, action,
      previous_state, new_state, reason, note, ip_address, user_agent,
      request_id, correlation_id)
    VALUES (v_zone.id, p_actor, p_actor_email, p_actor_role, 'expired',
            v_prev_state, 'EXPIRED', 'WINDOW_EXPIRED', p_note,
            p_ip, p_user_agent, p_request_id, p_correlation_id);
    RETURN jsonb_build_object('ok', false, 'code', 'EXPIRED');
  END IF;

  v_needs_two := v_zone.requires_two_approvals OR v_zone.multiplier > 5.0;

  IF p_action = 'approve'
     AND v_zone.multiplier > 5.0
     AND NOT public.has_role(p_actor, 'super_admin'::public.app_role) THEN
    INSERT INTO public.dispatch_approval_audit(
      zone_id, actor_user_id, actor_email, actor_role, action,
      previous_state, new_state, reason, note, ip_address, user_agent,
      request_id, correlation_id, metadata)
    VALUES (v_zone.id, p_actor, p_actor_email, p_actor_role, 'denied',
            v_prev_state, v_prev_state, 'MULTIPLIER_CEILING', p_note,
            p_ip, p_user_agent, p_request_id, p_correlation_id,
            jsonb_build_object('multiplier', v_zone.multiplier));
    RETURN jsonb_build_object('ok', false, 'code', 'MULTIPLIER_CEILING_EXCEEDED');
  END IF;

  IF p_action = 'reject' THEN
    v_new_state := 'REJECTED';
    UPDATE public.dispatch_surge_zones
       SET approval_status = 'REJECTED',
           active = false,
           rejected_by = p_actor,
           rejected_at = v_now,
           valid_to = COALESCE(valid_to, v_now),
           approval_notes = COALESCE(p_note, approval_notes)
     WHERE id = v_zone.id;
    SELECT * INTO v_zone FROM public.dispatch_surge_zones WHERE id = v_zone.id;
    PERFORM public._snapshot_surge_zone(v_zone, p_actor, 'REJECTED', p_request_id, p_correlation_id);

    INSERT INTO public.dispatch_approval_audit(
      zone_id, actor_user_id, actor_email, actor_role, action,
      previous_state, new_state, reason, note, ip_address, user_agent,
      request_id, correlation_id)
    VALUES (v_zone.id, p_actor, p_actor_email, p_actor_role, 'reject',
            v_prev_state, v_new_state, NULL, p_note,
            p_ip, p_user_agent, p_request_id, p_correlation_id);

    RETURN jsonb_build_object('ok', true, 'zone_id', v_zone.id,
      'status', v_new_state, 'approved_by', NULL,
      'request_id', p_request_id, 'correlation_id', p_correlation_id);
  END IF;

  -- Approve branch
  IF v_needs_two AND v_zone.first_approver_id IS NULL THEN
    -- Record first approval only; stay PENDING.
    UPDATE public.dispatch_surge_zones
       SET first_approver_id = p_actor,
           first_approved_at = v_now,
           first_approval_notes = p_note
     WHERE id = v_zone.id;
    SELECT * INTO v_zone FROM public.dispatch_surge_zones WHERE id = v_zone.id;
    PERFORM public._snapshot_surge_zone(v_zone, p_actor, 'FIRST_APPROVAL', p_request_id, p_correlation_id);

    INSERT INTO public.dispatch_approval_audit(
      zone_id, actor_user_id, actor_email, actor_role, action,
      previous_state, new_state, reason, note, ip_address, user_agent,
      request_id, correlation_id, metadata)
    VALUES (v_zone.id, p_actor, p_actor_email, p_actor_role, 'first_approve',
            v_prev_state, 'PENDING', 'AWAITING_SECOND_APPROVER', p_note,
            p_ip, p_user_agent, p_request_id, p_correlation_id,
            jsonb_build_object('requires_two_approvals', true));

    RETURN jsonb_build_object('ok', true, 'zone_id', v_zone.id,
      'status', 'PENDING', 'stage', 'FIRST_APPROVAL_RECORDED',
      'first_approver', p_actor, 'awaiting_second_approver', true,
      'request_id', p_request_id, 'correlation_id', p_correlation_id);
  END IF;

  IF v_needs_two AND v_zone.first_approver_id IS NOT NULL
     AND v_zone.first_approver_id = p_actor THEN
    INSERT INTO public.dispatch_approval_audit(
      zone_id, actor_user_id, actor_email, actor_role, action,
      previous_state, new_state, reason, note, ip_address, user_agent,
      request_id, correlation_id)
    VALUES (v_zone.id, p_actor, p_actor_email, p_actor_role, 'denied',
            v_prev_state, v_prev_state, 'FOUR_EYES_SAME_ACTOR', p_note,
            p_ip, p_user_agent, p_request_id, p_correlation_id);
    RETURN jsonb_build_object('ok', false, 'code', 'FOUR_EYES_SAME_ACTOR');
  END IF;

  -- Final approval (either single-eye or second-eye path)
  v_new_state := 'APPROVED';
  UPDATE public.dispatch_surge_zones
     SET active = false, valid_to = v_now
   WHERE cell_key = v_zone.cell_key
     AND active = true
     AND id <> v_zone.id
     AND priority <= v_zone.priority;

  UPDATE public.dispatch_surge_zones
     SET approval_status = 'APPROVED',
         active = true,
         approved_by = p_actor,
         approved_at = v_now,
         valid_from = v_now,
         approval_notes = COALESCE(p_note, approval_notes)
   WHERE id = v_zone.id;
  SELECT * INTO v_zone FROM public.dispatch_surge_zones WHERE id = v_zone.id;
  PERFORM public._snapshot_surge_zone(v_zone, p_actor, 'APPROVED', p_request_id, p_correlation_id);

  INSERT INTO public.dispatch_approval_audit(
    zone_id, actor_user_id, actor_email, actor_role, action,
    previous_state, new_state, reason, note, ip_address, user_agent,
    request_id, correlation_id, metadata)
  VALUES (v_zone.id, p_actor, p_actor_email, p_actor_role, 'approve',
          v_prev_state, v_new_state, NULL, p_note,
          p_ip, p_user_agent, p_request_id, p_correlation_id,
          jsonb_build_object(
            'cell_key', v_zone.cell_key,
            'multiplier', v_zone.multiplier,
            'priority', v_zone.priority,
            'four_eyes', v_needs_two,
            'first_approver', v_zone.first_approver_id));

  RETURN jsonb_build_object('ok', true, 'zone_id', v_zone.id,
    'status', v_new_state, 'approved_by', p_actor,
    'first_approver', v_zone.first_approver_id,
    'four_eyes_completed', v_needs_two,
    'request_id', p_request_id, 'correlation_id', p_correlation_id);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_dispatch_override(
  uuid, uuid, text, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_dispatch_override(
  uuid, uuid, text, text, text, text, text, text, text, text
) TO service_role;
