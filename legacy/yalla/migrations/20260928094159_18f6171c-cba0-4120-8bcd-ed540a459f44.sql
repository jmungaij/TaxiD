DO $$ DECLARE d text; BEGIN
  SELECT pg_get_functiondef('public._air_leg_guard()'::regprocedure) INTO d;
  d := replace(d, $x$IF public.air_is_admin() IS NOT TRUE AND coalesce(auth.role(),'') <> 'service_role' THEN$x$,
    $x$IF coalesce(current_setting('yalla.air_booking', true),'') = '1' AND TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
  IF public.air_is_admin() IS NOT TRUE AND coalesce(auth.role(),'') <> 'service_role' THEN$x$);
  EXECUTE d;
  SELECT pg_get_functiondef('public.air_book(uuid,uuid,text,text,date,date,int,jsonb,text)'::regprocedure) INTO d;
  d := replace(d, $x$IF _leg IS NOT NULL THEN UPDATE air_empty_legs$x$,
    $x$IF _leg IS NOT NULL THEN PERFORM set_config('yalla.air_booking','1',true); UPDATE air_empty_legs$x$);
  d := replace(d, $x$WHERE id = _leg; END IF;$x$, $x$WHERE id = _leg; PERFORM set_config('yalla.air_booking','',true); END IF;$x$);
  EXECUTE d;
END $$;