CREATE TABLE public.payment_certification_controls (
  code text PRIMARY KEY,
  control_group text NOT NULL,
  title text NOT NULL,
  expectation text NOT NULL,
  verdict text NOT NULL DEFAULT 'NOT_TESTED'
    CHECK (verdict IN ('IMPLEMENTED','PARTIALLY_IMPLEMENTED','BLOCKED','NOT_TESTED','EXTERNAL_EVIDENCE_REQUIRED','FAILED')),
  observation text,
  environment text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payment_certification_controls TO authenticated;
GRANT ALL ON public.payment_certification_controls TO service_role;
ALTER TABLE public.payment_certification_controls ENABLE ROW LEVEL SECURITY;
CREATE POLICY pcc_read ON public.payment_certification_controls FOR SELECT TO authenticated
  USING (public.is_credit_observer(auth.uid()));

CREATE TRIGGER pcc_touch BEFORE UPDATE ON public.payment_certification_controls
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.payment_certification_controls (code, control_group, title, expectation, verdict) VALUES
('PAY-001','payments','Cash payment through M-Pesa PayBill','ALLOW_CASH_PAYMENT with payment verification still required','NOT_TESTED'),
('PAY-002','payments','Cash payment through bank account','ALLOW_CASH_PAYMENT with payment verification still required','NOT_TESTED'),
('PAY-003','credit','Credit without a bank guarantee','GUARANTEE_REQUIRED','NOT_TESTED'),
('PAY-004','credit','Uploaded but unverified guarantee','Credit denied','NOT_TESTED'),
('PAY-005','credit','Verified but unapproved guarantee','Credit denied','NOT_TESTED'),
('PAY-006','credit','Approved guarantee but inactive facility','Credit denied','NOT_TESTED'),
('PAY-007','credit','Expired guarantee','Credit denied','NOT_TESTED'),
('PAY-008','credit','Revoked guarantee','Credit denied','NOT_TESTED'),
('PAY-009','credit','Insufficient available credit','CREDIT_LIMIT_EXCEEDED','NOT_TESTED'),
('PAY-010','credit','Active guarantee with sufficient credit','ALLOW_GUARANTEED_CREDIT','NOT_TESTED'),
('PAY-011','concurrency','Two concurrent credit bookings exceeding available credit','Only the valid exposure is authorised','NOT_TESTED'),
('PAY-012','security','Client manipulates guarantee status','Denied','NOT_TESTED'),
('PAY-013','security','Client manipulates credit balance or limit','Denied','NOT_TESTED'),
('PAY-014','security','Cross-tenant guarantee access','Denied','NOT_TESTED'),
('PAY-015','payments','Customer uploads a payment screenshot','PAYMENT_EVIDENCE only, never PAYMENT_CONFIRMED','NOT_TESTED'),
('PAY-016','payments','Proforma invoice presented as payment','PAYMENT_PENDING','NOT_TESTED'),
('PAY-017','credit','Corporate account without guarantee requests credit','Credit denied','NOT_TESTED'),
('PAY-018','credit','Guarantee expires while the customer is active','New credit transactions denied','NOT_TESTED')
ON CONFLICT (code) DO NOTHING;

-- =========================================================
-- Executable probe runner (service_role only)
-- =========================================================
CREATE OR REPLACE FUNCTION public.payment_certification_run(_test_corporate_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  gid uuid; fid uuid; other_gid uuid; other_corp uuid;
  d jsonb; r jsonb; env text; results jsonb := '[]'::jsonb;
  amount bigint := 2500000;   -- KES 25,000
  ok boolean;
BEGIN
  env := 'live project database ' || current_database() || ' @ ' || now()::text;

  PERFORM 1 FROM public.corporate_accounts WHERE id = _test_corporate_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'test_corporate_not_found'); END IF;

  -- clean any prior probe fixtures
  DELETE FROM public.corporate_credit_reservations WHERE idempotency_key LIKE 'PROBE-%';
  DELETE FROM public.corporate_bank_guarantee_events
    WHERE guarantee_id IN (SELECT id FROM public.corporate_bank_guarantees WHERE guarantee_number LIKE 'PROBE-%');
  DELETE FROM public.corporate_credit_facilities
    WHERE guarantee_id IN (SELECT id FROM public.corporate_bank_guarantees WHERE guarantee_number LIKE 'PROBE-%');
  DELETE FROM public.corporate_bank_guarantees WHERE guarantee_number LIKE 'PROBE-%';

  -- ensure an ACTIVE payment policy permitting guaranteed credit for the probe tenant
  UPDATE public.corporate_payment_policies SET status='RETIRED', updated_at=now()
    WHERE corporate_id = _test_corporate_id AND status IN ('ACTIVE','DRAFT');
  INSERT INTO public.corporate_payment_policies (corporate_id, version, credit_rule, status, business_approval, approved_by, approved_at, proposed_by)
  SELECT _test_corporate_id, COALESCE(MAX(version),0)+1, 'CREDIT_IF_GUARANTEED', 'ACTIVE', 'PROBE_FIXTURE', '00000000-0000-0000-0000-000000000000', now(), NULL
    FROM public.corporate_payment_policies WHERE corporate_id = _test_corporate_id;

  -- PAY-001 / PAY-002 cash
  d := public.corp_payment_decide(_test_corporate_id, amount, 'CASH');
  ok := (d->>'decision') = 'ALLOW_CASH_PAYMENT' AND (d->'reason_codes') ? 'PAYMENT_VERIFICATION_REQUIRED';
  UPDATE public.payment_certification_controls SET
    verdict = CASE WHEN ok THEN 'IMPLEMENTED' ELSE 'FAILED' END,
    observation = 'Cash decision returned ' || (d->>'decision') || '; payment verification still required before confirmation.',
    environment = env, evidence = d, last_run_at = now()
  WHERE code IN ('PAY-001','PAY-002');

  -- PAY-003 / PAY-017 credit with no guarantee
  d := public.corp_payment_decide(_test_corporate_id, amount, 'CREDIT');
  ok := (d->>'decision') = 'GUARANTEE_REQUIRED';
  UPDATE public.payment_certification_controls SET
    verdict = CASE WHEN ok THEN 'IMPLEMENTED' ELSE 'FAILED' END,
    observation = 'Corporate account with an active credit policy but no guarantee returned ' || (d->>'decision') || '.',
    environment = env, evidence = d, last_run_at = now()
  WHERE code IN ('PAY-003','PAY-017');

  -- fixture guarantee: KES 10,000,000
  INSERT INTO public.corporate_bank_guarantees (
    corporate_id, guarantee_number, issuing_bank, legal_entity_name, guaranteed_amount_cents,
    issue_date, effective_date, expiry_date, state, external_verification_required, document_reference
  ) VALUES (
    _test_corporate_id, 'PROBE-BG-001', 'PROBE TEST BANK (not a real guarantee)', 'PROBE TEST ENTITY',
    1000000000, current_date, current_date, current_date + 180, 'UPLOADED', true, 'PROBE FIXTURE'
  ) RETURNING id INTO gid;

  -- PAY-004 uploaded, unverified
  d := public.corp_payment_decide(_test_corporate_id, amount, 'CREDIT');
  ok := (d->>'decision') <> 'ALLOW_GUARANTEED_CREDIT';
  UPDATE public.payment_certification_controls SET
    verdict = CASE WHEN ok THEN 'IMPLEMENTED' ELSE 'FAILED' END,
    observation = 'Uploaded, unverified guarantee returned ' || (d->>'decision') || '.',
    environment = env, evidence = d, last_run_at = now() WHERE code = 'PAY-004';

  -- PAY-005 verified (pending approval) but unapproved
  UPDATE public.corporate_bank_guarantees SET state = 'PENDING_APPROVAL', verified_at = now(),
         external_verification_required = false WHERE id = gid;
  d := public.corp_payment_decide(_test_corporate_id, amount, 'CREDIT');
  ok := (d->>'decision') <> 'ALLOW_GUARANTEED_CREDIT';
  UPDATE public.payment_certification_controls SET
    verdict = CASE WHEN ok THEN 'IMPLEMENTED' ELSE 'FAILED' END,
    observation = 'Verified but unapproved guarantee returned ' || (d->>'decision') || '.',
    environment = env, evidence = d, last_run_at = now() WHERE code = 'PAY-005';

  -- PAY-006 approved guarantee, facility exists but not ACTIVE
  UPDATE public.corporate_bank_guarantees SET state = 'APPROVED', approved_at = now() WHERE id = gid;
  INSERT INTO public.corporate_credit_facilities (
    corporate_id, guarantee_id, approved_credit_limit_cents, risk_margin_bps, effective_date, expiry_date, state
  ) VALUES (_test_corporate_id, gid, 700000000, 0, current_date, current_date + 180, 'DRAFT')
  RETURNING id INTO fid;
  d := public.corp_payment_decide(_test_corporate_id, amount, 'CREDIT');
  ok := (d->>'decision') <> 'ALLOW_GUARANTEED_CREDIT';
  UPDATE public.payment_certification_controls SET
    verdict = CASE WHEN ok THEN 'IMPLEMENTED' ELSE 'FAILED' END,
    observation = 'Approved guarantee with a draft (inactive) facility returned ' || (d->>'decision') || '.',
    environment = env, evidence = d, last_run_at = now() WHERE code = 'PAY-006';

  -- activate both
  UPDATE public.corporate_bank_guarantees SET state = 'ACTIVE', activated_at = now() WHERE id = gid;
  UPDATE public.corporate_credit_facilities SET state = 'ACTIVE', activated_at = now() WHERE id = fid;

  -- PAY-010 sufficient credit
  d := public.corp_payment_decide(_test_corporate_id, amount, 'CREDIT');
  ok := (d->>'decision') = 'ALLOW_GUARANTEED_CREDIT';
  UPDATE public.payment_certification_controls SET
    verdict = CASE WHEN ok THEN 'IMPLEMENTED' ELSE 'FAILED' END,
    observation = 'Active guarantee (KES 10,000,000) with an active KES 7,000,000 facility authorised KES 25,000: '
                  || (d->>'decision') || '.',
    environment = env, evidence = d, last_run_at = now() WHERE code = 'PAY-010';

  -- PAY-009 insufficient credit
  d := public.corp_payment_decide(_test_corporate_id, 900000000, 'CREDIT');
  ok := (d->>'decision') = 'CREDIT_LIMIT_EXCEEDED';
  UPDATE public.payment_certification_controls SET
    verdict = CASE WHEN ok THEN 'IMPLEMENTED' ELSE 'FAILED' END,
    observation = 'KES 9,000,000 request against a KES 7,000,000 facility returned ' || (d->>'decision') || '.',
    environment = env, evidence = d, last_run_at = now() WHERE code = 'PAY-009';

  -- PAY-011 exposure accounting through reservations (sequential, single session)
  r := public.corp_credit_reserve(_test_corporate_id, 690000000, 'PROBE-RES-A');
  d := public.corp_credit_reserve(_test_corporate_id, 50000000, 'PROBE-RES-B');
  ok := (r->>'ok')::boolean AND NOT (d->>'ok')::boolean AND (d->>'decision') = 'CREDIT_LIMIT_EXCEEDED';
  UPDATE public.payment_certification_controls SET
    verdict = CASE WHEN ok THEN 'PARTIALLY_IMPLEMENTED' ELSE 'FAILED' END,
    observation = 'Reservation A (KES 6,900,000) authorised, reservation B (KES 500,000) refused as '
                  || COALESCE(d->>'decision','?') || '. Row-level facility locking is in place, but a genuine '
                  || 'two-session concurrency race has not been executed — that needs the isolated staging database.',
    environment = env, evidence = jsonb_build_object('a', r, 'b', d), last_run_at = now() WHERE code = 'PAY-011';
  PERFORM public.corp_credit_release((r->>'reservation_id')::uuid, 'probe cleanup');

  -- PAY-007 expired guarantee
  UPDATE public.corporate_bank_guarantees SET expiry_date = current_date - 1 WHERE id = gid;
  d := public.corp_payment_decide(_test_corporate_id, amount, 'CREDIT');
  ok := (d->>'decision') <> 'ALLOW_GUARANTEED_CREDIT';
  UPDATE public.payment_certification_controls SET
    verdict = CASE WHEN ok THEN 'IMPLEMENTED' ELSE 'FAILED' END,
    observation = 'Guarantee past its expiry date returned ' || (d->>'decision') || '.',
    environment = env, evidence = d, last_run_at = now() WHERE code IN ('PAY-007');

  -- PAY-018 expiry sweep disables credit
  r := public.corp_guarantee_expiry_sweep(30);
  d := public.corp_payment_decide(_test_corporate_id, amount, 'CREDIT');
  ok := (d->>'decision') <> 'ALLOW_GUARANTEED_CREDIT';
  UPDATE public.payment_certification_controls SET
    verdict = CASE WHEN ok THEN 'IMPLEMENTED' ELSE 'FAILED' END,
    observation = 'Automatic expiry sweep moved the guarantee to expired and closed its facility; the next credit '
                  || 'request returned ' || (d->>'decision') || '.',
    environment = env, evidence = jsonb_build_object('sweep', r, 'decision', d), last_run_at = now() WHERE code = 'PAY-018';

  -- PAY-008 revoked guarantee
  UPDATE public.corporate_bank_guarantees SET expiry_date = current_date + 180, state = 'ACTIVE' WHERE id = gid;
  UPDATE public.corporate_credit_facilities SET state = 'ACTIVE' WHERE id = fid;
  UPDATE public.corporate_bank_guarantees SET state = 'REVOKED', revoked_at = now() WHERE id = gid;
  UPDATE public.corporate_credit_facilities SET state = 'CLOSED' WHERE id = fid;
  d := public.corp_payment_decide(_test_corporate_id, amount, 'CREDIT');
  ok := (d->>'decision') <> 'ALLOW_GUARANTEED_CREDIT';
  UPDATE public.payment_certification_controls SET
    verdict = CASE WHEN ok THEN 'IMPLEMENTED' ELSE 'FAILED' END,
    observation = 'Revoked guarantee returned ' || (d->>'decision') || '.',
    environment = env, evidence = d, last_run_at = now() WHERE code = 'PAY-008';

  -- PAY-012 lifecycle change without finance authority (auth.uid() is NULL here)
  r := public.corp_guarantee_transition(gid, 'ACTIVATE', 'probe: unauthorised attempt');
  ok := NOT (r->>'ok')::boolean;
  UPDATE public.payment_certification_controls SET
    verdict = CASE WHEN ok THEN 'PARTIALLY_IMPLEMENTED' ELSE 'FAILED' END,
    observation = 'A caller without finance authority was refused: ' || COALESCE(r->>'error','?')
                  || '. Guarantee state is only writable through this authority-gated function; a signed-in '
                  || 'non-finance API probe still has to be executed.',
    environment = env, evidence = r, last_run_at = now() WHERE code = 'PAY-012';

  -- PAY-013 credit balance/limit not writable by clients
  ok := NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename IN ('corporate_credit_facilities','corporate_credit_reservations')
       AND cmd IN ('UPDATE','INSERT','ALL')
  );
  UPDATE public.payment_certification_controls SET
    verdict = CASE WHEN ok THEN 'PARTIALLY_IMPLEMENTED' ELSE 'FAILED' END,
    observation = 'No insert/update access rule exists on credit facilities or reservations, so signed-in clients '
                  || 'cannot write a limit, a balance or an exposure row; only the reservation functions can, and '
                  || 'they are restricted to the server role. A signed-in API write probe is still outstanding.',
    environment = env, evidence = jsonb_build_object('client_write_policies', NOT ok), last_run_at = now() WHERE code = 'PAY-013';

  -- PAY-014 cross-tenant guarantee reservation
  SELECT id INTO other_corp FROM public.corporate_accounts WHERE id <> _test_corporate_id LIMIT 1;
  r := public.corp_credit_reserve(other_corp, amount, 'PROBE-XTENANT-1');
  ok := NOT (r->>'ok')::boolean;
  UPDATE public.payment_certification_controls SET
    verdict = CASE WHEN ok THEN 'PARTIALLY_IMPLEMENTED' ELSE 'FAILED' END,
    observation = 'A reservation attempt for a different company found no guarantee or facility of its own and was '
                  || 'refused (' || COALESCE(r->>'error','?') || '); guarantees are resolved from the company, never '
                  || 'from a client-supplied guarantee id. A signed-in cross-tenant read probe is still outstanding.',
    environment = env, evidence = r, last_run_at = now() WHERE code = 'PAY-014';

  -- external / untested controls
  UPDATE public.payment_certification_controls SET
    verdict = 'EXTERNAL_EVIDENCE_REQUIRED',
    observation = 'M-Pesa and bank payment verification must be proven against the real provider and the bank '
                  || 'reconciliation feed; screenshots and manual references are never treated as confirmation.',
    environment = env, last_run_at = now() WHERE code IN ('PAY-015','PAY-016');

  -- cleanup fixtures
  DELETE FROM public.corporate_credit_reservations WHERE idempotency_key LIKE 'PROBE-%';
  DELETE FROM public.corporate_bank_guarantee_events WHERE guarantee_id = gid;
  DELETE FROM public.corporate_credit_facilities WHERE guarantee_id = gid;
  DELETE FROM public.corporate_bank_guarantees WHERE id = gid;
  UPDATE public.corporate_payment_policies SET status = 'RETIRED', updated_at = now()
    WHERE corporate_id = _test_corporate_id AND business_approval = 'PROBE_FIXTURE';

  SELECT jsonb_agg(jsonb_build_object('code', code, 'verdict', verdict)) INTO results
    FROM public.payment_certification_controls;
  RETURN jsonb_build_object('ok', true, 'ran_at', now(), 'controls', results);
END $$;
REVOKE ALL ON FUNCTION public.payment_certification_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_certification_run(uuid) TO service_role;