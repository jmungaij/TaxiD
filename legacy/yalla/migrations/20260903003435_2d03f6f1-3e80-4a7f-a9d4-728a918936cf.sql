-- ============ Stage 10: AI operations governance layer ============
DO $$ BEGIN
  CREATE TYPE public.ai_priority AS ENUM ('P0','P1','P2','P3');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ai_action_class AS ENUM ('AUTO_SAFE','APPROVAL_REQUIRED','HUMAN_ONLY','BLOCKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.ai_action_state AS ENUM
    ('PROPOSED','APPROVAL_PENDING','APPROVED','EXECUTING','EXECUTED','FAILED','REJECTED','EXPIRED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- helper: who may see / govern the AI layer ----------
CREATE OR REPLACE FUNCTION public.ai_ops_is_governor(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND (
    public.has_role(_uid,'admin') OR public.has_role(_uid,'super_admin')
  );
$$;

-- ---------- agents ----------
CREATE TABLE IF NOT EXISTS public.ai_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  domain text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_agents TO authenticated;
GRANT ALL ON public.ai_agents TO service_role;
ALTER TABLE public.ai_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_agents_read ON public.ai_agents FOR SELECT TO authenticated
  USING (public.ai_ops_is_governor(auth.uid()));

CREATE TABLE IF NOT EXISTS public.ai_agent_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id) ON DELETE CASCADE,
  version integer NOT NULL,
  model_id text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  prompt_hash text,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version)
);
GRANT SELECT ON public.ai_agent_versions TO authenticated;
GRANT ALL ON public.ai_agent_versions TO service_role;
ALTER TABLE public.ai_agent_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_agent_versions_read ON public.ai_agent_versions FOR SELECT TO authenticated
  USING (public.ai_ops_is_governor(auth.uid()));

