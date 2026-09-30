DO $$ DECLARE d text; BEGIN
  SELECT pg_get_functiondef('public.air_book(uuid,uuid,text,text,date,date,int,jsonb,text)'::regprocedure) INTO d;
  d := replace(d, $x$'mpesa', 'pending', 'pending_payment')$x$, $x$'mpesa', 'pending', 'pending')$x$);
  d := replace(d, $x$payment_method,payment_status,status)$x$, $x$payment_method,payment_status,status,flight_status)$x$);
  d := replace(d, $x$'pending', 'pending')$x$, $x$'pending', 'pending', 'requested')$x$);
  EXECUTE d;
END $$;