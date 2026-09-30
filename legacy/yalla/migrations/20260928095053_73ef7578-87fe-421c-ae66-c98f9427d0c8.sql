CREATE OR REPLACE FUNCTION public._air_booking_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.air_is_admin() IS TRUE
     OR has_role(auth.uid(),'admin') IS TRUE OR has_role(auth.uid(),'super_admin') IS TRUE THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.category_slug = 'aircraft-charter' AND coalesce(current_setting('yalla.air_book_insert', true),'') <> '1' THEN
      RAISE EXCEPTION 'Air charter bookings must be made through the booking page';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.category_slug = 'aircraft-charter' THEN
    NEW.status := OLD.status; NEW.flight_status := OLD.flight_status; NEW.flight_events := OLD.flight_events;
    NEW.amount := OLD.amount; NEW.trip := OLD.trip; NEW.category_slug := OLD.category_slug; NEW.asset_name := OLD.asset_name;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._air_booking_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS air_booking_guard ON public.charter_bookings;
CREATE TRIGGER air_booking_guard BEFORE INSERT OR UPDATE ON public.charter_bookings FOR EACH ROW EXECUTE FUNCTION public._air_booking_guard();

DO $$ DECLARE d text; BEGIN
  SELECT pg_get_functiondef('public.air_book(uuid,uuid,text,text,date,date,int,jsonb,text)'::regprocedure) INTO d;
  d := replace(d, $x$ref := 'CH-'$x$, $x$PERFORM set_config('yalla.air_book_insert','1',true);
  ref := 'CH-'$x$);
  d := replace(d, $x$RETURNING id INTO bid;$x$, $x$RETURNING id INTO bid;
  PERFORM set_config('yalla.air_book_insert','',true);$x$);
  EXECUTE d;
END $$;