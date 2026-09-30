CREATE OR REPLACE FUNCTION public.logistics_dispatch_orchestrate(_limit integer DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  j record;
  v_driver uuid;
  v_out jsonb := '[]'::jsonb;
  v_outcome text;
  v_reason text;
  v_prepay boolean;
BEGIN
  IF coalesce(auth.role(), current_user) <> 'service_role' THEN
    RAISE EXCEPTION 'not_authorised: logistics_dispatch_orchestrate is a worker routine';
  END IF;

  FOR j IN
    SELECT dj.id, dj.order_id, dj.package_id, dj.attempts, dj.required_capacity_kg,
           o.order_number, o.status AS order_status, o.payment_status,
           upper(coalesce(o.metadata->>'payment_method','MPESA')) AS payment_method,
           p.status AS package_status
      FROM delivery_dispatch_jobs dj
      JOIN delivery_orders o ON o.id = dj.order_id
      LEFT JOIN packages p ON p.id = dj.package_id
     WHERE dj.status IN ('queued','awaiting_payment','no_supply')
     ORDER BY dj.priority ASC, dj.created_at ASC
     LIMIT greatest(1, least(coalesce(_limit,25), 200))
     FOR UPDATE OF dj SKIP LOCKED
  LOOP
    v_driver := NULL;
    v_reason := NULL;

    v_prepay := j.payment_method IN ('MPESA','CARD');

    IF j.order_status = 'compliance_review' OR j.package_status = 'compliance_hold' THEN
      v_outcome := 'compliance_hold';
      v_reason := 'Shipment is held for compliance review; dispatch is not authorised.';
    ELSIF v_prepay AND j.payment_status <> 'paid' THEN
      v_outcome := 'awaiting_payment';
      v_reason := format('Prepaid method %s is not settled (payment_status=%s).', j.payment_method, j.payment_status);
    ELSE
      SELECT d.user_id INTO v_driver
        FROM drivers d
       WHERE d.status = 'active'
         AND d.user_id IS NOT NULL
         AND NOT EXISTS (
              SELECT 1 FROM packages p2
               WHERE p2.assigned_driver_id = d.user_id
                 AND p2.status IN ('assigned','picked_up','in_transit')
         )
       ORDER BY coalesce(d.driver_rating, 0) DESC, d.created_at ASC
       LIMIT 1;

      IF v_driver IS NULL THEN
        v_outcome := 'no_supply';
        v_reason := 'No eligible active driver is currently unassigned.';
      ELSE
        v_outcome := 'assigned';
      END IF;
    END IF;

    UPDATE delivery_dispatch_jobs
       SET status = v_outcome,
           assigned_driver_id = CASE WHEN v_outcome = 'assigned' THEN v_driver ELSE assigned_driver_id END,
           attempts = attempts + 1,
           last_attempt_at = now(),
           updated_at = now(),
           metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
             'orchestrator', jsonb_build_object(
               'outcome', v_outcome,
               'reason', v_reason,
               'decided_at', now(),
               'automated', true
             ))
     WHERE id = j.id;

    IF v_outcome = 'assigned' AND j.package_id IS NOT NULL THEN
      UPDATE packages
         SET assigned_driver_id = v_driver,
             status = 'assigned',
             updated_at = now()
       WHERE id = j.package_id
         AND status = 'created';

      INSERT INTO package_events (package_id, event_type, actor_id, notes, metadata)
      VALUES (j.package_id, 'assigned', NULL,
              'Assigned automatically by the dispatch orchestrator',
              jsonb_build_object('job_id', j.id, 'driver_user_id', v_driver,
                                 'order_number', j.order_number, 'automated', true));
    ELSIF v_outcome IN ('awaiting_payment','compliance_hold','no_supply') AND j.package_id IS NOT NULL THEN
      INSERT INTO package_events (package_id, event_type, actor_id, notes, metadata)
      VALUES (j.package_id, 'dispatch_deferred', NULL, v_reason,
              jsonb_build_object('job_id', j.id, 'outcome', v_outcome, 'automated', true));
    END IF;

    v_out := v_out || jsonb_build_object(
      'job_id', j.id, 'order_number', j.order_number,
      'outcome', v_outcome, 'reason', v_reason, 'driver_user_id', v_driver);
  END LOOP;

  RETURN jsonb_build_object('processed', jsonb_array_length(v_out), 'results', v_out, 'ran_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.logistics_dispatch_orchestrate(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.logistics_dispatch_orchestrate(integer) FROM anon;
REVOKE ALL ON FUNCTION public.logistics_dispatch_orchestrate(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.logistics_dispatch_orchestrate(integer) TO service_role;