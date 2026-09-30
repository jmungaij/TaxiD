-- =====================================================================
-- Phase 8.5 closure controls: certification gaps, idempotency replay,
-- operator SLA inbox, multi-period commercial priority brief.
-- =====================================================================

-- ---------------------------------------------------------------
-- 1. Certification gap ledger
-- ---------------------------------------------------------------
CREATE TABLE public.commercial_certification_gaps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.commercial_certification_runs(id) ON DELETE CASCADE,
  transaction_id uuid,
  transaction_ref text,
  case_kind text NOT NULL,
  service_line text,
  failed_gate text NOT NULL,
  missing_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  blockers text[] NOT NULL DEFAULT ARRAY[]::text[],
  missing_stages text[] NOT NULL DEFAULT ARRAY[]::text[],
  exposure_cents bigint NOT NULL DEFAULT 0,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ccg_run ON public.commercial_certification_gaps(run_id, failed_gate);
CREATE INDEX idx_ccg_tx ON public.commercial_certification_gaps(transaction_ref);

GRANT SELECT ON public.commercial_certification_gaps TO authenticated;
GRANT ALL ON public.commercial_certification_gaps TO service_role;
ALTER TABLE public.commercial_certification_gaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commercial staff read certification gaps"
  ON public.commercial_certification_gaps FOR SELECT TO authenticated
  USING (public.is_commercial_staff());

-- ---------------------------------------------------------------
-- 2. Idempotency replay harness records
-- ---------------------------------------------------------------
CREATE TABLE public.revenue_idempotency_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  replays_per_case int NOT NULL,
  cases_tested int NOT NULL DEFAULT 0,
  cases_passed int NOT NULL DEFAULT 0,
  cases_failed int NOT NULL DEFAULT 0,
  duplicates_created int NOT NULL DEFAULT 0,
  verdict text NOT NULL DEFAULT 'PASS',
  guard_present boolean NOT NULL DEFAULT false,
  run_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.revenue_idempotency_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.revenue_idempotency_runs(id) ON DELETE CASCADE,
  transaction_id uuid,
  transaction_ref text NOT NULL,
  replays int NOT NULL,
  events_before int NOT NULL,
  events_after int NOT NULL,
  amount_before_cents bigint NOT NULL DEFAULT 0,
  amount_after_cents bigint NOT NULL DEFAULT 0,
  revenue_event_id_before uuid,
  revenue_event_id_after uuid,
  idempotent boolean NOT NULL,
  duplicate_detected boolean NOT NULL,
  emitter_responses jsonb NOT NULL DEFAULT '[]'::jsonb,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ric_run ON public.revenue_idempotency_checks(run_id);

GRANT SELECT ON public.revenue_idempotency_runs TO authenticated;
GRANT SELECT ON public.revenue_idempotency_checks TO authenticated;
GRANT ALL ON public.revenue_idempotency_runs TO service_role;
GRANT ALL ON public.revenue_idempotency_checks TO service_role;
ALTER TABLE public.revenue_idempotency_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.revenue_idempotency_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commercial staff read idempotency runs"
  ON public.revenue_idempotency_runs FOR SELECT TO authenticated
  USING (public.is_commercial_staff());
CREATE POLICY "Commercial staff read idempotency checks"
  ON public.revenue_idempotency_checks FOR SELECT TO authenticated
  USING (public.is_commercial_staff());

