-- =====================================================================
-- RENTAL ORCHESTRATION — PHASE 6: CERTIFICATION + CONTROL TOWER
-- =====================================================================

CREATE TABLE public.rental_controls (
  control_code  text PRIMARY KEY,
  domain        text NOT NULL,
  title         text NOT NULL,
  requirement   text NOT NULL,
  evidence_kind text NOT NULL CHECK (evidence_kind IN
                  ('EXECUTED_DB_PROBE','ISOLATED_CONCURRENCY_PROBE','ROLE_SESSION_PROBE',
                   'EXTERNAL_DOCUMENT','OWNER_DECISION','MEASUREMENT','STAGING_END_TO_END')),
  severity      text NOT NULL CHECK (severity IN ('P0','P1','P2')),
  mandatory     boolean NOT NULL DEFAULT true,
  note          text
);
COMMENT ON TABLE public.rental_controls IS
  'Rental production controls. A control is only PASS when executed evidence exists — never from source code, unit tests, mocks or simulations.';
GRANT SELECT ON public.rental_controls TO authenticated;
GRANT ALL ON public.rental_controls TO service_role;
ALTER TABLE public.rental_controls ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read rental controls" ON public.rental_controls
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

INSERT INTO public.rental_controls (control_code, domain, title, requirement, evidence_kind, severity, note) VALUES
 ('RN-01','integrity','Illegal state transitions rejected','The database must refuse a transition that is not in the transition table.','EXECUTED_DB_PROBE','P0',NULL),
 ('RN-02','inventory','Overlapping vehicle commitments impossible','Two commitments on one vehicle covering the same dates must be refused.','EXECUTED_DB_PROBE','P0',NULL),
 ('RN-03','inventory','Concurrent allocation cannot double-book','Two simultaneous sessions racing for the last vehicle must produce exactly one winner.','ISOLATED_CONCURRENCY_PROBE','P0','Requires two real database sessions on isolated infrastructure.'),
 ('RN-04','orchestration','Retried operations are idempotent','A repeated operation key replays the stored result; a reused key with different data is refused.','EXECUTED_DB_PROBE','P0',NULL),
 ('RN-05','finance','Ledger entries must balance','An unbalanced posting cannot be committed by any code path.','EXECUTED_DB_PROBE','P0',NULL),
 ('RN-06','finance','Ledger is append-only','A posting cannot be edited or deleted; corrections are reversals.','EXECUTED_DB_PROBE','P0',NULL),
 ('RN-07','fulfilment','Handover records immutable','A recorded pickup or return cannot be altered.','EXECUTED_DB_PROBE','P1',NULL),
 ('RN-08','finance','Duplicate provider payment never auto-settled','Two verified payments for one quotation must stop and reach finance.','STAGING_END_TO_END','P0','Requires a staging payment pair.'),
 ('RN-09','security','Tenant and customer isolation','Anonymous, rider, provider and staff sessions must each see only what they may.','ROLE_SESSION_PROBE','P0','Requires real signed-in sessions per role.'),
 ('RN-10','finance','Reconciliation covers every rental','Booking, ledger and provider record must agree, and every break must raise a finance item.','EXECUTED_DB_PROBE','P0',NULL),
 ('RN-11','fleet','Vehicle readiness gate enforced','A vehicle without complete readiness evidence cannot be made available.','EXECUTED_DB_PROBE','P0',NULL),
 ('RN-12','policy','No undefined policy in the live path','Deposit, cancellation, refund, late return, licence and corporate rules must be decided.','OWNER_DECISION','P0','Blocked until the owner decides.'),
 ('RN-13','performance','Latency within budget','Availability, quote, booking and callback paths measured against a budget.','MEASUREMENT','P1',NULL),
 ('RN-14','resilience','Backup, restore and data integrity proven','Restore executed on isolated infrastructure with RPO/RTO evidence.','EXTERNAL_DOCUMENT','P0','Runs through the isolated staging programme.'),
 ('RN-15','fleet','Fleet activation readiness','Every vehicle offered for letting has passed its readiness audit.','EXECUTED_DB_PROBE','P0',NULL),
 ('RN-16','notification','Customer notifications delivered','Confirmation and change notifications proven delivered, retried and audited.','STAGING_END_TO_END','P1',NULL),
 ('RN-17','resilience','Failure injection survived','Payment timeout, delayed callback, vehicle loss, event publication failure exercised.','STAGING_END_TO_END','P0',NULL);

