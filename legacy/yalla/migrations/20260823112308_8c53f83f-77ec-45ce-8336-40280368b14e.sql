-- 1. Dispatch state on lifecycle signals
ALTER TABLE public.partner_lifecycle_signals
  ADD COLUMN IF NOT EXISTS dispatch_state text NOT NULL DEFAULT 'dispatched',
  ADD COLUMN IF NOT EXISTS dispatch_reason text,
  ADD COLUMN IF NOT EXISTS batched_into_signal_id uuid,
  ADD COLUMN IF NOT EXISTS notified_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.partner_lifecycle_signals
    ADD CONSTRAINT partner_lifecycle_signals_dispatch_state_chk
    CHECK (dispatch_state IN ('dispatched','batched','throttled','failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Throttle / batching windows
CREATE TABLE IF NOT EXISTS public.partner_lifecycle_dispatch_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL UNIQUE,
  window_seconds integer NOT NULL DEFAULT 120,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  last_signal_id uuid,
  last_work_item_id uuid,
  last_notification_id uuid,
  batched_count integer NOT NULL DEFAULT 0,
  batched_stages text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.partner_lifecycle_dispatch_windows TO authenticated;
GRANT ALL ON public.partner_lifecycle_dispatch_windows TO service_role;
ALTER TABLE public.partner_lifecycle_dispatch_windows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "yp_dispatch_windows_staff_read" ON public.partner_lifecycle_dispatch_windows;
CREATE POLICY "yp_dispatch_windows_staff_read"
  ON public.partner_lifecycle_dispatch_windows FOR SELECT TO authenticated
  USING (public.yp_is_staff());

-- 3. Throttled / batched lifecycle signal dispatcher
CREATE OR REPLACE FUNCTION public.partner_lifecycle_signal(
  p_session_id text, p_stage text, p_level text DEFAULT NULL::text,
  p_category text DEFAULT NULL::text, p_bring text DEFAULT NULL::text,
  p_variant text DEFAULT NULL::text, p_page text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_session text := nullif(btrim(coalesce(p_session_id, '')), '');
  v_stage text := nullif(btrim(coalesce(p_stage, '')), '');
  v_recent integer;
  v_existing uuid;
  v_work_id uuid;
  v_signal_id uuid;
  v_note_id uuid;
  v_code text;
  v_win public.partner_lifecycle_dispatch_windows;
  v_in_window boolean := false;
  v_state text := 'dispatched';
  v_reason text;
  v_ctx jsonb;
BEGIN
  IF v_session IS NULL OR v_stage IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_and_stage_required');
  END IF;
  IF length(v_session) > 120 OR length(v_stage) > 60 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_input');
  END IF;

  -- Dedupe: one signal per session per stage.
  SELECT id INTO v_existing FROM public.partner_lifecycle_signals
   WHERE session_id = v_session AND lifecycle_stage = v_stage;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'deduped', true, 'signal_id', v_existing);
  END IF;

  -- Rate limit: a session may raise at most 12 stage signals per hour.
  SELECT count(*) INTO v_recent FROM public.partner_lifecycle_signals
   WHERE session_id = v_session AND created_at > now() - interval '1 hour';
  IF v_recent >= 12 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  -- Throttling window: rapid stage changes fold into the open window's task.
  SELECT * INTO v_win FROM public.partner_lifecycle_dispatch_windows
   WHERE session_id = v_session FOR UPDATE;

  v_in_window := v_win.id IS NOT NULL
    AND v_win.last_work_item_id IS NOT NULL
    AND now() < v_win.window_started_at + make_interval(secs => v_win.window_seconds);

  v_ctx := jsonb_strip_nulls(jsonb_build_object(
    'stage', v_stage, 'level', p_level, 'category', p_category,
    'bring', p_bring, 'variant', p_variant, 'page', p_page
  ));

  IF v_in_window THEN
    v_state := 'batched';
    v_reason := 'folded into open dispatch window';
    v_work_id := v_win.last_work_item_id;
  ELSE
    v_code := 'YPL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
    INSERT INTO public.partner_work_items (
      work_code, queue, title, detail, priority, sla_minutes, dedupe_key
    ) VALUES (
      v_code, 'onboarding',
      'Partner interest at lifecycle stage: ' || v_stage,
      concat_ws(' · ',
        'Stage: ' || v_stage,
        CASE WHEN nullif(btrim(coalesce(p_level, '')), '') IS NOT NULL THEN 'Maturity level: ' || p_level END,
        CASE WHEN nullif(btrim(coalesce(p_category, '')), '') IS NOT NULL THEN 'Category: ' || p_category END,
        CASE WHEN nullif(btrim(coalesce(p_bring, '')), '') IS NOT NULL THEN 'Brings: ' || p_bring END,
        CASE WHEN nullif(btrim(coalesce(p_variant, '')), '') IS NOT NULL THEN 'Messaging variant: ' || p_variant END,
        'Session: ' || v_session
      ),
      'low', 480,
      'yp-lifecycle:' || v_session || ':' || v_stage
    )
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id INTO v_work_id;

    IF v_work_id IS NULL THEN
      SELECT id INTO v_work_id FROM public.partner_work_items
       WHERE dedupe_key = 'yp-lifecycle:' || v_session || ':' || v_stage;
    END IF;

    IF v_work_id IS NULL THEN
      v_state := 'failed';
      v_reason := 'staff task could not be raised for this stage';
    END IF;
  END IF;

  INSERT INTO public.partner_lifecycle_signals (
    session_id, lifecycle_stage, maturity_level, network_category,
    intent_bring, ab_variant, page_source, work_item_id, created_by,
    dispatch_state, dispatch_reason, batched_into_signal_id, notified_at
  ) VALUES (
    v_session, v_stage,
    nullif(btrim(coalesce(p_level, '')), ''),
    nullif(btrim(coalesce(p_category, '')), ''),
    nullif(btrim(coalesce(p_bring, '')), ''),
    nullif(btrim(coalesce(p_variant, '')), ''),
    nullif(btrim(coalesce(p_page, '')), ''),
    v_work_id, auth.uid(),
    v_state, v_reason,
    CASE WHEN v_state = 'batched' THEN v_win.last_signal_id END,
    CASE WHEN v_state = 'dispatched' THEN now() END
  )
  RETURNING id INTO v_signal_id;

  IF v_state = 'batched' THEN
    -- One alert per window: enrich the open notification instead of adding another.
    UPDATE public.partner_staff_notifications
       SET body = concat_ws(' · ', body, 'Also moved to stage ' || v_stage),
           context = context
             || jsonb_build_object('batched_stages',
                  coalesce(context -> 'batched_stages', '[]'::jsonb) || to_jsonb(v_stage))
             || jsonb_build_object('last_batched_at', to_jsonb(now()))
     WHERE id = v_win.last_notification_id;

    UPDATE public.partner_lifecycle_dispatch_windows
       SET batched_count = batched_count + 1,
           batched_stages = array_append(batched_stages, v_stage),
           last_signal_id = v_signal_id,
           updated_at = now()
     WHERE id = v_win.id;
  ELSIF v_state = 'dispatched' THEN
    INSERT INTO public.partner_staff_notifications (
      kind, title, body, work_item_id, signal_id, session_id, context
    ) VALUES (
      'lifecycle_stage_changed',
      'Partner visitor moved to stage: ' || v_stage,
      concat_ws(' · ',
        CASE WHEN p_bring IS NOT NULL THEN 'Brings ' || p_bring END,
        CASE WHEN p_category IS NOT NULL THEN 'Category ' || p_category END,
        CASE WHEN p_level IS NOT NULL THEN 'Level ' || p_level END
      ),
      v_work_id, v_signal_id, v_session, v_ctx
    )
    RETURNING id INTO v_note_id;

    INSERT INTO public.partner_lifecycle_dispatch_windows (
      session_id, window_started_at, last_signal_id, last_work_item_id,
      last_notification_id, batched_count, batched_stages
    ) VALUES (v_session, now(), v_signal_id, v_work_id, v_note_id, 0, ARRAY[v_stage])
    ON CONFLICT (session_id) DO UPDATE SET
      window_started_at = now(),
      last_signal_id = EXCLUDED.last_signal_id,
      last_work_item_id = EXCLUDED.last_work_item_id,
      last_notification_id = EXCLUDED.last_notification_id,
      batched_count = 0,
      batched_stages = EXCLUDED.batched_stages,
      updated_at = now();
  END IF;

  RETURN jsonb_build_object(
    'ok', v_state <> 'failed', 'signal_id', v_signal_id, 'work_item_id', v_work_id,
    'dispatch_state', v_state, 'reason', v_reason
  );
END;
$function$;

-- 4. Task queue status view with SLA timers
CREATE OR REPLACE VIEW public.v_partner_lifecycle_task_queue AS
SELECT
  s.id                         AS signal_id,
  s.session_id,
  s.lifecycle_stage,
  s.maturity_level,
  s.network_category,
  s.intent_bring,
  s.ab_variant,
  s.page_source,
  s.created_at                 AS signalled_at,
  s.dispatch_state,
  s.dispatch_reason,
  s.batched_into_signal_id,
  s.notified_at,
  w.id                         AS work_item_id,
  w.work_code,
  w.queue,
  w.title,
  w.state::text                AS work_state,
  w.priority,
  w.sla_minutes,
  w.sla_started_at,
  coalesce(w.due_at, w.sla_started_at + make_interval(mins => w.sla_minutes)) AS due_at,
  w.resolved_at,
  w.escalated_at,
  w.escalation_reason,
  w.assigned_to,
  CASE WHEN w.id IS NULL THEN NULL ELSE
    round(greatest(0, extract(epoch FROM (coalesce(w.resolved_at, now()) - w.sla_started_at)) / 60.0)::numeric, 2)
  END AS elapsed_minutes,
  CASE WHEN w.id IS NULL OR w.sla_minutes = 0 THEN NULL ELSE
    least(100, round((greatest(0, extract(epoch FROM (coalesce(w.resolved_at, now()) - w.sla_started_at)) / 60.0) / w.sla_minutes * 100)::numeric, 1))
  END AS sla_progress_pct,
  CASE
    WHEN w.id IS NULL THEN 'no_task'
    WHEN w.resolved_at IS NOT NULL THEN
      CASE WHEN w.resolved_at <= coalesce(w.due_at, w.sla_started_at + make_interval(mins => w.sla_minutes))
        THEN 'met' ELSE 'breached' END
    WHEN now() > coalesce(w.due_at, w.sla_started_at + make_interval(mins => w.sla_minutes)) THEN 'breached'
    WHEN extract(epoch FROM (now() - w.sla_started_at)) / 60.0 >= w.sla_minutes * 0.8 THEN 'at_risk'
    ELSE 'on_track'
  END AS sla_status
FROM public.partner_lifecycle_signals s
LEFT JOIN public.partner_work_items w ON w.id = s.work_item_id;

ALTER VIEW public.v_partner_lifecycle_task_queue SET (security_invoker = on);
GRANT SELECT ON public.v_partner_lifecycle_task_queue TO authenticated;

-- 5. Fine-grained revert permission
CREATE OR REPLACE FUNCTION public.partner_can_revert_profile(_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.has_any_role(_user_id, ARRAY[
    'super_admin','admin','director','general_manager'
  ]::app_role[]);
$function$;

CREATE OR REPLACE FUNCTION public.partner_permissions()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'is_staff', public.yp_is_staff(),
    'can_revert_profile', public.partner_can_revert_profile(auth.uid())
  );
$function$;

REVOKE ALL ON FUNCTION public.partner_can_revert_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_can_revert_profile(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.partner_permissions() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.partner_profile_revert(p_history_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_h public.partner_profile_history; v_new uuid;
BEGIN
  IF NOT public.yp_is_staff() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorised');
  END IF;
  IF NOT public.partner_can_revert_profile(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'revert_not_permitted');
  END IF;
  SELECT * INTO v_h FROM public.partner_profile_history WHERE id = p_history_id;
  IF v_h.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'history_not_found');
  END IF;

  UPDATE public.partner_intent_profiles SET
    intent_bring = v_h.intent_bring,
    network_category = v_h.network_category,
    maturity_level = v_h.maturity_level,
    lifecycle_stage = v_h.lifecycle_stage,
    commercial_model = v_h.commercial_model,
    partner_type = v_h.partner_type,
    updated_at = now()
  WHERE id = v_h.profile_id;

  UPDATE public.partner_profile_history
     SET change_kind = 'reverted', reverted_from_history_id = v_h.id
   WHERE profile_id = v_h.profile_id
     AND created_at = (SELECT max(created_at) FROM public.partner_profile_history WHERE profile_id = v_h.profile_id);

  SELECT id INTO v_new FROM public.partner_profile_history
   WHERE profile_id = v_h.profile_id ORDER BY created_at DESC LIMIT 1;

  RETURN jsonb_build_object('ok', true, 'profile_id', v_h.profile_id, 'history_id', v_new);
END; $function$;