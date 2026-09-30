-- =============================================================
-- Yalla orchestration spine: platform events -> governed staff work
-- =============================================================

CREATE TABLE public.ops_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      text NOT NULL,
  source_portal   text NOT NULL,
  service_line    text,
  chain_stage     text NOT NULL,
  entity_type     text NOT NULL,
  entity_id       uuid,
  entity_ref      text,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  signals         jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  disposition     text NOT NULL,
  ops_queue       text,
  priority        text NOT NULL DEFAULT 'medium',
  sla_minutes     integer NOT NULL DEFAULT 60,
  decision_reasons text[] NOT NULL DEFAULT ARRAY[]::text[],
  dedupe_key      text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_events_disposition_chk CHECK (disposition IN ('auto','staff_work','approval','escalate','notify_only','no_action')),
  CONSTRAINT ops_events_priority_chk CHECK (priority IN ('critical','high','medium','low'))
);

CREATE UNIQUE INDEX ops_events_dedupe_key_idx ON public.ops_events (dedupe_key);
CREATE INDEX ops_events_queue_idx ON public.ops_events (ops_queue, occurred_at DESC);
CREATE INDEX ops_events_entity_idx ON public.ops_events (entity_type, entity_id);

GRANT SELECT ON public.ops_events TO authenticated;
GRANT ALL ON public.ops_events TO service_role;
ALTER TABLE public.ops_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read platform events" ON public.ops_events
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.staff_members s WHERE s.user_id = auth.uid())
         OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Platform admins manage events" ON public.ops_events
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

-- ------------------------------------------------------------------
-- Extend the existing work item spine (no shadow entities created)
-- ------------------------------------------------------------------
ALTER TABLE public.staff_work_items
  ADD COLUMN IF NOT EXISTS source_event_id  uuid REFERENCES public.ops_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ops_queue        text,
  ADD COLUMN IF NOT EXISTS entity_type      text,
  ADD COLUMN IF NOT EXISTS entity_id        uuid,
  ADD COLUMN IF NOT EXISTS entity_ref       text,
  ADD COLUMN IF NOT EXISTS service_line     text,
  ADD COLUMN IF NOT EXISTS lifecycle_state  text NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS required_action  text,
  ADD COLUMN IF NOT EXISTS needs_approval   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_request_id uuid,
  ADD COLUMN IF NOT EXISTS escalation_level integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sla_started_at   timestamptz,
  ADD COLUMN IF NOT EXISTS sla_minutes      integer,
  ADD COLUMN IF NOT EXISTS sla_breached_at  timestamptz,
  ADD COLUMN IF NOT EXISTS resolution       text,
  ADD COLUMN IF NOT EXISTS resolution_notes text,
  ADD COLUMN IF NOT EXISTS closed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS seed_batch       text;

ALTER TABLE public.staff_work_items
  DROP CONSTRAINT IF EXISTS staff_work_items_lifecycle_chk;
ALTER TABLE public.staff_work_items
  ADD CONSTRAINT staff_work_items_lifecycle_chk
  CHECK (lifecycle_state IN ('new','triaged','assigned','in_progress','waiting','escalated','resolved','closed'));

CREATE INDEX IF NOT EXISTS staff_work_items_queue_state_idx ON public.staff_work_items (ops_queue, lifecycle_state);
CREATE INDEX IF NOT EXISTS staff_work_items_entity_idx ON public.staff_work_items (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS staff_work_items_sla_idx ON public.staff_work_items (sla_due_at);

-- ------------------------------------------------------------------
-- Immutable audit of every operational work action
-- ------------------------------------------------------------------
CREATE TABLE public.ops_work_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id  uuid NOT NULL REFERENCES public.staff_work_items(id) ON DELETE CASCADE,
  actor_user_id uuid,
  actor_role    text,
  actor_name    text,
  action        text NOT NULL,
  state_before  text,
  state_after   text,
  reason        text,
  entity_type   text,
  entity_id     uuid,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ops_work_audit_work_idx ON public.ops_work_audit (work_item_id, created_at DESC);
CREATE INDEX ops_work_audit_entity_idx ON public.ops_work_audit (entity_type, entity_id, created_at DESC);

GRANT SELECT ON public.ops_work_audit TO authenticated;
GRANT ALL ON public.ops_work_audit TO service_role;
ALTER TABLE public.ops_work_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read work audit" ON public.ops_work_audit
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.staff_members s WHERE s.user_id = auth.uid())
         OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE OR REPLACE FUNCTION public.ops_block_work_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'ops_work_audit is append-only';
