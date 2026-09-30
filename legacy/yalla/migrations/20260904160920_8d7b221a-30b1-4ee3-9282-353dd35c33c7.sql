ALTER TABLE public.carrier_application_events DISABLE TRIGGER carrier_application_events_immutable;
DELETE FROM public.carrier_application_events WHERE application_id IN (SELECT id FROM public.carrier_applications WHERE application_reference = 'FOA-202609-932185');
ALTER TABLE public.carrier_application_events ENABLE TRIGGER carrier_application_events_immutable;
DELETE FROM public.carrier_applications WHERE application_reference = 'FOA-202609-932185';
DELETE FROM public.carrier_compliance_items WHERE carrier_id = '48d66201-1d5c-49c1-9825-3651b6ecb8d3';
DELETE FROM public.carrier_profiles WHERE id = '48d66201-1d5c-49c1-9825-3651b6ecb8d3';
DELETE FROM public.partners WHERE id = 'e0308a73-5388-4fe8-a707-bb93a668cdda';