
-- ============ payment_callback_certifications ============
CREATE TABLE IF NOT EXISTS public.payment_callback_certifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id TEXT NOT NULL,
  stage TEXT NOT NULL, -- stk_push | callback_persisted | wallet_credit | ledger_post | settlement | reconciliation
  status TEXT NOT NULL DEFAULT 'pending', -- pending | passed | failed | skipped
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  duration_ms INTEGER,
  error TEXT,
  certified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  certification_run_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pcc_corr ON public.payment_callback_certifications (correlation_id, certified_at DESC);
CREATE INDEX IF NOT EXISTS idx_pcc_run ON public.payment_callback_certifications (certification_run_id);
GRANT SELECT ON public.payment_callback_certifications TO authenticated;
GRANT ALL ON public.payment_callback_certifications TO service_role;
ALTER TABLE public.payment_callback_certifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read pcc" ON public.payment_callback_certifications
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ payment_decision_trees ============
CREATE TABLE IF NOT EXISTS public.payment_decision_trees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id UUID NOT NULL,
  tree JSONB NOT NULL,           -- hierarchical evidence tree
  root_verdict TEXT NOT NULL,    -- promote | hold | rollback | no_change
  confidence NUMERIC,
  recommendations JSONB NOT NULL DEFAULT '[]'::jsonb,
  historical_comparison JSONB,
  built_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (decision_id)
);
CREATE INDEX IF NOT EXISTS idx_pdt_decision ON public.payment_decision_trees (decision_id);
GRANT SELECT ON public.payment_decision_trees TO authenticated;
GRANT ALL ON public.payment_decision_trees TO service_role;
ALTER TABLE public.payment_decision_trees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read pdt" ON public.payment_decision_trees
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ payment_replay_simulations ============
CREATE TABLE IF NOT EXISTS public.payment_replay_simulations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by UUID REFERENCES auth.users(id),
  source_correlation_id TEXT NOT NULL,
  scenario TEXT NOT NULL, -- baseline | oauth_outage | callback_delay | duplicate_callback | daraja_5xx | wallet_failure | ledger_failure | slow_db
  scenario_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'running', -- running | passed | failed | error
  original_timeline JSONB NOT NULL DEFAULT '[]'::jsonb,
  simulated_timeline JSONB NOT NULL DEFAULT '[]'::jsonb,
  divergence JSONB,          -- structured diff
  outcome_summary TEXT,
  passed_stages TEXT[] NOT NULL DEFAULT '{}',
  failed_stages TEXT[] NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prs_corr ON public.payment_replay_simulations (source_correlation_id, started_at DESC);
GRANT SELECT ON public.payment_replay_simulations TO authenticated;
GRANT ALL ON public.payment_replay_simulations TO service_role;
ALTER TABLE public.payment_replay_simulations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read prs" ON public.payment_replay_simulations
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ Extend payment_evidence_exports (provenance) ============
ALTER TABLE public.payment_evidence_exports
  ADD COLUMN IF NOT EXISTS deployment_version TEXT,
  ADD COLUMN IF NOT EXISTS git_revision TEXT,
  ADD COLUMN IF NOT EXISTS schema_version TEXT,
  ADD COLUMN IF NOT EXISTS rollout_percent NUMERIC,
  ADD COLUMN IF NOT EXISTS readiness_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS reliability_score NUMERIC,
  ADD COLUMN IF NOT EXISTS certification_run_id UUID,
  ADD COLUMN IF NOT EXISTS evidence_version TEXT NOT NULL DEFAULT 'v2',
  ADD COLUMN IF NOT EXISTS evidence_signature TEXT;

-- ============ Extend payment_notification_dispatches (priority) ============
ALTER TABLE public.payment_notification_dispatches
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';
CREATE INDEX IF NOT EXISTS idx_pnd_priority ON public.payment_notification_dispatches (priority, dispatched_at DESC);