-- ---------------------------------------------------------------
-- 3. Operator SLA inbox: exception workflow columns + audit trail
-- ---------------------------------------------------------------
ALTER TABLE public.commercial_exceptions
  ADD COLUMN IF NOT EXISTS assigned_to uuid,
  ADD COLUMN IF NOT EXISTS assigned_by uuid,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS acknowledged_by uuid,
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS triaged_by uuid,
  ADD COLUMN IF NOT EXISTS triaged_at timestamptz,
  ADD COLUMN IF NOT EXISTS triage_notes text,
  ADD COLUMN IF NOT EXISTS sla_breached_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_cex_inbox
  ON public.commercial_exceptions(status, sla_due_at, priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_cex_assignee
  ON public.commercial_exceptions(assigned_to, status);

CREATE TABLE public.commercial_exception_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_id uuid NOT NULL REFERENCES public.commercial_exceptions(id) ON DELETE CASCADE,
  exception_ref text NOT NULL,
  action text NOT NULL,
  actor_id uuid,
  actor_email text,
  status_before text,
  status_after text,
  assignee_before uuid,
  assignee_after uuid,
  note text,
  sla_state text,
  escalation_level int,
  source text NOT NULL DEFAULT 'operator',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cea_exception ON public.commercial_exception_audit(exception_id, created_at DESC);

GRANT SELECT ON public.commercial_exception_audit TO authenticated;
GRANT ALL ON public.commercial_exception_audit TO service_role;
ALTER TABLE public.commercial_exception_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Commercial staff read exception audit"
  ON public.commercial_exception_audit FOR SELECT TO authenticated
  USING (public.is_commercial_staff());

CREATE OR REPLACE FUNCTION public.deny_exception_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'commercial_exception_audit is append-only';
END; $$;

CREATE TRIGGER trg_cea_immutable
  BEFORE UPDATE OR DELETE ON public.commercial_exception_audit
  FOR EACH ROW EXECUTE FUNCTION public.deny_exception_audit_mutation();

-- Operator authority for the SLA inbox
CREATE OR REPLACE FUNCTION public.is_exception_operator(_uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid, 'operations_admin'::app_role)
      OR public.has_role(_uid, 'finance_admin'::app_role)
      OR public.has_role(_uid, 'admin'::app_role)
      OR public.has_role(_uid, 'super_admin'::app_role);
$$;

CREATE OR REPLACE FUNCTION public._log_exception_action(
  _exception_id uuid, _action text, _status_before text, _status_after text,
  _assignee_before uuid, _assignee_after uuid, _note text, _source text DEFAULT 'operator'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ex record;
BEGIN
  SELECT exception_ref, sla_due_at, escalation_level INTO ex
    FROM commercial_exceptions WHERE id = _exception_id;
  INSERT INTO commercial_exception_audit (
    exception_id, exception_ref, action, actor_id, actor_email,
    status_before, status_after, assignee_before, assignee_after, note,
    sla_state, escalation_level, source)
  VALUES (
    _exception_id, ex.exception_ref, _action, auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    _status_before, _status_after, _assignee_before, _assignee_after, _note,
    CASE WHEN ex.sla_due_at IS NULL THEN 'no_sla'
         WHEN ex.sla_due_at < now() THEN 'breached' ELSE 'within_sla' END,
    ex.escalation_level, _source);
END; $$;

-- Inbox reader
CREATE OR REPLACE FUNCTION public.commercial_exception_inbox(
  _scope text DEFAULT 'open', _assignee text DEFAULT 'any', _limit int DEFAULT 200
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE items jsonb; stats jsonb; uid uuid := auth.uid();
BEGIN
  IF NOT is_commercial_staff() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.breached DESC, x.priority_score DESC NULLS LAST), '[]'::jsonb)
    INTO items
  FROM (
    SELECT e.id, e.exception_ref, e.transaction_ref, e.stage, e.kind, e.severity,
           e.value_at_risk_cents, e.currency, e.priority_score, e.owner_team,
           e.sla_hours, e.sla_due_at, e.status, e.root_cause, e.recommended_action,
           e.escalation_level, e.assigned_to, e.assigned_at, e.acknowledged_at,
           e.triaged_at, e.triage_notes, e.resolution, e.resolved_at, e.created_at,
           (SELECT email FROM auth.users u WHERE u.id = e.assigned_to) AS assignee_email,
           (e.sla_due_at IS NOT NULL AND e.sla_due_at < now()
             AND e.status NOT IN ('resolved','closed')) AS breached,
           CASE WHEN e.sla_due_at IS NULL THEN NULL
                ELSE round(EXTRACT(epoch FROM (e.sla_due_at - now())) / 60) END AS minutes_to_due
      FROM commercial_exceptions e
     WHERE (_scope = 'all'
            OR (_scope = 'open' AND e.status NOT IN ('resolved','closed'))
            OR (_scope = 'breached' AND e.sla_due_at < now() AND e.status NOT IN ('resolved','closed'))
            OR (_scope = 'resolved' AND e.status IN ('resolved','closed')))
       AND (_assignee = 'any'
            OR (_assignee = 'me' AND e.assigned_to = uid)
            OR (_assignee = 'unassigned' AND e.assigned_to IS NULL))
     LIMIT GREATEST(_limit, 1)
  ) x;

  SELECT jsonb_build_object(
    'open', count(*) FILTER (WHERE status NOT IN ('resolved','closed')),
    'unassigned', count(*) FILTER (WHERE assigned_to IS NULL AND status NOT IN ('resolved','closed')),
    'mine', count(*) FILTER (WHERE assigned_to = uid AND status NOT IN ('resolved','closed')),
    'breached', count(*) FILTER (WHERE sla_due_at < now() AND status NOT IN ('resolved','closed')),
    'acknowledged', count(*) FILTER (WHERE acknowledged_at IS NOT NULL AND status NOT IN ('resolved','closed')),
    'resolved_7d', count(*) FILTER (WHERE resolved_at > now() - interval '7 days'),
    'exposure_cents', COALESCE(sum(value_at_risk_cents) FILTER (WHERE status NOT IN ('resolved','closed')), 0)
  ) INTO stats FROM commercial_exceptions;

  RETURN jsonb_build_object('ok', true, 'can_act', is_exception_operator(uid),
    'items', items, 'stats', stats, 'as_of', now());
END; $$;

-- Workflow actions
CREATE OR REPLACE FUNCTION public.exception_assign(_exception_id uuid, _assignee uuid, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE before_status text; before_assignee uuid;
BEGIN
  IF NOT is_exception_operator() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;
  SELECT status, assigned_to INTO before_status, before_assignee
    FROM commercial_exceptions WHERE id = _exception_id;
  IF before_status IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'exception_not_found'); END IF;

  UPDATE commercial_exceptions
     SET assigned_to = _assignee, assigned_by = auth.uid(), assigned_at = now(),
         status = CASE WHEN status = 'open' THEN 'assigned' ELSE status END,
         updated_at = now()
   WHERE id = _exception_id;

  PERFORM _log_exception_action(_exception_id, 'assigned', before_status,
    (SELECT status FROM commercial_exceptions WHERE id = _exception_id),
    before_assignee, _assignee, _note);
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.exception_acknowledge(_exception_id uuid, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE before_status text;
BEGIN
  IF NOT is_exception_operator() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;
  SELECT status INTO before_status FROM commercial_exceptions WHERE id = _exception_id;
  IF before_status IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'exception_not_found'); END IF;
  IF before_status IN ('resolved','closed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_closed');
  END IF;

  UPDATE commercial_exceptions
     SET acknowledged_by = auth.uid(), acknowledged_at = COALESCE(acknowledged_at, now()),
         assigned_to = COALESCE(assigned_to, auth.uid()),
         assigned_at = COALESCE(assigned_at, now()),
         status = 'acknowledged', updated_at = now()
   WHERE id = _exception_id;

  PERFORM _log_exception_action(_exception_id, 'acknowledged', before_status, 'acknowledged',
    NULL, NULL, _note);
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.exception_triage(
  _exception_id uuid, _root_cause text, _recommended_action text DEFAULT NULL,
  _severity text DEFAULT NULL, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE before_status text;
BEGIN
  IF NOT is_exception_operator() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;
  IF _root_cause IS NULL OR length(trim(_root_cause)) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'root_cause_required');
  END IF;
  SELECT status INTO before_status FROM commercial_exceptions WHERE id = _exception_id;
  IF before_status IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'exception_not_found'); END IF;
  IF before_status IN ('resolved','closed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_closed');
  END IF;

  UPDATE commercial_exceptions
     SET root_cause = _root_cause,
         recommended_action = COALESCE(_recommended_action, recommended_action),
         severity = COALESCE(_severity, severity),
         triaged_by = auth.uid(), triaged_at = now(), triage_notes = _note,
         status = 'in_progress', updated_at = now()
   WHERE id = _exception_id;

  PERFORM _log_exception_action(_exception_id, 'triaged', before_status, 'in_progress',
    NULL, NULL, COALESCE(_note, _root_cause));
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.exception_resolve(
  _exception_id uuid, _resolution text, _financial_impact_cents bigint DEFAULT NULL,
  _learning text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE before_status text; was_breached boolean;
BEGIN
  IF NOT is_exception_operator() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;
  IF _resolution IS NULL OR length(trim(_resolution)) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'resolution_required');
  END IF;
  SELECT status, (sla_due_at IS NOT NULL AND sla_due_at < now())
    INTO before_status, was_breached
    FROM commercial_exceptions WHERE id = _exception_id;
  IF before_status IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'exception_not_found'); END IF;
  IF before_status IN ('resolved','closed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_closed');
  END IF;

  UPDATE commercial_exceptions
     SET status = 'resolved', resolution = _resolution, resolved_by = auth.uid(),
         resolved_at = now(),
         financial_impact_cents = COALESCE(_financial_impact_cents, financial_impact_cents),
         learning_outcome = COALESCE(_learning, learning_outcome),
         updated_at = now()
   WHERE id = _exception_id;

  PERFORM _log_exception_action(_exception_id, 'resolved', before_status, 'resolved',
    NULL, NULL, _resolution);
  RETURN jsonb_build_object('ok', true, 'resolved_after_breach', COALESCE(was_breached, false));
