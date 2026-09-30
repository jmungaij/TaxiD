-- =====================================================================
-- STAGE 10B — AI OPERATIONS COMPLETION
-- Preserves every Stage 10A control. Adds: detectors, hashed context,
-- model governance, domain adapter map, execution-time revalidation,
-- approval binding, domain-command idempotency, non-action model,
-- security ledger.
-- =====================================================================

-- ---------- 1. DETECTOR FRAMEWORK ----------
CREATE TABLE public.ai_detectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  domain text NOT NULL,
  name text NOT NULL,
  event_source text NOT NULL,
  trigger_condition text NOT NULL,
  default_severity text NOT NULL CHECK (default_severity IN ('P0','P1','P2','P3')),
  confidence_floor numeric NOT NULL DEFAULT 0.50 CHECK (confidence_floor >= 0 AND confidence_floor <= 1),
  recommendation_type text,
  active boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);
GRANT SELECT ON public.ai_detectors TO authenticated;
GRANT ALL ON public.ai_detectors TO service_role;
ALTER TABLE public.ai_detectors ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_detectors_read ON public.ai_detectors FOR SELECT TO authenticated
  USING (public.ai_ops_is_governor(auth.uid()));

CREATE TABLE public.ai_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detector_code text NOT NULL,
  detector_version integer NOT NULL,
  tenant_id uuid,
  source_event_table text NOT NULL,
  source_event_id uuid,
  source_event_ref text,
  entity_type text NOT NULL,
  entity_id uuid,
  entity_ref text,
  severity text NOT NULL CHECK (severity IN ('P0','P1','P2','P3')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  dedupe_key text NOT NULL UNIQUE,
  detected_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','ASSESSED','RECOMMENDED','NO_ACTION','DISMISSED','EXPIRED')),
  recommendation_id uuid REFERENCES public.ai_recommendations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_findings_detector ON public.ai_findings (detector_code, detected_at DESC);
CREATE INDEX ai_findings_entity ON public.ai_findings (entity_type, entity_id);
CREATE INDEX ai_findings_status ON public.ai_findings (status, severity);
GRANT SELECT ON public.ai_findings TO authenticated;
GRANT ALL ON public.ai_findings TO service_role;
ALTER TABLE public.ai_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_findings_read ON public.ai_findings FOR SELECT TO authenticated
  USING (public.ai_ops_is_governor(auth.uid()));

-- ---------- 2. CONTEXT INTEGRITY ----------
CREATE TABLE public.ai_context_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id uuid NOT NULL REFERENCES public.ai_findings(id) ON DELETE CASCADE,
  context_version integer NOT NULL DEFAULT 1,
  sources jsonb NOT NULL,
  snapshot jsonb NOT NULL,
  context_hash text NOT NULL,
  assembled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (finding_id, context_version)
);
CREATE INDEX ai_ctx_hash ON public.ai_context_snapshots (context_hash);
GRANT SELECT ON public.ai_context_snapshots TO authenticated;
GRANT ALL ON public.ai_context_snapshots TO service_role;
ALTER TABLE public.ai_context_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_ctx_read ON public.ai_context_snapshots FOR SELECT TO authenticated
  USING (public.ai_ops_is_governor(auth.uid()));

-- snapshots are immutable evidence
CREATE OR REPLACE FUNCTION public._ai_context_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'AI context snapshots are immutable evidence';
END $$;
CREATE TRIGGER ai_ctx_immutable BEFORE UPDATE OR DELETE ON public.ai_context_snapshots
  FOR EACH ROW EXECUTE FUNCTION public._ai_context_immutable();

-- ---------- 3. MODEL GOVERNANCE ----------
CREATE TABLE public.ai_model_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  provider text NOT NULL,
  model text NOT NULL,
  model_version text NOT NULL DEFAULT 'unpinned',
  prompt_version text NOT NULL,
  tool_version text NOT NULL,
  max_output_tokens integer NOT NULL DEFAULT 2048,
  timeout_ms integer NOT NULL DEFAULT 60000,
  max_cost_usd numeric NOT NULL DEFAULT 0.50,
  fallback_model_code text,
  confidence_threshold numeric NOT NULL DEFAULT 0.70 CHECK (confidence_threshold >= 0 AND confidence_threshold <= 1),
  grounding_required boolean NOT NULL DEFAULT true,
  configured boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_model_registry TO authenticated;
GRANT ALL ON public.ai_model_registry TO service_role;
ALTER TABLE public.ai_model_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_model_read ON public.ai_model_registry FOR SELECT TO authenticated
  USING (public.ai_ops_is_governor(auth.uid()));

CREATE TABLE public.ai_model_invocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_code text NOT NULL REFERENCES public.ai_model_registry(code),
  agent_id uuid REFERENCES public.ai_agents(id),
  agent_version_id uuid REFERENCES public.ai_agent_versions(id),
  finding_id uuid REFERENCES public.ai_findings(id) ON DELETE SET NULL,
  context_snapshot_id uuid REFERENCES public.ai_context_snapshots(id) ON DELETE SET NULL,
  context_hash text,
  prompt_version text NOT NULL,
  tool_version text NOT NULL,
  policy_version integer,
  outcome text NOT NULL CHECK (outcome IN ('OK','FAILED','TIMEOUT','UNAVAILABLE','NOT_CONFIGURED','FALLBACK_USED','LOW_CONFIDENCE')),
  latency_ms integer,
  tokens_in integer,
  tokens_out integer,
  cost_usd numeric,
  confidence numeric,
  fallback_of text,
  error_message text,
  invoked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_model_inv_model ON public.ai_model_invocations (model_code, invoked_at DESC);
GRANT SELECT ON public.ai_model_invocations TO authenticated;
GRANT ALL ON public.ai_model_invocations TO service_role;
ALTER TABLE public.ai_model_invocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_model_inv_read ON public.ai_model_invocations FOR SELECT TO authenticated
  USING (public.ai_ops_is_governor(auth.uid()));

-- ---------- 4. DOMAIN ADAPTER MAP ----------
CREATE TABLE public.ai_adapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL UNIQUE,
  domain text NOT NULL,
  adapter_code text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  target_service text NOT NULL,
  target_function text,
  automation_allowed boolean NOT NULL DEFAULT false,
  refusal_reason text,
  revalidation_kind text NOT NULL DEFAULT 'NONE',
  required_payload_keys text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_adapters_refusal CHECK (automation_allowed OR refusal_reason IS NOT NULL)
);
GRANT SELECT ON public.ai_adapters TO authenticated;
GRANT ALL ON public.ai_adapters TO service_role;
ALTER TABLE public.ai_adapters ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_adapters_read ON public.ai_adapters FOR SELECT TO authenticated
  USING (public.ai_ops_is_governor(auth.uid()));

