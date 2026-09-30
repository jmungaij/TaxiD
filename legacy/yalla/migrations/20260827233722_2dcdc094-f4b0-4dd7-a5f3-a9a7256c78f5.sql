-- 1. Jurisdiction + regulators ------------------------------
INSERT INTO public.legal_jurisdictions (code, name, country_code, status)
VALUES ('KE','Kenya','KE','active')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.legal_regulators (code, name, jurisdiction_id, domain, website, status)
SELECT v.code, v.name, j.id, v.domain, v.website, 'active'::public.legal_status
FROM (VALUES
  ('CA_KE','Communications Authority of Kenya','postal_courier','https://ca.go.ke'),
  ('KRA','Kenya Revenue Authority','tax','https://kra.go.ke'),
  ('ODPC','Office of the Data Protection Commissioner','data_protection','https://odpc.go.ke'),
  ('NTSA','National Transport and Safety Authority','transport','https://ntsa.go.ke')
) AS v(code,name,domain,website)
CROSS JOIN public.legal_jurisdictions j
WHERE j.code = 'KE'
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.legal_frameworks (code, title, jurisdiction_id, regulator_id, legal_source, source_url, summary, status)
SELECT v.code, v.title, j.id, r.id, v.legal_source, v.url, v.summary, 'review_required'::public.legal_status
FROM (VALUES
  ('FW_KE_POSTAL_COURIER','Postal and courier licensing framework','CA_KE','Kenya Information and Communications Act and CA licensing framework','https://ca.go.ke','Licensing of postal and courier operators in Kenya. Applicability to the Yalla operating model requires legal determination.'),
  ('FW_KE_TAX_ETIMS','Electronic tax invoicing (eTIMS)','KRA','Tax Procedures Act and eTIMS regulations','https://kra.go.ke','Requirement for persons in business to issue electronic tax invoices, subject to applicable exceptions.'),
  ('FW_KE_DATA_PROTECTION','Data Protection Act 2019 framework','ODPC','Data Protection Act 2019 and subsidiary regulations','https://odpc.go.ke','Controller/processor registration, lawful basis, data subject rights, retention, transfers and breach notification.'),
  ('FW_KE_ROAD_TRANSPORT','Road transport and vehicle compliance','NTSA','National Transport and Safety Authority Act and road traffic rules','https://ntsa.go.ke','Vehicle registration, inspection, commercial-use authorisation and insurance requirements.')
) AS v(code,title,reg,legal_source,url,summary)
JOIN public.legal_regulators r ON r.code = v.reg
CROSS JOIN public.legal_jurisdictions j
WHERE j.code = 'KE'
ON CONFLICT (code) DO NOTHING;

-- 2. Structured requirements --------------------------------
INSERT INTO public.legal_requirements (
  code, title, description, jurisdiction_id, regulator_id, framework_id, legal_source,
  requirement_type, applies_to, service_families, partner_types, asset_types, geographies,
  mandatory, verification_method, evidence_type, approval_authority, renewal_period_days,
  failure_action, blocking_stages, owner_role, status
)
SELECT
  v.code, v.title, v.description, j.id, r.id, f.id, fw_src.legal_source,
  v.requirement_type, v.applies_to, v.service_families, v.partner_types, v.asset_types, ARRAY['KE'],
  v.mandatory, v.verification_method, v.evidence_type, v.approval_authority, v.renewal_days,
  v.failure_action::public.legal_failure_action, v.blocking_stages::public.legal_gate_stage[], v.owner_role,
  'review_required'::public.legal_status
