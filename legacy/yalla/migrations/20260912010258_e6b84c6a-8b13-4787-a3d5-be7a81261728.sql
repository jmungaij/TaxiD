ALTER TABLE public.staff_work_items DROP CONSTRAINT IF EXISTS staff_work_items_work_kind_check;
ALTER TABLE public.staff_work_items ADD CONSTRAINT staff_work_items_work_kind_check
  CHECK (work_kind = ANY (ARRAY[
    'sales_opportunity','customer_case','approval','reconciliation','operations_task',
    'document_review','training','admin_task',
    'contract_onboarding','contract_activation','contract_amendment_billing'
  ]));