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
     encode(sha256(convert_to(v_text, 'UTF8')), 'hex'), auth.uid(),
     p->>'accepted_by_name', p->>'accepted_by_role',
     now(), p->>'accepted_ip', p->>'document_path', 'ACCEPTED')
  ON CONFLICT (carrier_id, declaration_code, declaration_version) DO UPDATE
    SET state = 'ACCEPTED', accepted_at = now(), accepted_by = auth.uid(),
        accepted_by_name = EXCLUDED.accepted_by_name,
        accepted_by_role = EXCLUDED.accepted_by_role,
        declaration_text_hash = EXCLUDED.declaration_text_hash,
        document_path = COALESCE(EXCLUDED.document_path, public.carrier_declarations.document_path),
        updated_at = now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'declaration_id', v_id, 'declaration_code', v_code,
                            'version', v_version, 'text_hash', encode(sha256(convert_to(v_text,'UTF8')),'hex'));
END; $$;

REVOKE ALL ON FUNCTION public.carrier_declaration_accept(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carrier_declaration_accept(jsonb) TO authenticated, service_role;