END; $$;

CREATE TRIGGER ops_work_audit_immutable
  BEFORE UPDATE OR DELETE ON public.ops_work_audit
  FOR EACH ROW EXECUTE FUNCTION public.ops_block_work_audit_mutation();

CREATE OR REPLACE FUNCTION public.ops_block_event_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'ops_events is append-only';
END; $$;

CREATE TRIGGER ops_events_immutable
  BEFORE UPDATE OR DELETE ON public.ops_events
  FOR EACH ROW EXECUTE FUNCTION public.ops_block_event_mutation();

-- ------------------------------------------------------------------
-- Queue authority: which roles may work which queue
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_queue_roles(_queue text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _queue
    WHEN 'customer_operations' THEN ARRAY['support_agent','support_lead','operations_admin','admin','super_admin']
    WHEN 'supply_operations'   THEN ARRAY['fleet_manager','operations_admin','operations_manager','admin','super_admin']
    WHEN 'dispatch_fulfilment' THEN ARRAY['dispatcher','operations_manager','operations_admin','admin','super_admin']
    WHEN 'corporate_operations'THEN ARRAY['corporate_admin','operations_admin','admin','super_admin']
    WHEN 'delivery_logistics'  THEN ARRAY['logistics_manager','operations_admin','operations_manager','admin','super_admin']
    WHEN 'rental_leasing'      THEN ARRAY['rental_manager','operations_admin','admin','super_admin']
    WHEN 'charter_aviation'    THEN ARRAY['charter_admin','operations_admin','admin','super_admin']
    WHEN 'finance'             THEN ARRAY['finance_admin','finance_analyst','admin','super_admin']
    WHEN 'trust_safety'        THEN ARRAY['compliance_admin','trust_safety_officer','admin','super_admin']
    WHEN 'sales_revenue'       THEN ARRAY['sales_rep','sales_manager','revenue_admin','admin','super_admin']
    ELSE ARRAY['admin','super_admin']
  END;
$$;

CREATE OR REPLACE FUNCTION public.ops_can_work_queue(_user_id uuid, _queue text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role::text = ANY (public.ops_queue_roles(_queue))
  );
$$;

-- ------------------------------------------------------------------
-- Controlled work transition: the ONLY way staff change work state
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_work_transition(
  _work_item_id uuid,
  _to_state     text,
  _reason       text DEFAULT NULL,
  _assignee_staff_id uuid DEFAULT NULL,
  _resolution   text DEFAULT NULL
) RETURNS public.staff_work_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w public.staff_work_items;
  legal text[];
  actor_role text;
  actor_name text;
BEGIN
  SELECT * INTO w FROM public.staff_work_items WHERE id = _work_item_id FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION 'Work item not found'; END IF;

  IF w.ops_queue IS NOT NULL
     AND NOT public.ops_can_work_queue(auth.uid(), w.ops_queue)
     AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Not authorised to action work in the % queue', w.ops_queue;
  END IF;

  legal := CASE w.lifecycle_state
    WHEN 'new'         THEN ARRAY['triaged','assigned','escalated']
    WHEN 'triaged'     THEN ARRAY['assigned','escalated','waiting']
    WHEN 'assigned'    THEN ARRAY['in_progress','waiting','escalated','triaged']
    WHEN 'in_progress' THEN ARRAY['waiting','escalated','resolved']
    WHEN 'waiting'     THEN ARRAY['in_progress','escalated','resolved']
    WHEN 'escalated'   THEN ARRAY['in_progress','waiting','resolved']
    WHEN 'resolved'    THEN ARRAY['closed','in_progress']
    ELSE ARRAY[]::text[]
  END;

  IF NOT (_to_state = ANY (legal)) THEN
    RAISE EXCEPTION 'Illegal transition % -> %', w.lifecycle_state, _to_state;
  END IF;

  IF _to_state IN ('escalated','waiting','resolved','closed') AND coalesce(btrim(_reason),'') = '' THEN
    RAISE EXCEPTION 'A reason is required to move work to %', _to_state;
  END IF;

  IF _to_state IN ('assigned','in_progress')
     AND coalesce(_assignee_staff_id, w.staff_id) IS NULL THEN
    RAISE EXCEPTION 'Work must have an owner before it can be started';
  END IF;

  SELECT ur.role::text INTO actor_role FROM public.user_roles ur WHERE ur.user_id = auth.uid() LIMIT 1;
  SELECT s.full_name INTO actor_name FROM public.staff_members s WHERE s.user_id = auth.uid() LIMIT 1;

  UPDATE public.staff_work_items SET
    lifecycle_state = _to_state,
    staff_id = coalesce(_assignee_staff_id, staff_id),
    status = CASE _to_state
               WHEN 'in_progress' THEN 'in_progress'
               WHEN 'waiting' THEN 'waiting'
               WHEN 'escalated' THEN 'blocked'
               WHEN 'resolved' THEN 'done'
               WHEN 'closed' THEN 'done'
               ELSE 'todo' END,
    escalation_level = CASE WHEN _to_state = 'escalated' THEN escalation_level + 1 ELSE escalation_level END,
    started_at = CASE WHEN _to_state = 'in_progress' AND started_at IS NULL THEN now() ELSE started_at END,
    completed_at = CASE WHEN _to_state IN ('resolved','closed') THEN coalesce(completed_at, now()) ELSE completed_at END,
    closed_at = CASE WHEN _to_state = 'closed' THEN now() ELSE closed_at END,
    resolution = coalesce(_resolution, resolution),
    resolution_notes = CASE WHEN _to_state IN ('resolved','closed') THEN _reason ELSE resolution_notes END,
    sla_breached_at = CASE
      WHEN sla_breached_at IS NULL AND sla_due_at IS NOT NULL AND now() > sla_due_at THEN now()
      ELSE sla_breached_at END,
    updated_at = now()
  WHERE id = _work_item_id
  RETURNING * INTO w;

  INSERT INTO public.ops_work_audit (
    work_item_id, actor_user_id, actor_role, actor_name, action,
    state_before, state_after, reason, entity_type, entity_id, metadata
  ) VALUES (
    _work_item_id, auth.uid(), actor_role, actor_name, 'work_transition',
    _to_state, _to_state, _reason, w.entity_type, w.entity_id,
    jsonb_build_object('assignee_staff_id', _assignee_staff_id, 'resolution', _resolution, 'queue', w.ops_queue)
  );

  RETURN w;
END; $$;

GRANT EXECUTE ON FUNCTION public.ops_work_transition(uuid, text, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_can_work_queue(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_queue_roles(text) TO authenticated;

-- ------------------------------------------------------------------
-- Queue visibility for the extended work spine
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "Staff can read queue work" ON public.staff_work_items;
CREATE POLICY "Staff can read queue work" ON public.staff_work_items
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (SELECT 1 FROM public.staff_members s WHERE s.id = staff_work_items.staff_id AND s.user_id = auth.uid())
    OR (ops_queue IS NOT NULL AND public.ops_can_work_queue(auth.uid(), ops_queue))
  );

-- ------------------------------------------------------------------
-- Operational SLA projection consumed by the Staff Portal
-- ------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_ops_work_sla
WITH (security_invoker = true) AS
SELECT
  w.id,
  w.title,
  w.ops_queue,
  w.work_kind,
  w.service_line,
  w.entity_type,
  w.entity_id,
  w.entity_ref,
  w.lifecycle_state,
  w.priority,
  w.needs_approval,
  w.escalation_level,
  w.staff_id,
  w.required_action,
  w.source_event_id,
  w.created_at,
  w.sla_started_at,
  w.sla_minutes,
  w.sla_due_at,
  w.completed_at,
  w.closed_at,
  CASE
    WHEN w.lifecycle_state IN ('resolved','closed')
      THEN CASE WHEN w.sla_due_at IS NULL OR coalesce(w.completed_at, w.closed_at) <= w.sla_due_at THEN 'met' ELSE 'breached' END
    WHEN w.sla_due_at IS NULL THEN 'on_track'
    WHEN now() > w.sla_due_at THEN 'breached'
    WHEN w.sla_minutes IS NOT NULL
         AND now() > coalesce(w.sla_started_at, w.created_at) + (w.sla_minutes * 0.8) * interval '1 minute'
      THEN 'at_risk'
    ELSE 'on_track'
  END AS sla_status,
  CASE WHEN w.sla_due_at IS NULL THEN NULL
       ELSE round(extract(epoch FROM (w.sla_due_at - now())) / 60.0)::int END AS remaining_minutes
FROM public.staff_work_items w;

GRANT SELECT ON public.v_ops_work_sla TO authenticated;