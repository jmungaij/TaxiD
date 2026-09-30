CREATE OR REPLACE FUNCTION public.provider_payout_screen(_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
BEGIN
  SELECT * INTO v_row FROM public.provider_payout_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNKNOWN_REQUEST'; END IF;

  -- Screening only records automated checks; it can hold a withdrawal or move it
  -- to waiting-for-approval, never approve or release money. The operator who
  -- owns the withdrawal may therefore run it on their own request.
  IF current_user NOT IN ('service_role','postgres','supabase_admin')
     AND NOT public.has_staff_permission('staff.finance.settlement.manage')
     AND NOT public.capacity_can_approve(auth.uid())
     AND v_row.provider_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

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
END $function$;