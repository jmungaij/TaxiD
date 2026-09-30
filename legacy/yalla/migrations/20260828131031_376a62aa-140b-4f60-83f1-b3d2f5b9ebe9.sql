CREATE OR REPLACE FUNCTION public.capacity_transition(
  _reservation_id uuid, _action text, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v public.capacity_reservations; v_slot public.carrier_capacity_slots; v_bal numeric;
BEGIN
  IF NOT (public.has_staff_permission('staff.logistics.manage') OR public.is_service_context()) THEN
    RETURN jsonb_build_object('ok',false,'code','NOT_AUTHORISED');
  END IF;
  IF _action NOT IN ('RELEASE','COMMIT','CONSUME','EXPIRE') THEN
    RETURN jsonb_build_object('ok',false,'code','UNKNOWN_ACTION');
  END IF;

  SELECT * INTO v FROM public.capacity_reservations WHERE id = _reservation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','RESERVATION_NOT_FOUND'); END IF;
  SELECT * INTO v_slot FROM public.carrier_capacity_slots WHERE id = v.slot_id FOR UPDATE;

  IF _action IN ('RELEASE','EXPIRE') AND v.state NOT IN ('ACTIVE','COMMITTED') THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_TRANSITION','from',v.state);
  END IF;
  IF _action = 'COMMIT' AND v.state <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_TRANSITION','from',v.state);
  END IF;
  IF _action = 'CONSUME' AND v.state NOT IN ('ACTIVE','COMMITTED') THEN
    RETURN jsonb_build_object('ok',false,'code','INVALID_TRANSITION','from',v.state);
  END IF;

  IF _action IN ('RELEASE','EXPIRE') THEN
    UPDATE public.carrier_capacity_slots SET
      reserved_kg  = reserved_kg  - CASE WHEN v.state='ACTIVE' THEN v.qty_kg ELSE 0 END,
      committed_kg = committed_kg - CASE WHEN v.state='COMMITTED' THEN v.qty_kg ELSE 0 END
    WHERE id = v_slot.id;
    UPDATE public.capacity_reservations
       SET state = (CASE WHEN _action='EXPIRE' THEN 'EXPIRED' ELSE 'RELEASED' END)::public.capacity_reservation_state,
           released_at = now(), released_reason = _reason
     WHERE id = v.id RETURNING * INTO v;
  ELSIF _action = 'COMMIT' THEN
    UPDATE public.carrier_capacity_slots
       SET reserved_kg = reserved_kg - v.qty_kg, committed_kg = committed_kg + v.qty_kg
     WHERE id = v_slot.id;
    UPDATE public.capacity_reservations SET state='COMMITTED'::public.capacity_reservation_state
     WHERE id = v.id RETURNING * INTO v;
  ELSE -- CONSUME
    UPDATE public.carrier_capacity_slots SET
      reserved_kg  = reserved_kg  - CASE WHEN v.state='ACTIVE' THEN v.qty_kg ELSE 0 END,
      committed_kg = committed_kg - CASE WHEN v.state='COMMITTED' THEN v.qty_kg ELSE 0 END,
      consumed_kg  = consumed_kg + v.qty_kg
    WHERE id = v_slot.id;
    UPDATE public.capacity_reservations SET state='CONSUMED'::public.capacity_reservation_state
     WHERE id = v.id RETURNING * INTO v;
  END IF;

  SELECT offered_kg - reserved_kg - committed_kg - consumed_kg INTO v_bal
    FROM public.carrier_capacity_slots WHERE id = v_slot.id;

  INSERT INTO public.carrier_capacity_ledger (slot_id, reservation_id, entry_type, qty_kg, balance_after_kg, reason, actor_id, actor_role)
  VALUES (v_slot.id, v.id, _action, v.qty_kg, v_bal, _reason, auth.uid(), 'staff');

  IF _action IN ('RELEASE','EXPIRE') THEN
    PERFORM public.logistics_event_emit_internal('capacity.released','capacity', v.id,
      jsonb_build_object('reservation_id',v.id,'reservation_reference',v.reservation_reference,
        'slot_id',v_slot.id,'carrier_id',v_slot.carrier_id,'qty_kg',v.qty_kg,'reason',_reason),
      v.tenant_id, NULL, NULL, 'staff', auth.uid(), 'production', false,
      jsonb_build_object('table','capacity_reservations','id',v.id),
      'capacity:' || v.id::text || ':released');
  END IF;

  PERFORM public._freight_audit('capacity_reservation', v.id, 'CAPACITY_' || _action, NULL, v.state::text, _reason);
  RETURN jsonb_build_object('ok',true,'reservation_id',v.id,'state',v.state,'remaining_kg',v_bal);
END; $$;
REVOKE ALL ON FUNCTION public.capacity_transition(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.capacity_transition(uuid,text,text) TO authenticated;