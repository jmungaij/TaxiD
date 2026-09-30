UPDATE public.commercial_state_registry SET work_kind = 'sales_opportunity'
 WHERE state IN ('LEAD','OPPORTUNITY','WON','CONTRACTED');
UPDATE public.commercial_state_registry SET work_kind = 'operations_task' WHERE state = 'ORDERED';
UPDATE public.commercial_state_registry SET work_kind = 'document_review'  WHERE state = 'DELIVERED';
UPDATE public.commercial_state_registry SET work_kind = 'reconciliation'
 WHERE state IN ('BILLABLE','INVOICED','RECOGNISED');

ALTER TABLE public.commercial_state_registry
  DROP CONSTRAINT IF EXISTS commercial_state_registry_work_kind_check;
ALTER TABLE public.commercial_state_registry
  ADD CONSTRAINT commercial_state_registry_work_kind_check
  CHECK (work_kind IS NULL OR work_kind IN
    ('sales_opportunity','customer_case','approval','reconciliation',
     'operations_task','document_review','training','admin_task'));