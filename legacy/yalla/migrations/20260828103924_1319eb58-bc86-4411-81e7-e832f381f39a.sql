
-- ============================================================
-- PHASE 3 SERVER OPERATIONS
-- ============================================================

-- ---------- POD POLICY ----------
CREATE OR REPLACE FUNCTION public.logistics_pod_policy_effective(_offering_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v public.logistics_pod_policies;
BEGIN
  SELECT * INTO v FROM public.logistics_pod_policies
   WHERE offering_code = _offering_code AND status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'configuration_state', 'NOT_CONFIGURED',
      'offering_code', _offering_code,
      'policy', jsonb_build_object(
        'require_signature', false, 'require_photo', false, 'require_recipient_name', true,
        'require_otp', false, 'require_scan', false, 'require_geolocation', true,
        'require_notes', false, 'require_id_reference', false, 'require_recipient_relationship', false,
        'otp_ttl_seconds', 600, 'otp_max_attempts', 5, 'otp_max_resends', 3,
        'requires_inspection_before_disposition', true));
  END IF;
  RETURN jsonb_build_object('ok', true, 'configuration_state', 'CONFIGURED',
    'offering_code', _offering_code, 'policy_id', v.id, 'version', v.version,
    'policy', to_jsonb(v) - 'created_by' - 'activated_by');
END;
$$;

