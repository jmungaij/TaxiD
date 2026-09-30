-- ============ 1. Approval bands ============
CREATE TABLE IF NOT EXISTS public.provider_payout_approval_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL UNIQUE,
  min_cents bigint NOT NULL DEFAULT 0,
  max_cents bigint,
  required_approvals integer NOT NULL DEFAULT 1 CHECK (required_approvals BETWEEN 1 AND 3),
  requires_dual_release boolean NOT NULL DEFAULT false,
  sla_hours integer NOT NULL DEFAULT 8 CHECK (sla_hours > 0),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.provider_payout_approval_tiers TO authenticated;
GRANT ALL ON public.provider_payout_approval_tiers TO service_role;
ALTER TABLE public.provider_payout_approval_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance staff read payout tiers" ON public.provider_payout_approval_tiers;
CREATE POLICY "finance staff read payout tiers"
ON public.provider_payout_approval_tiers FOR SELECT TO authenticated
USING (public.has_staff_permission('staff.finance.settlement.manage')
       OR public.capacity_can_approve(auth.uid()));

DROP TRIGGER IF EXISTS trg_payout_tiers_touch ON public.provider_payout_approval_tiers;
CREATE TRIGGER trg_payout_tiers_touch BEFORE UPDATE ON public.provider_payout_approval_tiers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.provider_payout_approval_tiers
  (label, min_cents, max_cents, required_approvals, requires_dual_release, sla_hours, sort_order)
VALUES
  ('Standard',  0,        2000000,  1, false,  8, 1),
  ('Elevated',  2000001,  20000000, 2, true,  12, 2),
  ('Executive', 20000001, NULL,     2, true,  24, 3)
ON CONFLICT (label) DO NOTHING;

-- ============ 2. Request workflow columns ============
ALTER TABLE public.provider_payout_requests
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS tier_id uuid REFERENCES public.provider_payout_approval_tiers(id),
  ADD COLUMN IF NOT EXISTS tier_label text,
  ADD COLUMN IF NOT EXISTS required_approvals integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS approvals_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS screening_state text NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS screened_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS hold_reason text,
  ADD COLUMN IF NOT EXISTS requires_dual_release boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS released_by uuid,
  ADD COLUMN IF NOT EXISTS released_at timestamptz;

ALTER TABLE public.provider_payout_requests DROP CONSTRAINT IF EXISTS provider_payout_requests_state_check;
ALTER TABLE public.provider_payout_requests ADD CONSTRAINT provider_payout_requests_state_check
  CHECK (state = ANY (ARRAY['PENDING_SCREENING','ON_HOLD','PENDING_APPROVAL','APPROVED','PROCESSING','PAID','FAILED','CANCELLED']));

ALTER TABLE public.provider_payout_requests DROP CONSTRAINT IF EXISTS provider_payout_requests_screening_check;
ALTER TABLE public.provider_payout_requests ADD CONSTRAINT provider_payout_requests_screening_check
  CHECK (screening_state = ANY (ARRAY['PENDING','PASS','FLAGGED']));

-- ============ 3. Screening results (append-only) ============
CREATE TABLE IF NOT EXISTS public.provider_payout_screening_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.provider_payout_requests(id) ON DELETE CASCADE,
  run_at timestamptz NOT NULL DEFAULT now(),
  check_key text NOT NULL,
  label text NOT NULL,
  result text NOT NULL CHECK (result = ANY (ARRAY['PASS','WARN','FAIL'])),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payout_screening_request ON public.provider_payout_screening_results(request_id, run_at DESC);

GRANT SELECT ON public.provider_payout_screening_results TO authenticated;
GRANT ALL ON public.provider_payout_screening_results TO service_role;
ALTER TABLE public.provider_payout_screening_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance staff read payout screening" ON public.provider_payout_screening_results;
CREATE POLICY "finance staff read payout screening"
ON public.provider_payout_screening_results FOR SELECT TO authenticated
USING (public.has_staff_permission('staff.finance.settlement.manage'));

CREATE OR REPLACE FUNCTION public._provider_payout_screening_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'PAYOUT_SCREENING_IS_APPEND_ONLY';
END $$;

DROP TRIGGER IF EXISTS trg_payout_screening_append_only ON public.provider_payout_screening_results;
CREATE TRIGGER trg_payout_screening_append_only
BEFORE UPDATE OR DELETE ON public.provider_payout_screening_results
FOR EACH ROW EXECUTE FUNCTION public._provider_payout_screening_append_only();

