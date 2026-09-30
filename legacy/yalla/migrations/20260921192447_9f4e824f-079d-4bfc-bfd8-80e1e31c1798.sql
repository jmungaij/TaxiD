ALTER TABLE public.sales_commission_events
  DROP CONSTRAINT IF EXISTS sales_commission_events_source_type_check;
ALTER TABLE public.sales_commission_events
  ADD CONSTRAINT sales_commission_events_source_type_check
  CHECK (source_type = ANY (ARRAY['booking','transaction','manual','quotation','invoice','contract']));