CREATE TABLE public.rental_control_evidence (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_code text NOT NULL REFERENCES public.rental_controls(control_code),
  verdict      text NOT NULL CHECK (verdict IN
                 ('PASS','FAIL','PARTIAL','BLOCKED','NOT_TESTED','REQUIRES_EXTERNAL_ACTION')),
  environment  text NOT NULL,
  executed_at  timestamptz NOT NULL DEFAULT now(),
  executed_by  text NOT NULL,
  evidence     jsonb NOT NULL DEFAULT '{}'::jsonb,
  blocked_reason text,
  digest       text
);
COMMENT ON TABLE public.rental_control_evidence IS
  'Append-only evidence register. There is no route for a person or a screen to mark a control PASS — evidence is written by an executed probe.';
CREATE INDEX idx_rental_control_evidence_code ON public.rental_control_evidence (control_code, executed_at DESC);
GRANT SELECT ON public.rental_control_evidence TO authenticated;
GRANT ALL ON public.rental_control_evidence TO service_role;
ALTER TABLE public.rental_control_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read rental control evidence" ON public.rental_control_evidence
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE OR REPLACE FUNCTION public._rental_control_evidence_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'RENTAL_CONTROL_EVIDENCE_IS_APPEND_ONLY'; END; $$;
REVOKE ALL ON FUNCTION public._rental_control_evidence_append_only() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._rental_control_evidence_append_only() TO service_role;
CREATE TRIGGER trg_rental_control_evidence_append_only
  BEFORE UPDATE OR DELETE ON public.rental_control_evidence
  FOR EACH ROW EXECUTE FUNCTION public._rental_control_evidence_append_only();

-- Latest verdict per control; no evidence means NOT_TESTED, never PASS.
CREATE OR REPLACE VIEW public.v_rental_certification
WITH (security_invoker = true) AS
SELECT c.control_code, c.domain, c.title, c.requirement, c.evidence_kind, c.severity, c.mandatory,
       coalesce(e.verdict, 'NOT_TESTED') AS verdict,
       e.environment, e.executed_at, e.executed_by, e.blocked_reason, e.evidence,
       (coalesce(e.verdict,'NOT_TESTED') = 'PASS') AS passed
  FROM public.rental_controls c
  LEFT JOIN LATERAL (
    SELECT * FROM public.rental_control_evidence x
     WHERE x.control_code = c.control_code
     ORDER BY x.executed_at DESC LIMIT 1
  ) e ON true;
GRANT SELECT ON public.v_rental_certification TO authenticated;

CREATE OR REPLACE VIEW public.v_rental_certification_summary
WITH (security_invoker = true) AS
SELECT count(*) AS controls,
       count(*) FILTER (WHERE verdict = 'PASS')     AS passed,
       count(*) FILTER (WHERE verdict = 'FAIL')     AS failed,
       count(*) FILTER (WHERE verdict = 'PARTIAL')  AS partial,
       count(*) FILTER (WHERE verdict = 'BLOCKED')  AS blocked,
       count(*) FILTER (WHERE verdict = 'NOT_TESTED') AS not_tested,
       count(*) FILTER (WHERE verdict = 'REQUIRES_EXTERNAL_ACTION') AS requires_external_action,
       CASE WHEN count(*) FILTER (WHERE mandatory AND verdict <> 'PASS') = 0
            THEN 'PRODUCTION READY' ELSE 'NOT PRODUCTION READY' END AS certification
  FROM public.v_rental_certification;
GRANT SELECT ON public.v_rental_certification_summary TO authenticated;