-- ============ 4. Named approvals (append-only, four-eyes) ============
CREATE TABLE IF NOT EXISTS public.provider_payout_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.provider_payout_requests(id) ON DELETE CASCADE,
  level integer NOT NULL CHECK (level >= 1),
  actor_user_id uuid NOT NULL,
  note text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, level),
  UNIQUE (request_id, actor_user_id)
);

GRANT SELECT ON public.provider_payout_approvals TO authenticated;
GRANT ALL ON public.provider_payout_approvals TO service_role;
ALTER TABLE public.provider_payout_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "finance staff read payout approvals" ON public.provider_payout_approvals;
CREATE POLICY "finance staff read payout approvals"
ON public.provider_payout_approvals FOR SELECT TO authenticated
USING (public.has_staff_permission('staff.finance.settlement.manage'));

CREATE OR REPLACE FUNCTION public._provider_payout_approvals_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'PAYOUT_APPROVALS_ARE_APPEND_ONLY';
END $$;

DROP TRIGGER IF EXISTS trg_payout_approvals_append_only ON public.provider_payout_approvals;
CREATE TRIGGER trg_payout_approvals_append_only
BEFORE UPDATE OR DELETE ON public.provider_payout_approvals
FOR EACH ROW EXECUTE FUNCTION public._provider_payout_approvals_append_only();

-- ============ 5. Band resolution ============
CREATE OR REPLACE FUNCTION public._provider_payout_tier(_amount_cents bigint)
RETURNS public.provider_payout_approval_tiers
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.provider_payout_approval_tiers
   WHERE is_active
     AND _amount_cents >= min_cents
     AND (max_cents IS NULL OR _amount_cents <= max_cents)
   ORDER BY sort_order LIMIT 1;
$$;

