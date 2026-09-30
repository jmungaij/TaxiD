
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
   WHERE coalesce(employment_status, 'active') NOT IN ('terminated','resigned','exited','inactive');

  RETURN jsonb_build_object('ok', true, 'contracts', v_items, 'owners', v_owners,
                            'my_staff_id', public._my_staff_member_id());
END $function$;
