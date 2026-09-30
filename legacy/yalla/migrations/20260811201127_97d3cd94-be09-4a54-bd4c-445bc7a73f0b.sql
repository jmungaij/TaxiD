-- =============================================================
-- Stage B: approval binding, canonical write-back, propagation
-- =============================================================

ALTER TABLE public.staff_work_items
  ADD COLUMN IF NOT EXISTS approval_state         text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS approval_requested_by  uuid,
  ADD COLUMN IF NOT EXISTS approval_requested_at  timestamptz,
  ADD COLUMN IF NOT EXISTS approval_reason        text,
  ADD COLUMN IF NOT EXISTS approval_decided_by    uuid,
  ADD COLUMN IF NOT EXISTS approval_decided_at    timestamptz,
  ADD COLUMN IF NOT EXISTS approval_decision_note text,
  ADD COLUMN IF NOT EXISTS writeback_outcome      text,
  ADD COLUMN IF NOT EXISTS writeback_applied_at   timestamptz,
  ADD COLUMN IF NOT EXISTS writeback_result       jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.staff_work_items DROP CONSTRAINT IF EXISTS staff_work_items_approval_state_chk;
ALTER TABLE public.staff_work_items
  ADD CONSTRAINT staff_work_items_approval_state_chk
  CHECK (approval_state IN ('not_required','pending','requested','approved','declined'));

-- ------------------------------------------------------------------
-- Downstream propagation outbox
-- ------------------------------------------------------------------
CREATE TABLE public.ops_propagation_outbox (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id      uuid REFERENCES public.staff_work_items(id) ON DELETE CASCADE,
  ops_event_id      uuid REFERENCES public.ops_events(id) ON DELETE SET NULL,
  audience          text NOT NULL,
  channel           text NOT NULL DEFAULT 'portal',
  recipient_user_id uuid,
  recipient_ref     text,
  entity_type       text,
  entity_id         uuid,
  subject           text NOT NULL,
  message           text NOT NULL,
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  status            text NOT NULL DEFAULT 'pending',
  attempts          integer NOT NULL DEFAULT 0,
  last_error        text,
  read_at           timestamptz,
  processed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ops_prop_audience_chk CHECK (audience IN ('customer','provider','corporate','staff','finance')),
  CONSTRAINT ops_prop_channel_chk  CHECK (channel IN ('portal','email','webhook')),
  CONSTRAINT ops_prop_status_chk   CHECK (status IN ('pending','delivered','skipped','failed'))
);

CREATE INDEX ops_prop_pending_idx   ON public.ops_propagation_outbox (status, created_at);
CREATE INDEX ops_prop_recipient_idx ON public.ops_propagation_outbox (recipient_user_id, created_at DESC);
CREATE INDEX ops_prop_work_idx      ON public.ops_propagation_outbox (work_item_id, created_at DESC);

GRANT SELECT ON public.ops_propagation_outbox TO authenticated;
GRANT ALL    ON public.ops_propagation_outbox TO service_role;
ALTER TABLE public.ops_propagation_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recipients read their notifications" ON public.ops_propagation_outbox
  FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid());

