-- Owners can see their own proformas; wider visibility stays with commercial staff.
DROP POLICY IF EXISTS "commercial staff read proformas" ON public.proforma_invoices;
CREATE POLICY "read own or commercial proformas"
  ON public.proforma_invoices FOR SELECT TO authenticated
  USING (
    public.has_staff_permission('staff.commercial.read')
    OR public.is_platform_admin()
    OR (owner_staff_id IS NOT NULL AND public.is_my_staff_record(owner_staff_id))
  );

DROP POLICY IF EXISTS "commercial staff read proforma lines" ON public.proforma_invoice_lines;
CREATE POLICY "read own or commercial proforma lines"
  ON public.proforma_invoice_lines FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.proforma_invoices i
     WHERE i.id = proforma_id
       AND (public.has_staff_permission('staff.commercial.read')
            OR public.is_platform_admin()
            OR (i.owner_staff_id IS NOT NULL AND public.is_my_staff_record(i.owner_staff_id)))
  ));

DROP POLICY IF EXISTS "commercial staff read proforma events" ON public.proforma_invoice_events;
CREATE POLICY "read own or commercial proforma events"
  ON public.proforma_invoice_events FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.proforma_invoices i
     WHERE i.id = proforma_id
       AND (public.has_staff_permission('staff.commercial.read')
            OR public.is_platform_admin()
            OR (i.owner_staff_id IS NOT NULL AND public.is_my_staff_record(i.owner_staff_id)))
  ));

-- Read one: owner, commercial reader, or administrator.
CREATE OR REPLACE FUNCTION public.proforma_get(_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; v_owner uuid;
BEGIN
  SELECT owner_staff_id INTO v_owner FROM public.proforma_invoices WHERE id = _id;
  IF v_owner IS NULL AND NOT EXISTS (SELECT 1 FROM public.proforma_invoices WHERE id = _id) THEN
    RAISE EXCEPTION 'PROFORMA_NOT_FOUND';
  END IF;
  IF NOT (public.has_staff_permission('staff.commercial.read')
          OR public.is_platform_admin()
          OR (v_owner IS NOT NULL AND public.is_my_staff_record(v_owner))) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  SELECT to_jsonb(i)
       || jsonb_build_object(
            'lines', COALESCE((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.line_no)
                                 FROM public.proforma_invoice_lines l WHERE l.proforma_id = i.id), '[]'::jsonb),
            'events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC)
                                 FROM public.proforma_invoice_events e WHERE e.proforma_id = i.id), '[]'::jsonb),
            'can_write', public._proforma_can_write(i.owner_staff_id))
    INTO v FROM public.proforma_invoices i WHERE i.id = _id;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.proforma_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proforma_get(uuid) TO authenticated, service_role;

-- List: own rows for an ordinary employee, everything for a commercial reader.
CREATE OR REPLACE FUNCTION public.proforma_list()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; v_staff uuid := public._my_staff_member_id(); v_wide boolean;
BEGIN
  v_wide := public.has_staff_permission('staff.commercial.read') OR public.is_platform_admin();
  IF NOT v_wide AND v_staff IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  SELECT jsonb_build_object(
    'generated_at', now(),
    'can_create', public._proforma_can_write(v_staff),
    'scope', CASE WHEN v_wide THEN 'all' ELSE 'mine' END,
    'invoices', COALESCE((
      SELECT jsonb_agg(to_jsonb(i) || jsonb_build_object(
               'line_count', (SELECT count(*) FROM public.proforma_invoice_lines l WHERE l.proforma_id = i.id))
             ORDER BY i.created_at DESC)
      FROM public.proforma_invoices i
      WHERE v_wide OR i.owner_staff_id = v_staff), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.proforma_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proforma_list() TO authenticated, service_role;