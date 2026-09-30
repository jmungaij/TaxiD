-- ============================================================
-- STAGE 15 — Continuous optimisation, network intelligence
-- Measurement-first. No fabricated metrics, forecasts or profit.
-- ============================================================

CREATE TYPE public.opt_sufficiency AS ENUM ('SUFFICIENT','INSUFFICIENT_DATA','NO_DATA');
CREATE TYPE public.opt_risk_class AS ENUM ('LOW_REVERSIBLE','MEDIUM','HIGH','FINANCIAL','PRICING');
CREATE TYPE public.opt_state AS ENUM ('DRAFT','MEASURED','SIMULATED','APPROVAL_PENDING','APPROVED','ACTIVE','ADOPTED','ROLLED_BACK','REJECTED','BLOCKED');
CREATE TYPE public.opt_experiment_state AS ENUM ('DECLARED','RUNNING','CONCLUDED','ROLLED_BACK','ABANDONED');

-- ---------- metric catalogue ----------
CREATE TABLE public.opt_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  domain text NOT NULL,
  name text NOT NULL,
  unit text NOT NULL,
  direction text NOT NULL DEFAULT 'HIGHER_IS_BETTER'
    CHECK (direction IN ('HIGHER_IS_BETTER','LOWER_IS_BETTER','NEUTRAL')),
  min_sample_size integer NOT NULL CHECK (min_sample_size >= 1),
  source_description text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.opt_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_code text NOT NULL REFERENCES public.opt_metrics(code),
  scope_kind text NOT NULL,
  scope_ref text,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  value numeric,
  sample_size integer NOT NULL DEFAULT 0,
  sufficiency public.opt_sufficiency NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opt_measurement_value_law CHECK (
    (sufficiency = 'SUFFICIENT' AND value IS NOT NULL)
    OR (sufficiency <> 'SUFFICIENT' AND value IS NULL)
  )
);
CREATE INDEX opt_measurements_metric_idx ON public.opt_measurements (metric_code, created_at DESC);

-- ---------- experiments ----------
CREATE TABLE public.opt_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  hypothesis text NOT NULL,
  cohort_kind text NOT NULL,
  cohort_definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  control jsonb NOT NULL,
  treatment jsonb NOT NULL,
  primary_metric_code text NOT NULL REFERENCES public.opt_metrics(code),
  guardrail_metric_codes text[] NOT NULL DEFAULT '{}',
  starts_at timestamptz,
  ends_at timestamptz,
  state public.opt_experiment_state NOT NULL DEFAULT 'DECLARED',
  decision text,
  decision_reason text,
  decided_by uuid,
  decided_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.opt_experiment_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES public.opt_experiments(id) ON DELETE CASCADE,
  arm text NOT NULL CHECK (arm IN ('CONTROL','TREATMENT')),
  measurement_id uuid NOT NULL REFERENCES public.opt_measurements(id),
  is_guardrail boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- optimisation proposals ----------
CREATE TABLE public.opt_optimizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  objective text NOT NULL,
  domain text NOT NULL,
  hypothesis text NOT NULL,
  expected_impact jsonb NOT NULL,
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  risk_class public.opt_risk_class NOT NULL,
  approval_required boolean NOT NULL DEFAULT true,
  human_only boolean NOT NULL DEFAULT false,
  baseline_measurement_id uuid REFERENCES public.opt_measurements(id),
  target_metric_code text NOT NULL REFERENCES public.opt_metrics(code),
  experiment_id uuid REFERENCES public.opt_experiments(id),
  rollback_condition text NOT NULL,
  simulation jsonb,
  simulated_at timestamptz,
  state public.opt_state NOT NULL DEFAULT 'DRAFT',
  decided_by uuid,
  decided_at timestamptz,
  decision_reason text,
  result_measurement_id uuid REFERENCES public.opt_measurements(id),
  result jsonb,
  adopted_at timestamptz,
  rolled_back_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.opt_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  optimization_id uuid REFERENCES public.opt_optimizations(id) ON DELETE SET NULL,
  experiment_id uuid REFERENCES public.opt_experiments(id) ON DELETE SET NULL,
  measurement_id uuid REFERENCES public.opt_measurements(id) ON DELETE SET NULL,
  actor_id uuid,
  actor_kind text NOT NULL DEFAULT 'OPERATOR',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- automation registry ----------
CREATE TABLE public.opt_automation_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL UNIQUE,
  domain text NOT NULL,
  trigger_description text NOT NULL,
  policy_reference text NOT NULL,
  authority text NOT NULL,
  risk_level public.opt_risk_class NOT NULL,
  reversible boolean NOT NULL,
  rollback_capability text NOT NULL,
  adapter_code text,
  automation_allowed boolean NOT NULL DEFAULT false,
  refusal_reason text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opt_automation_refusal_law CHECK (
    automation_allowed OR refusal_reason IS NOT NULL
  ),
  CONSTRAINT opt_automation_risk_law CHECK (
    NOT automation_allowed OR (risk_level = 'LOW_REVERSIBLE' AND reversible)
  )
);

