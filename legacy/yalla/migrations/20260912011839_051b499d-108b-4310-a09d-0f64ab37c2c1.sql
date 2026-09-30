DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='contract_control_centre';

  v_def := replace(v_def,
    'FROM public.contract_revenue_events
                                  WHERE created_at >= date_trunc(''day'', now())',
    'FROM public.contract_revenue_events r JOIN public.commercial_contract_instances c ON c.id = r.contract_id
                                  WHERE r.created_at >= date_trunc(''day'', now()) AND NOT c.is_test');
  v_def := replace(v_def,
    'FROM public.contract_revenue_events
                                  WHERE revenue_period = to_char(now(), ''YYYY-MM'')',
    'FROM public.contract_revenue_events r JOIN public.commercial_contract_instances c ON c.id = r.contract_id
                                  WHERE r.revenue_period = to_char(now(), ''YYYY-MM'') AND NOT c.is_test');
  v_def := replace(v_def,
    'FROM public.contract_revenue_events
                         WHERE created_at >= date_trunc(''day'', now())',
    'FROM public.contract_revenue_events r JOIN public.commercial_contract_instances c ON c.id = r.contract_id
                         WHERE r.created_at >= date_trunc(''day'', now()) AND NOT c.is_test');
  v_def := replace(v_def,
    'FROM public.contract_revenue_events)',
    'FROM public.contract_revenue_events r JOIN public.commercial_contract_instances c ON c.id = r.contract_id WHERE NOT c.is_test)');

  EXECUTE v_def;
END $$;