DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='contract_manager_dashboard';
  v_def := replace(v_def,
    '''sent_to_customer'',''customer_review'',''signature_pending'',''partially_signed''',
    '''sent_to_customer'',''shared'',''customer_review'',''signature_pending'',''partially_signed''');
  EXECUTE v_def;

  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='contract_control_centre';
  IF v_def IS NOT NULL AND position('is_test' in v_def) = 0 THEN
    v_def := replace(v_def, 'FROM public.commercial_contract_instances c',
                            'FROM public.commercial_contract_instances c WHERE NOT c.is_test');
    v_def := replace(v_def, 'FROM public.commercial_contract_instances',
                            'FROM public.commercial_contract_instances');
    EXECUTE v_def;
  END IF;
END $$;