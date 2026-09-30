-- =====================================================================
-- FLEET OWNER (CARRIER) ONBOARDING = MARKET-ACCESS COMPLIANCE GATE
-- Extends the existing carrier_* compliance engine. No new compliance,
-- booking, wallet, ledger or settlement engine is created.
-- =====================================================================

-- 1. Responsibility level on existing compliance items -----------------
ALTER TABLE public.carrier_compliance_items
  ADD COLUMN IF NOT EXISTS responsibility_level text NOT NULL DEFAULT 'CARRIER'
    CHECK (responsibility_level IN ('CARRIER','VEHICLE','DRIVER'));

UPDATE public.carrier_compliance_items
   SET responsibility_level = CASE
     WHEN vehicle_id IS NOT NULL THEN 'VEHICLE'
     WHEN driver_user_id IS NOT NULL THEN 'DRIVER'
     ELSE 'CARRIER' END
 WHERE responsibility_level = 'CARRIER';

-- 2. Requirement template catalogue (configurable, not hard-coded law) -
CREATE TABLE IF NOT EXISTS public.carrier_requirement_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_code text NOT NULL UNIQUE,
  requirement_label text NOT NULL,
  category text NOT NULL,
  responsibility_level text NOT NULL CHECK (responsibility_level IN ('CARRIER','VEHICLE','DRIVER')),
  is_mandatory boolean NOT NULL DEFAULT true,
  service_categories text[] NOT NULL DEFAULT '{}',
  evidence_type text NOT NULL,
  issuing_authority_hint text,
  requires_expiry boolean NOT NULL DEFAULT true,
  guidance text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.carrier_requirement_templates TO authenticated;
GRANT ALL ON public.carrier_requirement_templates TO service_role;
ALTER TABLE public.carrier_requirement_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "carrier_req_templates_read" ON public.carrier_requirement_templates
  FOR SELECT TO authenticated USING (active);
CREATE POLICY "carrier_req_templates_staff_write" ON public.carrier_requirement_templates
  FOR ALL TO authenticated
  USING (public.has_staff_permission('staff.logistics.compliance.manage'))
  WITH CHECK (public.has_staff_permission('staff.logistics.compliance.manage'));

-- 3. Fleet Owner declarations (agreement / prohibited goods / indemnity)
CREATE TABLE IF NOT EXISTS public.carrier_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES public.carrier_profiles(id) ON DELETE CASCADE,
  declaration_code text NOT NULL,
  declaration_version text NOT NULL,
  declaration_title text NOT NULL,
  declaration_text_hash text NOT NULL,
  accepted_by uuid,
  accepted_by_name text,
  accepted_by_role text,
  accepted_at timestamptz,
  accepted_ip text,
  document_path text,
  state text NOT NULL DEFAULT 'PENDING'
    CHECK (state IN ('PENDING','ACCEPTED','SUPERSEDED','WITHDRAWN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (carrier_id, declaration_code, declaration_version)
);

GRANT SELECT, INSERT, UPDATE ON public.carrier_declarations TO authenticated;
GRANT ALL ON public.carrier_declarations TO service_role;
ALTER TABLE public.carrier_declarations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "carrier_declarations_own_read" ON public.carrier_declarations
  FOR SELECT TO authenticated
  USING (public._carrier_is_member(carrier_id) OR public.has_staff_permission('staff.logistics.compliance.view'));
CREATE POLICY "carrier_declarations_own_write" ON public.carrier_declarations
  FOR INSERT TO authenticated
  WITH CHECK (public._carrier_is_member(carrier_id) OR public.has_staff_permission('staff.logistics.compliance.manage'));
CREATE POLICY "carrier_declarations_update" ON public.carrier_declarations
  FOR UPDATE TO authenticated
  USING (public._carrier_is_member(carrier_id) OR public.has_staff_permission('staff.logistics.compliance.manage'))
  WITH CHECK (public._carrier_is_member(carrier_id) OR public.has_staff_permission('staff.logistics.compliance.manage'));

-- 4. Settlement destinations nominated DURING onboarding ---------------
CREATE TABLE IF NOT EXISTS public.carrier_settlement_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier_id uuid NOT NULL REFERENCES public.carrier_profiles(id) ON DELETE CASCADE,
  destination_type text NOT NULL CHECK (destination_type IN ('MPESA','BANK')),
  account_name text NOT NULL,
  msisdn text,
  bank_name text,
  bank_branch text,
  bank_account_number text,
  currency text NOT NULL DEFAULT 'KES',
  is_default boolean NOT NULL DEFAULT false,
  verification_state text NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (verification_state IN ('UNVERIFIED','UNDER_REVIEW','VERIFIED','REJECTED','SUSPENDED')),
  verified_by uuid,
  verified_at timestamptz,
  verification_notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carrier_dest_shape CHECK (
    (destination_type = 'MPESA' AND msisdn IS NOT NULL)
    OR (destination_type = 'BANK' AND bank_name IS NOT NULL AND bank_account_number IS NOT NULL)
  )
);