-- ---------- grants + RLS ----------
GRANT SELECT ON public.opt_metrics, public.opt_measurements, public.opt_experiments,
  public.opt_experiment_observations, public.opt_optimizations, public.opt_events,
  public.opt_automation_registry TO authenticated;
GRANT ALL ON public.opt_metrics, public.opt_measurements, public.opt_experiments,
  public.opt_experiment_observations, public.opt_optimizations, public.opt_events,
  public.opt_automation_registry TO service_role;

ALTER TABLE public.opt_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opt_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opt_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opt_experiment_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opt_optimizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opt_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opt_automation_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "opt_metrics_admin_read" ON public.opt_metrics FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "opt_measurements_admin_read" ON public.opt_measurements FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "opt_experiments_admin_read" ON public.opt_experiments FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "opt_experiment_obs_admin_read" ON public.opt_experiment_observations FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "opt_optimizations_admin_read" ON public.opt_optimizations FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "opt_events_admin_read" ON public.opt_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "opt_automation_admin_read" ON public.opt_automation_registry FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- append-only audit + immutable measurements
CREATE OR REPLACE FUNCTION public._opt_append_only() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Table %.% is append-only', TG_TABLE_SCHEMA, TG_TABLE_NAME;
END $$;
REVOKE ALL ON FUNCTION public._opt_append_only() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER opt_measurements_append_only BEFORE UPDATE OR DELETE ON public.opt_measurements
  FOR EACH ROW EXECUTE FUNCTION public._opt_append_only();
CREATE TRIGGER opt_events_append_only BEFORE UPDATE OR DELETE ON public.opt_events
  FOR EACH ROW EXECUTE FUNCTION public._opt_append_only();
CREATE TRIGGER opt_experiment_obs_append_only BEFORE UPDATE OR DELETE ON public.opt_experiment_observations
  FOR EACH ROW EXECUTE FUNCTION public._opt_append_only();

CREATE TRIGGER opt_metrics_touch BEFORE UPDATE ON public.opt_metrics
  FOR EACH ROW EXECUTE FUNCTION public._ai_touch();
CREATE TRIGGER opt_experiments_touch BEFORE UPDATE ON public.opt_experiments
  FOR EACH ROW EXECUTE FUNCTION public._ai_touch();
CREATE TRIGGER opt_optimizations_touch BEFORE UPDATE ON public.opt_optimizations
  FOR EACH ROW EXECUTE FUNCTION public._ai_touch();
CREATE TRIGGER opt_automation_touch BEFORE UPDATE ON public.opt_automation_registry
  FOR EACH ROW EXECUTE FUNCTION public._ai_touch();

-- ---------- metric catalogue seed ----------
INSERT INTO public.opt_metrics (code, domain, name, unit, direction, min_sample_size, source_description) VALUES
 ('DISPATCH_MATCH_RATE','DISPATCH','Dispatch match rate','ratio','HIGHER_IS_BETTER',20,'logistics_match_runs outcome vs total runs'),
 ('TIME_TO_MATCH_MS','DISPATCH','Median time to match','milliseconds','LOWER_IS_BETTER',20,'logistics_match_runs.matching_duration_ms'),
 ('ROUTE_CAPACITY_UTILISATION','CAPACITY','Route capacity utilisation','ratio','HIGHER_IS_BETTER',20,'freight_route_instances reserved vs planned capacity'),
 ('FLEET_ASSIGNMENT_RATE','CAPACITY','Registered fleet assignment rate','ratio','HIGHER_IS_BETTER',20,'logistics_fleet_capacity vs assigned dispatch requests'),
 ('DELIVERY_COMPLETION_RATE','EXECUTION','Delivery completion rate','ratio','HIGHER_IS_BETTER',30,'delivery_orders terminal status distribution'),
 ('EXCEPTION_RATE','EXECUTION','Exceptions per order','ratio','LOWER_IS_BETTER',30,'logistics_exceptions vs delivery_orders'),
 ('QUOTE_CONVERSION_RATE','COMMERCIAL','Quote to order conversion','ratio','HIGHER_IS_BETTER',20,'freight_quotations accepted vs issued'),
 ('INVOICE_COLLECTION_RATE','FINANCE','Invoice collection rate','ratio','HIGHER_IS_BETTER',20,'freight_invoices paid_total vs total'),
 ('EMPTY_RETURN_LEG_RATE','NETWORK','Empty return leg rate','ratio','LOWER_IS_BETTER',20,'freight_route_instances reverse-lane pairing'),
 ('AI_RECOMMENDATION_ACCEPTANCE','AI','AI recommendation acceptance','ratio','HIGHER_IS_BETTER',20,'ai_action_requests approval decisions'),
 ('AI_ACTION_SUCCESS_RATE','AI','AI action verified success rate','ratio','HIGHER_IS_BETTER',20,'ai_action_executions verified vs total');

