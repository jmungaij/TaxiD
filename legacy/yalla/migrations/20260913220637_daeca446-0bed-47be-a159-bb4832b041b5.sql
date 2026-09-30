
-- ============ versioned risk policy ============
CREATE TABLE public.identity_risk_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL,
  label text NOT NULL,
  w_new_device integer NOT NULL DEFAULT 30,
  w_new_country integer NOT NULL DEFAULT 35,
  w_dormant integer NOT NULL DEFAULT 20,
  w_recent_failures integer NOT NULL DEFAULT 25,
  w_impossible_travel integer NOT NULL DEFAULT 45,
  w_privileged_access integer NOT NULL DEFAULT 15,
  dormant_days integer NOT NULL DEFAULT 30,
  failure_window_minutes integer NOT NULL DEFAULT 60,
  failure_threshold integer NOT NULL DEFAULT 3,
  travel_window_hours integer NOT NULL DEFAULT 2,
  step_up_threshold integer NOT NULL DEFAULT 40,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT','ACTIVE','RETIRED')),
  business_approval text NOT NULL DEFAULT 'PENDING_BUSINESS_APPROVAL',
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version)
);
CREATE UNIQUE INDEX identity_risk_policy_one_active ON public.identity_risk_policies (state) WHERE state = 'ACTIVE';

GRANT SELECT ON public.identity_risk_policies TO authenticated;
GRANT ALL ON public.identity_risk_policies TO service_role;
ALTER TABLE public.identity_risk_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY identity_risk_policies_staff_read ON public.identity_risk_policies
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TRIGGER identity_risk_policies_touch
  BEFORE UPDATE ON public.identity_risk_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ append-only assessment ledger ============
CREATE TABLE public.identity_risk_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  policy_id uuid REFERENCES public.identity_risk_policies(id),
  policy_version integer,
  score integer NOT NULL,
  decision text NOT NULL CHECK (decision IN ('ALLOW','STEP_UP_REQUIRED')),
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  signals jsonb NOT NULL DEFAULT '{}'::jsonb,
  fingerprint_hash text,
  country text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX identity_risk_assessments_user ON public.identity_risk_assessments (user_id, occurred_at DESC);