-- ---------- policies ----------
CREATE TABLE IF NOT EXISTS public.ai_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  classification public.ai_action_class NOT NULL,
  target_service text,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  rationale text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (action_type, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_policies_one_active
  ON public.ai_policies (action_type) WHERE active;
GRANT SELECT ON public.ai_policies TO authenticated;
GRANT ALL ON public.ai_policies TO service_role;
ALTER TABLE public.ai_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_policies_read ON public.ai_policies FOR SELECT TO authenticated
  USING (public.ai_ops_is_governor(auth.uid()));

-- ---------- recommendations ----------
CREATE TABLE IF NOT EXISTS public.ai_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES public.ai_agents(id),
  agent_version_id uuid REFERENCES public.ai_agent_versions(id),
  recommendation_type text NOT NULL,
  priority public.ai_priority NOT NULL DEFAULT 'P2',
  entity_type text NOT NULL,
  entity_id uuid,
  entity_ref text,
  observation text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  reasoning_summary text NOT NULL,
  alternatives jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_action jsonb NOT NULL,
  expected_impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(5,2) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 100),
  classification public.ai_action_class NOT NULL DEFAULT 'APPROVAL_REQUIRED',
  policy_id uuid REFERENCES public.ai_policies(id),
  policy_status text NOT NULL DEFAULT 'PENDING',
  requires_approval boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','ACTIONED','DISMISSED','EXPIRED','SUPERSEDED')),
  dedupe_key text NOT NULL UNIQUE,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_reco_open ON public.ai_recommendations (status, priority, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_reco_entity ON public.ai_recommendations (entity_type, entity_id);
GRANT SELECT ON public.ai_recommendations TO authenticated;
GRANT ALL ON public.ai_recommendations TO service_role;
ALTER TABLE public.ai_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_reco_read ON public.ai_recommendations FOR SELECT TO authenticated
  USING (public.ai_ops_is_governor(auth.uid()));

CREATE TABLE IF NOT EXISTS public.ai_context_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id uuid NOT NULL REFERENCES public.ai_recommendations(id) ON DELETE CASCADE,
  source_table text NOT NULL,
  source_id uuid,
  source_ref text,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_ctx_reco ON public.ai_context_references (recommendation_id);
GRANT SELECT ON public.ai_context_references TO authenticated;
GRANT ALL ON public.ai_context_references TO service_role;
ALTER TABLE public.ai_context_references ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_ctx_read ON public.ai_context_references FOR SELECT TO authenticated
  USING (public.ai_ops_is_governor(auth.uid()));

-- ---------- action requests ----------
CREATE TABLE IF NOT EXISTS public.ai_action_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id uuid NOT NULL REFERENCES public.ai_recommendations(id),
  action_type text NOT NULL,
  classification public.ai_action_class NOT NULL,
  policy_id uuid REFERENCES public.ai_policies(id),
  policy_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_service text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  entity_type text NOT NULL,
  entity_id uuid,
  requested_by uuid,
  requested_by_kind text NOT NULL DEFAULT 'AGENT'
    CHECK (requested_by_kind IN ('AGENT','OPERATOR')),
  state public.ai_action_state NOT NULL DEFAULT 'PROPOSED',
  idempotency_key text NOT NULL UNIQUE,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_action_state_idx ON public.ai_action_requests (state, created_at DESC);
GRANT SELECT ON public.ai_action_requests TO authenticated;
GRANT ALL ON public.ai_action_requests TO service_role;
ALTER TABLE public.ai_action_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_action_read ON public.ai_action_requests FOR SELECT TO authenticated
  USING (public.ai_ops_is_governor(auth.uid()));

CREATE TABLE IF NOT EXISTS public.ai_action_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_request_id uuid NOT NULL REFERENCES public.ai_action_requests(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('APPROVED','REJECTED','DEFERRED','ESCALATED')),
  approver_id uuid NOT NULL,
  approver_role text,
  reason text NOT NULL,
  evidence_reviewed boolean NOT NULL DEFAULT false,
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_appr_req ON public.ai_action_approvals (action_request_id);
GRANT SELECT ON public.ai_action_approvals TO authenticated;
GRANT ALL ON public.ai_action_approvals TO service_role;
ALTER TABLE public.ai_action_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_appr_read ON public.ai_action_approvals FOR SELECT TO authenticated
  USING (public.ai_ops_is_governor(auth.uid()));

CREATE TABLE IF NOT EXISTS public.ai_action_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_request_id uuid NOT NULL REFERENCES public.ai_action_requests(id) ON DELETE CASCADE,
  attempt integer NOT NULL DEFAULT 1,
  invoked_service text NOT NULL,
  service_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  succeeded boolean NOT NULL DEFAULT false,
  verified boolean NOT NULL DEFAULT false,
  verification jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_message text,
  executed_by uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE (action_request_id, attempt)
);
GRANT SELECT ON public.ai_action_executions TO authenticated;
GRANT ALL ON public.ai_action_executions TO service_role;
ALTER TABLE public.ai_action_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_exec_read ON public.ai_action_executions FOR SELECT TO authenticated
  USING (public.ai_ops_is_governor(auth.uid()));

CREATE TABLE IF NOT EXISTS public.ai_action_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_request_id uuid NOT NULL UNIQUE REFERENCES public.ai_action_requests(id) ON DELETE CASCADE,
  expected jsonb NOT NULL DEFAULT '{}'::jsonb,
  actual jsonb NOT NULL DEFAULT '{}'::jsonb,
  variance jsonb NOT NULL DEFAULT '{}'::jsonb,
  success boolean,
  measured_at timestamptz NOT NULL DEFAULT now(),
  notes text
);
GRANT SELECT ON public.ai_action_outcomes TO authenticated;
GRANT ALL ON public.ai_action_outcomes TO service_role;
ALTER TABLE public.ai_action_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_outcome_read ON public.ai_action_outcomes FOR SELECT TO authenticated
  USING (public.ai_ops_is_governor(auth.uid()));

-- ---------- append-only audit ----------
CREATE TABLE IF NOT EXISTS public.ai_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  agent_id uuid REFERENCES public.ai_agents(id),
  agent_version_id uuid REFERENCES public.ai_agent_versions(id),
  recommendation_id uuid REFERENCES public.ai_recommendations(id) ON DELETE SET NULL,
  action_request_id uuid REFERENCES public.ai_action_requests(id) ON DELETE SET NULL,
  actor_id uuid,
  actor_kind text NOT NULL DEFAULT 'AGENT',
  policy_result jsonb,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_audit_reco ON public.ai_audit_events (recommendation_id);