CREATE POLICY "Staff read propagation" ON public.ops_propagation_outbox
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (SELECT 1 FROM public.staff_members s WHERE s.user_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.ops_enqueue_propagation(
  _work_item_id uuid,
  _audience text,
  _subject text,
  _message text,
  _recipient_user_id uuid DEFAULT NULL,
  _recipient_ref text DEFAULT NULL,
  _entity_type text DEFAULT NULL,
  _entity_id uuid DEFAULT NULL,
  _payload jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_id uuid;
BEGIN
  INSERT INTO public.ops_propagation_outbox (
    work_item_id, audience, subject, message, recipient_user_id, recipient_ref,
    entity_type, entity_id, payload
  ) VALUES (
    _work_item_id, _audience, _subject, _message, _recipient_user_id, _recipient_ref,
    _entity_type, _entity_id, coalesce(_payload, '{}'::jsonb)
  ) RETURNING id INTO new_id;
  RETURN new_id;
END; $$;

REVOKE ALL ON FUNCTION public.ops_enqueue_propagation(uuid, text, text, text, uuid, text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ops_enqueue_propagation(uuid, text, text, text, uuid, text, text, uuid, jsonb) TO service_role;

-- ------------------------------------------------------------------
-- Approval binding: maker requests, a different authorised person decides
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_work_request_approval(
  _work_item_id uuid,
  _reason text
) RETURNS public.staff_work_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w public.staff_work_items;
  actor_role text; actor_name text;
BEGIN
  SELECT * INTO w FROM public.staff_work_items WHERE id = _work_item_id FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION 'Work item not found'; END IF;
  IF coalesce(btrim(_reason),'') = '' THEN RAISE EXCEPTION 'A justification is required to request approval'; END IF;
  IF w.ops_queue IS NOT NULL
     AND NOT public.ops_can_work_queue(auth.uid(), w.ops_queue)
     AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Not authorised to action work in the % queue', w.ops_queue;
  END IF;
  IF w.approval_state IN ('approved','declined') THEN
    RAISE EXCEPTION 'This work already carries an authority decision';
  END IF;

  SELECT ur.role::text INTO actor_role FROM public.user_roles ur WHERE ur.user_id = auth.uid() LIMIT 1;
  SELECT s.full_name INTO actor_name FROM public.staff_members s WHERE s.user_id = auth.uid() LIMIT 1;

  UPDATE public.staff_work_items SET
    needs_approval = true,
    approval_state = 'requested',
    approval_requested_by = auth.uid(),
    approval_requested_at = now(),
    approval_reason = _reason,
    updated_at = now()
  WHERE id = _work_item_id
  RETURNING * INTO w;

  INSERT INTO public.ops_work_audit (
    work_item_id, actor_user_id, actor_role, actor_name, action,
    state_before, state_after, reason, entity_type, entity_id, metadata
  ) VALUES (
    _work_item_id, auth.uid(), actor_role, actor_name, 'approval_requested',
    w.lifecycle_state, w.lifecycle_state, _reason, w.entity_type, w.entity_id,
    jsonb_build_object('queue', w.ops_queue)
  );

  RETURN w;
END; $$;

CREATE OR REPLACE FUNCTION public.ops_work_decide_approval(
  _work_item_id uuid,
  _decision text,
  _reason text
) RETURNS public.staff_work_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w public.staff_work_items;
  actor_role text; actor_name text;
BEGIN
  IF _decision NOT IN ('approved','declined') THEN
    RAISE EXCEPTION 'Decision must be approved or declined';
  END IF;
  IF coalesce(btrim(_reason),'') = '' THEN RAISE EXCEPTION 'A reason is required for an authority decision'; END IF;

  SELECT * INTO w FROM public.staff_work_items WHERE id = _work_item_id FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION 'Work item not found'; END IF;
  IF w.approval_state NOT IN ('requested','pending') THEN
    RAISE EXCEPTION 'No approval is awaiting a decision on this work';
  END IF;
  IF w.ops_queue IS NOT NULL
     AND NOT public.ops_can_work_queue(auth.uid(), w.ops_queue)
     AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Not authorised to decide work in the % queue', w.ops_queue;
  END IF;
  IF w.approval_requested_by IS NOT NULL AND w.approval_requested_by = auth.uid() THEN
    RAISE EXCEPTION 'Maker-checker: approval must be decided by a different authorised person';
  END IF;

  SELECT ur.role::text INTO actor_role FROM public.user_roles ur WHERE ur.user_id = auth.uid() LIMIT 1;
  SELECT s.full_name INTO actor_name FROM public.staff_members s WHERE s.user_id = auth.uid() LIMIT 1;

  UPDATE public.staff_work_items SET
    approval_state = _decision,
    approval_decided_by = auth.uid(),
    approval_decided_at = now(),
    approval_decision_note = _reason,
    updated_at = now()
  WHERE id = _work_item_id
  RETURNING * INTO w;

  INSERT INTO public.ops_work_audit (
    work_item_id, actor_user_id, actor_role, actor_name, action,
    state_before, state_after, reason, entity_type, entity_id, metadata
  ) VALUES (
    _work_item_id, auth.uid(), actor_role, actor_name, 'approval_' || _decision,
    w.lifecycle_state, w.lifecycle_state, _reason, w.entity_type, w.entity_id,
    jsonb_build_object('requested_by', w.approval_requested_by, 'queue', w.ops_queue)
  );

  INSERT INTO public.ops_propagation_outbox (
    work_item_id, audience, subject, message, recipient_user_id, entity_type, entity_id, payload
  ) VALUES (
    _work_item_id, 'staff',
    'Authority decision recorded: ' || _decision,
    coalesce(w.title, 'Operational work') || ' — ' || _reason,
    w.approval_requested_by, w.entity_type, w.entity_id,
    jsonb_build_object('decision', _decision, 'queue', w.ops_queue)
  );

  RETURN w;
END; $$;

-- ------------------------------------------------------------------
-- Canonical write-back: permitted outcomes only
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ops_writeback_catalog(_entity_type text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _entity_type
    WHEN 'trip' THEN jsonb_build_object(
      'trip_cancelled', jsonb_build_object('status','cancelled','requires_approval',true,'label','Cancel the trip'),
      'trip_reinstated', jsonb_build_object('status','pending','requires_approval',false,'label','Return the trip to dispatch'),
      'no_change', jsonb_build_object('requires_approval',false,'label','Record decision only'))
    WHEN 'delivery' THEN jsonb_build_object(
      'delivery_reattempt', jsonb_build_object('status','pending','requires_approval',false,'label','Reattempt the delivery'),
      'delivery_returned', jsonb_build_object('status','cancelled','requires_approval',true,'label','Return the consignment'),
      'no_change', jsonb_build_object('requires_approval',false,'label','Record decision only'))
    WHEN 'charter_booking' THEN jsonb_build_object(
      'charter_confirmed', jsonb_build_object('status','confirmed','requires_approval',false,'label','Confirm the charter'),
      'charter_cancelled', jsonb_build_object('status','cancelled','requires_approval',true,'label','Cancel the charter'),
      'no_change', jsonb_build_object('requires_approval',false,'label','Record decision only'))
    WHEN 'document' THEN jsonb_build_object(
      'document_approved', jsonb_build_object('status','approved','requires_approval',false,'label','Approve the document'),
      'document_rejected', jsonb_build_object('status','rejected','requires_approval',true,'label','Reject the document'),
      'no_change', jsonb_build_object('requires_approval',false,'label','Record decision only'))
    ELSE jsonb_build_object(
      'no_change', jsonb_build_object('requires_approval',false,'label','Record decision only'))
  END;
$$;

GRANT EXECUTE ON FUNCTION public.ops_writeback_catalog(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ops_apply_writeback(
  _work_item_id uuid,
  _outcome text,
  _reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w public.staff_work_items;
  spec jsonb;
  target_status text;
  needs_auth boolean;
  actor_role text; actor_name text;
  customer_user uuid;
  applied boolean := false;
BEGIN
  SELECT * INTO w FROM public.staff_work_items WHERE id = _work_item_id FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION 'Work item not found'; END IF;
  IF coalesce(btrim(_reason),'') = '' THEN RAISE EXCEPTION 'A reason is required to write an outcome back'; END IF;
  IF w.ops_queue IS NOT NULL
     AND NOT public.ops_can_work_queue(auth.uid(), w.ops_queue)
     AND NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Not authorised to action work in the % queue', w.ops_queue;
  END IF;
  IF w.writeback_applied_at IS NOT NULL THEN
    RAISE EXCEPTION 'An outcome has already been written back for this work';
  END IF;

  spec := public.ops_writeback_catalog(w.entity_type) -> _outcome;
  IF spec IS NULL THEN
    RAISE EXCEPTION 'Outcome % is not permitted for a % record', _outcome, coalesce(w.entity_type,'unknown');
  END IF;

  needs_auth := coalesce((spec ->> 'requires_approval')::boolean, false) OR w.needs_approval;
  IF needs_auth AND w.approval_state <> 'approved' THEN
    RAISE EXCEPTION 'This outcome requires a recorded approval before it can be applied';
  END IF;

  target_status := spec ->> 'status';

  IF target_status IS NOT NULL AND w.entity_id IS NOT NULL THEN
    IF w.entity_type = 'trip' THEN
      UPDATE public.trip_bookings SET status = target_status, updated_at = now() WHERE id = w.entity_id;
      SELECT t.user_id INTO customer_user FROM public.trip_bookings t WHERE t.id = w.entity_id;
      applied := true;
    ELSIF w.entity_type = 'delivery' THEN
      UPDATE public.delivery_orders SET status = target_status, updated_at = now() WHERE id = w.entity_id;
      SELECT d.user_id INTO customer_user FROM public.delivery_orders d WHERE d.id = w.entity_id;
      applied := true;
    ELSIF w.entity_type = 'charter_booking' THEN
      UPDATE public.charter_bookings SET status = target_status, updated_at = now() WHERE id = w.entity_id;
      SELECT c.user_id INTO customer_user FROM public.charter_bookings c WHERE c.id = w.entity_id;
      applied := true;
    ELSIF w.entity_type = 'document' THEN
      UPDATE public.corporate_documents SET status = target_status, updated_at = now() WHERE id = w.entity_id;
      applied := true;
    END IF;
  END IF;

  UPDATE public.staff_work_items SET
    writeback_outcome = _outcome,
    writeback_applied_at = now(),
    writeback_result = jsonb_build_object(
      'outcome', _outcome, 'canonical_status', target_status, 'applied', applied,
      'entity_type', w.entity_type, 'entity_id', w.entity_id),
    resolution = coalesce(resolution, _outcome),
    resolution_notes = _reason,
    updated_at = now()
  WHERE id = _work_item_id
  RETURNING * INTO w;

  SELECT ur.role::text INTO actor_role FROM public.user_roles ur WHERE ur.user_id = auth.uid() LIMIT 1;
  SELECT s.full_name INTO actor_name FROM public.staff_members s WHERE s.user_id = auth.uid() LIMIT 1;

  INSERT INTO public.ops_work_audit (
    work_item_id, actor_user_id, actor_role, actor_name, action,
    state_before, state_after, reason, entity_type, entity_id, metadata
  ) VALUES (
    _work_item_id, auth.uid(), actor_role, actor_name, 'canonical_writeback',
    w.lifecycle_state, w.lifecycle_state, _reason, w.entity_type, w.entity_id,
    jsonb_build_object('outcome', _outcome, 'canonical_status', target_status, 'applied', applied)
  );

  IF customer_user IS NOT NULL THEN
    INSERT INTO public.ops_propagation_outbox (
      work_item_id, audience, subject, message, recipient_user_id, entity_type, entity_id, payload
    ) VALUES (
      _work_item_id, 'customer',
      'Update on your ' || replace(coalesce(w.entity_type,'booking'), '_', ' '),
      _reason, customer_user, w.entity_type, w.entity_id,
      jsonb_build_object('outcome', _outcome, 'status', target_status)
    );
  END IF;

  INSERT INTO public.ops_propagation_outbox (
    work_item_id, audience, subject, message, recipient_user_id, entity_type, entity_id, payload
  ) VALUES (
    _work_item_id, 'staff',
    'Outcome applied: ' || _outcome,
    coalesce(w.title, 'Operational work') || ' — ' || _reason,
    NULL, w.entity_type, w.entity_id,
    jsonb_build_object('outcome', _outcome, 'queue', w.ops_queue, 'canonical_status', target_status)
  );

  RETURN jsonb_build_object(
    'work_item_id', w.id, 'outcome', _outcome, 'canonical_status', target_status,
    'applied', applied, 'lifecycle_state', w.lifecycle_state);
END; $$;

GRANT EXECUTE ON FUNCTION public.ops_work_request_approval(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_work_decide_approval(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ops_apply_writeback(uuid, text, text) TO authenticated;

-- ------------------------------------------------------------------
-- Recipient-facing notification projection
-- ------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_ops_my_notifications
WITH (security_invoker = true) AS
SELECT p.id, p.audience, p.subject, p.message, p.entity_type, p.entity_id,
       p.payload, p.status, p.read_at, p.created_at
FROM public.ops_propagation_outbox p
WHERE p.recipient_user_id = auth.uid();

GRANT SELECT ON public.v_ops_my_notifications TO authenticated;

CREATE OR REPLACE FUNCTION public.ops_notification_mark_read(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.ops_propagation_outbox
     SET read_at = now()
   WHERE id = _id AND recipient_user_id = auth.uid();
END; $$;

GRANT EXECUTE ON FUNCTION public.ops_notification_mark_read(uuid) TO authenticated;