GRANT SELECT, INSERT, UPDATE ON public.carrier_settlement_destinations TO authenticated;
GRANT ALL ON public.carrier_settlement_destinations TO service_role;
ALTER TABLE public.carrier_settlement_destinations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "carrier_dest_read" ON public.carrier_settlement_destinations
  FOR SELECT TO authenticated
  USING (public._carrier_is_member(carrier_id) OR public.has_staff_permission('staff.finance.settlement.view'));
CREATE POLICY "carrier_dest_insert" ON public.carrier_settlement_destinations
  FOR INSERT TO authenticated
  WITH CHECK (public._carrier_is_member(carrier_id) OR public.has_staff_permission('staff.finance.settlement.manage'));
-- Only finance staff may move a destination into VERIFIED; carriers may edit
-- their own unverified rows.
CREATE POLICY "carrier_dest_staff_update" ON public.carrier_settlement_destinations
  FOR UPDATE TO authenticated
  USING (public.has_staff_permission('staff.finance.settlement.manage'))
  WITH CHECK (public.has_staff_permission('staff.finance.settlement.manage'));
CREATE POLICY "carrier_dest_owner_update_unverified" ON public.carrier_settlement_destinations
  FOR UPDATE TO authenticated
  USING (public._carrier_is_member(carrier_id) AND verification_state IN ('UNVERIFIED','REJECTED'))
  WITH CHECK (public._carrier_is_member(carrier_id) AND verification_state IN ('UNVERIFIED','REJECTED'));

CREATE UNIQUE INDEX IF NOT EXISTS carrier_dest_one_default
  ON public.carrier_settlement_destinations (carrier_id) WHERE is_default;

-- 5. Withdrawal requests + append-only event trail --------------------
CREATE TABLE IF NOT EXISTS public.carrier_withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_reference text NOT NULL UNIQUE,
  carrier_id uuid NOT NULL REFERENCES public.carrier_profiles(id) ON DELETE RESTRICT,
  destination_id uuid NOT NULL REFERENCES public.carrier_settlement_destinations(id) ON DELETE RESTRICT,
  amount_kes numeric(14,2) NOT NULL CHECK (amount_kes > 0),
  currency text NOT NULL DEFAULT 'KES',
  available_balance_at_request numeric(14,2),
  state text NOT NULL DEFAULT 'REQUESTED'
    CHECK (state IN ('REQUESTED','UNDER_REVIEW','APPROVED','REJECTED','EXECUTED','CONFIRMED','RECONCILED','CLOSED','FAILED','CANCELLED')),
  idempotency_key text NOT NULL UNIQUE,
  requested_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  authorised_by uuid,
  authorised_at timestamptz,
  executed_at timestamptz,
  payment_evidence jsonb,
  settlement_id uuid,
  failure_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.carrier_withdrawal_requests TO authenticated;
GRANT ALL ON public.carrier_withdrawal_requests TO service_role;
ALTER TABLE public.carrier_withdrawal_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "carrier_wd_read" ON public.carrier_withdrawal_requests
  FOR SELECT TO authenticated
  USING (public._carrier_is_member(carrier_id) OR public.has_staff_permission('staff.finance.settlement.view'));