-- ============ 6. Screening engine ============
CREATE OR REPLACE FUNCTION public.provider_payout_screen(_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.provider_payout_requests;
  v_acct public.provider_payout_accounts;
  v_set public.provider_settlement_settings;
  v_w public.provider_wallets;
  v_tier public.provider_payout_approval_tiers;
  v_run timestamptz := now();
  v_fails integer := 0;
  v_warns integer := 0;
  v_hold text := NULL;
  v_ver text;
  v_recent integer;

  PROCEDURE_NOOP boolean;
BEGIN
  IF current_user <> 'service_role'
     AND NOT public.has_staff_permission('staff.finance.settlement.manage')
     AND NOT public.capacity_can_approve(auth.uid()) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  SELECT * INTO v_row FROM public.provider_payout_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_REQUEST'; END IF;
  IF v_row.state NOT IN ('PENDING_SCREENING','ON_HOLD','PENDING_APPROVAL') THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'state', v_row.state);
  END IF;

  SELECT * INTO v_set FROM public.provider_settlement_settings WHERE id;
  SELECT * INTO v_acct FROM public.provider_payout_accounts WHERE id = v_row.account_id;
  SELECT * INTO v_w FROM public.provider_wallets WHERE provider_user_id = v_row.provider_user_id;
  v_tier := public._provider_payout_tier(coalesce(v_row.gross_cents, v_row.amount_cents));

  -- destination verified
  IF v_acct.id IS NULL OR v_acct.verification_state <> 'VERIFIED' THEN
    v_fails := v_fails + 1; v_hold := coalesce(v_hold, 'The M-Pesa destination is not verified.');
    INSERT INTO public.provider_payout_screening_results (request_id, run_at, check_key, label, result, detail)
    VALUES (_request_id, v_run, 'DESTINATION_VERIFIED', 'Verified M-Pesa destination', 'FAIL',
            jsonb_build_object('verification_state', coalesce(v_acct.verification_state,'MISSING')));
  ELSE
    INSERT INTO public.provider_payout_screening_results (request_id, run_at, check_key, label, result, detail)
    VALUES (_request_id, v_run, 'DESTINATION_VERIFIED', 'Verified M-Pesa destination', 'PASS',
            jsonb_build_object('verified_at', v_acct.verified_at));
  END IF;

  -- operator standing
  SELECT state INTO v_ver FROM public.provider_verification WHERE provider_user_id = v_row.provider_user_id;
  IF v_ver IN ('SUSPENDED','BLOCKED') THEN
    v_fails := v_fails + 1; v_hold := coalesce(v_hold, 'The operator is suspended or blocked.');
    INSERT INTO public.provider_payout_screening_results (request_id, run_at, check_key, label, result, detail)
    VALUES (_request_id, v_run, 'OPERATOR_STANDING', 'Operator in good standing', 'FAIL',
            jsonb_build_object('verification_state', v_ver));
  ELSIF v_ver IS DISTINCT FROM 'VERIFIED' THEN
    v_warns := v_warns + 1;
    INSERT INTO public.provider_payout_screening_results (request_id, run_at, check_key, label, result, detail)
    VALUES (_request_id, v_run, 'OPERATOR_STANDING', 'Operator in good standing', 'WARN',
            jsonb_build_object('verification_state', coalesce(v_ver,'UNVERIFIED')));
  ELSE
    INSERT INTO public.provider_payout_screening_results (request_id, run_at, check_key, label, result, detail)
    VALUES (_request_id, v_run, 'OPERATOR_STANDING', 'Operator in good standing', 'PASS', '{}'::jsonb);
  END IF;

  -- funds actually reserved
  IF v_w.provider_user_id IS NULL OR v_w.reserved_cents < coalesce(v_row.gross_cents, v_row.amount_cents) THEN
    v_fails := v_fails + 1; v_hold := coalesce(v_hold, 'The withdrawal amount is not reserved in the operator wallet.');
    INSERT INTO public.provider_payout_screening_results (request_id, run_at, check_key, label, result, detail)
    VALUES (_request_id, v_run, 'FUNDS_RESERVED', 'Amount reserved in operator wallet', 'FAIL',
            jsonb_build_object('reserved_cents', coalesce(v_w.reserved_cents,0),
                               'required_cents', coalesce(v_row.gross_cents, v_row.amount_cents)));
  ELSE
    INSERT INTO public.provider_payout_screening_results (request_id, run_at, check_key, label, result, detail)
    VALUES (_request_id, v_run, 'FUNDS_RESERVED', 'Amount reserved in operator wallet', 'PASS',
            jsonb_build_object('reserved_cents', v_w.reserved_cents));
  END IF;

  -- minimum payout
  IF v_row.amount_cents < greatest(coalesce(v_set.min_payout_cents,1000), 1000) THEN
    v_fails := v_fails + 1; v_hold := coalesce(v_hold, 'The net amount is below the smallest payout M-Pesa accepts.');
    INSERT INTO public.provider_payout_screening_results (request_id, run_at, check_key, label, result, detail)
    VALUES (_request_id, v_run, 'MINIMUM_AMOUNT', 'Meets minimum payout', 'FAIL',
            jsonb_build_object('net_cents', v_row.amount_cents, 'minimum_cents', v_set.min_payout_cents));
  ELSE
    INSERT INTO public.provider_payout_screening_results (request_id, run_at, check_key, label, result, detail)
    VALUES (_request_id, v_run, 'MINIMUM_AMOUNT', 'Meets minimum payout', 'PASS',
            jsonb_build_object('net_cents', v_row.amount_cents));
  END IF;

  -- shared destination number
  IF EXISTS (SELECT 1 FROM public.provider_payout_accounts a
              WHERE a.msisdn = v_row.msisdn AND a.provider_user_id <> v_row.provider_user_id) THEN
    v_fails := v_fails + 1; v_hold := coalesce(v_hold, 'This M-Pesa number is also saved by another operator.');
    INSERT INTO public.provider_payout_screening_results (request_id, run_at, check_key, label, result, detail)
    VALUES (_request_id, v_run, 'UNIQUE_DESTINATION', 'Destination not shared with another operator', 'FAIL', '{}'::jsonb);
  ELSE
    INSERT INTO public.provider_payout_screening_results (request_id, run_at, check_key, label, result, detail)
    VALUES (_request_id, v_run, 'UNIQUE_DESTINATION', 'Destination not shared with another operator', 'PASS', '{}'::jsonb);
  END IF;

  -- newly verified destination
  IF v_acct.verified_at IS NOT NULL AND v_acct.verified_at > now() - interval '24 hours' THEN
    v_warns := v_warns + 1;
    INSERT INTO public.provider_payout_screening_results (request_id, run_at, check_key, label, result, detail)
    VALUES (_request_id, v_run, 'DESTINATION_AGE', 'Destination verified more than 24h ago', 'WARN',
            jsonb_build_object('verified_at', v_acct.verified_at));
  ELSE
    INSERT INTO public.provider_payout_screening_results (request_id, run_at, check_key, label, result, detail)
    VALUES (_request_id, v_run, 'DESTINATION_AGE', 'Destination verified more than 24h ago', 'PASS', '{}'::jsonb);
  END IF;

  -- withdrawal frequency
  SELECT count(*) INTO v_recent FROM public.provider_payout_requests r
   WHERE r.provider_user_id = v_row.provider_user_id AND r.id <> _request_id
     AND r.created_at > now() - interval '24 hours';
  IF v_recent >= 3 THEN
    v_warns := v_warns + 1;
    INSERT INTO public.provider_payout_screening_results (request_id, run_at, check_key, label, result, detail)
    VALUES (_request_id, v_run, 'VELOCITY', 'Withdrawal frequency within normal range', 'WARN',
            jsonb_build_object('withdrawals_last_24h', v_recent));
  ELSE
    INSERT INTO public.provider_payout_screening_results (request_id, run_at, check_key, label, result, detail)
    VALUES (_request_id, v_run, 'VELOCITY', 'Withdrawal frequency within normal range', 'PASS',
            jsonb_build_object('withdrawals_last_24h', v_recent));
  END IF;

  -- payout rail configured
  IF coalesce(v_set.payout_shortcode,'') = '' OR v_set.payout_shortcode = v_set.platform_paybill THEN
    v_warns := v_warns + 1;
    INSERT INTO public.provider_payout_screening_results (request_id, run_at, check_key, label, result, detail)
    VALUES (_request_id, v_run, 'PAYOUT_RAIL', 'Dedicated M-Pesa payout short code configured', 'WARN',
            jsonb_build_object('payout_shortcode', coalesce(v_set.payout_shortcode,'')));
  ELSE
    INSERT INTO public.provider_payout_screening_results (request_id, run_at, check_key, label, result, detail)
    VALUES (_request_id, v_run, 'PAYOUT_RAIL', 'Dedicated M-Pesa payout short code configured', 'PASS', '{}'::jsonb);
  END IF;

  UPDATE public.provider_payout_requests
     SET screening_state = CASE WHEN v_fails > 0 THEN 'FLAGGED' ELSE 'PASS' END,
         screened_at = v_run,
         hold_reason = CASE WHEN v_fails > 0 THEN v_hold ELSE NULL END,
         state = CASE WHEN v_fails > 0 THEN 'ON_HOLD' ELSE 'PENDING_APPROVAL' END,
         tier_id = v_tier.id,
         tier_label = v_tier.label,
         required_approvals = greatest(coalesce(v_tier.required_approvals,1), approvals_count),
         requires_dual_release = coalesce(v_tier.requires_dual_release,false),
         sla_due_at = coalesce(sla_due_at, submitted_at + make_interval(hours => coalesce(v_tier.sla_hours,8)))
   WHERE id = _request_id;

  INSERT INTO public.provider_payout_events (request_id, event_type, state_from, state_to, note, detail, actor_user_id)
  VALUES (_request_id, 'SCREENED', v_row.state,
          CASE WHEN v_fails > 0 THEN 'ON_HOLD' ELSE 'PENDING_APPROVAL' END,
          v_hold,
          jsonb_build_object('failures', v_fails, 'warnings', v_warns,
                             'tier', v_tier.label, 'required_approvals', v_tier.required_approvals),
          auth.uid());

  RETURN jsonb_build_object('ok', true, 'failures', v_fails, 'warnings', v_warns,
    'state', CASE WHEN v_fails > 0 THEN 'ON_HOLD' ELSE 'PENDING_APPROVAL' END,
    'tier', v_tier.label, 'required_approvals', v_tier.required_approvals,
    'requires_dual_release', v_tier.requires_dual_release);
