CREATE OR REPLACE FUNCTION public.sync_trip_to_dispatch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_status public.dispatch_status;
BEGIN
  v_status := CASE NEW.status
    WHEN 'pending' THEN 'PENDING' WHEN 'scheduled' THEN 'PENDING'
    WHEN 'accepted' THEN 'ASSIGNED' WHEN 'arrived' THEN 'ASSIGNED' WHEN 'in_progress' THEN 'ASSIGNED'
    WHEN 'completed' THEN 'COMPLETED' WHEN 'cancelled' THEN 'CANCELLED' ELSE 'PENDING' END::public.dispatch_status;

  INSERT INTO public.dispatch_requests(id, rider_id, pickup_lat, pickup_lng, pickup_address, dropoff_lat, dropoff_lng, dropoff_address,
      scheduled_for, status, estimated_fare_cents, assigned_driver_id, assigned_at, completed_at, metadata)
  VALUES (NEW.id, NEW.rider_user_id, coalesce(NEW.pickup_lat,0), coalesce(NEW.pickup_lng,0), NEW.pickup_address, NEW.dropoff_lat, NEW.dropoff_lng, NEW.dropoff_address,
      NEW.scheduled_for, v_status, round(coalesce(NEW.total_fare,0)*100)::bigint, NEW.driver_id,
      CASE WHEN NEW.driver_id IS NOT NULL THEN now() END, NEW.completed_at, jsonb_build_object('trip_booking_id', NEW.id, 'source', 'taxid_booking'))
  ON CONFLICT (id) DO UPDATE SET status = excluded.status, assigned_driver_id = excluded.assigned_driver_id,
      assigned_at = coalesce(public.dispatch_requests.assigned_at, excluded.assigned_at), completed_at = excluded.completed_at, updated_at = now();

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.dispatch_events(request_id, event_type, actor_id, payload) VALUES (NEW.id, 'queued', auth.uid(), jsonb_build_object('status', NEW.status));
  ELSIF NEW.status IS DISTINCT FROM OLD.status OR NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN
    INSERT INTO public.dispatch_events(request_id, event_type, actor_id, payload)
    VALUES (NEW.id, CASE WHEN NEW.driver_id IS DISTINCT FROM OLD.driver_id AND NEW.driver_id IS NOT NULL THEN 'driver_assigned' ELSE 'status_changed' END,
            auth.uid(), jsonb_build_object('from', OLD.status, 'to', NEW.status, 'driver_id', NEW.driver_id));
  END IF;

  IF NEW.driver_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.dispatch_assignments WHERE request_id = NEW.id AND driver_id = NEW.driver_id) THEN
      INSERT INTO public.dispatch_assignments(request_id, driver_id, vehicle_id, accepted_at) VALUES (NEW.id, NEW.driver_id, NEW.vehicle_id, now());
    END IF;
    UPDATE public.dispatch_assignments SET
      arrived_at = CASE WHEN NEW.status = 'arrived' THEN coalesce(arrived_at, now()) ELSE arrived_at END,
      started_at = CASE WHEN NEW.status = 'in_progress' THEN coalesce(started_at, now()) ELSE started_at END,
      completed_at = CASE WHEN NEW.status = 'completed' THEN coalesce(completed_at, now()) ELSE completed_at END,
      cancelled_at = CASE WHEN NEW.status = 'cancelled' THEN coalesce(cancelled_at, now()) ELSE cancelled_at END,
      cancel_reason = CASE WHEN NEW.status = 'cancelled' THEN NEW.cancellation_reason ELSE cancel_reason END
    WHERE request_id = NEW.id AND driver_id = NEW.driver_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_trip_to_dispatch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_trip_to_dispatch ON public.trip_bookings;
CREATE TRIGGER trg_trip_to_dispatch AFTER INSERT OR UPDATE OF status, driver_id ON public.trip_bookings
FOR EACH ROW EXECUTE FUNCTION public.sync_trip_to_dispatch();

-- Backfill existing bookings into the queue
INSERT INTO public.dispatch_requests(id, rider_id, pickup_lat, pickup_lng, pickup_address, dropoff_lat, dropoff_lng, dropoff_address, scheduled_for, status, estimated_fare_cents, assigned_driver_id, metadata)
SELECT b.id, b.rider_user_id, coalesce(b.pickup_lat,0), coalesce(b.pickup_lng,0), b.pickup_address, b.dropoff_lat, b.dropoff_lng, b.dropoff_address, b.scheduled_for,
  (CASE b.status WHEN 'accepted' THEN 'ASSIGNED' WHEN 'arrived' THEN 'ASSIGNED' WHEN 'in_progress' THEN 'ASSIGNED' WHEN 'completed' THEN 'COMPLETED' WHEN 'cancelled' THEN 'CANCELLED' ELSE 'PENDING' END)::public.dispatch_status,
  round(coalesce(b.total_fare,0)*100)::bigint, b.driver_id, jsonb_build_object('trip_booking_id', b.id, 'source', 'backfill')
FROM public.trip_bookings b ON CONFLICT (id) DO NOTHING;