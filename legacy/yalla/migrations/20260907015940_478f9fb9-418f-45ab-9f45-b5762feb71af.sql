CREATE OR REPLACE FUNCTION public.commercial_book_create_opportunity(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account public.crm_accounts;
  v_ref text;
  v_opp uuid;
  v_staff uuid;
  v_title text := nullif(trim(coalesce(p->>'title','')), '');
  v_stage text := coalesce(nullif(trim(coalesce(p->>'stage','')), ''), 'qualified');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT (public.is_platform_admin() OR public.is_commercial_staff()
          OR public.has_staff_permission('staff.crm.manage')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED: commercial staff only';
  END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'TITLE_REQUIRED'; END IF;

  SELECT * INTO v_account FROM public.crm_accounts WHERE id = (p->>'account_id')::uuid;
  IF v_account.id IS NULL THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND'; END IF;
  IF v_stage NOT IN ('new','qualified','proposal','negotiation','won','lost') THEN
    RAISE EXCEPTION 'STAGE_NOT_ALLOWED: %', v_stage;
  END IF;

  SELECT id INTO v_staff FROM public.staff_members WHERE user_id = auth.uid() LIMIT 1;
  v_ref := 'OPP-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(gen_random_uuid()::text),1,6));

  INSERT INTO public.commercial_opportunities (
    opportunity_ref, title, stage, customer_kind, customer_label, corporate_id,
    source, source_ref, expected_value_cents, currency, probability_pct,
    owner_user_id, provenance
  ) VALUES (
    v_ref, v_title, v_stage, 'corporate', coalesce(v_account.legal_name, v_account.name),
    v_account.corporate_id, 'commercial_book', v_account.account_ref,
    nullif(p->>'expected_value_cents','')::bigint,
    coalesce(nullif(p->>'currency',''), 'KES'),
    nullif(p->>'probability_pct','')::int,
    auth.uid(), 'LIVE'
  ) RETURNING id INTO v_opp;

  INSERT INTO public.crm_opportunity_links (opportunity_id, account_id, owner_staff_id, created_by)
  VALUES (v_opp, v_account.id, v_staff, auth.uid())
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('opportunity_id', v_opp, 'opportunity_ref', v_ref, 'stage', v_stage);
END $$;

REVOKE ALL ON FUNCTION public.commercial_book_create_opportunity(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_book_create_opportunity(jsonb) TO authenticated, service_role;