CREATE INDEX IF NOT EXISTS ai_audit_action ON public.ai_audit_events (action_request_id);
GRANT SELECT ON public.ai_audit_events TO authenticated;
GRANT ALL ON public.ai_audit_events TO service_role;
ALTER TABLE public.ai_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_audit_read ON public.ai_audit_events FOR SELECT TO authenticated
  USING (public.ai_ops_is_governor(auth.uid()));

CREATE OR REPLACE FUNCTION public._ai_audit_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ai_audit_events is append-only';
END $$;
DROP TRIGGER IF EXISTS ai_audit_append_only ON public.ai_audit_events;
CREATE TRIGGER ai_audit_append_only BEFORE UPDATE OR DELETE ON public.ai_audit_events
  FOR EACH ROW EXECUTE FUNCTION public._ai_audit_append_only();

CREATE OR REPLACE FUNCTION public._ai_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS ai_reco_touch ON public.ai_recommendations;
CREATE TRIGGER ai_reco_touch BEFORE UPDATE ON public.ai_recommendations
  FOR EACH ROW EXECUTE FUNCTION public._ai_touch();
DROP TRIGGER IF EXISTS ai_action_touch ON public.ai_action_requests;
CREATE TRIGGER ai_action_touch BEFORE UPDATE ON public.ai_action_requests
  FOR EACH ROW EXECUTE FUNCTION public._ai_touch();

-- ---------- seed governance registry ----------
INSERT INTO public.ai_agents (code, name, domain, description, enabled) VALUES
  ('SLA_RECOVERY','SLA Recovery Agent','logistics','Detects delivery SLA risk and proposes recovery through the existing dispatch engine.', false),
  ('CAPACITY','Capacity Agent','logistics','Detects capacity, vehicle and driver shortages against authoritative fleet data.', false),
  ('HUB','Hub Optimisation Agent','logistics','Detects hub congestion and dwell risk from hub receipts, scans and manifests.', false),
  ('EXCEPTION','Exception Triage Agent','logistics','Triages logistics and freight exceptions and proposes owner, next action and escalation.', false),
  ('FINANCE_ASSIST','Finance Assistant','finance','Summarises reconciliation and allocation exceptions. Never mutates financial state.', false),
  ('CUSTOMER_COMMS','Customer Communication Agent','customer','Drafts customer explanations from verified facts only.', false)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ai_agent_versions (agent_id, version, model_id, config, active)
SELECT id, 1, NULL, jsonb_build_object('bootstrap', true), false FROM public.ai_agents
ON CONFLICT (agent_id, version) DO NOTHING;

