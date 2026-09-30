-- ============================================================
-- Navigation Governance — staged (canary) publishing, version diff,
-- drift detection alerts, audit search/export, snapshot API
-- ============================================================

ALTER TABLE public.nav_registry_versions
  ADD COLUMN IF NOT EXISTS rollout_mode text NOT NULL DEFAULT 'full',
  ADD COLUMN IF NOT EXISTS rollout_roles text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS rollout_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS rollout_percent integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS canary_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS canary_ended_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.nav_registry_versions
    ADD CONSTRAINT nav_rollout_mode_chk CHECK (rollout_mode IN ('full','canary'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Drift alerts -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.nav_drift_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint text NOT NULL,
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  title text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  version_id uuid REFERENCES public.nav_registry_versions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open',
  occurrences integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  notified_at timestamptz,
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  CONSTRAINT nav_drift_kind_chk CHECK (kind IN ('crawler_integrity','capability_drift','rbac_drift','snapshot_hash_drift','orphan_route')),
  CONSTRAINT nav_drift_sev_chk CHECK (severity IN ('info','warning','critical')),
  CONSTRAINT nav_drift_status_chk CHECK (status IN ('open','acknowledged','resolved')),
  CONSTRAINT nav_drift_fingerprint_open UNIQUE (fingerprint)
);
GRANT SELECT, UPDATE ON public.nav_drift_alerts TO authenticated;
GRANT ALL ON public.nav_drift_alerts TO service_role;
ALTER TABLE public.nav_drift_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "platform admins read nav drift alerts" ON public.nav_drift_alerts
  FOR SELECT TO authenticated USING (public.nav_registry_can_author(auth.uid()));
CREATE POLICY "platform admins triage nav drift alerts" ON public.nav_drift_alerts
  FOR UPDATE TO authenticated USING (public.nav_registry_can_author(auth.uid()))
  WITH CHECK (public.nav_registry_can_author(auth.uid()));

CREATE INDEX IF NOT EXISTS nav_drift_alerts_status_idx ON public.nav_drift_alerts (status, last_seen_at DESC);

-- Record / dedupe drift --------------------------------------------------
CREATE OR REPLACE FUNCTION public.nav_record_drift(
  p_kind text, p_title text, p_severity text DEFAULT 'warning',
  p_detail jsonb DEFAULT '{}'::jsonb, p_version_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fp text; v_id uuid; v_created boolean := false;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.nav_registry_can_author(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized: drift recording requires platform admin or the integrity worker';
  END IF;
  v_fp := encode(digest(p_kind || '|' || p_title || '|' || COALESCE(p_detail->>'path',''), 'sha256'), 'hex');

  INSERT INTO public.nav_drift_alerts (fingerprint, kind, severity, title, detail, version_id)
  VALUES (v_fp, p_kind, p_severity, p_title, COALESCE(p_detail,'{}'::jsonb), p_version_id)
  ON CONFLICT (fingerprint) DO UPDATE
     SET occurrences = public.nav_drift_alerts.occurrences + 1,
         last_seen_at = now(),
         severity = EXCLUDED.severity,
         detail = EXCLUDED.detail,
         status = CASE WHEN public.nav_drift_alerts.status = 'resolved' THEN 'open' ELSE public.nav_drift_alerts.status END,
         resolved_at = CASE WHEN public.nav_drift_alerts.status = 'resolved' THEN NULL ELSE public.nav_drift_alerts.resolved_at END
  RETURNING id, (occurrences = 1) INTO v_id, v_created;

  RETURN jsonb_build_object('ok', true, 'alert_id', v_id, 'created', v_created);
END; $$;

CREATE OR REPLACE FUNCTION public.nav_drift_triage(p_alert_id uuid, p_status text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.nav_registry_can_author(auth.uid()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_status NOT IN ('acknowledged','resolved','open') THEN RAISE EXCEPTION 'invalid status %', p_status; END IF;
  UPDATE public.nav_drift_alerts
     SET status = p_status,
         acknowledged_by = CASE WHEN p_status = 'acknowledged' THEN auth.uid() ELSE acknowledged_by END,
         acknowledged_at = CASE WHEN p_status = 'acknowledged' THEN now() ELSE acknowledged_at END,
         resolved_at = CASE WHEN p_status = 'resolved' THEN now() ELSE NULL END,
         detail = detail || jsonb_build_object('triage_note', p_note)
   WHERE id = p_alert_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found: alert'; END IF;
  RETURN jsonb_build_object('ok', true, 'status', p_status);
END; $$;

CREATE OR REPLACE FUNCTION public.nav_drift_mark_notified(p_alert_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_platform_admin() THEN RAISE EXCEPTION 'not_authorized'; END IF;
  UPDATE public.nav_drift_alerts SET notified_at = now() WHERE id = ANY(p_alert_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;

-- Staged (canary) publishing --------------------------------------------
CREATE OR REPLACE FUNCTION public.nav_registry_publish_canary(
  p_version_id uuid, p_roles text[] DEFAULT '{}'::text[],
  p_user_ids uuid[] DEFAULT '{}'::uuid[], p_percent integer DEFAULT 100
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_from text; v_passed boolean;
BEGIN
  IF NOT public.nav_registry_can_approve(auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized: staged publishing requires super admin';
  END IF;
  SELECT status, validation_passed INTO v_from, v_passed FROM public.nav_registry_versions WHERE id = p_version_id;
  IF v_from IS NULL THEN RAISE EXCEPTION 'not_found: version'; END IF;
  IF v_from NOT IN ('approved','canary') THEN RAISE EXCEPTION 'invalid_transition: only an approved version can enter canary'; END IF;
  IF NOT COALESCE(v_passed, false) THEN RAISE EXCEPTION 'validation_failed: integrity gates must pass before staged rollout'; END IF;
  IF COALESCE(array_length(p_roles,1),0) = 0 AND COALESCE(array_length(p_user_ids,1),0) = 0 THEN
    RAISE EXCEPTION 'validation_failed: a canary needs at least one role or user in the cohort';
  END IF;

  UPDATE public.nav_registry_versions
     SET status = 'canary', rollout_mode = 'canary', rollout_roles = COALESCE(p_roles,'{}'),
         rollout_user_ids = COALESCE(p_user_ids,'{}'), rollout_percent = LEAST(GREATEST(COALESCE(p_percent,100),1),100),
         canary_started_at = COALESCE(canary_started_at, now()), canary_ended_at = NULL, updated_at = now()
   WHERE id = p_version_id;

  PERFORM public.nav_registry_log(p_version_id, 'canary_started', v_from, 'canary',
    jsonb_build_object('roles', p_roles, 'user_ids', p_user_ids, 'percent', p_percent));
  RETURN jsonb_build_object('ok', true, 'status', 'canary');
END; $$;

CREATE OR REPLACE FUNCTION public.nav_registry_promote_canary(p_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  IF NOT public.nav_registry_can_approve(auth.uid()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT status INTO v_status FROM public.nav_registry_versions WHERE id = p_version_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'not_found: version'; END IF;
  IF v_status <> 'canary' THEN RAISE EXCEPTION 'invalid_transition: version is not in canary'; END IF;
  IF EXISTS (SELECT 1 FROM public.nav_drift_alerts
              WHERE version_id = p_version_id AND severity = 'critical' AND status = 'open') THEN
    RAISE EXCEPTION 'blocked: unresolved critical drift alerts on this canary';
  END IF;

  UPDATE public.nav_registry_versions
     SET status = 'approved', rollout_mode = 'full', rollout_percent = 100,
         canary_ended_at = now(), updated_at = now()
   WHERE id = p_version_id;
  PERFORM public.nav_registry_log(p_version_id, 'canary_promoted', 'canary', 'approved', '{}'::jsonb);
  PERFORM public.nav_registry_publish(p_version_id);
  RETURN jsonb_build_object('ok', true, 'status', 'published');
END; $$;

CREATE OR REPLACE FUNCTION public.nav_registry_abort_canary(p_version_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text;
BEGIN
  IF NOT public.nav_registry_can_approve(auth.uid()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN RAISE EXCEPTION 'validation_failed: abort reason required'; END IF;
  SELECT status INTO v_status FROM public.nav_registry_versions WHERE id = p_version_id;
  IF v_status <> 'canary' THEN RAISE EXCEPTION 'invalid_transition: version is not in canary'; END IF;

  UPDATE public.nav_registry_versions
     SET status = 'approved', rollout_mode = 'full', rollout_roles = '{}', rollout_user_ids = '{}',
         rollout_percent = 100, canary_ended_at = now(), updated_at = now()
   WHERE id = p_version_id;
  PERFORM public.nav_registry_log(p_version_id, 'canary_aborted', 'canary', 'approved',
    jsonb_build_object('reason', p_reason));
  RETURN jsonb_build_object('ok', true, 'status', 'approved');
END; $$;

-- Version diff -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nav_registry_diff(p_base_id uuid, p_target_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_base jsonb; v_target jsonb; v_out jsonb := '{}'::jsonb;
  v_section text; v_sections text[] := ARRAY['routes','capabilities','rbac','navigation'];
  v_added jsonb; v_removed jsonb; v_changed jsonb;
BEGIN
  IF NOT public.nav_registry_can_author(auth.uid()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT snapshot INTO v_base FROM public.nav_registry_versions WHERE id = p_base_id;
  SELECT snapshot INTO v_target FROM public.nav_registry_versions WHERE id = p_target_id;
  IF v_base IS NULL OR v_target IS NULL THEN RAISE EXCEPTION 'not_found: version snapshot'; END IF;

  FOREACH v_section IN ARRAY v_sections LOOP
    WITH b AS (
      SELECT key, value FROM jsonb_each(COALESCE(v_base->v_section, '{}'::jsonb))
       WHERE jsonb_typeof(COALESCE(v_base->v_section, '{}'::jsonb)) = 'object'
    ), t AS (
      SELECT key, value FROM jsonb_each(COALESCE(v_target->v_section, '{}'::jsonb))
       WHERE jsonb_typeof(COALESCE(v_target->v_section, '{}'::jsonb)) = 'object'
    )
    SELECT
      COALESCE((SELECT jsonb_agg(jsonb_build_object('key', t.key, 'value', t.value) ORDER BY t.key)
                  FROM t LEFT JOIN b ON b.key = t.key WHERE b.key IS NULL), '[]'::jsonb),
      COALESCE((SELECT jsonb_agg(jsonb_build_object('key', b.key, 'value', b.value) ORDER BY b.key)
                  FROM b LEFT JOIN t ON t.key = b.key WHERE t.key IS NULL), '[]'::jsonb),
      COALESCE((SELECT jsonb_agg(jsonb_build_object('key', b.key, 'before', b.value, 'after', t.value) ORDER BY b.key)
                  FROM b JOIN t ON t.key = b.key WHERE b.value <> t.value), '[]'::jsonb)
    INTO v_added, v_removed, v_changed;

    v_out := v_out || jsonb_build_object(v_section, jsonb_build_object(
      'added', v_added, 'removed', v_removed, 'changed', v_changed,
      'added_count', jsonb_array_length(v_added),
      'removed_count', jsonb_array_length(v_removed),
      'changed_count', jsonb_array_length(v_changed)));
  END LOOP;

  RETURN jsonb_build_object(
    'base', (SELECT jsonb_build_object('id', id, 'version', version, 'title', title, 'status', status, 'hash', snapshot_hash)
               FROM public.nav_registry_versions WHERE id = p_base_id),
    'target', (SELECT jsonb_build_object('id', id, 'version', version, 'title', title, 'status', status, 'hash', snapshot_hash)
               FROM public.nav_registry_versions WHERE id = p_target_id),
    'sections', v_out);
END; $$;

-- Audit search / export --------------------------------------------------
CREATE OR REPLACE FUNCTION public.nav_registry_audit_search(
  p_action text DEFAULT NULL, p_version_id uuid DEFAULT NULL,
  p_actor uuid DEFAULT NULL, p_from timestamptz DEFAULT NULL, p_to timestamptz DEFAULT NULL,
  p_search text DEFAULT NULL, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rows jsonb; v_total integer;
BEGIN
  IF NOT public.nav_registry_can_author(auth.uid()) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  WITH base AS (
    SELECT a.id, a.version_id, v.version, v.title, v.status AS version_status,
           a.action, a.from_status, a.to_status, a.actor, a.detail, a.created_at
      FROM public.nav_registry_audit a
      LEFT JOIN public.nav_registry_versions v ON v.id = a.version_id
     WHERE (p_action IS NULL OR a.action = p_action)
       AND (p_version_id IS NULL OR a.version_id = p_version_id)
       AND (p_actor IS NULL OR a.actor = p_actor)
       AND (p_from IS NULL OR a.created_at >= p_from)
       AND (p_to IS NULL OR a.created_at <= p_to)
       AND (p_search IS NULL OR p_search = ''
            OR a.action ILIKE '%'||p_search||'%'
            OR COALESCE(v.title,'') ILIKE '%'||p_search||'%'
            OR a.detail::text ILIKE '%'||p_search||'%')
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC), '[]'::jsonb), (SELECT count(*) FROM base)
    INTO v_rows, v_total
    FROM (SELECT * FROM base ORDER BY created_at DESC
           LIMIT GREATEST(1, LEAST(COALESCE(p_limit,100), 1000)) OFFSET GREATEST(COALESCE(p_offset,0),0)) x;

  RETURN jsonb_build_object('rows', v_rows, 'total', v_total,
    'actions', (SELECT COALESCE(jsonb_agg(DISTINCT action), '[]'::jsonb) FROM public.nav_registry_audit));
END; $$;

-- Versioned snapshot resolution (portal fetch + canary cohort) ----------
CREATE OR REPLACE FUNCTION public.nav_snapshot_active(p_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_row record; v_canary record;
BEGIN
  v_uid := COALESCE(p_user_id, auth.uid());
  SELECT * INTO v_row FROM public.nav_registry_versions WHERE is_active ORDER BY version DESC LIMIT 1;

  IF v_uid IS NOT NULL THEN
    SELECT * INTO v_canary FROM public.nav_registry_versions
     WHERE status = 'canary'
       AND (v_uid = ANY(rollout_user_ids)
            OR EXISTS (SELECT 1 FROM public.user_roles ur
                        WHERE ur.user_id = v_uid AND ur.role::text = ANY(rollout_roles)))
       AND (abs(hashtext(v_uid::text || snapshot_hash)) % 100) < rollout_percent
     ORDER BY version DESC LIMIT 1;
    IF v_canary.id IS NOT NULL THEN v_row := v_canary; END IF;
  END IF;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_active_navigation_version');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'version_id', v_row.id, 'version', v_row.version, 'title', v_row.title,
    'status', v_row.status, 'rollout_mode', v_row.rollout_mode,
    'snapshot_hash', v_row.snapshot_hash,
    'published_at', COALESCE(v_row.published_at, v_row.canary_started_at, v_row.created_at),
    'is_canary', v_row.status = 'canary',
    'snapshot', v_row.snapshot);
END; $$;