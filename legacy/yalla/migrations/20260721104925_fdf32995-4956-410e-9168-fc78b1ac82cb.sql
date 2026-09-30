
-- Phase D6.4: Canonical unified driver timeline (single source of truth)
CREATE OR REPLACE FUNCTION public.driver_timeline(_driver_id uuid, _limit int DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
  _events jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO _uid FROM public.drivers WHERE id = _driver_id;

  WITH ev AS (
    SELECT created_at AS at, 'wallet'::text AS type,
           (CASE WHEN direction='credit' THEN '+' ELSE '-' END || (amount_cents/100.0)::text || ' KES · ' || kind) AS label,
           reference AS correlation_id, status, 'wallet_transactions'::text AS source, user_id::text AS actor
    FROM public.wallet_transactions
    WHERE _uid IS NOT NULL AND user_id = _uid
    UNION ALL
    SELECT created_at, 'trip', 'Trip · ' || status, id::text, status, 'trip_bookings', driver_id::text
    FROM public.trip_bookings WHERE driver_id = _driver_id
    UNION ALL
    SELECT created_at, 'payout', 'Payout · ' || status, reference, status, 'driver_payouts', driver_id::text
    FROM public.driver_payouts WHERE _uid IS NOT NULL AND driver_id = _uid
    UNION ALL
    SELECT updated_at, 'document', doc_type || ' · ' || status, id::text, status, 'driver_documents', driver_id::text
    FROM public.driver_documents WHERE _uid IS NOT NULL AND driver_id = _uid
    UNION ALL
    SELECT created_at, 'compliance', COALESCE(message,'alert') || ' · ' || severity, id::text, status, 'compliance_alerts', driver_id::text
    FROM public.compliance_alerts WHERE driver_id = _driver_id
    UNION ALL
    SELECT assigned_at, 'vehicle', 'Vehicle assigned', id::text, COALESCE(CASE WHEN ended_at IS NULL THEN 'active' ELSE 'ended' END,'active'), 'driver_vehicle_assignments', driver_id::text
    FROM public.driver_vehicle_assignments WHERE driver_id = _driver_id
    UNION ALL
    SELECT created_at, 'incident', 'Incident · ' || COALESCE(incident_type,''), id::text, COALESCE(status,'open'), 'driver_incidents', driver_id::text
    FROM public.driver_incidents WHERE driver_id = _driver_id
    UNION ALL
    SELECT created_at, 'lifecycle', 'Lifecycle · ' || COALESCE(action,''), id::text, COALESCE(action,''), 'driver_lifecycle_history', driver_id::text
    FROM public.driver_lifecycle_history WHERE driver_id = _driver_id
  )
  SELECT jsonb_agg(row_to_json(x) ORDER BY x.at DESC)
  INTO _events
  FROM (SELECT * FROM ev ORDER BY at DESC NULLS LAST LIMIT GREATEST(_limit, 1)) x;

  RETURN jsonb_build_object(
    'driver_id', _driver_id,
    'generated_at', now(),
    'count', COALESCE(jsonb_array_length(_events), 0),
    'events', COALESCE(_events, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.driver_timeline(uuid, int) FROM public;
GRANT EXECUTE ON FUNCTION public.driver_timeline(uuid, int) TO authenticated;
