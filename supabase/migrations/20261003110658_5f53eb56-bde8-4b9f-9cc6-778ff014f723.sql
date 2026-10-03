CREATE OR REPLACE FUNCTION private.corporate_claim_work_account()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE me uuid := auth.uid(); em text; ok boolean; d text; corp uuid; e corporate_employees%ROWTYPE;
BEGIN
  IF me IS NULL THEN RETURN jsonb_build_object('ok',false,'error','AUTH_REQUIRED'); END IF;
  SELECT lower(email), email_confirmed_at IS NOT NULL INTO em, ok FROM auth.users WHERE id=me;
  IF NOT coalesce(ok,false) THEN RETURN jsonb_build_object('ok',false,'error','EMAIL_NOT_CONFIRMED'); END IF;
  d := split_part(em,'@',2);
  SELECT corporate_id INTO corp FROM corporate_work_domains WHERE domain=d;
  IF corp IS NOT NULL THEN
    SELECT * INTO e FROM corporate_employees WHERE corporate_id=corp AND lower(email)=em AND status IN ('invited','active') AND removed_at IS NULL LIMIT 1;
  END IF;
  -- KYB-approved applicants invited by exact confirmed email (any domain, incl. gmail)
  IF e.id IS NULL THEN
    SELECT * INTO e FROM corporate_employees
     WHERE lower(email)=em AND status='invited' AND removed_at IS NULL AND user_id IS NULL
       AND coalesce((metadata->>'first_admin')::boolean,false)
     ORDER BY invited_at DESC NULLS LAST LIMIT 1;
    corp := e.corporate_id;
  END IF;
  IF e.id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error', CASE WHEN corp IS NULL THEN 'NOT_A_WORK_DOMAIN' ELSE 'NOT_ON_STAFF_LIST' END,'message','Ask your company admin to add you to the staff list.');
  END IF;
  IF e.user_id IS NOT NULL AND e.user_id <> me THEN RETURN jsonb_build_object('ok',false,'error','LINKED_TO_ANOTHER_ACCOUNT'); END IF;
  UPDATE corporate_employees SET user_id=me, status='active', activated_at=coalesce(activated_at, now()) WHERE id=e.id;
  INSERT INTO user_roles(user_id, role) VALUES (me, CASE WHEN e.role='corporate_admin' THEN 'corporate_admin' ELSE 'corporate_employee' END::app_role) ON CONFLICT DO NOTHING;
  IF coalesce((e.metadata->>'protected_director')::boolean,false) THEN
    INSERT INTO user_roles(user_id, role) VALUES (me,'director') ON CONFLICT DO NOTHING;
  ELSIF e.metadata->>'title' = 'General Manager' THEN
    INSERT INTO user_roles(user_id, role) VALUES (me,'general_manager') ON CONFLICT DO NOTHING;
  END IF;
  INSERT INTO corporate_policy_audit_log(corporate_id, actor_user_id, action, target_type, target_id, after)
    VALUES (corp, me, 'employee.work_account_linked', 'employee', e.id, jsonb_build_object('email', em));
  RETURN jsonb_build_object('ok',true,'corporate_id',corp,'employee_id',e.id);
END $function$;

-- Auto-claim on email confirmation so invited applicants get access without staff help
CREATE OR REPLACE FUNCTION private.corporate_autoclaim_invite(_uid uuid, _email text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE e corporate_employees%ROWTYPE;
BEGIN
  SELECT * INTO e FROM corporate_employees WHERE lower(email)=lower(_email) AND status='invited'
    AND user_id IS NULL AND removed_at IS NULL AND coalesce((metadata->>'first_admin')::boolean,false)
    ORDER BY invited_at DESC NULLS LAST LIMIT 1;
  IF e.id IS NULL THEN RETURN; END IF;
  UPDATE corporate_employees SET user_id=_uid, status='active', activated_at=now() WHERE id=e.id;
  INSERT INTO user_roles(user_id, role) VALUES (_uid,'corporate_admin') ON CONFLICT DO NOTHING;
  INSERT INTO corporate_policy_audit_log(corporate_id, actor_user_id, action, target_type, target_id, after)
    VALUES (e.corporate_id, _uid, 'employee.invite_auto_claimed', 'employee', e.id, jsonb_build_object('email', lower(_email)));
END $$;
REVOKE ALL ON FUNCTION private.corporate_autoclaim_invite(uuid,text) FROM PUBLIC, anon, authenticated;

-- Charter quotes priced only from taxid_rate_card
CREATE OR REPLACE FUNCTION private.charter_rate_quote(_section text, _vehicle text, _location text, _days int, _qty int, _km numeric DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r taxid_rate_card%ROWTYPE; days int := greatest(coalesce(_days,1),1); qty int := greatest(coalesce(_qty,1),1); sub numeric; extra numeric := 0;
BEGIN
  SELECT * INTO r FROM taxid_rate_card WHERE is_active AND section=_section AND vehicle_group=_vehicle
    AND (_location IS NULL OR coalesce(location,'')=_location) ORDER BY effective_from DESC NULLS LAST LIMIT 1;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','NO_RATE','message','No published rate for this vehicle and location.'); END IF;
  IF r.basis ILIKE '%month%' THEN sub := r.amount_kes * qty * days;  -- days = months
  ELSIF r.basis ILIKE '%self%' OR r.section ILIKE '%daily%' THEN
    IF days < 3 THEN RETURN jsonb_build_object('ok',false,'error','MIN_DAYS','message','Self-drive daily hire needs at least 3 days.'); END IF;
    sub := r.amount_kes * qty * days;
  ELSE sub := r.amount_kes * qty * days; END IF;
  RETURN jsonb_build_object('ok',true,'rate_id',r.id,'section',r.section,'vehicle_group',r.vehicle_group,'location',r.location,
    'basis',r.basis,'unit_kes',r.amount_kes,'km_cap',r.km_cap,'all_inclusive',r.all_inclusive,'days',days,'quantity',qty,
    'subtotal_kes',sub,'total_kes',sub+extra,'currency','KES','source','taxid_rate_card');
END $$;
REVOKE ALL ON FUNCTION private.charter_rate_quote(text,text,text,int,int,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.charter_rate_quote(text,text,text,int,int,numeric) TO service_role;
GRANT EXECUTE ON FUNCTION private.corporate_autoclaim_invite(uuid,text) TO service_role;
GRANT USAGE ON SCHEMA private TO service_role;