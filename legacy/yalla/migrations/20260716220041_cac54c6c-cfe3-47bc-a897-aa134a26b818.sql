
-- 1. Alert settings per severity
CREATE TABLE IF NOT EXISTS public.paf_alert_settings (
  severity text PRIMARY KEY CHECK (severity IN ('critical','high','medium','low')),
  slack_webhook_url text,
  email_recipients text[] NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.paf_alert_settings TO authenticated;
GRANT ALL ON public.paf_alert_settings TO service_role;
ALTER TABLE public.paf_alert_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage alert settings" ON public.paf_alert_settings;
CREATE POLICY "admins manage alert settings" ON public.paf_alert_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- seed defaults
INSERT INTO public.paf_alert_settings(severity) VALUES ('critical'),('high'),('medium'),('low')
  ON CONFLICT (severity) DO NOTHING;

-- 2. Idempotency + batch on applications
ALTER TABLE public.paf_remediation_applications
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS batch_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS paf_rem_app_idem_key
  ON public.paf_remediation_applications(approval_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS paf_rem_app_batch_id ON public.paf_remediation_applications(batch_id);
CREATE INDEX IF NOT EXISTS paf_exception_events_created ON public.paf_exception_events(created_at DESC);

-- 3. Replace apply RPC with idempotency
CREATE OR REPLACE FUNCTION public.paf_apply_remediation(
  _approval_id uuid, _confirmation text, _notes text DEFAULT NULL,
  _rollback_sql text DEFAULT NULL, _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_approval public.paf_remediation_approvals%ROWTYPE;
  v_uid uuid := auth.uid();
  v_existing public.paf_remediation_applications%ROWTYPE;
  v_err text; v_rows integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  IF NOT (public.has_role(v_uid,'admin') OR public.has_role(v_uid,'super_admin')) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE='42501'; END IF;
  IF _confirmation IS DISTINCT FROM 'APPLY' THEN
    RAISE EXCEPTION 'confirmation text must equal APPLY' USING ERRCODE='22023'; END IF;

  -- Idempotency: return prior result if same key reused for this approval
  IF _idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.paf_remediation_applications
      WHERE approval_id = _approval_id AND idempotency_key = _idempotency_key LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', v_existing.status = 'success',
        'idempotent_replay', true, 'application_id', v_existing.id,
        'rows_affected', v_existing.rows_affected, 'error', v_existing.error_message);
    END IF;
  END IF;

  SELECT * INTO v_approval FROM public.paf_remediation_approvals WHERE id = _approval_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'approval % not found', _approval_id USING ERRCODE='P0002'; END IF;
  IF v_approval.decision <> 'approved' THEN
    RAISE EXCEPTION 'remediation not approved (decision=%)', v_approval.decision USING ERRCODE='42501'; END IF;

  BEGIN
    EXECUTE v_approval.sql_text;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    INSERT INTO public.paf_remediation_applications(
      approval_id, run_id, resource, severity, sql_text, sql_hash,
      applied_by, status, rows_affected, confirmation_text, rollback_sql, notes, idempotency_key
    ) VALUES (v_approval.id, v_approval.run_id, v_approval.resource, v_approval.severity,
      v_approval.sql_text, v_approval.sql_hash, v_uid, 'success', v_rows,
      _confirmation, _rollback_sql, _notes, _idempotency_key);
    RETURN jsonb_build_object('ok', true, 'rows_affected', v_rows);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    INSERT INTO public.paf_remediation_applications(
      approval_id, run_id, resource, severity, sql_text, sql_hash,
      applied_by, status, error_message, confirmation_text, rollback_sql, notes, idempotency_key
    ) VALUES (v_approval.id, v_approval.run_id, v_approval.resource, v_approval.severity,
      v_approval.sql_text, v_approval.sql_hash, v_uid, 'failed', v_err,
      _confirmation, _rollback_sql, _notes, _idempotency_key);
    RETURN jsonb_build_object('ok', false, 'error', v_err);
  END;
END; $$;

-- 4. Bulk apply in one transaction with grouped audit
CREATE OR REPLACE FUNCTION public.paf_apply_remediations_bulk(
  _approval_ids uuid[], _confirmation text, _notes text DEFAULT NULL,
  _idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_batch uuid := gen_random_uuid();
  v_approval public.paf_remediation_approvals%ROWTYPE;
  v_id uuid; v_rows integer; v_total integer := 0;
  v_success integer := 0; v_failed integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_existing_batch uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  IF NOT (public.has_role(v_uid,'admin') OR public.has_role(v_uid,'super_admin')) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE='42501'; END IF;
  IF _confirmation IS DISTINCT FROM 'APPLY' THEN
    RAISE EXCEPTION 'confirmation text must equal APPLY' USING ERRCODE='22023'; END IF;
  IF _approval_ids IS NULL OR array_length(_approval_ids,1) IS NULL THEN
    RAISE EXCEPTION 'no approvals provided'; END IF;

  -- Idempotency across the whole batch
  IF _idempotency_key IS NOT NULL THEN
    SELECT batch_id INTO v_existing_batch FROM public.paf_remediation_applications
      WHERE idempotency_key = _idempotency_key AND batch_id IS NOT NULL LIMIT 1;
    IF v_existing_batch IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'idempotent_replay', true, 'batch_id', v_existing_batch);
    END IF;
  END IF;

  FOREACH v_id IN ARRAY _approval_ids LOOP
    v_total := v_total + 1;
    SELECT * INTO v_approval FROM public.paf_remediation_approvals WHERE id = v_id;
    IF NOT FOUND OR v_approval.decision <> 'approved' THEN
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_object('approval_id', v_id, 'ok', false, 'error', 'not approved or missing');
      CONTINUE;
    END IF;
    BEGIN
      EXECUTE v_approval.sql_text;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      INSERT INTO public.paf_remediation_applications(
        approval_id, run_id, resource, severity, sql_text, sql_hash,
        applied_by, status, rows_affected, confirmation_text, notes, idempotency_key, batch_id
      ) VALUES (v_approval.id, v_approval.run_id, v_approval.resource, v_approval.severity,
        v_approval.sql_text, v_approval.sql_hash, v_uid, 'success', v_rows,
        _confirmation, _notes, _idempotency_key, v_batch);
      v_success := v_success + 1;
      v_results := v_results || jsonb_build_object('approval_id', v_id, 'ok', true, 'rows', v_rows);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.paf_remediation_applications(
        approval_id, run_id, resource, severity, sql_text, sql_hash,
        applied_by, status, error_message, confirmation_text, notes, idempotency_key, batch_id
      ) VALUES (v_approval.id, v_approval.run_id, v_approval.resource, v_approval.severity,
        v_approval.sql_text, v_approval.sql_hash, v_uid, 'failed', SQLERRM,
        _confirmation, _notes, _idempotency_key, v_batch);
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_object('approval_id', v_id, 'ok', false, 'error', SQLERRM);
    END;
  END LOOP;

  -- Grouped audit entry
  INSERT INTO public.admin_audit_log(action, actor_id, entity_type, entity_id, metadata)
  VALUES ('paf_bulk_apply', v_uid, 'paf_remediation_batch', v_batch,
    jsonb_build_object('total', v_total, 'success', v_success, 'failed', v_failed,
      'idempotency_key', _idempotency_key, 'notes', _notes, 'results', v_results));

  RETURN jsonb_build_object('ok', v_failed = 0, 'batch_id', v_batch,
    'total', v_total, 'success', v_success, 'failed', v_failed, 'results', v_results);
END; $$;

GRANT EXECUTE ON FUNCTION public.paf_apply_remediation(uuid,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.paf_apply_remediations_bulk(uuid[],text,text,text) TO authenticated;
