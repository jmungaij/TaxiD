CREATE OR REPLACE FUNCTION public.rate_card_review_digest(_card_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v public.commercial_rate_cards; v_lines int; v_prepared text; v_recipients jsonb;
BEGIN
  IF NOT (public._rate_card_can_read() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  SELECT * INTO v FROM public.commercial_rate_cards WHERE id = _card_id;
  IF v.id IS NULL THEN RAISE EXCEPTION 'RATE_CARD_NOT_FOUND'; END IF;

  SELECT count(*) INTO v_lines FROM public.commercial_rate_lines WHERE rate_card_id = v.id;

  SELECT COALESCE(u.email, 'Unknown') INTO v_prepared
    FROM auth.users u WHERE u.id = v.created_by;

  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('email', u.email)), '[]'::jsonb)
    INTO v_recipients
    FROM public.user_roles r
    JOIN auth.users u ON u.id = r.user_id
   WHERE r.role IN ('admin','super_admin')
     AND u.email IS NOT NULL
     AND u.email NOT ILIKE '%yallabeena.info';

  RETURN jsonb_build_object(
    'id', v.id,
    'code', v.code,
    'name', v.name,
    'version', v.version,
    'status', v.status,
    'currency', v.currency,
    'effective_from', v.effective_from,
    'change_reason', v.change_reason,
    'rate_count', v_lines,
    'prepared_by', v_prepared,
    'recipients', v_recipients
  );
END $function$;

REVOKE ALL ON FUNCTION public.rate_card_review_digest(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rate_card_review_digest(uuid) TO authenticated, service_role;