-- ============ enums ============
DO $$ BEGIN
  CREATE TYPE public.readiness_evidence_state AS ENUM (
    'MISSING','EVIDENCE_SUBMITTED','PENDING_APPROVAL','APPROVED','REJECTED','REVISION_REQUESTED','EXPIRED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.readiness_remediation_class AS ENUM (
    'BUILDABLE','CONFIGURABLE','INTEGRATABLE','TESTABLE','EVIDENCE_REQUIRED',
    'HUMAN_APPROVAL_REQUIRED','EXTERNAL_INFRASTRUCTURE_REQUIRED','LEGAL_DETERMINATION_REQUIRED',
    'BUSINESS_TARGET_REQUIRED','GENUINE_FAILURE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ evidence register ============
CREATE TABLE IF NOT EXISTS public.logistics_readiness_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_id text NOT NULL UNIQUE,
  remediation_class public.readiness_remediation_class NOT NULL,
  workflow_state public.readiness_evidence_state NOT NULL DEFAULT 'MISSING',
  owner_role text,
  approver_email text,
  evidence_ref text,
  document_path text,
  issuing_authority text,
  jurisdiction text,
  effective_at timestamptz,
  expiry_at timestamptz,
  declaration boolean NOT NULL DEFAULT false,
  comments text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_by uuid,
  submitted_at timestamptz,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.logistics_readiness_evidence TO authenticated;
GRANT ALL ON public.logistics_readiness_evidence TO service_role;
ALTER TABLE public.logistics_readiness_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "logistics staff read readiness evidence"
ON public.logistics_readiness_evidence FOR SELECT TO authenticated
USING (public.has_staff_permission('staff.logistics.read'));

-- ============ append-only audit ============
CREATE TABLE IF NOT EXISTS public.logistics_readiness_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_id text NOT NULL,
  action text NOT NULL,
  from_state public.readiness_evidence_state,
  to_state public.readiness_evidence_state,
  actor uuid,
  actor_email text,
  comments text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.logistics_readiness_audit TO authenticated;
GRANT ALL ON public.logistics_readiness_audit TO service_role;
ALTER TABLE public.logistics_readiness_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "logistics staff read readiness audit"
ON public.logistics_readiness_audit FOR SELECT TO authenticated
USING (public.has_staff_permission('staff.logistics.read'));

CREATE OR REPLACE FUNCTION public._logistics_readiness_audit_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'logistics_readiness_audit is append-only';
END; $$;

DROP TRIGGER IF EXISTS logistics_readiness_audit_immutable ON public.logistics_readiness_audit;
CREATE TRIGGER logistics_readiness_audit_immutable
BEFORE UPDATE OR DELETE ON public.logistics_readiness_audit
FOR EACH ROW EXECUTE FUNCTION public._logistics_readiness_audit_immutable();

-- ============ controlled pilot runs ============
CREATE TABLE IF NOT EXISTS public.logistics_pilot_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id text NOT NULL,
  expected_outcome text NOT NULL,
  observed_outcome text NOT NULL,
  result text NOT NULL CHECK (result IN ('PASS','FAIL')),
  evidence_ref text NOT NULL,
  environment text NOT NULL DEFAULT 'isolated_staging',
  executed_by uuid,
  executed_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logistics_pilot_runs_scenario_idx
  ON public.logistics_pilot_runs (scenario_id, executed_at DESC);

GRANT SELECT ON public.logistics_pilot_runs TO authenticated;
GRANT ALL ON public.logistics_pilot_runs TO service_role;
ALTER TABLE public.logistics_pilot_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "logistics staff read pilot runs"
ON public.logistics_pilot_runs FOR SELECT TO authenticated
USING (public.has_staff_permission('staff.logistics.read'));

-- ============ isolated environment register ============
CREATE TABLE IF NOT EXISTS public.logistics_infra_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_role text NOT NULL CHECK (target_role IN ('staging','restore')),
  label text NOT NULL,
  endpoint_ref text NOT NULL,
  synthetic_fixtures_loaded boolean NOT NULL DEFAULT false,
  isolation_verified boolean NOT NULL DEFAULT false,
  verified_by uuid,
  verified_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_role)
);

GRANT SELECT ON public.logistics_infra_targets TO authenticated;
GRANT ALL ON public.logistics_infra_targets TO service_role;
ALTER TABLE public.logistics_infra_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "logistics staff read infra targets"
ON public.logistics_infra_targets FOR SELECT TO authenticated
USING (public.has_staff_permission('staff.logistics.read'));

-- ============ touch trigger ============
CREATE OR REPLACE FUNCTION public._touch_logistics_readiness()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS touch_logistics_readiness_evidence ON public.logistics_readiness_evidence;
CREATE TRIGGER touch_logistics_readiness_evidence
BEFORE UPDATE ON public.logistics_readiness_evidence
FOR EACH ROW EXECUTE FUNCTION public._touch_logistics_readiness();

DROP TRIGGER IF EXISTS touch_logistics_infra_targets ON public.logistics_infra_targets;
CREATE TRIGGER touch_logistics_infra_targets
BEFORE UPDATE ON public.logistics_infra_targets
FOR EACH ROW EXECUTE FUNCTION public._touch_logistics_readiness();

