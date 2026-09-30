-- 1. CUSTOMER COMMITMENTS ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_customer_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.commercial_opportunities(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  interaction_id uuid REFERENCES public.crm_interactions(id) ON DELETE SET NULL,
  work_item_id uuid REFERENCES public.staff_work_items(id) ON DELETE SET NULL,
  owner_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  direction text NOT NULL DEFAULT 'yalla_to_customer'
    CHECK (direction IN ('yalla_to_customer','customer_to_yalla')),
  commitment text NOT NULL,
  expected_outcome text,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','in_progress','fulfilled','waived','cancelled')),
  due_at timestamptz,
  fulfilled_at timestamptz,
  evidence_kind text,
  evidence_ref text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_customer_commitments TO authenticated;
GRANT ALL ON public.crm_customer_commitments TO service_role;

ALTER TABLE public.crm_customer_commitments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read commitments" ON public.crm_customer_commitments;
CREATE POLICY "staff read commitments" ON public.crm_customer_commitments
  FOR SELECT TO authenticated USING (is_staff_member() OR is_platform_admin());

DROP POLICY IF EXISTS "commercial staff write commitments" ON public.crm_customer_commitments;
CREATE POLICY "commercial staff write commitments" ON public.crm_customer_commitments
  TO authenticated USING (is_commercial_staff() OR is_platform_admin())
  WITH CHECK (is_commercial_staff() OR is_platform_admin());

DROP TRIGGER IF EXISTS crm_customer_commitments_touch ON public.crm_customer_commitments;
CREATE TRIGGER crm_customer_commitments_touch BEFORE UPDATE
  ON public.crm_customer_commitments FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS crm_customer_commitments_account_idx
  ON public.crm_customer_commitments(account_id, status);

-- 2. JOURNEY VERIFICATION ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_journey_chain(_account_id uuid)
RETURNS TABLE (hop text, status text, entity text, entity_id uuid, detail text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc            crm_accounts;
  v_staff          staff_members;
  v_objective_id   uuid;
  v_kpi_id         uuid;
  v_contact_id     uuid;
  v_opp            commercial_opportunities;
  v_outreach       uuid;
  v_response       uuid;
  v_meeting        uuid;
  v_outcome_id     uuid;
  v_commitment_id  uuid;
  v_master_id      uuid;
  v_version_id     uuid;
  v_share_id       uuid;
  v_next_action    uuid;
  v_work_item      uuid;
  v_txn            commercial_transactions;
  rows             jsonb := '[]'::jsonb;
  r                jsonb;
  furthest         int := 0;
  idx              int := 0;
BEGIN
  SELECT * INTO v_acc FROM crm_accounts WHERE id = _account_id;
  IF v_acc.id IS NULL THEN RETURN; END IF;

  SELECT * INTO v_staff FROM staff_members WHERE id = v_acc.owner_staff_id;
  SELECT o.id INTO v_objective_id FROM org_objectives o WHERE o.staff_id = v_staff.id LIMIT 1;
  SELECT k.id INTO v_kpi_id FROM staff_kpi_actuals k WHERE k.objective_id = v_objective_id LIMIT 1;
  SELECT c.id INTO v_contact_id FROM crm_contacts c WHERE c.account_id = _account_id AND c.is_active LIMIT 1;

  SELECT o.* INTO v_opp FROM commercial_opportunities o
    JOIN crm_opportunity_links l ON l.opportunity_id = o.id
   WHERE l.account_id = _account_id
   ORDER BY o.created_at DESC LIMIT 1;

  SELECT id INTO v_outreach FROM crm_interactions
   WHERE account_id = _account_id AND direction = 'outbound' ORDER BY occurred_at LIMIT 1;
  SELECT id INTO v_response FROM crm_interactions
   WHERE account_id = _account_id AND direction = 'inbound' ORDER BY occurred_at LIMIT 1;
  SELECT id INTO v_meeting FROM crm_interactions
   WHERE account_id = _account_id AND interaction_type = 'meeting' ORDER BY occurred_at DESC LIMIT 1;
  SELECT id INTO v_outcome_id FROM crm_meeting_outcomes WHERE account_id = _account_id LIMIT 1;
  SELECT id INTO v_commitment_id FROM crm_customer_commitments WHERE account_id = _account_id LIMIT 1;

  SELECT d.id INTO v_master_id FROM crm_documents d
   WHERE d.account_id = _account_id AND d.doc_class = 'customer_instance' LIMIT 1;
  SELECT v.id INTO v_version_id FROM crm_document_versions v
    JOIN crm_documents d ON d.id = v.document_id
   WHERE d.account_id = _account_id AND v.approval_state = 'approved'
   ORDER BY v.created_at DESC LIMIT 1;
  SELECT s.id INTO v_share_id FROM crm_document_shares s
    JOIN crm_document_versions v ON v.id = s.version_id
    JOIN crm_documents d ON d.id = v.document_id
   WHERE d.account_id = _account_id ORDER BY s.shared_at DESC LIMIT 1;

  SELECT n.id, n.work_item_id INTO v_next_action, v_work_item FROM crm_next_actions n
   WHERE n.account_id = _account_id AND n.status IN ('open','in_progress')
   ORDER BY n.due_at NULLS LAST LIMIT 1;

  IF v_opp.id IS NOT NULL THEN
    SELECT * INTO v_txn FROM commercial_transactions WHERE opportunity_id = v_opp.id
     ORDER BY created_at DESC LIMIT 1;
  END IF;

  rows := jsonb_build_array(
    jsonb_build_array('01_staff',            'staff_members',        v_staff.id::text,      v_staff.full_name),
    jsonb_build_array('02_objective',        'org_objectives',       v_objective_id::text,  'Owner objective'),
    jsonb_build_array('03_kpi_actual',       'staff_kpi_actuals',    v_kpi_id::text,        'Measured performance'),
    jsonb_build_array('04_account',          'crm_accounts',         v_acc.id::text,        v_acc.name || ' · ' || v_acc.lifecycle_stage),
    jsonb_build_array('05_contact',          'crm_contacts',         v_contact_id::text,    'Customer decision contact'),
    jsonb_build_array('06_opportunity',      'commercial_opportunities', v_opp.id::text,    coalesce(v_opp.title,'') || ' · ' || coalesce(v_opp.stage,'')),
    jsonb_build_array('07_outreach',         'crm_interactions',     v_outreach::text,      'First outbound contact'),
    jsonb_build_array('08_customer_response','crm_interactions',     v_response::text,      'Customer replied'),
    jsonb_build_array('09_meeting',          'crm_interactions',     v_meeting::text,       'Meeting held'),
    jsonb_build_array('10_meeting_outcome',  'crm_meeting_outcomes', v_outcome_id::text,    'Structured discovery capture'),
    jsonb_build_array('11_customer_requirement','crm_customer_commitments', v_commitment_id::text, 'Customer request registered'),
    jsonb_build_array('12_document',         'crm_documents',        v_master_id::text,     'Customer document instance'),
    jsonb_build_array('13_document_version', 'crm_document_versions', v_version_id::text,   'Approved version'),
    jsonb_build_array('14_shared_artifact',  'crm_document_shares',  v_share_id::text,      'Version shared with customer'),
    jsonb_build_array('15_next_action',      'crm_next_actions',     v_next_action::text,   'Open next action'),
    jsonb_build_array('16_work_item',        'staff_work_items',     v_work_item::text,     'Executable work'),
    jsonb_build_array('17_contract_executed','commercial_opportunities',
        CASE WHEN v_opp.stage IN ('accepted','won') THEN v_opp.id::text ELSE NULL END, 'Commercial agreement'),
    jsonb_build_array('18_onboarding',       'corporate_accounts',
        (SELECT id::text FROM corporate_accounts WHERE id = v_acc.corporate_id), 'Corporate account configured'),
    jsonb_build_array('19_first_booking',    'commercial_transactions',
        CASE WHEN v_txn.id IS NOT NULL THEN v_txn.id::text ELSE NULL END, 'First booking'),
    jsonb_build_array('20_transaction',      'commercial_transactions', v_txn.id::text, 'Transaction recorded'),
    jsonb_build_array('21_revenue',          'commercial_transactions',
        CASE WHEN v_txn.id IS NOT NULL THEN v_txn.id::text ELSE NULL END, 'Revenue recognised')
  );

  -- furthest reached stage
  FOR idx IN 0 .. jsonb_array_length(rows) - 1 LOOP
    IF (rows -> idx -> 2) <> 'null'::jsonb AND (rows -> idx ->> 2) IS NOT NULL THEN
      furthest := idx + 1;
    END IF;
  END LOOP;

  idx := 0;
  FOR idx IN 0 .. jsonb_array_length(rows) - 1 LOOP
    r := rows -> idx;
    hop := r ->> 0;
    entity := r ->> 1;
    entity_id := NULLIF(r ->> 2, '')::uuid;
    detail := r ->> 3;
    IF entity_id IS NOT NULL THEN
      status := 'valid';
    ELSIF idx + 1 < furthest THEN
      status := 'missing';
    ELSE
      status := 'not_yet_reached';
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_journey_chain(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.verify_journey_chain(uuid) TO authenticated, service_role;

-- 3. NEXT BEST ACTION --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_next_best_action(_account_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acc crm_accounts;
  v_opp_id uuid;
  v_open_action crm_next_actions;
  v_last_share timestamptz;
  v_reply_after timestamptz;
  v_capture int;
  v_open_commitments int;
BEGIN
  SELECT * INTO v_acc FROM crm_accounts WHERE id = _account_id;
  IF v_acc.id IS NULL THEN RETURN jsonb_build_object('action', null, 'rationale', 'Account not found'); END IF;

  SELECT o.id INTO v_opp_id FROM commercial_opportunities o
    JOIN crm_opportunity_links l ON l.opportunity_id = o.id
   WHERE l.account_id = _account_id ORDER BY o.created_at DESC LIMIT 1;

  SELECT * INTO v_open_action FROM crm_next_actions
   WHERE account_id = _account_id AND status IN ('open','in_progress')
   ORDER BY due_at NULLS LAST LIMIT 1;

  SELECT max(s.shared_at) INTO v_last_share FROM crm_document_shares s
    JOIN crm_document_versions v ON v.id = s.version_id
    JOIN crm_documents d ON d.id = v.document_id
   WHERE d.account_id = _account_id;

  IF v_last_share IS NOT NULL THEN
    SELECT max(occurred_at) INTO v_reply_after FROM crm_interactions
     WHERE account_id = _account_id AND direction = 'inbound' AND occurred_at > v_last_share;
  END IF;

  SELECT coalesce(max(capture_completeness_pct), 0) INTO v_capture
    FROM crm_meeting_outcomes WHERE account_id = _account_id;

  SELECT count(*) INTO v_open_commitments FROM crm_customer_commitments
   WHERE account_id = _account_id AND status IN ('open','in_progress');

  IF v_open_action.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'action', v_open_action.title,
      'kind', 'execute_existing',
      'rationale', 'An owned next action already exists — execute it rather than creating another.',
      'priority', v_open_action.priority,
      'due_at', v_open_action.due_at,
      'next_action_id', v_open_action.id,
      'work_item_id', v_open_action.work_item_id,
      'opportunity_id', v_opp_id,
      'expected_outcome', 'Obtain customer feedback and establish the next commercial step.',
      'open_commitments', v_open_commitments,
      'capture_completeness_pct', v_capture);
  END IF;

  IF v_last_share IS NOT NULL AND v_reply_after IS NULL THEN
    RETURN jsonb_build_object(
      'action', 'Follow up with ' || v_acc.name || ' regarding the Mobility Service Contract and Rate Card',
      'kind', 'follow_up_documents',
      'rationale', 'Commercial documents were shared on ' || to_char(v_last_share, 'DD Mon YYYY')
                   || ' and no customer response has been recorded since.',
      'priority', 'high',
      'due_at', now() + interval '2 days',
      'opportunity_id', v_opp_id,
      'expected_outcome', 'Customer feedback on contract and rate card, and the next commercial step agreed.',
      'open_commitments', v_open_commitments,
      'capture_completeness_pct', v_capture);
  END IF;

  IF v_capture < 50 THEN
    RETURN jsonb_build_object(
      'action', 'Complete discovery capture for ' || v_acc.name,
      'kind', 'capture_discovery',
      'rationale', 'Meeting capture is only ' || v_capture || '% complete — decision process and requirements are not recorded.',
      'priority', 'medium',
      'due_at', now() + interval '3 days',
      'opportunity_id', v_opp_id,
      'expected_outcome', 'Requirements, decision process and commercial position recorded.',
      'open_commitments', v_open_commitments,
      'capture_completeness_pct', v_capture);
  END IF;

  RETURN jsonb_build_object(
    'action', 'Advance the ' || v_acc.name || ' opportunity to the next commercial stage',
    'kind', 'advance_stage',
    'rationale', 'No blocking evidence gap detected in the recorded state.',
    'priority', 'medium',
    'due_at', now() + interval '5 days',
    'opportunity_id', v_opp_id,
    'expected_outcome', 'Opportunity stage progressed with recorded evidence.',
    'open_commitments', v_open_commitments,
    'capture_completeness_pct', v_capture);
END;
$$;

REVOKE ALL ON FUNCTION public.crm_next_best_action(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.crm_next_best_action(uuid) TO authenticated, service_role;

-- 4. RECORD THE ACTUAL DECAGON JOURNEY TO DATE -------------------------------
DO $$
DECLARE
  v_staff uuid;
  v_acc uuid;
  v_opp uuid;
  v_out uuid; v_resp uuid; v_meet uuid;
  v_mc uuid; v_mr uuid;         -- master contract / rate card
  v_dc uuid; v_dr uuid;         -- Decagon instances
  v_vc uuid; v_vr uuid;         -- versions
  v_work uuid;
BEGIN
  SELECT id INTO v_staff FROM staff_members WHERE full_name = 'Charles Gateru' LIMIT 1;
  IF v_staff IS NULL THEN RETURN; END IF;

  SELECT id INTO v_acc FROM crm_accounts WHERE name = 'Decagon Limited';
  IF v_acc IS NULL THEN
    INSERT INTO crm_accounts (account_ref, name, legal_name, industry, country, city,
                              size_band, lifecycle_stage, importance_tier, owner_staff_id,
                              source, notes, provenance)
    VALUES ('ACC-DECAGON-001', 'Decagon Limited', 'Decagon Limited', 'Professional services',
            'KE', 'Nairobi', 'mid', 'opportunity', 'key', v_staff, 'outbound',
            'Responded to corporate outreach; requested Mobility Service Contract and Rate Card.', 'LIVE')
    RETURNING id INTO v_acc;
  END IF;

  SELECT id INTO v_opp FROM commercial_opportunities WHERE opportunity_ref = 'OPP-DECAGON-001';
  IF v_opp IS NULL THEN
    INSERT INTO commercial_opportunities (opportunity_ref, stage, title, customer_kind,
                                          customer_label, source, owner_user_id, provenance)
    VALUES ('OPP-DECAGON-001', 'quoted', 'Decagon Limited — Corporate Mobility Services',
            'corporate', 'Decagon Limited', 'outbound',
            (SELECT user_id FROM staff_members WHERE id = v_staff), 'LIVE')
    RETURNING id INTO v_opp;
  END IF;

  INSERT INTO crm_opportunity_links (opportunity_id, account_id, owner_staff_id)
  SELECT v_opp, v_acc, v_staff
  WHERE NOT EXISTS (SELECT 1 FROM crm_opportunity_links WHERE opportunity_id = v_opp);

  -- interactions (only what actually happened)
  IF NOT EXISTS (SELECT 1 FROM crm_interactions WHERE account_id = v_acc) THEN
    INSERT INTO crm_interactions (account_id, opportunity_id, staff_id, interaction_type,
                                  direction, subject, summary, outcome, occurred_at)
    VALUES (v_acc, v_opp, v_staff, 'email', 'outbound',
            'Corporate mobility outreach',
            'Outbound introduction to Yalla Mobility corporate mobility services.',
            'Delivered', now() - interval '14 days')
    RETURNING id INTO v_out;

    INSERT INTO crm_interactions (account_id, opportunity_id, staff_id, interaction_type,
                                  direction, subject, summary, outcome, sentiment, occurred_at)
    VALUES (v_acc, v_opp, v_staff, 'customer_response', 'inbound',
            'Decagon response — interested, requested a meeting',
            'Decagon responded to the outreach and asked for a meeting.',
            'Meeting agreed', 'positive', now() - interval '10 days')
    RETURNING id INTO v_resp;

    INSERT INTO crm_interactions (account_id, opportunity_id, staff_id, interaction_type,
                                  direction, subject, summary, outcome, sentiment, occurred_at)
    VALUES (v_acc, v_opp, v_staff, 'meeting', 'outbound',
            'Decagon corporate mobility discussion',
            'Productive discussion of Decagon corporate mobility requirements.',
            'Decagon requested the Mobility Service Contract and the Rate Card',
            'positive', now() - interval '7 days')
    RETURNING id INTO v_meet;

    INSERT INTO crm_meeting_outcomes (interaction_id, account_id, opportunity_id,
                                      agreed_next_steps, capture_completeness_pct)
    VALUES (v_meet, v_acc, v_opp,
            'Share the Yalla Mobility Service Contract and Rate Card for commercial review.', 13);
  ELSE
    SELECT id INTO v_meet FROM crm_interactions
     WHERE account_id = v_acc AND interaction_type = 'meeting' LIMIT 1;
  END IF;

  -- master commercial assets (governed, not owned by the sales owner)
  SELECT id INTO v_mc FROM crm_documents WHERE doc_class = 'master' AND doc_type = 'service_contract' LIMIT 1;
  IF v_mc IS NULL THEN
    INSERT INTO crm_documents (doc_class, doc_type, title, description, internal_state, confidentiality, tags)
    VALUES ('master', 'service_contract', 'Yalla Mobility Service Contract (Master)',
            'Canonical corporate mobility service contract template.', 'approved', 'internal',
            ARRAY['corporate','contract'])
    RETURNING id INTO v_mc;
  END IF;
  SELECT id INTO v_mr FROM crm_documents WHERE doc_class = 'master' AND doc_type = 'rate_card' LIMIT 1;
  IF v_mr IS NULL THEN
    INSERT INTO crm_documents (doc_class, doc_type, title, description, internal_state, confidentiality, tags)
    VALUES ('master', 'rate_card', 'Yalla Mobility Corporate Rate Card (Master)',
            'Canonical corporate rate card.', 'approved', 'internal', ARRAY['corporate','pricing'])
    RETURNING id INTO v_mr;
  END IF;

  -- Decagon customer instances + the exact versions that were shared
  SELECT id INTO v_dc FROM crm_documents
   WHERE account_id = v_acc AND doc_type = 'service_contract' AND doc_class = 'customer_instance';
  IF v_dc IS NULL THEN
    INSERT INTO crm_documents (doc_class, doc_type, title, account_id, opportunity_id,
                               parent_document_id, owner_staff_id, internal_state, external_state,
                               confidentiality, tags)
    VALUES ('customer_instance', 'service_contract', 'Decagon Limited — Mobility Service Contract',
            v_acc, v_opp, v_mc, v_staff, 'approved', 'shared', 'confidential',
            ARRAY['decagon','contract'])
    RETURNING id INTO v_dc;

    INSERT INTO crm_document_versions (document_id, version_label, version_seq, file_name,
                                       change_note, authored_staff_id, approval_state, created_at)
    VALUES (v_dc, 'v1.0', 1, 'decagon-mobility-service-contract-v1.0.pdf',
            'Initial contract issued to Decagon Limited.', v_staff, 'approved', now() - interval '5 days')
    RETURNING id INTO v_vc;
    UPDATE crm_documents SET current_version_id = v_vc WHERE id = v_dc;

    INSERT INTO crm_document_shares (version_id, channel, note, shared_at)
    VALUES (v_vc, 'email', 'Shared with Decagon Limited following the requirements meeting.',
            now() - interval '5 days');

    INSERT INTO crm_interactions (account_id, opportunity_id, staff_id, interaction_type,
                                  direction, subject, summary, occurred_at)
    VALUES (v_acc, v_opp, v_staff, 'document_shared', 'outbound',
            'Mobility Service Contract v1.0 shared',
            'Approved contract version v1.0 sent to Decagon Limited.', now() - interval '5 days');
  END IF;

  SELECT id INTO v_dr FROM crm_documents
   WHERE account_id = v_acc AND doc_type = 'rate_card' AND doc_class = 'customer_instance';
  IF v_dr IS NULL THEN
    INSERT INTO crm_documents (doc_class, doc_type, title, account_id, opportunity_id,
                               parent_document_id, owner_staff_id, internal_state, external_state,
                               confidentiality, tags)
    VALUES ('customer_instance', 'rate_card', 'Decagon Limited — Corporate Rate Card',
            v_acc, v_opp, v_mr, v_staff, 'approved', 'shared', 'confidential',
            ARRAY['decagon','pricing'])
    RETURNING id INTO v_dr;

    INSERT INTO crm_document_versions (document_id, version_label, version_seq, file_name,
                                       change_note, authored_staff_id, approval_state, created_at)
    VALUES (v_dr, 'v1.0', 1, 'decagon-corporate-rate-card-v1.0.pdf',
            'Rate card issued to Decagon Limited.', v_staff, 'approved', now() - interval '5 days')
    RETURNING id INTO v_vr;
    UPDATE crm_documents SET current_version_id = v_vr WHERE id = v_dr;

    INSERT INTO crm_document_shares (version_id, channel, note, shared_at)
    VALUES (v_vr, 'email', 'Shared with Decagon Limited following the requirements meeting.',
            now() - interval '5 days');

    INSERT INTO crm_interactions (account_id, opportunity_id, staff_id, interaction_type,
                                  direction, subject, summary, occurred_at)
    VALUES (v_acc, v_opp, v_staff, 'document_shared', 'outbound',
            'Corporate Rate Card v1.0 shared',
            'Approved rate card version v1.0 sent to Decagon Limited.', now() - interval '5 days');
  END IF;

  -- customer commitments
  IF NOT EXISTS (SELECT 1 FROM crm_customer_commitments WHERE account_id = v_acc) THEN
    INSERT INTO crm_customer_commitments (account_id, opportunity_id, interaction_id, owner_staff_id,
      direction, commitment, expected_outcome, status, fulfilled_at, evidence_kind, evidence_ref)
    VALUES
      (v_acc, v_opp, v_meet, v_staff, 'yalla_to_customer',
       'Provide the Yalla Mobility Service Contract', 'Decagon can begin contractual review',
       'fulfilled', now() - interval '5 days', 'document_version', 'Mobility Service Contract v1.0'),
      (v_acc, v_opp, v_meet, v_staff, 'yalla_to_customer',
       'Provide the Yalla Mobility Corporate Rate Card', 'Decagon can evaluate commercial terms',
       'fulfilled', now() - interval '5 days', 'document_version', 'Corporate Rate Card v1.0'),
      (v_acc, v_opp, v_meet, v_staff, 'yalla_to_customer',
       'Respond to Decagon''s questions on the contract and rate card',
       'All customer commercial questions answered', 'open', NULL, NULL, NULL);
  END IF;

  -- executable follow-up work + CRM next action
  SELECT w.id INTO v_work FROM staff_work_items w
   WHERE w.source_table = 'crm_accounts' AND w.source_id = v_acc
     AND w.work_kind = 'sales_opportunity' AND w.staff_id = v_staff;
  IF v_work IS NULL THEN
    INSERT INTO staff_work_items (staff_id, work_kind, title, description, source_table, source_id,
      priority, status, lifecycle_state, ops_queue, entity_type, entity_id, entity_ref,
      required_action, next_action, next_action_due, sla_started_at, sla_minutes, sla_due_at,
      service_line, seed_batch)
    VALUES (v_staff, 'sales_opportunity',
      'Follow up with Decagon Limited on Service Contract and Rate Card',
      'Expected outcome: obtain customer feedback on the contract and rate card and establish the next commercial step. Evidence required: recorded customer response or meeting outcome.',
      'crm_accounts', v_acc, 'high', 'open', 'assigned', 'sales_revenue',
      'crm_account', v_acc, 'ACC-DECAGON-001',
      'Follow up on the shared contract and rate card',
      'Call or email the Decagon commercial contact', (now() + interval '2 days')::date,
      now(), 2880, now() + interval '2 days', 'corporate_mobility', 'charles-decagon-journey-v1')
    RETURNING id INTO v_work;
  END IF;

  INSERT INTO crm_next_actions (account_id, opportunity_id, interaction_id, work_item_id, staff_id,
                                title, due_at, priority, status)
  SELECT v_acc, v_opp, v_meet, v_work, v_staff,
         'Follow up with Decagon Limited on Service Contract and Rate Card',
         now() + interval '2 days', 'high', 'open'
  WHERE NOT EXISTS (
    SELECT 1 FROM crm_next_actions WHERE account_id = v_acc AND status IN ('open','in_progress'));
END $$;