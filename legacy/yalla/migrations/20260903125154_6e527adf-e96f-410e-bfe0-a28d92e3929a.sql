ALTER TABLE public.carrier_compliance_items DROP CONSTRAINT IF EXISTS carrier_compliance_items_category_check;
ALTER TABLE public.carrier_compliance_items ADD CONSTRAINT carrier_compliance_items_category_check
  CHECK (category = ANY (ARRAY[
    'LICENCE','OPERATING_LICENCE','PROTECTION','INSURANCE','TAX','BUSINESS',
    'VEHICLE','VEHICLE_DOCUMENT','DRIVER','DRIVER_DOCUMENT','CONTRACT','DECLARATION','FINANCE','OTHER'
  ]));

ALTER TABLE public.carrier_requirement_templates DROP CONSTRAINT IF EXISTS carrier_requirement_templates_category_check;
ALTER TABLE public.carrier_requirement_templates ADD CONSTRAINT carrier_requirement_templates_category_check
  CHECK (category = ANY (ARRAY[
    'LICENCE','OPERATING_LICENCE','PROTECTION','INSURANCE','TAX','BUSINESS',
    'VEHICLE','VEHICLE_DOCUMENT','DRIVER','DRIVER_DOCUMENT','CONTRACT','DECLARATION','FINANCE','OTHER'
  ]));