-- ============ RPC: payment_derive_dependency_graph ============
CREATE OR REPLACE FUNCTION public.payment_derive_dependency_graph(_correlation_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_admin BOOLEAN;
  nodes JSONB := '[]'::jsonb;
  edges JSONB := '[]'::jsonb;
  r RECORD;
BEGIN
  SELECT public.has_role(auth.uid(), 'admin') INTO is_admin;
  IF NOT COALESCE(is_admin, false) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Nodes derived from observed telemetry (not a static definition).
  FOR r IN
    SELECT DISTINCT stage, MIN(occurred_at) AS first_seen, MAX(occurred_at) AS last_seen, COUNT(*) AS events
    FROM public.payment_journey_events
    WHERE correlation_id = _correlation_id
    GROUP BY stage
    ORDER BY first_seen
  LOOP
    nodes := nodes || jsonb_build_object(
      'id', r.stage, 'kind', 'stage',
      'first_seen', r.first_seen, 'last_seen', r.last_seen, 'events', r.events
    );
  END LOOP;

  -- Edges = temporal chain between successive stages we actually observed.
  WITH ordered AS (
    SELECT stage, MIN(occurred_at) AS ts
    FROM public.payment_journey_events
    WHERE correlation_id = _correlation_id
    GROUP BY stage
    ORDER BY MIN(occurred_at)
  ), pairs AS (
    SELECT
      stage AS from_stage,
      LEAD(stage) OVER (ORDER BY ts) AS to_stage,
      EXTRACT(EPOCH FROM (LEAD(ts) OVER (ORDER BY ts) - ts)) * 1000 AS gap_ms
    FROM ordered
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'from', from_stage, 'to', to_stage, 'gap_ms', gap_ms
  )), '[]'::jsonb) INTO edges
  FROM pairs WHERE to_stage IS NOT NULL;

  RETURN jsonb_build_object(
    'correlation_id', _correlation_id,
    'nodes', nodes,
    'edges', edges,
    'derived_at', now()
  );
END $$;

GRANT EXECUTE ON FUNCTION public.payment_derive_dependency_graph(TEXT) TO authenticated;

-- ============ RPC: payment_digital_twin_v2 ============
CREATE OR REPLACE FUNCTION public.payment_digital_twin_v2(_identifier TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_admin BOOLEAN;
  corr TEXT;
  timeline JSONB;
  mutations JSONB;
  dep_graph JSONB;
  certifications JSONB;
BEGIN
  SELECT public.has_role(auth.uid(), 'admin') INTO is_admin;
  IF NOT COALESCE(is_admin, false) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Resolve any identifier to correlation_id.
  SELECT correlation_id INTO corr FROM public.payment_journey_events WHERE correlation_id = _identifier LIMIT 1;
  IF corr IS NULL THEN
    SELECT correlation_id INTO corr FROM public.mpesa_stk_attempts
      WHERE checkout_request_id = _identifier OR merchant_request_id = _identifier LIMIT 1;
  END IF;
  IF corr IS NULL THEN
    SELECT correlation_id INTO corr FROM public.payment_attempts
      WHERE id::text = _identifier OR session_id::text = _identifier LIMIT 1;
  END IF;
  IF corr IS NULL THEN RETURN jsonb_build_object('error','not_found','identifier',_identifier); END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.occurred_at), '[]'::jsonb) INTO timeline
  FROM (
    SELECT occurred_at, stage, status, actor, metadata FROM public.payment_journey_events WHERE correlation_id = corr
    UNION ALL
    SELECT occurred_at, step_name AS stage, status, edge_function AS actor, metadata FROM public.payment_step_traces WHERE correlation_id = corr
  ) t;

  SELECT jsonb_build_object(
    'wallet_transactions', COALESCE((SELECT jsonb_agg(to_jsonb(w)) FROM public.wallet_transactions w WHERE w.correlation_id = corr), '[]'::jsonb),
    'journal_lines',       COALESCE((SELECT jsonb_agg(to_jsonb(j)) FROM public.journal_lines j WHERE j.correlation_id = corr), '[]'::jsonb),
    'callbacks',           COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM public.mpesa_callback_logs c WHERE c.correlation_id = corr), '[]'::jsonb)
  ) INTO mutations;

  dep_graph := public.payment_derive_dependency_graph(corr);

  SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.certified_at), '[]'::jsonb) INTO certifications
  FROM public.payment_callback_certifications p WHERE p.correlation_id = corr;

  RETURN jsonb_build_object(
    'correlation_id', corr,
    'timeline', timeline,
    'financial_mutations', mutations,
    'dependency_graph', dep_graph,
    'callback_certifications', certifications,
    'generated_at', now()
  );
END $$;

GRANT EXECUTE ON FUNCTION public.payment_digital_twin_v2(TEXT) TO authenticated;

