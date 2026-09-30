CREATE OR REPLACE VIEW public.v_sales_desk_simple
WITH (security_invoker = true) AS
SELECT
  l.sales_staff_id,
  coalesce(s.full_name, 'Unassigned') AS staff_name,
  count(*) FILTER (WHERE l.stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED'))::int AS leads_working,
  count(*) FILTER (WHERE l.meeting_held_at IS NOT NULL)::int AS meetings_held,
  count(*) FILTER (WHERE l.quote_shared_at IS NOT NULL)::int AS quotes_shared,
  count(*) FILTER (WHERE l.contract_signed_at IS NOT NULL)::int AS contracts_signed,
  count(*) FILTER (WHERE l.stage = 'CLOSED_WON')::int AS won,
  count(*) FILTER (WHERE l.stage IN ('CLOSED_LOST','DISQUALIFIED'))::int AS lost,
  coalesce(sum(l.won_revenue_kes) FILTER (WHERE l.stage = 'CLOSED_WON'), 0) AS revenue_won_kes,
  count(*) FILTER (WHERE l.waiting_on = 'US')::int AS waiting_on_us,
  count(*) FILTER (WHERE l.waiting_on = 'CLIENT')::int AS waiting_on_client,
  count(*) FILTER (WHERE l.waiting_on IS NOT NULL AND l.awaiting_due_date < current_date)::int AS waiting_overdue
FROM public.sales_leads l
LEFT JOIN public.staff_members s ON s.id = l.sales_staff_id
WHERE coalesce(l.is_test, false) = false
GROUP BY l.sales_staff_id, s.full_name;

GRANT SELECT ON public.v_sales_desk_simple TO authenticated;