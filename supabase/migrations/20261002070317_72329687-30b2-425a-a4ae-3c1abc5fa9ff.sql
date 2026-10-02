DO $$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef('private.corporate_trip_settle(uuid)'::regprocedure) INTO src;
  src := replace(src, 'SELECT coalesce(p.full_name, e.email) INTO emp FROM corporate_employees e LEFT JOIN profiles p ON p.user_id=e.user_id WHERE e.id=b.corporate_employee_id;',
                      'SELECT coalesce(e.full_name, p.full_name, e.email) INTO emp FROM corporate_employees e LEFT JOIN profiles p ON p.user_id=e.user_id WHERE e.id=b.corporate_employee_id;');
  EXECUTE src;
END $$;