
-- Canonical driver KPI aggregation layer (Phase D6.0 Sprint 1)
-- Single source of truth consumed by DriverAdministration + Driver360.

CREATE OR REPLACE FUNCTION public.driver_admin_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today_iso timestamptz := date_trunc('day', now());
  result jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')
       OR public.has_role(auth.uid(), 'super_admin')
       OR public.has_role(auth.uid(), 'compliance_admin')
       OR public.has_role(auth.uid(), 'finance_admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'total',        (SELECT count(*) FROM public.drivers),
    'active',       (SELECT count(*) FROM public.drivers WHERE status = 'active'),
    'offline',      (SELECT count(*) FROM public.drivers WHERE status = 'inactive'),
    'busy',         0,
    'suspended',    (SELECT count(*) FROM public.drivers WHERE status = 'suspended'),
    'pending',      (SELECT count(*) FROM public.drivers WHERE verification_status = 'pending'),
    'alerts',       (SELECT count(*) FROM public.compliance_alerts WHERE status = 'OPEN'),
    'walletBalance',(SELECT COALESCE(sum(balance_cents), 0) FROM public.wallets WHERE wallet_type = 'driver'),
    'earningsToday',(SELECT COALESCE(sum(amount_cents), 0) FROM public.wallet_transactions
                     WHERE created_at >= today_iso AND kind = 'ride_earning'),
    'tripsToday',   (SELECT count(*) FROM public.trip_bookings WHERE created_at >= today_iso),
    'acceptance',   (SELECT COALESCE(avg(acceptance_rate), 0) FROM public.driver_scores),
    'completion',   (SELECT COALESCE(avg(completion_rate), 0) FROM public.driver_scores),
    'safety',       (SELECT COALESCE(avg(safety_score), 0) FROM public.driver_scores),
    'rating',       (SELECT COALESCE(avg(driver_rating), 0) FROM public.drivers)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.driver_admin_metrics() FROM public;
GRANT EXECUTE ON FUNCTION public.driver_admin_metrics() TO authenticated;

CREATE OR REPLACE FUNCTION public.driver_metrics(_driver_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today_iso timestamptz := date_trunc('day', now());
  d_user_id uuid;
  result jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin')
       OR public.has_role(auth.uid(), 'super_admin')
       OR public.has_role(auth.uid(), 'compliance_admin')
       OR public.has_role(auth.uid(), 'finance_admin')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO d_user_id FROM public.drivers WHERE id = _driver_id;

  SELECT jsonb_build_object(
    'walletBalance', COALESCE((SELECT balance_cents FROM public.wallets
                               WHERE user_id = d_user_id AND wallet_type = 'driver' LIMIT 1), 0),
    'earningsToday', COALESCE((SELECT sum(amount_cents) FROM public.wallet_transactions
                               WHERE user_id = d_user_id AND created_at >= today_iso
                                 AND kind = 'ride_earning'), 0),
    'tripsToday',    (SELECT count(*) FROM public.trip_bookings
                       WHERE driver_id = _driver_id AND created_at >= today_iso),
    'tripsTotal',    (SELECT count(*) FROM public.trip_bookings WHERE driver_id = _driver_id),
    'openAlerts',    (SELECT count(*) FROM public.compliance_alerts
                       WHERE driver_id = _driver_id AND status = 'OPEN'),
    'acceptance',    COALESCE((SELECT acceptance_rate FROM public.driver_scores
                               WHERE driver_id = _driver_id LIMIT 1), 0),
    'completion',    COALESCE((SELECT completion_rate FROM public.driver_scores
                               WHERE driver_id = _driver_id LIMIT 1), 0),
    'safety',        COALESCE((SELECT safety_score FROM public.driver_scores
                               WHERE driver_id = _driver_id LIMIT 1), 0)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.driver_metrics(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.driver_metrics(uuid) TO authenticated;
