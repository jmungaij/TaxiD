CREATE OR REPLACE FUNCTION public.sales_kpi_close_email_queue(_since date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_queued integer;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;

  WITH inserted AS (
    INSERT INTO public.sales_kpi_close_emails
      (close_id, staff_member_id, grain, period_start, recipient_email, status)
    SELECT c.id, c.staff_member_id, c.grain::text, c.period_start,
           nullif(trim(coalesce(s.work_email,'')),''),
           CASE WHEN nullif(trim(coalesce(s.work_email,'')),'') IS NULL
                THEN 'NO_EMAIL_ON_RECORD' ELSE 'PENDING' END
      FROM public.sales_kpi_closes c
      LEFT JOIN public.staff_members s ON s.id = c.staff_member_id
     WHERE c.period_end >= coalesce(_since, (now() AT TIME ZONE 'Africa/Nairobi')::date)
       AND c.period_start <= (now() AT TIME ZONE 'Africa/Nairobi')::date
       AND c.grain::text IN ('DAY','WEEK','MONTH')
    ON CONFLICT (close_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_queued FROM inserted;

  RETURN jsonb_build_object('ok', true, 'queued', v_queued);
END $$;

REVOKE ALL ON FUNCTION public.sales_kpi_close_email_queue(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_kpi_close_email_queue(date) TO service_role;