-- ---------- automation registry seed (mirrors Stage 10B adapters) ----------
INSERT INTO public.opt_automation_registry
 (action_type, domain, trigger_description, policy_reference, authority, risk_level, reversible, rollback_capability, adapter_code, automation_allowed, refusal_reason)
SELECT a.action_type, a.domain,
  'Detector finding routed through Stage 10B governance', 'ai_policies.'||a.action_type,
  CASE WHEN a.automation_allowed THEN 'AI worker under approved policy' ELSE 'Human operator only' END,
  CASE WHEN a.automation_allowed THEN 'LOW_REVERSIBLE'::public.opt_risk_class ELSE 'HIGH'::public.opt_risk_class END,
  a.automation_allowed,
  CASE WHEN a.automation_allowed THEN 'Release/rematch through the authoritative dispatch engine'
       ELSE 'Not applicable — no automated execution permitted' END,
  a.adapter_code, a.automation_allowed,
  CASE WHEN a.automation_allowed THEN NULL ELSE coalesce(a.refusal_reason,'Automation not permitted for this domain') END
FROM public.ai_adapters a
ON CONFLICT (action_type) DO NOTHING;

-- ============================================================
-- MEASUREMENT ENGINE — authoritative sources only
-- ============================================================
CREATE OR REPLACE FUNCTION public.opt_measure(
  _metric_code text,
  _window_days integer DEFAULT 30,
  _scope_kind text DEFAULT 'PLATFORM',
  _scope_ref text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.opt_metrics; ws timestamptz; we timestamptz;
        v_n integer := 0; v_num numeric := 0; v_val numeric; v_suf public.opt_sufficiency;
        v_ev jsonb := '{}'::jsonb; v_id uuid; v_actor uuid := auth.uid();
BEGIN
  IF NOT (public._ai_is_worker() OR public.has_role(v_actor,'admin') OR public.has_role(v_actor,'super_admin')) THEN
    RAISE EXCEPTION 'Not authorised to compute optimisation measurements';
  END IF;
  SELECT * INTO m FROM public.opt_metrics WHERE code = _metric_code AND active;
  IF m.code IS NULL THEN RAISE EXCEPTION 'Unknown or inactive metric %', _metric_code; END IF;
  IF _window_days IS NULL OR _window_days < 1 THEN RAISE EXCEPTION 'Window must be at least one day'; END IF;

  we := now(); ws := now() - make_interval(days => _window_days);

  IF _metric_code = 'DISPATCH_MATCH_RATE' THEN
    SELECT count(*), count(*) FILTER (WHERE outcome IN ('MATCHED','SELECTED','SUCCESS'))
      INTO v_n, v_num FROM public.logistics_match_runs WHERE created_at BETWEEN ws AND we;
  ELSIF _metric_code = 'TIME_TO_MATCH_MS' THEN
    SELECT count(*) FILTER (WHERE matching_duration_ms IS NOT NULL),
           coalesce(percentile_disc(0.5) WITHIN GROUP (ORDER BY matching_duration_ms), 0)
      INTO v_n, v_num FROM public.logistics_match_runs WHERE created_at BETWEEN ws AND we;
  ELSIF _metric_code = 'ROUTE_CAPACITY_UTILISATION' THEN
    SELECT count(*), coalesce(sum(reserved_capacity_kg),0)
      INTO v_n, v_num FROM public.freight_route_instances
     WHERE created_at BETWEEN ws AND we AND coalesce(planned_capacity_kg,0) > 0;
    SELECT jsonb_build_object('planned_capacity_kg', coalesce(sum(planned_capacity_kg),0))
      INTO v_ev FROM public.freight_route_instances
     WHERE created_at BETWEEN ws AND we AND coalesce(planned_capacity_kg,0) > 0;
  ELSIF _metric_code = 'FLEET_ASSIGNMENT_RATE' THEN
    SELECT count(*), count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.logistics_dispatch_requests d
       WHERE d.assigned_vehicle_id = f.vehicle_id AND d.created_at BETWEEN ws AND we))
      INTO v_n, v_num FROM public.logistics_fleet_capacity f;
  ELSIF _metric_code = 'DELIVERY_COMPLETION_RATE' THEN
    SELECT count(*), count(*) FILTER (WHERE upper(status) IN ('DELIVERED','COMPLETED','CLOSED'))
      INTO v_n, v_num FROM public.delivery_orders WHERE created_at BETWEEN ws AND we;
  ELSIF _metric_code = 'EXCEPTION_RATE' THEN
    SELECT count(*) INTO v_n FROM public.delivery_orders WHERE created_at BETWEEN ws AND we;
    SELECT count(*) INTO v_num FROM public.logistics_exceptions WHERE created_at BETWEEN ws AND we;
  ELSIF _metric_code = 'QUOTE_CONVERSION_RATE' THEN
    SELECT count(*), count(*) FILTER (WHERE accepted_at IS NOT NULL)
      INTO v_n, v_num FROM public.freight_quotations WHERE created_at BETWEEN ws AND we;
  ELSIF _metric_code = 'INVOICE_COLLECTION_RATE' THEN
    SELECT count(*), coalesce(sum(paid_total),0)
      INTO v_n, v_num FROM public.freight_invoices
     WHERE created_at BETWEEN ws AND we AND voided_at IS NULL AND coalesce(total,0) > 0;
    SELECT jsonb_build_object('invoiced_total', coalesce(sum(total),0))
      INTO v_ev FROM public.freight_invoices
     WHERE created_at BETWEEN ws AND we AND voided_at IS NULL AND coalesce(total,0) > 0;
  ELSIF _metric_code = 'EMPTY_RETURN_LEG_RATE' THEN
    SELECT count(*), count(*) FILTER (WHERE NOT EXISTS (
      SELECT 1 FROM public.freight_route_instances b
        JOIN public.freight_repeat_routes rb ON rb.id = b.route_id
       WHERE rb.origin_label = ra.destination_label AND rb.destination_label = ra.origin_label
         AND b.service_date = i.service_date))
      INTO v_n, v_num
      FROM public.freight_route_instances i
      JOIN public.freight_repeat_routes ra ON ra.id = i.route_id
     WHERE i.created_at BETWEEN ws AND we;
  ELSIF _metric_code = 'AI_RECOMMENDATION_ACCEPTANCE' THEN
    SELECT count(*), count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM public.ai_action_approvals ap
       WHERE ap.action_request_id = r.id AND ap.decision = 'APPROVED'))
      INTO v_n, v_num FROM public.ai_action_requests r WHERE r.created_at BETWEEN ws AND we;
  ELSIF _metric_code = 'AI_ACTION_SUCCESS_RATE' THEN
    SELECT count(*), count(*) FILTER (WHERE verified)
      INTO v_n, v_num FROM public.ai_action_executions WHERE created_at BETWEEN ws AND we;
  ELSE
    RAISE EXCEPTION 'Metric % has no authoritative computation and must not be estimated', _metric_code;
  END IF;

  IF v_n = 0 THEN
    v_suf := 'NO_DATA'; v_val := NULL;
  ELSIF v_n < m.min_sample_size THEN
    v_suf := 'INSUFFICIENT_DATA'; v_val := NULL;
  ELSE
    v_suf := 'SUFFICIENT';
    v_val := CASE
      WHEN _metric_code = 'TIME_TO_MATCH_MS' THEN v_num
      WHEN _metric_code = 'ROUTE_CAPACITY_UTILISATION'
        THEN CASE WHEN coalesce((v_ev->>'planned_capacity_kg')::numeric,0) > 0
                  THEN round(v_num / (v_ev->>'planned_capacity_kg')::numeric, 4) ELSE NULL END
      WHEN _metric_code = 'INVOICE_COLLECTION_RATE'
        THEN CASE WHEN coalesce((v_ev->>'invoiced_total')::numeric,0) > 0
                  THEN round(v_num / (v_ev->>'invoiced_total')::numeric, 4) ELSE NULL END
      ELSE round(v_num::numeric / v_n::numeric, 4) END;
    IF v_val IS NULL THEN v_suf := 'INSUFFICIENT_DATA'; END IF;
  END IF;

  INSERT INTO public.opt_measurements
    (metric_code, scope_kind, scope_ref, window_start, window_end, value, sample_size, sufficiency, evidence, computed_by)
  VALUES (_metric_code, _scope_kind, _scope_ref, ws, we, v_val, v_n, v_suf,
          v_ev || jsonb_build_object('numerator', v_num, 'min_sample_size', m.min_sample_size,
                                     'source', m.source_description), v_actor)
  RETURNING id INTO v_id;

  INSERT INTO public.opt_events (event_type, measurement_id, actor_id, actor_kind, detail)
  VALUES ('MEASUREMENT_RECORDED', v_id, v_actor,
          CASE WHEN public._ai_is_worker() THEN 'WORKER' ELSE 'OPERATOR' END,
          jsonb_build_object('metric', _metric_code, 'sufficiency', v_suf, 'sample_size', v_n));

  RETURN jsonb_build_object('measurement_id', v_id, 'metric', _metric_code, 'value', v_val,
    'sample_size', v_n, 'min_sample_size', m.min_sample_size, 'sufficiency', v_suf,
    'window_start', ws, 'window_end', we);
