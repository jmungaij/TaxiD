
CREATE OR REPLACE FUNCTION public.corporate_tentative_bill_summary(_corporate_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _balance bigint; _pa bigint; _paa bigint; _ap bigint; _apa bigint;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.corporate_employees ce
               WHERE ce.corporate_id = _corporate_id AND ce.user_id = auth.uid() AND ce.status='active')
  ) THEN RAISE EXCEPTION 'Not authorised'; END IF;

  SELECT COALESCE(balance_after_cents,0) INTO _balance
  FROM public.corporate_cash_ledger
  WHERE corporate_id = _corporate_id
  ORDER BY occurred_at DESC, created_at DESC LIMIT 1;
  _balance := COALESCE(_balance,0);

  SELECT COUNT(*), COALESCE(SUM(estimated_fare_cents),0) INTO _pa, _paa
  FROM public.corporate_ride_approvals
  WHERE corporate_id = _corporate_id AND status='pending';

  SELECT COUNT(*), COALESCE(SUM(estimated_fare_cents),0) INTO _ap, _apa
  FROM public.corporate_ride_approvals
  WHERE corporate_id = _corporate_id AND status='approved';

  RETURN jsonb_build_object(
    'balance_cents', _balance,
    'pending_approvals_count', _pa,
    'pending_approvals_amount_cents', _paa,
    'inflight_trips_count', _ap,
    'inflight_trips_amount_cents', _apa,
    'tentative_total_cents', _paa + _apa,
    'projected_balance_cents', _balance - (_paa + _apa)
  );
END $$;
