-- =====================================================================
-- Document Templates Registry: version control + approval gates
-- =====================================================================

CREATE TABLE public.doc_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('CONTRACT','RATE_CARD','INVOICE','QUOTATION','SERVICE_ORDER','SCHEDULE','OTHER')),
  description text,
  owner_domain text NOT NULL DEFAULT 'commercial',
  legal_entity text NOT NULL DEFAULT 'Yalla Beena Limited (Trading as Yalla Mobility)',
  jurisdiction text NOT NULL DEFAULT 'Republic of Kenya',
  classification text NOT NULL DEFAULT 'PRIVATE & CONFIDENTIAL',
  source_reference text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.doc_templates TO authenticated;
GRANT ALL ON public.doc_templates TO service_role;
ALTER TABLE public.doc_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read doc templates" ON public.doc_templates
  FOR SELECT TO authenticated USING (has_staff_permission('staff.commercial.read'));
CREATE POLICY "commercial write doc templates" ON public.doc_templates
  FOR INSERT TO authenticated WITH CHECK (is_platform_admin() OR is_commercial_staff());
CREATE POLICY "commercial update doc templates" ON public.doc_templates
  FOR UPDATE TO authenticated USING (is_platform_admin() OR is_commercial_staff())
  WITH CHECK (is_platform_admin() OR is_commercial_staff());

CREATE TRIGGER trg_doc_templates_touch BEFORE UPDATE ON public.doc_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------

CREATE TABLE public.doc_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.doc_templates(id) ON DELETE CASCADE,
  version text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','PUBLISHED','REJECTED','RETIRED')),
  body jsonb NOT NULL DEFAULT '[]'::jsonb,
  variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  execution_block jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_fingerprint text,
  source_status text NOT NULL DEFAULT 'SOURCE_VERIFIED'
    CHECK (source_status IN ('SOURCE_VERIFIED','SOURCE_DOCUMENT_REQUIRED')),
  notes text,
  author_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  author_user_id uuid,
  submitted_at timestamptz,
  approved_at timestamptz,
  published_at timestamptz,
  retired_at timestamptz,
  supersedes_version_id uuid REFERENCES public.doc_template_versions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, version)
);

CREATE UNIQUE INDEX doc_template_one_published
  ON public.doc_template_versions (template_id) WHERE status = 'PUBLISHED';
CREATE INDEX doc_template_versions_status ON public.doc_template_versions (template_id, status);

GRANT SELECT, INSERT, UPDATE ON public.doc_template_versions TO authenticated;
GRANT ALL ON public.doc_template_versions TO service_role;
ALTER TABLE public.doc_template_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read doc template versions" ON public.doc_template_versions
  FOR SELECT TO authenticated USING (has_staff_permission('staff.commercial.read'));
CREATE POLICY "commercial write doc template versions" ON public.doc_template_versions
  FOR INSERT TO authenticated WITH CHECK (is_platform_admin() OR is_commercial_staff());
CREATE POLICY "commercial update doc template versions" ON public.doc_template_versions
  FOR UPDATE TO authenticated USING (is_platform_admin() OR is_commercial_staff())
  WITH CHECK (is_platform_admin() OR is_commercial_staff());

CREATE TRIGGER trg_doc_template_versions_touch BEFORE UPDATE ON public.doc_template_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------

CREATE TABLE public.doc_template_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.doc_template_versions(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('APPROVED','REJECTED')),
  decided_by uuid,
  decided_by_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  sole_approver boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.doc_template_approvals TO authenticated;
GRANT ALL ON public.doc_template_approvals TO service_role;
ALTER TABLE public.doc_template_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read doc template approvals" ON public.doc_template_approvals
  FOR SELECT TO authenticated USING (has_staff_permission('staff.commercial.read'));

CREATE TABLE public.doc_template_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid REFERENCES public.doc_template_versions(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.doc_templates(id) ON DELETE CASCADE,
  event text NOT NULL,
  status_before text,
  status_after text,
  actor_user_id uuid,
  actor_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  note text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.doc_template_events TO authenticated;
GRANT ALL ON public.doc_template_events TO service_role;
ALTER TABLE public.doc_template_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read doc template events" ON public.doc_template_events
  FOR SELECT TO authenticated USING (has_staff_permission('staff.commercial.read'));

CREATE OR REPLACE FUNCTION public._doc_template_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'doc template history is append-only';
END;
$$;

CREATE TRIGGER trg_doc_template_events_append_only
  BEFORE UPDATE OR DELETE ON public.doc_template_events
  FOR EACH ROW EXECUTE FUNCTION public._doc_template_append_only();
CREATE TRIGGER trg_doc_template_approvals_append_only
  BEFORE UPDATE OR DELETE ON public.doc_template_approvals
  FOR EACH ROW EXECUTE FUNCTION public._doc_template_append_only();

-- =====================================================================
-- Registry read model
-- =====================================================================

CREATE OR REPLACE FUNCTION public.doc_template_registry()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _out jsonb;
BEGIN
  IF NOT (public.is_platform_admin() OR public.has_staff_permission('staff.commercial.read')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'can_manage', public.is_platform_admin() OR public.is_commercial_staff(),
    'is_admin', public.is_platform_admin(),
    'templates', COALESCE(jsonb_agg(t ORDER BY t->>'kind', t->>'name'), '[]'::jsonb)
  )
  INTO _out
  FROM (
    SELECT jsonb_build_object(
      'id', d.id, 'code', d.code, 'name', d.name, 'kind', d.kind,
      'description', d.description, 'legal_entity', d.legal_entity,
      'jurisdiction', d.jurisdiction, 'classification', d.classification,
      'source_reference', d.source_reference, 'is_active', d.is_active,
      'published_version', (
        SELECT v.version FROM doc_template_versions v
        WHERE v.template_id = d.id AND v.status = 'PUBLISHED' LIMIT 1
      ),
      'versions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', v.id, 'version', v.version, 'status', v.status,
          'source_status', v.source_status, 'notes', v.notes,
          'section_count', jsonb_array_length(v.body),
          'variable_count', jsonb_array_length(v.variables),
          'body', v.body, 'variables', v.variables,
          'execution_block', v.execution_block,
          'content_fingerprint', v.content_fingerprint,
          'author_staff_id', v.author_staff_id,
          'author_name', (SELECT s.full_name FROM staff_members s WHERE s.id = v.author_staff_id),
          'author_user_id', v.author_user_id,
          'created_at', v.created_at, 'submitted_at', v.submitted_at,
          'approved_at', v.approved_at, 'published_at', v.published_at,
          'retired_at', v.retired_at,
          'approvals', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'decision', a.decision, 'sole_approver', a.sole_approver,
              'note', a.note, 'created_at', a.created_at,
              'decided_by_name', (SELECT s.full_name FROM staff_members s WHERE s.id = a.decided_by_staff_id)
            ) ORDER BY a.created_at DESC)
            FROM doc_template_approvals a WHERE a.version_id = v.id), '[]'::jsonb),
          'events', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'event', e.event, 'status_before', e.status_before, 'status_after', e.status_after,
              'note', e.note, 'created_at', e.created_at,
              'actor_name', (SELECT s.full_name FROM staff_members s WHERE s.id = e.actor_staff_id)
            ) ORDER BY e.created_at DESC)
            FROM doc_template_events e WHERE e.version_id = v.id), '[]'::jsonb)
        ) ORDER BY v.created_at DESC)
        FROM doc_template_versions v WHERE v.template_id = d.id
      ), '[]'::jsonb)
    ) AS t
    FROM doc_templates d
  ) s;

  RETURN _out;
