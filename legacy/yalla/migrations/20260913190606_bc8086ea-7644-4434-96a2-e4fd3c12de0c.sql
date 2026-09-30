CREATE OR REPLACE FUNCTION public.rental_control_record(
  _code text, _verdict text, _environment text, _evidence jsonb, _blocked_reason text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO public.rental_control_evidence
    (control_code, verdict, environment, executed_by, evidence, blocked_reason, digest)
  VALUES (_code, _verdict, _environment, 'rental_catalogue_probe_run',
          coalesce(_evidence,'{}'::jsonb), _blocked_reason,
          md5(_code || _verdict || coalesce(_evidence::text,'') || now()::text));
$$;
REVOKE ALL ON FUNCTION public.rental_control_record(text, text, text, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rental_control_record(text, text, text, jsonb, text) FROM anon;
REVOKE ALL ON FUNCTION public.rental_control_record(text, text, text, jsonb, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rental_control_record(text, text, text, jsonb, text) TO service_role;

CREATE OR REPLACE FUNCTION public.rental_catalogue_probe_run(_environment text DEFAULT 'live-production-database')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE env text := coalesce(_environment,'live-production-database');
        n bigint; m bigint; k bigint; ok boolean; det jsonb; u uuid; c1 uuid; refused boolean;
        executed int := 0;
BEGIN
  -- ARC-01 ownership register
  SELECT count(*) INTO n FROM public.rental_domain_authority;
  SELECT count(*) INTO m FROM public.rental_domain_authority
   WHERE entity_type IN ('quote','booking','unit','ledger','policy');
  PERFORM public.rental_control_record('ARC-01', CASE WHEN n > 0 AND m >= 3 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('authority_rows', n, 'core_entities_covered', m));

  -- ARC-02 state machines as data + triggers
  SELECT count(*) INTO n FROM public.rental_state_transitions;
  SELECT count(*) INTO m FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
   WHERE NOT t.tgisinternal AND t.tgname IN
     ('trg_rental_booking_transition','trg_rental_quote_transition','trg_rental_unit_transition');
  PERFORM public.rental_control_record('ARC-02', CASE WHEN n >= 10 AND m = 3 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('transition_rows', n, 'enforcing_triggers', m));

  -- ARC-03 append-only events with correlation
  SELECT count(*) INTO n FROM pg_trigger WHERE tgname = 'trg_rental_domain_events_append_only';
  SELECT count(*) INTO m FROM public.rental_domain_events WHERE correlation_id IS NULL;
  SELECT count(*) INTO k FROM public.rental_domain_events;
  PERFORM public.rental_control_record('ARC-03',
    CASE WHEN n = 1 AND m = 0 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('append_only_trigger', n, 'events', k, 'events_without_correlation', m));

  -- ARC-04 orchestration hand-off
  SELECT count(*) INTO n FROM public.rental_event_escalations;
  SELECT count(*) INTO m FROM public.ops_event_outbox WHERE event_type LIKE 'rental.%';
  PERFORM public.rental_control_record('ARC-04',
    CASE WHEN n > 0 AND m > 0 THEN 'PASS' WHEN n > 0 THEN 'PARTIAL' ELSE 'FAIL' END, env,
    jsonb_build_object('escalation_rules', n, 'rental_events_published', m),
    CASE WHEN n > 0 AND m = 0 THEN 'ESCALATION_MAP_PRESENT_NO_PUBLISHED_EVENT_YET' END);

  -- ARC-05 saga compensation
  SELECT count(*) INTO n FROM public.rental_saga_runs;
  SELECT count(*) INTO m FROM public.rental_saga_steps WHERE state = 'FAILED' AND compensation IS NULL;
  PERFORM public.rental_control_record('ARC-05',
    CASE WHEN n = 0 THEN 'NOT_TESTED' WHEN m = 0 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('saga_runs', n, 'failed_steps_without_compensation', m),
    CASE WHEN n = 0 THEN 'NO_SAGA_HAS_RUN_YET' END);

  -- ARC-06 idempotency register
  SELECT count(*) INTO n FROM pg_indexes
   WHERE schemaname='public' AND tablename='rental_operations'
     AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%idempotency_key%';
  PERFORM public.rental_control_record('ARC-06', CASE WHEN n > 0 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('unique_idempotency_indexes', n));

  -- ARC-07 server-authoritative pricing
  SELECT count(*) INTO n FROM public.rental_quote_requests;
  SELECT count(*) INTO m FROM public.rental_quote_requests
   WHERE snapshot_hash IS NULL OR pricing_version IS NULL;
  PERFORM public.rental_control_record('ARC-07',
    CASE WHEN n = 0 THEN 'NOT_TESTED' WHEN m = 0 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('quotes', n, 'quotes_without_priced_snapshot', m),
    CASE WHEN n = 0 THEN 'NO_QUOTATION_ISSUED_YET' END);

  -- ARC-08 provider abstraction
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='rental_fleet_units' AND column_name='provider_id';
  SELECT count(*) INTO m FROM public.rental_providers;
  PERFORM public.rental_control_record('ARC-08', CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('units_carry_provider', n = 1, 'providers_registered', m));

  -- SEC-01 row level security on every rental table
  SELECT count(*) INTO n FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
   WHERE s.nspname='public' AND c.relkind='r' AND c.relname LIKE 'rental\_%';
  SELECT count(*) INTO m FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
   WHERE s.nspname='public' AND c.relkind='r' AND c.relname LIKE 'rental\_%' AND c.relrowsecurity = false;
  PERFORM public.rental_control_record('SEC-01', CASE WHEN m = 0 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('rental_tables', n, 'without_row_level_security', m));

  -- SEC-02 anonymous holds no table privilege
  SELECT count(*) INTO m FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name LIKE 'rental\_%' AND grantee='anon';
  PERFORM public.rental_control_record('SEC-02', CASE WHEN m = 0 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('anon_table_grants', m));

  -- SEC-03 privileged routines closed to anonymous (rental_quote_open is the declared public entrypoint)
  SELECT count(*) INTO m FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
   WHERE s.nspname='public' AND p.proname LIKE 'rental\_%' AND p.prosecdef
     AND p.proname <> 'rental_quote_open'
     AND has_function_privilege('anon', p.oid, 'EXECUTE');
  PERFORM public.rental_control_record('SEC-03', CASE WHEN m = 0 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('anon_executable_privileged_routines', m,
                       'declared_public_entrypoints', jsonb_build_array('rental_quote_open')));

  -- SEC-08 event payload minimisation
  SELECT count(*) INTO n FROM public.rental_domain_events;
  SELECT count(*) INTO m FROM public.rental_domain_events
   WHERE payload ?| array['contact_phone','contact_email','id_number','licence_number','msisdn'];
  PERFORM public.rental_control_record('SEC-08',
    CASE WHEN n = 0 THEN 'NOT_TESTED' WHEN m = 0 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('events', n, 'events_carrying_personal_fields', m),
    CASE WHEN n = 0 THEN 'NO_EVENT_RECORDED_YET' END);

  -- INV-02 real double-booking attempt on one vehicle
  SELECT id INTO u FROM public.rental_fleet_units ORDER BY created_at LIMIT 1;
  IF u IS NULL THEN
    PERFORM public.rental_control_record('INV-02','BLOCKED', env,
      jsonb_build_object('reason','No fleet unit exists to probe'), 'NO_FLEET_UNIT_TO_PROBE');
  ELSE
    refused := false;
    INSERT INTO public.rental_unit_commitments (unit_id, start_date, end_date, source, note)
    VALUES (u, current_date + 3650, current_date + 3655, 'BLOCK', 'certification probe INV-02')
    RETURNING id INTO c1;
    BEGIN
      INSERT INTO public.rental_unit_commitments (unit_id, start_date, end_date, source, note)
      VALUES (u, current_date + 3652, current_date + 3657, 'BLOCK', 'certification probe INV-02 overlap');
    EXCEPTION WHEN others THEN
      refused := true; det := jsonb_build_object('refusal', SQLERRM);
    END;
    DELETE FROM public.rental_unit_commitments WHERE note LIKE 'certification probe INV-02%';
    PERFORM public.rental_control_record('INV-02', CASE WHEN refused THEN 'PASS' ELSE 'FAIL' END, env,
      jsonb_build_object('unit_id', u, 'overlapping_insert_refused', refused) || coalesce(det,'{}'::jsonb));
  END IF;

  -- INV-07 readiness checklists per unit
  SELECT count(*) INTO n FROM public.rental_fleet_units;
  SELECT count(*) INTO m FROM public.v_rental_unit_readiness WHERE coalesce(ready, false) = true;
  PERFORM public.rental_control_record('INV-07',
    CASE WHEN n = 0 THEN 'NOT_TESTED' WHEN m > 0 THEN 'PASS' ELSE 'BLOCKED' END, env,
    jsonb_build_object('units', n, 'units_with_complete_readiness', m),
    CASE WHEN n > 0 AND m = 0 THEN 'NO_UNIT_HAS_COMPLETED_READINESS_EVIDENCE' END);

  -- INV-08 retired stays retired (delegates to the executed transition-table probe)
  SELECT count(*) INTO n FROM public.rental_state_transitions
   WHERE entity_type = 'unit' AND from_state = 'RETIRED';
  PERFORM public.rental_control_record('INV-08', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('legal_transitions_out_of_retired', n));

  -- BKG-02 quotation expiry
  SELECT count(*) INTO n FROM public.rental_quote_requests
   WHERE expires_at < now() AND payment_status = 'PAID';
  PERFORM public.rental_control_record('BKG-02', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('expired_quotes_that_were_paid', n));

  -- BKG-04 booking transition table
  SELECT count(*) INTO n FROM public.rental_state_transitions WHERE entity_type = 'booking';
  PERFORM public.rental_control_record('BKG-04', CASE WHEN n >= 4 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('booking_transitions_declared', n));

  -- BKG-07 handover gate
  SELECT count(*) INTO n FROM pg_trigger WHERE tgname = 'trg_rental_handover_immutable';
  SELECT count(*) INTO m FROM public.rental_bookings
   WHERE status IN ('PICKED_UP','RETURNED')
     AND NOT EXISTS (SELECT 1 FROM public.rental_handovers h WHERE h.booking_id = rental_bookings.id);
  PERFORM public.rental_control_record('BKG-07',
    CASE WHEN n = 1 AND m = 0 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('handover_immutability_trigger', n, 'statuses_without_handover_record', m));

  -- BKG-08 booking truth
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
   WHERE s.nspname='public' AND p.proname = 'rental_booking_truth';
  PERFORM public.rental_control_record('BKG-08', CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('booking_truth_routine', n));

  -- PAY-01 verified-payment settlement path
  SELECT count(*) INTO n FROM pg_trigger WHERE tgname = 'trg_rental_settle_on_verified_payment';
  PERFORM public.rental_control_record('PAY-01', CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('verified_payment_trigger', n));

  -- PAY-02 replay idempotency register in use on the settlement operation
  SELECT count(*) INTO n FROM public.rental_operations WHERE operation = 'QUOTE_SETTLE_PAYMENT';
  PERFORM public.rental_control_record('PAY-02',
    CASE WHEN n = 0 THEN 'NOT_TESTED' ELSE 'PASS' END, env,
    jsonb_build_object('settlement_operations_claimed', n),
    CASE WHEN n = 0 THEN 'NO_PAYMENT_HAS_BEEN_SETTLED_YET' END);

  -- PAY-05 refunds only through the lifecycle
  SELECT count(*) INTO n FROM public.rental_refunds;
  SELECT count(*) INTO m FROM public.rental_refunds
   WHERE state IN ('REFUNDED','REFUND_INITIATED') AND (approved_by IS NULL OR policy_basis IS NULL);
  PERFORM public.rental_control_record('PAY-05',
    CASE WHEN n = 0 THEN 'NOT_TESTED' WHEN m = 0 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('refunds', n, 'refunds_without_approval_or_basis', m),
    CASE WHEN n = 0 THEN 'NO_REFUND_RAISED_YET' END);

  -- FIN-01 ledger balance
  SELECT count(*) INTO n FROM public.rental_ledger_entries;
  SELECT count(*) INTO m FROM (
    SELECT l.entry_id FROM public.rental_ledger_lines l
     GROUP BY l.entry_id
    HAVING coalesce(sum(CASE WHEN l.direction='DEBIT' THEN l.amount_kes ELSE 0 END),0)
        <> coalesce(sum(CASE WHEN l.direction='CREDIT' THEN l.amount_kes ELSE 0 END),0)) x;
  PERFORM public.rental_control_record('FIN-01',
    CASE WHEN n = 0 THEN 'NOT_TESTED' WHEN m = 0 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('ledger_entries', n, 'unbalanced_entries', m),
    CASE WHEN n = 0 THEN 'NO_LEDGER_POSTING_YET' END);

  -- FIN-06 reversals never deletions
  SELECT count(*) INTO n FROM pg_trigger
   WHERE tgname IN ('trg_rental_ledger_lines_immutable','trg_rental_ledger_entries_immutable');
  PERFORM public.rental_control_record('FIN-06', CASE WHEN n = 2 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('ledger_immutability_triggers', n));

  -- FIN-07 three-way reconciliation
  SELECT count(*) INTO n FROM public.v_rental_reconciliation;
  SELECT count(*) INTO m FROM public.v_rental_reconciliation WHERE coalesce(reconciled, false) = false;
  PERFORM public.rental_control_record('FIN-07',
    CASE WHEN n = 0 THEN 'NOT_TESTED' WHEN m = 0 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('reconciliation_rows', n, 'unreconciled_rows', m),
    CASE WHEN n = 0 THEN 'NO_SETTLED_RENTAL_TO_RECONCILE_YET' END);

  -- POL-01 versioned rules
  SELECT count(*) INTO n FROM public.rental_policies;
  SELECT count(*) INTO m FROM public.rental_policies p
   WHERE p.state = 'ACTIVE'
     AND NOT EXISTS (SELECT 1 FROM public.rental_policy_versions v
                      WHERE v.policy_code = p.policy_code AND v.effective_from IS NOT NULL);
  PERFORM public.rental_control_record('POL-01', CASE WHEN m = 0 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('policies', n, 'active_policies_without_version', m));

  -- POL-03 decision log
  SELECT count(*) INTO n FROM public.rental_policy_decisions;
  SELECT count(*) INTO m FROM public.rental_policy_decisions
   WHERE decision IS NULL OR evaluation_point IS NULL OR actor_kind IS NULL;
  PERFORM public.rental_control_record('POL-03',
    CASE WHEN n = 0 THEN 'NOT_TESTED' WHEN m = 0 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('decisions_logged', n, 'incomplete_decisions', m),
    CASE WHEN n = 0 THEN 'NO_POLICY_EVALUATION_RECORDED_YET' END);

  -- POL-04 pending rules keep the gate shut
  SELECT count(*) INTO n FROM public.rental_policies WHERE state <> 'ACTIVE';
  SELECT count(*) INTO m FROM public.v_rental_release_gates
   WHERE gate_code IN ('G7_POLICY','GC_POLICY') AND gate_status = 'PASS';
  PERFORM public.rental_control_record('POL-04',
    CASE WHEN n > 0 AND m = 0 THEN 'PASS' WHEN n = 0 THEN 'NOT_TESTED' ELSE 'FAIL' END, env,
    jsonb_build_object('rules_awaiting_business_approval', n, 'policy_gates_passing', m),
    CASE WHEN n = 0 THEN 'NO_PENDING_RULE_TO_TEST_THE_GATE_WITH' END);

  -- OPS-01 / OPS-03 exception lifecycle and service levels
  SELECT count(*) INTO n FROM public.rental_exception_policies;
  SELECT count(*) INTO m FROM public.rental_exceptions;
  PERFORM public.rental_control_record('OPS-01',
    CASE WHEN n > 0 AND m > 0 THEN 'PASS' WHEN n > 0 THEN 'PARTIAL' ELSE 'FAIL' END, env,
    jsonb_build_object('exception_policies', n, 'exceptions_raised', m),
    CASE WHEN n > 0 AND m = 0 THEN 'LIFECYCLE_DEFINED_NO_EXCEPTION_RAISED_YET' END);
  SELECT count(*) INTO k FROM pg_trigger WHERE tgname = 'trg_rental_exception_stamp_sla';
  PERFORM public.rental_control_record('OPS-03', CASE WHEN k = 1 AND n > 0 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('sla_stamping_trigger', k, 'policies_with_owner_and_deadline', n));

  -- OPS-04 control tower
  SELECT count(*) INTO n FROM public.v_rental_control_tower;
  PERFORM public.rental_control_record('OPS-04', CASE WHEN n > 0 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('control_tower_rows', n));

  -- OPS-06 corporate portal
  SELECT count(*) INTO n FROM public.rental_corporate_accounts;
  SELECT count(*) INTO m FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
   WHERE s.nspname='public' AND p.proname IN
     ('rental_corporate_portal','rental_corporate_budget_set','rental_corporate_submit_booking');
  PERFORM public.rental_control_record('OPS-06',
    CASE WHEN m = 3 AND n > 0 THEN 'PASS' WHEN m = 3 THEN 'PARTIAL' ELSE 'FAIL' END, env,
    jsonb_build_object('portal_routines', m, 'corporate_accounts', n),
    CASE WHEN m = 3 AND n = 0 THEN 'PORTAL_BUILT_NO_COMPANY_REGISTERED_YET' END);

  -- OBS-01 correlation identifiers
  SELECT count(*) INTO n FROM public.rental_quote_requests WHERE correlation_id IS NULL;
  SELECT count(*) INTO m FROM public.rental_bookings WHERE correlation_id IS NULL;
  PERFORM public.rental_control_record('OBS-01', CASE WHEN n + m = 0 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('quotes_without_correlation', n, 'bookings_without_correlation', m));

  -- RES-03 production jobs observe only
  BEGIN
    SELECT count(*) INTO n FROM cron.job
     WHERE command ILIKE '%rental%'
       AND command NOT ILIKE '%probe_transition_table%'
       AND command NOT ILIKE '%concurrency%';
    SELECT count(*) INTO m FROM cron.job WHERE command ILIKE '%rental%';
    PERFORM public.rental_control_record('RES-03', CASE WHEN m > 0 AND n = m THEN 'PASS' ELSE 'PARTIAL' END, env,
      jsonb_build_object('scheduled_rental_jobs', m, 'observe_and_reconcile_only', n));
  EXCEPTION WHEN others THEN
    PERFORM public.rental_control_record('RES-03','BLOCKED', env,
      jsonb_build_object('error', SQLERRM), 'SCHEDULE_REGISTRY_NOT_READABLE_IN_THIS_SESSION');
  END;

  -- DAT-01 immutable audit trail
  SELECT count(*) INTO n FROM pg_trigger WHERE tgname IN
    ('trg_rental_handover_immutable','trg_rental_domain_events_append_only',
     'trg_rental_ledger_lines_immutable','trg_rental_control_evidence_append_only',
     'trg_rental_policy_decisions_append_only','trg_rental_saga_steps_append_only');
  PERFORM public.rental_control_record('DAT-01', CASE WHEN n = 6 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('immutability_triggers', n, 'expected', 6));

  -- DAT-03 no fabricated production data
  SELECT count(*) INTO n FROM public.rental_fleet_units
   WHERE coalesce(provenance,'') ILIKE '%SEED%' OR coalesce(provenance,'') ILIKE '%TEST%';
  SELECT count(*) INTO m FROM public.rental_unit_commitments WHERE note ILIKE '%certification probe%';
  PERFORM public.rental_control_record('DAT-03', CASE WHEN n + m = 0 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('seeded_or_test_units', n, 'probe_commitments_left_behind', m));

  -- PTR-01 provider onboarding gates its units
  SELECT count(*) INTO n FROM public.rental_providers;
  SELECT count(*) INTO m FROM public.rental_fleet_units WHERE status = 'ACTIVE' AND provider_id IS NULL;
  PERFORM public.rental_control_record('PTR-01',
    CASE WHEN n = 0 THEN 'NOT_TESTED' WHEN m = 0 THEN 'PASS' ELSE 'FAIL' END, env,
    jsonb_build_object('providers', n, 'active_units_without_provider', m),
    CASE WHEN n = 0 THEN 'NO_PROVIDER_REGISTERED_YET' END);

  -- Controls that cannot be executed from a single production session
  PERFORM public.rental_control_record('SEC-04','BLOCKED', env, '{}'::jsonb,'REQUIRES_ANONYMOUS_AND_CUSTOMER_SESSIONS');
  PERFORM public.rental_control_record('SEC-05','BLOCKED', env, '{}'::jsonb,'REQUIRES_TWO_COMPANY_USER_SESSIONS');
  PERFORM public.rental_control_record('SEC-06','BLOCKED', env, '{}'::jsonb,'REQUIRES_NON_STAFF_ROLE_SESSION');
  PERFORM public.rental_control_record('SEC-07','BLOCKED', env, '{}'::jsonb,'REQUIRES_FOUR_ROLE_SESSIONS');
  PERFORM public.rental_control_record('INV-03','BLOCKED', env, '{}'::jsonb,'REQUIRES_ISOLATED_CONCURRENCY_DATABASE');
  PERFORM public.rental_control_record('INV-05','BLOCKED', env, '{}'::jsonb,'REQUIRES_STAGING_END_TO_END_RUN');
  PERFORM public.rental_control_record('PAY-04','BLOCKED', env, '{}'::jsonb,'REQUIRES_STAGING_FAILURE_INJECTION');
  PERFORM public.rental_control_record('RES-02','BLOCKED', env, '{}'::jsonb,'REQUIRES_STAGING_FAILURE_INJECTION');
  PERFORM public.rental_control_record('RES-04','REQUIRES_EXTERNAL_ACTION', env, '{}'::jsonb,'RESTORE_INTO_ISOLATED_DATABASE_REQUIRED');
  PERFORM public.rental_control_record('RES-05','REQUIRES_EXTERNAL_ACTION', env, '{}'::jsonb,'RECOVERY_OBJECTIVES_NOT_YET_DEMONSTRATED');
  PERFORM public.rental_control_record('CMP-03','REQUIRES_EXTERNAL_ACTION', env, '{}'::jsonb,'TAX_INVOICING_CONFIRMATION_REQUIRED');
  PERFORM public.rental_control_record('POL-05','BLOCKED', env, '{}'::jsonb,'AWAITING_BUSINESS_APPROVAL_OF_CANCELLATION_TIERS');
  PERFORM public.rental_control_record('POL-06','BLOCKED', env, '{}'::jsonb,'AWAITING_BUSINESS_APPROVAL_OF_DEPOSIT_LATE_AND_MILEAGE_CHARGES');
  PERFORM public.rental_control_record('DAT-02','BLOCKED', env, '{}'::jsonb,'RETENTION_RULES_AWAIT_BUSINESS_DECISION');

  SELECT count(*) INTO executed FROM public.rental_control_evidence
   WHERE executed_by = 'rental_catalogue_probe_run' AND executed_at > now() - interval '5 minutes';

  RETURN jsonb_build_object('ok', true, 'environment', env, 'records_written', executed,
    'summary', (SELECT to_jsonb(s) FROM public.v_rental_certification_summary s),
    'groups', (SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.control_group), '[]'::jsonb)
                 FROM public.v_rental_catalogue_groups g));
END; $$;
REVOKE ALL ON FUNCTION public.rental_catalogue_probe_run(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rental_catalogue_probe_run(text) FROM anon;
REVOKE ALL ON FUNCTION public.rental_catalogue_probe_run(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rental_catalogue_probe_run(text) TO service_role;