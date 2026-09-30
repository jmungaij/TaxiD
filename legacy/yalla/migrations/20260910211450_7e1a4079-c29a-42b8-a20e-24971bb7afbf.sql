CREATE OR REPLACE FUNCTION public.driver_payout_recipients()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_rows jsonb;
BEGIN
  IF NOT (public._driver_finance_staff()
          OR public.has_staff_permission('staff.finance.settlement.manage')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'user_id', d.user_id,
           'driver_id', d.id,
           'driver_code', d.driver_code,
           'status', d.status,
           'clearance_state', c.state)), '[]'::jsonb)
    INTO v_rows
    FROM public.drivers d
    LEFT JOIN public.driver_finance_clearances c ON c.driver_id = d.id
   WHERE d.user_id IS NOT NULL;

  RETURN jsonb_build_object('ok', true, 'drivers', v_rows);
END $function$;

REVOKE ALL ON FUNCTION public.driver_payout_recipients() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_payout_recipients() TO authenticated, service_role;