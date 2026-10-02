DO $$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef('private.trip_confirm_booking_ctx(uuid,text,text,uuid,text,text,timestamptz)'::regprocedure) INTO src;
  src := replace(src, $q$(SELECT status FROM corporate_accounts WHERE id=_corporate_id) NOT IN ('active','approved','verified')$q$,
                      $q$coalesce((SELECT status::text FROM corporate_accounts WHERE id=_corporate_id),'') <> 'ACTIVE'$q$);
  EXECUTE src;
END $$;