-- ---------------------------------------------------- CONTROL TOWER
CREATE OR REPLACE VIEW public.v_rental_control_tower
WITH (security_invoker = true) AS
SELECT
  (SELECT count(*) FROM public.rental_bookings WHERE status IN ('CONFIRMED','PICKED_UP')) AS active_bookings,
  (SELECT count(*) FROM public.rental_bookings WHERE status = 'AWAITING_ALLOCATION')      AS awaiting_allocation,
  (SELECT count(*) FROM public.rental_bookings WHERE change_request IS NOT NULL)          AS change_requests_open,
  (SELECT count(*) FROM public.rental_quote_requests
    WHERE payment_status <> 'paid' AND status IN ('QUOTED','AWAITING_PAYMENT') AND expires_at < now()) AS stale_quote_holds,
  (SELECT count(*) FROM public.rental_exceptions WHERE state = 'ESCALATED' AND severity = 'P0') AS escalations_p0,
  (SELECT count(*) FROM public.rental_exceptions WHERE state = 'ESCALATED' AND severity = 'P1') AS escalations_p1,
  (SELECT count(*) FROM public.rental_exceptions WHERE state IN ('OPEN','ESCALATED'))     AS exceptions_open,
  (SELECT count(*) FROM public.rental_refunds WHERE state IN ('REQUESTED','POLICY_REQUIRED','AUTHORISED')) AS refunds_pending,
  (SELECT count(*) FROM public.v_rental_reconciliation WHERE reconciliation_state <> 'RECONCILED') AS reconciliation_breaks,
  (SELECT count(*) FROM public.rental_saga_runs WHERE state IN ('RUNNING','COMPENSATING')) AS sagas_in_flight,
  (SELECT count(*) FROM public.rental_saga_runs WHERE state = 'ESCALATED')                 AS sagas_escalated,
  (SELECT count(*) FROM public.rental_fleet_units WHERE status = 'AVAILABLE')              AS units_available,
  (SELECT count(*) FROM public.rental_fleet_units WHERE status = 'UNDER_SERVICE')          AS units_under_service,
  (SELECT count(*) FROM public.v_rental_unit_readiness WHERE NOT may_be_activated)         AS units_not_ready,
  (SELECT count(*) FROM public.rental_policies WHERE state = 'POLICY_REQUIRED')            AS policies_undecided,
  (SELECT count(*) FROM public.ops_event_outbox WHERE status = 'failed')                   AS failed_platform_events;
GRANT SELECT ON public.v_rental_control_tower TO authenticated;

-- ------------------------------------------- EXECUTED PROBE RUNNER
-- Real writes against the real schema, rolled back inside the function.
CREATE OR REPLACE FUNCTION public.rental_certification_probe_run(_environment text DEFAULT 'live')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE results jsonb := '[]'::jsonb;
        ok boolean; msg text; detail jsonb;
        uid uuid; e1 uuid; claim1 jsonb; claim2 jsonb; claim3 jsonb;
        unready uuid; total int; ready int; undecided int; breaks int; unreconciled int;
  PROCEDURE_PLACEHOLDER boolean;