FROM (VALUES
  ('REQ_KE_CA_COURIER_LICENCE','Courier / postal operator licence','Operating a postal or courier business in Kenya requires the applicable Communications Authority licence. Whether Yalla is itself the licensed operator or operates through licensed carriers must be legally determined before activation.','CA_KE','FW_KE_POSTAL_COURIER','licence','platform',ARRAY['parcel','express','courier','freight'],ARRAY['courier','logistics_carrier','fleet_operator'],ARRAY[]::text[],true,'Licence document plus regulator register check','licence_certificate','Communications Authority of Kenya',365,'block_dispatch',ARRAY['activation','dispatch'],'compliance_admin'),
  ('REQ_KE_PARTNER_COURIER_LICENCE','Partner courier operating licence','Each courier or carrier partner performing regulated courier activity must hold and evidence its own applicable operating licence.','CA_KE','FW_KE_POSTAL_COURIER','licence','partner',ARRAY['parcel','express','courier','freight'],ARRAY['courier','logistics_carrier','fleet_operator'],ARRAY[]::text[],true,'Partner licence document and expiry verification','licence_certificate','Communications Authority of Kenya',365,'block_dispatch',ARRAY['activation','dispatch'],'compliance_admin'),
  ('REQ_KE_VEHICLE_REGISTRATION','Vehicle registration and inspection','Assets used for commercial carriage must evidence valid registration and, where applicable, inspection.','NTSA','FW_KE_ROAD_TRANSPORT','certification','asset',ARRAY['parcel','express','courier','freight','rides','charter','rental'],ARRAY['fleet_operator','logistics_carrier','rental_partner'],ARRAY['motorcycle','van','truck','car'],true,'Registration and inspection certificate verification','inspection_certificate','National Transport and Safety Authority',365,'block_dispatch',ARRAY['dispatch'],'operations_admin'),
  ('REQ_KE_MOTOR_INSURANCE','Motor insurance for commercial use','Vehicles used commercially must carry valid motor insurance appropriate to their use.','NTSA','FW_KE_ROAD_TRANSPORT','insurance','asset',ARRAY['parcel','express','courier','freight','rides','charter','rental'],ARRAY['fleet_operator','logistics_carrier','rental_partner','driver'],ARRAY['motorcycle','van','truck','car'],true,'Insurance certificate and cover period verification','insurance_certificate','Insurer',365,'block_dispatch',ARRAY['dispatch'],'operations_admin'),
  ('REQ_KE_GOODS_CONTROLS','Restricted and prohibited goods controls','Goods offered for carriage must be classified and cleared against the goods rules before booking is accepted.','CA_KE','FW_KE_POSTAL_COURIER','policy','service',ARRAY['parcel','express','courier','freight'],ARRAY[]::text[],ARRAY[]::text[],true,'Goods declaration evaluated against the goods rule register','goods_rule','Legal and compliance owner',NULL,'block_booking',ARRAY['booking'],'compliance_admin'),
  ('REQ_KE_CUSTOMER_TERMS','Customer terms acceptance','Every booking must reference the exact version of the customer terms, delivery terms and prohibited goods policy accepted by the customer.','CA_KE','FW_KE_POSTAL_COURIER','contract','customer',ARRAY['parcel','express','courier','freight','rides','charter','rental'],ARRAY[]::text[],ARRAY[]::text[],true,'Versioned acceptance record linked to the booking','acceptance_record','Legal owner',NULL,'block_booking',ARRAY['booking'],'compliance_admin'),
  ('REQ_KE_PARTNER_AGREEMENT','Executed partner agreement','A partner may not be activated without an executed agreement covering scope, liability, insurance, data protection and claims.','CA_KE','FW_KE_POSTAL_COURIER','contract','partner',ARRAY['parcel','express','courier','freight','rides','charter','rental'],ARRAY['driver','courier','fleet_operator','charter_operator','logistics_carrier','rental_partner','warehouse_partner','technology_partner','api_partner','white_label_partner'],ARRAY[]::text[],true,'Signed contract record with effective dates','signed_contract','Legal owner',NULL,'block_activation',ARRAY['activation'],'compliance_admin'),
  ('REQ_KE_CARGO_PROTECTION','Goods-in-transit protection','Any protection or insurance statement made to customers must be supported by an authoritative policy record naming insurer, limits and exclusions.','CA_KE','FW_KE_POSTAL_COURIER','insurance','platform',ARRAY['parcel','express','courier','freight'],ARRAY[]::text[],ARRAY[]::text[],false,'Protection policy record with verified evidence','insurance_policy','Insurer and legal owner',365,'manual_review',ARRAY['dispatch','claims'],'finance_admin'),
  ('REQ_KE_CLAIMS_POLICY','Approved claims policy','Claims handling requires an approved policy defining eligibility, evidence, assessment and settlement.','CA_KE','FW_KE_POSTAL_COURIER','policy','platform',ARRAY['parcel','express','courier','freight'],ARRAY[]::text[],ARRAY[]::text[],true,'Approved policy version with owner sign-off','approved_policy','Legal owner',NULL,'manual_review',ARRAY['claims'],'compliance_admin'),
  ('REQ_KE_ETIMS_INVOICING','Electronic tax invoicing (eTIMS)','Electronic tax invoices must be issued and acknowledged for billable transactions, subject to the applicable rules and exceptions.','KRA','FW_KE_TAX_ETIMS','tax','platform',ARRAY['parcel','express','courier','freight','rides','charter','rental'],ARRAY[]::text[],ARRAY[]::text[],true,'eTIMS submission acknowledgement stored per invoice','etims_response','Kenya Revenue Authority',NULL,'manual_review',ARRAY['invoicing','settlement'],'finance_admin'),
  ('REQ_KE_ODPC_REGISTRATION','Data controller / processor registration','Registration with the Data Protection Commissioner is required where the applicable thresholds and rules apply.','ODPC','FW_KE_DATA_PROTECTION','registration','platform',ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],true,'Registration certificate verification','registration_certificate','Office of the Data Protection Commissioner',730,'block_processing',ARRAY['processing'],'compliance_admin'),
  ('REQ_KE_PRIVACY_NOTICE','Privacy notice and processing register','Processing of sender, recipient, courier and location data requires a published privacy notice and a maintained processing register with lawful basis and retention.','ODPC','FW_KE_DATA_PROTECTION','policy','platform',ARRAY[]::text[],ARRAY[]::text[],ARRAY[]::text[],true,'Published notice version plus processing register completeness','published_policy','Legal owner',NULL,'block_processing',ARRAY['processing'],'compliance_admin')
) AS v(code,title,description,reg,framework,requirement_type,applies_to,service_families,partner_types,asset_types,mandatory,verification_method,evidence_type,approval_authority,renewal_days,failure_action,blocking_stages,owner_role)
JOIN public.legal_regulators r ON r.code = v.reg
JOIN public.legal_frameworks f ON f.code = v.framework
JOIN public.legal_frameworks fw_src ON fw_src.code = v.framework
CROSS JOIN public.legal_jurisdictions j
WHERE j.code = 'KE'
ON CONFLICT (code) DO NOTHING;

