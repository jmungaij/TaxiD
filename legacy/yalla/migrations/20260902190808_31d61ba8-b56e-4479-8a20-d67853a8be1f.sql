create or replace function public.logistics_compliance_decide(
  p_package_id uuid,
  p_decision   text,
  p_reason     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_pkg   public.packages;
  v_order public.delivery_orders;
  v_job   uuid;
  v_actor uuid := auth.uid();
BEGIN
  IF NOT public.has_staff_permission('staff.logistics.manage') THEN
    RAISE EXCEPTION 'not_authorised: staff.logistics.manage required' USING ERRCODE = '42501';
  END IF;

  IF p_decision NOT IN ('CLEARED', 'REFUSED') THEN
    RAISE EXCEPTION 'invalid_decision: expected CLEARED or REFUSED' USING ERRCODE = '22023';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'reason_required: a compliance decision must state its basis' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_pkg FROM public.packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'PACKAGE_NOT_FOUND');
  END IF;

  IF v_pkg.status <> 'compliance_hold' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'NOT_ON_HOLD', 'status', v_pkg.status);
  END IF;

  SELECT * INTO v_order FROM public.delivery_orders WHERE id = v_pkg.order_id FOR UPDATE;

  IF p_decision = 'REFUSED' THEN
    UPDATE public.packages SET status = 'cancelled', updated_at = now() WHERE id = v_pkg.id;
    UPDATE public.delivery_orders SET status = 'cancelled', updated_at = now() WHERE id = v_order.id;
    INSERT INTO public.package_events (package_id, event_type, actor_id, notes, metadata)
    VALUES (v_pkg.id, 'compliance_refused', v_actor, p_reason,
            jsonb_build_object('order_number', v_order.order_number, 'decided_by', v_actor));
    RETURN jsonb_build_object('ok', true, 'reason_code', 'REFUSED', 'package_id', v_pkg.id);
  END IF;

  UPDATE public.packages SET status = 'created', updated_at = now() WHERE id = v_pkg.id;
  UPDATE public.delivery_orders
     SET status = CASE WHEN status = 'compliance_review' THEN 'confirmed' ELSE status END,
         metadata = metadata || jsonb_build_object(
           'compliance', jsonb_build_object(
             'decision', 'CLEARED', 'reason', p_reason,
             'decided_by', v_actor, 'decided_at', now())),
         updated_at = now()
   WHERE id = v_order.id;

  INSERT INTO public.package_events (package_id, event_type, actor_id, notes, metadata)
  VALUES (v_pkg.id, 'compliance_cleared', v_actor, p_reason,
          jsonb_build_object('order_number', v_order.order_number, 'decided_by', v_actor));

  SELECT id INTO v_job FROM public.delivery_dispatch_jobs WHERE order_id = v_order.id LIMIT 1;
  IF v_job IS NULL THEN
    INSERT INTO public.delivery_dispatch_jobs (
      order_id, package_id, module, status, priority, sla_deadline,
      required_capacity_kg, origin_lat, origin_lng, destination_lat, destination_lng, metadata)
    VALUES (
      v_order.id, v_pkg.id, v_order.module, 'queued', 3, v_order.sla_deadline,
      v_pkg.weight_kg, v_order.pickup_lat, v_order.pickup_lng, v_pkg.dropoff_lat, v_pkg.dropoff_lng,
      jsonb_build_object('source', 'compliance_clearance', 'order_number', v_order.order_number))
    RETURNING id INTO v_job;
  ELSE
    UPDATE public.delivery_dispatch_jobs
       SET status = CASE WHEN status IN ('compliance_hold', 'on_hold') THEN 'queued' ELSE status END,
           updated_at = now()
     WHERE id = v_job;
  END IF;

  RETURN jsonb_build_object('ok', true, 'reason_code', 'CLEARED',
                            'package_id', v_pkg.id, 'dispatch_job_id', v_job);
END;
$$;

revoke all on function public.logistics_compliance_decide(uuid, text, text) from public;
revoke all on function public.logistics_compliance_decide(uuid, text, text) from anon;
grant execute on function public.logistics_compliance_decide(uuid, text, text) to authenticated;
grant execute on function public.logistics_compliance_decide(uuid, text, text) to service_role;