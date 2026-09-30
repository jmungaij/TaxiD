-- ------------------------------------------------------------ helpers
CREATE OR REPLACE FUNCTION public._sales_business_days(_from date, _to date)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT GREATEST(count(*),0)::int FROM generate_series(_from, _to - 1, interval '1 day') d
   WHERE EXTRACT(isodow FROM d) < 6;
$$;

CREATE OR REPLACE FUNCTION public.sales_sla_policy_for(_process text, _ctx jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  SELECT p.*,
    (CASE WHEN p.match_service IS NOT NULL THEN 16 ELSE 0 END
   + CASE WHEN p.match_tier IS NOT NULL THEN 8 ELSE 0 END
   + CASE WHEN p.match_territory IS NOT NULL THEN 4 ELSE 0 END
   + CASE WHEN p.match_source IS NOT NULL THEN 2 ELSE 0 END
   + CASE WHEN p.match_priority IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN p.match_position_code IS NOT NULL THEN 1 ELSE 0 END) AS specificity
  INTO r
  FROM public.sales_sla_policies p
  WHERE p.is_active AND p.process = _process
    AND p.effective_from <= current_date
    AND (p.effective_to IS NULL OR p.effective_to >= current_date)
    AND (p.match_service IS NULL OR p.match_service = _ctx->>'service')
    AND (p.match_tier IS NULL OR p.match_tier = _ctx->>'tier')
    AND (p.match_territory IS NULL OR p.match_territory = _ctx->>'territory')
    AND (p.match_source IS NULL OR p.match_source = _ctx->>'source')
    AND (p.match_priority IS NULL OR p.match_priority = _ctx->>'priority')
    AND (p.match_position_code IS NULL OR p.match_position_code = _ctx->>'position_code')
  ORDER BY specificity DESC, p.effective_from DESC, p.created_at DESC
  LIMIT 1;
  IF r.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('policy_id', r.id, 'process', r.process, 'label', r.label,
    'minutes', r.minutes, 'warn_ratio', r.warn_ratio, 'pause_on_customer', r.pause_on_customer);
END $$;

-- one task per event: dedupe on source record + kind + reference
CREATE OR REPLACE FUNCTION public._sales_work_ensure(
  _staff uuid, _kind text, _title text, _description text,
  _source_table text, _source_id uuid, _entity_ref text,
  _priority text, _sla_minutes int)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF _staff IS NULL THEN RETURN NULL; END IF;
  SELECT id INTO v_id FROM public.staff_work_items
   WHERE source_table = _source_table AND source_id = _source_id
     AND work_kind = _kind AND coalesce(entity_ref,'') = coalesce(_entity_ref,'')
     AND title = _title AND status NOT IN ('done','cancelled')
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.staff_work_items
    (staff_id, work_kind, title, description, source_table, source_id, entity_type, entity_id,
     entity_ref, priority, status, lifecycle_state, ops_queue, sla_started_at, sla_minutes,
     sla_due_at, next_action_due)
  VALUES (_staff, _kind, _title, _description, _source_table, _source_id, 'sales_lead', _source_id,
     _entity_ref, coalesce(_priority,'medium'), 'open', 'assigned', 'commercial', now(), _sla_minutes,
     CASE WHEN _sla_minutes IS NOT NULL THEN now() + make_interval(mins => _sla_minutes) END,
     CASE WHEN _sla_minutes IS NOT NULL THEN (now() + make_interval(mins => _sla_minutes))::date END)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public._sales_sla_start(
  _process text, _entity_type text, _entity_id uuid, _entity_ref text,
  _staff uuid, _ctx jsonb DEFAULT '{}'::jsonb, _work_item uuid DEFAULT NULL, _is_test boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pol jsonb; v_id uuid; v_min int;
BEGIN
  v_pol := public.sales_sla_policy_for(_process, _ctx);
  IF v_pol IS NULL THEN RETURN NULL; END IF;
  v_min := (v_pol->>'minutes')::int;
  SELECT id INTO v_id FROM public.sales_sla_clocks
   WHERE process=_process AND entity_type=_entity_type AND entity_id=_entity_id AND completed_at IS NULL;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.sales_sla_clocks
    (process, policy_id, entity_type, entity_id, entity_ref, staff_member_id, work_item_id,
     sla_minutes, started_at, due_at, is_test)
  VALUES (_process, (v_pol->>'policy_id')::uuid, _entity_type, _entity_id, _entity_ref, _staff, _work_item,
     v_min, now(), now() + make_interval(mins => v_min), coalesce(_is_test,false))
  RETURNING id INTO v_id;

  INSERT INTO public.sales_sla_events (clock_id, action, escalation_level, detail, actor_user_id)
  VALUES (v_id, 'SLA_STARTED', 0, jsonb_build_object('process',_process,'minutes',v_min,'entity_ref',_entity_ref), auth.uid());
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public._sales_sla_complete(_process text, _entity_type text, _entity_id uuid, _note text DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n int := 0;
BEGIN
  FOR r IN SELECT * FROM public.sales_sla_clocks
            WHERE entity_type=_entity_type AND entity_id=_entity_id AND completed_at IS NULL
              AND (_process IS NULL OR process = _process)
  LOOP
    UPDATE public.sales_sla_clocks
       SET completed_at = now(),
           breached_at = coalesce(breached_at, CASE WHEN now() > due_at THEN now() END)
     WHERE id = r.id;
    INSERT INTO public.sales_sla_events (clock_id, action, escalation_level, detail, actor_user_id)
    VALUES (r.id, CASE WHEN now() > r.due_at THEN 'SLA_COMPLETED_LATE' ELSE 'SLA_COMPLETED' END,
            r.escalation_level, jsonb_build_object('note',_note,'due_at',r.due_at), auth.uid());
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public._sales_sla_pause(_entity_type text, _entity_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.*, p.pause_on_customer FROM public.sales_sla_clocks c
             LEFT JOIN public.sales_sla_policies p ON p.id = c.policy_id
            WHERE c.entity_type=_entity_type AND c.entity_id=_entity_id
              AND c.completed_at IS NULL AND c.paused_at IS NULL
  LOOP
    UPDATE public.sales_sla_clocks SET paused_at = now() WHERE id = r.id;
    INSERT INTO public.sales_sla_events (clock_id, action, detail, actor_user_id)
    VALUES (r.id,'SLA_PAUSED', jsonb_build_object('reason',_reason), auth.uid());
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public._sales_sla_resume(_entity_type text, _entity_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_add int;
BEGIN
  FOR r IN SELECT * FROM public.sales_sla_clocks
            WHERE entity_type=_entity_type AND entity_id=_entity_id
              AND completed_at IS NULL AND paused_at IS NOT NULL
  LOOP
    v_add := GREATEST((EXTRACT(epoch FROM (now() - r.paused_at))/60)::int, 0);
    UPDATE public.sales_sla_clocks
       SET paused_at = NULL, paused_minutes = paused_minutes + v_add,
           due_at = due_at + make_interval(mins => v_add)
     WHERE id = r.id;
    INSERT INTO public.sales_sla_events (clock_id, action, detail, actor_user_id)
    VALUES (r.id,'SLA_RESUMED', jsonb_build_object('reason',_reason,'paused_minutes',v_add), auth.uid());
  END LOOP;
END $$;

-- ------------------------------------------------------------ escalation sweep
CREATE OR REPLACE FUNCTION public.sales_sla_sweep()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_level int; v_warned int := 0; v_breached int := 0; v_esc int := 0;
        v_mgr uuid; v_wr numeric;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_TO_SWEEP';
  END IF;
  SELECT warn_ratio INTO v_wr FROM public.sales_engine_settings WHERE id;

  FOR r IN SELECT c.*, p.warn_ratio AS pol_warn FROM public.sales_sla_clocks c
             LEFT JOIN public.sales_sla_policies p ON p.id = c.policy_id
            WHERE c.completed_at IS NULL AND c.paused_at IS NULL
  LOOP
    v_level := r.escalation_level;
    IF now() > r.due_at + interval '72 hours' THEN v_level := 4;
    ELSIF now() > r.due_at + interval '24 hours' THEN v_level := 3;
    ELSIF now() > r.due_at THEN v_level := 2;
    ELSIF now() >= r.started_at + make_interval(mins => (r.sla_minutes * coalesce(r.pol_warn, v_wr, 0.8))::int) THEN v_level := 1;
    END IF;

    IF v_level > r.escalation_level THEN
      UPDATE public.sales_sla_clocks
         SET escalation_level = v_level,
             breached_at = CASE WHEN v_level >= 2 THEN coalesce(r.breached_at, now()) ELSE r.breached_at END
       WHERE id = r.id;
      INSERT INTO public.sales_sla_events (clock_id, action, escalation_level, detail)
      VALUES (r.id, CASE WHEN v_level = 1 THEN 'SLA_APPROACHING'
                         WHEN v_level = 2 THEN 'SLA_BREACHED'
                         WHEN v_level = 3 THEN 'ESCALATED_TO_MANAGER'
                         ELSE 'ESCALATED_TO_LEADERSHIP' END,
              v_level, jsonb_build_object('due_at', r.due_at, 'process', r.process, 'entity_ref', r.entity_ref));
      IF v_level = 1 THEN v_warned := v_warned + 1;
      ELSIF v_level = 2 THEN v_breached := v_breached + 1;
      ELSE v_esc := v_esc + 1; END IF;

      IF v_level >= 3 THEN
        SELECT manager_staff_id INTO v_mgr FROM public.staff_members WHERE id = r.staff_member_id;
        IF v_mgr IS NOT NULL THEN
          PERFORM public._sales_work_ensure(v_mgr, 'approval',
            'Escalation: ' || r.process || ' overdue on ' || coalesce(r.entity_ref,'record'),
            'Service level breached and escalated for manager intervention.',
            'sales_sla_clocks', r.id, r.entity_ref, 'high', NULL);
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('approaching', v_warned, 'breached', v_breached, 'escalated', v_esc, 'swept_at', now());
END $$;

-- ------------------------------------------------------------ routing precedence
CREATE OR REPLACE FUNCTION public.sales_route_resolve(_ctx jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account uuid := nullif(_ctx->>'account_id','')::uuid;
  v_service text := _ctx->>'service'; v_country text := _ctx->>'country';
  v_city text := _ctx->>'city'; v_terr text := _ctx->>'territory'; v_tier text := _ctx->>'tier';
  a record; v_id uuid; v_rule uuid;
BEGIN
  IF v_account IS NOT NULL THEN
    SELECT * INTO a FROM public.crm_accounts WHERE id = v_account;
    v_terr := coalesce(v_terr, a.territory); v_city := coalesce(v_city, a.city);
    v_country := coalesce(v_country, a.country); v_tier := coalesce(v_tier, a.importance_tier);
    IF a.strategic_owner_staff_id IS NOT NULL AND coalesce(a.importance_tier,'') IN ('key','strategic') THEN
      RETURN jsonb_build_object('staff_id', a.strategic_owner_staff_id, 'rule_kind','STRATEGIC_OWNER',
        'reason','Strategic account owner retained for account continuity');
    END IF;
    IF a.owner_staff_id IS NOT NULL THEN
      RETURN jsonb_build_object('staff_id', a.owner_staff_id, 'rule_kind','ACCOUNT_OWNER',
        'reason','Existing account owner retained for account continuity');
    END IF;
  END IF;

  SELECT r.staff_member_id, r.id INTO v_id, v_rule
    FROM public.sales_routing_rules r
    JOIN public.staff_members s ON s.id = r.staff_member_id AND s.employment_status IN ('active','onboarding')
   WHERE r.is_active AND r.kind = 'TERRITORY'
     AND r.effective_from <= current_date AND (r.effective_to IS NULL OR r.effective_to >= current_date)
     AND (r.match_country IS NULL OR r.match_country = v_country)
     AND (r.match_city IS NULL OR r.match_city = v_city)
     AND (r.match_territory IS NULL OR r.match_territory = v_terr)
   ORDER BY r.priority, r.created_at LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('staff_id', v_id, 'rule_kind','TERRITORY','rule_id',v_rule,'reason','Territory rule');
  END IF;

  SELECT r.staff_member_id, r.id INTO v_id, v_rule
    FROM public.sales_routing_rules r
    JOIN public.staff_members s ON s.id = r.staff_member_id AND s.employment_status IN ('active','onboarding')
   WHERE r.is_active AND r.kind = 'CAPABILITY'
     AND r.effective_from <= current_date AND (r.effective_to IS NULL OR r.effective_to >= current_date)
     AND (r.match_service IS NULL OR v_service ILIKE '%'||r.match_service||'%')
     AND (r.match_tier IS NULL OR r.match_tier = v_tier)
   ORDER BY r.priority, r.created_at LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('staff_id', v_id, 'rule_kind','CAPABILITY','rule_id',v_rule,'reason','Service capability rule');
  END IF;

  SELECT s.id, r.id INTO v_id, v_rule
    FROM public.sales_routing_rules r
    JOIN public.staff_members s ON s.unit_id = r.unit_id AND s.employment_status IN ('active','onboarding')
   WHERE r.is_active AND r.kind = 'TEAM' AND r.unit_id IS NOT NULL
     AND r.effective_from <= current_date AND (r.effective_to IS NULL OR r.effective_to >= current_date)
   ORDER BY r.priority,
     (SELECT count(*) FROM public.sales_leads l WHERE l.sales_staff_id = s.id
       AND l.stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')), s.created_at
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('staff_id', v_id, 'rule_kind','TEAM','rule_id',v_rule,'reason','Team assignment rule');
  END IF;

  SELECT s.id INTO v_id
    FROM public.staff_members s
    JOIN public.org_positions p ON p.id = s.position_id
   WHERE s.employment_status IN ('active','onboarding')
     AND p.code IN ('SLS-MOB','SLS-SUP','SLS-PRT','SLS-LEAD')
   ORDER BY (SELECT count(*) FROM public.sales_leads l WHERE l.sales_staff_id = s.id
              AND l.stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')), s.created_at
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('staff_id', v_id, 'rule_kind','CAPACITY','reason','Lightest open workload among eligible specialists');
  END IF;

  SELECT s.id INTO v_id FROM public.staff_members s
    LEFT JOIN public.org_units u ON u.id = s.unit_id
   WHERE s.employment_status IN ('active','onboarding') AND coalesce(u.name,'') ILIKE '%sales%'
   ORDER BY s.created_at LIMIT 1;
  RETURN jsonb_build_object('staff_id', v_id, 'rule_kind','FALLBACK','reason','First available sales unit member');
END $$;

CREATE OR REPLACE FUNCTION public._sales_route_owner(_account_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT nullif(public.sales_route_resolve(jsonb_build_object('account_id', _account_id))->>'staff_id','')::uuid;
$$;

CREATE OR REPLACE FUNCTION public.sales_lead_assign(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lead uuid := (p->>'lead_id')::uuid; v_to uuid := (p->>'staff_id')::uuid;
        v_me uuid; v_admin boolean; l record;
BEGIN
  v_me := public._my_staff_member_id();
  v_admin := public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin');
  IF v_me IS NULL THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  SELECT * INTO l FROM public.sales_leads WHERE id = v_lead;
  IF l.id IS NULL THEN RAISE EXCEPTION 'LEAD_NOT_FOUND'; END IF;
  IF coalesce(trim(p->>'reason'),'') = '' THEN RAISE EXCEPTION 'REASSIGNMENT_REASON_REQUIRED'; END IF;
  IF NOT v_admin AND NOT EXISTS (
      SELECT 1 FROM public.staff_members s WHERE s.id IN (l.sales_staff_id, v_to) AND s.manager_staff_id = v_me
  ) THEN RAISE EXCEPTION 'NOT_AUTHORISED_TO_REASSIGN'; END IF;

  UPDATE public.sales_leads SET sales_staff_id = v_to, updated_at = now() WHERE id = v_lead;
  UPDATE public.sales_sla_clocks SET staff_member_id = v_to
   WHERE entity_type='sales_lead' AND entity_id = v_lead AND completed_at IS NULL;
  UPDATE public.staff_work_items SET staff_id = v_to
   WHERE source_table='sales_leads' AND source_id = v_lead AND status NOT IN ('done','cancelled');

  INSERT INTO public.sales_assignment_events (lead_id, account_id, from_staff_id, to_staff_id, rule_kind, reason, actor_user_id)
  VALUES (v_lead, l.account_id, l.sales_staff_id, v_to, 'MANAGER_OVERRIDE', trim(p->>'reason'), auth.uid());
  INSERT INTO public.sales_lead_events (lead_id, action, note, actor_user_id, detail)
  VALUES (v_lead, 'REASSIGNED', trim(p->>'reason'), auth.uid(),
          jsonb_build_object('from', l.sales_staff_id, 'to', v_to));
  RETURN jsonb_build_object('lead_id', v_lead, 'staff_id', v_to);
END $$;

-- ------------------------------------------------------------ identity matching
CREATE OR REPLACE FUNCTION public._sales_norm(_t text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT nullif(regexp_replace(lower(coalesce(_t,'')),
    '\y(limited|ltd|plc|company|co|holdings|group|kenya|k limited|llc|inc)\y|[^a-z0-9]', '', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION public.sales_identity_match(p jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_name text := p->>'organisation_name'; v_reg text := nullif(trim(coalesce(p->>'registration_number','')),'');
  v_tax text := nullif(trim(coalesce(p->>'tax_identifier','')),'');
  v_email text := lower(nullif(trim(coalesce(p->>'contact_email','')),''));
  v_phone text := regexp_replace(coalesce(p->>'contact_phone',''),'[^0-9]','','g');
  v_domain text := lower(nullif(split_part(coalesce(p->>'contact_email',''),'@',2),''));
  v_service text := p->>'service_interest';
  a record; c record; l record; v_conf text := 'NONE'; v_basis text;
BEGIN
  IF v_reg IS NOT NULL THEN
    SELECT * INTO a FROM public.crm_accounts WHERE registration_number = v_reg LIMIT 1;
    IF a.id IS NOT NULL THEN v_conf := 'EXACT'; v_basis := 'registration_number'; END IF;
  END IF;
  IF a.id IS NULL AND v_tax IS NOT NULL THEN
    SELECT * INTO a FROM public.crm_accounts WHERE tax_identifier = v_tax LIMIT 1;
    IF a.id IS NOT NULL THEN v_conf := 'EXACT'; v_basis := 'tax_identifier'; END IF;
  END IF;
  IF a.id IS NULL AND v_domain IS NOT NULL AND v_domain NOT IN ('gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com') THEN
    SELECT * INTO a FROM public.crm_accounts
     WHERE lower(coalesce(email_domain,'')) = v_domain OR lower(coalesce(website,'')) LIKE '%'||v_domain||'%' LIMIT 1;
    IF a.id IS NOT NULL THEN v_conf := 'STRONG'; v_basis := 'email_domain'; END IF;
  END IF;
  IF a.id IS NULL AND public._sales_norm(v_name) IS NOT NULL THEN
    SELECT * INTO a FROM public.crm_accounts
     WHERE public._sales_norm(name) = public._sales_norm(v_name)
        OR public._sales_norm(legal_name) = public._sales_norm(v_name) LIMIT 1;
    IF a.id IS NOT NULL THEN v_conf := 'STRONG'; v_basis := 'normalised_name'; END IF;
  END IF;
  IF a.id IS NULL AND length(v_phone) >= 9 THEN
    SELECT * INTO a FROM public.crm_accounts
     WHERE regexp_replace(coalesce(phone,''),'[^0-9]','','g') LIKE '%'||right(v_phone,9) LIMIT 1;
    IF a.id IS NOT NULL THEN v_conf := 'PROBABLE'; v_basis := 'phone'; END IF;
  END IF;

  IF a.id IS NOT NULL THEN
    SELECT * INTO c FROM public.crm_contacts
     WHERE account_id = a.id
       AND (( v_email IS NOT NULL AND lower(coalesce(email,'')) = v_email)
         OR ( length(v_phone) >= 9 AND regexp_replace(coalesce(phone,''),'[^0-9]','','g') LIKE '%'||right(v_phone,9)))
     LIMIT 1;
    SELECT * INTO l FROM public.sales_leads
     WHERE account_id = a.id AND stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')
       AND (v_service IS NULL OR service_interest ILIKE '%'||v_service||'%'
            OR v_service ILIKE '%'||service_interest||'%')
     ORDER BY created_at DESC LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'confidence', v_conf, 'basis', v_basis,
    'account_id', a.id, 'account_name', a.name, 'owner_staff_id', a.owner_staff_id,
    'strategic_owner_staff_id', a.strategic_owner_staff_id, 'tier', a.importance_tier,
    'territory', a.territory, 'country', a.country, 'city', a.city,
    'contact_id', c.id, 'contact_name', c.full_name,
    'duplicate_lead_id', l.id, 'duplicate_lead_ref', l.lead_ref, 'duplicate_lead_stage', l.stage,
    'action', CASE WHEN l.id IS NOT NULL THEN 'RELATE_TO_EXISTING_LEAD'
                   WHEN a.id IS NOT NULL THEN 'ATTACH_TO_EXISTING_ACCOUNT'
                   ELSE 'CREATE_NEW_ACCOUNT' END);
END $$;

-- ------------------------------------------------------------ lead lifecycle orchestration
CREATE OR REPLACE FUNCTION public._sales_lead_orchestrate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ctx jsonb; v_tier text; v_terr text; v_ref text := NEW.lead_ref; v_wi uuid;
BEGIN
  SELECT importance_tier, territory INTO v_tier, v_terr FROM public.crm_accounts WHERE id = NEW.account_id;
  v_ctx := jsonb_build_object('service', NEW.service_interest, 'source', NEW.source,
                              'tier', v_tier, 'territory', v_terr);

  IF TG_OP = 'INSERT' THEN
    v_wi := public._sales_work_ensure(NEW.sales_staff_id,'sales_opportunity',
      'Respond to ' || NEW.organisation_name || ' enquiry',
      'First meaningful sales response required for ' || NEW.service_interest || '.',
      'sales_leads', NEW.id, v_ref, 'high', NULL);
    PERFORM public._sales_sla_start('LEAD_RESPONSE','sales_lead',NEW.id,v_ref,NEW.sales_staff_id,v_ctx,v_wi,NEW.is_test);
    INSERT INTO public.sales_assignment_events (lead_id, account_id, to_staff_id, rule_kind, reason, actor_user_id, detail)
    VALUES (NEW.id, NEW.account_id, NEW.sales_staff_id, coalesce(NEW.source,'staff_capture'),
            'Lead created and assigned', auth.uid(), jsonb_build_object('lead_ref', v_ref));
    RETURN NEW;
  END IF;

  -- information request lifecycle: pause while the customer owes us a reply
  IF coalesce(OLD.information_request,'') = '' AND coalesce(NEW.information_request,'') <> '' THEN
    PERFORM public._sales_sla_pause('sales_lead', NEW.id, 'Awaiting customer information');
  ELSIF coalesce(OLD.information_request,'') <> '' AND coalesce(NEW.information_request,'') = '' THEN
    PERFORM public._sales_sla_resume('sales_lead', NEW.id, 'Customer responded');
    PERFORM public._sales_sla_start('INFORMATION_REQUEST','sales_lead',NEW.id,v_ref,NEW.sales_staff_id,v_ctx,NULL,NEW.is_test);
    PERFORM public._sales_work_ensure(NEW.sales_staff_id,'sales_opportunity',
      'Follow up customer response — ' || NEW.organisation_name,
      'The customer has replied; resume the commercial conversation.',
      'sales_leads', NEW.id, v_ref, 'high', NULL);
  END IF;

  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    IF NEW.stage = 'QUALIFIED' THEN
      PERFORM public._sales_sla_complete('LEAD_RESPONSE','sales_lead',NEW.id,'Lead qualified');
      PERFORM public._sales_sla_complete('QUALIFICATION','sales_lead',NEW.id,'Lead qualified');
      PERFORM public._sales_work_ensure(NEW.sales_staff_id,'sales_opportunity',
        'Run discovery with ' || NEW.organisation_name, 'Qualified enquiry: establish requirement and prepare a proposal.',
        'sales_leads', NEW.id, v_ref, 'medium', NULL);
    ELSIF NEW.stage = 'OPPORTUNITY' THEN
      PERFORM public._sales_work_ensure(NEW.sales_staff_id,'sales_opportunity',
        'Prepare proposal for ' || NEW.organisation_name, 'Opportunity open: issue a priced proposal.',
        'sales_leads', NEW.id, v_ref, 'medium', NULL);
    ELSIF NEW.stage = 'QUOTED' THEN
      PERFORM public._sales_sla_start('PROPOSAL_FOLLOWUP','sales_lead',NEW.id,v_ref,NEW.sales_staff_id,v_ctx,NULL,NEW.is_test);
      PERFORM public._sales_work_ensure(NEW.sales_staff_id,'sales_opportunity',
        'Follow up proposal — ' || NEW.organisation_name, 'Proposal issued: confirm receipt and progress the decision.',
        'sales_leads', NEW.id, v_ref, 'medium', NULL);
    ELSIF NEW.stage = 'ACCEPTED' THEN
      PERFORM public._sales_sla_complete('PROPOSAL_FOLLOWUP','sales_lead',NEW.id,'Proposal accepted');
      PERFORM public._sales_sla_start('CONTRACT_FOLLOWUP','sales_lead',NEW.id,v_ref,NEW.sales_staff_id,v_ctx,NULL,NEW.is_test);
      PERFORM public._sales_work_ensure(NEW.sales_staff_id,'sales_opportunity',
        'Complete contracting — ' || NEW.organisation_name, 'Proposal accepted: issue and conclude the contract.',
        'sales_leads', NEW.id, v_ref, 'high', NULL);
    ELSIF NEW.stage = 'BOOKED' THEN
      PERFORM public._sales_sla_complete('CONTRACT_FOLLOWUP','sales_lead',NEW.id,'Contract concluded');
      PERFORM public._sales_sla_start('ACCOUNT_ACTIVATION','sales_lead',NEW.id,v_ref,NEW.sales_staff_id,v_ctx,NULL,NEW.is_test);
      PERFORM public._sales_work_ensure(NEW.sales_staff_id,'customer_case',
        'Activate account — ' || NEW.organisation_name, 'Contract concluded: activate the account and hand over to delivery.',
        'sales_leads', NEW.id, v_ref, 'high', NULL);
    ELSIF NEW.stage = 'FULFILLED' THEN
      PERFORM public._sales_sla_complete('ACCOUNT_ACTIVATION','sales_lead',NEW.id,'Account activated');
      PERFORM public._sales_work_ensure(NEW.sales_staff_id,'customer_case',
        'Hand over to customer success — ' || NEW.organisation_name, 'Service running: complete the customer handover.',
        'sales_leads', NEW.id, v_ref, 'medium', NULL);
    ELSIF NEW.stage IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED') THEN
      PERFORM public._sales_sla_complete(NULL,'sales_lead',NEW.id,'Lead closed: ' || NEW.stage);
      UPDATE public.staff_work_items
         SET status = 'done', lifecycle_state = 'closed', closed_at = now(),
             resolution = 'Lead ' || NEW.stage
       WHERE source_table = 'sales_leads' AND source_id = NEW.id AND status NOT IN ('done','cancelled');
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sales_lead_orchestrate ON public.sales_leads;
CREATE TRIGGER trg_sales_lead_orchestrate AFTER INSERT OR UPDATE ON public.sales_leads
  FOR EACH ROW EXECUTE FUNCTION public._sales_lead_orchestrate();

CREATE OR REPLACE FUNCTION public._sales_lead_stamps()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    IF NEW.stage = 'QUALIFIED' AND NEW.qualified_at IS NULL THEN NEW.qualified_at := now(); END IF;
    IF NEW.stage = 'QUOTED' AND NEW.proposal_sent_at IS NULL THEN NEW.proposal_sent_at := now(); END IF;
    IF NEW.stage IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED') AND NEW.closed_at IS NULL THEN NEW.closed_at := now(); END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sales_lead_stamps ON public.sales_leads;
CREATE TRIGGER trg_sales_lead_stamps BEFORE UPDATE ON public.sales_leads
  FOR EACH ROW EXECUTE FUNCTION public._sales_lead_stamps();

-- ------------------------------------------------------------ month-end freeze
CREATE OR REPLACE FUNCTION public.sales_period_close(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_start date := coalesce((p->>'period_start')::date, date_trunc('month', now() - interval '1 month')::date);
        v_end date; v_n int := 0; s record; f jsonb; t numeric;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_TO_CLOSE_PERIOD';
  END IF;
  v_start := date_trunc('month', v_start)::date;
  v_end := (v_start + interval '1 month')::date;

  FOR s IN SELECT sm.id FROM public.staff_members sm
             JOIN public.org_positions op ON op.id = sm.position_id
            WHERE sm.employment_status IN ('active','onboarding')
              AND op.code IN ('SLS-MOB','SLS-SUP','SLS-PRT','SLS-LEAD')
  LOOP
    f := public._sales_person_figures(s.id, v_start::timestamptz, v_end::timestamptz, false);
    t := ((public.sales_target_for(s.id, v_start))->>'target_kes')::numeric;
    INSERT INTO public.sales_period_closures
      (period_start, period_end, staff_member_id, target_kes, revenue_kes, attainment_pct,
       won_count, decided_count, open_pipeline_kes, snapshot, closed_by)
    VALUES (v_start, v_end - 1, s.id, coalesce(t,0), (f->>'revenue_won_kes')::numeric,
       CASE WHEN coalesce(t,0) > 0 THEN round((f->>'revenue_won_kes')::numeric * 100 / t, 2) END,
       (f->>'won_count')::int, (f->>'decided_count')::int, (f->>'open_pipeline_kes')::numeric,
       f || jsonb_build_object('target_kes', coalesce(t,0)), auth.uid())
    ON CONFLICT (period_start, staff_member_id) DO NOTHING;
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('period_start', v_start, 'period_end', v_end - 1, 'people', v_n);
END $$;

CREATE OR REPLACE FUNCTION public.sales_period_adjust(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_TO_ADJUST_PERIOD';
  END IF;
  IF coalesce(trim(p->>'reason'),'') = '' THEN RAISE EXCEPTION 'ADJUSTMENT_REASON_REQUIRED'; END IF;
  INSERT INTO public.sales_period_adjustments (closure_id, amount_kes, reason, authorised_by)
  VALUES ((p->>'closure_id')::uuid, (p->>'amount_kes')::numeric, trim(p->>'reason'), auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('adjustment_id', v_id);
END $$;

-- ------------------------------------------------------------ SLA board reads
CREATE OR REPLACE FUNCTION public.sales_sla_board(_scope text DEFAULT 'mine')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_me uuid; v_ids uuid[]; v_scope text := lower(coalesce(_scope,'mine')); v_rows jsonb;
BEGIN
  v_me := public._my_staff_member_id();
  IF v_me IS NULL THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  IF v_scope = 'team' THEN
    WITH RECURSIVE line AS (
      SELECT id, 1 d FROM public.staff_members WHERE manager_staff_id = v_me
      UNION ALL SELECT c.id, l.d+1 FROM public.staff_members c JOIN line l ON c.manager_staff_id = l.id WHERE l.d < 8)
    SELECT array_agg(DISTINCT id) INTO v_ids FROM (SELECT id FROM line UNION SELECT v_me) x;
  ELSE v_ids := ARRAY[v_me]; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'clock_id', c.id, 'process', c.process, 'entity_type', c.entity_type, 'entity_id', c.entity_id,
      'entity_ref', c.entity_ref, 'staff_id', c.staff_member_id,
      'staff_name', coalesce(sm.preferred_name, sm.full_name),
      'due_at', c.due_at, 'started_at', c.started_at, 'paused', c.paused_at IS NOT NULL,
      'escalation_level', c.escalation_level, 'breached', c.breached_at IS NOT NULL,
      'minutes_remaining', round(EXTRACT(epoch FROM (c.due_at - now()))/60)::int,
      'organisation', l.organisation_name, 'stage', l.stage
    ) ORDER BY c.due_at), '[]'::jsonb) INTO v_rows
  FROM public.sales_sla_clocks c
  LEFT JOIN public.staff_members sm ON sm.id = c.staff_member_id
  LEFT JOIN public.sales_leads l ON l.id = c.entity_id AND c.entity_type = 'sales_lead'
  WHERE c.completed_at IS NULL AND NOT c.is_test AND c.staff_member_id = ANY(v_ids);

  RETURN jsonb_build_object('scope', v_scope, 'clocks', v_rows);
END $$;

REVOKE EXECUTE ON FUNCTION public._sales_append_only() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._sales_touch() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._sales_lead_orchestrate() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._sales_lead_stamps() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._sales_work_ensure(uuid,text,text,text,text,uuid,text,text,int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._sales_sla_start(text,text,uuid,text,uuid,jsonb,uuid,boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._sales_sla_complete(text,text,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._sales_sla_pause(text,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._sales_sla_resume(text,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._sales_norm(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sales_sla_policy_for(text,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sales_route_resolve(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sales_identity_match(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sales_sla_board(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sales_sla_sweep() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sales_period_close(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sales_period_adjust(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sales_lead_assign(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._sales_business_days(date,date) FROM PUBLIC, anon;