BEGIN
  -- RN-01 illegal state transition rejected -------------------------
  ok := false; msg := NULL;
  BEGIN
    INSERT INTO public.rental_fleet_units (plate, make, model, status, provenance)
    VALUES ('PROBE-RN01', 'Probe', 'Unit', 'RETIRED', 'CERTIFICATION_PROBE') RETURNING id INTO uid;
    BEGIN
      UPDATE public.rental_fleet_units SET status = 'AVAILABLE' WHERE id = uid;
      ok := false; msg := 'transition was accepted';
    EXCEPTION WHEN OTHERS THEN
      ok := SQLERRM LIKE '%ILLEGAL_TRANSITION_VEHICLE%' OR SQLERRM LIKE '%READINESS_INCOMPLETE%';
      msg := SQLERRM;
    END;
    RAISE EXCEPTION 'PROBE_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'PROBE_ROLLBACK' THEN ok := false; msg := SQLERRM; END IF;
  END;
  results := results || jsonb_build_object('control_code','RN-01','verdict', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END,
    'evidence', jsonb_build_object('probe','RETIRED -> AVAILABLE on a real row','database_response', msg));

  -- RN-02 overlapping commitments refused ---------------------------
  ok := false; msg := NULL;
  BEGIN
    INSERT INTO public.rental_fleet_units (plate, make, model, status, provenance)
    VALUES ('PROBE-RN02', 'Probe', 'Unit', 'UNDER_SERVICE', 'CERTIFICATION_PROBE') RETURNING id INTO uid;
    INSERT INTO public.rental_unit_commitments (unit_id, start_date, end_date, source, note)
    VALUES (uid, current_date + 10, current_date + 14, 'BLOCK', 'probe A');
    BEGIN
      INSERT INTO public.rental_unit_commitments (unit_id, start_date, end_date, source, note)
      VALUES (uid, current_date + 12, current_date + 16, 'BLOCK', 'probe B');
      ok := false; msg := 'overlapping commitment was accepted';
    EXCEPTION WHEN OTHERS THEN
      ok := SQLERRM LIKE '%RENTAL_UNIT_ALREADY_COMMITTED%'; msg := SQLERRM;
    END;
    RAISE EXCEPTION 'PROBE_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'PROBE_ROLLBACK' THEN ok := false; msg := SQLERRM; END IF;
  END;
  results := results || jsonb_build_object('control_code','RN-02','verdict', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END,
    'evidence', jsonb_build_object('probe','two overlapping date ranges on one real vehicle row','database_response', msg));

  -- RN-04 idempotency register -------------------------------------
  ok := false; detail := '{}'::jsonb;
  BEGIN
    claim1 := public.rental_operation_claim('PROBE_OP','probe-key-1','hash-a');
    PERFORM public.rental_operation_complete((claim1 ->> 'operation_id')::uuid, jsonb_build_object('value', 42));
    claim2 := public.rental_operation_claim('PROBE_OP','probe-key-1','hash-a');
    claim3 := public.rental_operation_claim('PROBE_OP','probe-key-1','hash-b');
    ok := coalesce((claim2 ->> 'replay')::boolean,false)
          AND (claim2 -> 'result' ->> 'value') = '42'
          AND coalesce((claim3 ->> 'ok')::boolean,true) = false
          AND (claim3 ->> 'reason_code') = 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST';
    detail := jsonb_build_object('first_claim', claim1, 'replayed_claim', claim2, 'conflicting_claim', claim3);
    RAISE EXCEPTION 'PROBE_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'PROBE_ROLLBACK' THEN ok := false; detail := jsonb_build_object('error', SQLERRM); END IF;
  END;
  results := results || jsonb_build_object('control_code','RN-04','verdict', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END,
    'evidence', detail);

  -- RN-05 unbalanced ledger entry refused ---------------------------
  ok := false; msg := NULL;
  BEGIN
    SET CONSTRAINTS ALL IMMEDIATE;
    INSERT INTO public.rental_ledger_entries (entry_type, source_ref, memo)
    VALUES ('ADJUSTMENT','probe-rn05-'||gen_random_uuid()::text,'probe') RETURNING id INTO e1;
    BEGIN
      INSERT INTO public.rental_ledger_lines (entry_id, account, direction, amount_kes)
      VALUES (e1, 'ADJUSTMENTS','DEBIT', 100);
      ok := false; msg := 'unbalanced entry was accepted';
    EXCEPTION WHEN OTHERS THEN
      ok := SQLERRM LIKE '%NOT_BALANCED%'; msg := SQLERRM;
    END;
    RAISE EXCEPTION 'PROBE_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'PROBE_ROLLBACK' THEN ok := false; msg := SQLERRM; END IF;
  END;
  results := results || jsonb_build_object('control_code','RN-05','verdict', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END,
    'evidence', jsonb_build_object('probe','single-sided posting with constraints immediate','database_response', msg));

  -- RN-06 ledger append-only ----------------------------------------
  ok := false; msg := NULL;
  BEGIN
    INSERT INTO public.rental_ledger_entries (entry_type, source_ref, memo)
    VALUES ('ADJUSTMENT','probe-rn06-'||gen_random_uuid()::text,'probe') RETURNING id INTO e1;
    BEGIN
      UPDATE public.rental_ledger_entries SET memo = 'tampered' WHERE id = e1;
      ok := false; msg := 'ledger entry was editable';
    EXCEPTION WHEN OTHERS THEN
      ok := SQLERRM LIKE '%APPEND_ONLY%'; msg := SQLERRM;
    END;
    RAISE EXCEPTION 'PROBE_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'PROBE_ROLLBACK' THEN ok := false; msg := SQLERRM; END IF;
  END;
  results := results || jsonb_build_object('control_code','RN-06','verdict', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END,
    'evidence', jsonb_build_object('probe','UPDATE on a committed-shape ledger entry','database_response', msg));

  -- RN-11 vehicle readiness gate ------------------------------------
  ok := false; msg := NULL;
  BEGIN
    INSERT INTO public.rental_fleet_units (plate, make, model, status, provenance)
    VALUES ('PROBE-RN11','Probe','Unit','UNDER_SERVICE','CERTIFICATION_PROBE') RETURNING id INTO unready;
    BEGIN
      UPDATE public.rental_fleet_units SET status = 'AVAILABLE' WHERE id = unready;
      ok := false; msg := 'an unaudited vehicle was made available';
    EXCEPTION WHEN OTHERS THEN
      ok := SQLERRM LIKE '%READINESS_INCOMPLETE%'; msg := SQLERRM;
    END;
    RAISE EXCEPTION 'PROBE_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'PROBE_ROLLBACK' THEN ok := false; msg := SQLERRM; END IF;
  END;
  results := results || jsonb_build_object('control_code','RN-11','verdict', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END,
    'evidence', jsonb_build_object('probe','activate a vehicle with no readiness evidence','database_response', msg));

  -- RN-10 reconciliation coverage -----------------------------------
  SELECT count(*) INTO breaks FROM public.rental_bookings;
  SELECT count(*) INTO unreconciled FROM public.v_rental_reconciliation WHERE reconciliation_state <> 'RECONCILED';
  results := results || jsonb_build_object('control_code','RN-10',
    'verdict', CASE WHEN breaks = 0 THEN 'NOT_TESTED' WHEN unreconciled = 0 THEN 'PASS' ELSE 'FAIL' END,
    'evidence', jsonb_build_object('bookings', breaks, 'unreconciled', unreconciled,
      'note', CASE WHEN breaks = 0 THEN 'No settled rentals exist yet, so reconciliation is untested.' ELSE NULL END));

  -- RN-15 fleet activation readiness --------------------------------
  SELECT count(*) INTO total FROM public.rental_fleet_units WHERE status = 'AVAILABLE';
  SELECT count(*) INTO ready FROM public.v_rental_unit_readiness WHERE status = 'AVAILABLE' AND may_be_activated;
  results := results || jsonb_build_object('control_code','RN-15',
    'verdict', CASE WHEN total = 0 THEN 'BLOCKED' WHEN total = ready THEN 'PASS' ELSE 'FAIL' END,
    'evidence', jsonb_build_object('units_available', total, 'units_audited', ready),
    'blocked_reason', CASE WHEN total = 0 THEN 'No vehicle has completed its readiness audit, so no rental can be fulfilled yet.' END);

  -- RN-12 policy completeness ---------------------------------------
  SELECT count(*) INTO undecided FROM public.rental_policies WHERE state = 'POLICY_REQUIRED';
  results := results || jsonb_build_object('control_code','RN-12',
    'verdict', CASE WHEN undecided = 0 THEN 'PASS' ELSE 'BLOCKED' END,
    'evidence', jsonb_build_object('undecided_policies', undecided,
      'codes', (SELECT coalesce(jsonb_agg(policy_code ORDER BY policy_code),'[]'::jsonb)
                  FROM public.rental_policies WHERE state = 'POLICY_REQUIRED')),
    'blocked_reason', CASE WHEN undecided > 0 THEN 'Deposit, cancellation, refund, late-return, licence and corporate rules are undecided by the business owner.' END);

  -- Controls that cannot be proven from a single session ------------
  results := results
    || jsonb_build_object('control_code','RN-03','verdict','BLOCKED','evidence','{}'::jsonb,
         'blocked_reason','Needs two concurrent database sessions on isolated infrastructure. A single-session probe cannot prove a race.')
    || jsonb_build_object('control_code','RN-07','verdict','BLOCKED','evidence','{}'::jsonb,
         'blocked_reason','Needs a staged booking with a recorded handover; not provable without staging fixtures.')
    || jsonb_build_object('control_code','RN-08','verdict','BLOCKED','evidence','{}'::jsonb,
         'blocked_reason','Needs two verified provider payments for one quotation in staging.')
    || jsonb_build_object('control_code','RN-09','verdict','BLOCKED','evidence','{}'::jsonb,
         'blocked_reason','Needs real anonymous, rider, provider and staff sessions.')
    || jsonb_build_object('control_code','RN-13','verdict','NOT_TESTED','evidence','{}'::jsonb,
         'blocked_reason','Latency has not been measured on the rental paths yet.')
    || jsonb_build_object('control_code','RN-14','verdict','REQUIRES_EXTERNAL_ACTION','evidence','{}'::jsonb,
         'blocked_reason','Restore and integrity evidence comes from the isolated staging programme.')
    || jsonb_build_object('control_code','RN-16','verdict','NOT_TESTED','evidence','{}'::jsonb,
         'blocked_reason','Notification delivery has not been proven end to end for rentals.')
    || jsonb_build_object('control_code','RN-17','verdict','NOT_TESTED','evidence','{}'::jsonb,
         'blocked_reason','Failure injection has not been executed for the rental paths.');

  -- Record the evidence.
  INSERT INTO public.rental_control_evidence (control_code, verdict, environment, executed_by, evidence, blocked_reason)
  SELECT r ->> 'control_code', r ->> 'verdict', _environment, 'rental_certification_probe_run',
         coalesce(r -> 'evidence','{}'::jsonb), r ->> 'blocked_reason'
    FROM jsonb_array_elements(results) r;

  RETURN jsonb_build_object('ok', true, 'executed_at', now(), 'environment', _environment,
    'results', results,
    'summary', (SELECT to_jsonb(s) FROM public.v_rental_certification_summary s));
END; $$;
REVOKE ALL ON FUNCTION public.rental_certification_probe_run(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_certification_probe_run(text) TO service_role;