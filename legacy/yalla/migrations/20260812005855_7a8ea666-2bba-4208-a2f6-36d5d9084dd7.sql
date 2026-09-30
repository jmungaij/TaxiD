-- ============ Phase 2: CRM foundation ============

CREATE TABLE public.crm_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_ref text NOT NULL UNIQUE DEFAULT ('ACC-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  name text NOT NULL,
  legal_name text,
  industry text,
  country text NOT NULL DEFAULT 'KE',
  city text,
  size_band text NOT NULL DEFAULT 'unknown'
    CHECK (size_band IN ('unknown','micro','small','mid','large','enterprise')),
  lifecycle_stage text NOT NULL DEFAULT 'prospect'
    CHECK (lifecycle_stage IN ('prospect','engaged','qualified','opportunity','negotiation','won','onboarding','active','expansion','renewal','lost')),
  importance_tier text NOT NULL DEFAULT 'standard'
    CHECK (importance_tier IN ('standard','key','strategic')),
  owner_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  corporate_id uuid REFERENCES public.corporate_accounts(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'outbound',
  website text,
  notes text,
  provenance text NOT NULL DEFAULT 'declared',
  seed_batch text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_accounts TO authenticated;
GRANT ALL ON public.crm_accounts TO service_role;
ALTER TABLE public.crm_accounts ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_crm_accounts_owner ON public.crm_accounts(owner_staff_id);
CREATE INDEX idx_crm_accounts_stage ON public.crm_accounts(lifecycle_stage);

CREATE POLICY "staff read accounts" ON public.crm_accounts
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "commercial insert accounts" ON public.crm_accounts
  FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff() OR public.is_platform_admin());
CREATE POLICY "commercial update accounts" ON public.crm_accounts
  FOR UPDATE TO authenticated
  USING (
    public.is_platform_admin()
    OR public.is_commercial_staff()
    OR (owner_staff_id IS NOT NULL AND (public.is_my_staff_record(owner_staff_id) OR public.manages_staff_record(owner_staff_id)))
  );
CREATE POLICY "admin delete accounts" ON public.crm_accounts
  FOR DELETE TO authenticated USING (public.is_platform_admin());

CREATE TABLE public.crm_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  contact_role text NOT NULL DEFAULT 'primary'
    CHECK (contact_role IN ('primary','decision_maker','procurement','finance','operations','exec_sponsor','other')),
  job_title text,
  email text,
  phone text,
  influence_level text NOT NULL DEFAULT 'medium'
    CHECK (influence_level IN ('low','medium','high')),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  seed_batch text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_contacts TO authenticated;
GRANT ALL ON public.crm_contacts TO service_role;
ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_crm_contacts_account ON public.crm_contacts(account_id);

CREATE POLICY "staff read contacts" ON public.crm_contacts
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "commercial write contacts" ON public.crm_contacts
  FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff() OR public.is_platform_admin());
CREATE POLICY "commercial update contacts" ON public.crm_contacts
  FOR UPDATE TO authenticated
  USING (public.is_commercial_staff() OR public.is_platform_admin());
CREATE POLICY "admin delete contacts" ON public.crm_contacts
  FOR DELETE TO authenticated USING (public.is_platform_admin());

CREATE TABLE public.crm_opportunity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL UNIQUE REFERENCES public.commercial_opportunities(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  primary_contact_id uuid REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  owner_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_opportunity_links TO authenticated;
GRANT ALL ON public.crm_opportunity_links TO service_role;
ALTER TABLE public.crm_opportunity_links ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_crm_opp_links_account ON public.crm_opportunity_links(account_id);

CREATE POLICY "staff read opp links" ON public.crm_opportunity_links
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "commercial insert opp links" ON public.crm_opportunity_links
  FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff() OR public.is_platform_admin());
CREATE POLICY "commercial update opp links" ON public.crm_opportunity_links
  FOR UPDATE TO authenticated
  USING (public.is_commercial_staff() OR public.is_platform_admin());
CREATE POLICY "admin delete opp links" ON public.crm_opportunity_links
  FOR DELETE TO authenticated USING (public.is_platform_admin());