END $$;

REVOKE ALL ON FUNCTION public.provider_payout_screen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_payout_screen(uuid) TO authenticated, service_role;

-- ============ 7. Approve / reject ============
CREATE OR REPLACE FUNCTION public.provider_payout_approve(_request_id uuid, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.provider_payout_requests;
  v_level integer;
  v_next_state text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT public.has_staff_permission('staff.finance.settlement.manage') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  SELECT * INTO v_row FROM public.provider_payout_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_REQUEST'; END IF;
  IF v_row.state = 'ON_HOLD' THEN RAISE EXCEPTION 'PAYOUT_ON_HOLD'; END IF;
  IF v_row.state = 'PENDING_SCREENING' OR v_row.screening_state <> 'PASS' THEN
    RAISE EXCEPTION 'SCREENING_REQUIRED';
  END IF;
  IF v_row.state <> 'PENDING_APPROVAL' THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'state', v_row.state);
  END IF;
  IF v_row.provider_user_id = v_uid THEN RAISE EXCEPTION 'SELF_APPROVAL_FORBIDDEN'; END IF;
  IF EXISTS (SELECT 1 FROM public.provider_payout_approvals
              WHERE request_id = _request_id AND actor_user_id = v_uid) THEN
    RAISE EXCEPTION 'SECOND_APPROVER_REQUIRED';
  END IF;

  v_level := v_row.approvals_count + 1;
  INSERT INTO public.provider_payout_approvals (request_id, level, actor_user_id, note)
  VALUES (_request_id, v_level, v_uid, _note);

  v_next_state := CASE WHEN v_level >= v_row.required_approvals THEN 'APPROVED' ELSE 'PENDING_APPROVAL' END;

  UPDATE public.provider_payout_requests
     SET approvals_count = v_level,
         state = v_next_state,
         approved_by = CASE WHEN v_next_state = 'APPROVED' THEN v_uid ELSE approved_by END,
         approved_at = CASE WHEN v_next_state = 'APPROVED' THEN now() ELSE approved_at END,
         decision_note = coalesce(_note, decision_note)
   WHERE id = _request_id;

  INSERT INTO public.provider_payout_events (request_id, event_type, state_from, state_to, note, detail, actor_user_id)
  VALUES (_request_id, 'APPROVAL_RECORDED', v_row.state, v_next_state, _note,
          jsonb_build_object('level', v_level, 'required_approvals', v_row.required_approvals,
                             'tier', v_row.tier_label), v_uid);

  RETURN jsonb_build_object('ok', true, 'state', v_next_state, 'level', v_level,
    'required_approvals', v_row.required_approvals,
    'approvals_outstanding', greatest(v_row.required_approvals - v_level, 0));