END; $$;

CREATE OR REPLACE FUNCTION public.exception_escalate(_exception_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE before_status text; lvl int;
BEGIN
  IF NOT is_exception_operator() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;
  SELECT status, COALESCE(escalation_level,0) INTO before_status, lvl
    FROM commercial_exceptions WHERE id = _exception_id;
  IF before_status IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'exception_not_found'); END IF;

  UPDATE commercial_exceptions
     SET escalation_level = lvl + 1,
         sla_breached_at = COALESCE(sla_breached_at,
           CASE WHEN sla_due_at < now() THEN sla_due_at ELSE NULL END),
         status = CASE WHEN status IN ('resolved','closed') THEN status ELSE 'escalated' END,
         updated_at = now()
   WHERE id = _exception_id;

  PERFORM _log_exception_action(_exception_id, 'escalated', before_status,
    (SELECT status FROM commercial_exceptions WHERE id = _exception_id),
    NULL, NULL, _reason);
  RETURN jsonb_build_object('ok', true, 'escalation_level', lvl + 1);
END; $$;

CREATE OR REPLACE FUNCTION public.commercial_exception_timeline(_exception_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE rows jsonb;
BEGIN
  IF NOT is_commercial_staff() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC), '[]'::jsonb) INTO rows
    FROM commercial_exception_audit a WHERE a.exception_id = _exception_id;
  RETURN jsonb_build_object('ok', true, 'entries', rows);
