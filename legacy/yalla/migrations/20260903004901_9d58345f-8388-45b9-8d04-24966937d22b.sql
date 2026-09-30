CREATE OR REPLACE FUNCTION public.ai_context_revalidate(_action_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.ai_action_requests; ad public.ai_adapters; c public.ai_context_snapshots;
  v_live jsonb := '{}'::jsonb; v_hash text; v_reasons text[] := ARRAY[]::text[]; v_key text;
BEGIN
  IF NOT (public._ai_is_worker() OR public.ai_ops_is_governor(auth.uid())) THEN
    RAISE EXCEPTION 'Not authorised to revalidate AI action context';
  END IF;
  SELECT * INTO a FROM public.ai_action_requests WHERE id = _action_request_id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Unknown action request'; END IF;
  SELECT * INTO ad FROM public.ai_adapters WHERE action_type = a.action_type AND active;
  SELECT * INTO c FROM public.ai_context_snapshots WHERE id = a.context_snapshot_id;

  IF ad.id IS NULL THEN
    v_reasons := array_append(v_reasons, 'NO_ADAPTER');
  ELSIF NOT ad.automation_allowed THEN
    v_reasons := array_append(v_reasons, 'AUTOMATION_NOT_PERMITTED');
  ELSE
    FOREACH v_key IN ARRAY ad.required_payload_keys LOOP
      IF coalesce(a.payload->>v_key,'') = '' THEN
        v_reasons := array_append(v_reasons, 'MISSING_PAYLOAD_' || upper(v_key));
      END IF;
    END LOOP;
  END IF;

  IF a.expires_at IS NOT NULL AND a.expires_at < now() THEN
    v_reasons := array_append(v_reasons, 'ACTION_EXPIRED');
  END IF;

  IF coalesce(ad.revalidation_kind,'NONE') = 'DISPATCH_REQUEST'
     AND (a.payload->>'dispatch_request_id') IS NOT NULL THEN
    SELECT jsonb_build_object('status', d.status,
             'assigned_vehicle_id', d.assigned_vehicle_id,
             'assigned_driver_id', d.assigned_driver_id)
      INTO v_live
      FROM public.logistics_dispatch_requests d
     WHERE d.id = (a.payload->>'dispatch_request_id')::uuid;
    IF v_live IS NULL THEN
      v_reasons := array_append(v_reasons, 'ENTITY_NOT_FOUND');
      v_live := '{}'::jsonb;
    END IF;
  END IF;

  v_hash := public.ai_context_hash(v_live);

  IF c.id IS NULL THEN
    v_reasons := array_append(v_reasons, 'NO_CONTEXT_SNAPSHOT');
  ELSIF c.snapshot ? 'revalidation_subject'
        AND public.ai_context_hash(c.snapshot->'revalidation_subject') <> v_hash THEN
    v_reasons := array_append(v_reasons, 'CONTEXT_CHANGED');
  END IF;

  IF a.classification = 'APPROVAL_REQUIRED' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.ai_action_approvals ap
       WHERE ap.action_request_id = a.id AND ap.decision = 'APPROVED'
         AND (ap.expires_at IS NULL OR ap.expires_at > now())
         AND (ap.bound_context_hash IS NULL OR ap.bound_context_hash = a.context_hash)
         AND (ap.bound_policy_version IS NULL OR ap.bound_policy_version = a.policy_version)
    ) THEN
      v_reasons := array_append(v_reasons, 'APPROVAL_STALE_OR_MISSING');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'action_request_id', a.id,
    'valid', cardinality(v_reasons) = 0,
    'reasons', to_jsonb(v_reasons),
    'live_state', v_live,
    'live_hash', v_hash,
    'adapter_code', ad.adapter_code,
    'automation_allowed', coalesce(ad.automation_allowed,false));
END $$;

REVOKE ALL ON FUNCTION public.ai_context_revalidate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_context_revalidate(uuid) TO authenticated, service_role;