-- ============================================================
-- CORPORATE ACCOUNT REGISTER (rental credit + approval control)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rental_corporate_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_code text NOT NULL UNIQUE,
  legal_name text NOT NULL,
  match_names text[] NOT NULL DEFAULT '{}',
  corporate_id uuid,
  cost_centre text,
  status text NOT NULL DEFAULT 'PENDING_ONBOARDING'
    CHECK (status IN ('PENDING_ONBOARDING','ACTIVE','CREDIT_BLOCKED','SUSPENDED')),
  credit_state text NOT NULL DEFAULT 'NO_CREDIT'
    CHECK (credit_state IN ('NO_CREDIT','APPLIED','APPROVED','BLOCKED')),
  credit_limit_kes numeric(14,2) NOT NULL DEFAULT 0,
  payment_terms_days integer NOT NULL DEFAULT 0,
  auto_approve_below_kes numeric(14,2),
  elevated_approval_above_kes numeric(14,2),
  approver_name text,
  approver_email text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rental_corporate_accounts TO authenticated;
GRANT ALL ON public.rental_corporate_accounts TO service_role;
ALTER TABLE public.rental_corporate_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rental_corporate_accounts_staff_read ON public.rental_corporate_accounts;
CREATE POLICY rental_corporate_accounts_staff_read ON public.rental_corporate_accounts
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
DROP TRIGGER IF EXISTS trg_rental_corporate_accounts_touch ON public.rental_corporate_accounts;
CREATE TRIGGER trg_rental_corporate_accounts_touch BEFORE UPDATE ON public.rental_corporate_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.rental_corporate_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.rental_corporate_accounts(id) ON DELETE CASCADE,
  quote_id uuid REFERENCES public.rental_quote_requests(id) ON DELETE SET NULL,
  quote_reference text,
  booking_reference text,
  amount_kes numeric(14,2) NOT NULL,
  required_level text NOT NULL DEFAULT 'DESIGNATED_APPROVER'
    CHECK (required_level IN ('AUTO_APPROVED','DESIGNATED_APPROVER','ELEVATED_APPROVAL')),
  state text NOT NULL DEFAULT 'REQUESTED'
    CHECK (state IN ('REQUESTED','APPROVED','REJECTED','WITHDRAWN')),
  policy_code text,
  policy_version integer,
  reason text,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rental_corporate_approvals TO authenticated;
GRANT ALL ON public.rental_corporate_approvals TO service_role;
ALTER TABLE public.rental_corporate_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rental_corporate_approvals_staff_read ON public.rental_corporate_approvals;
CREATE POLICY rental_corporate_approvals_staff_read ON public.rental_corporate_approvals
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE INDEX IF NOT EXISTS rental_corporate_approvals_state_idx
  ON public.rental_corporate_approvals (state, created_at DESC);
DROP TRIGGER IF EXISTS trg_rental_corporate_approvals_touch ON public.rental_corporate_approvals;
CREATE TRIGGER trg_rental_corporate_approvals_touch BEFORE UPDATE ON public.rental_corporate_approvals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP VIEW IF EXISTS public.v_rental_corporate_exposure;
CREATE VIEW public.v_rental_corporate_exposure AS
SELECT a.id AS account_id, a.account_code, a.legal_name, a.status, a.credit_state,
       a.credit_limit_kes, a.payment_terms_days, a.auto_approve_below_kes, a.elevated_approval_above_kes,
       coalesce(o.outstanding_kes, 0)::numeric(14,2) AS outstanding_kes,
       GREATEST(0, a.credit_limit_kes - coalesce(o.outstanding_kes,0))::numeric(14,2) AS available_credit_kes,
       coalesce(o.overdue_kes, 0)::numeric(14,2) AS overdue_kes,
       coalesce(o.bookings, 0) AS bookings,
       coalesce(p.pending_approvals, 0) AS pending_approvals
  FROM public.rental_corporate_accounts a
  LEFT JOIN (
    SELECT ca.id AS account_id,
           count(*) AS bookings,
           sum(GREATEST(b.total_kes - coalesce(b.amount_paid_kes,0), 0)) AS outstanding_kes,
           sum(CASE WHEN b.end_date < current_date - (ca.payment_terms_days || ' days')::interval
                    THEN GREATEST(b.total_kes - coalesce(b.amount_paid_kes,0), 0) ELSE 0 END) AS overdue_kes
      FROM public.rental_bookings b
      JOIN public.rental_corporate_accounts ca
        ON lower(coalesce(b.company_name,'')) = lower(ca.legal_name)
        OR lower(coalesce(b.company_name,'')) = ANY (SELECT lower(x) FROM unnest(ca.match_names) x)
     WHERE b.status <> 'CANCELLED'
     GROUP BY ca.id
  ) o ON o.account_id = a.id
  LEFT JOIN (
    SELECT account_id, count(*) AS pending_approvals
      FROM public.rental_corporate_approvals WHERE state = 'REQUESTED' GROUP BY account_id
  ) p ON p.account_id = a.id;