CREATE TABLE public.crm_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  opportunity_id uuid REFERENCES public.commercial_opportunities(id) ON DELETE SET NULL,
  work_item_id uuid REFERENCES public.staff_work_items(id) ON DELETE SET NULL,
  staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  interaction_type text NOT NULL
    CHECK (interaction_type IN ('email','call','meeting','document_shared','proposal','customer_response','note','visit')),
  direction text NOT NULL DEFAULT 'outbound' CHECK (direction IN ('inbound','outbound','internal')),
  subject text NOT NULL,
  summary text,
  outcome text,
  sentiment text CHECK (sentiment IS NULL OR sentiment IN ('positive','neutral','negative')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  provenance text NOT NULL DEFAULT 'declared',
  seed_batch text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_interactions TO authenticated;
GRANT ALL ON public.crm_interactions TO service_role;
ALTER TABLE public.crm_interactions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_crm_interactions_account_time ON public.crm_interactions(account_id, occurred_at DESC);
CREATE INDEX idx_crm_interactions_opportunity ON public.crm_interactions(opportunity_id);

CREATE POLICY "staff read interactions" ON public.crm_interactions
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "commercial insert interactions" ON public.crm_interactions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff() OR public.is_platform_admin());
CREATE POLICY "commercial update interactions" ON public.crm_interactions
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin()
         OR (staff_id IS NOT NULL AND (public.is_my_staff_record(staff_id) OR public.manages_staff_record(staff_id))));
CREATE POLICY "admin delete interactions" ON public.crm_interactions
  FOR DELETE TO authenticated USING (public.is_platform_admin());

CREATE TABLE public.crm_meeting_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  interaction_id uuid NOT NULL UNIQUE REFERENCES public.crm_interactions(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.commercial_opportunities(id) ON DELETE SET NULL,
  needs text,
  commercial_position text,
  operational_requirements text,
  decision_process text,
  decision_timeline text,
  competition text,
  risks text,
  agreed_next_steps text,
  capture_completeness_pct integer NOT NULL DEFAULT 0
    CHECK (capture_completeness_pct BETWEEN 0 AND 100),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_meeting_outcomes TO authenticated;
GRANT ALL ON public.crm_meeting_outcomes TO service_role;
ALTER TABLE public.crm_meeting_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read meeting outcomes" ON public.crm_meeting_outcomes
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "commercial insert meeting outcomes" ON public.crm_meeting_outcomes
  FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff() OR public.is_platform_admin());
CREATE POLICY "commercial update meeting outcomes" ON public.crm_meeting_outcomes
  FOR UPDATE TO authenticated
  USING (public.is_commercial_staff() OR public.is_platform_admin());
CREATE POLICY "admin delete meeting outcomes" ON public.crm_meeting_outcomes
  FOR DELETE TO authenticated USING (public.is_platform_admin());

CREATE TABLE public.crm_next_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.commercial_opportunities(id) ON DELETE SET NULL,
  interaction_id uuid REFERENCES public.crm_interactions(id) ON DELETE SET NULL,
  work_item_id uuid NOT NULL REFERENCES public.staff_work_items(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  title text NOT NULL,
  due_at timestamptz,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','cancelled')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_next_actions TO authenticated;
GRANT ALL ON public.crm_next_actions TO service_role;
ALTER TABLE public.crm_next_actions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_crm_next_actions_account ON public.crm_next_actions(account_id);
CREATE INDEX idx_crm_next_actions_work ON public.crm_next_actions(work_item_id);

CREATE POLICY "staff read next actions" ON public.crm_next_actions
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "commercial insert next actions" ON public.crm_next_actions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_commercial_staff() OR public.is_platform_admin());
CREATE POLICY "commercial update next actions" ON public.crm_next_actions
  FOR UPDATE TO authenticated
  USING (public.is_platform_admin()
         OR public.is_commercial_staff()
         OR (staff_id IS NOT NULL AND (public.is_my_staff_record(staff_id) OR public.manages_staff_record(staff_id))));
CREATE POLICY "admin delete next actions" ON public.crm_next_actions
  FOR DELETE TO authenticated USING (public.is_platform_admin());

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.crm_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_crm_accounts_touch BEFORE UPDATE ON public.crm_accounts
  FOR EACH ROW EXECUTE FUNCTION public.crm_touch_updated_at();
