
CREATE OR REPLACE FUNCTION public.certify_driver_operational_consistency(_driver_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
  _checks jsonb := '[]'::jsonb;
  _failed text[] := ARRAY[]::text[];
  _passed_count int := 0;
  _total_count int := 0;
  _score int;

  _wallet_id uuid;
  _wallet_balance bigint;
  _tx_net bigint;
  _trips_completed bigint;
  _trip_credits bigint;
  _payouts_completed bigint;
  _payouts_amount bigint;
  _journal_debits bigint;
  _certified_payouts bigint;
  _timeline_rows int;
  _orphan_tx bigint;
  _duplicate_certs bigint;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RETURN jsonb_build_object('error','forbidden','driver_id',_driver_id);
  END IF;

  SELECT user_id INTO _uid FROM public.drivers WHERE id = _driver_id;

  -- 1. Driver profile ↔ auth user
  _total_count := _total_count + 1;
  IF _uid IS NOT NULL THEN
    _passed_count := _passed_count + 1;
    _checks := _checks || jsonb_build_object('name','driver_profile','ok',true,'detail','driver linked to user_id');
  ELSE
    _failed := array_append(_failed, 'driver_profile');
    _checks := _checks || jsonb_build_object('name','driver_profile','ok',false,'detail','driver has no user_id','remediation','Attach the driver profile to an auth.users row.');
    -- can't continue meaningfully without a user_id
    _score := 0;
    RETURN jsonb_build_object(
      'driver_id',_driver_id,'passed',false,'score',0,
      'checks',_checks,'failed_checks',_failed,
      'generated_at',now()
    );
  END IF;

  -- 2. Wallet ownership
  _total_count := _total_count + 1;
  SELECT id, balance_cents INTO _wallet_id, _wallet_balance
    FROM public.wallets WHERE user_id = _uid ORDER BY created_at LIMIT 1;
  IF _wallet_id IS NOT NULL THEN
    _passed_count := _passed_count + 1;
    _checks := _checks || jsonb_build_object('name','wallet_ownership','ok',true,'detail',jsonb_build_object('wallet_id',_wallet_id,'balance_cents',_wallet_balance));
  ELSE
    _failed := array_append(_failed, 'wallet_ownership');
    _checks := _checks || jsonb_build_object('name','wallet_ownership','ok',false,'detail','no wallet for driver user','remediation','Provision a wallet for this user.');
  END IF;

  -- 3. Wallet balance ↔ wallet_transactions net
  IF _wallet_id IS NOT NULL THEN
    _total_count := _total_count + 1;
    SELECT COALESCE(SUM(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END),0)
      INTO _tx_net
      FROM public.wallet_transactions
      WHERE wallet_id = _wallet_id AND status IN ('completed','posted');
    IF _tx_net = _wallet_balance THEN
      _passed_count := _passed_count + 1;
      _checks := _checks || jsonb_build_object('name','wallet_balance_ledger','ok',true,'detail',jsonb_build_object('balance_cents',_wallet_balance,'tx_net',_tx_net));
    ELSE
      _failed := array_append(_failed, 'wallet_balance_ledger');
      _checks := _checks || jsonb_build_object('name','wallet_balance_ledger','ok',false,
        'detail',jsonb_build_object('balance_cents',_wallet_balance,'tx_net',_tx_net,'delta',_wallet_balance-_tx_net),
        'remediation','Run projection sync for wallet_transactions; investigate manual adjustments.');
    END IF;
  END IF;

  -- 4. Trips completed ↔ trip earning credits
  _total_count := _total_count + 1;
  SELECT COUNT(*) INTO _trips_completed
    FROM public.trip_bookings WHERE driver_id = _driver_id AND status = 'completed';
  IF _wallet_id IS NOT NULL THEN
    SELECT COUNT(*) INTO _trip_credits
      FROM public.wallet_transactions
      WHERE wallet_id = _wallet_id
        AND direction = 'credit'
        AND kind IN ('trip_earning','trip_payout','ride_credit');
  ELSE
    _trip_credits := 0;
  END IF;
  IF _trips_completed = 0 OR _trip_credits >= _trips_completed THEN
    _passed_count := _passed_count + 1;
    _checks := _checks || jsonb_build_object('name','trips_wallet_credits','ok',true,
      'detail',jsonb_build_object('trips_completed',_trips_completed,'trip_credits',_trip_credits));
  ELSE
    _failed := array_append(_failed, 'trips_wallet_credits');
    _checks := _checks || jsonb_build_object('name','trips_wallet_credits','ok',false,
      'detail',jsonb_build_object('trips_completed',_trips_completed,'trip_credits',_trip_credits,'missing',_trips_completed-_trip_credits),
      'remediation','Backfill trip_earning wallet_transactions for completed trips missing credits.');
  END IF;

  -- 5. Payouts ↔ journal entries (each completed payout must have a journal_id)
  _total_count := _total_count + 1;
  SELECT COUNT(*), COALESCE(SUM(amount_cents),0)
    INTO _payouts_completed, _payouts_amount
    FROM public.driver_payouts
    WHERE driver_id = _driver_id AND status IN ('paid','completed','settled');
  SELECT COALESCE(SUM(jl.amount_cents),0)
    INTO _journal_debits
    FROM public.driver_payouts dp
    JOIN public.journal_lines jl ON jl.journal_id = dp.journal_id
    WHERE dp.driver_id = _driver_id
      AND dp.status IN ('paid','completed','settled')
      AND jl.direction = 'debit';
  IF _payouts_completed = 0 OR _journal_debits >= _payouts_amount THEN
    _passed_count := _passed_count + 1;
    _checks := _checks || jsonb_build_object('name','payouts_journal','ok',true,
      'detail',jsonb_build_object('payouts_completed',_payouts_completed,'payouts_amount',_payouts_amount,'journal_debits',_journal_debits));
  ELSE
    _failed := array_append(_failed, 'payouts_journal');
    _checks := _checks || jsonb_build_object('name','payouts_journal','ok',false,
      'detail',jsonb_build_object('payouts_completed',_payouts_completed,'payouts_amount',_payouts_amount,'journal_debits',_journal_debits),
      'remediation','Repost missing journal entries for completed payouts.');
  END IF;

  -- 6. Withdrawals ↔ withdrawal certifications
  _total_count := _total_count + 1;
  SELECT COUNT(*) INTO _certified_payouts
    FROM public.driver_payouts dp
    WHERE dp.driver_id = _driver_id
      AND dp.status IN ('paid','completed','settled')
      AND EXISTS (SELECT 1 FROM public.driver_withdrawal_certifications c
                   WHERE c.payout_id = dp.id AND c.passed = true);
  IF _payouts_completed = 0 OR _certified_payouts = _payouts_completed THEN
    _passed_count := _passed_count + 1;
    _checks := _checks || jsonb_build_object('name','withdrawal_certifications','ok',true,
      'detail',jsonb_build_object('payouts',_payouts_completed,'certified',_certified_payouts));
  ELSE
    _failed := array_append(_failed, 'withdrawal_certifications');
    _checks := _checks || jsonb_build_object('name','withdrawal_certifications','ok',false,
      'detail',jsonb_build_object('payouts',_payouts_completed,'certified',_certified_payouts,'missing',_payouts_completed-_certified_payouts),
      'remediation','Run driver_withdrawal_certification_recover().');
  END IF;

  -- 7. Timeline coverage (canonical driver_timeline)
  _total_count := _total_count + 1;
  BEGIN
    SELECT COUNT(*) INTO _timeline_rows FROM public.driver_timeline(_driver_id, 500);
  EXCEPTION WHEN OTHERS THEN
    _timeline_rows := -1;
  END;
  IF _timeline_rows >= 0 AND (_trips_completed + _payouts_completed = 0 OR _timeline_rows > 0) THEN
    _passed_count := _passed_count + 1;
    _checks := _checks || jsonb_build_object('name','timeline_coverage','ok',true,
      'detail',jsonb_build_object('timeline_rows',_timeline_rows));
  ELSE
    _failed := array_append(_failed, 'timeline_coverage');
    _checks := _checks || jsonb_build_object('name','timeline_coverage','ok',false,
      'detail',jsonb_build_object('timeline_rows',_timeline_rows),
      'remediation','Verify driver_timeline RPC source unions are intact.');
  END IF;

  -- 8. No orphan wallet_transactions (wallet not belonging to user)
  _total_count := _total_count + 1;
  SELECT COUNT(*) INTO _orphan_tx
    FROM public.wallet_transactions wt
    LEFT JOIN public.wallets w ON w.id = wt.wallet_id
    WHERE wt.user_id = _uid
      AND (w.id IS NULL OR w.user_id <> _uid);
  IF _orphan_tx = 0 THEN
    _passed_count := _passed_count + 1;
    _checks := _checks || jsonb_build_object('name','orphan_wallet_tx','ok',true,'detail','no orphans');
  ELSE
    _failed := array_append(_failed, 'orphan_wallet_tx');
    _checks := _checks || jsonb_build_object('name','orphan_wallet_tx','ok',false,
      'detail',jsonb_build_object('orphan_count',_orphan_tx),
      'remediation','Investigate and reassign or void mismatched wallet_transactions.');
  END IF;

  -- 9. No duplicate withdrawal certifications per payout
  _total_count := _total_count + 1;
  SELECT COUNT(*) INTO _duplicate_certs FROM (
    SELECT payout_id FROM public.driver_withdrawal_certifications
    WHERE driver_user_id = _uid
    GROUP BY payout_id HAVING COUNT(*) > 1
  ) d;
  IF _duplicate_certs = 0 THEN
    _passed_count := _passed_count + 1;
    _checks := _checks || jsonb_build_object('name','duplicate_certifications','ok',true,'detail','unique per payout');
  ELSE
    _failed := array_append(_failed, 'duplicate_certifications');
    _checks := _checks || jsonb_build_object('name','duplicate_certifications','ok',false,
      'detail',jsonb_build_object('duplicated_payouts',_duplicate_certs),
      'remediation','De-duplicate driver_withdrawal_certifications, keep latest passed row.');
  END IF;

  _score := CASE WHEN _total_count = 0 THEN 0 ELSE (_passed_count * 100) / _total_count END;

  RETURN jsonb_build_object(
    'driver_id',_driver_id,
    'user_id',_uid,
    'passed', array_length(_failed,1) IS NULL,
    'score',_score,
    'checks',_checks,
    'failed_checks',_failed,
    'generated_at',now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.certify_driver_operational_consistency(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.certify_driver_operational_consistency(uuid) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.driver_operational_consistency_scoreboard(_sample_size int DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sample uuid[];
  _results jsonb := '[]'::jsonb;
  _row jsonb;
  _sum int := 0;
  _n int := 0;
  _failed int := 0;
  _driver uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')) THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;

  SELECT array_agg(id) INTO _sample FROM (
    SELECT id FROM public.drivers
    WHERE user_id IS NOT NULL
    ORDER BY updated_at DESC NULLS LAST
    LIMIT GREATEST(1, LEAST(_sample_size, 200))
  ) s;

  IF _sample IS NULL THEN
    RETURN jsonb_build_object('sample_size',0,'avg_score',0,'passed',true,'failed_drivers',0,'results','[]'::jsonb);
  END IF;

  FOREACH _driver IN ARRAY _sample LOOP
    _row := public.certify_driver_operational_consistency(_driver);
    _results := _results || _row;
    _sum := _sum + COALESCE((_row->>'score')::int, 0);
    _n := _n + 1;
    IF COALESCE((_row->>'passed')::boolean, false) = false THEN
      _failed := _failed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'sample_size',_n,
    'avg_score', CASE WHEN _n = 0 THEN 0 ELSE _sum / _n END,
    'failed_drivers',_failed,
    'passed', _failed = 0,
    'results',_results,
    'generated_at',now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.driver_operational_consistency_scoreboard(int) FROM public;
GRANT EXECUTE ON FUNCTION public.driver_operational_consistency_scoreboard(int) TO authenticated, service_role;