ALTER VIEW public.v_rental_corporate_exposure SET (security_invoker = true);
GRANT SELECT ON public.v_rental_corporate_exposure TO authenticated;

CREATE OR REPLACE FUNCTION public.rental_corporate_match(_company_name text)
RETURNS public.rental_corporate_accounts
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT a.* FROM public.rental_corporate_accounts a
   WHERE _company_name IS NOT NULL AND btrim(_company_name) <> ''
     AND (lower(btrim(_company_name)) = lower(a.legal_name)
       OR lower(btrim(_company_name)) = ANY (SELECT lower(x) FROM unnest(a.match_names) x))
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.rental_corporate_match(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rental_corporate_match(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rental_corporate_gate(
  _company_name text, _amount_kes numeric, _quote_id uuid DEFAULT NULL,
  _quote_reference text DEFAULT NULL, _correlation_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a public.rental_corporate_accounts;
        ap public.rental_corporate_approvals;
        expo record;
        pv_appr public.rental_policy_versions;
        pv_cred public.rental_policy_versions;
        auto_below numeric; elevated_above numeric;
        level text; allow boolean := true; reason text := NULL;
BEGIN
  a := public.rental_corporate_match(_company_name);
  IF a.id IS NULL THEN
    RETURN jsonb_build_object('applies', false, 'allow', true, 'reason_code','NOT_A_REGISTERED_CORPORATE');
  END IF;

  pv_appr := public.rental_policy_resolve('CORPORATE_APPROVAL');
  pv_cred := public.rental_policy_resolve('CORPORATE_CREDIT_LIMIT');
  auto_below := coalesce(a.auto_approve_below_kes, (pv_appr.config ->> 'auto_approve_below_kes')::numeric, 0);
  elevated_above := coalesce(a.elevated_approval_above_kes,
                             (pv_appr.config ->> 'elevated_approval_above_kes')::numeric, 1000000000000);

  level := CASE WHEN _amount_kes < auto_below THEN 'AUTO_APPROVED'
                WHEN _amount_kes >= elevated_above THEN 'ELEVATED_APPROVAL'
                ELSE 'DESIGNATED_APPROVER' END;

  IF a.status IN ('SUSPENDED','CREDIT_BLOCKED') THEN
    allow := false; reason := 'CORPORATE_ACCOUNT_' || a.status;
  END IF;

  SELECT * INTO expo FROM public.v_rental_corporate_exposure WHERE account_id = a.id;
  IF allow AND a.credit_state = 'APPROVED'
     AND coalesce((pv_cred.config ->> 'block_when_available_credit_below_booking_value')::boolean, true)
     AND coalesce(expo.available_credit_kes, 0) < _amount_kes THEN
    allow := false; reason := 'AVAILABLE_CREDIT_INSUFFICIENT';
  END IF;

  IF allow AND level <> 'AUTO_APPROVED' THEN
    SELECT * INTO ap FROM public.rental_corporate_approvals
     WHERE account_id = a.id
       AND ((_quote_id IS NOT NULL AND quote_id = _quote_id)
         OR (_quote_reference IS NOT NULL AND quote_reference = _quote_reference))
     ORDER BY created_at DESC LIMIT 1;

    IF ap.id IS NULL THEN
      INSERT INTO public.rental_corporate_approvals
        (account_id, quote_id, quote_reference, amount_kes, required_level, state,
         policy_code, policy_version, reason, correlation_id)
      VALUES (a.id, _quote_id, _quote_reference, _amount_kes, level, 'REQUESTED',
              'CORPORATE_APPROVAL', pv_appr.version,
              'Above the configured auto-approval threshold', _correlation_id)
      RETURNING * INTO ap;
      allow := false; reason := 'CORPORATE_APPROVAL_REQUESTED';
    ELSIF ap.state = 'APPROVED' THEN
      allow := true;
    ELSIF ap.state = 'REJECTED' THEN
      allow := false; reason := 'CORPORATE_APPROVAL_REJECTED';
    ELSE
      allow := false; reason := 'CORPORATE_APPROVAL_PENDING';
    END IF;
  END IF;

  INSERT INTO public.rental_policy_decisions
    (evaluation_point, policy_code, policy_version, version_state, rule_type,
     subject_type, subject_ref, correlation_id, input, decision, reason, binding)
  VALUES ('CORPORATE_BOOKING', 'CORPORATE_APPROVAL', pv_appr.version, pv_appr.state, 'HARD_GATE',
          'quote', coalesce(_quote_reference, _quote_id::text), _correlation_id,
          jsonb_build_object('company_name', _company_name, 'amount_kes', _amount_kes,
                             'account_code', a.account_code, 'required_level', level,
                             'available_credit_kes', expo.available_credit_kes,
                             'credit_state', a.credit_state),
          CASE WHEN allow THEN 'ALLOW' ELSE 'BLOCK' END, reason, true);

  RETURN jsonb_build_object('applies', true, 'allow', allow, 'reason_code', reason,
    'account_code', a.account_code, 'account_id', a.id, 'required_level', level,
    'approval_id', ap.id, 'approval_state', ap.state,
    'available_credit_kes', expo.available_credit_kes, 'credit_state', a.credit_state);
END; $$;
REVOKE ALL ON FUNCTION public.rental_corporate_gate(text, numeric, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_corporate_gate(text, numeric, uuid, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.rental_corporate_approval_decide(
  _approval_id uuid, _decision text, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE ap public.rental_corporate_approvals; d text := upper(coalesce(_decision,''));
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') = true
       OR public.has_role(auth.uid(),'super_admin') = true
       OR public.has_role(auth.uid(),'finance_admin') = true
       OR public.has_staff_permission('staff.commercial.write') = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason_code','NOT_AUTHORISED');
  END IF;
  IF d NOT IN ('APPROVE','REJECT') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code','UNKNOWN_DECISION');
  END IF;

  SELECT * INTO ap FROM public.rental_corporate_approvals WHERE id = _approval_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason_code','APPROVAL_NOT_FOUND'); END IF;
  IF ap.state <> 'REQUESTED' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code','ALREADY_DECIDED','state', ap.state);
  END IF;
  IF ap.required_level = 'ELEVATED_APPROVAL'
     AND NOT (public.has_role(auth.uid(),'admin') = true OR public.has_role(auth.uid(),'super_admin') = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason_code','ELEVATED_APPROVAL_REQUIRES_ADMIN');
  END IF;

  UPDATE public.rental_corporate_approvals
     SET state = CASE WHEN d = 'APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,
         decided_by = auth.uid(), decided_at = now(), decision_note = _note
   WHERE id = ap.id RETURNING * INTO ap;

  INSERT INTO public.rental_policy_decisions
    (evaluation_point, policy_code, policy_version, rule_type, subject_type, subject_ref,
     correlation_id, input, decision, reason, actor_kind, actor_id)
  VALUES ('CORPORATE_BOOKING','CORPORATE_APPROVAL', ap.policy_version, 'HARD_GATE',
          'quote', ap.quote_reference, ap.correlation_id,
          jsonb_build_object('amount_kes', ap.amount_kes, 'required_level', ap.required_level),
          ap.state, _note, 'HUMAN', auth.uid());

  RETURN jsonb_build_object('ok', true, 'approval_id', ap.id, 'state', ap.state);
END; $$;
REVOKE ALL ON FUNCTION public.rental_corporate_approval_decide(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rental_corporate_approval_decide(uuid, text, text) TO authenticated, service_role;

-- ============================================================
-- ALLOCATION respects the corporate gate before reserving a vehicle
-- ============================================================
CREATE OR REPLACE FUNCTION public.rental_allocate_for_quote(_quote_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  q public.rental_quote_requests;
  unit_id uuid;
  b public.rental_bookings;
  ref text;
  corp jsonb;
BEGIN
  SELECT * INTO q FROM public.rental_quote_requests WHERE id = _quote_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason_code', 'QUOTE_NOT_FOUND'); END IF;

  SELECT * INTO b FROM public.rental_bookings WHERE quote_id = q.id;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'reason_code', 'ALREADY_BOOKED',
      'booking_reference', b.booking_reference, 'status', b.status);
  END IF;

  corp := public.rental_corporate_gate(q.company_name, q.total_kes, q.id, q.reference, q.correlation_id);

  PERFORM pg_advisory_xact_lock(hashtext('rental_allocation'));

  IF coalesce((corp ->> 'allow')::boolean, true) THEN
    SELECT u.id INTO unit_id
      FROM public.rental_fleet_units u
     WHERE u.status = 'AVAILABLE'
       AND u.asset_class = q.asset_class
       AND u.band_label = q.band_label
       AND ((q.category = 'SELF_DRIVE' AND u.self_drive) OR (q.category = 'CHAUFFEUR' AND u.chauffeur))
       AND NOT EXISTS (
         SELECT 1 FROM public.rental_unit_commitments c
          WHERE c.unit_id = u.id AND c.start_date <= q.end_date AND c.end_date >= q.start_date
       )
     ORDER BY u.created_at
     LIMIT 1;
  END IF;

  ref := public._rental_booking_reference();

  INSERT INTO public.rental_bookings (
    booking_reference, quote_id, unit_id, category, asset_class, band_label,
    start_date, end_date, pickup_location, contact_name, contact_email,
    contact_phone, company_name, rider_user_id, total_kes, amount_paid_kes,
    currency, mpesa_receipt, status
  ) VALUES (
    ref, q.id, unit_id, q.category, q.asset_class, q.band_label,
    q.start_date, q.end_date, q.pickup_location, q.contact_name, q.contact_email,
    q.contact_phone, q.company_name, q.requested_by, q.total_kes, q.amount_paid_kes,
    q.currency, q.mpesa_receipt,
    CASE WHEN NOT coalesce((corp ->> 'allow')::boolean, true) THEN 'AWAITING_CORPORATE_APPROVAL'
         WHEN unit_id IS NULL THEN 'AWAITING_ALLOCATION'
         ELSE 'CONFIRMED' END
  ) RETURNING * INTO b;

  IF unit_id IS NOT NULL THEN
    INSERT INTO public.rental_unit_commitments (unit_id, booking_id, start_date, end_date, source)
    VALUES (unit_id, b.id, b.start_date, b.end_date, 'BOOKING');
  END IF;

  UPDATE public.rental_corporate_approvals
     SET booking_reference = b.booking_reference
   WHERE quote_id = q.id AND booking_reference IS NULL;

  INSERT INTO public.rental_booking_events (booking_id, event_type, detail)
  VALUES (b.id,
          CASE WHEN b.status = 'AWAITING_CORPORATE_APPROVAL' THEN 'BOOKING_AWAITING_CORPORATE_APPROVAL'
               WHEN unit_id IS NULL THEN 'BOOKING_AWAITING_ALLOCATION'
               ELSE 'BOOKING_CONFIRMED' END,
          jsonb_build_object('quote_reference', q.reference, 'unit_id', unit_id, 'corporate', corp));

  IF b.status = 'AWAITING_CORPORATE_APPROVAL' THEN
    PERFORM public.rental_exception_open('COMPLIANCE_EXCEPTION','booking', b.id, b.booking_reference,
      q.correlation_id, jsonb_build_object('gate','CORPORATE_APPROVAL','detail', corp), NULL);
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason_code',
    CASE WHEN b.status = 'AWAITING_CORPORATE_APPROVAL' THEN 'CORPORATE_APPROVAL_REQUIRED'
         WHEN unit_id IS NULL THEN 'AWAITING_ALLOCATION' ELSE 'ALLOCATED' END,
    'booking_reference', b.booking_reference, 'status', b.status, 'unit_id', unit_id,
    'corporate', corp);
END; $$;

-- ============================================================
-- BOOKING TRUTH
-- ============================================================
CREATE OR REPLACE FUNCTION public.rental_booking_truth(_reference text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE b public.rental_bookings; q public.rental_quote_requests; out_json jsonb;
BEGIN
  IF NOT (public.has_staff_permission('staff.commercial.read') = true
       OR public.has_role(auth.uid(),'admin') = true
       OR public.has_role(auth.uid(),'super_admin') = true
       OR public.has_role(auth.uid(),'finance_admin') = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason_code','NOT_AUTHORISED');
  END IF;

  SELECT * INTO b FROM public.rental_bookings
   WHERE upper(booking_reference) = upper(btrim(coalesce(_reference,'')));
  IF NOT FOUND THEN
    SELECT * INTO q FROM public.rental_quote_requests
     WHERE upper(reference) = upper(btrim(coalesce(_reference,'')));
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason_code','NOT_FOUND'); END IF;
    SELECT * INTO b FROM public.rental_bookings WHERE quote_id = q.id;
  ELSE
    SELECT * INTO q FROM public.rental_quote_requests WHERE id = b.quote_id;
  END IF;

  out_json := jsonb_build_object(
    'ok', true,
    'current_state', coalesce(b.status, q.status),
    'booking', to_jsonb(b) - 'contact_phone',
    'quote', jsonb_build_object(
      'reference', q.reference, 'status', q.status, 'payment_status', q.payment_status,
      'category', q.category, 'asset_class', q.asset_class, 'band_label', q.band_label,
      'rental_days', q.rental_days, 'expected_km', q.expected_km,
      'base_kes', q.base_kes, 'extra_hours_kes', q.extra_hours_kes, 'excess_km_kes', q.excess_km_kes,
      'discount_kes', q.discount_kes, 'vat_kes', q.vat_kes, 'total_kes', q.total_kes,
      'pricing_version', q.pricing_version, 'snapshot_hash', q.snapshot_hash,
      'pricing_snapshot', q.pricing_snapshot, 'created_at', q.created_at, 'expires_at', q.expires_at),
    'customer', jsonb_build_object('name', coalesce(b.contact_name, q.contact_name),
      'email', coalesce(b.contact_email, q.contact_email),
      'company_name', coalesce(b.company_name, q.company_name)),
    'corporate', (SELECT to_jsonb(e) FROM public.v_rental_corporate_exposure e
                   WHERE lower(e.legal_name) = lower(coalesce(b.company_name, q.company_name, ''))),
    'corporate_approvals', coalesce((SELECT jsonb_agg(to_jsonb(ca) ORDER BY ca.created_at)
      FROM public.rental_corporate_approvals ca WHERE ca.quote_id = q.id), '[]'::jsonb),
    'vehicle', (SELECT jsonb_build_object('unit_id', u.id, 'plate', u.plate, 'make', u.make,
        'model', u.model, 'year', u.year, 'asset_class', u.asset_class, 'band_label', u.band_label,
        'status', u.status, 'home_branch', u.home_branch)
      FROM public.rental_fleet_units u WHERE u.id = b.unit_id),
    'provider', (SELECT to_jsonb(pr) FROM public.rental_providers pr WHERE pr.id = b.provider_id),
    'reservation', coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at)
      FROM public.rental_unit_commitments c WHERE c.booking_id = b.id), '[]'::jsonb),
    'payment', jsonb_build_object('total_kes', coalesce(b.total_kes, q.total_kes),
      'amount_paid_kes', coalesce(b.amount_paid_kes, q.amount_paid_kes),
      'mpesa_receipt', coalesce(b.mpesa_receipt, q.mpesa_receipt), 'paid_at', q.paid_at),
    'ledger', coalesce((SELECT jsonb_agg(jsonb_build_object('entry_type', le.entry_type,
        'memo', le.memo, 'posted_at', le.posted_at, 'lines', (
          SELECT jsonb_agg(to_jsonb(ll)) FROM public.rental_ledger_lines ll WHERE ll.entry_id = le.id))
        ORDER BY le.posted_at)
      FROM public.rental_ledger_entries le WHERE le.quote_id = q.id OR le.booking_id = b.id), '[]'::jsonb),
    'fulfilment', coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.created_at)
      FROM public.rental_handovers h WHERE h.booking_id = b.id), '[]'::jsonb),
    'amendments', coalesce((SELECT jsonb_agg(to_jsonb(am) ORDER BY am.created_at)
      FROM public.rental_amendments am WHERE am.booking_id = b.id), '[]'::jsonb),
    'refunds', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at)
      FROM public.rental_refunds r WHERE r.booking_id = b.id), '[]'::jsonb),
    'policy_decisions', coalesce((SELECT jsonb_agg(to_jsonb(pd) ORDER BY pd.decided_at)
      FROM public.rental_policy_decisions pd
      WHERE pd.subject_ref IN (q.reference, b.booking_reference)
         OR (pd.correlation_id IS NOT NULL AND pd.correlation_id = q.correlation_id)), '[]'::jsonb),
    'exceptions', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.opened_at)
      FROM public.v_rental_exception_sla x
      WHERE x.subject_ref IN (q.reference, b.booking_reference)), '[]'::jsonb),
    'sagas', coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM public.rental_saga_runs s
      WHERE s.correlation_id = q.correlation_id), '[]'::jsonb),
    'timeline', coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.at) FROM (
        SELECT de.occurred_at AS at, 'DOMAIN_EVENT' AS source, de.event_type AS event,
               de.entity_ref AS ref, de.payload AS detail
          FROM public.rental_domain_events de
         WHERE de.correlation_id = q.correlation_id
        UNION ALL
        SELECT qe.created_at, 'QUOTE', qe.event_type, q.reference, qe.detail
          FROM public.rental_quote_events qe WHERE qe.quote_id = q.id
        UNION ALL
        SELECT be.created_at, 'BOOKING', be.event_type, b.booking_reference, be.detail
          FROM public.rental_booking_events be WHERE be.booking_id = b.id
      ) t), '[]'::jsonb)
  );
  RETURN out_json;