INSERT INTO public.ai_policies (action_type, classification, target_service, rules, rationale) VALUES
  ('CUSTOMER_NOTIFICATION','AUTO_SAFE','logistics_notify',
     '{"non_mutating_to_transaction":true}','Informational notification built from verified facts.'),
  ('EXCEPTION_ESCALATION','AUTO_SAFE','logistics_exception_escalate',
     '{"no_closure":true}','Escalation raises visibility only; exceptions are never auto-closed.'),
  ('SLA_ESCALATION','AUTO_SAFE','control_tower_alert','{}','Raises an operational alert only.'),
  ('DISPATCH_REASSIGNMENT','APPROVAL_REQUIRED','logistics_dispatch_match',
     '{"engine":"stage3","must_pass":["vehicle_eligibility","driver_eligibility","capacity","compliance","availability","reservation"]}',
     'Executed only by the Stage 3 dispatch engine, which revalidates every eligibility control.'),
  ('VEHICLE_SUBSTITUTION','APPROVAL_REQUIRED','logistics_dispatch_override',
     '{"engine":"stage3","min_vehicle_class":"same_or_higher"}','Substitution goes through the governed dispatch override.'),
  ('DRIVER_SUBSTITUTION','APPROVAL_REQUIRED','logistics_dispatch_override',
     '{"engine":"stage3"}','Driver eligibility is revalidated by the dispatch engine.'),
  ('CAPACITY_REALLOCATION','APPROVAL_REQUIRED','logistics_capacity_release','{"engine":"stage3"}','Reservation changes require operations approval.'),
  ('ROUTE_RECOVERY','APPROVAL_REQUIRED','freight_route_instance_dispatch','{"engine":"stage4"}','Route recovery runs through the repeat-route engine.'),
  ('HUB_REROUTING','APPROVAL_REQUIRED','freight_hub_reroute','{"engine":"stage5","active_hub_only":true}','Only ACTIVE hubs may participate.'),
  ('CONSOLIDATION','APPROVAL_REQUIRED','freight_route_consolidate','{"engine":"stage4"}','Consolidation changes committed capacity.'),
  ('DELIVERY_RESCHEDULING','APPROVAL_REQUIRED','logistics_delivery_reschedule','{}','Customer-visible commitment change.'),
  ('NETWORK_CAPACITY_ACTION','APPROVAL_REQUIRED','freight_route_capacity_adjust','{"engine":"stage4"}','Recurring capacity changes need approval.'),
  ('PAYMENT_FOLLOWUP','HUMAN_ONLY','stage7_finance','{"no_ai_mutation":true}','Financial follow-up is a human action through Stage 7.'),
  ('SETTLEMENT_REVIEW','HUMAN_ONLY','stage7_finance','{"no_ai_mutation":true}','Settlement release is human-only.'),
  ('CLAIM_ESCALATION','HUMAN_ONLY','stage8_claims','{"no_ai_decision":true}','Claim decisions remain human.'),
  ('REFUND','BLOCKED','none','{"forbidden":true}','The AI layer may never refund.'),
  ('LEDGER_ADJUSTMENT','BLOCKED','none','{"forbidden":true}','The AI layer may never touch the ledger.'),
  ('TARIFF_CHANGE','BLOCKED','none','{"forbidden":true}','Tariffs and quotation snapshots are immutable to the AI layer.'),
  ('QUOTE_OVERRIDE','BLOCKED','none','{"forbidden":true}','Quote values are set only by the authoritative rating engine.')
ON CONFLICT (action_type, version) DO NOTHING;

-- ---------- policy evaluation ----------
CREATE OR REPLACE FUNCTION public.ai_policy_evaluate(_action_type text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p public.ai_policies;
BEGIN
  SELECT * INTO p FROM public.ai_policies WHERE action_type = _action_type AND active LIMIT 1;
  IF p.id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'classification','BLOCKED',
      'policy_status','NO_POLICY',
      'reason', format('No active policy is registered for action %s. The action is blocked.', _action_type));
  END IF;
  RETURN jsonb_build_object(
    'allowed', p.classification <> 'BLOCKED',
    'policy_id', p.id,
    'classification', p.classification,
    'target_service', p.target_service,
    'requires_approval', p.classification IN ('APPROVAL_REQUIRED','HUMAN_ONLY'),
    'human_only', p.classification = 'HUMAN_ONLY',
    'policy_status', CASE WHEN p.classification = 'BLOCKED' THEN 'BLOCKED' ELSE 'PASSED' END,
    'rules', p.rules,
    'rationale', p.rationale);