END; $$;

-- Escalation sweep records an audit entry for each breach it escalates
CREATE OR REPLACE FUNCTION public.sweep_exception_sla_breaches()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n int := 0;
BEGIN
  IF NOT is_exception_operator() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;
  FOR r IN
    SELECT id, status FROM commercial_exceptions
     WHERE sla_due_at < now() AND status NOT IN ('resolved','closed')
       AND (sla_breached_at IS NULL OR escalation_level = 0)
     LIMIT 500
  LOOP
    UPDATE commercial_exceptions
       SET sla_breached_at = COALESCE(sla_breached_at, sla_due_at),
           escalation_level = COALESCE(escalation_level,0) + 1,
           status = 'escalated', updated_at = now()
     WHERE id = r.id;
    PERFORM _log_exception_action(r.id, 'sla_breach_escalated', r.status, 'escalated',
      NULL, NULL, 'SLA due time passed without resolution', 'sla_sweep');
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'escalated', n);
END; $$;

-- ---------------------------------------------------------------
-- 4. Certification with per-case gap logging
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.certify_phase_8_5_with_gaps()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cert jsonb; rid uuid; tx record; pre jsonb; gaps int := 0;
  missing text[]; blockers text[]; stages text[]; gate text; kind text;
  breakdown jsonb; cases int := 0; clean int := 0;
