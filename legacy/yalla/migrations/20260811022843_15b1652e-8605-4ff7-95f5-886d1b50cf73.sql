ALTER TABLE public.finance_change_audit DROP CONSTRAINT IF EXISTS fca_field_class_check;
ALTER TABLE public.finance_change_audit ADD CONSTRAINT fca_field_class_check
  CHECK (field_class = ANY (ARRAY[
    'currency', 'tax', 'commission', 'partner_entitlement',
    'recognition_rule', 'review', 'payment', 'settlement', 'other'
  ]));