END; $$;
REVOKE ALL ON FUNCTION public.rental_booking_truth(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rental_booking_truth(text) TO authenticated, service_role;

-- ============================================================
-- CERTIFICATION CATALOGUE EXPANSION (framework first, evidence later)
-- ============================================================
INSERT INTO public.rental_controls (control_code, domain, title, requirement, evidence_kind, severity, mandatory, note)
VALUES
 ('RN-18','POLICY','Policy versions are dated and approved',
  'Every rental rule is held as a numbered, dated version with an approval record; historical bookings retain the version they were created under.',
  'EXECUTED_DB_PROBE','P1', true, 'Register exists; probe not yet executed.'),
 ('RN-19','POLICY','Every policy decision is logged and explainable',
  'Each evaluation writes policy code, version, input, decision, reason, actor and timestamp to an append-only log.',
  'EXECUTED_DB_PROBE','P1', true, 'Log exists; probe not yet executed.'),
 ('RN-20','CORPORATE','Corporate approval cannot be bypassed',
  'A corporate booking above the configured threshold cannot reach CONFIRMED or reserve a vehicle without a recorded approval.',
  'EXECUTED_DB_PROBE','P0', true, 'Gate implemented; probe not yet executed.'),
 ('RN-21','CORPORATE','Corporate credit limit is enforced',
  'A credit booking beyond available credit, or on a blocked account, is refused by the database.',
  'EXECUTED_DB_PROBE','P0', true, 'Gate implemented; probe not yet executed.'),
 ('RN-22','OPERATIONS','Exceptions carry class, owner, SLA and escalation',
  'Every exception is classified AUTOMATED / HUMAN_REVIEW / APPROVAL_REQUIRED / SYSTEM_EXCEPTION with an owner, deadline and escalation, and breaches escalate.',
  'EXECUTED_DB_PROBE','P1', true, 'SLA engine implemented; probe not yet executed.'),
 ('RN-23','OPERATIONS','Booking truth is complete from one call',
  'One authorised read returns quote, pricing snapshot, policy versions, vehicle, provider, reservation, payment, ledger, fulfilment, refunds, exceptions and one chronological timeline.',
  'EXECUTED_DB_PROBE','P2', true, 'Report implemented; probe not yet executed.'),
 ('RN-24','FINANCE','Security deposit is separated from rental revenue',
  'Deposits are held, released and deducted on their own financial lifecycle and never posted as Yalla revenue.',
  'EXECUTED_DB_PROBE','P0', true, 'Awaiting approved deposit policy and ledger accounts.'),
 ('RN-25','ELIGIBILITY','Licence verification is a hard gate',
  'A self-drive booking cannot be confirmed until identity, licence validity, class eligibility and age policy are verified.',
  'EXECUTED_DB_PROBE','P0', true, 'Awaiting approved licence policy and verification capture.'),
 ('RN-26','PERFORMANCE','End-to-end booking path latency is measured',
  'p50/p95/p99 measured for availability, quote, booking, reservation and payment processing under realistic concurrency, with error and timeout rate.',
  'MEASUREMENT','P1', true, 'Database paths measured; full path under load not measured.'),
 ('RN-27','RESILIENCE','Destructive tests never touch production',
  'Integration, concurrency and failure-injection runs execute against isolated staging; production scheduled jobs are read-only or idempotent.',
  'STAGING_END_TO_END','P0', true, 'Separation asserted; independent evidence not yet recorded.'),
 ('RN-28','DATA','Audit records cannot be altered',
  'Policy decisions, domain events, ledger entries and handover records reject update and delete, proven by attempted mutation.',
  'EXECUTED_DB_PROBE','P0', true, 'Append-only triggers in place; probe not yet executed.'),
 ('RN-29','OPERATIONS','Control tower reflects authoritative records only',
  'Every figure on the control tower derives from database records; no manual or hard-coded totals, and the totals reconcile.',
  'EXECUTED_DB_PROBE','P1', true, 'Consistency function exists; probe not yet executed.'),
 ('RN-30','RESILIENCE','Deterministic recovery from partial failure',
  'Payment-without-inventory, booking-without-event, refund failure, notification failure and provider failure each end in a recorded recoverable state.',
  'STAGING_END_TO_END','P0', true, 'Failure injection not yet executed.')
ON CONFLICT (control_code) DO NOTHING;

INSERT INTO public.rental_release_gates (gate_code, label, sort_order, description)
VALUES ('G11_CORPORATE','Corporate control', 110, 'Corporate approval, credit and exposure control before a company booking is confirmed.'),
       ('G12_GOVERNANCE','Policy governance & audit', 120, 'Versioned policy, explainable decisions and unalterable audit records.')
ON CONFLICT (gate_code) DO NOTHING;

INSERT INTO public.rental_gate_controls (gate_code, control_code) VALUES
 ('G12_GOVERNANCE','RN-18'), ('G12_GOVERNANCE','RN-19'), ('G12_GOVERNANCE','RN-28'),
 ('G11_CORPORATE','RN-20'), ('G11_CORPORATE','RN-21'),
 ('G3_ORCHESTRATION','RN-22'), ('G3_ORCHESTRATION','RN-29'),
 ('G6_FULFILMENT','RN-23'), ('G6_FULFILMENT','RN-25'),
 ('G4_MONEY','RN-24'),
 ('G9_RESILIENCE','RN-26'), ('G9_RESILIENCE','RN-27'), ('G9_RESILIENCE','RN-30')
ON CONFLICT DO NOTHING;