-- ============ RPC: payment_build_decision_tree ============
CREATE OR REPLACE FUNCTION public.payment_build_decision_tree(_decision_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_admin BOOLEAN;
  d RECORD;
  ev JSONB;
  bd JSONB;
  hist JSONB;
  tree JSONB;
  recs JSONB := '[]'::jsonb;
BEGIN
  SELECT public.has_role(auth.uid(), 'admin') INTO is_admin;
  IF NOT COALESCE(is_admin, false) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO d FROM public.payment_orchestrator_decisions WHERE id = _decision_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
  ev := COALESCE(d.evidence, '{}'::jsonb);
  bd := COALESCE(d.confidence_breakdown, '{}'::jsonb);

  -- Compare against the last 20 decisions of the same action.
  WITH prev AS (
    SELECT confidence_score, reliability_score, callback_health, shadow_equivalence
    FROM public.payment_orchestrator_decisions
    WHERE action = d.action AND id <> d.id
    ORDER BY decided_at DESC LIMIT 20
  )
  SELECT jsonb_build_object(
    'sample_size', COUNT(*),
    'avg_confidence', AVG(confidence_score),
    'avg_reliability', AVG(reliability_score),
    'avg_shadow_equivalence', AVG(shadow_equivalence)
  ) INTO hist FROM prev;

  -- Build hierarchical tree
  tree := jsonb_build_object(
    'verdict', d.action,
    'confidence', d.confidence_score,
    'reason', d.reason,
    'children', jsonb_build_array(
      jsonb_build_object('name','gate_ready','actual',d.gate_ready,'threshold',true,
        'verdict', CASE WHEN d.gate_ready THEN 'pass' ELSE 'fail' END,
        'weight', COALESCE((bd->'gate'->>'weight')::numeric, 20)),
      jsonb_build_object('name','reliability','actual',d.reliability_score,'threshold',90,
        'verdict', CASE WHEN COALESCE(d.reliability_score,0) >= 90 THEN 'pass' ELSE 'fail' END,
        'weight', COALESCE((bd->'reliability'->>'weight')::numeric, 20)),
      jsonb_build_object('name','callback_health','actual',d.callback_health,'threshold','HEALTHY',
        'verdict', CASE WHEN d.callback_health = 'HEALTHY' THEN 'pass' ELSE 'warn' END,
        'weight', COALESCE((bd->'callback'->>'weight')::numeric, 15)),
      jsonb_build_object('name','shadow_equivalence','actual',d.shadow_equivalence,'threshold',95,
        'verdict', CASE WHEN COALESCE(d.shadow_equivalence,0) >= 95 THEN 'pass' ELSE 'warn' END,
        'weight', COALESCE((bd->'shadow'->>'weight')::numeric, 15)),
      jsonb_build_object('name','certification','actual',(ev->>'cert_pass_rate')::numeric,'threshold',90,
        'verdict', CASE WHEN COALESCE((ev->>'cert_pass_rate')::numeric,0) >= 90 THEN 'pass' ELSE 'fail' END,
        'weight', COALESCE((bd->'certification'->>'weight')::numeric, 15)),
      jsonb_build_object('name','active_critical_incidents','actual',d.active_critical_incidents,'threshold',0,
        'verdict', CASE WHEN d.active_critical_incidents = 0 THEN 'pass' ELSE 'fail' END,
        'weight', COALESCE((bd->'incidents'->>'weight')::numeric, 10))
    )
  );

  IF NOT COALESCE(d.gate_ready, false) THEN
    recs := recs || jsonb_build_array(jsonb_build_object('priority','high','action','Investigate readiness gate blockers before promotion'));
  END IF;
  IF COALESCE(d.reliability_score, 0) < 90 THEN
    recs := recs || jsonb_build_array(jsonb_build_object('priority','high','action','Reliability below 90 — inspect callback + settlement SLOs'));
  END IF;
  IF d.callback_health IS DISTINCT FROM 'HEALTHY' THEN
    recs := recs || jsonb_build_array(jsonb_build_object('priority','critical','action','Run callback-certification-run and inspect Daraja reachability'));
  END IF;
  IF d.active_critical_incidents > 0 THEN
    recs := recs || jsonb_build_array(jsonb_build_object('priority','critical','action','Resolve active critical incidents before any promotion'));
  END IF;

  INSERT INTO public.payment_decision_trees (decision_id, tree, root_verdict, confidence, recommendations, historical_comparison)
  VALUES (_decision_id, tree, d.action, d.confidence_score, recs, hist)
  ON CONFLICT (decision_id) DO UPDATE
    SET tree = EXCLUDED.tree,
        root_verdict = EXCLUDED.root_verdict,
        confidence = EXCLUDED.confidence,
        recommendations = EXCLUDED.recommendations,
        historical_comparison = EXCLUDED.historical_comparison,
        built_at = now();

  RETURN jsonb_build_object(
    'decision_id', _decision_id,
    'tree', tree,
    'recommendations', recs,
    'historical_comparison', hist
  );
END $$;

GRANT EXECUTE ON FUNCTION public.payment_build_decision_tree(UUID) TO authenticated;
