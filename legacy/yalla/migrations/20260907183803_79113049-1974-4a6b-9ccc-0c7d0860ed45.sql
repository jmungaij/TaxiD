CREATE OR REPLACE FUNCTION public.sales_identity_match(p jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name text := p->>'organisation_name'; v_reg text := nullif(trim(coalesce(p->>'registration_number','')),'');
  v_tax text := nullif(trim(coalesce(p->>'tax_identifier','')),'');
  v_email text := lower(nullif(trim(coalesce(p->>'contact_email','')),''));
  v_phone text := regexp_replace(coalesce(p->>'contact_phone',''),'[^0-9]','','g');
  v_domain text := lower(nullif(split_part(coalesce(p->>'contact_email',''),'@',2),''));
  v_service text := p->>'service_interest';
  v_acc uuid; v_acc_name text; v_owner uuid; v_strategic uuid; v_tier text;
  v_terr text; v_country text; v_city text;
  v_contact uuid; v_contact_name text;
  v_lead uuid; v_lead_ref text; v_lead_stage text;
  v_conf text := 'NONE'; v_basis text;
BEGIN
  IF v_reg IS NOT NULL THEN
    SELECT id INTO v_acc FROM public.crm_accounts WHERE registration_number = v_reg LIMIT 1;
    IF v_acc IS NOT NULL THEN v_conf := 'EXACT'; v_basis := 'registration_number'; END IF;
  END IF;
  IF v_acc IS NULL AND v_tax IS NOT NULL THEN
    SELECT id INTO v_acc FROM public.crm_accounts WHERE tax_identifier = v_tax LIMIT 1;
    IF v_acc IS NOT NULL THEN v_conf := 'EXACT'; v_basis := 'tax_identifier'; END IF;
  END IF;
  IF v_acc IS NULL AND v_domain IS NOT NULL
     AND v_domain NOT IN ('gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com') THEN
    SELECT id INTO v_acc FROM public.crm_accounts
     WHERE lower(coalesce(email_domain,'')) = v_domain
        OR lower(coalesce(website,'')) LIKE '%'||v_domain||'%' LIMIT 1;
    IF v_acc IS NOT NULL THEN v_conf := 'STRONG'; v_basis := 'email_domain'; END IF;
  END IF;
  IF v_acc IS NULL AND public._sales_norm(v_name) IS NOT NULL THEN
    SELECT id INTO v_acc FROM public.crm_accounts
     WHERE public._sales_norm(name) = public._sales_norm(v_name)
        OR public._sales_norm(legal_name) = public._sales_norm(v_name) LIMIT 1;
    IF v_acc IS NOT NULL THEN v_conf := 'STRONG'; v_basis := 'normalised_name'; END IF;
  END IF;
  IF v_acc IS NULL AND length(v_phone) >= 9 THEN
    SELECT id INTO v_acc FROM public.crm_accounts
     WHERE regexp_replace(coalesce(phone,''),'[^0-9]','','g') LIKE '%'||right(v_phone,9) LIMIT 1;
    IF v_acc IS NOT NULL THEN v_conf := 'PROBABLE'; v_basis := 'phone'; END IF;
  END IF;

  IF v_acc IS NOT NULL THEN
    SELECT name, owner_staff_id, strategic_owner_staff_id, importance_tier, territory, country, city
      INTO v_acc_name, v_owner, v_strategic, v_tier, v_terr, v_country, v_city
      FROM public.crm_accounts WHERE id = v_acc;
    SELECT id, full_name INTO v_contact, v_contact_name FROM public.crm_contacts
     WHERE account_id = v_acc
       AND (( v_email IS NOT NULL AND lower(coalesce(email,'')) = v_email)
         OR ( length(v_phone) >= 9 AND regexp_replace(coalesce(phone,''),'[^0-9]','','g') LIKE '%'||right(v_phone,9)))
     LIMIT 1;
    SELECT id, lead_ref, stage INTO v_lead, v_lead_ref, v_lead_stage FROM public.sales_leads
     WHERE account_id = v_acc AND stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')
       AND (v_service IS NULL OR service_interest ILIKE '%'||v_service||'%'
            OR v_service ILIKE '%'||service_interest||'%')
     ORDER BY created_at DESC LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'confidence', v_conf, 'basis', v_basis,
    'account_id', v_acc, 'account_name', v_acc_name, 'owner_staff_id', v_owner,
    'strategic_owner_staff_id', v_strategic, 'tier', v_tier,
    'territory', v_terr, 'country', v_country, 'city', v_city,
    'contact_id', v_contact, 'contact_name', v_contact_name,
    'duplicate_lead_id', v_lead, 'duplicate_lead_ref', v_lead_ref, 'duplicate_lead_stage', v_lead_stage,
    'action', CASE WHEN v_lead IS NOT NULL THEN 'RELATE_TO_EXISTING_LEAD'
                   WHEN v_acc IS NOT NULL THEN 'ATTACH_TO_EXISTING_ACCOUNT'
                   ELSE 'CREATE_NEW_ACCOUNT' END);
END $$;
REVOKE EXECUTE ON FUNCTION public.sales_identity_match(jsonb) FROM PUBLIC, anon;
