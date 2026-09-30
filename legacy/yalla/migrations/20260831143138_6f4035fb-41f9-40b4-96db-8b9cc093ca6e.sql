CREATE TABLE public.legal_compliance_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_stage text NOT NULL,
  requirement_code text NOT NULL,
  reason_code text NOT NULL,
  decision text NOT NULL,
  title text NOT NULL,
  detail text,
  service_family text,
  required_action text,
  owner_role text NOT NULL DEFAULT 'legal_counsel',
  severity text NOT NULL DEFAULT 'high',
  status text NOT NULL DEFAULT 'open',
  occurrences integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_transaction_ref text,
  last_correlation_id text,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  acknowledgement_note text,
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_compliance_alerts_status_chk
    CHECK (status IN ('open','acknowledged','resolved')),
  CONSTRAINT legal_compliance_alerts_severity_chk
    CHECK (severity IN ('low','medium','high','critical'))
);

CREATE UNIQUE INDEX legal_compliance_alerts_open_key
  ON public.legal_compliance_alerts (gate_stage, requirement_code, reason_code)
  WHERE status <> 'resolved';

CREATE INDEX legal_compliance_alerts_status_idx
  ON public.legal_compliance_alerts (status, last_seen_at DESC);

GRANT SELECT, UPDATE ON public.legal_compliance_alerts TO authenticated;
GRANT ALL ON public.legal_compliance_alerts TO service_role;

ALTER TABLE public.legal_compliance_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY legal_alerts_read ON public.legal_compliance_alerts
  FOR SELECT TO authenticated
  USING (
    public.has_staff_permission('staff.legal.read')
    OR public.has_staff_permission('staff.logistics.read')
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE POLICY legal_alerts_triage ON public.legal_compliance_alerts
  FOR UPDATE TO authenticated
  USING (
    public.has_staff_permission('staff.legal.manage')
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  )
  WITH CHECK (
    public.has_staff_permission('staff.legal.manage')
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

CREATE OR REPLACE FUNCTION public._legal_compliance_alerts_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER legal_compliance_alerts_touch
  BEFORE UPDATE ON public.legal_compliance_alerts
  FOR EACH ROW EXECUTE FUNCTION public._legal_compliance_alerts_touch();

-- Raise (or coalesce into) a non-blocking legal compliance alert. Called by the
-- booking/dispatch services when a transaction proceeds while a legal control is
-- unresolved. Never approves anything; only asks a human to decide.
CREATE OR REPLACE FUNCTION public.legal_raise_compliance_alert(
  _gate_stage text,
  _requirement_code text,
  _reason_code text,
  _decision text,
  _title text,
  _detail text DEFAULT NULL,
  _required_action text DEFAULT NULL,
  _owner_role text DEFAULT 'legal_counsel',
  _service_family text DEFAULT NULL,
  _transaction_ref text DEFAULT NULL,
  _correlation_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_created boolean := false;
  r record;
BEGIN
  INSERT INTO public.legal_compliance_alerts (
    gate_stage, requirement_code, reason_code, decision, title, detail,
    service_family, required_action, owner_role,
    severity, last_transaction_ref, last_correlation_id)
  VALUES (
    _gate_stage, _requirement_code, _reason_code, _decision, _title, _detail,
    _service_family, _required_action, COALESCE(_owner_role, 'legal_counsel'),
    CASE WHEN _decision = 'BLOCKED' THEN 'critical' ELSE 'high' END,
    _transaction_ref, _correlation_id)
  ON CONFLICT (gate_stage, requirement_code, reason_code)
    WHERE status <> 'resolved'
  DO UPDATE SET
    occurrences = public.legal_compliance_alerts.occurrences + 1,
    last_seen_at = now(),
    last_transaction_ref = COALESCE(EXCLUDED.last_transaction_ref, public.legal_compliance_alerts.last_transaction_ref),
    last_correlation_id = COALESCE(EXCLUDED.last_correlation_id, public.legal_compliance_alerts.last_correlation_id),
    detail = COALESCE(EXCLUDED.detail, public.legal_compliance_alerts.detail)
  RETURNING id, (xmax = 0) INTO v_id, v_created;

  IF NOT v_created THEN
    RETURN v_id;
  END IF;

  -- First occurrence only: one in-app notice per mapped stakeholder.
  FOR r IN
    SELECT ur.user_id
      FROM public.lg_approver_role_map m
      JOIN public.user_roles ur ON ur.role::text = m.role
     WHERE m.allowed AND m.notify
       AND (m.control_id IS NULL OR m.control_id = _requirement_code)
     GROUP BY ur.user_id
  LOOP
    INSERT INTO public.staff_notifications (
      recipient_user_id, kind, title, body, source_of_record, source_record_id)
    VALUES (
      r.user_id,
      'decision_requested',
      format('Legal compliance check required — %s (%s)', _requirement_code, _gate_stage),
      format(
        '%s Transactions are NOT blocked: %s traffic continues to completion by business decision. %s Decide the compliance level and record the determination — this alert is not an approval.',
        COALESCE(_detail, _title),
        _gate_stage,
        COALESCE('Required action: ' || _required_action || '.', '')),
      'legal_compliance_alerts', v_id);
  END LOOP;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.legal_raise_compliance_alert(
  text, text, text, text, text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.legal_raise_compliance_alert(
  text, text, text, text, text, text, text, text, text, text, text) TO service_role;

-- Acknowledge or resolve an alert with a written note (four-eyes friendly: the
-- note is mandatory and the actor is recorded).
CREATE OR REPLACE FUNCTION public.legal_triage_compliance_alert(
  _alert_id uuid,
  _action text,
  _note text
)
RETURNS public.legal_compliance_alerts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.legal_compliance_alerts;
BEGIN
  IF NOT (
    public.has_staff_permission('staff.legal.manage')
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'not authorised to triage legal compliance alerts';
  END IF;

  IF _action NOT IN ('acknowledge','resolve') THEN
    RAISE EXCEPTION 'unsupported action %', _action;
  END IF;

  IF _note IS NULL OR length(btrim(_note)) < 20 THEN
    RAISE EXCEPTION 'a written basis of at least 20 characters is required';
  END IF;

  IF _action = 'acknowledge' THEN
    UPDATE public.legal_compliance_alerts
       SET status = 'acknowledged',
           acknowledged_at = now(),
           acknowledged_by = auth.uid(),
           acknowledgement_note = btrim(_note)
     WHERE id = _alert_id AND status = 'open'
     RETURNING * INTO v_row;
  ELSE
    UPDATE public.legal_compliance_alerts
       SET status = 'resolved',
           resolved_at = now(),
           resolved_by = auth.uid(),
           resolution_note = btrim(_note)
     WHERE id = _alert_id AND status <> 'resolved'
     RETURNING * INTO v_row;
  END IF;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'alert not found or not in a triageable state';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.legal_triage_compliance_alert(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.legal_triage_compliance_alert(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.legal_triage_compliance_alert(uuid, text, text) TO service_role;