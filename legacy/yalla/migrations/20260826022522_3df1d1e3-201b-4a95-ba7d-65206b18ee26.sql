-- Revoke default PUBLIC execute on all functions created by the commission/support migration.
REVOKE EXECUTE ON FUNCTION public._sales_commission_audit_immutable() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._sales_commission_event_lock() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._partner_support_resolution_gate() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commission_generate_event(text,text,bigint,date,text,text,text,text,text,uuid,text,numeric,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.commission_submit_event(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.commission_decide_event(uuid,text,text,jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.commission_attribute_payout(uuid) FROM PUBLIC, anon;

-- Reconciliation view must evaluate as the querying user (RLS applies), not as the owner.
CREATE OR REPLACE VIEW public.v_sales_commission_reconciliation
WITH (security_invoker = on) AS
SELECT e.id, e.event_no, e.period_month, e.source_type, e.source_id, e.booking_ref,
       e.lead_context, e.product_scope, e.qualified_revenue_cents, e.currency,
       e.owner_position_code, p.title AS owner_position_title,
       e.attribution_role, e.share_pct, e.base_rate_bp, e.base_commission_cents,
       e.performance_eligible, e.performance_commission_cents, e.total_commission_cents,
       t.target_revenue_cents, (e.kpi_outcome->>'attainment_pct')::numeric AS attainment_pct,
       e.status, e.approver_id, e.decided_at, e.created_at
  FROM public.sales_commission_events e
  LEFT JOIN public.org_positions p ON p.code = e.owner_position_code
  LEFT JOIN public.sales_commission_targets t
    ON t.position_code = e.owner_position_code AND t.period_month = e.period_month AND t.status = 'active';