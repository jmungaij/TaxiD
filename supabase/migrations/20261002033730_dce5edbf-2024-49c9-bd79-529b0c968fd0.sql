DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('private.safety_sos_open(uuid,text,numeric,numeric,numeric,text,text,text,text,text)'::regprocedure);
  d := replace(d, '  IF _booking_id IS NOT NULL THEN
    SELECT b.id,', '  SELECT NULL::uuid AS id, NULL::text AS booking_number, NULL::uuid AS rider_user_id, NULL::text AS status, NULL::text AS pickup_address,
         NULL::text AS dropoff_address, NULL::uuid AS driver_id, NULL::uuid AS vehicle_id, NULL::uuid AS d_user, NULL::text AS d_name,
         NULL::text AS d_phone, NULL::text AS plate_number, NULL::text AS v_desc INTO v_b;
  IF _booking_id IS NOT NULL THEN
    SELECT b.id,');
  EXECUTE d;
END $$;