-- 3. Goods catalogue (unclassified until legally determined) --
INSERT INTO public.legal_goods_rules (code, goods_category, goods_class, jurisdiction_id, requirement_id, service_families, keywords, failure_action, notes, status)
SELECT
  'GOODS_' || upper(replace(v.category,' ','_')), v.category, 'unknown'::public.legal_goods_class, j.id, req.id,
  ARRAY['parcel','express','courier','freight'], v.keywords, 'manual_review'::public.legal_failure_action,
  'Classification pending legal and operational determination. Unknown goods route to manual review and are never treated as standard.',
  'review_required'::public.legal_status
FROM (VALUES
  ('general merchandise', ARRAY['general','merchandise','goods']),
  ('documents', ARRAY['document','letter','envelope','contract']),
  ('electronics', ARRAY['phone','laptop','tablet','electronics']),
  ('fragile items', ARRAY['fragile','glass','ceramic']),
  ('clothing and textiles', ARRAY['clothes','apparel','textile']),
  ('food non perishable', ARRAY['food','snack','dry goods']),
  ('food perishable', ARRAY['fresh','perishable','produce']),
  ('cold chain', ARRAY['cold chain','frozen','chilled','vaccine']),
  ('pharmaceutical', ARRAY['pharmaceutical','medicine','drug','prescription']),
  ('medical samples', ARRAY['medical sample','specimen','biological']),
  ('cash and negotiable instruments', ARRAY['cash','money','cheque','bearer']),
  ('jewellery and precious metals', ARRAY['jewellery','gold','silver','precious']),
  ('alcohol', ARRAY['alcohol','wine','spirits','beer']),
  ('tobacco and nicotine', ARRAY['tobacco','cigarette','nicotine','vape']),
  ('dangerous goods', ARRAY['dangerous','hazardous','flammable','corrosive','explosive']),
  ('batteries and lithium cells', ARRAY['battery','lithium','power bank']),
  ('chemicals', ARRAY['chemical','solvent','acid']),
  ('firearms and ammunition', ARRAY['firearm','gun','ammunition','weapon']),
  ('narcotics and controlled substances', ARRAY['narcotic','controlled substance','cannabis']),
  ('live animals', ARRAY['live animal','pet','livestock']),
  ('human remains and body parts', ARRAY['human remains','ashes','body part']),
  ('agricultural produce', ARRAY['agricultural','farm','seed','grain']),
  ('automotive parts', ARRAY['spare part','automotive','engine']),
  ('unclassified', ARRAY['other','unknown','unspecified'])
) AS v(category, keywords)
LEFT JOIN public.legal_requirements req ON req.code = 'REQ_KE_GOODS_CONTROLS'
CROSS JOIN public.legal_jurisdictions j
WHERE j.code = 'KE'
ON CONFLICT (code) DO NOTHING;

