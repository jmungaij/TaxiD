-- Completion projection: when POD is captured, the order and its dispatch job
-- must reach their terminal delivered state too. Previously only the package
-- moved, leaving orders permanently "confirmed" and jobs "assigned".
create or replace function public._logistics_complete_on_pod()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
BEGIN
  UPDATE public.delivery_orders
     SET status = 'delivered', updated_at = now()
   WHERE id = NEW.order_id
     AND status NOT IN ('delivered', 'cancelled', 'failed');

  UPDATE public.delivery_dispatch_jobs
     SET status = 'completed', updated_at = now()
   WHERE order_id = NEW.order_id
     AND status NOT IN ('completed', 'cancelled');

  RETURN NEW;
END;
$$;

revoke all on function public._logistics_complete_on_pod() from public;
revoke all on function public._logistics_complete_on_pod() from anon;
revoke all on function public._logistics_complete_on_pod() from authenticated;

drop trigger if exists trg_logistics_complete_on_pod on public.logistics_pod_records;
create trigger trg_logistics_complete_on_pod
after insert on public.logistics_pod_records
for each row execute function public._logistics_complete_on_pod();

-- Project the already-captured certification POD forward.
update public.delivery_orders o
   set status = 'delivered', updated_at = now()
 where exists (select 1 from public.logistics_pod_records r where r.order_id = o.id)
   and o.status not in ('delivered','cancelled','failed');

update public.delivery_dispatch_jobs j
   set status = 'completed', updated_at = now()
 where exists (select 1 from public.logistics_pod_records r where r.order_id = j.order_id)
   and j.status not in ('completed','cancelled');