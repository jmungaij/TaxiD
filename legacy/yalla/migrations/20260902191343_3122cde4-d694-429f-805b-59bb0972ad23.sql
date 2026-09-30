create or replace function public.logistics_pod_capture(_attempt_id uuid, _payload jsonb, _idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
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

  INSERT INTO public.audit_logs (action, entity_type, entity_id, actor_user_id, after_data)
  VALUES ('logistics.delivery.pod_captured','logistics_pod_records', v_pod.id, auth.uid(),
          jsonb_build_object('package_id', v_att.package_id, 'attempt_id', _attempt_id, 'integrity_hash', v_hash));

  RETURN jsonb_build_object('ok',true,'pod_id',v_pod.id,'package_id',v_att.package_id,
                            'custody_event_id', v_custody, 'integrity_hash', v_hash, 'replayed', false);
END;
$fn$;

revoke all on function public.logistics_pod_capture(uuid, jsonb, text) from public;
revoke all on function public.logistics_pod_capture(uuid, jsonb, text) from anon;
grant execute on function public.logistics_pod_capture(uuid, jsonb, text) to authenticated;
grant execute on function public.logistics_pod_capture(uuid, jsonb, text) to service_role;