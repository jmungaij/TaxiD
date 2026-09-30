
-- 1. Exception audit trail
CREATE TABLE public.paf_exception_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_id uuid NOT NULL REFERENCES public.paf_exceptions(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('submitted','approved','rejected','revoked','expired','edited')),
  actor_id uuid REFERENCES auth.users(id),
  reason text,
  previous_status text,
  new_status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.paf_exception_events TO authenticated;
GRANT ALL ON public.paf_exception_events TO service_role;
ALTER TABLE public.paf_exception_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read exception events" ON public.paf_exception_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can insert exception events" ON public.paf_exception_events
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE INDEX idx_paf_exception_events_exception ON public.paf_exception_events(exception_id, created_at DESC);

-- 2. Trigger — auto log status changes
CREATE OR REPLACE FUNCTION public.paf_log_exception_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.paf_exception_events(exception_id, action, actor_id, reason, new_status, metadata)
    VALUES (NEW.id, 'submitted', NEW.requested_by, NEW.justification, NEW.status, jsonb_build_object('resource', NEW.resource, 'category', NEW.category));
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.paf_exception_events(exception_id, action, actor_id, reason, previous_status, new_status, metadata)
    VALUES (
      NEW.id,
      CASE NEW.status WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected'
                     WHEN 'revoked'  THEN 'revoked'  WHEN 'expired'  THEN 'expired' ELSE 'edited' END,
      COALESCE(NEW.approved_by, auth.uid()),
      NEW.notes,
      OLD.status, NEW.status,
      jsonb_build_object('resource', NEW.resource, 'category', NEW.category)
    );
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_paf_log_exception_change ON public.paf_exceptions;
CREATE TRIGGER trg_paf_log_exception_change
  AFTER INSERT OR UPDATE ON public.paf_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.paf_log_exception_change();

-- Back-fill submitted events for existing rows
INSERT INTO public.paf_exception_events(exception_id, action, actor_id, reason, new_status, created_at, metadata)
SELECT id, 'submitted', requested_by, justification, status, created_at,
       jsonb_build_object('resource', resource, 'category', category, 'backfilled', true)
FROM public.paf_exceptions e
WHERE NOT EXISTS (SELECT 1 FROM public.paf_exception_events x WHERE x.exception_id = e.id);

-- 3. Remediation application log
CREATE TABLE public.paf_remediation_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id uuid NOT NULL REFERENCES public.paf_remediation_approvals(id) ON DELETE CASCADE,
  run_id uuid,
  resource text NOT NULL,
  severity text NOT NULL,
  sql_text text NOT NULL,
  sql_hash text NOT NULL,
  applied_by uuid REFERENCES auth.users(id),
  applied_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('success','failed','rolled_back')),
  error_message text,
  rows_affected integer,
  confirmation_text text,
  rollback_sql text,
  notes text
);
GRANT SELECT, INSERT ON public.paf_remediation_applications TO authenticated;
GRANT ALL ON public.paf_remediation_applications TO service_role;
ALTER TABLE public.paf_remediation_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read remediation applications" ON public.paf_remediation_applications
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Admins can insert remediation applications" ON public.paf_remediation_applications
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE INDEX idx_paf_rem_apps_approval ON public.paf_remediation_applications(approval_id, applied_at DESC);

-- 4. Controlled apply function — only executes SQL from an approved row
CREATE OR REPLACE FUNCTION public.paf_apply_remediation(
  _approval_id uuid,
  _confirmation text,
  _notes text DEFAULT NULL,
  _rollback_sql text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_approval public.paf_remediation_approvals%ROWTYPE;
  v_uid uuid := auth.uid();
  v_err text;
  v_rows integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '28000';
  END IF;
  IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'super_admin')) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_approval FROM public.paf_remediation_approvals WHERE id = _approval_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval % not found', _approval_id USING ERRCODE = 'P0002';
  END IF;
  IF v_approval.decision <> 'approved' THEN
    RAISE EXCEPTION 'remediation not approved (decision=%)', v_approval.decision USING ERRCODE = '42501';
  END IF;
  IF _confirmation IS DISTINCT FROM 'APPLY' THEN
    RAISE EXCEPTION 'confirmation text must equal APPLY' USING ERRCODE = '22023';
  END IF;

  BEGIN
    EXECUTE v_approval.sql_text;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    INSERT INTO public.paf_remediation_applications(
      approval_id, run_id, resource, severity, sql_text, sql_hash,
      applied_by, status, rows_affected, confirmation_text, rollback_sql, notes
    ) VALUES (
      v_approval.id, v_approval.run_id, v_approval.resource, v_approval.severity,
      v_approval.sql_text, v_approval.sql_hash,
      v_uid, 'success', v_rows, _confirmation, _rollback_sql, _notes
    );
    RETURN jsonb_build_object('ok', true, 'rows_affected', v_rows);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    INSERT INTO public.paf_remediation_applications(
      approval_id, run_id, resource, severity, sql_text, sql_hash,
      applied_by, status, error_message, confirmation_text, rollback_sql, notes
    ) VALUES (
      v_approval.id, v_approval.run_id, v_approval.resource, v_approval.severity,
      v_approval.sql_text, v_approval.sql_hash,
      v_uid, 'failed', v_err, _confirmation, _rollback_sql, _notes
    );
    RETURN jsonb_build_object('ok', false, 'error', v_err);
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.paf_apply_remediation(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.paf_apply_remediation(uuid, text, text, text) TO authenticated;

-- Rollback helper — executes stored rollback_sql on a prior successful application
CREATE OR REPLACE FUNCTION public.paf_rollback_remediation(
  _application_id uuid,
  _confirmation text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.paf_remediation_applications%ROWTYPE;
  v_uid uuid := auth.uid();
  v_err text;
  v_rows integer := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='28000'; END IF;
  IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'super_admin')) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE='42501';
  END IF;
  IF _confirmation IS DISTINCT FROM 'ROLLBACK' THEN
    RAISE EXCEPTION 'confirmation text must equal ROLLBACK' USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_app FROM public.paf_remediation_applications WHERE id = _application_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'application % not found', _application_id USING ERRCODE='P0002'; END IF;
  IF v_app.status <> 'success' THEN RAISE EXCEPTION 'only successful applications can be rolled back'; END IF;
  IF v_app.rollback_sql IS NULL OR btrim(v_app.rollback_sql) = '' THEN
    RAISE EXCEPTION 'no rollback SQL stored on this application';
  END IF;

  BEGIN
    EXECUTE v_app.rollback_sql;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    UPDATE public.paf_remediation_applications SET status = 'rolled_back' WHERE id = _application_id;
    INSERT INTO public.paf_remediation_applications(
      approval_id, run_id, resource, severity, sql_text, sql_hash,
      applied_by, status, rows_affected, confirmation_text, notes
    ) VALUES (
      v_app.approval_id, v_app.run_id, v_app.resource, v_app.severity,
      v_app.rollback_sql, v_app.sql_hash,
      v_uid, 'success', v_rows, _confirmation, 'rollback of ' || v_app.id::text
    );
    RETURN jsonb_build_object('ok', true, 'rows_affected', v_rows);
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    RETURN jsonb_build_object('ok', false, 'error', v_err);
  END;
END;
$$;
REVOKE ALL ON FUNCTION public.paf_rollback_remediation(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.paf_rollback_remediation(uuid, text) TO authenticated;
