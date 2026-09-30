
CREATE OR REPLACE FUNCTION public.contract_activation_plan()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_items jsonb := '[]'::jsonb;
  v_owners jsonb := '[]'::jsonb;
  r record;
  gate jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  END IF;

  FOR r IN
    SELECT c.*, s.full_name AS owner_name
      FROM public.commercial_contract_instances c
      LEFT JOIN public.staff_members s ON s.id = c.owner_staff_id
     WHERE c.activated_at IS NULL
       AND c.status NOT IN ('declined','superseded','terminated','expired','completed')
       AND public._contract_may_activate(c)
     ORDER BY c.updated_at DESC
     LIMIT 200
  LOOP
    gate := public.contract_activation_check(r.id);
    v_items := v_items || jsonb_build_object(
      'contract_id', r.id,
      'contract_number', r.contract_number,
      'title', r.title,
      'customer', r.customer_legal_name,
      'status', r.status,
      'value_amount', r.value_amount,
      'currency', r.currency,
      'value_type', r.value_type,
      'revenue_period', r.revenue_period,
      'execution_date', r.execution_date,
      'effective_date', r.effective_date,
      'term_start', r.term_start,
      'owner_staff_id', r.owner_staff_id,
      'owner_name', r.owner_name,
      'is_test', r.is_test,
      'can_activate', coalesce((gate->>'can_activate')::boolean, false),
      'blockers', coalesce((
        SELECT jsonb_agg(jsonb_build_object('label', chk->>'label', 'detail', chk->>'detail'))
          FROM jsonb_array_elements(coalesce(gate->'checks','[]'::jsonb)) chk
         WHERE (chk->>'ok')::boolean IS NOT TRUE
      ), '[]'::jsonb)
    );
  END LOOP;

  SELECT coalesce(jsonb_agg(jsonb_build_object('staff_id', id, 'full_name', full_name) ORDER BY full_name), '[]'::jsonb)
    INTO v_owners
    FROM public.staff_members
   WHERE coalesce(status, 'active') = 'active';

  RETURN jsonb_build_object('ok', true, 'contracts', v_items, 'owners', v_owners,
                            'my_staff_id', public._my_staff_member_id());
END $function$;

REVOKE ALL ON FUNCTION public.contract_activation_plan() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_activation_plan() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.contract_activation_plan_apply(
  _contract uuid,
  _service_start date,
  _owner_staff uuid,
  _reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c public.commercial_contract_instances;
  v_res jsonb;
  v_task record;
BEGIN
  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = _contract FOR UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_NOT_FOUND'); END IF;
  IF NOT public._contract_may_activate(c) THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED'); END IF;
  IF _service_start IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'SERVICE_START_REQUIRED'); END IF;
  IF _owner_staff IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'OWNER_REQUIRED'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff_members WHERE id = _owner_staff) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OWNER_NOT_FOUND');
  END IF;

  IF c.activated_at IS NULL THEN
    UPDATE public.commercial_contract_instances
       SET owner_staff_id = _owner_staff,
           effective_date = _service_start,
           term_start = coalesce(term_start, _service_start),
           updated_at = now()
     WHERE id = _contract;
  END IF;

  v_res := public.contract_activate(_contract, coalesce(_reason,
    'Activation plan: service starts ' || to_char(_service_start, 'DD Mon YYYY')));

  IF coalesce((v_res->>'ok')::boolean, false) IS NOT TRUE THEN
    RETURN v_res;
  END IF;

  SELECT id, title, sla_due_at, staff_id INTO v_task
    FROM public.staff_work_items
   WHERE source_table = 'commercial_contract_instances'
     AND source_id = _contract
     AND work_kind = 'contract_onboarding'
   ORDER BY created_at DESC
   LIMIT 1;

  RETURN v_res || jsonb_build_object(
    'service_start', _service_start,
    'owner_staff_id', _owner_staff,
    'onboarding_task', CASE WHEN v_task.id IS NULL THEN NULL ELSE jsonb_build_object(
      'work_item_id', v_task.id, 'title', v_task.title, 'due_at', v_task.sla_due_at,
      'staff_id', v_task.staff_id) END
  );
END $function$;

REVOKE ALL ON FUNCTION public.contract_activation_plan_apply(uuid, date, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_activation_plan_apply(uuid, date, uuid, text) TO authenticated, service_role;
