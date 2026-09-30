-- ============================================================
-- Personal work engine for MyWorkspace
-- Self-created work, one-touch outcome capture, capacity actions
-- ============================================================

-- Resolve the CALLER'S own active staff record. Never accepts an id argument,
-- so it cannot be used to act as another employee.
CREATE OR REPLACE FUNCTION public.staff_self_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.staff_members
   WHERE user_id = auth.uid() AND employment_status = 'active'
   LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.staff_self_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_self_id() TO authenticated, service_role;

-- ------------------------------------------------------------
-- Create work for myself
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_work_create_self(
  p_work_kind        text,
  p_title            text,
  p_required_action  text DEFAULT NULL,
  p_priority         text DEFAULT 'medium',
  p_due_at           timestamptz DEFAULT NULL,
  p_description      text DEFAULT NULL,
  p_account_id       uuid DEFAULT NULL,
  p_contact_id       uuid DEFAULT NULL,
  p_opportunity_id   uuid DEFAULT NULL,
  p_service_line     text DEFAULT NULL,
  p_ops_queue        text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_staff uuid;
  v_unit  uuid;
  v_work  uuid;
  v_ref   text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  v_staff := public.staff_self_id();
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'no_staff_identity';
  END IF;
  IF coalesce(btrim(p_title), '') = '' THEN
    RAISE EXCEPTION 'title_required';
  END IF;
  IF p_work_kind IS NULL OR p_work_kind NOT IN (
    'sales_opportunity','customer_case','approval','reconciliation',
    'operations_task','document_review','training','admin_task'
  ) THEN
    RAISE EXCEPTION 'invalid_work_kind';
  END IF;
  IF coalesce(p_priority, 'medium') NOT IN ('low','medium','high','critical') THEN
    RAISE EXCEPTION 'invalid_priority';
  END IF;

  SELECT unit_id INTO v_unit FROM public.staff_members WHERE id = v_staff;

  -- A customer-linked item must reference a real account.
  IF p_account_id IS NOT NULL THEN
    SELECT account_ref INTO v_ref FROM public.crm_accounts WHERE id = p_account_id;
    IF v_ref IS NULL THEN
      RAISE EXCEPTION 'account_not_found';
    END IF;
  END IF;

  INSERT INTO public.staff_work_items (
    staff_id, unit_id, work_kind, title, description, required_action,
    priority, status, lifecycle_state, assigned_by, assigned_at,
    sla_due_at, next_action, next_action_due,
    entity_type, entity_id, entity_ref, service_line, ops_queue,
    source_table, source_id
  ) VALUES (
    v_staff, v_unit, p_work_kind, btrim(p_title), p_description, p_required_action,
    coalesce(p_priority, 'medium'), 'open', 'assigned', v_uid, now(),
    p_due_at, p_required_action, (p_due_at)::date,
    CASE WHEN p_account_id IS NOT NULL THEN 'crm_account' END,
    p_account_id, v_ref, p_service_line, p_ops_queue,
    CASE WHEN p_account_id IS NOT NULL THEN 'crm_accounts' END,
    p_account_id
  )
  RETURNING id INTO v_work;

  -- Account-linked work is also a governed next action on the account, so the
  -- pipeline view and the personal queue never disagree.
  IF p_account_id IS NOT NULL THEN
    INSERT INTO public.crm_next_actions (
      account_id, opportunity_id, work_item_id, staff_id,
      title, due_at, priority, status, created_by
    ) VALUES (
      p_account_id, p_opportunity_id, v_work, v_staff,
      btrim(p_title), p_due_at, coalesce(p_priority, 'medium'), 'open', v_uid
    );
  END IF;

  INSERT INTO public.ops_work_audit (
    work_item_id, actor_user_id, action, state_after, reason,
    entity_type, entity_id, metadata
  ) VALUES (
    v_work, v_uid, 'self_created', 'assigned', 'staff self-assignment',
    CASE WHEN p_account_id IS NOT NULL THEN 'crm_account' END, p_account_id,
    jsonb_build_object(
      'work_kind', p_work_kind,
      'priority', coalesce(p_priority, 'medium'),
      'contact_id', p_contact_id,
      'opportunity_id', p_opportunity_id,
      'source', 'my_workspace'
    )
  );

  RETURN v_work;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_work_create_self(text,text,text,text,timestamptz,text,uuid,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_work_create_self(text,text,text,text,timestamptz,text,uuid,uuid,uuid,text,text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Record an outcome once; the platform does the rest
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_work_record_outcome(
  p_work_item_id        uuid,
  p_outcome             text,
  p_notes               text DEFAULT NULL,
  p_interaction_type    text DEFAULT NULL,
  p_sentiment           text DEFAULT NULL,
  p_contact_id          uuid DEFAULT NULL,
  p_opportunity_id      uuid DEFAULT NULL,
  p_next_action_title   text DEFAULT NULL,
  p_next_action_due     timestamptz DEFAULT NULL,
  p_next_action_kind    text DEFAULT NULL,
  p_next_action_priority text DEFAULT 'medium'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_staff   uuid;
  v_work    public.staff_work_items;
  v_before  text;
  v_account uuid;
  v_inter   uuid;
  v_next    uuid;
  v_type    text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  v_staff := public.staff_self_id();
  IF v_staff IS NULL THEN
    RAISE EXCEPTION 'no_staff_identity';
  END IF;
  IF coalesce(btrim(p_outcome), '') = '' THEN
    RAISE EXCEPTION 'outcome_required';
  END IF;

  SELECT * INTO v_work FROM public.staff_work_items WHERE id = p_work_item_id;
  IF v_work.id IS NULL THEN
    RAISE EXCEPTION 'work_item_not_found';
  END IF;
  -- Outcomes may only be recorded by the employee who owns the work.
  IF v_work.staff_id IS DISTINCT FROM v_staff THEN
    RAISE EXCEPTION 'not_your_work_item';
  END IF;

  v_before := v_work.lifecycle_state;

  UPDATE public.staff_work_items
     SET lifecycle_state  = 'resolved',
         status           = 'done',
         outcome          = btrim(p_outcome),
         resolution       = btrim(p_outcome),
         resolution_notes = p_notes,
         completed_at     = now(),
         started_at       = coalesce(started_at, now()),
         next_action      = NULLIF(btrim(coalesce(p_next_action_title, '')), ''),
         next_action_due  = (p_next_action_due)::date,
         updated_at       = now()
   WHERE id = p_work_item_id;

  -- Resolve the account either from the work item or from its next-action link.
  v_account := CASE WHEN v_work.entity_type = 'crm_account' THEN v_work.entity_id END;
  IF v_account IS NULL THEN
    SELECT account_id INTO v_account
      FROM public.crm_next_actions WHERE work_item_id = p_work_item_id LIMIT 1;
  END IF;

  -- Close the governed next action that this work item satisfied.
  UPDATE public.crm_next_actions
     SET status = 'done', updated_at = now()
   WHERE work_item_id = p_work_item_id AND status IN ('open', 'in_progress');

  -- Customer-facing work writes to the authoritative account timeline.
  IF v_account IS NOT NULL THEN
    v_type := coalesce(p_interaction_type, 'note');
    IF v_type NOT IN ('email','call','meeting','document_shared','proposal',
                      'customer_response','note','visit') THEN
      v_type := 'note';
    END IF;
    INSERT INTO public.crm_interactions (
      account_id, contact_id, opportunity_id, work_item_id, staff_id,
      interaction_type, direction, subject, summary, outcome, sentiment,
      occurred_at, provenance, created_by
    ) VALUES (
      v_account, p_contact_id, p_opportunity_id, p_work_item_id, v_staff,
      v_type, 'outbound', v_work.title, p_notes, btrim(p_outcome),
      CASE WHEN p_sentiment IN ('positive','neutral','negative') THEN p_sentiment END,
      now(), 'declared', v_uid
    )
    RETURNING id INTO v_inter;
  END IF;

  -- The loop only closes when the next action exists.
  IF coalesce(btrim(coalesce(p_next_action_title, '')), '') <> '' THEN
    v_next := public.staff_work_create_self(
      p_work_kind       => coalesce(p_next_action_kind, v_work.work_kind),
      p_title           => p_next_action_title,
      p_required_action => p_next_action_title,
      p_priority        => coalesce(p_next_action_priority, 'medium'),
      p_due_at          => p_next_action_due,
      p_description     => NULL,
      p_account_id      => v_account,
      p_contact_id      => p_contact_id,
      p_opportunity_id  => p_opportunity_id,
      p_service_line    => v_work.service_line,
      p_ops_queue       => v_work.ops_queue
    );
    IF v_inter IS NOT NULL THEN
      UPDATE public.crm_next_actions
         SET interaction_id = v_inter, updated_at = now()
       WHERE work_item_id = v_next;
    END IF;
  END IF;

  INSERT INTO public.ops_work_audit (
    work_item_id, actor_user_id, action, state_before, state_after, reason,
    entity_type, entity_id, metadata
  ) VALUES (
    p_work_item_id, v_uid, 'outcome_recorded', v_before, 'resolved', btrim(p_outcome),
    CASE WHEN v_account IS NOT NULL THEN 'crm_account' END, v_account,
    jsonb_build_object(
      'interaction_id', v_inter,
      'next_work_item_id', v_next,
      'interaction_type', v_type,
      'source', 'my_workspace'
    )
  );

  RETURN jsonb_build_object(
    'work_item_id', p_work_item_id,
    'account_id', v_account,
    'interaction_id', v_inter,
    'next_work_item_id', v_next
  );
END;
$$;

REVOKE ALL ON FUNCTION public.staff_work_record_outcome(uuid,text,text,text,text,uuid,uuid,text,timestamptz,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_work_record_outcome(uuid,text,text,text,text,uuid,uuid,text,timestamptz,text,text) TO authenticated, service_role;

-- ------------------------------------------------------------
-- Highest-value actions available to me right now (read-only)
-- Every row is derived from real records the caller already owns.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_available_actions(p_limit integer DEFAULT 8)
RETURNS TABLE (
  kind            text,
  title           text,
  reason          text,
  account_id      uuid,
  account_name    text,
  opportunity_id  uuid,
  reference_id    uuid,
  priority        text,
  value_score     numeric,
  suggested_minutes integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_staff uuid := public.staff_self_id();
  v_lim   integer := least(greatest(coalesce(p_limit, 8), 1), 25);
BEGIN
  IF v_staff IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH overdue AS (
    SELECT 'overdue_follow_up'::text AS kind,
           na.title,
           'Committed action is past its due date'::text AS reason,
           na.account_id,
           a.name AS account_name,
           na.opportunity_id,
           na.work_item_id AS reference_id,
           na.priority,
           90::numeric + least(extract(epoch FROM (now() - na.due_at)) / 86400, 10) AS value_score,
           10 AS suggested_minutes
      FROM public.crm_next_actions na
      JOIN public.crm_accounts a ON a.id = na.account_id
     WHERE na.staff_id = v_staff
       AND na.status IN ('open', 'in_progress')
       AND na.due_at IS NOT NULL
       AND na.due_at < now()
  ),
  dormant AS (
    SELECT 'reengage_account'::text,
           ('Re-engage ' || a.name)::text,
           'No recorded interaction in the last 30 days'::text,
           a.id,
           a.name,
           NULL::uuid,
           a.id,
           CASE a.importance_tier WHEN 'strategic' THEN 'high' WHEN 'key' THEN 'high' ELSE 'medium' END,
           60::numeric + CASE a.importance_tier WHEN 'strategic' THEN 20 WHEN 'key' THEN 10 ELSE 0 END,
           15
      FROM public.crm_accounts a
     WHERE a.owner_staff_id = v_staff
       AND NOT EXISTS (
         SELECT 1 FROM public.crm_interactions i
          WHERE i.account_id = a.id AND i.occurred_at > now() - interval '30 days'
       )
  ),
  stalled AS (
    SELECT 'opportunity_without_next_action'::text,
           ('Set the next action on ' || a.name)::text,
           'Active opportunity has no open next action'::text,
           a.id,
           a.name,
           ol.opportunity_id,
           ol.opportunity_id,
           'high'::text,
           75::numeric,
           10
      FROM public.crm_opportunity_links ol
      JOIN public.crm_accounts a ON a.id = ol.account_id
     WHERE ol.owner_staff_id = v_staff
       AND NOT EXISTS (
         SELECT 1 FROM public.crm_next_actions na
          WHERE na.opportunity_id = ol.opportunity_id
            AND na.status IN ('open', 'in_progress')
       )
  ),
  quiet AS (
    SELECT 'prospect_new_account'::text,
           ('Open a conversation with ' || a.name)::text,
           'Account owned by you has no interaction on record'::text,
           a.id,
           a.name,
           NULL::uuid,
           a.id,
           'medium'::text,
           50::numeric,
           15
      FROM public.crm_accounts a
     WHERE a.owner_staff_id = v_staff
       AND a.lifecycle_stage IN ('prospect', 'lead', 'qualified')
       AND NOT EXISTS (SELECT 1 FROM public.crm_interactions i WHERE i.account_id = a.id)
  )
  SELECT * FROM (
    SELECT * FROM overdue
    UNION ALL SELECT * FROM stalled
    UNION ALL SELECT * FROM dormant
    UNION ALL SELECT * FROM quiet
  ) s
  ORDER BY s.value_score DESC, s.title
  LIMIT v_lim;
END;
$$;

REVOKE ALL ON FUNCTION public.staff_available_actions(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_available_actions(integer) TO authenticated, service_role;