END;
$$;

REVOKE ALL ON FUNCTION public.doc_template_registry() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.doc_template_registry() TO authenticated;

-- =====================================================================
-- Version authoring
-- =====================================================================

CREATE OR REPLACE FUNCTION public.doc_template_version_create(
  _template_id uuid,
  _version text,
  _body jsonb DEFAULT NULL,
  _variables jsonb DEFAULT NULL,
  _execution_block jsonb DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _staff uuid := public._my_staff_member_id();
  _base doc_template_versions;
  _id uuid;
BEGIN
  IF NOT (public.is_platform_admin() OR public.is_commercial_staff()) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  IF coalesce(trim(_version), '') = '' THEN
    RAISE EXCEPTION 'VERSION_REQUIRED';
  END IF;

  SELECT * INTO _base FROM doc_template_versions
  WHERE template_id = _template_id ORDER BY created_at DESC LIMIT 1;

  INSERT INTO doc_template_versions (
    template_id, version, status, body, variables, execution_block,
    source_status, notes, author_staff_id, author_user_id, supersedes_version_id,
    content_fingerprint
  ) VALUES (
    _template_id, trim(_version), 'DRAFT',
    COALESCE(_body, _base.body, '[]'::jsonb),
    COALESCE(_variables, _base.variables, '[]'::jsonb),
    COALESCE(_execution_block, _base.execution_block, '{}'::jsonb),
    COALESCE(_base.source_status, 'SOURCE_VERIFIED'),
    _notes, _staff, auth.uid(),
    (SELECT id FROM doc_template_versions WHERE template_id = _template_id AND status = 'PUBLISHED' LIMIT 1),
    encode(sha256(convert_to(COALESCE(_body, _base.body, '[]'::jsonb)::text, 'UTF8')), 'hex')
  ) RETURNING id INTO _id;

  INSERT INTO doc_template_events (version_id, template_id, event, status_after, actor_user_id, actor_staff_id, note)
  VALUES (_id, _template_id, 'VERSION_CREATED', 'DRAFT', auth.uid(), _staff, _notes);

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.doc_template_version_create(uuid, text, jsonb, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.doc_template_version_create(uuid, text, jsonb, jsonb, jsonb, text) TO authenticated;

-- =====================================================================
-- Approval gates
-- =====================================================================

CREATE OR REPLACE FUNCTION public.doc_template_action(
  _version_id uuid,
  _action text,
  _note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _staff uuid := public._my_staff_member_id();
  _admin boolean := public.is_platform_admin();
  _v doc_template_versions;
  _next text;
  _sole boolean := false;
  _approvals int;
BEGIN
  IF NOT (_admin OR public.is_commercial_staff()) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  SELECT * INTO _v FROM doc_template_versions WHERE id = _version_id FOR UPDATE;
  IF _v.id IS NULL THEN RAISE EXCEPTION 'VERSION_NOT_FOUND'; END IF;

  _action := upper(coalesce(_action, ''));

  IF _action = 'SUBMIT' THEN
    IF _v.status <> 'DRAFT' AND _v.status <> 'REJECTED' THEN
      RAISE EXCEPTION 'ONLY_DRAFT_CAN_BE_SUBMITTED';
    END IF;
    IF jsonb_array_length(_v.body) = 0 THEN
      RAISE EXCEPTION 'TEMPLATE_BODY_REQUIRED';
    END IF;
    IF _v.source_status = 'SOURCE_DOCUMENT_REQUIRED' THEN
      RAISE EXCEPTION 'SOURCE_DOCUMENT_REQUIRED';
    END IF;
    _next := 'IN_REVIEW';
    UPDATE doc_template_versions SET status = _next, submitted_at = now() WHERE id = _version_id;

  ELSIF _action IN ('APPROVE','REJECT') THEN
    IF _v.status <> 'IN_REVIEW' THEN
      RAISE EXCEPTION 'ONLY_IN_REVIEW_CAN_BE_DECIDED';
    END IF;
    IF _action = 'APPROVE' THEN
      IF _v.author_user_id IS NOT NULL AND _v.author_user_id = auth.uid() THEN
        IF NOT _admin THEN
          RAISE EXCEPTION 'FOUR_EYES_REQUIRED';
        END IF;
        _sole := true;
      END IF;
      _next := 'APPROVED';
      UPDATE doc_template_versions SET status = _next, approved_at = now() WHERE id = _version_id;
    ELSE
      _next := 'REJECTED';
      UPDATE doc_template_versions
      SET status = _next, submitted_at = NULL, approved_at = NULL WHERE id = _version_id;
    END IF;
    INSERT INTO doc_template_approvals (version_id, decision, decided_by, decided_by_staff_id, sole_approver, note)
    VALUES (_version_id, CASE WHEN _action = 'APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,
            auth.uid(), _staff, _sole, _note);

  ELSIF _action = 'PUBLISH' THEN
    IF _v.status <> 'APPROVED' THEN
      RAISE EXCEPTION 'ONLY_APPROVED_CAN_BE_PUBLISHED';
    END IF;
    SELECT count(*) INTO _approvals FROM doc_template_approvals
    WHERE version_id = _version_id AND decision = 'APPROVED';
    IF _approvals = 0 THEN RAISE EXCEPTION 'APPROVAL_RECORD_REQUIRED'; END IF;

    UPDATE doc_template_versions
    SET status = 'RETIRED', retired_at = now()
    WHERE template_id = _v.template_id AND status = 'PUBLISHED';

    _next := 'PUBLISHED';
    UPDATE doc_template_versions SET status = _next, published_at = now() WHERE id = _version_id;

  ELSIF _action = 'RETIRE' THEN
    IF _v.status <> 'PUBLISHED' THEN
      RAISE EXCEPTION 'ONLY_PUBLISHED_CAN_BE_RETIRED';
    END IF;
    IF coalesce(trim(_note), '') = '' THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
    _next := 'RETIRED';
    UPDATE doc_template_versions SET status = _next, retired_at = now() WHERE id = _version_id;

  ELSE
    RAISE EXCEPTION 'UNKNOWN_ACTION';
  END IF;

  INSERT INTO doc_template_events (
    version_id, template_id, event, status_before, status_after,
    actor_user_id, actor_staff_id, note, detail
  ) VALUES (
    _version_id, _v.template_id, _action, _v.status, _next,
    auth.uid(), _staff, _note, jsonb_build_object('sole_approver', _sole)
  );

  RETURN jsonb_build_object('version_id', _version_id, 'status', _next, 'sole_approver', _sole);
END;
$$;

REVOKE ALL ON FUNCTION public.doc_template_action(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.doc_template_action(uuid, text, text) TO authenticated;

-- =====================================================================
-- Seed: templates
-- =====================================================================

INSERT INTO public.doc_templates (code, name, kind, description, source_reference, classification)
VALUES
 ('MSC', 'Mobility Service Contract', 'CONTRACT',
  'Master framework contract between Yalla Beena Limited and a Corporate Customer governing all bookings, schedules and invoices.',
  'Uploaded Mobility Service Contract (12-page execution copy)', 'PRIVATE & CONFIDENTIAL'),
 ('CHARTER_RATE_CARD', 'Charter Rate Card', 'RATE_CARD',
  'Corporate charter pricing schedule issued as an annexure to the Mobility Service Contract.',
  NULL, 'PRIVATE & CONFIDENTIAL'),
 ('TAX_INVOICE', 'Tax Invoice', 'INVOICE',
  'Tax invoice issued against a delivered service order under a Mobility Service Contract.',
  NULL, 'PRIVATE & CONFIDENTIAL')
ON CONFLICT (code) DO NOTHING;

-- Mobility Service Contract v1.0 — published, seeded from the uploaded document
WITH t AS (SELECT id FROM public.doc_templates WHERE code = 'MSC'),
ins AS (
  INSERT INTO public.doc_template_versions (
    template_id, version, status, source_status, notes, published_at, approved_at, submitted_at,
    variables, execution_block, body, content_fingerprint
  )
  SELECT t.id, 'v1.0', 'PUBLISHED', 'SOURCE_VERIFIED',
    'Seeded verbatim from the uploaded Mobility Service Contract (Articles 1-10 and Execution page).',
    now(), now(), now(),
    '[{"key":"customer_legal_name","label":"Customer legal name","required":true},
      {"key":"customer_signatory_name","label":"Customer signatory name","required":true},
      {"key":"customer_signatory_title","label":"Customer signatory title","required":true},
      {"key":"effective_date","label":"Effective date","required":true},
      {"key":"rate_card_reference","label":"Pricing schedule reference","required":true},
      {"key":"payment_terms","label":"Payment terms","required":true},
      {"key":"notice_address","label":"Customer notice address","required":true},
      {"key":"selected_services","label":"Services in scope","required":true}]'::jsonb,
    '{"provider_name":"YALLA BEENA LIMITED","provider_trading_as":"Trading as Yalla Mobility",
      "provider_signatory":"JOHN MUNGAI","provider_signatory_title":"DIRECTOR",
      "customer_heading":"THE CORPORATE CUSTOMER",
      "fields":["Company Name","Name","Title","Signature","Date","Company Seal (if applicable)","Company Stamp (if applicable)"],
      "preamble":"The Parties acknowledge that they have carefully read and understood this Agreement, have had the opportunity to obtain independent legal advice, freely enter into this Agreement without duress or undue influence, and agree to be legally bound by its terms. This Agreement shall become effective on the Effective Date upon execution by the duly authorised representatives of both Parties."}'::jsonb,
    '[
      {"article":1,"title":"Purpose, Definitions and Interpretation","clauses":[
        {"no":"1.1","heading":"Purpose","text":"This Contract establishes the legal, commercial and operational framework governing the Corporate Customer''s access to and use of the Yalla Mobility Platform. It defines the respective rights, obligations and responsibilities of the Parties and governs every Booking, quotation, Purchase Order (\"PO\"), Local Purchase Order (\"LPO\"), Booking Confirmation, Commercial Schedule, invoice, service request and other authorised transaction processed under this Contract during its Term."},
        {"no":"1.2","heading":"Platform Relationship","text":"Yalla Mobility owns and operates an enterprise mobility management platform through which corporate mobility services are requested, coordinated, administered and managed using an approved network of independent Fleet Partners and Mobility Service Providers. Unless expressly agreed otherwise in writing, Yalla Mobility acts solely as the operator of the Platform, the commercial administrator of mobility transactions and the coordinator of Services. Nothing contained in this Contract shall be construed as creating an employment, agency, partnership, joint venture or carrier relationship between Yalla Mobility and any Fleet Partner, Vehicle Owner or Driver."},
        {"no":"1.3","heading":"Definitions","text":"For the purposes of this Contract: \"Platform\" means the Yalla Mobility digital ecosystem comprising its website, mobile applications, customer portal, application programming interfaces (APIs), communication systems and supporting technologies through which Services are requested and administered. \"Booking\" means any request for Services accepted through the Platform or any other authorised communication channel. \"Fleet Partner\" means any independent transport operator, vehicle owner or mobility service provider approved by Yalla Mobility to perform Services. \"Services\" means the enterprise mobility management, booking administration, payment facilitation, customer support, reporting and related platform services provided by Yalla Mobility together with the transportation services performed by approved Fleet Partners."},
        {"no":"1.4","heading":"Scope","text":"This Contract governs all Services requested and accepted during the Term, including executive transportation, airport transfers, employee transportation, chauffeur services, vehicle hire, shuttle operations, project transport, event transport, logistics support, charter services and any other mobility solutions agreed in writing by the Parties. Each confirmed Booking constitutes an individual service engagement governed by this Contract together with the applicable Commercial Schedule, quotation or Booking Confirmation."},
        {"no":"1.5","heading":"Interpretation and Term","text":"This Contract constitutes a continuing, non-exclusive framework agreement and shall prevail over any inconsistent Purchase Order, quotation or Booking Confirmation unless expressly varied in writing by the Parties. This Contract shall commence on the Effective Date and remain in force until terminated in accordance with proceeding articles. Termination shall not affect accrued rights, outstanding obligations or any provision which by its nature is intended to survive termination, including provisions relating to payment, confidentiality, intellectual property, indemnities, limitation of liability, dispute resolution and governing law."}]},
      {"article":2,"title":"Platform Services","clauses":[
        {"no":"2.1","text":"Yalla Mobility shall provide the Corporate Customer with access to its digital mobility platform for the purpose of requesting, managing and administering corporate mobility services. The Platform shall facilitate the booking, coordination, scheduling, monitoring and management of transportation requirements through an approved network of independent Fleet Partners and Mobility Service Providers."},
        {"no":"2.2","text":"Subject to this Contract, Yalla Mobility shall provide enterprise mobility management services, including account administration, booking management, trip coordination, vehicle sourcing, payment facilitation, electronic invoicing, customer support, operational reporting, journey tracking, service monitoring and such other platform-enabled services as may be introduced from time to time to enhance customer experience and operational efficiency."},
        {"no":"2.3","text":"Transportation services requested through the Platform may include executive transportation, airport transfers, employee and staff transportation, chauffeur services, vehicle hire, shuttle operations, project transport, event transport, courier and logistics support, charter services and other mobility solutions made available through approved Fleet Partners. The availability of any Service shall remain subject to operational capacity, geographic coverage, regulatory requirements and acceptance of the relevant Booking."},
        {"no":"2.4","text":"The Corporate Customer acknowledges that Yalla Mobility facilitates access to mobility services through independent Fleet Partners who remain solely responsible for the ownership, operation, maintenance, licensing, insurance, statutory compliance and lawful operation of their vehicles and personnel. Nothing contained in this Contract shall be construed as creating an employment, agency, partnership or joint venture between Yalla Mobility and any Fleet Partner, nor shall Yalla Mobility be deemed the transport operator solely because a Booking is facilitated through the Platform."},
        {"no":"2.5","text":"Yalla Mobility may engage, replace, suspend or remove Fleet Partners from its network at its sole discretion where necessary to maintain service quality, regulatory compliance, customer safety or operational efficiency. Where reasonably practicable, Yalla Mobility shall use commercially reasonable efforts to allocate an alternative Fleet Partner without materially affecting the confirmed Booking."},
        {"no":"2.6","text":"Yalla Mobility may update, improve or modify the Platform by introducing new technologies, digital features, artificial intelligence capabilities, integrations, reporting tools, security enhancements or operational improvements, provided that such changes do not materially diminish the core Services subscribed to by the Corporate Customer. Planned maintenance or system upgrades shall, where reasonably practicable, be communicated in advance and scheduled to minimise disruption."},
        {"no":"2.7","text":"The Corporate Customer shall use the Platform only for lawful business purposes and in accordance with this Contract. Access credentials issued to authorised users shall remain confidential, and the Corporate Customer shall be responsible for all activities conducted through its authorised accounts until Yalla Mobility is notified of any unauthorised access or security breach."},
        {"no":"2.8","text":"Nothing in this Contract shall oblige Yalla Mobility to accept every Booking or guarantee the availability of any specific vehicle, Fleet Partner, driver, route or service category. Every Booking shall remain subject to availability, operational feasibility, safety considerations and compliance with applicable laws and the operational policies of the Platform."}]},
      {"article":3,"title":"Bookings and Service Delivery","clauses":[
        {"no":"3.1","text":"The Corporate Customer may request Services through the Yalla Mobility Platform, mobile application, customer portal, email, telephone, Purchase Order (PO), Local Purchase Order (LPO) or any other communication channel approved by Yalla Mobility. Every Booking shall contain sufficient information to facilitate efficient service delivery, including the collection and destination locations, travel date and time, passenger details, vehicle category, billing reference, authorised contact person and any special operational requirements."},
        {"no":"3.2","text":"A Booking shall become binding only upon written or electronic confirmation issued by Yalla Mobility, or upon commencement of the requested Service, whichever occurs first. All Bookings are subject to vehicle availability, operational feasibility, regulatory compliance and acceptance by an approved Fleet Partner. Yalla Mobility reserves the right to decline, defer or modify a Booking where it cannot reasonably be fulfilled under the requested terms."},
        {"no":"3.3","text":"Upon confirmation of a Booking, Yalla Mobility shall coordinate the allocation of a suitable Fleet Partner and facilitate communication between the Corporate Customer and the assigned service provider where necessary. Yalla Mobility may substitute a Fleet Partner or vehicle of an equivalent or higher category where operationally necessary, provided that such substitution does not materially affect the quality or purpose of the Service."},
        {"no":"3.4","text":"Estimated collection times, journey durations and arrival times are operational estimates only and may be affected by traffic conditions, weather, road closures, security incidents, mechanical breakdowns, government directives or other circumstances beyond the reasonable control of Yalla Mobility or the Fleet Partner. Neither Party shall treat such delays as a breach of this Contract where commercially reasonable efforts have been made to minimise disruption and complete the Service."},
        {"no":"3.5","text":"The Corporate Customer may amend or cancel a Booking by providing reasonable notice through the Platform or any authorised communication channel. Amendments shall remain subject to operational availability and may result in revised pricing where additional resources, waiting time, route changes or replacement vehicles are required. Cancellation charges, where applicable, shall be determined in accordance with the approved Pricing Schedule or quotation communicated before the Service."},
        {"no":"3.6","text":"The Corporate Customer shall ensure that all passengers behave lawfully, comply with reasonable safety instructions and refrain from conduct that may endanger persons, damage property or interfere with the delivery of the Services. Yalla Mobility or the assigned Fleet Partner may refuse, suspend or terminate a Service where passenger conduct presents a material safety, legal or operational risk, without prejudice to any rights available under this Contract."},
        {"no":"3.7","text":"Yalla Mobility shall use commercially reasonable efforts to monitor service performance, coordinate operational support and respond promptly to service-related enquiries and incidents. Where a confirmed Service cannot reasonably be completed, Yalla Mobility may facilitate alternative arrangements through another approved Fleet Partner, subject to availability, but shall not be obliged to guarantee uninterrupted service where circumstances exist beyond its reasonable control."}]},
      {"article":4,"title":"Commercial Terms","clauses":[
        {"no":"4.1","text":"The Corporate Customer shall pay for all Services requested through the Platform in accordance with the applicable quotation, approved Pricing Schedule, Purchase Order (PO), Local Purchase Order (LPO), Mobility Services Contract (MSC) or any other commercial arrangement agreed in writing. Unless expressly stated otherwise, all rates are exclusive of applicable taxes, statutory levies, tolls, parking fees, airport access charges, government-imposed fees and any other reimbursable expenses incurred in the delivery of the Services. Should such arise, the corporate customer is expected to pay the cost."},
        {"no":"4.2","text":"Service charges may be calculated using fixed, distance-based, hourly, daily, charter, subscription or project-based pricing, depending on the nature of the Service. Additional charges may apply for waiting time, route deviations, overnight assignments, special equipment, premium vehicle requests, emergency bookings or other Services requested outside the original Booking, provided such charges are communicated in accordance with the applicable Pricing Schedule or quotation."},
        {"no":"4.3","text":"Yalla Mobility shall issue electronic quotations, Booking Confirmations and invoices through the Platform or by other approved communication channels. The Corporate Customer shall verify all commercial information upon receipt and promptly notify Yalla Mobility of any discrepancy before payment becomes due."},
        {"no":"4.4","text":"Unless otherwise agreed in writing, all Services shall be paid for in advance by Bank Transfer (Real-Time Gross Settlement (RTGS)) or Mobile Money (M-Pesa PayBill). Payment shall be deemed received only when cleared funds have been irrevocably credited to Yalla Mobility''s designated bank account or approved mobile money account. Unless Yalla Mobility notifies the Corporate Customer otherwise in writing, all payments under this Contract shall be made exclusively through the approved payment channels set out in the payment table. The Corporate Customer shall quote the applicable invoice number, Purchase Order (PO), Local Purchase Order (LPO) or other payment reference with every remittance to facilitate timely allocation and reconciliation of payments.",
         "table":{"caption":"Approved payment channels","columns":["Payment method","Payment details"],"rows":[["Bank (RTGS / EFT / Bank Transfer)","Account Name: Yalla Beena Limited; Bank: KCB Bank Kenya PLC; Branch: Thika Branch; Account Number: 1334972281"],["Mobile Money (M-Pesa PayBill)","Business Name: Yalla Beena Limited; PayBill Number: 4148095; Account Reference: Name of the organization making payment or the applicable Invoice Number / Purchase Order Number"]]}},
        {"no":"4.5","text":"Yalla Mobility reserves the right to review or adjust its pricing where there is a material increase in fuel costs, insurance premiums, foreign exchange rates, statutory taxes, regulatory charges or other operating costs that materially affect the provision of the Services. Any revised pricing shall apply prospectively upon reasonable written notice and shall not affect Bookings already confirmed unless otherwise agreed by the Parties."},
        {"no":"4.6","text":"The Corporate Customer shall remain responsible for obtaining all necessary internal approvals, budgetary authorisations and Purchase Orders required for payment. The absence or delay of internal approvals shall not relieve the Corporate Customer of its obligation to pay for Services duly requested, performed and accepted under this Contract."}]},
      {"article":5,"title":"Rights and Obligations","clauses":[
        {"no":"5.1","text":"Yalla Mobility shall use commercially reasonable efforts to operate and maintain the Platform in a secure, reliable and efficient manner, facilitate Bookings through approved Fleet Partners, administer corporate accounts, coordinate service delivery, facilitate payments, provide customer support and maintain appropriate operational oversight to promote consistent service quality. Yalla Mobility may establish operational policies, service standards, service level requirements and supplier performance requirements designed to improve safety, efficiency, regulatory compliance and customer experience."},
        {"no":"5.2","text":"The Corporate Customer shall nominate authorised representatives to manage its account, submit accurate Booking requests, provide complete travel information, obtain all necessary internal approvals, cooperate in the coordination of Services and ensure that only authorised employees, contractors, guests or representatives access the Platform under its account. The Corporate Customer shall be responsible for maintaining the confidentiality of its account credentials and for all activities conducted through its authorised users."},
        {"no":"5.3","text":"The Corporate Customer shall ensure that its passengers comply with all applicable laws and reasonable operational requirements, conduct themselves in a safe and respectful manner, refrain from abusive, unlawful or disruptive behaviour and avoid any act likely to endanger persons, damage property or interfere with the delivery of the Services. The Corporate Customer shall be liable for any additional costs, losses or damages arising directly from the conduct of its passengers or authorised users."},
        {"no":"5.4","text":"Yalla Mobility shall use commercially reasonable efforts to engage competent and appropriately vetted Fleet Partners; however, each Fleet Partner shall remain solely responsible for the ownership, operation, maintenance, roadworthiness, licensing, insurance, statutory compliance and lawful operation of its vehicles, drivers and personnel. Nothing in this Contract shall be construed as transferring those operational responsibilities to Yalla Mobility solely because a Booking is facilitated through the Platform."},
        {"no":"5.5","text":"Each Party shall comply with all applicable laws, regulations and regulatory requirements relevant to its respective obligations under this Contract, including anti-bribery, anti-corruption, anti-money laundering, sanctions, taxation, employment, health and safety, environmental and data protection laws. Neither Party shall knowingly engage in any activity that may expose the other Party to legal, financial or reputational harm."},
        {"no":"5.6","text":"Each Party shall promptly notify the other of any circumstance that may materially affect the performance of this Contract, including operational disruptions, security incidents, regulatory investigations, insolvency events or any other matter likely to affect the efficient delivery or receipt of the Services. The Parties shall cooperate in good faith to minimise disruption, resolve operational issues promptly and maintain a professional and mutually beneficial commercial relationship throughout the Term of this Contract."},
        {"no":"5.7","text":"Nothing contained in this Contract shall create an exclusive relationship between the Parties. Yalla Mobility may engage additional Fleet Partners or service providers, and the Corporate Customer may procure mobility services from other providers, provided that such arrangements do not affect the performance of confirmed Bookings or any outstanding obligations under this Contract."}]},
      {"article":6,"title":"Liability, Insurance and Indemnities","clauses":[
        {"no":"6.1","text":"Yalla Mobility operates solely as a technology-enabled mobility platform that facilitates, coordinates and administers corporate mobility services through approved independent Fleet Partners. Except where expressly agreed in writing, Yalla Mobility shall not be deemed the owner, operator, carrier, employer, lessor or manager of any vehicle, driver or transportation service provided through the Platform, and nothing contained in this Contract shall be construed as creating such relationship."},
        {"no":"6.2","text":"Every Fleet Partner shall remain solely responsible for the ownership, possession, operation, maintenance, roadworthiness, licensing, insurance, inspection, statutory compliance and lawful operation of its vehicles, drivers and personnel, including compliance with all applicable transport, labour, tax, health, safety and regulatory requirements. Fleet Partners shall also remain solely liable for any claim, loss, injury, damage, fine, penalty or legal liability arising directly from the operation of their vehicles or the conduct of their personnel."},
        {"no":"6.3","text":"Yalla Mobility shall exercise commercially reasonable care in onboarding, monitoring and managing its network of Fleet Partners but does not warrant or guarantee the continuous availability of any specific vehicle, Fleet Partner or transportation resource. The allocation of a Fleet Partner to any Booking shall not be construed as a representation, warranty or assumption of operational liability by Yalla Mobility beyond its obligations under this Contract."},
        {"no":"6.4","text":"The Corporate Customer acknowledges that transportation services are performed by independent Fleet Partners and agrees that Yalla Mobility shall not be liable for delays, cancellations, route deviations, traffic congestion, weather conditions, road closures, mechanical failures, security incidents, governmental actions or any other event affecting the performance of a Booking where such event is beyond Yalla Mobility''s reasonable control. Yalla Mobility shall, however, use commercially reasonable efforts to coordinate alternative arrangements, facilitate communication and minimise operational disruption."},
        {"no":"6.5","text":"The Corporate Customer shall indemnify and hold harmless Yalla Mobility, its directors, officers, employees, agents and affiliates against all claims, losses, damages, liabilities, costs and expenses arising from the Corporate Customer''s breach of this Contract, misuse of the Platform, inaccurate Booking information, unlawful acts or omissions of its employees, passengers, contractors or authorised users, or any claim resulting from instructions issued by the Corporate Customer that are inconsistent with applicable law or operational safety."},
        {"no":"6.6","text":"Yalla Mobility shall not be liable for any indirect, incidental, consequential, exemplary or special damages, including loss of profit, revenue, business opportunity, anticipated savings, goodwill, contracts or data, whether arising in contract, tort, negligence or otherwise, except where such limitation is prohibited by applicable law."},
        {"no":"6.7","text":"To the fullest extent permitted by law, Yalla Mobility''s aggregate liability arising out of or in connection with this Contract, whether in contract, negligence, tort, statutory duty or otherwise, shall not exceed the total Platform Service Fees paid by the Corporate Customer to Yalla Mobility during the three (3) months immediately preceding the event giving rise to the claim. This limitation shall not apply to liability that cannot lawfully be excluded or limited under applicable law."},
        {"no":"6.8","text":"Each Party shall maintain, at its own cost, all insurance required by applicable law in relation to its respective business operations and obligations under this Contract. Yalla Mobility may, at its discretion, require Fleet Partners to provide evidence of valid insurance, licences, permits or regulatory approvals as a condition of participating on the Platform, without assuming responsibility for the continuing validity or adequacy of such documents."},
        {"no":"6.9","text":"A Party seeking indemnification under this Article shall promptly notify the other Party of any claim or proceeding likely to give rise to liability and shall provide reasonable cooperation in the investigation, defence or settlement of such claim. Neither Party shall admit liability or settle any claim affecting the other Party without that Party''s prior written consent, which shall not be unreasonably withheld or delayed."}]},
      {"article":7,"title":"Confidentiality, Data Protection and Intellectual Property","clauses":[
        {"no":"7.1","text":"Each Party shall keep confidential all non-public information obtained from the other Party in connection with this Contract, including commercial, financial, technical, operational and business information, customer records, pricing, software, trade secrets and any other information designated as confidential or which by its nature ought reasonably to be treated as confidential. Neither Party shall disclose such information to any third party except where required by law, authorised in writing by the disclosing Party or reasonably necessary for the performance of this Contract."},
        {"no":"7.2","text":"Yalla Mobility shall process personal data collected through the Platform in accordance with the applicable data protection laws, including the Data Protection Act, 2019 (Kenya) and any other applicable privacy legislation. Each Party shall implement appropriate administrative, technical and organisational measures to safeguard personal data against unauthorised access, disclosure, alteration, loss or misuse and shall promptly notify the other Party of any material data breach affecting information processed under this Contract where notification is required by law."},
        {"no":"7.3","text":"All intellectual property rights in the Yalla Mobility Platform, including its software, mobile applications, website, databases, application programming interfaces (APIs), algorithms, artificial intelligence models, trademarks, logos, trade names, domain names, reports, documentation, designs, source code, object code, user interfaces, business processes and related technology shall remain the exclusive property of Yalla Beena Limited or its licensors. Nothing contained in this Contract transfers or assigns any intellectual property rights to the Corporate Customer except for the limited right to access and use the Platform during the Term in accordance with this Contract."},
        {"no":"7.4","text":"The Corporate Customer shall not copy, modify, reverse engineer, decompile, disassemble, reproduce, distribute, sublicense, commercialise or otherwise exploit any part of the Platform except to the extent expressly permitted by applicable law or with the prior written consent of Yalla Mobility. The Corporate Customer shall not knowingly introduce malicious software, interfere with the security or integrity of the Platform or use the Platform in any manner that may impair its operation or infringe the rights of Yalla Mobility or any third party."},
        {"no":"7.5","text":"The obligations contained in this Article shall survive the expiration or termination of this Contract for a period of five (5) years or for such longer period as may be required by applicable law or where the information remains confidential by its nature. Nothing in this Article shall prevent either Party from retaining records required for legal, regulatory, audit or internal compliance purposes, provided that such records continue to be treated as confidential."}]},
      {"article":8,"title":"Term, Suspension and Termination","clauses":[
        {"no":"8.1","text":"This Contract shall commence on the Effective Date and shall remain in force until terminated in accordance with this Article. Unless otherwise agreed in writing, the Contract shall continue as a continuing commercial arrangement governing all Services requested and accepted through the Yalla Mobility Platform."},
        {"no":"8.2","text":"Either Party may terminate this Contract for convenience by giving not less than thirty (30) days'' prior written notice to the other Party. Termination shall not affect any Booking confirmed before the effective date of termination unless otherwise agreed by the Parties."},
        {"no":"8.3","text":"Either Party may terminate this Contract immediately by written notice where the other Party commits a material breach of this Contract and fails to remedy the breach within fourteen (14) days after receiving written notice requiring it to do so, becomes insolvent, enters liquidation or administration, ceases to carry on business, engages in fraud, corruption or unlawful conduct, or commits any act likely to materially damage the reputation or legitimate business interests of the other Party."},
        {"no":"8.4","text":"Yalla Mobility may suspend access to the Platform, decline new Bookings or suspend the provision of Services where the Corporate Customer has repeated breaches to this Contract, misuses the Platform, provides false or misleading information, compromises the security or integrity of the Platform, or where suspension is reasonably necessary to comply with applicable law, regulatory requirements or a lawful direction of a competent authority."},
        {"no":"8.5","text":"Upon expiration or termination of this Contract, the Corporate Customer shall promptly use commercially reasonable efforts to conclude or transition any Services already confirmed before the termination date, unless continuation would be unlawful, unsafe or commercially impracticable."},
        {"no":"8.6","text":"Expiration or termination of this Contract shall not affect any rights, remedies or obligations accrued before the effective date of termination, nor shall it affect any provision which by its nature is intended to survive termination, including provisions relating to payment obligations, confidentiality, intellectual property, limitation of liability, indemnities, dispute resolution and governing law."}]},
      {"article":9,"title":"Force Majeure","clauses":[
        {"no":"9.1","text":"Neither Party shall be liable for any delay, interruption or failure to perform its obligations under this Contract where such delay or failure results from an event beyond its reasonable control, including acts of God, floods, droughts, earthquakes, pandemics, epidemics, fire, explosions, acts of terrorism, war, civil unrest, strikes, labour disputes, governmental actions, changes in law, regulatory restrictions, embargoes, failure of public utilities, cyber-attacks, widespread technology failures or any other event that could not reasonably have been anticipated or avoided."},
        {"no":"9.2","text":"A Party affected by a Force Majeure event shall promptly notify the other Party, provide reasonable details of the circumstances and use commercially reasonable efforts to minimise the effects of the event and resume performance as soon as practicable. During the period of the Force Majeure event, the affected obligations shall be suspended only to the extent they are prevented from being performed."},
        {"no":"9.3","text":"Where a Force Majeure event materially affects the performance of a confirmed Booking, Yalla Mobility shall use commercially reasonable efforts to facilitate alternative arrangements through the Platform where reasonably practicable; however, neither Yalla Mobility nor any Fleet Partner shall be liable for any inability to provide or complete the affected Service where prevented by the Force Majeure event."}]},
      {"article":10,"title":"General Provisions","clauses":[
        {"no":"10.1","text":"This Contract constitutes the entire agreement between the Parties concerning its subject matter and supersedes all prior negotiations, representations, proposals, correspondence and agreements, whether written or oral. No amendment or variation shall be valid unless made in writing and signed by authorised representatives of both Parties."},
        {"no":"10.2","text":"Neither Party may assign, transfer, subcontract or otherwise dispose of its rights or obligations under this Contract without the prior written consent of the other Party, except that Yalla Mobility may engage affiliated companies, technology providers or approved Fleet Partners in the ordinary course of operating the Platform, provided that such engagement does not relieve Yalla Mobility of its obligations expressly assumed under this Contract."},
        {"no":"10.3","text":"Any notice required under this Contract shall be in writing and may be delivered by hand, courier, registered mail or electronic mail to the addresses specified in the Contract Schedule, and shall be deemed received on the date of delivery, or, where transmitted electronically, on the date of successful transmission unless proven otherwise."},
        {"no":"10.4","text":"No delay or failure by either Party in exercising any right or remedy under this Contract shall constitute a waiver of that right, nor shall any partial exercise of a right prevent any further exercise of that or any other right available under this Contract."},
        {"no":"10.5","text":"If any provision of this Contract is declared invalid, illegal or unenforceable by a court or competent authority, the remaining provisions shall continue in full force and effect, and the Parties shall replace the affected provision with a lawful provision that most closely reflects its original commercial intent."},
        {"no":"10.6","text":"The Parties shall endeavour to resolve any dispute arising under or in connection with this Contract through good-faith negotiations between their authorised representatives. Where a dispute cannot be resolved within thirty (30) days, either Party may refer the matter to mediation and, if unresolved, to the courts of competent jurisdiction in the Republic of Kenya."},
        {"no":"10.7","text":"This Contract shall be governed by and construed in accordance with the laws of the Republic of Kenya. The Parties irrevocably submit to the jurisdiction of the Kenyan courts in respect of any dispute arising out of or relating to this Contract."},
        {"no":"10.8","text":"This Contract may be executed in one or more counterparts, each of which shall be deemed an original, and all of which together shall constitute one instrument. A signature transmitted electronically, including by secure digital signature or scanned signed copy, shall have the same legal effect as an original handwritten signature to the extent permitted by applicable law."},
        {"no":"10.9","heading":"Good Faith and Goodwill","text":"The Parties acknowledge that this Contract is founded on mutual trust, good faith and a shared commitment to establishing a long-term commercial relationship. Each Party shall act honestly, fairly and in good faith in the performance of its obligations, cooperate reasonably to resolve operational or commercial issues, and refrain from any conduct likely to unjustifiably damage the reputation, business interests or goodwill of the other Party. Where any disagreement, operational challenge or misunderstanding arises, the Parties shall use commercially reasonable efforts to resolve the matter amicably through consultation and constructive dialogue before exercising any contractual remedy or commencing formal legal proceedings, except where immediate action is reasonably necessary to protect legal rights, confidential information, public safety or prevent material loss."}]}
    ]'::jsonb,
    NULL
  FROM t
  RETURNING id, body
)
UPDATE public.doc_template_versions v
SET content_fingerprint = encode(sha256(convert_to(v.body::text, 'UTF8')), 'hex')
WHERE v.id IN (SELECT id FROM ins);

-- Charter Rate Card v0.1 draft (layout only, awaiting authoritative source)
INSERT INTO public.doc_template_versions (template_id, version, status, source_status, notes, variables, body)
SELECT id, 'v0.1', 'DRAFT', 'SOURCE_DOCUMENT_REQUIRED',
  'Layout skeleton only. No rates recorded: the authoritative Charter Rate Card source document has not been supplied, so no pricing figures were entered.',
  '[{"key":"rate_card_version","label":"Rate card version","required":true},
    {"key":"effective_from","label":"Effective from","required":true},
    {"key":"currency","label":"Currency","required":true},
    {"key":"customer_legal_name","label":"Customer legal name","required":true}]'::jsonb,
  '[{"article":1,"title":"Rate Card Identity","clauses":[{"no":"1.1","text":"Document title, rate card version, effective dates, currency and the Mobility Service Contract it annexes."}]},
    {"article":2,"title":"Vehicle Categories and Charges","clauses":[{"no":"2.1","text":"Table placeholder: vehicle category, basis of charge, included kilometres/hours, rate. AWAITING SOURCE DOCUMENT — no figures recorded.","table":{"caption":"Charter rates","columns":["Vehicle category","Basis","Included","Rate"],"rows":[]}}]},
    {"article":3,"title":"Additional Charges","clauses":[{"no":"3.1","text":"Table placeholder: waiting time, excess kilometres, overnight allowance, out-of-town, tolls and parking. AWAITING SOURCE DOCUMENT.","table":{"caption":"Additional charges","columns":["Charge","Basis","Amount"],"rows":[]}}]},
    {"article":4,"title":"Taxes, Validity and Review","clauses":[{"no":"4.1","text":"Tax treatment, validity period and the price review mechanism referenced in Article 4.5 of the Mobility Service Contract."}]}]'::jsonb
