DO $$
DECLARE
  v_staff uuid; v_unit uuid; v_org uuid;
BEGIN
  SELECT id, unit_id INTO v_staff, v_unit FROM staff_members WHERE full_name = 'Charles Gateru' LIMIT 1;
  IF v_staff IS NULL THEN RETURN; END IF;
  SELECT org_id INTO v_org FROM org_objectives WHERE org_id IS NOT NULL LIMIT 1;
  IF v_org IS NULL THEN SELECT id INTO v_org FROM org_entities LIMIT 1; END IF;
  IF v_org IS NULL THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM org_objectives WHERE staff_id = v_staff AND seed_batch = 'charles-decagon-journey-v1') THEN
    RETURN;
  END IF;

  INSERT INTO org_objectives (org_id, level, unit_id, staff_id, owner_staff_id, title, description,
    kpi_label, kpi_unit, target, status, measurement_frequency, data_source, source_type,
    provenance, seed_batch, weight_pct, is_critical)
  VALUES
    (v_org,'employee',v_unit,v_staff,v_staff,'Customer acquisition — progress qualified corporate prospects',
     'Move contacted corporate prospects into qualified, evidenced commercial engagement.',
     'Qualified corporate prospects','count',10,'active','weekly','crm_accounts','authoritative_system',
     'LIVE','charles-decagon-journey-v1',20,true),
    (v_org,'employee',v_unit,v_staff,v_staff,'Decagon conversion — reach a valid commercial agreement',
     'Advance Decagon Limited from commercial evaluation to an executed agreement.',
     'Decagon opportunity at contracted stage','count',1,'active','weekly','commercial_opportunities','authoritative_system',
     'LIVE','charles-decagon-journey-v1',20,true),
    (v_org,'employee',v_unit,v_staff,v_staff,'Customer fulfilment — every customer request owned and fulfilled',
     'Each customer request is captured as a commitment, owned, scheduled and evidenced.',
     'Customer commitments fulfilled','count',3,'active','weekly','crm_customer_commitments','authoritative_system',
     'LIVE','charles-decagon-journey-v1',15,false),
    (v_org,'employee',v_unit,v_staff,v_staff,'Customer activation — operationally usable Yalla account',
     'Convert a signed relationship into a configured corporate account.',
     'Corporate accounts activated','count',1,'active','monthly','corporate_accounts','authoritative_system',
     'LIVE','charles-decagon-journey-v1',15,false),
    (v_org,'employee',v_unit,v_staff,v_staff,'First transaction — first successful customer booking',
     'Facilitate the customer''s first completed Yalla service.',
     'First completed bookings','count',1,'active','monthly','commercial_transactions','authoritative_system',
     'LIVE','charles-decagon-journey-v1',10,false),
    (v_org,'employee',v_unit,v_staff,v_staff,'Revenue — recognised revenue from completed customer activity',
     'Revenue recognised only from actual completed and settled service events. No target amount is set until an approved commercial plan exists.',
     'Revenue events recognised','count',1,'active','monthly','commercial_transactions','not_available',
     'LIVE','charles-decagon-journey-v1',10,false),
    (v_org,'employee',v_unit,v_staff,v_staff,'Relationship development — foundation for recurring business',
     'Establish repeat and expansion potential with converted accounts.',
     'Accounts in expansion or renewal','count',1,'active','quarterly','crm_accounts','authoritative_system',
     'LIVE','charles-decagon-journey-v1',10,false);
END $$;