BEGIN
  IF NOT is_commercial_staff() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;

  cert := certify_phase_8_5();
  IF cert->>'ok' <> 'true' THEN RETURN cert; END IF;
  rid := (cert->>'run_id')::uuid;

  FOR tx IN
    SELECT * FROM commercial_transactions
     WHERE cancelled_at IS NULL
       AND (fulfilled_at IS NOT NULL OR invoice_id IS NOT NULL OR booked_at IS NOT NULL)
     ORDER BY created_at
  LOOP
    cases := cases + 1;
    pre := revenue_gate_precheck(tx.id, NULL);
    missing := COALESCE(ARRAY(SELECT jsonb_array_elements_text(pre->'missing_fields')), ARRAY[]::text[]);
    blockers := COALESCE(ARRAY(SELECT jsonb_array_elements_text(pre->'blockers')), ARRAY[]::text[]);

    SELECT COALESCE(array_agg(s.stage_key ORDER BY s.stage_no), ARRAY[]::text[]) INTO stages
      FROM commercial_lineage_stages s
     WHERE s.transaction_id = tx.id AND s.stage_no <= 12 AND s.status = 'missing';

    kind := CASE
      WHEN tx.service_line IN ('ride_hailing','delivery') THEN 'trip'
      WHEN tx.invoice_id IS NOT NULL THEN 'invoice'
      ELSE 'booking' END;

    IF tx.recognised_at IS NOT NULL
       AND array_length(missing,1) IS NULL
       AND array_length(stages,1) IS NULL THEN
      clean := clean + 1;
      CONTINUE;
    END IF;

    gate := CASE
      WHEN array_length(missing,1) > 0 THEN 'gate_h_economics'
      WHEN tx.financial_review_status <> 'approved' THEN 'finance_sign_off'
      WHEN tx.recognised_at IS NULL AND array_length(blockers,1) > 0 THEN 'recognition_blocked'
      WHEN tx.recognised_at IS NULL THEN 'revenue_not_emitted'
      ELSE 'lineage_incomplete' END;

    INSERT INTO commercial_certification_gaps (
      run_id, transaction_id, transaction_ref, case_kind, service_line, failed_gate,
      missing_fields, blockers, missing_stages, exposure_cents, detail)
    VALUES (rid, tx.id, tx.transaction_ref, kind, tx.service_line, gate,
      missing, blockers, stages,
      COALESCE(tx.platform_revenue_cents, tx.gross_transaction_value_cents, 0),
      CASE WHEN array_length(missing,1) > 0
           THEN format('Missing %s', array_to_string(missing, ', '))
           ELSE COALESCE(blockers[1], 'Lineage stages not recorded') END);
    gaps := gaps + 1;
  END LOOP;

  SELECT COALESCE(jsonb_object_agg(failed_gate, cnt), '{}'::jsonb) INTO breakdown
    FROM (SELECT failed_gate, count(*) AS cnt FROM commercial_certification_gaps
           WHERE run_id = rid GROUP BY failed_gate) b;

  RETURN cert
    || jsonb_build_object(
      'cases_audited', cases,
      'cases_clean', clean,
      'cases_with_gaps', gaps,
      'gap_breakdown', breakdown,
      'gaps', (SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY g.exposure_cents DESC), '[]'::jsonb)
                 FROM commercial_certification_gaps g WHERE g.run_id = rid));
END; $$;

CREATE OR REPLACE FUNCTION public.certification_run_gaps(_run_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid; run record;
BEGIN
  IF NOT is_commercial_staff() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;
  SELECT * INTO run FROM commercial_certification_runs
   WHERE (_run_id IS NULL OR id = _run_id) AND phase = '8.5'
   ORDER BY created_at DESC LIMIT 1;
  IF run.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_run'); END IF;
  rid := run.id;
  RETURN jsonb_build_object('ok', true, 'run_id', rid, 'verdict', run.verdict,
    'score_pct', run.score, 'criteria', run.criteria, 'ran_at', run.created_at,
    'gaps', (SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY g.exposure_cents DESC), '[]'::jsonb)
               FROM commercial_certification_gaps g WHERE g.run_id = rid));
END; $$;

-- ---------------------------------------------------------------
-- 5. Revenue emitter idempotency replay
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.run_revenue_idempotency_replay(
  _replays int DEFAULT 3, _limit int DEFAULT 25)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rid uuid; tx record; i int; resp jsonb; responses jsonb;
  before_n int; after_n int; before_amt bigint; after_amt bigint;
  before_ev uuid; after_ev uuid; dup boolean; ok_case boolean;
  tested int := 0; passed int := 0; failed int := 0; dups int := 0;
  guard boolean; verdict text;