-- 4. Processing register ------------------------------------
INSERT INTO public.legal_data_processing_records (
  code, activity, data_controller, data_processor, processing_purpose, lawful_basis,
  data_categories, data_subjects, retention_period_days, deletion_rule, access_roles,
  sharing_parties, cross_border_transfer, security_measures, dpia_required, status
) VALUES
  ('DPR_BOOKING','Parcel and delivery booking','Yalla Mobility',NULL,'Accept, price and fulfil a delivery booking','REVIEW_REQUIRED',ARRAY['name','phone','pickup address','delivery address','goods description'],ARRAY['sender','recipient'],NULL,'REVIEW_REQUIRED',ARRAY['operations_admin','dispatch_manager'],ARRAY['assigned courier partner'],false,ARRAY['row level security','encrypted transport','role based access'],true,'review_required'),
  ('DPR_TRACKING','Shipment tracking and location','Yalla Mobility',NULL,'Provide tracking and operational visibility','REVIEW_REQUIRED',ARRAY['courier location','timestamps','shipment status'],ARRAY['courier','sender','recipient'],NULL,'REVIEW_REQUIRED',ARRAY['operations_admin','dispatch_manager'],ARRAY[]::text[],false,ARRAY['row level security','audit logging'],true,'review_required'),
  ('DPR_POD','Proof of delivery capture','Yalla Mobility',NULL,'Evidence delivery and support dispute resolution','REVIEW_REQUIRED',ARRAY['recipient name','signature','photograph','geolocation'],ARRAY['recipient','courier'],NULL,'REVIEW_REQUIRED',ARRAY['operations_admin','compliance_admin'],ARRAY[]::text[],false,ARRAY['private storage bucket','hash integrity','access audit'],true,'review_required'),
  ('DPR_PAYMENTS','Payment and settlement processing','Yalla Mobility','Mobile money provider','Collect payment and settle partners','REVIEW_REQUIRED',ARRAY['phone number','transaction reference','amount'],ARRAY['customer','partner'],NULL,'REVIEW_REQUIRED',ARRAY['finance_admin'],ARRAY['mobile money provider'],false,ARRAY['secret management','append only ledger'],true,'review_required'),
  ('DPR_TAX','Tax invoicing and eTIMS submission','Yalla Mobility','Tax authority interface','Issue and reconcile electronic tax invoices','REVIEW_REQUIRED',ARRAY['customer identity','tax identifier','invoice lines'],ARRAY['customer'],NULL,'REVIEW_REQUIRED',ARRAY['finance_admin'],ARRAY['Kenya Revenue Authority'],false,ARRAY['immutable invoice records','submission audit'],false,'review_required'),
  ('DPR_PARTNER_ONBOARDING','Partner and courier onboarding','Yalla Mobility',NULL,'Verify identity, licensing and eligibility','REVIEW_REQUIRED',ARRAY['identity document','licence','tax identifier','bank or wallet details'],ARRAY['partner','courier','driver'],NULL,'REVIEW_REQUIRED',ARRAY['compliance_admin','operations_admin'],ARRAY[]::text[],false,ARRAY['private storage bucket','verification workflow'],true,'review_required'),
  ('DPR_SUPPORT','Customer support and claims','Yalla Mobility',NULL,'Handle enquiries, complaints and claims','REVIEW_REQUIRED',ARRAY['contact details','correspondence','claim evidence'],ARRAY['customer','partner'],NULL,'REVIEW_REQUIRED',ARRAY['operations_admin','compliance_admin'],ARRAY[]::text[],false,ARRAY['role based access','audit logging'],false,'review_required')
ON CONFLICT (code) DO NOTHING;