END $$;
REVOKE ALL ON FUNCTION public.opt_measure(text,integer,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opt_measure(text,integer,text,text) TO authenticated, service_role;

-- ============================================================
-- OPTIMISATION LIFECYCLE
-- ============================================================
CREATE OR REPLACE FUNCTION public.opt_optimization_open(
  _code text, _objective text, _domain text, _hypothesis text,
  _target_metric_code text, _expected_impact jsonb, _confidence numeric,
  _risk_class public.opt_risk_class, _rollback_condition text,
  _baseline_measurement_id uuid DEFAULT NULL, _experiment_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := auth.uid(); v_id uuid; v_human boolean; b public.opt_measurements;
BEGIN
  IF NOT (public._ai_is_worker() OR public.has_role(v_actor,'admin') OR public.has_role(v_actor,'super_admin')) THEN
    RAISE EXCEPTION 'Not authorised to open optimisations';
  END IF;
  IF coalesce(trim(_objective),'') = '' OR coalesce(trim(_hypothesis),'') = ''
     OR coalesce(trim(_rollback_condition),'') = '' THEN
    RAISE EXCEPTION 'Objective, hypothesis and rollback condition are all required';
  END IF;
  PERFORM 1 FROM public.opt_metrics WHERE code = _target_metric_code AND active;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown target metric %', _target_metric_code; END IF;

  IF _baseline_measurement_id IS NOT NULL THEN
    SELECT * INTO b FROM public.opt_measurements WHERE id = _baseline_measurement_id;
    IF b.id IS NULL THEN RAISE EXCEPTION 'Unknown baseline measurement'; END IF;
    IF b.metric_code <> _target_metric_code THEN
      RAISE EXCEPTION 'Baseline measures % but the optimisation targets %', b.metric_code, _target_metric_code;
    END IF;
  END IF;

  -- pricing and financial optimisations are always human decisions and never auto-adopted
  v_human := _risk_class IN ('FINANCIAL','PRICING','HIGH');

  SELECT id INTO v_id FROM public.opt_optimizations WHERE code = _code;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('optimization_id', v_id, 'duplicate', true);
  END IF;

  INSERT INTO public.opt_optimizations
    (code, objective, domain, hypothesis, expected_impact, confidence, risk_class,
     approval_required, human_only, baseline_measurement_id, target_metric_code,
     experiment_id, rollback_condition, state, created_by)
  VALUES (_code, _objective, _domain, _hypothesis, _expected_impact, _confidence, _risk_class,
     true, v_human, _baseline_measurement_id, _target_metric_code, _experiment_id,
     _rollback_condition,
     CASE WHEN _baseline_measurement_id IS NULL THEN 'DRAFT' ELSE 'MEASURED' END, v_actor)
  RETURNING id INTO v_id;

  INSERT INTO public.opt_events (event_type, optimization_id, actor_id, detail)
  VALUES ('OPTIMIZATION_OPENED', v_id, v_actor,
    jsonb_build_object('risk_class', _risk_class, 'human_only', v_human, 'code', _code));

  RETURN jsonb_build_object('optimization_id', v_id, 'duplicate', false,
    'human_only', v_human, 'state', CASE WHEN _baseline_measurement_id IS NULL THEN 'DRAFT' ELSE 'MEASURED' END);
END $$;
REVOKE ALL ON FUNCTION public.opt_optimization_open(text,text,text,text,text,jsonb,numeric,public.opt_risk_class,text,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opt_optimization_open(text,text,text,text,text,jsonb,numeric,public.opt_risk_class,text,uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.opt_optimization_simulate(
  _optimization_id uuid, _simulation jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.opt_optimizations; b public.opt_measurements; v_actor uuid := auth.uid();
BEGIN
  IF NOT (public._ai_is_worker() OR public.has_role(v_actor,'admin') OR public.has_role(v_actor,'super_admin')) THEN
    RAISE EXCEPTION 'Not authorised to simulate optimisations';
  END IF;
  SELECT * INTO o FROM public.opt_optimizations WHERE id = _optimization_id FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Unknown optimisation'; END IF;
  IF o.state NOT IN ('DRAFT','MEASURED','SIMULATED') THEN
    RAISE EXCEPTION 'Optimisation is % and can no longer be simulated', o.state;
  END IF;
  IF o.baseline_measurement_id IS NULL THEN
    RETURN jsonb_build_object('optimization_id', o.id, 'accepted', false,
      'code','NO_BASELINE', 'message','Measure the baseline before simulating a change');
  END IF;
  SELECT * INTO b FROM public.opt_measurements WHERE id = o.baseline_measurement_id;
  IF b.sufficiency <> 'SUFFICIENT' THEN
    UPDATE public.opt_optimizations SET state = 'BLOCKED',
      decision_reason = format('Baseline evidence is %s', b.sufficiency), updated_at = now()
     WHERE id = o.id;
    INSERT INTO public.opt_events (event_type, optimization_id, actor_id, detail)
    VALUES ('OPTIMIZATION_BLOCKED', o.id, v_actor,
      jsonb_build_object('reason','INSUFFICIENT_BASELINE_EVIDENCE','sufficiency', b.sufficiency,
                         'sample_size', b.sample_size, 'min_sample_size', (b.evidence->>'min_sample_size')));
    RETURN jsonb_build_object('optimization_id', o.id, 'accepted', false,
      'code','INSUFFICIENT_BASELINE_EVIDENCE', 'sufficiency', b.sufficiency,
      'message','The baseline has insufficient evidence; no change may be proposed on it');
  END IF;
  IF _simulation IS NULL OR _simulation = '{}'::jsonb THEN
    RAISE EXCEPTION 'A simulation result is required before approval';
  END IF;

  UPDATE public.opt_optimizations
     SET simulation = _simulation, simulated_at = now(), state = 'SIMULATED', updated_at = now()
   WHERE id = o.id;
  INSERT INTO public.opt_events (event_type, optimization_id, actor_id, detail)
  VALUES ('OPTIMIZATION_SIMULATED', o.id, v_actor, _simulation);
  RETURN jsonb_build_object('optimization_id', o.id, 'accepted', true, 'state','SIMULATED');
END $$;
REVOKE ALL ON FUNCTION public.opt_optimization_simulate(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opt_optimization_simulate(uuid,jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.opt_optimization_decide(
  _optimization_id uuid, _decision text, _reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.opt_optimizations; v_actor uuid := auth.uid(); v_state public.opt_state;
BEGIN
  IF NOT (public.has_role(v_actor,'admin') OR public.has_role(v_actor,'super_admin')) THEN
    RAISE EXCEPTION 'Only an administrator may decide an optimisation';
  END IF;
  IF _decision NOT IN ('APPROVED','REJECTED') THEN RAISE EXCEPTION 'Invalid decision %', _decision; END IF;
  IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'Record a reason for the decision'; END IF;

  SELECT * INTO o FROM public.opt_optimizations WHERE id = _optimization_id FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Unknown optimisation'; END IF;
  IF o.state <> 'SIMULATED' THEN
    RETURN jsonb_build_object('optimization_id', o.id, 'accepted', false, 'code','NOT_SIMULATED',
      'state', o.state, 'message','Only a simulated optimisation with a sufficient baseline may be decided');
  END IF;

  v_state := CASE WHEN _decision = 'APPROVED' THEN 'APPROVED' ELSE 'REJECTED' END;
  UPDATE public.opt_optimizations
     SET state = v_state, decided_by = v_actor, decided_at = now(), decision_reason = _reason, updated_at = now()
   WHERE id = o.id;
  INSERT INTO public.opt_events (event_type, optimization_id, actor_id, detail)
  VALUES ('OPTIMIZATION_DECIDED', o.id, v_actor,
    jsonb_build_object('decision', _decision, 'reason', _reason, 'human_only', o.human_only));
  RETURN jsonb_build_object('optimization_id', o.id, 'accepted', true, 'state', v_state);
END $$;
REVOKE ALL ON FUNCTION public.opt_optimization_decide(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opt_optimization_decide(uuid,text,text) TO authenticated, service_role;

-- adopt / rollback strictly against a post-change measurement of the same metric
CREATE OR REPLACE FUNCTION public.opt_optimization_conclude(
  _optimization_id uuid, _result_measurement_id uuid, _guardrail_breached boolean, _reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.opt_optimizations; b public.opt_measurements; r public.opt_measurements;
        v_actor uuid := auth.uid(); v_state public.opt_state; v_delta numeric;
BEGIN
  IF NOT (public.has_role(v_actor,'admin') OR public.has_role(v_actor,'super_admin')) THEN
    RAISE EXCEPTION 'Only an administrator may conclude an optimisation';
  END IF;
  IF coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'Record a reason'; END IF;
  SELECT * INTO o FROM public.opt_optimizations WHERE id = _optimization_id FOR UPDATE;
  IF o.id IS NULL THEN RAISE EXCEPTION 'Unknown optimisation'; END IF;
  IF o.state NOT IN ('APPROVED','ACTIVE') THEN
    RETURN jsonb_build_object('optimization_id', o.id, 'accepted', false, 'code','NOT_APPROVED', 'state', o.state);
  END IF;

  SELECT * INTO r FROM public.opt_measurements WHERE id = _result_measurement_id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Unknown result measurement'; END IF;
  IF r.metric_code <> o.target_metric_code THEN
    RAISE EXCEPTION 'Result measures % but the optimisation targets %', r.metric_code, o.target_metric_code;
  END IF;
  SELECT * INTO b FROM public.opt_measurements WHERE id = o.baseline_measurement_id;

  IF _guardrail_breached THEN
    v_state := 'ROLLED_BACK';
  ELSIF r.sufficiency <> 'SUFFICIENT' THEN
    -- an unproven result may never be adopted
    UPDATE public.opt_optimizations SET state = 'ROLLED_BACK', rolled_back_at = now(),
      result_measurement_id = r.id, decision_reason = 'Result evidence insufficient: '||_reason, updated_at = now()
     WHERE id = o.id;
    INSERT INTO public.opt_events (event_type, optimization_id, measurement_id, actor_id, detail)
    VALUES ('OPTIMIZATION_ROLLED_BACK', o.id, r.id, v_actor,
      jsonb_build_object('reason','INSUFFICIENT_RESULT_EVIDENCE','sufficiency', r.sufficiency));
    RETURN jsonb_build_object('optimization_id', o.id, 'accepted', true, 'state','ROLLED_BACK',
      'code','INSUFFICIENT_RESULT_EVIDENCE');
  ELSE
    v_delta := r.value - coalesce(b.value, r.value);
    v_state := 'ADOPTED';
  END IF;

  UPDATE public.opt_optimizations
     SET state = v_state,
         result_measurement_id = r.id,
         result = jsonb_build_object('baseline', b.value, 'result', r.value, 'delta', v_delta,
                                     'guardrail_breached', _guardrail_breached),
         adopted_at = CASE WHEN v_state = 'ADOPTED' THEN now() ELSE NULL END,
         rolled_back_at = CASE WHEN v_state = 'ROLLED_BACK' THEN now() ELSE NULL END,
         decision_reason = _reason, updated_at = now()
   WHERE id = o.id;

  INSERT INTO public.opt_events (event_type, optimization_id, measurement_id, actor_id, detail)
  VALUES (CASE WHEN v_state = 'ADOPTED' THEN 'OPTIMIZATION_ADOPTED' ELSE 'OPTIMIZATION_ROLLED_BACK' END,
          o.id, r.id, v_actor, jsonb_build_object('baseline', b.value, 'result', r.value, 'delta', v_delta,
            'guardrail_breached', _guardrail_breached, 'reason', _reason));
  RETURN jsonb_build_object('optimization_id', o.id, 'accepted', true, 'state', v_state,
    'baseline', b.value, 'result', r.value, 'delta', v_delta);
END $$;
REVOKE ALL ON FUNCTION public.opt_optimization_conclude(uuid,uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.opt_optimization_conclude(uuid,uuid,boolean,text) TO authenticated, service_role;

-- ============================================================
-- NETWORK INTELLIGENCE VIEWS (real data, sample size exposed)
-- ============================================================
CREATE OR REPLACE VIEW public.v_opt_lane_intelligence
WITH (security_invoker = on) AS
SELECT
  coalesce(d.origin_label,'UNKNOWN') AS origin_label,
  coalesce(d.destination_label,'UNKNOWN') AS destination_label,
  count(*)::int AS dispatch_requests,
  count(*) FILTER (WHERE d.assigned_vehicle_id IS NOT NULL)::int AS assigned_requests,
  count(DISTINCT d.customer_id)::int AS distinct_customers,
  sum(coalesce(d.required_payload_kg,0)) AS demanded_payload_kg,
  min(d.created_at) AS first_seen,
  max(d.created_at) AS last_seen,
  CASE WHEN count(*) >= 20 THEN 'SUFFICIENT' ELSE 'INSUFFICIENT_DATA' END AS lane_evidence
FROM public.logistics_dispatch_requests d
GROUP BY 1,2;

CREATE OR REPLACE VIEW public.v_opt_capacity_position
WITH (security_invoker = on) AS
SELECT
  r.route_code, r.origin_label, r.destination_label, i.vehicle_class, i.service_date,
  i.planned_capacity_kg, i.reserved_capacity_kg, i.available_capacity_kg,
  CASE WHEN coalesce(i.planned_capacity_kg,0) > 0
       THEN round(coalesce(i.reserved_capacity_kg,0) / i.planned_capacity_kg, 4) END AS utilisation_ratio,
  i.allocation_count, i.status, i.actual_departure, i.actual_arrival,
  CASE
    WHEN coalesce(i.planned_capacity_kg,0) = 0 THEN 'NO_CAPACITY_DEFINED'
    WHEN coalesce(i.available_capacity_kg,0) <= 0 THEN 'FULLY_COMMITTED'
    WHEN coalesce(i.reserved_capacity_kg,0) = 0 THEN 'IDLE_CAPACITY'
    ELSE 'PARTIALLY_COMMITTED' END AS capacity_state
FROM public.freight_route_instances i
JOIN public.freight_repeat_routes r ON r.id = i.route_id;

-- Empty return legs: only real, same-day, reverse-lane gaps. No invented opportunities.
CREATE OR REPLACE VIEW public.v_opt_empty_leg_candidates
WITH (security_invoker = on) AS
SELECT
  i.id AS route_instance_id, i.instance_code, i.service_date, i.vehicle_class, i.vehicle_id,
  r.origin_label AS outbound_origin, r.destination_label AS outbound_destination,
  i.reserved_capacity_kg AS outbound_reserved_kg,
  EXISTS (
    SELECT 1 FROM public.freight_route_instances b
      JOIN public.freight_repeat_routes rb ON rb.id = b.route_id
     WHERE rb.origin_label = r.destination_label
       AND rb.destination_label = r.origin_label
       AND b.service_date = i.service_date
  ) AS return_leg_scheduled,
  'Return-lane capacity is unscheduled for this service date; a compatible reverse-lane consignment would remove an empty run.'::text AS finding
FROM public.freight_route_instances i
JOIN public.freight_repeat_routes r ON r.id = i.route_id
WHERE coalesce(i.reserved_capacity_kg,0) > 0;

CREATE OR REPLACE VIEW public.v_opt_fleet_utilisation
WITH (security_invoker = on) AS
SELECT
  f.vehicle_id, f.vehicle_class, f.payload_capacity_kg, f.base_label, f.capability_status,
  count(d.id)::int AS assigned_requests,
  max(d.created_at) AS last_assigned_at,
  CASE WHEN count(d.id) = 0 THEN 'IDLE' ELSE 'UTILISED' END AS utilisation_state
FROM public.logistics_fleet_capacity f
LEFT JOIN public.logistics_dispatch_requests d ON d.assigned_vehicle_id = f.vehicle_id
GROUP BY f.vehicle_id, f.vehicle_class, f.payload_capacity_kg, f.base_label, f.capability_status;

CREATE OR REPLACE VIEW public.v_opt_matching_performance
WITH (security_invoker = on) AS
SELECT
  mode, outcome, count(*)::int AS runs,
  round(avg(candidate_count)::numeric, 2) AS avg_candidates,
  round(avg(eligible_count)::numeric, 2) AS avg_eligible,
  percentile_disc(0.5) WITHIN GROUP (ORDER BY matching_duration_ms) AS median_duration_ms,
  CASE WHEN count(*) >= 20 THEN 'SUFFICIENT' ELSE 'INSUFFICIENT_DATA' END AS evidence
FROM public.logistics_match_runs
GROUP BY mode, outcome;

CREATE OR REPLACE VIEW public.v_opt_executive_summary
WITH (security_invoker = on) AS
SELECT
  (SELECT count(*) FROM public.delivery_orders)::int AS delivery_orders,
  (SELECT count(*) FROM public.freight_consignments)::int AS consignments,
  (SELECT count(*) FROM public.freight_route_instances)::int AS route_instances,
  (SELECT count(*) FROM public.logistics_dispatch_requests)::int AS dispatch_requests,
  (SELECT count(*) FROM public.logistics_fleet_capacity)::int AS registered_vehicles,
  (SELECT count(*) FROM public.logistics_hubs WHERE upper(status) = 'ACTIVE')::int AS active_hubs,
  (SELECT count(*) FROM public.logistics_exceptions)::int AS exceptions,
  (SELECT coalesce(sum(total),0) FROM public.freight_invoices WHERE voided_at IS NULL) AS invoiced_total,
  (SELECT coalesce(sum(paid_total),0) FROM public.freight_invoices WHERE voided_at IS NULL) AS collected_total,
  'INSUFFICIENT COST DATA'::text AS contribution_margin,
  'Carrier, hub and infrastructure cost inputs are not recorded, so contribution and profitability cannot be computed.'::text AS contribution_note,
  (SELECT count(*) FROM public.opt_measurements WHERE sufficiency = 'SUFFICIENT')::int AS sufficient_measurements,
  (SELECT count(*) FROM public.opt_measurements WHERE sufficiency <> 'SUFFICIENT')::int AS insufficient_measurements,
  (SELECT count(*) FROM public.opt_optimizations WHERE state = 'ADOPTED')::int AS adopted_optimizations,
  (SELECT count(*) FROM public.opt_optimizations WHERE state = 'BLOCKED')::int AS blocked_optimizations,
  (SELECT count(*) FROM public.opt_automation_registry WHERE automation_allowed)::int AS automations_allowed,
  (SELECT count(*) FROM public.opt_automation_registry WHERE NOT automation_allowed)::int AS automations_refused,
  (SELECT count(*) FROM public.ai_model_registry WHERE configured AND active)::int AS configured_ai_models;

GRANT SELECT ON public.v_opt_lane_intelligence, public.v_opt_capacity_position,
  public.v_opt_empty_leg_candidates, public.v_opt_fleet_utilisation,
  public.v_opt_matching_performance, public.v_opt_executive_summary TO authenticated, service_role;