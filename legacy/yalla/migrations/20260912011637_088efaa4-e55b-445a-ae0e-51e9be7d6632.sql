DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='contract_manager_dashboard';
  v_def := replace(v_def, 's.employee_code', 's.staff_no');
  EXECUTE v_def;
END $$;