CREATE OR REPLACE FUNCTION public.logistics_api_authenticate(_client_id text, _secret_sha text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE c public.partner_api_credentials; p public.partners;
BEGIN
  IF NOT public.is_service_context() THEN RAISE EXCEPTION 'service_context_required' USING ERRCODE='42501'; END IF;
  SELECT * INTO c FROM public.partner_api_credentials WHERE client_id = _client_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code','CREDENTIAL_INVALID'); END IF;
  IF c.secret_hash IS DISTINCT FROM _secret_sha THEN RETURN jsonb_build_object('ok', false, 'code','CREDENTIAL_INVALID'); END IF;
  IF c.status = 'revoked' THEN RETURN jsonb_build_object('ok', false, 'code','CREDENTIAL_REVOKED'); END IF;
  IF c.status = 'rotating' AND c.grace_expires_at IS NOT NULL AND c.grace_expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'code','CREDENTIAL_REVOKED');
  END IF;
  SELECT * INTO p FROM public.partners WHERE id = c.partner_id;
  IF NOT FOUND OR p.status::text IN ('suspended','terminated','rejected','offboarded','inactive') THEN
    RETURN jsonb_build_object('ok', false, 'code','CREDENTIAL_REVOKED');
  END IF;
  UPDATE public.partner_api_credentials SET last_used_at = now() WHERE id = c.id;
  RETURN jsonb_build_object('ok', true, 'partner_id', c.partner_id, 'credential_id', c.id,
    'environment', c.environment, 'scopes', to_jsonb(c.scopes), 'tier', c.tier,
    'rate_limit_per_min', c.rate_limit_per_min, 'partner_code', p.partner_code);
END; $function$;