-- 5. Server functions ---------------------------------------
CREATE OR REPLACE FUNCTION public.legal_record_event(
  _event_type text,
  _subject_type text,
  _subject_id uuid,
  _subject_ref text,
  _requirement_code text,
  _gate_stage text,
  _decision text,
  _reason_code text,
  _shadow_mode boolean,
  _detail jsonb,
  _correlation_id text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE new_id uuid;
BEGIN
  INSERT INTO public.legal_compliance_events (
    event_type, subject_type, subject_id, subject_ref, requirement_code, gate_stage,
    decision, reason_code, shadow_mode, detail, correlation_id
  ) VALUES (
    _event_type, _subject_type, _subject_id, _subject_ref, _requirement_code,
    NULLIF(_gate_stage,'')::public.legal_gate_stage,
    _decision, _reason_code, COALESCE(_shadow_mode, true), COALESCE(_detail,'{}'::jsonb), _correlation_id
  ) RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;
REVOKE ALL ON FUNCTION public.legal_record_event(text,text,uuid,text,text,text,text,text,boolean,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.legal_record_event(text,text,uuid,text,text,text,text,text,boolean,jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.legal_expiry_horizon()
RETURNS TABLE (
  instrument_kind text,
  instrument_id uuid,
  label text,
  holder text,
  effective_until date,
  days_remaining integer,
  band text,
  lifecycle public.legal_status
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH src AS (
    SELECT 'licence'::text AS kind, id, coalesce(licence_type,'licence') AS label, coalesce(holder_name, holder_type) AS holder, effective_until, status FROM public.legal_licences
    UNION ALL SELECT 'permit', id, coalesce(permit_type,'permit'), coalesce(holder_name, holder_type), effective_until, status FROM public.legal_permits
    UNION ALL SELECT 'certification', id, coalesce(certification_type,'certification'), coalesce(holder_name, holder_type), effective_until, status FROM public.legal_certifications
    UNION ALL SELECT 'protection', id, coalesce(coverage_type,'protection'), insured_entity, effective_until, status FROM public.legal_protection_policies
    UNION ALL SELECT 'contract', id, title, coalesce(counterparty_name, counterparty_type), effective_until, status FROM public.legal_contracts
    UNION ALL SELECT 'policy', id, title, audience, effective_until, status FROM public.legal_policies
  )
  SELECT
    kind, id, label, holder, effective_until,
    (effective_until - current_date)::integer AS days_remaining,
    CASE
      WHEN status IN ('suspended','revoked') THEN upper(status::text)
      WHEN effective_until IS NULL THEN 'NO_EXPIRY_RECORDED'
      WHEN effective_until < current_date THEN 'EXPIRED'
      WHEN effective_until - current_date <= 30 THEN 'EXPIRING_30_DAYS'
      WHEN effective_until - current_date <= 60 THEN 'EXPIRING_60_DAYS'
      WHEN effective_until - current_date <= 90 THEN 'EXPIRING_90_DAYS'
      ELSE 'VALID'
    END AS band,
    status
  FROM src
  WHERE public.has_staff_permission('staff.legal.read')
  ORDER BY effective_until NULLS LAST;
$$;
REVOKE ALL ON FUNCTION public.legal_expiry_horizon() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.legal_expiry_horizon() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.legal_readiness_matrix()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result jsonb;
BEGIN
  PERFORM public.require_staff('staff.legal.read');
  SELECT jsonb_build_object(
    'generated_at', now(),
    'requirements', jsonb_build_object(
      'total', (SELECT count(*) FROM public.legal_requirements),
      'active', (SELECT count(*) FROM public.legal_requirements WHERE status = 'active'),
      'review_required', (SELECT count(*) FROM public.legal_requirements WHERE status IN ('review_required','unknown')),
      'evidence_required', (SELECT count(*) FROM public.legal_requirements WHERE status = 'evidence_required')
    ),
    'licensing', jsonb_build_object(
      'total', (SELECT count(*) FROM public.legal_licences),
      'active', (SELECT count(*) FROM public.legal_licences WHERE status = 'active'),
      'expired', (SELECT count(*) FROM public.legal_licences WHERE status = 'expired' OR (effective_until IS NOT NULL AND effective_until < current_date))
    ),
    'contracts', jsonb_build_object(
      'total', (SELECT count(*) FROM public.legal_contracts),
      'active', (SELECT count(*) FROM public.legal_contracts WHERE status = 'active')
    ),
    'protection', jsonb_build_object(
      'total', (SELECT count(*) FROM public.legal_protection_policies),
      'active', (SELECT count(*) FROM public.legal_protection_policies WHERE status = 'active')
    ),
    'goods', jsonb_build_object(
      'total', (SELECT count(*) FROM public.legal_goods_rules),
      'classified', (SELECT count(*) FROM public.legal_goods_rules WHERE goods_class <> 'unknown' AND status = 'active')
    ),
    'privacy', jsonb_build_object(
      'total', (SELECT count(*) FROM public.legal_data_processing_records),
      'active', (SELECT count(*) FROM public.legal_data_processing_records WHERE status = 'active')
    ),
    'policies', jsonb_build_object(
      'total', (SELECT count(*) FROM public.legal_policies),
      'active', (SELECT count(*) FROM public.legal_policies WHERE status = 'active')
    ),
    'open_reviews', (SELECT count(*) FROM public.legal_reviews WHERE outcome IN ('pending','legal_review_required','evidence_required')),
    'open_incidents', (SELECT count(*) FROM public.legal_incidents WHERE status NOT IN ('active','not_applicable') AND resolved_at IS NULL),
    'expiry', (SELECT jsonb_object_agg(band, cnt) FROM (SELECT band, count(*) AS cnt FROM public.legal_expiry_horizon() GROUP BY band) b)
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.legal_readiness_matrix() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.legal_readiness_matrix() TO authenticated, service_role;