CREATE TRIGGER trg_crm_contacts_touch BEFORE UPDATE ON public.crm_contacts
  FOR EACH ROW EXECUTE FUNCTION public.crm_touch_updated_at();
CREATE TRIGGER trg_crm_opp_links_touch BEFORE UPDATE ON public.crm_opportunity_links
  FOR EACH ROW EXECUTE FUNCTION public.crm_touch_updated_at();
CREATE TRIGGER trg_crm_interactions_touch BEFORE UPDATE ON public.crm_interactions
  FOR EACH ROW EXECUTE FUNCTION public.crm_touch_updated_at();
CREATE TRIGGER trg_crm_meeting_outcomes_touch BEFORE UPDATE ON public.crm_meeting_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.crm_touch_updated_at();
CREATE TRIGGER trg_crm_next_actions_touch BEFORE UPDATE ON public.crm_next_actions
  FOR EACH ROW EXECUTE FUNCTION public.crm_touch_updated_at();

-- ============ RPCs ============

CREATE OR REPLACE FUNCTION public.crm_set_opportunity_stage(
  _opportunity_id uuid,
  _stage text,
  _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old text;
  v_account uuid;
  v_uid text := gen_random_uuid()::text;
BEGIN
  IF NOT (public.is_commercial_staff() OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'not authorised to change opportunity stage';
  END IF;

  SELECT stage INTO v_old FROM public.commercial_opportunities WHERE id = _opportunity_id;
  IF v_old IS NULL THEN RAISE EXCEPTION 'opportunity not found'; END IF;

  UPDATE public.commercial_opportunities
     SET stage = _stage, updated_at = now()
   WHERE id = _opportunity_id;

  SELECT account_id INTO v_account FROM public.crm_opportunity_links WHERE opportunity_id = _opportunity_id;

  IF v_account IS NOT NULL THEN
    UPDATE public.crm_accounts
       SET lifecycle_stage = CASE
             WHEN _stage IN ('won','closed_won') THEN 'won'
             WHEN _stage IN ('lost','closed_lost') THEN 'lost'
             WHEN _stage = 'negotiation' THEN 'negotiation'
             WHEN _stage IN ('qualified','qualification') THEN 'qualified'
             ELSE lifecycle_stage END,
           updated_at = now()
     WHERE id = v_account;
  END IF;

  INSERT INTO public.ops_event_outbox (
    event_uid, event_type, source_portal, service_line,
    entity_type, entity_id, entity_ref, dedupe_key, payload
  ) VALUES (
    v_uid,
    'commercial.opportunity.stage_changed',
    'staff_portal',
    'commercial',
    'commercial_opportunity',
    _opportunity_id,
    _opportunity_id::text,
    'opp_stage:' || _opportunity_id::text || ':' || _stage || ':' || v_uid,
    jsonb_build_object(
      'opportunity_id', _opportunity_id,
      'from_stage', v_old,
      'to_stage', _stage,
      'reason', _reason,
      'account_id', v_account,
      'actor', auth.uid()
    )
  );

  RETURN jsonb_build_object('ok', true, 'from_stage', v_old, 'to_stage', _stage, 'account_id', v_account);
END; $$;

REVOKE ALL ON FUNCTION public.crm_set_opportunity_stage(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_set_opportunity_stage(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_create_next_action(
  _account_id uuid,
  _staff_id uuid,
  _title text,
  _due_at timestamptz DEFAULT NULL,
  _priority text DEFAULT 'medium',
  _opportunity_id uuid DEFAULT NULL,
  _interaction_id uuid DEFAULT NULL,
  _sla_minutes integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_work_id uuid;
  v_action_id uuid;
  v_unit uuid;
  v_account_name text;
BEGIN
  IF NOT (public.is_commercial_staff() OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'not authorised to create commercial next actions';
  END IF;

  SELECT name INTO v_account_name FROM public.crm_accounts WHERE id = _account_id;
  IF v_account_name IS NULL THEN RAISE EXCEPTION 'account not found'; END IF;

  SELECT unit_id INTO v_unit FROM public.staff_members WHERE id = _staff_id;

  INSERT INTO public.staff_work_items (
    staff_id, unit_id, work_kind, title, description, priority, status,
    lifecycle_state, next_action, next_action_due, required_action,
    sla_minutes, sla_started_at, service_line,
    source_table, source_id, entity_type, entity_id, entity_ref
  ) VALUES (
    _staff_id, v_unit, 'commercial_task', _title,
    'CRM next action for account ' || v_account_name,
    _priority, 'open', 'new', _title, _due_at, _title,
    _sla_minutes, CASE WHEN _sla_minutes IS NOT NULL THEN now() END, 'commercial',
    'crm_next_actions', _account_id::text, 'crm_account', _account_id, v_account_name
  ) RETURNING id INTO v_work_id;

  INSERT INTO public.crm_next_actions (
    account_id, opportunity_id, interaction_id, work_item_id, staff_id,
    title, due_at, priority, status, created_by
  ) VALUES (
    _account_id, _opportunity_id, _interaction_id, v_work_id, _staff_id,
    _title, _due_at, _priority, 'open', auth.uid()
  ) RETURNING id INTO v_action_id;

  RETURN jsonb_build_object('ok', true, 'next_action_id', v_action_id, 'work_item_id', v_work_id);
END; $$;

REVOKE ALL ON FUNCTION public.crm_create_next_action(uuid, uuid, text, timestamptz, text, uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crm_create_next_action(uuid, uuid, text, timestamptz, text, uuid, uuid, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.verify_blueprint_chain(_staff_id uuid)
RETURNS TABLE (hop text, entity text, entity_id uuid, detail text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.is_staff_portal_member(auth.uid()) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'not authorised';
  END IF;

  RETURN QUERY
  SELECT '1_staff'::text, 'staff_members'::text, s.id, s.full_name
  FROM public.staff_members s WHERE s.id = _staff_id;

  RETURN QUERY
  SELECT '2_objective'::text, 'org_objectives'::text, o.id, o.title
  FROM public.org_objectives o WHERE o.staff_id = _staff_id ORDER BY o.created_at LIMIT 5;

  RETURN QUERY
  SELECT '3_kpi_actual'::text, 'staff_kpi_actuals'::text, a.id, (o.kpi_label || ' = ' || a.value::text)
  FROM public.staff_kpi_actuals a
  JOIN public.org_objectives o ON o.id = a.objective_id
  WHERE o.staff_id = _staff_id
  ORDER BY a.created_at LIMIT 5;

  RETURN QUERY
  SELECT '4_work_item'::text, 'staff_work_items'::text, w.id, w.title
  FROM public.staff_work_items w WHERE w.staff_id = _staff_id ORDER BY w.created_at DESC LIMIT 5;

  RETURN QUERY
  SELECT '5_next_action'::text, 'crm_next_actions'::text, n.id, n.title
  FROM public.crm_next_actions n WHERE n.staff_id = _staff_id ORDER BY n.created_at DESC LIMIT 5;

  RETURN QUERY
  SELECT '6_opportunity'::text, 'commercial_opportunities'::text, op.id, op.title
  FROM public.commercial_opportunities op
  WHERE op.id IN (SELECT opportunity_id FROM public.crm_next_actions WHERE staff_id = _staff_id AND opportunity_id IS NOT NULL)
  LIMIT 5;

  RETURN QUERY
  SELECT '7_account'::text, 'crm_accounts'::text, ac.id, ac.name
  FROM public.crm_accounts ac
  WHERE ac.id IN (SELECT account_id FROM public.crm_next_actions WHERE staff_id = _staff_id)
  LIMIT 5;

  RETURN QUERY
  SELECT '8_transaction'::text, 'commercial_transactions'::text, t.id, t.transaction_ref
  FROM public.commercial_transactions t
  WHERE t.opportunity_id IN (
    SELECT opportunity_id FROM public.crm_next_actions WHERE staff_id = _staff_id AND opportunity_id IS NOT NULL
  )
  LIMIT 5;
END; $$;

REVOKE ALL ON FUNCTION public.verify_blueprint_chain(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_blueprint_chain(uuid) TO authenticated;