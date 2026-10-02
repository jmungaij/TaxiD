CREATE OR REPLACE FUNCTION public._provider_wallet_post(
  _uid uuid, _type text, _amount bigint,
  _avail bigint, _held bigint, _reserved bigint,
  _reference text, _detail jsonb DEFAULT '{}'::jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_w public.provider_wallets;
BEGIN
  INSERT INTO public.provider_wallets (provider_user_id) VALUES (_uid)
  ON CONFLICT (provider_user_id) DO NOTHING;
  PERFORM 1 FROM public.provider_wallets WHERE provider_user_id = _uid FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.provider_wallet_ledger
              WHERE provider_user_id = _uid AND entry_type = _type AND reference = _reference) THEN
    RETURN false;
  END IF;
  UPDATE public.provider_wallets
     SET available_cents = available_cents + _avail,
         held_cents = held_cents + _held,
         reserved_cents = reserved_cents + _reserved,
         lifetime_earned_cents = lifetime_earned_cents + CASE WHEN _type = 'RELEASE' THEN _amount ELSE 0 END,
         lifetime_withdrawn_cents = lifetime_withdrawn_cents + CASE WHEN _type = 'WITHDRAWAL_PAID' THEN _amount ELSE 0 END,
         lifetime_fees_cents = lifetime_fees_cents + CASE WHEN _type = 'WITHDRAWAL_FEE' THEN _amount ELSE 0 END
   WHERE provider_user_id = _uid
  RETURNING * INTO v_w;
  INSERT INTO public.provider_wallet_ledger
    (provider_user_id, entry_type, amount_cents, available_delta, held_delta, reserved_delta,
     available_after, held_after, reserved_after, currency, reference, detail)
  VALUES (_uid, _type, _amount, _avail, _held, _reserved,
          v_w.available_cents, v_w.held_cents, v_w.reserved_cents, v_w.currency, _reference,
          coalesce(_detail, '{}'::jsonb));
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.provider_payout_claim(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_src uuid := (p->>'request_id')::uuid;
  v_row public.provider_payout_requests;
  v_acct public.provider_payout_accounts;
  v_existing public.payout_disbursements;
  v_key text; v_ref text; v_id uuid;
BEGIN
  IF coalesce(auth.role(),'') <> 'service_role'
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
  IF NOT EXISTS (SELECT 1 FROM public.provider_earnings WHERE payout_request_id = v_src AND state = 'RESERVED') THEN
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

REVOKE ALL ON FUNCTION public._provider_wallet_post(uuid,text,bigint,bigint,bigint,bigint,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.provider_payout_claim(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._provider_wallet_post(uuid,text,bigint,bigint,bigint,bigint,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.provider_payout_claim(jsonb) TO service_role;