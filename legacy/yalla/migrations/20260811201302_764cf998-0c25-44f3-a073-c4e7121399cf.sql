DROP VIEW IF EXISTS public.v_ops_work_sla;
CREATE VIEW public.v_ops_work_sla
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
  w.sla_breached_at,
  w.completed_at,
  w.closed_at,
  w.resolution,
  CASE
    WHEN w.closed_at IS NOT NULL OR w.completed_at IS NOT NULL THEN 'met'
    WHEN w.sla_due_at IS NULL THEN 'unknown'
    WHEN now() > w.sla_due_at THEN 'breached'
    WHEN now() > w.sla_due_at - ((coalesce(w.sla_minutes, 60) * interval '1 minute') * 0.25) THEN 'at_risk'
    ELSE 'on_track'
  END AS sla_status,
  CASE
    WHEN w.sla_due_at IS NULL THEN NULL
    ELSE floor(EXTRACT(epoch FROM (w.sla_due_at - now())) / 60)::integer
  END AS remaining_minutes,
  w.approval_state,
  w.approval_requested_by,
  w.approval_requested_at,
  w.approval_reason,
  w.approval_decided_by,
  w.approval_decided_at,
  w.approval_decision_note,
  w.writeback_outcome,
  w.writeback_applied_at
FROM public.staff_work_items w;

GRANT SELECT ON public.v_ops_work_sla TO authenticated;