CREATE OR REPLACE FUNCTION public.carrier_payable_release(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_id uuid := (p->>'payable_line_id')::uuid;
  v_line public.carrier_payable_lines;
  v_entry uuid;
BEGIN
  IF NOT public.has_staff_permission('staff.finance.charge.manage') THEN
    RETURN jsonb_build_object('error', true, 'code','AUTHORIZATION_ERROR');
  END IF;
  SELECT * INTO v_line FROM public.carrier_payable_lines WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','NOT_FOUND'); END IF;
  IF v_line.state = 'RELEASED' THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'state','RELEASED',
      'ledger_entry_id', v_line.ledger_entry_id, 'net_payable', v_line.net_payable);
  END IF;

  -- partner_ledger_entries.order_id references mobility orders only; freight
  -- delivery orders are carried as the textual reference instead.
  v_entry := public.partner_ledger_post(
    v_line.partner_id, 'supplier_cost'::partner_ledger_kind, 'CREDIT'::ledger_direction,
    v_line.net_payable,
    'Carrier settlement ' || v_line.line_reference || ' (delivery order ' || v_line.order_id::text || ')',
    NULL, NULL, v_line.line_reference,
    'carrier_payable:' || v_line.id::text, true);

  UPDATE public.carrier_payable_lines
     SET state='RELEASED', released_by=auth.uid(), released_at=now(),
         ledger_entry_id=v_entry, updated_at=now()
   WHERE id = v_id;

  RETURN jsonb_build_object('ok', true, 'state','RELEASED', 'payable_line_id', v_id,
    'ledger_entry_id', v_entry, 'net_payable', v_line.net_payable);
END $$;
REVOKE ALL ON FUNCTION public.carrier_payable_release(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.carrier_payable_release(jsonb) TO authenticated, service_role;