-- ---------- 5. DOMAIN-COMMAND IDEMPOTENCY (third layer) ----------
CREATE TABLE public.ai_domain_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  command_key text NOT NULL UNIQUE,
  action_request_id uuid NOT NULL REFERENCES public.ai_action_requests(id) ON DELETE CASCADE,
  adapter_code text NOT NULL,
  target_function text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  invoked_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_domain_commands TO authenticated;
GRANT ALL ON public.ai_domain_commands TO service_role;
ALTER TABLE public.ai_domain_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_domain_cmd_read ON public.ai_domain_commands FOR SELECT TO authenticated
  USING (public.ai_ops_is_governor(auth.uid()));

-- ---------- 6. EXPLICIT NON-ACTION MODEL ----------
CREATE TABLE public.ai_non_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (code IN (
    'ACTION_NOT_REQUIRED','ACTION_NOT_POSSIBLE','ACTION_BLOCKED',
    'ACTION_EXPIRED','STALE_CONTEXT','INSUFFICIENT_EVIDENCE')),
  finding_id uuid REFERENCES public.ai_findings(id) ON DELETE CASCADE,
  recommendation_id uuid REFERENCES public.ai_recommendations(id) ON DELETE SET NULL,
  action_request_id uuid REFERENCES public.ai_action_requests(id) ON DELETE SET NULL,
  entity_type text,
  entity_id uuid,
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  candidates_evaluated jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy_id uuid REFERENCES public.ai_policies(id),
  next_step text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_non_actions_code ON public.ai_non_actions (code, created_at DESC);
GRANT SELECT ON public.ai_non_actions TO authenticated;
GRANT ALL ON public.ai_non_actions TO service_role;
ALTER TABLE public.ai_non_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_non_actions_read ON public.ai_non_actions FOR SELECT TO authenticated
  USING (public.ai_ops_is_governor(auth.uid()));

-- ---------- 7. SECURITY LEDGER ----------
CREATE TABLE public.ai_security_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_key text NOT NULL UNIQUE,
  category text NOT NULL,
  finding_count integer NOT NULL DEFAULT 0,
  severity text NOT NULL CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW','INFO')),
  exploitability text NOT NULL CHECK (exploitability IN ('PROVEN','LIKELY','THEORETICAL','NOT_EXPLOITABLE','UNASSESSED')),
  tenant_impact boolean NOT NULL DEFAULT false,
  financial_impact boolean NOT NULL DEFAULT false,
  authentication_impact boolean NOT NULL DEFAULT false,
  authorization_impact boolean NOT NULL DEFAULT false,
  rls_impact boolean NOT NULL DEFAULT false,
  secret_exposure boolean NOT NULL DEFAULT false,
  production_blocker boolean NOT NULL DEFAULT false,
  remediation_status text NOT NULL DEFAULT 'OPEN'
    CHECK (remediation_status IN ('OPEN','IN_PROGRESS','MITIGATED','FIXED','RISK_ACCEPTED')),
  risk_acceptance_note text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_security_ledger TO authenticated;
GRANT ALL ON public.ai_security_ledger TO service_role;
ALTER TABLE public.ai_security_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_sec_ledger_read ON public.ai_security_ledger FOR SELECT TO authenticated
  USING (public.ai_ops_is_governor(auth.uid()));

-- ---------- 8. BIND CONTEXT / GROUNDING / APPROVAL COLUMNS ----------
ALTER TABLE public.ai_recommendations
  ADD COLUMN IF NOT EXISTS finding_id uuid REFERENCES public.ai_findings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS context_snapshot_id uuid REFERENCES public.ai_context_snapshots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS context_hash text,
  ADD COLUMN IF NOT EXISTS model_invocation_id uuid REFERENCES public.ai_model_invocations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS grounded boolean NOT NULL DEFAULT false;