END $$;
REVOKE ALL ON FUNCTION public.ai_policy_evaluate(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_policy_evaluate(text) TO authenticated, service_role;

-- ---------- recommendation intake (agents only: service_role) ----------
CREATE OR REPLACE FUNCTION public.ai_recommendation_record(
  _agent_code text, _type text, _priority public.ai_priority,
  _entity_type text, _entity_id uuid, _entity_ref text,
  _observation text, _evidence jsonb, _reasoning text,
  _alternatives jsonb, _recommended_action jsonb, _expected_impact jsonb,
  _confidence numeric, _dedupe_key text, _context jsonb DEFAULT '[]'::jsonb,
  _expires_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_agent public.ai_agents; v_ver uuid; v_pol jsonb; v_id uuid; v_existing uuid; v_ctx jsonb;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'ai_recommendation_record may only be called by the orchestration worker';
  END IF;
  IF coalesce(trim(_observation),'') = '' OR coalesce(trim(_reasoning),'') = '' THEN
    RAISE EXCEPTION 'A recommendation requires an observation and a reasoning summary';
  END IF;
  IF _evidence IS NULL OR _evidence = '{}'::jsonb THEN
    RAISE EXCEPTION 'A recommendation requires evidence drawn from authoritative records';
  END IF;

  SELECT * INTO v_agent FROM public.ai_agents WHERE code = _agent_code;
  IF v_agent.id IS NULL THEN RAISE EXCEPTION 'Unknown agent %', _agent_code; END IF;

  SELECT id INTO v_ver FROM public.ai_agent_versions
   WHERE agent_id = v_agent.id ORDER BY active DESC, version DESC LIMIT 1;

  SELECT id INTO v_existing FROM public.ai_recommendations WHERE dedupe_key = _dedupe_key;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('recommendation_id', v_existing, 'duplicate', true);
  END IF;

  v_pol := public.ai_policy_evaluate(_type);

  INSERT INTO public.ai_recommendations (
    agent_id, agent_version_id, recommendation_type, priority, entity_type, entity_id, entity_ref,
    observation, evidence, reasoning_summary, alternatives, recommended_action, expected_impact,
    confidence, classification, policy_id, policy_status, requires_approval, dedupe_key, expires_at)
  VALUES (v_agent.id, v_ver, _type, _priority, _entity_type, _entity_id, _entity_ref,
    _observation, _evidence, _reasoning, coalesce(_alternatives,'[]'::jsonb), _recommended_action,
    coalesce(_expected_impact,'{}'::jsonb), coalesce(_confidence,0),
    (v_pol->>'classification')::public.ai_action_class,
    nullif(v_pol->>'policy_id','')::uuid, v_pol->>'policy_status',
    coalesce((v_pol->>'requires_approval')::boolean, true), _dedupe_key, _expires_at)
  RETURNING id INTO v_id;

  FOR v_ctx IN SELECT * FROM jsonb_array_elements(coalesce(_context,'[]'::jsonb)) LOOP
    INSERT INTO public.ai_context_references (recommendation_id, source_table, source_id, source_ref, snapshot)
    VALUES (v_id, v_ctx->>'source_table', nullif(v_ctx->>'source_id','')::uuid,
            v_ctx->>'source_ref', coalesce(v_ctx->'snapshot','{}'::jsonb));
  END LOOP;

  INSERT INTO public.ai_audit_events (event_type, agent_id, agent_version_id, recommendation_id,
    actor_kind, policy_result, detail)
  VALUES ('RECOMMENDATION_CREATED', v_agent.id, v_ver, v_id, 'AGENT', v_pol,
          jsonb_build_object('type', _type, 'priority', _priority, 'entity_type', _entity_type));

  RETURN jsonb_build_object('recommendation_id', v_id, 'duplicate', false, 'policy', v_pol);
END $$;
REVOKE ALL ON FUNCTION public.ai_recommendation_record(text,text,public.ai_priority,text,uuid,text,text,jsonb,text,jsonb,jsonb,jsonb,numeric,text,jsonb,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_recommendation_record(text,text,public.ai_priority,text,uuid,text,text,jsonb,text,jsonb,jsonb,jsonb,numeric,text,jsonb,timestamptz) TO service_role;

-- ---------- action request creation ----------
CREATE OR REPLACE FUNCTION public.ai_action_request_open(
  _recommendation_id uuid, _payload jsonb, _idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.ai_recommendations; v_pol jsonb; v_id uuid; v_state public.ai_action_state; v_actor uuid := auth.uid();
BEGIN
  IF NOT (public.ai_ops_is_governor(v_actor)
          OR current_setting('role', true) = 'service_role'
          OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'Not authorised to open an AI action request';
  END IF;

  SELECT * INTO r FROM public.ai_recommendations WHERE id = _recommendation_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Unknown recommendation'; END IF;
  IF r.status <> 'OPEN' THEN RAISE EXCEPTION 'Recommendation is % and can no longer be actioned', r.status; END IF;
  IF r.expires_at IS NOT NULL AND r.expires_at < now() THEN
    UPDATE public.ai_recommendations SET status = 'EXPIRED' WHERE id = r.id;
    RAISE EXCEPTION 'Recommendation has expired; regenerate it against current data';
  END IF;

  SELECT id INTO v_id FROM public.ai_action_requests WHERE idempotency_key = _idempotency_key;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('action_request_id', v_id, 'duplicate', true);
  END IF;

  v_pol := public.ai_policy_evaluate(r.recommendation_type);
  IF NOT (v_pol->>'allowed')::boolean THEN
    INSERT INTO public.ai_audit_events (event_type, recommendation_id, actor_id, actor_kind, policy_result, detail)
    VALUES ('ACTION_BLOCKED', r.id, v_actor, 'OPERATOR', v_pol, jsonb_build_object('reason', v_pol->>'reason'));
    RAISE EXCEPTION 'Policy blocks this action: %', coalesce(v_pol->>'reason', v_pol->>'rationale');
  END IF;

  v_state := CASE WHEN (v_pol->>'requires_approval')::boolean THEN 'APPROVAL_PENDING' ELSE 'APPROVED' END;

  INSERT INTO public.ai_action_requests (recommendation_id, action_type, classification, policy_id,
    policy_result, target_service, payload, entity_type, entity_id, requested_by, requested_by_kind,
    state, idempotency_key, expires_at)
  VALUES (r.id, r.recommendation_type, (v_pol->>'classification')::public.ai_action_class,
    nullif(v_pol->>'policy_id','')::uuid, v_pol, v_pol->>'target_service', coalesce(_payload,'{}'::jsonb),
    r.entity_type, r.entity_id, v_actor,
    CASE WHEN v_actor IS NULL THEN 'AGENT' ELSE 'OPERATOR' END,
    v_state, _idempotency_key, coalesce(r.expires_at, now() + interval '12 hours'))
  RETURNING id INTO v_id;

  INSERT INTO public.ai_audit_events (event_type, recommendation_id, action_request_id, actor_id,
    actor_kind, policy_result, detail)
  VALUES ('ACTION_REQUESTED', r.id, v_id, v_actor,
          CASE WHEN v_actor IS NULL THEN 'AGENT' ELSE 'OPERATOR' END, v_pol,
          jsonb_build_object('state', v_state));

  RETURN jsonb_build_object('action_request_id', v_id, 'duplicate', false,
    'state', v_state, 'classification', v_pol->>'classification', 'policy', v_pol);
END $$;
REVOKE ALL ON FUNCTION public.ai_action_request_open(uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_action_request_open(uuid,jsonb,text) TO authenticated, service_role;

-- ---------- approval decision (maker-checker) ----------
CREATE OR REPLACE FUNCTION public.ai_action_decide(
  _action_request_id uuid, _decision text, _reason text, _evidence_reviewed boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.ai_action_requests; v_actor uuid := auth.uid(); v_state public.ai_action_state;
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
    RAISE EXCEPTION 'The approval window has expired; regenerate the recommendation';
  END IF;
  IF a.requested_by IS NOT NULL AND a.requested_by = v_actor THEN
    RAISE EXCEPTION 'The requester may not approve their own action';
  END IF;

  INSERT INTO public.ai_action_approvals (action_request_id, decision, approver_id, reason, evidence_reviewed)
  VALUES (a.id, _decision, v_actor, _reason, _evidence_reviewed);

  v_state := CASE _decision
    WHEN 'APPROVED' THEN 'APPROVED'::public.ai_action_state
    WHEN 'REJECTED' THEN 'REJECTED'::public.ai_action_state
    ELSE 'APPROVAL_PENDING'::public.ai_action_state END;

  UPDATE public.ai_action_requests SET state = v_state WHERE id = a.id;
  IF _decision = 'REJECTED' THEN
    UPDATE public.ai_recommendations SET status = 'DISMISSED' WHERE id = a.recommendation_id;
  END IF;

  INSERT INTO public.ai_audit_events (event_type, recommendation_id, action_request_id, actor_id, actor_kind, detail)
  VALUES ('APPROVAL_DECIDED', a.recommendation_id, a.id, v_actor, 'OPERATOR',
          jsonb_build_object('decision', _decision, 'reason', _reason));

  RETURN jsonb_build_object('action_request_id', a.id, 'state', v_state, 'decision', _decision);
END $$;
REVOKE ALL ON FUNCTION public.ai_action_decide(uuid,text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_action_decide(uuid,text,text,boolean) TO authenticated, service_role;

-- ---------- execution through existing engines only ----------
CREATE OR REPLACE FUNCTION public.ai_action_execute(_action_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.ai_action_requests; v_attempt integer; v_exec uuid; v_result jsonb;
  v_verified boolean := false; v_verification jsonb := '{}'::jsonb; v_actor uuid := auth.uid();
  v_req_id uuid;
BEGIN
  IF NOT (current_setting('role', true) = 'service_role' OR auth.role() = 'service_role') THEN
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

  SELECT coalesce(max(attempt),0) + 1 INTO v_attempt
    FROM public.ai_action_executions WHERE action_request_id = a.id;

  UPDATE public.ai_action_requests SET state = 'EXECUTING' WHERE id = a.id;
  INSERT INTO public.ai_action_executions (action_request_id, attempt, invoked_service, executed_by)
  VALUES (a.id, v_attempt, a.target_service, v_actor) RETURNING id INTO v_exec;

  BEGIN
    IF a.action_type IN ('DISPATCH_REASSIGNMENT') THEN
      v_req_id := (a.payload->>'dispatch_request_id')::uuid;
      IF v_req_id IS NULL THEN RAISE EXCEPTION 'dispatch_request_id is required'; END IF;
      v_result := public.logistics_dispatch_match(v_req_id, true);
      SELECT to_jsonb(d) - 'payload' INTO v_verification
        FROM public.logistics_dispatch_requests d WHERE d.id = v_req_id;
      v_verified := (v_verification->>'assigned_vehicle_id') IS NOT NULL;
    ELSIF a.action_type IN ('VEHICLE_SUBSTITUTION','DRIVER_SUBSTITUTION') THEN
      v_req_id := (a.payload->>'dispatch_request_id')::uuid;
      IF v_req_id IS NULL THEN RAISE EXCEPTION 'dispatch_request_id is required'; END IF;
      v_result := public.logistics_dispatch_override(
        v_req_id, nullif(a.payload->>'vehicle_id','')::uuid,
        nullif(a.payload->>'driver_id','')::uuid,
        coalesce(a.payload->>'reason','AI-assisted substitution, approved by operations'));
      SELECT to_jsonb(d) - 'payload' INTO v_verification
        FROM public.logistics_dispatch_requests d WHERE d.id = v_req_id;
      v_verified := (v_verification->>'assigned_vehicle_id') = (a.payload->>'vehicle_id');
    ELSE
      RAISE EXCEPTION 'No approved execution adapter is configured for action %. The action cannot be executed by the AI layer.', a.action_type;
    END IF;

    UPDATE public.ai_action_executions
       SET service_result = coalesce(v_result,'{}'::jsonb), succeeded = true,
           verified = v_verified, verification = coalesce(v_verification,'{}'::jsonb), finished_at = now()
     WHERE id = v_exec;

    IF v_verified THEN
      UPDATE public.ai_action_requests SET state = 'EXECUTED' WHERE id = a.id;
      UPDATE public.ai_recommendations SET status = 'ACTIONED' WHERE id = a.recommendation_id;
    ELSE
      UPDATE public.ai_action_requests SET state = 'FAILED' WHERE id = a.id;
    END IF;

    INSERT INTO public.ai_audit_events (event_type, recommendation_id, action_request_id, actor_id, actor_kind, detail)
    VALUES (CASE WHEN v_verified THEN 'ACTION_EXECUTED' ELSE 'ACTION_UNVERIFIED' END,
            a.recommendation_id, a.id, v_actor, 'AGENT',
            jsonb_build_object('attempt', v_attempt, 'service', a.target_service, 'verified', v_verified));

    RETURN jsonb_build_object('action_request_id', a.id,
      'state', CASE WHEN v_verified THEN 'EXECUTED' ELSE 'FAILED' END,
      'verified', v_verified, 'attempt', v_attempt, 'result', v_result);
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.ai_action_executions
       SET succeeded = false, verified = false, error_code = SQLSTATE,
           error_message = SQLERRM, finished_at = now()
     WHERE id = v_exec;
    UPDATE public.ai_action_requests SET state = 'FAILED' WHERE id = a.id;
    INSERT INTO public.ai_audit_events (event_type, recommendation_id, action_request_id, actor_id, actor_kind, detail)
    VALUES ('ACTION_FAILED', a.recommendation_id, a.id, v_actor, 'AGENT',
            jsonb_build_object('attempt', v_attempt, 'sqlstate', SQLSTATE, 'error', SQLERRM));
    RETURN jsonb_build_object('action_request_id', a.id, 'state','FAILED',
      'verified', false, 'error', SQLERRM);
  END;
END $$;
REVOKE ALL ON FUNCTION public.ai_action_execute(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_action_execute(uuid) TO service_role;

-- ---------- outcome measurement ----------
CREATE OR REPLACE FUNCTION public.ai_action_measure_outcome(
  _action_request_id uuid, _actual jsonb, _success boolean, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.ai_action_requests; v_expected jsonb;
BEGIN
  IF NOT (current_setting('role', true) = 'service_role' OR auth.role() = 'service_role'
          OR public.ai_ops_is_governor(auth.uid())) THEN
    RAISE EXCEPTION 'Not authorised to record AI outcomes';
  END IF;
  SELECT * INTO a FROM public.ai_action_requests WHERE id = _action_request_id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Unknown action request'; END IF;
  IF a.state <> 'EXECUTED' THEN RAISE EXCEPTION 'Outcomes are measured only for executed actions'; END IF;

  SELECT expected_impact INTO v_expected FROM public.ai_recommendations WHERE id = a.recommendation_id;

  INSERT INTO public.ai_action_outcomes (action_request_id, expected, actual, variance, success, notes)
  VALUES (a.id, coalesce(v_expected,'{}'::jsonb), coalesce(_actual,'{}'::jsonb),
          jsonb_build_object('expected', v_expected, 'actual', _actual), _success, _notes)
  ON CONFLICT (action_request_id) DO UPDATE
    SET actual = EXCLUDED.actual, variance = EXCLUDED.variance,
        success = EXCLUDED.success, notes = EXCLUDED.notes, measured_at = now();

  INSERT INTO public.ai_audit_events (event_type, recommendation_id, action_request_id, actor_id, actor_kind, detail)
  VALUES ('OUTCOME_MEASURED', a.recommendation_id, a.id, auth.uid(), 'OPERATOR',
          jsonb_build_object('success', _success));

  RETURN jsonb_build_object('action_request_id', a.id, 'success', _success);
END $$;
REVOKE ALL ON FUNCTION public.ai_action_measure_outcome(uuid,jsonb,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_action_measure_outcome(uuid,jsonb,boolean,text) TO authenticated, service_role;

-- ---------- control tower projection ----------
CREATE OR REPLACE VIEW public.v_ai_control_tower
WITH (security_invoker = true) AS
SELECT r.id AS recommendation_id, r.priority, r.recommendation_type, r.entity_type, r.entity_id,
       r.entity_ref, r.observation, r.evidence, r.reasoning_summary, r.alternatives,
       r.expected_impact, r.confidence, r.classification, r.policy_status, r.requires_approval,
       r.status AS recommendation_status, r.created_at, r.expires_at,
       ag.code AS agent_code, ag.name AS agent_name,
       ar.id AS action_request_id, ar.state AS action_state, ar.target_service,
       (SELECT count(*) FROM public.ai_action_approvals ap WHERE ap.action_request_id = ar.id) AS approvals,
       (SELECT bool_or(ex.verified) FROM public.ai_action_executions ex WHERE ex.action_request_id = ar.id) AS verified,
       o.success AS outcome_success
FROM public.ai_recommendations r
JOIN public.ai_agents ag ON ag.id = r.agent_id
LEFT JOIN public.ai_action_requests ar ON ar.recommendation_id = r.id
LEFT JOIN public.ai_action_outcomes o ON o.action_request_id = ar.id;
GRANT SELECT ON public.v_ai_control_tower TO authenticated;