CREATE TABLE IF NOT EXISTS public.carrier_withdrawal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.carrier_withdrawal_requests(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_state text,
  to_state text,
  actor uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.carrier_withdrawal_events TO authenticated;
GRANT ALL ON public.carrier_withdrawal_events TO service_role;
ALTER TABLE public.carrier_withdrawal_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "carrier_wd_events_read" ON public.carrier_withdrawal_events
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.carrier_withdrawal_requests r
     WHERE r.id = request_id
       AND (public._carrier_is_member(r.carrier_id) OR public.has_staff_permission('staff.finance.settlement.view'))));

CREATE OR REPLACE FUNCTION public._carrier_wd_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'carrier_withdrawal_events is append-only';
END; $$;

DROP TRIGGER IF EXISTS carrier_wd_events_append_only ON public.carrier_withdrawal_events;
CREATE TRIGGER carrier_wd_events_append_only
  BEFORE UPDATE OR DELETE ON public.carrier_withdrawal_events
  FOR EACH ROW EXECUTE FUNCTION public._carrier_wd_events_append_only();

-- touch triggers
CREATE OR REPLACE FUNCTION public._carrier_onboarding_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS t_carrier_req_templates_touch ON public.carrier_requirement_templates;
CREATE TRIGGER t_carrier_req_templates_touch BEFORE UPDATE ON public.carrier_requirement_templates
  FOR EACH ROW EXECUTE FUNCTION public._carrier_onboarding_touch();
DROP TRIGGER IF EXISTS t_carrier_declarations_touch ON public.carrier_declarations;
CREATE TRIGGER t_carrier_declarations_touch BEFORE UPDATE ON public.carrier_declarations
  FOR EACH ROW EXECUTE FUNCTION public._carrier_onboarding_touch();
DROP TRIGGER IF EXISTS t_carrier_dest_touch ON public.carrier_settlement_destinations;
CREATE TRIGGER t_carrier_dest_touch BEFORE UPDATE ON public.carrier_settlement_destinations
  FOR EACH ROW EXECUTE FUNCTION public._carrier_onboarding_touch();
DROP TRIGGER IF EXISTS t_carrier_wd_touch ON public.carrier_withdrawal_requests;
CREATE TRIGGER t_carrier_wd_touch BEFORE UPDATE ON public.carrier_withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION public._carrier_onboarding_touch();

-- 6. Seed the requirement catalogue (configurable) --------------------
INSERT INTO public.carrier_requirement_templates
  (requirement_code, requirement_label, category, responsibility_level, is_mandatory, service_categories, evidence_type, issuing_authority_hint, requires_expiry, guidance)