BEGIN
  IF NOT is_commercial_staff() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;

  -- The structural guard: a unique index on the revenue event source reference
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'revenue_events'
       AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%source_ref%'
  ) INTO guard;

  INSERT INTO revenue_idempotency_runs (replays_per_case, run_by, guard_present)
  VALUES (GREATEST(_replays,1), auth.uid(), guard) RETURNING id INTO rid;

  FOR tx IN
    SELECT ct.* FROM commercial_transactions ct
     WHERE ct.recognised_at IS NOT NULL AND ct.cancelled_at IS NULL
     ORDER BY ct.recognised_at DESC LIMIT GREATEST(_limit, 1)
  LOOP
    tested := tested + 1;
    responses := '[]'::jsonb;

    SELECT count(*), COALESCE(sum(gross_amount_cents),0), min(id)
      INTO before_n, before_amt, before_ev
      FROM revenue_events WHERE source_ref = tx.transaction_ref;

    -- Replay the same fulfilment event through the emitter N times
    FOR i IN 1..GREATEST(_replays,1) LOOP
      resp := emit_revenue_event(tx.id, 'idempotency_replay');
      responses := responses || jsonb_build_array(jsonb_build_object('replay', i, 'response', resp));
    END LOOP;

    SELECT count(*), COALESCE(sum(gross_amount_cents),0), min(id)
      INTO after_n, after_amt, after_ev
      FROM revenue_events WHERE source_ref = tx.transaction_ref;

    dup := after_n > before_n OR after_n > 1;
    ok_case := NOT dup AND after_amt = before_amt AND after_ev IS NOT DISTINCT FROM before_ev;

    IF ok_case THEN passed := passed + 1; ELSE failed := failed + 1; END IF;
    IF dup THEN dups := dups + GREATEST(after_n - GREATEST(before_n,1), 0); END IF;

    INSERT INTO revenue_idempotency_checks (
      run_id, transaction_id, transaction_ref, replays, events_before, events_after,
      amount_before_cents, amount_after_cents, revenue_event_id_before,
      revenue_event_id_after, idempotent, duplicate_detected, emitter_responses, detail)
    VALUES (rid, tx.id, tx.transaction_ref, GREATEST(_replays,1), before_n, after_n,
      before_amt, after_amt, before_ev, after_ev, ok_case, dup, responses,
      CASE WHEN ok_case THEN format('%s replays produced no additional revenue event', GREATEST(_replays,1))
           ELSE format('Replay changed recognised revenue: %s -> %s events, %s -> %s cents',
                       before_n, after_n, before_amt, after_amt) END);
  END LOOP;

  verdict := CASE WHEN failed = 0 AND guard THEN 'PASS' ELSE 'FAIL' END;

  UPDATE revenue_idempotency_runs
     SET cases_tested = tested, cases_passed = passed, cases_failed = failed,
         duplicates_created = dups, verdict = verdict
   WHERE id = rid;

  RETURN jsonb_build_object('ok', true, 'run_id', rid, 'verdict', verdict,
    'guard_present', guard, 'replays_per_case', GREATEST(_replays,1),
    'cases_tested', tested, 'cases_passed', passed, 'cases_failed', failed,
    'duplicates_created', dups,
    'checks', (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.idempotent, c.transaction_ref), '[]'::jsonb)
                 FROM revenue_idempotency_checks c WHERE c.run_id = rid));
END; $$;

-- ---------------------------------------------------------------
-- 6. Multi-period commercial priority brief
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commercial_priority_brief(_period text DEFAULT 'day')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cur_start timestamptz; cur_end timestamptz; prev_start timestamptz; prev_end timestamptz;
  cur jsonb; prev jsonb; p text;