-- ============ RPCs (the only write path) ============
CREATE OR REPLACE FUNCTION public.logistics_readiness_submit_evidence(
  p_control_id text,
  p_class public.readiness_remediation_class,
  p_evidence_ref text,
  p_approver_email text DEFAULT NULL,
  p_document_path text DEFAULT NULL,
  p_issuing_authority text DEFAULT NULL,
  p_jurisdiction text DEFAULT NULL,
  p_effective_at timestamptz DEFAULT NULL,
  p_expiry_at timestamptz DEFAULT NULL,
  p_owner_role text DEFAULT NULL,
  p_comments text DEFAULT NULL,
  p_declaration boolean DEFAULT false,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS public.logistics_readiness_evidence
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.logistics_readiness_evidence; v_from public.readiness_evidence_state;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.manage') THEN
    RAISE EXCEPTION 'not authorised to submit readiness evidence';
  END IF;
  IF coalesce(btrim(p_evidence_ref), '') = '' THEN
    RAISE EXCEPTION 'an evidence reference is mandatory; a control cannot be cleared without evidence';
  END IF;
  IF p_declaration IS NOT TRUE THEN
    RAISE EXCEPTION 'the submitter declaration is mandatory';
  END IF;

  SELECT workflow_state INTO v_from FROM public.logistics_readiness_evidence WHERE control_id = p_control_id;

  INSERT INTO public.logistics_readiness_evidence AS e (
    control_id, remediation_class, workflow_state, owner_role, approver_email, evidence_ref,
    document_path, issuing_authority, jurisdiction, effective_at, expiry_at, declaration,
    comments, payload, submitted_by, submitted_at, decided_by, decided_at
  ) VALUES (
    p_control_id, p_class, 'PENDING_APPROVAL', p_owner_role, p_approver_email, btrim(p_evidence_ref),
    p_document_path, p_issuing_authority, p_jurisdiction, p_effective_at, p_expiry_at, true,
    p_comments, coalesce(p_payload, '{}'::jsonb), auth.uid(), now(), NULL, NULL
  )
  ON CONFLICT (control_id) DO UPDATE SET
    remediation_class = EXCLUDED.remediation_class,
    workflow_state = 'PENDING_APPROVAL',
    owner_role = EXCLUDED.owner_role,
    approver_email = EXCLUDED.approver_email,
    evidence_ref = EXCLUDED.evidence_ref,
    document_path = EXCLUDED.document_path,
    issuing_authority = EXCLUDED.issuing_authority,
    jurisdiction = EXCLUDED.jurisdiction,
    effective_at = EXCLUDED.effective_at,
    expiry_at = EXCLUDED.expiry_at,
    declaration = true,
    comments = EXCLUDED.comments,
    payload = EXCLUDED.payload,
    submitted_by = auth.uid(),
    submitted_at = now(),
    decided_by = NULL,
    decided_at = NULL
  RETURNING e.* INTO v_row;

  INSERT INTO public.logistics_readiness_audit (control_id, action, from_state, to_state, actor, comments, payload)
  VALUES (p_control_id, 'EVIDENCE_SUBMITTED', v_from, 'PENDING_APPROVAL', auth.uid(), p_comments,
          jsonb_build_object('evidence_ref', btrim(p_evidence_ref), 'class', p_class::text));

  RETURN v_row;
END; $$;

REVOKE ALL ON FUNCTION public.logistics_readiness_submit_evidence(text, public.readiness_remediation_class, text, text, text, text, text, timestamptz, timestamptz, text, text, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_readiness_submit_evidence(text, public.readiness_remediation_class, text, text, text, text, text, timestamptz, timestamptz, text, text, boolean, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.logistics_readiness_decide(
  p_control_id text,
  p_decision text,
  p_comments text DEFAULT NULL
) RETURNS public.logistics_readiness_evidence
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.logistics_readiness_evidence; v_to public.readiness_evidence_state;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.manage') THEN
    RAISE EXCEPTION 'not authorised to decide readiness evidence';
  END IF;
  IF p_decision NOT IN ('APPROVE','REJECT','REQUEST_REVISION') THEN
    RAISE EXCEPTION 'invalid decision %', p_decision;
  END IF;

  SELECT * INTO v_row FROM public.logistics_readiness_evidence WHERE control_id = p_control_id FOR UPDATE;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'no evidence submitted for control %', p_control_id; END IF;
  IF v_row.workflow_state <> 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'control % is not pending approval (state %)', p_control_id, v_row.workflow_state;
  END IF;
  IF v_row.submitted_by IS NOT NULL AND v_row.submitted_by = auth.uid() THEN
    RAISE EXCEPTION 'separation of duties: the approver must differ from the submitter';
  END IF;
  IF coalesce(btrim(v_row.evidence_ref), '') = '' THEN
    RAISE EXCEPTION 'no evidence reference on record';
  END IF;

  v_to := CASE p_decision WHEN 'APPROVE' THEN 'APPROVED'::public.readiness_evidence_state
                          WHEN 'REJECT' THEN 'REJECTED'::public.readiness_evidence_state
                          ELSE 'REVISION_REQUESTED'::public.readiness_evidence_state END;

  UPDATE public.logistics_readiness_evidence
     SET workflow_state = v_to, decided_by = auth.uid(), decided_at = now(),
         comments = coalesce(p_comments, comments)
   WHERE control_id = p_control_id
  RETURNING * INTO v_row;

  INSERT INTO public.logistics_readiness_audit (control_id, action, from_state, to_state, actor, comments)
  VALUES (p_control_id, p_decision, 'PENDING_APPROVAL', v_to, auth.uid(), p_comments);

  RETURN v_row;
END; $$;

REVOKE ALL ON FUNCTION public.logistics_readiness_decide(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_readiness_decide(text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.logistics_pilot_record_run(
  p_scenario_id text,
  p_expected_outcome text,
  p_observed_outcome text,
  p_result text,
  p_evidence_ref text,
  p_environment text DEFAULT 'isolated_staging',
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS public.logistics_pilot_runs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.logistics_pilot_runs;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.manage') THEN
    RAISE EXCEPTION 'not authorised to record pilot runs';
  END IF;
  IF coalesce(btrim(p_evidence_ref), '') = '' OR coalesce(btrim(p_observed_outcome), '') = '' THEN
    RAISE EXCEPTION 'a pilot run requires an observed outcome and an evidence reference';
  END IF;
  IF p_result NOT IN ('PASS','FAIL') THEN RAISE EXCEPTION 'invalid result %', p_result; END IF;

  INSERT INTO public.logistics_pilot_runs (
    scenario_id, expected_outcome, observed_outcome, result, evidence_ref, environment, executed_by, payload
  ) VALUES (
    p_scenario_id, p_expected_outcome, btrim(p_observed_outcome), p_result, btrim(p_evidence_ref),
    coalesce(p_environment, 'isolated_staging'), auth.uid(), coalesce(p_payload, '{}'::jsonb)
  ) RETURNING * INTO v_row;

  INSERT INTO public.logistics_readiness_audit (control_id, action, actor, comments, payload)
  VALUES (p_scenario_id, 'PILOT_RUN_RECORDED', auth.uid(), p_observed_outcome,
          jsonb_build_object('result', p_result, 'evidence_ref', btrim(p_evidence_ref)));

  RETURN v_row;
END; $$;

REVOKE ALL ON FUNCTION public.logistics_pilot_record_run(text, text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_pilot_record_run(text, text, text, text, text, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.logistics_infra_target_upsert(
  p_target_role text,
  p_label text,
  p_endpoint_ref text,
  p_synthetic_fixtures_loaded boolean DEFAULT false,
  p_isolation_verified boolean DEFAULT false,
  p_notes text DEFAULT NULL
) RETURNS public.logistics_infra_targets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.logistics_infra_targets;
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.manage') THEN
    RAISE EXCEPTION 'not authorised to register infrastructure targets';
  END IF;
  IF p_target_role NOT IN ('staging','restore') THEN RAISE EXCEPTION 'invalid target role %', p_target_role; END IF;
  IF coalesce(btrim(p_endpoint_ref), '') = '' THEN RAISE EXCEPTION 'an endpoint reference is mandatory'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.logistics_infra_targets t
     WHERE t.target_role <> p_target_role AND t.endpoint_ref = btrim(p_endpoint_ref)
  ) THEN
    RAISE EXCEPTION 'the staging and restore targets must be distinct instances';
  END IF;

  INSERT INTO public.logistics_infra_targets AS t (
    target_role, label, endpoint_ref, synthetic_fixtures_loaded, isolation_verified, verified_by, verified_at, notes
  ) VALUES (
    p_target_role, p_label, btrim(p_endpoint_ref), p_synthetic_fixtures_loaded, p_isolation_verified,
    CASE WHEN p_isolation_verified THEN auth.uid() END,
    CASE WHEN p_isolation_verified THEN now() END,
    p_notes
  )
  ON CONFLICT (target_role) DO UPDATE SET
    label = EXCLUDED.label,
    endpoint_ref = EXCLUDED.endpoint_ref,
    synthetic_fixtures_loaded = EXCLUDED.synthetic_fixtures_loaded,
    isolation_verified = EXCLUDED.isolation_verified,
    verified_by = CASE WHEN EXCLUDED.isolation_verified THEN auth.uid() ELSE NULL END,
    verified_at = CASE WHEN EXCLUDED.isolation_verified THEN now() ELSE NULL END,
    notes = EXCLUDED.notes
  RETURNING t.* INTO v_row;

  INSERT INTO public.logistics_readiness_audit (control_id, action, actor, comments, payload)
  VALUES ('DI-00', 'INFRA_TARGET_REGISTERED', auth.uid(), p_notes,
          jsonb_build_object('role', p_target_role, 'isolation_verified', p_isolation_verified));

  RETURN v_row;
END; $$;

REVOKE ALL ON FUNCTION public.logistics_infra_target_upsert(text, text, text, boolean, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logistics_infra_target_upsert(text, text, text, boolean, boolean, text) TO authenticated, service_role;