VALUES
  ('FO-BUSINESS-REG','Certificate of incorporation / business registration','BUSINESS','CARRIER',true,'{}','REGISTRATION','Registrar of Companies',false,'Fleet Owner legal entity evidence.'),
  ('FO-KRA-PIN','KRA PIN certificate','TAX','CARRIER',true,'{}','TAX_CERTIFICATE','Kenya Revenue Authority',false,'Fleet Owner tax identity.'),
  ('FO-CAK-COURIER-LICENCE','Courier operations licence','OPERATING_LICENCE','CARRIER',true,'{PARCEL,EXPRESS,COURIER}','REGULATORY_LICENCE','Communications Authority of Kenya',true,'Required where the Fleet Owner provides courier / parcel services.'),
  ('FO-TRANSPORT-LICENCE','Transport / goods carriage operating authority','OPERATING_LICENCE','CARRIER',true,'{FREIGHT,HAULAGE,PSV}','REGULATORY_LICENCE','NTSA / applicable transport regulator',true,'Fleet Owner authority to provide the transport service.'),
  ('FO-MOTOR-INSURANCE','Fleet motor insurance (commercial)','INSURANCE','CARRIER',true,'{}','INSURANCE_POLICY','Licensed insurer',true,'Fleet-level commercial motor cover.'),
  ('FO-GIT-INSURANCE','Goods-in-transit insurance','INSURANCE','CARRIER',true,'{PARCEL,EXPRESS,COURIER,FREIGHT,HAULAGE}','INSURANCE_POLICY','Licensed insurer',true,'Cargo cover for goods carried.'),
  ('FO-AGREEMENT','Fleet Owner / Transport Service Provider Agreement','CONTRACT','CARRIER',true,'{}','CONTRACT','Yalla Mobility + Fleet Owner',false,'Executed agreement establishing the Fleet Owner as the independent transport service provider.'),
  ('FO-PROHIBITED-GOODS-UNDERTAKING','Restricted & prohibited goods compliance undertaking','DECLARATION','CARRIER',true,'{}','CONTRACT','Fleet Owner',false,'Fleet Owner undertaking covering narcotics, firearms, hazmat, sanctioned, stolen and counterfeit goods.'),
  ('FO-INDEMNITY','Indemnity & responsibility acceptance','DECLARATION','CARRIER',true,'{}','CONTRACT','Fleet Owner',false,'Fleet Owner indemnifies Yalla for breaches attributable to it, its drivers, employees, agents and subcontractors, to the extent permitted by law.'),
  ('FO-SETTLEMENT-DESTINATION','Verified settlement destination (bank and/or M-Pesa)','FINANCE','CARRIER',true,'{}','FINANCIAL_EVIDENCE','Fleet Owner',false,'Nominated during onboarding and verified before any settlement.'),
  ('VEH-REGISTRATION','Vehicle registration / logbook','VEHICLE_DOCUMENT','VEHICLE',true,'{}','REGISTRATION','NTSA',false,'Proves the Fleet Owner owns or controls the vehicle.'),
  ('VEH-INSPECTION','Vehicle inspection certificate','VEHICLE_DOCUMENT','VEHICLE',true,'{}','INSPECTION_CERTIFICATE','NTSA-approved inspection centre',true,'Roadworthiness. Expiry blocks dispatch of this vehicle.'),
  ('VEH-INSURANCE','Vehicle insurance certificate','INSURANCE','VEHICLE',true,'{}','INSURANCE_POLICY','Licensed insurer',true,'Per-vehicle cover. Expiry blocks dispatch of this vehicle.'),
  ('DRV-LICENCE','Driving licence','DRIVER_DOCUMENT','DRIVER',true,'{}','LICENCE','NTSA',true,'Expiry blocks assignment of this driver.'),
  ('DRV-PSV-BADGE','PSV / professional driving badge','DRIVER_DOCUMENT','DRIVER',true,'{PSV,PARCEL,EXPRESS,COURIER,FREIGHT,HAULAGE}','LICENCE','NTSA',true,'Professional eligibility. Expiry blocks assignment of this driver.')
ON CONFLICT (requirement_code) DO NOTHING;