BEGIN
  IF NOT is_commercial_staff() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;
  p := lower(COALESCE(_period, 'day'));
  IF p NOT IN ('day','week','month','year') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_period');
  END IF;

  cur_start := date_trunc(p, now());
  cur_end   := now();
  prev_start := cur_start - (('1 ' || p)::interval);
  prev_end   := cur_start;

  SELECT jsonb_build_object(
    'revenue_cents', COALESCE(sum(re.gross_amount_cents), 0),
    'events', count(re.id)
  ) INTO cur FROM revenue_events re
   WHERE re.recognized_at >= cur_start AND re.recognized_at < cur_end;

  SELECT jsonb_build_object(
    'revenue_cents', COALESCE(sum(re.gross_amount_cents), 0),
    'events', count(re.id)
  ) INTO prev FROM revenue_events re
   WHERE re.recognized_at >= prev_start AND re.recognized_at < prev_end;

  cur := cur || (
    SELECT jsonb_build_object(
      'contribution_cents', COALESCE(sum(ct.contribution_cents), 0),
      'transactions', count(*),
      'fulfilments', count(*) FILTER (WHERE ct.fulfilled_at IS NOT NULL),
      'collections_cents', COALESCE(sum(ct.customer_charge_cents) FILTER (WHERE ct.paid_at IS NOT NULL), 0),
      'gtv_cents', COALESCE(sum(ct.gross_transaction_value_cents), 0))
      FROM commercial_transactions ct
     WHERE ct.created_at >= cur_start AND ct.created_at < cur_end);

  prev := prev || (
    SELECT jsonb_build_object(
      'contribution_cents', COALESCE(sum(ct.contribution_cents), 0),
      'transactions', count(*),
      'fulfilments', count(*) FILTER (WHERE ct.fulfilled_at IS NOT NULL),
      'collections_cents', COALESCE(sum(ct.customer_charge_cents) FILTER (WHERE ct.paid_at IS NOT NULL), 0),
      'gtv_cents', COALESCE(sum(ct.gross_transaction_value_cents), 0))
      FROM commercial_transactions ct
     WHERE ct.created_at >= prev_start AND ct.created_at < prev_end);

  RETURN jsonb_build_object(
    'ok', true,
    'period', p,
    'as_of', now(),
    'current_start', cur_start,
    'previous_start', prev_start,
    'current', cur,
    'previous', prev,
    'opportunities', (
      SELECT COALESCE(jsonb_agg(to_jsonb(o)), '[]'::jsonb) FROM (
        SELECT opportunity_ref, title, stage, customer_label, expected_value_cents,
               probability_pct, currency, provenance
          FROM commercial_opportunities
         WHERE stage NOT IN ('won','lost')
         ORDER BY expected_value_cents DESC NULLS LAST LIMIT 10) o),
    'actions', (
      SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) FROM (
        SELECT action_ref, title, recommendation, status, risk_class, authority_class,
               expected_revenue_cents, expected_contribution_cents, confidence_pct,
               approval_required, provenance
          FROM commercial_actions
         WHERE status NOT IN ('closed','executed','rejected')
         ORDER BY expected_contribution_cents DESC NULLS LAST LIMIT 10) a),
    'constraints', (
      SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) FROM (
        SELECT exception_ref, transaction_ref, stage, kind, severity,
               value_at_risk_cents, sla_due_at, owner_team, recommended_action,
               (sla_due_at < now()) AS breached
          FROM commercial_exceptions
         WHERE status NOT IN ('resolved','closed')
         ORDER BY priority_score DESC NULLS LAST LIMIT 10) c),
    'reconciliation_exceptions', (
      SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) FROM (
        SELECT kind, severity, count(*) AS cases,
               COALESCE(sum(value_at_risk_cents), 0) AS exposure_cents
          FROM commercial_exceptions
         WHERE status NOT IN ('resolved','closed')
         GROUP BY kind, severity ORDER BY 4 DESC LIMIT 12) r),
    'critical_incidents', (
      SELECT COALESCE(jsonb_agg(to_jsonb(i)), '[]'::jsonb) FROM (
        SELECT exception_ref, transaction_ref, kind, stage, severity,
               value_at_risk_cents, sla_due_at, escalation_level
          FROM commercial_exceptions
         WHERE severity IN ('critical','high') AND status NOT IN ('resolved','closed')
         ORDER BY value_at_risk_cents DESC NULLS LAST LIMIT 10) i),
    'integrity', commercial_revenue_integrity());
END; $$;

-- ---------------------------------------------------------------
-- 7. Execute grants — signed-in staff only, never anon/public
-- ---------------------------------------------------------------
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'certify_phase_8_5_with_gaps()',
    'certification_run_gaps(uuid)',
    'run_revenue_idempotency_replay(integer,integer)',
    'commercial_priority_brief(text)',
    'commercial_exception_inbox(text,text,integer)',
    'commercial_exception_timeline(uuid)',
    'exception_assign(uuid,uuid,text)',
    'exception_acknowledge(uuid,text)',
    'exception_triage(uuid,text,text,text,text)',
    'exception_resolve(uuid,text,bigint,text)',
    'exception_escalate(uuid,text)',
    'sweep_exception_sla_breaches()',
    'is_exception_operator(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
  END LOOP;
  EXECUTE 'REVOKE ALL ON FUNCTION public._log_exception_action(uuid,text,text,text,uuid,uuid,text,text) FROM PUBLIC, anon, authenticated';
END $$;