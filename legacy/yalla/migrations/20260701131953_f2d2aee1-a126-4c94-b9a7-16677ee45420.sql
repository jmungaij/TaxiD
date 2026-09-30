
-- Enum for surge approval state.
DO $$ BEGIN
  CREATE TYPE public.surge_approval_status AS ENUM (
    'PENDING','APPROVED','REJECTED','EXPIRED','CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add approval columns to dispatch_surge_zones.
ALTER TABLE public.dispatch_surge_zones
  ADD COLUMN IF NOT EXISTS approval_status public.surge_approval_status
    NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS requested_by uuid,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by uuid,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_notes text,
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 100;

UPDATE public.dispatch_surge_zones
   SET approval_status = 'APPROVED'
 WHERE approval_status = 'PENDING'
   AND active = true
   AND (reason IS NULL OR reason NOT LIKE '[PENDING]%');

UPDATE public.dispatch_surge_zones
   SET approval_status = 'REJECTED'
 WHERE approval_status = 'PENDING'
   AND active = false
   AND reason LIKE '[REJECTED]%';

CREATE INDEX IF NOT EXISTS idx_surge_zones_approval_status
  ON public.dispatch_surge_zones(approval_status, cell_key);

-- Immutable audit trail table.
CREATE TABLE IF NOT EXISTS public.dispatch_approval_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL,
  actor_user_id uuid,
  actor_email text,
  actor_role text,
  action text NOT NULL,
  previous_state public.surge_approval_status,
  new_state public.surge_approval_status,
  reason text,
  note text,
  ip_address text,
  user_agent text,
  request_id text,
  correlation_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.dispatch_approval_audit TO authenticated;
GRANT ALL ON public.dispatch_approval_audit TO service_role;

ALTER TABLE public.dispatch_approval_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ops read approval audit" ON public.dispatch_approval_audit;
CREATE POLICY "ops read approval audit"
  ON public.dispatch_approval_audit
  FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY[
    'admin','super_admin','operations_admin','dispatch_manager','pricing_manager'
  ]::public.app_role[]));

DROP POLICY IF EXISTS "no update approval audit" ON public.dispatch_approval_audit;
CREATE POLICY "no update approval audit"
  ON public.dispatch_approval_audit FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "no delete approval audit" ON public.dispatch_approval_audit;
CREATE POLICY "no delete approval audit"
  ON public.dispatch_approval_audit FOR DELETE TO authenticated USING (false);

CREATE INDEX IF NOT EXISTS idx_dispatch_approval_audit_zone
  ON public.dispatch_approval_audit(zone_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_approval_audit_actor
  ON public.dispatch_approval_audit(actor_user_id, created_at DESC);

-- Approval RPC — SECURITY DEFINER, per-row lock, RBAC, fraud checks.
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
BEGIN
  IF p_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED');
  END IF;

  IF p_action NOT IN ('approve','reject') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'BAD_ACTION');
  END IF;

  IF NOT public.has_any_role(p_actor, ARRAY[
    'super_admin','operations_admin','dispatch_manager','pricing_manager'
  ]::public.app_role[]) THEN
    INSERT INTO public.dispatch_approval_audit(
      zone_id, actor_user_id, actor_email, actor_role, action,
      previous_state, new_state, reason, note, ip_address, user_agent,
      request_id, correlation_id, metadata)
    VALUES (p_zone_id, p_actor, p_actor_email, p_actor_role, 'denied',
            NULL, NULL, 'RBAC_DENIED', p_note, p_ip, p_user_agent,
            p_request_id, p_correlation_id,
            jsonb_build_object('requested_action', p_action));
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  SELECT * INTO v_zone
    FROM public.dispatch_surge_zones
   WHERE id = p_zone_id
   FOR UPDATE;

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
    RETURN jsonb_build_object(
      'ok', false, 'code', 'CONFLICT',
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
    INSERT INTO public.dispatch_approval_audit(
      zone_id, actor_user_id, actor_email, actor_role, action,
      previous_state, new_state, reason, note, ip_address, user_agent,
      request_id, correlation_id)
    VALUES (v_zone.id, p_actor, p_actor_email, p_actor_role, 'expired',
            v_prev_state, 'EXPIRED', 'WINDOW_EXPIRED', p_note,
            p_ip, p_user_agent, p_request_id, p_correlation_id);
    RETURN jsonb_build_object('ok', false, 'code', 'EXPIRED');
  END IF;

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
           active          = false,
           rejected_by     = p_actor,
           rejected_at     = v_now,
           valid_to        = COALESCE(valid_to, v_now),
           approval_notes  = COALESCE(p_note, approval_notes)
     WHERE id = v_zone.id;
  ELSE
    v_new_state := 'APPROVED';
    UPDATE public.dispatch_surge_zones
       SET active = false,
           valid_to = v_now
     WHERE cell_key = v_zone.cell_key
       AND active = true
       AND id <> v_zone.id
       AND priority <= v_zone.priority;

    UPDATE public.dispatch_surge_zones
       SET approval_status = 'APPROVED',
           active          = true,
           approved_by     = p_actor,
           approved_at     = v_now,
           valid_from      = v_now,
           approval_notes  = COALESCE(p_note, approval_notes)
     WHERE id = v_zone.id;
  END IF;

  INSERT INTO public.dispatch_approval_audit(
    zone_id, actor_user_id, actor_email, actor_role, action,
    previous_state, new_state, reason, note, ip_address, user_agent,
    request_id, correlation_id, metadata)
  VALUES (v_zone.id, p_actor, p_actor_email, p_actor_role, p_action,
          v_prev_state, v_new_state, NULL, p_note,
          p_ip, p_user_agent, p_request_id, p_correlation_id,
          jsonb_build_object(
            'cell_key', v_zone.cell_key,
            'multiplier', v_zone.multiplier,
            'priority', v_zone.priority));

  RETURN jsonb_build_object(
    'ok', true,
    'zone_id', v_zone.id,
    'status', v_new_state,
    'approved_by', p_actor,
    'request_id', p_request_id,
    'correlation_id', p_correlation_id);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_dispatch_override(
  uuid, uuid, text, text, text, text, text, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_dispatch_override(
  uuid, uuid, text, text, text, text, text, text, text, text
) FROM anon;
REVOKE ALL ON FUNCTION public.approve_dispatch_override(
  uuid, uuid, text, text, text, text, text, text, text, text
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.approve_dispatch_override(
  uuid, uuid, text, text, text, text, text, text, text, text
) TO service_role;