GRANT SELECT ON public.identity_risk_assessments TO authenticated;
GRANT ALL ON public.identity_risk_assessments TO service_role;
ALTER TABLE public.identity_risk_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY identity_risk_assessments_own_read ON public.identity_risk_assessments
  FOR SELECT TO authenticated
  USING (user_id = auth.uid()
     OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE OR REPLACE FUNCTION public._identity_risk_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'identity_risk_assessments is append-only';
END;
$$;
CREATE TRIGGER identity_risk_assessments_immutable
  BEFORE UPDATE OR DELETE ON public.identity_risk_assessments
  FOR EACH ROW EXECUTE FUNCTION public._identity_risk_append_only();

-- ============ evaluation ============
CREATE OR REPLACE FUNCTION public.identity_risk_evaluate(_fingerprint_hash text DEFAULT NULL, _country text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_p public.identity_risk_policies;
  v_score integer := 0;
  v_reasons jsonb := '[]'::jsonb;
  v_signals jsonb := '{}'::jsonb;
  v_new_device boolean := false;
  v_new_country boolean := false;
  v_dormant boolean := false;
  v_failures integer := 0;
  v_travel boolean := false;
  v_privileged boolean := false;
  v_last_success timestamptz;
  v_decision text;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_AUTHENTICATED');
  END IF;

  SELECT * INTO v_p FROM public.identity_risk_policies WHERE state = 'ACTIVE' LIMIT 1;
  IF v_p.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_ACTIVE_RISK_POLICY');
  END IF;

  IF _fingerprint_hash IS NOT NULL THEN
    v_new_device := NOT EXISTS (
      SELECT 1 FROM public.device_fingerprints d
      WHERE d.user_id = v_uid AND d.fingerprint_hash = _fingerprint_hash)
      AND NOT EXISTS (
      SELECT 1 FROM public.authentication_events e
      WHERE e.user_id = v_uid AND e.fingerprint_hash = _fingerprint_hash AND e.success);
  END IF;

  IF _country IS NOT NULL THEN
    v_new_country := NOT EXISTS (
      SELECT 1 FROM public.authentication_events e
      WHERE e.user_id = v_uid AND e.success AND e.country = _country);
  END IF;

  SELECT max(e.occurred_at) INTO v_last_success
  FROM public.authentication_events e
  WHERE e.user_id = v_uid AND e.success;
  v_dormant := v_last_success IS NOT NULL
    AND v_last_success < now() - make_interval(days => v_p.dormant_days);

  SELECT count(*) INTO v_failures
  FROM public.authentication_events e
  WHERE e.user_id = v_uid AND NOT e.success
    AND e.occurred_at > now() - make_interval(mins => v_p.failure_window_minutes);

  IF _country IS NOT NULL THEN
    v_travel := EXISTS (
      SELECT 1 FROM public.authentication_events e
      WHERE e.user_id = v_uid AND e.success
        AND e.country IS NOT NULL AND e.country <> _country
        AND e.occurred_at > now() - make_interval(hours => v_p.travel_window_hours));
  END IF;

  v_privileged := public.has_any_role(v_uid,
    ARRAY['admin','super_admin','finance_admin']::app_role[]);

  IF v_new_device THEN
    v_score := v_score + v_p.w_new_device;
    v_reasons := v_reasons || jsonb_build_array('A device we have not seen on this account before');
  END IF;
  IF v_new_country THEN
    v_score := v_score + v_p.w_new_country;
    v_reasons := v_reasons || jsonb_build_array('A country this account has not signed in from before');
  END IF;
  IF v_dormant THEN
    v_score := v_score + v_p.w_dormant;
    v_reasons := v_reasons || jsonb_build_array('A long gap since the last sign-in');
  END IF;
  IF v_failures >= v_p.failure_threshold THEN
    v_score := v_score + v_p.w_recent_failures;
    v_reasons := v_reasons || jsonb_build_array('Several failed sign-in attempts recently');
  END IF;
  IF v_travel THEN
    v_score := v_score + v_p.w_impossible_travel;
    v_reasons := v_reasons || jsonb_build_array('A sign-in from a different country within a short window');
  END IF;
  IF v_privileged THEN
    v_score := v_score + v_p.w_privileged_access;
    v_reasons := v_reasons || jsonb_build_array('This account holds privileged access');
  END IF;

  v_signals := jsonb_build_object(
    'new_device', v_new_device, 'new_country', v_new_country, 'dormant', v_dormant,
    'recent_failures', v_failures, 'impossible_travel', v_travel, 'privileged', v_privileged,
    'last_success_at', v_last_success);

  v_decision := CASE WHEN v_score >= v_p.step_up_threshold THEN 'STEP_UP_REQUIRED' ELSE 'ALLOW' END;

  INSERT INTO public.identity_risk_assessments
    (user_id, policy_id, policy_version, score, decision, reasons, signals, fingerprint_hash, country)
  VALUES (v_uid, v_p.id, v_p.version, v_score, v_decision, v_reasons, v_signals, _fingerprint_hash, _country)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'ok', true, 'assessment_id', v_id, 'decision', v_decision, 'score', v_score,
    'threshold', v_p.step_up_threshold, 'reasons', v_reasons,
    'policy', jsonb_build_object('id', v_p.id, 'version', v_p.version, 'label', v_p.label,
                                 'business_approval', v_p.business_approval));
END;
$$;
REVOKE ALL ON FUNCTION public.identity_risk_evaluate(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.identity_risk_evaluate(text, text) TO authenticated, service_role;

-- own risk history for the Security Centre
CREATE OR REPLACE FUNCTION public.identity_my_risk_assessments(_limit integer DEFAULT 20)
RETURNS TABLE (id uuid, score integer, decision text, reasons jsonb, occurred_at timestamptz, policy_version integer)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT a.id, a.score, a.decision, a.reasons, a.occurred_at, a.policy_version
  FROM public.identity_risk_assessments a
  WHERE a.user_id = auth.uid()
  ORDER BY a.occurred_at DESC
  LIMIT least(coalesce(_limit, 20), 100);
$$;
REVOKE ALL ON FUNCTION public.identity_my_risk_assessments(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.identity_my_risk_assessments(integer) TO authenticated, service_role;