ALTER TABLE public.ai_action_requests
  ADD COLUMN IF NOT EXISTS context_hash text,
  ADD COLUMN IF NOT EXISTS context_snapshot_id uuid REFERENCES public.ai_context_snapshots(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS policy_version integer,
  ADD COLUMN IF NOT EXISTS adapter_id uuid REFERENCES public.ai_adapters(id);

ALTER TABLE public.ai_action_approvals
  ADD COLUMN IF NOT EXISTS bound_context_hash text,
  ADD COLUMN IF NOT EXISTS bound_policy_version integer,
  ADD COLUMN IF NOT EXISTS bound_entity_id uuid,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- ---------- 9. FUNCTIONS ----------
CREATE OR REPLACE FUNCTION public._ai_is_worker() RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT current_setting('role', true) = 'service_role' OR auth.role() = 'service_role';
$$;
REVOKE ALL ON FUNCTION public._ai_is_worker() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._ai_is_worker() TO service_role;

-- canonical hash of a jsonb payload (stable key ordering via jsonb text form)
CREATE OR REPLACE FUNCTION public.ai_context_hash(_snapshot jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT encode(sha256(convert_to(coalesce(_snapshot,'{}'::jsonb)::text,'UTF8')),'hex');
$$;
GRANT EXECUTE ON FUNCTION public.ai_context_hash(jsonb) TO service_role;

-- 9.1 detector finding intake (worker only, deduped)
CREATE OR REPLACE FUNCTION public.ai_finding_record(
  _detector_code text, _source_event_table text, _entity_type text,
  _evidence jsonb, _confidence numeric, _dedupe_key text,
  _entity_id uuid DEFAULT NULL, _entity_ref text DEFAULT NULL,
  _source_event_id uuid DEFAULT NULL, _source_event_ref text DEFAULT NULL,
  _tenant_id uuid DEFAULT NULL, _severity text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE d public.ai_detectors; v_id uuid; v_sev text;
BEGIN
  IF NOT public._ai_is_worker() THEN
    RAISE EXCEPTION 'Detector findings are recorded only by the orchestration worker';
  END IF;
  SELECT * INTO d FROM public.ai_detectors
    WHERE code = _detector_code AND active ORDER BY version DESC LIMIT 1;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Unknown or inactive detector %', _detector_code; END IF;
  IF coalesce(_evidence,'{}'::jsonb) = '{}'::jsonb THEN
    RAISE EXCEPTION 'A finding must carry evidence from authoritative platform data';
  END IF;
  IF _confidence IS NULL OR _confidence < d.confidence_floor THEN
    RETURN jsonb_build_object('recorded', false, 'reason','BELOW_CONFIDENCE_FLOOR',
      'floor', d.confidence_floor, 'confidence', _confidence);
  END IF;

  SELECT id INTO v_id FROM public.ai_findings WHERE dedupe_key = _dedupe_key;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('finding_id', v_id, 'duplicate', true);
  END IF;

  v_sev := coalesce(_severity, d.default_severity);
  INSERT INTO public.ai_findings (detector_code, detector_version, tenant_id, source_event_table,
    source_event_id, source_event_ref, entity_type, entity_id, entity_ref, severity, evidence,
    confidence, dedupe_key)
  VALUES (d.code, d.version, _tenant_id, _source_event_table, _source_event_id, _source_event_ref,
    _entity_type, _entity_id, _entity_ref, v_sev, _evidence, _confidence, _dedupe_key)
  RETURNING id INTO v_id;

  INSERT INTO public.ai_audit_events (event_type, actor_kind, detail)
  VALUES ('DETECTOR_FINDING', 'AGENT', jsonb_build_object(
    'finding_id', v_id, 'detector', d.code, 'detector_version', d.version, 'severity', v_sev));

  RETURN jsonb_build_object('finding_id', v_id, 'duplicate', false, 'severity', v_sev,
    'detector', d.code, 'detector_version', d.version);
END $$;
REVOKE ALL ON FUNCTION public.ai_finding_record(text,text,text,jsonb,numeric,text,uuid,text,uuid,text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_finding_record(text,text,text,jsonb,numeric,text,uuid,text,uuid,text,uuid,text) TO service_role;

-- 9.2 context assembly (worker only, hashed, immutable)
CREATE OR REPLACE FUNCTION public.ai_context_assemble(
  _finding_id uuid, _sources jsonb, _snapshot jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f public.ai_findings; v_ver integer; v_hash text; v_id uuid;
BEGIN
  IF NOT public._ai_is_worker() THEN
    RAISE EXCEPTION 'Context snapshots are assembled only by the orchestration worker';
  END IF;
  SELECT * INTO f FROM public.ai_findings WHERE id = _finding_id;
  IF f.id IS NULL THEN RAISE EXCEPTION 'Unknown finding'; END IF;
  IF coalesce(_snapshot,'{}'::jsonb) = '{}'::jsonb OR coalesce(_sources,'[]'::jsonb) = '[]'::jsonb THEN
    INSERT INTO public.ai_non_actions (code, finding_id, entity_type, entity_id, reason, evidence)
    VALUES ('INSUFFICIENT_EVIDENCE', f.id, f.entity_type, f.entity_id,
      'No authoritative sources could be assembled for this finding', coalesce(f.evidence,'{}'::jsonb));
    UPDATE public.ai_findings SET status = 'NO_ACTION' WHERE id = f.id;
    RETURN jsonb_build_object('assembled', false, 'code','INSUFFICIENT_EVIDENCE');
  END IF;

  SELECT coalesce(max(context_version),0) + 1 INTO v_ver
    FROM public.ai_context_snapshots WHERE finding_id = f.id;
  v_hash := public.ai_context_hash(_snapshot);

  INSERT INTO public.ai_context_snapshots (finding_id, context_version, sources, snapshot, context_hash)
  VALUES (f.id, v_ver, _sources, _snapshot, v_hash) RETURNING id INTO v_id;

  UPDATE public.ai_findings SET status = 'ASSESSED' WHERE id = f.id AND status = 'OPEN';

  INSERT INTO public.ai_audit_events (event_type, actor_kind, detail)
  VALUES ('CONTEXT_ASSEMBLED','AGENT', jsonb_build_object(
    'finding_id', f.id, 'context_snapshot_id', v_id, 'context_version', v_ver, 'context_hash', v_hash));

  RETURN jsonb_build_object('assembled', true, 'context_snapshot_id', v_id,
    'context_version', v_ver, 'context_hash', v_hash);
END $$;
REVOKE ALL ON FUNCTION public.ai_context_assemble(uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_context_assemble(uuid,jsonb,jsonb) TO service_role;

-- 9.3 model invocation log (worker only)
CREATE OR REPLACE FUNCTION public.ai_model_invocation_record(
  _model_code text, _outcome text, _prompt_version text DEFAULT NULL,
  _tool_version text DEFAULT NULL, _finding_id uuid DEFAULT NULL,
  _context_snapshot_id uuid DEFAULT NULL, _latency_ms integer DEFAULT NULL,
  _tokens_in integer DEFAULT NULL, _tokens_out integer DEFAULT NULL,
  _cost_usd numeric DEFAULT NULL, _confidence numeric DEFAULT NULL,
  _fallback_of text DEFAULT NULL, _error text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m public.ai_model_registry; v_id uuid; v_hash text; v_outcome text := _outcome;
BEGIN
  IF NOT public._ai_is_worker() THEN
    RAISE EXCEPTION 'Model invocations are recorded only by the orchestration worker';
  END IF;
  SELECT * INTO m FROM public.ai_model_registry WHERE code = _model_code;
  IF m.id IS NULL THEN RAISE EXCEPTION 'Model % is not in the registry', _model_code; END IF;
  IF NOT m.configured AND v_outcome = 'OK' THEN v_outcome := 'NOT_CONFIGURED'; END IF;
  IF _cost_usd IS NOT NULL AND _cost_usd > m.max_cost_usd THEN
    v_outcome := 'FAILED';
  END IF;
  IF v_outcome = 'OK' AND _confidence IS NOT NULL AND _confidence < m.confidence_threshold THEN
    v_outcome := 'LOW_CONFIDENCE';
  END IF;
  SELECT context_hash INTO v_hash FROM public.ai_context_snapshots WHERE id = _context_snapshot_id;

  INSERT INTO public.ai_model_invocations (model_code, finding_id, context_snapshot_id, context_hash,
    prompt_version, tool_version, outcome, latency_ms, tokens_in, tokens_out, cost_usd, confidence,
    fallback_of, error_message)
  VALUES (m.code, _finding_id, _context_snapshot_id, v_hash,
    coalesce(_prompt_version, m.prompt_version), coalesce(_tool_version, m.tool_version),
    v_outcome, _latency_ms, _tokens_in, _tokens_out, _cost_usd, _confidence, _fallback_of, _error)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('model_invocation_id', v_id, 'outcome', v_outcome,
    'model_configured', m.configured, 'context_hash', v_hash);
END $$;
REVOKE ALL ON FUNCTION public.ai_model_invocation_record(text,text,text,text,uuid,uuid,integer,integer,integer,numeric,numeric,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_model_invocation_record(text,text,text,text,uuid,uuid,integer,integer,integer,numeric,numeric,text,text) TO service_role;

-- 9.4 grounding: bind a recommendation to finding + context + model invocation
CREATE OR REPLACE FUNCTION public.ai_recommendation_ground(
  _recommendation_id uuid, _finding_id uuid, _context_snapshot_id uuid, _model_invocation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.ai_recommendations; c public.ai_context_snapshots; mi public.ai_model_invocations;
BEGIN
  IF NOT public._ai_is_worker() THEN
    RAISE EXCEPTION 'Recommendation grounding is performed only by the orchestration worker';
  END IF;
  SELECT * INTO r FROM public.ai_recommendations WHERE id = _recommendation_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Unknown recommendation'; END IF;
  SELECT * INTO c FROM public.ai_context_snapshots WHERE id = _context_snapshot_id;
  IF c.id IS NULL OR c.finding_id <> _finding_id THEN
    RAISE EXCEPTION 'The context snapshot does not belong to the finding';
  END IF;
  SELECT * INTO mi FROM public.ai_model_invocations WHERE id = _model_invocation_id;
  IF mi.id IS NULL THEN RAISE EXCEPTION 'Unknown model invocation'; END IF;

  IF coalesce(r.evidence,'{}'::jsonb) = '{}'::jsonb OR mi.outcome <> 'OK' THEN
    INSERT INTO public.ai_non_actions (code, finding_id, recommendation_id, entity_type, entity_id, reason, evidence)
    VALUES ('INSUFFICIENT_EVIDENCE', _finding_id, r.id, r.entity_type, r.entity_id,
      format('Recommendation is not grounded: model outcome %s', mi.outcome),
      jsonb_build_object('model_outcome', mi.outcome, 'context_hash', c.context_hash));
    UPDATE public.ai_recommendations SET status = 'DISMISSED', grounded = false WHERE id = r.id;
    RETURN jsonb_build_object('grounded', false, 'code','INSUFFICIENT_EVIDENCE', 'model_outcome', mi.outcome);
  END IF;

  UPDATE public.ai_recommendations
     SET finding_id = _finding_id, context_snapshot_id = c.id, context_hash = c.context_hash,
         model_invocation_id = mi.id, grounded = true, updated_at = now()
   WHERE id = r.id;
  UPDATE public.ai_findings SET status = 'RECOMMENDED', recommendation_id = r.id WHERE id = _finding_id;

  INSERT INTO public.ai_audit_events (event_type, recommendation_id, actor_kind, detail)
  VALUES ('RECOMMENDATION_GROUNDED', r.id, 'AGENT', jsonb_build_object(
    'finding_id', _finding_id, 'context_hash', c.context_hash,
    'model_invocation_id', mi.id, 'model_code', mi.model_code));

  RETURN jsonb_build_object('grounded', true, 'context_hash', c.context_hash);
END $$;
REVOKE ALL ON FUNCTION public.ai_recommendation_ground(uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_recommendation_ground(uuid,uuid,uuid,uuid) TO service_role;

-- 9.5 non-action recording
CREATE OR REPLACE FUNCTION public.ai_non_action_record(
  _code text, _reason text, _evidence jsonb DEFAULT '{}'::jsonb,
  _finding_id uuid DEFAULT NULL, _recommendation_id uuid DEFAULT NULL,
  _action_request_id uuid DEFAULT NULL, _candidates jsonb DEFAULT '[]'::jsonb,
  _next_step text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (public._ai_is_worker() OR public.ai_ops_is_governor(auth.uid())) THEN
    RAISE EXCEPTION 'Not authorised to record an AI non-action';
  END IF;
  IF coalesce(trim(_reason),'') = '' THEN
    RAISE EXCEPTION 'A non-action must record why the system did not act';
  END IF;
  INSERT INTO public.ai_non_actions (code, finding_id, recommendation_id, action_request_id,
    reason, evidence, candidates_evaluated, next_step)
  VALUES (_code, _finding_id, _recommendation_id, _action_request_id,
    _reason, coalesce(_evidence,'{}'::jsonb), coalesce(_candidates,'[]'::jsonb), _next_step)
  RETURNING id INTO v_id;

  IF _finding_id IS NOT NULL THEN
    UPDATE public.ai_findings SET status = 'NO_ACTION' WHERE id = _finding_id;
  END IF;

  INSERT INTO public.ai_audit_events (event_type, recommendation_id, action_request_id, actor_id, actor_kind, detail)
  VALUES ('NON_ACTION_RECORDED', _recommendation_id, _action_request_id, auth.uid(),
    CASE WHEN auth.uid() IS NULL THEN 'AGENT' ELSE 'OPERATOR' END,
    jsonb_build_object('code', _code, 'reason', _reason, 'non_action_id', v_id));

  RETURN jsonb_build_object('non_action_id', v_id, 'code', _code);
END $$;
REVOKE ALL ON FUNCTION public.ai_non_action_record(text,text,jsonb,uuid,uuid,uuid,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_non_action_record(text,text,jsonb,uuid,uuid,uuid,jsonb,text) TO authenticated, service_role;

-- 9.6 execution-time revalidation: re-read authoritative state and compare hashes
CREATE OR REPLACE FUNCTION public.ai_context_revalidate(_action_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.ai_action_requests; ad public.ai_adapters; c public.ai_context_snapshots;
  v_live jsonb := '{}'::jsonb; v_hash text; v_reasons text[] := '{}'; v_key text;
BEGIN
  IF NOT (public._ai_is_worker() OR public.ai_ops_is_governor(auth.uid())) THEN
    RAISE EXCEPTION 'Not authorised to revalidate AI action context';
  END IF;
  SELECT * INTO a FROM public.ai_action_requests WHERE id = _action_request_id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Unknown action request'; END IF;
  SELECT * INTO ad FROM public.ai_adapters WHERE action_type = a.action_type AND active;
  SELECT * INTO c FROM public.ai_context_snapshots WHERE id = a.context_snapshot_id;

  IF ad.id IS NULL THEN
    v_reasons := v_reasons || 'NO_ADAPTER';
  ELSIF NOT ad.automation_allowed THEN
    v_reasons := v_reasons || 'AUTOMATION_NOT_PERMITTED';
  ELSE
    FOREACH v_key IN ARRAY ad.required_payload_keys LOOP
      IF coalesce(a.payload->>v_key,'') = '' THEN
        v_reasons := v_reasons || ('MISSING_PAYLOAD_' || upper(v_key));
      END IF;
    END LOOP;
  END IF;

  IF a.expires_at IS NOT NULL AND a.expires_at < now() THEN
    v_reasons := v_reasons || 'ACTION_EXPIRED';
  END IF;

  -- domain revalidation: re-read live authoritative state for the adapter's domain
  IF ad.revalidation_kind = 'DISPATCH_REQUEST' AND (a.payload->>'dispatch_request_id') IS NOT NULL THEN
    SELECT jsonb_build_object(
             'status', d.status,
             'assigned_vehicle_id', d.assigned_vehicle_id,
             'assigned_driver_id', d.assigned_driver_id)
      INTO v_live
      FROM public.logistics_dispatch_requests d
     WHERE d.id = (a.payload->>'dispatch_request_id')::uuid;
    IF v_live IS NULL THEN
      v_reasons := v_reasons || 'ENTITY_NOT_FOUND';
      v_live := '{}'::jsonb;
    END IF;
  END IF;

  v_hash := public.ai_context_hash(v_live);

  IF c.id IS NOT NULL AND c.snapshot ? 'revalidation_subject' THEN
    IF public.ai_context_hash(c.snapshot->'revalidation_subject') <> v_hash THEN
      v_reasons := v_reasons || 'CONTEXT_CHANGED';
    END IF;
  END IF;

  -- approval binding: an approval recorded against different context/policy is stale
  IF a.classification = 'APPROVAL_REQUIRED' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ai_action_approvals ap
       WHERE ap.action_request_id = a.id AND ap.decision = 'APPROVED'
         AND (ap.expires_at IS NULL OR ap.expires_at > now())
         AND (ap.bound_context_hash IS NULL OR ap.bound_context_hash = a.context_hash)
         AND (ap.bound_policy_version IS NULL OR ap.bound_policy_version = a.policy_version)
    ) THEN
      v_reasons := v_reasons || 'APPROVAL_STALE_OR_MISSING';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'action_request_id', a.id,
    'valid', array_length(v_reasons,1) IS NULL,
    'reasons', to_jsonb(v_reasons),
    'live_state', v_live,
    'live_hash', v_hash,
    'adapter_code', ad.adapter_code,
    'automation_allowed', coalesce(ad.automation_allowed,false));
END $$;
REVOKE ALL ON FUNCTION public.ai_context_revalidate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_context_revalidate(uuid) TO authenticated, service_role;

-- 9.7 approval decision now binds context + policy version + expiry
CREATE OR REPLACE FUNCTION public.ai_action_decide(
  _action_request_id uuid, _decision text, _reason text, _evidence_reviewed boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.ai_action_requests; v_actor uuid := auth.uid(); v_state public.ai_action_state;
        v_reval jsonb;
BEGIN
  IF NOT public.ai_ops_is_governor(v_actor) THEN
    RAISE EXCEPTION 'Not authorised to decide AI action approvals';
  END IF;
  IF _decision NOT IN ('APPROVED','REJECTED','DEFERRED','ESCALATED') THEN
    RAISE EXCEPTION 'Invalid decision %', _decision;
  END IF;
  IF coalesce(trim(_reason),'') = '' THEN
    RAISE EXCEPTION 'Record a reason for the decision';
  END IF;
  IF NOT _evidence_reviewed THEN
    RAISE EXCEPTION 'The evidence must be reviewed before a decision is recorded';
  END IF;

  SELECT * INTO a FROM public.ai_action_requests WHERE id = _action_request_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Unknown action request'; END IF;
  IF a.state <> 'APPROVAL_PENDING' THEN
    RAISE EXCEPTION 'Action request is % and is not awaiting a decision', a.state;
  END IF;
  IF a.expires_at IS NOT NULL AND a.expires_at < now() THEN
    UPDATE public.ai_action_requests SET state = 'EXPIRED' WHERE id = a.id;
    PERFORM public.ai_non_action_record('ACTION_EXPIRED',
      'The approval window closed before a decision was recorded',
      jsonb_build_object('expired_at', a.expires_at), NULL, a.recommendation_id, a.id, '[]'::jsonb,
      'Regenerate the recommendation against current data');
    RAISE EXCEPTION 'The approval window has expired; regenerate the recommendation';
  END IF;
  IF a.requested_by IS NOT NULL AND a.requested_by = v_actor THEN
    RAISE EXCEPTION 'The requester may not approve their own action';
  END IF;

  -- an approval may only be granted against currently valid state
  IF _decision = 'APPROVED' THEN
    v_reval := public.ai_context_revalidate(a.id);
    IF NOT (v_reval->>'valid')::boolean
       AND NOT (v_reval->'reasons' ? 'APPROVAL_STALE_OR_MISSING') THEN
      PERFORM public.ai_non_action_record('STALE_CONTEXT',
        'Approval refused: authoritative state changed after the recommendation was produced',
        v_reval, NULL, a.recommendation_id, a.id, '[]'::jsonb,
        'Regenerate the recommendation from current state');
      RAISE EXCEPTION 'Cannot approve: % ', v_reval->>'reasons';
    END IF;
  END IF;

  INSERT INTO public.ai_action_approvals (action_request_id, decision, approver_id, reason,
    evidence_reviewed, bound_context_hash, bound_policy_version, bound_entity_id, expires_at)
  VALUES (a.id, _decision, v_actor, _reason, _evidence_reviewed,
    a.context_hash, a.policy_version, a.entity_id,
    least(coalesce(a.expires_at, now() + interval '2 hours'), now() + interval '2 hours'));

  v_state := CASE _decision
    WHEN 'APPROVED' THEN 'APPROVED'::public.ai_action_state
    WHEN 'REJECTED' THEN 'REJECTED'::public.ai_action_state
    ELSE 'APPROVAL_PENDING'::public.ai_action_state END;

  UPDATE public.ai_action_requests SET state = v_state, updated_at = now() WHERE id = a.id;
  IF _decision = 'REJECTED' THEN
    UPDATE public.ai_recommendations SET status = 'DISMISSED' WHERE id = a.recommendation_id;
  END IF;

  INSERT INTO public.ai_audit_events (event_type, recommendation_id, action_request_id, actor_id, actor_kind, detail)
  VALUES ('APPROVAL_DECIDED', a.recommendation_id, a.id, v_actor, 'OPERATOR',
          jsonb_build_object('decision', _decision, 'reason', _reason,
            'bound_context_hash', a.context_hash, 'bound_policy_version', a.policy_version));

  RETURN jsonb_build_object('action_request_id', a.id, 'state', v_state, 'decision', _decision,
    'bound_context_hash', a.context_hash);
END $$;

-- 9.8 execution: adapter map + revalidation + domain-command idempotency
CREATE OR REPLACE FUNCTION public.ai_action_execute(_action_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.ai_action_requests; ad public.ai_adapters; v_attempt integer; v_exec uuid; v_result jsonb;
  v_verified boolean := false; v_verification jsonb := '{}'::jsonb; v_actor uuid := auth.uid();
  v_req_id uuid; v_reval jsonb; v_cmd_key text; v_cmd_id uuid; v_prior jsonb;
BEGIN
  IF NOT public._ai_is_worker() THEN
    RAISE EXCEPTION 'AI actions are executed only by the orchestration worker';
  END IF;

  SELECT * INTO a FROM public.ai_action_requests WHERE id = _action_request_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Unknown action request'; END IF;
  IF a.state = 'EXECUTED' THEN
    RETURN jsonb_build_object('action_request_id', a.id, 'state','EXECUTED','duplicate', true);
  END IF;
  IF a.state <> 'APPROVED' THEN
    RAISE EXCEPTION 'Action request is % — only an APPROVED action may execute', a.state;
  END IF;
  IF a.classification IN ('HUMAN_ONLY','BLOCKED') THEN
    RAISE EXCEPTION 'Action class % may never be executed by the AI layer', a.classification;
  END IF;

  -- adapter boundary: no adapter, or automation not permitted → explicit non-action
  SELECT * INTO ad FROM public.ai_adapters WHERE action_type = a.action_type AND active;
  IF ad.id IS NULL OR NOT ad.automation_allowed THEN
    PERFORM public.ai_non_action_record('ACTION_NOT_POSSIBLE',
      coalesce(ad.refusal_reason,
        format('No approved execution adapter exists for %s', a.action_type)),
      jsonb_build_object('action_type', a.action_type, 'adapter_code', ad.adapter_code),
      NULL, a.recommendation_id, a.id, '[]'::jsonb,
      'Route this action to the owning domain team for a human decision');
    UPDATE public.ai_action_requests SET state = 'CANCELLED', updated_at = now() WHERE id = a.id;
    RETURN jsonb_build_object('action_request_id', a.id, 'state','CANCELLED',
      'executed', false, 'code','ACTION_NOT_POSSIBLE');
  END IF;

  -- execution-time revalidation against authoritative state
  v_reval := public.ai_context_revalidate(a.id);
  IF NOT (v_reval->>'valid')::boolean THEN
    PERFORM public.ai_non_action_record(
      CASE WHEN v_reval->'reasons' ? 'ACTION_EXPIRED' THEN 'ACTION_EXPIRED' ELSE 'STALE_CONTEXT' END,
      'Execution refused: authoritative state, approval binding or policy changed after approval',
      v_reval, NULL, a.recommendation_id, a.id, '[]'::jsonb,
      'Regenerate the recommendation from current authoritative state');
    UPDATE public.ai_action_requests SET state = 'CANCELLED', updated_at = now() WHERE id = a.id;
    INSERT INTO public.ai_audit_events (event_type, recommendation_id, action_request_id, actor_kind, detail)
    VALUES ('STALE_ACTION_CONTEXT', a.recommendation_id, a.id, 'AGENT', v_reval);
    RETURN jsonb_build_object('action_request_id', a.id, 'state','CANCELLED',
      'executed', false, 'code','STALE_ACTION_CONTEXT', 'reasons', v_reval->'reasons');
  END IF;

  -- domain-command idempotency (third layer, below recommendation + action request)
  v_cmd_key := ad.adapter_code || ':' || a.action_type || ':' ||
               coalesce(a.payload->>'dispatch_request_id', coalesce(a.entity_id::text,'-')) || ':' ||
               coalesce(a.context_hash,'-');
  SELECT id, result INTO v_cmd_id, v_prior FROM public.ai_domain_commands WHERE command_key = v_cmd_key;
  IF v_cmd_id IS NOT NULL THEN
    RETURN jsonb_build_object('action_request_id', a.id, 'state', a.state,
      'duplicate_domain_command', true, 'result', v_prior);
  END IF;

  SELECT coalesce(max(attempt),0) + 1 INTO v_attempt
    FROM public.ai_action_executions WHERE action_request_id = a.id;

  UPDATE public.ai_action_requests SET state = 'EXECUTING', adapter_id = ad.id, updated_at = now() WHERE id = a.id;
  INSERT INTO public.ai_action_executions (action_request_id, attempt, invoked_service, executed_by)
  VALUES (a.id, v_attempt, ad.target_service, v_actor) RETURNING id INTO v_exec;

  BEGIN
    IF ad.target_function = 'logistics_dispatch_match' THEN
      v_req_id := (a.payload->>'dispatch_request_id')::uuid;
      v_result := public.logistics_dispatch_match(v_req_id, true);
      SELECT to_jsonb(d) - 'payload' INTO v_verification
        FROM public.logistics_dispatch_requests d WHERE d.id = v_req_id;
      v_verified := (v_verification->>'assigned_vehicle_id') IS NOT NULL;
    ELSIF ad.target_function = 'logistics_dispatch_override' THEN
      v_req_id := (a.payload->>'dispatch_request_id')::uuid;
      v_result := public.logistics_dispatch_override(
        v_req_id, nullif(a.payload->>'vehicle_id','')::uuid,
        nullif(a.payload->>'driver_id','')::uuid,
        coalesce(a.payload->>'reason','AI-assisted substitution, approved by operations'));
      SELECT to_jsonb(d) - 'payload' INTO v_verification
        FROM public.logistics_dispatch_requests d WHERE d.id = v_req_id;
      v_verified := (v_verification->>'assigned_vehicle_id') = (a.payload->>'vehicle_id');
    ELSE
      RAISE EXCEPTION 'Adapter % declares target function %, which is not an approved AI entry point',
        ad.adapter_code, coalesce(ad.target_function,'(none)');
    END IF;

    INSERT INTO public.ai_domain_commands (command_key, action_request_id, adapter_code,
      target_function, result)
    VALUES (v_cmd_key, a.id, ad.adapter_code, ad.target_function, coalesce(v_result,'{}'::jsonb));

    UPDATE public.ai_action_executions
       SET service_result = coalesce(v_result,'{}'::jsonb), succeeded = true,
           verified = v_verified, verification = coalesce(v_verification,'{}'::jsonb), finished_at = now()
     WHERE id = v_exec;

    IF v_verified THEN
      UPDATE public.ai_action_requests SET state = 'EXECUTED', updated_at = now() WHERE id = a.id;
      UPDATE public.ai_recommendations SET status = 'ACTIONED' WHERE id = a.recommendation_id;
    ELSE
      UPDATE public.ai_action_requests SET state = 'FAILED', updated_at = now() WHERE id = a.id;
    END IF;

    INSERT INTO public.ai_audit_events (event_type, recommendation_id, action_request_id, actor_id, actor_kind, detail)
    VALUES (CASE WHEN v_verified THEN 'ACTION_EXECUTED' ELSE 'ACTION_UNVERIFIED' END,
            a.recommendation_id, a.id, v_actor, 'AGENT',
            jsonb_build_object('attempt', v_attempt, 'adapter', ad.adapter_code,
              'service', ad.target_service, 'verified', v_verified, 'command_key', v_cmd_key));

    RETURN jsonb_build_object('action_request_id', a.id,
      'state', CASE WHEN v_verified THEN 'EXECUTED' ELSE 'FAILED' END,
      'verified', v_verified, 'attempt', v_attempt, 'adapter', ad.adapter_code, 'result', v_result);
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.ai_action_executions
       SET succeeded = false, verified = false, error_code = SQLSTATE,
           error_message = SQLERRM, finished_at = now()
     WHERE id = v_exec;
    UPDATE public.ai_action_requests SET state = 'FAILED', updated_at = now() WHERE id = a.id;
    INSERT INTO public.ai_audit_events (event_type, recommendation_id, action_request_id, actor_id, actor_kind, detail)
    VALUES ('ACTION_FAILED', a.recommendation_id, a.id, v_actor, 'AGENT',
            jsonb_build_object('attempt', v_attempt, 'sqlstate', SQLSTATE, 'error', SQLERRM));
    RETURN jsonb_build_object('action_request_id', a.id, 'state','FAILED',
      'verified', false, 'error', SQLERRM);
  END;
END $$;

-- ---------- 10. SEED: DETECTORS ----------
INSERT INTO public.ai_detectors (code, domain, name, event_source, trigger_condition, default_severity, confidence_floor, recommendation_type) VALUES
 ('DSP_NO_ELIGIBLE_CAPACITY','dispatch','No eligible capacity','logistics_dispatch_match_runs','A match run completes with zero eligible candidates','P1',0.60,'DISPATCH_REASSIGNMENT'),
 ('DSP_DRIVER_REJECTION','dispatch','Driver rejection','logistics_dispatch_events','A driver declines an assignment','P2',0.60,'DISPATCH_REASSIGNMENT'),
 ('DSP_VEHICLE_FAILURE','dispatch','Vehicle failure','logistics_dispatch_events','A vehicle is reported unavailable mid-assignment','P1',0.60,'VEHICLE_SUBSTITUTION'),
 ('DSP_PROLONGED_MATCHING','dispatch','Prolonged matching','logistics_dispatch_requests','A request stays unmatched beyond the matching budget','P2',0.55,'DISPATCH_REASSIGNMENT'),
 ('DSP_RESERVATION_CONFLICT','dispatch','Reservation conflict','logistics_dispatch_reservations','Two reservations contend for the same capacity window','P1',0.70,NULL),
 ('SLA_PICKUP_RISK','sla','Pickup at risk','logistics_events','Pickup has not occurred within the pickup window','P2',0.55,NULL),
 ('SLA_TRANSIT_DELAY','sla','Transit delay','logistics_route_events','Transit duration exceeds the planned leg duration','P2',0.55,NULL),
 ('SLA_DELIVERY_RISK','sla','Delivery at risk','logistics_events','Projected delivery time exceeds the promised window','P1',0.60,NULL),
 ('SLA_ETA_DETERIORATION','sla','ETA deterioration','logistics_route_events','ETA degrades materially between consecutive updates','P2',0.55,NULL),
 ('SLA_BREACH','sla','SLA breach','logistics_events','A promised milestone has been missed','P0',0.70,NULL),
 ('CAP_SHORTAGE','capacity','Capacity shortage','freight_route_allocations','Demand exceeds committed capacity on a corridor','P1',0.60,NULL),
 ('CAP_SURPLUS','capacity','Capacity surplus','freight_route_allocations','Committed capacity materially exceeds booked load','P3',0.55,NULL),
 ('CAP_UTILISATION_ANOMALY','capacity','Abnormal utilisation','v_freight_route_performance','Utilisation deviates from the corridor baseline','P2',0.55,NULL),
 ('CAP_ROUTE_IMBALANCE','capacity','Route imbalance','freight_route_instances','Directional load imbalance persists across instances','P3',0.55,NULL),
 ('HUB_CONGESTION','hub','Hub congestion','logistics_hub_scans','Inbound volume exceeds hub processing capacity','P1',0.60,NULL),
 ('HUB_DWELL_ANOMALY','hub','Dwell anomaly','logistics_hub_scans','Handling units dwell beyond the hub SLA','P2',0.55,NULL),
 ('HUB_RECEIVING_DISCREPANCY','hub','Receiving discrepancy','logistics_hub_receipts','Received units or weight differ from the manifest','P1',0.70,NULL),
 ('HUB_STAGING_BACKLOG','hub','Staging backlog','logistics_hub_allocations','Sorted units are not loaded before the departure cutoff','P2',0.55,NULL),
 ('HUB_OUTBOUND_SHORTFALL','hub','Outbound capacity shortfall','logistics_hub_manifests','Outbound capacity is insufficient for staged load','P1',0.60,NULL),
 ('EXC_MISSING_CARGO','exception','Missing cargo','logistics_exception_events','Expected handling units are not present at a scan point','P0',0.70,NULL),
 ('EXC_DAMAGE','exception','Damage','logistics_exception_events','Damage is recorded against a handling unit','P1',0.65,NULL),
 ('EXC_SHORT_RECEIPT','exception','Short receipt','logistics_hub_receipts','Fewer units received than dispatched','P1',0.70,NULL),
 ('EXC_FAILED_SCAN','exception','Failed scan','logistics_hub_scans','A required scan event is missing at a custody boundary','P2',0.55,NULL),
 ('EXC_ROUTE_DEVIATION','exception','Repeated route deviation','logistics_route_events','Repeated deviation from the planned route','P2',0.60,NULL),
 ('FIN_PAYMENT_FAILURE','finance','Payment failure','mpesa_transactions','A payment attempt fails or is cancelled','P2',0.65,'PAYMENT_FOLLOWUP'),
 ('FIN_UNPAID_INVOICE','finance','Unpaid invoice','freight_invoices','An invoice passes its due date unpaid','P2',0.65,'PAYMENT_FOLLOWUP'),
 ('FIN_RECONCILIATION_MISMATCH','finance','Reconciliation discrepancy','freight_reconciliation_findings','Executed work and charges do not reconcile','P1',0.70,NULL),
 ('FIN_SETTLEMENT_DISCREPANCY','finance','Settlement discrepancy','freight_settlements','Settlement value differs from the ledger position','P1',0.70,NULL),
 ('CUS_UNUSUAL_CANCELLATION','customer','Unusual cancellation','delivery_orders','Cancellation rate for an account exceeds its baseline','P2',0.55,NULL),
 ('CUS_SERVICE_DETERIORATION','customer','Service deterioration','logistics_events','On-time performance for an account degrades','P2',0.55,NULL),
 ('CUS_REPEATED_FAILURES','customer','Repeated failures','logistics_delivery_attempts','Repeated failed attempts for the same customer','P1',0.60,NULL);

-- ---------- 11. SEED: ADAPTER MAP ----------
INSERT INTO public.ai_adapters (action_type, domain, adapter_code, target_service, target_function,
  automation_allowed, refusal_reason, revalidation_kind, required_payload_keys) VALUES
 ('DISPATCH_REASSIGNMENT','dispatch','adapter.dispatch.reassign','logistics_dispatch','logistics_dispatch_match',
   true, NULL, 'DISPATCH_REQUEST', ARRAY['dispatch_request_id']),
 ('VEHICLE_SUBSTITUTION','dispatch','adapter.dispatch.substitute_vehicle','logistics_dispatch','logistics_dispatch_override',
   true, NULL, 'DISPATCH_REQUEST', ARRAY['dispatch_request_id','vehicle_id']),
 ('DRIVER_SUBSTITUTION','dispatch','adapter.dispatch.substitute_driver','logistics_dispatch','logistics_dispatch_override',
   true, NULL, 'DISPATCH_REQUEST', ARRAY['dispatch_request_id','driver_id']),
 ('CAPACITY_REBALANCE','capacity','adapter.capacity.rebalance','freight_capacity',NULL,
   false,'Capacity commitments are contractual; rebalancing requires a human commercial decision','NONE','{}'),
 ('ROUTE_ADJUSTMENT','route','adapter.route.adjust','freight_routes',NULL,
   false,'Route masters are governed master data and change only through the approve/activate lifecycle','NONE','{}'),
 ('HUB_REPRIORITISATION','hub','adapter.hub.reprioritise','logistics_hub',NULL,
   false,'Hub sortation and staging priority is a physical operations decision made by hub supervisors','NONE','{}'),
 ('SLA_INTERVENTION','sla','adapter.sla.intervene','logistics_sla',NULL,
   false,'SLA interventions change customer commitments and require a human operations decision','NONE','{}'),
 ('SHIPMENT_EXCEPTION_RESOLUTION','exception','adapter.exception.resolve','logistics_exceptions',NULL,
   false,'Exception resolution determines liability and custody and is reserved for a human decision','NONE','{}'),
 ('CUSTOMER_COMMUNICATION','customer','adapter.customer.notify','comms',NULL,
   false,'Outbound customer communication is not auto-sent by the AI layer pending communications governance','NONE','{}'),
 ('INTERNAL_NOTIFICATION','notification','adapter.ops.notify','comms',NULL,
   false,'Notification dispatch is routed through the existing comms engine by an operator','NONE','{}'),
 ('PAYMENT_FOLLOWUP','finance','adapter.finance.followup','freight_finance',NULL,
   false,'Payment follow-up touches financial truth and remains HUMAN_ONLY','NONE','{}'),
 ('TRACKING_ESCALATION','tracking','adapter.tracking.escalate','logistics_tracking',NULL,
   false,'Escalation targets a human on-call operator and is never auto-executed','NONE','{}');

-- ---------- 12. SEED: MODEL REGISTRY (not configured) ----------
INSERT INTO public.ai_model_registry (code, provider, model, model_version, prompt_version, tool_version,
  max_output_tokens, timeout_ms, max_cost_usd, fallback_model_code, confidence_threshold,
  grounding_required, configured, active, notes) VALUES
 ('logistics-ops-primary','lovable-ai-gateway','google/gemini-3.7-flash','unpinned','ops-reasoning-v1','tools-v1',
   2048, 60000, 0.25, 'logistics-ops-fallback', 0.70, true, false, false,
   'Registered but NOT CONFIGURED: no model call is wired, so AI capability must render as not configured.'),
 ('logistics-ops-fallback','lovable-ai-gateway','google/gemini-3.6-flash','unpinned','ops-reasoning-v1','tools-v1',
   1024, 45000, 0.10, NULL, 0.75, true, false, false,
   'Fallback target for the primary reasoning model. Also NOT CONFIGURED.');

-- ---------- 13. SEED: SECURITY LEDGER (recorded, not suppressed) ----------
INSERT INTO public.ai_security_ledger (finding_key, category, finding_count, severity, exploitability,
  tenant_impact, financial_impact, authentication_impact, authorization_impact, rls_impact,
  secret_exposure, production_blocker, remediation_status, evidence) VALUES
 ('linter.rls_enabled_no_policy','RLS', 3, 'CRITICAL','LIKELY', true,false,false,true,true,false,true,'OPEN',
   '{"source":"supabase linter","meaning":"RLS is on but no policy exists, so the table is unreachable or unprotected depending on grants"}'),
 ('linter.extension_in_public','Hardening', 1, 'LOW','THEORETICAL', false,false,false,false,false,false,false,'OPEN',
   '{"source":"supabase linter","meaning":"extension installed in the public schema"}'),
 ('linter.security_definer_anon_executable','Authorization', 126, 'HIGH','LIKELY', true,true,false,true,true,false,true,'OPEN',
   '{"source":"supabase linter","meaning":"SECURITY DEFINER functions executable by anon; each needs an allowlist decision"}'),
 ('linter.security_definer_authenticated_executable','Authorization', 937, 'MEDIUM','THEORETICAL', true,true,false,true,true,false,false,'OPEN',
   '{"source":"supabase linter","meaning":"SECURITY DEFINER functions executable by authenticated; bulk warning class requiring per-domain triage"}');

-- ---------- 14. OPERATIONAL PROJECTIONS ----------
CREATE OR REPLACE VIEW public.v_ai_pipeline_health AS
SELECT
  (SELECT count(*) FROM public.ai_detectors WHERE active) AS active_detectors,
  (SELECT count(*) FROM public.ai_findings) AS findings,
  (SELECT count(*) FROM public.ai_findings WHERE status = 'OPEN') AS findings_open,
  (SELECT count(*) FROM public.ai_context_snapshots) AS context_snapshots,
  (SELECT count(*) FROM public.ai_recommendations WHERE grounded) AS grounded_recommendations,
  (SELECT count(*) FROM public.ai_recommendations WHERE NOT grounded) AS ungrounded_recommendations,
  (SELECT count(*) FROM public.ai_non_actions) AS non_actions,
  (SELECT count(*) FROM public.ai_adapters WHERE automation_allowed AND active) AS automating_adapters,
  (SELECT count(*) FROM public.ai_adapters WHERE NOT automation_allowed AND active) AS refusing_adapters,
  (SELECT count(*) FROM public.ai_model_registry WHERE configured AND active) AS configured_models,
  (SELECT count(*) FROM public.ai_security_ledger WHERE production_blocker AND remediation_status IN ('OPEN','IN_PROGRESS')) AS open_security_blockers;

GRANT SELECT ON public.v_ai_pipeline_health TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_ai_non_action_register AS
SELECT n.id, n.code, n.reason, n.evidence, n.candidates_evaluated, n.next_step, n.created_at,
       f.detector_code, f.severity AS finding_severity, f.entity_type, f.entity_ref,
       r.recommendation_type, ar.action_type, ar.state AS action_state
  FROM public.ai_non_actions n
  LEFT JOIN public.ai_findings f ON f.id = n.finding_id
  LEFT JOIN public.ai_recommendations r ON r.id = n.recommendation_id
  LEFT JOIN public.ai_action_requests ar ON ar.id = n.action_request_id;

GRANT SELECT ON public.v_ai_non_action_register TO authenticated, service_role;