END $$;

REVOKE ALL ON FUNCTION public.provider_payout_approve(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_payout_approve(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.provider_payout_reject(_request_id uuid, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.provider_payout_requests;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT public.has_staff_permission('staff.finance.settlement.manage') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  IF coalesce(btrim(_note),'') = '' THEN RAISE EXCEPTION 'REJECTION_REASON_REQUIRED'; END IF;

  SELECT * INTO v_row FROM public.provider_payout_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_REQUEST'; END IF;
  IF v_row.state NOT IN ('PENDING_SCREENING','ON_HOLD','PENDING_APPROVAL','APPROVED') THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'state', v_row.state);
  END IF;
  IF v_row.released_at IS NOT NULL THEN RAISE EXCEPTION 'PAYOUT_ALREADY_RELEASED'; END IF;

  UPDATE public.provider_payout_requests
     SET state = 'CANCELLED', decision_note = _note, approved_by = v_uid, approved_at = now()
   WHERE id = _request_id;

  UPDATE public.provider_earnings
     SET state = 'PAYABLE', payout_request_id = NULL
   WHERE payout_request_id = _request_id AND state = 'RESERVED';

  INSERT INTO public.provider_payout_events (request_id, event_type, state_from, state_to, note, actor_user_id)
  VALUES (_request_id, 'REJECTED', v_row.state, 'CANCELLED', _note, v_uid);

  RETURN jsonb_build_object('ok', true, 'state', 'CANCELLED');
END $$;

REVOKE ALL ON FUNCTION public.provider_payout_reject(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_payout_reject(uuid, text) TO authenticated, service_role;

-- Backwards-compatible wrapper
CREATE OR REPLACE FUNCTION public.provider_payout_decide(_request_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _approve THEN
    RETURN public.provider_payout_approve(_request_id, _note);
  END IF;
  RETURN public.provider_payout_reject(_request_id, coalesce(_note, 'Rejected by finance'));
END $$;

-- ============ 8. Release for payment (separation of duties) ============
CREATE OR REPLACE FUNCTION public.provider_payout_release(_request_id uuid, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.provider_payout_requests;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT public.has_staff_permission('staff.finance.settlement.manage') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  SELECT * INTO v_row FROM public.provider_payout_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_REQUEST'; END IF;
  IF v_row.released_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'state', v_row.state);
  END IF;
  IF v_row.state <> 'APPROVED' THEN RAISE EXCEPTION 'PAYOUT_NOT_APPROVED'; END IF;
  IF v_row.approvals_count < v_row.required_approvals THEN RAISE EXCEPTION 'SECOND_APPROVER_REQUIRED'; END IF;
  IF v_row.requires_dual_release
     AND EXISTS (SELECT 1 FROM public.provider_payout_approvals
                  WHERE request_id = _request_id AND actor_user_id = v_uid) THEN
    RAISE EXCEPTION 'SEPARATE_RELEASER_REQUIRED';
  END IF;

  UPDATE public.provider_payout_requests
     SET released_by = v_uid, released_at = now()
   WHERE id = _request_id;

  INSERT INTO public.provider_payout_events (request_id, event_type, state_from, state_to, note, detail, actor_user_id)
  VALUES (_request_id, 'RELEASED_FOR_PAYMENT', 'APPROVED', 'APPROVED', _note,
          jsonb_build_object('requires_dual_release', v_row.requires_dual_release), v_uid);

  RETURN jsonb_build_object('ok', true, 'state', 'APPROVED', 'released', true);
END $$;

REVOKE ALL ON FUNCTION public.provider_payout_release(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_payout_release(uuid, text) TO authenticated, service_role;

-- ============ 9. Sending requires a recorded release ============
CREATE OR REPLACE FUNCTION public.provider_payout_claim(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_src uuid := (p->>'request_id')::uuid;
  v_row public.provider_payout_requests;
  v_acct public.provider_payout_accounts;
  v_existing public.payout_disbursements;
  v_key text;
  v_ref text;
  v_id uuid;
BEGIN
  IF current_user <> 'service_role'
     AND NOT public.has_staff_permission('staff.finance.settlement.manage') THEN
    RETURN jsonb_build_object('error', true, 'code','AUTHORIZATION_ERROR');
  END IF;

  SELECT * INTO v_row FROM public.provider_payout_requests WHERE id = v_src FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','UNKNOWN_REQUEST'); END IF;

  v_key := 'payout:provider_payout:' || v_src::text;
  SELECT * INTO v_existing FROM public.payout_disbursements WHERE idempotency_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'disbursement_id', v_existing.id,
      'reference', v_existing.disbursement_reference, 'state', v_existing.state,
      'msisdn', v_existing.msisdn, 'amount', v_existing.amount);
  END IF;

  IF v_row.state <> 'APPROVED' THEN
    RETURN jsonb_build_object('error', true, 'code','PAYOUT_NOT_APPROVED', 'state', v_row.state);
  END IF;
  IF v_row.approvals_count < v_row.required_approvals THEN
    RETURN jsonb_build_object('error', true, 'code','SECOND_APPROVER_REQUIRED', 'state', v_row.state);
  END IF;
  IF v_row.released_at IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code','PAYOUT_NOT_RELEASED', 'state', v_row.state);
  END IF;

  SELECT * INTO v_acct FROM public.provider_payout_accounts
   WHERE id = v_row.account_id AND provider_user_id = v_row.provider_user_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','DESTINATION_NOT_FOUND'); END IF;
  IF v_acct.verification_state <> 'VERIFIED' THEN
    RETURN jsonb_build_object('error', true, 'code','DESTINATION_NOT_VERIFIED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.provider_earnings
                  WHERE payout_request_id = v_src AND state = 'RESERVED') THEN
    RETURN jsonb_build_object('error', true, 'code','NO_RESERVED_EARNINGS');
  END IF;

  v_ref := 'PYT-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(v_key), 1, 8));

  INSERT INTO public.payout_disbursements
    (disbursement_reference, beneficiary_type, beneficiary_id, source_kind, source_id,
     destination_snapshot, msisdn, amount, currency, state, idempotency_key, initiated_by)
  VALUES (v_ref, 'PROVIDER', v_row.provider_user_id, 'provider_payout', v_src,
     jsonb_build_object('account_id', v_acct.id, 'type','MPESA',
                        'account_name', v_acct.account_name,
                        'verification_state', v_acct.verification_state,
                        'verified_at', v_acct.verified_at,
                        'approvals', v_row.approvals_count,
                        'released_by', v_row.released_by),
     v_acct.msisdn, round(v_row.amount_cents::numeric / 100, 2), coalesce(v_row.currency,'KES'),
     'DRAFT', v_key, auth.uid())
  RETURNING id INTO v_id;

  UPDATE public.provider_payout_requests SET disbursement_id = v_id WHERE id = v_src;

  INSERT INTO public.provider_payout_events (request_id, event_type, state_from, state_to, detail, actor_user_id)
  VALUES (v_src, 'PAYOUT_CREATED', v_row.state, v_row.state,
          jsonb_build_object('disbursement_id', v_id, 'reference', v_ref), auth.uid());

  RETURN jsonb_build_object('ok', true, 'disbursement_id', v_id, 'reference', v_ref,
    'state','DRAFT', 'msisdn', v_acct.msisdn,
    'amount', round(v_row.amount_cents::numeric / 100, 2),
    'request_reference', v_row.request_reference);
END $$;

-- ============ 10. Submission enters the workflow ============
CREATE OR REPLACE FUNCTION public.provider_withdrawal_request(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_set public.provider_settlement_settings;
  v_acct public.provider_payout_accounts;
  v_w public.provider_wallets;
  v_amount bigint := coalesce((p->>'amount_cents')::bigint, 0);
  v_fee bigint;
  v_net bigint;
  v_id uuid;
  v_ref text;
  v_tier public.provider_payout_approval_tiers;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT * INTO v_set FROM public.provider_settlement_settings WHERE id;

  SELECT * INTO v_acct FROM public.provider_payout_accounts
   WHERE provider_user_id = v_uid AND verification_state = 'VERIFIED'
   ORDER BY is_default DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'VERIFIED_MPESA_ACCOUNT_REQUIRED'; END IF;

  PERFORM public.provider_settlement_run();

  SELECT * INTO v_w FROM public.provider_wallets WHERE provider_user_id = v_uid FOR UPDATE;
  IF NOT FOUND OR v_w.available_cents <= 0 THEN RAISE EXCEPTION 'NO_WITHDRAWABLE_BALANCE'; END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'AMOUNT_REQUIRED'; END IF;
  IF v_amount > v_w.available_cents THEN RAISE EXCEPTION 'AMOUNT_EXCEEDS_AVAILABLE_BALANCE'; END IF;

  v_fee := round(v_amount::numeric * v_set.withdrawal_fee_bps / 10000);
  v_net := v_amount - v_fee;
  IF v_net < greatest(v_set.min_payout_cents, 1000) THEN
    RAISE EXCEPTION 'BELOW_MINIMUM_PAYOUT';
  END IF;

  IF EXISTS (SELECT 1 FROM public.provider_payout_requests
              WHERE provider_user_id = v_uid
                AND state IN ('PENDING_SCREENING','ON_HOLD','PENDING_APPROVAL','APPROVED','PROCESSING')) THEN
    RAISE EXCEPTION 'WITHDRAWAL_ALREADY_IN_PROGRESS';
  END IF;

  v_tier := public._provider_payout_tier(v_amount);
  v_ref := 'WDR-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 8));

  INSERT INTO public.provider_payout_requests
    (request_reference, provider_user_id, account_id, msisdn, amount_cents, currency,
     earnings_count, state, gross_cents, fee_bps, fee_cents,
     submitted_at, tier_id, tier_label, required_approvals, requires_dual_release, sla_due_at)
  VALUES (v_ref, v_uid, v_acct.id, v_acct.msisdn, v_net, v_w.currency, 0,
          'PENDING_SCREENING', v_amount, v_set.withdrawal_fee_bps, v_fee,
          now(), v_tier.id, v_tier.label, coalesce(v_tier.required_approvals,1),
          coalesce(v_tier.requires_dual_release,false),
          now() + make_interval(hours => coalesce(v_tier.sla_hours,8)))
  RETURNING id INTO v_id;

  PERFORM public._provider_wallet_post(
    v_uid, 'WITHDRAWAL_RESERVED', v_amount, -v_amount, 0, v_amount,
    'withdrawal:' || v_id::text,
    jsonb_build_object('reference', v_ref, 'fee_cents', v_fee, 'net_cents', v_net,
                       'fee_bps', v_set.withdrawal_fee_bps,
                       'funding_source', 'provider_wallet'));

  INSERT INTO public.provider_payout_events
    (request_id, event_type, state_to, note, detail, actor_user_id)
  VALUES (v_id, 'WITHDRAWAL_SUBMITTED', 'PENDING_SCREENING',
          'Operator submitted a withdrawal from their own wallet balance',
          jsonb_build_object('gross_cents', v_amount, 'fee_cents', v_fee, 'net_cents', v_net,
                             'fee_bps', v_set.withdrawal_fee_bps,
                             'tier', v_tier.label,
                             'required_approvals', coalesce(v_tier.required_approvals,1),
                             'funding_source', 'provider_wallet',
                             'payout_shortcode', v_set.payout_shortcode,
                             'fee_posted_to_paybill', v_set.platform_paybill), v_uid);

  PERFORM public.provider_payout_screen(v_id);

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'reference', v_ref,
    'gross_cents', v_amount, 'fee_cents', v_fee, 'net_cents', v_net,
    'fee_bps', v_set.withdrawal_fee_bps, 'msisdn', v_acct.msisdn,
    'tier', v_tier.label, 'required_approvals', coalesce(v_tier.required_approvals,1),
    'funding_source', 'provider_wallet');
END $$;

-- ============ 11. Workflow queue for the finance panel ============
CREATE OR REPLACE FUNCTION public.provider_payout_workflow_console()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT (public.has_staff_permission('staff.finance.settlement.manage')
          OR public.capacity_can_approve(v_uid)) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  RETURN jsonb_build_object(
    'can_decide', public.has_staff_permission('staff.finance.settlement.manage'),
    'tiers', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'label', t.label, 'min_cents', t.min_cents, 'max_cents', t.max_cents,
        'required_approvals', t.required_approvals,
        'requires_dual_release', t.requires_dual_release, 'sla_hours', t.sla_hours)
        ORDER BY t.sort_order), '[]'::jsonb)
        FROM public.provider_payout_approval_tiers t WHERE t.is_active),
    'summary', jsonb_build_object(
      'on_hold', (SELECT count(*) FROM public.provider_payout_requests WHERE state='ON_HOLD'),
      'awaiting_approval', (SELECT count(*) FROM public.provider_payout_requests WHERE state='PENDING_APPROVAL'),
      'awaiting_release', (SELECT count(*) FROM public.provider_payout_requests
                            WHERE state='APPROVED' AND released_at IS NULL),
      'in_flight', (SELECT count(*) FROM public.provider_payout_requests WHERE state='PROCESSING'),
      'sla_breached', (SELECT count(*) FROM public.provider_payout_requests
                        WHERE state IN ('PENDING_SCREENING','ON_HOLD','PENDING_APPROVAL','APPROVED')
                          AND sla_due_at IS NOT NULL AND sla_due_at < now())),
    'requests', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'reference', r.request_reference, 'provider_user_id', r.provider_user_id,
        'msisdn', r.msisdn, 'gross_cents', r.gross_cents, 'fee_cents', r.fee_cents,
        'amount_cents', r.amount_cents, 'currency', r.currency, 'state', r.state,
        'tier_label', r.tier_label, 'required_approvals', r.required_approvals,
        'approvals_count', r.approvals_count, 'requires_dual_release', r.requires_dual_release,
        'screening_state', r.screening_state, 'hold_reason', r.hold_reason,
        'submitted_at', r.submitted_at, 'sla_due_at', r.sla_due_at,
        'released_at', r.released_at, 'released_by', r.released_by,
        'paid_at', r.paid_at, 'provider_transaction_id', r.provider_transaction_id,
        'failure_reason', r.failure_reason,
        'viewer_has_approved', EXISTS (SELECT 1 FROM public.provider_payout_approvals a
                                        WHERE a.request_id = r.id AND a.actor_user_id = v_uid),
        'approvals', (SELECT coalesce(jsonb_agg(jsonb_build_object(
            'level', a.level, 'actor_user_id', a.actor_user_id, 'note', a.note,
            'decided_at', a.decided_at) ORDER BY a.level), '[]'::jsonb)
            FROM public.provider_payout_approvals a WHERE a.request_id = r.id),
        'checks', (SELECT coalesce(jsonb_agg(jsonb_build_object(
            'check_key', s.check_key, 'label', s.label, 'result', s.result, 'detail', s.detail)
            ORDER BY s.result DESC, s.check_key), '[]'::jsonb)
            FROM public.provider_payout_screening_results s
            WHERE s.request_id = r.id AND s.run_at = r.screened_at),
        'events', (SELECT coalesce(jsonb_agg(jsonb_build_object(
            'event_type', e.event_type, 'state_from', e.state_from, 'state_to', e.state_to,
            'note', e.note, 'actor_user_id', e.actor_user_id, 'created_at', e.created_at)
            ORDER BY e.created_at), '[]'::jsonb)
            FROM public.provider_payout_events e WHERE e.request_id = r.id))
        ORDER BY r.created_at DESC), '[]'::jsonb)
        FROM public.provider_payout_requests r));
END $$;

REVOKE ALL ON FUNCTION public.provider_payout_workflow_console() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_payout_workflow_console() TO authenticated, service_role;