FROM public.doc_templates WHERE code = 'CHARTER_RATE_CARD';

-- Tax Invoice v0.1 draft (layout only)
INSERT INTO public.doc_template_versions (template_id, version, status, source_status, notes, variables, body)
SELECT id, 'v0.1', 'DRAFT', 'SOURCE_DOCUMENT_REQUIRED',
  'Layout skeleton only. The authoritative invoice source document has not been supplied, so no tax rates, numbering series or figures were entered.',
  '[{"key":"invoice_number","label":"Invoice number","required":true},
    {"key":"invoice_date","label":"Invoice date","required":true},
    {"key":"customer_legal_name","label":"Customer legal name","required":true},
    {"key":"customer_pin","label":"Customer KRA PIN","required":true},
    {"key":"po_reference","label":"PO / LPO reference","required":false},
    {"key":"service_order_reference","label":"Service order reference","required":true},
    {"key":"due_date","label":"Due date","required":true}]'::jsonb,
  '[{"article":1,"title":"Issuer and Recipient","clauses":[{"no":"1.1","text":"Yalla Beena Limited (Trading as Yalla Mobility) issuer block with registered office, PIN and contact details; customer legal name, PIN and billing address."}]},
    {"article":2,"title":"Invoice Identity","clauses":[{"no":"2.1","text":"Invoice number, invoice date, due date, contract reference, PO/LPO reference and service order reference."}]},
    {"article":3,"title":"Service Lines","clauses":[{"no":"3.1","text":"Table placeholder: description, dates, quantity, unit, rate, line total. Figures come from the delivered service order — none recorded on the template.","table":{"caption":"Service lines","columns":["Description","Dates","Qty","Unit","Rate","Amount"],"rows":[]}}]},
    {"article":4,"title":"Totals and Taxes","clauses":[{"no":"4.1","text":"Subtotal, tax lines, total payable. AWAITING SOURCE DOCUMENT for the statutory tax presentation and numbering series."}]},
    {"article":5,"title":"Payment Instructions","clauses":[{"no":"5.1","text":"Approved payment channels as set out in Article 4.4 of the Mobility Service Contract, and the remittance reference requirement."}]}]'::jsonb
FROM public.doc_templates WHERE code = 'TAX_INVOICE';

INSERT INTO public.doc_template_events (version_id, template_id, event, status_after, note)
SELECT v.id, v.template_id, 'SEEDED', v.status, v.notes
FROM public.doc_template_versions v;