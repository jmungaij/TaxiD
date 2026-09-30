-- P0 fix: three-valued logic made the contract authorization guard fail OPEN.
-- _my_staff_member_id() is NULL for any signed-in user without a staff record, so
-- (owner_staff_id IS NOT NULL AND owner_staff_id = NULL) evaluated to NULL, the whole
-- OR-chain evaluated to NULL, and `IF NOT <guard> THEN return NOT_AUTHORISED` never
-- fired. Force a strict boolean and deny unauthenticated callers explicitly.
CREATE OR REPLACE FUNCTION public._contract_may_activate(_contract public.commercial_contract_instances)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN auth.uid() IS NULL AND coalesce(auth.role()::text,'') <> 'service_role' THEN false
  ELSE coalesce(
      public.has_role(auth.uid(), 'admin')
   OR public.has_role(auth.uid(), 'super_admin')
   OR public.has_staff_permission('staff.commercial.manage')
   OR (_contract.owner_staff_id IS NOT NULL
       AND public._my_staff_member_id() IS NOT NULL
       AND _contract.owner_staff_id = public._my_staff_member_id()),
   false) END;
$function$;

CREATE OR REPLACE FUNCTION public._contract_may_read(_contract public.commercial_contract_instances)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN auth.uid() IS NULL AND coalesce(auth.role()::text,'') <> 'service_role' THEN false
  ELSE coalesce(
      public.has_role(auth.uid(), 'admin')
   OR public.has_role(auth.uid(), 'super_admin')
   OR public.has_staff_permission('staff.commercial.read')
   OR public.has_staff_permission('staff.commercial.manage')
   OR (_contract.owner_staff_id IS NOT NULL
       AND public._my_staff_member_id() IS NOT NULL
       AND _contract.owner_staff_id = public._my_staff_member_id()),
   false) END;
$function$;

REVOKE ALL ON FUNCTION public._contract_may_activate(public.commercial_contract_instances) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._contract_may_read(public.commercial_contract_instances) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._contract_may_activate(public.commercial_contract_instances) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._contract_may_read(public.commercial_contract_instances) TO authenticated, service_role;

-- Defence in depth: the callers must treat a NULL guard as denial too.
CREATE OR REPLACE FUNCTION public.contract_status_set(_contract uuid, _status text, _reason text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE c public.commercial_contract_instances; before_state jsonb;
BEGIN
  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = _contract FOR UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_NOT_FOUND'); END IF;
  IF public._contract_may_activate(c) IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED'); END IF;
  IF c.activated_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_IS_ACTIVATED'); END IF;
  IF _status NOT IN ('draft','internal_review','approved','sent_to_customer','customer_review',
                     'under_negotiation','customer_accepted','signature_pending','partially_signed',
                     'executed','declined') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STATUS_NOT_ALLOWED');
  END IF;

  before_state := to_jsonb(c);
  UPDATE public.commercial_contract_instances SET status = _status, updated_at = now() WHERE id = _contract;

  INSERT INTO public.contract_events
    (contract_id, event_type, from_status, to_status, before_state, after_state, reason, actor_id, actor_staff_id)
  VALUES (_contract, 'STATUS_CHANGED', c.status, _status, before_state,
          jsonb_build_object('status', _status), _reason, auth.uid(), public._my_staff_member_id());

  RETURN jsonb_build_object('ok', true, 'contract_id', _contract, 'status', _status);
END $function$;

CREATE OR REPLACE FUNCTION public.contract_acceptance_record(_contract uuid, _accepted_on date, _accepted_by text, _channel text, _reference text DEFAULT NULL::text, _notes text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE c public.commercial_contract_instances; before_state jsonb; v_doc jsonb;
BEGIN
  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = _contract FOR UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_NOT_FOUND'); END IF;
  IF public._contract_may_activate(c) IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED'); END IF;
  IF coalesce(btrim(_accepted_by), '') = '' OR _accepted_on IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACCEPTANCE_EVIDENCE_REQUIRED',
      'detail', 'Record who accepted on the customer side and the date they accepted.');
  END IF;
  IF coalesce(btrim(_reference), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACCEPTANCE_REFERENCE_REQUIRED',
      'detail', 'Reference the acceptance evidence — the email, letter or signed page it came on.');
  END IF;

  before_state := to_jsonb(c);

  UPDATE public.commercial_contract_instances SET
    customer_signatory = coalesce(customer_signatory, _accepted_by),
    status = CASE WHEN status IN ('contracted','active','completed','terminated','executed') THEN status
                  ELSE 'customer_accepted' END,
    updated_at = now()
  WHERE id = _contract;

  v_doc := public.contract_document_attach(_contract, 'acceptance_evidence', NULL, NULL,
             coalesce(_channel, 'recorded') || ': ' || _reference,
             coalesce(_notes, 'Accepted by ' || _accepted_by || ' on ' || _accepted_on::text));

  INSERT INTO public.contract_events
    (contract_id, event_type, from_status, to_status, before_state, after_state, reason, actor_id, actor_staff_id)
  VALUES (_contract, 'CUSTOMER_ACCEPTED', c.status, 'customer_accepted', before_state,
          jsonb_build_object('accepted_by', _accepted_by, 'accepted_on', _accepted_on,
                             'channel', _channel, 'reference', _reference, 'document', v_doc),
          _notes, auth.uid(), public._my_staff_member_id());

  RETURN jsonb_build_object('ok', true, 'contract_id', _contract, 'status', 'customer_accepted', 'document', v_doc);
END $function$;

CREATE OR REPLACE FUNCTION public.contract_document_attach(_contract uuid, _document_type text, _storage_path text DEFAULT NULL::text, _file_name text DEFAULT NULL::text, _external_reference text DEFAULT NULL::text, _notes text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c public.commercial_contract_instances;
  v_version int;
  v_id uuid;
BEGIN
  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = _contract;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_NOT_FOUND'); END IF;
  IF public._contract_may_activate(c) IS NOT TRUE THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED'); END IF;

  SELECT coalesce(max(version), 0) + 1 INTO v_version
    FROM public.contract_documents WHERE contract_id = _contract AND document_type = _document_type;

  UPDATE public.contract_documents SET status = 'superseded'
   WHERE contract_id = _contract AND document_type = _document_type AND status = 'current';

  INSERT INTO public.contract_documents
    (contract_id, document_type, version, storage_path, file_name, external_reference, notes, uploaded_by)
  VALUES (_contract, _document_type, v_version, _storage_path, _file_name, _external_reference, _notes, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.contract_events
    (contract_id, event_type, from_status, to_status, after_state, reason, actor_id, actor_staff_id)
  VALUES (_contract, 'DOCUMENT_ATTACHED', c.status, c.status,
          jsonb_build_object('document_type', _document_type, 'version', v_version,
                             'storage_path', _storage_path, 'reference', _external_reference),
          _notes, auth.uid(), public._my_staff_member_id());

  RETURN jsonb_build_object('ok', true, 'document_id', v_id, 'version', v_version);
END $function$;

REVOKE ALL ON FUNCTION public.contract_status_set(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contract_acceptance_record(uuid, date, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contract_document_attach(uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_status_set(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contract_acceptance_record(uuid, date, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.contract_document_attach(uuid, text, text, text, text, text) TO authenticated, service_role;