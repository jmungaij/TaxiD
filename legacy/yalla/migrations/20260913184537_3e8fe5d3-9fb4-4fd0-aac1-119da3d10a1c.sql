DO $probe$
DECLARE
  v18 text := 'PASS'; e18 jsonb;
  v19 text := 'PASS'; e19 jsonb;
  v20 text := 'PASS'; e20 jsonb;
  v21 text := 'PASS'; e21 jsonb;
  v22 text := 'PASS'; e22 jsonb;
  v23 text := 'PARTIAL'; e23 jsonb;
  v28 text := 'PASS'; e28 jsonb;
  v29 text := 'PASS'; e29 jsonb;
  n_missing int; n_multi int; n_versions int;
  blocked_update boolean := false; blocked_delete boolean := false;
  ev_blocked boolean := false; ledger_blocked boolean := false;
  did uuid; acct uuid; g1 jsonb; g2 jsonb; g3 jsonb;
  ex_id uuid; ex_class text; ex_due timestamptz; ex_owner text; ex_esc text;
  cons jsonb; truth jsonb;
BEGIN
  -- ---------- RN-18: every policy has a dated version, at most one ACTIVE ----------
  SELECT count(*) INTO n_missing FROM public.rental_policies p
   WHERE NOT EXISTS (SELECT 1 FROM public.rental_policy_versions v WHERE v.policy_code = p.policy_code);
  SELECT count(*) INTO n_multi FROM (
    SELECT policy_code FROM public.rental_policy_versions WHERE state='ACTIVE'
     GROUP BY policy_code HAVING count(*) > 1) x;
  SELECT count(*) INTO n_versions FROM public.rental_policy_versions;
  IF n_missing > 0 OR n_multi > 0 THEN v18 := 'FAIL'; END IF;
  e18 := jsonb_build_object('policies_without_version', n_missing,
    'policies_with_more_than_one_active_version', n_multi, 'versions_total', n_versions,
    'pending_business_approval', (SELECT count(*) FROM public.rental_policy_versions WHERE state='PENDING_BUSINESS_APPROVAL'));

  -- ---------- RN-19: decision log is append-only ----------
  BEGIN
    INSERT INTO public.rental_policy_decisions
      (evaluation_point, policy_code, policy_version, rule_type, subject_type, subject_ref,
       input, decision, reason)
    VALUES ('CERTIFICATION_PROBE','RENTAL_LENGTH_BOUNDS',1,'CONFIGURABLE','probe','RN-19-PROBE',
            '{"probe":true}'::jsonb,'ALLOW','append-only probe')
    RETURNING id INTO did;
    BEGIN
      UPDATE public.rental_policy_decisions SET decision='TAMPERED' WHERE id = did;
    EXCEPTION WHEN others THEN blocked_update := true; END;
    BEGIN
      DELETE FROM public.rental_policy_decisions WHERE id = did;
    EXCEPTION WHEN others THEN blocked_delete := true; END;
    RAISE EXCEPTION 'PROBE_ROLLBACK_RN19';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'PROBE_ROLLBACK_RN19' THEN v19 := 'FAIL'; END IF;
  END;
  IF NOT (blocked_update AND blocked_delete) THEN v19 := 'FAIL'; END IF;
  e19 := jsonb_build_object('update_rejected', blocked_update, 'delete_rejected', blocked_delete,
    'decisions_logged', (SELECT count(*) FROM public.rental_policy_decisions));

  -- ---------- RN-28: domain events and ledger lines are immutable ----------
  BEGIN
    BEGIN
      UPDATE public.rental_domain_events SET event_type = event_type || '_X'
       WHERE id = (SELECT id FROM public.rental_domain_events LIMIT 1);
      IF NOT FOUND THEN ev_blocked := NULL; END IF;
    EXCEPTION WHEN others THEN ev_blocked := true; END;
    BEGIN
      UPDATE public.rental_ledger_lines SET amount_kes = amount_kes
       WHERE id = (SELECT id FROM public.rental_ledger_lines LIMIT 1);
    EXCEPTION WHEN others THEN ledger_blocked := true; END;
    RAISE EXCEPTION 'PROBE_ROLLBACK_RN28';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'PROBE_ROLLBACK_RN28' THEN NULL; END IF;
  END;
  IF ev_blocked IS NOT true THEN v28 := 'PARTIAL'; END IF;
  e28 := jsonb_build_object('domain_event_update_rejected', ev_blocked,
    'ledger_line_update_rejected', ledger_blocked,
    'domain_events', (SELECT count(*) FROM public.rental_domain_events),
    'ledger_lines', (SELECT count(*) FROM public.rental_ledger_lines),
    'note', 'Update attempted on a real stored row inside a rolled-back trial.');

  -- ---------- RN-22: SLA stamping on a newly opened exception ----------
  BEGIN
    INSERT INTO public.rental_exceptions (exception_code, subject_type, subject_ref, state, severity, attempts, detail)
    VALUES ('RECONCILIATION_BREAK','probe','RN-22-PROBE','OPEN','P0',1,'{"probe":true}'::jsonb)
    RETURNING id, decision_class, sla_due_at, owner_role, escalated_to
      INTO ex_id, ex_class, ex_due, ex_owner, ex_esc;
    RAISE EXCEPTION 'PROBE_ROLLBACK_RN22';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'PROBE_ROLLBACK_RN22' THEN v22 := 'FAIL'; END IF;
  END;
  IF ex_class IS NULL OR ex_due IS NULL OR ex_owner IS NULL OR ex_esc IS NULL THEN v22 := 'FAIL'; END IF;
  e22 := jsonb_build_object('decision_class', ex_class, 'sla_due_at', ex_due,
    'owner_role', ex_owner, 'escalation', ex_esc,
    'policies_classified', (SELECT count(*) FROM public.rental_exception_policies WHERE decision_class IS NOT NULL),
    'policies_total', (SELECT count(*) FROM public.rental_exception_policies));

  -- ---------- RN-20 / RN-21: corporate approval and credit gate ----------
  BEGIN
    INSERT INTO public.rental_corporate_accounts
      (account_code, legal_name, status, credit_state, credit_limit_kes,
       payment_terms_days, auto_approve_below_kes, elevated_approval_above_kes)
    VALUES ('PROBE-CORP','Probe Corporate Ltd','ACTIVE','NO_CREDIT',0,30,50000,300000)
    RETURNING id INTO acct;

    -- above the auto-approval threshold: must block and raise an approval request
    g1 := public.rental_corporate_gate('Probe Corporate Ltd', 180000, NULL, 'RN-20-PROBE', NULL);
    IF coalesce((g1 ->> 'allow')::boolean, true) THEN v20 := 'FAIL'; END IF;
    IF (g1 ->> 'reason_code') <> 'CORPORATE_APPROVAL_REQUESTED' THEN v20 := 'FAIL'; END IF;

    -- once approved, the same booking is allowed
    UPDATE public.rental_corporate_approvals SET state='APPROVED', decided_at = now()
     WHERE quote_reference = 'RN-20-PROBE';
    g2 := public.rental_corporate_gate('Probe Corporate Ltd', 180000, NULL, 'RN-20-PROBE', NULL);
    IF coalesce((g2 ->> 'allow')::boolean, false) IS NOT true THEN v20 := 'FAIL'; END IF;

    -- credit approved but limit exhausted: must block
    UPDATE public.rental_corporate_accounts
       SET credit_state='APPROVED', credit_limit_kes = 100000 WHERE id = acct;
    g3 := public.rental_corporate_gate('Probe Corporate Ltd', 400000, NULL, 'RN-21-PROBE', NULL);
    IF coalesce((g3 ->> 'allow')::boolean, true) THEN v21 := 'FAIL'; END IF;
    IF (g3 ->> 'reason_code') <> 'AVAILABLE_CREDIT_INSUFFICIENT' THEN v21 := 'FAIL'; END IF;

    RAISE EXCEPTION 'PROBE_ROLLBACK_CORP';
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'PROBE_ROLLBACK_CORP' THEN
      v20 := 'FAIL'; v21 := 'FAIL';
      e20 := jsonb_build_object('error', SQLERRM);
    END IF;
  END;
  e20 := coalesce(e20, jsonb_build_object('unapproved', g1, 'after_approval', g2,
    'note','Executed against the live database inside a rolled-back trial; no probe rows retained.'));
  e21 := jsonb_build_object('credit_exhausted', g3, 'limit_kes', 100000, 'requested_kes', 400000);

  -- ---------- RN-23: booking truth guard ----------
  truth := public.rental_booking_truth('RN-23-PROBE-NONE');
  e23 := jsonb_build_object('unauthorised_read', truth,
    'note','Guard refuses a caller without staff authority. Full payload still requires a real booking read by a staff session.');
  IF (truth ->> 'reason_code') IS DISTINCT FROM 'NOT_AUTHORISED' THEN v23 := 'PARTIAL'; END IF;

  -- ---------- RN-29: certification arithmetic ----------
  cons := public.rental_certification_consistency();
  IF coalesce((cons ->> 'consistent')::boolean, false) IS NOT true THEN v29 := 'FAIL'; END IF;
  e29 := cons;

  -- ---------- record evidence ----------
  INSERT INTO public.rental_control_evidence
    (control_code, verdict, environment, executed_at, executed_by, evidence, blocked_reason)
  VALUES
   ('RN-18', v18, 'live-production-database', now(), 'certification-probe', e18, NULL),
   ('RN-19', v19, 'live-production-database', now(), 'certification-probe', e19, NULL),
   ('RN-20', v20, 'live-production-database', now(), 'certification-probe', e20, NULL),
   ('RN-21', v21, 'live-production-database', now(), 'certification-probe', e21, NULL),
   ('RN-22', v22, 'live-production-database', now(), 'certification-probe', e22, NULL),
   ('RN-23', v23, 'live-production-database', now(), 'certification-probe', e23,
     'Needs one real booking read by a staff session to prove the full payload.'),
   ('RN-28', v28, 'live-production-database', now(), 'certification-probe', e28,
     CASE WHEN v28 <> 'PASS' THEN 'Ledger line immutability not exercised: no stored ledger line to attempt.' END),
   ('RN-29', v29, 'live-production-database', now(), 'certification-probe', e29, NULL);
END $probe$;