CREATE OR REPLACE FUNCTION public.logistics_pod_policy_upsert(
  _offering_code text, _requirements jsonb, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_version integer; v_row public.logistics_pod_policies;
BEGIN
  IF NOT public.logistics_delivery_authorised('policy') THEN
    RETURN jsonb_build_object('ok', false, 'code','AUTHORIZATION_ERROR','message','Not permitted to change POD policy');
  END IF;
  IF coalesce(_offering_code,'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'code','VALIDATION_ERROR','message','Offering code required');
  END IF;
  SELECT coalesce(max(version),0)+1 INTO v_version FROM public.logistics_pod_policies WHERE offering_code=_offering_code;
  INSERT INTO public.logistics_pod_policies (
    offering_code, version, status, require_signature, require_photo, require_recipient_name,
    require_otp, require_scan, require_geolocation, require_notes, require_id_reference,
    require_recipient_relationship, otp_ttl_seconds, otp_max_attempts, otp_max_resends,
    requires_inspection_before_disposition, notes, created_by)
  VALUES (_offering_code, v_version, 'draft',
    coalesce((_requirements->>'require_signature')::boolean,false),
    coalesce((_requirements->>'require_photo')::boolean,false),
    coalesce((_requirements->>'require_recipient_name')::boolean,true),
    coalesce((_requirements->>'require_otp')::boolean,false),
    coalesce((_requirements->>'require_scan')::boolean,false),
    coalesce((_requirements->>'require_geolocation')::boolean,true),
    coalesce((_requirements->>'require_notes')::boolean,false),
    coalesce((_requirements->>'require_id_reference')::boolean,false),
    coalesce((_requirements->>'require_recipient_relationship')::boolean,false),
    coalesce((_requirements->>'otp_ttl_seconds')::integer,600),
    coalesce((_requirements->>'otp_max_attempts')::integer,5),
    coalesce((_requirements->>'otp_max_resends')::integer,3),
    coalesce((_requirements->>'requires_inspection_before_disposition')::boolean,true),
    _notes, auth.uid())
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok', true, 'policy_id', v_row.id, 'version', v_row.version, 'status', v_row.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.logistics_pod_policy_activate(_policy_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v public.logistics_pod_policies;
BEGIN
  IF NOT public.logistics_delivery_authorised('policy') THEN
    RETURN jsonb_build_object('ok', false,'code','AUTHORIZATION_ERROR','message','Not permitted to activate POD policy');
  END IF;
  SELECT * INTO v FROM public.logistics_pod_policies WHERE id=_policy_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND','message','Policy not found'); END IF;
  IF v.status <> 'draft' THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_TRANSITION','message','Only a draft policy can be activated');
  END IF;
  UPDATE public.logistics_pod_policies
     SET status='superseded', superseded_by=_policy_id
   WHERE offering_code=v.offering_code AND status='active';
  UPDATE public.logistics_pod_policies
     SET status='active', activated_by=auth.uid(), effective_from=now()
   WHERE id=_policy_id;
  RETURN jsonb_build_object('ok',true,'policy_id',_policy_id,'offering_code',v.offering_code,'version',v.version);
END;
$$;

-- ---------- helper: package offering + actor rights ----------
CREATE OR REPLACE FUNCTION public.logistics_package_offering(_package_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(p.metadata->>'offering_code', p.module, 'PARCEL_STANDARD')
    FROM public.packages p WHERE p.id = _package_id;
$$;

CREATE OR REPLACE FUNCTION public.logistics_package_actor_ok(_package_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.logistics_delivery_authorised('execute')
      OR EXISTS (SELECT 1 FROM public.packages p
                  WHERE p.id=_package_id AND p.assigned_driver_id = auth.uid());
$$;

-- ---------- OTP ----------
CREATE OR REPLACE FUNCTION public.logistics_otp_issue(
  _package_id uuid, _purpose text DEFAULT 'delivery_confirmation', _recipient_phone text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_pkg public.packages; v_pol jsonb; v_existing public.logistics_delivery_otps;
  v_code text; v_salt text; v_id uuid; v_notif uuid; v_status text; v_recent integer;
  v_ttl integer; v_max_attempts integer; v_max_resends integer; v_disclose boolean := false;
BEGIN
  IF NOT public.logistics_package_actor_ok(_package_id) THEN
    RETURN jsonb_build_object('ok',false,'code','AUTHORIZATION_ERROR','message','Not permitted for this package');
  END IF;
  SELECT * INTO v_pkg FROM public.packages WHERE id=_package_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND','message','Package not found'); END IF;

  v_pol := public.logistics_pod_policy_effective(public.logistics_package_offering(_package_id))->'policy';
  v_ttl := coalesce((v_pol->>'otp_ttl_seconds')::integer, 600);
  v_max_attempts := coalesce((v_pol->>'otp_max_attempts')::integer, 5);
  v_max_resends := coalesce((v_pol->>'otp_max_resends')::integer, 3);

  SELECT count(*) INTO v_recent FROM public.logistics_delivery_otps
   WHERE package_id=_package_id AND created_at > now() - interval '10 minutes';
  IF v_recent >= (v_max_resends + 1) THEN
    RETURN jsonb_build_object('ok',false,'code','RATE_LIMITED','message','Too many passcode requests for this package');
  END IF;

  SELECT * INTO v_existing FROM public.logistics_delivery_otps
   WHERE package_id=_package_id AND purpose=_purpose AND status='pending' FOR UPDATE;
  IF FOUND THEN
    UPDATE public.logistics_delivery_otps SET status='invalidated' WHERE id=v_existing.id;
  END IF;

  v_code := lpad((floor(random()*1000000))::int::text, 6, '0');
  v_salt := encode(extensions.gen_random_bytes(16),'hex');

  INSERT INTO public.logistics_delivery_otps (
    package_id, purpose, recipient_phone, recipient_context, code_hash, code_salt,
    max_attempts, max_resends, expires_at, resend_count, last_sent_at, delivery_channel, created_by)
  VALUES (_package_id, _purpose, coalesce(_recipient_phone, v_pkg.recipient_phone),
    jsonb_build_object('recipient_name', v_pkg.recipient_name),
    encode(extensions.digest(v_salt || v_code, 'sha256'), 'hex'), v_salt,
    v_max_attempts, v_max_resends, now() + make_interval(secs => v_ttl),
    coalesce(v_existing.resend_count,0) + CASE WHEN v_existing.id IS NULL THEN 0 ELSE 1 END,
    now(), 'sms', auth.uid())
  RETURNING id INTO v_id;

  v_notif := public._logistics_notify('logistics.otp.generated', _package_id, NULL, NULL, v_id,
    coalesce(_recipient_phone, v_pkg.recipient_phone),
    jsonb_build_object('purpose', _purpose, 'expires_in_seconds', v_ttl));
  SELECT status INTO v_status FROM public.logistics_delivery_notifications WHERE id=v_notif;

  -- Honest fallback: with no configured provider the passcode cannot be sent.
  -- Disclose it to the authorised staff operator (never to a driver) so the
  -- flow can complete out-of-band, and record the disclosure.
  IF v_status = 'provider_configuration_required' AND public.logistics_delivery_authorised('execute') THEN
    v_disclose := true;
    INSERT INTO public.audit_logs (flow, action, entity_type, entity_id, user_id, after_data)
    VALUES ('logistics.delivery','otp_manual_disclosure','logistics_delivery_otps', v_id, auth.uid(),
            jsonb_build_object('package_id', _package_id, 'reason','provider_configuration_required'));
  END IF;

  RETURN jsonb_build_object('ok', true, 'otp_id', v_id, 'expires_in_seconds', v_ttl,
    'delivery_status', v_status,
    'configuration_state', CASE WHEN v_status='provider_configuration_required'
                                THEN 'PROVIDER_CONFIGURATION_REQUIRED' ELSE 'CONFIGURED' END,
    'manual_disclosure', v_disclose,
    'code', CASE WHEN v_disclose THEN v_code ELSE NULL END);
END;
$$;

CREATE OR REPLACE FUNCTION public.logistics_otp_verify(
  _package_id uuid, _code text, _attempt_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v public.logistics_delivery_otps; v_match boolean;
BEGIN
  IF NOT public.logistics_package_actor_ok(_package_id) THEN
    RETURN jsonb_build_object('ok',false,'code','AUTHORIZATION_ERROR','message','Not permitted for this package');
  END IF;
  SELECT * INTO v FROM public.logistics_delivery_otps
   WHERE package_id=_package_id AND status='pending' ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'code','OTP_NOT_ISSUED','message','No active passcode for this package');
  END IF;
  IF _attempt_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.logistics_delivery_attempts a
       WHERE a.id=_attempt_id AND a.package_id=_package_id) THEN
    RETURN jsonb_build_object('ok',false,'code','ATTEMPT_MISMATCH','message','Attempt does not belong to this package');
  END IF;
  IF v.expires_at <= now() THEN
    UPDATE public.logistics_delivery_otps SET status='expired' WHERE id=v.id;
    RETURN jsonb_build_object('ok',false,'code','OTP_EXPIRED','message','The passcode has expired');
  END IF;
  IF v.attempts >= v.max_attempts THEN
    UPDATE public.logistics_delivery_otps SET status='locked' WHERE id=v.id;
    RETURN jsonb_build_object('ok',false,'code','OTP_LOCKED','message','Too many incorrect passcode attempts');
  END IF;

  v_match := (encode(extensions.digest(v.code_salt || coalesce(_code,''), 'sha256'),'hex') = v.code_hash);
  UPDATE public.logistics_delivery_otps
     SET attempts = attempts + 1,
         status = CASE WHEN v_match THEN 'verified'
                       WHEN attempts + 1 >= max_attempts THEN 'locked' ELSE 'pending' END,
         verified_at = CASE WHEN v_match THEN now() ELSE verified_at END,
         attempt_id = coalesce(_attempt_id, attempt_id)
   WHERE id = v.id;

  IF NOT v_match THEN
    RETURN jsonb_build_object('ok',false,'code','OTP_INVALID','message','Incorrect passcode',
                              'attempts_remaining', greatest(v.max_attempts - v.attempts - 1, 0));
  END IF;
  PERFORM public._logistics_notify('logistics.otp.verified', _package_id, _attempt_id, NULL, v.id,
                                   v.recipient_phone, '{}'::jsonb);
  RETURN jsonb_build_object('ok',true,'otp_id',v.id,'verified',true);
END;
$$;

-- ---------- POD CAPTURE ----------
CREATE OR REPLACE FUNCTION public.logistics_pod_capture(
  _attempt_id uuid, _payload jsonb, _idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_att public.logistics_delivery_attempts; v_pkg public.packages;
  v_polrec jsonb; v_pol jsonb; v_pod public.logistics_pod_records;
  v_otp public.logistics_delivery_otps; v_missing text[] := '{}';
  v_offering text; v_file jsonb; v_hash text; v_custody uuid;
BEGIN
  IF _idempotency_key IS NULL OR length(_idempotency_key) < 8 THEN
    RETURN jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Idempotency key required');
  END IF;
  SELECT * INTO v_att FROM public.logistics_delivery_attempts WHERE id=_attempt_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND','message','Delivery attempt not found'); END IF;
  IF NOT public.logistics_package_actor_ok(v_att.package_id) THEN
    RETURN jsonb_build_object('ok',false,'code','AUTHORIZATION_ERROR','message','Not permitted for this package');
  END IF;

  SELECT * INTO v_pod FROM public.logistics_pod_records WHERE attempt_id=_attempt_id;
  IF FOUND THEN
    RETURN jsonb_build_object('ok',true,'replayed',true,'pod_id',v_pod.id,'package_id',v_pod.package_id);
  END IF;

  SELECT * INTO v_pkg FROM public.packages WHERE id=v_att.package_id FOR UPDATE;
  v_offering := public.logistics_package_offering(v_att.package_id);
  v_polrec := public.logistics_pod_policy_effective(v_offering);
  v_pol := v_polrec->'policy';

  IF v_att.outcome <> 'delivered' THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_TRANSITION',
      'message','Proof of delivery can only be captured for a delivered attempt');
  END IF;

  -- policy enforcement
  IF (v_pol->>'require_recipient_name')::boolean AND coalesce(_payload->>'recipient_name','')='' THEN
    v_missing := v_missing || 'recipient_name'; END IF;
  IF (v_pol->>'require_recipient_relationship')::boolean AND coalesce(_payload->>'recipient_relationship','')='' THEN
    v_missing := v_missing || 'recipient_relationship'; END IF;
  IF (v_pol->>'require_id_reference')::boolean AND coalesce(_payload->>'recipient_id_reference','')='' THEN
    v_missing := v_missing || 'recipient_id_reference'; END IF;
  IF (v_pol->>'require_signature')::boolean AND coalesce(_payload->>'signature_ref','')='' THEN
    v_missing := v_missing || 'signature'; END IF;
  IF (v_pol->>'require_scan')::boolean AND coalesce(_payload->>'scanned_barcode','')='' THEN
    v_missing := v_missing || 'scan'; END IF;
  IF (v_pol->>'require_notes')::boolean AND coalesce(_payload->>'notes','')='' THEN
    v_missing := v_missing || 'notes'; END IF;
  IF (v_pol->>'require_geolocation')::boolean AND (_payload->>'lat' IS NULL OR _payload->>'lng' IS NULL) THEN
    v_missing := v_missing || 'geolocation'; END IF;
  IF (v_pol->>'require_photo')::boolean AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(coalesce(_payload->'files','[]'::jsonb)) f
       WHERE f->>'kind' = 'photo') THEN
    v_missing := v_missing || 'photo'; END IF;

  IF (v_pol->>'require_otp')::boolean THEN
    SELECT * INTO v_otp FROM public.logistics_delivery_otps
     WHERE package_id=v_att.package_id AND status='verified'
       AND (attempt_id IS NULL OR attempt_id=_attempt_id)
     ORDER BY verified_at DESC LIMIT 1;
    IF NOT FOUND THEN v_missing := v_missing || 'otp_verification'; END IF;
  END IF;

  IF array_length(v_missing,1) > 0 THEN
    RETURN jsonb_build_object('ok',false,'code','POD_POLICY_UNSATISFIED',
      'message','Required proof of delivery evidence is missing',
      'missing', to_jsonb(v_missing), 'offering_code', v_offering);
  END IF;

  v_hash := encode(extensions.digest(
    _attempt_id::text || v_att.package_id::text || coalesce(_payload::text,'') || now()::text, 'sha256'),'hex');

  INSERT INTO public.logistics_pod_records (
    attempt_id, package_id, order_id, policy_id, policy_version, offering_code,
    recipient_name, recipient_relationship, recipient_id_reference, signature_ref,
    scanned_barcode, otp_id, otp_verified, captured_lat, captured_lng, notes,
    integrity_hash, captured_by)
  VALUES (_attempt_id, v_att.package_id, v_att.order_id,
    nullif(v_polrec->>'policy_id','')::uuid, (v_polrec->>'version')::integer, v_offering,
    _payload->>'recipient_name', _payload->>'recipient_relationship', _payload->>'recipient_id_reference',
    _payload->>'signature_ref', _payload->>'scanned_barcode', v_otp.id, v_otp.id IS NOT NULL,
    (_payload->>'lat')::numeric, (_payload->>'lng')::numeric, _payload->>'notes',
    v_hash, auth.uid())
  RETURNING * INTO v_pod;

  FOR v_file IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'files','[]'::jsonb)) LOOP
    INSERT INTO public.logistics_pod_evidence_files
      (pod_id, package_id, kind, object_ref, content_hash, byte_size, mime_type, uploaded_by)
    VALUES (v_pod.id, v_att.package_id, coalesce(v_file->>'kind','other'),
            coalesce(v_file->>'object_ref','unknown'),
            coalesce(v_file->>'content_hash', encode(extensions.digest(coalesce(v_file->>'object_ref','')||v_pod.id::text,'sha256'),'hex')),
            (v_file->>'byte_size')::bigint, v_file->>'mime_type', auth.uid());
  END LOOP;

  IF v_otp.id IS NOT NULL THEN
    UPDATE public.logistics_delivery_otps
       SET status='consumed', consumed_at=now(), consumed_pod_id=v_pod.id, attempt_id=_attempt_id
     WHERE id=v_otp.id;
  END IF;

  UPDATE public.logistics_delivery_attempts SET pod_id=v_pod.id WHERE id=_attempt_id;

  INSERT INTO public.package_chain_of_custody
    (package_id, event_type, actor_id, actor_label, location_lat, location_lng,
     signature_ref, photo_ref, notes, metadata)
  VALUES (v_att.package_id, 'delivered', auth.uid(), coalesce(v_pod.recipient_name,'recipient'),
          v_pod.captured_lat, v_pod.captured_lng, v_pod.signature_ref,
          (SELECT object_ref FROM public.logistics_pod_evidence_files
            WHERE pod_id=v_pod.id AND kind='photo' LIMIT 1),
          v_pod.notes, jsonb_build_object('pod_id', v_pod.id, 'attempt_id', _attempt_id,
                                          'integrity_hash', v_hash))
  RETURNING id INTO v_custody;

  UPDATE public.packages
     SET status='delivered', delivered_at=coalesce(delivered_at, now()), updated_at=now()
   WHERE id=v_att.package_id;

  PERFORM public._logistics_notify('logistics.delivery.completed', v_att.package_id, _attempt_id, NULL, v_otp.id,
    v_pkg.recipient_phone, jsonb_build_object('pod_id', v_pod.id, 'tracking_number', v_pkg.tracking_number));

  INSERT INTO public.audit_logs (flow, action, entity_type, entity_id, user_id, after_data)
  VALUES ('logistics.delivery','pod_captured','logistics_pod_records', v_pod.id, auth.uid(),
          jsonb_build_object('package_id', v_att.package_id, 'attempt_id', _attempt_id, 'integrity_hash', v_hash));

  RETURN jsonb_build_object('ok',true,'pod_id',v_pod.id,'package_id',v_att.package_id,
                            'custody_event_id', v_custody, 'integrity_hash', v_hash, 'replayed', false);
END;
$$;

-- ---------- DELIVERY OUTCOME ----------
CREATE OR REPLACE FUNCTION public.logistics_delivery_outcome(_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_att public.logistics_delivery_attempts; v_pod_id uuid; v_outcome text; v_pkg public.packages;
BEGIN
  IF NOT public.logistics_package_actor_ok(_package_id) THEN
    RETURN jsonb_build_object('ok',false,'code','AUTHORIZATION_ERROR','message','Not permitted for this package');
  END IF;
  SELECT * INTO v_pkg FROM public.packages WHERE id=_package_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND','message','Package not found'); END IF;
  SELECT * INTO v_att FROM public.logistics_delivery_attempts
   WHERE package_id=_package_id ORDER BY attempt_number DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',true,'outcome','NO_ATTEMPT','package_status',v_pkg.status);
  END IF;
  SELECT id INTO v_pod_id FROM public.logistics_pod_records WHERE attempt_id=v_att.id AND status='active';
  v_outcome := CASE
    WHEN v_att.outcome='delivered' AND v_pod_id IS NOT NULL THEN 'DELIVERED'
    WHEN v_att.outcome='delivered' AND v_pod_id IS NULL THEN 'AWAITING_EVIDENCE'
    WHEN v_att.outcome='refused' THEN 'REFUSED'
    WHEN v_att.outcome='returned' THEN 'RETURN_REQUIRED'
    WHEN v_att.reason_code='RECIPIENT_UNAVAILABLE' THEN 'UNAVAILABLE'
    WHEN v_att.reason_code='DAMAGED_PACKAGE' THEN 'DAMAGED'
    WHEN v_att.reason_code IN ('INVALID_ADDRESS','WRONG_ADDRESS') THEN 'WRONG_ADDRESS'
    WHEN v_att.outcome='failed' THEN 'FAILED'
    ELSE 'OTHER' END;
  RETURN jsonb_build_object('ok',true,'outcome',v_outcome,'attempt_id',v_att.id,
    'attempt_number',v_att.attempt_number,'pod_id',v_pod_id,'package_status',v_pkg.status);
END;
$$;

-- ---------- RETURNS ----------
CREATE OR REPLACE FUNCTION public.logistics_return_authorize(
  _package_id uuid, _reason text, _reason_code text DEFAULT NULL,
  _destination_hub_id uuid DEFAULT NULL, _service_level text DEFAULT NULL,
  _instructions text DEFAULT NULL, _merchant_approval_required boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_ret public.package_returns; v_att public.logistics_delivery_attempts; v_number text; v_exc uuid;
BEGIN
  IF NOT public.logistics_delivery_authorised('returns') THEN
    RETURN jsonb_build_object('ok',false,'code','AUTHORIZATION_ERROR','message','Not permitted to authorise returns');
  END IF;
  IF coalesce(_reason,'')='' THEN
    RETURN jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','A return reason is required');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.packages WHERE id=_package_id) THEN
    RETURN jsonb_build_object('ok',false,'code','NOT_FOUND','message','Package not found');
  END IF;
  SELECT * INTO v_ret FROM public.package_returns
   WHERE package_id=_package_id AND movement_status <> 'CANCELLED'
     AND coalesce(resolution_state,'') = '' LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok',true,'replayed',true,'return_id',v_ret.id,'return_number',v_ret.return_number);
  END IF;
  IF _destination_hub_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.logistics_hubs h
       WHERE h.id=_destination_hub_id AND h.status='active'
         AND 'returns_processing' = ANY(coalesce(h.capabilities,'{}'::text[]))) THEN
    RETURN jsonb_build_object('ok',false,'code','HUB_NOT_ELIGIBLE',
      'message','The destination hub is not active for returns processing');
  END IF;

  SELECT * INTO v_att FROM public.logistics_delivery_attempts
   WHERE package_id=_package_id ORDER BY attempt_number DESC LIMIT 1;
  v_number := 'RET-' || to_char(now(),'YYYYMM') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  INSERT INTO public.package_returns (
    package_id, reason, reason_code, initiated_by, status, return_number,
    authorization_status, authorized_by, authorized_at,
    merchant_approval_required, origin_attempt_id, destination_hub_id,
    return_service_level, return_instructions, movement_status, updated_by)
  VALUES (_package_id, _reason, _reason_code, auth.uid(), 'authorized', v_number,
    CASE WHEN _merchant_approval_required THEN 'pending' ELSE 'authorized' END,
    CASE WHEN _merchant_approval_required THEN NULL ELSE auth.uid() END,
    CASE WHEN _merchant_approval_required THEN NULL ELSE now() END,
    _merchant_approval_required, v_att.id, _destination_hub_id,
    _service_level, _instructions, 'AUTHORIZED', auth.uid())
  RETURNING * INTO v_ret;

  INSERT INTO public.logistics_return_events (return_id, event_name, to_status, note, actor_id, metadata)
  VALUES (v_ret.id, 'return_authorized', 'AUTHORIZED', _reason, auth.uid(),
          jsonb_build_object('reason_code',_reason_code,'origin_attempt_id',v_att.id));

  PERFORM public._logistics_notify('logistics.return.initiated', _package_id, v_att.id, v_ret.id, NULL, NULL,
                                   jsonb_build_object('return_number', v_number));
  RETURN jsonb_build_object('ok',true,'return_id',v_ret.id,'return_number',v_number,
                            'authorization_status', v_ret.authorization_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.logistics_return_merchant_approve(_return_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v public.package_returns;
BEGIN
  IF NOT public.logistics_delivery_authorised('returns') THEN
    RETURN jsonb_build_object('ok',false,'code','AUTHORIZATION_ERROR','message','Not permitted');
  END IF;
  SELECT * INTO v FROM public.package_returns WHERE id=_return_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND','message','Return not found'); END IF;
  IF v.authorization_status <> 'pending' THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_TRANSITION','message','Return is not awaiting approval');
  END IF;
  UPDATE public.package_returns
     SET authorization_status = CASE WHEN _approve THEN 'authorized' ELSE 'rejected' END,
         authorized_by = CASE WHEN _approve THEN auth.uid() ELSE authorized_by END,
         authorized_at = CASE WHEN _approve THEN now() ELSE authorized_at END,
         merchant_approved_by = auth.uid(), merchant_approved_at = now(),
         movement_status = CASE WHEN _approve THEN movement_status ELSE 'CANCELLED' END,
         updated_by = auth.uid(), updated_at = now()
   WHERE id=_return_id;
  INSERT INTO public.logistics_return_events (return_id, event_name, to_status, note, actor_id)
  VALUES (_return_id, CASE WHEN _approve THEN 'merchant_approved' ELSE 'merchant_rejected' END,
          CASE WHEN _approve THEN v.movement_status ELSE 'CANCELLED' END, _note, auth.uid());
  RETURN jsonb_build_object('ok',true,'return_id',_return_id,'approved',_approve);
END;
$$;

CREATE OR REPLACE FUNCTION public.logistics_return_transition(
  _return_id uuid, _to_status text, _note text DEFAULT NULL, _return_route_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v public.package_returns; v_allowed text[];
BEGIN
  IF NOT public.logistics_delivery_authorised('returns') THEN
    RETURN jsonb_build_object('ok',false,'code','AUTHORIZATION_ERROR','message','Not permitted');
  END IF;
  SELECT * INTO v FROM public.package_returns WHERE id=_return_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND','message','Return not found'); END IF;

  v_allowed := CASE v.movement_status
    WHEN 'AUTHORIZED' THEN ARRAY['READY_FOR_RETURN','CANCELLED']
    WHEN 'READY_FOR_RETURN' THEN ARRAY['DISPATCHED','CANCELLED']
    WHEN 'DISPATCHED' THEN ARRAY['IN_TRANSIT','CANCELLED']
    WHEN 'IN_TRANSIT' THEN ARRAY['HUB_RECEIVED']
    ELSE ARRAY[]::text[] END;

  IF NOT (_to_status = ANY(v_allowed)) THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_TRANSITION',
      'message', format('A return in %s cannot move to %s', v.movement_status, _to_status));
  END IF;
  IF _to_status IN ('DISPATCHED','IN_TRANSIT') AND v.authorization_status <> 'authorized' THEN
    RETURN jsonb_build_object('ok',false,'code','NOT_AUTHORIZED',
      'message','A return cannot be dispatched before it is authorised');
  END IF;

  UPDATE public.package_returns
     SET movement_status=_to_status, status=lower(_to_status),
         return_route_id = coalesce(_return_route_id, return_route_id),
         updated_by=auth.uid(), updated_at=now()
   WHERE id=_return_id;
  INSERT INTO public.logistics_return_events (return_id, event_name, from_status, to_status, note, actor_id)
  VALUES (_return_id, 'return_'||lower(_to_status), v.movement_status, _to_status, _note, auth.uid());

  IF _to_status = 'DISPATCHED' THEN
    PERFORM public._logistics_notify('logistics.return.dispatched', v.package_id, NULL, _return_id, NULL, NULL, '{}'::jsonb);
    PERFORM public._logistics_record_custody(v.package_id, 'transit'::custody_event_type, 'return_dispatch', _note);
  END IF;
  RETURN jsonb_build_object('ok',true,'return_id',_return_id,'movement_status',_to_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.logistics_return_receive(
  _return_id uuid, _hub_id uuid, _condition text, _seal_state text DEFAULT 'unknown',
  _seal_id text DEFAULT NULL, _scanned_reference text DEFAULT NULL,
  _notes text DEFAULT NULL, _evidence jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v public.package_returns; v_hub public.logistics_hubs; v_custody uuid; v_receipt uuid;
BEGIN
  IF NOT (public.logistics_delivery_authorised('returns') OR public.logistics_hub_authorised('operate')) THEN
    RETURN jsonb_build_object('ok',false,'code','AUTHORIZATION_ERROR','message','Not permitted to receive returns');
  END IF;
  SELECT * INTO v FROM public.package_returns WHERE id=_return_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND','message','Return not found'); END IF;
  IF v.movement_status NOT IN ('IN_TRANSIT','DISPATCHED') THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_TRANSITION',
      'message','Only a dispatched or in-transit return can be received');
  END IF;
  SELECT * INTO v_hub FROM public.logistics_hubs WHERE id=_hub_id;
  IF NOT FOUND OR v_hub.status <> 'active'
     OR NOT ('returns_processing' = ANY(coalesce(v_hub.capabilities,'{}'::text[]))) THEN
    RETURN jsonb_build_object('ok',false,'code','HUB_NOT_ELIGIBLE',
      'message','This hub is not active for returns processing');
  END IF;
  IF EXISTS (SELECT 1 FROM public.logistics_return_receipts WHERE return_id=_return_id) THEN
    RETURN jsonb_build_object('ok',true,'replayed',true,'return_id',_return_id);
  END IF;

  INSERT INTO public.package_chain_of_custody
    (package_id, event_type, actor_id, actor_label, location_label, seal_id, seal_intact, notes, metadata)
  VALUES (v.package_id, 'warehouse_in', auth.uid(), 'hub_return_receipt', v_hub.code, _seal_id,
          _seal_state = 'intact', _notes, jsonb_build_object('return_id', _return_id, 'hub_id', _hub_id))
  RETURNING id INTO v_custody;

  INSERT INTO public.logistics_return_receipts
    (return_id, package_id, hub_id, received_by, condition, seal_state, seal_id,
     scanned_reference, custody_event_id, evidence, notes)
  VALUES (_return_id, v.package_id, _hub_id, auth.uid(), _condition, coalesce(_seal_state,'unknown'),
          _seal_id, _scanned_reference, v_custody, coalesce(_evidence,'{}'::jsonb), _notes)
  RETURNING id INTO v_receipt;

  UPDATE public.package_returns
     SET movement_status='HUB_RECEIVED', status='hub_received', destination_hub_id=_hub_id,
         updated_by=auth.uid(), updated_at=now()
   WHERE id=_return_id;
  INSERT INTO public.logistics_return_events (return_id, event_name, from_status, to_status, note, actor_id, metadata)
  VALUES (_return_id,'return_hub_received', v.movement_status,'HUB_RECEIVED',_notes,auth.uid(),
          jsonb_build_object('hub_id',_hub_id,'condition',_condition,'seal_state',_seal_state));
  PERFORM public._logistics_notify('logistics.return.received', v.package_id, NULL, _return_id, NULL, NULL,
                                   jsonb_build_object('hub_id',_hub_id));
  RETURN jsonb_build_object('ok',true,'receipt_id',v_receipt,'custody_event_id',v_custody,'movement_status','HUB_RECEIVED');
END;
$$;

CREATE OR REPLACE FUNCTION public.logistics_return_inspect(
  _return_id uuid, _condition text, _damage_found boolean DEFAULT false, _damage_detail text DEFAULT NULL,
  _missing_contents boolean DEFAULT false, _missing_detail text DEFAULT NULL,
  _seal_condition text DEFAULT 'unknown', _packaging_condition text DEFAULT 'unknown',
  _photos jsonb DEFAULT '[]'::jsonb, _notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v public.package_returns; v_receipt uuid; v_id uuid;
BEGIN
  IF NOT (public.logistics_delivery_authorised('returns') OR public.logistics_hub_authorised('operate')) THEN
    RETURN jsonb_build_object('ok',false,'code','AUTHORIZATION_ERROR','message','Not permitted to inspect returns');
  END IF;
  SELECT * INTO v FROM public.package_returns WHERE id=_return_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND','message','Return not found'); END IF;
  IF v.movement_status NOT IN ('HUB_RECEIVED','INSPECTION') THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_TRANSITION',
      'message','A return must be received at a hub before inspection');
  END IF;
  IF _damage_found AND coalesce(_damage_detail,'')='' THEN
    RETURN jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Describe the damage found');
  END IF;
  SELECT id INTO v_receipt FROM public.logistics_return_receipts WHERE return_id=_return_id;

  INSERT INTO public.logistics_return_inspections (
    return_id, receipt_id, package_id, inspector_id, condition, damage_found, damage_detail,
    missing_contents, missing_detail, seal_condition, packaging_condition, photos, notes)
  VALUES (_return_id, v_receipt, v.package_id, auth.uid(), _condition, _damage_found, _damage_detail,
    _missing_contents, _missing_detail, coalesce(_seal_condition,'unknown'),
    coalesce(_packaging_condition,'unknown'), coalesce(_photos,'[]'::jsonb), _notes)
  RETURNING id INTO v_id;

  UPDATE public.package_returns SET movement_status='INSPECTION', status='inspection',
         updated_by=auth.uid(), updated_at=now() WHERE id=_return_id;
  INSERT INTO public.logistics_return_events (return_id, event_name, from_status, to_status, note, actor_id, metadata)
  VALUES (_return_id,'return_inspected', v.movement_status,'INSPECTION',_notes,auth.uid(),
          jsonb_build_object('condition',_condition,'damage_found',_damage_found,'missing_contents',_missing_contents));
  PERFORM public._logistics_notify('logistics.return.inspected', v.package_id, NULL, _return_id, NULL, NULL,
                                   jsonb_build_object('inspection_id', v_id));
  RETURN jsonb_build_object('ok',true,'inspection_id',v_id,'movement_status','INSPECTION');
END;
$$;

CREATE OR REPLACE FUNCTION public.logistics_return_disposition(
  _return_id uuid, _disposition text, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v public.package_returns; v_insp uuid; v_requires boolean; v_id uuid; v_pol jsonb;
BEGIN
  IF NOT public.logistics_delivery_authorised('disposition') THEN
    RETURN jsonb_build_object('ok',false,'code','AUTHORIZATION_ERROR','message','Not permitted to set a disposition');
  END IF;
  SELECT * INTO v FROM public.package_returns WHERE id=_return_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND','message','Return not found'); END IF;
  v_pol := public.logistics_pod_policy_effective(public.logistics_package_offering(v.package_id))->'policy';
  v_requires := coalesce((v_pol->>'requires_inspection_before_disposition')::boolean, true);
  SELECT id INTO v_insp FROM public.logistics_return_inspections
   WHERE return_id=_return_id ORDER BY completed_at DESC LIMIT 1;
  IF v_requires AND v_insp IS NULL THEN
    RETURN jsonb_build_object('ok',false,'code','INSPECTION_REQUIRED',
      'message','Policy requires an inspection before a disposition can be recorded');
  END IF;

  INSERT INTO public.logistics_return_dispositions
    (return_id, inspection_id, package_id, disposition, authorized_by, authorization_note)
  VALUES (_return_id, v_insp, v.package_id, _disposition, auth.uid(), _note)
  RETURNING id INTO v_id;

  UPDATE public.package_returns SET movement_status='DISPOSITION', status='disposition',
         disposition=_disposition, updated_by=auth.uid(), updated_at=now() WHERE id=_return_id;
  INSERT INTO public.logistics_return_events (return_id, event_name, from_status, to_status, note, actor_id, metadata)
  VALUES (_return_id,'return_disposition', v.movement_status,'DISPOSITION',_note,auth.uid(),
          jsonb_build_object('disposition',_disposition,'inspection_id',v_insp));
  PERFORM public._logistics_notify('logistics.return.disposition', v.package_id, NULL, _return_id, NULL, NULL,
                                   jsonb_build_object('disposition',_disposition));
  RETURN jsonb_build_object('ok',true,'disposition_id',v_id,'disposition',_disposition);
END;
$$;

CREATE OR REPLACE FUNCTION public.logistics_return_resolve(
  _return_id uuid, _resolution_state text, _financial_reference text DEFAULT NULL, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v public.package_returns;
BEGIN
  IF NOT public.logistics_delivery_authorised('returns') THEN
    RETURN jsonb_build_object('ok',false,'code','AUTHORIZATION_ERROR','message','Not permitted');
  END IF;
  IF _resolution_state NOT IN ('RESOLVED_DELIVERED','RESOLVED_RETURNED','RESOLVED_REPLACEMENT',
                               'RESOLVED_REFUND','RESOLVED_CLAIM','RESOLVED_CUSTOMER_ACTION_REQUIRED') THEN
    RETURN jsonb_build_object('ok',false,'code','VALIDATION_ERROR','message','Unknown resolution state');
  END IF;
  SELECT * INTO v FROM public.package_returns WHERE id=_return_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND','message','Return not found'); END IF;
  IF v.movement_status <> 'DISPOSITION' THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_TRANSITION',
      'message','A return can only be resolved after its disposition is recorded');
  END IF;
  IF _resolution_state IN ('RESOLVED_REFUND','RESOLVED_CLAIM') AND coalesce(_financial_reference,'')='' THEN
    RETURN jsonb_build_object('ok',false,'code','FINANCIAL_REFERENCE_REQUIRED',
      'message','A refund or claim resolution needs the settlement reference from the finance record');
  END IF;
  UPDATE public.package_returns
     SET movement_status='RESOLVED', status='resolved', resolution_state=_resolution_state,
         financial_reference=_financial_reference, resolution_notes=coalesce(_note, resolution_notes),
         updated_by=auth.uid(), updated_at=now()
   WHERE id=_return_id;
  INSERT INTO public.logistics_return_events (return_id, event_name, from_status, to_status, note, actor_id, metadata)
  VALUES (_return_id,'return_resolved', v.movement_status,'RESOLVED',_note,auth.uid(),
          jsonb_build_object('resolution_state',_resolution_state,'financial_reference',_financial_reference));
  IF v.package_id IS NOT NULL AND _resolution_state='RESOLVED_RETURNED' THEN
    PERFORM public._logistics_record_custody(v.package_id, 'returned'::custody_event_type, 'return_resolved', _note);
    UPDATE public.packages SET status='returned', updated_at=now() WHERE id=v.package_id;
  END IF;
  RETURN jsonb_build_object('ok',true,'return_id',_return_id,'resolution_state',_resolution_state);
END;
$$;

-- ---------- EXECUTE GRANTS (deny by default) ----------
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.logistics_pod_policy_effective(text)',
    'public.logistics_pod_policy_upsert(text,jsonb,text)',
    'public.logistics_pod_policy_activate(uuid)',
    'public.logistics_package_offering(uuid)',
    'public.logistics_package_actor_ok(uuid)',
    'public.logistics_otp_issue(uuid,text,text)',
    'public.logistics_otp_verify(uuid,text,uuid)',
    'public.logistics_pod_capture(uuid,jsonb,text)',
    'public.logistics_delivery_outcome(uuid)',
    'public.logistics_return_authorize(uuid,text,text,uuid,text,text,boolean)',
    'public.logistics_return_merchant_approve(uuid,boolean,text)',
    'public.logistics_return_transition(uuid,text,text,uuid)',
    'public.logistics_return_receive(uuid,uuid,text,text,text,text,text,jsonb)',
    'public.logistics_return_inspect(uuid,text,boolean,text,boolean,text,text,text,jsonb,text)',
    'public.logistics_return_disposition(uuid,text,text)',
    'public.logistics_return_resolve(uuid,text,text,text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;