-- 7. Provisioning: instantiate the checklist for the correct entity ----
CREATE OR REPLACE FUNCTION public.carrier_requirements_provision(
  _carrier_id uuid,
  _vehicle_id uuid DEFAULT NULL,
  _driver_user_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_carrier public.carrier_profiles;
  v_level text;
  v_created int := 0;
  r record;
BEGIN
  IF NOT (public._carrier_is_member(_carrier_id)
          OR public.has_staff_permission('staff.logistics.compliance.manage')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  SELECT * INTO v_carrier FROM public.carrier_profiles WHERE id = _carrier_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code', 'UNKNOWN_CARRIER'); END IF;

  IF _vehicle_id IS NOT NULL AND _driver_user_id IS NOT NULL THEN
    RETURN jsonb_build_object('error', true, 'code', 'AMBIGUOUS_SUBJECT');
  END IF;
  v_level := CASE WHEN _vehicle_id IS NOT NULL THEN 'VEHICLE'
                  WHEN _driver_user_id IS NOT NULL THEN 'DRIVER'
                  ELSE 'CARRIER' END;

  FOR r IN
    SELECT * FROM public.carrier_requirement_templates
     WHERE active
       AND responsibility_level = v_level
       AND (service_categories = '{}'::text[]
            OR service_categories && COALESCE(v_carrier.service_categories::text[], '{}'::text[]))
  LOOP
    INSERT INTO public.carrier_compliance_items
      (carrier_id, requirement_code, requirement_label, category, is_mandatory,
       state, responsibility_level, vehicle_id, driver_user_id, issuing_authority)
    SELECT _carrier_id, r.requirement_code, r.requirement_label, r.category, r.is_mandatory,
           'EVIDENCE_REQUIRED', v_level, _vehicle_id, _driver_user_id, r.issuing_authority_hint
     WHERE NOT EXISTS (
       SELECT 1 FROM public.carrier_compliance_items ci
        WHERE ci.carrier_id = _carrier_id
          AND ci.requirement_code = r.requirement_code
          AND COALESCE(ci.vehicle_id, '00000000-0000-0000-0000-000000000000') = COALESCE(_vehicle_id, '00000000-0000-0000-0000-000000000000')
          AND COALESCE(ci.driver_user_id, '00000000-0000-0000-0000-000000000000') = COALESCE(_driver_user_id, '00000000-0000-0000-0000-000000000000'));
    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'level', v_level, 'requirements_ensured', v_created);
END; $$;

REVOKE ALL ON FUNCTION public.carrier_requirements_provision(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.carrier_requirements_provision(uuid, uuid, uuid) TO authenticated, service_role;

-- 8. Entity-level eligibility ----------------------------------------
CREATE OR REPLACE FUNCTION public.carrier_subject_eligibility(
  _carrier_id uuid,
  _level text,
  _vehicle_id uuid DEFAULT NULL,
  _driver_user_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_total int; v_blocking jsonb := '[]'::jsonb; r record;
BEGIN
  SELECT count(*) INTO v_total FROM public.carrier_compliance_items
   WHERE carrier_id = _carrier_id AND is_mandatory AND responsibility_level = _level
     AND COALESCE(vehicle_id, '00000000-0000-0000-0000-000000000000') = COALESCE(_vehicle_id, '00000000-0000-0000-0000-000000000000')
     AND COALESCE(driver_user_id, '00000000-0000-0000-0000-000000000000') = COALESCE(_driver_user_id, '00000000-0000-0000-0000-000000000000');

  IF v_total = 0 THEN
    RETURN jsonb_build_object('eligible', false, 'state', 'REQUIREMENTS_NOT_PROVISIONED',
      'blocking', jsonb_build_array(jsonb_build_object('code','REQUIREMENTS_NOT_PROVISIONED','level',_level)));
  END IF;

  FOR r IN
    SELECT * FROM public.carrier_compliance_items
     WHERE carrier_id = _carrier_id AND is_mandatory AND responsibility_level = _level
       AND COALESCE(vehicle_id, '00000000-0000-0000-0000-000000000000') = COALESCE(_vehicle_id, '00000000-0000-0000-0000-000000000000')
       AND COALESCE(driver_user_id, '00000000-0000-0000-0000-000000000000') = COALESCE(_driver_user_id, '00000000-0000-0000-0000-000000000000')
  LOOP
    IF r.state::text <> 'VERIFIED' THEN
      v_blocking := v_blocking || jsonb_build_object('code','EVIDENCE_' || r.state::text, 'requirement', r.requirement_code);
    ELSIF r.expires_on IS NOT NULL AND r.expires_on < current_date THEN
      v_blocking := v_blocking || jsonb_build_object('code','EVIDENCE_EXPIRED', 'requirement', r.requirement_code, 'expired_on', r.expires_on);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'eligible', jsonb_array_length(v_blocking) = 0,
    'state', CASE WHEN jsonb_array_length(v_blocking) = 0 THEN 'ELIGIBLE' ELSE 'BLOCKED' END,
    'level', _level, 'mandatory_items', v_total, 'blocking', v_blocking, 'evaluated_at', now());
END; $$;

REVOKE ALL ON FUNCTION public.carrier_subject_eligibility(uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.carrier_subject_eligibility(uuid, text, uuid, uuid) TO authenticated, service_role;

-- Fleet Owner matchability = carrier compliance + declarations + verified destination
CREATE OR REPLACE FUNCTION public.carrier_matchability(_carrier_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_compliance jsonb;
  v_blocking jsonb := '[]'::jsonb;
  v_missing_decl text[];
BEGIN
  v_compliance := public.carrier_compliance_state(_carrier_id);
  IF (v_compliance->>'state') <> 'PASS' THEN
    v_blocking := v_blocking || jsonb_build_object('code','CARRIER_COMPLIANCE_' || (v_compliance->>'state'));
  END IF;

  SELECT array_agg(code) INTO v_missing_decl
    FROM (VALUES ('FLEET_OWNER_AGREEMENT'),('PROHIBITED_GOODS_UNDERTAKING'),('INDEMNITY_ACCEPTANCE')) AS t(code)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.carrier_declarations d
      WHERE d.carrier_id = _carrier_id AND d.declaration_code = t.code AND d.state = 'ACCEPTED');

  IF v_missing_decl IS NOT NULL THEN
    v_blocking := v_blocking || jsonb_build_object('code','DECLARATIONS_NOT_ACCEPTED','missing', to_jsonb(v_missing_decl));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.carrier_settlement_destinations
                  WHERE carrier_id = _carrier_id AND verification_state = 'VERIFIED') THEN
    v_blocking := v_blocking || jsonb_build_object('code','SETTLEMENT_DESTINATION_NOT_VERIFIED');
  END IF;

  RETURN jsonb_build_object(
    'matchable', jsonb_array_length(v_blocking) = 0,
    'state', CASE WHEN jsonb_array_length(v_blocking) = 0 THEN 'MATCHABLE' ELSE 'NOT_MATCHABLE' END,
    'compliance', v_compliance, 'blocking', v_blocking, 'evaluated_at', now());
END; $$;

REVOKE ALL ON FUNCTION public.carrier_matchability(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.carrier_matchability(uuid) TO authenticated, service_role;

-- 9. Declaration acceptance ------------------------------------------
CREATE OR REPLACE FUNCTION public.carrier_declaration_accept(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_carrier uuid := (p->>'carrier_id')::uuid;
  v_code text := upper(coalesce(p->>'declaration_code',''));
  v_version text := coalesce(p->>'declaration_version','v1');
  v_title text := coalesce(p->>'declaration_title','');
  v_text text := coalesce(p->>'declaration_text','');
  v_id uuid;
BEGIN
  IF NOT public._carrier_is_member(v_carrier) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  IF v_code NOT IN ('FLEET_OWNER_AGREEMENT','PROHIBITED_GOODS_UNDERTAKING','INDEMNITY_ACCEPTANCE') THEN
    RETURN jsonb_build_object('error', true, 'code','UNKNOWN_DECLARATION');
  END IF;
  IF length(v_text) < 200 THEN
    RETURN jsonb_build_object('error', true, 'code','DECLARATION_TEXT_REQUIRED');
  END IF;

  INSERT INTO public.carrier_declarations
    (carrier_id, declaration_code, declaration_version, declaration_title,
     declaration_text_hash, accepted_by, accepted_by_name, accepted_by_role,
     accepted_at, accepted_ip, document_path, state)
  VALUES
    (v_carrier, v_code, v_version, v_title,
     encode(digest(v_text, 'sha256'), 'hex'), auth.uid(), p->>'accepted_by_name', p->>'accepted_by_role',
     now(), p->>'accepted_ip', p->>'document_path', 'ACCEPTED')
  ON CONFLICT (carrier_id, declaration_code, declaration_version) DO UPDATE
    SET state = 'ACCEPTED', accepted_at = now(), accepted_by = auth.uid(),
        accepted_by_name = EXCLUDED.accepted_by_name,
        accepted_by_role = EXCLUDED.accepted_by_role,
        declaration_text_hash = EXCLUDED.declaration_text_hash,
        document_path = COALESCE(EXCLUDED.document_path, public.carrier_declarations.document_path),
        updated_at = now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'declaration_id', v_id, 'declaration_code', v_code, 'version', v_version);
END; $$;

REVOKE ALL ON FUNCTION public.carrier_declaration_accept(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.carrier_declaration_accept(jsonb) TO authenticated, service_role;

-- 10. Withdrawal orchestration ---------------------------------------
CREATE OR REPLACE FUNCTION public.carrier_withdrawal_request(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_carrier uuid := (p->>'carrier_id')::uuid;
  v_dest uuid := (p->>'destination_id')::uuid;
  v_amount numeric := (p->>'amount_kes')::numeric;
  v_key text := coalesce(p->>'idempotency_key','');
  v_existing public.carrier_withdrawal_requests;
  v_available numeric;
  v_partner uuid;
  v_id uuid;
  v_ref text;
BEGIN
  IF NOT public._carrier_is_member(v_carrier) THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  IF v_key = '' THEN RETURN jsonb_build_object('error', true, 'code','IDEMPOTENCY_KEY_REQUIRED'); END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RETURN jsonb_build_object('error', true, 'code','INVALID_AMOUNT'); END IF;

  SELECT * INTO v_existing FROM public.carrier_withdrawal_requests WHERE idempotency_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'request_id', v_existing.id,
                              'reference', v_existing.request_reference, 'state', v_existing.state);
  END IF;

  IF NOT (public.carrier_matchability(v_carrier)->>'matchable')::boolean THEN
    RETURN jsonb_build_object('error', true, 'code','CARRIER_NOT_IN_GOOD_STANDING',
      'detail', public.carrier_matchability(v_carrier));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.carrier_settlement_destinations
                  WHERE id = v_dest AND carrier_id = v_carrier AND verification_state = 'VERIFIED') THEN
    RETURN jsonb_build_object('error', true, 'code','DESTINATION_NOT_VERIFIED');
  END IF;

  SELECT partner_id INTO v_partner FROM public.carrier_profiles WHERE id = v_carrier;
  SELECT (balance - reserved) INTO v_available FROM public.partner_wallets WHERE partner_id = v_partner;
  IF v_available IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code','WALLET_NOT_CONFIGURED');
  END IF;
  IF v_amount > v_available THEN
    RETURN jsonb_build_object('error', true, 'code','INSUFFICIENT_AVAILABLE_BALANCE',
      'available_kes', v_available, 'requested_kes', v_amount);
  END IF;

  v_ref := 'WDR-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(v_key || v_carrier::text), 1, 6));

  INSERT INTO public.carrier_withdrawal_requests
    (request_reference, carrier_id, destination_id, amount_kes,
     available_balance_at_request, idempotency_key, requested_by, notes)
  VALUES (v_ref, v_carrier, v_dest, v_amount, v_available, v_key, auth.uid(), p->>'notes')
  RETURNING id INTO v_id;

  INSERT INTO public.carrier_withdrawal_events (request_id, event_type, to_state, actor, detail)
  VALUES (v_id, 'REQUESTED', 'REQUESTED', auth.uid(),
          jsonb_build_object('amount_kes', v_amount, 'available_kes', v_available, 'destination_id', v_dest));

  RETURN jsonb_build_object('ok', true, 'request_id', v_id, 'reference', v_ref, 'state','REQUESTED',
                            'admin_alert', true);
END; $$;

REVOKE ALL ON FUNCTION public.carrier_withdrawal_request(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.carrier_withdrawal_request(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.carrier_withdrawal_decide(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid := (p->>'request_id')::uuid;
  v_action text := upper(coalesce(p->>'action',''));
  v_row public.carrier_withdrawal_requests;
  v_next text;
BEGIN
  IF NOT public.has_staff_permission('staff.finance.settlement.manage') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  SELECT * INTO v_row FROM public.carrier_withdrawal_requests WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','UNKNOWN_REQUEST'); END IF;

  v_next := CASE
    WHEN v_action = 'REVIEW'    AND v_row.state = 'REQUESTED' THEN 'UNDER_REVIEW'
    WHEN v_action = 'APPROVE'   AND v_row.state IN ('REQUESTED','UNDER_REVIEW') THEN 'APPROVED'
    WHEN v_action = 'REJECT'    AND v_row.state IN ('REQUESTED','UNDER_REVIEW') THEN 'REJECTED'
    WHEN v_action = 'EXECUTED'  AND v_row.state = 'APPROVED' THEN 'EXECUTED'
    WHEN v_action = 'CONFIRMED' AND v_row.state = 'EXECUTED' THEN 'CONFIRMED'
    WHEN v_action = 'RECONCILED' AND v_row.state = 'CONFIRMED' THEN 'RECONCILED'
    WHEN v_action = 'CLOSE'     AND v_row.state = 'RECONCILED' THEN 'CLOSED'
    WHEN v_action = 'FAIL'      AND v_row.state IN ('APPROVED','EXECUTED') THEN 'FAILED'
    ELSE NULL END;

  IF v_next IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code','INVALID_TRANSITION',
      'from', v_row.state, 'action', v_action);
  END IF;

  IF v_next IN ('EXECUTED','CONFIRMED') AND (p->'payment_evidence') IS NULL AND v_row.payment_evidence IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code','PAYMENT_EVIDENCE_REQUIRED');
  END IF;

  UPDATE public.carrier_withdrawal_requests
     SET state = v_next,
         reviewed_by = CASE WHEN v_next = 'UNDER_REVIEW' THEN auth.uid() ELSE reviewed_by END,
         reviewed_at = CASE WHEN v_next = 'UNDER_REVIEW' THEN now() ELSE reviewed_at END,
         authorised_by = CASE WHEN v_next = 'APPROVED' THEN auth.uid() ELSE authorised_by END,
         authorised_at = CASE WHEN v_next = 'APPROVED' THEN now() ELSE authorised_at END,
         executed_at = CASE WHEN v_next = 'EXECUTED' THEN now() ELSE executed_at END,
         payment_evidence = COALESCE(p->'payment_evidence', payment_evidence),
         failure_reason = CASE WHEN v_next IN ('REJECTED','FAILED') THEN p->>'reason' ELSE failure_reason END
   WHERE id = v_id;

  INSERT INTO public.carrier_withdrawal_events (request_id, event_type, from_state, to_state, actor, detail)
  VALUES (v_id, v_action, v_row.state, v_next, auth.uid(),
          jsonb_strip_nulls(jsonb_build_object('reason', p->>'reason', 'payment_evidence', p->'payment_evidence')));

  RETURN jsonb_build_object('ok', true, 'request_id', v_id, 'state', v_next);
END; $$;

REVOKE ALL ON FUNCTION public.carrier_withdrawal_decide(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.carrier_withdrawal_decide(jsonb) TO authenticated, service_role;

-- 11. Reporting views -------------------------------------------------
CREATE OR REPLACE VIEW public.v_carrier_onboarding_readiness
WITH (security_invoker = true) AS
SELECT c.id AS carrier_id,
       c.carrier_code,
       c.legal_entity_name,
       c.operating_status::text AS operating_status,
       c.contract_status::text AS contract_status,
       (SELECT count(*) FROM public.carrier_compliance_items ci
         WHERE ci.carrier_id = c.id AND ci.is_mandatory AND ci.responsibility_level = 'CARRIER') AS carrier_requirements,
       (SELECT count(*) FROM public.carrier_compliance_items ci
         WHERE ci.carrier_id = c.id AND ci.is_mandatory AND ci.responsibility_level = 'CARRIER'
           AND ci.state::text = 'VERIFIED') AS carrier_verified,
       (SELECT count(*) FROM public.carrier_declarations d
         WHERE d.carrier_id = c.id AND d.state = 'ACCEPTED') AS declarations_accepted,
       (SELECT count(*) FROM public.carrier_settlement_destinations sd
         WHERE sd.carrier_id = c.id AND sd.verification_state = 'VERIFIED') AS verified_destinations
  FROM public.carrier_profiles c;

GRANT SELECT ON public.v_carrier_onboarding_readiness TO authenticated;